// Shared operations state.
//
// One store feeds the operations grid, the AG Studio workspace, the capacity
// widget and the investigation agent, so they cannot disagree about what the
// data is or which rows are in focus. It is a plain external store read with
// `useSyncExternalStore`; no component owns it and no Grid or Studio API is
// kept in it.
//
// Rules:
// - every request can be aborted, and a response is applied only if it belongs
//   to the latest request of its kind and the store is still running;
// - a poll that brings no change keeps the existing snapshot object, so nothing
//   downstream re-renders;
// - a filter is only ever a list of exact row identifiers that exist in the
//   current data. Identifiers that do not exist are dropped and reported;
// - the store reads. It has no way to approve, pay or change anything.
import { useSyncExternalStore } from "react";
import { ContractError, matchToRows, type OperationsInvestigation, type OperationsSnapshot, type PaymentOperationDetail } from "./contract.ts";

export interface OperationsApi {
  snapshot(signal: AbortSignal): Promise<OperationsSnapshot>;
  detail(operationId: string, signal: AbortSignal): Promise<PaymentOperationDetail>;
  investigate(question: string, signal: AbortSignal): Promise<OperationsInvestigation>;
}

export type FocusSource = "investigation" | "widget";

export interface GridFocus {
  /** Exact row identifiers, all present in the current data. */
  ids: string[];
  label: string;
  source: FocusSource;
  investigationId: string | null;
  /** Identifiers that were requested but are not in the current data. */
  droppedIds: string[];
}

/** A Studio selection mirrored onto a grid column: the column shows only these values. */
export interface StudioSelection { column: string; values: string[] }

/** Grid columns a Studio selection may be mirrored onto. */
export const MIRRORED_COLUMNS: readonly string[] = ["paymentStatus", "approvalState", "verificationState", "reconciliationState", "recordClass", "recipient", "dueWindow", "source"];

export type InvestigationOrigin = "panel" | "studio-agent";

export interface InvestigationState {
  status: "idle" | "running" | "done" | "error";
  question: string;
  origin: InvestigationOrigin | null;
  result: OperationsInvestigation | null;
  error: string | null;
  /** Identifiers the result named that are not in the current data. */
  unknownIds: string[];
  /** True when the data has changed since the result was computed. */
  dataChanged: boolean;
}

export interface OperationsState {
  status: "loading" | "ready" | "error";
  snapshot: OperationsSnapshot | null;
  /** Server time of the most recent successful read, including reads that brought no change. */
  checkedAt: string | null;
  loadError: string | null;
  focus: GridFocus | null;
  studioSelections: StudioSelection[];
  investigation: InvestigationState;
  /** A request for the grid to open one record. The nonce makes a repeated request distinct. */
  detailRequest: { operationId: string; nonce: number } | null;
  notice: string | null;
}

export type InvestigationOutcome =
  | { ok: true; result: OperationsInvestigation; applied: string[]; unknown: string[] }
  | { ok: false; superseded: true }
  | { ok: false; superseded: false; error: string };

export type ApplyOutcome = { ok: true; applied: string[]; unknown: string[] } | { ok: false; error: string };

export interface OperationsStore {
  getState(): OperationsState;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  focusPayments(request: { ids: readonly string[]; label: string; source: FocusSource; investigationId?: string | null }): { applied: string[]; unknown: string[] };
  clearFocus(): void;
  setStudioSelections(selections: StudioSelection[]): void;
  openPayment(operationId: string): boolean;
  investigate(question: string, origin: InvestigationOrigin): Promise<InvestigationOutcome>;
  /** Record a validated investigation without filtering (the Studio agent applies it through its tool call). */
  acceptInvestigation(result: OperationsInvestigation, origin: InvestigationOrigin): void;
  /** Filter the grid to an accepted investigation's rows. Refused for an unknown investigation or foreign identifiers. */
  applyInvestigation(investigationId: string, paymentIds: readonly string[]): ApplyOutcome;
  clearInvestigation(): void;
  dismissNotice(): void;
  readonly api: OperationsApi;
}

const IDLE_INVESTIGATION: InvestigationState = { status: "idle", question: "", origin: null, result: null, error: null, unknownIds: [], dataChanged: false };

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function sameSelections(a: StudioSelection[], b: StudioSelection[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry.column === b[index].column && entry.values.length === b[index].values.length && entry.values.every((value, position) => value === b[index].values[position]));
}

export function createOperationsStore(options: { api: OperationsApi; pollMs?: number }): OperationsStore {
  const { api } = options;
  const pollMs = options.pollMs ?? 5000;
  let state: OperationsState = { status: "loading", snapshot: null, checkedAt: null, loadError: null, focus: null, studioSelections: [], investigation: IDLE_INVESTIGATION, detailRequest: null, notice: null };
  const listeners = new Set<() => void>();
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loadController: AbortController | null = null;
  let loadSequence = 0;
  let investigationController: AbortController | null = null;
  let investigationSequence = 0;
  let nonce = 0;

  const set = (patch: Partial<OperationsState>): void => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const rows = () => state.snapshot?.rows ?? [];

  const refresh = async (): Promise<void> => {
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const sequence = ++loadSequence;
    try {
      const next = await api.snapshot(controller.signal);
      if (!running || controller.signal.aborted || sequence !== loadSequence) return;
      if (state.snapshot && state.snapshot.dataVersion === next.dataVersion) {
        // Nothing changed: keep the existing objects so the grid and Studio are not touched.
        set({ status: "ready", checkedAt: next.generatedAt, loadError: null });
        return;
      }
      const patch: Partial<OperationsState> = { status: "ready", snapshot: next, checkedAt: next.generatedAt, loadError: null };
      if (state.focus) {
        const { known } = matchToRows(state.focus.ids, next.rows);
        if (known.length === 0) {
          patch.focus = null;
          patch.notice = `The ${state.focus.label} filter was removed: its records are no longer in the data.`;
        } else if (known.length !== state.focus.ids.length) {
          patch.focus = { ...state.focus, ids: known };
        }
      }
      if (state.investigation.result) {
        patch.investigation = { ...state.investigation, dataChanged: state.investigation.result.dataVersion !== next.dataVersion };
      }
      set(patch);
    } catch (error) {
      if (isAbort(error) || !running || controller.signal.aborted || sequence !== loadSequence) return;
      const reason = error instanceof ContractError ? "the server response was not in the expected form" : "the server could not be reached";
      if (state.snapshot) {
        set({ loadError: `Showing the last successful read (${state.checkedAt ?? "time unknown"}); the latest refresh failed because ${reason}.` });
      } else {
        set({ status: "error", loadError: `Payment operations could not be loaded: ${reason}. Retrying automatically.` });
      }
    }
  };

  const focusPayments: OperationsStore["focusPayments"] = (request) => {
    const { known, unknown } = matchToRows([...new Set(request.ids)], rows());
    if (known.length === 0) {
      if (state.focus && state.focus.source === request.source) set({ focus: null });
      return { applied: [], unknown };
    }
    set({ focus: { ids: known, label: request.label, source: request.source, investigationId: request.investigationId ?? null, droppedIds: unknown }, notice: null });
    return { applied: known, unknown };
  };

  const openPayment = (operationId: string): boolean => {
    if (!rows().some((row) => row.operationId === operationId)) return false;
    set({ detailRequest: { operationId, nonce: ++nonce } });
    return true;
  };

  /** Apply a validated result's suggested action. Only exact identifiers are ever used. */
  const applyResult = (result: OperationsInvestigation): { applied: string[]; unknown: string[] } => {
    const action = result.suggestedGridAction;
    const requested = action.type === "filter_payments" ? action.paymentIds : action.type === "open_payment" ? [action.paymentId] : [];
    if (requested.length === 0) {
      // No rows to show: remove a filter left by an earlier investigation, keep one the user set otherwise.
      if (state.focus?.source === "investigation") set({ focus: null });
      return { applied: [], unknown: matchToRows(result.paymentIds, rows()).unknown };
    }
    const label = action.type === "none" ? "" : action.label;
    const outcome = focusPayments({ ids: requested, label, source: "investigation", investigationId: result.investigationId });
    if (action.type === "open_payment" && outcome.applied.length === 1) openPayment(outcome.applied[0]);
    return { applied: outcome.applied, unknown: matchToRows(result.paymentIds, rows()).unknown };
  };

  const investigate: OperationsStore["investigate"] = async (question, origin) => {
    investigationController?.abort();
    const controller = new AbortController();
    investigationController = controller;
    const sequence = ++investigationSequence;
    set({ investigation: { ...state.investigation, status: "running", question, origin, error: null } });
    try {
      const result = await api.investigate(question, controller.signal);
      if (!running || controller.signal.aborted || sequence !== investigationSequence) return { ok: false, superseded: true };
      set({ investigation: { status: "done", question, origin, result, error: null, unknownIds: matchToRows(result.paymentIds, rows()).unknown, dataChanged: state.snapshot ? result.dataVersion !== state.snapshot.dataVersion : false } });
      const outcome = applyResult(result);
      return { ok: true, result, applied: outcome.applied, unknown: outcome.unknown };
    } catch (error) {
      if (isAbort(error) || !running || controller.signal.aborted || sequence !== investigationSequence) return { ok: false, superseded: true };
      const message = error instanceof ContractError
        ? "The investigation response was not in the expected form, so it was not used. The grid was not changed."
        : "The investigation could not be completed. The grid was not changed. Try again.";
      set({ investigation: { ...state.investigation, status: "error", question, origin, error: message } });
      return { ok: false, superseded: false, error: message };
    }
  };

  return {
    api,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (running) return;
      running = true;
      void refresh();
      timer = setInterval(() => { void refresh(); }, pollMs);
    },
    stop() {
      running = false;
      if (timer !== null) clearInterval(timer);
      timer = null;
      loadController?.abort();
      investigationController?.abort();
    },
    refresh,
    focusPayments,
    clearFocus() {
      if (state.focus) set({ focus: null });
    },
    setStudioSelections(selections) {
      const next = selections.filter((entry) => MIRRORED_COLUMNS.includes(entry.column) && entry.values.length > 0);
      if (!sameSelections(state.studioSelections, next)) set({ studioSelections: next });
    },
    openPayment,
    investigate,
    acceptInvestigation(result, origin) {
      investigationController?.abort();
      investigationSequence += 1;
      set({ investigation: { status: "done", question: result.question, origin, result, error: null, unknownIds: matchToRows(result.paymentIds, rows()).unknown, dataChanged: state.snapshot ? result.dataVersion !== state.snapshot.dataVersion : false } });
    },
    applyInvestigation(investigationId, paymentIds) {
      const result = state.investigation.result;
      if (!result || result.investigationId !== investigationId) return { ok: false, error: "No accepted investigation has that id, so nothing was filtered." };
      const allowed = new Set(result.paymentIds);
      if (paymentIds.length === 0 || paymentIds.some((id) => !allowed.has(id))) return { ok: false, error: "The identifiers are not the ones that investigation returned, so nothing was filtered." };
      const outcome = focusPayments({ ids: paymentIds, label: result.suggestedGridAction.type === "none" ? "Investigation" : result.suggestedGridAction.label, source: "investigation", investigationId });
      if (outcome.applied.length === 1 && result.suggestedGridAction.type === "open_payment") openPayment(outcome.applied[0]);
      return { ok: true, applied: outcome.applied, unknown: outcome.unknown };
    },
    clearInvestigation() {
      investigationController?.abort();
      investigationSequence += 1;
      set({ investigation: IDLE_INVESTIGATION, focus: state.focus?.source === "investigation" ? null : state.focus });
    },
    dismissNotice() {
      if (state.notice) set({ notice: null });
    },
  };
}

/** Subscribe a component to one slice of the store. The selector must return a stable value for unchanged state. */
export function useOperations<T>(store: OperationsStore, selector: (state: OperationsState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
