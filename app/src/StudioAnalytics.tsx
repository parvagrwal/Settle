import { useMemo, useState } from "react";
import { AgStudio } from "ag-studio-react";
import { enableStudioDevValidations } from "ag-studio";
import type { AgDataSourcesDefinition, AgFieldDefinition, AgReportState } from "ag-studio";
import type { Transaction } from "./transactions.ts";

if (import.meta.env.DEV) enableStudioDevValidations();

const fields: AgFieldDefinition[] = [
  { id: "status", name: "Status", format: "textFormat" },
  { id: "payeeEmail", name: "Payee", format: "textFormat" },
  { id: "gross", name: "Gross (USD)", format: "currencyFormat" },
  { id: "fee", name: "Fee (USD)", format: "currencyFormat" },
  { id: "net", name: "Net (USD)", format: "currencyFormat" },
];

const initialState: AgReportState = {
  pages: [{
    id: "transaction-analysis",
    widgets: {
      "status-chart": {
        type: "column-chart-grouped",
        dataMapping: {
          categoryKey: [{ id: "transactions.status" }],
          valueKey: [{ id: "transactions.gross", aggregation: "sum" }],
        },
        format: {
          title: { enabled: true, text: "Verified gross by status" },
          crossFilter: "highlight",
        },
      },
      "analysis-grid": {
        type: "grid",
        dataMapping: { cols: [
          { id: "transactions.status" }, { id: "transactions.payeeEmail" },
          { id: "transactions.gross" }, { id: "transactions.fee" }, { id: "transactions.net" },
        ] },
        format: {
          title: { enabled: true, text: "Cross-filtered payment analysis" },
          crossFilter: "filter",
          style: { columnWidth: 170, columnAutoSize: false, theme: { rowHeight: 42 } },
        },
      },
    },
    widgetLayout: {
      "status-chart": { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 14 },
      "analysis-grid": { xTrack: 0, yTrack: 14, xSpan: 24, ySpan: 16 },
    },
  }],
  selectedPageId: "transaction-analysis",
};

function savedState(): AgReportState {
  try {
    const stored = localStorage.getItem("settle.studio.report");
    return stored ? JSON.parse(stored) as AgReportState : initialState;
  } catch { return initialState; }
}

export default function StudioAnalytics({ rows }: { rows: Transaction[] }) {
  const [state] = useState<AgReportState>(savedState);
  const [saved, setSaved] = useState(false);
  const data: AgDataSourcesDefinition = useMemo(() => ({ sources: [{
    id: "transactions", name: "Verified transactions",
    data: rows.map((row) => ({
      status: row.status, payeeEmail: row.payeeEmail ?? "Not supplied",
      gross: row.grossCents / 100, fee: row.feeCents === null ? null : row.feeCents / 100,
      net: row.netCents === null ? null : row.netCents / 100,
    })),
    fields,
  }] }), [rows]);

  return <section className="studio-section" aria-label="AG Studio transaction analytics">
    <div className="section-heading"><div><p className="eyebrow">AG STUDIO · NATIVE CROSS-FILTER</p><h2>From pattern to payment population</h2></div><span className="save-state" role="status">{saved ? "Report state saved locally" : "Layout and filter state persists locally"}</span></div>
    <p className="muted">Select a chart status to cross-filter the analytical grid. Exact fees and net remain blank when PayPal did not report them.</p>
    <div className="studio transaction-studio">
      <AgStudio data={data} initialState={state} mode="view" onStateUpdated={(event) => {
        localStorage.setItem("settle.studio.report", JSON.stringify(event.state));
        setSaved(true);
      }} />
    </div>
  </section>;
}
