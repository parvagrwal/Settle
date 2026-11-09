// Approved-plan execution tests: success only when every item settles,
// anything else is failed, never succeeded. No live PayPal call: the
// PayPal replies come from a mock fetch. No money moved.
// Run: node --test tests/planExecution.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AllocationStore, type Actor } from "../src/server/allocationStore.ts";
import { generateAllocationScenarios, type AllocationContext } from "../src/server/allocation.ts";
import { executeApprovedPlan } from "../src/server/planExecution.ts";

const owner: Actor = { actorId: "meera", role: "owner" };
const AT = "2026-11-09T10:05:00Z";
const EXEC_AT = "2026-11-09T10:06:00Z";

const context: AllocationContext = {
  contextId: "exec-ctx", capturedAt: "2026-11-09T10:00:00Z", validUntil: "2026-11-09T11:00:00Z",
  clearedFundsCents: 10000, reserveCents: 0, perPaymentCapCents: 20000, totalCapCents: 10000, committedCents: 0,
  obligations: [
    { obligationId: "job-a", recipient: "a@example.test", currency: "USD", owedCents: 5000, settledCents: 0, dueAt: "2026-11-09T12:00:00Z", mandatory: true, partialAllowed: false, priority: "urgent", note: "First job" },
    { obligationId: "job-b", recipient: "b@example.test", currency: "USD", owedCents: 5000, settledCents: 0, dueAt: "2026-11-09T13:00:00Z", mandatory: true, partialAllowed: false, priority: "urgent", note: "Second job" },
  ],
};

function approvedStore() {
  const path = join(mkdtempSync(join(tmpdir(), "settle-exec-")), "test.db");
  const store = new AllocationStore(path);
  const plan = generateAllocationScenarios(context)[0];
  store.recordRecommendation(plan, { reason: "Both jobs fit.", uncertainties: [], changeTriggers: ["Funds change"] }, context);
  store.approvePlan(plan.planId, owner, AT);
  return { store, planId: plan.planId };
}

function mockResponse(status: number, json: Record<string, unknown>) {
  return { status, ok: status >= 200 && status < 300, json: async () => json, headers: { get: () => null } };
}

function pollItem(jobId: string, receiver: string, status: string) {
  return {
    payout_item_id: `ITEM-${jobId}`,
    sender_item_id: jobId,
    transaction_status: status,
    payout_item: { receiver, amount: { value: "50.00", currency: "USD" } },
  };
}

/** Mock PayPal: create returns a PENDING batch, the poll returns the given items. */
function mockPayPal(itemStatuses: Array<[string, string, string]>) {
  return (async (url: string, init: Record<string, unknown>) => {
    const method = (init.method as string) ?? "GET";
    if (method === "POST") {
      return mockResponse(201, { batch_header: { payout_batch_id: "BATCH-PLAN", batch_status: "PENDING" } });
    }
    return mockResponse(200, {
      batch_header: { payout_batch_id: "BATCH-PLAN", batch_status: "SUCCESS" },
      items: itemStatuses.map(([jobId, receiver, status]) => pollItem(jobId, receiver, status)),
    });
  }) as unknown as typeof fetch;
}

test("approved plan with every item settled succeeds and the store records it", async () => {
  const { store, planId } = approvedStore();
  const result = await executeApprovedPlan({
    store, planId, actor: owner, at: EXEC_AT,
    baseUrl: "https://api-m.sandbox.paypal.com", token: "test-token",
    fetchFn: mockPayPal([["job-a", "a@example.test", "SUCCESS"], ["job-b", "b@example.test", "SUCCESS"]]),
    pollDelayMs: 0,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.payoutBatchId, "BATCH-PLAN");
  assert.equal(result.settledItems, 2);
  assert.equal(result.totalItems, 2);
  assert.equal(store.getPlan(planId)?.status, "succeeded");
  assert.equal(store.getExecution(planId)?.providerBatchId, "BATCH-PLAN");
});

test("one failed item means the plan is failed, never succeeded", async () => {
  const { store, planId } = approvedStore();
  const result = await executeApprovedPlan({
    store, planId, actor: owner, at: EXEC_AT,
    baseUrl: "https://api-m.sandbox.paypal.com", token: "test-token",
    fetchFn: mockPayPal([["job-a", "a@example.test", "SUCCESS"], ["job-b", "b@example.test", "FAILED"]]),
    pollDelayMs: 0,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.settledItems, 1);
  assert.equal(result.totalItems, 2);
  assert.match(result.reason, /did not settle: status SUCCESS, 1 of 2 items SUCCESS/);
  assert.equal(store.getPlan(planId)?.status, "failed");
  assert.equal(store.getExecution(planId)?.providerBatchId, "BATCH-PLAN");
});

test("PayPal unreachable means the plan is failed, never succeeded", async () => {
  const { store, planId } = approvedStore();
  const unreachable = (async () => {
    throw new Error("fetch failed");
  }) as unknown as typeof fetch;
  const result = await executeApprovedPlan({
    store, planId, actor: owner, at: EXEC_AT,
    baseUrl: "https://api-m.sandbox.paypal.com", token: "test-token",
    fetchFn: unreachable,
    pollDelayMs: 0,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.settledItems, 0);
  assert.match(result.reason, /Payouts create failed/);
  assert.equal(store.getPlan(planId)?.status, "failed");
});

test("a plan that was never approved is denied, and PayPal is never called", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "settle-exec-")), "test.db");
  const store = new AllocationStore(path);
  const plan = generateAllocationScenarios(context)[0];
  store.recordRecommendation(plan, { reason: "Both jobs fit.", uncertainties: [], changeTriggers: ["Funds change"] }, context);
  let calls = 0;
  const counting = (async (...args: unknown[]) => {
    calls++;
    return mockPayPal([["job-a", "a@example.test", "SUCCESS"], ["job-b", "b@example.test", "SUCCESS"]])(...(args as [string, Record<string, unknown>]));
  }) as unknown as typeof fetch;
  const result = await executeApprovedPlan({
    store, planId: plan.planId, actor: owner, at: EXEC_AT,
    baseUrl: "https://api-m.sandbox.paypal.com", token: "test-token",
    fetchFn: counting,
    pollDelayMs: 0,
  });
  assert.equal(result.status, "denied");
  assert.equal(result.executionId, null);
  assert.equal(calls, 0);
  assert.equal(store.getPlan(plan.planId)?.status, "proposed");
});
