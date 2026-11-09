// Wiring tests — the model allocator meets the loop proposer.
// Attacker: the provider fails (429), the model invents a job, or
// there is no key at all. Every failure must hold the run for the
// owner to pick by hand and pay nothing, never auto-pay the full set
// and never throw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groqAllocator } from "../src/server/groqAgent.ts";
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

function groqReply(proposals: unknown, held: unknown = []): Record<string, unknown> {
  return {
    choices: [{ message: { content: JSON.stringify({ proposals, held }) } }],
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

test("model success wires model allocations into a sync proposer, with the held jobs", async () => {
  const jobs = [demoJob("job-1"), demoJob("job-2")];
  const { fetchFn } = mockFetch(
    groqReply(
      [{ jobId: "job-1", recipient: "freelancer@example.com", amountCents: 100, reason: "Due first." }],
      [{ jobId: "job-2", reason: "Does not fit the run budget." }],
    ),
  );
  const wired = await groqAllocator({ jobs, apiKey: "test-key", runBudgetCents: 100, fetchFn });
  assert.equal(wired.source, "model");
  assert.equal(wired.reason, null);
  assert.equal(typeof wired.ms, "number");
  assert.deepEqual(wired.held, [{ jobId: "job-2", reason: "Does not fit the run budget." }]);
  const proposals = wired.proposer(jobs);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].jobId, "job-1");
  assert.equal(proposals[0].source, "model");
});

test("a 429 holds the run for the owner and pays nothing", async () => {
  const jobs = [demoJob("job-1")];
  const { fetchFn } = mockFetch({ error: { message: "rate limit" } }, 429);
  const wired = await groqAllocator({ jobs, apiKey: "test-key", runBudgetCents: 200, fetchFn });
  assert.equal(wired.source, "manual-hold");
  assert.match(wired.reason ?? "", /429/);
  assert.match(wired.reason ?? "", /pick the jobs by hand/);
  assert.deepEqual(wired.proposer(jobs), []);
  assert.deepEqual(wired.held, []);
});

test("a reply naming an unknown job holds the run for the owner", async () => {
  const jobs = [demoJob("job-1")];
  const { fetchFn } = mockFetch(
    groqReply([{ jobId: "job-9", recipient: "freelancer@example.com", amountCents: 100, reason: "Invented." }]),
  );
  const wired = await groqAllocator({ jobs, apiKey: "test-key", runBudgetCents: 200, fetchFn });
  assert.equal(wired.source, "manual-hold");
  assert.match(wired.reason ?? "", /unknown job/);
  assert.deepEqual(wired.proposer(jobs), []);
});

test("no key holds the run without calling the model", async () => {
  const jobs = [demoJob("job-1")];
  const { fetchFn, seen } = mockFetch(groqReply([]));
  const wired = await groqAllocator({ jobs, apiKey: "", runBudgetCents: 200, fetchFn });
  assert.equal(wired.source, "manual-hold");
  assert.match(wired.reason ?? "", /no GROQ_API_KEY/);
  assert.match(wired.reason ?? "", /pick the jobs by hand/);
  assert.equal(seen.length, 0);
  assert.deepEqual(wired.proposer(jobs), []);
});

test("no waiting jobs makes no model call", async () => {
  const { fetchFn, seen } = mockFetch(groqReply([]));
  const wired = await groqAllocator({ jobs: [], apiKey: "test-key", runBudgetCents: 200, fetchFn });
  assert.equal(wired.source, "model");
  assert.match(wired.reason ?? "", /no approved jobs are waiting/);
  assert.equal(seen.length, 0);
  assert.deepEqual(wired.proposer([]), []);
});
