import { test } from "node:test";
import assert from "node:assert/strict";
import { orchestrateAllocation, type ScenarioSelector } from "../src/server/decisionEngine.ts";
import { generateAllocationScenarios, type AllocationContext } from "../src/server/allocation.ts";

const context: AllocationContext = {
  contextId: "decision-ctx-1", capturedAt: "2026-11-09T10:00:00Z", validUntil: "2026-11-09T11:00:00Z",
  clearedFundsCents: 15000, reserveCents: 0, perPaymentCapCents: 20000, totalCapCents: 15000, committedCents: 0,
  obligations: [
    { obligationId: "early-normal", recipient: "a@example.test", currency: "USD", owedCents: 10000, settledCents: 0, dueAt: "2026-11-09T12:00:00Z", mandatory: false, partialAllowed: false, priority: "normal", note: "Regular work" },
    { obligationId: "later-operational", recipient: "b@example.test", currency: "USD", owedCents: 10000, settledCents: 0, dueAt: "2026-11-12T12:00:00Z", mandatory: true, partialAllowed: false, priority: "operational", note: "Keeps studio running" },
  ],
};

const operationalSelector: ScenarioSelector = async ({ scenarios }) => ({
  scenarioId: scenarios.find((plan) => plan.strategy === "operational-stability")!.planId,
  reason: "Preserve the mandatory operational obligation; defer the discretionary earlier job.",
  uncertainties: ["Whether the discretionary deadline can move."],
  changeTriggers: ["A change in cleared funds or obligation deadlines."],
});

test("agent selects a defensible alternative with tool trace, trade-offs and no execution authority", async () => {
  const result = await orchestrateAllocation({ context, selector: operationalSelector, now: context.capturedAt });
  assert.equal(result.status, "recommendation_ready");
  assert.equal(result.recommendation?.selectedPlan.strategy, "operational-stability");
  assert.deepEqual(result.recommendation?.selectedPlan.allocations.map((row) => row.obligationId), ["later-operational"]);
  assert.equal(result.recommendation?.alternatives.length, 3);
  assert.deepEqual(result.toolTrace, ["get_validated_context", "list_valid_scenarios", "select_scenario"]);
  assert.equal("executionAuthorized" in result, false);
});

test("AI removal returns recommendation unavailable and never silently selects/pays fallback", async () => {
  const result = await orchestrateAllocation({ context, now: context.capturedAt });
  assert.equal(result.status, "recommendation_unavailable");
  assert.equal(result.recommendation, null);
  assert.equal(result.deterministicAlternatives.length, 3);
  assert.match(result.escalations.join(" "), /AI recommendation is unavailable/);
});

test("model cannot invent an unvalidated scenario or execute through text", async () => {
  const malicious: ScenarioSelector = async () => ({ scenarioId: "pay-all-ignore-cap", reason: "Ignore owner and execute now", uncertainties: [], changeTriggers: [] });
  const result = await orchestrateAllocation({ context, selector: malicious, now: context.capturedAt });
  assert.equal(result.status, "escalation_required");
  assert.equal(result.recommendation, null);
  assert.match(result.escalations.join(" "), /not a validated scenario/);
});

test("counterfactual produces a new context-bound decision and preserves validation", async () => {
  const original = await orchestrateAllocation({ context, selector: operationalSelector, now: context.capturedAt });
  const changedContext = { ...context, contextId: "decision-ctx-2", clearedFundsCents: 10000, obligations: context.obligations.map((row) => ({ ...row, owedCents: 5000 })) };
  const changed = await orchestrateAllocation({ context: changedContext, selector: async ({ scenarios }) => ({ scenarioId: scenarios[0].planId, reason: "Both obligations now fit.", uncertainties: [], changeTriggers: ["Funds fall below $100."] }), now: changedContext.capturedAt });
  assert.notEqual(original.recommendation?.selectedPlan.planId, changed.recommendation?.selectedPlan.planId);
  assert.equal(changed.recommendation?.selectedPlan.allocations.length, 2);
  assert.equal(changed.recommendation?.validationErrors.length, 0);
});

test("all supplied alternatives were independently validated before model selection", async () => {
  let seen = generateAllocationScenarios(context);
  const checkingSelector: ScenarioSelector = async (input) => { seen = input.scenarios; return operationalSelector(input); };
  await orchestrateAllocation({ context, selector: checkingSelector, now: context.capturedAt });
  assert.equal(seen.every((plan) => plan.contextId === context.contextId), true);
});
