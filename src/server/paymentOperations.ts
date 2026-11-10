// Payment operations projection.
//
// One read-only row model for everything that looks at payments: the operations
// grid, the AG Studio workspace, the capacity widget and the investigation
// agent. Each of those used to be able to compute its own answer; they now read
// this one.
//
// Rules this module keeps:
//
// - It reads. It never writes to the ledger, the workspace store or a cache.
// - A row carries an identifier only when the record holds it. A seeded row has
//   no payment identity; a historical reference has a claimed batch and nothing
//   at item level; an accepted batch has a batch id and no item id yet.
// - Money comes from the ledger. The capacity block copies the financial
//   report's figures instead of recomputing them.
// - Demonstration records (seed, synthetic) are counted apart from operational
//   records and are never added to an operational amount.
import { createHash } from "node:crypto";
import type { FinancialPayment, FinancialStore, PayoutItem } from "./financialStore.ts";
import type { FinancialReport } from "./financialReport.ts";
import type { Job } from "./jobs.ts";
import { AMBIGUOUS_STATES, IN_FLIGHT_STATES, type PaymentState } from "./paymentState.ts";
import type { ProductJob, ProductReceipt, Workspace } from "./productStore.ts";
import type { TransactionRecord } from "./transactionStore.ts";
import { deriveVerificationState } from "./verificationState.ts";
import type {
  BatchReferenceKind, ExceptionBucket, LedgerPaymentState, OperationApprovalState, OperationFeeState, OperationOrigin, OperationPaymentStatus,
  OperationReconciliationState, OperationSource, OperationVerificationState, OperationsCapacity, OperationsSnapshot,
  PaymentOperationFlag, PaymentOperationRow,
} from "../shared/operations.ts";

export type {
  BatchReferenceKind, ExceptionBucket, OperationApprovalState, OperationEnvironment, OperationFeeState, OperationOrigin,
  OperationPaymentStatus, OperationReconciliationState, OperationSource, OperationVerificationState, OperationsCapacity,
  OperationsSnapshot, PaymentOperationFlag, PaymentOperationRow,
} from "../shared/operations.ts";

export interface OperationsInput {
  at: string;
  legacyJobs: Job[];
  /** Only workspaces the requester may see. The caller applies the access rule. */
  workspaces: Array<{ workspace: Workspace; jobs: ProductJob[]; receipts: ProductReceipt[] }>;
  financial: FinancialStore;
  transactions: TransactionRecord[];
  report: FinancialReport;
  signedIn: boolean;
  approvalExpiryMs: number;
}

export const DUE_SOON_DAYS = 3;

// Compile-time proof that the shared contract lists exactly the ledger's payment states.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const ledgerStatesMatch: Same<LedgerPaymentState, PaymentState> = true;
void ledgerStatesMatch;

const PAYMENT_STATUS_LABELS: Record<OperationPaymentStatus, string> = {
  not_submitted: "Not submitted",
  held: "Held for owner",
  refused: "Refused by policy",
  historical_reference: "Historical reference",
  unverified_legacy_status: "Recorded without ledger evidence",
  approved: "Approved, not sent",
  reserved: "Reserved",
  submitted: "Submitted",
  awaiting_confirmation: "Awaiting confirmation",
  pending: "Pending at PayPal",
  unclaimed: "Unclaimed",
  onhold: "On hold at PayPal",
  provider_confirmed: "Confirmed by PayPal",
  failed: "Failed",
  blocked: "Blocked by PayPal",
  returned: "Returned",
  reversed: "Reversed",
  refunded: "Refunded",
  outcome_unknown: "Outcome unknown",
  reconciliation_required: "Reconciliation required",
};

export function paymentStatusLabel(status: OperationPaymentStatus): string {
  return PAYMENT_STATUS_LABELS[status];
}

const SETTLED_BADLY: ReadonlySet<string> = new Set(["failed", "blocked", "returned", "reversed", "refunded"]);
const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

interface Obligation {
  operationId: string;
  source: OperationSource;
  workspaceId: string | null;
  workspaceName: string | null;
  jobId: string | null;
  title: string | null;
  recipient: string;
  amountCents: number;
  currency: string;
  dueDate: string | null;
  priority: "high" | "normal" | "low" | null;
  origin: OperationOrigin;
  approved: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  /** Status of a record that has no ledger identity. */
  bareStatus: OperationPaymentStatus;
  claimedBatchId: string | null;
  reason: string | null;
  updatedAt: string | null;
}

function isoFromMs(ms: number | null | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function latest(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) { best = new Date(ms).toISOString(); bestMs = ms; }
  }
  return best;
}

/** Whole UTC days between the snapshot date and a `YYYY-MM-DD` (or ISO) due date. */
export function daysUntil(dueDate: string | null, at: string): number | null {
  if (!dueDate) return null;
  const due = Date.parse(dueDate.length === 10 ? `${dueDate}T00:00:00.000Z` : dueDate);
  if (!Number.isFinite(due)) return null;
  const now = new Date(at);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueDay = new Date(due);
  return Math.round((Date.UTC(dueDay.getUTCFullYear(), dueDay.getUTCMonth(), dueDay.getUTCDate()) - today) / 86_400_000);
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function legacyBareStatus(job: Job): OperationPaymentStatus {
  switch (job.status) {
    case "historical_reference": return "historical_reference";
    case "waiting_for_meera": return "held";
    case "blocked": return "refused";
    case "waiting": return "not_submitted";
    default: return "unverified_legacy_status";
  }
}

function legacyObligation(job: Job): Obligation {
  const origin: OperationOrigin = job.origin === "seed" ? "seed" : "application";
  return {
    operationId: `legacy/${job.job_id}`,
    source: "legacy_grid",
    workspaceId: null,
    workspaceName: null,
    jobId: job.job_id,
    title: null,
    recipient: job.freelancer_id,
    amountCents: job.amount_cents,
    currency: job.currency,
    dueDate: job.due ?? null,
    priority: job.priority ?? null,
    origin,
    approved: job.approval_state === "approved",
    approvedAt: isoFromMs(job.approved_at),
    approvedBy: null,
    bareStatus: legacyBareStatus(job),
    claimedBatchId: job.payout_batch_id,
    reason: job.decision_reason,
    updatedAt: isoFromMs(job.approved_at),
  };
}

function workspaceOrigin(origin: string): OperationOrigin {
  return origin === "synthetic" ? "synthetic" : origin === "seed" ? "seed" : "application";
}

function workspaceObligation(workspace: Workspace, job: ProductJob): Obligation {
  return {
    operationId: `workspace/${job.jobId}`,
    source: "workspace",
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.name,
    jobId: job.jobId,
    title: job.title,
    recipient: job.recipientName,
    amountCents: job.amountCents,
    currency: job.currency,
    dueDate: job.dueAt ? job.dueAt.slice(0, 10) : null,
    priority: job.priority,
    origin: workspaceOrigin(job.origin),
    approved: job.approvalState === "approved",
    approvedAt: job.approvedAt,
    approvedBy: job.approvedBy,
    bareStatus: "not_submitted",
    claimedBatchId: null,
    reason: null,
    updatedAt: job.updatedAt,
  };
}

/** A receipt with no job: the workspace's record of a past payout it did not make itself. */
function receiptObligation(workspace: Workspace, receipt: ProductReceipt): Obligation {
  return {
    operationId: `receipt/${receipt.receiptId}`,
    source: "workspace",
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.name,
    jobId: null,
    title: receipt.title,
    recipient: receipt.recipientName,
    amountCents: receipt.amountCents,
    currency: receipt.currency,
    dueDate: null,
    priority: null,
    origin: workspaceOrigin(receipt.origin),
    approved: receipt.approvedAt !== null,
    approvedAt: receipt.approvedAt,
    approvedBy: receipt.approvedBy,
    bareStatus: receipt.verificationState === "historical_evidence_only" ? "historical_reference" : "not_submitted",
    claimedBatchId: receipt.payoutBatchId,
    reason: null,
    updatedAt: latest(receipt.ingestedAt, receipt.approvedAt),
  };
}

interface LedgerFacts {
  payment: FinancialPayment;
  item: PayoutItem | null;
  attemptBatchId: string | null;
  discrepancyCount: number;
  feeEstimateCents: number | null;
  providerFeeCents: number | null;
}

function buildRow(obligation: Obligation, ledger: LedgerFacts | null, ctx: { at: string; approvalExpiryMs: number; perPaymentCapCents: number; events: TransactionRecord[] }): PaymentOperationRow {
  const demonstration = obligation.origin !== "application";
  const payment = ledger?.payment ?? null;
  const item = ledger?.item ?? null;
  const paymentStatus: OperationPaymentStatus = payment ? (payment.status as PaymentState) : obligation.bareStatus;
  const historical = paymentStatus === "historical_reference";
  const settled = paymentStatus === "provider_confirmed";
  const settledBadly = SETTLED_BADLY.has(paymentStatus);
  const ambiguous = payment !== null && AMBIGUOUS_STATES.has(paymentStatus as PaymentState);
  const inFlight = payment !== null && (IN_FLIGHT_STATES.has(paymentStatus as PaymentState) || paymentStatus === "reserved");
  const sent = payment !== null && payment.status !== "approved" && payment.status !== "reserved";

  const approvedAt = payment?.approvedAt ?? obligation.approvedAt;
  const approvedBase = payment !== null || obligation.approved;
  const approvalAgeMs = approvedAt ? Date.parse(ctx.at) - Date.parse(approvedAt) : null;
  const notYetSent = payment === null ? !historical : payment.status === "approved";
  const expired = approvedBase && notYetSent && approvalAgeMs !== null && approvalAgeMs > ctx.approvalExpiryMs;
  const approvalState: OperationApprovalState = !approvedBase ? "not_approved" : expired ? "expired" : "approved";

  const payoutBatchId = item?.payoutBatchId ?? ledger?.attemptBatchId ?? (payment === null ? obligation.claimedBatchId : null);
  const batchReferenceKind: BatchReferenceKind | null = item ? "provider_item" : ledger?.attemptBatchId ? "provider_acknowledgement" : payoutBatchId ? "historical_claim" : null;

  let verificationState: OperationVerificationState;
  if (payment) {
    verificationState = deriveVerificationState({ paymentStatus: payment.status, hasProviderItem: item !== null, lastReconciledAt: item?.lastReconciledAt ?? null, discrepancyCount: ledger?.discrepancyCount ?? 0 });
  } else if (historical) verificationState = "historical_reference";
  else if (demonstration) verificationState = "demonstration";
  else if (paymentStatus === "unverified_legacy_status") verificationState = "unverified";
  else verificationState = "not_applicable";

  let reconciliationState: OperationReconciliationState = "not_applicable";
  if (payment) {
    if ((ledger?.discrepancyCount ?? 0) > 0) reconciliationState = "discrepancy";
    else if (item?.lastReconciledAt) reconciliationState = "reconciled";
    else if (ambiguous) reconciliationState = "required";
    else if (sent) reconciliationState = "not_reconciled";
  }

  const feeState: OperationFeeState = !payment ? "not_applicable"
    : ledger?.providerFeeCents !== null && ledger?.providerFeeCents !== undefined ? "provider_reported"
      : ledger?.feeEstimateCents !== null && ledger?.feeEstimateCents !== undefined ? "estimate_only" : "unavailable";

  const dueInDays = daysUntil(obligation.dueDate, ctx.at);
  const isPendingObligation = !historical && !settled && !settledBadly && paymentStatus !== "refused" && paymentStatus !== "unverified_legacy_status";
  const needsApproval = isPendingObligation && payment === null && approvalState !== "approved";
  const isUnreconciled = payment !== null && ((settled && !item?.lastReconciledAt) || ambiguous || (ledger?.discrepancyCount ?? 0) > 0);
  const isOverdue = isPendingObligation && dueInDays !== null && dueInDays < 0;
  const isDueSoon = isPendingObligation && dueInDays !== null && dueInDays <= DUE_SOON_DAYS;
  const overPerPaymentCap = isPendingObligation && !sent && !inFlight && obligation.amountCents > ctx.perPaymentCapCents;

  const evidenceGaps: string[] = [];
  if (historical) {
    evidenceGaps.push("No payout item ID is stored in this database for this record.", "No PayPal transaction ID is stored in this database for this record.", "This application has not independently re-read the cited batch from PayPal.");
  } else if (payment && sent) {
    if (!payoutBatchId) evidenceGaps.push("No PayPal batch ID was recorded for this submission.");
    if (payoutBatchId && !item) evidenceGaps.push("PayPal acknowledged the batch; no payout item outcome has been stored yet.");
    if (item && settled && !item.transactionId) evidenceGaps.push("The confirmed payout item carries no PayPal transaction ID.");
    if (settled && feeState !== "provider_reported") evidenceGaps.push("PayPal reported no fee for this item. The fee is unknown, not zero.");
    if (settled && !item?.lastReconciledAt) evidenceGaps.push("The confirmed item has not been independently re-read from PayPal.");
    if ((ledger?.discrepancyCount ?? 0) > 0) evidenceGaps.push(`${ledger?.discrepancyCount} unresolved reconciliation discrepancy record(s) reference this payment.`);
  }

  const blockedReason = payment?.failureReason ?? obligation.reason;
  const attentionReasons: string[] = [];
  if (paymentStatus === "failed") attentionReasons.push("PayPal reported this payout item as FAILED; no payment was confirmed.");
  if (paymentStatus === "blocked") attentionReasons.push("PayPal blocked this payout item.");
  if (paymentStatus === "returned" || paymentStatus === "reversed" || paymentStatus === "refunded") attentionReasons.push(`PayPal reported this payout as ${paymentStatus.toUpperCase()}.`);
  if (paymentStatus === "outcome_unknown") attentionReasons.push("The submission response was lost. Reconcile with PayPal before any retry; never resubmit blindly.");
  if (paymentStatus === "reconciliation_required") attentionReasons.push("Confirmation attempts are exhausted without a terminal outcome. Reconcile with PayPal.");
  if ((ledger?.discrepancyCount ?? 0) > 0) attentionReasons.push("A reconciliation discrepancy is recorded against this payment.");
  if (paymentStatus === "refused" || paymentStatus === "held") attentionReasons.push(blockedReason ? `Held before submission: ${blockedReason}` : "Held before submission by policy.");
  if (overPerPaymentCap && paymentStatus !== "held") attentionReasons.push(`The amount ${usd(obligation.amountCents)} exceeds the per-payment cap of ${usd(ctx.perPaymentCapCents)}.`);
  if (isOverdue) attentionReasons.push(`Overdue by ${Math.abs(dueInDays ?? 0)} day(s) and not settled.`);
  if (approvalState === "expired") attentionReasons.push("The owner approval has expired and must be renewed before payment.");

  const status = paymentStatus;
  return {
    operationId: obligation.operationId,
    source: obligation.source,
    workspaceId: obligation.workspaceId,
    workspaceName: obligation.workspaceName,
    jobId: obligation.jobId,
    title: obligation.title,
    recipient: obligation.recipient,
    amountCents: obligation.amountCents,
    currency: obligation.currency,
    dueDate: obligation.dueDate,
    dueInDays,
    priority: obligation.priority,
    recordOrigin: obligation.origin,
    isDemonstration: demonstration,
    providerEnvironment: demonstration ? (historical ? "sandbox" : "none") : "sandbox",
    approvalState,
    approvedAt: approvedBase ? approvedAt : null,
    approvedBy: payment?.approvedBy ?? obligation.approvedBy,
    paymentStatus: status,
    paymentStatusLabel: PAYMENT_STATUS_LABELS[status],
    paymentId: payment?.paymentId ?? null,
    policyVersion: payment?.policyVersion ?? null,
    payoutBatchId,
    batchReferenceKind,
    payoutItemId: item?.payoutItemId ?? null,
    transactionId: item?.transactionId ?? null,
    providerStatus: item?.status ?? null,
    providerTimestamp: item?.providerTimestamp ?? null,
    submittedAt: payment?.submittedAt ?? null,
    confirmedAt: payment?.confirmedAt ?? null,
    verificationState,
    reconciliationState,
    lastReconciledAt: item?.lastReconciledAt ?? null,
    feeState,
    feeEstimateCents: ledger?.feeEstimateCents ?? null,
    providerFeeCents: ledger?.providerFeeCents ?? null,
    executionRunId: payment?.executionRunId ?? null,
    lastUpdatedAt: latest(obligation.updatedAt, approvedAt, payment?.reservedAt, payment?.submittedAt, payment?.confirmedAt, item?.providerTimestamp, item?.ingestedAt, item?.lastReconciledAt),
    providerEventCount: ctx.events.length,
    providerEventKeys: ctx.events.map((event) => event.rowKey),
    blockedReason,
    needsApproval,
    isPendingObligation,
    isReadyToPay: false,
    isInFlight: inFlight,
    isUnreconciled,
    isDueSoon,
    isOverdue,
    cannotPayWithinBudget: overPerPaymentCap,
    budgetReason: overPerPaymentCap ? `${usd(obligation.amountCents)} exceeds the per-payment cap of ${usd(ctx.perPaymentCapCents)}.` : null,
    hasIncompleteEvidence: evidenceGaps.length > 0,
    evidenceGaps,
    needsAttention: attentionReasons.length > 0,
    attentionReasons,
  };
}

function bucket(rows: PaymentOperationRow[], flag: PaymentOperationFlag, label: string, definition: string): ExceptionBucket {
  const flagged = rows.filter((row) => row[flag]);
  const total = (list: PaymentOperationRow[]) => ({ count: list.length, amountCents: list.reduce((sum, row) => sum + row.amountCents, 0) });
  return {
    flag,
    label,
    definition,
    operationIds: flagged.map((row) => row.operationId),
    operational: total(flagged.filter((row) => !row.isDemonstration)),
    demonstration: total(flagged.filter((row) => row.isDemonstration)),
  };
}

/** Collect the ledger facts for one job, with reads only. */
function ledgerFacts(financial: FinancialStore, jobId: string | null, discrepancyCounts: Map<string, number>): LedgerFacts | null {
  if (jobId === null) return null;
  const payment = financial.getPaymentByJob(jobId);
  if (!payment) return null;
  const item = financial.getPayoutItem(payment.paymentId);
  const fees = financial.getFeeRecord(payment.paymentId);
  return {
    payment,
    item,
    attemptBatchId: financial.getAttemptBatchId(payment.paymentId),
    discrepancyCount: discrepancyCounts.get(payment.paymentId) ?? 0,
    feeEstimateCents: fees.estimate?.estimatedFeeMinor ?? null,
    providerFeeCents: fees.provider?.reportedFeeMinor ?? null,
  };
}

export function buildPaymentOperations(input: OperationsInput): OperationsSnapshot {
  const { financial, report } = input;
  const policy = financial.getPolicy();
  const discrepancyCounts = new Map<string, number>();
  for (const row of financial.getDiscrepancies()) {
    if (typeof row.payment_id === "string") discrepancyCounts.set(row.payment_id, (discrepancyCounts.get(row.payment_id) ?? 0) + 1);
  }

  const obligations: Obligation[] = input.legacyJobs.map(legacyObligation);
  for (const entry of input.workspaces) {
    for (const job of entry.jobs) obligations.push(workspaceObligation(entry.workspace, job));
    for (const receipt of entry.receipts) if (receipt.jobId === null) obligations.push(receiptObligation(entry.workspace, receipt));
  }

  const linkedEventKeys = new Set<string>();
  const rows = obligations.map((obligation) => {
    const ledger = ledgerFacts(financial, obligation.jobId, discrepancyCounts);
    const itemId = ledger?.item?.payoutItemId ?? null;
    const events = input.transactions.filter((event) =>
      (obligation.jobId !== null && event.jobId === obligation.jobId)
      || (itemId !== null && (event.payoutItemId === itemId || event.rowKey === itemId)));
    for (const event of events) linkedEventKeys.add(event.rowKey);
    return buildRow(obligation, ledger, { at: input.at, approvalExpiryMs: input.approvalExpiryMs, perPaymentCapCents: policy.perPaymentCapCents, events });
  });

  // Budget fit for operational work the owner has approved but not yet sent:
  // highest priority first, then soonest due, drawn from what the ledger says is left.
  let remaining = report.cap.remainingCents;
  const queue = rows
    .filter((row) => !row.isDemonstration && row.paymentStatus === "approved" && row.approvalState === "approved")
    .sort((a, b) => (PRIORITY_RANK[a.priority ?? ""] ?? 3) - (PRIORITY_RANK[b.priority ?? ""] ?? 3)
      || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
      || a.amountCents - b.amountCents
      || a.operationId.localeCompare(b.operationId));
  for (const row of queue) {
    if (row.cannotPayWithinBudget) continue;
    if (row.amountCents <= remaining) {
      remaining -= row.amountCents;
      row.isReadyToPay = true;
    } else {
      row.cannotPayWithinBudget = true;
      row.budgetReason = `${usd(row.amountCents)} does not fit the remaining rolling capacity: ${usd(remaining)} is left after higher-priority approved work.`;
    }
  }

  rows.sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention)
    || (a.dueInDays ?? Number.MAX_SAFE_INTEGER) - (b.dueInDays ?? Number.MAX_SAFE_INTEGER)
    || a.operationId.localeCompare(b.operationId));

  const windowHours = Math.round((Date.parse(report.cap.windowEnd) - Date.parse(report.cap.windowStart)) / 3_600_000);
  const capacity: OperationsCapacity = {
    currency: "USD",
    budgetCents: policy.capCents,
    perPaymentCapCents: policy.perPaymentCapCents,
    windowHours,
    windowStart: report.cap.windowStart,
    windowEnd: report.cap.windowEnd,
    rollingSpendCents: report.metrics.rollingWindowSpend.value,
    activeExposureCents: report.cap.activeReservationsCents,
    awaitingConfirmationCents: report.metrics.awaitingConfirmation.value,
    remainingCents: report.cap.remainingCents,
    fresh: report.cap.fresh,
    freshnessSeconds: policy.freshnessSeconds,
    lastSuccessfulReconciliation: report.cap.lastSuccessfulReconciliation,
    policyVersion: report.cap.policyVersion,
    emergencyStop: financial.isEmergencyStopped(),
    formula: "remaining = budget − rolling expenditure − active exposure, never below zero",
    definitions: {
      budget: `The owner's rolling cap for any ${windowHours}-hour window (policy version ${report.cap.policyVersion}).`,
      rollingSpend: report.metrics.rollingWindowSpend.definition,
      activeExposure: "Approved amounts the ledger currently holds against the cap: payments in reserved, submitted, outcome unknown, pending, unclaimed or on hold.",
      awaitingConfirmation: report.metrics.awaitingConfirmation.definition,
      remaining: "What the ledger will still allow inside the cap: the budget minus rolling expenditure minus active exposure. New reservations are refused beyond it.",
      perPaymentCap: "The largest single payment the owner policy allows.",
    },
    source: report.source,
  };

  const exceptions: OperationsSnapshot["exceptions"] = {
    awaitingApproval: bucket(rows, "needsApproval", "Awaiting approval", "Obligations that are still owed and have no valid owner approval: never approved, or approved longer ago than the approval lifetime."),
    pendingObligations: bucket(rows, "isPendingObligation", "Pending obligations", "Obligations that are still owed or in flight: not confirmed by PayPal, not failed, returned or refused, and not a historical reference."),
    unreconciled: bucket(rows, "isUnreconciled", "Unreconciled", "Ledger payments whose provider outcome has not been independently re-read: confirmed but never reconciled, outcome unknown, reconciliation required, or carrying a discrepancy."),
    needsAttention: bucket(rows, "needsAttention", "Needs attention", "Records with a failed, blocked, returned, unknown or disputed provider outcome, a policy hold, an expired approval, or an overdue unpaid obligation."),
    dueSoon: bucket(rows, "isDueSoon", "Due soon", `Pending obligations that are overdue or due within ${DUE_SOON_DAYS} days of the snapshot date.`),
    cannotPayWithinBudget: bucket(rows, "cannotPayWithinBudget", "Outside budget", "Pending obligations that exceed the per-payment cap, or approved work that does not fit the remaining rolling capacity after higher-priority approved work."),
    incompleteEvidence: bucket(rows, "hasIncompleteEvidence", "Incomplete provider evidence", "Records that cite or expect PayPal evidence this database does not fully hold: a missing batch, item or transaction identifier, an unreported fee, or no independent re-read."),
  };

  const signedIn = input.signedIn;
  const operationalVisible = input.workspaces.some((entry) => entry.workspace.kind === "operational");
  const dataVersion = createHash("sha256")
    .update(JSON.stringify({ rows, capacity: { ...capacity, windowStart: undefined, windowEnd: undefined } }))
    .digest("hex").slice(0, 16);

  return {
    generatedAt: input.at,
    dataVersion,
    access: {
      signedIn,
      scope: signedIn && operationalVisible ? "owner" : "public",
      workspaces: input.workspaces.map((entry) => ({ workspaceId: entry.workspace.workspaceId, name: entry.workspace.name, kind: entry.workspace.kind })),
      note: signedIn && operationalVisible
        ? "Signed in as the workspace owner: operational obligations and their ledger payments are included."
        : "Public view: demonstration records only. Sign in to the operational workspace to include its obligations and ledger payments.",
    },
    provider: { environment: "sandbox", configured: report.environment.configured, connected: report.environment.connected, note: report.environment.note },
    rows,
    capacity,
    exceptions,
    providerEvents: { total: input.transactions.length, linked: linkedEventKeys.size, unlinked: input.transactions.length - linkedEventKeys.size },
    sources: [
      report.source,
      "Obligations: legacy demonstration grid (data/seed.json) and the product workspace store",
      "Verified provider events: persisted, postback-verified PayPal webhook events",
    ],
  };
}
