// Audit trail — every decision writes a reason, and the record is
// append-only. A recorded refusal is an audit row, shown in the grid,
// never just a console log. No PayPal call happens in this file.
// Sandbox only, test money, no real money moves.
// Worst-case exposure: $1,500 per week, printed wherever a cap is shown.
import type { Decision } from "../shared/types.ts";

export type AuditAction = "accepted" | "rejected" | "paid" | "held";

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

/** Append-only log. Rows are frozen copies; there is no update or delete. */
export function createAuditLog(): AuditLog {
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
 */
export function rowFromDecision(opts: {
  actor: string;
  jobId: string;
  amountCents: number;
  decision: Decision;
  payoutBatchId?: string | null;
  transactionId?: string | null;
  at?: number;
}): AuditRowInput {
  if (opts.decision.decision === "accept") {
    return {
      actor: opts.actor,
      job_id: opts.jobId,
      action: "accepted",
      reason:
        "accepted: approved job, allowed recipient, within the $200 per-payment cap and the $1,500 weekly cap",
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
