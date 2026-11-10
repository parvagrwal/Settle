// Routes — the server side of the app. No PayPal secret reaches the
// browser: the browser only sees jobs, grid rows, and audit rows.
// The owner approves a job here, the agent loop pays here, and every
// decision is in the audit trail. No framework, plain Node http, so
// the build stays at $0 out of pocket with no new dependency.
// Sandbox only, test money, no real money moves.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { runAgentLoop, type AgentLoopResult } from "./agent.ts";
import { groqAllocator } from "./groqAgent.ts";
import { ownerSelectedProposal, type Proposer } from "./model.ts";
import { billApprovedJobs } from "./invoicing.ts";
import { centsToDollars } from "./payouts.ts";
import { DEFAULT_POLICY } from "./policy.ts";
import { createAuditLog, type AuditLog, type AuditRow } from "./audit.ts";
import type { Job } from "./jobs.ts";
import type { Policy } from "../shared/types.ts";
import type { FetchFn } from "./paypalClient.ts";
import { TransactionStore } from "./transactionStore.ts";
import { transmissionFromHeaders, verifyWithPayPal } from "./webhooks.ts";
import { investigateTransactions, narrateInvestigation } from "./investigation.ts";
import { AllocationStore } from "./allocationStore.ts";
import { allocationCounterfactual, allocationDemoContext } from "./scenarioFixtures.ts";
import { orchestrateAllocation } from "./decisionEngine.ts";
import { groqScenarioSelector } from "./groqScenarioSelector.ts";
import { requireOwner } from "./ownerAuth.ts";
import { executeApprovedPlan } from "./planExecution.ts";
import { FinancialStore } from "./financialStore.ts";
import { confirmDuePayments, paypalDecimalToMinorUnits, reconcilePayPal, submitApprovedPayment } from "./financialPayments.ts";
import { buildFinancialReport } from "./financialReport.ts";
import { DEFAULT_CONFIRMATION_POLICY } from "./paymentState.ts";
import { createHash } from "node:crypto";
import type { ProductStore } from "./productStore.ts";
import { handleProductRoute, userFor } from "./productRoutes.ts";
import { buildPaymentOperations, type OperationsSnapshot } from "./paymentOperations.ts";
import { buildPaymentOperationDetail } from "./paymentOperationDetail.ts";
import { investigateOperations, narrateOperationsInvestigation } from "./operationsInvestigation.ts";

export interface GridRow {
  job_id: string;
  freelancer_id: string;
  amount_cents: number;
  fee_cents: number | null;
  due: string | null;
  priority: "high" | "normal" | "low" | null;
  status: string;
  reason: string | null;
  payout_batch_id: string | null;
  /** Where the record came from. */
  record_origin: "application" | "seed";
  /** What can be claimed about this row, in one sentence. */
  provenance_label: string;
  /** True only for rows from data/seed.json. They are never counted. */
  seeded: boolean;
  fee_estimate_cents: number | null;
  provider_fee_cents: number | null;
  fee_state: "estimate_only" | "provider_reported" | "unavailable" | "not_applicable";
  execution_run_id: string | null;
}

export interface SettleStore {
  jobs: Job[];
  allowlistedEmails: Set<string>;
  audit: AuditLog;
  /** Jobs already billed on this server run. A fresh server start resets it, same as the payout state. */
  invoicedJobIds: Set<string>;
}

export interface SettleServer {
  server: Server;
  store: SettleStore;
  /** Start listening on an ephemeral port (0) or a chosen port. */
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function gridRows(jobs: Job[]): GridRow[] {
  return jobs.map((job) => {
    const seeded = job.origin === "seed";
    const providerFee = job.fee_cents ?? null;
    return {
      job_id: job.job_id,
      freelancer_id: job.freelancer_id,
      amount_cents: job.amount_cents,
      fee_cents: providerFee,
      due: job.due ?? null,
      priority: job.priority ?? null,
      status: job.status,
      reason: job.decision_reason,
      payout_batch_id: job.payout_batch_id,
      record_origin: seeded ? "seed" : "application",
      provenance_label: seeded
        ? job.status === "historical_reference"
          ? "Seeded demonstration row; the claimed batch id is not verified by any artifact in this repository"
          : "Seeded demonstration row; never submitted to PayPal"
        : providerFee !== null
          ? "Application record; fee amount reported by PayPal"
          : "Application record; no provider-reported fee",
      seeded,
      fee_estimate_cents: null,
      provider_fee_cents: providerFee,
      fee_state: seeded ? "not_applicable" : providerFee !== null ? "provider_reported" : "unavailable",
      execution_run_id: null,
    };
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(text);
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Serve one file from the built dashboard folder. Returns true when the
 * file was served. Paths that escape the folder are refused. A path with
 * no file extension falls back to index.html, so the dashboard's own
 * screens load; a missing file with an extension is a 404, not a fallback. */
function serveStaticFile(res: ServerResponse, dir: string, path: string): boolean {
  const root = resolve(dir);
  let filePath = resolve(join(root, path === "/" ? "index.html" : path));
  if (filePath !== root && !filePath.startsWith(root + "/")) return false;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (extname(path) !== "") return false;
    filePath = join(root, "index.html");
    if (!existsSync(filePath)) return false;
  }
  const type = STATIC_CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(readFileSync(filePath));
  return true;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (Buffer.concat(chunks).length > 64 * 1024) {
      throw new Error("routes: request body too large");
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("routes: request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function readRawBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) throw new Error("webhook: request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createSettleServer(opts: {
  jobs: Job[];
  allowlistedEmails: Set<string>;
  policy?: Policy;
  audit?: AuditLog;
  baseUrl?: string;
  token?: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
  /** Key for the model allocator. Without it the run holds for the
   * owner to pick the jobs by hand, it never auto-pays the full set. */
  groqApiKey?: string;
  /** Email of the client being billed, set by the owner in local .env.
   * Without it the payout still works and the invoice is skipped. */
  clientEmail?: string;
  /** Folder with the built dashboard. Without it, only the API is served. */
  staticDir?: string;
  /** Durable verified-event projection. Required for transaction APIs. */
  transactionStore?: TransactionStore;
  /** PayPal webhook subscription ID, used only for postback verification. */
  webhookId?: string;
  /** Durable agent recommendations, approvals and execution controls. */
  allocationStore?: AllocationStore;
  /** Durable internal authorization, reservations and provider identity. */
  financialStore?: FinancialStore;
  /** Persistent authenticated workspace and product provenance model. */
  productStore?: ProductStore;
}): SettleServer {
  const store: SettleStore = {
    jobs: opts.jobs,
    allowlistedEmails: opts.allowlistedEmails,
    audit: opts.audit ?? createAuditLog(),
    invoicedJobIds: new Set<string>(),
  };
  const policy = opts.policy;
  const financial = opts.financialStore ?? new FinancialStore(":memory:");
  const recipientId = (email: string) => `recipient-${createHash("sha256").update(email).digest("hex").slice(0, 24)}`;
  if (policy && (!opts.financialStore || financial.getPolicy().version === 1)) {
    financial.updatePolicy({ capCents: policy.weeklyCapCents, perPaymentCapCents: policy.perPaymentCapCents, freshnessSeconds: 300, actor: { actorId: "configured-policy", role: "owner" }, at: new Date().toISOString() });
  }
  const activePolicy = (): Policy => {
    const current = financial.getPolicy();
    return {
      perPaymentCapCents: current.perPaymentCapCents,
      weeklyCapCents: current.capCents,
      windowMs: DEFAULT_POLICY.windowMs,
      approvalExpiryMs: policy?.approvalExpiryMs ?? DEFAULT_POLICY.approvalExpiryMs,
    };
  };
  const syncLegacyFromFinancial = (): void => {
    for (const verified of financial.listRecipients()) store.allowlistedEmails.add(verified.email);
    for (const jobId of financial.listInvoicedJobIds()) store.invoicedJobIds.add(jobId);
    for (const job of store.jobs) {
      const payment = financial.getPaymentByJob(job.job_id);
      if (!payment) continue;
      job.paypal_email = payment.recipientEmail;
      job.approval_state = "approved";
      if (job.approved_at === null) job.approved_at = Date.parse(payment.approvedAt);
      if (payment.status === "provider_confirmed") {
        const item = financial.getPayoutItem(payment.paymentId);
        job.status = "paid";
        job.payout_batch_id = (item?.payoutBatchId as string | undefined) ?? job.payout_batch_id;
        job.payout_item_id = item?.payoutItemId ?? job.payout_item_id;
        job.paypal_transaction_id = item?.transactionId ?? job.paypal_transaction_id ?? null;
        job.fee_cents = item?.feeCents ?? job.fee_cents ?? null;
        job.decision_reason = null;
      } else if (payment.status === "awaiting_confirmation" || payment.status === "pending" || payment.status === "onhold") {
        const item = financial.getPayoutItem(payment.paymentId);
        job.status = "processing";
        job.payout_batch_id = item?.payoutBatchId ?? financial.getAttemptBatchId(payment.paymentId) ?? job.payout_batch_id;
        job.payout_item_id = item?.payoutItemId ?? job.payout_item_id;
        job.fee_cents = item?.feeCents ?? job.fee_cents ?? null;
        job.decision_reason = payment.status === "awaiting_confirmation"
          ? "PayPal accepted the batch; the payout item has not settled yet. Confirmation is scheduled; this is not a failure."
          : `Provider item ${payment.status.toUpperCase()}: processing at PayPal — reconcile or wait for webhook`;
      } else if (payment.status === "unclaimed") {
        const item = financial.getPayoutItem(payment.paymentId);
        job.status = "unclaimed";
        job.payout_batch_id = item?.payoutBatchId ?? job.payout_batch_id;
        job.payout_item_id = item?.payoutItemId ?? job.payout_item_id;
        job.fee_cents = item?.feeCents ?? job.fee_cents ?? null;
        job.decision_reason = "Provider item UNCLAIMED: waiting for recipient or reconcile";
      } else if (payment.status === "reconciliation_required") {
        job.status = "blocked";
        job.decision_reason = "ReconciliationRequired: confirmation budget exhausted; reconcile provider state before retrying";
      } else if (payment.status === "outcome_unknown" || payment.status === "submitted" || payment.status === "reserved") {
        job.status = "blocked";
        job.decision_reason = "OutcomeUnknown: reconcile provider state before retrying";
      } else if (payment.status === "failed") {
        const item = financial.getPayoutItem(payment.paymentId);
        job.status = "failed";
        job.payout_batch_id = item?.payoutBatchId ?? job.payout_batch_id;
        job.payout_item_id = item?.payoutItemId ?? job.payout_item_id;
        job.decision_reason = "Provider item FAILED: no payment confirmed";
      } else if (["blocked", "returned", "reversed", "refunded"].includes(payment.status)) {
        const item = financial.getPayoutItem(payment.paymentId);
        job.status = "blocked";
        job.payout_batch_id = item?.payoutBatchId ?? job.payout_batch_id;
        job.payout_item_id = item?.payoutItemId ?? job.payout_item_id;
        job.fee_cents = item?.feeCents ?? job.fee_cents ?? null;
        job.decision_reason = `Provider item ${payment.status.toUpperCase()}: reconcile provider state before retrying`;
      } else if (payment.status === "approved" && job.status === "blocked") {
        job.status = "waiting";
        job.decision_reason = null;
      }
    }
  };
  syncLegacyFromFinancial();
  // There is deliberately no startup bridge from `approval_state === "approved"`
  // to a payment identity. A payment identity is created only by an explicit
  // owner approval of an application-origin job. Seed rows stay seed rows.

  // One place assembles the financial report, so the report route and the
  // payment operations projection cannot be given different inputs.
  const financialReportAt = (at: string) => buildFinancialReport({
    financial,
    at,
    providerConfigured: opts.baseUrl !== undefined && opts.token !== undefined,
    providerConnected: opts.baseUrl !== undefined && opts.token !== undefined,
    seedRecordCount: store.jobs.filter((job) => job.origin === "seed").length,
  });

  /** Read-only projection for the requester. Access is decided here and only
   * here: the legacy grid and the demonstration workspace are public (as they
   * already are), an operational workspace is included only for its owner's
   * server-verified session. */
  const operationsFor = (req: IncomingMessage): { snapshot: OperationsSnapshot; userId: string | null; workspaceJobs: Map<string, { recipientEmail: string }> } => {
    const at = new Date().toISOString();
    const productStore = opts.productStore;
    const user = productStore ? userFor(req, productStore) : null;
    const userId = user?.userId ?? null;
    const workspaces = productStore
      ? productStore.listWorkspaces(userId).map((workspace) => ({
          workspace,
          jobs: productStore.listJobs(workspace.workspaceId, userId),
          receipts: productStore.listReceipts(workspace.workspaceId, userId),
        }))
      : [];
    const workspaceJobs = new Map<string, { recipientEmail: string }>();
    for (const entry of workspaces) for (const job of entry.jobs) workspaceJobs.set(job.jobId, { recipientEmail: job.recipientEmail });
    const snapshot = buildPaymentOperations({
      at,
      legacyJobs: store.jobs,
      workspaces,
      financial,
      transactions: opts.transactionStore ? opts.transactionStore.listTransactions() : [],
      report: financialReportAt(at),
      signedIn: user !== null,
      approvalExpiryMs: activePolicy().approvalExpiryMs,
    });
    return { snapshot, userId, workspaceJobs };
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (await handleProductRoute(req, res, path, { productStore: opts.productStore, financialStore: financial, baseUrl: opts.baseUrl, token: opts.token, refreshToken: opts.refreshToken, fetchFn: opts.fetchFn })) return;

      if (req.method === "GET" && path === "/api/jobs") {
        sendJson(res, 200, { jobs: store.jobs });
        return;
      }
      if (req.method === "GET" && path === "/api/grid") {
        const rows = gridRows(store.jobs).map((row) => {
          const payment = financial.getPaymentByJob(row.job_id);
          if (!payment) return row;
          const fees = financial.getFeeRecord(payment.paymentId);
          return {
            ...row,
            fee_estimate_cents: fees.estimate?.estimatedFeeMinor ?? null,
            provider_fee_cents: fees.provider?.reportedFeeMinor ?? null,
            fee_state: fees.provider ? "provider_reported" : fees.estimate ? "estimate_only" : "unavailable",
            execution_run_id: payment.executionRunId,
            provenance_label: row.seeded
              ? row.provenance_label
              : `Application record, ${payment.status.replace(/_/g, " ")}${fees.provider ? ", provider-reported fee" : fees.estimate ? ", estimated fee only" : ""}`,
          };
        });
        sendJson(res, 200, { rows, note: "record_origin tells you what each row is. Seeded rows are never counted in any monetary total." });
        return;
      }
      if (req.method === "GET" && path === "/api/audit") {
        const rows: AuditRow[] = store.audit.rows();
        sendJson(res, 200, { rows });
        return;
      }
      if (req.method === "GET" && path === "/api/caps") {
        const caps = financial.getPolicy();
        const summary = financial.getCapSummary(new Date().toISOString());
        sendJson(res, 200, {
          per_payment_cap_cents: caps.perPaymentCapCents,
          weekly_cap_cents: caps.capCents,
          rolling_cap_cents: caps.capCents,
          window_hours: 168,
          window_days: 7,
          approval_expiry_days: 7,
          policy_version: caps.version,
          freshness_seconds: caps.freshnessSeconds,
          ...summary,
          worst_case_exposure: `Worst-case configured exposure: $${(caps.capCents / 100).toFixed(2)} per rolling 168 hours.`,
        });
        return;
      }
      if (req.method === "PUT" && path === "/api/financial/policy") {
        const owner = requireOwner(req);
        if (!owner.ok) { sendJson(res, owner.status, { error: owner.error }); return; }
        const body = await readJsonBody(req);
        const capCents = body.capCents; const perPaymentCapCents = body.perPaymentCapCents; const freshnessSeconds = body.freshnessSeconds;
        const valid = Number.isSafeInteger(capCents) && Number(capCents) >= 0
          && Number.isSafeInteger(perPaymentCapCents) && Number(perPaymentCapCents) > 0
          && Number.isSafeInteger(freshnessSeconds) && Number(freshnessSeconds) > 0
          && Number(perPaymentCapCents) <= Number(capCents);
        if (!valid) { sendJson(res, 400, { error: "capCents must be a non-negative integer, perPaymentCapCents and freshnessSeconds positive integers, and perPaymentCapCents <= capCents" }); return; }
        const version = financial.updatePolicy({ capCents: capCents as number, perPaymentCapCents: perPaymentCapCents as number, freshnessSeconds: freshnessSeconds as number, actor: { actorId: "owner", role: "owner" }, at: new Date().toISOString() });
        sendJson(res, 200, { policyVersion: version, policy: financial.getPolicy() }); return;
      }
      if (req.method === "GET" && path === "/api/financial/discrepancies") {
        const owner = requireOwner(req); if (!owner.ok) { sendJson(res, owner.status, { error: owner.error }); return; }
        sendJson(res, 200, { discrepancies: financial.getDiscrepancies() }); return;
      }
      if (req.method === "POST" && path === "/api/financial/reconcile") {
        const owner = requireOwner(req); if (!owner.ok) { sendJson(res, owner.status, { error: owner.error }); return; }
        if (opts.baseUrl === undefined || opts.token === undefined) {
          sendJson(res, 503, { error: "reconcile is not configured: sandbox credentials are missing" }); return;
        }
        const body = await readJsonBody(req);
        const batchIds = Array.isArray(body.batchIds)
          ? body.batchIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          : undefined;
        const idempotentReplay = body.idempotentReplay === true;
        const reconciled = await reconcilePayPal({ store: financial, baseUrl: opts.baseUrl, token: opts.token, refreshToken: opts.refreshToken, fetchFn: opts.fetchFn, batchIds, idempotentReplay });
        syncLegacyFromFinancial();
        sendJson(res, 200, { ...reconciled, idempotentReplay, cap: financial.getCapSummary(new Date().toISOString()) }); return;
      }
      if (req.method === "POST" && path === "/api/financial/confirm") {
        const owner = requireOwner(req); if (!owner.ok) { sendJson(res, owner.status, { error: owner.error }); return; }
        if (opts.baseUrl === undefined || opts.token === undefined) {
          sendJson(res, 503, { error: "confirmation is not configured: sandbox credentials are missing" }); return;
        }
        const sweep = await confirmDuePayments({
          store: financial, baseUrl: opts.baseUrl, token: opts.token, refreshToken: opts.refreshToken, fetchFn: opts.fetchFn,
          policy: DEFAULT_CONFIRMATION_POLICY,
        });
        syncLegacyFromFinancial();
        sendJson(res, 200, { ...sweep, cap: financial.getCapSummary(new Date().toISOString()) }); return;
      }
      if (req.method === "GET" && path === "/api/financial/report") {
        sendJson(res, 200, financialReportAt(new Date().toISOString()));
        return;
      }
      if (req.method === "GET" && path === "/api/financial/control") {
        const owner = requireOwner(req); if (!owner.ok) { sendJson(res, owner.status, { error: owner.error }); return; }
        sendJson(res, 200, financial.getControlState()); return;
      }
      if (req.method === "POST" && path === "/api/financial/control") {
        const owner = requireOwner(req); if (!owner.ok) { sendJson(res, owner.status, { error: owner.error }); return; }
        const body = await readJsonBody(req);
        if (typeof body.emergencyStop !== "boolean") { sendJson(res, 400, { error: "emergencyStop must be true or false" }); return; }
        const reason = typeof body.reason === "string" && body.reason.trim() !== "" ? body.reason.trim() : "owner changed the emergency stop";
        financial.setEmergencyStop({ stopped: body.emergencyStop, actor: { actorId: "owner", role: "owner" }, reason, at: new Date().toISOString() });
        sendJson(res, 200, financial.getControlState()); return;
      }

      if (req.method === "GET" && path === "/api/transactions") {
        if (!opts.transactionStore) { sendJson(res, 503, { error: "transaction store is not configured" }); return; }
        const since = Number(url.searchParams.get("since") ?? "0");
        if (!Number.isSafeInteger(since) || since < 0) { sendJson(res, 400, { error: "since must be a non-negative integer" }); return; }
        sendJson(res, 200, {
          transactions: opts.transactionStore.listTransactions(since),
          cursor: opts.transactionStore.currentSequence(),
          serverTime: new Date().toISOString(),
          source: "persisted verified PayPal events",
        });
        return;
      }

      const historyMatch = path.match(/^\/api\/transactions\/([^/]+)\/history$/);
      if (req.method === "GET" && historyMatch) {
        if (!opts.transactionStore) { sendJson(res, 503, { error: "transaction store is not configured" }); return; }
        const rowKey = decodeURIComponent(historyMatch[1]);
        if (!opts.transactionStore.getTransaction(rowKey)) { sendJson(res, 404, { error: "transaction not found" }); return; }
        sendJson(res, 200, { transaction: opts.transactionStore.getTransaction(rowKey), events: opts.transactionStore.getHistory(rowKey) });
        return;
      }

      if (req.method === "POST" && path === "/api/investigate") {
        if (!opts.transactionStore) { sendJson(res, 503, { error: "transaction store is not configured" }); return; }
        const body = (await readJsonBody(req)) as { question?: string };
        if (typeof body.question !== "string" || body.question.trim().length < 3 || body.question.length > 1000) {
          sendJson(res, 400, { error: "question must contain 3–1000 characters" }); return;
        }
        let analysis = investigateTransactions(opts.transactionStore.listTransactions(), body.question);
        if (process.env.GROQ_API_KEY) analysis = await narrateInvestigation(analysis, process.env.GROQ_API_KEY, opts.fetchFn);
        sendJson(res, 200, analysis);
        return;
      }

      // ---- payment operations: read-only projection, detail and investigation ----
      if (req.method === "GET" && path === "/api/operations") {
        sendJson(res, 200, operationsFor(req).snapshot);
        return;
      }
      const operationMatch = path.match(/^\/api\/operations\/payments\/([^/]+)$/);
      if (req.method === "GET" && operationMatch) {
        const operationId = decodeURIComponent(operationMatch[1]);
        const { snapshot, userId, workspaceJobs } = operationsFor(req);
        // A record the requester cannot see is indistinguishable from one that does not exist.
        const row = snapshot.rows.find((candidate) => candidate.operationId === operationId);
        if (!row) { sendJson(res, 404, { error: "payment record not found" }); return; }
        const sensitive = userId !== null || requireOwner(req).ok;
        const legacyJob = row.source === "legacy_grid" ? store.jobs.find((job) => job.job_id === row.jobId) : undefined;
        sendJson(res, 200, buildPaymentOperationDetail({
          at: snapshot.generatedAt,
          row,
          financial,
          sensitive,
          approvalExpiryMs: activePolicy().approvalExpiryMs,
          recipientEmail: legacyJob?.paypal_email ?? (row.jobId ? workspaceJobs.get(row.jobId)?.recipientEmail ?? null : null),
          workspaceAudit: row.workspaceId && opts.productStore ? opts.productStore.listAudit(row.workspaceId, userId) : [],
          legacyAudit: store.audit.rows(),
          transactions: opts.transactionStore ? opts.transactionStore.listTransactions() : [],
        }));
        return;
      }
      if (req.method === "POST" && path === "/api/operations/investigate") {
        const body = (await readJsonBody(req)) as { question?: unknown };
        if (typeof body.question !== "string" || body.question.trim().length < 3 || body.question.length > 500) {
          sendJson(res, 400, { error: "question must contain 3–500 characters" }); return;
        }
        const { snapshot, userId } = operationsFor(req);
        let analysis = investigateOperations(snapshot, body.question.trim());
        // Narration is optional and owner-only: an anonymous request never spends the owner's model quota.
        if (process.env.GROQ_API_KEY && (userId !== null || requireOwner(req).ok)) {
          analysis = await narrateOperationsInvestigation(analysis, process.env.GROQ_API_KEY, opts.fetchFn);
        }
        sendJson(res, 200, analysis);
        return;
      }

      if (req.method === "POST" && path === "/api/webhooks/paypal") {
        if (!opts.transactionStore || !opts.webhookId || opts.baseUrl === undefined || opts.token === undefined) {
          sendJson(res, 503, { error: "webhook is not configured: transaction store, webhook ID and sandbox credentials are required" }); return;
        }
        let transmission;
        try { transmission = transmissionFromHeaders(req.headers); }
        catch (error) { sendJson(res, 400, { error: (error as Error).message }); return; }
        const raw = await readRawBody(req);
        let event: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
          event = parsed as Record<string, unknown>;
        } catch { sendJson(res, 400, { error: "webhook: body must be a JSON object" }); return; }
        const verified = await verifyWithPayPal({
          baseUrl: opts.baseUrl, token: opts.token, webhookId: opts.webhookId,
          transmission, event, refreshToken: opts.refreshToken, fetchFn: opts.fetchFn,
        });
        if (!verified) { sendJson(res, 401, { error: "PayPal webhook signature verification failed" }); return; }
        const result = opts.transactionStore.processVerifiedEvent(event, new Date().toISOString(), transmission.id);
        const eventType = String(event.event_type ?? "");
        if (result.outcome === "applied" && (eventType.startsWith("PAYMENT.PAYOUTS-ITEM.") || eventType.startsWith("PAYOUTS.ITEM."))) {
          try {
            const resource = event.resource as Record<string, unknown> | undefined;
            const payoutItem = resource?.payout_item as Record<string, unknown> | undefined;
            const senderItemId = payoutItem?.sender_item_id ?? resource?.sender_item_id;
            const payment = typeof senderItemId === "string" ? financial.getPaymentByIdempotency(senderItemId) : null;
            const amountObj = (payoutItem?.amount ?? resource?.amount) as Record<string, unknown> | undefined;
            const receiver = payoutItem?.receiver ?? resource?.receiver;
            if (payment && resource && typeof receiver === "string" && typeof amountObj?.value === "string" && typeof amountObj?.currency === "string" && typeof resource.payout_item_id === "string" && typeof resource.transaction_status === "string") {
              financial.recordPayoutItem({
                paymentId: payment.paymentId,
                senderBatchId: payment.idempotencyKey,
                payoutBatchId: String(resource.payout_batch_id ?? financial.getAttemptBatchId(payment.paymentId) ?? ""),
                payoutItemId: resource.payout_item_id,
                transactionId: typeof resource.transaction_id === "string" ? resource.transaction_id : null,
                activityId: typeof resource.activity_id === "string" ? resource.activity_id : null,
                recipientEmail: receiver,
                amountCents: paypalDecimalToMinorUnits(amountObj.value),
                currency: amountObj.currency,
                status: resource.transaction_status,
                providerTimestamp: typeof resource.time_processed === "string" ? resource.time_processed : String(event.create_time),
                raw: resource,
              });
              syncLegacyFromFinancial();
            }
          } catch {
            // FinancialStore preserves any fact mismatch discrepancies independently.
          }
        }
        console.log(JSON.stringify({ type: "paypal_webhook_processed", eventId: event.id, correlationId: transmission.id, outcome: result.outcome, rowKey: result.rowKey }));
        sendJson(res, 200, { verification: "SUCCESS", outcome: result.outcome, duplicate: result.duplicate, rowKey: result.rowKey });
        return;
      }

      if (req.method === "GET" && path === "/api/allocation/demo-context") {
        sendJson(res, 200, { ...allocationDemoContext(), source: "illustrative scenario fixture — not customer data or actual cash" });
        return;
      }

      if (req.method === "POST" && path === "/api/allocation/recommend") {
        const owner = requireOwner(req);
        if (!owner.ok) { sendJson(res, owner.status, { error: owner.error }); return; }
        const body = await readJsonBody(req);
        const context = body.counterfactual === true ? allocationCounterfactual() : allocationDemoContext();
        const selector = opts.groqApiKey ? groqScenarioSelector({ apiKey: opts.groqApiKey, fetchFn: opts.fetchFn }) : undefined;
        const result = await orchestrateAllocation({ context, selector, now: new Date().toISOString() });
        if (result.recommendation && opts.allocationStore) {
          const rec = result.recommendation;
          opts.allocationStore.recordRecommendation(rec.selectedPlan, { reason: rec.reason, uncertainties: rec.uncertainties, changeTriggers: rec.changeTriggers }, context);
        }
        sendJson(res, 200, { ...result, context, source: "illustrative scenario fixture — no payment authorized" });
        return;
      }

      const planMatch = path.match(/^\/api\/allocation\/plans\/([^/]+)$/);
      if (req.method === "GET" && planMatch) {
        const plan = opts.allocationStore?.getPlan(decodeURIComponent(planMatch[1]));
        if (!plan) { sendJson(res, 404, { error: "allocation plan not found" }); return; }
        sendJson(res, 200, plan);
        return;
      }

      const executeMatch = path.match(/^\/api\/allocation\/plans\/([^/]+)\/execute$/);
      if (req.method === "POST" && executeMatch) {
        const owner = requireOwner(req);
        if (!owner.ok) { sendJson(res, owner.status, { error: owner.error }); return; }
        if (!opts.allocationStore) { sendJson(res, 503, { error: "allocation store is not configured" }); return; }
        if (opts.baseUrl === undefined || opts.token === undefined) {
          sendJson(res, 503, { error: "plan execution is not configured: sandbox credentials are missing, set them in local .env only" });
          return;
        }
        const planId = decodeURIComponent(executeMatch[1]);
        const result = await executeApprovedPlan({
          store: opts.allocationStore,
          financialStore: financial,
          planId,
          actor: { actorId: "owner", role: "owner" },
          baseUrl: opts.baseUrl,
          token: opts.token,
          refreshToken: opts.refreshToken,
          fetchFn: opts.fetchFn,
        });
        const executionStatus = result.status === "succeeded" ? 200
          : result.status === "outcome_unknown" ? 202
            : result.status === "denied" || result.reason.includes("CAP_EXCEEDED:") ? 409 : 502;
        sendJson(res, executionStatus, result);
        return;
      }

      if (req.method === "POST" && path === "/api/approve") {
        const owner = requireOwner(req);
        if (!owner.ok) { sendJson(res, owner.status, { error: owner.error }); return; }
        const body = await readJsonBody(req);
        const jobId = body.job_id;
        const recipient = body.recipient;
        if (typeof jobId !== "string" || jobId === "") {
          sendJson(res, 400, { error: "approve needs a job_id string" });
          return;
        }
        const job = store.jobs.find((j) => j.job_id === jobId);
        if (job === undefined) {
          sendJson(res, 404, { error: `no job named ${jobId}` });
          return;
        }
        if (job.origin === "seed") {
          sendJson(res, 409, {
            error: "DEMO_RECORD_NOT_PAYABLE: this row is seeded demonstration data. It is not a PayPal payment and cannot be approved, reserved or submitted. Use the operational workspace for a real sandbox payout.",
            code: "DEMO_RECORD_NOT_PAYABLE",
          });
          return;
        }
        // Owner confirm-once: a first payment to a new email waits until
        // the owner approves it here. Approval adds the email to the
        // allowlist and marks the job approved, and the audit trail
        // records who approved what.
        const email = typeof recipient === "string" && recipient !== "" ? recipient : job.paypal_email;
        const verifiedRecipientId = recipientId(email);
        if (!financial.getRecipient(verifiedRecipientId)) financial.verifyRecipient({ recipientId: verifiedRecipientId, email, actor: { actorId: "owner", role: "owner" }, at: new Date().toISOString() });
        if (!financial.getPaymentByJob(job.job_id)) financial.approvePayment({ jobId: job.job_id, recipientId: verifiedRecipientId, requestedRecipientEmail: email, amountCents: job.amount_cents, currency: "USD", actor: { actorId: "owner", role: "owner" }, at: new Date().toISOString() });
        store.allowlistedEmails.add(email);
        job.paypal_email = email;
        job.approval_state = "approved";
        job.approved_at = Date.now();
        if (job.status === "blocked" || job.status === "waiting") job.status = "waiting";
        job.decision_reason = null;
        store.audit.write({
          actor: "owner",
          job_id: job.job_id,
          action: "accepted",
          reason: `owner approved job ${job.job_id} for ${email}`,
          amount_cents: job.amount_cents,
          payout_batch_id: null,
          paypal_transaction_id: null,
        });
        sendJson(res, 200, { job });
        return;
      }

      if (req.method === "POST" && path === "/api/pay") {
        // Ownership is proved here, before any payment runs. The loop
        // and the billing step below both receive that proof, so the
        // decision check sees a real authorised actor, not a hard-coded one.
        const owner = requireOwner(req);
        if (!owner.ok) { sendJson(res, owner.status, { error: owner.error }); return; }
        const body = await readJsonBody(req);
        // The weekly cap is enforced against what is already paid in this
        // window, not from zero, so the number on screen and the number
        // the check enforces are the same number.
        const weeklyCapCents = financial.getPolicy().capCents;
        const capSummary = financial.getCapSummary(new Date().toISOString());
        const spentInWindowCents = capSummary.eligibleSpendCents + capSummary.activeReservationsCents;
        // Run budget: the owner's cap on this run only, in cents. The
        // dashboard sends dollars and converts; the default is the
        // weekly cap left, so a run with no budget given can still pay
        // up to the weekly cap. The store is memory-only, so this is
        // not a rolling PayPal-time window: a restart rebuilds the
        // seed jobs.
        let runBudgetCents = Math.max(0, weeklyCapCents - spentInWindowCents);
        const rawBudget = body.runBudgetCents;
        if (rawBudget !== undefined) {
          if (
            typeof rawBudget !== "number" ||
            !Number.isInteger(rawBudget) ||
            rawBudget <= 0 ||
            rawBudget > weeklyCapCents
          ) {
            sendJson(res, 400, {
              error: "run budget must be a whole number of cents above $0 and no more than the $1,500 weekly cap",
            });
            return;
          }
          runBudgetCents = rawBudget;
        }
        // The candidates for this run: approved jobs still waiting to
        // be paid. The over-cap job waits for the owner and is never a
        // candidate, so the model never sees it.
        const candidates = store.jobs.filter(
          (job) => job.origin !== "seed" && job.approval_state === "approved" && job.status === "waiting",
        );
        // Owner selection: the dashboard sends the job ids the owner
        // picked. Unknown ids are a client error; known jobs the check
        // refuses are refused by the loop with their label, as usual.
        let selectedIds: string[] | null = null;
        const rawSelected = body.selectedJobIds;
        if (rawSelected !== undefined) {
          if (!Array.isArray(rawSelected) || !rawSelected.every((entry) => typeof entry === "string")) {
            sendJson(res, 400, { error: "selected jobs must be a list of job ids" });
            return;
          }
          selectedIds = rawSelected;
          const unknown = selectedIds.filter((id) => !store.jobs.some((job) => job.job_id === id));
          if (unknown.length > 0) {
            sendJson(res, 400, { error: `selected job ${unknown[0]} does not exist` });
            return;
          }
          const seededSelection = selectedIds.filter((id) => store.jobs.find((job) => job.job_id === id)?.origin === "seed");
          if (seededSelection.length > 0) {
            sendJson(res, 409, {
              error: `DEMO_RECORD_NOT_PAYABLE: ${seededSelection.join(", ")} is seeded demonstration data. It cannot be selected for payment.`,
              code: "DEMO_RECORD_NOT_PAYABLE",
            });
            return;
          }
        }
        // How this run is proposed: the owner's picked jobs first,
        // then the model allocator when its key is set, else a hold
        // for the owner to pick by hand. A hold pays nothing and
        // returns the candidates.
        let proposer: Proposer;
        let proposerSource: "model" | "owner" | "manual-hold";
        let proposerReason: string | null = null;
        let modelHeld: Array<{ jobId: string; reason: string }> = [];
        let loopHeld: Array<{ jobId: string; reason: string }> = [];
        let heldForSelection: string[] = [];
        let holdReason: string | null = null;
        if (selectedIds !== null && selectedIds.length > 0) {
          proposer = ownerSelectedProposal(store.jobs, selectedIds);
          proposerSource = "owner";
        } else if (selectedIds !== null) {
          proposer = () => [];
          proposerSource = "manual-hold";
          holdReason = "no jobs were picked, pick the jobs to pay and try again";
          proposerReason = holdReason;
          heldForSelection = candidates.map((job) => job.job_id);
          loopHeld = candidates.map((job) => ({ jobId: job.job_id, reason: holdReason as string }));
        } else {
          const wire = await groqAllocator({
            jobs: candidates,
            apiKey: opts.groqApiKey ?? "",
            runBudgetCents,
            fetchFn: opts.fetchFn,
          });
          proposer = wire.proposer;
          proposerSource = wire.source;
          proposerReason = wire.reason;
          modelHeld = wire.held;
          loopHeld = wire.held;
          if (wire.source === "manual-hold") {
            heldForSelection = candidates.map((job) => job.job_id);
            holdReason = wire.reason;
            loopHeld = candidates.map((job) => ({
              jobId: job.job_id,
              reason: wire.reason ?? "held for the owner to pick",
            }));
          }
        }
        // The provider is checked after the request has been validated, so a
        // seeded selection and a missing token are answered with their own
        // reasons instead of a generic "not configured". No provider call can
        // happen without credentials, because this guard precedes the loop.
        if (opts.baseUrl === undefined || opts.token === undefined) {
          sendJson(res, 503, {
            error: "pay is not configured: sandbox credentials are missing, set them in local .env only",
          });
          return;
        }
        let ambiguousExecution = false;
        let executionRunId: string | null = null;
        // Items the provider refused after the policy accepted them. They are
        // not policy rejections, but they must be visible in the response and
        // the audit trail; otherwise a failed payout looks like a job that was
        // never selected.
        const providerRefusals: Array<{ job_id: string; label: string; reason: string }> = [];
        const processingJobs: Job[] = [];
        const recordedProviderItems: Array<{ job_id: string; payout_batch_id: string | null; payout_item_id: string | null; transaction_id: string | null; fee_cents: number | null; status: string }> = [];
        const result: AgentLoopResult = await runAgentLoop({
          jobs: store.jobs,
          allowlistedEmails: store.allowlistedEmails,
          policy: activePolicy(),
          spentInWindowCents,
          proposer,
          audit: store.audit,
          baseUrl: opts.baseUrl,
          token: opts.token,
          refreshToken: opts.refreshToken,
          fetchFn: opts.fetchFn,
          runBudgetCents,
          held: loopHeld,
          actorAuthorized: true,
          payFn: async ({ jobs: selectedJobs }) => {
            const accepted: Job[] = [];
            const rejected: Job[] = [];
            const providerItems: Array<ReturnType<FinancialStore["getPayoutItem"]>> = [];
            const providerBatches: string[] = [];
            // The run exists before the first provider call, so the owner can
            // refer to one durable id when the response is lost.
            const run = financial.createExecutionRun({
              kind: "legacy",
              requestedBy: "owner",
              actorRole: "owner",
              policyVersion: financial.getPolicy().version,
              at: new Date().toISOString(),
              note: `selected ${selectedJobs.length} job(s): ${selectedJobs.map((job) => job.job_id).join(", ")}`,
            });
            executionRunId = run.runId;
            for (const [ordinal, job] of selectedJobs.entries()) {
              try {
                // A job in the legacy dashboard carries its own approval record.
                // The owner's Pay click is the owner action that turns that
                // record into a ledger payment identity, once, here. Seed rows
                // never reach this point (the route filters them out).
                if (job.origin !== "seed" && !financial.getPaymentByJob(job.job_id)) {
                  const identity = recipientId(job.paypal_email);
                  if (!financial.getRecipient(identity)) {
                    financial.verifyRecipient({ recipientId: identity, email: job.paypal_email, actor: { actorId: "owner", role: "owner" }, at: new Date().toISOString() });
                  }
                  const payment = financial.approvePayment({
                    jobId: job.job_id,
                    recipientId: identity,
                    requestedRecipientEmail: job.paypal_email,
                    amountCents: job.amount_cents,
                    currency: "USD",
                    actor: { actorId: "owner", role: "owner" },
                    at: new Date().toISOString(),
                  });
                  store.audit.write({
                    actor: "owner",
                    job_id: job.job_id,
                    action: "accepted",
                    reason: `payment identity created for owner-approved application job ${job.job_id} (policy v${financial.getPolicy().version})`,
                    amount_cents: job.amount_cents,
                    payout_batch_id: null,
                    paypal_transaction_id: null,
                  });
                  void payment;
                }
                const sub = await submitApprovedPayment({ store: financial, jobId: job.job_id, baseUrl: opts.baseUrl!, token: opts.token!, refreshToken: opts.refreshToken, fetchFn: opts.fetchFn });
                const runPaymentId = financial.getPaymentByJob(job.job_id)?.paymentId;
                if (runPaymentId) financial.attachPaymentToRun({ runId: run.runId, paymentId: runPaymentId, ordinal });
                providerItems.push(sub.item);
                if (sub.batchStatus) providerBatches.push(sub.batchStatus);
                const resolvedBatchId = sub.item?.payoutBatchId ?? sub.payoutBatchId ?? null;
                job.payout_batch_id = resolvedBatchId;
                job.payout_item_id = sub.item?.payoutItemId ?? null;
                job.paypal_transaction_id = sub.item?.transactionId ?? null;
                job.fee_cents = sub.item?.feeCents ?? null;
                recordedProviderItems.push({
                  job_id: job.job_id,
                  payout_batch_id: resolvedBatchId,
                  payout_item_id: job.payout_item_id,
                  transaction_id: job.paypal_transaction_id ?? null,
                  fee_cents: job.fee_cents ?? null,
                  status: sub.item?.status ?? sub.status.toUpperCase(),
                });
                if (sub.status === "provider_confirmed") {
                  job.status = "paid";
                  job.decision_reason = null;
                  accepted.push(job);
                } else if (sub.status === "awaiting_confirmation") {
                  job.status = "processing";
                  job.decision_reason = "PayPal accepted the batch; the payout item has not settled yet. Confirmation is scheduled; this is not a failure.";
                  processingJobs.push(job);
                } else if (sub.status === "pending" || sub.status === "onhold") {
                  job.status = "processing";
                  job.decision_reason = `Provider item ${sub.status.toUpperCase()}: processing at PayPal — reconcile or wait for webhook`;
                  processingJobs.push(job);
                } else if (sub.status === "unclaimed") {
                  job.status = "unclaimed";
                  job.decision_reason = "Provider item UNCLAIMED: waiting for recipient or reconcile";
                  rejected.push(job);
                } else {
                  job.status = sub.status === "failed" ? "failed" : "blocked";
                  job.decision_reason = `Provider item ${sub.item?.status ?? sub.status.toUpperCase()}: no payment confirmed`;
                  rejected.push(job);
                  providerRefusals.push({
                    job_id: job.job_id,
                    label: `PROVIDER_ITEM_${sub.item?.status ?? sub.status.toUpperCase()}`,
                    reason: job.decision_reason,
                  });
                  store.audit.write({
                    actor: "agent",
                    job_id: job.job_id,
                    action: "rejected",
                    reason: job.decision_reason,
                    amount_cents: job.amount_cents,
                    payout_batch_id: job.payout_batch_id,
                    paypal_transaction_id: null,
                  });
                }
              } catch (error) {
                const state = financial.getPaymentByJob(job.job_id)?.status;
                if (state === "outcome_unknown") {
                  ambiguousExecution = true;
                  job.status = "blocked";
                  job.decision_reason = "OutcomeUnknown: reconcile provider state before retrying";
                  rejected.push(job);
                  providerRefusals.push({ job_id: job.job_id, label: "OUTCOME_UNKNOWN", reason: job.decision_reason });
                  store.audit.write({
                    actor: "agent",
                    job_id: job.job_id,
                    action: "rejected",
                    reason: job.decision_reason,
                    amount_cents: job.amount_cents,
                    payout_batch_id: job.payout_batch_id,
                    paypal_transaction_id: null,
                  });
                  break;
                }
                throw error;
              }
            }
            const runStatus = ambiguousExecution
              ? "outcome_unknown"
              : processingJobs.length > 0 || accepted.length > 0
                ? (accepted.length === selectedJobs.length ? "succeeded" : "partial")
                : rejected.length > 0 ? "failed" : "failed";
            financial.finishExecutionRun({
              runId: run.runId,
              status: runStatus,
              note: `${accepted.length} confirmed, ${processingJobs.length} awaiting confirmation, ${rejected.length} not executed`,
              at: new Date().toISOString(),
            });
            const failedBatchStatus = providerBatches.length > 0 && providerBatches.every((s) => s === "DENIED") ? "DENIED" : "FAILED";
            const batchStatus = ambiguousExecution
              ? "OUTCOME_UNKNOWN"
              : accepted.length === 0
                ? (processingJobs.length > 0 ? "PROCESSING" : rejected.length > 0 ? failedBatchStatus : null)
                : (rejected.length > 0 || processingJobs.length > 0 ? "PARTIAL" : "SUCCESS");
            return {
              accepted,
              rejected,
              payoutBatchId: providerItems[0]?.payoutBatchId ?? processingJobs[0]?.payout_batch_id ?? null,
              senderBatchId: providerItems[0]?.senderBatchId ?? null,
              batchStatus,
            };
          },
        });
        // Billing: the client is billed for the same jobs the payout just
        // paid, with the client email the owner set in local .env. Only a
        // SUCCESS batch with paid jobs is billed, so held, blocked, and
        // rejected jobs are never invoiced, and a failed batch bills
        // nothing. A failed bill never unpays or fails the payout: the
        // payout result stands and the invoice is manual, for the owner
        // to bill by hand.
        let invoiceId: string | null = null;
        let invoiceStatus = "SKIPPED";
        let invoiceTotalCents = 0;
        let invoiceError: string | null = null;
        if (result.batchStatus === "SUCCESS" && result.accepted.length > 0) {
          const paidTotalCents = result.accepted.reduce((sum, job) => sum + job.amount_cents, 0);
          const firstPaidJob = result.accepted[0];
          if (opts.clientEmail === undefined || opts.clientEmail === "") {
            invoiceError = "no client email in local .env, invoice not sent, bill by hand";
            store.audit.write({
              actor: "agent",
              job_id: firstPaidJob.job_id,
              action: "rejected",
              reason: `invoice skipped: ${invoiceError}`,
              amount_cents: paidTotalCents,
              payout_batch_id: result.payoutBatchId,
              paypal_transaction_id: null,
            });
          } else {
            const bill = await billApprovedJobs({
              baseUrl: opts.baseUrl,
              token: opts.token,
              jobs: result.accepted,
              clientEmail: opts.clientEmail,
              clientId: "client-1",
              alreadyInvoicedJobIds: store.invoicedJobIds,
              refreshToken: opts.refreshToken,
              fetchFn: opts.fetchFn,
              actorAuthorized: true,
            });
            if (!bill.manual && bill.invoice !== null) {
              invoiceId = bill.invoice.invoiceId;
              invoiceStatus = "SENT";
              invoiceTotalCents = bill.totalCents;
              for (const jobId of bill.jobIds) store.invoicedJobIds.add(jobId);
              const detail = bill.invoice.raw?.detail as Record<string, unknown> | undefined;
              financial.recordInvoiceEvidence({
                internalInvoiceId: `invoice-${bill.jobIds.slice().sort().join("+")}`,
                paypalInvoiceId: bill.invoice.invoiceId,
                invoiceNumber: typeof detail?.invoice_number === "string" ? detail.invoice_number : null,
                status: bill.invoice.status,
                amountCents: bill.totalCents,
                currency: "USD",
                jobIds: bill.jobIds,
                endpoint: `/v2/invoicing/invoices/${bill.invoice.invoiceId}`,
                retrievedAt: new Date().toISOString(),
                raw: bill.invoice.raw,
              });
              store.audit.write({
                actor: "agent",
                job_id: bill.jobIds[0] ?? firstPaidJob.job_id,
                action: "invoiced",
                reason: `invoice ${invoiceId} sent for ${bill.jobIds.length} jobs, $${centsToDollars(invoiceTotalCents)}`,
                amount_cents: invoiceTotalCents,
                payout_batch_id: result.payoutBatchId,
                paypal_transaction_id: null,
              });
            } else if (
              bill.rejected.length > 0 &&
              bill.rejected.every((r) => r.label === "DuplicatePayout")
            ) {
              invoiceStatus = "NOT_CREATED";
              invoiceError = "all paid jobs were already invoiced, no new invoice";
              store.audit.write({
                actor: "agent",
                job_id: firstPaidJob.job_id,
                action: "rejected",
                reason: `invoice not created: ${invoiceError}`,
                amount_cents: paidTotalCents,
                payout_batch_id: result.payoutBatchId,
                paypal_transaction_id: null,
              });
            } else {
              invoiceStatus = "MANUAL";
              invoiceError = bill.error ?? "invoice failed, bill by hand";
              store.audit.write({
                actor: "agent",
                job_id: firstPaidJob.job_id,
                action: "rejected",
                reason: `invoice not sent: ${invoiceError}, bill by hand`,
                amount_cents: paidTotalCents,
                payout_batch_id: result.payoutBatchId,
                paypal_transaction_id: null,
              });
            }
          }
        } else {
          invoiceError =
            result.batchStatus === null
              ? "no jobs were paid, nothing to bill"
              : `batch was ${result.batchStatus}, nothing was paid to bill`;
        }
        const reportedFees = recordedProviderItems.map((entry) => entry.fee_cents).filter((v): v is number => v !== null);
        const actualFeeCents = reportedFees.length > 0 ? reportedFees.reduce((sum, fee) => sum + fee, 0) : null;
        const feeRecords = recordedProviderItems
          .map((entry) => {
            const payment = financial.getPaymentByJob(entry.job_id);
            if (!payment) return null;
            return { job_id: entry.job_id, ...financial.getFeeRecord(payment.paymentId) };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        sendJson(res, ambiguousExecution ? 202 : 200, {
          execution_run: executionRunId === null ? null : financial.getExecutionRun(executionRunId),
          fee_records: feeRecords,
          accepted: result.accepted.map((job) => job.job_id),
          rejected: [
            ...result.rejected.map((r) => ({ job_id: r.proposalJobId, label: r.label, reason: r.reason })),
            ...providerRefusals,
          ],
          processing: processingJobs.map((job) => ({
            job_id: job.job_id,
            payout_batch_id: job.payout_batch_id,
            payout_item_id: job.payout_item_id,
            reason: job.decision_reason,
          })),
          payout_batch_id: result.payoutBatchId,
          batch_status: result.batchStatus,
          actual_fee_cents: actualFeeCents,
          provider_items: recordedProviderItems,
          proposer: proposerSource,
          proposer_reason: proposerReason,
          held: modelHeld.map((h) => ({ job_id: h.jobId, reason: h.reason })),
          held_for_selection: heldForSelection,
          hold_reason: holdReason,
          invoice_id: invoiceId,
          invoice_status: invoiceStatus,
          invoice_total_cents: invoiceTotalCents,
          invoice_error: invoiceError,
        });
        return;
      }

      if (req.method === "GET" && opts.staticDir !== undefined) {
        if (serveStaticFile(res, opts.staticDir, path)) return;
      }
      if (req.method === "GET" && path === "/" && opts.staticDir === undefined) {
        const text =
          "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Settle</title></head>" +
          "<body style=\"font-family: system-ui, sans-serif; font-size: 16px; padding: 24px;\">" +
          "<h1>Settle dashboard</h1><p>The dashboard is not built yet.</p>" +
          "<p>Build it, then restart this server:</p>" +
          "<pre>cd app &amp;&amp; npm install &amp;&amp; npm run build</pre>" +
          "<p>The API still works: <a href=\"/api/grid\">/api/grid</a>.</p>" +
          "<p>Sandbox only. Test money, no real money moves.</p></body></html>";
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(text);
        return;
      }

      sendJson(res, 404, { error: `no route ${req.method} ${path}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      const conflict = /^(CAP_EXCEEDED:|SUBMISSION_CONFLICT:|DEMO_RECORD_NOT_PAYABLE|EMERGENCY_STOP:|provider reconciliation is stale|payment outcome is unknown|payment is not owner-approved|payment cannot be reserved)/.test(message);
      sendJson(res, conflict ? 409 : 500, { error: message });
    }
  });

  return {
    server,
    store,
    listen(port = 0): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, () => {
          const address = server.address();
          if (address !== null && typeof address === "object") resolve(address.port);
          else reject(new Error("routes: server address is not available"));
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
