import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettleServer } from "../src/server/routes.ts";
import { seedJobs } from "../src/server/seed.ts";
import { ProductStore } from "../src/server/productStore.ts";
import { FinancialStore } from "../src/server/financialStore.ts";

process.env.SETTLE_OWNER_TOKEN = "product-api-owner-secret";
const TOKEN = process.env.SETTLE_OWNER_TOKEN;

async function setup() {
  const path = join(mkdtempSync(join(tmpdir(), "settle-product-api-")), "product.db");
  const productStore = new ProductStore(path);
  const app = createSettleServer({ jobs: seedJobs("receiver@example.test"), allowlistedEmails: new Set(["receiver@example.test"]), productStore });
  const port = await app.listen(0);
  return { app, productStore, base: `http://127.0.0.1:${port}` };
}
async function login(base: string) {
  const response = await fetch(`${base}/api/product/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  return { cookie, body: await response.json() as { user: { userId: string; displayName: string } } };
}

test("first run exposes illustrative demo without a fake authenticated owner", async () => {
  const { app, base } = await setup();
  try {
    const session = await (await fetch(`${base}/api/product/session`)).json() as { authenticated: boolean; user: null };
    assert.equal(session.authenticated, false);
    assert.equal(session.user, null);
    const response = await fetch(`${base}/api/product/workspaces/demo`);
    assert.equal(response.status, 200);
    const body = await response.json() as { workspace: { kind: string; owner: null }; jobs: Array<{ origin: string }>; receipts: Array<{ verificationState: string }>; capabilities: { canPay: boolean } };
    assert.equal(body.workspace.kind, "demo");
    assert.equal(body.workspace.owner, null);
    assert.ok(body.jobs.every((job) => ["synthetic", "seed"].includes(job.origin)));
    assert.equal(body.receipts[0].verificationState, "historical_evidence_only");
    assert.equal(body.capabilities.canPay, false);
  } finally { await app.close(); }
});

test("owner login uses an HttpOnly session and operational data requires membership", async () => {
  const { app, base } = await setup();
  try {
    const denied = await fetch(`${base}/api/product/workspaces/operational`);
    assert.equal(denied.status, 401);
    const bad = await fetch(`${base}/api/product/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "wrong" }) });
    assert.equal(bad.status, 401);
    const { cookie, body } = await login(base);
    assert.equal(body.user.displayName, "Workspace owner");
    const createdResponse = await fetch(`${base}/api/product/workspaces`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Owner Studio" }) });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { workspace: { workspaceId: string; owner: { userId: string } } };
    assert.equal(created.workspace.owner.userId, body.user.userId);
    const read = await fetch(`${base}/api/product/workspaces/${created.workspace.workspaceId}`, { headers: { cookie } });
    assert.equal(read.status, 200);
    const unauthenticated = await fetch(`${base}/api/product/workspaces/${created.workspace.workspaceId}`);
    assert.equal(unauthenticated.status, 401);
    const logout = await fetch(`${base}/api/product/auth/logout`, { method: "POST", headers: { cookie } });
    assert.equal(logout.status, 204);
  } finally { await app.close(); }
});

test("operational receipt progresses from unverified to provider-confirmed to independently reconciled", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "settle-product-payment-")), "product.db");
  const productStore = new ProductStore(path);
  const financialStore = new FinancialStore(path);
  const batches = new Map<string, Record<string, unknown>>();
  const fetchFn = (async (url: string, init: Record<string, unknown> = {}) => {
    const method = String(init.method ?? "GET");
    const response = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, headers: { get: () => null } });
    if (method === "POST") {
      const input = JSON.parse(String(init.body)) as { sender_batch_header: { sender_batch_id: string }; items: Array<{ sender_item_id: string; receiver: string; amount: { value: string; currency: string } }> };
      const id = "PAYPAL-BATCH-FIXTURE-1";
      const item = input.items[0];
      batches.set(id, { batch_header: { payout_batch_id: id, sender_batch_id: input.sender_batch_header.sender_batch_id, batch_status: "SUCCESS" }, items: [{ payout_item_id: "PAYPAL-ITEM-FIXTURE-1", transaction_id: "PAYPAL-TX-FIXTURE-1", activity_id: "PAYPAL-ACTIVITY-FIXTURE-1", sender_item_id: item.sender_item_id, transaction_status: "SUCCESS", receiver: item.receiver, payout_item: { amount: item.amount, payout_item_fee: { value: "0.25", currency: "USD" } }, time_processed: "2026-11-10T12:00:00Z" }] });
      return response(201, { batch_header: { payout_batch_id: id, batch_status: "PENDING" } });
    }
    if (url.includes("?")) return response(200, { items: [...batches.values()].map((batch) => ({ batch_header: (batch.batch_header as Record<string, unknown>) })), total_items: batches.size });
    const id = url.split("/").pop()!;
    return response(200, batches.get(id));
  }) as unknown as typeof fetch;
  const app = createSettleServer({ jobs: [], allowlistedEmails: new Set(), productStore, financialStore, baseUrl: "https://api-m.sandbox.paypal.com", token: "fixture-token", fetchFn });
  const port = await app.listen(0); const base = `http://127.0.0.1:${port}`;
  try {
    const { cookie } = await login(base);
    const created = await (await fetch(`${base}/api/product/workspaces`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Sandbox Fixture Studio" }) })).json() as { workspace: { workspaceId: string } };
    const id = created.workspace.workspaceId;
    const job = await (await fetch(`${base}/api/product/workspaces/${id}/jobs`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ title: "Provider-backed fixture", recipientName: "Sandbox recipient", recipientEmail: "sandbox@example.test", amountCents: 1000, dueAt: null, priority: "high" }) })).json() as { job: { jobId: string } };
    const approved = await fetch(`${base}/api/product/workspaces/${id}/jobs/${job.job.jobId}/approve`, { method: "POST", headers: { cookie } });
    assert.equal(approved.status, 200);
    let snapshot = await approved.json() as { receipts: Array<{ verificationState: string }> };
    assert.equal(snapshot.receipts[0].verificationState, "unverified");
    const paid = await fetch(`${base}/api/product/workspaces/${id}/jobs/${job.job.jobId}/pay`, { method: "POST", headers: { cookie } });
    assert.equal(paid.status, 200);
    snapshot = (await paid.json() as { workspace: typeof snapshot }).workspace;
    assert.equal(snapshot.receipts[0].verificationState, "provider_confirmed");
    const reconciled = await fetch(`${base}/api/product/workspaces/${id}/reconcile`, { method: "POST", headers: { cookie } });
    assert.equal(reconciled.status, 200);
    const final = (await reconciled.json() as { workspace: { receipts: Array<{ verificationState: string; payoutBatchId: string; payoutItemId: string; transactionId: string; feeCents: number; lastReconciledAt: string; reconciliationRunId: string }> } }).workspace;
    assert.deepEqual(final.receipts.map((row) => [row.verificationState, row.payoutBatchId, row.payoutItemId, row.transactionId, row.feeCents]), [["reconciled", "PAYPAL-BATCH-FIXTURE-1", "PAYPAL-ITEM-FIXTURE-1", "PAYPAL-TX-FIXTURE-1", 25]]);
    assert.ok(final.receipts[0].lastReconciledAt);
    assert.ok(final.receipts[0].reconciliationRunId);
    const detailResponse = await fetch(`${base}/api/product/workspaces/${id}/receipts/receipt-${job.job.jobId}`, { headers: { cookie } });
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as { providerEvidence: { payout_item_id: string } | null };
    assert.equal(detail.providerEvidence?.payout_item_id, "PAYPAL-ITEM-FIXTURE-1");
  } finally { await app.close(); productStore.close(); financialStore.close(); }
});

test("legacy demo routes stay live alongside the product model and still require the owner token", async () => {
  const { app, base } = await setup();
  try {
    // No owner token: the legacy approve route still refuses with 401.
    const anonymous = await fetch(`${base}/api/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: "demo-approve-1" }) });
    assert.equal(anonymous.status, 401);
    // With the owner token: the legacy routes are not disabled (no 410).
    // Approve runs the legacy flow; pay reaches the credentials check (503
    // here, because this test server has no PayPal credentials); plan
    // execution reaches the allocation-store check (503 here).
    const approve = await fetch(`${base}/api/approve`, { method: "POST", headers: { "x-settle-owner-token": TOKEN!, "Content-Type": "application/json" }, body: JSON.stringify({ job_id: "demo-approve-1" }) });
    assert.equal(approve.status, 200);
    const pay = await fetch(`${base}/api/pay`, { method: "POST", headers: { "x-settle-owner-token": TOKEN!, "Content-Type": "application/json" }, body: JSON.stringify({}) });
    assert.equal(pay.status, 503);
    const execute = await fetch(`${base}/api/allocation/plans/demo/execute`, { method: "POST", headers: { "x-settle-owner-token": TOKEN! } });
    assert.equal(execute.status, 503);
  } finally { await app.close(); }
});

test("demo reset rejects anonymous callers and cannot invoke operational payment APIs", async () => {
  const { app, base } = await setup();
  try {
    const anonymous = await fetch(`${base}/api/product/workspaces/demo/reset`, { method: "POST" });
    assert.equal(anonymous.status, 401);
    const { cookie } = await login(base);
    const approve = await fetch(`${base}/api/product/workspaces/demo/jobs/demo-approval/approve`, { method: "POST", headers: { cookie } });
    assert.equal(approve.status, 409);
    const pay = await fetch(`${base}/api/product/workspaces/demo/jobs/demo-waiting/pay`, { method: "POST", headers: { cookie } });
    assert.equal(pay.status, 409);
    const reset = await fetch(`${base}/api/product/workspaces/demo/reset`, { method: "POST", headers: { cookie } });
    assert.equal(reset.status, 200);
  } finally { await app.close(); }
});
