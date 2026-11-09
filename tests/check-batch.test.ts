// Batch check tests — the check must read a batch live and say, in plain
// words, whether the batch paid, whether Reporting has seen it, and whether
// anything failed. No live PayPal call, no money moved, in these tests.
// The live proof is the practice run itself, with a real batch ID.
// Run: node --test tests/check-batch.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBatch, exitCodeFor, saveResult } from "../scripts/check-batch.ts";

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

function makePollItem(jobId: string, txId: string | null, itemStatus: string): Record<string, unknown> {
  const item: Record<string, unknown> = {
    payout_item_id: `ITEM-${jobId}`,
    transaction_status: itemStatus,
    payout_item: {
      recipient_type: "EMAIL",
      amount: { value: "1.00", currency: "USD" },
      receiver: `freelancer-${jobId}@example.com`,
      sender_item_id: jobId,
    },
  };
  if (txId !== null) item.transaction_id = txId;
  return item;
}

function makePollReply(batchStatus: string, items: Record<string, unknown>[]): Record<string, unknown> {
  return {
    batch_header: { payout_batch_id: "BATCH-1", batch_status: batchStatus },
    items,
  };
}

function makeReportingReply(txIds: string[]): Record<string, unknown> {
  return {
    // The event code is carried through, never checked by the batch check.
    // "PAYOUT" below is a stand-in, not a claim about which code PayPal sends.
    transaction_details: txIds.map((id) => ({
      transaction_info: {
        transaction_id: id,
        transaction_event_code: "PAYOUT",
        transaction_initiation_date: "2026-11-07",
        transaction_amount: { currency_code: "USD", value: "-1.00" },
        transaction_status: "S",
        paypal_reference_id: `ITEM-${id}`,
      },
      payer_info: { email_address: "freelancer@example.com" },
    })),
    total_items: txIds.length,
    total_pages: 1,
  };
}

function makeFetch(pollJson: Record<string, unknown>, reportingJson: Record<string, unknown>) {
  return (async (url: string) => {
    if (url.includes("/v1/payments/payouts/")) return mockResponse(200, pollJson);
    if (url.includes("/v1/reporting/transactions")) return mockResponse(200, reportingJson);
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

function threePaidItems(): Record<string, unknown>[] {
  return [
    makePollItem("job-1", "TX-1", "SUCCESS"),
    makePollItem("job-2", "TX-2", "SUCCESS"),
    makePollItem("job-3", "TX-3", "SUCCESS"),
  ];
}

test("batch read: items, amounts, and transaction IDs come out of the poll", async () => {
  const fetchFn = makeFetch(makePollReply("SUCCESS", threePaidItems()), makeReportingReply(["TX-1", "TX-2", "TX-3"]));
  const result = await checkBatch({ baseUrl: "https://api-m.sandbox.paypal.com", token: "TOKEN", payoutBatchId: "BATCH-1", fetchFn });

  assert.equal(result.batchStatus, "SUCCESS");
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].jobId, "job-1");
  assert.equal(result.items[0].receiverEmail, "freelancer-job-1@example.com");
  assert.equal(result.items[0].amountCents, 100);
  assert.equal(result.items[0].currency, "USD");
  assert.equal(result.items[0].status, "SUCCESS");
  assert.deepEqual(
    result.items.map((item) => item.transactionId),
    ["TX-1", "TX-2", "TX-3"],
  );
  assert.equal(result.reporting.matched, 3);
  assert.deepEqual(result.reporting.matchedTransactionIds, ["TX-1", "TX-2", "TX-3"]);
  assert.equal(result.reporting.lagging, false);
  assert.equal(result.ok, true);
  assert.equal(exitCodeFor(result), 0);
});

test("Reporting lag: no match yet is a finding, not a failure", async () => {
  const fetchFn = makeFetch(makePollReply("SUCCESS", threePaidItems()), makeReportingReply([]));
  const result = await checkBatch({ baseUrl: "https://api-m.sandbox.paypal.com", token: "TOKEN", payoutBatchId: "BATCH-1", fetchFn });

  assert.equal(result.batchStatus, "SUCCESS");
  assert.equal(result.reporting.totalItems, 0);
  assert.equal(result.reporting.matched, 0);
  assert.equal(result.reporting.lagging, true);
  assert.equal(result.ok, true);
  assert.equal(exitCodeFor(result), 0);
});

test("failed batch: a denied batch fails the check", async () => {
  const deniedItems = [
    makePollItem("job-1", null, "FAILED"),
    makePollItem("job-2", null, "FAILED"),
    makePollItem("job-3", null, "FAILED"),
  ];
  const fetchFn = makeFetch(makePollReply("DENIED", deniedItems), makeReportingReply([]));
  const result = await checkBatch({ baseUrl: "https://api-m.sandbox.paypal.com", token: "TOKEN", payoutBatchId: "BATCH-1", fetchFn });

  assert.equal(result.batchStatus, "DENIED");
  assert.equal(result.ok, false);
  assert.match(result.note ?? "", /DENIED/);
  assert.equal(exitCodeFor(result), 1);
});

test("settled batch: an item with no transaction ID fails the check", async () => {
  const items = [
    makePollItem("job-1", "TX-1", "SUCCESS"),
    makePollItem("job-2", "TX-2", "SUCCESS"),
    makePollItem("job-3", null, "SUCCESS"),
  ];
  const fetchFn = makeFetch(makePollReply("SUCCESS", items), makeReportingReply(["TX-1", "TX-2"]));
  const result = await checkBatch({ baseUrl: "https://api-m.sandbox.paypal.com", token: "TOKEN", payoutBatchId: "BATCH-1", fetchFn });

  assert.equal(result.ok, false);
  assert.match(result.note ?? "", /job-3/);
  assert.equal(exitCodeFor(result), 1);
});

test("unsettled batch: a pending batch is not a failure", async () => {
  const fetchFn = makeFetch(makePollReply("PENDING", threePaidItems()), makeReportingReply([]));
  const result = await checkBatch({ baseUrl: "https://api-m.sandbox.paypal.com", token: "TOKEN", payoutBatchId: "BATCH-1", fetchFn });

  assert.equal(result.batchStatus, "PENDING");
  assert.equal(result.ok, true);
  assert.match(result.note ?? "", /PENDING/);
  assert.equal(exitCodeFor(result), 0);
});

test("save: the full result is written as JSON", async () => {
  const fetchFn = makeFetch(makePollReply("SUCCESS", threePaidItems()), makeReportingReply(["TX-1", "TX-2", "TX-3"]));
  const result = await checkBatch({ baseUrl: "https://api-m.sandbox.paypal.com", token: "TOKEN", payoutBatchId: "BATCH-1", fetchFn });

  const dir = mkdtempSync(join(tmpdir(), "settle-batch-check-"));
  try {
    const savedPath = saveResult(result, join(dir, "batch-check.json"));
    const saved = JSON.parse(readFileSync(savedPath, "utf8")) as Record<string, unknown>;
    assert.equal(saved.batchId, "BATCH-1");
    assert.equal(saved.batchStatus, "SUCCESS");
    assert.equal((saved.items as unknown[]).length, 3);
    assert.equal(saved.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
