import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AllocationStore, type Actor } from "../src/server/allocationStore.ts";
import { FinancialStore } from "../src/server/financialStore.ts";
import { generateAllocationScenarios, type AllocationContext } from "../src/server/allocation.ts";
import { executeApprovedPlan } from "../src/server/planExecution.ts";
const owner: Actor = { actorId: "meera", role: "owner" };
const AT = "2026-11-09T10:05:00Z";
const context: AllocationContext = { contextId: "exec-ctx", capturedAt: AT, validUntil: "2026-11-09T11:00:00Z", clearedFundsCents: 10000, reserveCents: 0, perPaymentCapCents: 20000, totalCapCents: 10000, committedCents: 0,
  obligations: [
    { obligationId: "job-a", recipient: "a@example.test", currency: "USD", owedCents: 5000, settledCents: 0, dueAt: "2026-11-09T12:00:00Z", mandatory: true, partialAllowed: false, priority: "urgent", note: "First" },
    { obligationId: "job-b", recipient: "b@example.test", currency: "USD", owedCents: 5000, settledCents: 0, dueAt: "2026-11-09T13:00:00Z", mandatory: true, partialAllowed: false, priority: "urgent", note: "Second" },
  ] };
function setup() {
  const path = join(mkdtempSync(join(tmpdir(), "settle-exec-")), "test.db");
  const store = new AllocationStore(path); const financialStore = new FinancialStore(path);
  const plan = generateAllocationScenarios(context)[0]; store.recordRecommendation(plan, { reason: "Both fit", uncertainties: [], changeTriggers: [] }, context); store.approvePlan(plan.planId, owner, AT);
  return { store, financialStore, planId: plan.planId };
}
function response(json: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(json), { status }); }
function item(jobId: string, receiver: string, status: string) { return { payout_item_id: `ITEM-${jobId}`, transaction_id: `TX-${jobId}`, activity_id: `ACT-${jobId}`, sender_item_id: `settle-payment-${jobId}`, transaction_status: status, receiver, payout_item: { amount: { value: "50.00", currency: "USD" } }, time_processed: AT }; }
function paypal(statuses: Record<string, string>) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("?")) return response({ items: [], total_items: 0 });
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); const key = body.items[0].sender_item_id; const id = key.replace("settle-payment-", "");
      return response({ batch_header: { payout_batch_id: `BATCH-${id}`, batch_status: "PENDING" } }, 201);
    }
    const id = String(url).split("BATCH-")[1];
    return response({ batch_header: { payout_batch_id: `BATCH-${id}`, batch_status: "SUCCESS" }, items: [item(id, `${id.replace("job-", "")}@example.test`, statuses[id] ?? "SUCCESS")] });
  }) as typeof fetch;
}
const opts = (s: ReturnType<typeof setup>, fetchFn: typeof fetch) => ({ ...s, actor: owner, at: AT, baseUrl: "https://paypal.test", token: "secret", fetchFn });

test("every successful provider item completes approved plan and preserves payment identity", async () => {
  const s = setup(); const result = await executeApprovedPlan(opts(s, paypal({})));
  assert.equal(result.status, "succeeded"); assert.equal(result.settledItems, 2);
  assert.equal(s.financialStore.getPaymentByJob("job-a")?.status, "provider_confirmed");
  assert.equal(s.financialStore.getPayoutItem(s.financialStore.getPaymentByJob("job-a")!.paymentId)?.activityId, "ACT-job-a");
});

test("partial provider failure remains partial and does not erase successful evidence", async () => {
  const s = setup(); const result = await executeApprovedPlan(opts(s, paypal({ "job-b": "FAILED" })));
  assert.equal(result.status, "failed"); assert.equal(result.settledItems, 1);
  assert.equal(s.financialStore.getPaymentByJob("job-a")?.status, "provider_confirmed");
  assert.equal(s.financialStore.getPaymentByJob("job-b")?.status, "failed");
});

test("ambiguous provider failure is outcome_unknown, not failed or blind retry", async () => {
  const s = setup(); const fetchFn = (async (url: string | URL | Request) => {
    if (String(url).includes("?")) return response({ items: [], total_items: 0 });
    throw new Error("timeout after accept");
  }) as typeof fetch;
  const result = await executeApprovedPlan(opts(s, fetchFn));
  assert.equal(result.status, "outcome_unknown"); assert.equal(s.store.getPlan(s.planId)?.status, "outcome_unknown");
  assert.equal(s.financialStore.getPaymentByJob("job-a")?.status, "outcome_unknown");
});

test("unapproved plan is denied before provider call", async () => {
  const s = setup(); let calls = 0;
  const result = await executeApprovedPlan({ ...opts(s, (async () => { calls++; return response({}); }) as typeof fetch), planId: "missing" });
  assert.equal(result.status, "denied"); assert.equal(calls, 0);
});
