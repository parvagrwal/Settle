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

export interface GridRow {
  job_id: string;
  freelancer_id: string;
  amount_cents: number;
  due: string | null;
  priority: "high" | "normal" | "low" | null;
  status: string;
  reason: string | null;
  payout_batch_id: string | null;
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
  return jobs.map((job) => ({
    job_id: job.job_id,
    freelancer_id: job.freelancer_id,
    amount_cents: job.amount_cents,
    due: job.due ?? null,
    priority: job.priority ?? null,
    status: job.status,
    reason: job.decision_reason,
    payout_batch_id: job.payout_batch_id,
  }));
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
}): SettleServer {
  const store: SettleStore = {
    jobs: opts.jobs,
    allowlistedEmails: opts.allowlistedEmails,
    audit: opts.audit ?? createAuditLog(),
    invoicedJobIds: new Set<string>(),
  };
  const policy = opts.policy;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (req.method === "GET" && path === "/api/jobs") {
        sendJson(res, 200, { jobs: store.jobs });
        return;
      }
      if (req.method === "GET" && path === "/api/grid") {
        sendJson(res, 200, { rows: gridRows(store.jobs) });
        return;
      }
      if (req.method === "GET" && path === "/api/audit") {
        const rows: AuditRow[] = store.audit.rows();
        sendJson(res, 200, { rows });
        return;
      }
      if (req.method === "GET" && path === "/api/caps") {
        const caps = policy ?? DEFAULT_POLICY;
        sendJson(res, 200, {
          per_payment_cap_cents: caps.perPaymentCapCents,
          weekly_cap_cents: caps.weeklyCapCents,
          window_days: 7,
          approval_expiry_days: 7,
          worst_case_exposure: "Worst-case exposure: $1,500 per week.",
        });
        return;
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
        console.log(JSON.stringify({ type: "paypal_webhook_processed", eventId: event.id, correlationId: transmission.id, outcome: result.outcome, rowKey: result.rowKey }));
        sendJson(res, 200, { verification: "SUCCESS", outcome: result.outcome, duplicate: result.duplicate, rowKey: result.rowKey });
        return;
      }

      if (req.method === "GET" && path === "/api/allocation/demo-context") {
        sendJson(res, 200, { ...allocationDemoContext(), source: "illustrative scenario fixture — not customer data or actual cash" });
        return;
      }

      if (req.method === "POST" && path === "/api/allocation/recommend") {
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

      if (req.method === "POST" && path === "/api/approve") {
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
        // Owner confirm-once: a first payment to a new email waits until
        // the owner approves it here. Approval adds the email to the
        // allowlist and marks the job approved, and the audit trail
        // records who approved what.
        const email = typeof recipient === "string" && recipient !== "" ? recipient : job.paypal_email;
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
        if (opts.baseUrl === undefined || opts.token === undefined) {
          sendJson(res, 503, {
            error: "pay is not configured: sandbox credentials are missing, set them in local .env only",
          });
          return;
        }
        const body = await readJsonBody(req);
        // The weekly cap is enforced against what is already paid in this
        // window, not from zero, so the number on screen and the number
        // the check enforces are the same number.
        const weeklyCapCents = (policy ?? DEFAULT_POLICY).weeklyCapCents;
        const spentInWindowCents = store.jobs
          .filter((job) => job.status === "paid")
          .reduce((sum, job) => sum + job.amount_cents, 0);
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
          (job) => job.approval_state === "approved" && job.status === "waiting",
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
        const result: AgentLoopResult = await runAgentLoop({
          jobs: store.jobs,
          allowlistedEmails: store.allowlistedEmails,
          policy,
          spentInWindowCents,
          proposer,
          audit: store.audit,
          baseUrl: opts.baseUrl,
          token: opts.token,
          refreshToken: opts.refreshToken,
          fetchFn: opts.fetchFn,
          runBudgetCents,
          held: loopHeld,
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
            });
            if (!bill.manual && bill.invoice !== null) {
              invoiceId = bill.invoice.invoiceId;
              invoiceStatus = "SENT";
              invoiceTotalCents = bill.totalCents;
              for (const jobId of bill.jobIds) store.invoicedJobIds.add(jobId);
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
        sendJson(res, 200, {
          accepted: result.accepted.map((job) => job.job_id),
          rejected: result.rejected.map((r) => ({ job_id: r.proposalJobId, label: r.label, reason: r.reason })),
          payout_batch_id: result.payoutBatchId,
          batch_status: result.batchStatus,
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
      sendJson(res, 500, { error: message });
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
