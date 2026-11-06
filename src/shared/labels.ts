// Canonical label set for Settle — exactly one set, used everywhere.
// Source: PRD §7, precedence order highest first. No second label set anywhere.
// NOTE (discrepancy, flagged for Parv, not silently resolved): the tracker
// S2.5 names an expiry outcome "SessionExpired", but PRD §7's canonical
// 8-label set has no such label, and 256 = 2^8 only holds for 8 labels.
// This draft maps an expired approval to JobNotApproved (the job is no
// longer approved once its 7-day approval lapses). If Parv wants a 9th
// label, the combination count becomes 512 and the tests must be re-run.

export const LABELS = [
  "UnauthorisedActor",
  "SystemSuspended",
  "JobNotApproved",
  "ZeroAmount",
  "RecipientNotAllowed",
  "DuplicatePayout",
  "WindowCapExceeded",
  "PerRequestCapExceeded",
] as const;

export type RejectLabel = (typeof LABELS)[number];
