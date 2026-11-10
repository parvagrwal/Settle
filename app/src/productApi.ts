export type WorkspaceKind = "demo" | "operational";
export type VerificationState = "synthetic" | "unverified" | "provider_response_received" | "provider_confirmed" | "reconciled" | "discrepancy_detected" | "verification_unavailable" | "historical_evidence_only";
export interface User { userId: string; displayName: string; email: string | null; authProvider: string }
export interface Workspace { workspaceId: string; name: string; kind: WorkspaceKind; providerEnvironment: string; owner: User | null; createdAt: string; updatedAt: string }
export interface Job { jobId: string; workspaceId: string; title: string; recipientName: string; recipientEmail: string; amountCents: number; currency: string; dueAt: string | null; priority: "high" | "normal" | "low"; approvalState: "not_approved" | "approved"; approvedBy: string | null; approvedAt: string | null; origin: string; providerEnvironment: string; sourceTimestamp: string | null; ingestedAt: string; createdAt: string; updatedAt: string }
export interface Decision { decisionId: string; workspaceId: string; status: string; summary: string; rationale: string; recommendedJobIds: string[]; origin: string; createdBy: string; createdAt: string }
export interface TimelineEvent { kind: string; label: string; state: "complete" | "missing" | "historical"; at: string | null; detail: string }
export interface Receipt { receiptId: string; workspaceId: string; jobId: string | null; paymentId: string | null; title: string; recipientName: string; recipientEmail: string | null; amountCents: number; currency: string; origin: string; providerEnvironment: string; verificationState: VerificationState; approvedBy: string | null; approvedAt: string | null; policyVersion: number | null; submittedAt: string | null; payoutBatchId: string | null; payoutItemId: string | null; transactionId: string | null; providerStatus: string | null; feeCents: number | null; providerTimestamp: string | null; ingestedAt: string | null; lastReconciledAt: string | null; reconciliationRunId: string | null; discrepancies: Record<string, unknown>[]; timeline: TimelineEvent[] }
export interface Snapshot {
  workspace: Workspace; jobs: Job[]; receipts: Receipt[]; decisions: Decision[];
  policy: { perPaymentCapCents: number; rollingCapCents: number; windowHours: number; approvalExpiryDays: number; updatedBy: string; updatedAt: string };
  audit: Array<{ sequence: number; actor_id: string; action: string; resource_id: string | null; reason: string; at: string }>;
  summary: { needsApproval: number; approved: number; pendingCents: number; receiptsNeedingVerification: number; financialPosition: null | { confirmedSpendCents: number; remainingCents: number; lastSuccessfulReconciliation: string | null; fresh: boolean } };
  capabilities: { canEdit: boolean; canApprove: boolean; canPay: boolean; canReconcile: boolean; canResetDemo: boolean };
  provider: { environment: string; configured: boolean }; provenanceNotice: string;
}
export interface Session { authenticated: boolean; user: User | null; workspaces: Workspace[] }
export interface ReceiptDetail { receipt: Receipt; job: Job | null; providerEvidence?: Record<string, unknown> | null; financialAudit: Array<Record<string, unknown>>; productAudit: Array<Record<string, unknown>> }

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    const error = new Error(body.error ?? `Request failed with HTTP ${response.status}`) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    try { error.payload = await response.clone().json(); } catch { /* no payload */ }
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const productApi = {
  session: () => request<Session>("/api/product/session"),
  workspace: (id: string) => request<Snapshot>(`/api/product/workspaces/${encodeURIComponent(id)}`),
  login: (token: string) => request<{ user: User; expiresAt: string }>("/api/product/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }),
  logout: () => request<void>("/api/product/auth/logout", { method: "POST" }),
  createWorkspace: (name: string) => request<{ workspace: Workspace }>("/api/product/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  createJob: (workspaceId: string, input: { title: string; recipientName: string; recipientEmail: string; amountCents: number; dueAt: string | null; priority: string }) => request<{ job: Job }>(`/api/product/workspaces/${workspaceId}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  recommend: (workspaceId: string) => request<{ decision: Decision }>(`/api/product/workspaces/${workspaceId}/recommend`, { method: "POST" }),
  approve: (workspaceId: string, jobId: string) => request<Snapshot>(`/api/product/workspaces/${workspaceId}/jobs/${jobId}/approve`, { method: "POST" }),
  pay: (workspaceId: string, jobId: string) => request<{ workspace: Snapshot }>(`/api/product/workspaces/${workspaceId}/jobs/${jobId}/pay`, { method: "POST" }),
  reconcile: (workspaceId: string) => request<{ workspace: Snapshot }>(`/api/product/workspaces/${workspaceId}/reconcile`, { method: "POST" }),
  policy: (workspaceId: string, input: { perPaymentCapCents: number; rollingCapCents: number }) => request<{ policy: Snapshot["policy"] }>(`/api/product/workspaces/${workspaceId}/policy`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
  resetDemo: () => request<Snapshot>("/api/product/workspaces/demo/reset", { method: "POST" }),
  receipt: (workspaceId: string, receiptId: string) => request<ReceiptDetail>(`/api/product/workspaces/${workspaceId}/receipts/${receiptId}`),
};
