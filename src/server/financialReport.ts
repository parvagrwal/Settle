// One financial projection, with the semantics of every number written down.
//
// The dashboard previously showed a "total paid" computed from seeded rows and a
// "rolling spend" computed from an empty provider table. Both numbers were real
// queries; neither meant what its label said. This module defines each figure
// once, states the window and the record origin it includes, and returns the
// query it came from, so a reader can check it instead of guessing.
import type { FinancialStore } from "./financialStore.ts";
import { DEFAULT_FEE_POLICY_ID, feePolicy } from "./fees.ts";

export interface Metric {
  value: number;
  currency: "USD";
  label: string;
  definition: string;
  window: string;
  includes: string;
  source: string;
  verification: string;
}

export interface FinancialReport {
  asOf: string;
  environment: { mode: "sandbox"; configured: boolean; connected: boolean; note: string };
  source: string;
  metrics: {
    lifetimeConfirmedGross: Metric;
    lifetimeReturned: Metric;
    rollingWindowSpend: Metric;
    activeReservations: Metric;
    awaitingConfirmation: Metric;
    pending: Metric;
    failed: Metric;
    outcomeUnknown: Metric;
    reconciliationRequired: Metric;
    unreconciledConfirmed: Metric;
    demoRecords: Metric;
  };
  fees: {
    policy: { policyId: string; version: number; formula: string; sourceUrl: string; retrievedAt: string };
    estimatedTotal: Metric;
    providerReportedTotal: Metric;
    providerReportedCount: number;
    missingProviderFeeCount: number;
    note: string;
  };
  cap: ReturnType<FinancialStore["getCapSummary"]>;
  discrepancies: number;
  explanations: { totalsDiffer: string; seeds: string; fees: string };
}

function metric(input: Omit<Metric, "currency">): Metric {
  return { ...input, currency: "USD" };
}

export function buildFinancialReport(opts: {
  financial: FinancialStore;
  at: string;
  providerConfigured: boolean;
  providerConnected: boolean;
  seedRecordCount: number;
  feePolicyId?: string;
}): FinancialReport {
  const m = opts.financial.metrics();
  const cap = opts.financial.getCapSummary(opts.at);
  const policy = feePolicy(opts.feePolicyId ?? DEFAULT_FEE_POLICY_ID);
  const discrepancies = opts.financial.getDiscrepancies().length;
  const origin = "application-origin payments only; seeded and synthetic records are excluded";
  const provider = "PayPal payout item evidence stored in this database";
  return {
    asOf: opts.at,
    environment: {
      mode: "sandbox",
      configured: opts.providerConfigured,
      connected: opts.providerConnected,
      note: opts.providerConnected
        ? "A PayPal Sandbox token was obtained by this server. Displayed records are still only the records stored here."
        : "PayPal Sandbox is not connected in this process. Nothing on this screen is a live provider reading, and no payment can be submitted.",
    },
    source: "SQLite financial ledger: payments, payout_items, provider_spend, fee_estimates, provider_fee_evidence",
    metrics: {
      lifetimeConfirmedGross: metric({
        value: m.lifetimeConfirmedMinor,
        label: "Lifetime provider-confirmed payouts (gross)",
        definition: "Sum of payout item amounts whose stored provider status is SUCCESS, for all time.",
        window: "lifetime",
        includes: origin,
        source: provider,
        verification: m.unreconciledConfirmedCount > 0
          ? `${m.unreconciledConfirmedCount} confirmed item(s) have not yet been independently re-read from PayPal`
          : "every confirmed item has been independently re-read at least once",
      }),
      lifetimeReturned: metric({
        value: m.lifetimeReturnedMinor,
        label: "Lifetime returned, reversed or refunded",
        definition: "Sum of payout item amounts whose latest provider status is RETURNED, REVERSED or REFUNDED.",
        window: "lifetime",
        includes: origin,
        source: provider,
        verification: "provider status, latest observed event wins",
      }),
      rollingWindowSpend: metric({
        value: cap.eligibleSpendCents,
        label: `Rolling ${Math.round((Date.parse(cap.windowEnd) - Date.parse(cap.windowStart)) / 3600000)}-hour expenditure`,
        definition: "Provider-timestamped SUCCESS amounts inside the current rolling window, minus documented returns and reversals. This is the figure the owner cap is enforced against.",
        window: `${cap.windowStart} to ${cap.windowEnd}`,
        includes: origin,
        source: "provider_spend rows written from provider item evidence",
        verification: cap.fresh
          ? `provider reconciliation completed at ${cap.lastSuccessfulReconciliation}`
          : `provider reconciliation is stale or has never run${cap.lastSuccessfulReconciliation ? ` (last ${cap.lastSuccessfulReconciliation})` : ""}`,
      }),
      activeReservations: metric({
        value: m.activeReservationMinor,
        label: "Active reservations",
        definition: "Approved amounts reserved atomically against the cap and not yet sent to PayPal.",
        window: "current",
        includes: origin,
        source: "payments.status = reserved",
        verification: "internal authorization only; no provider evidence exists yet",
      }),
      awaitingConfirmation: metric({
        value: m.awaitingConfirmationMinor,
        label: "Awaiting PayPal confirmation",
        definition: "Batches PayPal accepted whose items have not settled yet. Durable confirmation work is scheduled for each.",
        window: "current",
        includes: origin,
        source: "payments.status = awaiting_confirmation",
        verification: "provider acknowledged the batch; the item outcome is not yet known",
      }),
      pending: metric({
        value: m.pendingMinor,
        label: "Pending, unclaimed or on hold at PayPal",
        definition: "Payout items whose stored provider status is PENDING, UNCLAIMED or ONHOLD.",
        window: "current",
        includes: origin,
        source: provider,
        verification: "provider status; not a failure and not a success",
      }),
      failed: metric({
        value: m.failedMinor,
        label: "Failed or blocked",
        definition: "Payments whose provider status is FAILED or BLOCKED, or whose create request PayPal definitively refused.",
        window: "current",
        includes: origin,
        source: provider,
        verification: "provider refusal; no money is expected to move",
      }),
      outcomeUnknown: metric({
        value: m.outcomeUnknownMinor,
        label: "Outcome unknown",
        definition: "Submissions whose provider response was lost. These require reconciliation by durable identity and are never resubmitted automatically.",
        window: "current",
        includes: origin,
        source: "payments.status = outcome_unknown",
        verification: "unverified; may or may not have executed",
      }),
      reconciliationRequired: metric({
        value: m.reconciliationRequiredMinor,
        label: "Reconciliation required",
        definition: "Payments whose confirmation budget was exhausted without a terminal provider outcome.",
        window: "current",
        includes: origin,
        source: "payments.status = reconciliation_required",
        verification: "unresolved; needs an operator or a later provider read",
      }),
      unreconciledConfirmed: metric({
        value: m.unreconciledConfirmedCount,
        label: "Confirmed items not yet independently re-read",
        definition: "Count of SUCCESS items whose last_reconciled_at is null.",
        window: "lifetime",
        includes: origin,
        source: provider,
        verification: "a count, not an amount",
      }),
      demoRecords: metric({
        value: opts.seedRecordCount,
        label: "Seeded demonstration records (excluded)",
        definition: "Rows from data/seed.json shown for illustration. They are excluded from every monetary total above and cannot be submitted to PayPal.",
        window: "n/a",
        includes: "seed-origin records only",
        source: "legacy dashboard grid",
        verification: "not provider evidence; no checked-in PayPal artifact backs these rows",
      }),
    },
    fees: {
      policy: {
        policyId: policy.policyId,
        version: policy.version,
        formula: policy.formula,
        sourceUrl: policy.source.url,
        retrievedAt: policy.source.retrievedAt,
      },
      estimatedTotal: metric({
        value: m.feeEstimateMinor,
        label: "Estimated sender fees",
        definition: "Sum of the per-payment estimates stored before submission, using the cited policy version.",
        window: "lifetime of stored estimates",
        includes: origin,
        source: "fee_estimates",
        verification: "estimate only; not a charge",
      }),
      providerReportedTotal: metric({
        value: m.providerFeeMinor,
        label: "Provider-reported fees",
        definition: "Sum of the fee amounts PayPal reported on payout items. PayPal describes this field as an estimate populated from PENDING onward.",
        window: "lifetime of stored provider fees",
        includes: origin,
        source: "provider_fee_evidence",
        verification: `${m.providerFeeReportedCount} item(s) reported a fee; ${m.feeMissingProvider ?? m.feeMissingCount} confirmed item(s) did not`,
      }),
      providerReportedCount: m.providerFeeReportedCount,
      missingProviderFeeCount: m.feeMissingCount,
      note: "Recipients receive the full payout amount. The Payouts fee is charged to the sender and is not deducted from the recipient's amount.",
    },
    cap,
    discrepancies,
    explanations: {
      totalsDiffer:
        "Lifetime and rolling figures differ by definition: lifetime is all time, the rolling figure is the last 168 hours and is the only number the owner cap is enforced against. A payment confirmed before the window opened appears in lifetime and not in rolling.",
      seeds:
        "Seeded rows in data/seed.json are demonstration records. They are not counted here, cannot be reserved, and are refused before any PayPal call.",
      fees:
        "An estimate and a provider-reported fee are different facts. The estimate is computed from the cited published policy; the provider amount is what PayPal reported for that item. Neither is inferred from the other, and an absent fee is shown as unknown rather than zero.",
    },
  };
}
