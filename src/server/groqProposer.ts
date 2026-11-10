// Groq proposer — gpt-oss-20b allocates payments, it never instructs one.
// The model chooses which approved jobs to pay now and in what order,
// under the run budget the owner set, with one reason per chosen job
// and per held job. The decision check is the ground truth: every
// chosen job goes through decide() before any PayPal call. A proposal
// the check refuses never reaches Payouts. The key lives in local .env
// only (GROQ_API_KEY), never pasted in a message, never committed.
// Free tier, no card. Groq's endpoint is OpenAI-compatible, plain
// fetch, no SDK. Structured output uses strict mode, which Groq says
// guarantees the reply matches the schema. The schema uses only the
// keywords Groq documents for strict mode: type, properties, required,
// additionalProperties, items, description.
import type { Job } from "./jobs.ts";
import type { Proposal } from "./model.ts";
import type { FetchFn } from "./paypalClient.ts";

export const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
export const GROQ_MODEL = "openai/gpt-oss-20b";

export interface GroqProposalWithReason extends Proposal {
  reason: string;
}

/** A job the model holds for a later run, with its reason. */
export interface GroqHeldJob {
  jobId: string;
  reason: string;
}

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      description: "The jobs to pay now, in the order to pay them. Their total must fit the run budget.",
      items: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "The approved job id, copied exactly." },
          recipient: { type: "string", description: "The freelancer PayPal email for that job, copied exactly." },
          amountCents: { type: "integer", description: "The payment in integer cents, copied from the approved job." },
          reason: { type: "string", description: "One sentence, why this job is paid now." },
        },
        required: ["jobId", "recipient", "amountCents", "reason"],
        additionalProperties: false,
      },
    },
    held: {
      type: "array",
      description: "The jobs not paid in this run, with one reason sentence each. Every job given must appear here or in proposals, exactly once.",
      items: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "The approved job id, copied exactly." },
          reason: { type: "string", description: "One sentence, why this job waits for a later run." },
        },
        required: ["jobId", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["proposals", "held"],
  additionalProperties: false,
};

/** Ask the model to allocate payments for the given jobs under the run
 * budget. Throws on any failure: no key, network error, non-200 reply,
 * bad JSON, a reply naming an unknown job, a job listed twice or in
 * both lists, or a reply that leaves a job in neither list. The caller
 * holds the run for the owner to pick by hand, never pays on a failed
 * model call. The run budget total is NOT checked here: the loop trims
 * a subset that does not fit the budget, so a bad model reply still
 * pays the jobs that fit, in the model's order. */
export async function groqPropose(opts: {
  jobs: Job[];
  apiKey: string;
  runBudgetCents: number;
  model?: string;
  fetchFn?: FetchFn;
  /** Extra instruction for the model, used by the hostile leg of the spike. */
  extraInstruction?: string;
}): Promise<{ proposals: GroqProposalWithReason[]; held: GroqHeldJob[]; ms: number; rawReply: string }> {
  const started = Date.now();
  const model = opts.model ?? GROQ_MODEL;
  // Soonest due first, then highest priority, so the model sees the
  // most urgent jobs first and the reply order matches that order.
  const priorityRank = (job: Job): number =>
    job.priority === "high" ? 0 : job.priority === "normal" ? 1 : job.priority === "low" ? 2 : 3;
  const sorted = [...opts.jobs].sort((a, b) => {
    const dueA = a.due ?? "";
    const dueB = b.due ?? "";
    if (dueA !== dueB) return dueA === "" ? 1 : dueB === "" ? -1 : dueA < dueB ? -1 : 1;
    const rank = priorityRank(a) - priorityRank(b);
    if (rank !== 0) return rank;
    return a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0;
  });
  const jobLines = sorted.map((job) => ({
    jobId: job.job_id,
    recipient: job.paypal_email,
    amountCents: job.amount_cents,
    currency: job.currency,
    due: job.due ?? null,
    priority: job.priority ?? null,
  }));
  const system =
    "You are the payout allocator for a small studio. Choose which approved jobs to pay now and in what order, under the run budget. Pay the most urgent first: soonest due, then highest priority. The total of the chosen jobs must fit the run budget. Copy the job id, recipient email, and amount in cents exactly from the job record for each chosen job. Give one sentence of reason for each chosen job and for each job you hold. You choose which jobs to pay; the rules still check every chosen job before any payment happens.";
  const user =
    `Approved jobs to pay, soonest due first:\n${JSON.stringify(jobLines, null, 2)}\n` +
    `Run budget for this run: ${opts.runBudgetCents} cents ($${(opts.runBudgetCents / 100).toFixed(2)}). The total of the jobs you choose must fit the run budget.\n` +
    `The owner's per-payment and rolling weekly caps are enforced by the rules after your proposal; your only budget here is the run budget above.` +
    (opts.extraInstruction ? `\n${opts.extraInstruction}` : "");
  const fetchImpl = (opts.fetchFn ?? fetch) as FetchFn;
  const res = await fetchImpl(GROQ_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "settle_allocation", strict: true, schema: PROPOSAL_SCHEMA },
      },
    }),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    throw new Error(
      `groq: request failed, HTTP ${res.status}. A 429 means the free-tier limit was hit, hold the run for the owner to pick by hand, never pay.`,
    );
  }
  const json = (await res.json()) as Record<string, unknown>;
  const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = (choice?.message ?? {}) as Record<string, unknown>;
  const content = message.content;
  if (typeof content !== "string") {
    throw new Error("groq: reply had no text content");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("groq: reply was not valid JSON, hold the run for the owner to pick by hand");
  }
  const list = (parsed as Record<string, unknown>).proposals;
  if (!Array.isArray(list)) {
    throw new Error("groq: reply had no proposals list");
  }
  const heldList = (parsed as Record<string, unknown>).held;
  if (!Array.isArray(heldList)) {
    throw new Error("groq: reply had no held list");
  }
  const knownIds = new Set(opts.jobs.map((job) => job.job_id));
  const seen = new Set<string>();
  const proposals: GroqProposalWithReason[] = list.map((entry) => {
    const item = entry as Record<string, unknown>;
    const jobId = item.jobId;
    const recipient = item.recipient;
    const amountCents = item.amountCents;
    const reason = item.reason;
    if (typeof jobId !== "string" || !knownIds.has(jobId)) {
      throw new Error(`groq: proposal names an unknown job, ${String(jobId)}, refusing the whole reply`);
    }
    if (seen.has(jobId)) {
      throw new Error(`groq: reply names job ${jobId} twice, refusing the whole reply`);
    }
    seen.add(jobId);
    if (
      typeof recipient !== "string" ||
      typeof amountCents !== "number" ||
      !Number.isInteger(amountCents) ||
      typeof reason !== "string"
    ) {
      throw new Error(`groq: proposal for job ${jobId} has a bad recipient, amount, or reason, refusing the whole reply`);
    }
    return { jobId, recipient, amountCents, source: "model" as const, reason };
  });
  const held: GroqHeldJob[] = heldList.map((entry) => {
    const item = entry as Record<string, unknown>;
    const jobId = item.jobId;
    const reason = item.reason;
    if (typeof jobId !== "string" || !knownIds.has(jobId)) {
      throw new Error(`groq: held list names an unknown job, ${String(jobId)}, refusing the whole reply`);
    }
    if (seen.has(jobId)) {
      throw new Error(`groq: reply names job ${jobId} twice, refusing the whole reply`);
    }
    seen.add(jobId);
    if (typeof reason !== "string") {
      throw new Error(`groq: held job ${jobId} has a bad reason, refusing the whole reply`);
    }
    return { jobId, reason };
  });
  for (const job of opts.jobs) {
    if (!seen.has(job.job_id)) {
      throw new Error(
        `groq: reply does not list every job exactly once, job ${job.job_id} is in neither proposals nor held, refusing the whole reply`,
      );
    }
  }
  return { proposals, held, ms, rawReply: content };
}

/** Check the model is live before the spike spends a call on it.
 * Returns true when the model id appears in the Groq models list.
 * A failure here is informational only, the chat call is the real test. */
export async function groqModelLive(opts: { apiKey: string; fetchFn?: FetchFn }): Promise<boolean> {
  const fetchImpl = (opts.fetchFn ?? fetch) as FetchFn;
  try {
    const res = await fetchImpl(GROQ_MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });
    if (!res.ok) return false;
    const json = (await res.json()) as Record<string, unknown>;
    const list = json.data;
    if (!Array.isArray(list)) return false;
    return list.some((entry) => (entry as Record<string, unknown>).id === GROQ_MODEL);
  } catch {
    return false;
  }
}
