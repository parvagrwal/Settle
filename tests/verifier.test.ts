// Verifier tests — the attack is written first, the code second.
// Attacker: a hostile submitter changes one destination in the app's
// stored copy, expecting the grid to follow it. The verifier must fail,
// because it recomputes from PayPal, not from the stored copy.
// A second attacker changes the destination through the owner path.
// The verifier must fail there too: a legitimate edit does not make
// the grid true, PayPal does.
// A verifier that has never failed is not trusted.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listTransactions,
  dollarsToCents,
  type ReportingTransaction,
} from "../src/server/reporting.ts";
import {
  verifyGrid,
  hashFileText,
  payoutItemsFromPoll,
  storedRowsFromCreate,
  type StoredRow,
  type PayoutItemRead,
} from "../src/server/verifier.ts";

const SENDER = "studio@example.com";
const FREELANCER_A = "freelancer-a@example.com";
const FREELANCER_B = "freelancer-b@example.com";
const AGENT = "agent@settle.internal";

function makeStoredRow(overrides: Partial<StoredRow> = {}): StoredRow {
  return {
    jobId: "job-1",
    freelancerId: "freelancer-1",
    receiverEmail: FREELANCER_A,
    amountCents: 100,
    currency: "USD",
    payoutBatchId: "BATCH-1",
    // The stored copy never recorded these. They come from the live Payouts read.
    payoutItemId: null,
    transactionId: null,
    status: "paid",
    ...overrides,
  };
}

function makePayoutItem(overrides: Partial<PayoutItemRead> = {}): PayoutItemRead {
  return {
    payoutItemId: "ITEM-1",
    transactionId: "TX-1",
    jobId: "job-1",
    receiverEmail: FREELANCER_A,
    amountCents: 100,
    currency: "USD",
    status: "SUCCESS",
    ...overrides,
  };
}

function makeReportingTx(overrides: Partial<ReportingTransaction> = {}): ReportingTransaction {
  // The event code is carried through, never checked by the verifier.
  // T0006 and T0000 below are sample values, not claims about which code
  // PayPal sends for a payout. The live payout transactions on 2026-11-07
  // carried event code T0001.
  return {
    transactionId: "TX-1",
    eventCode: "T0006",
    date: "2026-11-06T12:44:00Z",
    // A payout debit from the sender's account is negative in Reporting.
    amountCents: -100,
    currency: "USD",
    status: "S",
    // For a payout transaction, Reporting's payer_info holds the
    // recipient, not the sender. Proved on the live run of 2026-11-07:
    // payer_info.account_id equalled transaction_info.paypal_account_id,
    // the payee's account, and the payer email was the freelancer's.
    payerEmail: FREELANCER_A,
    referenceId: "ITEM-1",
    raw: {},
    ...overrides,
  };
}

function baseState() {
  return {
    storedRows: [makeStoredRow()],
    reporting: [makeReportingTx()],
    payoutItems: [makePayoutItem()],
    payoutBatchId: "BATCH-1",
    allowlistEmails: [FREELANCER_A, FREELANCER_B],
    agentEmail: AGENT,
  };
}

test("all three agree, the grid is proved", () => {
  const result = verifyGrid(baseState());
  assert.equal(result.ok, true);
  assert.deepEqual(result.diff, []);
  assert.equal(result.rowsChecked, 1);
});

test("sabotage through the owner path: stored receiver changed, verifier fails naming the job and the receiver", () => {
  // The owner corrects a destination in the stored copy, through the
  // legitimate owner path. The payment already went to the old address.
  // The grid must match PayPal, not the owner's edit.
  const state = baseState();
  state.storedRows = [makeStoredRow({ receiverEmail: FREELANCER_B })];
  const result = verifyGrid(state);
  assert.equal(result.ok, false);
  assert.equal(result.diff.length, 1);
  assert.match(result.diff[0], /job-1/);
  assert.match(result.diff[0], /freelancer-b@example\.com/);
  assert.match(result.diff[0], /freelancer-a@example\.com/);
});

test("stored-copy attack: stored receiver edited directly, verifier fails", () => {
  const state = baseState();
  // A hostile submitter edits the stored copy, not through the owner path.
  state.storedRows[0].receiverEmail = "attacker@example.com";
  const result = verifyGrid(state);
  assert.equal(result.ok, false);
  assert.match(result.diff.join("\n"), /job-1/);
  assert.match(result.diff.join("\n"), /attacker@example\.com/);
  // The stored copy also names a receiver who is not on the allowlist.
  assert.match(result.diff.join("\n"), /not on the allowlist/);
});

test("Reporting payer is the freelancer, the grid still proves, because payer_info holds the recipient for a payout", () => {
  // The live run of 2026-11-07 showed payer_info.account_id equal to
  // transaction_info.paypal_account_id, the payee's account, with the
  // payer email the freelancer's. The base state already carries that
  // real shape, so all three agreeing here is the live shape, not a
  // special case. The direction is proved by the negative amount.
  const result = verifyGrid(baseState());
  assert.equal(result.ok, true);
  assert.deepEqual(result.diff, []);
});

test("Reporting amount positive means money came in, verifier fails", () => {
  const state = baseState();
  state.reporting = [makeReportingTx({ amountCents: 100 })];
  const result = verifyGrid(state);
  assert.equal(result.ok, false);
  assert.match(result.diff.join("\n"), /drift/);
  assert.match(result.diff.join("\n"), /did not leave the sender's account/);
});

test("Reporting missing the transaction is a named drift, not a pass", () => {
  const state = baseState();
  state.reporting = [];
  const result = verifyGrid(state);
  assert.equal(result.ok, false);
  assert.match(result.diff.join("\n"), /drift/);
  assert.match(result.diff.join("\n"), /TX-1/);
});

test("amount mismatch between the stored copy and PayPal fails", () => {
  const state = baseState();
  state.storedRows = [makeStoredRow({ amountCents: 200 })];
  const result = verifyGrid(state);
  assert.equal(result.ok, false);
  assert.match(result.diff.join("\n"), /job-1/);
  assert.match(result.diff.join("\n"), /200/);
  assert.match(result.diff.join("\n"), /100/);
});

test("the agent named as receiver fails the roles check", () => {
  const state = baseState();
  state.payoutItems = [makePayoutItem({ receiverEmail: AGENT })];
  const result = verifyGrid(state);
  assert.equal(result.ok, false);
  assert.match(result.diff.join("\n"), /agent/);
});

test("code hash changed fails the code identity check, matching hashes pass", () => {
  const decideText = "export function decide() { return true; }";
  const policyText = "export const POLICY = {};";
  const good = verifyGrid({
    ...baseState(),
    expectedCodeHashes: { decide: hashFileText(decideText), policy: hashFileText(policyText) },
    currentCodeHashes: { decide: hashFileText(decideText), policy: hashFileText(policyText) },
  });
  assert.equal(good.ok, true);
  const bad = verifyGrid({
    ...baseState(),
    expectedCodeHashes: { decide: hashFileText(decideText), policy: hashFileText(policyText) },
    currentCodeHashes: { decide: hashFileText("changed"), policy: hashFileText(policyText) },
  });
  assert.equal(bad.ok, false);
  assert.match(bad.diff.join("\n"), /decide\.ts/);
});

test("listTransactions parses the Reporting reply", async () => {
  const seen: string[] = [];
  const fetchFn = (async (url: string) => {
    seen.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
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
      }),
    };
  }) as unknown as typeof fetch;
  const result = await listTransactions({
    baseUrl: "https://api-m.sandbox.paypal.com",
    token: "test-token",
    startDate: new Date("2026-11-06T00:00:00Z"),
    endDate: new Date("2026-11-07T00:00:00Z"),
    fetchFn,
  });
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].transactionId, "TX-1");
  assert.equal(result.transactions[0].amountCents, -100);
  assert.equal(result.transactions[0].payerEmail, SENDER);
  assert.equal(result.transactions[1].amountCents, 500);
  assert.equal(result.totalItems, 2);
  assert.match(seen[0], /\/v1\/reporting\/transactions\?/);
  assert.match(seen[0], /fields=all/);
  assert.match(seen[0], /page_size=500/);
});

test("listTransactions rejects a search longer than 31 days and a page size over 500", async () => {
  await assert.rejects(
    listTransactions({
      baseUrl: "https://api-m.sandbox.paypal.com",
      token: "test-token",
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: new Date("2026-11-06T00:00:00Z"),
    }),
    /31 days/,
  );
  await assert.rejects(
    listTransactions({
      baseUrl: "https://api-m.sandbox.paypal.com",
      token: "test-token",
      startDate: new Date("2026-11-06T00:00:00Z"),
      endDate: new Date("2026-11-07T00:00:00Z"),
      pageSize: 501,
    }),
    /500/,
  );
});

test("dollarsToCents converts dollars strings to integer cents", () => {
  assert.equal(dollarsToCents("100.00"), 10000);
  assert.equal(dollarsToCents("1.00"), 100);
  assert.equal(dollarsToCents("0.01"), 1);
  assert.equal(dollarsToCents("-1.00"), -100);
  assert.throws(() => dollarsToCents("not-a-number"), /amount/);
});

test("no payout item for a stored job fails, naming the job", () => {
  const state = baseState();
  state.payoutItems = [];
  const result = verifyGrid(state);
  assert.equal(result.ok, false);
  assert.match(result.diff.join("\n"), /job-1/);
  assert.match(result.diff.join("\n"), /no payout item/);
});

test("stored batch ID different from the live batch fails", () => {
  const state = baseState();
  state.payoutBatchId = "BATCH-OTHER";
  const result = verifyGrid(state);
  assert.equal(result.ok, false);
  assert.match(result.diff.join("\n"), /BATCH-1/);
  assert.match(result.diff.join("\n"), /BATCH-OTHER/);
});

test("storedRowsFromCreate reads the payout record, jobs plus batch ID", () => {
  const raw = {
    payout_batch_id: "BATCH-1",
    batch_status: "SUCCESS",
    sender_batch_id: "settle-123",
    jobs: [
      {
        job_id: "job-1",
        freelancer_id: "freelancer-1",
        paypal_email: FREELANCER_A,
        amount_cents: 100,
        currency: "USD",
        approval_state: "approved",
        approved_at: 1793965620000,
        status: "paid",
        payout_batch_id: "BATCH-1",
        payout_item_id: null,
        decision_reason: null,
      },
    ],
  };
  const rows = storedRowsFromCreate(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].jobId, "job-1");
  assert.equal(rows[0].receiverEmail, FREELANCER_A);
  assert.equal(rows[0].amountCents, 100);
  assert.equal(rows[0].payoutBatchId, "BATCH-1");
  assert.equal(rows[0].payoutItemId, null);
  assert.equal(rows[0].transactionId, null);
  assert.equal(rows[0].status, "paid");
});

test("payoutItemsFromPoll reads the batch items from a Payouts GET reply", () => {
  const raw = {
    batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" },
    items: [
      {
        payout_item_id: "ITEM-1",
        transaction_id: "TX-1",
        transaction_status: "SUCCESS",
        sender_item_id: "job-1",
        payout_item: {
          receiver: FREELANCER_A,
          amount: { currency: "USD", value: "1.00" },
        },
      },
      {
        payout_item_id: "ITEM-2",
        transaction_id: null,
        transaction_status: "UNCLAIMED",
        sender_item_id: "job-2",
        payout_item: {
          receiver: FREELANCER_B,
          amount: { currency: "USD", value: "2.00" },
        },
      },
    ],
  };
  const items = payoutItemsFromPoll(raw);
  assert.equal(items.length, 2);
  assert.equal(items[0].payoutItemId, "ITEM-1");
  assert.equal(items[0].transactionId, "TX-1");
  assert.equal(items[0].jobId, "job-1");
  assert.equal(items[0].receiverEmail, FREELANCER_A);
  assert.equal(items[0].amountCents, 100);
  assert.equal(items[1].transactionId, null);
  assert.equal(items[1].amountCents, 200);
});

test("payoutItemsFromPoll accepts a flat item with a number amount", () => {
  const raw = {
    batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" },
    items: [
      {
        payout_item_id: "ITEM-1",
        transaction_id: "TX-1",
        transaction_status: "SUCCESS",
        receiver: FREELANCER_A,
        amount: { currency: "USD", value: 1 },
        payout_item: { sender_item_id: "job-1" },
      },
    ],
  };
  const items = payoutItemsFromPoll(raw);
  assert.equal(items.length, 1);
  assert.equal(items[0].jobId, "job-1");
  assert.equal(items[0].receiverEmail, FREELANCER_A);
  assert.equal(items[0].amountCents, 100);
});

test("payoutItemsFromPoll names the missing field when an item is incomplete", () => {
  const raw = {
    batch_header: { payout_batch_id: "BATCH-1", batch_status: "SUCCESS" },
    items: [
      {
        payout_item_id: "ITEM-1",
        transaction_id: "TX-1",
        sender_item_id: "job-1",
        payout_item: { receiver: FREELANCER_A, amount: { currency: "USD", value: "1.00" } },
      },
    ],
  };
  assert.throws(() => payoutItemsFromPoll(raw), /transaction_status/);
});
