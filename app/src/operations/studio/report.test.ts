// The shipped Studio report and the translation of Studio's filter state into
// grid column filters.
import { describe, expect, it } from "vitest";
import { CAPACITY_WIDGET_TYPE, REPORT_PAGE_ID, initialReport, loadReport, saveReport, selectionsFromState, type SettleReport } from "./report.ts";
import { STUDIO_FIELDS, STUDIO_SOURCE_ID } from "../view.ts";

const fieldIds = new Set(STUDIO_FIELDS.map((field) => `${STUDIO_SOURCE_ID}.${field.id}`));

function referencedFields(state: SettleReport): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.id === "string" && record.id.startsWith(`${STUDIO_SOURCE_ID}.`)) found.push(record.id);
      Object.values(record).forEach(walk);
    }
  };
  walk(state.pages);
  return found;
}

describe("Studio report", () => {
  it.each(["desktop", "compact"] as const)("the %s report places the capacity widget and references only fields the data source defines", (layout) => {
    const report = initialReport(layout);
    const page = report.pages.find((entry) => entry.id === REPORT_PAGE_ID)!;
    expect(report.selectedPageId).toBe(REPORT_PAGE_ID);
    const widgets = page.widgets as Record<string, { type: string }>;
    expect(Object.values(widgets).some((widget) => widget.type === CAPACITY_WIDGET_TYPE)).toBe(true);
    expect(Object.keys(widgets).sort()).toEqual(Object.keys(page.widgetLayout ?? {}).sort());
    for (const id of referencedFields(report)) expect(fieldIds.has(id), `${id} is a defined field`).toBe(true);
    expect(page.filter?.page?.length).toBeGreaterThanOrEqual(3);
    for (const position of Object.values(page.widgetLayout ?? {})) {
      expect(position!.xTrack + position!.xSpan).toBeLessThanOrEqual(24);
    }
  });

  it("stacks every widget full width in the compact layout", () => {
    const page = initialReport("compact").pages[0];
    for (const position of Object.values(page.widgetLayout ?? {})) {
      expect(position!.xTrack).toBe(0);
      expect(position!.xSpan).toBe(24);
    }
    expect(page.layout?.minWidth).toBeLessThanOrEqual(340);
  });

  it("restores a saved report for the same layout and ignores an unreadable one", () => {
    const storage = new Map<string, string>();
    const store = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
    expect(loadReport("desktop", store)).toEqual(initialReport("desktop"));
    const edited = { ...initialReport("desktop"), panels: { filters: { collapsed: true } } };
    expect(saveReport("desktop", edited, store)).toBe(true);
    expect(loadReport("desktop", store)).toEqual(edited);
    expect(loadReport("compact", store)).toEqual(initialReport("compact"));
    storage.set([...storage.keys()][0], "{not json");
    expect(loadReport("desktop", store)).toEqual(initialReport("desktop"));
    storage.set([...storage.keys()][0], JSON.stringify({ pages: [], selectedPageId: "x" }));
    expect(loadReport("desktop", store)).toEqual(initialReport("desktop"));
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadReport("desktop", blocked)).toEqual(initialReport("desktop"));
    expect(saveReport("desktop", edited, blocked)).toBe(false);
  });
});

describe("Studio selections mirrored onto the grid", () => {
  const base = initialReport("desktop");
  const withPage = (patch: Record<string, unknown>): SettleReport => ({ ...base, pages: [{ ...base.pages[0], ...patch }] }) as SettleReport;

  it("returns nothing when Studio has no selection", () => {
    expect(selectionsFromState(base)).toEqual([]);
  });

  it("turns a chart cross-filter into the values of the matching grid column", () => {
    const state = withPage({ crossFilter: { values: { status: [{ type: "value", group: 0, field: { id: "payments.paymentStatus" }, values: ["Failed", "Outcome unknown"] }] } } });
    expect(selectionsFromState(state)).toEqual([{ column: "paymentStatus", values: ["Failed", "Outcome unknown"] }]);
  });

  it("turns page filters with a list or a single value into grid column values", () => {
    const state = withPage({ filter: { page: [
      { field: { id: "payments.approvalState" }, model: { operator: "isIn", value: ["Not approved"] } },
      { field: { id: "payments.recordClass" }, model: { operator: "equals", value: "Operational" } },
      { field: { id: "payments.paymentStatus" } },
      { field: { id: "payments.amount" }, model: { operator: "greaterThan", value: 10 } },
    ] } });
    expect(selectionsFromState(state)).toEqual([{ column: "approvalState", values: ["Not approved"] }, { column: "recordClass", values: ["Operational"] }]);
  });

  it("intersects a cross-filter and a page filter on the same field, and ignores fields the grid does not mirror", () => {
    const state = withPage({
      filter: { page: [{ field: { id: "payments.paymentStatus" }, model: { operator: "isIn", value: ["Failed", "Approved, not sent"] } }] },
      crossFilter: { values: {
        status: [{ type: "value", group: 0, field: { id: "payments.paymentStatus" }, values: ["Failed", "Outcome unknown"] }],
        capacity: [{ type: "value", group: 0, field: { id: "payments.needsApproval" }, values: [true] }],
        other: [{ type: "range", group: 0, field: { id: "payments.amount" }, from: 1, to: 5 }],
      } },
    });
    expect(selectionsFromState(state)).toEqual([{ column: "paymentStatus", values: ["Failed"] }]);
  });

  it("reads only the selected page", () => {
    const state: SettleReport = { ...base, pages: [...base.pages, { id: "other", crossFilter: { values: { w: [{ type: "value", group: 0, field: { id: "payments.paymentStatus" }, values: ["Failed"] }] } } }] };
    expect(selectionsFromState(state)).toEqual([]);
  });
});
