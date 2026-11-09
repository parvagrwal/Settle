import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";

export type FinancialActor = { actorId: string; role: "owner" | "operator" | "viewer" | "agent" };
type Row = Record<string, unknown>;

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
        sender_batch_id TEXT UNIQUE NOT NULL, started_at TEXT NOT NULL, status TEXT NOT NULL, last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS payout_items (
        payment_id TEXT PRIMARY KEY REFERENCES payments(payment_id), sender_batch_id TEXT NOT NULL,
        payout_batch_id TEXT NOT NULL, payout_item_id TEXT UNIQUE NOT NULL,
        transaction_id TEXT UNIQUE, activity_id TEXT UNIQUE, recipient_email TEXT NOT NULL,
        amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
        provider_timestamp TEXT NOT NULL, raw_json TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS payout_items_status_time ON payout_items(status,provider_timestamp);
      CREATE TABLE IF NOT EXISTS provider_spend (
        evidence_id TEXT PRIMARY KEY, payment_key TEXT NOT NULL, amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL, status TEXT NOT NULL, provider_timestamp TEXT NOT NULL,
        UNIQUE(payment_key,status,provider_timestamp)
      );
      CREATE INDEX IF NOT EXISTS provider_spend_window ON provider_spend(currency,status,provider_timestamp);
      CREATE TABLE IF NOT EXISTS reconciliation_state (id INTEGER PRIMARY KEY CHECK(id=1), last_success_at TEXT);
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
      this.db.prepare(`INSERT INTO payments(payment_id,job_id,idempotency_key,recipient_id,recipient_email,amount_cents,currency,policy_version,status,approved_by,approved_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(paymentId, opts.jobId, `settle-payment-${opts.jobId}`, opts.recipientId, recipient.email,
        opts.amountCents, opts.currency, this.getPolicy().version, "approved", opts.actor.actorId, opts.at);
      this.audit(opts.actor, "payment_approved", paymentId, null, { jobId: opts.jobId, recipient: recipient.email, amountCents: opts.amountCents }, opts.at);
      return paymentId;
    });
  }
  reservePayment(opts: { jobId: string; at: string }): { paymentId: string; idempotencyKey: string; status: string } {
    return this.tx(() => {
      const summary = this.getCapSummary(opts.at);
      if (!summary.fresh) throw new Error("provider reconciliation is stale; new payouts are refused");
      const payment = this.getPaymentByJob(opts.jobId);
      if (!payment) throw new Error("payment is not owner-approved");
      if (["reserved", "submitted", "outcome_unknown", "provider_confirmed"].includes(payment.status)) return { paymentId: payment.paymentId, idempotencyKey: payment.idempotencyKey, status: payment.status };
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
    const activeReservationsCents = Number((this.db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status IN ('reserved','submitted','outcome_unknown')").get() as Row).total);
    const last = this.db.prepare("SELECT last_success_at FROM reconciliation_state WHERE id=1").get() as Row | undefined;
    const lastSuccessfulReconciliation = last?.last_success_at ? String(last.last_success_at) : null;
    const fresh = lastSuccessfulReconciliation !== null && now - iso(lastSuccessfulReconciliation) <= policy.freshnessSeconds * 1000 && now >= iso(lastSuccessfulReconciliation);
    return { windowStart: start, windowEnd: at, confirmedSpendCents, adjustmentsCents, eligibleSpendCents, activeReservationsCents, remainingCents: Math.max(0, policy.capCents - eligibleSpendCents - activeReservationsCents), lastSuccessfulReconciliation, fresh, policyVersion: policy.version, currency: "USD" };
  }
  markReconciled(at: string): void {
    iso(at);
    this.db.prepare("INSERT INTO reconciliation_state(id,last_success_at) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_success_at=excluded.last_success_at").run(at);
  }
  recordProviderSpend(opts: { paymentKey: string; amountCents: number; currency: string; status: string; providerTimestamp: string }): void {
    cents(opts.amountCents, "provider amount"); iso(opts.providerTimestamp);
    if (opts.currency !== "USD") throw new Error("mixed currencies are not supported by this cap policy");
    this.db.prepare("INSERT INTO provider_spend VALUES(?,?,?,?,?,?)").run(randomUUID(), opts.paymentKey, opts.amountCents, opts.currency, opts.status, opts.providerTimestamp);
  }
  beginSubmission(paymentId: string, at: string): { attemptId: string; senderBatchId: string } {
    return this.tx(() => {
      const payment = this.db.prepare("SELECT * FROM payments WHERE payment_id=?").get(paymentId) as Row | undefined;
      if (!payment || payment.status !== "reserved") throw new Error(`SUBMISSION_CONFLICT: payment is ${String(payment?.status ?? "missing")}, not reserved`);
      const existing = this.db.prepare("SELECT * FROM execution_attempts WHERE payment_id=?").get(paymentId) as Row | undefined;
      if (existing) throw new Error("SUBMISSION_CONFLICT: execution attempt already exists");
      const attemptId = randomUUID(); const senderBatchId = String(payment.idempotency_key);
      this.db.prepare("INSERT INTO execution_attempts VALUES(?,?,?,?,?,?)").run(attemptId, paymentId, senderBatchId, at, "submitting", null);
      this.db.prepare("UPDATE payments SET status='submitted',submitted_at=? WHERE payment_id=?").run(at, paymentId);
      this.audit("system", "payment_submitted", paymentId, payment.status, "submitted", at, senderBatchId);
      return { attemptId, senderBatchId };
    });
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
  recordPayoutItem(opts: { paymentId: string; senderBatchId: string; payoutBatchId: string; payoutItemId: string; transactionId: string | null; activityId: string | null; recipientEmail: string; amountCents: number; currency: string; status: string; providerTimestamp: string; raw: Row }): void {
    const supported = ["SUCCESS", "FAILED", "PENDING", "UNCLAIMED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"];
    if (!supported.includes(opts.status)) throw new Error("unsupported provider item status"); iso(opts.providerTimestamp);
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
    this.tx(() => {
      this.db.prepare(`INSERT INTO payout_items(payment_id,sender_batch_id,payout_batch_id,payout_item_id,transaction_id,activity_id,recipient_email,amount_cents,currency,status,provider_timestamp,raw_json,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(payment_id) DO UPDATE SET status=excluded.status,transaction_id=excluded.transaction_id,activity_id=excluded.activity_id,provider_timestamp=excluded.provider_timestamp,raw_json=excluded.raw_json,updated_at=datetime('now')`)
        .run(opts.paymentId, opts.senderBatchId, opts.payoutBatchId, opts.payoutItemId, opts.transactionId, opts.activityId, opts.recipientEmail, opts.amountCents, opts.currency, opts.status, opts.providerTimestamp, JSON.stringify(opts.raw));
      const next = opts.status === "SUCCESS" ? "provider_confirmed" : opts.status === "FAILED" ? "failed" : opts.status.toLowerCase();
      this.db.prepare("UPDATE payments SET status=?,confirmed_at=CASE WHEN ?='SUCCESS' THEN ? ELSE confirmed_at END WHERE payment_id=?").run(next, opts.status, opts.providerTimestamp, opts.paymentId);
      if (opts.status === "SUCCESS" || ["RETURNED", "REVERSED", "REFUNDED"].includes(opts.status)) {
        this.db.prepare("INSERT OR IGNORE INTO provider_spend VALUES(?,?,?,?,?,?)").run(randomUUID(), opts.paymentId, opts.amountCents, opts.currency, opts.status, opts.providerTimestamp);
      }
      this.audit("system", "provider_item_updated", opts.paymentId, payment.status, next, opts.providerTimestamp, opts.payoutItemId);
    });
  }
  listRecipients(): Array<{ recipientId: string; email: string; verifiedBy: string; verifiedAt: string }> {
    const rows = this.db.prepare("SELECT * FROM recipients ORDER BY verified_at").all() as Row[];
    return rows.map((row) => ({ recipientId: String(row.recipient_id), email: String(row.email), verifiedBy: String(row.verified_by), verifiedAt: String(row.verified_at) }));
  }
  getPayoutItem(paymentId: string): Row | null {
    const row = this.db.prepare("SELECT * FROM payout_items WHERE payment_id=?").get(paymentId) as Row | undefined;
    return row ? { paymentId, senderBatchId: String(row.sender_batch_id), payoutBatchId: String(row.payout_batch_id), payoutItemId: String(row.payout_item_id), transactionId: row.transaction_id ? String(row.transaction_id) : null, activityId: row.activity_id ? String(row.activity_id) : null, status: String(row.status), providerTimestamp: String(row.provider_timestamp), raw: JSON.parse(String(row.raw_json)) } : null;
  }
  getPaymentByJob(jobId: string): { paymentId: string; jobId: string; idempotencyKey: string; recipientEmail: string; amountCents: number; currency: string; policyVersion: number; status: string; approvedAt: string } | null {
    const row = this.db.prepare("SELECT * FROM payments WHERE job_id=?").get(jobId) as Row | undefined;
    return row ? this.paymentRow(row) : null;
  }
  getPaymentByIdempotency(key: string): { paymentId: string; jobId: string; idempotencyKey: string; recipientEmail: string; amountCents: number; currency: string; policyVersion: number; status: string; approvedAt: string } | null {
    const row = this.db.prepare("SELECT * FROM payments WHERE idempotency_key=?").get(key) as Row | undefined;
    return row ? this.paymentRow(row) : null;
  }
  private paymentRow(row: Row) {
    return { paymentId: String(row.payment_id), jobId: String(row.job_id), idempotencyKey: String(row.idempotency_key), recipientEmail: String(row.recipient_email), amountCents: Number(row.amount_cents), currency: String(row.currency), policyVersion: Number(row.policy_version), status: String(row.status), approvedAt: String(row.approved_at) };
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
  getAudit(): Row[] { return this.db.prepare("SELECT * FROM financial_audit ORDER BY sequence").all() as Row[]; }
  unsafeTestOnlySql(sql: string): void { this.db.exec(sql); }
}
