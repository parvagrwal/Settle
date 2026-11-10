// Approved plans execute through the durable financial ledger. The plan store
// proves immutable owner approval; the financial store owns recipient identity,
// reservations, submission attempts and provider evidence. Ambiguous network
// outcomes remain recoverable and are never blindly retried.
import { createHash } from "node:crypto";
import { AllocationStore, type Actor } from "./allocationStore.ts";
import { FinancialStore } from "./financialStore.ts";
import { submitApprovedPayment } from "./financialPayments.ts";
import type { FetchFn } from "./paypalClient.ts";

export interface PlanExecutionResult {
  status: "succeeded" | "failed" | "denied" | "outcome_unknown";
  planId: string;
  executionId: string | null;
  payoutBatchId: string | null;
  reason: string;
  settledItems: number;
  totalItems: number;
}

export async function executeApprovedPlan(opts: {
  store: AllocationStore; financialStore: FinancialStore; planId: string; actor: Actor; at?: string;
  baseUrl: string; token: string; refreshToken?: () => Promise<string>; fetchFn?: FetchFn; pollDelayMs?: number;
}): Promise<PlanExecutionResult> {
  const at = opts.at ?? new Date().toISOString();
  let execution: { executionId: string; idempotencyKey: string };
  try { execution = opts.store.beginExecution(opts.planId, opts.actor, at); }
  catch (error) { return { status: "denied", planId: opts.planId, executionId: null, payoutBatchId: null, reason: error instanceof Error ? error.message : String(error), settledItems: 0, totalItems: 0 }; }
  const failed = (payoutBatchId: string | null, reason: string, settledItems: number, totalItems: number): PlanExecutionResult => {
    opts.store.failExecution(execution.executionId, payoutBatchId, reason, at);
    return { status: "failed", planId: opts.planId, executionId: execution.executionId, payoutBatchId, reason, settledItems, totalItems };
  };
  const stored = opts.store.getPlan(opts.planId);
  if (!stored) return failed(null, "approved plan disappeared after execution started", 0, 0);
  const context = opts.store.getContext(stored.plan.contextId);
  if (!context) return failed(null, `stored context ${stored.plan.contextId} not found`, 0, 0);
  const items: Array<{ jobId: string; recipientEmail: string; amountCents: number }> = [];
  for (const line of stored.plan.allocations) {
    const obligation = context.obligations.find((row) => row.obligationId === line.obligationId);
    if (!obligation) return failed(null, `plan names unknown obligation ${line.obligationId}`, 0, stored.plan.allocations.length);
    items.push({ jobId: line.obligationId, recipientEmail: obligation.recipient, amountCents: line.amountCents });
  }
  if (items.length === 0) return failed(null, "plan has no allocations to pay", 0, 0);
  let settledItems = 0; let payoutBatchId: string | null = null;
  for (const item of items) {
    const recipientId = `recipient-${createHash("sha256").update(item.recipientEmail).digest("hex").slice(0, 24)}`;
    if (!opts.financialStore.getRecipient(recipientId)) opts.financialStore.verifyRecipient({ recipientId, email: item.recipientEmail, actor: opts.actor, at });
    if (!opts.financialStore.getPaymentByJob(item.jobId)) opts.financialStore.approvePayment({ jobId: item.jobId, recipientId, amountCents: item.amountCents, currency: "USD", actor: opts.actor, at });
    let result;
    try {
      result = await submitApprovedPayment({ store: opts.financialStore, jobId: item.jobId, baseUrl: opts.baseUrl, token: opts.token, refreshToken: opts.refreshToken, fetchFn: opts.fetchFn });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const paymentState = opts.financialStore.getPaymentByJob(item.jobId)?.status;
      if (paymentState === "outcome_unknown" || paymentState === "submitted") {
        const reason = `payment outcome unknown for ${item.jobId}: ${detail}`;
        opts.store.markExecutionOutcomeUnknown(execution.executionId, reason, at);
        return { status: "outcome_unknown", planId: opts.planId, executionId: execution.executionId, payoutBatchId, reason, settledItems, totalItems: items.length };
      }
      return failed(payoutBatchId, `payment refused before submission for ${item.jobId}: ${detail}`, settledItems, items.length);
    }
    payoutBatchId = result.item?.payoutBatchId as string ?? payoutBatchId;
    if (result.status === "provider_confirmed") settledItems++;
  }
  if (settledItems === items.length) {
    opts.store.completeExecution(execution.executionId, payoutBatchId, at);
    return { status: "succeeded", planId: opts.planId, executionId: execution.executionId, payoutBatchId, reason: `${settledItems} of ${items.length} provider items SUCCESS`, settledItems, totalItems: items.length };
  }
  return failed(payoutBatchId, `only ${settledItems} of ${items.length} provider items succeeded`, settledItems, items.length);
}
