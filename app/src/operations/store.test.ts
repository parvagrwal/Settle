// The operations store is the one place the grid, the Studio workspace, the
// capacity widget and the agent share state. These tests pin its behaviour
// under the conditions that broke the old dashboard: unmounts, late responses,
// concurrent requests and failures.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOperationsStore, type OperationsApi } from "./store.ts";
import { ContractError, type OperationsInvestigation, type OperationsSnapshot } from "./contract.ts";
import { investigation, row, snapshot, standardRows } from "../test/operationsFixtures.ts";

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void; signal: AbortSignal }

function fakeApi() {
  const snapshots: Deferred<OperationsSnapshot>[] = [];
  const investigations: Array<Deferred<OperationsInvestigation> & { question: string }> = [];
  const defer = <T,>(signal: AbortSignal): Deferred<T> => {
    let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    return { promise, resolve, reject, signal };
  };
  const api: OperationsApi = {
    snapshot: (signal) => { const entry = defer<OperationsSnapshot>(signal); snapshots.push(entry); return entry.promise; },
    investigate: (question, signal) => { const entry = { ...defer<OperationsInvestigation>(signal), question }; investigations.push(entry); return entry.promise; },
    detail: () => Promise.reject(new Error("not used in these tests")),
  };
  return { api, snapshots, investigations };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("operations store: loading", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }); });
  afterEach(() => { vi.useRealTimers(); });

  it("loads a snapshot, then keeps the same row objects when a poll brings no change", async () => {
    const { api, snapshots } = fakeApi();
    const store = createOperationsStore({ api, pollMs: 5000 });
    expect(store.getState().status).toBe("loading");
    store.start();
    const first = snapshot(standardRows());
    snapshots[0].resolve(first);
    await settle();
    expect(store.getState().status).toBe("ready");
    const rowsBefore = store.getState().snapshot?.rows;
    expect(rowsBefore).toBe(first.rows);

    vi.advanceTimersByTime(5000);
    expect(snapshots).toHaveLength(2);
    snapshots[1].resolve({ ...snapshot(standardRows()), generatedAt: "2026-11-10T12:00:05.000Z" });
    await settle();
    expect(store.getState().snapshot?.rows).toBe(rowsBefore);
    expect(store.getState().checkedAt).toBe("2026-11-10T12:00:05.000Z");

    vi.advanceTimersByTime(5000);
    const changed = snapshot(standardRows().map((entry) => entry.operationId === "workspace/ready" ? { ...entry, paymentStatus: "provider_confirmed" as const } : entry));
    snapshots[2].resolve(changed);
    await settle();
    expect(store.getState().snapshot?.rows).toBe(changed.rows);
    store.stop();
  });

  it("reports a first-load failure, and recovers on the next poll", async () => {
    const { api, snapshots } = fakeApi();
    const store = createOperationsStore({ api, pollMs: 5000 });
    store.start();
    snapshots[0].reject(new Error("HTTP 503"));
    await settle();
    expect(store.getState().status).toBe("error");
    expect(store.getState().loadError).toMatch(/could not be loaded/i);
    vi.advanceTimersByTime(5000);
    snapshots[1].resolve(snapshot(standardRows()));
    await settle();
    expect(store.getState().status).toBe("ready");
    expect(store.getState().loadError).toBeNull();
    store.stop();
  });

  it("keeps the last good data on screen when a later poll fails or returns a malformed response", async () => {
    const { api, snapshots } = fakeApi();
    const store = createOperationsStore({ api, pollMs: 5000 });
    store.start();
    snapshots[0].resolve(snapshot(standardRows()));
    await settle();
    vi.advanceTimersByTime(5000);
    snapshots[1].reject(new ContractError("snapshot.rows: expected a list of rows"));
    await settle();
    expect(store.getState().status).toBe("ready");
    expect(store.getState().snapshot?.rows).toHaveLength(6);
    expect(store.getState().loadError).toMatch(/last successful read/i);
    store.stop();
  });

  it("ignores a response that arrives after the store was stopped, and aborts the request", async () => {
    const { api, snapshots } = fakeApi();
    const store = createOperationsStore({ api, pollMs: 5000 });
    store.start();
    store.stop();
    expect(snapshots[0].signal.aborted).toBe(true);
    snapshots[0].resolve(snapshot(standardRows()));
    await settle();
    expect(store.getState().snapshot).toBeNull();
    vi.advanceTimersByTime(20_000);
    expect(snapshots).toHaveLength(1);
  });

  it("survives start, stop, start (React Strict Mode) with a single poller", async () => {
    const { api, snapshots } = fakeApi();
    const store = createOperationsStore({ api, pollMs: 5000 });
    store.start(); store.stop(); store.start();
    expect(snapshots).toHaveLength(2);
    snapshots[1].resolve(snapshot(standardRows()));
    await settle();
    expect(store.getState().status).toBe("ready");
    vi.advanceTimersByTime(5000);
    expect(snapshots).toHaveLength(3);
    store.stop();
  });

  it("never lets an older response overwrite a newer one", async () => {
    const { api, snapshots } = fakeApi();
    const store = createOperationsStore({ api, pollMs: 5000 });
    store.start();
    void store.refresh();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].signal.aborted).toBe(true);
    const newer = snapshot([row({ operationId: "workspace/newer" })]);
    snapshots[1].resolve(newer);
    await settle();
    snapshots[0].resolve(snapshot([row({ operationId: "workspace/older" })]));
    await settle();
    expect(store.getState().snapshot?.rows[0].operationId).toBe("workspace/newer");
    store.stop();
  });

  it("notifies subscribers only when state changes, and stops after unsubscribe", async () => {
    const { api, snapshots } = fakeApi();
    const store = createOperationsStore({ api, pollMs: 5000 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.start();
    snapshots[0].resolve(snapshot(standardRows()));
    await settle();
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
    store.clearFocus();
    store.focusPayments({ ids: ["workspace/failed"], label: "x", source: "widget" });
    expect(listener.mock.calls.length).toBe(calls);
    store.stop();
  });
});

async function ready(rows = standardRows()) {
  const fake = fakeApi();
  const store = createOperationsStore({ api: fake.api, pollMs: 60_000 });
  store.start();
  fake.snapshots[0].resolve(snapshot(rows));
  await settle();
  return { store, ...fake };
}

describe("operations store: grid focus", () => {
  it("focuses exactly the requested rows that exist, and reports the ones that do not", async () => {
    const { store } = await ready();
    const outcome = store.focusPayments({ ids: ["workspace/failed", "workspace/ghost", "workspace/unknown"], label: "Needs attention", source: "widget" });
    expect(outcome).toEqual({ applied: ["workspace/failed", "workspace/unknown"], unknown: ["workspace/ghost"] });
    expect(store.getState().focus).toMatchObject({ ids: ["workspace/failed", "workspace/unknown"], label: "Needs attention", source: "widget", droppedIds: ["workspace/ghost"] });
    store.stop();
  });

  it("applies no filter when none of the identifiers exist", async () => {
    const { store } = await ready();
    const outcome = store.focusPayments({ ids: ["workspace/ghost"], label: "Ghosts", source: "widget" });
    expect(outcome).toEqual({ applied: [], unknown: ["workspace/ghost"] });
    expect(store.getState().focus).toBeNull();
    store.stop();
  });

  it("clears the focus on request", async () => {
    const { store } = await ready();
    store.focusPayments({ ids: ["workspace/failed"], label: "Failed", source: "widget" });
    store.clearFocus();
    expect(store.getState().focus).toBeNull();
    store.stop();
  });

  it("drops focused rows that disappear from the data, and clears the focus when none are left", async () => {
    const { store, snapshots } = await ready();
    store.focusPayments({ ids: ["workspace/failed", "workspace/unknown"], label: "Needs attention", source: "widget" });
    void store.refresh();
    snapshots[1].resolve(snapshot(standardRows().filter((entry) => entry.operationId !== "workspace/failed")));
    await settle();
    expect(store.getState().focus?.ids).toEqual(["workspace/unknown"]);
    void store.refresh();
    snapshots[2].resolve(snapshot(standardRows().filter((entry) => !["workspace/failed", "workspace/unknown"].includes(entry.operationId))));
    await settle();
    expect(store.getState().focus).toBeNull();
    expect(store.getState().notice).toMatch(/no longer in the data/i);
    store.stop();
  });

  it("asks the grid to open one payment record", async () => {
    const { store } = await ready();
    expect(store.openPayment("workspace/ghost")).toBe(false);
    expect(store.getState().detailRequest).toBeNull();
    expect(store.openPayment("workspace/failed")).toBe(true);
    const first = store.getState().detailRequest;
    expect(first?.operationId).toBe("workspace/failed");
    store.openPayment("workspace/failed");
    expect(store.getState().detailRequest?.nonce).not.toBe(first?.nonce);
    store.stop();
  });

  it("mirrors Studio selections only for fields the grid knows, without touching an exact-row focus", async () => {
    const { store } = await ready();
    store.focusPayments({ ids: ["workspace/failed"], label: "Failed", source: "widget" });
    store.setStudioSelections([{ column: "paymentStatus", values: ["Failed"] }, { column: "notAColumn", values: ["x"] }, { column: "approvalState", values: [] }]);
    expect(store.getState().studioSelections).toEqual([{ column: "paymentStatus", values: ["Failed"] }]);
    expect(store.getState().focus?.ids).toEqual(["workspace/failed"]);
    const before = store.getState().studioSelections;
    store.setStudioSelections([{ column: "paymentStatus", values: ["Failed"] }]);
    expect(store.getState().studioSelections).toBe(before);
    store.stop();
  });
});

describe("operations store: investigation", () => {
  it("applies exactly the returned payment identifiers to the grid", async () => {
    const { store, investigations } = await ready();
    const pending = store.investigate("Which payments need attention?", "panel");
    expect(store.getState().investigation.status).toBe("running");
    investigations[0].resolve(investigation());
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: true, applied: ["workspace/unknown", "workspace/failed"], unknown: [] });
    const state = store.getState();
    expect(state.investigation.status).toBe("done");
    expect(state.investigation.result?.investigationId).toBe("inv_11111111-2222-4333-8444-555555555555");
    expect(state.focus).toMatchObject({ ids: ["workspace/unknown", "workspace/failed"], source: "investigation", label: "Needs attention", investigationId: "inv_11111111-2222-4333-8444-555555555555" });
    store.stop();
  });

  it("opens the payment when the investigation names exactly one", async () => {
    const { store, investigations } = await ready();
    const pending = store.investigate("Which payments remain unreconciled?", "panel");
    investigations[0].resolve(investigation({ intent: "unreconciled", findings: [{ id: "f", title: "t", detail: "d", severity: "critical", paymentIds: ["workspace/unknown"] }], paymentIds: ["workspace/unknown"], suggestedGridAction: { type: "open_payment", paymentId: "workspace/unknown", label: "Unreconciled" } }));
    await pending;
    expect(store.getState().focus?.ids).toEqual(["workspace/unknown"]);
    expect(store.getState().detailRequest?.operationId).toBe("workspace/unknown");
    store.stop();
  });

  it("drops identifiers that are not in the current data and says so; filters nothing when none exist", async () => {
    const { store, investigations } = await ready();
    const first = store.investigate("q one", "panel");
    investigations[0].resolve(investigation({ findings: [{ id: "f", title: "t", detail: "d", severity: "warning", paymentIds: ["workspace/failed", "workspace/ghost"] }], paymentIds: ["workspace/failed", "workspace/ghost"], suggestedGridAction: { type: "filter_payments", paymentIds: ["workspace/failed", "workspace/ghost"], label: "Mixed" } }));
    expect(await first).toMatchObject({ ok: true, applied: ["workspace/failed"], unknown: ["workspace/ghost"] });
    expect(store.getState().investigation.unknownIds).toEqual(["workspace/ghost"]);
    expect(store.getState().focus?.ids).toEqual(["workspace/failed"]);

    const second = store.investigate("q two", "panel");
    investigations[1].resolve(investigation({ findings: [{ id: "f", title: "t", detail: "d", severity: "warning", paymentIds: ["workspace/ghost"] }], paymentIds: ["workspace/ghost"], suggestedGridAction: { type: "open_payment", paymentId: "workspace/ghost", label: "Ghost" } }));
    expect(await second).toMatchObject({ ok: true, applied: [], unknown: ["workspace/ghost"] });
    expect(store.getState().focus).toBeNull();
    expect(store.getState().detailRequest).toBeNull();
    store.stop();
  });

  it("an empty result removes the previous investigation's filter but leaves a filter the user set another way", async () => {
    const { store, investigations } = await ready();
    const first = store.investigate("q", "panel");
    investigations[0].resolve(investigation());
    await first;
    const empty = investigation({ investigationId: "inv_22222222-2222-4333-8444-555555555555", findings: [], paymentIds: [], suggestedGridAction: { type: "none", reason: "No matching payment in the current data." } });
    const second = store.investigate("q", "panel");
    investigations[1].resolve(empty);
    expect(await second).toMatchObject({ ok: true, applied: [], unknown: [] });
    expect(store.getState().focus).toBeNull();

    store.focusPayments({ ids: ["workspace/ready"], label: "Ready", source: "widget" });
    const third = store.investigate("q", "panel");
    investigations[2].resolve(empty);
    await third;
    expect(store.getState().focus?.source).toBe("widget");
    store.stop();
  });

  it("only the latest of two concurrent questions is applied; the earlier request is aborted", async () => {
    const { store, investigations } = await ready();
    const first = store.investigate("first question", "panel");
    const second = store.investigate("second question", "panel");
    expect(investigations[0].signal.aborted).toBe(true);
    investigations[1].resolve(investigation({ question: "second question", findings: [{ id: "f", title: "t", detail: "d", severity: "info", paymentIds: ["workspace/ready"] }], paymentIds: ["workspace/ready"], suggestedGridAction: { type: "open_payment", paymentId: "workspace/ready", label: "Second" } }));
    investigations[0].resolve(investigation({ question: "first question" }));
    expect(await first).toEqual({ ok: false, superseded: true });
    expect(await second).toMatchObject({ ok: true, applied: ["workspace/ready"] });
    expect(store.getState().investigation.result?.question).toBe("second question");
    expect(store.getState().focus?.ids).toEqual(["workspace/ready"]);
    store.stop();
  });

  it("a failed request leaves the grid as it was, reports the failure and can be retried", async () => {
    const { store, investigations } = await ready();
    store.focusPayments({ ids: ["workspace/ready"], label: "Ready", source: "widget" });
    const failed = store.investigate("q", "panel");
    investigations[0].reject(new Error("HTTP 500"));
    expect(await failed).toMatchObject({ ok: false, superseded: false });
    expect(store.getState().investigation.status).toBe("error");
    expect(store.getState().investigation.error).toMatch(/could not be completed/i);
    expect(store.getState().focus?.ids).toEqual(["workspace/ready"]);
    const retry = store.investigate("q", "panel");
    investigations[1].resolve(investigation());
    expect(await retry).toMatchObject({ ok: true });
    expect(store.getState().investigation.status).toBe("done");
    expect(store.getState().investigation.error).toBeNull();
    store.stop();
  });

  it("refuses a response that breaks the contract and filters nothing", async () => {
    const { store, investigations } = await ready();
    const pending = store.investigate("q", "panel");
    investigations[0].reject(new ContractError("investigation.readOnly: expected true"));
    expect(await pending).toMatchObject({ ok: false, superseded: false });
    expect(store.getState().investigation.error).toMatch(/not in the expected form/i);
    expect(store.getState().focus).toBeNull();
    store.stop();
  });

  it("marks an investigation as computed on older data once the data changes", async () => {
    const { store, investigations, snapshots } = await ready();
    const pending = store.investigate("q", "panel");
    investigations[0].resolve(investigation({ dataVersion: store.getState().snapshot!.dataVersion }));
    await pending;
    expect(store.getState().investigation.dataChanged).toBe(false);
    void store.refresh();
    snapshots[1].resolve(snapshot(standardRows().map((entry) => entry.operationId === "workspace/failed" ? { ...entry, paymentStatus: "provider_confirmed" as const } : entry)));
    await settle();
    expect(store.getState().investigation.dataChanged).toBe(true);
    store.stop();
  });

  it("stopping the store aborts a running investigation and ignores its answer", async () => {
    const { store, investigations } = await ready();
    const pending = store.investigate("q", "panel");
    store.stop();
    expect(investigations[0].signal.aborted).toBe(true);
    expect(await pending).toEqual({ ok: false, superseded: true });
    expect(store.getState().focus).toBeNull();
  });

  it("clearing the investigation also removes the filter it applied", async () => {
    const { store, investigations } = await ready();
    const pending = store.investigate("q", "panel");
    investigations[0].resolve(investigation());
    await pending;
    store.clearInvestigation();
    expect(store.getState().investigation).toMatchObject({ status: "idle", result: null, error: null });
    expect(store.getState().focus).toBeNull();
    store.stop();
  });

  it("an investigation accepted from the Studio agent is applied only through its own id", async () => {
    const { store } = await ready();
    const result = investigation();
    store.acceptInvestigation(result, "studio-agent");
    expect(store.getState().investigation.result).toBe(result);
    expect(store.getState().focus).toBeNull();
    expect(store.applyInvestigation("inv_unknown", result.paymentIds)).toMatchObject({ ok: false });
    expect(store.applyInvestigation(result.investigationId, ["workspace/ready"])).toMatchObject({ ok: false });
    expect(store.applyInvestigation(result.investigationId, result.paymentIds)).toEqual({ ok: true, applied: ["workspace/unknown", "workspace/failed"], unknown: [] });
    expect(store.getState().focus?.investigationId).toBe(result.investigationId);
    store.stop();
  });
});
