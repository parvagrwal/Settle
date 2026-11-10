import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { allocationDemoContext } from "../src/server/scenarioFixtures.ts";
import { orchestrateAllocation } from "../src/server/decisionEngine.ts";
import { generateAllocationScenarios, validateAllocationPlan } from "../src/server/allocation.ts";
import { seedJobs } from "../src/server/seed.ts";
import { payableJobs } from "./helpers/payableJobs.ts";
import { ProductStore } from "../src/server/productStore.ts";
import { FinancialStore } from "../src/server/financialStore.ts";
import { TransactionStore } from "../src/server/transactionStore.ts";
import { createSettleServer } from "../src/server/routes.ts";
import { payoutItemEvent } from "./fixtures/paypalEvents.ts";

const OWNER_TOKEN = process.env.SETTLE_OWNER_TOKEN || "audit-fix-owner-secret";
process.env.SETTLE_OWNER_TOKEN = OWNER_TOKEN;
const OWNER_HEADERS = { "x-settle-owner-token": OWNER_TOKEN, "Content-Type": "application/json" };

test("December 5 2026 clock keeps allocation, seed jobs and product demo dates future-relative", async () => {
  const dec5 = new Date("2026-12-05T12:00:00Z");
  const context = allocationDemoContext(dec5);
  assert.equal(context.obligations.find((o) => o.obligationId === "studio-software")?.dueAt, "2026-12-08T12:00:00.000Z");

  // All generated scenarios pass validation on 5 Dec 2026 (no overdue escalation).
  const scenarios = generateAllocationScenarios(context);
  assert.ok(scenarios.length >= 2);
  for (const plan of scenarios) {
    assert.deepEqual(validateAllocationPlan(plan, context, dec5.toISOString()), []);
  }
  const decision = await orchestrateAllocation({ context, now: dec5.toISOString() });
  assert.notEqual(decision.status, "escalation_required");
  assert.equal(decision.status, "recommendation_unavailable");

  const jobs = seedJobs("receiver@example.test", dec5.getTime());
  const byId = new Map(jobs.map((j) => [j.job_id, j]));
  assert.equal(byId.get("demo-waiting-1")?.due, "2026-12-07");
  assert.equal(byId.get("demo-approve-1")?.due, "2026-12-08");
  assert.equal(byId.get("demo-waiting-2")?.due, "2026-12-09");

  const productStore = new ProductStore(":memory:");
  const today = new Date().toISOString().slice(0, 10);
  for (const job of productStore.listJobs("demo", null)) {
    assert.ok(job.dueAt && job.dueAt >= today, `expected demo job ${job.jobId} dueAt (${job.dueAt}) >= today (${today})`);
  }
  productStore.close();
});

test("processing payment settles cleanly via verified PAYMENT.PAYOUTS-ITEM.SUCCEEDED webhook and updates grid fee_cents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-webhook-settle-"));
  const dbPath = join(dir, "settle.db");
  const transactionStore = new TransactionStore(dbPath);
  const financialStore = new FinancialStore(dbPath);
  const productStore = new ProductStore(dbPath);
  const fetchFn = (async (url: string, init: Record<string, unknown> = {}) => {
    const response = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, headers: { get: () => null } });
    if (url.includes("/v1/notifications/verify-webhook-signature")) {
      return response(200, { verification_status: "SUCCESS" });
    }
    if (url.includes("/v1/payments/payouts") && init.method === "POST") {
      return response(201, { batch_header: { payout_batch_id: "BATCH-PROC-1", batch_status: "PENDING" } });
    }
    if (url.includes("/v1/payments/payouts/BATCH-PROC-1")) {
      return response(200, {
        batch_header: { payout_batch_id: "BATCH-PROC-1", sender_batch_header: { sender_batch_id: "settle-payment-demo-waiting-1" }, batch_status: "PENDING" },
        items: [{
          payout_item_id: "POI-PROC-1",
          transaction_status: "PENDING",
          payout_batch_id: "BATCH-PROC-1",
          payout_item: {
            sender_item_id: "settle-payment-demo-waiting-1",
            receiver: "receiver@example.test",
            amount: { value: "1.00", currency: "USD" },
          },
        }],
      });
    }
    throw new Error(`unexpected call ${url}`);
  }) as unknown as typeof fetch;

  const app = createSettleServer({
    jobs: payableJobs("receiver@example.test"),
    allowlistedEmails: new Set(["receiver@example.test"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "token",
    webhookId: "WH-ID-1",
    fetchFn,
    transactionStore,
    financialStore,
    productStore,
  });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    // Seed a pending item in FinancialStore as if polling hit its ~90s window
    const T0 = new Date().toISOString();
    financialStore.markReconciled(T0);
    // This test drives the store directly, so it creates the payment identity
    // the /api/approve route would create. No startup bridge does this.
    financialStore.verifyRecipient({ recipientId: "recipient-test", email: "receiver@example.test", actor: { actorId: "owner", role: "owner" }, at: T0 });
    financialStore.approvePayment({ jobId: "demo-waiting-1", recipientId: "recipient-test", requestedRecipientEmail: "receiver@example.test", amountCents: 100, currency: "USD", actor: { actorId: "owner", role: "owner" }, at: T0 });
    const res = financialStore.reservePayment({ jobId: "demo-waiting-1", at: T0 });
    const att = financialStore.beginSubmission(res.paymentId, T0);
    financialStore.recordAttemptBatchId(att.attemptId, "BATCH-PROC-1");
    financialStore.recordPayoutItem({
      paymentId: res.paymentId,
      senderBatchId: att.senderBatchId,
      payoutBatchId: "BATCH-PROC-1",
      payoutItemId: "POI-PROC-1",
      transactionId: null,
      activityId: null,
      recipientEmail: "receiver@example.test",
      amountCents: 100,
      currency: "USD",
      status: "PENDING",
      providerTimestamp: T0,
      raw: {
        payout_item_id: "POI-PROC-1",
        transaction_status: "PENDING",
        payout_batch_id: "BATCH-PROC-1",
        payout_item: { sender_item_id: att.senderBatchId, receiver: "receiver@example.test", amount: { value: "1.00", currency: "USD" } },
      },
    });

    // Verified PAYMENT.PAYOUTS-ITEM.SUCCEEDED webhook arrives and settles it
    const event = payoutItemEvent({
      id: "WH-SETTLE-1",
      payoutItemId: "POI-PROC-1",
      payoutBatchId: "BATCH-PROC-1",
      senderItemId: "settle-payment-demo-waiting-1",
      receiver: "receiver@example.test",
      amount: "1.00",
      fee: "0.02",
      status: "SUCCESS",
      transactionId: "TX-PROC-1",
    });
    const wh = await fetch(`${base}/api/webhooks/paypal`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "paypal-transmission-id": "TR-1",
        "paypal-transmission-time": T0,
        "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-transmission-sig": "sig",
      },
      body: JSON.stringify(event),
    });
    assert.equal(wh.status, 200);
    const whBody = await wh.json() as { outcome: string };
    assert.equal(whBody.outcome, "applied");

    // Both TransactionStore and FinancialStore/Grid now show paid + actual feeCents = 2
    const tx = transactionStore.listTransactions().find((t) => t.rowKey === "POI-PROC-1");
    assert.equal(tx?.status, "SUCCESS");
    assert.equal(tx?.feeCents, 2);

    const grid = await (await fetch(`${base}/api/grid`)).json() as { rows: Array<{ job_id: string; status: string; fee_cents: number | null }> };
    const row = grid.rows.find((r) => r.job_id === "demo-waiting-1");
    assert.equal(row?.status, "paid");
    assert.equal(row?.fee_cents, 2);

    // Ensure duplicate pay attempt refuses rather than double-paying
    const repay = await fetch(`${base}/api/pay`, {
      method: "POST",
      headers: OWNER_HEADERS,
      body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }),
    });
    assert.equal(repay.status, 200);
    const repayBody = await repay.json() as { accepted: string[]; rejected: Array<{ label: string }> };
    assert.deepEqual(repayBody.accepted, []);
    assert.equal(repayBody.rejected[0]?.label, "DuplicatePayout");

    // Grid preserves paid status rather than downgrading it to blocked on DuplicatePayout
    const gridAfter = await (await fetch(`${base}/api/grid`)).json() as { rows: Array<{ job_id: string; status: string }> };
    assert.equal(gridAfter.rows.find((r) => r.job_id === "demo-waiting-1")?.status, "paid");
  } finally {
    await app.close();
    productStore.close();
    financialStore.close();
    transactionStore.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cold-start script parses cleanly and includes database reset", () => {
  execFileSync("bash", ["-n", "scripts/cold-start.sh"]);
  const script = readFileSync("scripts/cold-start.sh", "utf8");
  assert.match(script, /Resetting local database/);
  assert.match(script, /rm -f "\$db_path"/);
});
