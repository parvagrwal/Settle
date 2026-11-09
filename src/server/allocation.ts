export type Currency = "USD";

export interface Obligation {
  obligationId: string;
  recipient: string;
  currency: Currency;
  owedCents: number;
  settledCents: number;
  dueAt: string;
  mandatory: boolean;
  partialAllowed: boolean;
  priority: "urgent" | "operational" | "normal";
  /** Untrusted context only. Never parsed as an instruction or financial fact. */
  note: string;
}

export interface AllocationContext {
  contextId: string;
  capturedAt: string;
  validUntil: string;
  clearedFundsCents: number;
  reserveCents: number;
  perPaymentCapCents: number;
  totalCapCents: number;
  committedCents: number;
  obligations: Obligation[];
}

export interface AllocationLine {
  obligationId: string;
  amountCents: number;
  residualCents: number;
}

export interface AllocationPlan {
  planId: string;
  contextId: string;
  strategy: "deadline-first" | "operational-stability" | "partial-coverage";
  allocations: AllocationLine[];
  totalAllocatedCents: number;
  unfundedObligationIds: string[];
  rationale: string;
}

export interface AllocationViolation {
  code: "INVALID_CONTEXT" | "STALE_CONTEXT" | "CONTEXT_MISMATCH" | "UNKNOWN_OBLIGATION" | "DUPLICATE_OBLIGATION" | "INVALID_AMOUNT" | "ENTITLEMENT_MISMATCH" | "PARTIAL_NOT_ALLOWED" | "PER_PAYMENT_CAP_EXCEEDED" | "BUDGET_EXCEEDED" | "MANDATORY_UNFUNDED";
  obligationId?: string;
  message: string;
}

function cents(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer number of cents`);
}

export function calculateDiscretionaryBudget(context: AllocationContext): number {
  cents(context.clearedFundsCents, "clearedFundsCents");
  cents(context.reserveCents, "reserveCents");
  cents(context.committedCents, "committedCents");
  cents(context.totalCapCents, "totalCapCents");
  const available = Math.max(0, context.clearedFundsCents - context.reserveCents - context.committedCents);
  return Math.min(available, Math.max(0, context.totalCapCents - context.committedCents));
}

function remaining(obligation: Obligation): number {
  cents(obligation.owedCents, `${obligation.obligationId}.owedCents`);
  cents(obligation.settledCents, `${obligation.obligationId}.settledCents`);
  if (obligation.settledCents > obligation.owedCents) throw new Error(`${obligation.obligationId}: settled exceeds owed`);
  return obligation.owedCents - obligation.settledCents;
}

function makePlan(context: AllocationContext, strategy: AllocationPlan["strategy"], ordered: Obligation[], allowPartial: boolean): AllocationPlan {
  let budget = calculateDiscretionaryBudget(context);
  const allocations: AllocationLine[] = [];
  const funded = new Set<string>();
  for (const obligation of ordered) {
    const owed = remaining(obligation);
    if (owed === 0) { funded.add(obligation.obligationId); continue; }
    const permitted = allowPartial && obligation.partialAllowed;
    if (owed > context.perPaymentCapCents && !permitted) {
      if (obligation.mandatory) break;
      continue;
    }
    const full = Math.min(owed, context.perPaymentCapCents);
    const amount = budget >= full ? full : permitted ? Math.min(budget, full) : 0;
    if (amount === 0) {
      // Do not spend money needed by an unaffordable mandatory obligation
      // on lower-priority discretionary work. Escalate the funding gap.
      if (obligation.mandatory) break;
      continue;
    }
    allocations.push({ obligationId: obligation.obligationId, amountCents: amount, residualCents: owed - amount });
    funded.add(obligation.obligationId);
    budget -= amount;
  }
  const rationale = strategy === "deadline-first"
    ? "Protects the earliest deadlines first; later obligations remain explicitly unfunded."
    : strategy === "operational-stability"
      ? "Protects operational and urgent obligations before normal-priority work."
      : "Uses permitted partial schedules to broaden coverage while preserving every residual entitlement.";
  return {
    planId: `${context.contextId}:${strategy}`,
    contextId: context.contextId,
    strategy,
    allocations,
    totalAllocatedCents: allocations.reduce((sum, row) => sum + row.amountCents, 0),
    unfundedObligationIds: context.obligations.filter((row) => !funded.has(row.obligationId)).map((row) => row.obligationId),
    rationale,
  };
}

export function generateAllocationScenarios(context: AllocationContext): AllocationPlan[] {
  if (context.obligations.some((row) => row.currency !== "USD")) throw new Error("scenario generation requires one currency");
  const byDeadline = [...context.obligations].sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.obligationId.localeCompare(b.obligationId));
  const rank = { urgent: 0, operational: 1, normal: 2 };
  const byOperational = [...context.obligations].sort((a, b) => rank[a.priority] - rank[b.priority] || a.dueAt.localeCompare(b.dueAt) || a.obligationId.localeCompare(b.obligationId));
  return [
    makePlan(context, "deadline-first", byDeadline, false),
    makePlan(context, "operational-stability", byOperational, false),
    makePlan(context, "partial-coverage", byDeadline, true),
  ];
}

export function validateAllocationPlan(plan: AllocationPlan, context: AllocationContext, at: string): AllocationViolation[] {
  const errors: AllocationViolation[] = [];
  if (plan.contextId !== context.contextId) errors.push({ code: "CONTEXT_MISMATCH", message: "plan does not belong to this context" });
  if (at >= context.validUntil) errors.push({ code: "STALE_CONTEXT", message: "financial context is stale" });
  const byId = new Map(context.obligations.map((row) => [row.obligationId, row]));
  const seen = new Set<string>();
  let total = 0;
  for (const line of plan.allocations) {
    if (seen.has(line.obligationId)) errors.push({ code: "DUPLICATE_OBLIGATION", obligationId: line.obligationId, message: "obligation appears more than once" });
    seen.add(line.obligationId);
    const obligation = byId.get(line.obligationId);
    if (!obligation) { errors.push({ code: "UNKNOWN_OBLIGATION", obligationId: line.obligationId, message: "unknown obligation" }); continue; }
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents <= 0 || !Number.isSafeInteger(line.residualCents) || line.residualCents < 0) {
      errors.push({ code: "INVALID_AMOUNT", obligationId: line.obligationId, message: "allocation must use positive integer cents and a non-negative residual" }); continue;
    }
    const owed = remaining(obligation);
    if (line.amountCents + line.residualCents !== owed) errors.push({ code: "ENTITLEMENT_MISMATCH", obligationId: line.obligationId, message: "allocation plus residual must equal the outstanding entitlement" });
    if (line.residualCents > 0 && !obligation.partialAllowed) errors.push({ code: "PARTIAL_NOT_ALLOWED", obligationId: line.obligationId, message: "contract does not permit partial allocation" });
    if (line.amountCents > context.perPaymentCapCents) errors.push({ code: "PER_PAYMENT_CAP_EXCEEDED", obligationId: line.obligationId, message: "allocation exceeds per-payment cap" });
    total += line.amountCents;
  }
  if (total > calculateDiscretionaryBudget(context)) errors.push({ code: "BUDGET_EXCEEDED", message: "allocation exceeds validated discretionary budget" });
  if (total !== plan.totalAllocatedCents) errors.push({ code: "INVALID_AMOUNT", message: "plan total does not equal allocation sum" });
  // An overdue mandatory obligation must be fully funded before any
  // discretionary spend. A plan that funds discretionary work while an
  // overdue mandatory obligation is unfunded, or only partly funded, is
  // refused and the funding gap escalates instead.
  const allocatedById = new Map(plan.allocations.map((line) => [line.obligationId, line.amountCents]));
  const hasDiscretionarySpend = plan.allocations.some((line) => {
    const obligation = byId.get(line.obligationId);
    return obligation !== undefined && !obligation.mandatory && line.amountCents > 0;
  });
  if (hasDiscretionarySpend) {
    for (const obligation of context.obligations) {
      if (!obligation.mandatory) continue;
      if (obligation.dueAt > at) continue;
      const owed = remaining(obligation);
      if (owed === 0) continue;
      const funded = allocatedById.get(obligation.obligationId) ?? 0;
      if (funded < owed) {
        errors.push({ code: "MANDATORY_UNFUNDED", obligationId: obligation.obligationId, message: `overdue mandatory obligation ${obligation.obligationId} must be fully funded before any discretionary spend` });
      }
    }
  }
  return errors;
}
