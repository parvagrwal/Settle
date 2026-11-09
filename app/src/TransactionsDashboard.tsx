import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import type { ColDef, GridApi, GridReadyEvent, SelectionChangedEvent, ValueFormatterParams } from "ag-grid-community";
import StudioAnalytics from "./StudioAnalytics.tsx";
import { transactionApi, type HistoryEvent, type Investigation, type Transaction } from "./transactions.ts";

ModuleRegistry.registerModules([AllCommunityModule]);

const money = (cents: number | null, currency: string): string => cents === null ? "Not reported" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const value = (text: string | null): string => text ?? "Not reported";

function Status({ value: status }: { value: string }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}>{status}</span>;
}

export default function TransactionsDashboard() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(0);
  const gridRef = useRef<GridApi<Transaction> | null>(null);
  const [connection, setConnection] = useState("Connecting to verified event ledger");
  const [view, setView] = useState<"operations" | "analytics">("operations");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [question, setQuestion] = useState("Which payments require investigation?");
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      try {
        const response = await transactionApi.since(cursorRef.current);
        if (!active) return;
        if (response.transactions.length) {
          setRows((current) => {
            const next = new Map(current.map((row) => [row.rowKey, row]));
            response.transactions.forEach((row) => next.set(row.rowKey, row));
            return [...next.values()];
          });
        }
        cursorRef.current = response.cursor;
        setCursor(response.cursor);
        setLastSync(response.serverTime);
        setConnection("Verified event store connected · delta polling");
      } catch { if (active) setConnection("Connection interrupted · retrying from durable cursor"); }
    };
    void sync();
    const timer = setInterval(() => void sync(), 4000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    const api = gridRef.current;
    if (!api) return;
    const known = new Set<string>();
    api.forEachNode((node) => { if (node.data) known.add(node.data.rowKey); });
    const updates = rows.filter((row) => known.has(row.rowKey));
    const additions = rows.filter((row) => !known.has(row.rowKey));
    api.applyTransaction({ update: updates, add: additions });
  }, [rows]);

  const inspect = useCallback(async (transaction: Transaction) => {
    setSelected(transaction); setHistoryError(""); setHistory([]);
    try { setHistory((await transactionApi.history(transaction.rowKey)).events); }
    catch { setHistoryError("History could not be loaded. The projected row remains available."); }
  }, []);

  const clearEvidenceFilter = useCallback(() => {
    gridRef.current?.setFilterModel(null);
    setInvestigation(null);
  }, []);

  const columns = useMemo<ColDef<Transaction>[]>(() => [
    { field: "rowKey", headerName: "Payment identity", pinned: "left", minWidth: 180, filter: true, checkboxSelection: true, headerCheckboxSelection: false },
    { field: "status", headerName: "Lifecycle", cellRenderer: Status, filter: true, width: 140 },
    { field: "grossCents", headerName: "Gross", valueFormatter: (p: ValueFormatterParams<Transaction, number>) => money(p.value ?? null, p.data?.currency ?? "USD"), filter: "agNumberColumnFilter", width: 125 },
    { field: "feeCents", headerName: "Actual fee", valueFormatter: (p: ValueFormatterParams<Transaction, number>) => money(p.value ?? null, p.data?.currency ?? "USD"), width: 130 },
    { field: "netCents", headerName: "Actual net", valueFormatter: (p: ValueFormatterParams<Transaction, number>) => money(p.value ?? null, p.data?.currency ?? "USD"), width: 130 },
    { field: "payeeEmail", headerName: "Payee", valueFormatter: (p) => value(p.value), minWidth: 210, filter: true },
    { field: "originalTransactionId", headerName: "Original payment ID", valueFormatter: (p) => value(p.value), minWidth: 190 },
    { field: "latestEventId", headerName: "Latest webhook event", minWidth: 190 },
    { field: "eventCreatedAt", headerName: "PayPal event time", minWidth: 185, sort: "desc" },
    { field: "jobId", headerName: "App job metadata", valueFormatter: (p) => value(p.value), minWidth: 155 },
    { field: "lastEventSequence", headerName: "Ledger cursor", width: 135 },
    { headerName: "Action", colId: "inspect", sortable: false, filter: false, width: 115, pinned: "right", cellRenderer: (params: { data?: Transaction }) => params.data ? <button className="row-action" onClick={() => void inspect(params.data as Transaction)}>Inspect</button> : null },
  ], [inspect]);

  const gross = rows.reduce((sum, row) => sum + row.grossCents, 0);
  const currencies = new Set(rows.map((row) => row.currency));
  const grossLabel = currencies.size > 1 ? "Mixed currencies" : money(gross, rows[0]?.currency ?? "USD");
  const attention = rows.filter((row) => row.status !== "SUCCESS" && row.status !== "COMPLETED").length;

  async function runInvestigation() {
    setInvestigating(true);
    try { setInvestigation(await transactionApi.investigate(question)); }
    finally { setInvestigating(false); }
  }

  return <main className="transaction-page">
    <section className="transaction-hero">
      <div><p className="eyebrow">PAYPAL EVENT INTELLIGENCE</p><h1>Every status has a receipt.</h1><p>Trace the original payment, verified webhook and application decision without collapsing them into one timestamp or one field.</p></div>
      <div className="connection-card"><span className={`connection-dot ${connection.includes("interrupted") ? "offline" : ""}`} /><span>{connection}</span><strong>Cursor {cursor}</strong><small>{lastSync ? `Last response ${new Date(lastSync).toLocaleTimeString()}` : "Awaiting first response"}</small></div>
    </section>

    <section className="kpis transaction-kpis" aria-label="Verified transaction totals">
      <div className="kpi"><div className="kpi-label">Verified transactions</div><div className="kpi-value">{rows.length}</div></div>
      <div className="kpi"><div className="kpi-label">Gross across records</div><div className="kpi-value">{grossLabel}</div></div>
      <div className="kpi"><div className="kpi-label">Needs investigation</div><div className="kpi-value">{attention}</div></div>
      <div className="kpi"><div className="kpi-label">Payment truth</div><div className="kpi-value small">Postback verified</div></div>
    </section>
    <p className="truth-note">No verified rows is a truthful empty state—not a demo failure. Mixed currencies are never summed; fixtures never enter this database.</p>

    <div className="view-tabs" role="tablist" aria-label="Transaction views">
      <button role="tab" aria-selected={view === "operations"} onClick={() => setView("operations")}>Operations grid</button>
      <button role="tab" aria-selected={view === "analytics"} onClick={() => setView("analytics")}>AG Studio analytics</button>
    </div>

    {view === "operations" ? <>
      <section className="grid-shell" aria-label="Verified transaction operations">
        <div className="grid-toolbar">
          <label>Search every field<input aria-label="Search transactions" placeholder="ID, email, event…" onChange={(event) => gridRef.current?.setGridOption("quickFilterText", event.target.value)} /></label>
          <label><input type="checkbox" checked={attentionOnly} onChange={(event) => setAttentionOnly(event.target.checked)} /> Needs attention</label>
          <button onClick={() => gridRef.current?.resetColumnState()}>Reset columns</button>
          <button onClick={clearEvidenceFilter}>Clear filters</button>
          <button onClick={() => gridRef.current?.exportDataAsCsv({ fileName: "settle-visible-transactions.csv" })}>Export visible CSV</button>
          <button disabled={!selected} onClick={() => selected && void inspect(selected)}>Open selected</button>
        </div>
        <div className="ag-theme-alpine transaction-grid">
          <AgGridReact<Transaction>
            rowData={[]} columnDefs={columns} getRowId={(params) => params.data.rowKey}
            defaultColDef={{ sortable: true, resizable: true, filter: true, floatingFilter: true }}
            rowSelection={{ mode: "singleRow", checkboxes: true, enableClickSelection: true }}
            isExternalFilterPresent={() => attentionOnly}
            doesExternalFilterPass={(node) => !!node.data && node.data.status !== "SUCCESS" && node.data.status !== "COMPLETED"}
            onGridReady={(event: GridReadyEvent<Transaction>) => { gridRef.current = event.api; event.api.applyTransaction({ add: rows }); }}
            onSelectionChanged={(event: SelectionChangedEvent<Transaction>) => {
              const node = event.selectedNodes?.[0]; if (node?.data) setSelected(node.data);
            }}
            onFilterChanged={(event) => event.api.redrawRows()}
            pagination={true} paginationPageSize={25} paginationPageSizeSelector={[25, 50, 100]}
            sideBar={{ toolPanels: [{ id: "columns", labelDefault: "Columns", labelKey: "columns", iconKey: "columns", toolPanel: "agColumnsToolPanel" }, { id: "filters", labelDefault: "Filters", labelKey: "filters", iconKey: "filter", toolPanel: "agFiltersToolPanel" }] }}
            getContextMenuItems={(params) => ["copy", "copyWithHeaders", "separator", ...(params.node?.data ? [{ name: "Inspect transaction history", action: () => void inspect((params.node as { data: Transaction }).data) }] : []), "export"]}
          />
        </div>
        <div className="grid-footer"><span>{rows.length} projected rows · persisted cursor {cursor}</span><span>Sort, filter, hide or pin columns; CSV respects visible rows.</span></div>
      </section>

      <section className="investigator" aria-label="Evidence-grounded transaction investigation">
        <div className="section-heading"><div><p className="eyebrow">EVIDENCE-GROUNDED INVESTIGATION</p><h2>Ask the ledger, not a generic chatbot.</h2></div><span>{investigation?.source ?? "Deterministic by default"}</span></div>
        <div className="question-row"><input aria-label="Investigation question" value={question} onChange={(event) => setQuestion(event.target.value)} /><button disabled={investigating || question.trim().length < 3} onClick={() => void runInvestigation()}>{investigating ? "Querying…" : "Investigate"}</button></div>
        {investigation && <div className="investigation-result"><p className="answer">{investigation.answer}</p><div className="fact-list">{investigation.facts.map((fact) => <div key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong><small>{fact.evidence.length} evidence IDs</small></div>)}</div>{investigation.hypotheses.map((hypothesis) => <p className="hypothesis" key={hypothesis}><strong>Hypothesis:</strong> {hypothesis}</p>)}<button disabled={!investigation.supportingTransactionIds.length} onClick={() => {
          gridRef.current?.setFilterModel({ rowKey: { filterType: "set", values: investigation.supportingTransactionIds } });
          setView("operations");
        }}>Reveal {investigation.supportingTransactionIds.length} evidence rows in grid</button><p className="muted">Generated {new Date(investigation.generatedAt).toLocaleString()} · supporting IDs are computed by the server.</p></div>}
      </section>

      <aside className={`history-drawer ${selected ? "open" : ""}`} aria-label="Transaction history">
        {selected ? <><div className="section-heading"><div><p className="eyebrow">IMMUTABLE EVENT HISTORY</p><h2>{selected.rowKey}</h2></div><button aria-label="Close history" onClick={() => setSelected(null)}>×</button></div>
          <div className="identity-grid"><div><span>Original payment</span><strong>{value(selected.originalTransactionId)}</strong></div><div><span>Latest event</span><strong>{selected.latestEventId}</strong></div><div><span>Payment created</span><strong>{value(selected.transactionTimestamp)}</strong></div><div><span>Event received</span><strong>{selected.eventReceivedAt}</strong></div></div>
          <div className="history-facts"><span>Status <strong>{selected.status}</strong></span><span>Gross <strong>{money(selected.grossCents, selected.currency)}</strong></span><span>Fee <strong>{money(selected.feeCents, selected.currency)}</strong></span><span>Net <strong>{money(selected.netCents, selected.currency)}</strong></span></div>
          {historyError && <p role="alert">{historyError}</p>}
          <ol className="timeline">{history.map((event) => <li key={event.sequence}><span className="sequence">#{event.sequence}</span><div><strong>{event.eventType}</strong><p>{event.outcome} · {event.eventId}</p><time>PayPal {event.eventCreatedAt}<br />Received {event.receivedAt}</time></div></li>)}</ol>
          {!history.length && !historyError && <p>Loading immutable events…</p>}
        </> : <p>Select a row to inspect its payment and webhook identities.</p>}
      </aside>
    </> : <StudioAnalytics rows={rows} />}
  </main>;
}
