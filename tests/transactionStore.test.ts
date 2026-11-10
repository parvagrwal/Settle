import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransactionStore } from "../src/server/transactionStore.ts";
import { payoutItemEvent } from "./fixtures/paypalEvents.ts";

function tempDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "settle-transactions-"));
  return { path: join(dir, "settle.db"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("verified payout item preserves payment, webhook and actual fee identities", () => {
  const store = new TransactionStore(":memory:");
  const result = store.processVerifiedEvent(payoutItemEvent(), "2026-11-09T10:00:02Z");
  assert.equal(result.duplicate, false);
  assert.equal(result.outcome, "applied");
  const rows = store.listTransactions();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    rowKey: "POI-1",
    originalTransactionId: "TX-1",
    associatedOrderId: null,
    latestEventId: "WH-1",
    originalEventId: "WH-1",
    transactionTimestamp: "2026-11-09T10:00:00Z",
    eventCreatedAt: "2026-11-09T10:00:01Z",
    eventReceivedAt: "2026-11-09T10:00:02Z",
    status: "SUCCESS",
    grossCents: 100,
    currency: "USD",
    feeCents: 2,
    netCents: 98,
    payerEmail: null,
    payeeEmail: "receiver@example.com",
    paymentMethod: "PAYPAL",
    payoutBatchId: "BATCH-1",
    payoutItemId: "POI-1",
    jobId: "job-1",
    relatedTransactionId: null,
    lastEventSequence: 1,
  });
  assert.equal(store.getHistory("POI-1").length, 1);
  assert.equal(store.getHistory("POI-1")[0].eventId, "WH-1");
  store.close();
});

test("duplicate verified event is idempotent and preserves one history row", () => {
  const store = new TransactionStore(":memory:");
  store.processVerifiedEvent(payoutItemEvent(), "2026-11-09T10:00:02Z");
  const duplicate = store.processVerifiedEvent(payoutItemEvent(), "2026-11-09T10:00:03Z");
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.outcome, "duplicate");
  assert.equal(store.listTransactions().length, 1);
  assert.equal(store.getHistory("POI-1").length, 1);
  assert.equal(store.currentSequence(), 1);
  store.close();
});

test("older pending event cannot overwrite newer success; history remains ordered", () => {
  const store = new TransactionStore(":memory:");
  store.processVerifiedEvent(payoutItemEvent(), "2026-11-09T10:00:02Z");
  const old = payoutItemEvent({ id: "WH-0", createTime: "2026-11-09T09:59:59Z", status: "PENDING", transactionId: null });
  const result = store.processVerifiedEvent(old, "2026-11-09T10:00:03Z");
  assert.equal(result.outcome, "superseded");
  assert.equal(store.listTransactions()[0].status, "SUCCESS");
  assert.equal(store.listTransactions()[0].latestEventId, "WH-1");
  assert.deepEqual(store.getHistory("POI-1").map((row) => row.eventId), ["WH-1", "WH-0"]);
  store.close();
});

test("terminal success cannot regress even if a conflicting later failure arrives", () => {
  const store = new TransactionStore(":memory:");
  store.processVerifiedEvent(payoutItemEvent(), "2026-11-09T10:00:02Z");
  const failed = payoutItemEvent({ id: "WH-2", createTime: "2026-11-09T10:01:00Z", status: "FAILED", transactionId: null });
  const result = store.processVerifiedEvent(failed, "2026-11-09T10:01:02Z");
  assert.equal(result.outcome, "conflict");
  assert.equal(store.listTransactions()[0].status, "SUCCESS");
  assert.equal(store.getHistory("POI-1").length, 2);
  store.close();
});

test("file database survives reopen and delta cursor returns only later changes", () => {
  const db = tempDb();
  try {
    const first = new TransactionStore(db.path);
    first.processVerifiedEvent(payoutItemEvent(), "2026-11-09T10:00:02Z");
    first.close();
    const reopened = new TransactionStore(db.path);
    assert.equal(reopened.listTransactions().length, 1);
    assert.equal(reopened.currentSequence(), 1);
    const second = payoutItemEvent({ id: "WH-2", payoutItemId: "POI-2", createTime: "2026-11-09T10:02:00Z", status: "UNCLAIMED" });
    reopened.processVerifiedEvent(second, "2026-11-09T10:02:02Z");
    assert.equal(reopened.listTransactions(1).length, 1);
    assert.equal(reopened.listTransactions(1)[0].status, "UNCLAIMED");
    assert.equal(reopened.listTransactions(2).length, 0);
    reopened.close();
  } finally {
    db.cleanup();
  }
});

test("invalid event is rejected atomically without event or transaction rows", () => {
  const store = new TransactionStore(":memory:");
  assert.throws(() => store.processVerifiedEvent({ id: "WH-BAD", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED" }, "2026-11-09T10:00:02Z"), /event/i);
  assert.equal(store.currentSequence(), 0);
  assert.equal(store.listTransactions().length, 0);
  store.close();
});

test("accepts real PayPal PAYMENT.PAYOUTS-ITEM.* webhook event names and top-level payout_item_fee", () => {
  const store = new TransactionStore(":memory:");
  const events = [
    payoutItemEvent({ id: "WH-PEND", payoutItemId: "POI-A", eventType: "PAYMENT.PAYOUTS-ITEM.HELD", status: "ONHOLD", transactionId: null }),
    payoutItemEvent({ id: "WH-SUCC", payoutItemId: "POI-A", createTime: "2026-11-09T10:01:00Z", eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", status: "SUCCESS", fee: "0.02" }),
    payoutItemEvent({ id: "WH-FAIL", payoutItemId: "POI-B", eventType: "PAYMENT.PAYOUTS-ITEM.FAILED", status: "FAILED", transactionId: null }),
    payoutItemEvent({ id: "WH-UNCL", payoutItemId: "POI-C", eventType: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", status: "UNCLAIMED" }),
    payoutItemEvent({ id: "WH-RET", payoutItemId: "POI-D", eventType: "PAYMENT.PAYOUTS-ITEM.RETURNED", status: "RETURNED" }),
  ];
  for (const ev of events) {
    const res = store.processVerifiedEvent(ev, "2026-11-09T10:02:00Z");
    assert.equal(res.outcome, "applied");
  }
  const byKey = new Map(store.listTransactions().map((row) => [row.rowKey, row]));
  assert.equal(byKey.get("POI-A")?.status, "SUCCESS");
  assert.equal(byKey.get("POI-A")?.feeCents, 2);
  assert.equal(byKey.get("POI-B")?.status, "FAILED");
  assert.equal(byKey.get("POI-C")?.status, "UNCLAIMED");
  assert.equal(byKey.get("POI-D")?.status, "RETURNED");
  store.close();
});
