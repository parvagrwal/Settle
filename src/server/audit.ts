// Audit trail — every decision writes a reason, and the record is
// append-only. A recorded refusal is an audit row, shown in the grid,
// never just a console log. No PayPal call happens in this file.
// Sandbox only, test money, no real money moves.
//
// Durability: with a database path the rows live in SQLite next to the
// financial ledger, protected by the same immutability triggers, so the
// history survives a restart. Without a path (pure unit tests) the log
// is in-memory with the same interface and the same append-only rule.
import { DatabaseSync } from "node:sqlite";
import type { Decision, Policy } from "../shared/types.ts";
import { capText } from "./money.ts";

export type AuditAction =
  | "accepted"
  | "rejected"
  | "paid"
  | "held"
  | "invoiced"
  /** The provider refused or failed an item after the policy accepted it.
   * Kept distinct from "rejected" so authorization and execution outcomes
   * can never be confused. */
  | "provider_failed";

export interface AuditRow {
  audit_id: string;
  /** ms epoch when the row was written. */
  at: number;
  /** Who acted: "owner" for Meera, "agent" for the payout agent. */
  actor: string;
  job_id: string;
  action: AuditAction;
  /** Plain words: which rule passed or failed, which cap, which job. */
  reason: string;
  amount_cents: number;
  payout_batch_id: string | null;
  paypal_transaction_id: string | null;
}

export type AuditRowInput = Omit<AuditRow, "audit_id" | "at"> & {
  at?: number;
};

export interface AuditLog {
  write(row: AuditRowInput): AuditRow;
  rows(): AuditRow[];
}

/**
 * Append-only log. Rows are frozen copies; there is no update or delete.
 *
 * With `dbPath` the rows persist in the `legacy_audit` table of that SQLite
 * file and survive restarts; UPDATE and DELETE are refused by triggers, the
 * same guarantee the financial audit table already carries.
 */
export function createAuditLog(dbPath?: string): AuditLog {
  if (dbPath === undefined) return createMemoryAuditLog();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS legacy_audit (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      actor TEXT NOT NULL,
      job_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      payout_batch_id TEXT,
      paypal_transaction_id TEXT
    );
    CREATE TRIGGER IF NOT EXISTS legacy_audit_no_update BEFORE UPDATE ON legacy_audit
    BEGIN SELECT RAISE(ABORT,'immutable audit log'); END;
    CREATE TRIGGER IF NOT EXISTS legacy_audit_no_delete BEFORE DELETE ON legacy_audit
    BEGIN SELECT RAISE(ABORT,'immutable audit log'); END;
  `);
  const insert = db.prepare(
    "INSERT INTO legacy_audit(at,actor,job_id,action,reason,amount_cents,payout_batch_id,paypal_transaction_id) VALUES(?,?,?,?,?,?,?,?)",
  );
  const select = db.prepare("SELECT * FROM legacy_audit ORDER BY sequence");
  return {
    write(row: AuditRowInput): AuditRow {
      const at = row.at ?? Date.now();
      const result = insert.run(
        at, row.actor, row.job_id, row.action, row.reason, row.amount_cents,
        row.payout_batch_id, row.paypal_transaction_id,
      );
      return Object.freeze({
        ...row,
        audit_id: `audit-${Number(result.lastInsertRowid)}`,
        at,
      });
    },
    rows(): AuditRow[] {
      return (select.all() as Array<Record<string, unknown>>).map((row) => ({
        audit_id: `audit-${Number(row.sequence)}`,
        at: Number(row.at),
        actor: String(row.actor),
        job_id: String(row.job_id),
        action: String(row.action) as AuditAction,
        reason: String(row.reason),
        amount_cents: Number(row.amount_cents),
        payout_batch_id: row.payout_batch_id === null ? null : String(row.payout_batch_id),
        paypal_transaction_id: row.paypal_transaction_id === null ? null : String(row.paypal_transaction_id),
      }));
    },
  };
}

function createMemoryAuditLog(): AuditLog {
  const stored: AuditRow[] = [];
  return {
    write(row: AuditRowInput): AuditRow {
      const written: AuditRow = Object.freeze({
        ...row,
        audit_id: `audit-${stored.length + 1}`,
        at: row.at ?? Date.now(),
      });
      stored.push(written);
      return written;
    },
    rows(): AuditRow[] {
      return stored.map((row) => ({ ...row }));
    },
  };
}


/**
 * Build an audit row from a decision, so the reason always names the
 * rule, the cap, and the job. An accepted row says all rules passed.
 * A rejected row carries the exact label and reason from the decision.
 * When the active policy is supplied the reason names the owner's
 * configured caps; without it the text stays generic rather than
 * claiming a cap value that may no longer be true.
 */
export function rowFromDecision(opts: {
  actor: string;
  jobId: string;
  amountCents: number;
  decision: Decision;
  policy?: Policy;
  payoutBatchId?: string | null;
  transactionId?: string | null;
  at?: number;
}): AuditRowInput {
  if (opts.decision.decision === "accept") {
    const caps = opts.policy
      ? `within the ${capText(opts.policy.perPaymentCapCents)} per-payment cap and the ${capText(opts.policy.weeklyCapCents)} weekly cap`
      : "within the configured per-payment cap and the configured weekly cap";
    return {
      actor: opts.actor,
      job_id: opts.jobId,
      action: "accepted",
      reason: `accepted: approved job, allowed recipient, ${caps}`,
      amount_cents: opts.amountCents,
      payout_batch_id: opts.payoutBatchId ?? null,
      paypal_transaction_id: opts.transactionId ?? null,
      at: opts.at,
    };
  }
  return {
    actor: opts.actor,
    job_id: opts.jobId,
    action: "rejected",
    reason: `${opts.decision.label}: ${opts.decision.reason}`,
    amount_cents: opts.amountCents,
    payout_batch_id: opts.payoutBatchId ?? null,
    paypal_transaction_id: opts.transactionId ?? null,
    at: opts.at,
  };
}
