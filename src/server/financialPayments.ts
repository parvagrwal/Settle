import { createPayoutBatch, pollPayoutBatch, centsToDollars } from "./payouts.ts";
import { paypalRequest, type FetchFn } from "./paypalClient.ts";
import type { FinancialStore } from "./financialStore.ts";

type Row = Record<string, unknown>;
type Options = { store: FinancialStore; baseUrl: string; token: string; refreshToken?: () => Promise<string>; fetchFn?: FetchFn; now?: () => Date };
const terminal = new Set(["SUCCESS", "FAILED", "RETURNED", "REFUNDED", "REVERSED", "BLOCKED"]);
function minorUnits(value: unknown): number {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) throw new Error("provider amount is not a two-decimal string");
  const [whole, fraction] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(result)) throw new Error("provider amount exceeds safe integer range");
  return result;
}
function timestamp(item: Row, now: string): string {
  for (const key of ["time_processed", "time_created", "time_updated"]) if (typeof item[key] === "string") return String(item[key]);
  return now;
}
async function providerItem(opts: Options, item: Row, senderBatchId: string, payoutBatchId: string, now: string): Promise<boolean> {
  const key = item.sender_item_id;
  const status = item.transaction_status;
  const id = item.payout_item_id;
  if (typeof key !== "string" || typeof status !== "string" || typeof id !== "string") throw new Error("provider item is missing sender identity or status");
  const payment = opts.store.getPaymentByIdempotency(key);
  const amount = item.payout_item as Row | undefined;
  const money = amount?.amount as Row | undefined;
  if (typeof item.receiver !== "string" || typeof money?.value !== "string" || typeof money.currency !== "string") throw new Error("provider item is missing recipient or amount");
  if (!payment) {
    opts.store.recordDiscrepancy({ paymentId: null, type: "PROVIDER_ORPHAN", details: { payoutItemId: id, senderItemId: key }, at: now });
    return false;
  }
  opts.store.recordPayoutItem({ paymentId: payment.paymentId, senderBatchId, payoutBatchId, payoutItemId: id,
    transactionId: typeof item.transaction_id === "string" ? item.transaction_id : null,
    activityId: typeof item.activity_id === "string" ? item.activity_id : null,
    recipientEmail: item.receiver, amountCents: minorUnits(money.value), currency: money.currency,
    status, providerTimestamp: timestamp(item, now), raw: item });
  return true;
}

export async function reconcilePayPal(opts: Options): Promise<{ batchesRead: number; itemsRecorded: number }> {
  const end = opts.now?.() ?? new Date();
  const start = new Date(end.getTime() - 169 * 60 * 60 * 1000);
  let page = 1; let batchesRead = 0; let itemsRecorded = 0;
  while (page <= 1000) {
    const query = new URLSearchParams({ start_date: start.toISOString(), end_date: end.toISOString(), page: String(page), page_size: "100", total_required: "true" });
    const { json } = await paypalRequest({ method: "GET", path: `${opts.baseUrl}/v1/payments/payouts?${query}`, token: opts.token, refreshToken: opts.refreshToken, fetchFn: opts.fetchFn });
    const batches = Array.isArray(json.items) ? json.items as Row[] : [];
    for (const batch of batches) {
      const header = batch.batch_header as Row | undefined;
      const batchId = header?.payout_batch_id; const senderId = header?.sender_batch_id;
      if (typeof batchId !== "string" || typeof senderId !== "string") throw new Error("provider batch has incomplete identity");
      const detail = await paypalRequest({ method: "GET", path: `${opts.baseUrl}/v1/payments/payouts/${batchId}`, token: opts.token, refreshToken: opts.refreshToken, fetchFn: opts.fetchFn });
      const items = Array.isArray(detail.json.items) ? detail.json.items as Row[] : [];
      for (const item of items) if (await providerItem(opts, item, senderId, batchId, end.toISOString())) itemsRecorded++;
      batchesRead++;
    }
    const total = Number(json.total_items ?? batches.length);
    if (batches.length === 0 || page * 100 >= total) break;
    page++;
  }
  opts.store.markReconciled(end.toISOString());
  return { batchesRead, itemsRecorded };
}

export async function submitApprovedPayment(opts: Options & { jobId: string }): Promise<{ status: string; batchStatus?: string; item: ReturnType<FinancialStore["getPayoutItem"]> }> {
  const clock = () => (opts.now?.() ?? new Date()).toISOString();
  const existing = opts.store.getPaymentByJob(opts.jobId);
  if (existing?.status === "outcome_unknown") throw new Error("payment outcome is unknown; reconcile by durable identity instead of resubmitting");
  if (existing?.status === "provider_confirmed") return { status: existing.status, batchStatus: "SUCCESS", item: opts.store.getPayoutItem(existing.paymentId) };
  // A successful, complete read establishes freshness before the reservation transaction.
  await reconcilePayPal(opts);
  const reservedAt = clock();
  const reservation = opts.store.reservePayment({ jobId: opts.jobId, at: reservedAt });
  const payment = opts.store.getPaymentByJob(opts.jobId)!;
  const attempt = opts.store.beginSubmission(reservation.paymentId, reservedAt);
  let batchId: string;
  try {
    const result = await createPayoutBatch({ baseUrl: opts.baseUrl, token: opts.token, refreshToken: opts.refreshToken, fetchFn: opts.fetchFn,
      senderBatchId: attempt.senderBatchId, requestId: attempt.senderBatchId,
      items: [{ jobId: payment.idempotencyKey, recipientEmail: payment.recipientEmail, amountCents: payment.amountCents }] });
    batchId = result.payoutBatchId;
  } catch (error) {
    opts.store.markOutcomeUnknown(attempt.attemptId, error instanceof Error ? error.message : "provider submission failed", clock());
    throw error;
  }
  let poll;
  try {
    poll = await pollPayoutBatch({ baseUrl: opts.baseUrl, token: opts.token, refreshToken: opts.refreshToken, fetchFn: opts.fetchFn, payoutBatchId: batchId, maxAttempts: 1 });
  } catch (error) {
    opts.store.markOutcomeUnknown(attempt.attemptId, error instanceof Error ? error.message : "provider poll failed", clock());
    throw error;
  }
  const settledAt = clock();
  const items = Array.isArray(poll.raw.items) ? poll.raw.items as Row[] : [];
  if (items.length !== 1) {
    opts.store.markOutcomeUnknown(attempt.attemptId, "provider batch did not contain exactly one payment item", settledAt);
    throw new Error("payment remains outcome_unknown pending provider reconciliation");
  }
  await providerItem(opts, items[0], attempt.senderBatchId, batchId, settledAt);
  const item = opts.store.getPayoutItem(reservation.paymentId);
  if (!item || !terminal.has(String(item.status))) {
    opts.store.markOutcomeUnknown(attempt.attemptId, "provider item is not terminal", settledAt);
    throw new Error("payment remains outcome_unknown pending provider reconciliation");
  }
  return { status: opts.store.getPaymentByJob(opts.jobId)!.status, batchStatus: poll.batchStatus, item };
}

export { minorUnits as paypalDecimalToMinorUnits, centsToDollars };
