// Payment operations grid (AG Grid Enterprise).
//
// One row per obligation, joined to its ledger evidence. The grid is the place
// every other part of the workspace points at: the capacity widget, the Studio
// charts and the investigation agent all end by putting exact rows in front of
// the operator here.
//
// Data and API rules (docs/ag-grid/05-LIFECYCLE.md):
// - rows arrive through `rowData`; identity is `operationId`;
// - the Grid API is held in state and cleared on destroy (`useGridApi`);
// - a focus from the widget or the agent is a native set filter on the Record
//   column, listing exact row ids, so it is visible in the filter UI and
//   removable like any other filter;
// - every option object and callback is stable between renders.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type {
  ColDef, DefaultMenuItem, FilterChangedEvent, GetContextMenuItemsParams, GetRowIdParams, ICellRendererParams, IsRowMaster, ITooltipParams,
  MenuItemDef, RowClassRules, SelectionChangedEvent, SideBarDef, StatusPanelDef, ValueFormatterParams,
} from "ag-grid-community";
import { settleGridTheme } from "../ag/theme.ts";
import { useGridApi } from "../ag/useGridApi.ts";
import { PaymentDetailRenderer, Pill } from "./PaymentDetail.tsx";
import type { GridFocus, OperationsStore, StudioSelection } from "./store.ts";
import { useOperations } from "./store.ts";
import { approvalTone, dueText, formatCents, formatDateTime, statusTone, verificationTone, type OperationView } from "./view.ts";

const RECORD_COLUMN = "operationId";

// ---- cell renderers ----------------------------------------------------------
function RecordCell({ data }: ICellRendererParams<OperationView>) {
  if (!data) return null;
  return <span className="ops-record">
    <span className="ops-record-name">{data.recordName}</span>
    {data.isDemonstration && <span className="ops-tag" title="Demonstration record: excluded from every total and never payable">Demo</span>}
  </span>;
}
function StatusCell({ data }: ICellRendererParams<OperationView>) {
  return data ? <Pill tone={statusTone(data.paymentStatus)}>{data.paymentStatusLabel}</Pill> : null;
}
function ApprovalCell({ data }: ICellRendererParams<OperationView>) {
  return data ? <Pill tone={approvalTone(data.approvalState)}>{data.approvalLabel}</Pill> : null;
}
function VerificationCell({ data }: ICellRendererParams<OperationView>) {
  return data ? <Pill tone={verificationTone(data.verificationState)}>{data.verificationLabel}</Pill> : null;
}
function AttentionCell({ data }: ICellRendererParams<OperationView>) {
  if (!data) return null;
  return data.needsAttention ? <Pill tone="danger">Needs attention</Pill> : <span className="ops-absent">No exception</span>;
}
function BatchCell({ data }: ICellRendererParams<OperationView>) {
  if (!data) return null;
  if (!data.payoutBatchId) return <span className="ops-absent">None recorded</span>;
  return <span className="ops-mono">{data.payoutBatchId}{data.batchReferenceKind === "historical_claim" && <span className="ops-tag" title="Cited by the record; not verified by this application">cited</span>}</span>;
}

// ---- stable grid configuration -----------------------------------------------
const getRowId = (params: GetRowIdParams<OperationView>): string => params.data.operationId;
const isRowMaster: IsRowMaster<OperationView> = () => true;
const defaultColDef: ColDef<OperationView> = { sortable: true, resizable: true, filter: true, floatingFilter: true, minWidth: 110 };
const rowSelection = { mode: "singleRow", checkboxes: false, enableClickSelection: true } as const;
const pageSizes = [25, 50, 100];
const statusBar: { statusPanels: StatusPanelDef[] } = { statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" }, { statusPanel: "agSelectedRowCountComponent", align: "left" }] };
const rowClassRules: RowClassRules<OperationView> = {
  "ops-row-attention": (params) => params.data?.needsAttention === true,
  "ops-row-demo": (params) => params.data?.isDemonstration === true,
};
const moneyFormatter = (params: ValueFormatterParams<OperationView, number | null>): string => formatCents(params.value ?? null);
const attentionTooltip = (params: ITooltipParams<OperationView>): string | undefined => params.data?.attentionReasons.length ? params.data.attentionReasons.join(" ") : undefined;
const recordFilterLabel = (rows: Map<string, OperationView>) => (params: { value: string | null }): string => (params.value ? rows.get(params.value)?.recordName ?? params.value : "(none)");

function sameIds(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export interface OperationsGridProps {
  store: OperationsStore;
  rows: OperationView[];
  search: string;
  /** Narrow screens get fewer default columns and a closed side bar. */
  compact: boolean;
  onApi?: (api: { resetColumns(): void; clearFilters(): void; exportCsv(): void; toggleSideBar(): void } | null) => void;
}

export function OperationsGrid({ store, rows, search, compact, onApi }: OperationsGridProps) {
  const { api, onGridReady, onGridPreDestroyed } = useGridApi<OperationView>();
  const focus = useOperations(store, (state) => state.focus);
  const studioSelections = useOperations(store, (state) => state.studioSelections);
  const detailRequest = useOperations(store, (state) => state.detailRequest);
  const context = useMemo(() => ({ store }), [store]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.operationId, row])), [rows]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const [sideBarOpen, setSideBarOpen] = useState(false);

  const inspect = useCallback((operationId: string) => { store.openPayment(operationId); }, [store]);

  const columns = useMemo<ColDef<OperationView>[]>(() => [
    {
      colId: RECORD_COLUMN, field: "operationId", headerName: "Record", pinned: compact ? undefined : "left", minWidth: compact ? 190 : 250, flex: compact ? undefined : 1.3,
      cellRenderer: "agGroupCellRenderer", cellRendererParams: { innerRenderer: RecordCell },
      filter: "agSetColumnFilter", filterParams: { valueFormatter: (params: { value: string | null }) => recordFilterLabel(byIdRef.current)(params) },
      getQuickFilterText: (params) => `${params.data?.recordName ?? ""} ${params.data?.jobId ?? ""} ${params.data?.operationId ?? ""}`,
      tooltip: (params) => params.data ? `${params.data.operationId}${params.data.jobId ? ` · job ${params.data.jobId}` : ""}` : undefined,
      headerTooltip: "The obligation. Expand a row for its full payment record.",
    },
    { colId: "recipient", field: "recipient", headerName: "Recipient", filter: "agSetColumnFilter", minWidth: 150, hide: compact },
    { colId: "amountCents", field: "amountCents", headerName: "Amount", type: "rightAligned", valueFormatter: moneyFormatter, filter: "agNumberColumnFilter", width: 120 },
    {
      colId: "dueDate", field: "dueDate", headerName: "Due", valueFormatter: (params) => (params.data ? dueText(params.data) : ""), filter: "agTextColumnFilter", minWidth: 190, hide: compact,
      cellClassRules: { "ops-cell-danger": (params) => params.data?.isOverdue === true, "ops-cell-warning": (params) => params.data?.isDueSoon === true && params.data?.isOverdue !== true },
    },
    { colId: "paymentStatus", field: "paymentStatusLabel", headerName: "Payment status", cellRenderer: StatusCell, filter: "agSetColumnFilter", minWidth: 190, enableCellChangeFlash: true, tooltip: (params) => params.data?.blockedReason },
    { colId: "approvalState", field: "approvalLabel", headerName: "Approval", cellRenderer: ApprovalCell, filter: "agSetColumnFilter", minWidth: 150, hide: compact, enableCellChangeFlash: true },
    { colId: "environment", field: "environmentLabel", headerName: "Provider environment", filter: "agSetColumnFilter", minWidth: 160, hide: compact },
    { colId: "verificationState", field: "verificationLabel", headerName: "Verification", cellRenderer: VerificationCell, filter: "agSetColumnFilter", minWidth: 200, hide: compact, enableCellChangeFlash: true },
    { colId: "payoutBatchId", field: "payoutBatchId", headerName: "Batch reference", cellRenderer: BatchCell, minWidth: 190, hide: compact },
    { colId: "lastUpdatedAt", field: "lastUpdatedAt", headerName: "Last update", valueFormatter: (params) => formatDateTime(params.value as string | null), minWidth: 190, hide: compact },
    { colId: "attention", field: "attentionLabel", headerName: "Attention", cellRenderer: AttentionCell, filter: "agSetColumnFilter", minWidth: 160, tooltip: attentionTooltip },
    // Available from the Columns tool panel; also the targets of mirrored Studio selections.
    { colId: "recordClass", field: "recordClass", headerName: "Record class", filter: "agSetColumnFilter", hide: true },
    { colId: "reconciliationState", field: "reconciliationLabel", headerName: "Reconciliation", filter: "agSetColumnFilter", hide: true },
    { colId: "dueWindow", field: "dueWindow", headerName: "Due window", filter: "agSetColumnFilter", hide: true },
    { colId: "source", field: "sourceLabel", headerName: "Workspace", filter: "agSetColumnFilter", hide: true },
    { colId: "paymentId", field: "paymentId", headerName: "Internal payment ID", hide: true, valueFormatter: (params) => (params.value as string | null) ?? "None recorded" },
    { colId: "payoutItemId", field: "payoutItemId", headerName: "Payout item ID", hide: true, valueFormatter: (params) => (params.value as string | null) ?? "None recorded" },
    { colId: "transactionId", field: "transactionId", headerName: "Transaction ID", hide: true, valueFormatter: (params) => (params.value as string | null) ?? "None recorded" },
    { colId: "providerFeeCents", field: "providerFeeCents", headerName: "Fee reported by PayPal", type: "rightAligned", hide: true, filter: "agNumberColumnFilter", valueFormatter: (params) => (params.value === null || params.value === undefined ? "Not reported" : formatCents(params.value as number)) },
    {
      colId: "inspect", headerName: "Inspect", sortable: false, filter: false, floatingFilter: false, resizable: false, width: 104, pinned: compact ? undefined : "right", suppressHeaderMenuButton: true,
      cellRenderer: (params: ICellRendererParams<OperationView>) => params.data ? <button type="button" className="ops-row-action" aria-label={`Inspect ${params.data.recordName}`} onClick={() => inspect((params.data as OperationView).operationId)}>Inspect</button> : null,
    },
  ], [compact, inspect]);

  const sideBar = useMemo<SideBarDef>(() => ({ toolPanels: ["columns", "filters"], hiddenByDefault: compact }), [compact]);

  const getContextMenuItems = useCallback((params: GetContextMenuItemsParams<OperationView>): (MenuItemDef<OperationView> | DefaultMenuItem)[] => {
    const record = params.node?.data;
    return [
      ...(record ? [
        { name: `Inspect ${record.recordName}`, action: () => inspect(record.operationId) },
        { name: "Show only this record", action: () => { store.focusPayments({ ids: [record.operationId], label: record.recordName, source: "widget" }); } },
        "separator" as const,
      ] : []),
      "copy", "copyWithHeaders", "separator", "csvExport",
    ];
  }, [inspect, store]);

  // ---- exact-row focus (widget or agent) as a native set filter on the Record column ----
  const appliedFocus = useRef<GridFocus | null>(null);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const done = () => { if (!cancelled && !api.isDestroyed()) api.onFilterChanged(); };
    if (focus) {
      appliedFocus.current = focus;
      void api.setColumnFilterModel(RECORD_COLUMN, { filterType: "set", values: focus.ids }).then(done);
    } else if (appliedFocus.current) {
      // Remove the filter only if it is still the one this component applied; a filter the user changed is theirs.
      const model = api.getColumnFilterModel<{ values?: string[] }>(RECORD_COLUMN);
      const stillOurs = sameIds(model?.values, appliedFocus.current.ids);
      appliedFocus.current = null;
      if (stillOurs) void api.setColumnFilterModel(RECORD_COLUMN, null).then(done);
    }
    return () => { cancelled = true; };
  }, [api, focus]);

  // ---- Studio selections mirrored onto the matching grid columns ----
  const mirrored = useRef<string[]>([]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const wanted = new Map(studioSelections.map((selection: StudioSelection) => [selection.column, selection.values]));
    const columnsToClear = mirrored.current.filter((column) => !wanted.has(column));
    mirrored.current = [...wanted.keys()];
    const work = [
      ...columnsToClear.map((column) => api.setColumnFilterModel(column, null)),
      ...[...wanted.entries()].map(([column, values]) => api.setColumnFilterModel(column, { filterType: "set", values })),
    ];
    if (work.length > 0) void Promise.all(work).then(() => { if (!cancelled && !api.isDestroyed()) api.onFilterChanged(); });
    return () => { cancelled = true; };
  }, [api, studioSelections]);

  // The user changed or removed the Record filter in the grid's own UI: the focus is no longer in force.
  const onFilterChanged = useCallback((event: FilterChangedEvent<OperationView>) => {
    const current = store.getState().focus;
    if (!current) return;
    const model = event.api.getColumnFilterModel<{ values?: string[] }>(RECORD_COLUMN);
    if (!sameIds(model?.values, current.ids)) store.clearFocus();
  }, [store]);

  // ---- open one record: expand its detail row and bring it into view ----
  useEffect(() => {
    if (!api || !detailRequest) return;
    // The focus filter may have been applied in the same tick; wait for the grid to settle before looking the row up.
    const handle = setTimeout(() => {
      if (api.isDestroyed()) return;
      const node = api.getRowNode(detailRequest.operationId);
      if (!node) return;
      node.setExpanded(true);
      if (node.displayed) api.ensureNodeVisible(node, "top");
    }, 60);
    return () => clearTimeout(handle);
  }, [api, detailRequest]);

  // ---- toolbar commands, exposed without handing out the Grid API ----
  useEffect(() => {
    if (!onApi) return;
    if (!api) { onApi(null); return; }
    onApi({
      resetColumns: () => { api.resetColumnState(); },
      clearFilters: () => { api.setFilterModel(null); },
      exportCsv: () => { api.exportDataAsCsv({ fileName: "settle-payment-operations.csv" }); },
      toggleSideBar: () => { setSideBarOpen((open) => !open); },
    });
    return () => onApi(null);
  }, [api, onApi]);
  useEffect(() => {
    if (!api || !compact) return;
    api.setSideBarVisible(sideBarOpen);
    if (sideBarOpen) api.openToolPanel("filters"); else api.closeToolPanel();
  }, [api, compact, sideBarOpen]);

  const onSelectionChanged = useCallback((_event: SelectionChangedEvent<OperationView>) => undefined, []);

  return <div className={`ops-grid${compact ? " ops-grid-compact" : ""}`} data-testid="operations-grid">
    <AgGridReact<OperationView>
      theme={settleGridTheme}
      rowData={rows} columnDefs={columns} getRowId={getRowId} context={context}
      defaultColDef={defaultColDef}
      rowSelection={rowSelection}
      rowClassRules={rowClassRules}
      quickFilterText={search}
      pagination={true} paginationPageSize={25} paginationPageSizeSelector={pageSizes}
      sideBar={sideBar} statusBar={statusBar}
      getContextMenuItems={getContextMenuItems}
      masterDetail={true} isRowMaster={isRowMaster} detailCellRenderer={PaymentDetailRenderer} detailRowAutoHeight={true}
      tooltipShowDelay={400}
      onGridReady={onGridReady} onGridPreDestroyed={onGridPreDestroyed}
      onFilterChanged={onFilterChanged} onSelectionChanged={onSelectionChanged}
      overlayNoRowsTemplate="No payment record matches the current filters."
    />
  </div>;
}
