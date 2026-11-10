// Money and fee-model tests, written before the implementation.
// Two independent claims are under test:
//   1. Authoritative money is integer minor units, parsed without floating point.
//   2. A Payouts fee is either (a) a versioned policy estimate with a cited source,
//      or (b) a provider-reported amount. One is never presented as the other, and a
//      fee observed once is never promoted to a universal schedule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMinor, formatMinor, parseDecimalToMinor, sumMinor } from "../src/server/money.ts";
import {
  DEFAULT_FEE_POLICY_ID,
  FEE_POLICIES,
  estimateBatchFee,
  estimatePayoutFee,
  feePolicy,
  observeFees,
  providerFeeConsistency,
} from "../src/server/fees.ts";

test("decimal strings become exact minor units without floating point", () => {
  assert.equal(parseDecimalToMinor("0.01"), 1);
  assert.equal(parseDecimalToMinor("1.00"), 100);
  assert.equal(parseDecimalToMinor("2.00"), 200);
  assert.equal(parseDecimalToMinor("0.04"), 4);
  assert.equal(parseDecimalToMinor("1234.56"), 123456);
  assert.equal(parseDecimalToMinor("10"), 1000);
  // 0.1 + 0.2 arithmetic cannot appear here because the value never becomes a float.
  assert.equal(sumMinor([parseDecimalToMinor("0.10"), parseDecimalToMinor("0.20")]), 30);
  assert.equal(formatMinor(30), "0.30");
});

test("decimal parsing rejects anything that is not an exact currency amount", () => {
  for (const bad of ["", "1.005", "0.1", "-1.00", "1,00", "abc", "1e3", ".50", "1."]) {
    assert.throws(() => parseDecimalToMinor(bad), /two-decimal|minor units/, `accepted ${JSON.stringify(bad)}`);
  }
  assert.throws(() => parseDecimalToMinor(1.5 as unknown as string), /string/);
  // Scientific notation through Number() would silently produce 300 for "3e2".
  assert.throws(() => parseDecimalToMinor("3e2"), /two-decimal/);
});

test("assertMinor refuses non-integers, negatives and unsafe values", () => {
  assert.doesNotThrow(() => assertMinor(0, "amount", { allowZero: true }));
  assert.throws(() => assertMinor(0, "amount"), /positive/);
  assert.throws(() => assertMinor(10.5, "amount"), /integer/);
  assert.throws(() => assertMinor(-1, "amount", { allowZero: true }), /non-negative/);
  assert.throws(() => assertMinor(Number.MAX_SAFE_INTEGER + 2, "amount"), /safe/);
});

test("the default Payouts API fee policy is the published flat per-item rate and cites its source", () => {
  const policy = feePolicy(DEFAULT_FEE_POLICY_ID);
  assert.equal(policy.channel, "api");
  assert.equal(policy.method, "flat_per_item");
  assert.equal(policy.flatMinor, 25);
  assert.equal(policy.currency, "USD");
  assert.equal(policy.senderCountry, "US");
  assert.match(policy.source.url, /^https:\/\/www\.paypal\.com\//);
  assert.match(policy.source.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(policy.status, "published");
});

test("a flat policy charges one fee per payout item, not per batch", () => {
  const single = estimatePayoutFee({ amountMinor: 200 });
  assert.equal(single.estimatedFeeMinor, 25);
  assert.equal(single.method, "flat_per_item");
  assert.equal(single.isEstimate, true);
  assert.equal(single.policyId, DEFAULT_FEE_POLICY_ID);

  const batch = estimateBatchFee([200, 100, 5000]);
  assert.equal(batch.estimatedFeeMinor, 75);
  assert.equal(batch.perItem.length, 3);
  assert.equal(batch.policyVersion, FEE_POLICIES[DEFAULT_FEE_POLICY_ID].version);
});

test("the percentage policy is capped, and the cap is applied per item", () => {
  const id = "paypal-us-payouts-web-2pct-cap-2026-10";
  assert.equal(estimatePayoutFee({ amountMinor: 100, policyId: id }).estimatedFeeMinor, 2);
  assert.equal(estimatePayoutFee({ amountMinor: 200, policyId: id }).estimatedFeeMinor, 4);
  // 2% of $100.00 is $2.00, capped at $1.00.
  assert.equal(estimatePayoutFee({ amountMinor: 10000, policyId: id }).estimatedFeeMinor, 100);
});

test("an estimate always carries its formula, policy version and provenance", () => {
  const estimate = estimatePayoutFee({ amountMinor: 200 });
  assert.equal(estimate.formula, "USD 0.25 flat per payout item");
  assert.ok(estimate.policyVersion >= 1);
  assert.equal(estimate.source.title.length > 5, true);
  assert.equal(estimate.note, null);
});

test("an unknown fee policy is refused instead of silently defaulting", () => {
  assert.throws(() => estimatePayoutFee({ amountMinor: 100, policyId: "made-up" }), /unknown fee policy/);
  assert.throws(() => estimatePayoutFee({ amountMinor: 0 }), /positive/);
});

test("the checked-in Sandbox artifact is read as two $1.00 items and never as one $2.00 item", () => {
  // Verbatim values from evidence/payouts-first-test/payout-poll.json.
  const observation = observeFees({
    environment: "sandbox",
    batchId: "YFBPVYJBHM9GU",
    batchFeeMinor: 4,
    items: [
      { payoutItemId: "N9SWSQDWW3GM4", amountMinor: 100, feeMinor: 2 },
      { payoutItemId: "TH4GJTFKP6NRN", amountMinor: 100, feeMinor: 2 },
    ],
  });
  assert.equal(observation.itemCount, 2);
  assert.equal(observation.grossMinor, 200);
  assert.equal(observation.reportedFeeMinor, 4);
  assert.equal(observation.batchFeeMatchesItemSum, true);
  assert.deepEqual(observation.observedBps, [200, 200]);
  assert.equal(observation.environment, "sandbox");
  // 2% with no fixed component: consistent with the web policy on these two items and
  // inconsistent with the flat API policy. That is a recorded observation, not a new rule.
  assert.deepEqual(observation.consistentWithPolicyIds, ["paypal-us-payouts-web-2pct-cap-2026-10"]);
  assert.match(observation.note, /estimate only|does not establish a fee schedule/i);
});

test("one observation never becomes a universal fee schedule", () => {
  const observation = observeFees({
    environment: "sandbox",
    batchId: "B1",
    items: [{ payoutItemId: "I1", amountMinor: 100, feeMinor: 2 }],
  });
  assert.equal(observation.consistentWithPolicyIds.includes(DEFAULT_FEE_POLICY_ID), false);
  assert.match(observation.note, /one batch|not a schedule|not enough/i);
});

test("provider fee consistency compares the reported fee with the versioned estimate", () => {
  const match = providerFeeConsistency({ amountMinor: 100, reportedFeeMinor: 25, policyId: DEFAULT_FEE_POLICY_ID });
  assert.equal(match.consistent, true);
  assert.equal(match.deltaMinor, 0);
  const mismatch = providerFeeConsistency({ amountMinor: 100, reportedFeeMinor: 2, policyId: DEFAULT_FEE_POLICY_ID });
  assert.equal(mismatch.consistent, false);
  assert.equal(mismatch.deltaMinor, -23);
  assert.match(mismatch.explanation, /differs from the published estimate/);
  // Unreported is not zero.
  const missing = providerFeeConsistency({ amountMinor: 100, reportedFeeMinor: null, policyId: DEFAULT_FEE_POLICY_ID });
  assert.equal(missing.consistent, null);
  assert.match(missing.explanation, /not reported/);
});
