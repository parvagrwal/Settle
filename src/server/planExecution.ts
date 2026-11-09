// Approved-plan execution — the plan store connected to PayPal.
// An approved plan is paid through the same Payouts call path the
// legacy flow uses, with the same PayPal client, never a second one.
// The plan's allocations become payout items, one per obligation, with
// the obligation ID as the sender item ID, so the batch reply joins
// back to the plan. The batch ID is the execution's idempotency key,
// so a retry never pays the same plan twice. Success is earned, not
// assumed: the batch is polled, then reconciled item by item, and the
// plan is marked succeeded only when the batch settled and every item
// shows SUCCESS for the right person and amount. Anything else — a
// failed item, an unsettled batch, a reply that cannot be read, PayPal
// unreachable — marks the plan failed, never succeeded. A plan that was
// never approved, or went stale before execution, is refused as denied
// before any PayPal call. Sandbox only, test money, no real money moves.
import { createPayoutBatch, pollPayoutBatch } from "./payouts.ts";
import { payoutItemsFromPoll } from "./verifier.ts";
import { AllocationStore, type Actor } from "./allocationStore.ts";
import type { FetchFn } from "./paypalClient.ts";

export interface PlanExecutionResult {
  status: "succeeded" | "failed" | "denied";
  planId: string;
  executionId: string | null;
  payoutBatchId: string | null;
  reason: string;
  settledItems: number;
  totalItems: number;
}

export async function executeApprovedPlan(opts: {
  store: AllocationStore;
  planId: string;
  actor: Actor;
  at?: string;
  baseUrl: string;
  token: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
  /** Delay between batch polls. Live it is 5 seconds; tests pass 0. */
  pollDelayMs?: number;
}): Promise<PlanExecutionResult> {
  const at = opts.at ?? new Date().toISOString();
  // Starting execution revalidates the plan against its stored context
  // at this time, so a stale or rule-breaking plan never reaches PayPal.
  // A refusal here means nothing started, so it is denied, not failed.
  let execution: { executionId: string; idempotencyKey: string };
  try {
    execution = opts.store.beginExecution(opts.planId, opts.actor, at);
  } catch (error) {
    return {
      status: "denied",
      planId: opts.planId,
      executionId: null,
      payoutBatchId: null,
      reason: error instanceof Error ? error.message : String(error),
      settledItems: 0,
      totalItems: 0,
    };
  }
  const failed = (payoutBatchId: string | null, reason: string, settledItems: number, totalItems: number): PlanExecutionResult => {
    opts.store.failExecution(execution.executionId, payoutBatchId, reason, at);
    return { status: "failed", planId: opts.planId, executionId: execution.executionId, payoutBatchId, reason, settledItems, totalItems };
  };
  const stored = opts.store.getPlan(opts.planId);
  if (!stored) return failed(null, "approved plan disappeared after execution started", 0, 0);
  const context = opts.store.getContext(stored.plan.contextId);
  if (!context) return failed(null, `stored context ${stored.plan.contextId} not found`, 0, 0);
  const items: Array<{ jobId: string; recipientEmail: string; amountCents: number; note: string }> = [];
  for (const line of stored.plan.allocations) {
    const obligation = context.obligations.find((row) => row.obligationId === line.obligationId);
    if (!obligation) return failed(null, `plan names unknown obligation ${line.obligationId}`, 0, stored.plan.allocations.length);
    items.push({
      jobId: line.obligationId,
      recipientEmail: obligation.recipient,
      amountCents: line.amountCents,
      note: `Settle plan ${stored.plan.planId} ${line.obligationId}`,
    });
  }
  if (items.length === 0) return failed(null, "plan has no allocations to pay", 0, 0);
  let batch: { payoutBatchId: string; batchStatus: string };
  try {
    batch = await createPayoutBatch({
      baseUrl: opts.baseUrl,
      token: opts.token,
      items,
      senderBatchId: execution.idempotencyKey,
      refreshToken: opts.refreshToken,
      fetchFn: opts.fetchFn,
    });
  } catch (error) {
    return failed(null, `Payouts create failed: ${error instanceof Error ? error.message : String(error)}`, 0, items.length);
  }
  let polled: { payoutBatchId: string; batchStatus: string; raw: Record<string, unknown> };
  try {
    polled = await pollPayoutBatch({
      baseUrl: opts.baseUrl,
      token: opts.token,
      payoutBatchId: batch.payoutBatchId,
      refreshToken: opts.refreshToken,
      fetchFn: opts.fetchFn,
      delayMs: opts.pollDelayMs ?? 5000,
    });
  } catch (error) {
    return failed(batch.payoutBatchId, `Payouts poll failed: ${error instanceof Error ? error.message : String(error)}`, 0, items.length);
  }
  // Reconcile: the batch reply must list every planned item, each with
  // transaction status SUCCESS for the right person and amount. A reply
  // that cannot be read, an item missing, or any item not SUCCESS means
  // the plan did not settle.
  let settledItems = 0;
  try {
    const read = payoutItemsFromPoll(polled.raw);
    const byId = new Map(read.map((row) => [row.jobId, row]));
    settledItems = items.filter((item) => {
      const row = byId.get(item.jobId);
      return row !== undefined && row.status === "SUCCESS" && row.receiverEmail === item.recipientEmail && row.amountCents === item.amountCents;
    }).length;
    const allSettled = read.length === items.length && settledItems === items.length;
    if (polled.batchStatus === "SUCCESS" && allSettled) {
      opts.store.completeExecution(execution.executionId, batch.payoutBatchId, at);
      return {
        status: "succeeded",
        planId: opts.planId,
        executionId: execution.executionId,
        payoutBatchId: batch.payoutBatchId,
        reason: `batch ${batch.payoutBatchId} settled, ${settledItems} of ${items.length} items SUCCESS`,
        settledItems,
        totalItems: items.length,
      };
    }
    return failed(
      batch.payoutBatchId,
      `batch ${batch.payoutBatchId} did not settle: status ${polled.batchStatus}, ${settledItems} of ${items.length} items SUCCESS`,
      settledItems,
      items.length,
    );
  } catch (error) {
    return failed(
      batch.payoutBatchId,
      `batch ${batch.payoutBatchId} could not be reconciled: ${error instanceof Error ? error.message : String(error)}`,
      settledItems,
      items.length,
    );
  }
}
