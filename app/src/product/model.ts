// Derived views over the operations projection.
//
// The server's row model is the authority. This file only groups, sorts and
// words what the server already said. It never invents a status, a total or a
// reason: a row that the server has not classified stays unclassified here.
//
// One rule runs through every function: demonstration records are separated
// from operational ones and are never added to an operational amount.
import type { OperationsSnapshot, PaymentOperationRow } from "../operations/contract.ts";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "selected";

/** Rows the studio actually owns. Demonstration records are excluded. */
export function operationalRows(operations: OperationsSnapshot | null): PaymentOperationRow[] {
  return (operations?.rows ?? []).filter((row) => !row.isDemonstration);
}

/** Demonstration and historical rows, kept apart from the operational set. */
export function demonstrationRows(operations: OperationsSnapshot | null): PaymentOperationRow[] {
  return (operations?.rows ?? []).filter((row) => row.isDemonstration);
}

/** Ledger states where the provider holds the payment but has not settled it. */
export const IN_FLIGHT = new Set(["reserved", "submitted", "awaiting_confirmation", "pending", "onhold"]);
/** Ledger states where the outcome is not known and must not be retried blindly. */
export const AMBIGUOUS = new Set(["outcome_unknown", "reconciliation_required"]);

export function isInFlight(row: PaymentOperationRow): boolean {
  return IN_FLIGHT.has(row.paymentStatus);
}

export function isAmbiguous(row: PaymentOperationRow): boolean {
  return AMBIGUOUS.has(row.paymentStatus);
}

/** Approved by the owner and still waiting to be sent. */
export function isReadyWithinPolicy(row: PaymentOperationRow): boolean {
  return row.approvalState === "approved" && row.paymentStatus === "approved" && !row.cannotPayWithinBudget;
}

export function isAwaitingApproval(row: PaymentOperationRow): boolean {
  return row.needsApproval;
}

export function isAwaitingProvider(row: PaymentOperationRow): boolean {
  return isInFlight(row);
}

/** The words a row's payment state is shown with. Never a colour on its own. */
export function statusTone(row: PaymentOperationRow): Tone {
  switch (row.paymentStatus) {
    case "provider_confirmed": return "success";
    case "failed": case "blocked": case "returned": case "reversed": case "refunded": return "danger";
    case "outcome_unknown": case "reconciliation_required": return "danger";
    case "awaiting_confirmation": case "pending": case "onhold": case "unclaimed": case "held": case "refused": return "warning";
    case "approved": case "reserved": case "submitted": return "info";
    case "historical_reference": return "info";
    default: return "neutral";
  }
}

export function verificationTone(row: PaymentOperationRow): Tone {
  switch (row.verificationState) {
    case "reconciled": case "provider_confirmed": return "success";
    case "discrepancy_detected": case "verification_unavailable": return "danger";
    case "provider_response_received": return "warning";
    case "historical_reference": return "info";
    default: return "neutral";
  }
}

/**
 * The words a row's verification state is shown with.
 *
 * The state names what has been proven, never what might have happened: a
 * provider acknowledgement reads as an acknowledgement, and an unknown fee or
 * an unavailable verification reads as unknown.
 */
const VERIFICATION_LABELS: Record<PaymentOperationRow["verificationState"], string> = {
  demonstration: "Demonstration",
  historical_reference: "Historical reference",
  not_applicable: "Nothing to verify yet",
  unverified: "Unverified",
  provider_response_received: "Provider response received",
  provider_confirmed: "Confirmed by PayPal",
  reconciled: "Reconciled",
  discrepancy_detected: "Discrepancy detected",
  verification_unavailable: "Verification unavailable",
};

export function verificationLabel(row: PaymentOperationRow): string {
  return VERIFICATION_LABELS[row.verificationState];
}

/** The words a row's reconciliation state is shown with. */
const RECONCILIATION_LABELS: Record<PaymentOperationRow["reconciliationState"], string> = {
  not_applicable: "Not applicable",
  not_reconciled: "Not reconciled",
  reconciled: "Reconciled",
  required: "Reconciliation required",
  discrepancy: "Discrepancy",
};

export function reconciliationLabel(row: PaymentOperationRow): string {
  return RECONCILIATION_LABELS[row.reconciliationState];
}

/** The words a row's fee state is shown with. A missing fee is unknown, not zero. */
const FEE_LABELS: Record<PaymentOperationRow["feeState"], string> = {
  not_applicable: "Not applicable",
  unavailable: "Unavailable, not zero",
  estimate_only: "Estimate only",
  provider_reported: "Reported by PayPal",
};

export function feeLabel(row: PaymentOperationRow): string {
  return FEE_LABELS[row.feeState];
}

export function approvalTone(row: PaymentOperationRow): Tone {
  switch (row.approvalState) {
    case "approved": return "success";
    case "expired": return "danger";
    default: return "warning";
  }
}

/** The one phrase that says what a record is, in full. */
export function recordLabel(row: PaymentOperationRow): string {
  if (row.title) return row.title;
  if (row.jobId) return row.jobId;
  return row.operationId;
}

export function originLabel(origin: PaymentOperationRow["recordOrigin"]): string {
  switch (origin) {
    case "application": return "Application record";
    case "seed": return "Seed data";
    default: return "Synthetic demonstration";
  }
}

/** Sort rows by a named order. The order is stable and documented on screen. */
export type SortKey = "attention" | "due" | "amount" | "priority" | "updated";

export function sortRows(rows: PaymentOperationRow[], key: SortKey): PaymentOperationRow[] {
  const priorityRank: Record<string, number> = { high: 0, normal: 1, low: 2 };
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (key) {
      case "amount": return b.amountCents - a.amountCents || a.operationId.localeCompare(b.operationId);
      case "due": return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || a.operationId.localeCompare(b.operationId);
      case "priority": return (priorityRank[a.priority ?? "normal"] ?? 3) - (priorityRank[b.priority ?? "normal"] ?? 3) || a.operationId.localeCompare(b.operationId);
      case "updated": return (b.lastUpdatedAt ?? "").localeCompare(a.lastUpdatedAt ?? "") || a.operationId.localeCompare(b.operationId);
      default: return Number(b.needsAttention) - Number(a.needsAttention) || (a.dueInDays ?? Number.MAX_SAFE_INTEGER) - (b.dueInDays ?? Number.MAX_SAFE_INTEGER) || a.operationId.localeCompare(b.operationId);
    }
  });
  return copy;
}

/** The workspace's own obligations, without the legacy demonstration grid. */
export function workspaceRows(operations: OperationsSnapshot | null, workspaceId: string | null): PaymentOperationRow[] {
  if (workspaceId === null) return [];
  return (operations?.rows ?? []).filter((row) => row.workspaceId === workspaceId);
}

/** Count and amount of a set of rows, split by record class. */
export function totals(rows: PaymentOperationRow[]): { count: number; amountCents: number } {
  return { count: rows.length, amountCents: rows.reduce((sum, row) => sum + row.amountCents, 0) };
}
