// Payment operations projection: one read-only row model for the operations
// grid, the Studio workspace, the capacity widget and the investigation agent.
//
// These tests were written before the module existed. They pin three things:
// every figure comes from the ledger (never from a second calculation), a row
// never carries an identifier its record does not support, and building the
// projection writes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FinancialStore } from "../src/server/financialStore.ts";
import { ProductStore } from "../src/server/productStore.ts";
import { buildFinancialReport } from "../src/server/financialReport.ts";
import { buildPaymentOperations, type OperationsSnapshot, type PaymentOperationRow } from "../src/server/paymentOperations.ts";
import type { Job } from "../src/server/jobs.ts";

const NOW = "2026-11-10T12:00:00.000Z";
const OWNER = { actorId: "owner-1", role: "owner" as const };

function legacyJob(overrides: Partial<Job>): Job {
  return {
    job_id: "job-1", freelancer_id: "freelancer-1", paypal_email: "receiver@example.test", amount_cents: 5000, currency: "USD",
    due: null, priority: null, origin: "application", approval_state: "not_approved", approved_at: null, status: "waiting",
    payout_batch_id: null, payout_item_id: null, decision_reason: null, ...overrides,
  };
}

/** Drive the real ledger through its own public methods, the way the routes do. */
function ledger() {
  const financial = new FinancialStore(":memory:");
  let recipientSeq = 0;
  const approve = (jobId: string, amountCents: number, at = "2026-11-09T09:00:00.000Z") => {
    const recipientId = `recipient-${++recipientSeq}`;
    financial.verifyRecipient({ recipientId, email: `r${recipientSeq}@example.test`, actor: OWNER, at });
    const paymentId = financial.approvePayment({ jobId, recipientId, amountCents, currency: "USD", actor: OWNER, at });
    return { paymentId, email: `r${recipientSeq}@example.test` };
  };
  const submit = (jobId: string, paymentId: string, at = "2026-11-09T10:00:00.000Z") => {
    financial.markReconciled(at);
    financial.reservePayment({ jobId, at });
    return financial.beginSubmission(paymentId, at);
  };
  const item = (paymentId: string, email: string, amountCents: number, status: string, senderBatchId: string, batch: string, opts: { fee?: string; reconcile?: boolean; tx?: string | null } = {}) => {
    const runId = opts.reconcile ? financial.beginReconciliation("2026-11-10T11:55:00.000Z") : undefined;
    financial.recordPayoutItem({
      paymentId, senderBatchId, payoutBatchId: batch, payoutItemId: `ITEM-${batch}`, transactionId: opts.tx === undefined ? `TX-${batch}` : opts.tx,
      activityId: null, recipientEmail: email, amountCents, currency: "USD", status, providerTimestamp: "2026-11-09T10:05:00.000Z",
      raw: opts.fee ? { payout_item_fee: { value: opts.fee, currency: "USD" } } : {},
      reconciliationRunId: runId, reconciledAt: runId ? "2026-11-10T11:55:00.000Z" : undefined,
    });
    if (runId) financial.completeReconciliation(runId, "2026-11-10T11:55:00.000Z", 1, 1);
  };
  return { financial, approve, submit, item };
}

function snapshot(opts: {
  financial?: FinancialStore; legacyJobs?: Job[]; workspaces?: Parameters<typeof buildPaymentOperations>[0]["workspaces"]; signedIn?: boolean;
  transactions?: Parameters<typeof buildPaymentOperations>[0]["transactions"]; at?: string;
}): OperationsSnapshot {
  const financial = opts.financial ?? new FinancialStore(":memory:");
  const at = opts.at ?? NOW;
  const legacyJobs = opts.legacyJobs ?? [];
  return buildPaymentOperations({
    at, legacyJobs, workspaces: opts.workspaces ?? [], financial, transactions: opts.transactions ?? [],
    report: buildFinancialReport({ financial, at, providerConfigured: false, providerConnected: false, seedRecordCount: legacyJobs.filter((job) => job.origin === "seed").length }),
    signedIn: opts.signedIn ?? false, approvalExpiryMs: 7 * 24 * 60 * 60 * 1000,
  });
}

const byJob = (snap: OperationsSnapshot, jobId: string): PaymentOperationRow => {
  const row = snap.rows.find((candidate) => candidate.jobId === jobId);
  assert.ok(row, `row for ${jobId}`);
  return row;
};

test("a seeded demonstration row carries no payment identity, no provider evidence and no money in any total", () => {
  const snap = snapshot({ legacyJobs: [
    legacyJob({ job_id: "demo-waiting-1", origin: "seed", approval_state: "approved", approved_at: Date.parse("2026-11-09T12:00:00Z"), amount_cents: 100, due: "2026-11-12", priority: "high" }),
  ] });
  const row = byJob(snap, "demo-waiting-1");
  assert.equal(row.operationId, "legacy/demo-waiting-1");
  assert.equal(row.recordOrigin, "seed");
  assert.equal(row.isDemonstration, true);
  assert.equal(row.providerEnvironment, "none");
  assert.equal(row.verificationState, "demonstration");
  assert.equal(row.paymentStatus, "not_submitted");
  assert.equal(row.approvalState, "approved");
  for (const key of ["paymentId", "payoutBatchId", "payoutItemId", "transactionId", "providerStatus", "lastReconciledAt", "executionRunId"] as const) {
    assert.equal(row[key], null, `${key} must be absent on a seeded row`);
  }
  assert.equal(row.dueInDays, 2);
  assert.equal(row.isDueSoon, true);
  assert.equal(snap.exceptions.pendingObligations.operational.amountCents, 0);
  assert.equal(snap.exceptions.pendingObligations.demonstration.count, 1);
});

test("a seed row that cites a past batch is a historical reference, with the batch marked as a claim and no item-level identifiers", () => {
  const snap = snapshot({ legacyJobs: [
    legacyJob({ job_id: "settle-audit-1", origin: "seed", approval_state: "approved", approved_at: Date.parse("2026-11-07T12:00:00Z"), status: "historical_reference", payout_batch_id: "RBZ4V8LCSSK5W", amount_cents: 100 }),
  ] });
  const row = byJob(snap, "settle-audit-1");
  assert.equal(row.paymentStatus, "historical_reference");
  assert.equal(row.verificationState, "historical_reference");
  assert.equal(row.providerEnvironment, "sandbox");
  assert.equal(row.payoutBatchId, "RBZ4V8LCSSK5W");
  assert.equal(row.batchReferenceKind, "historical_claim");
  assert.equal(row.payoutItemId, null);
  assert.equal(row.transactionId, null);
  assert.equal(row.hasIncompleteEvidence, true);
  assert.equal(row.isPendingObligation, false, "a historical reference is not money owed");
  assert.match(row.evidenceGaps.join(" "), /item/i);
});

test("a confirmed and reconciled ledger payment exposes exactly the identifiers the ledger holds", () => {
  const l = ledger();
  const { paymentId, email } = l.approve("job-paid", 4000);
  const attempt = l.submit("job-paid", paymentId);
  l.item(paymentId, email, 4000, "SUCCESS", attempt.senderBatchId, "BATCH-A", { fee: "0.25", reconcile: true });
  const snap = snapshot({ financial: l.financial, legacyJobs: [legacyJob({ job_id: "job-paid", amount_cents: 4000, approval_state: "approved", approved_at: Date.parse("2026-11-09T09:00:00Z"), status: "paid" })] });
  const row = byJob(snap, "job-paid");
  assert.equal(row.paymentId, paymentId);
  assert.equal(row.paymentStatus, "provider_confirmed");
  assert.equal(row.verificationState, "reconciled");
  assert.equal(row.reconciliationState, "reconciled");
  assert.equal(row.payoutBatchId, "BATCH-A");
  assert.equal(row.batchReferenceKind, "provider_item");
  assert.equal(row.payoutItemId, "ITEM-BATCH-A");
  assert.equal(row.transactionId, "TX-BATCH-A");
  assert.equal(row.providerStatus, "SUCCESS");
  assert.equal(row.providerFeeCents, 25);
  assert.equal(row.feeState, "provider_reported");
  assert.equal(row.lastReconciledAt, "2026-11-10T11:55:00.000Z");
  assert.equal(row.needsAttention, false);
  assert.equal(row.isUnreconciled, false);
  assert.equal(row.isPendingObligation, false);
  assert.equal(row.hasIncompleteEvidence, false);
  assert.equal(row.recordOrigin, "application");
  assert.equal(row.providerEnvironment, "sandbox");
});

test("a confirmed payment that was never independently re-read is unreconciled, and the count equals the ledger's own figure", () => {
  const l = ledger();
  const { paymentId, email } = l.approve("job-unrec", 3000);
  const attempt = l.submit("job-unrec", paymentId);
  l.item(paymentId, email, 3000, "SUCCESS", attempt.senderBatchId, "BATCH-B");
  const snap = snapshot({ financial: l.financial, legacyJobs: [legacyJob({ job_id: "job-unrec", amount_cents: 3000, approval_state: "approved" })] });
  const row = byJob(snap, "job-unrec");
  assert.equal(row.verificationState, "provider_confirmed");
  assert.equal(row.reconciliationState, "not_reconciled");
  assert.equal(row.isUnreconciled, true);
  assert.equal(row.feeState, "unavailable");
  assert.equal(row.providerFeeCents, null, "an absent fee is unknown, never zero");
  assert.equal(snap.exceptions.unreconciled.operational.count, l.financial.metrics().unreconciledConfirmedCount);
});

test("accepted-not-settled, lost response and provider failure are three different states with three different reasons", () => {
  const l = ledger();
  const waiting = l.approve("job-await", 1000);
  const awaitAttempt = l.submit("job-await", waiting.paymentId);
  l.financial.recordAttemptBatchId(awaitAttempt.attemptId, "BATCH-C");
  l.financial.markAwaitingConfirmation(awaitAttempt.attemptId, "BATCH-C", "2026-11-09T10:01:00.000Z");

  const lost = l.approve("job-lost", 1100);
  const lostAttempt = l.submit("job-lost", lost.paymentId);
  l.financial.markOutcomeUnknown(lostAttempt.attemptId, "timeout", "2026-11-09T10:02:00.000Z");

  const failed = l.approve("job-failed", 1200);
  const failedAttempt = l.submit("job-failed", failed.paymentId);
  l.item(failed.paymentId, failed.email, 1200, "FAILED", failedAttempt.senderBatchId, "BATCH-D", { tx: null });

  const snap = snapshot({ financial: l.financial, legacyJobs: ["job-await", "job-lost", "job-failed"].map((job_id, index) => legacyJob({ job_id, amount_cents: 1000 + index * 100, approval_state: "approved" })) });

  const awaiting = byJob(snap, "job-await");
  assert.equal(awaiting.paymentStatus, "awaiting_confirmation");
  assert.equal(awaiting.payoutBatchId, "BATCH-C");
  assert.equal(awaiting.batchReferenceKind, "provider_acknowledgement");
  assert.equal(awaiting.payoutItemId, null);
  assert.equal(awaiting.needsAttention, false, "accepted and still processing is not a failure");
  assert.equal(awaiting.isPendingObligation, true);

  const unknown = byJob(snap, "job-lost");
  assert.equal(unknown.paymentStatus, "outcome_unknown");
  assert.equal(unknown.verificationState, "verification_unavailable");
  assert.equal(unknown.payoutBatchId, null);
  assert.equal(unknown.needsAttention, true);
  assert.equal(unknown.isUnreconciled, true);
  assert.match(unknown.attentionReasons.join(" "), /reconcile/i);

  const refused = byJob(snap, "job-failed");
  assert.equal(refused.paymentStatus, "failed");
  assert.equal(refused.providerStatus, "FAILED");
  assert.equal(refused.needsAttention, true);
  assert.equal(refused.isPendingObligation, false);
});

test("capacity figures are the financial report's figures, not a second calculation", () => {
  const l = ledger();
  const paid = l.approve("job-cap-paid", 4000);
  const paidAttempt = l.submit("job-cap-paid", paid.paymentId);
  l.item(paid.paymentId, paid.email, 4000, "SUCCESS", paidAttempt.senderBatchId, "BATCH-E");
  const reserved = l.approve("job-cap-reserved", 2500);
  l.financial.reservePayment({ jobId: "job-cap-reserved", at: "2026-11-09T10:00:00.000Z" });
  const report = buildFinancialReport({ financial: l.financial, at: NOW, providerConfigured: false, providerConnected: false, seedRecordCount: 0 });
  const snap = snapshot({ financial: l.financial, legacyJobs: [legacyJob({ job_id: "job-cap-paid", amount_cents: 4000, approval_state: "approved" }), legacyJob({ job_id: "job-cap-reserved", amount_cents: 2500, approval_state: "approved" })] });
  assert.equal(snap.capacity.budgetCents, l.financial.getPolicy().capCents);
  assert.equal(snap.capacity.rollingSpendCents, report.metrics.rollingWindowSpend.value);
  assert.equal(snap.capacity.rollingSpendCents, 4000);
  assert.equal(snap.capacity.activeExposureCents, report.cap.activeReservationsCents);
  assert.equal(snap.capacity.activeExposureCents, 2500);
  assert.equal(snap.capacity.remainingCents, report.cap.remainingCents);
  assert.equal(snap.capacity.remainingCents, 150000 - 4000 - 2500);
  assert.equal(snap.capacity.perPaymentCapCents, 20000);
  assert.equal(snap.capacity.fresh, report.cap.fresh);
  assert.equal(snap.capacity.policyVersion, report.cap.policyVersion);
  assert.match(snap.capacity.definitions.remaining, /cap/i);
  assert.ok(reserved.paymentId);
});

test("budget fit is decided by the owner's caps: over the per-payment cap, or beyond what is left after higher-priority work", () => {
  const financial = new FinancialStore(":memory:");
  financial.updatePolicy({ capCents: 30000, perPaymentCapCents: 20000, freshnessSeconds: 300, actor: OWNER, at: "2026-11-09T08:00:00.000Z" });
  const approveOnly = (jobId: string, amountCents: number, index: number) => {
    financial.verifyRecipient({ recipientId: `rc-${index}`, email: `c${index}@example.test`, actor: OWNER, at: "2026-11-09T09:00:00.000Z" });
    financial.approvePayment({ jobId, recipientId: `rc-${index}`, amountCents, currency: "USD", actor: OWNER, at: "2026-11-09T09:00:00.000Z" });
  };
  approveOnly("job-first", 18000, 1);
  approveOnly("job-second", 15000, 2);
  const snap = snapshot({ financial, legacyJobs: [
    legacyJob({ job_id: "job-first", amount_cents: 18000, approval_state: "approved", priority: "high", due: "2026-11-11" }),
    legacyJob({ job_id: "job-second", amount_cents: 15000, approval_state: "approved", priority: "low", due: "2026-11-20" }),
    legacyJob({ job_id: "job-too-big", amount_cents: 25000, approval_state: "not_approved", priority: "high" }),
  ] });
  assert.equal(byJob(snap, "job-first").cannotPayWithinBudget, false);
  assert.equal(byJob(snap, "job-first").isReadyToPay, true);
  const second = byJob(snap, "job-second");
  assert.equal(second.cannotPayWithinBudget, true);
  assert.match(second.budgetReason ?? "", /remaining/i);
  const tooBig = byJob(snap, "job-too-big");
  assert.equal(tooBig.cannotPayWithinBudget, true);
  assert.match(tooBig.budgetReason ?? "", /per-payment cap/i);
  assert.equal(tooBig.needsApproval, true);
  assert.deepEqual([...snap.exceptions.cannotPayWithinBudget.operationIds].sort(), ["legacy/job-second", "legacy/job-too-big"]);
});

test("exception totals list exactly the rows that carry the flag, and never add demonstration money to operational money", () => {
  const l = ledger();
  l.approve("job-op", 7000);
  const snap = snapshot({ financial: l.financial, legacyJobs: [
    legacyJob({ job_id: "job-op", amount_cents: 7000, approval_state: "approved" }),
    legacyJob({ job_id: "job-needs", amount_cents: 900, approval_state: "not_approved" }),
    legacyJob({ job_id: "demo-seed", origin: "seed", amount_cents: 100, approval_state: "not_approved" }),
  ] });
  for (const key of Object.keys(snap.exceptions) as Array<keyof OperationsSnapshot["exceptions"]>) {
    const bucket = snap.exceptions[key];
    const flagged = snap.rows.filter((row) => row[bucket.flag]).map((row) => row.operationId).sort();
    assert.deepEqual([...bucket.operationIds].sort(), flagged, `${key} ids`);
    assert.equal(bucket.operational.count + bucket.demonstration.count, flagged.length, `${key} count`);
    assert.equal(bucket.operational.amountCents, snap.rows.filter((row) => row[bucket.flag] && !row.isDemonstration).reduce((sum, row) => sum + row.amountCents, 0), `${key} operational amount`);
    assert.ok(bucket.definition.length > 20, `${key} states its definition`);
  }
  assert.equal(snap.exceptions.awaitingApproval.operational.count, 1);
  assert.equal(snap.exceptions.awaitingApproval.demonstration.count, 1);
  assert.equal(snap.exceptions.awaitingApproval.operational.amountCents, 900);
  assert.equal(snap.exceptions.pendingObligations.operational.amountCents, 7900);
});

test("workspace obligations are included only for the workspaces handed in, with their own titles and recipients", () => {
  const product = new ProductStore(":memory:");
  const demoJobs = product.listJobs("demo", null);
  const demoReceipts = product.listReceipts("demo", null);
  const workspace = product.getWorkspace("demo", null);
  const snap = snapshot({ workspaces: [{ workspace, jobs: demoJobs, receipts: demoReceipts }] });
  const retouch = byJob(snap, "demo-retouch");
  assert.equal(retouch.operationId, "workspace/demo-retouch");
  assert.equal(retouch.source, "workspace");
  assert.equal(retouch.workspaceName, workspace.name);
  assert.equal(retouch.title, "Rush retouching");
  assert.equal(retouch.recordOrigin, "synthetic");
  assert.equal(retouch.isDemonstration, true);
  assert.equal(retouch.verificationState, "demonstration");
  assert.equal(retouch.paymentId, null);
  assert.equal(byJob(snap, "demo-approval").needsApproval, true);
  assert.equal(byJob(snap, "demo-license").cannotPayWithinBudget, true, "a $250 job exceeds the $200 per-payment policy");
  const historical = snap.rows.find((row) => row.operationId === "receipt/demo-historical-receipt");
  assert.ok(historical, "the receipt-only historical record is a row");
  assert.equal(historical.jobId, null);
  assert.equal(historical.paymentStatus, "historical_reference");
  assert.equal(historical.payoutBatchId, "RBZ4V8LCSSK5W");
  assert.equal(historical.batchReferenceKind, "historical_claim");
  assert.equal(snap.access.signedIn, false);
  assert.deepEqual(snap.access.workspaces.map((entry) => entry.workspaceId), ["demo"]);
});

test("verified provider events are linked to their obligation by job or payout item, and never invent a row", () => {
  const l = ledger();
  const { paymentId, email } = l.approve("job-evt", 2000);
  const attempt = l.submit("job-evt", paymentId);
  l.item(paymentId, email, 2000, "SUCCESS", attempt.senderBatchId, "BATCH-F");
  const event = {
    rowKey: "ITEM-BATCH-F", originalTransactionId: "TX-BATCH-F", associatedOrderId: null, latestEventId: "WH-9", originalEventId: "WH-8",
    transactionTimestamp: "2026-11-09T10:05:00Z", eventCreatedAt: "2026-11-09T10:05:01Z", eventReceivedAt: "2026-11-09T10:05:02Z", status: "SUCCESS",
    grossCents: 2000, currency: "USD", feeCents: 25, netCents: 1975, payerEmail: null, payeeEmail: email, paymentMethod: "PAYPAL",
    payoutBatchId: "BATCH-F", payoutItemId: "ITEM-BATCH-F", jobId: null, relatedTransactionId: null, lastEventSequence: 4,
  };
  const orphan = { ...event, rowKey: "ITEM-OTHER", payoutItemId: "ITEM-OTHER", payoutBatchId: "BATCH-OTHER", latestEventId: "WH-10" };
  const snap = snapshot({ financial: l.financial, legacyJobs: [legacyJob({ job_id: "job-evt", amount_cents: 2000, approval_state: "approved" })], transactions: [event, orphan] });
  assert.equal(snap.rows.length, 1);
  const row = byJob(snap, "job-evt");
  assert.equal(row.providerEventCount, 1);
  assert.deepEqual(row.providerEventKeys, ["ITEM-BATCH-F"]);
  assert.equal(snap.providerEvents.total, 2);
  assert.equal(snap.providerEvents.unlinked, 1);
});

test("building the projection is read-only: the ledger audit trail and every payment row are byte-identical afterwards", () => {
  const l = ledger();
  const { paymentId, email } = l.approve("job-ro", 2000);
  const attempt = l.submit("job-ro", paymentId);
  l.item(paymentId, email, 2000, "SUCCESS", attempt.senderBatchId, "BATCH-G");
  const before = JSON.stringify({ audit: l.financial.getAudit(), payment: l.financial.getPaymentByJob("job-ro"), item: l.financial.getPayoutItem(paymentId), cap: l.financial.getCapSummary(NOW) });
  for (let i = 0; i < 3; i++) snapshot({ financial: l.financial, legacyJobs: [legacyJob({ job_id: "job-ro", amount_cents: 2000, approval_state: "approved" })] });
  const after = JSON.stringify({ audit: l.financial.getAudit(), payment: l.financial.getPaymentByJob("job-ro"), item: l.financial.getPayoutItem(paymentId), cap: l.financial.getCapSummary(NOW) });
  assert.equal(after, before);
});

test("an approval older than the policy lifetime is reported as expired, and an overdue unpaid obligation needs attention", () => {
  const snap = snapshot({ legacyJobs: [
    legacyJob({ job_id: "job-stale", approval_state: "approved", approved_at: Date.parse("2026-10-30T12:00:00Z"), due: "2026-11-05" }),
  ] });
  const row = byJob(snap, "job-stale");
  assert.equal(row.approvalState, "expired");
  assert.equal(row.dueInDays, -5);
  assert.equal(row.needsAttention, true);
  assert.match(row.attentionReasons.join(" | "), /overdue/i);
  assert.match(row.attentionReasons.join(" | "), /expired/i);
});

test("the snapshot is deterministic for the same ledger state and names its sources", () => {
  const first = snapshot({ legacyJobs: [legacyJob({ job_id: "job-x" })] });
  const second = snapshot({ legacyJobs: [legacyJob({ job_id: "job-x" })] });
  assert.equal(first.dataVersion, second.dataVersion);
  assert.equal(first.generatedAt, NOW);
  assert.ok(first.sources.length >= 2);
  const changed = snapshot({ legacyJobs: [legacyJob({ job_id: "job-x", amount_cents: 5001 })] });
  assert.notEqual(changed.dataVersion, first.dataVersion);
});
