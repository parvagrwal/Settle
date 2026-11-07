// Fee estimator — PayPal's published cross-border rates for India:
// 4.40% of the amount, plus $0.30 per payment, plus about 3% currency
// conversion. About $74.30 lost per $1,000 sent. This is an estimate from
// the published rates, not the exact fee, and it never claims the fee is
// removed. Amounts are in dollars here; the server keeps integer cents.
export const FEE_PERCENT = 0.044;
export const FX_PERCENT = 0.03;
export const FEE_FIXED_USD = 0.3;

export function estimateFeeUsd(amountUsd: number): number {
  return amountUsd * FEE_PERCENT + FEE_FIXED_USD + amountUsd * FX_PERCENT;
}

export function estimateNetUsd(amountUsd: number): number {
  return amountUsd - estimateFeeUsd(amountUsd);
}

export function centsToUsd(cents: number): number {
  return cents / 100;
}

/** "$1.00" from 100 cents. Always two decimals, so amounts line up. */
export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** How far an amount sits over a cap, in cents. Zero when it fits. */
export function overCapCents(amountCents: number, capCents: number): number {
  return Math.max(0, amountCents - capCents);
}
