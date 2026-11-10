// API client — the browser talks only to this server, never to PayPal.
// No PayPal secret reaches the browser: the browser only sees jobs,
// grid rows, and audit rows. Every call returns plain JSON from /api/*.
import { actualFeeUsd, usdOrUnreported } from "./fees.ts";
import { statusLabel } from "./status.ts";
export type RecordOrigin = "application" | "seed";
export type FeeState = "estimate_only" | "provider_reported" | "unavailable" | "not_applicable";

export interface GridRow {
  job_id: string;
  freelancer_id: string;
  amount_cents: number;
  fee_cents?: number | null;
  due: string | null;
  priority: "high" | "normal" | "low" | null;
  status: string;
  reason: string | null;
  payout_batch_id: string | null;
  record_origin?: RecordOrigin;
  provenance_label?: string;
  seeded?: boolean;
  fee_estimate_cents?: number | null;
  provider_fee_cents?: number | null;
  fee_state?: FeeState;
  execution_run_id?: string | null;
}

export interface JobRow {
  job_id: string;
  /** Seed rows are demonstration data and cannot be approved or paid. */
  origin?: "application" | "seed";
  freelancer_id: string;
  paypal_email: string;
  amount_cents: number;
  currency: string;
  due?: string | null;
  priority?: "high" | "normal" | "low" | null;
  approval_state: "approved" | "not_approved" | "expired";
  approved_at: number | null;
  status: string;
  payout_batch_id: string | null;
  payout_item_id: string | null;
  decision_reason: string | null;
}

export interface AuditRow {
  audit_id: string;
  at: number;
  actor: string;
  job_id: string;
  action: string;
  reason: string;
  amount_cents: number;
  payout_batch_id: string | null;
  paypal_transaction_id: string | null;
}

export interface Caps {
  per_payment_cap_cents: number;
  weekly_cap_cents: number;
  rolling_cap_cents?: number;
  window_hours?: number;
  window_days: number;
  approval_expiry_days: number;
  policy_version?: number;
  freshness_seconds?: number;
  eligibleSpendCents?: number;
  activeReservationsCents?: number;
  remainingCents?: number;
  lastSuccessfulReconciliation?: string | null;
  fresh?: boolean;
  worst_case_exposure: string;
}

export interface PayResult {
  accepted: string[];
  rejected: Array<{ job_id: string; label: string; reason: string }>;
  processing?: Array<{ job_id: string; payout_batch_id: string | null; payout_item_id: string | null; reason: string | null }>;
  payout_batch_id: string | null;
  batch_status: string | null;
  actual_fee_cents?: number | null;
  provider_items?: Array<{ job_id: string; payout_batch_id: string | null; payout_item_id: string | null; transaction_id: string | null; fee_cents: number | null; status: string }>;
  proposer: string;
  proposer_reason: string | null;
  /** Jobs the model held for a later run, with reasons. */
  held: Array<{ job_id: string; reason: string }>;
  /** Candidates the run held for the owner to pick by hand. */
  held_for_selection: string[];
  hold_reason: string | null;
  /** Invoice for the same work, when the server sent one. Missing on an
   * old response, which shows nothing about invoicing. */
  invoice_id?: string | null;
  invoice_status?: string | null;
  invoice_total_cents?: number | null;
  invoice_error?: string | null;
  /** Durable identity for this run. Every item below hangs off this id. */
  execution_run?: null | {
    runId: string;
    status: string;
    items: Array<{
      jobId: string;
      status: string;
      payoutBatchId: string | null;
      payoutItemId: string | null;
      transactionId: string | null;
      providerStatus: string | null;
      amountMinor: number;
    }>;
    batches: Array<{ payoutBatchId: string; itemCount: number; grossMinor: number; status: string }>;
  };
  fee_records?: Array<{
    job_id: string;
    estimate: { estimatedFeeMinor: number; policyId: string; policyVersion: number; formula: string; sourceUrl: string } | null;
    provider: { reportedFeeMinor: number; isProviderEstimate: boolean } | null;
    consistent: boolean | null;
    explanation: string;
  }>;
  /** HTTP 202 means a provider submission became ambiguous. */
  httpStatus?: number;
  outcomeUnknown?: boolean;
}

export interface FinancialReport {
  asOf: string;
  environment: { mode: string; configured: boolean; connected: boolean; note: string };
  source: string;
  metrics: Record<string, {
    value: number;
    currency: string;
    label: string;
    definition: string;
    window: string;
    includes: string;
    source: string;
    verification: string;
  }>;
  fees: {
    policy: { policyId: string; version: number; formula: string; sourceUrl: string; retrievedAt: string };
    estimatedTotal: { value: number };
    providerReportedTotal: { value: number };
    providerReportedCount: number;
    missingProviderFeeCount: number;
    note: string;
  };
  cap: { eligibleSpendCents: number; activeReservationsCents: number; remainingCents: number; fresh: boolean; windowStart: string; windowEnd: string; lastSuccessfulReconciliation: string | null };
  discrepancies: number;
  explanations: { totalsDiffer: string; seeds: string; fees: string };
}

export interface ControlState {
  emergencyStop: boolean;
  reason: string | null;
  changedAt: string | null;
  changedBy: string | null;
}

export interface FinancialDiscrepancy {
  discrepancy_id: string;
  payment_id: string | null;
  type: string;
  details_json: string;
  detected_at: string;
  resolved_at: string | null;
}

/** One grid row plus the money columns the dashboard shows. */
export interface DashboardRow {
  job_id: string;
  freelancer: string;
  amount_cents: number;
  amount_usd: number;
  due: string | null;
  priority: "high" | "normal" | "low" | null;
  status: string;
  /** Plain-words status for the screen, never colour alone. */
  status_label: string;
  reason: string | null;
  payout_batch_id: string | null;
  fee_cents: number | null;
  fee_usd: number | null;
  fee_label: string;
  net_usd: number;
  record_origin: RecordOrigin;
  provenance_label: string;
  seeded: boolean;
  fee_state: FeeState;
  fee_estimate_cents: number | null;
  execution_run_id: string | null;
}

export function toDashboardRow(row: GridRow): DashboardRow {
  const amountUsd = row.amount_cents / 100;
  const feeCents = row.fee_cents ?? null;
  const feeUsd = actualFeeUsd(feeCents);
  return {
    job_id: row.job_id,
    freelancer: row.freelancer_id,
    amount_cents: row.amount_cents,
    amount_usd: amountUsd,
    due: row.due ?? null,
    priority: row.priority ?? null,
    status: row.status,
    status_label: statusLabel(row.status),
    reason: row.reason,
    payout_batch_id: row.payout_batch_id,
    fee_cents: feeCents,
    fee_usd: feeUsd,
    fee_label: usdOrUnreported(feeCents),
    net_usd: amountUsd,
    record_origin: row.record_origin ?? "application",
    provenance_label: row.provenance_label ?? "Application record",
    seeded: row.seeded === true || row.record_origin === "seed",
    fee_state: row.fee_state ?? (row.fee_cents === null ? "unavailable" : "provider_reported"),
    fee_estimate_cents: row.fee_estimate_cents ?? null,
    execution_run_id: row.execution_run_id ?? null,
  };
}

async function getJson<T>(path: string): Promise<T> {
  // Sensitive reads (audit, transactions, financial report) are server-gated:
  // the owner token header or the HttpOnly session cookie proves the reader.
  const res = await fetch(path, { headers: ownerHeaders() });
  if (!res.ok) {
    throw new Error(`request to ${path} failed, HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Owner token, kept in this browser tab only (sessionStorage). It is
 * asked for once per session, sent on the approve, pay, and
 * allocation-write calls, and never baked into the bundle or saved to
 * disk. Empty means the owner has not entered it yet. */
const OWNER_TOKEN_KEY = "settle-owner-token";

export function ownerToken(): string | null {
  try {
    return sessionStorage.getItem(OWNER_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setOwnerToken(token: string): void {
  try {
    if (token === "") sessionStorage.removeItem(OWNER_TOKEN_KEY);
    else sessionStorage.setItem(OWNER_TOKEN_KEY, token);
  } catch {
    // Storage unavailable: the token stays unset and the guarded
    // buttons stay disabled.
  }
}

export function ownerHeaders(): Record<string, string> {
  const token = ownerToken();
  return token ? { "x-settle-owner-token": token } : {};
}

export async function fetchGrid(): Promise<GridRow[]> {
  const body = await getJson<{ rows: GridRow[] }>("/api/grid");
  return body.rows;
}

export async function fetchJobs(): Promise<JobRow[]> {
  const body = await getJson<{ jobs: JobRow[] }>("/api/jobs");
  return body.jobs;
}

export async function fetchAudit(): Promise<AuditRow[]> {
  const body = await getJson<{ rows: AuditRow[] }>("/api/audit");
  return body.rows;
}

export async function fetchCaps(): Promise<Caps> {
  return getJson<Caps>("/api/caps");
}

export async function fetchReport(): Promise<FinancialReport> {
  return getJson<FinancialReport>("/api/financial/report");
}

export async function fetchControl(): Promise<ControlState> {
  const res = await fetch("/api/financial/control", { headers: ownerHeaders() });
  if (!res.ok) throw new Error(`control state failed, HTTP ${res.status}`);
  return (await res.json()) as ControlState;
}

export async function setEmergencyStop(stopped: boolean, reason: string): Promise<ControlState> {
  const res = await fetch("/api/financial/control", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify({ emergencyStop: stopped, reason }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `emergency stop change failed, HTTP ${res.status}`);
  }
  return (await res.json()) as ControlState;
}

export async function confirmDue(): Promise<{ checked: number; confirmed: number; stillPending: number; errors: number }> {
  const res = await fetch("/api/financial/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `confirmation sweep failed, HTTP ${res.status}`);
  }
  return (await res.json()) as { checked: number; confirmed: number; stillPending: number; errors: number };
}

export async function approveJob(jobId: string): Promise<JobRow> {
  const res = await fetch("/api/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify({ job_id: jobId }),
  });
  if (!res.ok) {
    throw new Error(`approve failed, HTTP ${res.status}`);
  }
  const body = (await res.json()) as { job: JobRow };
  return body.job;
}

export async function payJobs(opts: { runBudgetCents?: number; selectedJobIds?: string[] } = {}): Promise<PayResult> {
  const res = await fetch("/api/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify({
      ...(opts.runBudgetCents !== undefined ? { runBudgetCents: opts.runBudgetCents } : {}),
      ...(opts.selectedJobIds !== undefined ? { selectedJobIds: opts.selectedJobIds } : {}),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `pay failed, HTTP ${res.status}`);
  }
  const body = (await res.json()) as PayResult;
  return {
    ...body,
    httpStatus: res.status,
    outcomeUnknown: res.status === 202 || body.batch_status === "OUTCOME_UNKNOWN",
  };
}

export async function reconcileFinancial(opts: { idempotentReplay?: boolean } = {}): Promise<{ batchesRead: number; itemsRecorded: number; failures: number; idempotentReplay: boolean }> {
  const res = await fetch("/api/financial/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify({ ...(opts.idempotentReplay ? { idempotentReplay: true } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `reconcile failed, HTTP ${res.status}`);
  }
  return (await res.json()) as { batchesRead: number; itemsRecorded: number; failures: number; idempotentReplay: boolean };
}

export async function updateFinancialPolicy(input: {
  capCents: number;
  perPaymentCapCents: number;
  freshnessSeconds: number;
}): Promise<{ policyVersion: number }> {
  const res = await fetch("/api/financial/policy", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `policy update failed, HTTP ${res.status}`);
  }
  return (await res.json()) as { policyVersion: number };
}

export async function fetchFinancialDiscrepancies(): Promise<FinancialDiscrepancy[]> {
  const res = await fetch("/api/financial/discrepancies", { headers: ownerHeaders() });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `discrepancy fetch failed, HTTP ${res.status}`);
  }
  const body = (await res.json()) as { discrepancies: FinancialDiscrepancy[] };
  return body.discrepancies;
}
