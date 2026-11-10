// Pay-click invoicing tests — the Pay click also bills the client for the
// same work that was just paid. Attack-first: each test names the attacker
// and the attack it must defeat, before the wiring exists.
// Attacker 1: a proposer that names unpaid jobs. Attack: an invoice built
// from a different list than the payouts (invoice items must match the
// paid jobs exactly, same IDs, same amounts, client email from the server
// settings only, never from a proposal).
// Attacker 2: a replayed second Pay click. Attack: billing the same jobs
// twice, a second invoice for work already billed.
// Attacker 3: a failing invoice service. Attack: a failed bill unpays
// the freelancers or fails the payout.
// Attacker 4: missing owner config. Attack: an invoice call with no
// client email set.
// Attacker 5: a batch that did not succeed. Attack: invoicing work that
// was never paid.
// Run: node --test tests/pay-invoice.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettleServer } from "../src/server/routes.ts";

// The guarded routes need the owner token. Every test file runs in its
// own process, so setting it here cannot leak into another file.
process.env.SETTLE_OWNER_TOKEN = "test-owner-token";
const OWNER_HEADERS = { "x-settle-owner-token": "test-owner-token" };
import { seedJobs } from "../src/server/seed.ts";
import { billApprovedJobs } from "../src/server/invoicing.ts";
import type { Job } from "../src/server/jobs.ts";

type MockResponse = {
  status: number;
  ok: boolean;
  json: () => Promise<Record<string, unknown>>;
  headers: { get: (name: string) => string | null };
};

function mockResponse(status: number, json: Record<string, unknown>): MockResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => json,
    headers: { get: () => null },
  };
}

interface PayResponse {
  accepted: string[];
  rejected: Array<{ job_id: string; label: string; reason: string }>;
  payout_batch_id: string | null;
  batch_status: string | null;
  proposer: string;
  proposer_reason: string | null;
  invoice_id?: string | null;
  invoice_status?: string | null;
  invoice_total_cents?: number | null;
  invoice_error?: string | null;
}

/** Mock PayPal that answers Payouts and Invoicing, and records every call.
 * It also answers Groq with the full waiting set, so the pay click goes
 * through the model allocator the way the live dashboard does. */
function makePayPalMock(opts: { batchStatus?: string; invoiceFails?: boolean } = {}) {
  const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
  let invoiceGetCount = 0;
  let payoutItem: Record<string, unknown> | null = null;
  const fetchFn = (async (url: string, init: Record<string, unknown>) => {
    calls.push({ url, init });
    const method = (init.method as string) ?? "GET";
    if (url.includes("api.groq.com")) {
      return mockResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                proposals: [
                  { jobId: "demo-waiting-1", recipient: "freelancer@example.com", amountCents: 100, reason: "Due first." },
                  { jobId: "demo-waiting-2", recipient: "freelancer@example.com", amountCents: 100, reason: "Due second." },
                ],
                held: [],
              }),
            },
          },
        ],
      });
    }
    if (url.includes("/v1/payments/payouts")) {
      if (method === "POST") {
        const body = JSON.parse(String(init.body)); const source = body.items[0];
        payoutItem = {
          payout_item_id: `ITEM-${source.sender_item_id}`,
          transaction_id: `TX-${source.sender_item_id}`,
          activity_id: `ACT-${source.sender_item_id}`,
          payout_item_fee: { value: "0.02", currency: "USD" },
          payout_batch_id: "BATCH-INV",
          transaction_status: opts.batchStatus === "DENIED" ? "FAILED" : "SUCCESS",
          payout_item: { sender_item_id: source.sender_item_id, receiver: source.receiver, amount: source.amount },
          time_processed: new Date().toISOString(),
        };
        return mockResponse(201, { batch_header: { payout_batch_id: "BATCH-INV", batch_status: "PENDING" } });
      }
      if (url.includes("?")) throw new Error(`unexpected list query: ${url}`);
      return mockResponse(200, { batch_header: { payout_batch_id: "BATCH-INV", batch_status: opts.batchStatus ?? "SUCCESS" }, items: payoutItem ? [payoutItem] : [] });
    }
    if (url.includes("/v2/invoicing/invoices")) {
      if (opts.invoiceFails && method === "POST" && !url.endsWith("/send")) {
        return mockResponse(400, { name: "VALIDATION_ERROR", message: "invoice failed" });
      }
      if (method === "POST" && url.endsWith("/send")) {
        return mockResponse(200, { id: "INV2-TEST-001", status: "SENT" });
      }
      if (method === "POST") {
        return mockResponse(201, { id: "INV2-TEST-001", status: "DRAFT" });
      }
      invoiceGetCount++;
      const status = invoiceGetCount === 1 ? "DRAFT" : "SENT";
      return mockResponse(200, { id: "INV2-TEST-001", status });
    }
    throw new Error(`mock: unexpected PayPal call ${method} ${url}`);
  }) as unknown as typeof fetch;
  return {
    fetchFn,
    calls,
    invoicingCalls: () => calls.filter((call) => call.url.includes("/v2/invoicing/")),
    invoicePosts: () => calls.filter((call) => call.url.includes("/v2/invoicing/") && ((call.init.method as string) ?? "GET") === "POST"),
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    job_id: "job-1",
    freelancer_id: "freelancer-1",
    paypal_email: "freelancer@example.com",
    amount_cents: 100,
    currency: "USD",
    approval_state: "approved",
    approved_at: Date.now(),
    status: "paid",
    payout_batch_id: "BATCH-INV",
    payout_item_id: null,
    decision_reason: null,
    ...overrides,
  };
}

async function payOnce(port: number): Promise<PayResponse> {
  const res = await fetch(`http://127.0.0.1:${port}/api/pay`, { method: "POST", headers: { ...OWNER_HEADERS } });
  assert.equal(res.status, 200);
  return (await res.json()) as PayResponse;
}

test("pay bills only the jobs the payout paid, client email from the server settings", async () => {
  const mock = makePayPalMock();
  const jobs = seedJobs("freelancer@example.com");
  const app = createSettleServer({
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
    groqApiKey: "test-key",
    clientEmail: "client@example.com",
  });
  const port = await app.listen(0);
  try {
    const paid = await payOnce(port);
    assert.equal(paid.payout_batch_id, "BATCH-INV");
    assert.equal(paid.batch_status, "SUCCESS");
    assert.deepEqual(paid.accepted, ["demo-waiting-1", "demo-waiting-2"]);
    assert.equal(paid.proposer, "model");
    // The invoice fields ride on the same response, old fields unchanged.
    assert.equal(paid.invoice_id, "INV2-TEST-001");
    assert.equal(paid.invoice_status, "SENT");
    assert.equal(paid.invoice_total_cents, 200);
    assert.equal(paid.invoice_error, null);

    // The invoice items match the paid jobs exactly: same IDs, same
    // amounts, and the client email from the server settings, never
    // from a proposal. Held and blocked jobs are never invoiced.
    const create = mock.invoicePosts().find((call) => call.url.endsWith("/v2/invoicing/invoices"));
    assert.ok(create, "no invoice create call was made");
    const body = JSON.parse(create.init.body as string) as Record<string, unknown>;
    const recipients = body.primary_recipients as Array<Record<string, Record<string, string>>>;
    assert.equal(recipients[0].billing_info.email_address, "client@example.com");
    const items = body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 2);
    assert.match(items[0].name as string, /demo-waiting-1/);
    assert.match(items[1].name as string, /demo-waiting-2/);
    assert.deepEqual(items[0].unit_amount, { currency_code: "USD", value: "1.00" });
    assert.deepEqual(items[1].unit_amount, { currency_code: "USD", value: "1.00" });
    assert.doesNotMatch(JSON.stringify(body), /demo-over-cap|demo-approve-1/);

    // The audit trail names the invoice outcome.
    const auditRes = await fetch(`http://127.0.0.1:${port}/api/audit`);
    const audit = (await auditRes.json()) as { rows: Array<{ action: string; reason: string }> };
    assert.ok(
      audit.rows.some((row) => row.action === "invoiced" && row.reason.includes("INV2-TEST-001")),
      "no audit row names the sent invoice",
    );
  } finally {
    await app.close();
  }
});

test("second pay click bills nothing new, no second invoice is created", async () => {
  const mock = makePayPalMock();
  const jobs = seedJobs("freelancer@example.com");
  const app = createSettleServer({
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
    groqApiKey: "test-key",
    clientEmail: "client@example.com",
  });
  const port = await app.listen(0);
  try {
    const first = await payOnce(port);
    assert.equal(first.invoice_status, "SENT");
    const invoicingAfterFirst = mock.invoicingCalls().length;
    assert.ok(invoicingAfterFirst > 0, "first click made no invoicing call");

    const second = await payOnce(port);
    // The jobs are already paid, so nothing is proposed again and nothing
    // is paid a second time. No new invoice call is made.
    assert.deepEqual(second.accepted, []);
    assert.equal(second.invoice_id, null);
    assert.equal(second.invoice_status, "SKIPPED");
    assert.equal(mock.invoicingCalls().length, invoicingAfterFirst);
  } finally {
    await app.close();
  }
});

test("billing the same jobs twice rejects the second bill as already billed", async () => {
  const mock = makePayPalMock();
  const jobs = [makeJob({ job_id: "job-1" }), makeJob({ job_id: "job-2", freelancer_id: "freelancer-2", paypal_email: "f2@example.com" })];
  const invoiced = new Set<string>();
  const first = await billApprovedJobs({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    jobs,
    clientEmail: "client@example.com",
    clientId: "client-1",
    alreadyInvoicedJobIds: invoiced,
    fetchFn: mock.fetchFn,
    actorAuthorized: true
  });
  assert.equal(first.manual, false);
  assert.equal(first.invoice?.invoiceId, "INV2-TEST-001");
  for (const jobId of first.jobIds) invoiced.add(jobId);
  const postsAfterFirst = mock.invoicePosts().length;

  const second = await billApprovedJobs({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    jobs,
    clientEmail: "client@example.com",
    clientId: "client-1",
    alreadyInvoicedJobIds: invoiced,
    fetchFn: mock.fetchFn,
    actorAuthorized: true
  });
  assert.equal(second.manual, true);
  assert.equal(second.invoice, null);
  assert.equal(second.rejected.length, 2);
  assert.ok(second.rejected.every((r) => r.label === "DuplicatePayout"));
  assert.equal(mock.invoicePosts().length, postsAfterFirst);
});

test("failed invoice does not unpay or fail the payout, invoice is manual", async () => {
  const mock = makePayPalMock({ invoiceFails: true });
  const jobs = seedJobs("freelancer@example.com");
  const app = createSettleServer({
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
    groqApiKey: "test-key",
    clientEmail: "client@example.com",
  });
  const port = await app.listen(0);
  try {
    const paid = await payOnce(port);
    assert.equal(paid.batch_status, "SUCCESS");
    assert.deepEqual(paid.accepted, ["demo-waiting-1", "demo-waiting-2"]);
    assert.equal(paid.invoice_id, null);
    assert.equal(paid.invoice_status, "MANUAL");
    assert.match(paid.invoice_error ?? "", /VALIDATION_ERROR/);

    // The payout still stands: the jobs stay paid with the batch ID.
    const gridRes = await fetch(`http://127.0.0.1:${port}/api/grid`);
    const grid = (await gridRes.json()) as { rows: Array<{ job_id: string; status: string; payout_batch_id: string | null }> };
    const byId = new Map(grid.rows.map((row) => [row.job_id, row]));
    assert.equal(byId.get("demo-waiting-1")?.status, "paid");
    assert.equal(byId.get("demo-waiting-1")?.payout_batch_id, "BATCH-INV");

    // The audit trail names the manual invoice and its reason.
    const auditRes = await fetch(`http://127.0.0.1:${port}/api/audit`);
    const audit = (await auditRes.json()) as { rows: Array<{ reason: string }> };
    assert.ok(audit.rows.some((row) => row.reason.includes("invoice not sent")), "no audit row names the manual invoice");
  } finally {
    await app.close();
  }
});

test("no client email configured: payout works, invoice skipped, no invoicing call", async () => {
  const mock = makePayPalMock();
  const jobs = seedJobs("freelancer@example.com");
  const app = createSettleServer({
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
    groqApiKey: "test-key",
  });
  const port = await app.listen(0);
  try {
    const paid = await payOnce(port);
    assert.equal(paid.batch_status, "SUCCESS");
    assert.deepEqual(paid.accepted, ["demo-waiting-1", "demo-waiting-2"]);
    assert.equal(paid.invoice_id, null);
    assert.equal(paid.invoice_status, "SKIPPED");
    assert.match(paid.invoice_error ?? "", /no client email/);
    assert.equal(mock.invoicingCalls().length, 0);
  } finally {
    await app.close();
  }
});

test("denied batch makes no invoice call, invoice skipped", async () => {
  const mock = makePayPalMock({ batchStatus: "DENIED" });
  const jobs = seedJobs("freelancer@example.com");
  const app = createSettleServer({
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
    groqApiKey: "test-key",
    clientEmail: "client@example.com",
  });
  const port = await app.listen(0);
  try {
    const paid = await payOnce(port);
    assert.equal(paid.batch_status, "DENIED");
    assert.equal(paid.invoice_id, null);
    assert.equal(paid.invoice_status, "SKIPPED");
    assert.match(paid.invoice_error ?? "", /DENIED/);
    assert.equal(mock.invoicingCalls().length, 0);
  } finally {
    await app.close();
  }
});

test("jobs already invoiced are not billed again: no new invoice, no invoice call", async () => {
  const mock = makePayPalMock();
  const jobs = seedJobs("freelancer@example.com");
  const app = createSettleServer({
    jobs,
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
    groqApiKey: "test-key",
    clientEmail: "client@example.com",
  });
  // Both waiting jobs were already billed in an earlier run on this server.
  app.store.invoicedJobIds.add("demo-waiting-1");
  app.store.invoicedJobIds.add("demo-waiting-2");
  const port = await app.listen(0);
  try {
    const paid = await payOnce(port);
    assert.equal(paid.batch_status, "SUCCESS");
    assert.deepEqual(paid.accepted, ["demo-waiting-1", "demo-waiting-2"]);
    assert.equal(paid.invoice_id, null);
    assert.equal(paid.invoice_status, "NOT_CREATED");
    assert.match(paid.invoice_error ?? "", /already invoiced/);
    assert.equal(mock.invoicePosts().length, 0);
  } finally {
    await app.close();
  }
});
