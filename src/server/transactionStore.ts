// Durable, verified-PayPal-event store. No unverified caller can write here:
// routes must call this only after PayPal's signature verification succeeds.
import { DatabaseSync } from "node:sqlite";

export interface TransactionRecord {
  rowKey: string;
  originalTransactionId: string | null;
  associatedOrderId: string | null;
  latestEventId: string;
  originalEventId: string;
  transactionTimestamp: string | null;
  eventCreatedAt: string;
  eventReceivedAt: string;
  status: string;
  grossCents: number | null;
  currency: string | null;
  feeCents: number | null;
  netCents: number | null;
  payerEmail: string | null;
  payeeEmail: string | null;
  paymentMethod: string | null;
  payoutBatchId: string | null;
  payoutItemId: string | null;
  jobId: string | null;
  relatedTransactionId: string | null;
  lastEventSequence: number;
}

export interface EventHistoryRecord {
  sequence: number;
  eventId: string;
  eventType: string;
  eventCreatedAt: string;
  eventReceivedAt: string;
  outcome: string;
  correlationId: string | null;
  rawEvent: Record<string, unknown>;
}

export interface ProcessResult {
  duplicate: boolean;
  outcome: "applied" | "duplicate" | "superseded" | "conflict" | "ignored";
  rowKey: string | null;
}

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : {};
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function moneyCents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}
function requireText(value: unknown, name: string): string {
  const result = text(value);
  if (!result) throw new Error(`event validation: ${name} is required`);
  return result;
}

interface Projection extends Omit<TransactionRecord, "originalEventId" | "eventReceivedAt" | "lastEventSequence"> {
  raw: UnknownRecord;
}

function payoutProjection(event: UnknownRecord): Projection {
  const resource = object(event.resource);
  const item = object(resource.payout_item);
  const amount = object(item.amount);
  const fee = object(item.payout_item_fee);
  const grossCents = moneyCents(amount.value);
  const feeCents = moneyCents(fee.value);
  const currency = text(amount.currency) ?? text(fee.currency);
  return {
    rowKey: requireText(resource.payout_item_id, "resource.payout_item_id"),
    originalTransactionId: text(resource.transaction_id),
    associatedOrderId: null,
    latestEventId: requireText(event.id, "id"),
    transactionTimestamp: text(resource.time_processed),
    eventCreatedAt: requireText(event.create_time, "create_time"),
    status: requireText(resource.transaction_status, "resource.transaction_status"),
    grossCents,
    currency,
    feeCents,
    netCents: grossCents !== null && feeCents !== null ? grossCents - feeCents : null,
    payerEmail: null,
    payeeEmail: text(item.receiver),
    paymentMethod: text(item.recipient_wallet),
    payoutBatchId: text(resource.payout_batch_id),
    payoutItemId: text(resource.payout_item_id),
    jobId: text(item.sender_item_id),
    relatedTransactionId: null,
    raw: resource,
  };
}

function captureProjection(event: UnknownRecord): Projection {
  const resource = object(event.resource);
  const amount = object(resource.amount);
  const breakdown = object(resource.seller_receivable_breakdown);
  const fee = object(breakdown.paypal_fee);
  const net = object(breakdown.net_amount);
  const related = object(object(resource.supplementary_data).related_ids);
  const grossCents = moneyCents(amount.value);
  const feeCents = moneyCents(fee.value);
  const explicitNet = moneyCents(net.value);
  return {
    rowKey: requireText(resource.id, "resource.id"),
    originalTransactionId: text(resource.id),
    associatedOrderId: text(related.order_id),
    latestEventId: requireText(event.id, "id"),
    transactionTimestamp: text(resource.update_time) ?? text(resource.create_time),
    eventCreatedAt: requireText(event.create_time, "create_time"),
    status: requireText(resource.status, "resource.status"),
    grossCents,
    currency: text(amount.currency_code),
    feeCents,
    netCents: explicitNet ?? (grossCents !== null && feeCents !== null ? grossCents - feeCents : null),
    payerEmail: text(object(resource.payer).email_address),
    payeeEmail: text(object(resource.payee).email_address),
    paymentMethod: Object.keys(object(resource.payment_source))[0]?.toUpperCase() ?? null,
    payoutBatchId: null,
    payoutItemId: null,
    jobId: text(resource.custom_id),
    relatedTransactionId: text(related.capture_id) ?? null,
    raw: resource,
  };
}

function project(event: UnknownRecord): Projection | null {
  requireText(event.id, "id");
  requireText(event.event_type, "event_type");
  requireText(event.create_time, "create_time");
  if (String(event.event_type).startsWith("PAYOUTS.ITEM.")) return payoutProjection(event);
  if (String(event.event_type).startsWith("PAYMENT.CAPTURE.")) return captureProjection(event);
  return null;
}

const MIGRATION = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
CREATE TABLE IF NOT EXISTS paypal_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  row_key TEXT,
  event_type TEXT NOT NULL,
  event_created_at TEXT NOT NULL,
  event_received_at TEXT NOT NULL,
  correlation_id TEXT,
  outcome TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS paypal_events_row_history ON paypal_events(row_key, event_created_at DESC, sequence DESC);
CREATE TABLE IF NOT EXISTS payment_transactions (
  row_key TEXT PRIMARY KEY,
  original_transaction_id TEXT,
  associated_order_id TEXT,
  latest_event_id TEXT NOT NULL,
  original_event_id TEXT NOT NULL,
  transaction_timestamp TEXT,
  event_created_at TEXT NOT NULL,
  event_received_at TEXT NOT NULL,
  status TEXT NOT NULL,
  gross_cents INTEGER,
  currency TEXT,
  fee_cents INTEGER,
  net_cents INTEGER,
  payer_email TEXT,
  payee_email TEXT,
  payment_method TEXT,
  payout_batch_id TEXT,
  payout_item_id TEXT,
  job_id TEXT,
  related_transaction_id TEXT,
  last_event_sequence INTEGER NOT NULL,
  latest_raw_json TEXT NOT NULL,
  CHECK(gross_cents IS NULL OR gross_cents >= 0),
  CHECK(net_cents IS NULL OR gross_cents IS NULL OR fee_cents IS NULL OR net_cents = gross_cents - fee_cents)
);
CREATE INDEX IF NOT EXISTS payment_transactions_delta ON payment_transactions(last_event_sequence);
CREATE INDEX IF NOT EXISTS payment_transactions_original ON payment_transactions(original_transaction_id);
`;

export class TransactionStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(MIGRATION);
  }

  close(): void { this.db.close(); }
  currentSequence(): number {
    return Number((this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS value FROM paypal_events").get() as UnknownRecord).value);
  }

  processVerifiedEvent(eventInput: UnknownRecord, receivedAt: string, correlationId: string | null = null): ProcessResult {
    const projection = project(eventInput);
    const eventId = requireText(eventInput.id, "id");
    const eventType = requireText(eventInput.event_type, "event_type");
    const eventCreatedAt = requireText(eventInput.create_time, "create_time");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT 1 AS found FROM paypal_events WHERE event_id=?").get(eventId)) {
        this.db.exec("COMMIT");
        return { duplicate: true, outcome: "duplicate", rowKey: projection?.rowKey ?? null };
      }
      let outcome: ProcessResult["outcome"] = projection ? "applied" : "ignored";
      const existing = projection ? this.db.prepare("SELECT * FROM payment_transactions WHERE row_key=?").get(projection.rowKey) as UnknownRecord | undefined : undefined;
      if (projection && existing) {
        const currentStatus = String(existing.status);
        const incomingIsOlder = Date.parse(eventCreatedAt) < Date.parse(String(existing.event_created_at));
        if (incomingIsOlder) outcome = "superseded";
        else if (["SUCCESS", "COMPLETED"].includes(currentStatus) && projection.status !== currentStatus) outcome = "conflict";
      }
      const eventInsert = this.db.prepare(`INSERT INTO paypal_events
        (event_id,row_key,event_type,event_created_at,event_received_at,correlation_id,outcome,raw_json)
        VALUES (?,?,?,?,?,?,?,?)`);
      const inserted = eventInsert.run(eventId, projection?.rowKey ?? null, eventType, eventCreatedAt, receivedAt, correlationId, outcome, JSON.stringify(eventInput));
      const sequence = Number(inserted.lastInsertRowid);
      if (projection && outcome === "applied") {
        this.db.prepare(`INSERT INTO payment_transactions (
          row_key,original_transaction_id,associated_order_id,latest_event_id,original_event_id,
          transaction_timestamp,event_created_at,event_received_at,status,gross_cents,currency,
          fee_cents,net_cents,payer_email,payee_email,payment_method,payout_batch_id,payout_item_id,
          job_id,related_transaction_id,last_event_sequence,latest_raw_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(row_key) DO UPDATE SET
          original_transaction_id=excluded.original_transaction_id,
          associated_order_id=excluded.associated_order_id,
          latest_event_id=excluded.latest_event_id,
          transaction_timestamp=excluded.transaction_timestamp,
          event_created_at=excluded.event_created_at,
          event_received_at=excluded.event_received_at,
          status=excluded.status,gross_cents=excluded.gross_cents,currency=excluded.currency,
          fee_cents=excluded.fee_cents,net_cents=excluded.net_cents,payer_email=excluded.payer_email,
          payee_email=excluded.payee_email,payment_method=excluded.payment_method,
          payout_batch_id=excluded.payout_batch_id,payout_item_id=excluded.payout_item_id,
          job_id=excluded.job_id,related_transaction_id=excluded.related_transaction_id,
          last_event_sequence=excluded.last_event_sequence,latest_raw_json=excluded.latest_raw_json`).run(
          projection.rowKey, projection.originalTransactionId, projection.associatedOrderId, projection.latestEventId,
          (existing?.original_event_id as string | undefined) ?? projection.latestEventId,
          projection.transactionTimestamp, projection.eventCreatedAt, receivedAt, projection.status,
          projection.grossCents, projection.currency, projection.feeCents, projection.netCents,
          projection.payerEmail, projection.payeeEmail, projection.paymentMethod, projection.payoutBatchId,
          projection.payoutItemId, projection.jobId, projection.relatedTransactionId, sequence, JSON.stringify(projection.raw),
        );
      }
      this.db.exec("COMMIT");
      return { duplicate: false, outcome, rowKey: projection?.rowKey ?? null };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listTransactions(sinceSequence = 0): TransactionRecord[] {
    return (this.db.prepare("SELECT * FROM payment_transactions WHERE last_event_sequence>? ORDER BY event_created_at DESC, row_key").all(sinceSequence) as unknown as UnknownRecord[]).map(mapTransaction);
  }

  getTransaction(rowKey: string): TransactionRecord | null {
    const row = this.db.prepare("SELECT * FROM payment_transactions WHERE row_key=?").get(rowKey) as UnknownRecord | undefined;
    return row ? mapTransaction(row) : null;
  }

  getHistory(rowKey: string): EventHistoryRecord[] {
    return (this.db.prepare("SELECT * FROM paypal_events WHERE row_key=? ORDER BY event_created_at DESC, sequence DESC").all(rowKey) as unknown as UnknownRecord[]).map((row) => ({
      sequence: Number(row.sequence), eventId: String(row.event_id), eventType: String(row.event_type),
      eventCreatedAt: String(row.event_created_at), eventReceivedAt: String(row.event_received_at),
      outcome: String(row.outcome), correlationId: text(row.correlation_id), rawEvent: JSON.parse(String(row.raw_json)) as UnknownRecord,
    }));
  }
}

function mapTransaction(row: UnknownRecord): TransactionRecord {
  return {
    rowKey: String(row.row_key), originalTransactionId: text(row.original_transaction_id),
    associatedOrderId: text(row.associated_order_id), latestEventId: String(row.latest_event_id),
    originalEventId: String(row.original_event_id), transactionTimestamp: text(row.transaction_timestamp),
    eventCreatedAt: String(row.event_created_at), eventReceivedAt: String(row.event_received_at),
    status: String(row.status), grossCents: row.gross_cents === null ? null : Number(row.gross_cents),
    currency: text(row.currency), feeCents: row.fee_cents === null ? null : Number(row.fee_cents),
    netCents: row.net_cents === null ? null : Number(row.net_cents), payerEmail: text(row.payer_email),
    payeeEmail: text(row.payee_email), paymentMethod: text(row.payment_method),
    payoutBatchId: text(row.payout_batch_id), payoutItemId: text(row.payout_item_id), jobId: text(row.job_id),
    relatedTransactionId: text(row.related_transaction_id), lastEventSequence: Number(row.last_event_sequence),
  };
}
