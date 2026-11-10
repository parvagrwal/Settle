// HTTP contract of the payment operations endpoints, written before the routes.
//
// Three properties matter more than the shapes: the endpoints are read-only,
// they never widen what a signed-out visitor can already see, and the numbers
// they carry are the ledger's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettleServer } from "../src/server/routes.ts";
import { ProductStore } from "../src/server/productStore.ts";
import { FinancialStore } from "../src/server/financialStore.ts";
import { TransactionStore } from "../src/server/transactionStore.ts";
import { seedJobs } from "../src/server/seed.ts";

process.env.SETTLE_OWNER_TOKEN = "operations-owner";
const TOKEN = "operations-owner";

function mockPayPal() {
  const batches = new Map<string, { sender: string; amount: string }>();
  let seq = 0;
  const fetchFn = (async (url: string, init: Record<string, unknown> = {}) => {
    const path = String(url);
    const reply = (status: number, payload: unknown) => ({ status, ok: status < 300, json: async () => payload, headers: { get: () => null } });
    if (path.includes("/v1/payments/payouts")) {
      if (init.method === "POST") {
        const body = JSON.parse(String(init.body)) as { sender_batch_header: { sender_batch_id: string }; items: Array<{ amount: { value: string } }> };
        const id = `BATCH-OPS-${++seq}`;
        batches.set(id, { sender: body.sender_batch_header.sender_batch_id, amount: body.items[0].amount.value });
        return reply(201, { batch_header: { payout_batch_id: id, batch_status: "PENDING" } });
      }
      const id = path.split("/").pop()!;
      return reply(200, {
        batch_header: { payout_batch_id: id, batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: batches.get(id)?.sender ?? "" } },
        items: [{
          payout_item_id: `ITEM-${id}`, payout_batch_id: id, transaction_id: `TX-${id}`, transaction_status: "SUCCESS",
          payout_item_fee: { value: "0.25", currency: "USD" },
          payout_item: { sender_item_id: batches.get(id)?.sender, receiver: "contractor@example.test", amount: { value: batches.get(id)?.amount ?? "0.00", currency: "USD" } },
        }],
      });
    }
    throw new Error(`unexpected call ${init.method ?? "GET"} ${path}`);
  }) as unknown as typeof fetch;
  return { fetchFn };
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "settle-operations-"));
  const dbPath = join(dir, "operations.db");
  const productStore = new ProductStore(dbPath);
  const financialStore = new FinancialStore(dbPath);
  const transactionStore = new TransactionStore(dbPath);
  const app = createSettleServer({
    jobs: seedJobs("sandbox-receiver@example.com"), allowlistedEmails: new Set<string>(), productStore, financialStore, transactionStore,
    baseUrl: "https://api-m.sandbox.paypal.com", token: "test-token", fetchFn: mockPayPal().fetchFn,
  });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/product/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const created = await fetch(`${base}/api/product/workspaces`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Operations Studio" }) });
  const workspaceId = ((await created.json()) as { workspace: { workspaceId: string } }).workspace.workspaceId;
  const post = (path: string) => fetch(`${base}/api/product/workspaces/${workspaceId}${path}`, { method: "POST", headers: { cookie } });
  const createJob = async (title: string, amountCents: number, dueAt: string | null = null) => {
    const res = await fetch(`${base}/api/product/workspaces/${workspaceId}/jobs`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ title, recipientName: "Contractor", recipientEmail: "contractor@example.test", amountCents, priority: "normal", dueAt }) });
    assert.equal(res.status, 201);
    return ((await res.json()) as { job: { jobId: string } }).job.jobId;
  };
  const paidJob = await createJob("Landing page", 4000);
  assert.equal((await post(`/jobs/${paidJob}/approve`)).status, 200);
  assert.equal((await post(`/jobs/${paidJob}/pay`)).status, 200);
  const openJob = await createJob("Logo refresh", 900, "2026-12-01");
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, { headers });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { app, base, cookie, workspaceId, paidJob, openJob, get, financialStore, productStore };
}

test("a signed-out visitor sees demonstration records only; the owner also sees operational obligations with ledger identity", async () => {
  const ctx = await setup();
  try {
    const anonymous = await ctx.get("/api/operations");
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.body.access.scope, "public");
    assert.equal(anonymous.body.access.signedIn, false);
    const anonymousRows = anonymous.body.rows as Array<Record<string, any>>;
    assert.ok(anonymousRows.length >= 12, "legacy seed rows and the demonstration workspace are listed");
    assert.ok(anonymousRows.every((row) => row.isDemonstration === true));
    assert.ok(anonymousRows.every((row) => row.paymentId === null));
    assert.equal(anonymousRows.find((row) => row.jobId === ctx.paidJob), undefined, "operational rows are not public");
    assert.equal(JSON.stringify(anonymous.body).includes("contractor@example.test"), false, "no operational recipient email leaks");

    const owner = await ctx.get("/api/operations", { cookie: ctx.cookie });
    assert.equal(owner.body.access.scope, "owner");
    const paid = (owner.body.rows as Array<Record<string, any>>).find((row) => row.jobId === ctx.paidJob)!;
    assert.equal(paid.operationId, `workspace/${ctx.paidJob}`);
    assert.equal(paid.title, "Landing page");
    assert.equal(paid.recordOrigin, "application");
    assert.equal(paid.paymentStatus, "provider_confirmed");
    assert.match(paid.paymentId, /^[0-9a-f-]{36}$/);
    assert.equal(paid.payoutBatchId, "BATCH-OPS-1");
    assert.equal(paid.payoutItemId, "ITEM-BATCH-OPS-1");
    assert.equal(paid.transactionId, "TX-BATCH-OPS-1");
    assert.equal(paid.providerFeeCents, 25);
    assert.equal(paid.feeEstimateCents, 25);
    assert.match(paid.executionRunId, /.+/);
    const open = (owner.body.rows as Array<Record<string, any>>).find((row) => row.jobId === ctx.openJob)!;
    assert.equal(open.needsApproval, true);
    assert.equal(open.paymentId, null);
  } finally { await ctx.app.close(); }
});

test("capacity in the operations snapshot equals the financial report served by the same process", async () => {
  const ctx = await setup();
  try {
    const [operations, report] = await Promise.all([ctx.get("/api/operations", { cookie: ctx.cookie }), ctx.get("/api/financial/report", { cookie: ctx.cookie })]);
    assert.equal(operations.body.capacity.rollingSpendCents, report.body.metrics.rollingWindowSpend.value);
    assert.equal(operations.body.capacity.rollingSpendCents, 4000);
    assert.equal(operations.body.capacity.remainingCents, report.body.cap.remainingCents);
    assert.equal(operations.body.capacity.activeExposureCents, report.body.cap.activeReservationsCents);
    assert.equal(operations.body.capacity.budgetCents, 150000);
  } finally { await ctx.app.close(); }
});

test("payment detail: the public view names what it withholds; the owner sees the audit trail and the fee record", async () => {
  const ctx = await setup();
  try {
    const id = encodeURIComponent(`workspace/${ctx.paidJob}`);
    const hidden = await ctx.get(`/api/operations/payments/${id}`);
    assert.equal(hidden.status, 404, "an operational payment is not addressable without the owner session");

    const detail = await ctx.get(`/api/operations/payments/${id}`, { cookie: ctx.cookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.row.operationId, `workspace/${ctx.paidJob}`);
    assert.equal(detail.body.audit.access, "granted");
    const actions = (detail.body.audit.events as Array<{ action: string; source: string }>).map((event) => event.action);
    for (const expected of ["payment_approved", "payment_reserved", "payment_submitted", "provider_item_updated"]) assert.ok(actions.includes(expected), `${expected} in audit history`);
    assert.ok(actions.includes("job_created") || actions.includes("job_approved"), "workspace audit rows are merged in");
    assert.equal(detail.body.fees.provider.reportedFeeMinor, 25);
    assert.equal(detail.body.fees.estimate.estimatedFeeMinor, 25);
    assert.equal(detail.body.identity.paymentId, detail.body.row.paymentId);
    assert.equal(detail.body.identity.recipientEmail, "contractor@example.test");
    assert.equal(detail.body.executionRun.status, "succeeded");
    const timeline = detail.body.timeline as Array<{ kind: string; state: string }>;
    assert.deepEqual(timeline.map((step) => step.kind), ["authorization", "submission", "provider_acknowledgement", "item_outcome", "transaction", "reconciliation"]);
    assert.equal(timeline.find((step) => step.kind === "transaction")!.state, "complete");
    assert.equal(timeline.find((step) => step.kind === "reconciliation")!.state, "missing");
    assert.equal(JSON.stringify(detail.body).includes("raw_json"), false);

    const seeded = await ctx.get(`/api/operations/payments/${encodeURIComponent("legacy/settle-audit-1")}`);
    assert.equal(seeded.status, 200);
    assert.equal(seeded.body.audit.access, "not_applicable");
    assert.deepEqual(seeded.body.audit.events, []);
    assert.equal(seeded.body.identity.paymentId, null);
    assert.equal(seeded.body.fees.estimate, null);
    assert.equal(seeded.body.executionRun, null);

    const missing = await ctx.get(`/api/operations/payments/${encodeURIComponent("legacy/does-not-exist")}`);
    assert.equal(missing.status, 404);
  } finally { await ctx.app.close(); }
});

test("a legacy ledger payment's audit trail needs the owner token; without it the response says so instead of pretending there is none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settle-operations-legacy-"));
  const financialStore = new FinancialStore(join(dir, "legacy.db"));
  financialStore.verifyRecipient({ recipientId: "rc-1", email: "legacy@example.test", actor: { actorId: "owner", role: "owner" }, at: "2026-11-09T09:00:00.000Z" });
  financialStore.approvePayment({ jobId: "legacy-app-1", recipientId: "rc-1", amountCents: 1500, currency: "USD", actor: { actorId: "owner", role: "owner" }, at: "2026-11-09T09:00:00.000Z" });
  const app = createSettleServer({
    jobs: [{ job_id: "legacy-app-1", freelancer_id: "freelancer-9", paypal_email: "legacy@example.test", amount_cents: 1500, currency: "USD", origin: "application", approval_state: "approved", approved_at: Date.parse("2026-11-09T09:00:00Z"), status: "waiting", payout_batch_id: null, payout_item_id: null, decision_reason: null }],
    allowlistedEmails: new Set<string>(), financialStore,
  });
  const port = await app.listen(0);
  try {
    const url = `http://127.0.0.1:${port}/api/operations/payments/${encodeURIComponent("legacy/legacy-app-1")}`;
    const anonymous = await (await fetch(url)).json() as Record<string, any>;
    assert.equal(anonymous.audit.access, "owner_required");
    assert.deepEqual(anonymous.audit.events, []);
    assert.equal(anonymous.identity.recipientEmail, null);
    assert.equal(anonymous.identity.idempotencyKey, null);
    assert.match(anonymous.row.paymentId, /^[0-9a-f-]{36}$/);
    const wrong = await (await fetch(url, { headers: { "x-settle-owner-token": "nope" } })).json() as Record<string, any>;
    assert.equal(wrong.audit.access, "owner_required");
    const owner = await (await fetch(url, { headers: { "x-settle-owner-token": TOKEN } })).json() as Record<string, any>;
    assert.equal(owner.audit.access, "granted");
    assert.ok((owner.audit.events as Array<{ action: string }>).some((event) => event.action === "payment_approved"));
    assert.equal(owner.identity.recipientEmail, "legacy@example.test");
    assert.equal(owner.identity.idempotencyKey, "settle-payment-legacy-app-1");
  } finally { await app.close(); }
});

test("investigation returns the contract, only identifiers the requester can see, and rejects malformed questions", async () => {
  const ctx = await setup();
  try {
    const ask = async (question: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(`${ctx.base}/api/operations/investigate`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ question }) });
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    const anonymous = await ask("Which payments are awaiting approval?");
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.body.contractVersion, 1);
    assert.equal(anonymous.body.intent, "awaiting_approval");
    assert.equal(anonymous.body.readOnly, true);
    const visible = new Set(((await ctx.get("/api/operations")).body.rows as Array<{ operationId: string }>).map((row) => row.operationId));
    assert.ok(anonymous.body.paymentIds.length > 0);
    for (const id of anonymous.body.paymentIds as string[]) assert.ok(visible.has(id), `${id} is visible to the requester`);
    assert.equal((anonymous.body.paymentIds as string[]).includes(`workspace/${ctx.openJob}`), false);

    const owner = await ask("Which payments are awaiting approval?", { cookie: ctx.cookie });
    assert.ok((owner.body.paymentIds as string[]).includes(`workspace/${ctx.openJob}`));

    const unreconciled = await ask("Which payments remain unreconciled?", { cookie: ctx.cookie });
    assert.deepEqual(unreconciled.body.paymentIds, [`workspace/${ctx.paidJob}`]);
    assert.equal(unreconciled.body.suggestedGridAction.type, "open_payment");

    for (const bad of ["", "ab", "x".repeat(501), 42, null]) assert.equal((await ask(bad)).status, 400, `rejects ${JSON.stringify(bad)?.slice(0, 20)}`);
  } finally { await ctx.app.close(); }
});

test("the operations endpoints write nothing: ledger audit, workspace audit, receipts and capacity are identical after repeated reads", async () => {
  const ctx = await setup();
  try {
    const user = ctx.productStore.getUserBySession(decodeURIComponent(ctx.cookie.split("=")[1]));
    assert.ok(user, "the session resolves to the owner");
    const state = () => JSON.stringify({
      financialAudit: ctx.financialStore.getAudit(),
      productAudit: ctx.productStore.listAudit(ctx.workspaceId, user.userId),
      receipts: [ctx.productStore.listReceipts("demo", null), ctx.productStore.listReceipts(ctx.workspaceId, user.userId)],
      cap: ctx.financialStore.getCapSummary("2026-11-10T12:00:00.000Z"),
      control: ctx.financialStore.getControlState(),
    });
    const before = state();
    for (let i = 0; i < 3; i++) {
      await ctx.get("/api/operations", { cookie: ctx.cookie });
      await ctx.get("/api/operations");
      await ctx.get(`/api/operations/payments/${encodeURIComponent(`workspace/${ctx.paidJob}`)}`, { cookie: ctx.cookie });
      await fetch(`${ctx.base}/api/operations/investigate`, { method: "POST", headers: { "Content-Type": "application/json", cookie: ctx.cookie }, body: JSON.stringify({ question: "Which payments need attention?" }) });
    }
    assert.equal(state(), before);
  } finally { await ctx.app.close(); }
});

test("there is no mutating verb on the operations resources", async () => {
  const ctx = await setup();
  try {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const list = await fetch(`${ctx.base}/api/operations`, { method, headers: { cookie: ctx.cookie, "x-settle-owner-token": TOKEN } });
      assert.ok([404, 405].includes(list.status), `${method} /api/operations -> ${list.status}`);
      const detail = await fetch(`${ctx.base}/api/operations/payments/${encodeURIComponent(`workspace/${ctx.paidJob}`)}`, { method, headers: { cookie: ctx.cookie, "x-settle-owner-token": TOKEN } });
      assert.ok([404, 405].includes(detail.status), `${method} detail -> ${detail.status}`);
    }
  } finally { await ctx.app.close(); }
});
