// Runtime checks for the payment operations contract.
//
// The types come from the shared contract the server builds. Types alone prove
// nothing about a response at run time, and the dashboard filters a financial
// grid from these responses, so everything is checked before it is used:
// a response that does not match is refused as a whole, never partly applied.
import type {
  ExceptionBucket, InvestigationFinding, InvestigationIntent, OperationsCapacity, OperationsInvestigation, OperationsSnapshot,
  PaymentOperationDetail, PaymentOperationFlag, PaymentOperationRow, SuggestedGridAction,
} from "../../../src/shared/operations.ts";

export type {
  ExceptionBucket, InvestigationFinding, InvestigationIntent, OperationAuditEvent, OperationsCapacity, OperationsInvestigation,
  OperationsSnapshot, PaymentOperationDetail, PaymentOperationFlag, PaymentOperationRow, SuggestedGridAction, TimelineState,
} from "../../../src/shared/operations.ts";

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

type Json = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new ContractError(`${path}: expected ${expected}`);
}
function object(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "an object");
  return value as Json;
}
function string(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "a string");
  return value as string;
}
function nonEmpty(value: unknown, path: string): string {
  const text = string(value, path);
  if (text.trim() === "") fail(path, "a non-empty string");
  return text;
}
function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return string(value, path);
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "true or false");
  return value as boolean;
}
function cents(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(path, "a non-negative whole number of cents");
  return value as number;
}
function nullableCents(value: unknown, path: string): number | null {
  return value === null ? null : cents(value, path);
}
function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(path, "a whole number");
  return value as number;
}
function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) fail(path, "a list of strings");
  return value as string[];
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(path, `one of ${allowed.join(", ")}`);
  return value as T;
}
function timestamp(value: unknown, path: string): string {
  const text = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(Date.parse(text))) fail(path, "an ISO timestamp");
  return text;
}

const PAYMENT_STATUSES = [
  "not_submitted", "held", "refused", "historical_reference", "unverified_legacy_status", "approved", "reserved", "submitted",
  "awaiting_confirmation", "pending", "unclaimed", "onhold", "provider_confirmed", "failed", "blocked", "returned", "reversed",
  "refunded", "outcome_unknown", "reconciliation_required",
] as const;
const VERIFICATION_STATES = ["demonstration", "historical_reference", "not_applicable", "unverified", "provider_response_received", "provider_confirmed", "reconciled", "discrepancy_detected", "verification_unavailable"] as const;
const RECONCILIATION_STATES = ["not_applicable", "not_reconciled", "reconciled", "required", "discrepancy"] as const;
const APPROVAL_STATES = ["not_approved", "approved", "expired"] as const;
const ORIGINS = ["seed", "synthetic", "application"] as const;
const ENVIRONMENTS = ["none", "sandbox"] as const;
const FEE_STATES = ["not_applicable", "unavailable", "estimate_only", "provider_reported"] as const;
const SOURCES = ["legacy_grid", "workspace"] as const;
const BATCH_KINDS = ["provider_item", "provider_acknowledgement", "historical_claim"] as const;
const PRIORITIES = ["high", "normal", "low"] as const;

export const ROW_FLAGS: readonly PaymentOperationFlag[] = ["isDemonstration", "needsApproval", "isPendingObligation", "isReadyToPay", "isInFlight", "isUnreconciled", "isDueSoon", "isOverdue", "cannotPayWithinBudget", "hasIncompleteEvidence", "needsAttention"];
const NULLABLE_STRINGS = ["workspaceId", "workspaceName", "jobId", "title", "dueDate", "approvedAt", "approvedBy", "paymentId", "payoutBatchId", "payoutItemId", "transactionId", "providerStatus", "providerTimestamp", "submittedAt", "confirmedAt", "lastReconciledAt", "executionRunId", "lastUpdatedAt", "blockedReason", "budgetReason"] as const;

function parseRow(value: unknown, path: string): PaymentOperationRow {
  const row = object(value, path);
  nonEmpty(row.operationId, `${path}.operationId`);
  oneOf(row.source, SOURCES, `${path}.source`);
  nonEmpty(row.recipient, `${path}.recipient`);
  cents(row.amountCents, `${path}.amountCents`);
  nonEmpty(row.currency, `${path}.currency`);
  if (row.dueInDays !== null) integer(row.dueInDays, `${path}.dueInDays`);
  if (row.priority !== null) oneOf(row.priority, PRIORITIES, `${path}.priority`);
  oneOf(row.recordOrigin, ORIGINS, `${path}.recordOrigin`);
  oneOf(row.providerEnvironment, ENVIRONMENTS, `${path}.providerEnvironment`);
  oneOf(row.approvalState, APPROVAL_STATES, `${path}.approvalState`);
  oneOf(row.paymentStatus, PAYMENT_STATUSES, `${path}.paymentStatus`);
  nonEmpty(row.paymentStatusLabel, `${path}.paymentStatusLabel`);
  if (row.policyVersion !== null) integer(row.policyVersion, `${path}.policyVersion`);
  if (row.batchReferenceKind !== null) oneOf(row.batchReferenceKind, BATCH_KINDS, `${path}.batchReferenceKind`);
  oneOf(row.verificationState, VERIFICATION_STATES, `${path}.verificationState`);
  oneOf(row.reconciliationState, RECONCILIATION_STATES, `${path}.reconciliationState`);
  oneOf(row.feeState, FEE_STATES, `${path}.feeState`);
  nullableCents(row.feeEstimateCents, `${path}.feeEstimateCents`);
  nullableCents(row.providerFeeCents, `${path}.providerFeeCents`);
  integer(row.providerEventCount, `${path}.providerEventCount`);
  for (const key of NULLABLE_STRINGS) nullableString(row[key], `${path}.${key}`);
  for (const key of ROW_FLAGS) boolean(row[key], `${path}.${key}`);
  strings(row.providerEventKeys, `${path}.providerEventKeys`);
  strings(row.evidenceGaps, `${path}.evidenceGaps`);
  strings(row.attentionReasons, `${path}.attentionReasons`);
  return row as unknown as PaymentOperationRow;
}

function parseCapacity(value: unknown, path: string): OperationsCapacity {
  const capacity = object(value, path);
  for (const key of ["budgetCents", "perPaymentCapCents", "rollingSpendCents", "activeExposureCents", "awaitingConfirmationCents", "remainingCents"]) cents(capacity[key], `${path}.${key}`);
  integer(capacity.windowHours, `${path}.windowHours`);
  integer(capacity.policyVersion, `${path}.policyVersion`);
  integer(capacity.freshnessSeconds, `${path}.freshnessSeconds`);
  boolean(capacity.fresh, `${path}.fresh`);
  boolean(capacity.emergencyStop, `${path}.emergencyStop`);
  nullableString(capacity.lastSuccessfulReconciliation, `${path}.lastSuccessfulReconciliation`);
  timestamp(capacity.windowStart, `${path}.windowStart`);
  timestamp(capacity.windowEnd, `${path}.windowEnd`);
  nonEmpty(capacity.formula, `${path}.formula`);
  nonEmpty(capacity.source, `${path}.source`);
  const definitions = object(capacity.definitions, `${path}.definitions`);
  for (const key of ["budget", "rollingSpend", "activeExposure", "awaitingConfirmation", "remaining", "perPaymentCap"]) nonEmpty(definitions[key], `${path}.definitions.${key}`);
  return capacity as unknown as OperationsCapacity;
}

const BUCKET_KEYS = ["awaitingApproval", "pendingObligations", "unreconciled", "needsAttention", "dueSoon", "cannotPayWithinBudget", "incompleteEvidence"] as const;

function parseBucket(value: unknown, path: string, known: Set<string>): ExceptionBucket {
  const bucket = object(value, path);
  oneOf(bucket.flag, ROW_FLAGS, `${path}.flag`);
  nonEmpty(bucket.label, `${path}.label`);
  nonEmpty(bucket.definition, `${path}.definition`);
  for (const id of strings(bucket.operationIds, `${path}.operationIds`)) if (!known.has(id)) fail(`${path}.operationIds`, `only rows of this snapshot (found ${id})`);
  for (const scope of ["operational", "demonstration"]) {
    const total = object(bucket[scope], `${path}.${scope}`);
    integer(total.count, `${path}.${scope}.count`);
    cents(total.amountCents, `${path}.${scope}.amountCents`);
  }
  return bucket as unknown as ExceptionBucket;
}

export function parseSnapshot(value: unknown): OperationsSnapshot {
  const snapshot = object(value, "snapshot");
  timestamp(snapshot.generatedAt, "snapshot.generatedAt");
  nonEmpty(snapshot.dataVersion, "snapshot.dataVersion");
  if (!Array.isArray(snapshot.rows)) fail("snapshot.rows", "a list of rows");
  const known = new Set<string>();
  (snapshot.rows as unknown[]).forEach((entry, index) => {
    const row = parseRow(entry, `snapshot.rows[${index}]`);
    if (known.has(row.operationId)) fail(`snapshot.rows[${index}].operationId`, `a unique id (${row.operationId} is repeated)`);
    known.add(row.operationId);
  });
  parseCapacity(snapshot.capacity, "snapshot.capacity");
  const exceptions = object(snapshot.exceptions, "snapshot.exceptions");
  for (const key of BUCKET_KEYS) parseBucket(exceptions[key], `snapshot.exceptions.${key}`, known);
  const access = object(snapshot.access, "snapshot.access");
  boolean(access.signedIn, "snapshot.access.signedIn");
  oneOf(access.scope, ["public", "owner"] as const, "snapshot.access.scope");
  string(access.note, "snapshot.access.note");
  if (!Array.isArray(access.workspaces)) fail("snapshot.access.workspaces", "a list");
  const provider = object(snapshot.provider, "snapshot.provider");
  boolean(provider.configured, "snapshot.provider.configured");
  boolean(provider.connected, "snapshot.provider.connected");
  string(provider.note, "snapshot.provider.note");
  const events = object(snapshot.providerEvents, "snapshot.providerEvents");
  for (const key of ["total", "linked", "unlinked"]) integer(events[key], `snapshot.providerEvents.${key}`);
  strings(snapshot.sources, "snapshot.sources");
  return snapshot as unknown as OperationsSnapshot;
}

const INTENTS: readonly InvestigationIntent[] = ["needs_attention", "approaching_deadlines", "unreconciled", "awaiting_approval", "cannot_pay_within_budget", "incomplete_provider_evidence", "overview", "unsupported"];
const INVESTIGATION_SOURCES = ["Deterministic ledger projection", "Model narration over the deterministic ledger projection"] as const;

function parseAction(value: unknown, ids: Set<string>): SuggestedGridAction {
  const action = object(value, "investigation.suggestedGridAction");
  const type = oneOf(action.type, ["filter_payments", "open_payment", "none"] as const, "investigation.suggestedGridAction.type");
  if (type === "none") {
    nonEmpty(action.reason, "investigation.suggestedGridAction.reason");
    return { type, reason: action.reason as string };
  }
  nonEmpty(action.label, "investigation.suggestedGridAction.label");
  if (type === "open_payment") {
    const paymentId = nonEmpty(action.paymentId, "investigation.suggestedGridAction.paymentId");
    if (!ids.has(paymentId)) fail("investigation.suggestedGridAction.paymentId", "an id from investigation.paymentIds");
    return { type, paymentId, label: action.label as string };
  }
  // A grid action is always a list of exact identifiers. A filter expression or query is never accepted.
  const paymentIds = strings(action.paymentIds, "investigation.suggestedGridAction.paymentIds");
  if (paymentIds.length === 0 || paymentIds.some((id) => !ids.has(id))) fail("investigation.suggestedGridAction.paymentIds", "a non-empty subset of investigation.paymentIds");
  return { type, paymentIds, label: action.label as string };
}

export function parseInvestigation(value: unknown): OperationsInvestigation {
  const result = object(value, "investigation");
  if (result.contractVersion !== 1) fail("investigation.contractVersion", "1");
  if (result.readOnly !== true) fail("investigation.readOnly", "true");
  const investigationId = nonEmpty(result.investigationId, "investigation.investigationId");
  if (!/^inv_[A-Za-z0-9-]{8,}$/.test(investigationId)) fail("investigation.investigationId", "an investigation id");
  const question = string(result.question, "investigation.question");
  const intent = oneOf(result.intent, INTENTS, "investigation.intent");
  const paymentIds = strings(result.paymentIds, "investigation.paymentIds");
  const ids = new Set(paymentIds);
  if (ids.size !== paymentIds.length) fail("investigation.paymentIds", "unique ids");
  if (!Array.isArray(result.findings)) fail("investigation.findings", "a list of findings");
  const supported = new Set<string>();
  const findings: InvestigationFinding[] = (result.findings as unknown[]).map((entry, index) => {
    const path = `investigation.findings[${index}]`;
    const finding = object(entry, path);
    const findingIds = strings(finding.paymentIds, `${path}.paymentIds`);
    for (const id of findingIds) {
      if (!ids.has(id)) fail(`${path}.paymentIds`, "ids from investigation.paymentIds");
      supported.add(id);
    }
    return {
      id: nonEmpty(finding.id, `${path}.id`), title: nonEmpty(finding.title, `${path}.title`), detail: nonEmpty(finding.detail, `${path}.detail`),
      severity: oneOf(finding.severity, ["info", "warning", "critical"] as const, `${path}.severity`), paymentIds: findingIds,
    };
  });
  for (const id of paymentIds) if (!supported.has(id)) fail("investigation.paymentIds", `ids that a finding supports (${id} has none)`);
  const explanation = nonEmpty(result.explanation, "investigation.explanation");
  if (explanation.length > 4000) fail("investigation.explanation", "at most 4000 characters");
  return {
    contractVersion: 1,
    investigationId,
    question,
    intent,
    findings,
    paymentIds,
    explanation,
    dataTimestamp: timestamp(result.dataTimestamp, "investigation.dataTimestamp"),
    dataVersion: nonEmpty(result.dataVersion, "investigation.dataVersion"),
    uncertainty: strings(result.uncertainty, "investigation.uncertainty"),
    suggestedGridAction: parseAction(result.suggestedGridAction, ids),
    source: oneOf(result.source, INVESTIGATION_SOURCES, "investigation.source"),
    readOnly: true,
  };
}

/** Split identifiers into those present in the current rows and those that are not. Order is preserved. */
export function matchToRows(paymentIds: readonly string[], rows: readonly PaymentOperationRow[]): { known: string[]; unknown: string[] } {
  const present = new Set(rows.map((row) => row.operationId));
  return { known: paymentIds.filter((id) => present.has(id)), unknown: paymentIds.filter((id) => !present.has(id)) };
}

export function parseDetail(value: unknown): PaymentOperationDetail {
  const detail = object(value, "detail");
  timestamp(detail.generatedAt, "detail.generatedAt");
  boolean(detail.sensitiveAccess, "detail.sensitiveAccess");
  parseRow(detail.row, "detail.row");
  const identity = object(detail.identity, "detail.identity");
  nonEmpty(identity.operationId, "detail.identity.operationId");
  for (const key of ["paymentId", "jobId", "workspaceId", "workspaceName", "recipientEmail", "idempotencyKey"]) nullableString(identity[key], `detail.identity.${key}`);
  object(detail.approval, "detail.approval");
  object(detail.provider, "detail.provider");
  const fees = object(detail.fees, "detail.fees");
  nonEmpty(fees.explanation, "detail.fees.explanation");
  const reconciliation = object(detail.reconciliation, "detail.reconciliation");
  integer(reconciliation.discrepancyCount, "detail.reconciliation.discrepancyCount");
  if (!Array.isArray(reconciliation.discrepancies)) fail("detail.reconciliation.discrepancies", "a list");
  for (const key of ["timestamps", "timeline", "providerEvents"]) if (!Array.isArray(detail[key])) fail(`detail.${key}`, "a list");
  const audit = object(detail.audit, "detail.audit");
  oneOf(audit.access, ["granted", "owner_required", "not_applicable"] as const, "detail.audit.access");
  nonEmpty(audit.note, "detail.audit.note");
  if (!Array.isArray(audit.events)) fail("detail.audit.events", "a list of audit events");
  (audit.events as unknown[]).forEach((entry, index) => {
    const event = object(entry, `detail.audit.events[${index}]`);
    nonEmpty(event.action, `detail.audit.events[${index}].action`);
    nonEmpty(event.at, `detail.audit.events[${index}].at`);
  });
  return detail as unknown as PaymentOperationDetail;
}
