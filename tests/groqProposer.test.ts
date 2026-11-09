// Groq proposer tests — the attack is written first, the code second.
// Attacker: the model returns a proposal for a job that does not exist,
// a wrong amount type, or invalid JSON. The proposer must refuse the
// whole reply, never pass a bad proposal on to the decision check.
// A second attacker is the provider itself: a 429 must be a named
// error, not a silent fallback to paying.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groqPropose, groqModelLive, GROQ_MODEL } from "../src/server/groqProposer.ts";
import type { Job } from "../src/server/jobs.ts";

function demoJob(jobId: string): Job {
  return {
    job_id: jobId,
    freelancer_id: `freelancer-${jobId}`,
    paypal_email: "freelancer@example.com",
    amount_cents: 100,
    currency: "USD",
    due: "2026-11-12",
    priority: "high",
    approval_state: "approved",
    approved_at: Date.now(),
    status: "waiting",
    payout_batch_id: null,
    payout_item_id: null,
    decision_reason: null,
  };
}

function groqReply(proposals: unknown, held: unknown = []): Record<string, unknown> {
  return {
    choices: [{ message: { content: JSON.stringify({ proposals, held }) } }],
  };
}

function mockFetch(reply: unknown, status = 200) {
  const seen: Array<{ url: string; body: string }> = [];
  const fetchFn = (async (url: string, init?: Record<string, unknown>) => {
    seen.push({ url, body: String((init as Record<string, unknown>).body ?? "") });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply,
    };
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

test("groqPropose parses a good reply, chosen and held jobs with reasons", async () => {
  const jobs = [demoJob("job-1"), demoJob("job-2")];
  const { fetchFn, seen } = mockFetch(
    groqReply(
      [{ jobId: "job-1", recipient: "freelancer@example.com", amountCents: 100, reason: "Due first." }],
      [{ jobId: "job-2", reason: "Does not fit the run budget." }],
    ),
  );
  const result = await groqPropose({ jobs, apiKey: "test-key", runBudgetCents: 100, fetchFn });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].jobId, "job-1");
  assert.equal(result.proposals[0].source, "model");
  assert.equal(result.proposals[0].reason, "Due first.");
  assert.deepEqual(result.held, [{ jobId: "job-2", reason: "Does not fit the run budget." }]);
  assert.equal(typeof result.ms, "number");
  const sent = JSON.parse(seen[0].body) as Record<string, unknown>;
  assert.equal(sent.model, GROQ_MODEL);
  assert.equal(sent.temperature, 0);
  const format = sent.response_format as Record<string, unknown>;
  assert.equal(format.type, "json_schema");
  assert.equal((format.json_schema as Record<string, unknown>).strict, true);
  // The model sees the run budget and the due and priority of each job.
  const messages = sent.messages as Array<{ role: string; content: string }>;
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  assert.match(user, /Run budget for this run: 100 cents/);
  assert.match(user, /"due": "2026-11-12"/);
  assert.match(user, /"priority": "high"/);
});

// The budget total is enforced by the loop, not here: a reply whose
// subset is over the run budget is accepted by the proposer and
// trimmed by the loop, so the jobs that fit still pay.
test("groqPropose accepts an over-budget subset, the loop trims it", async () => {
  const jobs = [demoJob("job-1"), demoJob("job-2")];
  const { fetchFn } = mockFetch(
    groqReply([
      { jobId: "job-1", recipient: "freelancer@example.com", amountCents: 100, reason: "Due first." },
      { jobId: "job-2", recipient: "freelancer@example.com", amountCents: 100, reason: "Due second." },
    ]),
  );
  const result = await groqPropose({ jobs, apiKey: "test-key", runBudgetCents: 100, fetchFn });
  assert.equal(result.proposals.length, 2);
  assert.deepEqual(result.held, []);
});

test("groqPropose refuses a reply naming an unknown job", async () => {
  const jobs = [demoJob("job-1")];
  const { fetchFn } = mockFetch(
    groqReply([{ jobId: "job-9", recipient: "freelancer@example.com", amountCents: 100, reason: "Invented." }]),
  );
  await assert.rejects(groqPropose({ jobs, apiKey: "test-key", runBudgetCents: 200, fetchFn }), /unknown job/);
});

test("groqPropose refuses a reply with a non-integer amount", async () => {
  const jobs = [demoJob("job-1")];
  const { fetchFn } = mockFetch(
    groqReply([{ jobId: "job-1", recipient: "freelancer@example.com", amountCents: "100", reason: "Wrong type." }]),
  );
  await assert.rejects(
    groqPropose({ jobs, apiKey: "test-key", runBudgetCents: 200, fetchFn }),
    /bad recipient, amount, or reason/,
  );
});

test("groqPropose names a 429 instead of failing silently", async () => {
  const jobs = [demoJob("job-1")];
  const { fetchFn } = mockFetch({ error: { message: "rate limit" } }, 429);
  await assert.rejects(groqPropose({ jobs, apiKey: "test-key", runBudgetCents: 200, fetchFn }), /429/);
});

test("groqPropose refuses a reply that is not valid JSON", async () => {
  const jobs = [demoJob("job-1")];
  const fetchFn = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "not json at all" } }] }),
  })) as unknown as typeof fetch;
  await assert.rejects(groqPropose({ jobs, apiKey: "test-key", runBudgetCents: 200, fetchFn }), /not valid JSON/);
});

test("groqModelLive finds the model id in the models list", async () => {
  const fetchFn = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: GROQ_MODEL }, { id: "openai/gpt-oss-120b" }] }),
  })) as unknown as typeof fetch;
  assert.equal(await groqModelLive({ apiKey: "test-key", fetchFn }), true);
  const missingFn = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: "openai/gpt-oss-120b" }] }),
  })) as unknown as typeof fetch;
  assert.equal(await groqModelLive({ apiKey: "test-key", fetchFn: missingFn }), false);
});
