import { generateAllocationScenarios, validateAllocationPlan, type AllocationContext, type AllocationPlan } from "./allocation.ts";
import { orchestrateAllocation, type ScenarioSelector } from "./decisionEngine.ts";
import { allocationCounterfactual } from "./scenarioFixtures.ts";

export interface EvaluationMetrics {
  allocationValid: boolean;
  obligationProtection: boolean;
  allocatedCents: number;
  mandatoryFundedCents: number;
  urgentFundedCents: number;
  residualCents: number;
  humanInterventions: number;
  explanationAccuracy: null;
}

export interface SystemResult {
  system: "deterministic_fallback" | "ai_assisted" | "agentic";
  plan: AllocationPlan | null;
  metrics: EvaluationMetrics;
  latencyMs: number;
  reason: string;
}

function metrics(plan: AllocationPlan | null, context: AllocationContext, interventions: number): EvaluationMetrics {
  const errors = plan ? validateAllocationPlan(plan, context, context.capturedAt) : [{ code: "NO_PLAN" }];
  const amount = (mandatory: boolean, urgent = false) => plan?.allocations.reduce((sum, line) => {
    const obligation = context.obligations.find((row) => row.obligationId === line.obligationId);
    return obligation && (urgent ? obligation.priority === "urgent" : obligation.mandatory === mandatory) ? sum + line.amountCents : sum;
  }, 0) ?? 0;
  return {
    allocationValid: !!plan && errors.length === 0,
    obligationProtection: !!plan && !errors.some((row) => "code" in row && ["ENTITLEMENT_MISMATCH", "PARTIAL_NOT_ALLOWED", "UNKNOWN_OBLIGATION"].includes(String(row.code))),
    allocatedCents: plan?.totalAllocatedCents ?? 0,
    mandatoryFundedCents: amount(true),
    urgentFundedCents: amount(false, true),
    residualCents: plan?.allocations.reduce((sum, row) => sum + row.residualCents, 0) ?? context.obligations.reduce((sum, row) => sum + row.owedCents - row.settledCents, 0),
    humanInterventions: interventions,
    explanationAccuracy: null,
  };
}

export async function evaluateThreeSystems(context: AllocationContext, selector: ScenarioSelector, includeCounterfactual = false) {
  const scenarios = generateAllocationScenarios(context);
  const fallbackStart = Date.now();
  const fallback = scenarios.find((plan) => plan.strategy === "deadline-first") ?? null;
  const systems: SystemResult[] = [{ system: "deterministic_fallback", plan: fallback, metrics: metrics(fallback, context, 0), latencyMs: Date.now() - fallbackStart, reason: fallback?.rationale ?? "No plan" }];
  for (const system of ["ai_assisted", "agentic"] as const) {
    const started = Date.now();
    const result = await orchestrateAllocation({ context, selector, now: context.capturedAt });
    const plan = result.recommendation?.selectedPlan ?? null;
    systems.push({ system, plan, metrics: metrics(plan, context, result.escalations.length), latencyMs: Date.now() - started, reason: result.recommendation?.reason ?? result.escalations.join(" ") });
  }
  let counterfactual: null | {
    originalContext: AllocationContext; modifiedContext: AllocationContext;
    originalPlanId: string | null; newPlanId: string | null; reason: string; constraintValid: boolean;
  } = null;
  if (includeCounterfactual) {
    const modifiedContext = allocationCounterfactual();
    const changed = await orchestrateAllocation({ context: modifiedContext, selector, now: modifiedContext.capturedAt });
    counterfactual = {
      originalContext: context, modifiedContext,
      originalPlanId: systems[2].plan?.planId ?? null,
      newPlanId: changed.recommendation?.selectedPlan.planId ?? null,
      reason: changed.recommendation?.reason ?? changed.escalations.join(" "),
      constraintValid: !!changed.recommendation && changed.recommendation.validationErrors.length === 0,
    };
  }
  return { methodology: "independent integer-cent validator; latency wall clock; explanation accuracy requires separate human review", systems, counterfactual };
}
