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
import { groqOrRuleBasedProposer } from "./groqAgent.ts";
import { billApprovedJobs } from "./invoicing.ts";
import { centsToDollars } from "./payouts.ts";
import { DEFAULT_POLICY } from "./policy.ts";
import { createAuditLog, type AuditLog, type AuditRow } from "./audit.ts";
import type { Job } from "./jobs.ts";
import type { Policy } from "../shared/types.ts";
import type { FetchFn } from "./paypalClient.ts";

export interface GridRow {
  job_id: string;
  freelancer_id: string;
  amount_cents: number;
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

export function createSettleServer(opts: {
  jobs: Job[];
  allowlistedEmails: Set<string>;
  policy?: Policy;
  audit?: AuditLog;
  baseUrl?: string;
  token?: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
  /** Key for the model proposer. Without it the loop proposes rule-based. */
  groqApiKey?: string;
  /** Email of the client being billed, set by the owner in local .env.
   * Without it the payout still works and the invoice is skipped. */
  clientEmail?: string;
  /** Folder with the built dashboard. Without it, only the API is served. */
  staticDir?: string;
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
        // The weekly cap is enforced against what is already paid in this
        // window, not from zero, so the number on screen and the number
        // the check enforces are the same number.
        const spentInWindowCents = store.jobs
          .filter((job) => job.status === "paid")
          .reduce((sum, job) => sum + job.amount_cents, 0);
        // The model proposes when its key is set, rule-based when it is
        // not. Either way the decision check disposes every proposal.
        const wired = await groqOrRuleBasedProposer({
          jobs: store.jobs,
          apiKey: opts.groqApiKey ?? "",
          fetchFn: opts.fetchFn,
        });
        const result: AgentLoopResult = await runAgentLoop({
          jobs: store.jobs,
          allowlistedEmails: store.allowlistedEmails,
          policy,
          spentInWindowCents,
          proposer: wired.proposer,
          audit: store.audit,
          baseUrl: opts.baseUrl,
          token: opts.token,
          refreshToken: opts.refreshToken,
          fetchFn: opts.fetchFn,
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
          proposer: wired.source,
          proposer_reason: wired.reason,
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
