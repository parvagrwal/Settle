// Full-stack server for browser tests.
//
// The real routes, the real SQLite stores and the built dashboard, with one
// substitution: PayPal is a scripted fake, exactly as in the server's own unit
// tests. The fake decides an outcome from the amount, so a test can put a
// payment in a chosen ledger state by driving the real HTTP API.
//
// Everything created here is labelled as a fixture. Nothing in this file is, or
// may be presented as, PayPal evidence.
//
//   node --experimental-strip-types e2e/support/stack-server.ts
//   PORT=3210 (default)   SETTLE_OWNER_TOKEN=e2e-owner-token (default)
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSettleServer } from "../../src/server/routes.ts";
import { seedJobs } from "../../src/server/seed.ts";
import { TransactionStore } from "../../src/server/transactionStore.ts";
import { AllocationStore } from "../../src/server/allocationStore.ts";
import { FinancialStore } from "../../src/server/financialStore.ts";
import { ProductStore } from "../../src/server/productStore.ts";

process.env.SETTLE_OWNER_TOKEN ??= "e2e-owner-token";
const TOKEN = process.env.SETTLE_OWNER_TOKEN;
const PORT = Number(process.env.PORT ?? "3210");
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Amounts that select a scripted provider outcome. */
const FAILED_AMOUNT = "13.00";
const STUCK_AMOUNT = "17.00";
const LOST_AMOUNT = "19.00";
const SLOW_AMOUNT = "55.00";

function fakePayPal() {
  const batches = new Map<string, { sender: string; amount: string; reads: number }>();
  let sequence = 0;
  let releaseSlow = false;
  const reply = (status: number, payload: unknown) => ({ status, ok: status < 300, json: async () => payload, text: async () => JSON.stringify(payload), headers: { get: () => null } });
  const fetchFn = (async (url: string, init: Record<string, unknown> = {}) => {
    const path = String(url);
    if (path.includes("/v1/oauth2/token")) return reply(200, { access_token: "fixture", expires_in: 3600 });
    if (!path.includes("/v1/payments/payouts")) throw new Error(`fixture PayPal: unexpected call ${String(init.method ?? "GET")} ${path}`);
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body)) as { sender_batch_header: { sender_batch_id: string }; items: Array<{ amount: { value: string } }> };
      const amount = body.items[0].amount.value;
      if (amount === LOST_AMOUNT) throw new Error("fixture PayPal: connection reset before a response was received");
      const id = `FIXTURE-BATCH-${String(++sequence).padStart(2, "0")}`;
      batches.set(id, { sender: body.sender_batch_header.sender_batch_id, amount, reads: 0 });
      return reply(201, { batch_header: { payout_batch_id: id, batch_status: "PENDING" } });
    }
    const id = path.split("?")[0].split("/").pop() ?? "";
    const batch = batches.get(id);
    if (!batch) return reply(404, { name: "RESOURCE_NOT_FOUND" });
    batch.reads += 1;
    const header = { payout_batch_id: id, sender_batch_header: { sender_batch_id: batch.sender } };
    const stillProcessing = batch.amount === STUCK_AMOUNT || (batch.amount === SLOW_AMOUNT && !releaseSlow);
    if (stillProcessing) return reply(200, { batch_header: { ...header, batch_status: "PROCESSING" }, items: [] });
    const failed = batch.amount === FAILED_AMOUNT;
    return reply(200, {
      batch_header: { ...header, batch_status: failed ? "DENIED" : "SUCCESS" },
      items: [{
        payout_item_id: `FIXTURE-ITEM-${id.slice(-2)}`,
        payout_batch_id: id,
        transaction_id: failed ? undefined : `FIXTURE-TX-${id.slice(-2)}`,
        transaction_status: failed ? "FAILED" : "SUCCESS",
        ...(failed ? {} : { payout_item_fee: { value: "0.25", currency: "USD" } }),
        payout_item: { sender_item_id: batch.sender, receiver: "fixture-contractor@example.test", amount: { value: batch.amount, currency: "USD" } },
      }],
    });
  }) as unknown as typeof fetch;
  return { fetchFn, release: () => { releaseSlow = true; } };
}

const directory = mkdtempSync(join(tmpdir(), "settle-e2e-stack-"));
const dbPath = join(directory, "stack.db");
const staticDir = join(root, "app", "dist");
const paypal = fakePayPal();
const app = createSettleServer({
  jobs: seedJobs("sandbox-receiver@example.com"),
  allowlistedEmails: new Set(["sandbox-receiver@example.com"]),
  baseUrl: "https://api-m.sandbox.paypal.com",
  token: "fixture-token",
  fetchFn: paypal.fetchFn,
  transactionStore: new TransactionStore(dbPath),
  allocationStore: new AllocationStore(dbPath),
  financialStore: new FinancialStore(dbPath),
  productStore: new ProductStore(dbPath),
  staticDir: existsSync(join(staticDir, "index.html")) ? staticDir : undefined,
});
const port = await app.listen(PORT);
const base = `http://127.0.0.1:${port}`;

// ---- scenario: one operational workspace with a payment in every state ----
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const login = await fetch(`${base}/api/product/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
if (login.status !== 200) throw new Error(`fixture login failed: ${login.status}`);
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
};
const workspace = await call("POST", "/api/product/workspaces", { name: "E2E fixture studio (mock PayPal)" });
const workspaceId = String(workspace.body.workspace?.workspaceId ?? "");
if (!workspaceId) throw new Error(`fixture workspace failed: ${workspace.status}`);
const ws = `/api/product/workspaces/${workspaceId}`;
await call("PUT", `${ws}/policy`, { perPaymentCapCents: 20000, rollingCapCents: 30000 });

const jobIds: Record<string, string> = {};
const job = async (key: string, title: string, amountCents: number, dueAt: string | null, priority: "high" | "normal" | "low" = "normal") => {
  const created = await call("POST", `${ws}/jobs`, { title, recipientName: "Fixture Contractor", recipientEmail: "fixture-contractor@example.test", amountCents, dueAt, priority });
  if (created.status !== 201) throw new Error(`fixture job ${key} failed: ${created.status} ${JSON.stringify(created.body)}`);
  jobIds[key] = String(created.body.job.jobId);
};
await job("confirmed", "Homepage illustration", 4000, day(-6));
await job("reconciled", "Brand guidelines PDF", 5500, day(-4));
await job("failed", "Icon set", 1300, day(-2));
await job("awaiting", "Motion teaser", 1700, day(1));
await job("unknown", "Podcast edit", 1900, day(3));
await job("ready", "Newsletter layout", 6000, day(2), "high");
await job("overBudget", "Launch video", 18000, day(9), "low");
await job("overCap", "Trade show booth", 25000, day(20));
await job("overdue", "Social tiles", 2500, day(-1));
await job("dueSoon", "Copy edit", 3000, day(1), "high");
await job("unreconciled", "Press kit", 2100, day(-3));

for (const key of ["confirmed", "reconciled", "failed", "awaiting", "unknown", "ready", "overBudget", "unreconciled"]) {
  const approved = await call("POST", `${ws}/jobs/${jobIds[key]}/approve`);
  if (approved.status !== 200) throw new Error(`fixture approve ${key} failed: ${approved.status} ${JSON.stringify(approved.body)}`);
}
for (const key of ["confirmed", "reconciled", "failed", "awaiting", "unknown"]) {
  const paid = await call("POST", `${ws}/jobs/${jobIds[key]}/pay`);
  if (![200, 202, 400, 500, 502].includes(paid.status)) throw new Error(`fixture pay ${key} failed: ${paid.status} ${JSON.stringify(paid.body)}`);
}
// The slow batch settles, and a reconciliation run re-reads it: that payment becomes "reconciled".
paypal.release();
const reconciled = await call("POST", `${ws}/reconcile`, {});
if (reconciled.status !== 200) throw new Error(`fixture reconcile failed: ${reconciled.status} ${JSON.stringify(reconciled.body)}`);
// Paid last, after the reconciliation run: confirmed by PayPal, never independently re-read.
const last = await call("POST", `${ws}/jobs/${jobIds.unreconciled}/pay`);
if (last.status !== 200) throw new Error(`fixture pay unreconciled failed: ${last.status} ${JSON.stringify(last.body)}`);

const snapshot = await call("GET", ws);
const states = Object.fromEntries((snapshot.body.receipts as Array<Record<string, any>>).map((receipt) => [receipt.title, `${receipt.verificationState}/${receipt.providerStatus ?? "-"}`]));
console.log(`Settle E2E stack: ${base}`);
console.log(`Owner token: ${TOKEN}`);
console.log(`Fixture workspace ${workspaceId} (mock PayPal; not provider evidence)`);
console.log(JSON.stringify({ jobIds, states }));
console.log("READY");

const stop = async () => { await app.close(); process.exit(0); };
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
