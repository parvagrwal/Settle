// Payment investigation view: everything the stores hold about one record.
//
// Read-only. Fields the record does not support are null, never a placeholder
// value. Anything the existing API already restricts to the owner (the ledger
// audit trail, discrepancy details, recipient email, idempotency identity) is
// returned only when the caller proved ownership, and the response says when
// something was withheld so an empty audit list is never mistaken for "no
// history".
import type { AuditRow } from "./audit.ts";
import type { FinancialStore } from "./financialStore.ts";
import type { OperationAuditEvent, PaymentOperationDetail, PaymentOperationRow } from "../shared/operations.ts";
import type { TransactionRecord } from "./transactionStore.ts";

export type { OperationAuditEvent, PaymentOperationDetail, TimelineState } from "../shared/operations.ts";

type StoreRow = Record<string, unknown>;

function compactState(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    return JSON.stringify(parsed).slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

export function buildPaymentOperationDetail(input: {
  at: string;
  row: PaymentOperationRow;
  financial: FinancialStore;
  /** True only when the caller proved ownership (owner token or owner session). */
  sensitive: boolean;
  approvalExpiryMs: number;
  recipientEmail: string | null;
  workspaceAudit: StoreRow[];
  legacyAudit: AuditRow[];
  transactions: TransactionRecord[];
}): PaymentOperationDetail {
  const { row, financial, sensitive } = input;
  const payment = row.jobId !== null && row.paymentId !== null ? financial.getPaymentByJob(row.jobId) : null;
  const item = payment ? financial.getPayoutItem(payment.paymentId) : null;
  const demonstration = row.isDemonstration;
  const historical = row.paymentStatus === "historical_reference";

  const timestamps: PaymentOperationDetail["timestamps"] = [];
  const stamp = (key: string, label: string, at: string | null | undefined) => { if (at) timestamps.push({ key, label, at }); };
  stamp("approved", "Owner approval", row.approvedAt);
  stamp("reserved", "Budget reserved", payment?.reservedAt);
  stamp("submitted", "Submitted to PayPal", row.submittedAt);
  stamp("provider", "Provider outcome", row.providerTimestamp);
  stamp("confirmed", "Confirmed", row.confirmedAt);
  stamp("ingested", "Evidence stored", item?.ingestedAt);
  stamp("reconciled", "Last independent re-read", row.lastReconciledAt);

  let fees: PaymentOperationDetail["fees"];
  if (payment) {
    const record = financial.getFeeRecord(payment.paymentId);
    fees = {
      state: row.feeState,
      estimate: record.estimate ? { estimatedFeeMinor: record.estimate.estimatedFeeMinor, currency: record.estimate.currency, policyId: record.estimate.policyId, policyVersion: record.estimate.policyVersion, formula: record.estimate.formula, sourceUrl: record.estimate.sourceUrl } : null,
      provider: record.provider ? { reportedFeeMinor: record.provider.reportedFeeMinor, currency: record.provider.currency, source: record.provider.source, isProviderEstimate: record.provider.isProviderEstimate, observedAt: record.provider.observedAt } : null,
      consistent: record.consistent,
      explanation: record.explanation,
    };
  } else {
    fees = { state: "not_applicable", estimate: null, provider: null, consistent: null, explanation: "No ledger payment exists for this record, so there is no fee estimate and no provider-reported fee." };
  }

  const discrepancyRows = payment ? financial.getDiscrepancies().filter((entry) => entry.payment_id === payment.paymentId) : [];
  const run = payment?.executionRunId ? financial.getExecutionRun(payment.executionRunId) : null;
  const confirmation = payment ? financial.getConfirmationState(payment.paymentId) : null;

  const none = demonstration && !historical ? "not_applicable" as const : "missing" as const;
  const kept = historical ? "historical" as const : "complete" as const;
  const timeline: PaymentOperationDetail["timeline"] = [
    { kind: "authorization", label: "Owner authorization", state: row.approvedAt ? kept : none, at: row.approvedAt, detail: row.approvedAt ? `Approved${row.approvedBy ? ` by ${row.approvedBy}` : ""}${row.approvalState === "expired" ? " (now expired)" : ""}` : demonstration ? "Demonstration record without an owner approval" : "No owner authorization recorded" },
    { kind: "submission", label: "Payment submission", state: row.submittedAt ? "complete" : none, at: row.submittedAt, detail: row.submittedAt ? "Submitted by Settle" : demonstration ? "Demonstration records are never submitted to PayPal" : "Not submitted" },
    { kind: "provider_acknowledgement", label: "Provider acknowledgement", state: row.payoutBatchId ? (row.batchReferenceKind === "historical_claim" ? "historical" : "complete") : none, at: null, detail: row.payoutBatchId ? `${row.batchReferenceKind === "historical_claim" ? "Cited batch" : "PayPal batch"} ${row.payoutBatchId}` : "No PayPal batch ID recorded" },
    { kind: "item_outcome", label: "Payout item outcome", state: row.providerStatus ? "complete" : none, at: row.providerTimestamp, detail: row.providerStatus ? `${row.providerStatus}${row.payoutItemId ? ` · item ${row.payoutItemId}` : ""}` : "No item-level provider outcome stored" },
    { kind: "transaction", label: "Transaction evidence", state: row.transactionId ? "complete" : none, at: row.transactionId ? row.providerTimestamp : null, detail: row.transactionId ?? "No PayPal transaction ID stored" },
    { kind: "reconciliation", label: "Independent reconciliation", state: row.lastReconciledAt ? "complete" : none, at: row.lastReconciledAt, detail: row.lastReconciledAt ? `Re-read in run ${item?.reconciliationRunId ?? "unknown"}` : historical ? "Historical reference only; this application has not re-read it" : "Not independently reconciled" },
  ];

  const events: OperationAuditEvent[] = input.legacyAudit
    .filter((entry) => row.source === "legacy_grid" && entry.job_id === row.jobId)
    .map((entry, index) => ({ source: "legacy_decision" as const, sequence: index + 1, at: new Date(entry.at).toISOString(), actor: entry.actor, action: entry.action, from: null, to: null, note: entry.reason }));
  const protectedAudit = payment !== null || (row.source === "workspace" && !demonstration);
  const access: PaymentOperationDetail["audit"]["access"] = !protectedAudit ? "not_applicable" : sensitive ? "granted" : "owner_required";
  if (access === "granted") {
    if (payment) {
      for (const entry of financial.getAudit()) {
        if (entry.resource_id !== payment.paymentId && !(item && entry.correlation_id === item.payoutItemId)) continue;
        events.push({ source: "ledger", sequence: Number(entry.sequence), at: String(entry.at), actor: `${String(entry.actor_role)}${entry.actor_id && entry.actor_id !== entry.actor_role ? ` · ${String(entry.actor_id)}` : ""}`, action: String(entry.action), from: compactState(entry.previous_state), to: compactState(entry.new_state), note: null });
      }
    }
    for (const entry of input.workspaceAudit) {
      if (entry.resource_id !== row.jobId && !(payment && entry.resource_id === payment.paymentId)) continue;
      events.push({ source: "workspace", sequence: Number(entry.sequence), at: String(entry.at), actor: String(entry.actor_id), action: String(entry.action), from: null, to: null, note: typeof entry.reason === "string" ? entry.reason : null });
    }
  }
  const sourceOrder = { workspace: 0, legacy_decision: 1, ledger: 2 };
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || sourceOrder[a.source] - sourceOrder[b.source] || a.sequence - b.sequence);

  return {
    generatedAt: input.at,
    sensitiveAccess: sensitive,
    row,
    identity: {
      operationId: row.operationId,
      paymentId: row.paymentId,
      jobId: row.jobId,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      recipient: row.recipient,
      recipientEmail: sensitive ? input.recipientEmail : null,
      idempotencyKey: sensitive ? payment?.idempotencyKey ?? null : null,
    },
    approval: {
      state: row.approvalState,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      expiresAt: row.approvedAt && !row.submittedAt && !historical ? new Date(Date.parse(row.approvedAt) + input.approvalExpiryMs).toISOString() : null,
      policyVersion: row.policyVersion,
    },
    provider: {
      environment: row.providerEnvironment,
      payoutBatchId: row.payoutBatchId,
      batchReferenceKind: row.batchReferenceKind,
      payoutItemId: row.payoutItemId,
      transactionId: row.transactionId,
      providerStatus: row.providerStatus,
      providerTimestamp: row.providerTimestamp,
    },
    timestamps,
    fees,
    reconciliation: {
      state: row.reconciliationState,
      lastReconciledAt: row.lastReconciledAt,
      reconciliationRunId: item?.reconciliationRunId ?? null,
      discrepancyCount: discrepancyRows.length,
      discrepancies: sensitive ? discrepancyRows.map((entry) => ({ type: String(entry.type), detectedAt: String(entry.detected_at), details: compactState(entry.details_json) })) : [],
    },
    confirmation: confirmation ? { state: confirmation.state, attemptCount: confirmation.attemptCount, nextAttemptAt: confirmation.nextAttemptAt, lastError: confirmation.lastError } : null,
    executionRun: run ? { runId: run.runId, kind: run.kind, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, itemCount: run.items.length } : null,
    timeline,
    audit: {
      access,
      note: access === "granted" ? "Ledger and workspace audit rows for this record, oldest first."
        : access === "owner_required" ? "This record has a ledger audit trail. It is shown only to the owner: sign in to the operational workspace or enter the owner token."
          : "This record has no ledger payment, so there is no ledger audit trail.",
      events,
    },
    providerEvents: input.transactions
      .filter((event) => row.providerEventKeys.includes(event.rowKey))
      .map((event) => ({ rowKey: event.rowKey, status: event.status, latestEventId: event.latestEventId, eventCreatedAt: event.eventCreatedAt, eventReceivedAt: event.eventReceivedAt })),
  };
}
