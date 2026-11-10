// One definition of "how far has the provider evidence for this payment got".
//
// The operational workspace snapshot and the payment operations projection both
// need this answer. It lives here so the two can never disagree.
import type { VerificationState } from "./productStore.ts";

/** The states a ledger payment can be in. `synthetic` and `historical_evidence_only` belong to records that never had one. */
export type LedgerVerificationState = Exclude<VerificationState, "synthetic" | "historical_evidence_only">;

export function deriveVerificationState(input: {
  /** Ledger payment status. */
  paymentStatus: string;
  /** True once a payout item (any provider outcome) is stored for the payment. */
  hasProviderItem: boolean;
  /** `last_reconciled_at` of the stored payout item, when one exists. */
  lastReconciledAt: string | null;
  /** Unresolved reconciliation discrepancies recorded for this payment. */
  discrepancyCount: number;
}): LedgerVerificationState {
  if (input.discrepancyCount > 0) return "discrepancy_detected";
  if (input.lastReconciledAt) return "reconciled";
  if (input.paymentStatus === "outcome_unknown") return "verification_unavailable";
  if (input.paymentStatus === "provider_confirmed") return "provider_confirmed";
  if (input.hasProviderItem) return "provider_response_received";
  return "unverified";
}
