// Agent loop tests — the decision check is the ground truth, and the
// audit trail records every decision. Tests are written attack-first:
// each one names the attack, then asserts the check stops it and the
// payout call never happens. No live PayPal call, no money moved, in
// these tests. Live payout is proved separately, in scripts/run-agent.ts,
// with sandbox $1 items, and saved in evidence/audit/.
// Run: node --test tests/agent.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuditLog, rowFromDecision } from "../src/server/audit.ts";
import { ruleBasedProposal } from "../src/server/model.ts";
import { runAgentLoop, type PayFn } from "../src/server/agent.ts";
import { createSettleServer } from "../src/server/routes.ts";
import type { Job } from "../src/server/jobs.ts";

type MockResponse = {
  status: number;
  ok: boolean;
  json: () => Promise<Record<string, unknown>>;
  headers: { get: (name: string) => string | null };
};

function mockResponse(status: number, json: Record<string, unknown>): MockResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => json,
    headers: { get: () => null },
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    job_id: "job-1",
    freelancer_id: "freelancer-1",
    paypal_email: "freelancer@example.com",
    amount_cents: 10000, // $100
    currency: "USD",
    approval_state: "approved",
    approved_at: Date.now(),
    status: "waiting",
    payout_batch_id: null,
    payout_item_id: null,
    decision_reason: null,
    ...overrides,
  };
}

function makeAllowlist(): Set<string> {
  return new Set(["freelancer@example.com", "freelancer-2@example.com"]);
}

/** Stand-in for the payout call: records what it was given, pays nothing real. */
function makeStubPay(): { payFn: PayFn; calls: Job[][] } {
  const calls: Job[][] = [];
  const payFn: PayFn = async (o) => {
    calls.push([...o.jobs]);
    for (const job of o.jobs) {
      job.payout_batch_id = "BATCH-STUB";
      job.status = "paid";
    }
    return {
      accepted: o.jobs,
      rejected: [],
      payoutBatchId: "BATCH-STUB",
      batchStatus: "SUCCESS",
      senderBatchId: "sender-stub",
    };
  };
  return { payFn, calls };
}

test("audit log is append-only: rows get ids in order, and returned rows are copies", () => {
  const log = createAuditLog();
  const first = log.write({
    actor: "agent",
    job_id: "job-1",
    action: "accepted",
    reason: "accepted: approved job",
    amount_cents: 10000,
    payout_batch_id: null,
    paypal_transaction_id: null,
  });
  assert.equal(first.audit_id, "audit-1");
  assert.equal(typeof first.at, "number");
  log.write({
    actor: "agent",
    job_id: "job-1",
    action: "paid",
    reason: "paid in batch BATCH-STUB",
    amount_cents: 10000,
    payout_batch_id: "BATCH-STUB",
    paypal_transaction_id: null,
  });
  const rows = log.rows();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].audit_id, "audit-2");
  rows[0].reason = "tampered";
  assert.notEqual(log.rows()[0].reason, "tampered");
  assert.equal(log.rows().length, 2);
});

test("audit row from a decision names the rule, the cap, and the job", () => {
  const accepted = rowFromDecision({
    actor: "agent",
    jobId: "job-1",
    amountCents: 10000,
    decision: { decision: "accept" },
  });
  assert.match(accepted.reason, /\$200 per-payment cap/);
  assert.match(accepted.reason, /\$1,500 weekly cap/);
  const rejected = rowFromDecision({
    actor: "agent",
    jobId: "job-1",
    amountCents: 99900,
    decision: { decision: "reject", label: "PerRequestCapExceeded", reason: "payment exceeds the $200 per-payment cap" },
  });
  assert.equal(rejected.action, "rejected");
  assert.match(rejected.reason, /PerRequestCapExceeded/);
});

test("hallucinated amount over the per-payment cap is rejected, payout never called", async () => {
  const { payFn, calls } = makeStubPay();
  const job = makeJob({ amount_cents: 10000 });
  const result = await runAgentLoop({
    jobs: [job],
    allowlistedEmails: makeAllowlist(),
    proposer: () => [{ jobId: "job-1", recipient: "freelancer@example.com", amountCents: 99900, source: "model" as const }],
    payFn,
  });
  assert.equal(calls.length, 0);
  assert.equal(result.payoutBatchId, null);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].label, "PerRequestCapExceeded");
  assert.equal(job.status, "waiting_for_meera");
  assert.match(job.decision_reason ?? "", /PerRequestCapExceeded/);
  assert.equal(result.auditRows.length, 1);
  assert.match(result.auditRows[0].reason, /PerRequestCapExceeded/);
});

test("hallucinated amount over the weekly cap is rejected, payout never called", async () => {
  const { payFn, calls } = makeStubPay();
  const job = makeJob({ amount_cents: 20000 }); // $200, exactly the per-payment cap
  const result = await runAgentLoop({
    jobs: [job],
    allowlistedEmails: makeAllowlist(),
    spentInWindowCents: 140000, // $1,400 already spent this week
    payFn,
  });
  assert.equal(calls.length, 0);
  assert.equal(result.rejected[0].label, "WindowCapExceeded");
  assert.equal(job.status, "waiting_for_meera");
});

test("hallucinated recipient, not on the allowlist, is rejected, payout never called", async () => {
  const { payFn, calls } = makeStubPay();
  const job = makeJob();
  const result = await runAgentLoop({
    jobs: [job],
    allowlistedEmails: makeAllowlist(),
    proposer: () => [{ jobId: "job-1", recipient: "stranger@example.com", amountCents: 10000, source: "model" as const }],
    payFn,
  });
  assert.equal(calls.length, 0);
  assert.equal(result.rejected[0].label, "RecipientNotAllowed");
  assert.equal(job.status, "blocked");
});

test("proposal naming a job that does not exist is rejected, payout never called", async () => {
  const { payFn, calls } = makeStubPay();
  const result = await runAgentLoop({
    jobs: [makeJob()],
    allowlistedEmails: makeAllowlist(),
    proposer: () => [{ jobId: "job-no-such", recipient: "freelancer@example.com", amountCents: 10000, source: "model" as const }],
    payFn,
  });
  assert.equal(calls.length, 0);
  assert.equal(result.rejected[0].label, "JobNotApproved");
  assert.match(result.auditRows[0].reason, /no such job/);
});

test("amount inside the caps but different from the approved job is still refused", async () => {
  const { payFn, calls } = makeStubPay();
  const job = makeJob({ amount_cents: 10000 }); // approved $100
  const result = await runAgentLoop({
    jobs: [job],
    allowlistedEmails: makeAllowlist(),
    proposer: () => [{ jobId: "job-1", recipient: "freelancer@example.com", amountCents: 15000, source: "model" as const }],
    payFn,
  });
  // The check passes on $150 as stated, but the studio approved $100,
  // so the agent refuses to pay the invented amount.
  assert.equal(calls.length, 0);
  assert.equal(result.rejected[0].label, "Mismatch");
  assert.match(result.rejected[0].reason, /15000 cents/);
  assert.match(result.rejected[0].reason, /10000 cents/);
  assert.equal(job.status, "blocked");
});

test("expired approval is rejected, payout never called", async () => {
  const { payFn, calls } = makeStubPay();
  const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
  const job = makeJob({ approved_at: Date.now() - eightDaysMs });
  const result = await runAgentLoop({
    jobs: [job],
    allowlistedEmails: makeAllowlist(),
    payFn,
  });
  assert.equal(calls.length, 0);
  assert.equal(result.rejected[0].label, "JobNotApproved");
});

test("valid proposal pays, and a rejected job in the same loop is left out", async () => {
  const { payFn, calls } = makeStubPay();
  const good = makeJob({ job_id: "job-1", amount_cents: 10000 });
  const bad = makeJob({ job_id: "job-2", freelancer_id: "freelancer-2", paypal_email: "freelancer-2@example.com", amount_cents: 99900 });
  const audit = createAuditLog();
  const result = await runAgentLoop({
    jobs: [good, bad],
    allowlistedEmails: makeAllowlist(),
    audit,
    payFn,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.equal(calls[0][0].job_id, "job-1");
  assert.equal(result.payoutBatchId, "BATCH-STUB");
  assert.equal(result.batchStatus, "SUCCESS");
  assert.equal(good.status, "paid");
  assert.equal(good.payout_batch_id, "BATCH-STUB");
  assert.equal(bad.status, "waiting_for_meera");
  const paidRows = result.auditRows.filter((row) => row.action === "paid");
  assert.equal(paidRows.length, 1);
  assert.equal(paidRows[0].payout_batch_id, "BATCH-STUB");
});

test("duplicate payment for an already-paid job is rejected, payout never called", async () => {
  const { payFn, calls } = makeStubPay();
  const job = makeJob({ status: "paid", payout_batch_id: "BATCH-OLD" });
  const result = await runAgentLoop({
    jobs: [job],
    allowlistedEmails: makeAllowlist(),
    proposer: () => [{ jobId: "job-1", recipient: "freelancer@example.com", amountCents: 10000, source: "rule-based" as const }],
    payFn,
  });
  assert.equal(calls.length, 0);
  assert.equal(result.rejected[0].label, "DuplicatePayout");
});

test("every decision writes an audit row, including rejections", async () => {
  const { payFn } = makeStubPay();
  const good = makeJob({ job_id: "job-1" });
  const overCap = makeJob({ job_id: "job-2", freelancer_id: "freelancer-2", paypal_email: "freelancer-2@example.com", amount_cents: 99900 });
  const unlisted = makeJob({ job_id: "job-3", freelancer_id: "freelancer-3", paypal_email: "outsider@example.com" });
  const result = await runAgentLoop({
    jobs: [good, overCap, unlisted],
    allowlistedEmails: makeAllowlist(),
    payFn,
  });
  // One accepted row, two rejected rows, one paid row.
  assert.equal(result.auditRows.length, 4);
  const rejectedRows = result.auditRows.filter((row) => row.action === "rejected");
  assert.equal(rejectedRows.length, 2);
  assert.ok(rejectedRows.every((row) => row.reason.length > 0));
  assert.ok(rejectedRows.some((row) => row.reason.includes("PerRequestCapExceeded")));
  assert.ok(rejectedRows.some((row) => row.reason.includes("RecipientNotAllowed")));
});

test("rule-based proposer proposes approved waiting jobs only, labelled rule-based", () => {
  const jobs = [
    makeJob({ job_id: "job-1" }),
    makeJob({ job_id: "job-2", status: "paid" }),
    makeJob({ job_id: "job-3", approval_state: "not_approved" }),
  ];
  const proposals = ruleBasedProposal(jobs);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].jobId, "job-1");
  assert.equal(proposals[0].source, "rule-based");
});

test("routes: owner approves a new email once, pay holds for the owner, then Pay Selected pays it, audit shows all four steps", async () => {
  const fetchFn = (async (url: string, init: Record<string, unknown>) => {
    const method = (init.method as string) ?? "GET";
    if (method === "POST") {
      return mockResponse(201, { batch_header: { payout_batch_id: "BATCH-7", batch_status: "PENDING" } });
    }
    return mockResponse(200, { batch_header: { payout_batch_id: "BATCH-7", batch_status: "SUCCESS" } });
  }) as unknown as typeof fetch;
  const job = makeJob({ approval_state: "not_approved", approved_at: null });
  const app = createSettleServer({
    jobs: [job],
    allowlistedEmails: new Set<string>(),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn,
  });
  const port = await app.listen(0);
  try {
    const base = `http://127.0.0.1:${port}`;
    const approveRes = await fetch(`${base}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: "job-1" }),
    });
    assert.equal(approveRes.status, 200);
    const approved = (await approveRes.json()) as { job: Job };
    assert.equal(approved.job.approval_state, "approved");
    assert.ok(app.store.allowlistedEmails.has("freelancer@example.com"));

    // No Groq key was passed, so the first Pay holds for the owner to
    // pick by hand and pays nothing.
    const holdRes = await fetch(`${base}/api/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(holdRes.status, 200);
    const held = (await holdRes.json()) as {
      payout_batch_id: string | null;
      accepted: string[];
      proposer: string;
      held_for_selection: string[];
      hold_reason: string | null;
    };
    assert.equal(held.payout_batch_id, null);
    assert.deepEqual(held.accepted, []);
    assert.equal(held.proposer, "manual-hold");
    assert.deepEqual(held.held_for_selection, ["job-1"]);
    assert.match(held.hold_reason ?? "", /pick the jobs by hand/);

    const payRes = await fetch(`${base}/api/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedJobIds: ["job-1"] }),
    });
    assert.equal(payRes.status, 200);
    const paid = (await payRes.json()) as { payout_batch_id: string; accepted: string[]; proposer: string };
    assert.equal(paid.payout_batch_id, "BATCH-7");
    assert.deepEqual(paid.accepted, ["job-1"]);
    assert.equal(paid.proposer, "owner");

    const gridRes = await fetch(`${base}/api/grid`);
    const grid = (await gridRes.json()) as { rows: Array<{ job_id: string; status: string; payout_batch_id: string | null }> };
    assert.equal(grid.rows[0].status, "paid");
    assert.equal(grid.rows[0].payout_batch_id, "BATCH-7");

    const auditRes = await fetch(`${base}/api/audit`);
    const auditBody = (await auditRes.json()) as { rows: Array<{ actor: string; action: string }> };
    assert.ok(auditBody.rows.some((row) => row.actor === "owner" && row.action === "accepted"));
    assert.ok(auditBody.rows.some((row) => row.actor === "agent" && row.action === "held"));
    assert.ok(auditBody.rows.some((row) => row.actor === "agent" && row.action === "accepted"));
    assert.ok(auditBody.rows.some((row) => row.actor === "agent" && row.action === "paid"));
  } finally {
    await app.close();
  }
});

test("routes: pay with no sandbox credentials returns 503 and names the missing setup", async () => {
  const app = createSettleServer({ jobs: [makeJob()], allowlistedEmails: makeAllowlist() });
  const port = await app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/pay`, { method: "POST" });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /sandbox credentials are missing/);
  } finally {
    await app.close();
  }
});

test("routes: approve of an unknown job returns 404, and no response carries the token", async () => {
  const token = "token-value-that-must-stay-server-side";
  const app = createSettleServer({
    jobs: [makeJob()],
    allowlistedEmails: makeAllowlist(),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token,
  });
  const port = await app.listen(0);
  try {
    const base = `http://127.0.0.1:${port}`;
    const res = await fetch(`${base}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: "job-no-such" }),
    });
    assert.equal(res.status, 404);
    for (const path of ["/api/jobs", "/api/grid", "/api/audit"]) {
      const getRes = await fetch(`${base}${path}`);
      assert.equal(getRes.status, 200);
      const text = await getRes.text();
      assert.ok(!text.includes(token), `${path} must not carry the token`);
    }
  } finally {
    await app.close();
  }
});
