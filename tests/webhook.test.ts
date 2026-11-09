import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettleServer } from "../src/server/routes.ts";
import { TransactionStore } from "../src/server/transactionStore.ts";
import { payoutItemEvent } from "./fixtures/paypalEvents.ts";

const headers = {
  "content-type": "application/json",
  "paypal-transmission-id": "TRANSMISSION-1",
  "paypal-transmission-time": "2026-11-09T10:00:02Z",
  "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-transmission-sig": "signature",
};

function paypalMock(status = "SUCCESS") {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchFn = (async (url: string, init: Record<string, unknown>) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return {
      ok: true, status: 200,
      json: async () => ({ verification_status: status }),
      headers: { get: () => null },
    };
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function setup(verificationStatus = "SUCCESS") {
  const transactionStore = new TransactionStore(":memory:");
  const mock = paypalMock(verificationStatus);
  const app = createSettleServer({
    jobs: [], allowlistedEmails: new Set(), transactionStore, webhookId: "WEBHOOK-1",
    baseUrl: "https://api-m.sandbox.paypal.com", token: "token", fetchFn: mock.fetchFn,
  });
  return { app, transactionStore, mock };
}

async function post(port: number, body: unknown, customHeaders: Record<string, string> = headers): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/webhooks/paypal`, { method: "POST", headers: customHeaders, body: typeof body === "string" ? body : JSON.stringify(body) });
}

test("webhook fails closed before parsing/processing when required headers are missing", async () => {
  const { app, transactionStore, mock } = setup();
  const port = await app.listen(0);
  try {
    const res = await post(port, payoutItemEvent(), { "content-type": "application/json" });
    assert.equal(res.status, 400);
    assert.equal(mock.calls.length, 0);
    assert.equal(transactionStore.currentSequence(), 0);
  } finally { await app.close(); transactionStore.close(); }
});

test("PayPal verification failure returns 401 and stores nothing", async () => {
  const { app, transactionStore } = setup("FAILURE");
  const port = await app.listen(0);
  try {
    const res = await post(port, payoutItemEvent());
    assert.equal(res.status, 401);
    assert.equal(transactionStore.currentSequence(), 0);
  } finally { await app.close(); transactionStore.close(); }
});

test("verified raw event reaches idempotent store and persisted delta/history APIs", async () => {
  const { app, transactionStore, mock } = setup();
  const port = await app.listen(0);
  try {
    const event = payoutItemEvent();
    const res = await post(port, event);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { verification: "SUCCESS", outcome: "applied", duplicate: false, rowKey: "POI-1" });
    const verification = mock.calls[0];
    assert.equal(verification.url, "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    assert.deepEqual(verification.body, {
      transmission_id: "TRANSMISSION-1", transmission_time: "2026-11-09T10:00:02Z",
      cert_url: "https://api.sandbox.paypal.com/cert", auth_algo: "SHA256withRSA",
      transmission_sig: "signature", webhook_id: "WEBHOOK-1", webhook_event: event,
    });
    const duplicate = await post(port, event);
    assert.equal((await duplicate.json()).outcome, "duplicate");
    const delta = await fetch(`http://127.0.0.1:${port}/api/transactions?since=0`);
    const body = await delta.json();
    assert.equal(body.transactions.length, 1);
    assert.equal(body.transactions[0].originalTransactionId, "TX-1");
    assert.equal(body.cursor, 1);
    assert.equal(body.serverTime !== undefined, true);
    const history = await fetch(`http://127.0.0.1:${port}/api/transactions/POI-1/history`);
    assert.equal((await history.json()).events.length, 1);
  } finally { await app.close(); transactionStore.close(); }
});

test("malformed JSON is not stored even when verifier is available", async () => {
  const { app, transactionStore } = setup();
  const port = await app.listen(0);
  try {
    const res = await post(port, "{bad json");
    assert.equal(res.status, 400);
    assert.equal(transactionStore.currentSequence(), 0);
  } finally { await app.close(); transactionStore.close(); }
});
