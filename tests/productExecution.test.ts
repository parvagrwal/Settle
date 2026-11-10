// Operational workspace execution contract, written before the routes changed.
//
// The workspace is where a real obligation becomes a real sandbox payout, so
// these tests care about identity: one run per owner action, one provider item
// per job, a fee record that separates estimate from evidence, a rejection that
// cannot silently un-authorize money already promised, and an emergency stop
// that stops the next call rather than the one in flight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettleServer } from "../src/server/routes.ts";
import { ProductStore } from "../src/server/productStore.ts";
import { FinancialStore } from "../src/server/financialStore.ts";

process.env.SETTLE_OWNER_TOKEN = "product-exec-owner";
const TOKEN = "product-exec-owner";

function mockPayPal(opts: { itemStatus?: string } = {}) {
  const batches = new Map<string, { sender: string; amount: string }>();
  const posts: Array<{ sender_batch_header: { sender_batch_id: string } }> = [];
  let seq = 0;
  const fetchFn = (async (url: string, init: Record<string, unknown> = {}) => {
    const path = String(url);
    const reply = (status: number, payload: unknown) => ({ status, ok: status < 300, json: async () => payload, headers: { get: () => null } });
    if (path.includes("/v1/oauth2/token")) return reply(200, { access_token: "t", expires_in: 3600 });
    if (path.includes("/v2/invoicing")) return reply(201, { href: "/v2/invoicing/invoices/INV-1", status: "DRAFT" });
    if (path.includes("/v1/payments/payouts")) {
      if (init.method === "POST") {
        const body = JSON.parse(String(init.body)) as { sender_batch_header: { sender_batch_id: string }; items: Array<{ amount: { value: string } }> };
        posts.push(body as unknown as { sender_batch_header: { sender_batch_id: string } });
        const id = `BATCH-PX-${++seq}`;
        batches.set(id, { sender: body.sender_batch_header.sender_batch_id, amount: body.items[0].amount.value });
        return reply(201, { batch_header: { payout_batch_id: id, batch_status: "PENDING" } });
      }
      const id = path.split("/").pop()!;
      return reply(200, {
        batch_header: { payout_batch_id: id, batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: batches.get(id)?.sender ?? "" } },
        items: [{
          payout_item_id: `ITEM-PX-${id}`,
          payout_batch_id: id,
          transaction_id: `TX-PX-${id}`,
          transaction_status: opts.itemStatus ?? "SUCCESS",
          payout_item_fee: { value: "0.25", currency: "USD" },
          payout_item: { sender_item_id: batches.get(id)?.sender, receiver: "contractor@example.test", amount: { value: batches.get(id)?.amount ?? "0.00", currency: "USD" } },
        }],
      });
    }
    throw new Error(`unexpected call ${init.method ?? "GET"} ${path}`);
  }) as unknown as typeof fetch;
  return { fetchFn, posts };
}

async function setup(opts: { itemStatus?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "settle-product-exec-"));
  const dbPath = join(dir, "product.db");
  const productStore = new ProductStore(dbPath);
  const financialStore = new FinancialStore(dbPath);
  const mock = mockPayPal(opts);
  const app = createSettleServer({
    jobs: [],
    allowlistedEmails: new Set<string>(),
    productStore,
    financialStore,
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    fetchFn: mock.fetchFn,
  });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const loginRes = await fetch(`${base}/api/product/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get("set-cookie")!.split(";")[0];
  const created = await fetch(`${base}/api/product/workspaces`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Execution Studio" }),
  });
  assert.equal(created.status, 201);
  const workspaceId = ((await created.json()) as { workspace: { workspaceId: string } }).workspace.workspaceId;
  const snapshot = async () => {
    const res = await fetch(`${base}/api/product/workspaces/${workspaceId}`, { headers: { cookie } });
    assert.equal(res.status, 200);
    return (await res.json()) as Record<string, any>;
  };
  const createJob = async (amountCents = 4000, title = "Landing page") => {
    const res = await fetch(`${base}/api/product/workspaces/${workspaceId}/jobs`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title, recipientName: "Contractor", recipientEmail: "contractor@example.test", amountCents, priority: "normal" }),
    });
    assert.equal(res.status, 201);
    return ((await res.json()) as { job: { jobId: string } }).job.jobId;
  };
  return { app, base, cookie, workspaceId, snapshot, createJob, mock, productStore, financialStore };
}

test("paying a workspace job records one execution run with provider item identity and a fee record", async () => {
  const ctx = await setup();
  try {
    const jobId = await ctx.createJob(4000);
    const approve = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/approve`, { method: "POST", headers: { cookie: ctx.cookie } });
    assert.equal(approve.status, 200);

    const pay = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/pay`, { method: "POST", headers: { cookie: ctx.cookie } });
    assert.equal(pay.status, 200);
    const body = (await pay.json()) as {
      result: { status: string; batchStatus: string; payoutBatchId: string | null };
      execution_run: { runId: string; status: string; items: Array<{ jobId: string; payoutBatchId: string | null; payoutItemId: string | null; transactionId: string | null; providerStatus: string | null }>; batches: Array<{ payoutBatchId: string; itemCount: number; status: string }> };
      workspace: { fees: Array<{ jobId: string; estimate: { estimatedFeeMinor: number } | null; provider: { reportedFeeMinor: number } | null; consistent: boolean | null; explanation: string }>; control: { emergencyStop: boolean } };
    };
    assert.equal(body.result.status, "provider_confirmed");
    assert.equal(body.result.batchStatus, "SUCCESS");
    assert.equal(body.execution_run.status, "succeeded");
    assert.equal(body.execution_run.items.length, 1);
    const item = body.execution_run.items[0];
    assert.equal(item.jobId, jobId);
    assert.ok(item.payoutBatchId);
    assert.ok(item.payoutItemId);
    assert.ok(item.transactionId);
    assert.equal(item.providerStatus, "SUCCESS");
    assert.equal(body.execution_run.batches.length, 1);
    assert.equal(body.execution_run.batches[0].itemCount, 1);

    const fee = body.workspace.fees.find((row) => row.jobId === jobId)!;
    assert.equal(fee.estimate?.estimatedFeeMinor, 25, "the Payouts API flat fee is 25 cents per item");
    assert.equal(fee.provider?.reportedFeeMinor, 25);
    assert.equal(fee.consistent, true, "estimate and provider amount agree here; they are still stored separately");
    assert.match(fee.explanation, /matches the published estimate/i);
    assert.equal(ctx.mock.posts.length, 1);

    const snapshot = await ctx.snapshot();
    assert.equal(snapshot.capabilities.canPay, true);
    assert.equal(snapshot.control.emergencyStop, false);
    assert.equal(snapshot.receipts[0].verificationState, "provider_confirmed");
  } finally {
    await ctx.app.close();
  }
});

test("a newly approved workspace obligation cannot be rejected, and a rejected one never reaches PayPal", async () => {
  const ctx = await setup();
  try {
    const jobId = await ctx.createJob(1000, "Logo");
    const rejectBefore = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/reject`, {
      method: "POST",
      headers: { cookie: ctx.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "duplicate invoice" }),
    });
    assert.equal(rejectBefore.status, 200);
    const snapshot = await ctx.snapshot();
    assert.ok(snapshot.audit.some((row: { action: string; reason: string }) => row.action === "job_rejected" && /duplicate invoice/.test(row.reason)));
    assert.equal(ctx.mock.posts.length, 0);

    const noReason = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/reject`, {
      method: "POST",
      headers: { cookie: ctx.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "   " }),
    });
    assert.equal(noReason.status, 400);

    const approve = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/approve`, { method: "POST", headers: { cookie: ctx.cookie } });
    assert.equal(approve.status, 200);
    const rejectAfter = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/reject`, {
      method: "POST",
      headers: { cookie: ctx.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "changed my mind" }),
    });
    assert.equal(rejectAfter.status, 409);
    assert.match(((await rejectAfter.json()) as { error: string }).error, /payment identity/);
  } finally {
    await ctx.app.close();
  }
});

test("the workspace emergency stop is durable, refuses the next payout before any provider call, and can be cleared", async () => {
  const ctx = await setup();
  try {
    const jobId = await ctx.createJob(2000, "Illustration");
    await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/approve`, { method: "POST", headers: { cookie: ctx.cookie } });
    const stop = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/control`, {
      method: "POST",
      headers: { cookie: ctx.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ emergencyStop: true, reason: "suspicious recipient" }),
    });
    assert.equal(stop.status, 200);
    const stopped = (await stop.json()) as { control: { emergencyStop: boolean; reason: string }; capabilities: { canPay: boolean } };
    assert.equal(stopped.control.emergencyStop, true);
    assert.equal(stopped.capabilities.canPay, false);

    const pay = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/pay`, { method: "POST", headers: { cookie: ctx.cookie } });
    assert.equal(pay.status, 409);
    assert.match(((await pay.json()) as { error: string }).error, /EMERGENCY_STOP/);
    assert.equal(ctx.mock.posts.length, 0, "no provider call is made while the stop is engaged");

    const clear = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/control`, {
      method: "POST",
      headers: { cookie: ctx.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ emergencyStop: false, reason: "reviewed" }),
    });
    assert.equal(((await clear.json()) as { control: { emergencyStop: boolean } }).control.emergencyStop, false);
    const afterPay = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/pay`, { method: "POST", headers: { cookie: ctx.cookie } });
    assert.equal(afterPay.status, 200);
    assert.equal(ctx.mock.posts.length, 1);
  } finally {
    await ctx.app.close();
  }
});

test("the stop survives a restart because it lives in the database, not in the request handler", async () => {
  const ctx = await setup();
  try {
    await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/control`, {
      method: "POST",
      headers: { cookie: ctx.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ emergencyStop: true, reason: "restart drill" }),
    });
    await ctx.app.close();
    const reopened = new FinancialStore(ctx.financialStore.path());
    try {
      assert.equal(reopened.getControlState().emergencyStop, true);
      assert.equal(reopened.isEmergencyStopped(), true);
    } finally {
      reopened.close();
    }
  } finally {
    // ctx.app.close() is idempotent in practice; guard anyway.
    await ctx.app.close().catch(() => undefined);
  }
});

test("the demonstration workspace cannot change execution control or reach the ledger", async () => {
  const ctx = await setup();
  try {
    const control = await fetch(`${ctx.base}/api/product/workspaces/demo/control`, {
      method: "POST",
      headers: { cookie: ctx.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ emergencyStop: true, reason: "demo" }),
    });
    assert.equal(control.status, 409);
    const snapshot = (await (await fetch(`${ctx.base}/api/product/workspaces/demo`, { headers: { cookie: ctx.cookie } })).json()) as Record<string, any>;
    assert.equal(snapshot.capabilities.canPay, false);
    assert.equal(snapshot.capabilities.canControl, false);
    assert.equal(snapshot.fees.length, 0, "synthetic receipts have no fee evidence");
  } finally {
    await ctx.app.close();
  }
});

test("a provider FAILED workspace item is recorded as failed and never shown as confirmed", async () => {
  const ctx = await setup({ itemStatus: "FAILED" });
  try {
    const jobId = await ctx.createJob(3000, "Motion");
    await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/approve`, { method: "POST", headers: { cookie: ctx.cookie } });
    const pay = await fetch(`${ctx.base}/api/product/workspaces/${ctx.workspaceId}/jobs/${jobId}/pay`, { method: "POST", headers: { cookie: ctx.cookie } });
    assert.equal(pay.status, 200);
    const body = (await pay.json()) as {
      result: { status: string; batchStatus: string };
      execution_run: { status: string; items: Array<{ status: string; providerStatus: string | null }> };
      workspace: { receipts: Array<{ verificationState: string; providerStatus: string | null }> };
    };
    assert.equal(body.result.status, "failed");
    assert.equal(body.result.batchStatus, "FAILED");
    assert.equal(body.execution_run.status, "failed");
    assert.equal(body.execution_run.items[0].providerStatus, "FAILED");
    const receipt = body.workspace.receipts.find((row) => row.providerStatus === "FAILED")!;
    assert.equal(receipt.verificationState, "provider_response_received");

    const report = (await (await fetch(`${ctx.base}/api/financial/report`, { headers: { "x-settle-owner-token": "product-exec-owner" } })).json()) as { metrics: Record<string, { value: number }> };
    assert.equal(report.metrics.lifetimeConfirmedGross.value, 0);
    assert.equal(report.metrics.failed.value, 3000);
  } finally {
    await ctx.app.close();
  }
});
