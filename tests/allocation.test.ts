// AI-allocation tests — the model chooses which approved jobs to pay now,
// in what order, under an owner-set run budget, with reasons, instead of
// copying every approved job. Attack-first: each test names the attacker
// and the attack it must defeat, before the wiring exists.
// Attacker 1: two run budgets. Attack: the same jobs pay the same set
// whatever the budget says (the model copies every approved job).
// Attacker 2: a model reply over the run budget. Attack: paying over the
// budget the owner set for this run.
// Attacker 3: a model reply naming an unknown job, a wrong amount, or a
// wrong recipient. Attack: paying a job that does not exist, or paying
// the wrong amount to the wrong person.
// Attacker 4: no Groq key. Attack: the run auto-pays the full set with
// no model and no owner choice.
// Attacker 5: the owner picks jobs by hand. Attack: paying jobs the
// owner did not pick.
// Attacker 6: a replayed second Pay click. Attack: paying or billing
// the same jobs twice.
// Attacker 7: the over-cap job. Attack: the model is handed the
// over-cap job as a candidate, or it is paid.
// Attacker 8: a run budget above the weekly cap. Attack: the owner sets
// a budget the weekly cap forbids, and the server pays anyway.
// Run: node --test tests/allocation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettleServer } from "../src/server/routes.ts";
import { seedJobs } from "../src/server/seed.ts";
import { runAgentLoop, type PayFn } from "../src/server/agent.ts";
import { createAuditLog } from "../src/server/audit.ts";
import { groqPropose } from "../src/server/groqProposer.ts";
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

interface PayResponse {
  accepted: string[];
  rejected: Array<{ job_id: string; label: string; reason: string }>;
  payout_batch_id: string | null;
  batch_status: string | null;
  proposer: string;
  proposer_reason: string | null;
  held: Array<{ job_id: string; reason: string }>;
  held_for_selection: string[];
  hold_reason: string | null;
  invoice_id?: string | null;
  invoice_status?: string | null;
  invoice_total_cents?: number | null;
  invoice_error?: string | null;
  error?: string;
}

type GroqReply = {
  proposals: Array<{ jobId: string; recipient: string; amountCents: number; reason: string }>;
  held: Array<{ jobId: string; reason: string }>;
};

type GroqHandler = (body: Record<string, unknown>) => GroqReply;

/** A stand-in model that allocates the way a good model should: soonest
    due and highest priority first, taking jobs while they fit the run
    budget, and holding the rest with a reason. It reads the candidates
    and the run budget from the request the server sent, so a budget that
    never reaches the model cannot pass this test. */
function greedyByDue(): GroqHandler {
  return (body) => {
    const messages = body.messages as Array<{ role: string; content: string }>;
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    const budget = Number((user.match(/Run budget for this run: (\d+) cents/) ?? [])[1] ?? 0);
    const ids = [...user.matchAll(/"jobId": "([^"]+)"/g)].map((m) => m[1]);
    const amounts = [...user.matchAll(/"amountCents": (\d+)/g)].map((m) => Number(m[1]));
    const proposals: GroqReply["proposals"] = [];
    const held: GroqReply["held"] = [];
    let spent = 0;
    ids.forEach((jobId, index) => {
      const amount = amounts[index] ?? 100;
      const reason =
        index === 0
          ? `Due soonest and highest priority, fits the run budget.`
          : `Due before the held jobs, fits the run budget.`;
      if (spent + amount <= budget) {
        proposals.push({ jobId, recipient: "freelancer@example.com", amountCents: amount, reason });
        spent += amount;
      } else {
        held.push({ jobId, reason: `Does not fit the run budget, so it waits for a later run.` });
      }
    });
    return { proposals, held };
  };
}

/** Mock fetch that answers Groq, Payouts, and Invoicing, and records calls. */
function makeMock(opts: { groqHandler?: GroqHandler; batchStatus?: string } = {}) {
  const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
  const groqBodies: Array<Record<string, unknown>> = [];
  let invoiceGetCount = 0;
  const fetchFn = (async (url: string, init: Record<string, unknown>) => {
    calls.push({ url, init });
    const method = (init.method as string) ?? "GET";
    if (url.includes("api.groq.com")) {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      groqBodies.push(body);
      if (!opts.groqHandler) throw new Error("mock: unexpected Groq call, no handler set");
      const reply = opts.groqHandler(body);
      return mockResponse(200, { choices: [{ message: { content: JSON.stringify(reply) } }] });
    }
    if (url.includes("/v1/payments/payouts")) {
      if (method === "POST") {
        return mockResponse(201, { batch_header: { payout_batch_id: "BATCH-ALLOC", batch_status: "PENDING" } });
      }
      return mockResponse(200, {
        batch_header: { payout_batch_id: "BATCH-ALLOC", batch_status: opts.batchStatus ?? "SUCCESS" },
      });
    }
    if (url.includes("/v2/invoicing/invoices")) {
      if (method === "POST" && url.endsWith("/send")) {
        return mockResponse(200, { id: "INV2-ALLOC-001", status: "SENT" });
      }
      if (method === "POST") {
        return mockResponse(201, { id: "INV2-ALLOC-001", status: "DRAFT" });
      }
      invoiceGetCount++;
      const status = invoiceGetCount === 1 ? "DRAFT" : "SENT";
      return mockResponse(200, { id: "INV2-ALLOC-001", status });
    }
    throw new Error(`mock: unexpected call ${method} ${url}`);
  }) as unknown as typeof fetch;
  return {
    fetchFn,
    calls,
    groqBodies,
    payoutCalls: () => calls.filter((call) => call.url.includes("/v1/payments/payouts")),
    invoicingCalls: () => calls.filter((call) => call.url.includes("/v2/invoicing/")),
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    job_id: "job-1",
    freelancer_id: "freelancer-1",
    paypal_email: "freelancer@example.com",
    amount_cents: 100,
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

async function startServer(mock: ReturnType<typeof makeMock>, opts: { groqApiKey?: string; clientEmail?: string } = {}) {
  const jobs = seedJobs("freelancer@example.com");
  const app = createSettleServer({
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
    ...(opts.groqApiKey !== undefined ? { groqApiKey: opts.groqApiKey } : {}),
    ...(opts.clientEmail !== undefined ? { clientEmail: opts.clientEmail } : {}),
  });
  const port = await app.listen(0);
  return { app, port };
}

async function postPay(port: number, body?: Record<string, unknown>): Promise<{ status: number; data: PayResponse }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/pay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, data: (await res.json()) as PayResponse };
}

async function approve(port: number, jobId: string): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/api/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ job_id: jobId, approver_email: "owner@example.com" }),
  });
  assert.equal(res.status, 200, `approve ${jobId} failed with ${res.status}`);
}

// Attacker 1: two run budgets must produce two different paid subsets.
test("two run budgets pay two different subsets, the model allocates under the budget", async () => {
  const mock = makeMock({ groqHandler: greedyByDue() });
  const { app, port } = await startServer(mock, { groqApiKey: "test-key", clientEmail: "client@example.com" });
  try {
    await approve(port, "demo-approve-1");
    const small = await postPay(port, { runBudgetCents: 200 });
    assert.equal(small.status, 200);
    assert.deepEqual(small.data.accepted, ["demo-waiting-1", "demo-approve-1"]);
    assert.equal(small.data.batch_status, "SUCCESS");
    assert.equal(small.data.proposer, "model");
    assert.deepEqual(
      small.data.held.map((h) => h.job_id),
      ["demo-waiting-2"],
    );
    assert.match(small.data.held[0].reason, /run budget/i);

    // The third job is still waiting, so a bigger budget pays it too.
    const big = await postPay(port, { runBudgetCents: 300 });
    assert.equal(big.status, 200);
    assert.deepEqual(big.data.accepted, ["demo-waiting-2"]);
  } finally {
    await app.close();
  }
});

// Demo anchor: after approving demo-approve-1, three waiting $1.00 jobs
// with a $2.00 run budget, the model pays 2 and holds 1 with a reason.
test("demo anchor: three $1.00 waiting jobs, $2.00 run budget, model pays 2 and holds 1 with a reason", async () => {
  const mock = makeMock({ groqHandler: greedyByDue() });
  const { app, port } = await startServer(mock, { groqApiKey: "test-key", clientEmail: "client@example.com" });
  try {
    await approve(port, "demo-approve-1");
    const paid = await postPay(port, { runBudgetCents: 200 });
    assert.equal(paid.status, 200);
    assert.deepEqual(paid.data.accepted, ["demo-waiting-1", "demo-approve-1"]);
    assert.equal(paid.data.batch_status, "SUCCESS");
    assert.deepEqual(
      paid.data.held.map((h) => h.job_id),
      ["demo-waiting-2"],
    );
    assert.ok(paid.data.held[0].reason.length > 10, "held job has no reason sentence");
    assert.equal(paid.data.invoice_id, "INV2-ALLOC-001");
    assert.equal(paid.data.invoice_status, "SENT");
    assert.equal(paid.data.invoice_total_cents, 200);
  } finally {
    await app.close();
  }
});

// Attacker 2: a model reply whose subset total exceeds the run budget is
// trimmed, never paid over budget.
test("model reply over the run budget is trimmed, never paid over budget", async () => {
  const jobs = [makeJob({ job_id: "job-1" }), makeJob({ job_id: "job-2" }), makeJob({ job_id: "job-3" })];
  const audit = createAuditLog();
  const { payFn, calls } = makeStubPay();
  const result = await runAgentLoop({
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com"]),
    audit,
    runBudgetCents: 200,
    proposer: () => [
      { jobId: "job-1", recipient: "freelancer@example.com", amountCents: 100, source: "model", reason: "Due first." },
      { jobId: "job-2", recipient: "freelancer@example.com", amountCents: 100, source: "model", reason: "Due second." },
      { jobId: "job-3", recipient: "freelancer@example.com", amountCents: 100, source: "model", reason: "Due third." },
    ],
    payFn,
  });
  assert.deepEqual(
    result.accepted.map((job) => job.job_id),
    ["job-1", "job-2"],
  );
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].proposalJobId, "job-3");
  assert.equal(result.rejected[0].label, "RunBudgetExceeded");
  assert.match(result.rejected[0].reason, /run budget/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2);
  assert.equal(jobs[2].status, "waiting");
  assert.match(jobs[2].decision_reason ?? "", /RunBudgetExceeded/);
});

// Attacker 3a: a model reply naming an unknown job is refused, never paid.
test("model reply naming an unknown job is refused, never paid", async () => {
  const jobs = seedJobs("freelancer@example.com");
  const fetchFn = (async () => {
    return mockResponse(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              proposals: [
                { jobId: "demo-waiting-1", recipient: "freelancer@example.com", amountCents: 100, reason: "Due first." },
                { jobId: "job-that-does-not-exist", recipient: "freelancer@example.com", amountCents: 100, reason: "Invented." },
              ],
              held: [{ jobId: "demo-waiting-2", reason: "Waits." }],
            }),
          },
        },
      ],
    });
  }) as unknown as typeof fetch;
  await assert.rejects(
    groqPropose({ jobs: jobs.filter((j) => j.status === "waiting"), apiKey: "test-key", runBudgetCents: 200, fetchFn }),
    /unknown job/,
  );
});

// Attacker 3b: a model reply holding an unknown job is refused too.
test("model reply holding an unknown job is refused", async () => {
  const jobs = seedJobs("freelancer@example.com");
  const fetchFn = (async () => {
    return mockResponse(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              proposals: [
                { jobId: "demo-waiting-1", recipient: "freelancer@example.com", amountCents: 100, reason: "Due first." },
                { jobId: "demo-waiting-2", recipient: "freelancer@example.com", amountCents: 100, reason: "Due second." },
              ],
              held: [{ jobId: "job-that-does-not-exist", reason: "Invented." }],
            }),
          },
        },
      ],
    });
  }) as unknown as typeof fetch;
  await assert.rejects(
    groqPropose({ jobs: jobs.filter((j) => j.status === "waiting"), apiKey: "test-key", runBudgetCents: 200, fetchFn }),
    /unknown job/,
  );
});

// Attacker 3c: a model reply that leaves a candidate in neither list, or
// names the same job twice, is refused.
test("model reply must cover every candidate exactly once, no gaps and no duplicates", async () => {
  const jobs = seedJobs("freelancer@example.com").filter((j) => j.status === "waiting");
  const replyFor = (content: string) =>
    (async () => mockResponse(200, { choices: [{ message: { content } }] })) as unknown as typeof fetch;
  await assert.rejects(
    groqPropose({
      jobs,
      apiKey: "test-key",
      runBudgetCents: 200,
      fetchFn: replyFor(
        JSON.stringify({
          proposals: [{ jobId: "demo-waiting-1", recipient: "freelancer@example.com", amountCents: 100, reason: "Due first." }],
          held: [],
        }),
      ),
    }),
    /not listed|every job/i,
  );
  await assert.rejects(
    groqPropose({
      jobs,
      apiKey: "test-key",
      runBudgetCents: 200,
      fetchFn: replyFor(
        JSON.stringify({
          proposals: [
            { jobId: "demo-waiting-1", recipient: "freelancer@example.com", amountCents: 100, reason: "Due first." },
            { jobId: "demo-waiting-1", recipient: "freelancer@example.com", amountCents: 100, reason: "Twice." },
          ],
          held: [{ jobId: "demo-waiting-2", reason: "Waits." }],
        }),
      ),
    }),
    /twice|duplicate/i,
  );
});

// Attacker 3d: a wrong amount or a wrong recipient in a proposal is
// refused by the loop, never paid.
test("loop refuses a proposal with a wrong amount or a wrong recipient, never pays it", async () => {
  const jobs = [makeJob({ job_id: "job-1" }), makeJob({ job_id: "job-2" })];
  const audit = createAuditLog();
  const { payFn, calls } = makeStubPay();
  const result = await runAgentLoop({
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com"]),
    audit,
    proposer: () => [
      { jobId: "job-1", recipient: "freelancer@example.com", amountCents: 150, source: "model", reason: "Wrong amount." },
      { jobId: "job-2", recipient: "someone-else@example.com", amountCents: 100, source: "model", reason: "Wrong person." },
    ],
    payFn,
  });
  assert.deepEqual(result.accepted, []);
  assert.equal(result.rejected.length, 2);
  // Wrong amount: the proposal does not match the approved job record.
  assert.equal(result.rejected.find((r) => r.proposalJobId === "job-1")?.label, "Mismatch");
  // Wrong recipient: the recipient is not the allowlisted payee on the record.
  assert.equal(result.rejected.find((r) => r.proposalJobId === "job-2")?.label, "RecipientNotAllowed");
  assert.equal(calls.length, 0);
});

// Attacker 4: no Groq key, the Pay click pays nothing and returns the
// candidates for the owner to pick.
test("no Groq key: Pay pays nothing and returns the candidates for the owner", async () => {
  const mock = makeMock();
  const { app, port } = await startServer(mock, { clientEmail: "client@example.com" });
  try {
    const held = await postPay(port, {});
    assert.equal(held.status, 200);
    assert.deepEqual(held.data.accepted, []);
    assert.equal(held.data.payout_batch_id, null);
    assert.equal(held.data.proposer, "manual-hold");
    assert.match(held.data.hold_reason ?? "", /no Groq key|pick/i);
    assert.deepEqual(held.data.held_for_selection, ["demo-waiting-1", "demo-waiting-2"]);
    assert.equal(mock.payoutCalls().length, 0);
    assert.equal(held.data.invoice_status, "SKIPPED");
    assert.match(held.data.invoice_error ?? "", /no jobs were paid/);

    // The hold is on the audit trail, with the reason.
    const auditRes = await fetch(`http://127.0.0.1:${port}/api/audit`);
    const audit = (await auditRes.json()) as { rows: Array<{ action: string; job_id: string; reason: string }> };
    const heldRows = audit.rows.filter((row) => row.action === "held");
    assert.deepEqual(
      heldRows.map((row) => row.job_id).sort(),
      ["demo-waiting-1", "demo-waiting-2"],
    );
    assert.ok(heldRows.every((row) => row.reason.length > 0));
  } finally {
    await app.close();
  }
});

// Attacker 5: the owner picks one job, only that job is paid.
test("owner-picked Pay Selected pays only the picked jobs", async () => {
  const mock = makeMock();
  const { app, port } = await startServer(mock, { clientEmail: "client@example.com" });
  try {
    const paid = await postPay(port, { selectedJobIds: ["demo-waiting-1"] });
    assert.equal(paid.status, 200);
    assert.deepEqual(paid.data.accepted, ["demo-waiting-1"]);
    assert.equal(paid.data.proposer, "owner");
    assert.equal(paid.data.batch_status, "SUCCESS");
    assert.equal(paid.data.invoice_total_cents, 100);
    assert.equal(mock.payoutCalls().length, 2);

    // The job the owner did not pick is still waiting, unpaid.
    const gridRes = await fetch(`http://127.0.0.1:${port}/api/grid`);
    const grid = (await gridRes.json()) as { rows: Array<{ job_id: string; status: string }> };
    const byId = new Map(grid.rows.map((row) => [row.job_id, row.status]));
    assert.equal(byId.get("demo-waiting-2"), "waiting");

    // Ticking nothing pays nothing.
    const none = await postPay(port, { selectedJobIds: [] });
    assert.equal(none.status, 200);
    assert.deepEqual(none.data.accepted, []);
    assert.deepEqual(none.data.held_for_selection, ["demo-waiting-2"]);
  } finally {
    await app.close();
  }
});

// Attacker 6: a second Pay click pays and bills nothing new.
test("second Pay click pays and bills nothing new", async () => {
  const mock = makeMock({ groqHandler: greedyByDue() });
  const { app, port } = await startServer(mock, { groqApiKey: "test-key", clientEmail: "client@example.com" });
  try {
    const first = await postPay(port, { runBudgetCents: 200 });
    assert.equal(first.status, 200);
    assert.deepEqual(first.data.accepted, ["demo-waiting-1", "demo-waiting-2"]);
    const payoutsAfterFirst = mock.payoutCalls().length;
    const invoicingAfterFirst = mock.invoicingCalls().length;
    assert.ok(payoutsAfterFirst > 0, "first click made no payout call");
    assert.ok(invoicingAfterFirst > 0, "first click made no invoicing call");

    const second = await postPay(port, { runBudgetCents: 200 });
    assert.equal(second.status, 200);
    assert.deepEqual(second.data.accepted, []);
    assert.equal(second.data.invoice_id, null);
    assert.equal(second.data.invoice_status, "SKIPPED");
    assert.equal(mock.payoutCalls().length, payoutsAfterFirst);
    assert.equal(mock.invoicingCalls().length, invoicingAfterFirst);
  } finally {
    await app.close();
  }
});

// Attacker 7a: the model never receives the over-cap job as a candidate.
test("model never receives the over-cap job as a candidate", async () => {
  const mock = makeMock({ groqHandler: greedyByDue() });
  const { app, port } = await startServer(mock, { groqApiKey: "test-key" });
  try {
    const paid = await postPay(port, { runBudgetCents: 200 });
    assert.equal(paid.status, 200);
    assert.equal(mock.groqBodies.length, 1);
    const messages = mock.groqBodies[0].messages as Array<{ role: string; content: string }>;
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    assert.doesNotMatch(user, /demo-over-cap/);
    // The jobs sent carry due and priority, and the run budget.
    assert.match(user, /Run budget for this run: 200 cents/);
    assert.match(user, /"due": "2026-11-12"/);
    assert.match(user, /"priority": "high"/);
  } finally {
    await app.close();
  }
});

// Attacker 7b: the owner picks the over-cap job by hand, the loop still
// refuses it under the per-payment cap, and the valid job is still paid.
// (The model can never name it: it is never a candidate, so a model
// reply naming it is refused as an unknown job.)
test("owner picking the over-cap job is refused under the per-payment cap, never paid", async () => {
  const mock = makeMock();
  const { app, port } = await startServer(mock, { clientEmail: "client@example.com" });
  try {
    const paid = await postPay(port, { selectedJobIds: ["demo-over-cap", "demo-waiting-1"] });
    assert.equal(paid.status, 200);
    assert.deepEqual(paid.data.accepted, ["demo-waiting-1"]);
    assert.equal(paid.data.proposer, "owner");
    const refused = paid.data.rejected.find((r) => r.job_id === "demo-over-cap");
    assert.ok(refused, "over-cap job was not refused");
    assert.equal(refused.label, "PerRequestCapExceeded");
    assert.equal(mock.payoutCalls().length, 2);
  } finally {
    await app.close();
  }
});

// Attacker 8: a run budget above the weekly cap is rejected server-side.
test("run budget above the weekly cap is rejected, nothing is paid", async () => {
  const mock = makeMock({ groqHandler: greedyByDue() });
  const { app, port } = await startServer(mock, { groqApiKey: "test-key", clientEmail: "client@example.com" });
  try {
    for (const bad of [150001, 0, -100, 150000.5]) {
      const res = await postPay(port, { runBudgetCents: bad });
      assert.equal(res.status, 400, `budget ${bad} was not rejected`);
      assert.match(res.data.error ?? "", /run budget/i, `budget ${bad} has no clear error`);
    }
    assert.equal(mock.payoutCalls().length, 0);
    assert.equal(mock.groqBodies.length, 0);

    // The weekly cap itself is a valid budget.
    const ok = await postPay(port, { runBudgetCents: 150000 });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.accepted, ["demo-waiting-1", "demo-waiting-2"]);
  } finally {
    await app.close();
  }
});

// The model's chosen jobs reach the audit trail with the model's reasons.
test("allocation audit rows name the chosen and held jobs with reasons", async () => {
  const mock = makeMock({ groqHandler: greedyByDue() });
  const { app, port } = await startServer(mock, { groqApiKey: "test-key" });
  try {
    await approve(port, "demo-approve-1");
    const paid = await postPay(port, { runBudgetCents: 200 });
    assert.equal(paid.status, 200);
    const auditRes = await fetch(`http://127.0.0.1:${port}/api/audit`);
    const audit = (await auditRes.json()) as { rows: Array<{ action: string; job_id: string; reason: string }> };
    const heldRow = audit.rows.find((row) => row.action === "held" && row.job_id === "demo-waiting-2");
    assert.ok(heldRow, "no held audit row for demo-waiting-2");
    assert.match(heldRow.reason, /run budget/i);
    const acceptedRow = audit.rows.find((row) => row.action === "accepted" && row.job_id === "demo-waiting-1");
    assert.ok(acceptedRow, "no accepted audit row for demo-waiting-1");
    assert.match(acceptedRow.reason, /Due soonest|highest priority/i);
  } finally {
    await app.close();
  }
});
