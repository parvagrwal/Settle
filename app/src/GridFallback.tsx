// Plain grid fallback — the same payout rows in plain AG Grid, with no
// dashboard library involved. Used when the dashboard library fails to
// load, so the payout rows are never a blank screen. The grid library
// stays in package.json either way, so this fallback is always available.
import { AgGridReact } from "ag-grid-react";
import { themeQuartz } from "ag-grid-community";
import type { ColDef } from "ag-grid-community";
import type { DashboardRow } from "./api.ts";
import { statusLabel } from "./status.ts";

// Column widths are set by hand, measured against the longest strings
// the grid shows: Status needs 165px for "Waiting for owner", Reason
// needs 490px for the over-cap text ("PerRequestCapExceeded: payment
// exceeds the $200 per-payment cap", 65 characters). The two together
// end inside the 1,066px desktop grid width, so both show in full
// without scrolling; the last three columns scroll inside the grid.
const columns: ColDef<DashboardRow>[] = [
  { field: "job_id", headerName: "Job", sortable: true, width: 140 },
  { field: "freelancer", headerName: "Freelancer", sortable: true, width: 130 },
  {
    field: "amount_usd",
    headerName: "Amount (USD)",
    sortable: true,
    width: 110,
    valueFormatter: (params) => `$${Number(params.value ?? 0).toFixed(2)}`,
  },
  {
    field: "status",
    headerName: "Status",
    sortable: true,
    width: 165,
    valueFormatter: (params) => statusLabel(String(params.value ?? "")),
  },
  { field: "reason", headerName: "Reason", sortable: false, width: 490 },
  { field: "payout_batch_id", headerName: "Payout batch", sortable: true, width: 160 },
  {
    field: "fee_usd",
    headerName: "PayPal fee (USD)",
    sortable: true,
    width: 130,
    valueFormatter: (params) => (params.value == null ? "Not reported" : `$${Number(params.value).toFixed(2)}`),
  },
  {
    field: "net_usd",
    headerName: "Recipient receives (USD)",
    sortable: true,
    width: 150,
    valueFormatter: (params) => `$${Number(params.value ?? 0).toFixed(2)}`,
  },
];

export default function GridFallback({ rows }: { rows: DashboardRow[] }) {
  return (
    <div className="plain-grid-wrap">
      <div className="fallback-note">
        Plain grid view. PayPal fee shows the actual payout_item_fee reported by
        PayPal (sender-side fee; recipients receive the full payout amount).
      </div>
      <div style={{ height: 320, width: "100%" }}>
        <AgGridReact theme={themeQuartz} rowData={rows} columnDefs={columns} />
      </div>
    </div>
  );
}
