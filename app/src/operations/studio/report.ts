// The Studio report shipped with the operations workspace, its persistence, and
// the translation of Studio's own filter state into grid column filters.
import type { AgReportState } from "ag-studio";
import type { StudioSelection } from "../store.ts";
import { STUDIO_SOURCE_ID, STUDIO_TO_GRID_COLUMN } from "../view.ts";
import { CAPACITY_WIDGET_TYPE, type SettleRegistry } from "./registry.ts";

export { CAPACITY_WIDGET_TYPE };
export const REPORT_PAGE_ID = "operations";
export const CAPACITY_WIDGET_ID = "capacity";

/** Report state for the Settle registry (default widgets plus the capacity widget). */
export type SettleReport = AgReportState<SettleRegistry>;

export type ReportLayout = "desktop" | "compact";

const field = (id: string) => ({ id: `${STUDIO_SOURCE_ID}.${id}` });

/**
 * The report a reader sees first. `compact` is a separate, deliberate layout for
 * narrow screens (widgets stacked full width, a narrower minimum canvas), not
 * the desktop layout scaled down.
 */
export function initialReport(layout: ReportLayout): SettleReport {
  const compact = layout === "compact";
  const widgets: NonNullable<SettleReport["pages"][number]["widgets"]> = {
    [CAPACITY_WIDGET_ID]: {
      type: CAPACITY_WIDGET_TYPE,
      dataMapping: {},
      format: { title: { enabled: true, text: "Payment capacity and exceptions" }, crossFilter: "highlight", style: { showCalculation: false, includeDemonstration: true } },
    },
    status: {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [field("paymentStatus")], valueKey: [{ ...field("amount"), aggregation: "sum" }] },
      format: { title: { enabled: true, text: "Amount by payment status" }, crossFilter: "filter" },
    },
    due: {
      type: "donut-chart",
      dataMapping: { categoryKey: [field("dueWindow")], valueKey: [{ ...field("operationId"), aggregation: "count" }] },
      format: { title: { enabled: true, text: "Records by due window" }, crossFilter: "filter" },
    },
  };
  const widgetLayout = compact
    ? {
        [CAPACITY_WIDGET_ID]: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 34 },
        status: { xTrack: 0, yTrack: 34, xSpan: 24, ySpan: 18 },
        due: { xTrack: 0, yTrack: 52, xSpan: 24, ySpan: 18 },
      }
    : {
        [CAPACITY_WIDGET_ID]: { xTrack: 0, yTrack: 0, xSpan: 11, ySpan: 26 },
        status: { xTrack: 11, yTrack: 0, xSpan: 7, ySpan: 26 },
        due: { xTrack: 18, yTrack: 0, xSpan: 6, ySpan: 26 },
      };
  return {
    pages: [{
      id: REPORT_PAGE_ID,
      widgets,
      widgetLayout,
      layout: compact ? { minWidth: 320 } : { minWidth: 720 },
      filter: { page: [
        { field: field("paymentStatus"), view: { viewTypeId: "selection" } },
        { field: field("approvalState"), view: { viewTypeId: "selection" } },
        { field: field("recordClass"), view: { viewTypeId: "selection" } },
        { field: field("dueWindow"), view: { viewTypeId: "selection" } },
      ] },
    }],
    selectedPageId: REPORT_PAGE_ID,
    // Narrow screens start with the panels folded so the canvas has the width.
    panels: { filters: { collapsed: compact }, edit: { collapsed: true }, data: { collapsed: true }, ai: { collapsed: false } },
  };
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const storageKey = (layout: ReportLayout): string => `settle.operations.report.v1.${layout}`;

function usable(value: unknown): value is SettleReport {
  if (typeof value !== "object" || value === null) return false;
  const state = value as { pages?: unknown; selectedPageId?: unknown };
  return Array.isArray(state.pages) && typeof state.selectedPageId === "string"
    && state.pages.some((page) => typeof page === "object" && page !== null && (page as { id?: unknown }).id === state.selectedPageId);
}

export function loadReport(layout: ReportLayout, storage: Storage = localStorage): SettleReport {
  try {
    const stored = storage.getItem(storageKey(layout));
    if (!stored) return initialReport(layout);
    const parsed: unknown = JSON.parse(stored);
    return usable(parsed) ? parsed : initialReport(layout);
  } catch {
    // Blocked or corrupted storage: start from the shipped report.
    return initialReport(layout);
  }
}

export function saveReport(layout: ReportLayout, state: SettleReport, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(storageKey(layout), JSON.stringify(state));
    return true;
  } catch {
    // Storage full or blocked: the report keeps working, it is just not remembered.
    return false;
  }
}

export function forgetReport(layout: ReportLayout, storage: Pick<globalThis.Storage, "removeItem"> = localStorage): void {
  try {
    storage.removeItem(storageKey(layout));
  } catch {
    // Nothing to forget when storage is unavailable.
  }
}

/**
 * Studio's current value selections on the selected page (chart cross-filters and
 * list page filters), expressed as grid column values. Only fields the grid
 * carries with identical values are mirrored; anything else is left to Studio.
 */
export function selectionsFromState(state: SettleReport): StudioSelection[] {
  const page = state.pages.find((entry) => entry.id === state.selectedPageId);
  if (!page) return [];
  const byColumn = new Map<string, string[]>();
  const add = (fieldId: unknown, values: unknown[]): void => {
    if (typeof fieldId !== "string" || !fieldId.startsWith(`${STUDIO_SOURCE_ID}.`)) return;
    const column = STUDIO_TO_GRID_COLUMN[fieldId.slice(STUDIO_SOURCE_ID.length + 1)];
    const texts = values.filter((value): value is string => typeof value === "string");
    if (!column || texts.length === 0) return;
    const existing = byColumn.get(column);
    byColumn.set(column, existing ? existing.filter((value) => texts.includes(value)) : texts);
  };
  for (const filter of page.filter?.page ?? []) {
    const model = filter.model as { operator?: string; value?: unknown } | undefined;
    if (!model) continue;
    if (model.operator === "isIn" && Array.isArray(model.value)) add(filter.field?.id, model.value);
    else if (model.operator === "equals") add(filter.field?.id, [model.value]);
  }
  for (const selections of Object.values(page.crossFilter?.values ?? {})) {
    for (const selection of selections) {
      if (selection.type === "value") add(selection.field?.id, selection.values);
    }
  }
  return [...byColumn.entries()].map(([column, values]) => ({ column, values }));
}
