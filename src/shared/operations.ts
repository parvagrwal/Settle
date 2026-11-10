// Payment operations contract, shared by the server and the dashboard.
//
// Types only: this file has no runtime dependency, so the dashboard can import
// it without pulling server code into the bundle. The server builds these
// shapes (src/server/paymentOperations.ts, operationsInvestigation.ts,
// paymentOperationDetail.ts); the dashboard validates what it receives against
// them before using it (app/src/operations/contract.ts).
/**
 * The ledger's payment states. The canonical vocabulary is `PaymentState` in
 * src/server/paymentState.ts; the server proves at compile time that this list
 * is identical (see paymentOperations.ts), so the two cannot drift.
 */
export type LedgerPaymentState =
  | "approved" | "reserved" | "submitted" | "awaiting_confirmation" | "pending" | "unclaimed" | "onhold"
  | "provider_confirmed" | "failed" | "blocked" | "returned" | "reversed" | "refunded" | "outcome_unknown" | "reconciliation_required";

export type OperationSource = "legacy_grid" | "workspace";
export type OperationOrigin = "seed" | "synthetic" | "application";
export type OperationEnvironment = "none" | "sandbox";
export type OperationApprovalState = "not_approved" | "approved" | "expired";
/** Ledger states, plus the states a record can be in before it has a ledger identity. */
export type OperationPaymentStatus =
  | LedgerPaymentState
  | "not_submitted"
  | "held"
  | "refused"
  | "historical_reference"
  | "unverified_legacy_status";
export type OperationVerificationState =
  | "demonstration"
  | "historical_reference"
  | "not_applicable"
  | "unverified"
  | "provider_response_received"
  | "provider_confirmed"
  | "reconciled"
  | "discrepancy_detected"
  | "verification_unavailable";
export type OperationReconciliationState = "not_applicable" | "not_reconciled" | "reconciled" | "required" | "discrepancy";
export type OperationFeeState = "not_applicable" | "unavailable" | "estimate_only" | "provider_reported";
export type BatchReferenceKind = "provider_item" | "provider_acknowledgement" | "historical_claim";

export interface PaymentOperationRow {
  /** Stable row identity: `legacy/<job>`, `workspace/<job>` or `receipt/<receipt>`. */
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
  /** Whole days from the snapshot date to the due date; negative when overdue. */
  dueInDays: number | null;
  priority: "high" | "normal" | "low" | null;
  recordOrigin: OperationOrigin;
  isDemonstration: boolean;
  providerEnvironment: OperationEnvironment;
  approvalState: OperationApprovalState;
  approvedAt: string | null;
  approvedBy: string | null;
  paymentStatus: OperationPaymentStatus;
  paymentStatusLabel: string;
  /** Ledger payment identity. Null until an owner approval created one. */
  paymentId: string | null;
  policyVersion: number | null;
  payoutBatchId: string | null;
  batchReferenceKind: BatchReferenceKind | null;
  payoutItemId: string | null;
  transactionId: string | null;
  providerStatus: string | null;
  providerTimestamp: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  verificationState: OperationVerificationState;
  reconciliationState: OperationReconciliationState;
  lastReconciledAt: string | null;
  feeState: OperationFeeState;
  feeEstimateCents: number | null;
  providerFeeCents: number | null;
  executionRunId: string | null;
  lastUpdatedAt: string | null;
  providerEventCount: number;
  providerEventKeys: string[];
  /** Why the record is held, refused or failed, in the ledger's own words. */
  blockedReason: string | null;
  needsApproval: boolean;
  isPendingObligation: boolean;
  isReadyToPay: boolean;
  isInFlight: boolean;
  isUnreconciled: boolean;
  isDueSoon: boolean;
  isOverdue: boolean;
  cannotPayWithinBudget: boolean;
  budgetReason: string | null;
  hasIncompleteEvidence: boolean;
  evidenceGaps: string[];
  needsAttention: boolean;
  attentionReasons: string[];
}

/** The boolean classification fields of a row. An exception bucket names the one it counts. */
export type PaymentOperationFlag = {
  [K in keyof PaymentOperationRow]: PaymentOperationRow[K] extends boolean ? K : never;
}[keyof PaymentOperationRow];

export interface ExceptionBucket {
  flag: PaymentOperationFlag;
  label: string;
  definition: string;
  operationIds: string[];
  operational: { count: number; amountCents: number };
  demonstration: { count: number; amountCents: number };
}

export interface OperationsCapacity {
  currency: "USD";
  budgetCents: number;
  perPaymentCapCents: number;
  windowHours: number;
  windowStart: string;
  windowEnd: string;
  rollingSpendCents: number;
  activeExposureCents: number;
  awaitingConfirmationCents: number;
  remainingCents: number;
  fresh: boolean;
  freshnessSeconds: number;
  lastSuccessfulReconciliation: string | null;
  policyVersion: number;
  emergencyStop: boolean;
  formula: string;
  definitions: { budget: string; rollingSpend: string; activeExposure: string; awaitingConfirmation: string; remaining: string; perPaymentCap: string };
  source: string;
}

export interface OperationsSnapshot {
  generatedAt: string;
  /** Changes when, and only when, the rows or the capacity figures change. */
  dataVersion: string;
  access: { signedIn: boolean; scope: "public" | "owner"; workspaces: Array<{ workspaceId: string; name: string; kind: string }>; note: string };
  provider: { environment: "sandbox"; configured: boolean; connected: boolean; note: string };
  rows: PaymentOperationRow[];
  capacity: OperationsCapacity;
  exceptions: {
    awaitingApproval: ExceptionBucket;
    pendingObligations: ExceptionBucket;
    unreconciled: ExceptionBucket;
    needsAttention: ExceptionBucket;
    dueSoon: ExceptionBucket;
    cannotPayWithinBudget: ExceptionBucket;
    incompleteEvidence: ExceptionBucket;
  };
  providerEvents: { total: number; linked: number; unlinked: number };
  sources: string[];
}

// ---- investigation ----

export type InvestigationIntent =
  | "needs_attention"
  | "approaching_deadlines"
  | "unreconciled"
  | "awaiting_approval"
  | "cannot_pay_within_budget"
  | "incomplete_provider_evidence"
  | "overview"
  | "unsupported";

export interface InvestigationFinding {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  paymentIds: string[];
}

export type SuggestedGridAction =
  | { type: "filter_payments"; paymentIds: string[]; label: string }
  | { type: "open_payment"; paymentId: string; label: string }
  | { type: "none"; reason: string };

export interface OperationsInvestigation {
  contractVersion: 1;
  investigationId: string;
  question: string;
  intent: InvestigationIntent;
  findings: InvestigationFinding[];
  /** Operation ids referenced by the findings. Always a subset of the snapshot's rows. */
  paymentIds: string[];
  explanation: string;
  /** `generatedAt` of the snapshot the findings were computed from. */
  dataTimestamp: string;
  dataVersion: string;
  uncertainty: string[];
  suggestedGridAction: SuggestedGridAction;
  source: "Deterministic ledger projection" | "Model narration over the deterministic ledger projection";
  readOnly: true;
}

// ---- payment investigation detail ----

export type TimelineState = "complete" | "missing" | "historical" | "not_applicable";

export interface OperationAuditEvent {
  source: "ledger" | "workspace" | "legacy_decision";
  sequence: number;
  at: string;
  actor: string;
  action: string;
  from: string | null;
  to: string | null;
  note: string | null;
}

export interface PaymentOperationDetail {
  generatedAt: string;
  sensitiveAccess: boolean;
  row: PaymentOperationRow;
  identity: {
    operationId: string;
    paymentId: string | null;
    jobId: string | null;
    workspaceId: string | null;
    workspaceName: string | null;
    recipient: string;
    recipientEmail: string | null;
    idempotencyKey: string | null;
  };
  approval: { state: string; approvedBy: string | null; approvedAt: string | null; expiresAt: string | null; policyVersion: number | null };
  provider: {
    environment: string;
    payoutBatchId: string | null;
    batchReferenceKind: string | null;
    payoutItemId: string | null;
    transactionId: string | null;
    providerStatus: string | null;
    providerTimestamp: string | null;
  };
  timestamps: Array<{ key: string; label: string; at: string }>;
  fees: {
    state: string;
    estimate: { estimatedFeeMinor: number; currency: string; policyId: string; policyVersion: number; formula: string; sourceUrl: string } | null;
    provider: { reportedFeeMinor: number; currency: string; source: string; isProviderEstimate: boolean; observedAt: string } | null;
    consistent: boolean | null;
    explanation: string;
  };
  reconciliation: {
    state: string;
    lastReconciledAt: string | null;
    reconciliationRunId: string | null;
    discrepancyCount: number;
    discrepancies: Array<{ type: string; detectedAt: string; details: unknown }>;
  };
  confirmation: { state: string; attemptCount: number; nextAttemptAt: string; lastError: string | null } | null;
  executionRun: { runId: string; kind: string; status: string; startedAt: string; completedAt: string | null; itemCount: number } | null;
  timeline: Array<{ kind: string; label: string; state: TimelineState; at: string | null; detail: string }>;
  audit: { access: "granted" | "owner_required" | "not_applicable"; note: string; events: OperationAuditEvent[] };
  providerEvents: Array<{ rowKey: string; status: string; latestEventId: string; eventCreatedAt: string; eventReceivedAt: string }>;
}
