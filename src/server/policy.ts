import type { Policy } from "../shared/types.ts";

// Locked caps from the pick file / PRD. Do not change without Parv's sign-off.
// Worst-case exposure: $1,500 per week. Print that wherever a cap is shown.
export const DEFAULT_POLICY: Policy = {
  perPaymentCapCents: 20000, // $200 per payment
  weeklyCapCents: 150000, // $1,500 per week combined
  windowMs: 7 * 24 * 60 * 60 * 1000,
  approvalExpiryMs: 7 * 24 * 60 * 60 * 1000,
};

export const WORST_CASE_EXPOSURE_TEXT = "Worst-case exposure: $1,500 per week.";
