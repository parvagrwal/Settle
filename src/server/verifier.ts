// Verifier — recomputes the grid from PayPal, never from the app's memory.
// Path 1: Reporting Transaction Search, through the PayPal Agent Toolkit's
// list_transactions tool. Path 2: Payouts GET, direct REST.
// Neither stored value is trusted. A disagreement is a named mismatch,
// never averaged away.
// The verifier checks the money facts: who was paid, how much, in what
// currency, and whether the payment has a PayPal transaction receipt.
// It also checks the roles, the agent is never a receiver or a payer,
// and the code identity, the enforcement files have not changed since
// the baseline was recorded.
import { createHash } from "node:crypto";
import { PayPalError } from "./paypalClient.ts";
import { dollarsToCents, type ReportingTransaction } from "./reporting.ts";

export interface StoredRow {
  jobId: string;
  freelancerId: string;
  receiverEmail: string;
  amountCents: number;
  currency: string;
  payoutBatchId: string;
  payoutItemId: string | null;
  transactionId: string | null;
  status: string;
}

export interface PayoutItemRead {
  payoutItemId: string;
  transactionId: string | null;
  jobId: string;
  receiverEmail: string;
  amountCents: number;
  currency: string;
  status: string;
}

export interface VerifyGridResult {
  ok: boolean;
  diff: string[];
  rowsChecked: number;
  reportingCount: number;
  payoutsCount: number;
}

export function hashFileText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" ? value : null;
}

/** Read the items out of a Payouts GET reply, `GET /v1/payments/payouts/{id}`. */
export function payoutItemsFromPoll(raw: Record<string, unknown>): PayoutItemRead[] {
  const items = raw.items;
  if (!Array.isArray(items)) {
    throw new PayPalError(200, "VERIFIER_READ_FAILED", "Payouts reply had no items list");
  }
  return items.map((entry) => {
    const item = entry as Record<string, unknown>;
    const payoutItem = (item.payout_item ?? {}) as Record<string, unknown>;
    // The documented shape nests the receiver and the amount inside
    // payout_item. Some replies carry them flat on the item, and the amount
    // can be a number instead of a string. Try the nested shape first,
    // then the flat one. If a field is still missing, the error names it
    // and lists the keys that are there, so the next run shows the real shape.
    const receiverEmail = readString(payoutItem, "receiver") ?? readString(item, "receiver");
    const amountObj = (payoutItem.amount ?? item.amount ?? {}) as Record<string, unknown>;
    const currency = readString(amountObj, "currency");
    const valueRaw = amountObj.value;
    const value =
      typeof valueRaw === "string" ? valueRaw : typeof valueRaw === "number" ? String(valueRaw) : null;
    const payoutItemId = readString(item, "payout_item_id");
    const jobId = readString(item, "sender_item_id") ?? readString(payoutItem, "sender_item_id");
    const status = readString(item, "transaction_status");
    const missing: string[] = [];
    if (!payoutItemId) missing.push("payout_item_id");
    if (!jobId) missing.push("sender_item_id");
    if (!receiverEmail) missing.push("receiver");
    if (!currency) missing.push("amount.currency");
    if (value === null) missing.push("amount.value");
    if (!status) missing.push("transaction_status");
    if (missing.length > 0) {
      throw new PayPalError(
        200,
        "VERIFIER_READ_FAILED",
        `Payouts item was missing ${missing.join(", ")}. Item keys: ${Object.keys(item).join(", ")}. Payout item keys: ${Object.keys(payoutItem).join(", ")}`,
      );
    }
    return {
      // The missing-field check above guarantees these are strings here.
      payoutItemId: payoutItemId!,
      transactionId: readString(item, "transaction_id"),
      jobId: jobId!,
      receiverEmail: receiverEmail!,
      amountCents: dollarsToCents(value!),
      currency: currency!,
      status: status!,
    };
  });
}

/** Build the stored copy from the payout record, `evidence/payouts/payouts-create.json`.
 * That file holds the jobs the app paid, with the payout batch ID, but it
 * never recorded a payout item ID or a transaction ID: the payout code
 * writes those back to the job only as the batch ID and the status. The
 * item ID and the transaction ID come from the live Payouts read, and the
 * join between the stored copy and the Payouts read is the job ID, which
 * the payout code sends as the sender item ID. */
export function storedRowsFromCreate(
  raw: Record<string, unknown>,
): StoredRow[] {
  const payoutBatchId = readString(raw, "payout_batch_id");
  const jobs = raw.jobs;
  if (!payoutBatchId || !Array.isArray(jobs)) {
    throw new PayPalError(200, "VERIFIER_READ_FAILED", "Payout record had no payout_batch_id or jobs list");
  }
  return jobs.map((entry) => {
    const job = entry as Record<string, unknown>;
    const jobId = readString(job, "job_id");
    const freelancerId = readString(job, "freelancer_id");
    const receiverEmail = readString(job, "paypal_email");
    const amountCents = job.amount_cents;
    const currency = readString(job, "currency");
    const status = readString(job, "status");
    if (!jobId || !freelancerId || !receiverEmail || typeof amountCents !== "number" || !currency || !status) {
      throw new PayPalError(200, "VERIFIER_READ_FAILED", "Payout record job was missing an id, receiver, amount, or status");
    }
    return {
      jobId,
      freelancerId,
      receiverEmail,
      amountCents,
      currency,
      payoutBatchId,
      // The app never recorded these. They come from the live Payouts read.
      payoutItemId: null,
      transactionId: null,
      status,
    };
  });
}

function expectedStoredStatus(payoutStatus: string): string {
  if (payoutStatus === "SUCCESS") return "paid";
  if (payoutStatus === "UNCLAIMED") return "unclaimed";
  return "failed";
}

export function verifyGrid(opts: {
  storedRows: StoredRow[];
  reporting: ReportingTransaction[];
  payoutItems: PayoutItemRead[];
  /** The batch ID the live Payouts read returned. The stored copy must name the same batch. */
  payoutBatchId: string;
  allowlistEmails: string[];
  agentEmail: string;
  expectedCodeHashes?: { decide: string; policy: string };
  currentCodeHashes?: { decide: string; policy: string };
}): VerifyGridResult {
  const diff: string[] = [];

  for (const row of opts.storedRows) {
    // The join is the job ID, which the payout code sends as the sender
    // item ID. The stored copy never recorded a payout item ID.
    const item = opts.payoutItems.find((entry) => entry.jobId === row.jobId);
    if (row.payoutBatchId !== opts.payoutBatchId) {
      diff.push(
        `job ${row.jobId}: payout batch is ${row.payoutBatchId} in the stored copy but the live read returned ${opts.payoutBatchId}`,
      );
    }
    if (!item) {
      diff.push(`job ${row.jobId}: no payout item found in the Payouts read for this job`);
      continue;
    }
    if (item.receiverEmail !== row.receiverEmail) {
      diff.push(
        `job ${row.jobId}: receiver is ${row.receiverEmail} in the stored copy but PayPal paid ${item.receiverEmail}`,
      );
    }
    if (item.amountCents !== row.amountCents) {
      diff.push(
        `job ${row.jobId}: amount is ${row.amountCents} cents in the stored copy but PayPal paid ${item.amountCents} cents`,
      );
    }
    if (item.currency !== row.currency) {
      diff.push(
        `job ${row.jobId}: currency is ${row.currency} in the stored copy but PayPal paid ${item.currency}`,
      );
    }
    if (row.status !== expectedStoredStatus(item.status)) {
      diff.push(
        `job ${row.jobId}: status is ${row.status} in the stored copy but PayPal says ${item.status}`,
      );
    }
    if (item.receiverEmail === opts.agentEmail) {
      diff.push(`job ${row.jobId}: the agent is named as the receiver, ${opts.agentEmail}`);
    }
    if (row.receiverEmail === opts.agentEmail) {
      diff.push(`job ${row.jobId}: the agent is named as the receiver in the stored copy, ${opts.agentEmail}`);
    }
    if (!opts.allowlistEmails.includes(item.receiverEmail)) {
      diff.push(`job ${row.jobId}: receiver ${item.receiverEmail} is not on the allowlist`);
    }
    if (!opts.allowlistEmails.includes(row.receiverEmail)) {
      diff.push(`job ${row.jobId}: receiver ${row.receiverEmail} in the stored copy is not on the allowlist`);
    }
    const transactionId = item.transactionId ?? row.transactionId;
    if (transactionId === null) {
      diff.push(`job ${row.jobId}: no PayPal transaction ID, the payment has no receipt`);
      continue;
    }
    const tx = opts.reporting.find((entry) => entry.transactionId === transactionId);
    if (!tx) {
      // The two PayPal paths disagree, or Reporting has not caught up yet.
      // Named as a drift, never averaged away, never passed silently.
      diff.push(`drift: payout item ${item.payoutItemId} transaction ${transactionId} not found in Reporting`);
      continue;
    }
    if (Math.abs(tx.amountCents) !== item.amountCents) {
      diff.push(
        `drift: job ${row.jobId}: Reporting shows ${tx.amountCents} cents but Payouts shows ${item.amountCents} cents for transaction ${transactionId}`,
      );
    }
    if (tx.currency !== item.currency) {
      diff.push(
        `drift: job ${row.jobId}: Reporting currency ${tx.currency} but Payouts currency ${item.currency} for transaction ${transactionId}`,
      );
    }
    // For a payout transaction, Reporting's payer_info holds the
    // recipient, not the sender. Proved on the live run of 2026-11-07:
    // for both payout transactions, payer_info.account_id equalled
    // transaction_info.paypal_account_id, the payee's account, and the
    // payer email was the freelancer's. So the payer field is never
    // checked as the sender here. The direction of the money is proved
    // by the signed amount instead: a payout debit from the sender's
    // account is negative. A zero or positive amount would mean money
    // did not leave the sender's account, which is wrong for a payout.
    if (tx.amountCents >= 0) {
      diff.push(
        `drift: job ${row.jobId}: Reporting shows ${tx.amountCents} cents for transaction ${transactionId}, money did not leave the sender's account`,
      );
    }
    if (tx.payerEmail !== null && tx.payerEmail === opts.agentEmail) {
      diff.push(`job ${row.jobId}: the agent is named as the payer in Reporting`);
    }
  }

  if (opts.expectedCodeHashes !== undefined) {
    if (opts.currentCodeHashes === undefined) {
      diff.push("code identity: no current code hashes given, the check was skipped");
    } else {
      if (opts.currentCodeHashes.decide !== opts.expectedCodeHashes.decide) {
        diff.push(
          `code identity: decide.ts hash changed, expected ${opts.expectedCodeHashes.decide}, got ${opts.currentCodeHashes.decide}`,
        );
      }
      if (opts.currentCodeHashes.policy !== opts.expectedCodeHashes.policy) {
        diff.push(
          `code identity: policy.ts hash changed, expected ${opts.expectedCodeHashes.policy}, got ${opts.currentCodeHashes.policy}`,
        );
      }
    }
  }

  return {
    ok: diff.length === 0,
    diff,
    rowsChecked: opts.storedRows.length,
    reportingCount: opts.reporting.length,
    payoutsCount: opts.payoutItems.length,
  };
}
