// The workspace context.
//
// One place holds the session, the active workspace, the product snapshot and
// the unified operations projection. Every screen reads from it, so no screen
// can disagree with another about what the ledger says.
//
// Rules:
// - Identity comes from the server-verified session. The browser never sends an
//   owner id, and the provider secret never reaches it.
// - A failed refresh keeps the last good data on screen and says so, rather
//   than blanking the workspace.
// - Demonstration records are always separated from operational ones. They are
//   never added to an operational total.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { client, describeError, ProductRequestError } from "./client.ts";
import type { Session, Snapshot, Workspace } from "../productApi.ts";
import type { OperationsSnapshot } from "../operations/contract.ts";

export type { Session, Snapshot, Workspace, OperationsSnapshot };

export interface WorkspaceContextValue {
  /** "loading" until the first session read completes. */
  sessionStatus: "loading" | "ready" | "error";
  session: Session | null;
  sessionError: string | null;
  /** The workspace the screens are showing. */
  workspaceId: string | null;
  workspace: Workspace | null;
  snapshot: Snapshot | null;
  operations: OperationsSnapshot | null;
  dataStatus: "loading" | "ready" | "error";
  dataError: string | null;
  /** Server time of the last successful read. */
  checkedAt: string | null;
  /** True when the last read failed but older data is still on screen. */
  stale: boolean;
  refresh: () => Promise<void>;
  selectWorkspace: (workspaceId: string) => void;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Replace the snapshot after a write so the screen shows the server's answer. */
  applySnapshot: (snapshot: Snapshot) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const POLL_MS = 10_000;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [sessionStatus, setSessionStatus] = useState<"loading" | "ready" | "error">("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [operations, setOperations] = useState<OperationsSnapshot | null>(null);
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [dataError, setDataError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  // Whether any data has been loaded. A ref, so a refresh does not re-trigger itself.
  const hasData = useRef(false);

  const loadSession = useCallback(async () => {
    try {
      const next = await client.session();
      setSession(next);
      setSessionError(null);
      setSessionStatus("ready");
      setWorkspaceId((current) => {
        if (current && next.workspaces.some((workspace) => workspace.workspaceId === current)) return current;
        const operational = next.workspaces.find((workspace) => workspace.kind === "operational");
        return operational?.workspaceId ?? next.workspaces[0]?.workspaceId ?? null;
      });
    } catch (error) {
      setSessionError(describeError(error, "The session could not be read."));
      setSessionStatus("error");
    }
  }, []);

  const loadData = useCallback(async (target: string | null) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    if (target === null) {
      hasData.current = false;
      setSnapshot(null);
      setOperations(null);
      setDataStatus("ready");
      setCheckedAt(null);
      return;
    }
    try {
      const [nextSnapshot, nextOperations] = await Promise.all([
        client.workspace(target, { signal: controller.signal }),
        client.operations({ signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      hasData.current = true;
      setSnapshot(nextSnapshot);
      setOperations(nextOperations);
      setDataError(null);
      setStale(false);
      setDataStatus("ready");
      setCheckedAt(nextOperations.generatedAt);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof ProductRequestError && error.status === 401) {
        // The session is gone. Clear the workspace and ask for sign-in.
        hasData.current = false;
        setSnapshot(null);
        setOperations(null);
        setSession((current) => (current ? { ...current, authenticated: false, user: null } : current));
        setSessionError("Your session has expired. Sign in again to continue.");
        return;
      }
      setDataError(describeError(error, "The workspace could not be read."));
      setDataStatus(hasData.current ? "ready" : "error");
      setStale(hasData.current);
    }
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => { void loadData(workspaceId); }, [workspaceId, loadData]);

  // A background refresh keeps the command centre current without a reload.
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (workspaceId === null) return;
      void loadData(workspaceId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [workspaceId, loadData]);

  const refresh = useCallback(async () => {
    await loadSession();
    await loadData(workspaceId);
  }, [loadSession, loadData, workspaceId]);

  const signIn = useCallback(async (token: string) => {
    await client.login(token);
    await loadSession();
  }, [loadSession]);

  const signOut = useCallback(async () => {
    await client.logout();
    setSession((current) => (current ? { ...current, authenticated: false, user: null } : current));
    setWorkspaceId(null);
    hasData.current = false;
    setSnapshot(null);
    setOperations(null);
    await loadSession();
  }, [loadSession]);

  const selectWorkspace = useCallback((next: string) => { setWorkspaceId(next); }, []);

  const applySnapshot = useCallback((next: Snapshot) => {
    hasData.current = true;
    setSnapshot(next);
    // The unified projection carries the approval and execution state too, so it
    // is read again rather than patched in the browser.
    if (next.workspace.workspaceId !== null) void loadData(next.workspace.workspaceId);
  }, [loadData]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    sessionStatus, session, sessionError, workspaceId,
    workspace: snapshot?.workspace ?? session?.workspaces.find((entry) => entry.workspaceId === workspaceId) ?? null,
    snapshot, operations, dataStatus, dataError, checkedAt, stale,
    refresh, selectWorkspace, signIn, signOut, applySnapshot,
  }), [sessionStatus, session, sessionError, workspaceId, snapshot, operations, dataStatus, dataError, checkedAt, stale, refresh, selectWorkspace, signIn, signOut, applySnapshot]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (value === null) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return value;
}
