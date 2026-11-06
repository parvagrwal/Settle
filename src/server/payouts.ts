// Payouts — Payouts REST, v1, REST only, NOT in the Agent Toolkit.
// POST /v1/payments/payouts, GET /v1/payments/payouts/{payout_batch_id},
// GET /v1/payments/payouts-item/{payout_item_id},
// POST /v1/payments/payouts-item/{payout_item_id}/cancel.
// Amounts are integer cents in code, dollars as strings in PayPal payloads.
// All items in a batch share one currency, USD. Max 15,000 items per call.
// sender_batch_id is unique per batch. Reused within 30 days, PayPal rejects
// it as duplicate, HTTP 400 DUPLICATE_REQUEST_ID, with a link to the original batch.
import { paypalRequest, PayPalError, type FetchFn } from "./paypalClient.ts";

export interface PayoutItemInput {
  jobId: string;
  recipientEmail: string;
  amountCents: number;
  note?: string;
}

export interface PayoutBatchResult {
  payoutBatchId: string;
  batchStatus: string;
  senderBatchId: string;
  requestId: string;
  raw: Record<string, unknown>;
}

export interface PayoutPollResult {
  payoutBatchId: string;
  batchStatus: string;
  raw: Record<string, unknown>;
}

export function centsToDollars(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("payouts: amountCents must be a positive integer, in cents");
  }
  return (amountCents / 100).toFixed(2);
}

export function makeSenderBatchId(nowMs: number = Date.now()): string {
  return `settle-${nowMs}`;
}

export async function createPayoutBatch(opts: {
  baseUrl: string;
  token: string;
  items: PayoutItemInput[];
  senderBatchId?: string;
  requestId?: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
}): Promise<PayoutBatchResult> {
  if (opts.items.length === 0) throw new Error("payouts: batch needs at least one item");
  if (opts.items.length > 15000) throw new Error("payouts: max 15,000 items per call");
  const senderBatchId = opts.senderBatchId ?? makeSenderBatchId();
  const requestId = opts.requestId ?? crypto.randomUUID();
  const body = {
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      email_subject: "Settle payout",
    },
    items: opts.items.map((item, i) => ({
      recipient_type: "EMAIL",
      amount: { value: centsToDollars(item.amountCents), currency: "USD" },
      receiver: item.recipientEmail,
      note: item.note ?? `Settle payout ${i + 1}`,
      sender_item_id: item.jobId,
    })),
  };
  const { status, json } = await paypalRequest({
    method: "POST",
    path: `${opts.baseUrl}/v1/payments/payouts`,
    token: opts.token,
    body,
    requestId,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  if (status !== 201) {
    throw new PayPalError(status, "PAYOUT_CREATE_FAILED", `Payouts create returned HTTP ${status}`);
  }
  const header = json.batch_header as Record<string, unknown> | undefined;
  const payoutBatchId = header?.payout_batch_id;
  const batchStatus = header?.batch_status;
  if (typeof payoutBatchId !== "string" || typeof batchStatus !== "string") {
    throw new PayPalError(status, "PAYOUT_CREATE_FAILED", "Payouts create reply had no payout_batch_id or batch_status");
  }
  return { payoutBatchId, batchStatus, senderBatchId, requestId, raw: json };
}

export async function pollPayoutBatch(opts: {
  baseUrl: string;
  token: string;
  payoutBatchId: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<PayoutPollResult> {
  const maxAttempts = opts.maxAttempts ?? 12;
  const delayMs = opts.delayMs ?? 5000;
  let last: PayoutPollResult | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { json } = await paypalRequest({
      method: "GET",
      path: `${opts.baseUrl}/v1/payments/payouts/${opts.payoutBatchId}`,
      token: opts.token,
      refreshToken: opts.refreshToken,
      fetchFn: opts.fetchFn,
    });
    const header = json.batch_header as Record<string, unknown> | undefined;
    const batchStatus = header?.batch_status;
    if (typeof batchStatus !== "string") {
      throw new PayPalError(200, "PAYOUT_POLL_FAILED", "Payouts poll reply had no batch_status");
    }
    last = { payoutBatchId: opts.payoutBatchId, batchStatus, raw: json };
    if (batchStatus === "SUCCESS" || batchStatus === "DENIED" || batchStatus === "CANCELED") {
      return last;
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  if (!last) throw new PayPalError(200, "PAYOUT_POLL_FAILED", "Payouts poll returned nothing");
  return last;
}

export async function getPayoutItem(opts: {
  baseUrl: string;
  token: string;
  payoutItemId: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
}): Promise<Record<string, unknown>> {
  const { json } = await paypalRequest({
    method: "GET",
    path: `${opts.baseUrl}/v1/payments/payouts-item/${opts.payoutItemId}`,
    token: opts.token,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  return json;
}

export async function cancelUnclaimedItem(opts: {
  baseUrl: string;
  token: string;
  payoutItemId: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
}): Promise<Record<string, unknown>> {
  const { json } = await paypalRequest({
    method: "POST",
    path: `${opts.baseUrl}/v1/payments/payouts-item/${opts.payoutItemId}/cancel`,
    token: opts.token,
    body: {},
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  return json;
}

export { PayPalError };
