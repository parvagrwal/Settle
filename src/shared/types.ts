import type { RejectLabel } from "./labels.ts";

// Amounts are integer cents everywhere in code. Dollars appear only as
// strings in PayPal payloads (Payouts integration, amounts as integer cents). Worst-case exposure $1,500/week.
export interface Policy {
  /** Per-payment cap, cents. $200 = 20000. */
  perPaymentCapCents: number;
  /** Weekly combined cap, cents. $1,500 = 150000. */
  weeklyCapCents: number;
  /** Rolling window length, ms. 7 days. */
  windowMs: number;
  /** Approval lifetime, ms. 7 days from approval. */
  approvalExpiryMs: number;
}

export interface State {
  actorAuthorized: boolean;
  systemSuspended: boolean;
  jobApproved: boolean;
  /** ms epoch when this job's approval lapses; null = no expiry recorded. */
  approvalExpiresAtMs: number | null;
  recipientAllowed: boolean;
  alreadyPaid: boolean;
  /** Cents already spent inside the current rolling window. */
  spentInWindowCents: number;
}

export interface PaymentRequest {
  jobId: string;
  recipient: string;
  /** Integer cents. Must be an integer; decide() throws otherwise. */
  amountCents: number;
}

export type Decision =
  | { decision: "accept" }
  | { decision: "reject"; label: RejectLabel; reason: string };
