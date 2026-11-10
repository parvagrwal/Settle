// Provider calls for the financial ledger.
//
// Three rules govern this module:
//
//   1. PayPal processing is not a failure. A batch that PayPal accepted and has
//      not finished is `awaiting_confirmation`, with durable work scheduled.
//   2. An ambiguous submission is `outcome_unknown`. It is never re-POSTed
//      without an explicit, audited idempotent-replay decision, because the only
//      documented lookup key for a batch is its PayPal id, not the sender id.
//   3. Reconciliation reads. It does not execute. The one exception is the
//      explicit replay probe, which is opt-in per call, uses the same
//      `sender_batch_id` PayPal documents as idempotent for 30 days, and is
//      recorded in the audit trail before the request is made.
import {
  createPayoutBatch,
  extractBatchIdFromDuplicateError,
  getPayoutBatch,
  pollPayoutBatch,
  centsToDollars,
} from "./payouts.ts";
import { PayPalError, type FetchFn } from "./paypalClient.ts";
import { isTerminal, type ConfirmationPolicy } from "./paymentState.ts";
import { estimatePayoutFee } from "./fees.ts";
import { parseDecimalToMinor } from "./money.ts";
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

const PROVIDER_STATUS = new Set(["SUCCESS", "FAILED", "PENDING", "UNCLAIMED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"]);

function timestamp(item: Row, fallback: string): string {
  for (const key of ["time_processed", "time_created", "time_updated"]) {
    if (typeof item[key] === "string") return String(item[key]);
  }
  return fallback;
}

/** One provider fact → the ledger. Returns false when the item belongs to no
 * payment (recorded as a provider orphan discrepancy by the store). */
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
  if (money.currency !== "USD") throw new Error(`unsupported provider currency ${String(money.currency)}: this ledger is USD-only`);
  if (!PROVIDER_STATUS.has(status)) throw new Error(`unsupported provider item status ${status}`);
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
    amountCents: parseDecimalToMinor(money.value),
    currency: "USD",
    status,
    providerTimestamp: timestamp(item, batchTime ?? now),
    raw: item,
    reconciliationRunId,
    reconciledAt: reconciliationRunId ? now : undefined,
    environment: "sandbox",
  });
  return true;
}

async function applyBatchDetail(
  opts: Options,
  detail: Row,
  fallbackBatchId: string,
  at: string,
  reconciliationRunId?: string,
): Promise<{ items: number; batchStatus: string | null }> {
  const header = detail.batch_header as Row | undefined;
  const senderHeader = header?.sender_batch_header as Row | undefined;
  const headerSenderId = typeof senderHeader?.sender_batch_id === "string"
    ? senderHeader.sender_batch_id
    : typeof header?.sender_batch_id === "string"
      ? header.sender_batch_id
      : "";
  const batchTime = typeof header?.time_completed === "string"
    ? header.time_completed
    : typeof header?.time_created === "string"
      ? header.time_created
      : undefined;
  const items = Array.isArray(detail.items) ? (detail.items as Row[]) : [];
  let recorded = 0;
  for (const item of items) {
    if (await providerItem(opts, item, headerSenderId, fallbackBatchId, at, reconciliationRunId, batchTime)) recorded++;
  }
  return { items: recorded, batchStatus: typeof header?.batch_status === "string" ? header.batch_status : null };
}

export interface ReconciliationResult {
  batchesRead: number;
  itemsRecorded: number;
  reconciliationRunId: string;
  failures: number;
}

/**
 * Read provider state for every in-flight payment.
 *
 * - A payment with a stored batch id is read by that id.
 * - A payment whose submission is ambiguous has no batch id. Reading it requires
 *   a lookup key PayPal does not expose. By default this run records a durable
 *   discrepancy and leaves the payment alone. With `idempotentReplay: true` the
 *   caller explicitly accepts a replay probe: the same sender_batch_id is sent
 *   once, PayPal answers with the original batch (documented duplicate
 *   semantics), and the batch is then read normally.
 * - A read failure for one batch is recorded and does not discard the results
 *   for the others.
 */
export async function reconcilePayPal(
  opts: Options & { batchIds?: string[]; idempotentReplay?: boolean },
): Promise<ReconciliationResult> {
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
      if (!opts.idempotentReplay) {
        opts.store.recordDiscrepancy({
          paymentId: attempt.paymentId,
          type: "AMBIGUOUS_SUBMISSION_WITHOUT_BATCH_ID",
          details: {
            senderBatchId: attempt.senderBatchId,
            paymentStatus: attempt.paymentStatus,
            recovery: "An operator may run reconciliation with idempotentReplay to probe the documented duplicate sender_batch_id, or supply the batch id.",
          },
          at: startedAt,
        });
        continue;
      }
      // Explicit, audited probe. Same sender_batch_id, same PayPal-Request-Id.
      opts.store.auditReplayProbe({ paymentId: attempt.paymentId, senderBatchId: attempt.senderBatchId, at: startedAt });
      opts.store.recordDiscrepancy({
        paymentId: attempt.paymentId,
        type: "IDEMPOTENT_REPLAY_PROBED",
        details: { senderBatchId: attempt.senderBatchId },
        at: startedAt,
      });
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
      if (typeof extraBatchId === "string" && extraBatchId.trim()) batchesToFetch.add(extraBatchId.trim());
    }

    let batchesRead = 0;
    let itemsRecorded = 0;
    let failures = 0;
    for (const batchId of batchesToFetch) {
      try {
        const detail = await getPayoutBatch({
          baseUrl: opts.baseUrl,
          token: opts.token,
          refreshToken: opts.refreshToken,
          fetchFn: opts.fetchFn,
          payoutBatchId: batchId,
        });
        const applied = await applyBatchDetail(opts, detail.raw, batchId, startedAt, reconciliationRunId);
        itemsRecorded += applied.items;
        batchesRead++;
      } catch (error) {
        failures++;
        opts.store.recordDiscrepancy({
          paymentId: null,
          type: "RECONCILIATION_READ_FAILED",
          details: { payoutBatchId: batchId, error: error instanceof Error ? error.message : String(error) },
          at: startedAt,
        });
      }
    }

    if (batchesRead === 0 && failures > 0) {
      throw new Error(`reconciliation could not read any batch (${failures} read failure(s)); unresolved work is preserved`);
    }
    opts.store.completeReconciliation(reconciliationRunId, startedAt, batchesRead, itemsRecorded);
    return { batchesRead, itemsRecorded, reconciliationRunId, failures };
  } catch (error) {
    opts.store.failReconciliation(reconciliationRunId, (opts.now?.() ?? new Date()).toISOString());
    throw error;
  }
}

/** The batch status this server reports for a payment state. It never upgrades
 * "accepted but not settled" into "SUCCESS". */
export function publicBatchStatus(paymentStatus: string, providerBatchStatus: string | null): string {
  switch (paymentStatus) {
    case "provider_confirmed": return "SUCCESS";
    case "pending":
    case "awaiting_confirmation": return "PROCESSING";
    case "unclaimed": return "UNCLAIMED";
    case "onhold": return "ONHOLD";
    case "failed": return providerBatchStatus === "DENIED" ? "DENIED" : "FAILED";
    case "blocked": return "BLOCKED";
    case "returned": return "RETURNED";
    case "reversed": return "REVERSED";
    case "refunded": return "REFUNDED";
    case "outcome_unknown": return "OUTCOME_UNKNOWN";
    default: return providerBatchStatus ?? "PROCESSING";
  }
}

function isDefiniteRefusal(error: unknown): boolean {
  if (!(error instanceof PayPalError)) return false;
  // 4xx means PayPal refused the request; nothing moved. 408/429 are transient.
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

export interface SubmissionResult {
  status: string;
  batchStatus?: string;
  payoutBatchId?: string | null;
  item: ReturnType<FinancialStore["getPayoutItem"]>;
  confirmationScheduled: boolean;
}

export async function submitApprovedPayment(
  opts: Options & {
    jobId: string;
    confirmationPolicy?: ConfirmationPolicy;
    feePolicyId?: string;
    scheduleConfirmation?: boolean;
  },
): Promise<SubmissionResult> {
  const clock = () => (opts.now?.() ?? new Date()).toISOString();
  const existing = opts.store.getPaymentByJob(opts.jobId);
  if (!existing) throw new Error("payment is not owner-approved");
  if (existing.recordOrigin !== "application") {
    throw new Error("DEMO_RECORD_NOT_PAYABLE: this is a seeded or synthetic demonstration record; it cannot be submitted to PayPal");
  }
  if (existing.status === "outcome_unknown") {
    throw new Error("payment outcome is unknown; reconcile by durable identity instead of resubmitting");
  }
  if (existing.status === "reserved" || existing.status === "submitted") {
    throw new Error(`SUBMISSION_CONFLICT: payment is ${existing.status}, submission already in flight`);
  }
  if (existing.status === "provider_confirmed") {
    const item = opts.store.getPayoutItem(existing.paymentId);
    return { status: existing.status, batchStatus: "SUCCESS", payoutBatchId: item?.payoutBatchId ?? null, item, confirmationScheduled: false };
  }
  if (["pending", "awaiting_confirmation", "unclaimed", "onhold", "reconciliation_required"].includes(existing.status)) {
    await reconcilePayPal(opts);
    const refreshed = opts.store.getPaymentByJob(opts.jobId)!;
    const item = opts.store.getPayoutItem(refreshed.paymentId);
    const payoutBatchId = item?.payoutBatchId ?? opts.store.getAttemptBatchId(refreshed.paymentId);
    if (refreshed.status === "provider_confirmed") {
      return { status: refreshed.status, batchStatus: "SUCCESS", payoutBatchId, item, confirmationScheduled: false };
    }
    if (["pending", "awaiting_confirmation", "unclaimed", "onhold", "reconciliation_required"].includes(refreshed.status)) {
      opts.store.scheduleConfirmation({ paymentId: refreshed.paymentId, at: clock(), delayMs: 0 });
      return {
        status: refreshed.status,
        batchStatus: refreshed.status === "pending" ? "PROCESSING" : refreshed.status.toUpperCase(),
        payoutBatchId,
        item,
        confirmationScheduled: true,
      };
    }
    if (refreshed.status === "outcome_unknown" || refreshed.status === "submitted" || refreshed.status === "reserved") {
      throw new Error("payment outcome is unknown; reconcile by durable identity instead of resubmitting");
    }
  }
  // A complete read establishes freshness before the reservation transaction.
  await reconcilePayPal(opts);
  const reservedAt = clock();
  const reservation = opts.store.reservePayment({ jobId: opts.jobId, at: reservedAt });
  const payment = opts.store.getPaymentByJob(opts.jobId)!;
  const feePolicyId = opts.feePolicyId;
  const estimate = estimatePayoutFee({ amountMinor: payment.amountCents, policyId: feePolicyId });
  opts.store.recordFeeEstimate({
    paymentId: payment.paymentId,
    policyId: estimate.policyId,
    policyVersion: estimate.policyVersion,
    amountMinor: estimate.amountMinor,
    estimatedFeeMinor: estimate.estimatedFeeMinor,
    currency: estimate.currency,
    method: estimate.method,
    formula: estimate.formula,
    sourceUrl: estimate.source.url,
    sourceRetrievedAt: estimate.source.retrievedAt,
    at: reservedAt,
  });
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
    const reason = error instanceof Error ? error.message : "provider submission failed";
    if (isDefiniteRefusal(error)) {
      opts.store.markSubmissionFailed(attempt.attemptId, reason, clock());
      throw error;
    }
    opts.store.markOutcomeUnknown(attempt.attemptId, reason, clock());
    throw error;
  }

  // Durable work exists before the first read, so a crash between the create and
  // the read cannot lose the payment.
  opts.store.scheduleConfirmation({ paymentId: reservation.paymentId, at: clock(), delayMs: 0 });

  // A short, bounded immediate read. It is an optimisation, not the source of truth.
  const maxAttempts = opts.pollMaxAttempts ?? 2;
  const baseDelay = opts.pollDelayMs ?? 500;
  let pollError: string | null = null;
  let batchStatus: string | null = null;
  let appliedItems = 0;
  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
    try {
      const polled = await pollPayoutBatch({
        baseUrl: opts.baseUrl,
        token: opts.token,
        refreshToken: opts.refreshToken,
        fetchFn: opts.fetchFn,
        payoutBatchId: batchId,
        maxAttempts: 1,
        delayMs: 0,
      });
      batchStatus = polled.batchStatus;
      const applied = await applyBatchDetail(opts, polled.raw, batchId, clock());
      appliedItems += applied.items;
      const current = opts.store.getPaymentByJob(opts.jobId)!;
      if (isTerminal(current.status as never)) break;
      if (["DENIED", "CANCELED"].includes(polled.batchStatus)) break;
    } catch (error) {
      pollError = error instanceof Error ? error.message : String(error);
      break;
    }
    if (attemptIndex + 1 < maxAttempts) await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, attemptIndex)));
  }

  const finalPayment = opts.store.getPaymentByJob(opts.jobId)!;
  if (isTerminal(finalPayment.status as never)) {
    opts.store.completeConfirmation(reservation.paymentId, clock());
    const item = opts.store.getPayoutItem(reservation.paymentId);
    return { status: finalPayment.status, batchStatus: publicBatchStatus(finalPayment.status, batchStatus), payoutBatchId: batchId, item, confirmationScheduled: false };
  }
  if (appliedItems === 0) {
    opts.store.markAwaitingConfirmation(attempt.attemptId, batchId, clock());
    if (pollError) {
      // The durable job already exists and is due now. Record the read error
      // without pushing the next attempt out; the sweep retries immediately.
      opts.store.noteConfirmationError(reservation.paymentId, `immediate read failed: ${pollError}`, clock());
    }
  }
  const item = opts.store.getPayoutItem(reservation.paymentId);
  const effective = opts.store.getPaymentByJob(opts.jobId)!;
  return {
    status: effective.status,
    batchStatus: publicBatchStatus(effective.status, batchStatus),
    payoutBatchId: batchId,
    item,
    confirmationScheduled: true,
  };
}

export interface ConfirmationSweep {
  checked: number;
  confirmed: number;
  stillPending: number;
  errors: number;
}

/**
 * Resolve payments whose durable confirmation work is due. Called by the
 * server's timer, by the manual reconciliation route, and after a restart.
 * Each item is read by its own batch id; nothing is submitted here.
 */
export async function confirmDuePayments(
  opts: Options & { policy: ConfirmationPolicy; limit?: number; random?: () => number },
): Promise<ConfirmationSweep> {
  const at = (opts.now?.() ?? new Date()).toISOString();
  const due = opts.store.listDueConfirmations(at, opts.limit ?? 25);
  const sweep: ConfirmationSweep = { checked: due.length, confirmed: 0, stillPending: 0, errors: 0 };
  if (due.length === 0) return sweep;
  const runId = opts.store.beginReconciliation(at);
  let readFailures = 0;
  try {
    for (const job of due) {
      if (!job.payoutBatchId) {
        sweep.errors++;
        opts.store.recordConfirmationFailure({
          paymentId: job.paymentId,
          error: "no provider batch id is stored for this payment; reconciliation must recover it",
          at,
          policy: opts.policy,
          random: opts.random,
        });
        continue;
      }
      try {
        const detail = await getPayoutBatch({
          baseUrl: opts.baseUrl,
          token: opts.token,
          refreshToken: opts.refreshToken,
          fetchFn: opts.fetchFn,
          payoutBatchId: job.payoutBatchId,
        });
        await applyBatchDetail(opts, detail.raw, job.payoutBatchId, at, runId);
        const payment = opts.store.getPaymentByJob(job.jobId);
        if (payment && isTerminal(payment.status as never)) {
          opts.store.completeConfirmation(job.paymentId, at);
          if (payment.status === "provider_confirmed") sweep.confirmed++;
        } else {
          sweep.stillPending++;
          opts.store.recordConfirmationFailure({
            paymentId: job.paymentId,
            error: "provider has not settled this payout item yet",
            at,
            policy: opts.policy,
            random: opts.random,
          });
        }
      } catch (error) {
        sweep.errors++;
        readFailures++;
        opts.store.recordConfirmationFailure({
          paymentId: job.paymentId,
          error: `confirmation read failed: ${error instanceof Error ? error.message : String(error)}`,
          at,
          policy: opts.policy,
          random: opts.random,
        });
      }
    }
  } finally {
    if (readFailures === due.length) opts.store.failReconciliation(runId, at);
    else opts.store.completeReconciliation(runId, at, due.length - readFailures, sweep.confirmed);
  }
  return sweep;
}

export { parseDecimalToMinor as paypalDecimalToMinorUnits, centsToDollars };
