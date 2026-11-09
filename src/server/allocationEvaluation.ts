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

export async function evaluateThreeSystems(
  context: AllocationContext,
  selector: ScenarioSelector,
  includeCounterfactual = false,
  /** One-condition mutation of the input context for the counterfactual.
   * Without it, the counterfactual falls back to the fixed demo mutation. */
  counterfactualMutate?: (input: AllocationContext) => AllocationContext,
) {
  const scenarios = generateAllocationScenarios(context);
  const fallbackStart = Date.now();
  const fallback = scenarios.find((plan) => plan.strategy === "deadline-first") ?? null;
  const systems: SystemResult[] = [{ system: "deterministic_fallback", plan: fallback, metrics: metrics(fallback, context, 0), latencyMs: Date.now() - fallbackStart, reason: fallback?.rationale ?? "No plan" }];
  // ai_assisted is one model selection over the generated scenarios, and
  // nothing else: no orchestration loop, no validation retry, no
  // escalation. The pick is returned as-is, even when it breaks a rule,
  // and the metrics say so. That is what makes it different from the
  // agentic path below, which validates and escalates instead.
  const assistedStart = Date.now();
  let assistedPlan: AllocationPlan | null = null;
  let assistedReason = "";
  let assistedEscalations: string[] = [];
  try {
    const selection = await selector({ context, scenarios });
    assistedPlan = scenarios.find((plan) => plan.planId === selection.scenarioId) ?? null;
    assistedReason = selection.reason;
    if (!assistedPlan) assistedEscalations = [`${selection.scenarioId} is not a supplied scenario. No payment was authorized.`];
  } catch (error) {
    assistedEscalations = [`AI-assisted selection failed: ${(error as Error).message}. No payment was authorized.`];
  }
  systems.push({
    system: "ai_assisted",
    plan: assistedPlan,
    metrics: metrics(assistedPlan, context, assistedEscalations.length),
    latencyMs: Date.now() - assistedStart,
    reason: assistedPlan ? assistedReason : assistedEscalations.join(" "),
  });
  // agentic is the full loop: generate, select, validate, and on a rule
  // break escalate and try the next scenario, auditing each step. It
  // recommends only a plan that passes the independent validator.
  const agenticStart = Date.now();
  const result = await orchestrateAllocation({ context, selector, now: context.capturedAt });
  const agenticPlan = result.recommendation?.selectedPlan ?? null;
  systems.push({ system: "agentic", plan: agenticPlan, metrics: metrics(agenticPlan, context, result.escalations.length), latencyMs: Date.now() - agenticStart, reason: result.recommendation?.reason ?? result.escalations.join(" ") });
  let counterfactual: null | {
    originalContext: AllocationContext; modifiedContext: AllocationContext;
    originalPlanId: string | null; newPlanId: string | null; reason: string; constraintValid: boolean;
  } = null;
  if (includeCounterfactual) {
    const modifiedContext = counterfactualMutate ? counterfactualMutate(context) : allocationCounterfactual();
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
