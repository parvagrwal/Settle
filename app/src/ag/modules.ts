// AG Grid feature → module map.
//
// AG Grid 36 is modular: a grid option works only when the module that
// implements it is registered. This file is the inventory. Each entry names a
// feature the application uses, where it is used, and the modules that provide
// it; the registered list is exactly the union of the entries. Nothing here is
// an "All…" bundle, so a feature added without its module fails a test instead
// of failing in the browser.
//
// Module names for each option come from the installed version's own tables
// (GRID_OPTIONS_MODULES and the column definition map in ag-grid-community 36.2).
import {
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  ColumnAutoSizeModule,
  CsvExportModule,
  DateFilterModule,
  ExternalFilterModule,
  HighlightChangesModule,
  NumberFilterModule,
  PaginationModule,
  QuickFilterModule,
  RowApiModule,
  RowAutoHeightModule,
  RowSelectionModule,
  RowStyleModule,
  ScrollApiModule,
  TextFilterModule,
  TooltipModule,
  ValidationModule,
  type Module,
} from "ag-grid-community";
import {
  ClipboardModule,
  ColumnsToolPanelModule,
  ContextMenuModule,
  FiltersToolPanelModule,
  MasterDetailModule,
  SetFilterModule,
  SideBarModule,
  StatusBarModule,
} from "ag-grid-enterprise";

export interface GridFeature {
  feature: string;
  /** Grid options or API calls that need the modules. */
  options: string[];
  edition: "community" | "enterprise";
  modules: Module[];
  usedBy: string[];
}

const OPERATIONS = "operations/OperationsGrid.tsx";
const EVENTS = "TransactionsDashboard.tsx";
const ALLOCATION = "AllocationPlanner.tsx";
const FALLBACK = "GridFallback.tsx";

export const GRID_FEATURES: GridFeature[] = [
  { feature: "Client-side rows fed by React props", options: ["rowData", "getRowId"], edition: "community", modules: [ClientSideRowModelModule], usedBy: [OPERATIONS, EVENTS, ALLOCATION, FALLBACK] },
  { feature: "Text, number and date column filters with floating filters", options: ["colDef.filter", "floatingFilter"], edition: "community", modules: [TextFilterModule, NumberFilterModule, DateFilterModule], usedBy: [OPERATIONS, EVENTS, ALLOCATION] },
  { feature: "Search across every column", options: ["quickFilterText"], edition: "community", modules: [QuickFilterModule], usedBy: [OPERATIONS, EVENTS] },
  { feature: "\"Needs attention\" toggle", options: ["isExternalFilterPresent", "doesExternalFilterPass"], edition: "community", modules: [ExternalFilterModule], usedBy: [EVENTS] },
  { feature: "Pagination", options: ["pagination", "paginationPageSize"], edition: "community", modules: [PaginationModule], usedBy: [OPERATIONS, EVENTS] },
  { feature: "Row selection with a checkbox column", options: ["rowSelection"], edition: "community", modules: [RowSelectionModule], usedBy: [OPERATIONS, EVENTS] },
  { feature: "CSV export of the visible rows", options: ["api.exportDataAsCsv", "context menu csvExport"], edition: "community", modules: [CsvExportModule], usedBy: [OPERATIONS, EVENTS] },
  { feature: "Reset column layout", options: ["api.resetColumnState"], edition: "community", modules: [ColumnApiModule], usedBy: [OPERATIONS, EVENTS] },
  { feature: "Columns sized to the grid width", options: ["autoSizeStrategy"], edition: "community", modules: [ColumnAutoSizeModule], usedBy: [OPERATIONS] },
  { feature: "Open and scroll to a payment record", options: ["api.getRowNode", "api.ensureNodeVisible"], edition: "community", modules: [RowApiModule, ScrollApiModule], usedBy: [OPERATIONS] },
  { feature: "Status and attention styling", options: ["cellClass", "cellClassRules", "getRowClass", "rowClassRules"], edition: "community", modules: [CellStyleModule, RowStyleModule], usedBy: [OPERATIONS, ALLOCATION] },
  { feature: "Explanatory tooltips", options: ["tooltipValueGetter", "headerTooltip"], edition: "community", modules: [TooltipModule], usedBy: [OPERATIONS] },
  { feature: "Flash a cell when a live update changes it", options: ["enableCellChangeFlash"], edition: "community", modules: [HighlightChangesModule], usedBy: [OPERATIONS, EVENTS] },
  { feature: "Wrapped text with automatic row height", options: ["wrapText", "autoHeight"], edition: "community", modules: [RowAutoHeightModule], usedBy: [ALLOCATION] },
  { feature: "Side bar with column and filter tool panels", options: ["sideBar"], edition: "enterprise", modules: [SideBarModule, ColumnsToolPanelModule, FiltersToolPanelModule], usedBy: [OPERATIONS, EVENTS] },
  { feature: "Context menu with record actions", options: ["getContextMenuItems"], edition: "enterprise", modules: [ContextMenuModule], usedBy: [OPERATIONS, EVENTS] },
  { feature: "Copy cells from the context menu", options: ["context menu copy", "copyWithHeaders"], edition: "enterprise", modules: [ClipboardModule], usedBy: [OPERATIONS, EVENTS] },
  { feature: "Set filters, including the exact-record filter the agent and widget apply", options: ["agSetColumnFilter", "api.setColumnFilterModel"], edition: "enterprise", modules: [SetFilterModule], usedBy: [OPERATIONS, EVENTS] },
  { feature: "Payment investigation detail row", options: ["masterDetail", "detailCellRenderer"], edition: "enterprise", modules: [MasterDetailModule], usedBy: [OPERATIONS] },
  { feature: "Row counts: total, filtered and selected", options: ["statusBar"], edition: "enterprise", modules: [StatusBarModule], usedBy: [OPERATIONS] },
];

/** Every module the application registers, each once. */
export const GRID_MODULES: Module[] = [...new Set(GRID_FEATURES.flatMap((feature) => feature.modules))];

export const ENTERPRISE_MODULE_NAMES: string[] = [...new Set(GRID_FEATURES.filter((feature) => feature.edition === "enterprise").flatMap((feature) => feature.modules.map((module) => module.moduleName)))];

/** The list handed to `ModuleRegistry`. Validation (readable errors, option checks) is a development aid only. */
export function gridModules(options: { development: boolean }): Module[] {
  return options.development ? [...GRID_MODULES, ValidationModule] : GRID_MODULES;
}
