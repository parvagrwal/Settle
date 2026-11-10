import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GetRowIdParams, RowClassParams } from "ag-grid-community";
import { ownerHeaders } from "./api.ts";
import { settleGridTheme } from "./ag/theme.ts";

type Obligation = { obligationId: string; recipient: string; owedCents: number; dueAt: string; mandatory: boolean; partialAllowed: boolean; priority: string; note: string };
type Context = { contextId: string; capturedAt: string; clearedFundsCents: number; reserveCents: number; committedCents: number; obligations: Obligation[]; source: string };
type Plan = { planId: string; strategy: string; totalAllocatedCents: number; allocations: { obligationId: string; amountCents: number; residualCents: number }[]; unfundedObligationIds: string[]; rationale: string };
type Result = { status: string; recommendation: null | { selectedPlan: Plan; reason: string; uncertainties: string[]; changeTriggers: string[] }; deterministicAlternatives: Plan[]; escalations: string[]; toolTrace: string[]; context: Context; source: string };
const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
// Stable grid configuration: identical on every render.
const getPlanRowId = (params: GetRowIdParams<Plan>): string => params.data.planId;
const planDefaultColDef: ColDef<Plan> = { sortable: true, filter: true, resizable: true, wrapText: true, autoHeight: true };

export default function AllocationPlanner() {
  const [context, setContext] = useState<Context | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/allocation/demo-context").then((res) => res.json()).then(setContext).catch(() => setError("Could not load scenario context")); }, []);
  const run = useCallback(async (counterfactual: boolean) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/allocation/recommend", { method: "POST", headers: { "Content-Type": "application/json", ...ownerHeaders() }, body: JSON.stringify({ counterfactual }) });
      if (response.status === 401) throw new Error("owner token needed: enter it at the top of the page, then try again");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as Result;
      setResult(body); setContext(body.context);
    } catch (cause) { setError(`Recommendation failed: ${String(cause)}`); }
    finally { setLoading(false); }
  }, []);
  const columns = useMemo<ColDef<Plan>[]>(() => [
    { field: "strategy", headerName: "Alternative", minWidth: 190 },
    { field: "totalAllocatedCents", headerName: "Allocated", valueFormatter: (p) => usd(p.value), width: 130 },
    { headerName: "Funded obligations", valueGetter: (p) => p.data?.allocations.map((row) => row.obligationId).join(", "), minWidth: 230 },
    { headerName: "Residual schedule", valueGetter: (p) => p.data?.allocations.filter((row) => row.residualCents > 0).map((row) => `${row.obligationId}: ${usd(row.residualCents)} remains`).join("; ") || "None", minWidth: 220 },
    { field: "unfundedObligationIds", headerName: "Deferred / escalated", valueFormatter: (p) => (p.value as string[]).join(", ") || "None", minWidth: 210 },
    { field: "rationale", headerName: "Deterministic trade-off", minWidth: 320 },
  ], []);
  const selectedId = result?.recommendation?.selectedPlan.planId;
  const getRowClass = useCallback((params: RowClassParams<Plan>) => (params.data?.planId === selectedId ? "selected-scenario" : undefined), [selectedId]);
  return <main className="allocation-page">
    <section className="allocation-hero"><p className="eyebrow">AGENTIC ALLOCATION · OWNER CONTROLLED</p><h1>Coordinate priorities.<br />Protect every obligation.</h1><p>The agent compares valid allocation scenarios as circumstances change. It cannot invent entitlements, alter limits, approve its own plan, or access PayPal credentials.</p><div className="allocation-actions"><button disabled={loading} onClick={() => void run(false)}>{loading ? "Evaluating…" : "Evaluate current scenario"}</button><button disabled={loading} className="secondary" onClick={() => void run(true)}>Simulate delayed receipt</button></div></section>
    {error && <p role="alert" className="error-text">{error}</p>}
    {context && <section className="context-strip"><div><span>Illustrative cleared funds</span><strong>{usd(context.clearedFundsCents)}</strong></div><div><span>Protected reserve</span><strong>{usd(context.reserveCents)}</strong></div><div><span>Discretionary budget</span><strong>{usd(context.clearedFundsCents - context.reserveCents - context.committedCents)}</strong></div><div><span>Context version</span><strong>{context.contextId}</strong></div><p>{context.source}</p></section>}
    {context && <section className="obligation-section"><div className="section-heading"><div><p className="eyebrow">VALIDATED INPUT</p><h2>Competing obligations</h2></div><span>Notes are untrusted context, not instructions</span></div><div className="obligation-cards">{context.obligations.map((row) => <article key={row.obligationId}><div><span className={`priority ${row.priority}`}>{row.priority}</span><span>{row.mandatory ? "Mandatory" : "Discretionary"}</span></div><h3>{row.obligationId}</h3><strong>{usd(row.owedCents)}</strong><p>Due {new Date(row.dueAt).toLocaleDateString()} · {row.partialAllowed ? "Partial schedule permitted" : "Full payment required"}</p><small>{row.note}</small></article>)}</div></section>}
    {result && <>
      <section className={`decision-status ${result.status}`}><div><p className="eyebrow">AGENT RECOMMENDATION</p><h2>{result.status === "recommendation_ready" ? "A defensible plan is ready for review" : result.status === "recommendation_unavailable" ? "AI recommendation unavailable" : "Escalation required"}</h2><p>{result.escalations.join(" ") || "The model selected only from independently validated alternatives. No payment is approved."}</p></div><span className="no-execution">NO PAYMENT AUTHORIZED</span></section>
      {result.recommendation && <section className="recommendation-detail"><p className="eyebrow">WHY THIS TRADE-OFF</p><h2>{result.recommendation.selectedPlan.strategy}</h2><p>{result.recommendation.reason}</p><div><span><strong>Uncertainties</strong>{result.recommendation.uncertainties.join(" ") || "None stated"}</span><span><strong>What changes this decision</strong>{result.recommendation.changeTriggers.join(" ") || "Material context change"}</span></div></section>}
      <section className="scenario-grid"><div className="section-heading"><div><p className="eyebrow">ALTERNATIVES, NOT A SINGLE ANSWER</p><h2>Compare the allocation scenarios</h2></div><span>Tool trace: {result.toolTrace.join(" → ")}</span></div><div className="allocation-grid" style={{ height: 330 }}><AgGridReact<Plan> theme={settleGridTheme} rowData={result.deterministicAlternatives} columnDefs={columns} getRowId={getPlanRowId} defaultColDef={planDefaultColDef} getRowClass={getRowClass} /></div></section>
      <p className="truth-note">AI removal removes contextual scenario selection and explanation; deterministic alternatives remain for explicit human review. This illustrative scenario is not real customer research, actual available cash, or proof of AI superiority.</p>
    </>}
  </main>;
}
