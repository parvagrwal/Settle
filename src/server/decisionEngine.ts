import {
  generateAllocationScenarios,
  validateAllocationPlan,
  type AllocationContext,
  type AllocationPlan,
  type AllocationViolation,
} from "./allocation.ts";

export interface ScenarioSelection {
  scenarioId: string;
  reason: string;
  uncertainties: string[];
  changeTriggers: string[];
}

export type ScenarioSelector = (input: {
  context: AllocationContext;
  scenarios: AllocationPlan[];
}) => Promise<ScenarioSelection>;

export interface AllocationRecommendation {
  selectedPlan: AllocationPlan;
  alternatives: AllocationPlan[];
  reason: string;
  uncertainties: string[];
  changeTriggers: string[];
  validationErrors: AllocationViolation[];
  recommendationSource: "agent";
}

export interface OrchestrationResult {
  status: "recommendation_ready" | "recommendation_unavailable" | "escalation_required";
  recommendation: AllocationRecommendation | null;
  deterministicAlternatives: AllocationPlan[];
  escalations: string[];
  toolTrace: string[];
}

export async function orchestrateAllocation(opts: {
  context: AllocationContext;
  selector?: ScenarioSelector;
  now: string;
}): Promise<OrchestrationResult> {
  const toolTrace = ["get_validated_context"];
  const scenarios = generateAllocationScenarios(opts.context);
  // Validate every generated scenario up front, so the loop below knows
  // which ones are safe to fall back to. A scenario that breaks a rule
  // is never recommended, only recorded as an escalation.
  const violations = new Map<string, AllocationViolation[]>();
  for (const plan of scenarios) {
    const errors = validateAllocationPlan(plan, opts.context, opts.now);
    if (errors.length > 0) violations.set(plan.planId, errors);
  }
  toolTrace.push("list_valid_scenarios");
  if (!opts.selector) {
    if (violations.size > 0) {
      return { status: "escalation_required", recommendation: null, deterministicAlternatives: scenarios, escalations: [...violations.values()].flat().map((row) => row.message), toolTrace };
    }
    return {
      status: "recommendation_unavailable", recommendation: null, deterministicAlternatives: scenarios,
      escalations: ["AI recommendation is unavailable. No plan was selected or authorized; an owner may explicitly review deterministic alternatives."], toolTrace,
    };
  }
  let selection: ScenarioSelection;
  try { selection = await opts.selector({ context: opts.context, scenarios }); }
  catch (error) {
    return { status: "recommendation_unavailable", recommendation: null, deterministicAlternatives: scenarios, escalations: [`AI recommendation failed: ${(error as Error).message}. No payment was authorized.`], toolTrace };
  }
  toolTrace.push("select_scenario");
  const selected = scenarios.find((plan) => plan.planId === selection.scenarioId);
  if (!selected) {
    return { status: "escalation_required", recommendation: null, deterministicAlternatives: scenarios, escalations: [`${selection.scenarioId} is not a validated scenario. No payment was authorized.`], toolTrace };
  }
  const validationErrors = validateAllocationPlan(selected, opts.context, opts.now);
  if (validationErrors.length === 0) {
    return {
      status: "recommendation_ready",
      recommendation: { selectedPlan: selected, alternatives: scenarios, reason: selection.reason, uncertainties: selection.uncertainties, changeTriggers: selection.changeTriggers, validationErrors, recommendationSource: "agent" },
      deterministicAlternatives: scenarios,
      escalations: [],
      toolTrace,
    };
  }
  // The model's pick broke a rule. Escalate that pick and try the next
  // scenario in generated order; recommend only one that passes the
  // validator. If none passes, escalate with no recommendation.
  toolTrace.push("retry_next_scenario");
  const escalations: string[] = validationErrors.map((row) => row.message);
  for (const next of scenarios) {
    if (next.planId === selected.planId) continue;
    const errors = validateAllocationPlan(next, opts.context, opts.now);
    if (errors.length > 0) { escalations.push(...errors.map((row) => row.message)); continue; }
    return {
      status: "recommendation_ready",
      recommendation: { selectedPlan: next, alternatives: scenarios, reason: selection.reason, uncertainties: selection.uncertainties, changeTriggers: selection.changeTriggers, validationErrors: [], recommendationSource: "agent" },
      deterministicAlternatives: scenarios,
      escalations: [...escalations, `Model pick ${selected.planId} was refused; next valid scenario ${next.planId} used instead.`],
      toolTrace,
    };
  }
  return { status: "escalation_required", recommendation: null, deterministicAlternatives: scenarios, escalations, toolTrace };
}
