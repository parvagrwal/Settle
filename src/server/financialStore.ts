import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { providerFeeConsistency } from "./fees.ts";
import {
  PROVIDER_ITEM_STATE,
  isTerminal,
  providerStatusRank,
  nextConfirmationDelayMs,
  type ConfirmationPolicy,
  type PaymentState,
} from "./paymentState.ts";

export type FinancialActor = { actorId: string; role: "owner" | "operator" | "viewer" | "agent" };
export type FinancialPayment = { paymentId: string; jobId: string; idempotencyKey: string; recipientEmail: string; amountCents: number; currency: string; policyVersion: number; status: string; approvedBy: string; approvedAt: string; reservedAt: string | null; submittedAt: string | null; confirmedAt: string | null; failureReason: string | null; recordOrigin: string; executionRunId: string | null };
export type FeeRecord = {
  paymentId: string;
  estimate: null | { policyId: string; policyVersion: number; amountMinor: number; estimatedFeeMinor: number; currency: string; method: string; formula: string; sourceUrl: string; sourceRetrievedAt: string; createdAt: string };
  provider: null | { reportedFeeMinor: number; currency: string; feePayer: string; source: string; sourceBatchId: string | null; sourceItemId: string | null; isProviderEstimate: boolean; environment: string; observedAt: string };
  consistent: boolean | null;
  explanation: string;
};
export type ExecutionRunItem = { paymentId: string; jobId: string; ordinal: number; status: string; recordOrigin: string; payoutBatchId: string | null; payoutItemId: string | null; transactionId: string | null; amountMinor: number; currency: string; providerStatus: string | null; providerTimestamp: string | null };
export type ExecutionRun = { runId: string; kind: string; planId: string | null; requestedBy: string; actorRole: string; policyVersion: number; startedAt: string; completedAt: string | null; status: string; note: string | null; items: ExecutionRunItem[]; batches: Array<{ payoutBatchId: string; itemCount: number; grossMinor: number; status: string }> };
export type ConfirmationJob = { paymentId: string; jobId: string; status: string; payoutBatchId: string | null; attemptCount: number; nextAttemptAt: string; lastError: string | null };
export type PayoutItem = { paymentId: string; senderBatchId: string; payoutBatchId: string; payoutItemId: string; transactionId: string | null; activityId: string | null; status: string; providerTimestamp: string; ingestedAt: string | null; lastReconciledAt: string | null; reconciliationRunId: string | null; feeCents: number | null; raw: unknown };
export type ReconcilableAttempt = { paymentId: string; attemptId: string; senderBatchId: string; payoutBatchId: string | null; jobId: string; idempotencyKey: string; recipientEmail: string; amountCents: number; currency: string; paymentStatus: string; attemptStatus: string };
type Row = Record<string, unknown>;

export function extractPayoutItemFeeCents(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Row;
  const nested = row.payout_item && typeof row.payout_item === "object" ? (row.payout_item as Row) : null;
  const feeObj = row.payout_item_fee && typeof row.payout_item_fee === "object"
    ? (row.payout_item_fee as Row)
    : nested?.payout_item_fee && typeof nested.payout_item_fee === "object"
      ? (nested.payout_item_fee as Row)
      : null;
  if (!feeObj) return null;
  const value = feeObj.value;
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split(".");
  const parsed = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function cents(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive integer minor units`);
}
function iso(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("invalid provider or policy timestamp");
  return parsed;
}
/** Stable object serialisation for idempotent discrepancy identity. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Row;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
}

export class FinancialStore {
  private db: DatabaseSync;
  private dbPath: string;
  constructor(path: string) {
    this.dbPath = path;
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recipients (
        recipient_id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
        verified_by TEXT NOT NULL, verified_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS owner_policies (
        version INTEGER PRIMARY KEY AUTOINCREMENT, cap_cents INTEGER NOT NULL CHECK(cap_cents >= 0),
        per_payment_cap_cents INTEGER NOT NULL CHECK(per_payment_cap_cents > 0),
        freshness_seconds INTEGER NOT NULL CHECK(freshness_seconds > 0), currency TEXT NOT NULL,
        window_hours INTEGER NOT NULL DEFAULT 168, actor_id TEXT NOT NULL, effective_at TEXT NOT NULL
      );
      INSERT INTO owner_policies(cap_cents,per_payment_cap_cents,freshness_seconds,currency,actor_id,effective_at)
        SELECT 150000,20000,300,'USD','system',datetime('now') WHERE NOT EXISTS(SELECT 1 FROM owner_policies);
      CREATE TABLE IF NOT EXISTS payments (
        payment_id TEXT PRIMARY KEY, job_id TEXT UNIQUE NOT NULL, idempotency_key TEXT UNIQUE NOT NULL,
        recipient_id TEXT NOT NULL REFERENCES recipients(recipient_id), recipient_email TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), currency TEXT NOT NULL,
        policy_version INTEGER NOT NULL REFERENCES owner_policies(version), status TEXT NOT NULL,
        approved_by TEXT NOT NULL, approved_at TEXT NOT NULL, reserved_at TEXT,
        submitted_at TEXT, confirmed_at TEXT, failure_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS execution_attempts (
        attempt_id TEXT PRIMARY KEY, payment_id TEXT UNIQUE NOT NULL REFERENCES payments(payment_id),
        sender_batch_id TEXT UNIQUE NOT NULL, started_at TEXT NOT NULL, status TEXT NOT NULL, last_error TEXT,
        payout_batch_id TEXT
      );
      CREATE TABLE IF NOT EXISTS payout_items (
        payment_id TEXT PRIMARY KEY REFERENCES payments(payment_id), sender_batch_id TEXT NOT NULL,
        payout_batch_id TEXT NOT NULL, payout_item_id TEXT UNIQUE NOT NULL,
        transaction_id TEXT UNIQUE, activity_id TEXT UNIQUE, recipient_email TEXT NOT NULL,
        amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
        provider_timestamp TEXT NOT NULL, raw_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        ingested_at TEXT, last_reconciled_at TEXT, reconciliation_run_id TEXT
      );
      CREATE INDEX IF NOT EXISTS payout_items_status_time ON payout_items(status,provider_timestamp);
      CREATE TABLE IF NOT EXISTS provider_spend (
        evidence_id TEXT PRIMARY KEY, payment_key TEXT NOT NULL, amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL, status TEXT NOT NULL, provider_timestamp TEXT NOT NULL,
        UNIQUE(payment_key,status,provider_timestamp)
      );
      CREATE INDEX IF NOT EXISTS provider_spend_window ON provider_spend(currency,status,provider_timestamp);
      CREATE TABLE IF NOT EXISTS reconciliation_state (id INTEGER PRIMARY KEY CHECK(id=1), last_success_at TEXT);
      CREATE TABLE IF NOT EXISTS reconciliation_runs (
        run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, completed_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
        batches_read INTEGER NOT NULL DEFAULT 0, items_recorded INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
        discrepancy_id TEXT PRIMARY KEY, payment_id TEXT, type TEXT NOT NULL,
        details_json TEXT NOT NULL, detected_at TEXT NOT NULL, resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS invoice_evidence (
        internal_invoice_id TEXT PRIMARY KEY, paypal_invoice_id TEXT UNIQUE, invoice_number TEXT,
        status TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
        job_ids_json TEXT NOT NULL, evidence_class TEXT NOT NULL, endpoint TEXT NOT NULL,
        retrieved_at TEXT NOT NULL, environment TEXT NOT NULL, raw_json TEXT NOT NULL, integrity_sha256 TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS financial_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
        actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, action TEXT NOT NULL,
        resource_id TEXT, previous_state TEXT, new_state TEXT, correlation_id TEXT,
        request_metadata_json TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS financial_audit_no_update BEFORE UPDATE ON financial_audit
      BEGIN SELECT RAISE(ABORT,'immutable financial audit'); END;
      CREATE TRIGGER IF NOT EXISTS financial_audit_no_delete BEFORE DELETE ON financial_audit
      BEGIN SELECT RAISE(ABORT,'immutable financial audit'); END;
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fee_estimates (
        payment_id TEXT PRIMARY KEY REFERENCES payments(payment_id), policy_id TEXT NOT NULL,
        policy_version INTEGER NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        estimated_fee_minor INTEGER NOT NULL CHECK(estimated_fee_minor >= 0), currency TEXT NOT NULL,
        method TEXT NOT NULL, formula TEXT NOT NULL, source_url TEXT NOT NULL, source_retrieved_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_fee_evidence (
        payment_id TEXT PRIMARY KEY REFERENCES payments(payment_id), reported_fee_minor INTEGER NOT NULL CHECK(reported_fee_minor >= 0),
        currency TEXT NOT NULL, fee_payer TEXT NOT NULL, source TEXT NOT NULL, source_version TEXT,
        source_batch_id TEXT, source_item_id TEXT, is_provider_estimate INTEGER NOT NULL,
        environment TEXT NOT NULL, observed_at TEXT NOT NULL, raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS financial_control (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_runs (
        run_id TEXT PRIMARY KEY, kind TEXT NOT NULL, plan_id TEXT, requested_by TEXT NOT NULL,
        actor_role TEXT NOT NULL, policy_version INTEGER NOT NULL, started_at TEXT NOT NULL,
        completed_at TEXT, status TEXT NOT NULL, note TEXT
      );
      CREATE TABLE IF NOT EXISTS execution_run_payments (
        run_id TEXT NOT NULL REFERENCES execution_runs(run_id), payment_id TEXT NOT NULL REFERENCES payments(payment_id),
        ordinal INTEGER NOT NULL, PRIMARY KEY(run_id, payment_id), UNIQUE(payment_id)
      );
      CREATE TABLE IF NOT EXISTS confirmation_jobs (
        payment_id TEXT PRIMARY KEY REFERENCES payments(payment_id), attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL, last_error TEXT, state TEXT NOT NULL DEFAULT 'scheduled', updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS confirmation_due ON confirmation_jobs(state, next_attempt_at);
      CREATE TRIGGER IF NOT EXISTS payments_origin_insert BEFORE INSERT ON payments
      WHEN NEW.record_origin NOT IN ('application')
      BEGIN SELECT RAISE(ABORT,'demonstration records cannot hold a payment identity'); END;
      CREATE TRIGGER IF NOT EXISTS payments_no_demo_submit BEFORE UPDATE ON payments
      WHEN NEW.record_origin <> 'application' AND NEW.status IN ('submitted','pending','awaiting_confirmation','provider_confirmed')
      BEGIN SELECT RAISE(ABORT,'demonstration records cannot be submitted to PayPal'); END;
    `);
    const paymentColumns = (this.db.prepare("PRAGMA table_info(payments)").all() as Row[]).map((row) => String(row.name));
    if (!paymentColumns.includes("record_origin")) this.db.exec("ALTER TABLE payments ADD COLUMN record_origin TEXT NOT NULL DEFAULT 'application'");
    if (!paymentColumns.includes("execution_run_id")) this.db.exec("ALTER TABLE payments ADD COLUMN execution_run_id TEXT");
    const payoutColumns = (this.db.prepare("PRAGMA table_info(payout_items)").all() as Row[]).map((row) => String(row.name));
    for (const column of ["ingested_at", "last_reconciled_at", "reconciliation_run_id"]) {
      if (!payoutColumns.includes(column)) this.db.exec(`ALTER TABLE payout_items ADD COLUMN ${column} TEXT`);
    }
    const attemptColumns = (this.db.prepare("PRAGMA table_info(execution_attempts)").all() as Row[]).map((row) => String(row.name));
    if (!attemptColumns.includes("payout_batch_id")) this.db.exec("ALTER TABLE execution_attempts ADD COLUMN payout_batch_id TEXT");
  }
  path(): string { return this.dbPath; }
  close(): void { this.db.close(); }
  private audit(actor: FinancialActor | "system", action: string, resourceId: string | null, previous: unknown, next: unknown, at: string, correlationId: string = randomUUID()): void {
    this.db.prepare(`INSERT INTO financial_audit(event_id,actor_id,actor_role,action,resource_id,previous_state,new_state,correlation_id,request_metadata_json,at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), actor === "system" ? "system" : actor.actorId, actor === "system" ? "system" : actor.role,
      action, resourceId, previous === undefined ? null : JSON.stringify(previous), next === undefined ? null : JSON.stringify(next), correlationId, "{}", at);
  }
  private tx<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private owner(actor: FinancialActor): void { if (actor.role !== "owner") throw new Error("only an owner may perform this financial operation"); }
  verifyRecipient(opts: { recipientId: string; email: string; actor: FinancialActor; at: string }): void {
    this.owner(opts.actor);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.email)) throw new Error("invalid recipient email");
    this.tx(() => {
      this.db.prepare("INSERT INTO recipients VALUES(?,?,?,?)").run(opts.recipientId, opts.email, opts.actor.actorId, opts.at);
      this.audit(opts.actor, "recipient_verified", opts.recipientId, null, { email: opts.email }, opts.at);
    });
  }
  getRecipient(id: string): { recipientId: string; email: string; verifiedBy: string; verifiedAt: string } | null {
    const row = this.db.prepare("SELECT * FROM recipients WHERE recipient_id=?").get(id) as Row | undefined;
    return row ? { recipientId: id, email: String(row.email), verifiedBy: String(row.verified_by), verifiedAt: String(row.verified_at) } : null;
  }
  updatePolicy(opts: { capCents: number; perPaymentCapCents: number; freshnessSeconds: number; actor: FinancialActor; at: string }): number {
    this.owner(opts.actor);
    if (!Number.isSafeInteger(opts.capCents) || opts.capCents < 0) throw new Error("cap must be non-negative integer minor units");
    cents(opts.perPaymentCapCents, "per-payment cap"); cents(opts.freshnessSeconds, "freshness threshold");
    return this.tx(() => {
      const previous = this.getPolicy();
      const result = this.db.prepare("INSERT INTO owner_policies(cap_cents,per_payment_cap_cents,freshness_seconds,window_hours,currency,actor_id,effective_at) VALUES(?,?,?,168,?,?,?)")
        .run(opts.capCents, opts.perPaymentCapCents, opts.freshnessSeconds, "USD", opts.actor.actorId, opts.at);
      const version = Number(result.lastInsertRowid);
      this.audit(opts.actor, "policy_changed", String(version), previous, opts, opts.at);
      return version;
    });
  }
  getPolicy(): { version: number; capCents: number; perPaymentCapCents: number; freshnessSeconds: number; currency: string; windowHours: number; effectiveAt: string } {
    const row = this.db.prepare("SELECT * FROM owner_policies ORDER BY version DESC LIMIT 1").get() as Row;
    return { version: Number(row.version), capCents: Number(row.cap_cents), perPaymentCapCents: Number(row.per_payment_cap_cents), freshnessSeconds: Number(row.freshness_seconds), currency: String(row.currency), windowHours: Number(row.window_hours), effectiveAt: String(row.effective_at) };
  }
  approvePayment(opts: { jobId: string; recipientId: string; requestedRecipientEmail?: string; amountCents: number; currency: string; actor: FinancialActor; at: string }): string {
    this.owner(opts.actor); cents(opts.amountCents, "payment amount");
    if (opts.currency !== "USD") throw new Error("unsupported currency: this policy is USD-only");
    const recipient = this.getRecipient(opts.recipientId);
    if (!recipient) throw new Error("recipient is not owner-verified");
    if (opts.requestedRecipientEmail !== undefined && opts.requestedRecipientEmail !== recipient.email) throw new Error("recipient substitution is prohibited");
    if (opts.amountCents > this.getPolicy().perPaymentCapCents) throw new Error("amount exceeds per-payment cap");
    return this.tx(() => {
      if (this.getPaymentByJob(opts.jobId)) throw new Error("job already has a permanent payment identity");
      const paymentId = randomUUID();
      this.db.prepare(`INSERT INTO payments(payment_id,job_id,idempotency_key,recipient_id,recipient_email,amount_cents,currency,policy_version,status,approved_by,approved_at,record_origin)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'application')`).run(paymentId, opts.jobId, `settle-payment-${opts.jobId}`, opts.recipientId, recipient.email,
        opts.amountCents, opts.currency, this.getPolicy().version, "approved", opts.actor.actorId, opts.at);
      this.audit(opts.actor, "payment_approved", paymentId, null, { jobId: opts.jobId, recipient: recipient.email, amountCents: opts.amountCents }, opts.at);
      return paymentId;
    });
  }
  reservePayment(opts: { jobId: string; at: string }): { paymentId: string; idempotencyKey: string; status: string } {
    if (this.isEmergencyStopped()) throw new Error("EMERGENCY_STOP: the owner emergency stop is active; no new payment may be reserved or submitted");
    return this.tx(() => {
      const summary = this.getCapSummary(opts.at);
      if (!summary.fresh) throw new Error("provider reconciliation is stale; new payouts are refused");
      const payment = this.getPaymentByJob(opts.jobId);
      if (!payment) throw new Error("payment is not owner-approved");
      if (payment.recordOrigin !== "application") {
        throw new Error("DEMO_RECORD_NOT_PAYABLE: this record is a seeded or synthetic demonstration record; it cannot be reserved or paid");
      }
      if (["reserved", "submitted", "outcome_unknown", "pending", "unclaimed", "onhold", "provider_confirmed"].includes(payment.status)) return { paymentId: payment.paymentId, idempotencyKey: payment.idempotencyKey, status: payment.status };
      if (payment.status !== "approved") throw new Error(`payment cannot be reserved from ${payment.status}`);
      if (payment.amountCents > summary.remainingCents) throw new Error("CAP_EXCEEDED: committed spend plus active reservations plus proposal exceeds owner cap");
      this.db.prepare("UPDATE payments SET status='reserved',reserved_at=? WHERE payment_id=? AND status='approved'").run(opts.at, payment.paymentId);
      this.audit("system", "payment_reserved", payment.paymentId, payment.status, "reserved", opts.at, payment.idempotencyKey);
      return { paymentId: payment.paymentId, idempotencyKey: payment.idempotencyKey, status: "reserved" };
    });
  }
  getCapSummary(at: string) {
    const policy = this.getPolicy(); const now = iso(at); const start = new Date(now - policy.windowHours * 3600000).toISOString();
    const rows = this.db.prepare("SELECT payment_key,status,amount_cents FROM provider_spend WHERE currency='USD' AND provider_timestamp>=? AND provider_timestamp<=?").all(start, at) as Row[];
    const byPayment = new Map<string, { success: number; adjustments: number }>();
    for (const row of rows) {
      const current = byPayment.get(String(row.payment_key)) ?? { success: 0, adjustments: 0 };
      if (row.status === "SUCCESS") current.success += Number(row.amount_cents);
      if (["RETURNED", "REVERSED", "REFUNDED"].includes(String(row.status))) current.adjustments += Number(row.amount_cents);
      byPayment.set(String(row.payment_key), current);
    }
    const confirmedSpendCents = [...byPayment.values()].reduce((sum, value) => sum + value.success, 0);
    const adjustmentsCents = [...byPayment.values()].reduce((sum, value) => sum + Math.min(value.success, value.adjustments), 0);
    const eligibleSpendCents = [...byPayment.values()].reduce((sum, value) => sum + Math.max(0, value.success - value.adjustments), 0);
    const activeReservationsCents = Number((this.db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status IN ('reserved','submitted','outcome_unknown','pending','unclaimed','onhold')").get() as Row).total);
    const last = this.db.prepare("SELECT last_success_at FROM reconciliation_state WHERE id=1").get() as Row | undefined;
    const lastSuccessfulReconciliation = last?.last_success_at ? String(last.last_success_at) : null;
    const fresh = lastSuccessfulReconciliation !== null && now - iso(lastSuccessfulReconciliation) <= policy.freshnessSeconds * 1000 && now >= iso(lastSuccessfulReconciliation);
    return { windowStart: start, windowEnd: at, confirmedSpendCents, adjustmentsCents, eligibleSpendCents, activeReservationsCents, remainingCents: Math.max(0, policy.capCents - eligibleSpendCents - activeReservationsCents), lastSuccessfulReconciliation, fresh, policyVersion: policy.version, currency: "USD" };
  }
  markReconciled(at: string): void {
    iso(at);
    this.db.prepare("INSERT INTO reconciliation_state(id,last_success_at) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_success_at=excluded.last_success_at").run(at);
  }
  beginReconciliation(at: string): string {
    iso(at);
    const runId = randomUUID();
    this.db.prepare("INSERT INTO reconciliation_runs(run_id,started_at,status) VALUES(?,?,'running')").run(runId, at);
    return runId;
  }
  completeReconciliation(runId: string, at: string, batchesRead: number, itemsRecorded: number): void {
    iso(at);
    if (!Number.isSafeInteger(batchesRead) || batchesRead < 0 || !Number.isSafeInteger(itemsRecorded) || itemsRecorded < 0) throw new Error("invalid reconciliation counts");
    this.tx(() => {
      const result = this.db.prepare("UPDATE reconciliation_runs SET completed_at=?,status='succeeded',batches_read=?,items_recorded=? WHERE run_id=? AND status='running'").run(at, batchesRead, itemsRecorded, runId);
      if (result.changes !== 1) throw new Error("unknown or completed reconciliation run");
      this.markReconciled(at);
      this.audit("system", "reconciliation_completed", runId, "running", { status: "succeeded", batchesRead, itemsRecorded }, at, runId);
    });
  }
  failReconciliation(runId: string, at: string): void {
    this.db.prepare("UPDATE reconciliation_runs SET completed_at=?,status='failed' WHERE run_id=? AND status='running'").run(at, runId);
  }
  getReconciliationRun(runId: string): Row | null {
    const row = this.db.prepare("SELECT * FROM reconciliation_runs WHERE run_id=?").get(runId) as Row | undefined;
    return row ? { runId: String(row.run_id), startedAt: String(row.started_at), completedAt: row.completed_at ? String(row.completed_at) : null, status: String(row.status), batchesRead: Number(row.batches_read), itemsRecorded: Number(row.items_recorded) } : null;
  }
  recordProviderSpend(opts: { paymentKey: string; amountCents: number; currency: string; status: string; providerTimestamp: string }): void {
    cents(opts.amountCents, "provider amount"); iso(opts.providerTimestamp);
    if (opts.currency !== "USD") throw new Error("mixed currencies are not supported by this cap policy");
    this.db.prepare("INSERT INTO provider_spend VALUES(?,?,?,?,?,?)").run(randomUUID(), opts.paymentKey, opts.amountCents, opts.currency, opts.status, opts.providerTimestamp);
  }
  beginSubmission(paymentId: string, at: string): { attemptId: string; senderBatchId: string } {
    if (this.isEmergencyStopped()) throw new Error("EMERGENCY_STOP: the owner emergency stop is active; no new submission may begin");
    return this.tx(() => {
      const origin = this.db.prepare("SELECT record_origin FROM payments WHERE payment_id=?").get(paymentId) as Row | undefined;
      if (origin && String(origin.record_origin) !== "application") {
        throw new Error("DEMO_RECORD_NOT_PAYABLE: this record is a demonstration record; it cannot be submitted");
      }
      const payment = this.db.prepare("SELECT * FROM payments WHERE payment_id=?").get(paymentId) as Row | undefined;
      if (!payment || payment.status !== "reserved") throw new Error(`SUBMISSION_CONFLICT: payment is ${String(payment?.status ?? "missing")}, not reserved`);
      const existing = this.db.prepare("SELECT * FROM execution_attempts WHERE payment_id=?").get(paymentId) as Row | undefined;
      if (existing) throw new Error("SUBMISSION_CONFLICT: execution attempt already exists");
      const attemptId = randomUUID(); const senderBatchId = String(payment.idempotency_key);
      this.db.prepare("INSERT INTO execution_attempts(attempt_id,payment_id,sender_batch_id,started_at,status,last_error,payout_batch_id) VALUES(?,?,?,?,?,?,?)").run(attemptId, paymentId, senderBatchId, at, "submitting", null, null);
      this.db.prepare("UPDATE payments SET status='submitted',submitted_at=? WHERE payment_id=?").run(at, paymentId);
      this.audit("system", "payment_submitted", paymentId, payment.status, "submitted", at, senderBatchId);
      return { attemptId, senderBatchId };
    });
  }
  recordAttemptBatchId(attemptId: string, payoutBatchId: string): void {
    this.db.prepare("UPDATE execution_attempts SET payout_batch_id=? WHERE attempt_id=?").run(payoutBatchId, attemptId);
  }
  getAttemptBatchId(paymentId: string): string | null {
    const row = this.db.prepare("SELECT payout_batch_id FROM execution_attempts WHERE payment_id=?").get(paymentId) as Row | undefined;
    return row?.payout_batch_id ? String(row.payout_batch_id) : null;
  }
  markProcessing(attemptId: string, payoutBatchId: string | null, reason: string, at: string): void {
    this.tx(() => {
      const attempt = this.db.prepare("SELECT payment_id, status FROM execution_attempts WHERE attempt_id=?").get(attemptId) as Row | undefined;
      if (!attempt) throw new Error("unknown execution attempt");
      this.db.prepare("UPDATE execution_attempts SET status='pending',payout_batch_id=COALESCE(?,payout_batch_id),last_error=? WHERE attempt_id=?").run(payoutBatchId, reason, attemptId);
      const payment = this.db.prepare("SELECT status FROM payments WHERE payment_id=?").get(String(attempt.payment_id)) as Row | undefined;
      this.db.prepare("UPDATE payments SET status='pending',failure_reason=? WHERE payment_id=?").run(reason, String(attempt.payment_id));
      this.audit("system", "payment_processing", String(attempt.payment_id), payment?.status ?? null, "pending", at, payoutBatchId ?? undefined);
    });
  }
  listReconcilableAttempts(at: string = new Date().toISOString()): ReconcilableAttempt[] {
    const policy = this.getPolicy();
    const now = iso(at);
    const windowStart = new Date(now - policy.windowHours * 3600000).toISOString();
    const rows = this.db.prepare(`
      SELECT
        p.payment_id, p.job_id, p.idempotency_key, p.recipient_email, p.amount_cents, p.currency, p.status AS payment_status,
        ea.attempt_id, ea.sender_batch_id, COALESCE(ea.payout_batch_id, pi.payout_batch_id) AS payout_batch_id, ea.status AS attempt_status
      FROM payments p
      JOIN execution_attempts ea ON ea.payment_id = p.payment_id
      LEFT JOIN payout_items pi ON pi.payment_id = p.payment_id
      WHERE p.status IN ('submitted', 'outcome_unknown', 'awaiting_confirmation', 'pending', 'unclaimed', 'onhold', 'reconciliation_required')
         OR (p.status IN ('provider_confirmed', 'failed', 'blocked', 'returned', 'reversed', 'refunded')
             AND (pi.last_reconciled_at IS NULL OR COALESCE(pi.provider_timestamp, p.submitted_at, p.reserved_at) >= ?))
      ORDER BY ea.started_at ASC
    `).all(windowStart) as Row[];
    return rows.map((row) => ({
      paymentId: String(row.payment_id),
      attemptId: String(row.attempt_id),
      senderBatchId: String(row.sender_batch_id),
      payoutBatchId: row.payout_batch_id ? String(row.payout_batch_id) : null,
      jobId: String(row.job_id),
      idempotencyKey: String(row.idempotency_key),
      recipientEmail: String(row.recipient_email),
      amountCents: Number(row.amount_cents),
      currency: String(row.currency),
      paymentStatus: String(row.payment_status),
      attemptStatus: String(row.attempt_status),
    }));
  }
  markOutcomeUnknown(attemptId: string, reason: string, at: string): void {
    this.tx(() => {
      const attempt = this.db.prepare("SELECT payment_id FROM execution_attempts WHERE attempt_id=?").get(attemptId) as Row | undefined;
      if (!attempt) throw new Error("unknown execution attempt");
      this.db.prepare("UPDATE execution_attempts SET status='outcome_unknown',last_error=? WHERE attempt_id=?").run(reason, attemptId);
      this.db.prepare("UPDATE payments SET status='outcome_unknown',failure_reason=? WHERE payment_id=?").run(reason, String(attempt.payment_id));
      this.audit("system", "outcome_unknown", String(attempt.payment_id), "submitted", "outcome_unknown", at);
    });
  }
  recoverSubmission(paymentId: string): { status: string; idempotencyKey: string; senderBatchId: string } {
    const payment = this.db.prepare("SELECT * FROM payments WHERE payment_id=?").get(paymentId) as Row | undefined;
    const attempt = this.db.prepare("SELECT * FROM execution_attempts WHERE payment_id=?").get(paymentId) as Row | undefined;
    if (!payment || !attempt) throw new Error("no durable submission to recover");
    return { status: String(payment.status), idempotencyKey: String(payment.idempotency_key), senderBatchId: String(attempt.sender_batch_id) };
  }
  /** Apply one provider item fact.
   *
   * Provider events arrive by poll, by webhook, by reconciliation and by retry,
   * and they do not arrive in order. The stored fact therefore wins over an
   * older one, a duplicate is a no-op, and a terminal SUCCESS cannot be
   * regressed to PENDING by a late event. Every ignored event is audited with
   * its reason, so "ignored" is never silent.
   */
  recordPayoutItem(opts: {
    paymentId: string; senderBatchId: string; payoutBatchId: string; payoutItemId: string;
    transactionId: string | null; activityId: string | null; recipientEmail: string; amountCents: number;
    currency: string; status: string; providerTimestamp: string; raw: Row;
    reconciliationRunId?: string; reconciledAt?: string; environment?: "sandbox" | "production";
  }): { applied: boolean; reason: string } {
    const supported = ["SUCCESS", "FAILED", "PENDING", "UNCLAIMED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"];
    if (!supported.includes(opts.status)) throw new Error("unsupported provider item status");
    iso(opts.providerTimestamp);
    const payment = this.db.prepare("SELECT * FROM payments WHERE payment_id=?").get(opts.paymentId) as Row | undefined;
    if (!payment) throw new Error("provider item has no internal payment");
    // A provider mismatch is a durable discrepancy, not a payment fact.
    // Record it outside the item transaction so the subsequent refusal
    // cannot roll the discrepancy back with the rejected item update.
    if (payment.recipient_email !== opts.recipientEmail || Number(payment.amount_cents) !== opts.amountCents || payment.currency !== opts.currency) {
      this.recordDiscrepancy({
        paymentId: opts.paymentId,
        type: "PROVIDER_FACT_MISMATCH",
        details: {
          payoutBatchId: opts.payoutBatchId,
          payoutItemId: opts.payoutItemId,
          expectedRecipient: payment.recipient_email,
          actualRecipient: opts.recipientEmail,
          expectedAmountCents: Number(payment.amount_cents),
          actualAmountCents: opts.amountCents,
          expectedCurrency: payment.currency,
          actualCurrency: opts.currency,
        },
        at: opts.providerTimestamp,
      });
      throw new Error("provider recipient, amount or currency mismatch");
    }
    const existing = this.db.prepare("SELECT * FROM payout_items WHERE payment_id=?").get(opts.paymentId) as Row | undefined;
    const incomingState = PROVIDER_ITEM_STATE[opts.status];
    if (existing) {
      if (String(existing.payout_item_id) !== opts.payoutItemId) {
        this.recordDiscrepancy({
          paymentId: opts.paymentId,
          type: "PROVIDER_ITEM_MISMATCH",
          details: { storedPayoutItemId: String(existing.payout_item_id), incomingPayoutItemId: opts.payoutItemId },
          at: opts.providerTimestamp,
        });
        throw new Error("provider item id does not match the item already stored for this payment");
      }
      const storedStatus = String(existing.status);
      const storedAt = iso(String(existing.provider_timestamp));
      const incomingAt = iso(opts.providerTimestamp);
      const storedRank = providerStatusRank(storedStatus);
      const incomingRank = providerStatusRank(opts.status);
      const reobserve = (): void => {
        if (!opts.reconciliationRunId) return;
        const observedAt = opts.reconciledAt ?? opts.providerTimestamp;
        this.db.prepare("UPDATE payout_items SET last_reconciled_at=?,reconciliation_run_id=? WHERE payment_id=?")
          .run(observedAt, opts.reconciliationRunId, opts.paymentId);
        this.audit("system", "provider_item_reobserved", opts.paymentId, storedStatus, opts.status, observedAt, opts.reconciliationRunId);
      };
      if (storedStatus === opts.status && (existing.transaction_id ?? null) === (opts.transactionId ?? null)) {
        reobserve();
        return { applied: false, reason: "duplicate_event" };
      }
      // Rank, not wall-clock order, decides whether a fact is newer. A provider
      // timestamp is the tie-breaker inside one rank.
      if (incomingRank < storedRank) {
        reobserve();
        const reason = incomingAt < storedAt ? "stale_provider_timestamp" : "provider_state_regressed";
        this.audit("system", "provider_item_update_ignored", opts.paymentId, storedStatus, opts.status, opts.providerTimestamp, opts.payoutItemId);
        return { applied: false, reason };
      }
      if (incomingRank === storedRank && incomingAt <= storedAt) {
        reobserve();
        return { applied: false, reason: "duplicate_event" };
      }
    }
    const feeMinor = extractPayoutItemFeeCents(opts.raw);
    this.tx(() => {
      const ingestedAt = new Date().toISOString();
      this.db.prepare(`INSERT INTO payout_items(payment_id,sender_batch_id,payout_batch_id,payout_item_id,transaction_id,activity_id,recipient_email,amount_cents,currency,status,provider_timestamp,raw_json,updated_at,ingested_at,last_reconciled_at,reconciliation_run_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(payment_id) DO UPDATE SET status=excluded.status,transaction_id=COALESCE(excluded.transaction_id,payout_items.transaction_id),activity_id=COALESCE(excluded.activity_id,payout_items.activity_id),provider_timestamp=excluded.provider_timestamp,raw_json=excluded.raw_json,updated_at=excluded.updated_at,
        last_reconciled_at=COALESCE(excluded.last_reconciled_at,payout_items.last_reconciled_at),reconciliation_run_id=COALESCE(excluded.reconciliation_run_id,payout_items.reconciliation_run_id)`)
        .run(opts.paymentId, opts.senderBatchId, opts.payoutBatchId, opts.payoutItemId, opts.transactionId, opts.activityId, opts.recipientEmail, opts.amountCents, opts.currency, opts.status, opts.providerTimestamp, JSON.stringify(opts.raw), ingestedAt, ingestedAt, opts.reconciliationRunId ? (opts.reconciledAt ?? ingestedAt) : null, opts.reconciliationRunId ?? null);
      const next = incomingState ?? "submitted";
      this.db.prepare("UPDATE payments SET status=?,confirmed_at=CASE WHEN ?='SUCCESS' THEN ? ELSE confirmed_at END,failure_reason=CASE WHEN ?='SUCCESS' THEN NULL WHEN ?='FAILED' THEN failure_reason ELSE failure_reason END WHERE payment_id=?")
        .run(next, opts.status, opts.providerTimestamp, opts.status, opts.status, opts.paymentId);
      const attemptStatus = opts.status === "SUCCESS" ? "settled" : opts.status === "FAILED" ? "failed" : opts.status.toLowerCase();
      this.db.prepare("UPDATE execution_attempts SET status=?,payout_batch_id=COALESCE(payout_batch_id,?),last_error=CASE WHEN ?='settled' THEN NULL ELSE last_error END WHERE payment_id=?")
        .run(attemptStatus, opts.payoutBatchId, attemptStatus, opts.paymentId);
      if (opts.status === "SUCCESS" || ["RETURNED", "REVERSED", "REFUNDED"].includes(opts.status)) {
        this.db.prepare("INSERT OR IGNORE INTO provider_spend VALUES(?,?,?,?,?,?)").run(randomUUID(), opts.paymentId, opts.amountCents, opts.currency, opts.status, opts.providerTimestamp);
      }
      if (feeMinor !== null) {
        this.db.prepare(`INSERT INTO provider_fee_evidence(payment_id,reported_fee_minor,currency,fee_payer,source,source_version,source_batch_id,source_item_id,is_provider_estimate,environment,observed_at,raw_json)
          VALUES(?,?,?,'sender','payout_item_fee','payouts-v1',?,?,1,?,?,?) ON CONFLICT(payment_id) DO UPDATE SET reported_fee_minor=excluded.reported_fee_minor,currency=excluded.currency,observed_at=excluded.observed_at,raw_json=excluded.raw_json`)
          .run(opts.paymentId, feeMinor, opts.currency, opts.payoutBatchId, opts.payoutItemId, opts.environment ?? "sandbox", opts.providerTimestamp, JSON.stringify(opts.raw));
      }
      if (isTerminal(next)) {
        this.db.prepare("UPDATE confirmation_jobs SET state='done',updated_at=? WHERE payment_id=?").run(ingestedAt, opts.paymentId);
      }
      this.audit("system", "provider_item_updated", opts.paymentId, String(payment.status), next, opts.providerTimestamp, opts.payoutItemId);
    });
    return { applied: true, reason: "applied" };
  }
  listRecipients(): Array<{ recipientId: string; email: string; verifiedBy: string; verifiedAt: string }> {
    const rows = this.db.prepare("SELECT * FROM recipients ORDER BY verified_at").all() as Row[];
    return rows.map((row) => ({ recipientId: String(row.recipient_id), email: String(row.email), verifiedBy: String(row.verified_by), verifiedAt: String(row.verified_at) }));
  }
  getPayoutItem(paymentId: string): PayoutItem | null {
    const row = this.db.prepare("SELECT * FROM payout_items WHERE payment_id=?").get(paymentId) as Row | undefined;
    if (!row) return null;
    const raw = JSON.parse(String(row.raw_json));
    return { paymentId, senderBatchId: String(row.sender_batch_id), payoutBatchId: String(row.payout_batch_id), payoutItemId: String(row.payout_item_id), transactionId: row.transaction_id ? String(row.transaction_id) : null, activityId: row.activity_id ? String(row.activity_id) : null, status: String(row.status), providerTimestamp: String(row.provider_timestamp), ingestedAt: row.ingested_at ? String(row.ingested_at) : null, lastReconciledAt: row.last_reconciled_at ? String(row.last_reconciled_at) : null, reconciliationRunId: row.reconciliation_run_id ? String(row.reconciliation_run_id) : null, feeCents: extractPayoutItemFeeCents(raw), raw };
  }
  getPaymentByJob(jobId: string): FinancialPayment | null {
    const row = this.db.prepare("SELECT * FROM payments WHERE job_id=?").get(jobId) as Row | undefined;
    return row ? this.paymentRow(row) : null;
  }
  getPaymentByIdempotency(key: string): FinancialPayment | null {
    const row = this.db.prepare("SELECT * FROM payments WHERE idempotency_key=?").get(key) as Row | undefined;
    return row ? this.paymentRow(row) : null;
  }
  private paymentRow(row: Row) {
    return { paymentId: String(row.payment_id), jobId: String(row.job_id), idempotencyKey: String(row.idempotency_key), recipientEmail: String(row.recipient_email), amountCents: Number(row.amount_cents), currency: String(row.currency), policyVersion: Number(row.policy_version), status: String(row.status), approvedBy: String(row.approved_by), approvedAt: String(row.approved_at), reservedAt: row.reserved_at ? String(row.reserved_at) : null, submittedAt: row.submitted_at ? String(row.submitted_at) : null, confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null, failureReason: row.failure_reason ? String(row.failure_reason) : null, recordOrigin: row.record_origin ? String(row.record_origin) : "application", executionRunId: row.execution_run_id ? String(row.execution_run_id) : null };
  }
  recordDiscrepancy(opts: { paymentId: string | null; type: string; details: Row; at: string }): string {
    // Reconciliation is read-only from the provider and may repeat the same
    // unresolved fact. A stable identity makes discrepancy recording
    // idempotent across polls, retries and restarts.
    const id = createHash("sha256")
      .update(canonical({ paymentId: opts.paymentId, type: opts.type, details: opts.details }))
      .digest("hex");
    const result = this.db.prepare("INSERT OR IGNORE INTO reconciliation_discrepancies VALUES(?,?,?,?,?,NULL)")
      .run(id, opts.paymentId, opts.type, JSON.stringify(opts.details), opts.at);
    if (result.changes > 0) this.audit("system", "reconciliation_discrepancy", opts.paymentId, null, { type: opts.type, ...opts.details }, opts.at);
    return id;
  }
  getDiscrepancies(): Row[] { return this.db.prepare("SELECT * FROM reconciliation_discrepancies WHERE resolved_at IS NULL ORDER BY detected_at").all() as Row[]; }
  recordInvoiceEvidence(opts: { internalInvoiceId: string; paypalInvoiceId: string | null; invoiceNumber: string | null; status: string; amountCents: number; currency: string; jobIds: string[]; endpoint: string; retrievedAt: string; raw: Row }): void {
    const raw = JSON.stringify(opts.raw);
    const sha = createHash("sha256").update(raw).digest("hex");
    this.db.prepare(`INSERT INTO invoice_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(internal_invoice_id) DO UPDATE SET paypal_invoice_id=excluded.paypal_invoice_id,invoice_number=excluded.invoice_number,status=excluded.status,retrieved_at=excluded.retrieved_at,raw_json=excluded.raw_json,integrity_sha256=excluded.integrity_sha256`)
      .run(opts.internalInvoiceId, opts.paypalInvoiceId, opts.invoiceNumber, opts.status, opts.amountCents, opts.currency,
        JSON.stringify(opts.jobIds), "PAYPAL_INVOICE_OBJECT", opts.endpoint, opts.retrievedAt, "sandbox", raw, sha);
    this.audit("system", "invoice_evidence_retrieved", opts.internalInvoiceId, null, { paypalInvoiceId: opts.paypalInvoiceId, status: opts.status }, opts.retrievedAt);
  }
  listInvoicedJobIds(): string[] {
    const rows = this.db.prepare("SELECT job_ids_json FROM invoice_evidence").all() as Row[];
    const ids = new Set<string>();
    for (const row of rows) for (const id of JSON.parse(String(row.job_ids_json)) as string[]) ids.add(id);
    return [...ids];
  }
  getInvoice(id: string): Row | null {
    const row = this.db.prepare("SELECT * FROM invoice_evidence WHERE internal_invoice_id=?").get(id) as Row | undefined;
    return row ? { internalInvoiceId: id, paypalInvoiceId: row.paypal_invoice_id ? String(row.paypal_invoice_id) : null, invoiceNumber: row.invoice_number ? String(row.invoice_number) : null, status: String(row.status), amountCents: Number(row.amount_cents), currency: String(row.currency), jobIds: JSON.parse(String(row.job_ids_json)), evidenceClass: String(row.evidence_class), endpoint: String(row.endpoint), retrievedAt: String(row.retrieved_at), environment: String(row.environment), integritySha256: String(row.integrity_sha256), raw: JSON.parse(String(row.raw_json)) as Row } : null;
  }
  /** A definite provider refusal (4xx that is not a timeout or rate limit):
   * no money moved, so the payment is failed and can be re-approved later. */
  markSubmissionFailed(attemptId: string, reason: string, at: string): void {
    this.tx(() => {
      const attempt = this.db.prepare("SELECT payment_id FROM execution_attempts WHERE attempt_id=?").get(attemptId) as Row | undefined;
      if (!attempt) throw new Error("unknown execution attempt");
      const payment = this.db.prepare("SELECT status FROM payments WHERE payment_id=?").get(String(attempt.payment_id)) as Row;
      this.db.prepare("UPDATE execution_attempts SET status='failed',last_error=? WHERE attempt_id=?").run(reason, attemptId);
      this.db.prepare("UPDATE payments SET status='failed',failure_reason=? WHERE payment_id=?").run(reason, String(attempt.payment_id));
      this.audit("system", "payment_submission_refused", String(attempt.payment_id), String(payment.status), "failed", at);
    });
  }

  /** PayPal accepted the batch but has not settled the item yet. */
  markAwaitingConfirmation(attemptId: string, payoutBatchId: string, at: string): void {
    this.tx(() => {
      const attempt = this.db.prepare("SELECT payment_id FROM execution_attempts WHERE attempt_id=?").get(attemptId) as Row | undefined;
      if (!attempt) throw new Error("unknown execution attempt");
      const payment = this.db.prepare("SELECT status FROM payments WHERE payment_id=?").get(String(attempt.payment_id)) as Row;
      this.db.prepare("UPDATE execution_attempts SET status='awaiting_confirmation',payout_batch_id=COALESCE(payout_batch_id,?) WHERE attempt_id=?").run(payoutBatchId, attemptId);
      this.db.prepare("UPDATE payments SET status='awaiting_confirmation' WHERE payment_id=? AND status NOT IN ('pending','unclaimed','onhold','provider_confirmed','failed','blocked','returned','reversed','refunded')").run(String(attempt.payment_id));
      this.audit("system", "payment_awaiting_confirmation", String(attempt.payment_id), String(payment.status), "awaiting_confirmation", at, payoutBatchId);
    });
  }

  /** Aggregates for the financial projection. Every figure names a payment
   * origin, so demonstration records can never be added to operational money. */
  metrics(): {
    lifetimeConfirmedMinor: number;
    lifetimeReturnedMinor: number;
    confirmedCount: number;
    unreconciledConfirmedCount: number;
    pendingMinor: number;
    awaitingConfirmationMinor: number;
    failedMinor: number;
    outcomeUnknownMinor: number;
    reconciliationRequiredMinor: number;
    activeReservationMinor: number;
    feeEstimateMinor: number;
    providerFeeMinor: number;
    providerFeeReportedCount: number;
    feeMissingCount: number;
    demoPaymentCount: number;
  } {
    const sum = (sql: string, ...params: string[]): number => {
      const row = this.db.prepare(sql).get(...params) as Row | undefined;
      return Number(row?.total ?? 0);
    };
    const count = (sql: string, ...params: string[]): number => {
      const row = this.db.prepare(sql).get(...params) as Row | undefined;
      return Number(row?.n ?? 0);
    };
    return {
      lifetimeConfirmedMinor: sum("SELECT COALESCE(SUM(pi.amount_cents),0) AS total FROM payout_items pi JOIN payments p ON p.payment_id=pi.payment_id WHERE pi.status='SUCCESS' AND p.record_origin='application'"),
      lifetimeReturnedMinor: sum("SELECT COALESCE(SUM(pi.amount_cents),0) AS total FROM payout_items pi JOIN payments p ON p.payment_id=pi.payment_id WHERE pi.status IN ('RETURNED','REVERSED','REFUNDED') AND p.record_origin='application'"),
      confirmedCount: count("SELECT COUNT() AS n FROM payout_items pi JOIN payments p ON p.payment_id=pi.payment_id WHERE pi.status='SUCCESS' AND p.record_origin='application'"),
      unreconciledConfirmedCount: count("SELECT COUNT() AS n FROM payout_items pi JOIN payments p ON p.payment_id=pi.payment_id WHERE pi.status='SUCCESS' AND pi.last_reconciled_at IS NULL AND p.record_origin='application'"),
      pendingMinor: sum("SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status IN ('pending','unclaimed','onhold') AND record_origin='application'"),
      awaitingConfirmationMinor: sum("SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status='awaiting_confirmation' AND record_origin='application'"),
      failedMinor: sum("SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status IN ('failed','blocked') AND record_origin='application'"),
      outcomeUnknownMinor: sum("SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status='outcome_unknown' AND record_origin='application'"),
      reconciliationRequiredMinor: sum("SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status='reconciliation_required' AND record_origin='application'"),
      activeReservationMinor: sum("SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status='reserved' AND record_origin='application'"),
      feeEstimateMinor: sum("SELECT COALESCE(SUM(estimated_fee_minor),0) AS total FROM fee_estimates"),
      providerFeeMinor: sum("SELECT COALESCE(SUM(reported_fee_minor),0) AS total FROM provider_fee_evidence"),
      providerFeeReportedCount: count("SELECT COUNT() AS n FROM provider_fee_evidence"),
      feeMissingCount: count("SELECT COUNT() AS n FROM payments WHERE status='provider_confirmed' AND payment_id NOT IN (SELECT payment_id FROM provider_fee_evidence)"),
      demoPaymentCount: count("SELECT COUNT() AS n FROM payments WHERE record_origin <> 'application'"),
    };
  }

  // ---- owner control -------------------------------------------------------

  isEmergencyStopped(): boolean {
    const row = this.db.prepare("SELECT value FROM financial_control WHERE key='emergency_stop'").get() as Row | undefined;
    return row?.value === "1";
  }

  getControlState(): {
    emergencyStop: boolean;
    reason: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
    changedAt: string | null;
    changedBy: string | null;
  } {
    const row = this.db.prepare("SELECT value,updated_at,updated_by FROM financial_control WHERE key='emergency_stop'").get() as Row | undefined;
    const last = this.db.prepare("SELECT new_state,actor_id,at FROM financial_audit WHERE resource_id='emergency_stop' ORDER BY sequence DESC LIMIT 1").get() as Row | undefined;
    let reason: string | null = null;
    if (last?.new_state) {
      try {
        const parsed = JSON.parse(String(last.new_state)) as Row;
        reason = typeof parsed.reason === "string" ? parsed.reason : null;
      } catch {
        // A malformed historical row must not break the control panel.
      }
    }
    return {
      emergencyStop: row?.value === "1",
      reason,
      updatedAt: row ? String(row.updated_at) : null,
      updatedBy: row ? String(row.updated_by) : null,
      changedAt: last ? String(last.at) : row ? String(row.updated_at) : null,
      changedBy: last ? String(last.actor_id) : row ? String(row.updated_by) : null,
    };
  }

  /** Persistent, audited stop. It blocks new reservations and submissions; it
   * never cancels or reverses a provider transaction that already exists. */
  setEmergencyStop(opts: { stopped: boolean; actor: FinancialActor; at: string; reason: string }): void {
    this.owner(opts.actor);
    iso(opts.at);
    if (typeof opts.reason !== "string" || opts.reason.trim() === "") throw new Error("emergency stop needs a reason");
    this.tx(() => {
      const previous = this.getControlState();
      this.db.prepare(`INSERT INTO financial_control(key,value,updated_at,updated_by) VALUES('emergency_stop',?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
        .run(opts.stopped ? "1" : "0", opts.at, opts.actor.actorId);
      this.audit(opts.actor, opts.stopped ? "emergency_stopped" : "emergency_resumed", "emergency_stop", previous, { stopped: opts.stopped, reason: opts.reason }, opts.at);
    });
  }

  // ---- execution runs ------------------------------------------------------

  createExecutionRun(opts: { kind: "legacy" | "plan" | "product"; planId?: string | null; requestedBy: string; actorRole: string; policyVersion: number; at: string; note?: string }): { runId: string } {
    iso(opts.at);
    if (!Number.isSafeInteger(opts.policyVersion) || opts.policyVersion < 1) throw new Error("execution run needs a policy version");
    const runId = randomUUID();
    this.tx(() => {
      this.db.prepare("INSERT INTO execution_runs(run_id,kind,plan_id,requested_by,actor_role,policy_version,started_at,status,note) VALUES(?,?,?,?,?,?,?,'running',?)")
        .run(runId, opts.kind, opts.planId ?? null, opts.requestedBy, opts.actorRole, opts.policyVersion, opts.at, opts.note ?? null);
      this.audit({ actorId: opts.requestedBy, role: opts.actorRole as FinancialActor["role"] }, "execution_run_started", runId, null, { kind: opts.kind, planId: opts.planId ?? null }, opts.at);
    });
    return { runId };
  }

  attachPaymentToRun(opts: { runId: string; paymentId: string; ordinal: number }): void {
    if (!Number.isSafeInteger(opts.ordinal) || opts.ordinal < 0) throw new Error("ordinal must be a non-negative integer");
    this.tx(() => {
      const run = this.db.prepare("SELECT run_id FROM execution_runs WHERE run_id=?").get(opts.runId) as Row | undefined;
      if (!run) throw new Error("unknown execution run");
      this.db.prepare("INSERT INTO execution_run_payments(run_id,payment_id,ordinal) VALUES(?,?,?)").run(opts.runId, opts.paymentId, opts.ordinal);
      this.db.prepare("UPDATE payments SET execution_run_id=? WHERE payment_id=?").run(opts.runId, opts.paymentId);
    });
  }

  finishExecutionRun(opts: { runId: string; status: "succeeded" | "partial" | "failed" | "outcome_unknown" | "reconciliation_required"; note: string; at: string }): void {
    iso(opts.at);
    this.tx(() => {
      const result = this.db.prepare("UPDATE execution_runs SET completed_at=?,status=?,note=? WHERE run_id=? AND completed_at IS NULL")
        .run(opts.at, opts.status, opts.note, opts.runId);
      if (result.changes !== 1) throw new Error("unknown or already completed execution run");
      this.audit("system", "execution_run_completed", opts.runId, "running", { status: opts.status, note: opts.note }, opts.at);
    });
  }

  /** Items and batches of a run, each with its own provider identity. */
  getExecutionRun(runId: string): ExecutionRun | null {
    const run = this.db.prepare("SELECT * FROM execution_runs WHERE run_id=?").get(runId) as Row | undefined;
    if (!run) return null;
    const rows = this.db.prepare(`
      SELECT p.payment_id,p.job_id,p.status,p.record_origin,p.amount_cents,p.currency,erp.ordinal,
             pi.payout_batch_id,pi.payout_item_id,pi.transaction_id,pi.status AS provider_status,pi.provider_timestamp
      FROM execution_run_payments erp
      JOIN payments p ON p.payment_id = erp.payment_id
      LEFT JOIN payout_items pi ON pi.payment_id = p.payment_id
      WHERE erp.run_id=? ORDER BY erp.ordinal
    `).all(runId) as Row[];
    const items: ExecutionRunItem[] = rows.map((row) => ({
      paymentId: String(row.payment_id),
      jobId: String(row.job_id),
      ordinal: Number(row.ordinal),
      status: String(row.status),
      recordOrigin: String(row.record_origin),
      payoutBatchId: row.payout_batch_id ? String(row.payout_batch_id) : null,
      payoutItemId: row.payout_item_id ? String(row.payout_item_id) : null,
      transactionId: row.transaction_id ? String(row.transaction_id) : null,
      amountMinor: Number(row.amount_cents),
      currency: String(row.currency),
      providerStatus: row.provider_status ? String(row.provider_status) : null,
      providerTimestamp: row.provider_timestamp ? String(row.provider_timestamp) : null,
    }));
    const byBatch = new Map<string, { itemCount: number; grossMinor: number; statuses: string[] }>();
    for (const item of items) {
      if (!item.payoutBatchId) continue;
      const current = byBatch.get(item.payoutBatchId) ?? { itemCount: 0, grossMinor: 0, statuses: [] };
      current.itemCount += 1;
      current.grossMinor += item.amountMinor;
      current.statuses.push(item.providerStatus ?? item.status);
      byBatch.set(item.payoutBatchId, current);
    }
    const batches = [...byBatch.entries()].map(([payoutBatchId, value]) => ({
      payoutBatchId,
      itemCount: value.itemCount,
      grossMinor: value.grossMinor,
      status: summarizeBatch(value.statuses),
    }));
    const derived = summarizeRun(items, batches);
    const stored = String(run.status);
    return {
      runId: String(run.run_id),
      kind: String(run.kind),
      planId: run.plan_id ? String(run.plan_id) : null,
      requestedBy: String(run.requested_by),
      actorRole: String(run.actor_role),
      policyVersion: Number(run.policy_version),
      startedAt: String(run.started_at),
      completedAt: run.completed_at ? String(run.completed_at) : null,
      status: stored === "running" ? derived : stored,
      note: run.note ? String(run.note) : null,
      items,
      batches,
    };
  }

  // ---- fee provenance ------------------------------------------------------

  recordFeeEstimate(opts: { paymentId: string; policyId: string; policyVersion: number; amountMinor: number; estimatedFeeMinor: number; currency: string; method: string; formula: string; sourceUrl: string; sourceRetrievedAt: string; at: string }): void {
    cents(opts.amountMinor, "fee estimate amount");
    if (!Number.isSafeInteger(opts.estimatedFeeMinor) || opts.estimatedFeeMinor < 0) throw new Error("estimated fee must be a non-negative integer");
    iso(opts.at);
    this.tx(() => {
      this.db.prepare(`INSERT INTO fee_estimates(payment_id,policy_id,policy_version,amount_minor,estimated_fee_minor,currency,method,formula,source_url,source_retrieved_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(payment_id) DO UPDATE SET policy_id=excluded.policy_id,policy_version=excluded.policy_version,amount_minor=excluded.amount_minor,estimated_fee_minor=excluded.estimated_fee_minor,currency=excluded.currency,method=excluded.method,formula=excluded.formula,source_url=excluded.source_url,source_retrieved_at=excluded.source_retrieved_at,created_at=excluded.created_at`)
        .run(opts.paymentId, opts.policyId, opts.policyVersion, opts.amountMinor, opts.estimatedFeeMinor, opts.currency, opts.method, opts.formula, opts.sourceUrl, opts.sourceRetrievedAt, opts.at);
      this.audit("system", "fee_estimated", opts.paymentId, null, { policyId: opts.policyId, policyVersion: opts.policyVersion, estimatedFeeMinor: opts.estimatedFeeMinor }, opts.at);
    });
  }

  getFeeRecord(paymentId: string): FeeRecord {
    const estimateRow = this.db.prepare("SELECT * FROM fee_estimates WHERE payment_id=?").get(paymentId) as Row | undefined;
    const providerRow = this.db.prepare("SELECT * FROM provider_fee_evidence WHERE payment_id=?").get(paymentId) as Row | undefined;
    const payment = this.db.prepare("SELECT amount_cents FROM payments WHERE payment_id=?").get(paymentId) as Row | undefined;
    if (!payment) throw new Error("unknown payment");
    const estimate = estimateRow ? {
      policyId: String(estimateRow.policy_id), policyVersion: Number(estimateRow.policy_version), amountMinor: Number(estimateRow.amount_minor),
      estimatedFeeMinor: Number(estimateRow.estimated_fee_minor), currency: String(estimateRow.currency), method: String(estimateRow.method),
      formula: String(estimateRow.formula), sourceUrl: String(estimateRow.source_url), sourceRetrievedAt: String(estimateRow.source_retrieved_at),
      createdAt: String(estimateRow.created_at),
    } : null;
    const provider = providerRow ? {
      reportedFeeMinor: Number(providerRow.reported_fee_minor), currency: String(providerRow.currency), feePayer: String(providerRow.fee_payer),
      source: String(providerRow.source), sourceBatchId: providerRow.source_batch_id ? String(providerRow.source_batch_id) : null,
      sourceItemId: providerRow.source_item_id ? String(providerRow.source_item_id) : null,
      isProviderEstimate: Number(providerRow.is_provider_estimate) === 1, environment: String(providerRow.environment), observedAt: String(providerRow.observed_at),
    } : null;
    if (!estimate) {
      return {
        paymentId, estimate: null, provider,
        consistent: null,
        explanation: provider
          ? "PayPal reported a fee for this item, but no policy estimate was stored for the payment. The provider amount is shown alone."
          : "No estimate is stored and the provider fee was not reported. The fee is unavailable, not zero.",
      };
    }
    const comparison = providerFeeConsistency({
      amountMinor: estimate.amountMinor,
      reportedFeeMinor: provider ? provider.reportedFeeMinor : null,
      policyId: estimate.policyId,
    });
    return { paymentId, estimate, provider, consistent: comparison.consistent, explanation: comparison.explanation };
  }

  listFeeRecords(): FeeRecord[] {
    const rows = this.db.prepare("SELECT payment_id FROM payments ORDER BY approved_at").all() as Row[];
    return rows.map((row) => this.getFeeRecord(String(row.payment_id)));
  }

  // ---- durable confirmation ------------------------------------------------

  scheduleConfirmation(opts: { paymentId: string; at: string; delayMs: number }): void {
    iso(opts.at);
    if (!Number.isSafeInteger(opts.delayMs) || opts.delayMs < 0) throw new Error("confirmation delay must be a non-negative integer");
    const next = new Date(iso(opts.at) + opts.delayMs).toISOString();
    this.db.prepare("INSERT OR IGNORE INTO confirmation_jobs(payment_id,attempt_count,next_attempt_at,last_error,state,updated_at) VALUES(?,0,?,NULL,'scheduled',?)")
      .run(opts.paymentId, next, opts.at);
  }

  listDueConfirmations(at: string, limit = 50): ConfirmationJob[] {
    iso(at);
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    const rows = this.db.prepare(`
      SELECT c.payment_id,c.attempt_count,c.next_attempt_at,c.last_error,p.job_id,p.status,
             COALESCE(ea.payout_batch_id, pi.payout_batch_id) AS payout_batch_id
      FROM confirmation_jobs c
      JOIN payments p ON p.payment_id=c.payment_id
      LEFT JOIN execution_attempts ea ON ea.payment_id=c.payment_id
      LEFT JOIN payout_items pi ON pi.payment_id=c.payment_id
      WHERE c.state='scheduled' AND c.next_attempt_at<=?
      ORDER BY c.next_attempt_at LIMIT ?
    `).all(at, limit) as Row[];
    return rows.map((row) => ({
      paymentId: String(row.payment_id),
      jobId: String(row.job_id),
      status: String(row.status),
      payoutBatchId: row.payout_batch_id ? String(row.payout_batch_id) : null,
      attemptCount: Number(row.attempt_count),
      nextAttemptAt: String(row.next_attempt_at),
      lastError: row.last_error ? String(row.last_error) : null,
    }));
  }

  /** Read-only view of the durable confirmation work for one payment, for the
   * payment investigation view. Returns null when no work was ever scheduled. */
  getConfirmationState(paymentId: string): { state: string; attemptCount: number; nextAttemptAt: string; lastError: string | null; updatedAt: string } | null {
    const row = this.db.prepare("SELECT state,attempt_count,next_attempt_at,last_error,updated_at FROM confirmation_jobs WHERE payment_id=?").get(paymentId) as Row | undefined;
    if (!row) return null;
    return {
      state: String(row.state), attemptCount: Number(row.attempt_count), nextAttemptAt: String(row.next_attempt_at),
      lastError: row.last_error ? String(row.last_error) : null, updatedAt: String(row.updated_at),
    };
  }

  /** Annotate durable confirmation work without moving its next attempt. */
  noteConfirmationError(paymentId: string, error: string, at: string): void {
    iso(at);
    this.db.prepare("UPDATE confirmation_jobs SET last_error=?,updated_at=? WHERE payment_id=?").run(error, at, paymentId);
  }

  /** The deliberate, audited decision to probe an ambiguous submission with its
   * documented idempotency key. */
  auditReplayProbe(opts: { paymentId: string; senderBatchId: string; at: string }): void {
    iso(opts.at);
    this.audit("system", "idempotent_replay_attempted", opts.paymentId, null, { senderBatchId: opts.senderBatchId }, opts.at, opts.senderBatchId);
  }

  /** Called once at startup. Anything PayPal is still processing gets durable
   * work, without resetting an attempt count that already exists. */
  rearmConfirmations(opts: { at: string }): number {
    iso(opts.at);
    const rows = this.db.prepare(`
      SELECT p.payment_id FROM payments p
      LEFT JOIN confirmation_jobs c ON c.payment_id=p.payment_id
      WHERE p.status IN ('submitted','awaiting_confirmation','pending','unclaimed','onhold') AND c.payment_id IS NULL
    `).all() as Row[];
    for (const row of rows) this.scheduleConfirmation({ paymentId: String(row.payment_id), at: opts.at, delayMs: 0 });
    return rows.length;
  }

  completeConfirmation(paymentId: string, at: string): void {
    iso(at);
    this.db.prepare("UPDATE confirmation_jobs SET state='done',updated_at=? WHERE payment_id=?").run(at, paymentId);
  }

  /** A failed poll is not a failed payment. It is rescheduled, or, after the
   * configured budget, escalated to reconciliation_required. */
  recordConfirmationFailure(opts: { paymentId: string; error: string; at: string; policy: ConfirmationPolicy; random?: () => number }): { state: string; nextAttemptAt: string | null; attemptCount: number } {
    iso(opts.at);
    const job = this.db.prepare("SELECT * FROM confirmation_jobs WHERE payment_id=?").get(opts.paymentId) as Row | undefined;
    if (!job) throw new Error("no confirmation work for this payment");
    const attemptCount = Number(job.attempt_count) + 1;
    if (attemptCount >= opts.policy.maxAttempts) {
      this.tx(() => {
        this.db.prepare("UPDATE confirmation_jobs SET attempt_count=?,state='exhausted',last_error=?,updated_at=? WHERE payment_id=?")
          .run(attemptCount, opts.error, opts.at, opts.paymentId);
        const payment = this.db.prepare("SELECT status FROM payments WHERE payment_id=?").get(opts.paymentId) as Row;
        this.db.prepare("UPDATE payments SET status='reconciliation_required',failure_reason=? WHERE payment_id=?").run(opts.error, opts.paymentId);
        this.audit("system", "confirmation_exhausted", opts.paymentId, String(payment.status), "reconciliation_required", opts.at);
      });
      return { state: "exhausted", nextAttemptAt: null, attemptCount };
    }
    const delayMs = nextConfirmationDelayMs(opts.policy, attemptCount - 1, opts.random);
    const nextAttemptAt = new Date(iso(opts.at) + delayMs).toISOString();
    this.tx(() => {
      this.db.prepare("UPDATE confirmation_jobs SET attempt_count=?,next_attempt_at=?,state='scheduled',last_error=?,updated_at=? WHERE payment_id=?")
        .run(attemptCount, nextAttemptAt, opts.error, opts.at, opts.paymentId);
      this.audit("system", "confirmation_rescheduled", opts.paymentId, null, { attemptCount, nextAttemptAt, error: opts.error }, opts.at);
    });
    return { state: "scheduled", nextAttemptAt, attemptCount };
  }

  getAudit(): Row[] { return this.db.prepare("SELECT * FROM financial_audit ORDER BY sequence").all() as Row[]; }
  unsafeTestOnlySql(sql: string): void { this.db.exec(sql); }
}

function summarizeBatch(statuses: string[]): string {
  if (statuses.length === 0) return "UNKNOWN";
  const confirmed = statuses.filter((status) => status === "SUCCESS" || status === "provider_confirmed").length;
  if (confirmed === statuses.length) return "SUCCESS";
  const failed = statuses.filter((status) => ["FAILED", "failed", "BLOCKED", "blocked"].includes(status)).length;
  if (failed === statuses.length) return "FAILED";
  if (failed + confirmed === statuses.length) return "PARTIAL";
  return "PROCESSING";
}

function summarizeRun(items: ExecutionRunItem[], batches: Array<{ status: string }>): string {
  if (items.length === 0) return "running";
  const states = items.map((item) => item.status);
  if (states.some((state) => state === "outcome_unknown")) return "outcome_unknown";
  if (states.some((state) => state === "reconciliation_required")) return "reconciliation_required";
  const succeeded = states.filter((state) => state === "provider_confirmed").length;
  if (succeeded === states.length) return "succeeded";
  const settled = states.filter((state) => ["provider_confirmed", "failed", "blocked", "returned", "reversed", "refunded"].includes(state)).length;
  if (settled === states.length && succeeded > 0) return "partial";
  if (succeeded === 0 && settled === states.length) return "failed";
  if (batches.some((batch) => batch.status === "PROCESSING")) return "in_progress";
  return "in_progress";
}
