import { createPayoutBatch, pollPayoutBatch, getPayoutBatch, extractBatchIdFromDuplicateError, centsToDollars } from "./payouts.ts";
import { type FetchFn } from "./paypalClient.ts";
import type { FinancialStore } from "./financialStore.ts";

type Row = Record<string, unknown>;
type Options = {
  store: FinancialStore;
  baseUrl: string;
  token: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
  now?: () => Date;
  pollMaxAttempts?: number;
  pollDelayMs?: number;
};

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
async function providerItem(
  opts: Options,
  item: Row,
  senderBatchId: string,
  payoutBatchId: string,
  now: string,
  reconciliationRunId?: string,
  batchTime?: string,
): Promise<boolean> {
  const nested = item.payout_item && typeof item.payout_item === "object" ? (item.payout_item as Row) : undefined;
  const key = nested?.sender_item_id ?? item.sender_item_id;
  const receiver = nested?.receiver ?? item.receiver;
  const money = (nested?.amount ?? item.amount) as Row | undefined;
  const status = item.transaction_status;
  const id = item.payout_item_id;
  if (typeof key !== "string" || typeof status !== "string" || typeof id !== "string") {
    throw new Error("provider item is missing sender identity or status");
  }
  if (typeof receiver !== "string" || typeof money?.value !== "string" || typeof money.currency !== "string") {
    throw new Error("provider item is missing recipient or amount");
  }
  const resolvedBatchId = typeof item.payout_batch_id === "string" ? item.payout_batch_id : payoutBatchId;
  const payment = opts.store.getPaymentByIdempotency(key);
  if (!payment) {
    opts.store.recordDiscrepancy({ paymentId: null, type: "PROVIDER_ORPHAN", details: { payoutBatchId: resolvedBatchId, payoutItemId: id, senderItemId: key }, at: now });
    return false;
  }
  opts.store.recordPayoutItem({
    paymentId: payment.paymentId,
    senderBatchId: senderBatchId || payment.idempotencyKey,
    payoutBatchId: resolvedBatchId,
    payoutItemId: id,
    transactionId: typeof item.transaction_id === "string" ? item.transaction_id : null,
    activityId: typeof item.activity_id === "string" ? item.activity_id : null,
    recipientEmail: receiver,
    amountCents: minorUnits(money.value),
    currency: money.currency,
    status,
    providerTimestamp: timestamp(item, batchTime ?? now),
    raw: item,
    reconciliationRunId,
    reconciledAt: reconciliationRunId ? now : undefined,
  });
  return true;
}

export async function reconcilePayPal(
  opts: Options & { batchIds?: string[] },
): Promise<{ batchesRead: number; itemsRecorded: number; reconciliationRunId: string }> {
  const end = opts.now?.() ?? new Date();
  const startedAt = end.toISOString();
  const reconciliationRunId = opts.store.beginReconciliation(startedAt);
  try {
    const attempts = opts.store.listReconcilableAttempts(startedAt);
    const batchesToFetch = new Set<string>();

    for (const attempt of attempts) {
      if (attempt.payoutBatchId) {
        batchesToFetch.add(attempt.payoutBatchId);
        continue;
      }
      // If createPayoutBatch failed before returning a payout_batch_id,
      // resend with the exact same sender_batch_id and PayPal-Request-Id.
      // PayPal returns either the idempotent batch (201) or HTTP 400
      // DUPLICATE_REQUEST_ID linking to the original batch.
      try {
        const probe = await createPayoutBatch({
          baseUrl: opts.baseUrl,
          token: opts.token,
          refreshToken: opts.refreshToken,
          fetchFn: opts.fetchFn,
          senderBatchId: attempt.senderBatchId,
          requestId: attempt.senderBatchId,
          items: [{ jobId: attempt.idempotencyKey, recipientEmail: attempt.recipientEmail, amountCents: attempt.amountCents }],
        });
        opts.store.recordAttemptBatchId(attempt.attemptId, probe.payoutBatchId);
        batchesToFetch.add(probe.payoutBatchId);
      } catch (error) {
        const recoveredBatchId = extractBatchIdFromDuplicateError(error);
        if (!recoveredBatchId) throw error;
        opts.store.recordAttemptBatchId(attempt.attemptId, recoveredBatchId);
        batchesToFetch.add(recoveredBatchId);
      }
    }

    for (const extraBatchId of opts.batchIds ?? []) {
      if (typeof extraBatchId === "string" && extraBatchId.trim()) {
        batchesToFetch.add(extraBatchId.trim());
      }
    }

    let batchesRead = 0;
    let itemsRecorded = 0;
    for (const batchId of batchesToFetch) {
      const detail = await getPayoutBatch({
        baseUrl: opts.baseUrl,
        token: opts.token,
        refreshToken: opts.refreshToken,
        fetchFn: opts.fetchFn,
        payoutBatchId: batchId,
      });
      const header = detail.raw.batch_header as Row | undefined;
      const senderHeader = header?.sender_batch_header as Row | undefined;
      const headerSenderId = typeof senderHeader?.sender_batch_id === "string"
        ? senderHeader.sender_batch_id
        : typeof header?.sender_batch_id === "string"
          ? header.sender_batch_id
          : undefined;
      const batchTime = typeof header?.time_completed === "string"
        ? header.time_completed
        : typeof header?.time_created === "string"
          ? header.time_created
          : undefined;
      const items = Array.isArray(detail.raw.items) ? (detail.raw.items as Row[]) : [];
      for (const item of items) {
        if (await providerItem(opts, item, headerSenderId ?? "", batchId, startedAt, reconciliationRunId, batchTime)) {
          itemsRecorded++;
        }
      }
      batchesRead++;
    }

    opts.store.completeReconciliation(reconciliationRunId, startedAt, batchesRead, itemsRecorded);
    return { batchesRead, itemsRecorded, reconciliationRunId };
  } catch (error) {
    opts.store.failReconciliation(reconciliationRunId, (opts.now?.() ?? new Date()).toISOString());
    throw error;
  }
}

export async function submitApprovedPayment(
  opts: Options & { jobId: string },
): Promise<{ status: string; batchStatus?: string; payoutBatchId?: string | null; item: ReturnType<FinancialStore["getPayoutItem"]> }> {
  const clock = () => (opts.now?.() ?? new Date()).toISOString();
  const existing = opts.store.getPaymentByJob(opts.jobId);
  if (existing?.status === "outcome_unknown") {
    throw new Error("payment outcome is unknown; reconcile by durable identity instead of resubmitting");
  }
  if (existing?.status === "reserved" || existing?.status === "submitted") {
    throw new Error(`SUBMISSION_CONFLICT: payment is ${existing.status}, submission already in flight`);
  }
  if (existing?.status === "provider_confirmed") {
    const item = opts.store.getPayoutItem(existing.paymentId);
    return { status: existing.status, batchStatus: "SUCCESS", payoutBatchId: item?.payoutBatchId ?? null, item };
  }
  if (existing && ["pending", "unclaimed", "onhold"].includes(existing.status)) {
    await reconcilePayPal(opts);
    const refreshed = opts.store.getPaymentByJob(opts.jobId)!;
    const item = opts.store.getPayoutItem(refreshed.paymentId);
    const payoutBatchId = item?.payoutBatchId ?? opts.store.getAttemptBatchId(refreshed.paymentId);
    if (refreshed.status === "provider_confirmed") {
      return { status: refreshed.status, batchStatus: "SUCCESS", payoutBatchId, item };
    }
    if (["pending", "unclaimed", "onhold"].includes(refreshed.status)) {
      return {
        status: refreshed.status,
        batchStatus: refreshed.status === "pending" ? "PROCESSING" : refreshed.status.toUpperCase(),
        payoutBatchId,
        item,
      };
    }
    if (["outcome_unknown", "submitted", "reserved"].includes(refreshed.status)) {
      throw new Error("payment outcome is unknown; reconcile by durable identity instead of resubmitting");
    }
  }
  // A successful, complete read establishes freshness before the reservation transaction.
  await reconcilePayPal(opts);
  const reservedAt = clock();
  const reservation = opts.store.reservePayment({ jobId: opts.jobId, at: reservedAt });
  const payment = opts.store.getPaymentByJob(opts.jobId)!;
  const attempt = opts.store.beginSubmission(reservation.paymentId, reservedAt);
  let batchId: string;
  try {
    const result = await createPayoutBatch({
      baseUrl: opts.baseUrl,
      token: opts.token,
      refreshToken: opts.refreshToken,
      fetchFn: opts.fetchFn,
      senderBatchId: attempt.senderBatchId,
      requestId: attempt.senderBatchId,
      items: [{ jobId: payment.idempotencyKey, recipientEmail: payment.recipientEmail, amountCents: payment.amountCents }],
    });
    batchId = result.payoutBatchId;
    opts.store.recordAttemptBatchId(attempt.attemptId, batchId);
  } catch (error) {
    opts.store.markOutcomeUnknown(attempt.attemptId, error instanceof Error ? error.message : "provider submission failed", clock());
    throw error;
  }
  let poll;
  try {
    poll = await pollPayoutBatch({
      baseUrl: opts.baseUrl,
      token: opts.token,
      refreshToken: opts.refreshToken,
      fetchFn: opts.fetchFn,
      payoutBatchId: batchId,
      maxAttempts: opts.pollMaxAttempts ?? 18,
      delayMs: opts.pollDelayMs ?? 5000,
    });
  } catch (error) {
    opts.store.markOutcomeUnknown(attempt.attemptId, error instanceof Error ? error.message : "provider poll failed", clock());
    throw error;
  }
  const settledAt = clock();
  const header = poll.raw.batch_header as Row | undefined;
  const batchTime = typeof header?.time_completed === "string"
    ? header.time_completed
    : typeof header?.time_created === "string"
      ? header.time_created
      : undefined;
  const items = Array.isArray(poll.raw.items) ? (poll.raw.items as Row[]) : [];
  if (items.length === 0 && ["PENDING", "PROCESSING", "NEW"].includes(poll.batchStatus)) {
    opts.store.markProcessing(attempt.attemptId, batchId, "provider batch still processing without item details yet", settledAt);
    return { status: "pending", batchStatus: "PROCESSING", payoutBatchId: batchId, item: null };
  }
  if (items.length !== 1) {
    opts.store.markOutcomeUnknown(attempt.attemptId, "provider batch did not contain exactly one payment item", settledAt);
    throw new Error("payment remains outcome_unknown pending provider reconciliation");
  }
  await providerItem(opts, items[0], attempt.senderBatchId, batchId, settledAt, undefined, batchTime);
  const item = opts.store.getPayoutItem(reservation.paymentId);
  if (!item) {
    opts.store.markOutcomeUnknown(attempt.attemptId, "provider item could not be recorded", settledAt);
    throw new Error("payment remains outcome_unknown pending provider reconciliation");
  }
  const finalStatus = opts.store.getPaymentByJob(opts.jobId)!.status;
  const effectiveBatchStatus = ["pending", "onhold"].includes(finalStatus) ? "PROCESSING" : poll.batchStatus;
  return { status: finalStatus, batchStatus: effectiveBatchStatus, payoutBatchId: batchId, item };
}

export { minorUnits as paypalDecimalToMinorUnits, centsToDollars };
