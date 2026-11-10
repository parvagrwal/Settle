// Investigation over the payment operations projection.
//
// The investigator is a reader. It is handed one snapshot, classifies the
// question with fixed keyword rules, and points at rows the projection already
// flagged. It writes nothing, executes nothing, builds no query from model
// output, and returns only identifiers that exist in the snapshot it was given.
//
// An optional model may reword the explanation. It never sees a way to change
// the findings, and a rewording that names a record outside the computed set is
// thrown away.
import { randomUUID } from "node:crypto";
import type { InvestigationFinding, InvestigationIntent, OperationsInvestigation, OperationsSnapshot, PaymentOperationRow, SuggestedGridAction } from "../shared/operations.ts";

export type { InvestigationFinding, InvestigationIntent, OperationsInvestigation, SuggestedGridAction } from "../shared/operations.ts";

export const SUPPORTED_QUESTIONS: ReadonlyArray<{ intent: Exclude<InvestigationIntent, "overview" | "unsupported">; question: string; label: string }> = [
  { intent: "needs_attention", question: "Which payments need attention?", label: "Needs attention" },
  { intent: "approaching_deadlines", question: "Which payments are approaching deadlines?", label: "Approaching deadlines" },
  { intent: "unreconciled", question: "Which payments remain unreconciled?", label: "Unreconciled" },
  { intent: "awaiting_approval", question: "Which payments are awaiting approval?", label: "Awaiting approval" },
  { intent: "cannot_pay_within_budget", question: "Which payments cannot be paid within the current budget?", label: "Outside budget" },
  { intent: "incomplete_provider_evidence", question: "Which payments have incomplete provider evidence?", label: "Incomplete evidence" },
];

const RULES: ReadonlyArray<[InvestigationIntent, RegExp]> = [
  ["unreconciled", /reconcil|re-?read|unverified/i],
  ["incomplete_provider_evidence", /evidence|incomplete|missing\b.*\b(id|ids|identifier|identifiers|fee|fees|transaction|batch|item)/i],
  ["cannot_pay_within_budget", /budget|\bcaps?\b|capacity|afford|exceed|over the limit|within.*limit|can(not|'t| not) be paid/i],
  ["approaching_deadlines", /deadline|overdue|\bdue\b|approaching|upcoming|\blate\b/i],
  ["awaiting_approval", /approv/i],
  ["needs_attention", /attention|investigat|fail|problem|issue|risk|block|stuck|wrong|anomal|exception|unknown/i],
  ["overview", /summary|summar|overview|status|how many|state of/i],
];

export function classifyQuestion(question: string): InvestigationIntent {
  for (const [intent, pattern] of RULES) if (pattern.test(question)) return intent;
  return "unsupported";
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function name(row: PaymentOperationRow): string {
  const label = row.jobId ?? row.operationId;
  return row.title ? `${label} (${row.title})` : label;
}

function describe(row: PaymentOperationRow, text: string): string {
  return `${name(row)}, ${usd(row.amountCents)}${row.isDemonstration ? ", demonstration record" : ""}: ${text}`;
}

function finding(id: string, title: string, severity: InvestigationFinding["severity"], rows: PaymentOperationRow[], line: (row: PaymentOperationRow) => string, lead = ""): InvestigationFinding | null {
  if (rows.length === 0) return null;
  return { id, title, severity, paymentIds: rows.map((row) => row.operationId), detail: `${lead}${rows.map((row) => describe(row, line(row))).join(" · ")}` };
}

function compact(list: Array<InvestigationFinding | null>): InvestigationFinding[] {
  return list.filter((entry): entry is InvestigationFinding => entry !== null);
}

const PROVIDER_FAILURE = new Set(["failed", "blocked", "returned", "reversed", "refunded"]);
const AMBIGUOUS = new Set(["outcome_unknown", "reconciliation_required"]);

function attentionFindings(rows: PaymentOperationRow[]): InvestigationFinding[] {
  const flagged = rows.filter((row) => row.needsAttention);
  const taken = new Set<string>();
  const take = (predicate: (row: PaymentOperationRow) => boolean) => {
    const list = flagged.filter((row) => !taken.has(row.operationId) && predicate(row));
    for (const row of list) taken.add(row.operationId);
    return list;
  };
  const reason = (row: PaymentOperationRow) => row.attentionReasons.join(" ");
  return compact([
    finding("ambiguous-outcome", "Provider outcome is not known", "critical", take((row) => AMBIGUOUS.has(row.paymentStatus) || row.reconciliationState === "discrepancy"), reason),
    finding("provider-failure", "PayPal reported a failed, blocked or returned payout", "critical", take((row) => PROVIDER_FAILURE.has(row.paymentStatus)), reason),
    finding("overdue", "Overdue and not settled", "warning", take((row) => row.isOverdue), reason),
    finding("policy-hold", "Held before submission", "warning", take((row) => row.paymentStatus === "held" || row.paymentStatus === "refused" || row.cannotPayWithinBudget), reason),
    finding("approval-expired", "Owner approval expired", "warning", take((row) => row.approvalState === "expired"), reason),
    finding("other-attention", "Other records needing attention", "warning", take(() => true), reason),
  ]);
}

function deadlineFindings(rows: PaymentOperationRow[]): InvestigationFinding[] {
  const due = rows.filter((row) => row.isDueSoon);
  const when = (row: PaymentOperationRow) => row.dueInDays === null ? "no due date" : row.dueInDays < 0 ? `due ${row.dueDate}, ${Math.abs(row.dueInDays)} day(s) overdue` : row.dueInDays === 0 ? `due today (${row.dueDate})` : `due ${row.dueDate}, in ${row.dueInDays} day(s)`;
  const status = (row: PaymentOperationRow) => `${when(row)}; ${row.paymentStatusLabel.toLowerCase()}, approval ${row.approvalState.replace("_", " ")}.`;
  return compact([
    finding("overdue", "Overdue", "critical", due.filter((row) => row.isOverdue), status),
    finding("due-soon", "Due within 3 days", "warning", due.filter((row) => !row.isOverdue), status),
  ]);
}

function unreconciledFindings(rows: PaymentOperationRow[]): InvestigationFinding[] {
  const flagged = rows.filter((row) => row.isUnreconciled);
  return compact([
    finding("discrepancy", "Reconciliation discrepancy recorded", "critical", flagged.filter((row) => row.reconciliationState === "discrepancy"), () => "a discrepancy record references this payment; details are available to the owner."),
    finding("outcome-unknown", "Outcome unknown or reconciliation required", "critical", flagged.filter((row) => row.reconciliationState === "required"), (row) => `${row.paymentStatusLabel.toLowerCase()}; reconcile with PayPal before any retry.`),
    finding("confirmed-not-reread", "Confirmed by PayPal, never independently re-read", "warning", flagged.filter((row) => row.reconciliationState === "not_reconciled"), (row) => `confirmed${row.providerTimestamp ? ` at ${row.providerTimestamp}` : ""}${row.payoutBatchId ? ` in batch ${row.payoutBatchId}` : ""}; no reconciliation run has re-read it.`),
  ]);
}

function approvalFindings(rows: PaymentOperationRow[]): InvestigationFinding[] {
  const flagged = rows.filter((row) => row.needsApproval);
  const due = (row: PaymentOperationRow) => row.dueDate ? `due ${row.dueDate}` : "no due date";
  return compact([
    finding("approval-expired", "Approval expired", "warning", flagged.filter((row) => row.approvalState === "expired"), (row) => `approved ${row.approvedAt ?? "earlier"}, now expired; ${due(row)}.`),
    finding("never-approved", "Not yet approved by the owner", "info", flagged.filter((row) => row.approvalState === "not_approved"), (row) => `no owner approval recorded; ${due(row)}.`),
  ]);
}

function budgetFindings(snapshot: OperationsSnapshot, rows: PaymentOperationRow[]): InvestigationFinding[] {
  const flagged = rows.filter((row) => row.cannotPayWithinBudget);
  const cap = snapshot.capacity;
  const overCap = (row: PaymentOperationRow) => row.amountCents > cap.perPaymentCapCents;
  const why = (row: PaymentOperationRow) => row.budgetReason ?? "outside the owner's caps.";
  return compact([
    finding("over-per-payment-cap", "Over the per-payment cap", "warning", flagged.filter((row) => overCap(row) && !row.isDemonstration), why, `Per-payment cap ${usd(cap.perPaymentCapCents)}. `),
    finding("beyond-remaining-capacity", "Does not fit the remaining rolling capacity", "warning", flagged.filter((row) => !overCap(row) && !row.isDemonstration), why, `Remaining capacity ${usd(cap.remainingCents)} of a ${usd(cap.budgetCents)} cap. `),
    finding("demonstration-over-cap", "Demonstration records over the per-payment cap (illustrative)", "info", flagged.filter((row) => row.isDemonstration), why, `Per-payment cap ${usd(cap.perPaymentCapCents)}. `),
  ]);
}

function evidenceFindings(rows: PaymentOperationRow[]): InvestigationFinding[] {
  const flagged = rows.filter((row) => row.hasIncompleteEvidence);
  const gaps = (row: PaymentOperationRow) => row.evidenceGaps.join(" ");
  return compact([
    finding("historical-claim", "Historical references with a claimed batch only", "info", flagged.filter((row) => row.paymentStatus === "historical_reference"), (row) => `cites batch ${row.payoutBatchId ?? "none"}. ${gaps(row)}`),
    finding("in-flight-evidence", "Submitted, provider evidence still arriving or absent", "warning", flagged.filter((row) => row.paymentStatus !== "historical_reference" && row.paymentStatus !== "provider_confirmed"), gaps),
    finding("confirmed-with-gaps", "Confirmed, with gaps in the stored evidence", "warning", flagged.filter((row) => row.paymentStatus === "provider_confirmed"), gaps),
  ]);
}

function overviewFindings(snapshot: OperationsSnapshot, rows: PaymentOperationRow[]): InvestigationFinding[] {
  const order: Array<keyof OperationsSnapshot["exceptions"]> = ["needsAttention", "dueSoon", "awaitingApproval", "unreconciled", "cannotPayWithinBudget", "incompleteEvidence"];
  const severity: Record<string, InvestigationFinding["severity"]> = { needsAttention: "critical", unreconciled: "warning", dueSoon: "warning", cannotPayWithinBudget: "warning", awaitingApproval: "info", incompleteEvidence: "info" };
  return compact(order.map((key) => {
    const bucket = snapshot.exceptions[key];
    const list = rows.filter((row) => row[bucket.flag]);
    if (list.length === 0) return null;
    return { id: key, title: bucket.label, severity: severity[key], paymentIds: list.map((row) => row.operationId), detail: `${list.length} record(s): ${list.map(name).join(", ")}. ${bucket.definition}` };
  }));
}

const EMPTY_TEXT: Record<Exclude<InvestigationIntent, "unsupported">, string> = {
  needs_attention: "No payment in the current data needs attention.",
  approaching_deadlines: "No pending payment is overdue or due within 3 days.",
  unreconciled: "No ledger payment is unreconciled in the current data.",
  awaiting_approval: "No pending payment is awaiting owner approval.",
  cannot_pay_within_budget: "No pending payment is outside the owner's caps in the current data.",
  incomplete_provider_evidence: "No record in the current data has incomplete provider evidence.",
  overview: "No exception is recorded in the current data.",
};

const LEAD_TEXT: Record<Exclude<InvestigationIntent, "unsupported">, (count: number) => string> = {
  needs_attention: (count) => `${count} payment record(s) need attention.`,
  approaching_deadlines: (count) => `${count} pending payment(s) are overdue or due within 3 days.`,
  unreconciled: (count) => `${count} ledger payment(s) remain unreconciled.`,
  awaiting_approval: (count) => `${count} pending payment(s) are awaiting owner approval.`,
  cannot_pay_within_budget: (count) => `${count} pending payment(s) cannot be paid within the owner's current caps.`,
  incomplete_provider_evidence: (count) => `${count} record(s) have incomplete provider evidence.`,
  overview: (count) => `${count} record(s) appear in at least one exception category.`,
};

const ACTION_LABEL: Record<Exclude<InvestigationIntent, "unsupported">, string> = {
  needs_attention: "Needs attention",
  approaching_deadlines: "Approaching deadlines",
  unreconciled: "Unreconciled",
  awaiting_approval: "Awaiting approval",
  cannot_pay_within_budget: "Outside budget",
  incomplete_provider_evidence: "Incomplete provider evidence",
  overview: "All exceptions",
};

export function investigateOperations(snapshot: OperationsSnapshot, question: string): OperationsInvestigation {
  const intent = classifyQuestion(question);
  const base = {
    contractVersion: 1 as const,
    investigationId: `inv_${randomUUID()}`,
    question,
    intent,
    dataTimestamp: snapshot.generatedAt,
    dataVersion: snapshot.dataVersion,
    source: "Deterministic ledger projection" as const,
    readOnly: true as const,
  };
  const uncertainty: string[] = [];
  if (snapshot.access.scope === "public") uncertainty.push("Public view: only demonstration records and the legacy grid are visible. Operational workspace payments are not included until the owner signs in.");
  if (!snapshot.provider.connected) uncertainty.push("PayPal Sandbox is not connected in this process. Nothing here is a live provider reading; statuses are the ones stored in this database.");
  if (!snapshot.capacity.fresh) uncertainty.push(`Provider reconciliation is stale or has never run${snapshot.capacity.lastSuccessfulReconciliation ? ` (last ${snapshot.capacity.lastSuccessfulReconciliation})` : ""}, so a provider status may have changed since it was stored.`);

  if (intent === "unsupported") {
    return {
      ...base,
      findings: [],
      paymentIds: [],
      explanation: `This investigator answers questions about the recorded state of payments. Supported questions: ${SUPPORTED_QUESTIONS.map((entry) => entry.question).join(" ")} It does not approve, pay, change policy or edit recipients.`,
      uncertainty: ["The question did not match a supported investigation, so no rows were selected.", ...uncertainty],
      suggestedGridAction: { type: "none", reason: "The question did not match a supported investigation." },
    };
  }

  const rows = snapshot.rows;
  let findings: InvestigationFinding[];
  switch (intent) {
    case "needs_attention": findings = attentionFindings(rows); break;
    case "approaching_deadlines": {
      findings = deadlineFindings(rows);
      const undated = rows.filter((row) => row.isPendingObligation && row.dueDate === null).length;
      if (undated > 0) uncertainty.push(`${undated} pending obligation(s) have no due date and cannot be assessed against a deadline.`);
      break;
    }
    case "unreconciled": findings = unreconciledFindings(rows); break;
    case "awaiting_approval": findings = approvalFindings(rows); break;
    case "cannot_pay_within_budget": {
      findings = budgetFindings(snapshot, rows);
      uncertainty.push("Budget fit assumes approved work is paid in priority order, then by due date. Amounts awaiting PayPal confirmation are reported by the ledger separately from active exposure.");
      break;
    }
    case "incomplete_provider_evidence": findings = evidenceFindings(rows); break;
    case "overview": findings = overviewFindings(snapshot, rows); break;
  }

  const paymentIds = [...new Set(findings.flatMap((entry) => entry.paymentIds))];
  const referenced = rows.filter((row) => paymentIds.includes(row.operationId));
  if (referenced.length > 0 && referenced.every((row) => row.isDemonstration)) {
    uncertainty.push("Every referenced record is a demonstration record. No operational ledger payment is involved and no money figure here is part of a ledger total.");
  }

  let explanation: string;
  if (rows.length === 0) explanation = "There is no payment record in the current data, so there is nothing to investigate.";
  else if (paymentIds.length === 0) explanation = EMPTY_TEXT[intent];
  else {
    const budgetNote = intent === "cannot_pay_within_budget"
      ? ` The ledger reports ${usd(snapshot.capacity.remainingCents)} remaining of a ${usd(snapshot.capacity.budgetCents)} rolling cap, with a per-payment cap of ${usd(snapshot.capacity.perPaymentCapCents)}.`
      : "";
    explanation = `${LEAD_TEXT[intent](paymentIds.length)}${budgetNote} ${findings.map((entry) => `${entry.title}: ${entry.paymentIds.length}.`).join(" ")} This reports recorded state only.`;
  }

  const label = ACTION_LABEL[intent];
  const suggestedGridAction: SuggestedGridAction = paymentIds.length === 0
    ? { type: "none", reason: "No matching payment in the current data." }
    : paymentIds.length === 1
      ? { type: "open_payment", paymentId: paymentIds[0], label }
      : { type: "filter_payments", paymentIds, label };

  return { ...base, findings, paymentIds, explanation, uncertainty, suggestedGridAction };
}

const OPERATION_ID_PATTERN = /\b(?:legacy|workspace|receipt)\/[A-Za-z0-9._-]+/g;

/** Optional rewording. The findings, identifiers and action are returned untouched. */
export async function narrateOperationsInvestigation(analysis: OperationsInvestigation, apiKey: string, fetchFn: typeof fetch = fetch): Promise<OperationsInvestigation> {
  if (analysis.intent === "unsupported" || analysis.paymentIds.length === 0) return analysis;
  try {
    const response = await fetchFn("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "Rewrite the supplied payment investigation in at most four plain sentences. Preserve every record identifier, amount, status and uncertainty statement exactly. Do not add records, causes, advice or actions. Return plain text only." },
          { role: "user", content: JSON.stringify({ question: analysis.question, explanation: analysis.explanation, findings: analysis.findings, uncertainty: analysis.uncertainty, paymentIds: analysis.paymentIds }) },
        ],
        temperature: 0,
        max_tokens: 400,
      }),
    });
    if (!response.ok) return analysis;
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text || text.length > 2000) return analysis;
    const allowed = new Set(analysis.paymentIds);
    const mentioned = text.match(OPERATION_ID_PATTERN) ?? [];
    if (mentioned.some((id) => !allowed.has(id.replace(/[.,;:]+$/, "")))) return analysis;
    return { ...analysis, explanation: text, source: "Model narration over the deterministic ledger projection" };
  } catch {
    // A narration failure must never lose the deterministic answer.
    return analysis;
  }
}
