// Money and PayPal fee helpers — amounts stay in integer cents on the
// server, and actual PayPal fees come directly from PayPal's reported
// `payout_item_fee` (sender-side fee in Payouts) rather than guessed
// cross-border card/checkout percentages.
export function actualFeeUsd(feeCents: number | null | undefined): number | null {
  return typeof feeCents === "number" && Number.isFinite(feeCents) ? feeCents / 100 : null;
}

export function centsToUsd(cents: number): number {
  return cents / 100;
}

/** "$1.00" from 100 cents. Always two decimals, so amounts line up. */
export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function usdOrUnreported(cents: number | null | undefined): string {
  return typeof cents === "number" && Number.isFinite(cents) ? usd(cents) : "Not reported";
}

/** How far an amount sits over a cap, in cents. Zero when it fits. */
export function overCapCents(amountCents: number, capCents: number): number {
  return Math.max(0, amountCents - capCents);
}
