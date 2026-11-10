// Verified provider events: the PayPal webhook ledger in AG Grid, with the
// immutable event history of each record and an evidence-grounded question box.
//
// Grid lifecycle rules followed here (see docs/ag-grid/05-LIFECYCLE.md):
// - rows reach the grid through the `rowData` prop with `getRowId`; nothing
//   pushes rows through the Grid API from an effect;
// - the Grid API lives in state (`useGridApi`) and is cleared when the grid is
//   destroyed, so nothing can call a destroyed grid after a tab switch;
// - every object or function handed to `AgGridReact` is stable between renders,
//   so a poll does not rebuild the side bar or close an open menu;
// - every request is aborted on unmount and a late answer is ignored.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, DefaultMenuItem, GetContextMenuItemsParams, GetRowIdParams, IRowNode, MenuItemDef, SelectionChangedEvent, SideBarDef, ValueFormatterParams } from "ag-grid-community";
import StudioAnalytics from "./StudioAnalytics.tsx";
import { settleGridTheme } from "./ag/theme.ts";
import { useGridApi } from "./ag/useGridApi.ts";
import { formatMoney, isAbort, transactionApi, type HistoryEvent, type Investigation, type Transaction } from "./transactions.ts";

const text = (value: string | null | undefined): string => value ?? "Not reported";
const settled = (status: string): boolean => status === "SUCCESS" || status === "COMPLETED";

function Status({ value: status }: { value: string }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}>{status}</span>;
}

// ---- stable grid configuration (module scope: identical on every render) ----
const getRowId = (params: GetRowIdParams<Transaction>): string => params.data.rowKey;
const defaultColDef: ColDef<Transaction> = { sortable: true, resizable: true, filter: true, floatingFilter: true };
const rowSelection = { mode: "singleRow", checkboxes: true, enableClickSelection: true } as const;
const selectionColumnDef: ColDef<Transaction> = { pinned: "left", width: 48, resizable: false };
const pageSizes = [25, 50, 100];
const sideBar: SideBarDef = { toolPanels: ["columns", "filters"] };
const moneyFormatter = (params: ValueFormatterParams<Transaction, number | null>): string => formatMoney(params.value ?? null, params.data?.currency ?? null);
const textFormatter = (params: ValueFormatterParams<Transaction, string | null>): string => text(params.value);

export default function TransactionsDashboard() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(0);
  const { api, onGridReady, onGridPreDestroyed } = useGridApi<Transaction>();
  const [connection, setConnection] = useState("Connecting to verified event ledger");
  const [view, setView] = useState<"operations" | "analytics">("operations");
  const [search, setSearch] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const attentionOnlyRef = useRef(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [inspected, setInspected] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [question, setQuestion] = useState("Which payments require investigation?");
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [investigationError, setInvestigationError] = useState("");
  const [investigating, setInvestigating] = useState(false);
  const [evidenceIds, setEvidenceIds] = useState<string[] | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Delta polling from the durable cursor. One request at a time; aborted on unmount.
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const sync = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await transactionApi.since(cursorRef.current, controller.signal);
        if (controller.signal.aborted) return;
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
      } catch (error) {
        if (!isAbort(error) && !controller.signal.aborted) setConnection("Connection interrupted · retrying from durable cursor");
      } finally {
        inFlight = false;
      }
    };
    void sync();
    const timer = setInterval(() => void sync(), 4000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  // Keep what the drawer and the selection show in step with the latest projection of the same record.
  const byKey = useMemo(() => new Map(rows.map((row) => [row.rowKey, row])), [rows]);
  const inspectedRow = inspected ? byKey.get(inspected.rowKey) ?? inspected : null;

  // History of the inspected record. A newer inspection aborts the previous request.
  const inspectedKey = inspected?.rowKey ?? null;
  useEffect(() => {
    if (inspectedKey === null) return;
    const controller = new AbortController();
    setHistory(null);
    setHistoryError("");
    transactionApi.history(inspectedKey, controller.signal)
      .then((response) => { if (!controller.signal.aborted) setHistory(response.events); })
      .catch((error: unknown) => { if (!isAbort(error) && !controller.signal.aborted) setHistoryError("History could not be loaded. The projected row remains available."); });
    return () => controller.abort();
  }, [inspectedKey]);

  const inspect = useCallback((transaction: Transaction) => setInspected(transaction), []);

  // External "needs attention" filter: the callbacks are stable and read a ref; the grid is told when the toggle changes.
  const isExternalFilterPresent = useCallback(() => attentionOnlyRef.current, []);
  const doesExternalFilterPass = useCallback((node: IRowNode<Transaction>) => !!node.data && !settled(node.data.status), []);
  useEffect(() => {
    attentionOnlyRef.current = attentionOnly;
    api?.onFilterChanged();
  }, [api, attentionOnly]);

  // Evidence filter: exactly the records the investigation named, as a native set filter on the identity column.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.setColumnFilterModel("rowKey", evidenceIds ? { filterType: "set", values: evidenceIds } : null).then(() => {
      if (!cancelled && !api.isDestroyed()) api.onFilterChanged();
    });
    return () => { cancelled = true; };
  }, [api, evidenceIds]);

  const clearFilters = useCallback(() => {
    setEvidenceIds(null);
    setInvestigation(null);
    setInvestigationError("");
    setSearch("");
    api?.setFilterModel(null);
  }, [api]);

  const columns = useMemo<ColDef<Transaction>[]>(() => [
    { field: "rowKey", headerName: "Payment identity", pinned: "left", minWidth: 180, filter: "agSetColumnFilter" },
    { field: "status", headerName: "Lifecycle", cellRenderer: Status, filter: "agSetColumnFilter", width: 150, enableCellChangeFlash: true },
    { field: "grossCents", headerName: "Gross", valueFormatter: moneyFormatter, filter: "agNumberColumnFilter", width: 125 },
    { field: "feeCents", headerName: "Actual fee", valueFormatter: moneyFormatter, filter: "agNumberColumnFilter", width: 130 },
    { field: "netCents", headerName: "Actual net", valueFormatter: moneyFormatter, filter: "agNumberColumnFilter", width: 130 },
    { field: "payeeEmail", headerName: "Payee", valueFormatter: textFormatter, minWidth: 210 },
    { field: "originalTransactionId", headerName: "Original payment ID", valueFormatter: textFormatter, minWidth: 190 },
    { field: "latestEventId", headerName: "Latest webhook event", minWidth: 190 },
    { field: "eventCreatedAt", headerName: "PayPal event time", minWidth: 185, sort: "desc" },
    { field: "jobId", headerName: "App job metadata", valueFormatter: textFormatter, minWidth: 155 },
    { field: "lastEventSequence", headerName: "Ledger cursor", width: 135, filter: "agNumberColumnFilter" },
    {
      headerName: "Action", colId: "inspect", sortable: false, filter: false, floatingFilter: false, width: 115, pinned: "right",
      cellRenderer: (params: { data?: Transaction }) => params.data ? <button className="row-action" onClick={() => inspect(params.data as Transaction)}>Inspect</button> : null,
    },
  ], [inspect]);

  const getContextMenuItems = useCallback((params: GetContextMenuItemsParams<Transaction>): (MenuItemDef<Transaction> | DefaultMenuItem)[] => {
    const record = params.node?.data;
    return [
      "copy", "copyWithHeaders", "separator",
      ...(record ? [{ name: "Inspect transaction history", action: () => inspect(record) }] : []),
      "csvExport",
    ];
  }, [inspect]);

  const onSelectionChanged = useCallback((event: SelectionChangedEvent<Transaction>) => {
    setSelected(event.api.getSelectedRows()[0] ?? null);
  }, []);

  const currencies = new Set(rows.map((row) => row.currency));
  const gross = rows.reduce((sum, row) => sum + (row.grossCents ?? 0), 0);
  const grossLabel = currencies.size > 1 ? "Mixed currencies" : formatMoney(gross, rows[0]?.currency ?? "USD");
  const attention = rows.filter((row) => !settled(row.status)).length;

  // One investigation at a time: a newer question aborts the previous one, and a late answer is dropped.
  const investigationRequest = useRef<AbortController | null>(null);
  useEffect(() => () => investigationRequest.current?.abort(), []);
  const runInvestigation = useCallback(async () => {
    investigationRequest.current?.abort();
    const controller = new AbortController();
    investigationRequest.current = controller;
    setInvestigating(true);
    setInvestigationError("");
    try {
      const result = await transactionApi.investigate(question, controller.signal);
      if (controller.signal.aborted) return;
      setInvestigation(result);
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return;
      setInvestigation(null);
      setInvestigationError("The investigation could not be completed. Nothing was changed; the grid still shows the verified rows. Try again.");
    } finally {
      if (investigationRequest.current === controller) setInvestigating(false);
    }
  }, [question]);

  // Only identifiers that exist in the current rows can be revealed.
  const knownEvidence = investigation ? investigation.supportingTransactionIds.filter((id) => byKey.has(id)) : [];
  const unknownEvidence = investigation ? investigation.supportingTransactionIds.length - knownEvidence.length : 0;

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
          <label>Search every field<input aria-label="Search transactions" placeholder="ID, email, event…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label><input type="checkbox" checked={attentionOnly} onChange={(event) => setAttentionOnly(event.target.checked)} /> Needs attention</label>
          <button onClick={() => api?.resetColumnState()}>Reset columns</button>
          <button onClick={clearFilters}>Clear filters</button>
          <button onClick={() => api?.exportDataAsCsv({ fileName: "settle-visible-transactions.csv" })}>Export visible CSV</button>
          <button disabled={!selected} onClick={() => selected && inspect(selected)}>Open selected</button>
        </div>
        <div className="transaction-grid">
          <AgGridReact<Transaction>
            theme={settleGridTheme}
            rowData={rows} columnDefs={columns} getRowId={getRowId}
            defaultColDef={defaultColDef}
            rowSelection={rowSelection} selectionColumnDef={selectionColumnDef}
            quickFilterText={search}
            isExternalFilterPresent={isExternalFilterPresent} doesExternalFilterPass={doesExternalFilterPass}
            onGridReady={onGridReady} onGridPreDestroyed={onGridPreDestroyed}
            onSelectionChanged={onSelectionChanged}
            pagination={true} paginationPageSize={25} paginationPageSizeSelector={pageSizes}
            sideBar={sideBar}
            getContextMenuItems={getContextMenuItems}
          />
        </div>
        <div className="grid-footer"><span>{rows.length} projected rows · persisted cursor {cursor}</span><span>Sort, filter, hide or pin columns; CSV respects visible rows.</span></div>
      </section>

      <section className="investigator" aria-label="Evidence-grounded transaction investigation">
        <div className="section-heading"><div><p className="eyebrow">EVIDENCE-GROUNDED INVESTIGATION</p><h2>Ask the ledger, not a generic chatbot.</h2></div><span>{investigation?.source ?? "Deterministic by default"}</span></div>
        <div className="question-row"><input aria-label="Investigation question" value={question} onChange={(event) => setQuestion(event.target.value)} /><button disabled={investigating || question.trim().length < 3} onClick={() => void runInvestigation()}>{investigating ? "Querying…" : "Investigate"}</button></div>
        {investigationError && <p role="alert" className="error-text">{investigationError}</p>}
        {investigation && <div className="investigation-result"><p className="answer">{investigation.answer}</p><div className="fact-list">{investigation.facts.map((fact) => <div key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong><small>{fact.evidence.length} evidence IDs</small></div>)}</div>{investigation.hypotheses.map((hypothesis) => <p className="hypothesis" key={hypothesis}><strong>Hypothesis:</strong> {hypothesis}</p>)}<button disabled={!knownEvidence.length} onClick={() => {
          setEvidenceIds(knownEvidence);
          setView("operations");
        }}>Reveal {knownEvidence.length} evidence rows in grid</button>{unknownEvidence > 0 && <p className="muted" role="status">{unknownEvidence} referenced record(s) are not in the current data and were left out.</p>}<p className="muted">Generated {new Date(investigation.generatedAt).toLocaleString()} · supporting IDs are computed by the server.</p></div>}
      </section>

      <aside className={`history-drawer ${inspectedRow ? "open" : ""}`} aria-label="Transaction history">
        {inspectedRow ? <><div className="section-heading"><div><p className="eyebrow">IMMUTABLE EVENT HISTORY</p><h2>{inspectedRow.rowKey}</h2></div><button aria-label="Close history" onClick={() => setInspected(null)}>×</button></div>
          <div className="identity-grid"><div><span>Original payment</span><strong>{text(inspectedRow.originalTransactionId)}</strong></div><div><span>Latest event</span><strong>{inspectedRow.latestEventId}</strong></div><div><span>Payment created</span><strong>{text(inspectedRow.transactionTimestamp)}</strong></div><div><span>Event received</span><strong>{inspectedRow.eventReceivedAt}</strong></div></div>
          <div className="history-facts"><span>Status <strong>{inspectedRow.status}</strong></span><span>Gross <strong>{formatMoney(inspectedRow.grossCents, inspectedRow.currency)}</strong></span><span>Fee <strong>{formatMoney(inspectedRow.feeCents, inspectedRow.currency)}</strong></span><span>Net <strong>{formatMoney(inspectedRow.netCents, inspectedRow.currency)}</strong></span></div>
          {historyError && <p role="alert">{historyError}</p>}
          {history && <ol className="timeline">{history.map((event) => <li key={event.sequence}><span className="sequence">#{event.sequence}</span><div><strong>{event.eventType}</strong><p>{event.outcome} · {event.eventId}{event.correlationId ? ` · transmission ${event.correlationId}` : ""}</p><time>PayPal {event.eventCreatedAt}<br />Received {event.eventReceivedAt}</time></div></li>)}</ol>}
          {history && history.length === 0 && <p>No events are stored for this record.</p>}
          {!history && !historyError && <p>Loading immutable events…</p>}
        </> : <p>Select a row to inspect its payment and webhook identities.</p>}
      </aside>
    </> : <StudioAnalytics rows={rows} />}
  </main>;
}
