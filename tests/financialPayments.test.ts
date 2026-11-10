import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinancialStore } from "../src/server/financialStore.ts";
import { reconcilePayPal, submitApprovedPayment } from "../src/server/financialPayments.ts";
import type { FetchFn } from "../src/server/paypalClient.ts";

const owner = { actorId: "owner", role: "owner" } as const;
const T0 = "2026-11-09T12:00:00Z";

function setup(fetchFn: FetchFn) {
  const store = new FinancialStore(join(mkdtempSync(join(tmpdir(), "settle-finpay-")), "ledger.db"));
  store.verifyRecipient({ recipientId: "r1", email: "worker@example.test", actor: owner, at: T0 });
  store.approvePayment({ jobId: "j1", recipientId: "r1", amountCents: 1000, currency: "USD", actor: owner, at: T0 });
  return { store, opts: { baseUrl: "https://paypal.test", token: "secret", fetchFn, now: () => new Date(T0), pollDelayMs: 0 } };
}
function item(overrides: Record<string, unknown> = {}) {
  return {
    payout_item_id: "ITEM-1",
    transaction_id: "TX-1",
    activity_id: "ACT-1",
    payout_item_fee: { value: "0.02", currency: "USD" },
    payout_batch_id: "BATCH-1",
    transaction_status: "SUCCESS",
    payout_item: {
      sender_item_id: "settle-payment-j1",
      receiver: "worker@example.test",
      amount: { value: "10.00", currency: "USD" },
    },
    time_processed: "2026-11-09T11:59:00Z",
    ...overrides,
  };
}

test("timeout after accept becomes outcome_unknown and restart recovery never creates another payout", async () => {
  const { store, opts } = setup((async (url: string | URL | Request) => {
    assert.ok(!String(url).includes("?"), `must not call undocumented list endpoint: ${url}`);
    throw new Error("network timeout");
  }) as FetchFn);
  await assert.rejects(submitApprovedPayment({ ...opts, store, jobId: "j1" }), /network timeout/);
  assert.equal(store.getPaymentByJob("j1")?.status, "outcome_unknown");
  let createCalls = 0;
  const fetchFn = (async (url: string | URL | Request) => {
    if (String(url).endsWith("/payouts")) { createCalls++; throw new Error("must not create on replay"); }
    throw new Error(`unexpected call ${url}`);
  }) as FetchFn;
  await assert.rejects(submitApprovedPayment({ ...opts, store, fetchFn, jobId: "j1" }), /outcome is unknown/);
  assert.equal(createCalls, 0);
});

test("submission persists complete provider item and confirms only successful item", async () => {
  const fetchFn = (async (url: string | URL | Request) => {
    const path = String(url);
    assert.ok(!path.includes("?"), `must not call undocumented list endpoint: ${path}`);
    if (path.endsWith("/payouts")) return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } }), { status: 201 });
    return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" }, items: [item()] }), { status: 200 });
  }) as FetchFn;
  const { store, opts } = setup(fetchFn);
  const result = await submitApprovedPayment({ ...opts, store, jobId: "j1" });
  assert.equal(result.status, "provider_confirmed");
  assert.equal(result.item?.transactionId, "TX-1");
  assert.equal(result.item?.feeCents, 2);
  assert.equal(store.getCapSummary(T0).confirmedSpendCents, 1000);
});

test("Real PayPal Sandbox payout-poll.json nested payout_item shape parses cleanly", async () => {
  const pollFixture = JSON.parse(readFileSync("evidence/payouts-first-test/payout-poll.json", "utf8")) as {
    batch_header: { payout_batch_id: string; batch_status: string; sender_batch_header: { sender_batch_id: string } };
    items: Array<Record<string, unknown> & { payout_item: { sender_item_id: string; receiver: string; amount: { value: string; currency: string } } }>;
  };
  const expectedBatchId = pollFixture.batch_header.payout_batch_id;

  // 1) Reconcile the exact unmodified multi-item payout-poll.json batch from PayPal Sandbox
  const reconStore = new FinancialStore(join(mkdtempSync(join(tmpdir(), "settle-blocker-a-multi-")), "ledger.db"));
  reconStore.verifyRecipient({ recipientId: "r-real-batch", email: pollFixture.items[0].payout_item.receiver, actor: owner, at: T0 });
  for (const realItem of pollFixture.items) {
    const jobId = realItem.payout_item.sender_item_id;
    reconStore.approvePayment({ jobId, recipientId: "r-real-batch", amountCents: 100, currency: "USD", actor: owner, at: T0 });
    reconStore.unsafeTestOnlySql(`UPDATE payments SET idempotency_key='${realItem.payout_item.sender_item_id}' WHERE job_id='${jobId}'`);
  }
  const reconRec = await reconcilePayPal({
    store: reconStore,
    baseUrl: "https://paypal.test",
    token: "secret",
    batchIds: [expectedBatchId],
    now: () => new Date(T0),
    fetchFn: (async (url: string | URL | Request) => {
      assert.equal(String(url), `https://paypal.test/v1/payments/payouts/${expectedBatchId}`);
      return new Response(JSON.stringify(pollFixture), { status: 200 });
    }) as FetchFn,
  });
  assert.equal(reconRec.batchesRead, 1);
  assert.equal(reconRec.itemsRecorded, 2);
  assert.equal(reconStore.getCapSummary(T0).confirmedSpendCents, 200);
  for (const realItem of pollFixture.items) {
    const payment = reconStore.getPaymentByJob(realItem.payout_item.sender_item_id)!;
    assert.equal(payment.status, "provider_confirmed");
    const saved = reconStore.getPayoutItem(payment.paymentId);
    assert.equal(saved?.payoutItemId, realItem.payout_item_id);
    assert.equal(saved?.feeCents, 2);
  }

  // 2) Submit single-item payout using the exact nested payout_item shape from payout-poll.json
  const realItem = pollFixture.items[0];
  const store = new FinancialStore(join(mkdtempSync(join(tmpdir(), "settle-blocker-a-")), "ledger.db"));
  store.verifyRecipient({ recipientId: "r-real", email: realItem.payout_item.receiver, actor: owner, at: T0 });
  store.approvePayment({ jobId: "job-real-1", recipientId: "r-real", amountCents: 100, currency: "USD", actor: owner, at: T0 });
  store.unsafeTestOnlySql(`UPDATE payments SET idempotency_key='${realItem.payout_item.sender_item_id}' WHERE job_id='job-real-1'`);

  const singlePollFixture = { ...pollFixture, items: [realItem] };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    assert.ok(!path.includes("?"), `must not call undocumented list endpoint: ${path}`);
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ batch_header: { payout_batch_id: expectedBatchId, batch_status: "PENDING" } }), { status: 201 });
    }
    assert.equal(path, `https://paypal.test/v1/payments/payouts/${expectedBatchId}`);
    return new Response(JSON.stringify(singlePollFixture), { status: 200 });
  }) as FetchFn;

  const result = await submitApprovedPayment({
    store,
    baseUrl: "https://paypal.test",
    token: "secret",
    fetchFn,
    now: () => new Date(T0),
    pollDelayMs: 0,
    jobId: "job-real-1",
  });
  assert.equal(result.status, "provider_confirmed");
  assert.equal(result.item?.payoutBatchId, expectedBatchId);
  assert.equal(result.item?.payoutItemId, realItem.payout_item_id);
  assert.equal(result.item?.transactionId, realItem.transaction_id);
  assert.equal(result.item?.activityId, realItem.activity_id);
  assert.equal(result.item?.feeCents, 2);
  assert.equal(store.getCapSummary(T0).confirmedSpendCents, 100);
});

test("reconciliation recovers attempt without batch ID via sender_batch_id duplicate link and never calls list URL", async () => {
  const { store, opts } = setup((async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    assert.ok(!path.includes("?"), `must not call undocumented list endpoint: ${path}`);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { sender_batch_header: { sender_batch_id: string } };
      assert.equal(body.sender_batch_header.sender_batch_id, "settle-payment-j1");
      return new Response(JSON.stringify({
        name: "DUPLICATE_REQUEST_ID",
        message: "Duplicate request id",
        links: [{ href: "https://paypal.test/v1/payments/payouts/BATCH-1", rel: "self", method: "GET" }],
      }), { status: 400 });
    }
    assert.equal(path, "https://paypal.test/v1/payments/payouts/BATCH-1");
    return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: "settle-payment-j1" } }, items: [item()] }), { status: 200 });
  }) as FetchFn);
  store.markReconciled(T0);
  const reservation = store.reservePayment({ jobId: "j1", at: T0 });
  const attempt = store.beginSubmission(reservation.paymentId, T0);
  store.markOutcomeUnknown(attempt.attemptId, "simulated crash during POST", T0);
  const result = await reconcilePayPal({ ...opts, store });
  assert.equal(result.itemsRecorded, 1);
  assert.equal(store.getPaymentByJob("j1")?.status, "provider_confirmed");
  assert.equal(store.getPayoutItem(reservation.paymentId)?.activityId, "ACT-1");
});

test("reconciliation fetches known batch directly without POST when poll failed after create returned batch ID", async () => {
  let postCount = 0;
  let failPoll = true;
  const { store, opts } = setup((async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (init?.method === "POST") {
      postCount++;
      return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } }), { status: 201 });
    }
    if (failPoll) throw new Error("poll socket hang up");
    assert.equal(path, "https://paypal.test/v1/payments/payouts/BATCH-1");
    return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" }, items: [item()] }), { status: 200 });
  }) as FetchFn);

  await assert.rejects(submitApprovedPayment({ ...opts, store, jobId: "j1" }), /poll socket hang up/);
  assert.equal(postCount, 1);
  assert.equal(store.getAttemptBatchId(store.getPaymentByJob("j1")!.paymentId), "BATCH-1");

  failPoll = false;
  const rec = await reconcilePayPal({ ...opts, store });
  assert.equal(postCount, 1); // Zero extra POSTs needed because batch ID was persisted
  assert.equal(rec.itemsRecorded, 1);
  assert.equal(store.getPaymentByJob("j1")?.status, "provider_confirmed");
});

test("polling waits through PENDING attempts until SUCCESS and keeps processing items reserved against cap", async () => {
  let pollCalls = 0;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } }), { status: 201 });
    }
    pollCalls++;
    if (pollCalls < 3) {
      return new Response(JSON.stringify({
        batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" },
        items: [item({ transaction_status: "PENDING", transaction_id: null, activity_id: null, payout_item_fee: undefined })],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" },
      items: [item()],
    }), { status: 200 });
  }) as FetchFn;

  const { store, opts } = setup(fetchFn);
  const res = await submitApprovedPayment({ ...opts, store, jobId: "j1", pollMaxAttempts: 5, pollDelayMs: 0 });
  assert.equal(pollCalls, 3);
  assert.equal(res.status, "provider_confirmed");

  // Now verify clean processing return if still PENDING after poll budget expires
  const store2 = new FinancialStore(join(mkdtempSync(join(tmpdir(), "settle-proc-")), "ledger.db"));
  store2.verifyRecipient({ recipientId: "r1", email: "worker@example.test", actor: owner, at: T0 });
  store2.approvePayment({ jobId: "j2", recipientId: "r1", amountCents: 1000, currency: "USD", actor: owner, at: T0 });
  let settleNow = false;
  const procFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ batch_header: { payout_batch_id: "BATCH-2", batch_status: "PENDING" } }), { status: 201 });
    return new Response(JSON.stringify({
      batch_header: { payout_batch_id: "BATCH-2", batch_status: settleNow ? "SUCCESS" : "PENDING" },
      items: [item({
        payout_batch_id: "BATCH-2",
        payout_item_id: "ITEM-2",
        transaction_status: settleNow ? "SUCCESS" : "PENDING",
        transaction_id: settleNow ? "TX-2" : null,
        payout_item: { sender_item_id: "settle-payment-j2", receiver: "worker@example.test", amount: { value: "10.00", currency: "USD" } },
      })],
    }), { status: 200 });
  }) as FetchFn;
  const proc = await submitApprovedPayment({ store: store2, baseUrl: "https://paypal.test", token: "secret", fetchFn: procFetch, now: () => new Date(T0), pollMaxAttempts: 2, pollDelayMs: 0, jobId: "j2" });
  assert.equal(proc.status, "pending");
  assert.equal(proc.batchStatus, "PROCESSING");
  // Pending payment MUST count in activeReservationsCents so cap cannot be bypassed!
  assert.equal(store2.getCapSummary(T0).activeReservationsCents, 1000);
  // Reconcile finishes it once PayPal settles
  settleNow = true;
  await reconcilePayPal({ store: store2, baseUrl: "https://paypal.test", token: "secret", fetchFn: procFetch, now: () => new Date(T0) });
  assert.equal(store2.getPaymentByJob("j2")?.status, "provider_confirmed");
  assert.equal(store2.getCapSummary(T0).confirmedSpendCents, 1000);
  assert.equal(store2.getCapSummary(T0).activeReservationsCents, 0);
});
