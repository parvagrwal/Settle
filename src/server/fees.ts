// Payouts fee model.
//
// Two facts are kept apart on purpose:
//
//   1. A *policy estimate* — what PayPal's published schedule implies for this
//      product, channel and currency, at a named version, with a source URL and a
//      retrieval date. It is an estimate and is labelled as one.
//
//   2. An *observed provider fee* — an amount PayPal actually reported for a
//      specific payout item or batch, at a specific provider timestamp.
//
// A fee observed once is evidence about that payment, not a schedule. The
// analysis helpers below compare observations with policies and report a
// discrepancy; they never rewrite the policy from a single transaction.
//
// PayPal's own OpenAPI description of `payout_item_fee` is an "estimate for the
// payout fee ... populated after the item moves to the PENDING state", and the
// batch `fees` field is "the total estimate for the applicable payouts fees".
// Both are therefore stored as provider-reported estimates, not as audited costs.
import { bpsOfMinor, assertMinor, type Currency } from "./money.ts";

export type FeeChannel = "api" | "web";

export interface FeePolicy {
  policyId: string;
  version: number;
  product: "payouts";
  channel: FeeChannel;
  senderCountry: "US";
  currency: Currency;
  /** "flat_per_item": a fixed amount for each payout item.
   *  "percent_capped": basis points of each item amount, capped per item. */
  method: "flat_per_item" | "percent_capped";
  flatMinor: number;
  rateBps: number;
  capMinor: number | null;
  formula: string;
  source: { title: string; url: string; retrievedAt: string };
  status: "published" | "observed_sandbox";
}

const RETRIEVED_AT = "2026-11-10";
const FEE_PAGE = "https://www.paypal.com/us/business/paypal-business-fees";

/**
 * Published schedule, US sender, USD payout. PayPal lists a flat rate for the
 * Payouts API and a capped 2% rate for Payouts outside the API. Sandbox fees are
 * not guaranteed to mirror production pricing, which is why every payment also
 * records what PayPal actually reported.
 */
export const FEE_POLICIES: Record<string, FeePolicy> = {
  "paypal-us-payouts-api-flat-2026-10": {
    policyId: "paypal-us-payouts-api-flat-2026-10",
    version: 1,
    product: "payouts",
    channel: "api",
    senderCountry: "US",
    currency: "USD",
    method: "flat_per_item",
    flatMinor: 25,
    rateBps: 0,
    capMinor: null,
    formula: "USD 0.25 flat per payout item",
    source: { title: "PayPal Merchant Fees — Sending PayPal Payouts (US, Payouts API)", url: FEE_PAGE, retrievedAt: RETRIEVED_AT },
    status: "published",
  },
  "paypal-us-payouts-web-2pct-cap-2026-10": {
    policyId: "paypal-us-payouts-web-2pct-cap-2026-10",
    version: 1,
    product: "payouts",
    channel: "web",
    senderCountry: "US",
    currency: "USD",
    method: "percent_capped",
    flatMinor: 0,
    rateBps: 200,
    capMinor: 100,
    formula: "2% of the payout item amount, capped at USD 1.00 per item",
    source: { title: "PayPal Merchant Fees — Sending PayPal Payouts (US, maximum fee cap)", url: FEE_PAGE, retrievedAt: RETRIEVED_AT },
    status: "published",
  },
};

export const DEFAULT_FEE_POLICY_ID = "paypal-us-payouts-api-flat-2026-10";

export function feePolicy(policyId: string = DEFAULT_FEE_POLICY_ID): FeePolicy {
  const policy = FEE_POLICIES[policyId];
  if (!policy) throw new Error(`unknown fee policy ${policyId}`);
  return policy;
}

export interface FeeEstimate {
  amountMinor: number;
  estimatedFeeMinor: number;
  currency: Currency;
  policyId: string;
  policyVersion: number;
  method: FeePolicy["method"];
  formula: string;
  isEstimate: true;
  /** Non-null when the estimate cannot be applied cleanly. */
  note: string | null;
  source: FeePolicy["source"];
}

export function estimatePayoutFee(opts: { amountMinor: number; policyId?: string }): FeeEstimate {
  const policy = feePolicy(opts.policyId);
  assertMinor(opts.amountMinor, "payout amount");
  let fee = policy.flatMinor;
  if (policy.method === "percent_capped") {
    fee = bpsOfMinor(opts.amountMinor, policy.rateBps);
    if (policy.capMinor !== null) fee = Math.min(fee, policy.capMinor);
  }
  assertMinor(fee, "estimated fee", { allowZero: true });
  return {
    amountMinor: opts.amountMinor,
    estimatedFeeMinor: fee,
    currency: policy.currency,
    policyId: policy.policyId,
    policyVersion: policy.version,
    method: policy.method,
    formula: policy.formula,
    isEstimate: true,
    note: null,
    source: policy.source,
  };
}

export interface BatchFeeEstimate {
  estimatedFeeMinor: number;
  currency: Currency;
  policyId: string;
  policyVersion: number;
  formula: string;
  isEstimate: true;
  source: FeePolicy["source"];
  perItem: Array<{ amountMinor: number; estimatedFeeMinor: number }>;
}

/** A Payouts fee applies per payout item, so a batch of N items is N fee events. */
export function estimateBatchFee(amountsMinor: number[], policyId?: string): BatchFeeEstimate {
  if (amountsMinor.length === 0) throw new Error("a batch estimate needs at least one payout item");
  const perItem = amountsMinor.map((amountMinor) => {
    const estimate = estimatePayoutFee({ amountMinor, policyId });
    return { amountMinor, estimatedFeeMinor: estimate.estimatedFeeMinor };
  });
  const first = estimatePayoutFee({ amountMinor: amountsMinor[0], policyId });
  return {
    estimatedFeeMinor: perItem.reduce((sum, row) => sum + row.estimatedFeeMinor, 0),
    currency: first.currency,
    policyId: first.policyId,
    policyVersion: first.policyVersion,
    formula: first.formula,
    isEstimate: true,
    source: first.source,
    perItem,
  };
}

export interface FeeObservationInput {
  environment: "sandbox" | "production";
  batchId: string;
  batchFeeMinor?: number | null;
  items: Array<{ payoutItemId: string; amountMinor: number; feeMinor: number | null }>;
}

export interface FeeObservation {
  environment: "sandbox" | "production";
  batchId: string;
  itemCount: number;
  grossMinor: number;
  reportedFeeMinor: number;
  batchFeeMinor: number | null;
  batchFeeMatchesItemSum: boolean | null;
  observedBps: number[];
  consistentWithPolicyIds: string[];
  note: string;
}

/** Compare what PayPal reported with each published policy. The result is
 * evidence for one batch. It is deliberately not a fee schedule. */
export function observeFees(input: FeeObservationInput): FeeObservation {
  if (input.items.length === 0) throw new Error("an observation needs at least one payout item");
  const reported = input.items.filter((row) => row.feeMinor !== null);
  const grossMinor = input.items.reduce((sum, row) => sum + row.amountMinor, 0);
  const reportedFeeMinor = reported.reduce((sum, row) => sum + (row.feeMinor ?? 0), 0);
  const observedBps = reported.map((row) => Math.round(((row.feeMinor ?? 0) * 10000) / row.amountMinor));
  const consistentWithPolicyIds = Object.values(FEE_POLICIES)
    .filter((policy) => reported.length === input.items.length && input.items.every((row) => {
      const estimate = estimatePayoutFee({ amountMinor: row.amountMinor, policyId: policy.policyId });
      return estimate.estimatedFeeMinor === row.feeMinor;
    }))
    .map((policy) => policy.policyId);
  const batchFeeMatchesItemSum = input.batchFeeMinor === undefined || input.batchFeeMinor === null
    ? null
    : input.batchFeeMinor === reportedFeeMinor;
  const rate = observedBps.length > 0 ? `${(observedBps[0] / 100).toFixed(2)}%` : "unreported";
  return {
    environment: input.environment,
    batchId: input.batchId,
    itemCount: input.items.length,
    grossMinor,
    reportedFeeMinor,
    batchFeeMinor: input.batchFeeMinor ?? null,
    batchFeeMatchesItemSum,
    observedBps,
    consistentWithPolicyIds,
    note:
      `Observed ${reported.length} item fee(s) (${rate}) in one batch (${input.environment}). This is one observation and ` +
      "does not establish a fee schedule; provider-reported fees are stored per payment and are not inferred for other amounts.",
  };
}

export interface FeeConsistency {
  amountMinor: number;
  reportedFeeMinor: number | null;
  expectedFeeMinor: number;
  deltaMinor: number | null;
  consistent: boolean | null;
  policyId: string;
  policyVersion: number;
  explanation: string;
}

export function providerFeeConsistency(opts: {
  amountMinor: number;
  reportedFeeMinor: number | null;
  policyId?: string;
}): FeeConsistency {
  const estimate = estimatePayoutFee({ amountMinor: opts.amountMinor, policyId: opts.policyId });
  if (opts.reportedFeeMinor === null) {
    return {
      amountMinor: opts.amountMinor,
      reportedFeeMinor: null,
      expectedFeeMinor: estimate.estimatedFeeMinor,
      deltaMinor: null,
      consistent: null,
      policyId: estimate.policyId,
      policyVersion: estimate.policyVersion,
      explanation: `PayPal has not reported a fee for this item. The published estimate (${estimate.formula}) is shown as an estimate only.`,
    };
  }
  assertMinor(opts.reportedFeeMinor, "reported fee", { allowZero: true });
  const deltaMinor = opts.reportedFeeMinor - estimate.estimatedFeeMinor;
  return {
    amountMinor: opts.amountMinor,
    reportedFeeMinor: opts.reportedFeeMinor,
    expectedFeeMinor: estimate.estimatedFeeMinor,
    deltaMinor,
    consistent: deltaMinor === 0,
    policyId: estimate.policyId,
    policyVersion: estimate.policyVersion,
    explanation: deltaMinor === 0
      ? "The provider-reported fee matches the published estimate for this item."
      : `The provider-reported fee differs from the published estimate by ${deltaMinor} minor units. The provider amount is authoritative for this payment; the policy is not changed.`,
  };
}
