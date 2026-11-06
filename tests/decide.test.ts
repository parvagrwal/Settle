// Decision-rules tests: 256 combination cases + boundary tests + precedence pairs.
// Run: node --test tests/decide.test.ts   (Node >= 22, type stripping on)
// Evidence: save the run output to evidence/decide/test-output.txt
import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/server/decide.ts";
import { DEFAULT_POLICY } from "../src/server/policy.ts";
import type { PaymentRequest, Policy, State } from "../src/shared/types.ts";
import type { RejectLabel } from "../src/shared/labels.ts";

const NOW = 1_791_000_000_000; // fixed clock, never the wall clock
const EXPIRY = NOW + 7 * 24 * 60 * 60 * 1000;

function baseState(): State {
  return {
    actorAuthorized: true,
    systemSuspended: false,
    jobApproved: true,
    approvalExpiresAtMs: EXPIRY,
    recipientAllowed: true,
    alreadyPaid: false,
    spentInWindowCents: 0,
  };
}

function baseRequest(): PaymentRequest {
  return { jobId: "job-1", recipient: "freelancer@example.com", amountCents: 10000 };
}

// Independent expected-label computation: re-evaluates each rule's
// predicate on the constructed input, in the decision-rules precedence order.
// It does NOT call decide()'s internals, so a shared bug would need to
// appear in both places to pass silently.
function expectedLabel(policy: Policy, state: State, req: PaymentRequest, now: number): RejectLabel | "accept" {
  if (!state.actorAuthorized) return "UnauthorisedActor";
  if (state.systemSuspended) return "SystemSuspended";
  if (!state.jobApproved || (state.approvalExpiresAtMs !== null && now >= state.approvalExpiresAtMs)) return "JobNotApproved";
  if (req.amountCents <= 0) return "ZeroAmount";
  if (!state.recipientAllowed) return "RecipientNotAllowed";
  if (state.alreadyPaid) return "DuplicatePayout";
  if (BigInt(state.spentInWindowCents) + BigInt(req.amountCents) > BigInt(policy.weeklyCapCents)) return "WindowCapExceeded";
  if (req.amountCents > policy.perPaymentCapCents) return "PerRequestCapExceeded";
  return "accept";
}

// Bit order matches LABELS precedence: 0 unauthorised, 1 suspended,
// 2 job-not-approved, 3 zero-amount, 4 recipient, 5 duplicate,
// 6 window-cap, 7 per-request-cap.
function inputForMask(mask: number): { state: State; req: PaymentRequest } {
  const state = baseState();
  const req = baseRequest();
  if (mask & 1) state.actorAuthorized = false;
  if (mask & 2) state.systemSuspended = true;
  if (mask & 4) state.jobApproved = false;
  if (mask & 8) req.amountCents = 0;
  if (mask & 16) state.recipientAllowed = false;
  if (mask & 32) state.alreadyPaid = true;
  if (mask & 64) state.spentInWindowCents = 150001; // spent alone breaks the week
  if (mask & 128) req.amountCents = 20001; // $200.01
  return { state, req };
}

test("256 combination cases: every mask 0..255, expected from predicates", () => {
  let infeasible = 0;
  for (let mask = 0; mask < 256; mask++) {
    const { state, req } = inputForMask(mask);
    const expected = expectedLabel(DEFAULT_POLICY, state, req, NOW);
    const got = decide(DEFAULT_POLICY, state, req, NOW);
    if (expected === "accept") {
      assert.equal(got.decision, "accept", `mask ${mask}: expected accept`);
    } else {
      assert.equal(got.decision, "reject", `mask ${mask}: expected reject ${expected}`);
      assert.equal((got as { label: string }).label, expected, `mask ${mask}`);
    }
    // Honest count: zero-amount (bit 3) and per-request-cap (bit 7) cannot
    // both hold on one amount, so masks with both bits collapse to the
    // per-request violation only. Those masks are still run, not skipped.
    if ((mask & 8) && (mask & 128)) infeasible++;
  }
  assert.equal(infeasible, 64, "64 masks carry both zero-amount and over-cap bits");
});

test("boundary: $200.00 accepts, $200.01 is PerRequestCapExceeded", () => {
  const ok = decide(DEFAULT_POLICY, baseState(), { ...baseRequest(), amountCents: 20000 }, NOW);
  assert.equal(ok.decision, "accept");
  const over = decide(DEFAULT_POLICY, baseState(), { ...baseRequest(), amountCents: 20001 }, NOW);
  assert.equal(over.decision, "reject");
  assert.equal((over as { label: string }).label, "PerRequestCapExceeded");
});

test("boundary: exact $1,500 weekly fill accepts, one cent over is WindowCapExceeded", () => {
  const fillState = { ...baseState(), spentInWindowCents: 140000 };
  const fill = decide(DEFAULT_POLICY, fillState, { ...baseRequest(), amountCents: 10000 }, NOW);
  assert.equal(fill.decision, "accept");
  const overState = { ...baseState(), spentInWindowCents: 140001 };
  const over = decide(DEFAULT_POLICY, overState, { ...baseRequest(), amountCents: 10000 }, NOW);
  assert.equal(over.decision, "reject");
  assert.equal((over as { label: string }).label, "WindowCapExceeded");
});

test("boundary: window cap outranks per-request cap", () => {
  // $200.01 AND breaks the week: the week label must win.
  const state = { ...baseState(), spentInWindowCents: 140000 };
  const got = decide(DEFAULT_POLICY, state, { ...baseRequest(), amountCents: 20001 }, NOW);
  assert.equal((got as { label: string }).label, "WindowCapExceeded");
});

test("boundary: now exactly at expiry is not approved; 1s before is", () => {
  const at = decide(DEFAULT_POLICY, baseState(), baseRequest(), EXPIRY);
  assert.equal(at.decision, "reject");
  assert.equal((at as { label: string }).label, "JobNotApproved");
  const before = decide(DEFAULT_POLICY, baseState(), baseRequest(), EXPIRY - 1000);
  assert.equal(before.decision, "accept");
  const after = decide(DEFAULT_POLICY, baseState(), baseRequest(), EXPIRY + 1000);
  assert.equal((after as { label: string }).label, "JobNotApproved");
});

test("boundary: new window with spent reset to 0 accepts a previously impossible spend", () => {
  const fresh = { ...baseState(), spentInWindowCents: 0 };
  assert.equal(decide(DEFAULT_POLICY, fresh, baseRequest(), NOW).decision, "accept");
});

test("boundary: maximum representable amount is WindowCapExceeded, never a panic", () => {
  const got = decide(
    DEFAULT_POLICY,
    baseState(),
    { ...baseRequest(), amountCents: Number.MAX_SAFE_INTEGER },
    NOW,
  );
  assert.equal(got.decision, "reject");
  assert.equal((got as { label: string }).label, "WindowCapExceeded");
});

test("boundary: zero and negative amounts are ZeroAmount", () => {
  for (const amountCents of [0, -1, -10000]) {
    const got = decide(DEFAULT_POLICY, baseState(), { ...baseRequest(), amountCents }, NOW);
    assert.equal((got as { label: string }).label, "ZeroAmount", `amount ${amountCents}`);
  }
});

test("precedence pairs: every co-occurring pair returns the higher label", () => {
  // Each entry: [lower-bit input, higher-bit input] built independently.
  const violators: Array<(s: State, r: PaymentRequest) => void> = [
    (s) => { s.actorAuthorized = false; },
    (s) => { s.systemSuspended = true; },
    (s) => { s.jobApproved = false; },
    (_s, r) => { r.amountCents = 0; },
    (s) => { s.recipientAllowed = false; },
    (s) => { s.alreadyPaid = true; },
    (s) => { s.spentInWindowCents = 150001; },
    (_s, r) => { r.amountCents = 20001; },
  ];
  const labels: RejectLabel[] = [
    "UnauthorisedActor", "SystemSuspended", "JobNotApproved", "ZeroAmount",
    "RecipientNotAllowed", "DuplicatePayout", "WindowCapExceeded", "PerRequestCapExceeded",
  ];
  for (let hi = 0; hi < 8; hi++) {
    for (let lo = hi + 1; lo < 8; lo++) {
      // Zero-amount (3) and per-request-cap (7) cannot co-occur on one
      // amount; that pair is covered by the 256-mask run instead.
      if (hi === 3 && lo === 7) continue;
      const state = baseState();
      const req = baseRequest();
      violators[hi](state, req);
      violators[lo](state, req);
      const got = decide(DEFAULT_POLICY, state, req, NOW);
      assert.equal(got.decision, "reject", `pair ${hi}/${lo}`);
      assert.equal((got as { label: string }).label, labels[hi], `pair ${hi} should beat ${lo}`);
    }
  }
});

test("decide is pure: same inputs give the same decision, inputs unchanged", () => {
  const state = baseState();
  const req = baseRequest();
  const first = decide(DEFAULT_POLICY, state, req, NOW);
  const second = decide(DEFAULT_POLICY, state, req, NOW);
  assert.deepEqual(first, second);
  assert.deepEqual(state, baseState());
  assert.deepEqual(req, baseRequest());
});
