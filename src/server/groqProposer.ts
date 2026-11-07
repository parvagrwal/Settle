// Groq proposer — gpt-oss-20b proposes payments, it never instructs one.
// The decision check is the ground truth: every proposal goes through
// decide() before any PayPal call. A proposal the check refuses never
// reaches Payouts. The key lives in local .env only (GROQ_API_KEY),
// never pasted in a message, never committed. Free tier, no card.
// Groq's endpoint is OpenAI-compatible, plain fetch, no SDK.
// Structured output uses strict mode, which Groq says guarantees the
// reply matches the schema. The schema uses only the keywords Groq
// documents for strict mode: type, properties, required,
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

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      description: "One proposal per approved job that should be paid.",
      items: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "The approved job id, copied exactly." },
          recipient: { type: "string", description: "The freelancer PayPal email for that job, copied exactly." },
          amountCents: { type: "integer", description: "The payment in integer cents, copied from the approved job." },
          reason: { type: "string", description: "One sentence, why this job should be paid now." },
        },
        required: ["jobId", "recipient", "amountCents", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["proposals"],
  additionalProperties: false,
};

/** Ask the model to propose payments for the given jobs. Throws on any
 * failure: no key, network error, non-200 reply, bad JSON, a proposal
 * naming an unknown job, or a proposal with a bad recipient, amount, or
 * reason. The caller falls back to the rule-based proposer and records
 * the fallback, never pays on a failed model call. */
export async function groqPropose(opts: {
  jobs: Job[];
  apiKey: string;
  model?: string;
  fetchFn?: FetchFn;
  /** Extra instruction for the model, used by the hostile leg of the spike. */
  extraInstruction?: string;
}): Promise<{ proposals: GroqProposalWithReason[]; ms: number; rawReply: string }> {
  const started = Date.now();
  const model = opts.model ?? GROQ_MODEL;
  const jobLines = opts.jobs.map((job) => ({
    jobId: job.job_id,
    recipient: job.paypal_email,
    amountCents: job.amount_cents,
    currency: job.currency,
  }));
  const system =
    "You are the payment proposer for a small studio. Propose a payment for each approved job listed. Copy the job id, recipient email, and amount in cents exactly from the job. Give one sentence of reason per proposal. You never decide whether a payment happens, you only propose.";
  const user =
    `Approved jobs to pay:\n${JSON.stringify(jobLines, null, 2)}` +
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
        json_schema: { name: "settle_proposals", strict: true, schema: PROPOSAL_SCHEMA },
      },
    }),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    throw new Error(
      `groq: request failed, HTTP ${res.status}. A 429 means the free-tier limit was hit, fall back to the rule-based proposer, never pay.`,
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
    throw new Error("groq: reply was not valid JSON, fall back to the rule-based proposer");
  }
  const list = (parsed as Record<string, unknown>).proposals;
  if (!Array.isArray(list)) {
    throw new Error("groq: reply had no proposals list");
  }
  const knownIds = new Set(opts.jobs.map((job) => job.job_id));
  const proposals: GroqProposalWithReason[] = list.map((entry) => {
    const item = entry as Record<string, unknown>;
    const jobId = item.jobId;
    const recipient = item.recipient;
    const amountCents = item.amountCents;
    const reason = item.reason;
    if (typeof jobId !== "string" || !knownIds.has(jobId)) {
      throw new Error(`groq: proposal names an unknown job, ${String(jobId)}, refusing the whole reply`);
    }
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
  return { proposals, ms, rawReply: content };
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
