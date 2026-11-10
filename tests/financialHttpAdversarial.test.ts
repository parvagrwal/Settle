import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettleServer } from "../src/server/routes.ts";
import { seedJobs } from "../src/server/seed.ts";
import { FinancialStore } from "../src/server/financialStore.ts";
import { AllocationStore } from "../src/server/allocationStore.ts";
import { generateAllocationScenarios, type AllocationContext } from "../src/server/allocation.ts";

process.env.SETTLE_OWNER_TOKEN = "adversarial-owner-token";
const OWNER = { "x-settle-owner-token": "adversarial-owner-token", "Content-Type": "application/json" };

function jsonResponse(status: number, body: Record<string, unknown>) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: { get: () => null },
  };
}

function createStatefulPayPalMock(opts: {
  delayMs?: number;
  failPostAfterAccept?: boolean;
  itemStatus?: string;
  orphanItems?: Array<{ batchId: string; senderBatchId: string; item: Record<string, unknown> }>;
} = {}) {
  const batches = new Map<string, { senderBatchId: string; item: Record<string, unknown> }>();
  const itemStatus = opts.itemStatus ?? "SUCCESS";
  const postBodies: Array<Record<string, unknown>> = [];
  let invoiceCount = 0;
  let invoiceSent = false;
  let batchSeq = 0;

  const fetchFn = (async (url: string, init: Record<string, unknown> = {}) => {
    const method = (init.method as string) ?? "GET";
    if (opts.delayMs && opts.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
    }
    if (url.includes("/v1/payments/payouts")) {
      if (method === "POST") {
        const parsed = JSON.parse(String(init.body)) as {
          sender_batch_header: { sender_batch_id: string };
          items: Array<{ sender_item_id: string; receiver: string; amount: { value: string; currency: string } }>;
        };
        postBodies.push(parsed as unknown as Record<string, unknown>);
        const existingBatch = [...batches.entries()].find(([, entry]) => entry.senderBatchId === parsed.sender_batch_header.sender_batch_id);
        if (existingBatch) {
          return jsonResponse(400, {
            name: "DUPLICATE_REQUEST_ID",
            message: "Duplicate sender batch id",
            links: [{ href: `https://api-m.sandbox.paypal.com/v1/payments/payouts/${existingBatch[0]}`, rel: "self", method: "GET" }],
          });
        }
        const src = parsed.items[0];
        const batchId = `BATCH-ADV-${++batchSeq}`;
        batches.set(batchId, {
          senderBatchId: parsed.sender_batch_header.sender_batch_id,
          item: {
            payout_item_id: `ITEM-${batchSeq}`,
            transaction_id: `TX-${batchSeq}`,
            activity_id: `ACT-${batchSeq}`,
            payout_item_fee: { value: "0.02", currency: "USD" },
            payout_batch_id: batchId,
            transaction_status: itemStatus,
            payout_item: {
              sender_item_id: src.sender_item_id,
              receiver: src.receiver,
              amount: src.amount,
            },
            time_processed: new Date().toISOString(),
          },
        });
        if (opts.failPostAfterAccept) {
          throw new Error("simulated socket hang up after provider accepted batch");
        }
        return jsonResponse(201, { batch_header: { payout_batch_id: batchId, batch_status: "PENDING" } });
      }
      if (url.includes("?")) {
        throw new Error(`undocumented list endpoint must not be called: ${url}`);
      }
      const batchId = url.split("/").pop()!;
      const stored = batches.get(batchId);
      if (stored) {
        return jsonResponse(200, {
          batch_header: { payout_batch_id: batchId, sender_batch_header: { sender_batch_id: stored.senderBatchId }, batch_status: "SUCCESS" },
          items: [stored.item],
        });
      }
      const orphan = (opts.orphanItems ?? []).find((o) => o.batchId === batchId);
      if (orphan) {
        return jsonResponse(200, {
          batch_header: { payout_batch_id: orphan.batchId, sender_batch_header: { sender_batch_id: orphan.senderBatchId }, batch_status: "SUCCESS" },
          items: [orphan.item],
        });
      }
      return jsonResponse(404, { name: "RESOURCE_NOT_FOUND", message: "Batch not found" });
    }
    if (url.includes("/v2/invoicing/invoices")) {
      if (method === "POST" && url.endsWith("/send")) {
        invoiceSent = true;
        return jsonResponse(200, { id: `INV2-ADV-${invoiceCount}`, status: "SENT" });
      }
      if (method === "POST") {
        invoiceCount++;
        invoiceSent = false;
        return jsonResponse(201, { id: `INV2-ADV-${invoiceCount}`, status: "DRAFT" });
      }
      return jsonResponse(200, {
        id: `INV2-ADV-${invoiceCount}`,
        status: invoiceSent ? "SENT" : "DRAFT",
        detail: { invoice_number: `NUM-${invoiceCount}` },
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as unknown as typeof fetch;

  return {
    fetchFn,
    postCount: () => postBodies.length,
    batchCount: () => batches.size,
    invoiceCount: () => invoiceCount,
    setFailPostAfterAccept: (value: boolean) => { opts.failPostAfterAccept = value; },
  };
}

test("owner authorization boundary protects policy, discrepancies, reconcile, approve, pay and plan execute", async () => {
  const app = createSettleServer({
    jobs: seedJobs("freelancer@example.com"),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    allocationStore: new AllocationStore(":memory:"),
  });
  const port = await app.listen(0);
  try {
    const base = `http://127.0.0.1:${port}`;
    const badHeaders = { "x-settle-owner-token": "wrong-token", "Content-Type": "application/json" };

    const r1 = await fetch(`${base}/api/financial/policy`, { method: "PUT", headers: badHeaders, body: JSON.stringify({ capCents: 100, perPaymentCapCents: 100, freshnessSeconds: 60 }) });
    assert.equal(r1.status, 401);

    const r2 = await fetch(`${base}/api/financial/discrepancies`, { headers: badHeaders });
    assert.equal(r2.status, 401);

    const r3 = await fetch(`${base}/api/financial/reconcile`, { method: "POST", headers: badHeaders });
    assert.equal(r3.status, 401);

    const r4 = await fetch(`${base}/api/approve`, { method: "POST", headers: badHeaders, body: JSON.stringify({ job_id: "demo-approve-1" }) });
    assert.equal(r4.status, 401);

    const r5 = await fetch(`${base}/api/pay`, { method: "POST", headers: badHeaders, body: JSON.stringify({}) });
    assert.equal(r5.status, 401);

    const r6 = await fetch(`${base}/api/allocation/plans/nonexistent/execute`, { method: "POST", headers: badHeaders });
    assert.equal(r6.status, 401);

    // Float or non-integer policy values are rejected with 400 even for the owner.
    const badPolicy = await fetch(`${base}/api/financial/policy`, {
      method: "PUT",
      headers: OWNER,
      body: JSON.stringify({ capCents: 100.5, perPaymentCapCents: 100, freshnessSeconds: 60 }),
    });
    assert.equal(badPolicy.status, 400);
    // Domain bounds are rejected as 400, and no invalid policy version is created.
    const invalidPolicies = [
      { capCents: 100, perPaymentCapCents: 0, freshnessSeconds: 60 },
      { capCents: 100, perPaymentCapCents: 101, freshnessSeconds: 60 },
      { capCents: 100, perPaymentCapCents: 100, freshnessSeconds: 0 },
    ];
    for (const input of invalidPolicies) {
      const invalid = await fetch(`${base}/api/financial/policy`, { method: "PUT", headers: OWNER, body: JSON.stringify(input) });
      assert.equal(invalid.status, 400);
    }
    const caps = (await (await fetch(`${base}/api/caps`)).json()) as { policy_version: number; freshness_seconds: number };
    assert.equal(caps.policy_version, 1);
    assert.equal(caps.freshness_seconds, 300);
  } finally {
    await app.close();
  }
});

test("durable policy, approvals, payouts, rolling cap and invoice deduplication survive full server restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-http-restart-"));
  const dbPath = join(dir, "settle.db");
  const mock = createStatefulPayPalMock();

  // First server lifetime
  const store1 = new FinancialStore(dbPath);
  const app1 = createSettleServer({
    jobs: seedJobs("freelancer@example.com"),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    clientEmail: "client@example.com",
    fetchFn: mock.fetchFn,
    financialStore: store1,
  });
  const port1 = await app1.listen(0);
  try {
    const base1 = `http://127.0.0.1:${port1}`;
    const polRes = await fetch(`${base1}/api/financial/policy`, {
      method: "PUT",
      headers: OWNER,
      body: JSON.stringify({ capCents: 350, perPaymentCapCents: 200, freshnessSeconds: 300 }),
    });
    assert.equal(polRes.status, 200);

    const appRes = await fetch(`${base1}/api/approve`, {
      method: "POST",
      headers: OWNER,
      body: JSON.stringify({ job_id: "demo-approve-1" }),
    });
    assert.equal(appRes.status, 200);

    const payRes = await fetch(`${base1}/api/pay`, {
      method: "POST",
      headers: OWNER,
      body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }),
    });
    assert.equal(payRes.status, 200);
    const paidBody = (await payRes.json()) as { accepted: string[]; invoice_status: string };
    assert.deepEqual(paidBody.accepted, ["demo-waiting-1"]);
    assert.equal(paidBody.invoice_status, "SENT");
    assert.equal(mock.postCount(), 1);
    assert.equal(mock.invoiceCount(), 1);
  } finally {
    await app1.close();
    store1.close();
  }

  // Second server lifetime over fresh seedJobs + reopened SQLite file
  const store2 = new FinancialStore(dbPath);
  const app2 = createSettleServer({
    jobs: seedJobs("freelancer@example.com"),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    clientEmail: "client@example.com",
    fetchFn: mock.fetchFn,
    financialStore: store2,
  });
  const port2 = await app2.listen(0);
  try {
    const base2 = `http://127.0.0.1:${port2}`;
    const caps = (await (await fetch(`${base2}/api/caps`)).json()) as {
      rolling_cap_cents: number;
      policy_version: number;
      eligibleSpendCents: number;
      remainingCents: number;
    };
    assert.equal(caps.rolling_cap_cents, 350);
    assert.equal(caps.policy_version, 2);
    assert.equal(caps.eligibleSpendCents, 100);
    assert.equal(caps.remainingCents, 250);

    const grid = (await (await fetch(`${base2}/api/grid`)).json()) as {
      rows: Array<{ job_id: string; status: string }>;
    };
    const byId = new Map(grid.rows.map((r) => [r.job_id, r.status]));
    assert.equal(byId.get("demo-waiting-1"), "paid");
    assert.equal(byId.get("demo-approve-1"), "waiting");

    // Re-selecting demo-waiting-1 after restart neither re-pays nor re-bills.
    const replay = await fetch(`${base2}/api/pay`, {
      method: "POST",
      headers: OWNER,
      body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }),
    });
    assert.equal(replay.status, 200);
    const replayBody = (await replay.json()) as { accepted: string[]; rejected: Array<{ label: string }> };
    assert.deepEqual(replayBody.accepted, []);
    assert.equal(replayBody.rejected[0]?.label, "DuplicatePayout");
    assert.equal(mock.postCount(), 1);
    assert.equal(mock.invoiceCount(), 1);
  } finally {
    await app2.close();
    store2.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provider item FAILED is not marked paid and projects a durable failed status across restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-http-failed-"));
  const dbPath = join(dir, "settle.db");
  const mock = createStatefulPayPalMock({ itemStatus: "FAILED" });

  const store1 = new FinancialStore(dbPath);
  const app1 = createSettleServer({
    jobs: seedJobs("freelancer@example.com"),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    clientEmail: "client@example.com",
    fetchFn: mock.fetchFn,
    financialStore: store1,
  });
  const port1 = await app1.listen(0);
  try {
    const base1 = `http://127.0.0.1:${port1}`;
    const payRes = await fetch(`${base1}/api/pay`, {
      method: "POST",
      headers: OWNER,
      body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }),
    });
    assert.equal(payRes.status, 200);
    const payBody = (await payRes.json()) as { accepted: string[]; batch_status: string; invoice_status: string };
    assert.deepEqual(payBody.accepted, []);
    assert.equal(payBody.batch_status, "FAILED");
    assert.equal(payBody.invoice_status, "SKIPPED");
    assert.equal(mock.postCount(), 1);
    assert.equal(mock.invoiceCount(), 0);
  } finally {
    await app1.close();
    store1.close();
  }

  const store2 = new FinancialStore(dbPath);
  const app2 = createSettleServer({
    jobs: seedJobs("freelancer@example.com"),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
    financialStore: store2,
  });
  const port2 = await app2.listen(0);
  try {
    const base2 = `http://127.0.0.1:${port2}`;
    const grid = (await (await fetch(`${base2}/api/grid`)).json()) as {
      rows: Array<{ job_id: string; status: string }>;
    };
    const statusById = new Map(grid.rows.map((r) => [r.job_id, r.status]));
    assert.equal(statusById.get("demo-waiting-1"), "failed");
    const caps = (await (await fetch(`${base2}/api/caps`)).json()) as {
      eligibleSpendCents: number;
      activeReservationsCents: number;
    };
    assert.equal(caps.eligibleSpendCents, 0);
    assert.equal(caps.activeReservationsCents, 0);
  } finally {
    await app2.close();
    store2.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent /api/pay requests cannot double-submit the same job or breach the rolling cap", async () => {
  const mock = createStatefulPayPalMock({ delayMs: 50 });
  const app = createSettleServer({
    jobs: seedJobs("freelancer@example.com"),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
  });
  const port = await app.listen(0);
  try {
    const base = `http://127.0.0.1:${port}`;
    // Cap is $2.00 total: race 1 tests same-job concurrency ($1.00), race 2 tests cross-job cap concurrency ($1.00 left vs two $1.00 jobs).
    await fetch(`${base}/api/financial/policy`, {
      method: "PUT",
      headers: OWNER,
      body: JSON.stringify({ capCents: 200, perPaymentCapCents: 200, freshnessSeconds: 300 }),
    });
    await fetch(`${base}/api/approve`, {
      method: "POST",
      headers: OWNER,
      body: JSON.stringify({ job_id: "demo-approve-1" }),
    });

    // Race 1: two simultaneous requests for the exact same job demo-waiting-1
    const [sameA, sameB] = await Promise.all([
      fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }) }),
      fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }) }),
    ]);
    const sameStatuses = [sameA.status, sameB.status].sort();
    assert.deepEqual(sameStatuses, [200, 409]);
    assert.equal(mock.postCount(), 1);

    // Race 2: $1.00 of $2.00 cap remains; two simultaneous requests try to pay demo-waiting-2 ($1.00) and demo-approve-1 ($1.00)
    const [capA, capB] = await Promise.all([
      fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-2"] }) }),
      fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-approve-1"] }) }),
    ]);
    const capStatuses = [capA.status, capB.status].sort();
    assert.deepEqual(capStatuses, [200, 409]);
    assert.equal(mock.postCount(), 2);

    const caps = (await (await fetch(`${base}/api/caps`)).json()) as {
      eligibleSpendCents: number;
      activeReservationsCents: number;
      remainingCents: number;
    };
    assert.equal(caps.eligibleSpendCents, 200);
    assert.equal(caps.activeReservationsCents, 0);
    assert.equal(caps.remainingCents, 0);
  } finally {
    await app.close();
  }
});

test("ambiguous /api/pay returns 202 OUTCOME_UNKNOWN, holds active cap reservation, refuses blind retry, and recovers via /api/financial/reconcile", async () => {
  const mock = createStatefulPayPalMock({ failPostAfterAccept: true });
  const app = createSettleServer({
    jobs: seedJobs("freelancer@example.com"),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    clientEmail: "client@example.com",
    fetchFn: mock.fetchFn,
  });
  const port = await app.listen(0);
  try {
    const base = `http://127.0.0.1:${port}`;
    const res = await fetch(`${base}/api/pay`, {
      method: "POST",
      headers: OWNER,
      body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }),
    });
    assert.equal(res.status, 202);
    const body = (await res.json()) as { batch_status: string; accepted: string[]; invoice_status: string };
    assert.equal(body.batch_status, "OUTCOME_UNKNOWN");
    assert.deepEqual(body.accepted, []);
    assert.equal(body.invoice_status, "SKIPPED");
    assert.equal(mock.postCount(), 1);
    assert.equal(mock.invoiceCount(), 0);

    // Reservation stays active so rolling exposure is protected while outcome is unknown.
    const capsDuring = (await (await fetch(`${base}/api/caps`)).json()) as {
      eligibleSpendCents: number;
      activeReservationsCents: number;
    };
    assert.equal(capsDuring.eligibleSpendCents, 0);
    assert.equal(capsDuring.activeReservationsCents, 100);

    // A blind retry before reconciliation is refused without sending a second payout POST.
    mock.setFailPostAfterAccept(false);
    const retry = await fetch(`${base}/api/pay`, {
      method: "POST",
      headers: OWNER,
      body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }),
    });
    assert.equal(retry.status, 202);
    const retryBody = (await retry.json()) as { batch_status: string; accepted: string[] };
    assert.equal(retryBody.batch_status, "OUTCOME_UNKNOWN");
    assert.deepEqual(retryBody.accepted, []);
    assert.equal(mock.postCount(), 1);

    // Owner triggers durable provider reconciliation: recovers item by sender_batch_id duplicate link without creating a second batch, clears reservation, marks job paid.
    const recRes = await fetch(`${base}/api/financial/reconcile`, { method: "POST", headers: OWNER });
    assert.equal(recRes.status, 200);
    const recBody = (await recRes.json()) as { itemsRecorded: number; cap: { eligibleSpendCents: number; activeReservationsCents: number } };
    assert.equal(recBody.itemsRecorded, 1);
    assert.equal(recBody.cap.eligibleSpendCents, 100);
    assert.equal(recBody.cap.activeReservationsCents, 0);
    assert.equal(mock.batchCount(), 1);

    const grid = (await (await fetch(`${base}/api/grid`)).json()) as { rows: Array<{ job_id: string; status: string }> };
    const statusById = new Map(grid.rows.map((r) => [r.job_id, r.status]));
    assert.equal(statusById.get("demo-waiting-1"), "paid");
  } finally {
    await app.close();
  }
});

test("approved plan HTTP execute returns 202 on ambiguous provider drop and refuses duplicate execution", async () => {
  const allocationStore = new AllocationStore(":memory:");
  const financialStore = new FinancialStore(":memory:");
  const now = new Date();
  const validUntil = new Date(now.getTime() + 3600_000).toISOString();
  const context: AllocationContext = {
    contextId: "http-plan-ctx",
    capturedAt: now.toISOString(),
    validUntil,
    clearedFundsCents: 5000,
    reserveCents: 0,
    perPaymentCapCents: 20000,
    totalCapCents: 5000,
    committedCents: 0,
    obligations: [
      {
        obligationId: "plan-job-1",
        recipient: "freelancer@example.com",
        currency: "USD",
        owedCents: 5000,
        settledCents: 0,
        dueAt: validUntil,
        mandatory: true,
        partialAllowed: false,
        priority: "urgent",
        note: "Urgent payout",
      },
    ],
  };
  const plan = generateAllocationScenarios(context)[0];
  allocationStore.recordRecommendation(plan, { reason: "Fits cleared funds", uncertainties: [], changeTriggers: [] }, context);
  allocationStore.approvePlan(plan.planId, { actorId: "owner", role: "owner" }, now.toISOString());

  const mock = createStatefulPayPalMock({ failPostAfterAccept: true });
  const app = createSettleServer({
    jobs: [],
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
    allocationStore,
    financialStore,
  });
  const port = await app.listen(0);
  try {
    const base = `http://127.0.0.1:${port}`;
    const exec1 = await fetch(`${base}/api/allocation/plans/${plan.planId}/execute`, { method: "POST", headers: OWNER });
    assert.equal(exec1.status, 202);
    const body1 = (await exec1.json()) as { status: string };
    assert.equal(body1.status, "outcome_unknown");

    const storedPlan = (await (await fetch(`${base}/api/allocation/plans/${plan.planId}`)).json()) as { status: string };
    assert.equal(storedPlan.status, "outcome_unknown");

    // Re-executing an outcome_unknown plan is denied with 409 before touching PayPal again.
    const exec2 = await fetch(`${base}/api/allocation/plans/${plan.planId}/execute`, { method: "POST", headers: OWNER });
    assert.equal(exec2.status, 409);
    assert.equal(mock.postCount(), 1);
  } finally {
    await app.close();
  }
});

test("provider orphan payout items surface in GET /api/financial/discrepancies without corrupting eligible spend", async () => {
  const mock = createStatefulPayPalMock({
    orphanItems: [
      {
        batchId: "BATCH-ORPHAN-1",
        senderBatchId: "external-sender-batch",
        item: {
          payout_item_id: "ITEM-ORPHAN-1",
          transaction_id: "TX-ORPHAN-1",
          transaction_status: "SUCCESS",
          payout_item: {
            sender_item_id: "unknown-external-item",
            receiver: "stranger@example.com",
            amount: { value: "99.00", currency: "USD" },
          },
          time_processed: new Date().toISOString(),
        },
      },
    ],
  });
  const app = createSettleServer({
    jobs: seedJobs("freelancer@example.com"),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
  });
  const port = await app.listen(0);
  try {
    const base = `http://127.0.0.1:${port}`;
    const rec = await fetch(`${base}/api/financial/reconcile`, {
      method: "POST",
      headers: OWNER,
      body: JSON.stringify({ batchIds: ["BATCH-ORPHAN-1"] }),
    });
    assert.equal(rec.status, 200);
    // Repeating a read-only provider reconciliation must not duplicate an
    // unresolved discrepancy or invent eligible spend.
    const recAgain = await fetch(`${base}/api/financial/reconcile`, {
      method: "POST",
      headers: OWNER,
      body: JSON.stringify({ batchIds: ["BATCH-ORPHAN-1"] }),
    });
    assert.equal(recAgain.status, 200);

    const discRes = await fetch(`${base}/api/financial/discrepancies`, { headers: OWNER });
    assert.equal(discRes.status, 200);
    const { discrepancies } = (await discRes.json()) as { discrepancies: Array<{ type: string }> };
    assert.equal(discrepancies.length, 1);
    assert.equal(discrepancies[0].type, "PROVIDER_ORPHAN");

    const caps = (await (await fetch(`${base}/api/caps`)).json()) as { eligibleSpendCents: number };
    assert.equal(caps.eligibleSpendCents, 0);
  } finally {
    await app.close();
  }
});
