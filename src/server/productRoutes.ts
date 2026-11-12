import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { ProductPermissionError, ProductStore, type ProductUser, type VerificationState } from "./productStore.ts";
import { extractPayoutItemFeeCents, type FinancialStore } from "./financialStore.ts";
import { verifyOwnerToken } from "./ownerAuth.ts";
import { deriveVerificationState } from "./verificationState.ts";
import { confirmDuePayments, publicBatchStatus, reconcilePayPal, submitApprovedPayment } from "./financialPayments.ts";
import { DEFAULT_CONFIRMATION_POLICY } from "./paymentState.ts";
import type { FetchFn } from "./paypalClient.ts";
import { refuseIfLimited, type RateLimiter } from "./rateLimit.ts";
import { securityHeaders } from "./httpSecurity.ts";

const SESSION_COOKIE = "settle_session";
type Context = {
  productStore?: ProductStore; financialStore: FinancialStore; baseUrl?: string; token?: string;
  refreshToken?: () => Promise<string>; fetchFn?: FetchFn; limiter?: RateLimiter;
};
/** Secure cookie attribute when the deployment serves HTTPS (behind a proxy
 * that sets x-forwarded-proto, or forced by SETTLE_SECURE_COOKIES=1). */
function cookieSecurity(req: IncomingMessage): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const https = process.env.SETTLE_SECURE_COOKIES === "1" || (typeof forwardedProto === "string" && forwardedProto.split(",")[0].trim() === "https");
  return https ? "; Secure" : "";
}
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...securityHeaders(), ...headers }); res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const b = chunk as Buffer; size += b.length; if (size > 65536) throw new Error("request body too large"); chunks.push(b); }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request body must be a JSON object");
  return parsed as Record<string, unknown>;
}
function sessionToken(req: IncomingMessage): string | null {
  const cookies = req.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) { const [key, ...rest] = cookie.trim().split("="); if (key === SESSION_COOKIE) return decodeURIComponent(rest.join("=")); }
  return null;
}
/** The server-verified product user for this request, or null. Identity never comes from the request body. */
export function userFor(req: IncomingMessage, store: ProductStore): ProductUser | null { return store.getUserBySession(sessionToken(req)); }
function recipientId(email: string): string { return `recipient-${createHash("sha256").update(email).digest("hex").slice(0, 24)}`; }
function feeFromRaw(raw: unknown): number | null {
  return extractPayoutItemFeeCents(raw);
}

export function productSnapshot(store: ProductStore, financial: FinancialStore, workspaceId: string, user: ProductUser | null, providerConfigured: boolean) {
  const workspace = store.getWorkspace(workspaceId, user?.userId ?? null);
  if (workspace.kind === "operational") {
    for (const receipt of store.listReceipts(workspaceId, user!.userId)) {
      if (!receipt.jobId) continue;
      const payment = financial.getPaymentByJob(receipt.jobId);
      if (!payment) continue;
      const item = financial.getPayoutItem(payment.paymentId);
      const discrepancies = financial.getDiscrepancies().filter((row) => row.payment_id === payment.paymentId);
      const verificationState: VerificationState = deriveVerificationState({
        paymentStatus: payment.status, hasProviderItem: item !== null,
        lastReconciledAt: item?.lastReconciledAt ?? null, discrepancyCount: discrepancies.length,
      });
      store.syncPaymentEvidence({ workspaceId, paymentId: payment.paymentId, verificationState, submittedAt: payment.submittedAt,
        policyVersion: payment.policyVersion, payoutBatchId: item?.payoutBatchId ?? null, payoutItemId: item?.payoutItemId ?? null,
        transactionId: item?.transactionId ?? null, providerStatus: item?.status ?? null, feeCents: feeFromRaw(item?.raw),
        providerTimestamp: item?.providerTimestamp ?? null, ingestedAt: item?.ingestedAt ?? null,
        lastReconciledAt: item?.lastReconciledAt ?? null, reconciliationRunId: item?.reconciliationRunId ?? null, discrepancies });
    }
  }
  const jobs = store.listJobs(workspaceId, user?.userId ?? null);
  const receipts = store.listReceipts(workspaceId, user?.userId ?? null);
  const policy = store.getPolicy(workspaceId, user?.userId ?? null);
  const isOwner = workspace.kind === "operational" && workspace.owner?.userId === user?.userId;
  const cap = workspace.kind === "operational" ? financial.getCapSummary(new Date().toISOString()) : null;
  const control = financial.getControlState();
  const fees = workspace.kind === "operational"
    ? receipts.flatMap((receipt) => {
        if (!receipt.paymentId) return [];
        const record = financial.getFeeRecord(receipt.paymentId);
        return [{ jobId: receipt.jobId, paymentId: receipt.paymentId, estimate: record.estimate, provider: record.provider, consistent: record.consistent, explanation: record.explanation }];
      })
    : [];
  return {
    workspace, jobs, receipts, decisions: store.listDecisions(workspaceId, user?.userId ?? null), policy,
    audit: store.listAudit(workspaceId, user?.userId ?? null),
    summary: {
      needsApproval: jobs.filter((job) => job.approvalState === "not_approved").length,
      approved: jobs.filter((job) => job.approvalState === "approved").length,
      pendingCents: jobs.filter((job) => !receipts.some((receipt) => receipt.jobId === job.jobId && ["provider_confirmed", "reconciled"].includes(receipt.verificationState))).reduce((sum, job) => sum + job.amountCents, 0),
      receiptsNeedingVerification: receipts.filter((receipt) => !["reconciled", "synthetic"].includes(receipt.verificationState)).length,
      financialPosition: cap ? { confirmedSpendCents: cap.confirmedSpendCents, remainingCents: cap.remainingCents, lastSuccessfulReconciliation: cap.lastSuccessfulReconciliation, fresh: cap.fresh } : null,
    },
    fees,
    control,
    capabilities: {
      canEdit: isOwner, canApprove: isOwner, canReject: isOwner, canPay: isOwner && providerConfigured && !control.emergencyStop,
      canReconcile: isOwner && providerConfigured, canControl: isOwner,
      canResetDemo: workspace.kind === "demo" && user !== null,
    },
    provider: { environment: workspace.kind === "demo" ? "none" : "sandbox", configured: workspace.kind === "demo" ? false : providerConfigured },
    provenanceNotice: workspace.kind === "demo" ? "Illustrative workspace · synthetic jobs · no real money or operational ledger activity" : "Operational workspace · application records and PayPal Sandbox evidence remain separately identified",
  };
}

/** Product API. All owner and workspace identity comes from the persisted,
 * server-verified session; the request body never supplies an owner ID. */
export async function handleProductRoute(req: IncomingMessage, res: ServerResponse, path: string, ctx: Context): Promise<boolean> {
  if (!path.startsWith("/api/product/")) return false;
  const store = ctx.productStore;
  if (!store) { send(res, 503, { error: "product workspace store is not configured" }); return true; }
  try {
    const user = userFor(req, store);
    if (req.method === "GET" && path === "/api/product/session") {
      send(res, 200, user ? { authenticated: true, user, workspaces: store.listWorkspaces(user.userId) } : { authenticated: false, user: null, workspaces: store.listWorkspaces(null) }); return true;
    }
    if (req.method === "POST" && path === "/api/product/auth/login") {
      if (ctx.limiter && refuseIfLimited({ limiter: ctx.limiter, bucket: "login", req, res })) return true;
      const input = await body(req); const token = typeof input.token === "string" ? input.token : null;
      const verified = verifyOwnerToken(token);
      if (!verified.ok) { send(res, verified.status, { error: verified.error }); return true; }
      const displayName = (process.env.SETTLE_OWNER_NAME ?? "").trim() || "Workspace owner";
      const configuredEmail = (process.env.SETTLE_OWNER_EMAIL ?? "").trim();
      const login = store.createOwnerSession({ displayName, email: configuredEmail || null }, new Date().toISOString(), 12 * 60 * 60 * 1000);
      send(res, 200, { user: login.user, expiresAt: login.expiresAt }, { "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(login.sessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${cookieSecurity(req)}` }); return true;
    }
    if (req.method === "POST" && path === "/api/product/auth/logout") {
      store.deleteSession(sessionToken(req));
      res.writeHead(204, { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cookieSecurity(req)}` }); res.end(); return true;
    }
    if (req.method === "POST" && path === "/api/product/workspaces") {
      if (!user) { send(res, 401, { error: "owner sign-in is required" }); return true; }
      const input = await body(req);
      if (typeof input.name !== "string") { send(res, 400, { error: "studio name is required" }); return true; }
      const workspace = store.createOperationalWorkspace(user.userId, input.name, new Date().toISOString());
      send(res, 201, { workspace }); return true;
    }
    const workspaceMatch = path.match(/^\/api\/product\/workspaces\/([^/]+)(.*)$/);
    if (!workspaceMatch) { send(res, 404, { error: "product route not found" }); return true; }
    const workspaceId = decodeURIComponent(workspaceMatch[1]);
    const rest = workspaceMatch[2];
    const providerConfigured = ctx.baseUrl !== undefined && ctx.token !== undefined;
    if (req.method === "GET" && rest === "") {
      if (workspaceId === "operational" && !user) { send(res, 401, { error: "owner sign-in is required for an operational workspace" }); return true; }
      send(res, 200, productSnapshot(store, ctx.financialStore, workspaceId, user, providerConfigured)); return true;
    }
    if (req.method === "POST" && rest === "/reset" && workspaceId === "demo") {
      if (!user) { send(res, 401, { error: "owner sign-in is required to reset the demonstration" }); return true; }
      store.resetDemo(user.userId, new Date().toISOString());
      send(res, 200, productSnapshot(store, ctx.financialStore, workspaceId, user, providerConfigured)); return true;
    }
    if (req.method === "POST" && rest === "/recommend") {
      // A product decision is a write: it requires a server-verified session
      // even in the demonstration workspace, and it is rate limited, so an
      // anonymous caller cannot flood the decision history.
      if (!user) { send(res, 401, { error: "owner sign-in is required to generate a recommendation" }); return true; }
      if (ctx.limiter && refuseIfLimited({ limiter: ctx.limiter, bucket: "recommend", req, res })) return true;
      const decision = store.createRecommendation(workspaceId, user?.userId ?? null, new Date().toISOString());
      send(res, 201, { decision }); return true;
    }
    if (req.method === "POST" && rest === "/jobs") {
      if (!user) { send(res, 401, { error: "owner sign-in is required" }); return true; }
      const input = await body(req);
      const validStrings = ["title", "recipientName", "recipientEmail"].every((key) => typeof input[key] === "string");
      if (!validStrings || !Number.isSafeInteger(input.amountCents) || !["high", "normal", "low"].includes(String(input.priority))) { send(res, 400, { error: "title, recipient, positive integer amount and valid priority are required" }); return true; }
      const job = store.createJob(workspaceId, user.userId, { title: String(input.title), recipientName: String(input.recipientName), recipientEmail: String(input.recipientEmail), amountCents: Number(input.amountCents), dueAt: typeof input.dueAt === "string" && input.dueAt ? input.dueAt : null, priority: input.priority as "high" | "normal" | "low" }, new Date().toISOString());
      send(res, 201, { job }); return true;
    }
    const rejectMatch = rest.match(/^\/jobs\/([^/]+)\/reject$/);
    if (req.method === "POST" && rejectMatch) {
      if (!user) { send(res, 401, { error: "owner sign-in is required" }); return true; }
      const input = await body(req);
      const reason = typeof input.reason === "string" ? input.reason : "";
      store.rejectJob(workspaceId, decodeURIComponent(rejectMatch[1]), user.userId, reason, new Date().toISOString());
      send(res, 200, productSnapshot(store, ctx.financialStore, workspaceId, user, providerConfigured)); return true;
    }
    const approveMatch = rest.match(/^\/jobs\/([^/]+)\/approve$/);
    if (req.method === "POST" && approveMatch) {
      if (!user) { send(res, 401, { error: "owner sign-in is required" }); return true; }
      const jobId = decodeURIComponent(approveMatch[1]);
      const job = store.getJob(workspaceId, jobId, user.userId);
      // This call rejects demo workspaces before any recipient or payment
      // identity can be created in the operational financial store.
      store.getWorkspace(workspaceId, user.userId);
      if (store.getWorkspace(workspaceId, user.userId).kind !== "operational") throw new ProductPermissionError(409, "this action requires an operational workspace; demonstration records cannot enter the financial ledger");
      const id = recipientId(job.recipientEmail); const at = new Date().toISOString();
      if (!ctx.financialStore.getRecipient(id)) ctx.financialStore.verifyRecipient({ recipientId: id, email: job.recipientEmail, actor: { actorId: user.userId, role: "owner" }, at });
      if (!ctx.financialStore.getPaymentByJob(jobId)) ctx.financialStore.approvePayment({ jobId, recipientId: id, requestedRecipientEmail: job.recipientEmail, amountCents: job.amountCents, currency: "USD", actor: { actorId: user.userId, role: "owner" }, at });
      store.approveJob(workspaceId, jobId, user.userId, at);
      const approvedPayment = ctx.financialStore.getPaymentByJob(jobId)!;
      store.linkPayment(workspaceId, jobId, approvedPayment.paymentId, user.userId, at);
      store.syncPaymentEvidence({ workspaceId, paymentId: approvedPayment.paymentId, verificationState: "unverified", submittedAt: approvedPayment.submittedAt, policyVersion: approvedPayment.policyVersion, payoutBatchId: null, payoutItemId: null, transactionId: null, providerStatus: null, feeCents: null, providerTimestamp: null, ingestedAt: at, lastReconciledAt: null, reconciliationRunId: null });
      send(res, 200, productSnapshot(store, ctx.financialStore, workspaceId, user, providerConfigured)); return true;
    }
    const payMatch = rest.match(/^\/jobs\/([^/]+)\/pay$/);
    if (req.method === "POST" && payMatch) {
      if (!user) { send(res, 401, { error: "owner sign-in is required" }); return true; }
      if (store.getWorkspace(workspaceId, user.userId).kind !== "operational") throw new ProductPermissionError(409, "this action requires an operational workspace; demonstration records cannot enter the financial ledger");
      if (!providerConfigured) { send(res, 503, { error: "PayPal Sandbox is not configured; no payment was submitted" }); return true; }
      const jobId = decodeURIComponent(payMatch[1]);
      // One run per owner action, before any provider call, so a lost response
      // still leaves a durable id to refer to.
      const run = ctx.financialStore.createExecutionRun({
        kind: "product",
        requestedBy: user.userId,
        actorRole: "owner",
        policyVersion: ctx.financialStore.getPolicy().version,
        at: new Date().toISOString(),
        note: `workspace ${workspaceId}, job ${jobId}`,
      });
      try {
        const result = await submitApprovedPayment({ store: ctx.financialStore, jobId, baseUrl: ctx.baseUrl!, token: ctx.token!, refreshToken: ctx.refreshToken, fetchFn: ctx.fetchFn });
        const payment = ctx.financialStore.getPaymentByJob(jobId);
        if (payment) ctx.financialStore.attachPaymentToRun({ runId: run.runId, paymentId: payment.paymentId, ordinal: 0 });
        const status = result.status === "provider_confirmed" ? "succeeded"
          : result.status === "outcome_unknown" ? "outcome_unknown"
            : ["failed", "blocked"].includes(result.status) ? "failed" : "partial";
        ctx.financialStore.finishExecutionRun({ runId: run.runId, status: status as "succeeded" | "partial" | "failed" | "outcome_unknown", note: `provider status ${result.batchStatus ?? "none"}`, at: new Date().toISOString() });
        send(res, 200, {
          result: { ...result, batchStatus: publicBatchStatus(result.status, result.batchStatus ?? null) },
          execution_run: ctx.financialStore.getExecutionRun(run.runId),
          workspace: productSnapshot(store, ctx.financialStore, workspaceId, user, true),
        });
      } catch (error) {
        const payment = ctx.financialStore.getPaymentByJob(jobId);
        const message = error instanceof Error ? error.message : "payment submission failed";
        const outcomeUnknown = payment?.status === "outcome_unknown";
        const runStatus = outcomeUnknown ? "outcome_unknown" : /EMERGENCY_STOP/.test(message) ? "failed" : payment?.status === "failed" ? "failed" : "outcome_unknown";
        try {
          ctx.financialStore.finishExecutionRun({ runId: run.runId, status: runStatus as "outcome_unknown" | "failed", note: message, at: new Date().toISOString() });
        } catch {
          // The run is already closed by a previous attempt; the payment state is authoritative.
        }
        const snapshot = productSnapshot(store, ctx.financialStore, workspaceId, user, true);
        if (outcomeUnknown) { send(res, 202, { error: message, outcomeUnknown: true, execution_run_id: run.runId, workspace: snapshot }); return true; }
        if (/EMERGENCY_STOP/.test(message)) { send(res, 409, { error: message, execution_run_id: run.runId, workspace: snapshot }); return true; }
        throw error;
      }
      return true;
    }
    if (req.method === "POST" && rest === "/reconcile") {
      if (!user) { send(res, 401, { error: "owner sign-in is required" }); return true; }
      if (store.getWorkspace(workspaceId, user.userId).kind !== "operational") throw new ProductPermissionError(409, "demonstration records cannot be reconciled as operational payments");
      if (!providerConfigured) { send(res, 503, { error: "PayPal Sandbox reconciliation is not configured" }); return true; }
      const input = await body(req);
      const idempotentReplay = input.idempotentReplay === true;
      const result = await reconcilePayPal({ store: ctx.financialStore, baseUrl: ctx.baseUrl!, token: ctx.token!, refreshToken: ctx.refreshToken, fetchFn: ctx.fetchFn, idempotentReplay });
      send(res, 200, { result, workspace: productSnapshot(store, ctx.financialStore, workspaceId, user, true) }); return true;
    }
    if (req.method === "POST" && rest === "/confirm") {
      // The confirmation sweep is the same server function the legacy route
      // calls, with the same policy. Only the authorisation differs: this one
      // accepts the server-verified product session of the workspace owner.
      if (!user) { send(res, 401, { error: "owner sign-in is required" }); return true; }
      if (store.getWorkspace(workspaceId, user.userId).kind !== "operational") { send(res, 409, { error: "demonstration workspaces cannot start a provider confirmation sweep" }); return true; }
      if (!providerConfigured) { send(res, 503, { error: "PayPal Sandbox confirmation is not configured" }); return true; }
      const sweep = await confirmDuePayments({
        store: ctx.financialStore, baseUrl: ctx.baseUrl!, token: ctx.token!, refreshToken: ctx.refreshToken,
        policy: DEFAULT_CONFIRMATION_POLICY,
      });
      send(res, 200, { sweep, workspace: productSnapshot(store, ctx.financialStore, workspaceId, user, true) });
      return true;
    }
    if (req.method === "POST" && rest === "/control") {
      if (!user) { send(res, 401, { error: "owner sign-in is required" }); return true; }
      if (store.getWorkspace(workspaceId, user.userId).kind !== "operational") { send(res, 409, { error: "demonstration workspaces cannot change execution control" }); return true; }
      const input = await body(req);
      if (typeof input.emergencyStop !== "boolean") { send(res, 400, { error: "emergencyStop must be true or false" }); return true; }
      const reason = typeof input.reason === "string" && input.reason.trim() !== "" ? input.reason.trim() : "workspace owner changed the emergency stop";
      ctx.financialStore.setEmergencyStop({ stopped: input.emergencyStop, actor: { actorId: user.userId, role: "owner" }, reason, at: new Date().toISOString() });
      send(res, 200, productSnapshot(store, ctx.financialStore, workspaceId, user, providerConfigured)); return true;
    }
    if (req.method === "PUT" && rest === "/policy") {
      if (!user) { send(res, 401, { error: "owner sign-in is required" }); return true; }
      const input = await body(req);
      const policy = store.updatePolicy(workspaceId, user.userId, { perPaymentCapCents: Number(input.perPaymentCapCents), rollingCapCents: Number(input.rollingCapCents) }, new Date().toISOString());
      if (store.getWorkspace(workspaceId, user.userId).kind === "operational") ctx.financialStore.updatePolicy({ capCents: policy.rollingCapCents, perPaymentCapCents: policy.perPaymentCapCents, freshnessSeconds: 300, actor: { actorId: user.userId, role: "owner" }, at: new Date().toISOString() });
      send(res, 200, { policy }); return true;
    }
    const receiptMatch = rest.match(/^\/receipts\/([^/]+)$/);
    if (req.method === "GET" && receiptMatch) {
      productSnapshot(store, ctx.financialStore, workspaceId, user, providerConfigured);
      const receipt = store.getReceipt(workspaceId, decodeURIComponent(receiptMatch[1]), user?.userId ?? null);
      const job = receipt.jobId ? store.getJob(workspaceId, receipt.jobId, user?.userId ?? null) : null;
      const financialAudit = workspaceId !== "demo" && receipt.paymentId ? ctx.financialStore.getAudit().filter((row) => row.resource_id === receipt.paymentId || row.correlation_id === receipt.payoutItemId) : [];
      const providerEvidence = receipt.paymentId ? ctx.financialStore.getPayoutItem(receipt.paymentId)?.raw ?? null : null;
      send(res, 200, { receipt, job, providerEvidence, financialAudit, productAudit: store.listAudit(workspaceId, user?.userId ?? null).filter((row) => row.resource_id === receipt.jobId || row.resource_id === receipt.paymentId) }); return true;
    }
    send(res, 404, { error: "product route not found" }); return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "product request failed";
    const capMatch = message.match(/^PER_PAYMENT_CAP_EXCEEDED: requested (\d+) cents exceeds the owner's per-payment cap of (\d+) cents \(policy v(\d+)\)/);
    if (error instanceof ProductPermissionError) send(res, error.status, { error: error.message });
    else if (capMatch) send(res, 422, { error: message, code: "PER_PAYMENT_CAP_EXCEEDED", requestedCents: Number(capMatch[1]), limitCents: Number(capMatch[2]), policyVersion: Number(capMatch[3]) });
    else if (error instanceof SyntaxError || /request body must be a JSON object/.test(message)) send(res, 400, { error: "request body must be valid JSON", code: "MALFORMED_JSON" });
    else if (/request body too large/.test(message)) send(res, 413, { error: "request body exceeds the configured size limit", code: "BODY_TOO_LARGE" });
    else if (error instanceof Error && /required|requires|invalid|must|cannot|exceed|only the workspace owner/.test(message)) send(res, 400, { error: message });
    else send(res, 500, { error: "product request failed", code: "INTERNAL_ERROR" });
    return true;
  }
}
