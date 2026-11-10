// View model: the one place a ledger row becomes display text.
//
// The operations grid, the Studio data source and the capacity widget all read
// these values. A label, a due window or a money format is therefore computed
// once, and a Studio selection can be mirrored onto a grid column because both
// carry the same strings.
import type { AgFieldDefinition } from "ag-studio";
import type { PaymentOperationRow } from "./contract.ts";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatCents(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "Not reported" : USD.format(cents / 100);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "No date";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

export function recordName(row: Pick<PaymentOperationRow, "title" | "jobId" | "operationId">): string {
  return row.title ?? row.jobId ?? row.operationId;
}

export type DueWindow = "Overdue" | "Due within 3 days" | "Due later" | "No due date" | "Not pending";

export function dueWindow(row: Pick<PaymentOperationRow, "isPendingObligation" | "dueInDays">): DueWindow {
  if (!row.isPendingObligation) return "Not pending";
  if (row.dueInDays === null) return "No due date";
  if (row.dueInDays < 0) return "Overdue";
  return row.dueInDays <= 3 ? "Due within 3 days" : "Due later";
}

export function dueText(row: Pick<PaymentOperationRow, "dueDate" | "dueInDays">): string {
  if (!row.dueDate || row.dueInDays === null) return "No due date";
  const when = row.dueInDays === 0 ? "today" : row.dueInDays > 0 ? `in ${row.dueInDays} day${row.dueInDays === 1 ? "" : "s"}` : `${Math.abs(row.dueInDays)} day${row.dueInDays === -1 ? "" : "s"} overdue`;
  return `${formatDate(row.dueDate)} · ${when}`;
}

const APPROVAL_LABELS = { approved: "Approved", not_approved: "Not approved", expired: "Approval expired" } as const;
const VERIFICATION_LABELS = {
  demonstration: "Demonstration", historical_reference: "Historical reference", not_applicable: "Nothing to verify yet", unverified: "Unverified",
  provider_response_received: "Provider response received", provider_confirmed: "Confirmed by PayPal", reconciled: "Reconciled",
  discrepancy_detected: "Discrepancy detected", verification_unavailable: "Verification unavailable",
} as const;
const RECONCILIATION_LABELS = { not_applicable: "Not applicable", not_reconciled: "Not reconciled", reconciled: "Reconciled", required: "Reconciliation required", discrepancy: "Discrepancy" } as const;
const ENVIRONMENT_LABELS = { none: "Not sent", sandbox: "PayPal Sandbox" } as const;
const ORIGIN_LABELS = { seed: "Seed data", synthetic: "Synthetic demonstration", application: "Application record" } as const;
const FEE_LABELS = { not_applicable: "Not applicable", unavailable: "Unavailable, not zero", estimate_only: "Estimate only", provider_reported: "Reported by PayPal" } as const;

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const STATUS_TONES: Record<PaymentOperationRow["paymentStatus"], Tone> = {
  not_submitted: "neutral", held: "warning", refused: "danger", historical_reference: "info", unverified_legacy_status: "warning",
  approved: "info", reserved: "info", submitted: "info", awaiting_confirmation: "warning", pending: "warning", unclaimed: "warning", onhold: "warning",
  provider_confirmed: "success", failed: "danger", blocked: "danger", returned: "danger", reversed: "danger", refunded: "danger",
  outcome_unknown: "danger", reconciliation_required: "danger",
};
const VERIFICATION_TONES: Record<PaymentOperationRow["verificationState"], Tone> = {
  demonstration: "neutral", historical_reference: "info", not_applicable: "neutral", unverified: "neutral", provider_response_received: "warning",
  provider_confirmed: "success", reconciled: "success", discrepancy_detected: "danger", verification_unavailable: "danger",
};
const APPROVAL_TONES: Record<PaymentOperationRow["approvalState"], Tone> = { approved: "success", not_approved: "warning", expired: "danger" };

export const statusTone = (status: PaymentOperationRow["paymentStatus"]): Tone => STATUS_TONES[status];
export const verificationTone = (state: PaymentOperationRow["verificationState"]): Tone => VERIFICATION_TONES[state];
export const approvalTone = (state: PaymentOperationRow["approvalState"]): Tone => APPROVAL_TONES[state];
export const feeLabel = (state: PaymentOperationRow["feeState"]): string => FEE_LABELS[state];
export const originLabel = (origin: PaymentOperationRow["recordOrigin"]): string => ORIGIN_LABELS[origin];

export interface OperationView extends PaymentOperationRow {
  recordName: string;
  recordClass: "Operational" | "Demonstration";
  approvalLabel: string;
  verificationLabel: string;
  reconciliationLabel: string;
  environmentLabel: string;
  sourceLabel: string;
  dueWindow: DueWindow;
  attentionLabel: "Needs attention" | "No exception";
}

export function toView(row: PaymentOperationRow): OperationView {
  return {
    ...row,
    recordName: recordName(row),
    recordClass: row.isDemonstration ? "Demonstration" : "Operational",
    approvalLabel: APPROVAL_LABELS[row.approvalState],
    verificationLabel: VERIFICATION_LABELS[row.verificationState],
    reconciliationLabel: RECONCILIATION_LABELS[row.reconciliationState],
    environmentLabel: ENVIRONMENT_LABELS[row.providerEnvironment],
    sourceLabel: row.source === "legacy_grid" ? "Legacy demonstration grid" : row.workspaceName ?? "Workspace",
    dueWindow: dueWindow(row),
    attentionLabel: row.needsAttention ? "Needs attention" : "No exception",
  };
}

export function toViews(rows: readonly PaymentOperationRow[]): OperationView[] {
  return rows.map(toView);
}

// ---- AG Studio data source ---------------------------------------------------

export const STUDIO_SOURCE_ID = "payments";

export const STUDIO_FIELDS: AgFieldDefinition[] = [
  { id: "operationId", name: "Record ID", format: "textFormat" },
  { id: "record", name: "Record", format: "textFormat" },
  { id: "recipient", name: "Recipient", format: "textFormat" },
  { id: "amount", name: "Amount (USD)", format: "currencyFormat" },
  { id: "paymentStatus", name: "Payment status", format: "textFormat" },
  { id: "approvalState", name: "Approval", format: "textFormat" },
  { id: "verificationState", name: "Verification", format: "textFormat" },
  { id: "reconciliationState", name: "Reconciliation", format: "textFormat" },
  { id: "recordClass", name: "Record class", format: "textFormat" },
  { id: "source", name: "Workspace", format: "textFormat" },
  { id: "environment", name: "Provider environment", format: "textFormat" },
  { id: "dueWindow", name: "Due window", format: "textFormat" },
  { id: "dueDate", name: "Due date", format: "dateFormat" },
  { id: "needsAttention", name: "Needs attention", format: "booleanFormat" },
  { id: "needsApproval", name: "Awaiting approval", format: "booleanFormat" },
  { id: "isPendingObligation", name: "Pending obligation", format: "booleanFormat" },
  { id: "isUnreconciled", name: "Unreconciled", format: "booleanFormat" },
  { id: "isDueSoon", name: "Due soon", format: "booleanFormat" },
  { id: "cannotPayWithinBudget", name: "Outside budget", format: "booleanFormat" },
  { id: "hasIncompleteEvidence", name: "Incomplete evidence", format: "booleanFormat" },
];

export type StudioRow = Record<string, string | number | boolean | null>;

export function studioRows(views: readonly OperationView[]): StudioRow[] {
  return views.map((view) => ({
    operationId: view.operationId,
    record: view.recordName,
    recipient: view.recipient,
    amount: view.amountCents / 100,
    paymentStatus: view.paymentStatusLabel,
    approvalState: view.approvalLabel,
    verificationState: view.verificationLabel,
    reconciliationState: view.reconciliationLabel,
    recordClass: view.recordClass,
    source: view.sourceLabel,
    environment: view.environmentLabel,
    dueWindow: view.dueWindow,
    dueDate: view.dueDate,
    needsAttention: view.needsAttention,
    needsApproval: view.needsApproval,
    isPendingObligation: view.isPendingObligation,
    isUnreconciled: view.isUnreconciled,
    isDueSoon: view.isDueSoon,
    cannotPayWithinBudget: view.cannotPayWithinBudget,
    hasIncompleteEvidence: view.hasIncompleteEvidence,
  }));
}

/** Studio field → grid column that carries the same values, for mirroring a Studio selection onto the grid. */
export const STUDIO_TO_GRID_COLUMN: Record<string, string> = {
  paymentStatus: "paymentStatus",
  approvalState: "approvalState",
  verificationState: "verificationState",
  reconciliationState: "reconciliationState",
  recordClass: "recordClass",
  recipient: "recipient",
  dueWindow: "dueWindow",
  source: "source",
};
