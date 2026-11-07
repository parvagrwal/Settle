// Canonical label set for Settle — exactly one set, used everywhere.
// Source: the product plan, decision rules section. Precedence order highest first. No second label set anywhere.
// Decided 2026-11-07, by Parv: keep 8 labels. An approval
// that runs out exactly at its expiry time maps to "not approved", and the
// reason text carries the expiry ("job is not approved, or its approval
// has expired"), so the grid and audit trail show it in plain words. A
// ninth label was rejected: it would only change the label, at the cost of
// 512 combination tests and a full re-verification round. The proposed
// ninth-label name was also wrong: it is an approval expiring, not a session.

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
