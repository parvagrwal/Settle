import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateThreeSystems } from "../src/server/allocationEvaluation.ts";
import { allocationDemoContext } from "../src/server/scenarioFixtures.ts";

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
