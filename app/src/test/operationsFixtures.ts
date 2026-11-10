// Labelled fixtures for dashboard unit tests. Shapes follow the shared contract
// in src/shared/operations.ts; values are invented and marked as fixtures.
import type { OperationsCapacity, OperationsInvestigation, OperationsSnapshot, PaymentOperationDetail, PaymentOperationFlag, PaymentOperationRow } from "../operations/contract.ts";

export function row(overrides: Partial<PaymentOperationRow> = {}): PaymentOperationRow {
  return {
    operationId: "workspace/job-1", source: "workspace", workspaceId: "ws-1", workspaceName: "Fixture studio", jobId: "job-1", title: "Fixture job",
    recipient: "Fixture Contractor", amountCents: 4000, currency: "USD", dueDate: "2026-11-12", dueInDays: 2, priority: "normal",
    recordOrigin: "application", isDemonstration: false, providerEnvironment: "sandbox", approvalState: "approved", approvedAt: "2026-11-09T09:00:00.000Z", approvedBy: "owner-1",
    paymentStatus: "approved", paymentStatusLabel: "Approved, not sent", paymentId: "11111111-1111-4111-8111-111111111111", policyVersion: 1,
    payoutBatchId: null, batchReferenceKind: null, payoutItemId: null, transactionId: null, providerStatus: null, providerTimestamp: null,
    submittedAt: null, confirmedAt: null, verificationState: "unverified", reconciliationState: "not_applicable", lastReconciledAt: null,
    feeState: "unavailable", feeEstimateCents: null, providerFeeCents: null, executionRunId: null, lastUpdatedAt: "2026-11-09T09:00:00.000Z",
    providerEventCount: 0, providerEventKeys: [], blockedReason: null,
    needsApproval: false, isPendingObligation: true, isReadyToPay: true, isInFlight: false, isUnreconciled: false, isDueSoon: true, isOverdue: false,
    cannotPayWithinBudget: false, budgetReason: null, hasIncompleteEvidence: false, evidenceGaps: [], needsAttention: false, attentionReasons: [],
    ...overrides,
  };
}

export const capacity: OperationsCapacity = {
  currency: "USD", budgetCents: 150000, perPaymentCapCents: 20000, windowHours: 168, windowStart: "2026-11-03T12:00:00.000Z", windowEnd: "2026-11-10T12:00:00.000Z",
  rollingSpendCents: 9500, activeExposureCents: 1900, awaitingConfirmationCents: 1700, remainingCents: 138600, fresh: true, freshnessSeconds: 300,
  lastSuccessfulReconciliation: "2026-11-10T11:58:00.000Z", policyVersion: 2, emergencyStop: false,
  formula: "remaining = budget − rolling expenditure − active exposure, never below zero",
  definitions: { budget: "budget definition", rollingSpend: "rolling definition", activeExposure: "exposure definition", awaitingConfirmation: "awaiting definition", remaining: "remaining definition", perPaymentCap: "cap definition" },
  source: "SQLite financial ledger (fixture)",
};

const BUCKETS: Array<[keyof OperationsSnapshot["exceptions"], PaymentOperationFlag, string]> = [
  ["awaitingApproval", "needsApproval", "Awaiting approval"], ["pendingObligations", "isPendingObligation", "Pending obligations"], ["unreconciled", "isUnreconciled", "Unreconciled"],
  ["needsAttention", "needsAttention", "Needs attention"], ["dueSoon", "isDueSoon", "Due soon"], ["cannotPayWithinBudget", "cannotPayWithinBudget", "Outside budget"], ["incompleteEvidence", "hasIncompleteEvidence", "Incomplete provider evidence"],
];

export function snapshot(rows: PaymentOperationRow[], overrides: Partial<OperationsSnapshot> = {}): OperationsSnapshot {
  const exceptions = Object.fromEntries(BUCKETS.map(([key, flag, label]) => {
    const flagged = rows.filter((entry) => entry[flag]);
    const total = (list: PaymentOperationRow[]) => ({ count: list.length, amountCents: list.reduce((sum, entry) => sum + entry.amountCents, 0) });
    return [key, { flag, label, definition: `${label}: fixture definition of the category.`, operationIds: flagged.map((entry) => entry.operationId), operational: total(flagged.filter((entry) => !entry.isDemonstration)), demonstration: total(flagged.filter((entry) => entry.isDemonstration)) }];
  })) as OperationsSnapshot["exceptions"];
  const next: OperationsSnapshot = {
    generatedAt: "2026-11-10T12:00:00.000Z", dataVersion: "",
    access: { signedIn: true, scope: "owner", workspaces: [{ workspaceId: "ws-1", name: "Fixture studio", kind: "operational" }], note: "fixture" },
    provider: { environment: "sandbox", configured: true, connected: true, note: "fixture" },
    rows, capacity, exceptions, providerEvents: { total: 0, linked: 0, unlinked: 0 }, sources: ["fixture ledger", "fixture obligations"],
    ...overrides,
  };
  // The version changes when, and only when, the rows or the capacity figures
  // change, as the shared contract states and as the server hashes it. A
  // version built from operation ids and payment statuses alone would silently
  // drop a real change (a flag changing is a row changing) because the store
  // keeps the existing snapshot for a poll that brings the same version.
  next.dataVersion = `v-${JSON.stringify(next.rows)}|${JSON.stringify(next.capacity)}`;
  return next;
}

export function standardRows(): PaymentOperationRow[] {
  return [
    row({ operationId: "workspace/confirmed", jobId: "confirmed", title: "Homepage illustration", paymentStatus: "provider_confirmed", paymentStatusLabel: "Confirmed by PayPal", payoutBatchId: "BATCH-1", batchReferenceKind: "provider_item", payoutItemId: "ITEM-1", transactionId: "TX-1", providerStatus: "SUCCESS", verificationState: "provider_confirmed", reconciliationState: "not_reconciled", isPendingObligation: false, isReadyToPay: false, isUnreconciled: true, isDueSoon: false, hasIncompleteEvidence: true, evidenceGaps: ["The confirmed item has not been independently re-read from PayPal."] }),
    row({ operationId: "workspace/failed", jobId: "failed", title: "Icon set", amountCents: 1300, paymentStatus: "failed", paymentStatusLabel: "Failed", providerStatus: "FAILED", payoutBatchId: "BATCH-2", batchReferenceKind: "provider_item", payoutItemId: "ITEM-2", verificationState: "provider_response_received", reconciliationState: "not_reconciled", isPendingObligation: false, isReadyToPay: false, isDueSoon: false, needsAttention: true, attentionReasons: ["PayPal reported this payout item as FAILED; no payment was confirmed."] }),
    row({ operationId: "workspace/unknown", jobId: "unknown", title: "Podcast edit", amountCents: 1900, paymentStatus: "outcome_unknown", paymentStatusLabel: "Outcome unknown", verificationState: "verification_unavailable", reconciliationState: "required", isReadyToPay: false, isUnreconciled: true, needsAttention: true, attentionReasons: ["The submission response was lost. Reconcile with PayPal before any retry; never resubmit blindly."], hasIncompleteEvidence: true, evidenceGaps: ["No PayPal batch ID was recorded for this submission."] }),
    row({ operationId: "workspace/ready", jobId: "ready", title: "Newsletter layout", amountCents: 6000 }),
    row({ operationId: "workspace/unapproved", jobId: "unapproved", title: "Copy edit", amountCents: 3000, approvalState: "not_approved", approvedAt: null, approvedBy: null, paymentStatus: "not_submitted", paymentStatusLabel: "Not submitted", paymentId: null, policyVersion: null, verificationState: "not_applicable", feeState: "not_applicable", needsApproval: true, isReadyToPay: false }),
    row({ operationId: "legacy/demo-waiting-1", source: "legacy_grid", workspaceId: null, workspaceName: null, jobId: "demo-waiting-1", title: null, recipient: "freelancer-2", amountCents: 100, recordOrigin: "seed", isDemonstration: true, providerEnvironment: "none", paymentStatus: "not_submitted", paymentStatusLabel: "Not submitted", paymentId: null, policyVersion: null, verificationState: "demonstration", feeState: "not_applicable", isReadyToPay: false }),
  ];
}

export function investigation(overrides: Partial<OperationsInvestigation> = {}): OperationsInvestigation {
  return {
    contractVersion: 1, investigationId: "inv_11111111-2222-4333-8444-555555555555", question: "Which payments need attention?", intent: "needs_attention",
    findings: [
      { id: "ambiguous-outcome", title: "Provider outcome is not known", detail: "unknown (Podcast edit), $19.00: reconcile.", severity: "critical", paymentIds: ["workspace/unknown"] },
      { id: "provider-failure", title: "PayPal reported a failed, blocked or returned payout", detail: "failed (Icon set), $13.00: FAILED.", severity: "critical", paymentIds: ["workspace/failed"] },
    ],
    paymentIds: ["workspace/unknown", "workspace/failed"], explanation: "2 payment record(s) need attention. This reports recorded state only.",
    dataTimestamp: "2026-11-10T12:00:00.000Z", dataVersion: "v-fixture", uncertainty: ["Fixture uncertainty statement."],
    suggestedGridAction: { type: "filter_payments", paymentIds: ["workspace/unknown", "workspace/failed"], label: "Needs attention" },
    source: "Deterministic ledger projection", readOnly: true,
    ...overrides,
  };
}

export function detail(base: PaymentOperationRow, overrides: Partial<PaymentOperationDetail> = {}): PaymentOperationDetail {
  return {
    generatedAt: "2026-11-10T12:00:00.000Z", sensitiveAccess: true, row: base,
    identity: { operationId: base.operationId, paymentId: base.paymentId, jobId: base.jobId, workspaceId: base.workspaceId, workspaceName: base.workspaceName, recipient: base.recipient, recipientEmail: "fixture-contractor@example.test", idempotencyKey: base.paymentId ? `settle-payment-${base.jobId}` : null },
    approval: { state: base.approvalState, approvedBy: base.approvedBy, approvedAt: base.approvedAt, expiresAt: null, policyVersion: base.policyVersion },
    provider: { environment: base.providerEnvironment, payoutBatchId: base.payoutBatchId, batchReferenceKind: base.batchReferenceKind, payoutItemId: base.payoutItemId, transactionId: base.transactionId, providerStatus: base.providerStatus, providerTimestamp: base.providerTimestamp },
    timestamps: base.approvedAt ? [{ key: "approved", label: "Owner approval", at: base.approvedAt }] : [],
    fees: { state: base.feeState, estimate: null, provider: null, consistent: null, explanation: "Fixture fee explanation." },
    reconciliation: { state: base.reconciliationState, lastReconciledAt: base.lastReconciledAt, reconciliationRunId: null, discrepancyCount: 0, discrepancies: [] },
    confirmation: null, executionRun: null,
    timeline: [
      { kind: "authorization", label: "Owner authorization", state: base.approvedAt ? "complete" : "missing", at: base.approvedAt, detail: "fixture" },
      { kind: "submission", label: "Payment submission", state: "missing", at: null, detail: "Not submitted" },
    ],
    audit: { access: "granted", note: "Ledger and workspace audit rows for this record, oldest first.", events: [{ source: "ledger", sequence: 1, at: "2026-11-09T09:00:00.000Z", actor: "owner", action: "payment_approved", from: null, to: "approved", note: null }] },
    providerEvents: [],
    ...overrides,
  };
}
