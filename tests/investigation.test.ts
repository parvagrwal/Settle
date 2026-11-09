import { test } from "node:test";
import assert from "node:assert/strict";
import { investigateTransactions, narrateInvestigation } from "../src/server/investigation.ts";
import type { TransactionRecord } from "../src/server/transactionStore.ts";

function row(overrides: Partial<TransactionRecord>): TransactionRecord {
  return {
    rowKey: "POI-1", originalTransactionId: "TX-1", associatedOrderId: null,
    latestEventId: "WH-1", originalEventId: "WH-1", transactionTimestamp: "2026-11-09T10:00:00Z",
    eventCreatedAt: "2026-11-09T10:00:01Z", eventReceivedAt: "2026-11-09T10:00:02Z",
    status: "SUCCESS", grossCents: 100, currency: "USD", feeCents: 2, netCents: 98,
    payerEmail: null, payeeEmail: "receiver@example.com", paymentMethod: "PAYPAL",
    payoutBatchId: "BATCH-1", payoutItemId: "POI-1", jobId: "job-1", relatedTransactionId: null,
    lastEventSequence: 1, ...overrides,
  };
}

const rows = [
  row({}),
  row({ rowKey: "POI-2", originalTransactionId: null, latestEventId: "WH-2", status: "FAILED", grossCents: 25000, netCents: null, feeCents: null }),
  row({ rowKey: "POI-3", originalTransactionId: "TX-3", latestEventId: "WH-3", status: "PENDING", grossCents: 500, netCents: null, feeCents: null }),
];

test("investigation question returns evidence, calculations and exact rows requiring attention", () => {
  const result = investigateTransactions(rows, "Which payments require investigation?");
  assert.deepEqual(result.supportingTransactionIds, ["POI-2", "POI-3"]);
  assert.deepEqual(result.gridFilter.transactionIds, ["POI-2", "POI-3"]);
  assert.equal(result.facts.find((fact) => fact.label === "Attention gross USD")?.value, "$255.00");
  assert.match(result.answer, /POI-2/);
  assert.match(result.answer, /FAILED/);
  assert.doesNotMatch(result.answer, /fraud|cause/i);
});

test("causal question without comparison evidence is explicitly unresolved", () => {
  const result = investigateTransactions(rows, "Why did successful payment volume increase?");
  assert.match(result.answer, /cannot establish an increase or its cause/i);
  assert.deepEqual(result.supportingTransactionIds, ["POI-1"]);
  assert.equal(result.hypotheses.length, 0);
});

test("empty database returns no invented financial conclusion", () => {
  const result = investigateTransactions([], "Show unusual activity");
  assert.deepEqual(result.supportingTransactionIds, []);
  assert.match(result.answer, /No verified transactions/i);
});

test("optional model receives computed evidence and cannot introduce supporting IDs", async () => {
  const analysis = investigateTransactions(rows, "Which payments require investigation?");
  let prompt = "";
  const result = await narrateInvestigation(analysis, "key", (async (_url: string, init: Record<string, unknown>) => {
    prompt = String(init.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Two records need review: POI-2 and POI-3." } }] }) };
  }) as unknown as typeof fetch);
  assert.equal(result.source, "Groq narration over deterministic transaction query");
  assert.deepEqual(result.supportingTransactionIds, ["POI-2", "POI-3"]);
  assert.match(prompt, /Attention gross USD/);
  assert.match(prompt, /POI-2/);
});
