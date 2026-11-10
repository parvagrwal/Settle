// Toolkit Reporting tests — the attack is written first, the code second.
// Attacker: a Toolkit reply that is shaped wrong, an error hidden in a JSON
// string, or a call pointed at live PayPal. The adapter must fail loudly
// in every case, never pass a wrong row to the verifier, and never call live.
// The fixture reply shape is the recorded Reporting reply shape, the same
// one the direct REST path tests use: transaction_details with
// transaction_info and payer_info.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listTransactions, type ReportingTransaction } from "../src/server/reporting.ts";
import {
  listTransactionsViaToolkit,
  type ToolkitClientLike,
} from "../src/server/toolkitReporting.ts";

const SENDER = "studio@example.com";

function makeReportingReply(): Record<string, unknown> {
  return {
    transaction_details: [
      {
        transaction_info: {
          transaction_id: "TX-1",
          transaction_event_code: "T0006",
          transaction_initiation_date: "2026-11-06T12:44:00Z",
          transaction_amount: { currency_code: "USD", value: "-1.00" },
          transaction_status: "S",
          paypal_reference_id: "ITEM-1",
        },
        payer_info: { email_address: SENDER },
      },
      {
        transaction_info: {
          transaction_id: "TX-2",
          transaction_event_code: "T0000",
          transaction_initiation_date: "2026-11-06T12:45:00Z",
          transaction_amount: { currency_code: "USD", value: "5.00" },
          transaction_status: "S",
          paypal_reference_id: null,
        },
        payer_info: { email_address: "buyer@example.com" },
      },
    ],
    total_items: 2,
    total_pages: 1,
  };
}

function makeFakeClient(reply: unknown, seen: Record<string, unknown>[] = []): ToolkitClientLike {
  return {
    getTools: () => ({
      list_transactions: {
        execute: async (params: Record<string, unknown>) => {
          seen.push(params);
          return reply;
        },
      },
    }),
  };
}

const START = new Date("2026-11-06T00:00:00Z");
const END = new Date("2026-11-07T00:00:00Z");

test("Toolkit reply maps to the same rows as the REST path", async () => {
  const seen: Record<string, unknown>[] = [];
  const result = await listTransactionsViaToolkit({
    clientId: "id",
    clientSecret: "secret",
    sandbox: true,
    startDate: START,
    endDate: END,
    toolkitClient: makeFakeClient(JSON.stringify(makeReportingReply()), seen),
  });
  assert.equal(result.transactions.length, 2);
  assert.equal(result.totalItems, 2);
  assert.equal(result.totalPages, 1);
  const first = result.transactions[0];
  assert.equal(first.transactionId, "TX-1");
  assert.equal(first.eventCode, "T0006");
  assert.equal(first.date, "2026-11-06T12:44:00Z");
  assert.equal(first.amountCents, -100);
  assert.equal(first.currency, "USD");
  assert.equal(first.status, "S");
  assert.equal(first.payerEmail, SENDER);
  assert.equal(first.referenceId, "ITEM-1");
  assert.equal(result.transactions[1].amountCents, 500);
  assert.equal(result.transactions[1].referenceId, null);
  // The call sent the dates, the page size, and the successful-only filter.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].start_date, "2026-11-06T00:00:00Z");
  assert.equal(seen[0].end_date, "2026-11-07T00:00:00Z");
  assert.equal(seen[0].page_size, 500);
  assert.equal(seen[0].transaction_status, "S");
});

test("Toolkit rows equal REST rows for the same reply", async () => {
  const reply = makeReportingReply();
  const viaToolkit = await listTransactionsViaToolkit({
    clientId: "id",
    clientSecret: "secret",
    sandbox: true,
    startDate: START,
    endDate: END,
    toolkitClient: makeFakeClient(JSON.stringify(reply)),
  });
  const fetchFn = (async () => ({
    ok: true,
    status: 200,
    json: async () => reply,
  })) as unknown as typeof fetch;
  const viaRest = await listTransactions({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "token",
    startDate: START,
    endDate: END,
    fetchFn,
  });
  assert.deepEqual(viaToolkit.transactions, viaRest.transactions);
  assert.equal(viaToolkit.totalItems, viaRest.totalItems);
  assert.equal(viaToolkit.totalPages, viaRest.totalPages);
});

test("Toolkit error reply fails loudly with the Toolkit message", async () => {
  const errorReply = JSON.stringify({ error: { message: "invalid token", type: "paypal_error" } });
  await assert.rejects(
    () =>
      listTransactionsViaToolkit({
        clientId: "id",
        clientSecret: "secret",
        sandbox: true,
        startDate: START,
        endDate: END,
        toolkitClient: makeFakeClient(errorReply),
      }),
    /invalid token/,
  );
});

test("Toolkit text that is not JSON fails loudly", async () => {
  await assert.rejects(
    () =>
      listTransactionsViaToolkit({
        clientId: "id",
        clientSecret: "secret",
        sandbox: true,
        startDate: START,
        endDate: END,
        toolkitClient: makeFakeClient("this is not json"),
      }),
    /not JSON/,
  );
});

test("Toolkit reply with no transaction list fails loudly", async () => {
  await assert.rejects(
    () =>
      listTransactionsViaToolkit({
        clientId: "id",
        clientSecret: "secret",
        sandbox: true,
        startDate: START,
        endDate: END,
        toolkitClient: makeFakeClient(JSON.stringify({ total_items: 0 })),
      }),
    /no transaction_details list/,
  );
});

test("Toolkit reply as an object, not a string, still maps", async () => {
  const result = await listTransactionsViaToolkit({
    clientId: "id",
    clientSecret: "secret",
    sandbox: true,
    startDate: START,
    endDate: END,
    toolkitClient: makeFakeClient(makeReportingReply()),
  });
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].transactionId, "TX-1");
});

test("missing list_transactions tool fails loudly", async () => {
  const noTool = { getTools: () => ({}) } as unknown as ToolkitClientLike;
  await assert.rejects(
    () =>
      listTransactionsViaToolkit({
        clientId: "id",
        clientSecret: "secret",
        sandbox: true,
        startDate: START,
        endDate: END,
        toolkitClient: noTool,
      }),
    /did not provide a list_transactions tool/,
  );
});

test("Toolkit path refuses live, even with credentials", async () => {
  await assert.rejects(
    () =>
      listTransactionsViaToolkit({
        clientId: "id",
        clientSecret: "secret",
        sandbox: false,
        startDate: START,
        endDate: END,
        toolkitClient: makeFakeClient(JSON.stringify(makeReportingReply())),
      }),
    /sandbox must be true/,
  );
});

test("Toolkit path refuses missing credentials when no test client is given", async () => {
  await assert.rejects(
    () =>
      listTransactionsViaToolkit({
        clientId: "",
        clientSecret: "secret",
        sandbox: true,
        startDate: START,
        endDate: END,
      }),
    /PAYPAL_CLIENT_ID is missing/,
  );
  await assert.rejects(
    () =>
      listTransactionsViaToolkit({
        clientId: "id",
        clientSecret: "",
        sandbox: true,
        startDate: START,
        endDate: END,
      }),
    /PAYPAL_CLIENT_SECRET is missing/,
  );
});

test("Toolkit path rejects a search longer than 31 days and a bad page size", async () => {
  const client = makeFakeClient(JSON.stringify(makeReportingReply()));
  await assert.rejects(
    () =>
      listTransactionsViaToolkit({
        clientId: "id",
        clientSecret: "secret",
        sandbox: true,
        startDate: new Date("2026-10-01T00:00:00Z"),
        endDate: new Date("2026-11-07T00:00:00Z"),
        toolkitClient: client,
      }),
    /31 days or less/,
  );
  await assert.rejects(
    () =>
      listTransactionsViaToolkit({
        clientId: "id",
        clientSecret: "secret",
        sandbox: true,
        startDate: END,
        endDate: START,
        toolkitClient: client,
      }),
    /endDate must be after startDate/,
  );
  await assert.rejects(
    () =>
      listTransactionsViaToolkit({
        clientId: "id",
        clientSecret: "secret",
        sandbox: true,
        startDate: START,
        endDate: END,
        pageSize: 501,
        toolkitClient: client,
      }),
    /pageSize must be between 1 and 500/,
  );
});

test("verifier accepts Toolkit-mapped rows", async () => {
  const { verifyGrid } = await import("../src/server/verifier.ts");
  const result = await listTransactionsViaToolkit({
    clientId: "id",
    clientSecret: "secret",
    sandbox: true,
    startDate: START,
    endDate: END,
    toolkitClient: makeFakeClient(JSON.stringify(makeReportingReply())),
  });
  const checked = verifyGrid({
    storedRows: [
      {
        jobId: "job-1",
        freelancerId: "freelancer-1",
        receiverEmail: SENDER,
        amountCents: 100,
        currency: "USD",
        payoutBatchId: "BATCH-1",
        payoutItemId: "ITEM-1",
        transactionId: "TX-1",
        status: "paid",
      },
    ],
    reporting: result.transactions as ReportingTransaction[],
    payoutItems: [
      {
        payoutItemId: "ITEM-1",
        transactionId: "TX-1",
        jobId: "job-1",
        receiverEmail: SENDER,
        amountCents: 100,
        currency: "USD",
        status: "SUCCESS",
      },
    ],
    payoutBatchId: "BATCH-1",
    allowlistEmails: [SENDER],
    agentEmail: "agent@settle.internal",
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.reportingCount, 2);
});
