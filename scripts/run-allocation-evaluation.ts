import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { evaluateThreeSystems } from "../src/server/allocationEvaluation.ts";
import { groqScenarioSelector } from "../src/server/groqScenarioSelector.ts";
import { allocationDemoContext } from "../src/server/scenarioFixtures.ts";
import { generateAllocationScenarios } from "../src/server/allocation.ts";

try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim();
  }
} catch { /* optional local env */ }

const context = allocationDemoContext();
let report: Record<string, unknown>;
if (!process.env.GROQ_API_KEY) {
  report = {
    status: "BLOCKED_NO_GROQ_CREDENTIAL",
    modelResultsClaimed: false,
    deterministicFallback: generateAllocationScenarios(context).find((plan) => plan.strategy === "deadline-first"),
    message: "No live AI-assisted or agentic comparison was run. Mock-selector unit tests verify the harness only.",
  };
} else {
  try {
    // The counterfactual changes exactly one condition: cleared funds
    // fall by $50, everything else stays the same.
    const delayedReceipt = (input: ReturnType<typeof allocationDemoContext>) => ({
      ...input,
      contextId: `${input.contextId}-delayed-receipt`,
      clearedFundsCents: input.clearedFundsCents - 5000,
    });
    report = { status: "LIVE_MODEL_EVALUATION", ...(await evaluateThreeSystems(context, groqScenarioSelector({ apiKey: process.env.GROQ_API_KEY }), true, delayedReceipt)) };
  } catch (error) {
    report = { status: "LIVE_MODEL_EVALUATION_FAILED", modelResultsClaimed: false, error: (error as Error).message };
  }
}
mkdirSync("evidence/allocation", { recursive: true });
writeFileSync("evidence/allocation/comparison.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
