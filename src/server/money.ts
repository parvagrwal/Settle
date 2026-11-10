// Authoritative money helpers.
//
// Financial values are integer minor units (cents) everywhere. Decimal strings
// from PayPal are parsed digit-by-digit, never through Number() on a fractional
// value, so 0.1 + 0.2 cannot become 0.30000000000000004 in a financial total.
// A currency with a different exponent would get its own parser; this product is
// USD-only by policy, and every other currency is refused at the boundary.

export type Currency = "USD";

export interface MinorOptions {
  allowZero?: boolean;
}

/** Strict `123` or `123.45`. Rejects exponent, sign, whitespace, separators and
 * any number of decimals other than two. */
export function parseDecimalToMinor(value: unknown, currency: Currency = "USD"): number {
  if (typeof value !== "string") throw new Error("provider amount must be a string in two-decimal major units");
  if (currency !== "USD") throw new Error(`unsupported currency ${currency}: this ledger is USD-only`);
  const match = /^(\d+)(?:\.(\d{2}))?$/.exec(value);
  if (!match) throw new Error(`"${value}" is not a two-decimal amount string`);
  const whole = BigInt(match[1]);
  const fraction = BigInt(match[2] ?? "0");
  const minor = whole * 100n + fraction;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("provider amount exceeds safe integer range");
  return Number(minor);
}

export function formatMinor(minor: number, currency: Currency = "USD"): string {
  assertMinor(minor, "amount", { allowZero: true });
  if (currency !== "USD") throw new Error(`unsupported currency ${currency}`);
  const whole = Math.trunc(minor / 100);
  const fraction = minor % 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

export function assertMinor(value: number, name: string, options: MinorOptions = {}): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer number of minor units`);
  if (options.allowZero ? value < 0 : value <= 0) {
    throw new Error(`${name} must be ${options.allowZero ? "a non-negative" : "a positive"} number of minor units`);
  }
}

export function sumMinor(values: number[]): number {
  let total = 0;
  for (const value of values) {
    assertMinor(value, "amount", { allowZero: true });
    total += value;
  }
  if (!Number.isSafeInteger(total)) throw new Error("sum exceeds safe integer range");
  return total;
}

/** Exact basis-point application with half-up rounding on the final minor unit.
 * Used only for published percentage fees, never for authoritative amounts. */
export function bpsOfMinor(minor: number, bps: number): number {
  assertMinor(minor, "amount", { allowZero: true });
  if (!Number.isSafeInteger(bps) || bps < 0) throw new Error("basis points must be a non-negative integer");
  const numerator = BigInt(minor) * BigInt(bps);
  const result = (numerator + 5000n) / 10000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("fee exceeds safe integer range");
  return Number(result);
}

/** Human cap text for policy messages: $1,500 for whole dollars, $3.50 otherwise. */
export function capText(cents: number): string {
  assertMinor(cents, "cap", { allowZero: true });
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
