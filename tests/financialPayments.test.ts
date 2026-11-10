import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinancialStore } from "../src/server/financialStore.ts";
import { reconcilePayPal, submitApprovedPayment } from "../src/server/financialPayments.ts";
import type { FetchFn } from "../src/server/paypalClient.ts";
const owner = { actorId: "owner", role: "owner" } as const;
const T0 = "2026-11-09T12:00:00Z";

function setup(fetchFn: FetchFn) {
  const store = new FinancialStore(join(mkdtempSync(join(tmpdir(), "settle-finpay-")), "ledger.db"));
  store.verifyRecipient({ recipientId: "r1", email: "worker@example.test", actor: owner, at: T0 });
  store.approvePayment({ jobId: "j1", recipientId: "r1", amountCents: 1000, currency: "USD", actor: owner, at: T0 });
  return { store, opts: { baseUrl: "https://paypal.test", token: "secret", fetchFn, now: () => new Date(T0) } };
}
function item(overrides: Record<string, unknown> = {}) {
  return { payout_item_id: "ITEM-1", transaction_id: "TX-1", activity_id: "ACT-1", payout_item_fee: { value: "0.00", currency: "USD" }, payout_batch_id: "BATCH-1", sender_item_id: "settle-payment-j1", transaction_status: "SUCCESS", receiver: "worker@example.test", payout_item: { amount: { value: "10.00", currency: "USD" } }, time_processed: "2026-11-09T11:59:00Z", ...overrides };
}
function reconciled() {
  return new Response(JSON.stringify({ items: [], total_items: 0 }), { status: 200 });
}

test("timeout after accept becomes outcome_unknown and restart recovery never creates another payout", async () => {
  const { store, opts } = setup((async (url: string | URL | Request) => {
    if (String(url).includes("?")) return reconciled();
    throw new Error("network timeout");
  }) as FetchFn);
  await assert.rejects(submitApprovedPayment({ ...opts, store, jobId: "j1" }), /network timeout/);
  assert.equal(store.getPaymentByJob("j1")?.status, "outcome_unknown");
  let createCalls = 0;
  const fetchFn = (async (url: string | URL | Request) => {
    if (String(url).endsWith("/payouts")) { createCalls++; throw new Error("must not create on replay"); }
    return reconciled();
  }) as FetchFn;
  await assert.rejects(submitApprovedPayment({ ...opts, store, fetchFn, jobId: "j1" }), /outcome is unknown/);
  assert.equal(createCalls, 0);
});

test("submission persists complete provider item and confirms only successful item", async () => {
  const fetchFn = (async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith("/payouts")) return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } }), { status: 201 });
    if (path.includes("?")) return reconciled();
    return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" }, items: [item()] }), { status: 200 });
  }) as FetchFn;
  const { store, opts } = setup(fetchFn);
  const result = await submitApprovedPayment({ ...opts, store, jobId: "j1" });
  assert.equal(result.status, "provider_confirmed");
  assert.equal(result.item?.transactionId, "TX-1");
  assert.equal(store.getCapSummary(T0).confirmedSpendCents, 1000);
});

test("reconciliation discovers missing item after crash and records orphan discrepancies", async () => {
  const { store, opts } = setup((async (url: string | URL | Request) => {
    if (String(url).includes("?")) return new Response(JSON.stringify({ items: [{ batch_header: { payout_batch_id: "BATCH-1", sender_batch_id: "settle-payment-j1" } }] }), { status: 200 });
    return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1" }, items: [item()] }), { status: 200 });
  }) as FetchFn);
  store.markReconciled(T0);
  const reservation = store.reservePayment({ jobId: "j1", at: T0 });
  const attempt = store.beginSubmission(reservation.paymentId, T0);
  store.markOutcomeUnknown(attempt.attemptId, "simulated crash", T0);
  const result = await reconcilePayPal({ ...opts, store });
  assert.equal(result.itemsRecorded, 1);
  assert.equal(store.getPaymentByJob("j1")?.status, "provider_confirmed");
  assert.equal(store.getPayoutItem(reservation.paymentId)?.activityId, "ACT-1");
});
