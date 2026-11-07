// Wiring tests — the model proposer meets the loop proposer.
// Attacker: the provider fails (429), the model invents a job, or
// there is no key at all. Every failure must fall back to the
// rule-based proposer and say so, never pay and never throw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groqOrRuleBasedProposer } from "../src/server/groqAgent.ts";
import type { Job } from "../src/server/jobs.ts";

function demoJob(jobId: string): Job {
  return {
    job_id: jobId,
    freelancer_id: `freelancer-${jobId}`,
    paypal_email: "freelancer@example.com",
    amount_cents: 100,
    currency: "USD",
    approval_state: "approved",
    approved_at: Date.now(),
    status: "waiting",
    payout_batch_id: null,
    payout_item_id: null,
    decision_reason: null,
  };
}

function groqReply(proposals: unknown): Record<string, unknown> {
  return {
    choices: [{ message: { content: JSON.stringify({ proposals }) } }],
  };
}

function mockFetch(reply: unknown, status = 200) {
  const seen: Array<{ url: string }> = [];
  const fetchFn = (async (url: string) => {
    seen.push({ url });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply,
    };
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

test("model success wires model proposals into a sync proposer", async () => {
  const jobs = [demoJob("job-1"), demoJob("job-2")];
  const { fetchFn } = mockFetch(
    groqReply([
      { jobId: "job-1", recipient: "freelancer@example.com", amountCents: 100, reason: "Approved work, due now." },
      { jobId: "job-2", recipient: "freelancer@example.com", amountCents: 100, reason: "Approved work, due now." },
    ]),
  );
  const wired = await groqOrRuleBasedProposer({ jobs, apiKey: "test-key", fetchFn });
  assert.equal(wired.source, "model");
  assert.equal(wired.reason, null);
  assert.equal(typeof wired.ms, "number");
  const proposals = wired.proposer(jobs);
  assert.equal(proposals.length, 2);
  assert.equal(proposals[0].jobId, "job-1");
  assert.equal(proposals[0].source, "model");
});

test("a 429 falls back to rule-based and names the failure", async () => {
  const jobs = [demoJob("job-1")];
  const { fetchFn } = mockFetch({ error: { message: "rate limit" } }, 429);
  const wired = await groqOrRuleBasedProposer({ jobs, apiKey: "test-key", fetchFn });
  assert.equal(wired.source, "rule-based");
  assert.match(wired.reason ?? "", /429/);
  const proposals = wired.proposer(jobs);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].source, "rule-based");
});

test("a reply naming an unknown job falls back to rule-based", async () => {
  const jobs = [demoJob("job-1")];
  const { fetchFn } = mockFetch(
    groqReply([{ jobId: "job-9", recipient: "freelancer@example.com", amountCents: 100, reason: "Invented." }]),
  );
  const wired = await groqOrRuleBasedProposer({ jobs, apiKey: "test-key", fetchFn });
  assert.equal(wired.source, "rule-based");
  assert.match(wired.reason ?? "", /unknown job/);
  assert.equal(wired.proposer(jobs).length, 1);
});

test("no key falls back to rule-based without calling the model", async () => {
  const jobs = [demoJob("job-1")];
  const { fetchFn, seen } = mockFetch(groqReply([]));
  const wired = await groqOrRuleBasedProposer({ jobs, apiKey: "", fetchFn });
  assert.equal(wired.source, "rule-based");
  assert.match(wired.reason ?? "", /no GROQ_API_KEY/);
  assert.equal(seen.length, 0);
  assert.equal(wired.proposer(jobs).length, 1);
});
