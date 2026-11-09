import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinancialStore } from "../src/server/financialStore.ts";

const owner = { actorId: "owner-1", role: "owner" } as const;
const T0 = "2026-11-09T12:00:00Z";
const inside = "2026-11-08T12:00:00Z";

function setup() {
  const path = join(mkdtempSync(join(tmpdir(), "settle-financial-")), "ledger.db");
  const store = new FinancialStore(path);
  store.verifyRecipient({ recipientId: "rec-1", email: "verified@example.test", actor: owner, at: T0 });
  store.markReconciled(T0);
  return { store, path };
}

function approved(store: FinancialStore, jobId = "job-1", amountCents = 6000) {
  store.approvePayment({ jobId, recipientId: "rec-1", amountCents, currency: "USD", actor: owner, at: T0 });
  return store.reservePayment({ jobId, at: T0 });
}

test("owner settings, recipient verification, approval and complete payment identity survive restart", () => {
  const { store, path } = setup();
  store.updatePolicy({ capCents: 100000, perPaymentCapCents: 20000, freshnessSeconds: 300, actor: owner, at: T0 });
  approved(store);
  store.close();
  const reopened = new FinancialStore(path);
  assert.equal(reopened.getPolicy().capCents, 100000);
  assert.equal(reopened.getRecipient("rec-1")?.verifiedBy, "owner-1");
  const payment = reopened.getPaymentByJob("job-1");
  assert.equal(payment?.idempotencyKey, "settle-payment-job-1");
  assert.equal(payment?.recipientEmail, "verified@example.test");
  assert.equal(payment?.policyVersion, 2);
  assert.ok(reopened.getAudit().length >= 4);
});

test("client cannot substitute recipient or exceed owner per-payment cap", () => {
  const { store } = setup();
  assert.throws(() => store.approvePayment({ jobId: "job-1", recipientId: "rec-1", amountCents: 6000, currency: "USD", actor: { actorId: "mallory", role: "viewer" }, at: T0 }), /owner/);
  assert.throws(() => store.approvePayment({ jobId: "job-1", recipientId: "rec-1", requestedRecipientEmail: "attacker@example.test", amountCents: 6000, currency: "USD", actor: owner, at: T0 }), /recipient substitution/);
  assert.throws(() => store.approvePayment({ jobId: "job-1", recipientId: "rec-1", amountCents: 20001, currency: "USD", actor: owner, at: T0 }), /per-payment cap/);
});

test("replay returns original reservation and concurrent reservations cannot exceed cap", () => {
  const { store } = setup();
  store.updatePolicy({ capCents: 10000, perPaymentCapCents: 20000, freshnessSeconds: 300, actor: owner, at: T0 });
  const first = approved(store);
  const replay = store.reservePayment({ jobId: "job-1", at: T0 });
  assert.equal(replay.paymentId, first.paymentId);
  store.approvePayment({ jobId: "job-2", recipientId: "rec-1", amountCents: 5000, currency: "USD", actor: owner, at: T0 });
  const results = Array.from({ length: 8 }, () => { try { return store.reservePayment({ jobId: "job-2", at: T0 }).status; } catch { return "CAP_EXCEEDED"; } });
  assert.ok(results.every((result) => result === "CAP_EXCEEDED"));
  assert.equal(store.getCapSummary(T0).activeReservationsCents, 6000);
});

test("rolling cap uses provider timestamps and excludes old, pending and failed items", () => {
  const { store } = setup();
  store.updatePolicy({ capCents: 10000, perPaymentCapCents: 20000, freshnessSeconds: 300, actor: owner, at: T0 });
  store.recordProviderSpend({ paymentKey: "historical-1", amountCents: 4000, currency: "USD", status: "SUCCESS", providerTimestamp: "2026-11-02T11:59:59Z" });
  store.recordProviderSpend({ paymentKey: "historical-2", amountCents: 3000, currency: "USD", status: "SUCCESS", providerTimestamp: inside });
  store.recordProviderSpend({ paymentKey: "historical-3", amountCents: 9000, currency: "USD", status: "PENDING", providerTimestamp: inside });
  store.recordProviderSpend({ paymentKey: "historical-4", amountCents: 9000, currency: "USD", status: "FAILED", providerTimestamp: inside });
  store.markReconciled(T0);
  assert.equal(store.getCapSummary(T0).confirmedSpendCents, 3000);
  approved(store);
  assert.equal(store.getCapSummary(T0).remainingCents, 1000);
});

test("returned and reversed payments are separate adjustments, not deleted history", () => {
  const { store } = setup();
  store.recordProviderSpend({ paymentKey: "original", amountCents: 5000, currency: "USD", status: "SUCCESS", providerTimestamp: inside });
  store.recordProviderSpend({ paymentKey: "original", amountCents: 5000, currency: "USD", status: "RETURNED", providerTimestamp: inside });
  store.recordProviderSpend({ paymentKey: "other", amountCents: 1000, currency: "USD", status: "REVERSED", providerTimestamp: inside });
  store.markReconciled(T0);
  const summary = store.getCapSummary(T0);
  assert.equal(summary.confirmedSpendCents, 5000);
  assert.equal(summary.adjustmentsCents, 5000);
  assert.equal(summary.eligibleSpendCents, 0);
});

test("stale reconciliation fails closed and exposes last successful reconciliation", () => {
  const { store } = setup();
  approved(store);
  assert.throws(() => store.reservePayment({ jobId: "job-1", at: "2026-11-09T12:10:00Z" }), /reconciliation is stale/);
  assert.equal(store.getCapSummary("2026-11-09T12:10:00Z").fresh, false);
});

test("ambiguous submission is outcome_unknown and recovery reuses identity without another submission", () => {
  const { store } = setup();
  const reservation = approved(store);
  const attempt = store.beginSubmission(reservation.paymentId, T0);
  store.markOutcomeUnknown(attempt.attemptId, "timeout after provider accept", T0);
  store.close();
  const reopened = new FinancialStore(store.path());
  const recovered = reopened.recoverSubmission(reservation.paymentId);
  assert.equal(recovered.status, "outcome_unknown");
  assert.equal(recovered.idempotencyKey, reservation.idempotencyKey);
  assert.equal(recovered.senderBatchId, attempt.senderBatchId);
});

test("mixed provider items preserve every identifier and never collapse batch outcomes", () => {
  const { store } = setup();
  const reservation = approved(store);
  const attempt = store.beginSubmission(reservation.paymentId, T0);
  store.recordPayoutItem({ paymentId: reservation.paymentId, senderBatchId: attempt.senderBatchId, payoutBatchId: "PB-1", payoutItemId: "PI-1", transactionId: "TX-1", activityId: "ACT-1", recipientEmail: "verified@example.test", amountCents: 6000, currency: "USD", status: "FAILED", providerTimestamp: inside, raw: { provider: "fixture" } });
  const item = store.getPayoutItem(reservation.paymentId);
  assert.equal(item?.status, "FAILED");
  assert.equal(item?.activityId, "ACT-1");
  assert.equal(store.getPaymentByJob("job-1")?.status, "failed");
  assert.equal(item?.payoutBatchId, "PB-1");
});

test("provider mismatch persists one discrepancy outside the rejected item transaction", () => {
  const { store } = setup();
  const reservation = approved(store);
  const mismatch = {
    paymentId: reservation.paymentId,
    senderBatchId: "settle-payment-job-1",
    payoutBatchId: "PB-MISMATCH",
    payoutItemId: "PI-MISMATCH",
    transactionId: "TX-MISMATCH",
    activityId: "ACT-MISMATCH",
    recipientEmail: "attacker@example.test",
    amountCents: 6001,
    currency: "USD",
    status: "SUCCESS",
    providerTimestamp: inside,
    raw: { provider: "fixture" },
  };
  assert.throws(() => store.recordPayoutItem(mismatch), /provider recipient, amount or currency mismatch/);
  assert.throws(() => store.recordPayoutItem(mismatch), /provider recipient, amount or currency mismatch/);
  const conflicts = store.getDiscrepancies().filter((row) => String(row.type) === "PROVIDER_FACT_MISMATCH");
  assert.equal(conflicts.length, 1);
  assert.match(String(conflicts[0].details_json), /attacker@example\.test/);
  assert.equal(store.getPayoutItem(reservation.paymentId), null);
  assert.equal(store.getPaymentByJob("job-1")?.status, "reserved");
});

test("reconciliation discrepancies are idempotent, durable and audit is immutable", () => {
  const { store, path } = setup();
  const fact = { paymentId: null, type: "PROVIDER_ORPHAN", details: { providerPaymentId: "TX-ORPHAN" }, at: T0 };
  const first = store.recordDiscrepancy(fact);
  const second = store.recordDiscrepancy(fact);
  assert.equal(first, second);
  assert.equal(store.getDiscrepancies().length, 1);
  assert.throws(() => store.unsafeTestOnlySql("DELETE FROM financial_audit"), /immutable/);
  store.close();
  const reopened = new FinancialStore(path);
  assert.equal(reopened.getDiscrepancies().length, 1);
  assert.equal(reopened.recordDiscrepancy(fact), first);
  assert.equal(reopened.getDiscrepancies().length, 1);
});

test("invoice evidence is distinct from payment evidence and preserves raw provider object", () => {
  const { store } = setup();
  store.recordInvoiceEvidence({ internalInvoiceId: "invoice-1", paypalInvoiceId: "INV2-TEST", invoiceNumber: "N-1", status: "SENT", amountCents: 1000, currency: "USD", jobIds: ["job-1"], endpoint: "/v2/invoicing/invoices/INV2-TEST", retrievedAt: T0, raw: { id: "INV2-TEST", status: "SENT" } });
  const invoice = store.getInvoice("invoice-1");
  assert.ok(invoice);
  assert.equal(invoice.paypalInvoiceId, "INV2-TEST");
  assert.equal(invoice.evidenceClass, "PAYPAL_INVOICE_OBJECT");
  assert.equal((invoice.raw as Record<string, unknown>).status, "SENT");
  assert.equal("paymentStatus" in (invoice ?? {}), false);
});
