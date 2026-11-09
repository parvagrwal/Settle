// Invoicing — bill the client for the same approved jobs that were paid.
// The Agent Toolkit tool create_invoice calls POST /v2/invoicing/invoices,
// and send_invoice calls POST /v2/invoicing/invoices/{invoice_id}/send.
// This file calls those same endpoints directly, with the same bearer token
// and the same request-id rule as the Payouts code. v1 invoices are
// deprecated, so this file never calls /v1/invoices.
// Every job goes through decide() first, the same gate as payouts. A job
// that is not approved is left out, with its label as the reason, and no
// PayPal call is made for it. A job that was already billed is left out
// too, so the client is never billed twice for the same job.
// Invoicing never changes a job. The payout fields stay as they were, so a
// failed bill never unpays a freelancer. If the bill fails, the payout
// still stands and the invoice row is labelled manual, see billApprovedJobs.
// Amounts are integer cents in code, dollars as strings in PayPal payloads.
import { decide } from "./decide.ts";
import { DEFAULT_POLICY } from "./policy.ts";
import { centsToDollars } from "./payouts.ts";
import { paypalRequest, PayPalError, type FetchFn } from "./paypalClient.ts";
import type { Job } from "./jobs.ts";
import type { Policy, State } from "../shared/types.ts";

export interface InvoiceRejection {
  jobId: string;
  label: string;
  reason: string;
}

export interface InvoiceResult {
  invoiceId: string | null;
  status: string;
  jobIds: string[];
  clientId: string;
  totalCents: number;
  rejected: InvoiceRejection[];
  raw: Record<string, unknown> | null;
}

export interface SentInvoiceResult {
  invoiceId: string;
  status: string;
  raw: Record<string, unknown>;
}

export interface BillResult {
  invoice: SentInvoiceResult | null;
  jobIds: string[];
  totalCents: number;
  accepted: Job[];
  rejected: InvoiceRejection[];
  manual: boolean;
  error: string | null;
}

function invoiceState(job: Job, billedSoFarCents: number, alreadyBilled: boolean, policy: Policy, actorAuthorized: boolean): State {
  return {
    actorAuthorized,
    systemSuspended: false,
    jobApproved: job.approval_state === "approved",
    approvalExpiresAtMs:
      job.approved_at === null ? null : job.approved_at + policy.approvalExpiryMs,
    // The billed client is set by the owner in local .env, never chosen by
    // the model, so there is no allowlist to check for the client. The
    // allowlist guards who gets paid, not who gets billed.
    recipientAllowed: true,
    // Already paid is the normal case for a bill, the work was paid out
    // first. Already billed is the duplicate: the same job on a second bill.
    alreadyPaid: alreadyBilled,
    spentInWindowCents: billedSoFarCents,
  };
}

export function buildInvoiceBody(jobs: Job[], clientEmail: string, invoiceNumber: string): Record<string, unknown> {
  return {
    detail: {
      invoice_number: invoiceNumber,
      currency_code: "USD",
      note: "Settle invoice for approved work, same jobs as the payout.",
    },
    primary_recipients: [{ billing_info: { email_address: clientEmail } }],
    items: jobs.map((job) => ({
      name: `Approved work ${job.job_id}`,
      description: `Job ${job.job_id}, freelancer ${job.freelancer_id}, paid with PayPal.`,
      quantity: "1",
      unit_amount: { currency_code: "USD", value: centsToDollars(job.amount_cents) },
      unit_of_measure: "QUANTITY",
    })),
  };
}

export function makeInvoiceNumber(nowMs: number = Date.now()): string {
  return `settle-${nowMs}`;
}

export async function getInvoice(opts: {
  baseUrl: string;
  token: string;
  invoiceId: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
}): Promise<SentInvoiceResult> {
  const { json } = await paypalRequest({
    method: "GET",
    path: `${opts.baseUrl}/v2/invoicing/invoices/${opts.invoiceId}`,
    token: opts.token,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  const invoiceId = json.id;
  const status = json.status;
  if (typeof invoiceId !== "string" || typeof status !== "string") {
    throw new PayPalError(200, "INVOICE_READ_FAILED", "Invoice read reply had no invoice ID or status");
  }
  return { invoiceId, status, raw: json };
}

export async function createInvoice(opts: {
  baseUrl: string;
  token: string;
  jobs: Job[];
  clientEmail: string;
  clientId: string;
  policy?: Policy;
  nowMs?: number;
  alreadyInvoicedJobIds?: Set<string>;
  invoiceNumber?: string;
  requestId?: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
  /** True only when the caller proved ownership first. Defaults to false,
   * so a caller that forgets it gets every job refused, never billed. */
  actorAuthorized?: boolean;
}): Promise<InvoiceResult> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const nowMs = opts.nowMs ?? Date.now();
  const actorAuthorized = opts.actorAuthorized ?? false;
  const alreadyInvoiced = opts.alreadyInvoicedJobIds ?? new Set<string>();
  const accepted: Job[] = [];
  const rejected: InvoiceRejection[] = [];
  let billedSoFarCents = 0;

  for (const job of opts.jobs) {
    const state = invoiceState(job, billedSoFarCents, alreadyInvoiced.has(job.job_id), policy, actorAuthorized);
    const decision = decide(
      policy,
      state,
      { jobId: job.job_id, recipient: opts.clientEmail, amountCents: job.amount_cents },
      nowMs,
    );
    if (decision.decision === "reject") {
      rejected.push({ jobId: job.job_id, label: decision.label, reason: decision.reason });
      continue;
    }
    accepted.push(job);
    billedSoFarCents += job.amount_cents;
  }

  if (accepted.length === 0) {
    return {
      invoiceId: null,
      status: "NOT_CREATED",
      jobIds: [],
      clientId: opts.clientId,
      totalCents: 0,
      rejected,
      raw: null,
    };
  }

  const invoiceNumber = opts.invoiceNumber ?? makeInvoiceNumber(nowMs);
  const requestId = opts.requestId ?? crypto.randomUUID();
  const body = buildInvoiceBody(accepted, opts.clientEmail, invoiceNumber);
  const { status, json } = await paypalRequest({
    method: "POST",
    path: `${opts.baseUrl}/v2/invoicing/invoices`,
    token: opts.token,
    body,
    requestId,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  if (status !== 201) {
    throw new PayPalError(status, "INVOICE_CREATE_FAILED", `Invoice create returned HTTP ${status}`);
  }
  // The create reply is either the full invoice, with an id and a status,
  // or a single self link to the invoice, with the ID in the link. Both
  // name the created invoice. Take the ID from whichever shape came back,
  // then read the invoice back with GET, so the status check uses the real
  // invoice, not the reply shape.
  let invoiceId: string | null = null;
  if (typeof json.id === "string") invoiceId = json.id;
  else if (typeof json.href === "string") {
    const match = json.href.match(/\/v2\/invoicing\/invoices\/([^/?]+)/);
    if (match) invoiceId = match[1];
  }
  if (invoiceId === null || !invoiceId.startsWith("INV2-")) {
    const rawPreview = JSON.stringify(json).slice(0, 800);
    throw new PayPalError(status, "INVOICE_CREATE_FAILED", `Invoice create reply named no INV2- invoice ID. Raw reply: ${rawPreview}`);
  }
  const readBack = await getInvoice({
    baseUrl: opts.baseUrl,
    token: opts.token,
    invoiceId,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  if (readBack.status !== "DRAFT") {
    throw new PayPalError(status, "INVOICE_CREATE_FAILED", `Invoice ${invoiceId} status was ${readBack.status}, not DRAFT`);
  }
  return {
    invoiceId,
    status: "DRAFT",
    jobIds: accepted.map((job) => job.job_id),
    clientId: opts.clientId,
    totalCents: billedSoFarCents,
    rejected,
    raw: readBack.raw,
  };
}

export async function sendInvoice(opts: {
  baseUrl: string;
  token: string;
  invoiceId: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
}): Promise<SentInvoiceResult> {
  await paypalRequest({
    method: "POST",
    path: `${opts.baseUrl}/v2/invoicing/invoices/${opts.invoiceId}/send`,
    token: opts.token,
    body: { send_to_recipient: true },
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  const readBack = await getInvoice({
    baseUrl: opts.baseUrl,
    token: opts.token,
    invoiceId: opts.invoiceId,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  if (readBack.status !== "SENT") {
    throw new PayPalError(200, "INVOICE_SEND_FAILED", `Invoice ${opts.invoiceId} status after send was ${readBack.status}, not SENT`);
  }
  return readBack;
}

export async function billApprovedJobs(opts: {
  baseUrl: string;
  token: string;
  jobs: Job[];
  clientEmail: string;
  clientId: string;
  policy?: Policy;
  nowMs?: number;
  alreadyInvoicedJobIds?: Set<string>;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
  /** True only when the caller proved ownership first. Defaults to false. */
  actorAuthorized?: boolean;
}): Promise<BillResult> {
  try {
    const created = await createInvoice({
      baseUrl: opts.baseUrl,
      token: opts.token,
      jobs: opts.jobs,
      clientEmail: opts.clientEmail,
      clientId: opts.clientId,
      policy: opts.policy,
      nowMs: opts.nowMs,
      alreadyInvoicedJobIds: opts.alreadyInvoicedJobIds,
      refreshToken: opts.refreshToken,
      fetchFn: opts.fetchFn,
      actorAuthorized: opts.actorAuthorized ?? false,
    });
    if (created.invoiceId === null) {
      return {
        invoice: null,
        jobIds: [],
        totalCents: 0,
        accepted: [],
        rejected: created.rejected,
        manual: true,
        error: "no approved job to bill, no invoice was created",
      };
    }
    const sent = await sendInvoice({
      baseUrl: opts.baseUrl,
      token: opts.token,
      invoiceId: created.invoiceId,
      refreshToken: opts.refreshToken,
      fetchFn: opts.fetchFn,
    });
    return {
      invoice: sent,
      jobIds: created.jobIds,
      totalCents: created.totalCents,
      accepted: opts.jobs.filter((job) => created.jobIds.includes(job.job_id)),
      rejected: created.rejected,
      manual: false,
      error: null,
    };
  } catch (err) {
    // The bill failed. The payout still stands: this function never changes
    // a job, so every payout_batch_id and status stays as it was. The
    // invoice row is labelled manual, and the owner bills the client by hand.
    return {
      invoice: null,
      jobIds: [],
      totalCents: 0,
      accepted: [],
      rejected: [],
      manual: true,
      error:
        err instanceof PayPalError
          ? `${err.paypalName}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

export { PayPalError };
