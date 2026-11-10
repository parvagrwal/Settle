// Verdict logic for the Toolkit vs REST Reporting comparison.
// The only expected difference is a payer the Toolkit does not surface:
// payer none via the Toolkit but named via REST. Everything else that
// disagrees, amount, currency, status, date, any other payer difference,
// or a row missing on either side, must stay DIFFERENCE.
import assert from "node:assert/strict";
import test from "node:test";
import { compareReportingPaths } from "../src/server/reportingCompare.ts";
import type { ReportingTransaction } from "../src/server/reporting.ts";

const SENDER = "sb-nxn4n45090184@personal.example.com";

function row(
  transactionId: string,
  overrides: Partial<ReportingTransaction> = {},
): ReportingTransaction {
  return {
    transactionId,
    eventCode: "T0006",
    date: "2026-11-06T12:44:00Z",
    amountCents: -100,
    currency: "USD",
    status: "S",
    payerEmail: SENDER,
    referenceId: null,
    raw: {},
    ...overrides,
  };
}

test("identical rows match with no differences", () => {
  const result = compareReportingPaths([row("A1")], [row("A1")]);
  assert.equal(result.match, true);
  assert.deepEqual(result.fieldDiffs, []);
  assert.deepEqual(result.payerDiffs, []);
  assert.deepEqual(result.toolkitOnly, []);
  assert.deepEqual(result.restOnly, []);
});

test("payer missing in the Toolkit only is expected and still matches", () => {
  // The live case, 2026-11-10: 29 of 70 shared transactions had payer none
  // via the Toolkit but the sender email via REST.
  const toolkit = [row("A1", { payerEmail: null }), row("A2", { payerEmail: null })];
  const rest = [row("A1"), row("A2")];
  const result = compareReportingPaths(toolkit, rest);
  assert.equal(result.match, true);
  assert.deepEqual(result.fieldDiffs, []);
  assert.equal(result.payerDiffs.length, 2);
  assert.match(result.payerDiffs[0], /A1: payer is none via Toolkit but .* via REST/);
});

test("amount difference stays DIFFERENCE", () => {
  const result = compareReportingPaths([row("A1", { amountCents: -100 })], [row("A1", { amountCents: -200 })]);
  assert.equal(result.match, false);
  assert.match(result.fieldDiffs[0], /amount is -100 cents via Toolkit but -200 via REST/);
});

test("currency difference stays DIFFERENCE", () => {
  const result = compareReportingPaths([row("A1", { currency: "USD" })], [row("A1", { currency: "EUR" })]);
  assert.equal(result.match, false);
  assert.match(result.fieldDiffs[0], /currency is USD via Toolkit but EUR via REST/);
});

test("status difference stays DIFFERENCE", () => {
  const result = compareReportingPaths([row("A1", { status: "S" })], [row("A1", { status: "P" })]);
  assert.equal(result.match, false);
  assert.match(result.fieldDiffs[0], /status is S via Toolkit but P via REST/);
});

test("date difference stays DIFFERENCE", () => {
  const result = compareReportingPaths(
    [row("A1", { date: "2026-11-06T12:44:00Z" })],
    [row("A1", { date: "2026-11-06T12:45:00Z" })],
  );
  assert.equal(result.match, false);
  assert.match(result.fieldDiffs[0], /date is .* via Toolkit but .* via REST/);
});

test("Toolkit-only row stays DIFFERENCE", () => {
  const result = compareReportingPaths([row("A1"), row("A2")], [row("A1")]);
  assert.equal(result.match, false);
  assert.deepEqual(result.toolkitOnly, ["A2"]);
});

test("REST-only successful row stays DIFFERENCE", () => {
  const result = compareReportingPaths([row("A1")], [row("A1"), row("A2", { status: "S" })]);
  assert.equal(result.match, false);
  assert.deepEqual(result.restOnlySuccessful, ["A2"]);
});

test("REST-only non-successful row does not fail the check", () => {
  const result = compareReportingPaths([row("A1")], [row("A1"), row("A2", { status: "P" })]);
  assert.equal(result.match, true);
  assert.equal(result.restOnly.length, 1);
  assert.deepEqual(result.restOnlySuccessful, []);
});

test("two different named payers stay DIFFERENCE", () => {
  const result = compareReportingPaths(
    [row("A1", { payerEmail: "one@example.test" })],
    [row("A1", { payerEmail: "two@example.test" })],
  );
  assert.equal(result.match, false);
  assert.deepEqual(result.payerDiffs, []);
  assert.match(result.fieldDiffs[0], /payer is one@example\.test via Toolkit but two@example\.test via REST/);
});

test("payer named by the Toolkit but missing via REST stays DIFFERENCE", () => {
  const result = compareReportingPaths(
    [row("A1", { payerEmail: SENDER })],
    [row("A1", { payerEmail: null })],
  );
  assert.equal(result.match, false);
  assert.deepEqual(result.payerDiffs, []);
  assert.match(result.fieldDiffs[0], /payer is .* via Toolkit but none via REST/);
});
