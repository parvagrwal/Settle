// Formatting for the product screens.
//
// Money is stored as integer cents and is always rendered with two decimals and
// tabular figures. A value that the server did not report is never formatted as
// zero: it is shown as an explicit "not reported" label, because an unknown fee
// is not a zero fee.

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function money(cents: number | null | undefined, options: { unknown?: string } = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return options.unknown ?? "Not reported";
  return USD.format(cents / 100);
}

/** Money for a statement of fact that the server did not measure. Never "$0.00". */
export function unknownMoney(cents: number | null | undefined): string {
  return money(cents, { unknown: "Not reported — unknown, not zero" });
}

export function date(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return `${parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, ${parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

/** A relative day phrase for a due date. Returns null when there is no date. */
export function duePhrase(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = Date.now();
  const days = Math.round((parsed.getTime() - today) / 86_400_000);
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `due in ${days} days`;
}

export function percent(part: number, whole: number): number {
  if (!Number.isFinite(whole) || whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

/** A short identifier that stays readable but never implies a value it lacks. */
export function shortId(value: string | null | undefined, length = 18): string {
  if (!value) return "Not recorded";
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}
