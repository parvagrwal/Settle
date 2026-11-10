// Hardening regression suite — written RED-first against the defects found in
// the 2026-11 forensic baseline, then turned GREEN by the fixes they describe.
//
//   A. A rejected duplicate Pay command never overwrites the authoritative
//      paid state or its on-grid reason.
//   B. Approving a job above the per-payment cap is a business-rule rejection
//      (422 + stable code), never an internal server error.
//   C. The legacy audit history is durable: it survives a server restart.
//   D. Sensitive reads require owner/session authentication; recipient emails
//      are masked for anonymous callers of the public demo grid.
//   E. Every response carries baseline security headers.
//   F. Malformed JSON is 400; an oversized body is 413.
//   G. Owner sign-in is rate limited.
//   H. unsafeTestOnlySql is unavailable outside the Node test runner.
//   I. Policy rejection messages name the owner's configured caps, not the
//      compiled-in defaults.
//   J. awaiting_confirmation exposure cannot escape the rolling-cap arithmetic.
//   K. Anonymous callers cannot create demo product decisions.
//   L. Allocation recommend and plan execute share the financialWrite rate
//      limit (the inventory table claims it; the code did not apply it).
//      Added by the pack builder, 2026-11-10.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettleServer } from "../src/server/routes.ts";
import { payableJobs } from "./helpers/payableJobs.ts";
import { FinancialStore } from "../src/server/financialStore.ts";
import { ProductStore } from "../src/server/productStore.ts";
import { createAuditLog } from "../src/server/audit.ts";

process.env.SETTLE_OWNER_TOKEN = "hardening-owner-token";
const OWNER = { "x-settle-owner-token": "hardening-owner-token", "Content-Type": "application/json" };

function jsonResponse(status: number, body: Record<string, unknown>) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => null } };
}

function mockPayPal() {
  const batches = new Map<string, { senderBatchId: string; item: Record<string, unknown> }>();
  let seq = 0;
  return (async (url: string, init: Record<string, unknown> = {}) => {
    const method = (init.method as string) ?? "GET";
    if (url.includes("/v1/payments/payouts")) {
      if (method === "POST") {
        const parsed = JSON.parse(String(init.body)) as {
          sender_batch_header: { sender_batch_id: string };
          items: Array<{ sender_item_id: string; receiver: string; amount: { value: string; currency: string } }>;
        };
        const src = parsed.items[0];
        const batchId = `BATCH-HRD-${++seq}`;
        batches.set(batchId, {
          senderBatchId: parsed.sender_batch_header.sender_batch_id,
          item: {
            payout_item_id: `ITEM-${seq}`, transaction_id: `TX-${seq}`, activity_id: `ACT-${seq}`,
            payout_item_fee: { value: "0.02", currency: "USD" }, payout_batch_id: batchId,
            transaction_status: "SUCCESS",
            payout_item: { sender_item_id: src.sender_item_id, receiver: src.receiver, amount: src.amount },
            time_processed: new Date().toISOString(),
          },
        });
        return jsonResponse(201, { batch_header: { payout_batch_id: batchId, batch_status: "PENDING" } });
      }
      const batchId = url.split("?")[0].split("/").pop()!;
      const stored = batches.get(batchId);
      if (stored) {
        return jsonResponse(200, {
          batch_header: { payout_batch_id: batchId, sender_batch_header: { sender_batch_id: stored.senderBatchId }, batch_status: "SUCCESS" },
          items: [stored.item],
        });
      }
      return jsonResponse(404, { name: "RESOURCE_NOT_FOUND" });
    }
    if (url.includes("/v2/invoicing")) return jsonResponse(201, { id: "INV-HRD", status: "DRAFT" });
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as unknown as typeof fetch;
}

function makeServer(dbPath: string, extra: Record<string, unknown> = {}) {
  return createSettleServer({
    jobs: payableJobs(),
    allowlistedEmails: new Set(["freelancer@example.com"]),
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "mock-token",
    fetchFn: mockPayPal(),
    financialStore: new FinancialStore(dbPath),
    audit: createAuditLog(dbPath),
    ...extra,
  });
}

test("A: a rejected duplicate Pay command never overwrites the paid state or its reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-hardening-"));
  const app = makeServer(join(dir, "a.db"));
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    const target = "demo-waiting-1";
    const pay1 = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: [target] }) });
    assert.equal(pay1.status, 200);
    const body1 = await pay1.json() as { accepted: string[] };
    assert.deepEqual(body1.accepted, [target]);

    const pay2 = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: [target] }) });
    assert.equal(pay2.status, 200);
    const body2 = await pay2.json() as { accepted: string[]; rejected: Array<{ job_id: string; label: string }> };
    assert.deepEqual(body2.accepted, []);
    assert.equal(body2.rejected.find((r) => r.job_id === target)?.label, "DuplicatePayout");

    // The authoritative grid projection still says paid, with no rejection text in its reason.
    const grid = await (await fetch(`${base}/api/grid`, { headers: OWNER })).json() as { rows: Array<{ job_id: string; status: string; reason: string | null }> };
    const row = grid.rows.find((r) => r.job_id === target)!;
    assert.equal(row.status, "paid");
    assert.equal(row.reason, null, "duplicate command result must not replace the paid row's reason");

    // The rejected duplicate command remains visible as an audit event.
    const audit = await (await fetch(`${base}/api/audit`, { headers: OWNER })).json() as { rows: Array<{ job_id: string; action: string; reason: string }> };
    assert.ok(audit.rows.some((r) => r.job_id === target && r.action === "rejected" && /DuplicatePayout/.test(r.reason)));
    // Exactly one provider payment exists for the job.
    assert.equal(audit.rows.filter((r) => r.job_id === target && r.action === "paid").length, 1);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("B: approving above the per-payment cap is 422 with a stable code, not 500", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-hardening-"));
  const app = makeServer(join(dir, "b.db"));
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/api/approve`, { method: "POST", headers: OWNER, body: JSON.stringify({ job_id: "demo-over-cap" }) });
    assert.equal(res.status, 422);
    const body = await res.json() as { error: string; code: string; limitCents: number; requestedCents: number };
    assert.equal(body.code, "PER_PAYMENT_CAP_EXCEEDED");
    assert.equal(body.limitCents, 20000);
    assert.equal(body.requestedCents, 25000);
    assert.doesNotMatch(body.error, /stack|sqlite|SQL/i);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C: legacy audit history survives a restart when backed by the database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-hardening-"));
  const dbPath = join(dir, "c.db");
  const app = makeServer(dbPath);
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  let before: Array<{ audit_id: string; job_id: string; action: string }> = [];
  try {
    const pay = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-1"] }) });
    assert.equal(pay.status, 200);
    before = ((await (await fetch(`${base}/api/audit`, { headers: OWNER })).json()) as { rows: typeof before }).rows;
    assert.ok(before.length > 0, "payment produced audit rows");
  } finally {
    await app.close();
  }
  const app2 = makeServer(dbPath);
  const port2 = await app2.listen(0);
  try {
    const after = ((await (await fetch(`http://127.0.0.1:${port2}/api/audit`, { headers: OWNER })).json()) as { rows: typeof before }).rows;
    assert.deepEqual(after.map((r) => `${r.audit_id}:${r.job_id}:${r.action}`), before.map((r) => `${r.audit_id}:${r.job_id}:${r.action}`), "audit rows and their order survive a restart");
  } finally {
    await app2.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("D: sensitive reads require authentication; the public grid masks recipient emails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-hardening-"));
  const app = makeServer(join(dir, "d.db"));
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    for (const path of ["/api/audit", "/api/financial/report"]) {
      const anon = await fetch(`${base}${path}`);
      assert.equal(anon.status, 401, `${path} must refuse anonymous readers`);
      const authed = await fetch(`${base}${path}`, { headers: OWNER });
      assert.equal(authed.status, 200, `${path} must serve the owner`);
    }
    const investigate = await fetch(`${base}/api/investigate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "which payments failed?" }) });
    assert.equal(investigate.status, 401, "anonymous callers cannot use the investigation endpoint");

    const anonJobs = await (await fetch(`${base}/api/jobs`)).json() as { jobs: Array<{ paypal_email: string }> };
    for (const job of anonJobs.jobs) {
      assert.doesNotMatch(job.paypal_email, /^[^*]+@/, `recipient email must be masked for anonymous readers, got ${job.paypal_email}`);
    }
    const ownerJobs = await (await fetch(`${base}/api/jobs`, { headers: OWNER })).json() as { jobs: Array<{ paypal_email: string }> };
    assert.ok(ownerJobs.jobs.some((job) => /@example\.com$/.test(job.paypal_email)), "the owner still sees full recipient emails");
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("E: responses carry baseline security headers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-hardening-"));
  const app = makeServer(join(dir, "e.db"));
  const port = await app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/grid`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok((res.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"));
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F: malformed JSON is 400 and an oversized body is 413, never 500", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-hardening-"));
  const app = makeServer(join(dir, "f.db"));
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    const malformed = await fetch(`${base}/api/approve`, { method: "POST", headers: OWNER, body: "{not json" });
    assert.equal(malformed.status, 400);
    assert.equal(((await malformed.json()) as { code: string }).code, "MALFORMED_JSON");

    const oversized = await fetch(`${base}/api/approve`, { method: "POST", headers: OWNER, body: JSON.stringify({ job_id: "x".repeat(70 * 1024) }) });
    assert.equal(oversized.status, 413);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G: owner sign-in is rate limited with 429 and Retry-After", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-hardening-"));
  const app = makeServer(join(dir, "g.db"), { productStore: new ProductStore(join(dir, "g.db")) });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${base}/api/product/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: `wrong-${i}` }) });
      if (res.status === 429) {
        limited = true;
        assert.ok(Number(res.headers.get("retry-after")) > 0, "429 carries Retry-After");
        break;
      }
      assert.equal(res.status, 401);
    }
    assert.ok(limited, "repeated failed sign-ins must hit the rate limit");
    // A verified webhook route is never rate limited by the sign-in bucket:
    // the webhook endpoint still answers (503 configuration, not 429).
    const webhook = await fetch(`${base}/api/webhooks/paypal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.notEqual(webhook.status, 429);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H: unsafeTestOnlySql refuses to run outside the Node test runner context", () => {
  const store = new FinancialStore(":memory:");
  const saved = process.env.NODE_TEST_CONTEXT;
  const savedEnv = process.env.NODE_ENV;
  const savedAllow = process.env.SETTLE_ALLOW_TEST_SQL;
  try {
    delete process.env.NODE_TEST_CONTEXT;
    delete process.env.NODE_ENV;
    delete process.env.SETTLE_ALLOW_TEST_SQL;
    assert.throws(() => store.unsafeTestOnlySql("SELECT 1"), /test-only/);
  } finally {
    if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved;
    if (savedEnv !== undefined) process.env.NODE_ENV = savedEnv;
    if (savedAllow !== undefined) process.env.SETTLE_ALLOW_TEST_SQL = savedAllow;
  }
  // Inside the runner it still works, so tests keep their database access.
  store.unsafeTestOnlySql("SELECT 1");
});

test("I: policy rejection messages name the owner's configured caps, not compiled-in defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-hardening-"));
  const app = makeServer(join(dir, "i.db"));
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    const update = await fetch(`${base}/api/financial/policy`, { method: "PUT", headers: OWNER, body: JSON.stringify({ capCents: 50, perPaymentCapCents: 50, freshnessSeconds: 300 }) });
    assert.equal(update.status, 200);
    const policyVersion = ((await update.json()) as { policyVersion: number }).policyVersion;
    assert.ok(policyVersion > 1);

    // demo-waiting-2 costs $1.00 — it violates the new $0.50 weekly cap.
    const pay = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ selectedJobIds: ["demo-waiting-2"] }) });
    const body = await pay.json() as { rejected: Array<{ job_id: string; label: string; reason: string }> };
    const rejection = body.rejected.find((r) => r.job_id === "demo-waiting-2");
    assert.ok(rejection, "over-cap job is rejected");
    assert.doesNotMatch(rejection!.reason, /1,500/, "stale default cap text must not appear");
    assert.match(rejection!.reason, /\$0\.50/, `rejection must name the configured cap, got: ${rejection!.reason}`);

    // The run-budget validation names the configured cap too.
    const budget = await fetch(`${base}/api/pay`, { method: "POST", headers: OWNER, body: JSON.stringify({ runBudgetCents: 100000 }) });
    assert.equal(budget.status, 400);
    const budgetBody = await budget.json() as { error: string };
    assert.doesNotMatch(budgetBody.error, /1,500/);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("J: awaiting_confirmation exposure counts against the rolling cap", () => {
  const store = new FinancialStore(":memory:");
  const owner = { actorId: "owner", role: "owner" as const };
  const at = new Date().toISOString();
  store.verifyRecipient({ recipientId: "rec-1", email: "contractor@example.test", actor: owner, at });
  store.approvePayment({ jobId: "job-exp-1", recipientId: "rec-1", amountCents: 5000, currency: "USD", actor: owner, at });
  store.markReconciled(at);
  store.reservePayment({ jobId: "job-exp-1", at });
  const payment = store.getPaymentByJob("job-exp-1")!;
  const attempt = store.beginSubmission(payment.paymentId, at);
  store.markAwaitingConfirmation(attempt.attemptId, "BATCH-EXP-1", at);
  assert.equal(store.getPaymentByJob("job-exp-1")!.status, "awaiting_confirmation");
  const summary = store.getCapSummary(new Date().toISOString());
  assert.equal(summary.activeReservationsCents, 5000, "awaiting_confirmation must be counted as active exposure");
});

test("K: anonymous callers cannot create demo product decisions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-hardening-"));
  const dbPath = join(dir, "k.db");
  const app = makeServer(dbPath, { productStore: new ProductStore(dbPath) });
  const port = await app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/product/workspaces/demo/recommend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(res.status, 401);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("L: allocation recommend and plan execute share the financialWrite rate limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-hardening-"));
  const app = makeServer(join(dir, "l.db"));
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    let limited = false;
    for (let i = 0; i < 61; i++) {
      const res = await fetch(`${base}/api/allocation/recommend`, { method: "POST", headers: OWNER, body: "{}" });
      if (res.status === 429) {
        limited = true;
        assert.ok(Number(res.headers.get("retry-after")) > 0, "429 carries Retry-After");
        break;
      }
      assert.equal(res.status, 200);
    }
    assert.ok(limited, "60 recommend calls in a minute must exhaust the financialWrite bucket");
    // Execute shares the same bucket and client, so it is refused too —
    // even before the plan lookup runs.
    const execute = await fetch(`${base}/api/allocation/plans/no-such-plan/execute`, { method: "POST", headers: OWNER });
    assert.equal(execute.status, 429);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
