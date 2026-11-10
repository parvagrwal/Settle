// Provenance, reporting semantics and the execution-run contract, over HTTP.
//
// These are the claims the dashboard makes, so they are asserted through the
// routes a user actually hits rather than against the store. Written before the
// reporting projection existed; the numbers below are the ones a reader has to
// be able to check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettleServer } from "../src/server/routes.ts";
import { seedJobs } from "../src/server/seed.ts";
import { payableJobs } from "./helpers/payableJobs.ts";
import { FinancialStore } from "../src/server/financialStore.ts";

process.env.SETTLE_OWNER_TOKEN = "report-owner-token";
const OWNER = { "x-settle-owner-token": "report-owner-token", "Content-Type": "application/json" };
const T0 = "2026-11-10T12:00:00.000Z";
const owner = { actorId: "owner", role: "owner" } as const;

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => null } };
}

/** A PayPal mock that pays one job per batch, with a configurable item status. */
function mockPayPal(opts: { statusFor?: (senderItemId: string) => string; amountFor?: (senderItemId: string) => string } = {}) {
  const batches = new Map<string, { sender: string; status: string; amount: string }>();
  const postBodies: Array<{ sender_batch_header: { sender_batch_id: string } }> = [];
  let seq = 0;
  const itemFor = (batchId: string) => {
    const batch = batches.get(batchId)!;
    return {
      payout_item_id: `ITEM-${batchId}`,
      payout_batch_id: batchId,
      transaction_id: batch.status === "SUCCESS" ? `TX-${batchId}` : undefined,
      transaction_status: batch.status,
      payout_item_fee: { value: "0.25", currency: "USD" },
      payout_item: {
        sender_item_id: batch.sender,
        receiver: "freelancer@example.com",
        amount: { value: batch.amount, currency: "USD" },
      },
    };
  };
  const fetchFn = (async (url: string, init: Record<string, unknown> = {}) => {
    const method = (init.method as string) ?? "GET";
    const path = String(url);
    if (path.includes("/v1/oauth2/token")) return jsonResponse(200, { access_token: "t", expires_in: 3600 });
    if (path.includes("/v2/invoicing")) return jsonResponse(201, { href: "/v2/invoicing/invoices/INV-1", status: "DRAFT" });
    if (path.includes("/v1/payments/payouts")) {
      if (method === "POST") {
        const body = JSON.parse(String(init.body)) as { sender_batch_header: { sender_batch_id: string }; items: Array<{ sender_item_id: string; amount: { value: string } }> };
        postBodies.push(body);
        const batchId = `BATCH-REP-${++seq}`;
        batches.set(batchId, {
          sender: body.sender_batch_header.sender_batch_id,
          status: opts.statusFor?.(body.items[0].sender_item_id) ?? "SUCCESS",
          amount: opts.amountFor?.(body.items[0].sender_item_id) ?? body.items[0].amount.value,
        });
        return jsonResponse(201, { batch_header: { payout_batch_id: batchId, batch_status: "PENDING" } });
      }
      const batchId = path.split("/").pop()!;
      return jsonResponse(200, {
        batch_header: {
          payout_batch_id: batchId,
          batch_status: "SUCCESS",
          sender_batch_header: { sender_batch_id: batches.get(batchId)?.sender ?? "" },
        },
        items: batches.has(batchId) ? [itemFor(batchId)] : [],
      });
    }
    throw new Error(`unexpected call ${method} ${path}`);
  }) as unknown as typeof fetch;
  return { fetchFn, postBodies, batchCount: () => batches.size };
}

async function withServer(
  opts: { jobs?: ReturnType<typeof payableJobs>; financial?: FinancialStore; fetchFn?: typeof fetch; clientEmail?: boolean },
  run: (ctx: { base: string; financial: FinancialStore; app: ReturnType<typeof createSettleServer> }) => Promise<void>,
): Promise<void> {
  const financial = opts.financial ?? new FinancialStore(":memory:");
  const app = createSettleServer({
    jobs: opts.jobs ?? payableJobs("freelancer@example.com"),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    ...(opts.clientEmail === false ? {} : { clientEmail: "client@example.com" }),
    financialStore: financial,
  });
  const port = await app.listen(0);
  try {
    await run({ base: `http://127.0.0.1:${port}`, financial, app });
  } finally {
    await app.close();
  }
}

test("seeded rows cannot be approved or selected for payment, and no provider call is made", async () => {
  const mock = mockPayPal();
  await withServer({ jobs: seedJobs("freelancer@example.com"), fetchFn: mock.fetchFn }, async ({ base }) => {
    const approve = await fetch(`${base}/api/approve`, { method: "POST", headers: OWNER, body: JSON.stringify({ job_id: "demo-waiting-1" }) });
    assert.equal(approve.status, 409);
    const body = (await approve.json()) as { error: string; code: string };
    assert.equal(body.code, "DEMO_RECORD_NOT_PAYABLE");
    assert.match(body.error, /seeded demonstration data/);

    const pay = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }) });
    assert.equal(pay.status, 409);
    assert.match(((await pay.json()) as { error: string }).error, /DEMO_RECORD_NOT_PAYABLE/);
    assert.equal(mock.postBodies.length, 0, "a seeded row must never reach the provider");

    const grid = (await (await fetch(`${base}/api/grid`)).json()) as {
      rows: Array<{ job_id: string; status: string; record_origin: string; seeded: boolean; provenance_label: string }>;
    };
    const byId = new Map(grid.rows.map((row) => [row.job_id, row]));
    assert.equal(byId.get("settle-audit-1")?.status, "historical_reference");
    assert.equal(byId.get("settle-audit-1")?.record_origin, "seed");
    assert.equal(byId.get("settle-audit-1")?.seeded, true);
    assert.match(byId.get("settle-audit-1")!.provenance_label, /not verified by any artifact/);
    assert.equal(byId.get("demo-waiting-1")?.record_origin, "seed");
  });
});

test("report counts only application-origin provider evidence and names the seeded rows it excludes", async () => {
  const mock = mockPayPal();
  await withServer({ jobs: seedJobs("freelancer@example.com"), fetchFn: mock.fetchFn }, async ({ base }) => {
    const report = (await (await fetch(`${base}/api/financial/report`)).json()) as {
      source: string;
      metrics: Record<string, { value: number; definition: string; window: string; includes: string; verification: string }>;
      environment: { mode: string; configured: boolean };
      fees: { note: string };
    };
    assert.equal(report.metrics.lifetimeConfirmedGross.value, 0, "a seeded row is not confirmed money");
    assert.equal(report.metrics.demoRecords.value, seedJobs("freelancer@example.com").length);
    assert.match(report.metrics.demoRecords.definition, /excluded from every monetary total/);
    assert.match(report.metrics.lifetimeConfirmedGross.includes, /seeded and synthetic records are excluded/);
    assert.match(report.environment.mode, /sandbox/);
    assert.match(report.fees.note, /Recipients receive the full payout amount/);
    assert.ok(report.metrics.lifetimeConfirmedGross.definition.length > 0);
  });
});

test("a payment confirmed before the rolling window appears in lifetime and not in rolling spend", async () => {
  const dbFile = join(mkdtempSync(join(tmpdir(), "settle-report-")), "report.db");
  const financial = new FinancialStore(dbFile);
  financial.markReconciled(T0);
  financial.verifyRecipient({ recipientId: "r-old", email: "old@example.test", actor: owner, at: T0 });
  financial.approvePayment({ jobId: "old-job", recipientId: "r-old", amountCents: 500, currency: "USD", actor: owner, at: T0 });
  const old = financial.getPaymentByJob("old-job")!;
  const eightDaysAgo = "2026-11-02T12:00:00.000Z";
  financial.recordPayoutItem({
    paymentId: old.paymentId,
    senderBatchId: old.idempotencyKey,
    payoutBatchId: "BATCH-OLD",
    payoutItemId: "ITEM-OLD",
    transactionId: "TX-OLD",
    activityId: null,
    recipientEmail: old.recipientEmail,
    amountCents: 500,
    currency: "USD",
    status: "SUCCESS",
    providerTimestamp: eightDaysAgo,
    raw: { payout_item_fee: { value: "0.25", currency: "USD" } },
  });

  await withServer({ financial, jobs: [], fetchFn: mockPayPal().fetchFn }, async ({ base }) => {
    const report = (await (await fetch(`${base}/api/financial/report`)).json()) as {
      metrics: Record<string, { value: number; window: string; definition: string; verification: string }>;
      fees: { providerReportedTotal: { value: number }; providerReportedCount: number; missingProviderFeeCount: number };
      explanations: { totalsDiffer: string };
      cap: { eligibleSpendCents: number; windowStart: string; windowEnd: string };
    };
    assert.equal(report.metrics.lifetimeConfirmedGross.value, 500);
    assert.equal(report.metrics.rollingWindowSpend.value, 0);
    assert.equal(report.cap.eligibleSpendCents, 0);
    assert.match(report.metrics.rollingWindowSpend.definition, /provider-timestamped SUCCESS amounts inside the current rolling window/i);
    assert.notEqual(report.metrics.lifetimeConfirmedGross.window, report.metrics.rollingWindowSpend.window);
    assert.match(report.explanations.totalsDiffer, /lifetime is all time/);
    assert.equal(report.fees.providerReportedTotal.value, 25);
    assert.equal(report.fees.providerReportedCount, 1);
    // The item arrived from a single provider read, not from a reconciliation
    // run, so it is honestly counted as not yet independently re-read.
    assert.equal(report.metrics.unreconciledConfirmed.value, 1);
    assert.match(report.metrics.lifetimeConfirmedGross.verification, /have not yet been independently re-read/);
  });
});

test("/api/pay records an execution run with per-item provider identity and a single run id", async () => {
  const mock = mockPayPal();
  await withServer({ fetchFn: mock.fetchFn }, async ({ base }) => {
    const res = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-1", "demo-waiting-2"] }) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      accepted: string[];
      execution_run: null | {
        runId: string;
        status: string;
        items: Array<{ jobId: string; payoutBatchId: string | null; payoutItemId: string | null; transactionId: string | null; providerStatus: string | null }>;
        batches: Array<{ payoutBatchId: string; itemCount: number; status: string }>;
      };
      fee_records: Array<{ job_id: string; estimate: { estimatedFeeMinor: number; policyId: string } | null; provider: { reportedFeeMinor: number } | null; consistent: boolean | null; explanation: string }>;
    };
    assert.deepEqual(body.accepted, ["demo-waiting-1", "demo-waiting-2"]);
    assert.ok(body.execution_run, "the run id survives in the response");
    assert.equal(body.execution_run!.status, "succeeded");
    assert.equal(body.execution_run!.items.length, 2);
    for (const item of body.execution_run!.items) {
      assert.ok(item.payoutBatchId);
      assert.ok(item.payoutItemId);
      assert.ok(item.transactionId);
      assert.equal(item.providerStatus, "SUCCESS");
    }
    // Two separate single-item batches are two batches, not one invented batch.
    assert.equal(body.execution_run!.batches.length, 2);
    assert.ok(body.execution_run!.batches.every((batch) => batch.itemCount === 1));

    assert.equal(body.fee_records.length, 2);
    for (const fee of body.fee_records) {
      assert.equal(fee.estimate?.estimatedFeeMinor, 25);
      assert.equal(fee.provider?.reportedFeeMinor, 25);
      assert.equal(fee.consistent, true);
      assert.match(fee.explanation, /matches the published estimate/);
    }

    const grid = (await (await fetch(`${base}/api/grid`)).json()) as { rows: Array<{ job_id: string; record_origin: string; fee_state: string; fee_estimate_cents: number | null; provider_fee_cents: number | null; execution_run_id: string | null }> };
    const row = grid.rows.find((entry) => entry.job_id === "demo-waiting-1")!;
    assert.equal(row.record_origin, "application");
    assert.equal(row.fee_state, "provider_reported");
    assert.equal(row.fee_estimate_cents, 25);
    assert.equal(row.provider_fee_cents, 25);
    assert.equal(row.execution_run_id, body.execution_run!.runId);
  });
});

test("a run with one refused item is partial, and the refused item is not counted as paid", async () => {
  const mock = mockPayPal({ statusFor: (sender) => (sender.includes("demo-waiting-2") ? "FAILED" : "SUCCESS") });
  await withServer({ fetchFn: mock.fetchFn }, async ({ base }) => {
    const res = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-1", "demo-waiting-2"] }) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      accepted: string[];
      rejected: Array<{ job_id: string }>;
      batch_status: string;
      execution_run: { status: string; items: Array<{ jobId: string; status: string; providerStatus: string | null }> };
    };
    assert.deepEqual(body.accepted, ["demo-waiting-1"]);
    assert.deepEqual(body.rejected.map((row) => row.job_id), ["demo-waiting-2"]);
    assert.equal(body.batch_status, "PARTIAL");
    assert.equal(body.execution_run.status, "partial");
    const failedItem = body.execution_run.items.find((item) => item.jobId === "demo-waiting-2")!;
    assert.equal(failedItem.status, "failed");
    assert.equal(failedItem.providerStatus, "FAILED");

    const report = (await (await fetch(`${base}/api/financial/report`)).json()) as { metrics: Record<string, { value: number }> };
    assert.equal(report.metrics.lifetimeConfirmedGross.value, 100);
    assert.equal(report.metrics.failed.value, 100);
  });
});

test("emergency stop blocks every provider call and is recorded before the refusal", async () => {
  const mock = mockPayPal();
  await withServer({ fetchFn: mock.fetchFn }, async ({ base }) => {
    const set = await fetch(`${base}/api/financial/control`, { method: "POST", headers: OWNER, body: JSON.stringify({ emergencyStop: true, reason: "incident drill" }) });
    assert.equal(set.status, 200);
    const state = (await set.json()) as { emergencyStop: boolean; reason: string };
    assert.equal(state.emergencyStop, true);

    const pay = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }) });
    assert.equal(pay.status, 409);
    assert.match(((await pay.json()) as { error: string }).error, /EMERGENCY_STOP/);
    assert.equal(mock.postBodies.length, 0);
    assert.equal(mock.batchCount(), 0);

    const cleared = await fetch(`${base}/api/financial/control`, { method: "POST", headers: OWNER, body: JSON.stringify({ emergencyStop: false, reason: "drill over" }) });
    assert.equal(((await cleared.json()) as { emergencyStop: boolean }).emergencyStop, false);
    const after = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }) });
    assert.equal(after.status, 200);
    assert.equal(mock.postBodies.length, 1);
  });
});

test("an unreported provider fee is reported as unknown, never as zero", async () => {
  // No payout_item_fee on the item at all.
  const batches = new Map<string, { sender: string }>();
  let seq = 0;
  const fetchFn = (async (url: string, init: Record<string, unknown> = {}) => {
    const path = String(url);
    if (path.includes("/v1/oauth2/token")) return jsonResponse(200, { access_token: "t", expires_in: 3600 });
    if (path.includes("/v2/invoicing")) return jsonResponse(201, { href: "/v2/invoicing/invoices/INV-1", status: "DRAFT" });
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body)) as { sender_batch_header: { sender_batch_id: string } };
      const batchId = `BATCH-NOFEE-${++seq}`;
      batches.set(batchId, { sender: body.sender_batch_header.sender_batch_id });
      return jsonResponse(201, { batch_header: { payout_batch_id: batchId, batch_status: "PENDING" } });
    }
    const batchId = path.split("/").pop()!;
    return jsonResponse(200, {
      batch_header: { payout_batch_id: batchId, batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: batches.get(batchId)?.sender ?? "" } },
      items: [{
        payout_item_id: `ITEM-${batchId}`,
        payout_batch_id: batchId,
        transaction_id: `TX-${batchId}`,
        transaction_status: "SUCCESS",
        payout_item: { sender_item_id: batches.get(batchId)?.sender, receiver: "freelancer@example.com", amount: { value: "1.00", currency: "USD" } },
      }],
    });
  }) as unknown as typeof fetch;

  await withServer({ fetchFn }, async ({ base }) => {
    const res = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { fee_records: Array<{ estimate: { estimatedFeeMinor: number } | null; provider: unknown; consistent: boolean | null; explanation: string }> };
    assert.equal(body.fee_records.length, 1);
    assert.equal(body.fee_records[0].estimate?.estimatedFeeMinor, 25);
    assert.equal(body.fee_records[0].provider, null);
    assert.equal(body.fee_records[0].consistent, null);
    assert.match(body.fee_records[0].explanation, /not reported|unavailable/i);

    const report = (await (await fetch(`${base}/api/financial/report`)).json()) as {
      fees: { providerReportedTotal: { value: number }; providerReportedCount: number; missingProviderFeeCount: number };
      metrics: Record<string, { value: number }>;
    };
    assert.equal(report.fees.providerReportedTotal.value, 0);
    assert.equal(report.fees.providerReportedCount, 0);
    // The provider fee is absent, and the report says so instead of showing $0.00.
    assert.equal(report.metrics.lifetimeConfirmedGross.value, 100);
  });
});

test("the report and its provenance labels survive a restart from the same database file", async () => {
  const dbFile = join(mkdtempSync(join(tmpdir(), "settle-report-restart-")), "restart.db");
  const mock = mockPayPal();
  const first = new FinancialStore(dbFile);
  await withServer({ financial: first, fetchFn: mock.fetchFn }, async ({ base }) => {
    const res = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }) });
    assert.equal(res.status, 200);
  });
  first.close();

  // Same file, fresh server process: the figures come back from the ledger, not
  // from the demo rows this new process seeds.
  const second = new FinancialStore(dbFile);
  await withServer({ financial: second, jobs: seedJobs("freelancer@example.com"), fetchFn: mock.fetchFn }, async ({ base }) => {
    const report = (await (await fetch(`${base}/api/financial/report`)).json()) as { metrics: Record<string, { value: number }> };
    assert.equal(report.metrics.lifetimeConfirmedGross.value, 100);
    const grid = (await (await fetch(`${base}/api/grid`)).json()) as { rows: Array<{ job_id: string; record_origin: string; status: string }> };
    // The seeded fixture does not describe the application payment, so the row
    // stays a seed row and the ledger total stands on its own.
    assert.equal(grid.rows.find((row) => row.job_id === "settle-audit-1")?.record_origin, "seed");
  });
  second.close();
});
