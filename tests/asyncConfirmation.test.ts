// Asynchronous payout confirmation and recovery, written before the implementation.
// The core rule: PayPal processing is not a failure and is not "unknown".
//   - a batch that PayPal accepted but has not finished is awaiting_confirmation
//   - a poll that fails after a batch id exists is retryable, not outcome_unknown
//   - an ambiguous submission is outcome_unknown, is never re-POSTed implicitly,
//     and is only recovered by reading the batch that belongs to it
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinancialStore } from "../src/server/financialStore.ts";
import { confirmDuePayments, reconcilePayPal, submitApprovedPayment } from "../src/server/financialPayments.ts";
import type { FetchFn } from "../src/server/paypalClient.ts";
import { DEFAULT_CONFIRMATION_POLICY } from "../src/server/paymentState.ts";

const owner = { actorId: "owner", role: "owner" } as const;
const T0 = "2026-11-10T12:00:00.000Z";

function setup(jobId = "job-1", amountCents = 100) {
  const store = new FinancialStore(join(mkdtempSync(join(tmpdir(), "settle-async-")), "ledger.db"));
  store.verifyRecipient({ recipientId: "r1", email: "worker@example.test", actor: owner, at: T0 });
  store.approvePayment({ jobId, recipientId: "r1", amountCents, currency: "USD", actor: owner, at: T0 });
  return store;
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    payout_item_id: "ITEM-1",
    payout_batch_id: "BATCH-1",
    activity_id: "ACT-1",
    payout_item_fee: { value: "0.25", currency: "USD" },
    transaction_status: "SUCCESS",
    payout_item: {
      sender_item_id: "settle-payment-job-1",
      receiver: "worker@example.test",
      amount: { value: "1.00", currency: "USD" },
    },
    time_processed: "2026-11-10T12:00:30.000Z",
    ...overrides,
  };
}

const opts = (store: FinancialStore, fetchFn: FetchFn, extra: Record<string, unknown> = {}) => ({
  store,
  baseUrl: "https://paypal.test",
  token: "secret",
  fetchFn,
  now: () => new Date(T0),
  pollDelayMs: 0,
  ...extra,
});

test("an accepted batch that PayPal is still processing is awaiting_confirmation, never outcome_unknown", async () => {
  const store = setup();
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } }), { status: 201 });
    }
    return new Response(JSON.stringify({
      batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" },
      items: [item({ transaction_status: "PENDING", transaction_id: null, payout_item_fee: undefined })],
    }), { status: 200 });
  }) as FetchFn;
  const result = await submitApprovedPayment({ ...opts(store, fetchFn), jobId: "job-1", pollMaxAttempts: 1 });
  assert.equal(result.status, "pending");
  const payment = store.getPaymentByJob("job-1")!;
  assert.notEqual(payment.status, "outcome_unknown");
  assert.ok(["pending", "awaiting_confirmation"].includes(payment.status));
  // The reservation is still exposure, so the cap cannot be bypassed while PayPal processes.
  assert.equal(store.getCapSummary(T0).activeReservationsCents, 100);
  // Durable work exists and is due immediately at the payment's next check.
  assert.equal(store.listDueConfirmations("2026-11-10T12:00:00.000Z").length, 1);
});

test("a poll failure after the batch id is known schedules retry work instead of declaring the payment unknown", async () => {
  const store = setup();
  let pollFails = true;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } }), { status: 201 });
    }
    if (pollFails) throw new Error("socket hang up");
    assert.equal(String(url), "https://paypal.test/v1/payments/payouts/BATCH-1");
    return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" }, items: [item()] }), { status: 200 });
  }) as FetchFn;
  const result = await submitApprovedPayment({ ...opts(store, fetchFn), jobId: "job-1", pollMaxAttempts: 1 });
  assert.equal(result.status, "awaiting_confirmation");
  const payment = store.getPaymentByJob("job-1")!;
  assert.notEqual(payment.status, "outcome_unknown");
  assert.equal(payment.status, "awaiting_confirmation");

  pollFails = false;
  const confirmed = await confirmDuePayments({
    ...opts(store, fetchFn),
    policy: { ...DEFAULT_CONFIRMATION_POLICY, baseMs: 1, maxMs: 1, maxAttempts: 5, jitterRatio: 0 },
    random: () => 0.5,
  });
  assert.equal(confirmed.checked, 1);
  assert.equal(confirmed.confirmed, 1);
  assert.equal(store.getPaymentByJob("job-1")?.status, "provider_confirmed");
  // No second payout was created: exactly one POST in the whole test.
  assert.equal(store.listDueConfirmations("2026-11-11T00:00:00.000Z").length, 0);
});

test("confirmDuePayments leaves a still-processing payment scheduled and never marks it failed", async () => {
  const store = setup();
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } }), { status: 201 });
    return new Response(JSON.stringify({
      batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" },
      items: [item({ transaction_status: "PENDING", transaction_id: null })],
    }), { status: 200 });
  }) as FetchFn;
  await submitApprovedPayment({ ...opts(store, fetchFn), jobId: "job-1", pollMaxAttempts: 1 });
  const run = await confirmDuePayments({ ...opts(store, fetchFn), policy: { ...DEFAULT_CONFIRMATION_POLICY, baseMs: 1, maxMs: 1, maxAttempts: 5, jitterRatio: 0 }, random: () => 0.5 });
  assert.equal(run.stillPending, 1);
  assert.equal(run.confirmed, 0);
  assert.equal(store.getPaymentByJob("job-1")?.status, "pending");
  assert.equal(store.listDueConfirmations("2026-11-10T12:00:00.000Z").length, 0, "rescheduled, not immediately due again");
});

test("an ambiguous submission is outcome_unknown and reconcile refuses to replay it by default", async () => {
  const store = setup();
  let posts = 0;
  const ambiguous = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") { posts++; throw new Error("connection reset after send"); }
    throw new Error("unexpected GET");
  }) as FetchFn;
  await assert.rejects(submitApprovedPayment({ ...opts(store, ambiguous), jobId: "job-1", pollMaxAttempts: 1 }), /connection reset/);
  assert.equal(posts, 1);
  assert.equal(store.getPaymentByJob("job-1")?.status, "outcome_unknown");
  // A reconciliation with no documented way to look the batch up must not POST again.
  const reconciled = await reconcilePayPal({ ...opts(store, ambiguous) });
  assert.equal(posts, 1, "reconciliation must not resubmit by default");
  assert.equal(reconciled.itemsRecorded, 0);
  const discrepancy = store.getDiscrepancies().find((row) => row.type === "AMBIGUOUS_SUBMISSION_WITHOUT_BATCH_ID");
  assert.ok(discrepancy, "the unresolved submission is recorded as a discrepancy");
  assert.equal(store.getPaymentByJob("job-1")?.status, "outcome_unknown");
});

test("an explicitly authorised idempotent replay probe recovers the original batch without creating a second payment", async () => {
  const store = setup();
  let posts = 0;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts++;
      const body = JSON.parse(String(init.body)) as { sender_batch_header: { sender_batch_id: string } };
      assert.equal(body.sender_batch_header.sender_batch_id, "settle-payment-job-1");
      return new Response(JSON.stringify({
        name: "DUPLICATE_REQUEST_ID",
        message: "Duplicate request id",
        links: [{ href: "https://paypal.test/v1/payments/payouts/BATCH-1", rel: "self", method: "GET" }],
      }), { status: 400 });
    }
    assert.equal(String(url), "https://paypal.test/v1/payments/payouts/BATCH-1");
    return new Response(JSON.stringify({
      batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: "settle-payment-job-1" } },
      items: [item()],
    }), { status: 200 });
  }) as FetchFn;
  store.markReconciled(T0);
  const reservation = store.reservePayment({ jobId: "job-1", at: T0 });
  const attempt = store.beginSubmission(reservation.paymentId, T0);
  store.markOutcomeUnknown(attempt.attemptId, "connection reset after send", T0);
  const result = await reconcilePayPal({ ...opts(store, fetchFn), idempotentReplay: true });
  assert.equal(result.itemsRecorded, 1);
  assert.equal(store.getPaymentByJob("job-1")?.status, "provider_confirmed");
  const audit = store.getAudit().map((row) => String(row.action));
  assert.ok(audit.includes("idempotent_replay_attempted"), "the replay is explicit in the audit trail");
});

test("a definite provider refusal is a failed payment, not an unknown one", async () => {
  const store = setup();
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ name: "INVALID_REQUEST", message: "receiver is invalid", debug_id: "dbg" }), { status: 400 });
    }
    throw new Error("unexpected GET");
  }) as FetchFn;
  await assert.rejects(submitApprovedPayment({ ...opts(store, fetchFn), jobId: "job-1", pollMaxAttempts: 1 }), /receiver is invalid|INVALID_REQUEST|HTTP 400/);
  assert.equal(store.getPaymentByJob("job-1")?.status, "failed");
  assert.equal(store.listDueConfirmations("2026-11-11T00:00:00.000Z").length, 0);
});

test("a fee estimate is recorded before submission and the provider fee afterwards", async () => {
  const store = setup("job-1", 100);
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } }), { status: 201 });
    return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" }, items: [item()] }), { status: 200 });
  }) as FetchFn;
  await submitApprovedPayment({ ...opts(store, fetchFn), jobId: "job-1", pollMaxAttempts: 1 });
  const payment = store.getPaymentByJob("job-1")!;
  const fee = store.getFeeRecord(payment.paymentId);
  assert.equal(fee.estimate?.estimatedFeeMinor, 25);
  assert.equal(fee.estimate?.policyId, "paypal-us-payouts-api-flat-2026-10");
  assert.equal(fee.provider?.reportedFeeMinor, 25);
  assert.equal(fee.consistent, true);
});

test("emergency stop blocks submission before any provider call", async () => {
  const store = setup();
  store.markReconciled(T0);
  store.setEmergencyStop({ stopped: true, actor: owner, at: T0, reason: "owner stop" });
  let calls = 0;
  const fetchFn = (async () => { calls++; throw new Error("must not be called"); }) as FetchFn;
  await assert.rejects(submitApprovedPayment({ ...opts(store, fetchFn), jobId: "job-1" }), /EMERGENCY_STOP/);
  assert.equal(calls, 0);
  assert.equal(store.getPaymentByJob("job-1")?.status, "approved");
});

test("two concurrent submissions for one job make exactly one provider call", async () => {
  const store = setup();
  let posts = 0;
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } }), { status: 201 });
    }
    return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" }, items: [item()] }), { status: 200 });
  }) as FetchFn;
  const results = await Promise.allSettled([
    submitApprovedPayment({ ...opts(store, fetchFn), jobId: "job-1", pollMaxAttempts: 1 }),
    submitApprovedPayment({ ...opts(store, fetchFn), jobId: "job-1", pollMaxAttempts: 1 }),
  ]);
  assert.equal(posts, 1, "a second concurrent submit must not create a second payout");
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(store.getPaymentByJob("job-1")?.status, "provider_confirmed");
});
