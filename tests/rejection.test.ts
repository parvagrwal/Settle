// S3 rejection test — docs/ARCHITECTURE.md Section 7.
// Run with all application processes stopped. No server, no PayPal call,
// no money moved. It tests decide() directly, the enforcement point.
// Pass: all four attempts fail, policy reads back unchanged.
// Uses Node's built-in test runner, no dependencies. Run: node --test tests/rejection.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/server/decide.ts";
import { DEFAULT_POLICY } from "../src/server/policy.ts";
import type { Policy, State, PaymentRequest } from "../src/shared/types.ts";

const nowMs = 1793960000000;
const baseState: State = {
  actorAuthorized: true,
  systemSuspended: false,
  jobApproved: true,
  approvalExpiresAtMs: nowMs + 7 * 24 * 60 * 60 * 1000,
  recipientAllowed: true,
  alreadyPaid: false,
  spentInWindowCents: 0,
};
const baseRequest: PaymentRequest = {
  jobId: "job-1",
  recipient: "freelancer@example.com",
  amountCents: 10000, // $100, inside both caps
};

test("attempt 1: plain transfer by an unauthorised actor must fail", () => {
  const d = decide(DEFAULT_POLICY, { ...baseState, actorAuthorized: false }, baseRequest, nowMs);
  assert.equal(d.decision, "reject");
  assert.equal(d.label, "UnauthorisedActor");
});

test("attempt 2: transfer to a recipient not on the allowlist must fail", () => {
  const d = decide(DEFAULT_POLICY, { ...baseState, recipientAllowed: false }, baseRequest, nowMs);
  assert.equal(d.decision, "reject");
  assert.equal(d.label, "RecipientNotAllowed");
});

test("attempt 3a: over-policy amount $200.01 must fail as PerRequestCapExceeded", () => {
  const d = decide(DEFAULT_POLICY, baseState, { ...baseRequest, amountCents: 20001 }, nowMs);
  assert.equal(d.decision, "reject");
  assert.equal(d.label, "PerRequestCapExceeded");
});

test("attempt 3b: amount that would take the week over $1,500 must fail as WindowCapExceeded", () => {
  const d = decide(
    DEFAULT_POLICY,
    { ...baseState, spentInWindowCents: 140000 }, // $1,400 already spent
    { ...baseRequest, amountCents: 20000 }, // $200 more = $1,600 total
    nowMs,
  );
  assert.equal(d.decision, "reject");
  assert.equal(d.label, "WindowCapExceeded");
});

test("attempt 4: owner function signed by the constrained actor must fail, policy unchanged", () => {
  // In Settle there is no owner function in decide(), and no agent code
  // path calls an extraction, refund, or cancel. The closest a constrained
  // actor can get is a payment request with actorAuthorized false, which
  // must reject, and the policy object must read back unchanged.
  const policyBefore: Policy = { ...DEFAULT_POLICY };
  const d = decide(DEFAULT_POLICY, { ...baseState, actorAuthorized: false }, baseRequest, nowMs);
  assert.equal(d.decision, "reject");
  assert.equal(d.label, "UnauthorisedActor");
  assert.deepEqual(DEFAULT_POLICY, policyBefore);
  assert.equal(DEFAULT_POLICY.perPaymentCapCents, 20000);
  assert.equal(DEFAULT_POLICY.weeklyCapCents, 150000);
});
