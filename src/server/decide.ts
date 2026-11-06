import type { Decision, PaymentRequest, Policy, State } from "../shared/types.ts";
import type { RejectLabel } from "../shared/labels.ts";

// Reference model, the ground truth (product plan, decision rules). Pure function:
// no I/O, no PayPal call, no model call. Every payment path must call
// this before any PayPal call; the model never instructs a payment.
// Precedence, highest first:
//   1 UnauthorisedActor, 2 SystemSuspended, 3 JobNotApproved,
//   4 ZeroAmount, 5 RecipientNotAllowed, 6 DuplicatePayout,
//   7 WindowCapExceeded, 8 PerRequestCapExceeded.
// Window cap outranks per-request cap on purpose: a batch that would
// break the week is refused as a week, not as a single payment.
// Zero amount beats recipient-not-allowed.
// Amounts use BigInt for the window sum so a maximum representable
// amount becomes WindowCapExceeded, never an overflow or a panic.
// Expiry: now >= approvalExpiresAtMs means the approval has lapsed, so
// the job is not approved (see labels.ts note on "expired approval").
// Window rollover is the caller's job: it passes spentInWindowCents for
// the current window (0 at the first instant of a new window).
export function decide(
  policy: Policy,
  state: State,
  request: PaymentRequest,
  nowMs: number,
): Decision {
  if (!Number.isInteger(request.amountCents)) {
    throw new Error("decide: amountCents must be integer cents");
  }
  if (!Number.isInteger(state.spentInWindowCents)) {
    throw new Error("decide: spentInWindowCents must be integer cents");
  }

  const reject = (label: RejectLabel, reason: string): Decision => ({
    decision: "reject",
    label,
    reason,
  });

  if (!state.actorAuthorized) {
    return reject("UnauthorisedActor", "actor is not authorised to request a payment");
  }
  if (state.systemSuspended) {
    return reject("SystemSuspended", "system is suspended");
  }
  if (
    !state.jobApproved ||
    (state.approvalExpiresAtMs !== null && nowMs >= state.approvalExpiresAtMs)
  ) {
    return reject("JobNotApproved", "job is not approved, or its approval has expired");
  }
  if (request.amountCents <= 0) {
    return reject("ZeroAmount", "amount is zero or negative");
  }
  if (!state.recipientAllowed) {
    return reject("RecipientNotAllowed", "recipient is not on the allowlist");
  }
  if (state.alreadyPaid) {
    return reject("DuplicatePayout", "this job has already been paid");
  }
  if (
    BigInt(state.spentInWindowCents) + BigInt(request.amountCents) >
    BigInt(policy.weeklyCapCents)
  ) {
    return reject("WindowCapExceeded", "payment would exceed the $1,500 weekly cap");
  }
  if (request.amountCents > policy.perPaymentCapCents) {
    return reject("PerRequestCapExceeded", "payment exceeds the $200 per-payment cap");
  }
  return { decision: "accept" };
}
