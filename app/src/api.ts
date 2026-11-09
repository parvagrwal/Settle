// API client — the browser talks only to this server, never to PayPal.
// No PayPal secret reaches the browser: the browser only sees jobs,
// grid rows, and audit rows. Every call returns plain JSON from /api/*.
import { statusLabel } from "./status.ts";
export interface GridRow {
  job_id: string;
  freelancer_id: string;
  amount_cents: number;
  due: string | null;
  priority: "high" | "normal" | "low" | null;
  status: string;
  reason: string | null;
  payout_batch_id: string | null;
}

export interface JobRow {
  job_id: string;
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
  payout_batch_id: string | null;
  batch_status: string | null;
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
  /** HTTP 202 means a provider submission became ambiguous. */
  httpStatus?: number;
  outcomeUnknown?: boolean;
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
  fee_usd: number;
  net_usd: number;
}

export function toDashboardRow(row: GridRow): DashboardRow {
  const amountUsd = row.amount_cents / 100;
  const feeUsd = estimateFeeUsd(amountUsd);
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
    fee_usd: feeUsd,
    net_usd: amountUsd - feeUsd,
  };
}

// Fee estimate, from PayPal's published cross-border rates: 4.40% of the
// amount, plus $0.30 per payment, plus about 3% currency conversion.
// About $74.30 lost per $1,000 sent. An estimate, not the exact fee,
// and it never claims the fee is removed.
export function estimateFeeUsd(amountUsd: number): number {
  return amountUsd * 0.044 + 0.3 + amountUsd * 0.03;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
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

export async function reconcileFinancial(): Promise<{ batchesRead: number; itemsRecorded: number }> {
  const res = await fetch("/api/financial/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `reconcile failed, HTTP ${res.status}`);
  }
  return (await res.json()) as { batchesRead: number; itemsRecorded: number };
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
