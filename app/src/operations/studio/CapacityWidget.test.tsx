// Payment capacity and exceptions widget, exercised with a stand-in for Studio's
// widget API. Capacity figures must be the ledger's; exception counts must be
// the rows Studio returned; a tile must point the grid at exactly those rows.
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgWidgetParams } from "ag-studio";
import { CapacityWidget } from "./CapacityWidget.tsx";
import type { CapacityWidgetState } from "./registry.ts";
import { createOperationsStore, type OperationsApi, type OperationsStore } from "../store.ts";
import { STUDIO_FIELDS, STUDIO_SOURCE_ID, studioRows, toViews } from "../view.ts";
import { capacity, row, snapshot, standardRows } from "../../test/operationsFixtures.ts";
import type { OperationsSnapshot, PaymentOperationRow } from "../contract.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function storeWith(first: OperationsSnapshot | Error) {
  const pending: Array<{ resolve: (value: OperationsSnapshot) => void; reject: (error: unknown) => void }> = [];
  const api: OperationsApi = {
    snapshot: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }); }),
    detail: () => Promise.reject(new Error("unused")),
    investigate: () => Promise.reject(new Error("unused")),
  };
  const store = createOperationsStore({ api, pollMs: 60_000 });
  store.start();
  if (first instanceof Error) pending[0].reject(first); else pending[0].resolve(first);
  await settle();
  return { store, pending };
}

/** Stand-in for Studio's widget API: returns the same shape as the real one (rows keyed by `source.field`). */
function fakeWidgetApi(rows: () => PaymentOperationRow[], options: { selected?: () => PaymentOperationRow[] | undefined; fail?: boolean } = {}) {
  const key = (id: string) => `${STUDIO_SOURCE_ID}.${id}`;
  const fields = STUDIO_FIELDS.map((definition) => ({ fieldId: key(definition.id), key: key(definition.id), name: definition.name, type: "column" }));
  const shape = (list: PaymentOperationRow[]) => ({ rows: studioRows(toViews(list)).map((entry) => Object.fromEntries(Object.entries(entry).map(([id, value]) => [key(id), value]))) });
  const api = {
    getSchema: vi.fn(() => [{ id: STUDIO_SOURCE_ID, name: "Payment operations", type: "table", fields }]),
    getData: vi.fn(async () => {
      if (options.fail) throw new Error("engine failure");
      const selected = options.selected?.();
      return { results: shape(rows()), crossFilter: selected ? shape(selected) : undefined };
    }),
    setDisplayState: vi.fn(),
    toggleCrossFilter: vi.fn(),
    resetCrossFilter: vi.fn(),
    getCrossFilterSelections: vi.fn(() => undefined),
  };
  return api;
}

function props(store: OperationsStore, widgetApi: ReturnType<typeof fakeWidgetApi>, style: CapacityWidgetState["format"] = { style: { showCalculation: false, includeDemonstration: true } }): AgWidgetParams<CapacityWidgetState> {
  return { widgetId: "capacity", widgetType: "settle-capacity", format: style, dataMapping: {}, sort: undefined, config: {} as never, widgetApi: widgetApi as never, api: {} as never, context: { store } };
}

describe("CapacityWidget", () => {
  it("shows the ledger's capacity figures, unchanged", async () => {
    const { store } = await storeWith(snapshot(standardRows()));
    render(<CapacityWidget {...props(store, fakeWidgetApi(standardRows))} />);
    const figures = await screen.findByRole("list", { name: "Capacity figures" });
    const figure = (label: string) => within(within(figures).getByText(label).closest("li")!).getByTestId("figure-value").textContent;
    expect(figure("Available budget")).toBe("$1,500.00");
    expect(figure("Rolling expenditure")).toBe("$95.00");
    expect(figure("Active exposure")).toBe("$19.00");
    expect(figure("Remaining capacity")).toBe("$1,386.00");
    const meter = screen.getByRole("img", { name: /of the \$1,500\.00 budget/ });
    expect(meter.getAttribute("aria-label")).toContain("$95.00 spent");
    expect(meter.getAttribute("aria-label")).toContain("$1,386.00 remaining");
    store.stop();
  });

  it("counts exceptions from the rows Studio returns and keeps demonstration money apart", async () => {
    const { store } = await storeWith(snapshot(standardRows()));
    render(<CapacityWidget {...props(store, fakeWidgetApi(standardRows))} />);
    const tile = async (label: string) => within(await screen.findByRole("button", { name: new RegExp(`^${label}`) }));
    expect((await tile("Pending obligations")).getByTestId("tile-count").textContent).toBe("4");
    expect((await tile("Pending obligations")).getByTestId("tile-amount").textContent).toBe("$109.00 operational");
    expect((await tile("Pending obligations")).getByText(/1 demonstration/)).toBeInTheDocument();
    expect((await tile("Awaiting approval")).getByTestId("tile-count").textContent).toBe("1");
    expect((await tile("Unreconciled")).getByTestId("tile-count").textContent).toBe("2");
    expect((await tile("Needs attention")).getByTestId("tile-count").textContent).toBe("2");
    store.stop();
  });

  it("a tile points the grid at exactly its rows and cross-filters Studio; a second press clears both", async () => {
    const user = userEvent.setup();
    const { store } = await storeWith(snapshot(standardRows()));
    const widgetApi = fakeWidgetApi(standardRows);
    render(<CapacityWidget {...props(store, widgetApi)} />);
    const tile = await screen.findByRole("button", { name: /^Unreconciled/ });
    await user.click(tile);
    expect(store.getState().focus).toMatchObject({ ids: ["workspace/confirmed", "workspace/unknown"], label: "Unreconciled", source: "widget" });
    expect(widgetApi.toggleCrossFilter).toHaveBeenCalledWith(expect.objectContaining({ type: "value", value: true, field: expect.objectContaining({ fieldId: "payments.isUnreconciled" }) }));
    expect(tile).toHaveAttribute("aria-pressed", "true");
    await user.click(tile);
    expect(store.getState().focus).toBeNull();
    expect(widgetApi.resetCrossFilter).toHaveBeenCalled();
    expect(tile).toHaveAttribute("aria-pressed", "false");
    store.stop();
  });

  it("releases its Studio cross-filter when the grid focus is cleared elsewhere", async () => {
    const user = userEvent.setup();
    const { store } = await storeWith(snapshot(standardRows()));
    const widgetApi = fakeWidgetApi(standardRows);
    render(<CapacityWidget {...props(store, widgetApi)} />);
    await user.click(await screen.findByRole("button", { name: /^Needs attention/ }));
    widgetApi.resetCrossFilter.mockClear();
    act(() => store.clearFocus());
    await waitFor(() => expect(widgetApi.resetCrossFilter).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /^Needs attention/ })).toHaveAttribute("aria-pressed", "false");
    store.stop();
  });

  it("can leave demonstration records out of the counts", async () => {
    const { store } = await storeWith(snapshot(standardRows()));
    render(<CapacityWidget {...props(store, fakeWidgetApi(standardRows), { style: { includeDemonstration: false } })} />);
    const tile = within(await screen.findByRole("button", { name: /^Pending obligations/ }));
    expect(tile.getByTestId("tile-count").textContent).toBe("3");
    expect(tile.queryByText(/demonstration/)).toBeNull();
    store.stop();
  });

  it("shows how many of a category are inside another widget's selection", async () => {
    const all = standardRows();
    const { store } = await storeWith(snapshot(all));
    render(<CapacityWidget {...props(store, fakeWidgetApi(() => all, { selected: () => all.filter((entry) => entry.operationId === "workspace/unknown") }))} />);
    const tile = within(await screen.findByRole("button", { name: /^Needs attention/ }));
    expect(tile.getByText("1 in the current selection")).toBeInTheDocument();
    store.stop();
  });

  it("reveals the calculation with each term, its definition and its source", async () => {
    const user = userEvent.setup();
    const { store } = await storeWith(snapshot(standardRows()));
    render(<CapacityWidget {...props(store, fakeWidgetApi(standardRows))} />);
    await user.click(await screen.findByRole("button", { name: "How this is calculated" }));
    const calculation = screen.getByRole("region", { name: "Calculation and sources" });
    expect(calculation).toHaveTextContent("remaining = budget − rolling expenditure − active exposure, never below zero");
    expect(calculation).toHaveTextContent("$1,500.00 − $95.00 − $19.00 = $1,386.00");
    for (const definition of ["budget definition", "rolling definition", "exposure definition", "remaining definition"]) expect(calculation).toHaveTextContent(definition);
    expect(calculation).toHaveTextContent("SQLite financial ledger (fixture)");
    expect(calculation).toHaveTextContent("policy version 2");
    store.stop();
  });

  it("follows the data: new figures and new counts after the ledger changes", async () => {
    const { store, pending } = await storeWith(snapshot(standardRows()));
    let rows = standardRows();
    const widgetApi = fakeWidgetApi(() => rows);
    const view = render(<CapacityWidget {...props(store, widgetApi)} />);
    await screen.findByRole("button", { name: /^Unreconciled/ });
    rows = standardRows().map((entry) => entry.operationId === "workspace/unknown" ? { ...entry, isUnreconciled: false, needsAttention: false } : entry);
    void store.refresh();
    pending[1].resolve(snapshot(rows, { capacity: { ...capacity, rollingSpendCents: 11400, activeExposureCents: 0, remainingCents: 138600 } }));
    await act(settle);
    // Studio refreshes a widget by rendering it again with new params.
    view.rerender(<CapacityWidget {...props(store, widgetApi)} />);
    await waitFor(() => expect(within(screen.getByRole("button", { name: /^Unreconciled/ })).getByTestId("tile-count").textContent).toBe("1"));
    expect(within(screen.getByText("Rolling expenditure").closest("li")!).getByTestId("figure-value").textContent).toBe("$114.00");
    store.stop();
  });

  it("states an empty workspace plainly", async () => {
    const { store } = await storeWith(snapshot([]));
    render(<CapacityWidget {...props(store, fakeWidgetApi(() => []))} />);
    expect(await screen.findByText("No payment obligation is recorded in this view yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Pending obligations/ })).toBeDisabled();
    store.stop();
  });

  it("flags stale reconciliation and an engaged emergency stop from the ledger", async () => {
    const { store } = await storeWith(snapshot(standardRows(), { capacity: { ...capacity, fresh: false, lastSuccessfulReconciliation: null, emergencyStop: true } }));
    render(<CapacityWidget {...props(store, fakeWidgetApi(standardRows))} />);
    expect(await screen.findByText(/Provider reconciliation is stale or has never run/)).toBeInTheDocument();
    expect(screen.getByText(/Emergency stop is engaged/)).toBeInTheDocument();
    store.stop();
  });

  it("reports an unavailable ledger instead of showing zeros", async () => {
    const { store } = await storeWith(new Error("HTTP 503"));
    render(<CapacityWidget {...props(store, fakeWidgetApi(() => []))} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/financial position is unavailable/i);
    expect(screen.queryByText("$0.00")).toBeNull();
    store.stop();
  });

  it("reports a failed exception query without hiding the capacity figures", async () => {
    const { store } = await storeWith(snapshot(standardRows()));
    render(<CapacityWidget {...props(store, fakeWidgetApi(standardRows, { fail: true }))} />);
    expect(await screen.findByText(/exception counts could not be read/i)).toBeInTheDocument();
    expect(screen.getByText("Remaining capacity")).toBeInTheDocument();
    store.stop();
  });

  it("uses a fixture row helper that stays in the contract", () => {
    expect(row().operationId).toBe("workspace/job-1");
  });
});
