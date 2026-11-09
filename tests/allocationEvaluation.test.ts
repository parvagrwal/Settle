import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateThreeSystems } from "../src/server/allocationEvaluation.ts";
import { allocationDemoContext } from "../src/server/scenarioFixtures.ts";
import type { AllocationContext } from "../src/server/allocation.ts";

test("comparison uses independent validation and predeclared metrics", async () => {
  const report = await evaluateThreeSystems(allocationDemoContext(), async ({ scenarios }) => ({
    scenarioId: scenarios.find((plan) => plan.strategy === "operational-stability")!.planId,
    reason: "Mandatory operational continuity outranks an earlier discretionary deadline.", uncertainties: [], changeTriggers: ["Receipt delayed"],
  }));
  assert.equal(report.systems.length, 3);
  assert.ok(report.systems.every((system) => system.metrics.allocationValid));
  assert.equal(report.systems[0].system, "deterministic_fallback");
  assert.equal(report.systems[1].system, "ai_assisted");
  assert.equal(report.systems[2].system, "agentic");
  assert.ok(report.systems.every((system) => system.latencyMs >= 0));
});

test("counterfactual records context, decision, reason and validity difference", async () => {
  const selector = async ({ scenarios }: { scenarios: { planId: string }[] }) => ({ scenarioId: scenarios[0].planId, reason: "Earliest deadlines under current funds.", uncertainties: [], changeTriggers: ["Funds change"] });
  const report = await evaluateThreeSystems(allocationDemoContext(), selector, true);
  assert.notEqual(report.counterfactual?.originalContext.contextId, report.counterfactual?.modifiedContext.contextId);
  assert.equal(report.counterfactual?.constraintValid, true);
  assert.ok(report.counterfactual?.reason.length);
});

test("ai_assisted returns the model's invalid pick while agentic escalates and uses the next valid scenario", async () => {
  // Discretionary $80 due 08:00, mandatory $100 due 09:00 and overdue by
  // the 10:00 decision, $100 of cleared funds. Deadline-first funds the
  // discretionary job and leaves the overdue mandatory job with nothing,
  // which breaks the mandatory rule; funding the mandatory job first is
  // valid. The model always picks the first scenario.
  const context: AllocationContext = {
    contextId: "harness-ctx", capturedAt: "2026-11-09T10:00:00Z", validUntil: "2026-11-09T11:00:00Z",
    clearedFundsCents: 10000, reserveCents: 0, perPaymentCapCents: 20000, totalCapCents: 10000, committedCents: 0,
    obligations: [
      { obligationId: "job-early", recipient: "early@example.test", currency: "USD", owedCents: 8000, settledCents: 0, dueAt: "2026-11-09T08:00:00Z", mandatory: false, partialAllowed: false, priority: "normal", note: "Discretionary, due first" },
      { obligationId: "job-must", recipient: "must@example.test", currency: "USD", owedCents: 10000, settledCents: 0, dueAt: "2026-11-09T09:00:00Z", mandatory: true, partialAllowed: false, priority: "urgent", note: "Mandatory, overdue" },
    ],
  };
  const selector = async ({ scenarios }: { scenarios: { planId: string }[] }) => ({ scenarioId: scenarios[0].planId, reason: "Earliest deadlines first.", uncertainties: [], changeTriggers: ["Funds change"] });
  const report = await evaluateThreeSystems(context, selector);
  const assisted = report.systems.find((row) => row.system === "ai_assisted")!;
  const agentic = report.systems.find((row) => row.system === "agentic")!;
  // One model selection, no validation retry: the invalid pick is
  // returned as-is, and the metrics say it is invalid.
  assert.equal(assisted.plan?.strategy, "deadline-first");
  assert.equal(assisted.metrics.allocationValid, false);
  assert.equal(assisted.metrics.humanInterventions, 0);
  // The full loop refuses the pick, escalates, and recommends the next
  // scenario that passes the validator.
  assert.equal(agentic.plan?.strategy, "operational-stability");
  assert.equal(agentic.metrics.allocationValid, true);
  assert.ok(agentic.metrics.humanInterventions > 0);
  assert.notEqual(assisted.plan?.planId, agentic.plan?.planId);
});

test("counterfactual with a caller-supplied mutation differs in exactly one condition", async () => {
  const input = allocationDemoContext();
  const selector = async ({ scenarios }: { scenarios: { planId: string }[] }) => ({ scenarioId: scenarios[0].planId, reason: "Earliest deadlines under current funds.", uncertainties: [], changeTriggers: ["Funds change"] });
  const mutate = (ctx: typeof input) => ({ ...ctx, clearedFundsCents: ctx.clearedFundsCents - 5000 });
  const report = await evaluateThreeSystems(input, selector, true, mutate);
  const changed = report.counterfactual?.modifiedContext;
  assert.ok(changed);
  assert.equal(changed.clearedFundsCents, input.clearedFundsCents - 5000);
  // Every other field is untouched: restoring the one changed field
  // makes the two contexts identical.
  const { clearedFundsCents: _changedFunds, ...changedRest } = changed;
  const { clearedFundsCents: _inputFunds, ...inputRest } = input;
  assert.deepEqual(changedRest, inputRest);
});
