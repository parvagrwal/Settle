// AG Studio analytics over the verified provider events: a chart that
// cross-filters a grid, in the Settle theme, with page filters the reader can
// actually use.
import { useMemo, useState } from "react";
import { AgStudio } from "ag-studio-react";
import type { AgDataSourcesDefinition, AgFieldDefinition, AgReportState, AgStudioStateUpdatedEvent } from "ag-studio";
import { settleStudioTheme } from "./ag/theme.ts";
import type { Transaction } from "./transactions.ts";

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
          style: { columnWidth: 170, columnAutoSize: false },
        },
      },
    },
    widgetLayout: {
      "status-chart": { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 14 },
      "analysis-grid": { xTrack: 0, yTrack: 14, xSpan: 24, ySpan: 16 },
    },
    // Page filters shown in the filters panel. Without these a viewer saw "No filters available".
    filter: { page: [
      { field: { id: "transactions.status" }, view: { viewTypeId: "selection" } },
      { field: { id: "transactions.payeeEmail" }, view: { viewTypeId: "selection" } },
    ] },
  }],
  selectedPageId: "transaction-analysis",
};

/** Studio fills its parent only when its own root is given a size. */
const FILL = { height: "100%", width: "100%" } as const;

// v2: the saved report now includes page filters; an older saved report is not restored.
const STORAGE_KEY = "settle.studio.report.v2";

function savedState(): AgReportState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return initialState;
    const parsed = JSON.parse(stored) as AgReportState;
    return Array.isArray(parsed.pages) && parsed.pages.length > 0 && typeof parsed.selectedPageId === "string" ? parsed : initialState;
  } catch {
    // Unreadable or blocked storage: start from the shipped report.
    return initialState;
  }
}

function persist(event: AgStudioStateUpdatedEvent): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(event.state));
    return true;
  } catch {
    // Storage full or blocked: the report still works, it is just not remembered.
    return false;
  }
}

export default function StudioAnalytics({ rows }: { rows: Transaction[] }) {
  const [state] = useState<AgReportState>(savedState);
  const [saved, setSaved] = useState(false);
  const data: AgDataSourcesDefinition = useMemo(() => ({ sources: [{
    id: "transactions", name: "Verified transactions",
    data: rows.map((row) => ({
      status: row.status, payeeEmail: row.payeeEmail ?? "Not supplied",
      gross: row.grossCents === null ? null : row.grossCents / 100, fee: row.feeCents === null ? null : row.feeCents / 100,
      net: row.netCents === null ? null : row.netCents / 100,
    })),
    fields,
  }] }), [rows]);

  return <section className="studio-section" aria-label="AG Studio transaction analytics">
    <div className="section-heading"><div><p className="eyebrow">AG STUDIO · NATIVE CROSS-FILTER</p><h2>From pattern to payment population</h2></div><span className="save-state" role="status">{saved ? "Report state saved locally" : "Layout and filter state persists locally"}</span></div>
    <p className="muted">Select a chart status to cross-filter the analytical grid. Exact fees and net remain blank when PayPal did not report them.</p>
    <div className="studio transaction-studio">
      <AgStudio style={FILL} data={data} initialState={state} mode="view" theme={settleStudioTheme} enableFilterEditingInViewMode={true}
        onStateUpdated={(event) => { if (persist(event)) setSaved(true); }} />
    </div>
  </section>;
}
