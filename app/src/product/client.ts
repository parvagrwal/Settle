// The product's HTTP client.
//
// One place that talks to the server. Nothing here decides what a status means
// on screen beyond classifying it: the caller decides how to present it. The
// browser never holds a PayPal credential and never sends an owner identity in
// a request body — identity comes from the server-verified session cookie.
import { productApi, type ReceiptDetail, type Session, type Snapshot } from "../productApi.ts";
import { operationsApi } from "../operations/api.ts";
import { parseDetail, parseInvestigation, parseSnapshot, type OperationsInvestigation, type OperationsSnapshot, type PaymentOperationDetail } from "../operations/contract.ts";

export type { ReceiptDetail, Session, Snapshot };
export type { OperationsInvestigation, OperationsSnapshot, PaymentOperationDetail };

/** A failed request, with the server's own status and message kept intact. */
export class ProductRequestError extends Error {
  status: number;
  code: string | null;
  payload: unknown;

  constructor(message: string, status: number, code: string | null = null, payload: unknown = null) {
    super(message);
    this.name = "ProductRequestError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }

  /** True when the session is gone and the owner must sign in again. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** True when the server refused because of policy or a conflict, not a fault. */
  get isRefusal(): boolean {
    return this.status === 409 || this.status === 422 || this.status === 403;
  }

  /** True when the environment is not configured for this action. */
  get isNotConfigured(): boolean {
    return this.status === 503;
  }
}

/** A readable sentence for any failure, without inventing a cause. */
export function describeError(error: unknown, fallback = "The request could not be completed."): string {
  if (error instanceof ProductRequestError) {
    if (error.status === 401) return "Your session has expired. Sign in again to continue.";
    if (error.status === 403) return "You do not have permission to do that in this workspace.";
    if (error.status === 0) return "The server could not be reached. Check your connection and try again.";
    return error.message || fallback;
  }
  if (error instanceof TypeError) return "The server could not be reached. Check your connection and try again.";
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

type RequestOptions = { signal?: AbortSignal };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ProductRequestError("The server could not be reached.", 0, "NETWORK", null);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
    throw new ProductRequestError(body.error ?? `The request failed with HTTP ${response.status}.`, response.status, body.code ?? null, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface PayOutcome {
  status: string;
  batchStatus: string | null;
  payoutBatchId: string | null;
  confirmationScheduled: boolean;
  executionRunId: string | null;
  executionRunStatus: string | null;
  /** HTTP 202: the provider outcome is ambiguous. Never a success. */
  outcomeUnknown: boolean;
  workspace: Snapshot;
}

export const client = {
  session: () => request<Session>("/api/product/session"),
  workspace: (id: string, options: RequestOptions = {}) => request<Snapshot>(`/api/product/workspaces/${encodeURIComponent(id)}`, options.signal ? { signal: options.signal } : undefined),
  receipt: (workspaceId: string, receiptId: string) => request<ReceiptDetail>(`/api/product/workspaces/${encodeURIComponent(workspaceId)}/receipts/${encodeURIComponent(receiptId)}`),
  login: (token: string) => request<{ user: Session["user"]; expiresAt: string }>("/api/product/auth/login", { method: "POST", ...json({ token }) }),
  logout: () => request<void>("/api/product/auth/logout", { method: "POST" }),
  createWorkspace: (name: string) => request<{ workspace: Session["workspaces"][number] }>("/api/product/workspaces", { method: "POST", ...json({ name }) }),
  createJob: (workspaceId: string, input: { title: string; recipientName: string; recipientEmail: string; amountCents: number; dueAt: string | null; priority: "high" | "normal" | "low" }) => request<{ job: Snapshot["jobs"][number] }>(`/api/product/workspaces/${encodeURIComponent(workspaceId)}/jobs`, { method: "POST", ...json(input) }),
  recommend: (workspaceId: string) => request<{ decision: Snapshot["decisions"][number] }>(`/api/product/workspaces/${encodeURIComponent(workspaceId)}/recommend`, { method: "POST" }),
  approve: (workspaceId: string, jobId: string) => request<Snapshot>(`/api/product/workspaces/${encodeURIComponent(workspaceId)}/jobs/${encodeURIComponent(jobId)}/approve`, { method: "POST" }),
  decline: (workspaceId: string, jobId: string, reason: string) => request<Snapshot>(`/api/product/workspaces/${encodeURIComponent(workspaceId)}/jobs/${encodeURIComponent(jobId)}/reject`, { method: "POST", ...json({ reason }) }),
  pay: async (workspaceId: string, jobId: string): Promise<PayOutcome> => {
    // The pay route answers 202 when the provider outcome is ambiguous. That is
    // a real answer, not a failure, and it is never reported as a success.
    const body = await request<{
      error?: string; outcomeUnknown?: boolean; execution_run_id?: string; workspace: Snapshot;
      result?: { status?: string; batchStatus?: string | null; payoutBatchId?: string | null; confirmationScheduled?: boolean };
      execution_run?: { runId: string; status: string } | null;
    }>(`/api/product/workspaces/${encodeURIComponent(workspaceId)}/jobs/${encodeURIComponent(jobId)}/pay`, { method: "POST" });
    if (body.outcomeUnknown === true) {
      return {
        status: "outcome_unknown", batchStatus: null, payoutBatchId: null, confirmationScheduled: false,
        executionRunId: body.execution_run_id ?? null, executionRunStatus: null, outcomeUnknown: true,
        workspace: body.workspace,
      };
    }
    const run = body.execution_run ?? null;
    return {
      status: body.result?.status ?? "unknown",
      batchStatus: body.result?.batchStatus ?? null,
      payoutBatchId: body.result?.payoutBatchId ?? null,
      confirmationScheduled: body.result?.confirmationScheduled === true,
      executionRunId: run?.runId ?? null,
      executionRunStatus: run?.status ?? null,
      outcomeUnknown: false,
      workspace: body.workspace,
    };
  },
  control: (workspaceId: string, emergencyStop: boolean, reason: string) => request<Snapshot>(`/api/product/workspaces/${encodeURIComponent(workspaceId)}/control`, { method: "POST", ...json({ emergencyStop, reason }) }),
  reconcile: (workspaceId: string) => request<{ result: { batchesRead: number; itemsRecorded: number; failures: number }; workspace: Snapshot }>(`/api/product/workspaces/${encodeURIComponent(workspaceId)}/reconcile`, { method: "POST" }),
  confirm: (workspaceId: string) => request<{ sweep: { checked: number; confirmed: number; stillPending: number; errors: number }; workspace: Snapshot }>(`/api/product/workspaces/${encodeURIComponent(workspaceId)}/confirm`, { method: "POST" }),
  policy: (workspaceId: string, input: { perPaymentCapCents: number; rollingCapCents: number }) => request<{ policy: Snapshot["policy"] }>(`/api/product/workspaces/${encodeURIComponent(workspaceId)}/policy`, { method: "PUT", ...json(input) }),
  operations: async (options: RequestOptions = {}): Promise<OperationsSnapshot> => {
    const controller = new AbortController();
    if (options.signal) options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    return parseSnapshot(await operationsApi.snapshot(controller.signal));
  },
  operationDetail: async (operationId: string, options: RequestOptions = {}): Promise<PaymentOperationDetail> => {
    const controller = new AbortController();
    if (options.signal) options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    return parseDetail(await operationsApi.detail(operationId, controller.signal));
  },
  investigate: async (question: string, options: RequestOptions = {}): Promise<OperationsInvestigation> => {
    const controller = new AbortController();
    if (options.signal) options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    return parseInvestigation(await operationsApi.investigate(question, controller.signal));
  },
};

// `productApi` stays the module the repository already had, so the legacy
// surfaces keep working against the same contract.
export { productApi };
