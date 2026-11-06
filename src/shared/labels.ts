// Canonical label set for Settle — exactly one set, used everywhere.
// Source: the product plan, decision rules section. Precedence order highest first. No second label set anywhere.
// Note, open question, not silently resolved: this code maps an approval
// that runs out exactly at its expiry time to "not approved". A separate
// "expired approval" label is still undecided. Parv decides. If a ninth
// label is added, the combination count becomes 512 and the tests must run again.

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
