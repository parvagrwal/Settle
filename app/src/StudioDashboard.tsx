// Dashboard — the payout rows in the dashboard library, plus a chart of
// amount by status, plus a filter by freelancer. If the dashboard library
// fails to load, the plain grid takes over at once, so the payout rows
// are never a blank screen. Sorting by amount works on the column header
// in both views. The grid updates live: new rows arrive every few seconds
// from the server, and again right after a payment completes.
import { Component, useMemo, useState, type ReactNode } from "react";
import { AgStudio } from "ag-studio-react";
import { enableStudioDevValidations } from "ag-studio";
import type { AgDataSourcesDefinition, AgFieldDefinition, AgReportState } from "ag-studio";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule, ModuleRegistry } from "ag-charts-community";
import type { DashboardRow } from "./api.ts";
import { statusLabel } from "./status.ts";
import GridFallback from "./GridFallback.tsx";

// The chart library needs its modules registered once, before any chart
// is created. Without this, the chart throws and the whole page goes blank.
ModuleRegistry.registerModules([AllCommunityModule]);

// Development-time checks from the dashboard library. Runs only in dev.
if (import.meta.env.DEV) {
  enableStudioDevValidations();
}

const jobFields: AgFieldDefinition[] = [
  { id: "job_id", name: "Job", format: "textFormat" },
  { id: "freelancer", name: "Freelancer", format: "textFormat" },
  { id: "amount_usd", name: "Amount (USD)", format: "currencyFormat" },
  { id: "status_label", name: "Status", format: "textFormat" },
  { id: "reason", name: "Reason", format: "textFormat" },
  { id: "payout_batch_id", name: "Payout batch", format: "textFormat" },
  { id: "fee_usd", name: "Fee est. (USD)", format: "currencyFormat" },
  { id: "net_usd", name: "Net est. (USD)", format: "currencyFormat" },
];

// Dashboard layout, built from the payout rows. One page, one grid widget
// showing the payout rows.
const initialState: AgReportState = {
  pages: [
    {
      id: "overview",
      widgets: {
        "jobs-grid": {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "jobs.job_id" },
              { id: "jobs.freelancer" },
              { id: "jobs.amount_usd" },
              { id: "jobs.status_label" },
              { id: "jobs.reason" },
              { id: "jobs.payout_batch_id" },
              { id: "jobs.fee_usd" },
              { id: "jobs.net_usd" },
            ],
          },
          format: {
            title: { enabled: true, text: "Payouts" },
            // Sizing columns to their content leaves no room when a
            // machine renders the same text slightly wider, so the
            // longest status and reason were cut off. Every column
            // instead uses one fixed width, and rows are tall enough
            // for the longest reason to wrap onto four lines.
            style: { columnWidth: 200, columnAutoSize: false, theme: { rowHeight: 90 } },
          },
        },
      },
      widgetLayout: {
        "jobs-grid": { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 32 },
      },
    },
  ],
  selectedPageId: "overview",
};

interface StudioErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface StudioErrorBoundaryState {
  failed: boolean;
}

class StudioErrorBoundary extends Component<StudioErrorBoundaryProps, StudioErrorBoundaryState> {
  constructor(props: StudioErrorBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): StudioErrorBoundaryState {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

interface StudioDashboardProps {
  rows: DashboardRow[];
}

export default function StudioDashboard({ rows }: StudioDashboardProps) {
  const [freelancer, setFreelancer] = useState("all");
  const [usePlainGrid, setUsePlainGrid] = useState(false);

  const freelancers = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) seen.add(row.freelancer);
    return [...seen].sort();
  }, [rows]);

  const filteredRows = useMemo(
    () => (freelancer === "all" ? rows : rows.filter((row) => row.freelancer === freelancer)),
    [rows, freelancer],
  );

  const data: AgDataSourcesDefinition = useMemo(
    () => ({
      sources: [
        {
          id: "jobs",
          name: "Jobs",
          data: filteredRows,
          fields: jobFields,
        },
      ],
    }),
    [filteredRows],
  );

  const chartData = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const row of rows) {
      byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.amount_usd);
    }
    return [...byStatus.entries()].map(([status, amount]) => ({
      status: statusLabel(status),
      amount: Math.round(amount * 100) / 100,
    }));
  }, [rows]);

  return (
    <section className="studio-section" aria-label="Payouts dashboard">
      <div className="grid-controls">
        <label htmlFor="freelancer-filter">Filter by freelancer</label>
        <select
          id="freelancer-filter"
          value={freelancer}
          onChange={(event) => setFreelancer(event.target.value)}
        >
          <option value="all">All freelancers</option>
          {freelancers.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setUsePlainGrid((value) => !value)}
        >
          {usePlainGrid ? "Use dashboard view" : "Use plain grid view"}
        </button>
      </div>

      {usePlainGrid ? (
        <GridFallback rows={filteredRows} />
      ) : (
        <StudioErrorBoundary fallback={<GridFallback rows={filteredRows} />}>
          <div className="studio">
            <AgStudio data={data} initialState={initialState} mode="view" />
          </div>
        </StudioErrorBoundary>
      )}

      <div className="chart" aria-label="Amount by status">
        <h3>Amount by status (USD)</h3>
        <StudioErrorBoundary fallback={<p>Chart could not load. The payout rows above are still live.</p>}>
          <AgCharts
            options={{
              data: chartData,
              series: [{ type: "bar", xKey: "status", yKey: "amount", yName: "Amount (USD)" }],
              title: { text: "Amount by status (USD)" },
            }}
          />
        </StudioErrorBoundary>
      </div>
    </section>
  );
}
