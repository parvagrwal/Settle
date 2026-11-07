// Reporting — Transaction Search, REST only, NOT the Agent Toolkit package.
// GET /v1/reporting/transactions, the call the Toolkit's list_transactions
// tool makes. Do not confuse with the legacy NVP/SOAP Reporting API,
// which is a different, older API.
// A payout debit from the sender's account is negative in Reporting:
// a $1.00 payout shows as -1.00. The verifier compares absolute amounts.
import { paypalRequest, PayPalError, type FetchFn } from "./paypalClient.ts";

export const MAX_REPORTING_RANGE_DAYS = 31;
export const MAX_REPORTING_PAGE_SIZE = 500;

export interface ReportingTransaction {
  transactionId: string;
  eventCode: string;
  /** transaction_initiation_date, RFC 3339. */
  date: string;
  /** Signed integer cents. Negative means money left the account. */
  amountCents: number;
  currency: string;
  status: string;
  payerEmail: string | null;
  referenceId: string | null;
  raw: Record<string, unknown>;
}

export interface ReportingListResult {
  transactions: ReportingTransaction[];
  totalItems: number;
  totalPages: number;
  raw: Record<string, unknown>;
}

export function dollarsToCents(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`reporting: bad amount "${value}", expected a dollars string like "1.00"`);
  }
  return Math.round(parsed * 100);
}

export function toRfc3339(date: Date): string {
  // PayPal wants RFC 3339 with seconds. toISOString has milliseconds;
  // strip them so the date has seconds, not milliseconds.
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" ? value : null;
}

export async function listTransactions(opts: {
  baseUrl: string;
  token: string;
  startDate: Date;
  endDate: Date;
  pageSize?: number;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
}): Promise<ReportingListResult> {
  const pageSize = opts.pageSize ?? MAX_REPORTING_PAGE_SIZE;
  if (pageSize < 1 || pageSize > MAX_REPORTING_PAGE_SIZE) {
    throw new Error(`reporting: pageSize must be between 1 and ${MAX_REPORTING_PAGE_SIZE}`);
  }
  if (opts.endDate.getTime() <= opts.startDate.getTime()) {
    throw new Error("reporting: endDate must be after startDate");
  }
  const rangeMs = opts.endDate.getTime() - opts.startDate.getTime();
  if (rangeMs > MAX_REPORTING_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error(`reporting: search range must be ${MAX_REPORTING_RANGE_DAYS} days or less`);
  }
  const query = new URLSearchParams({
    start_date: toRfc3339(opts.startDate),
    end_date: toRfc3339(opts.endDate),
    fields: "all",
    page_size: String(pageSize),
  });
  const { json } = await paypalRequest({
    method: "GET",
    path: `${opts.baseUrl}/v1/reporting/transactions?${query.toString()}`,
    token: opts.token,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  const details = json.transaction_details;
  if (!Array.isArray(details)) {
    throw new PayPalError(200, "REPORTING_READ_FAILED", "Reporting reply had no transaction_details list");
  }
  const transactions: ReportingTransaction[] = details.map((entry) => {
    const detail = entry as Record<string, unknown>;
    const info = (detail.transaction_info ?? {}) as Record<string, unknown>;
    const payer = (detail.payer_info ?? {}) as Record<string, unknown>;
    const amount = (info.transaction_amount ?? {}) as Record<string, unknown>;
    const transactionId = readString(info, "transaction_id");
    const eventCode = readString(info, "transaction_event_code");
    const date = readString(info, "transaction_initiation_date");
    const currency = readString(amount, "currency_code");
    const value = readString(amount, "value");
    const status = readString(info, "transaction_status");
    if (!transactionId || !eventCode || !date || !currency || value === null || !status) {
      throw new PayPalError(200, "REPORTING_READ_FAILED", "Reporting transaction was missing an id, date, amount, or status");
    }
    return {
      transactionId,
      eventCode,
      date,
      amountCents: dollarsToCents(value),
      currency,
      status,
      payerEmail: readString(payer, "email_address"),
      referenceId: readString(info, "paypal_reference_id"),
      raw: detail,
    };
  });
  const totalItems = typeof json.total_items === "number" ? json.total_items : transactions.length;
  const totalPages = typeof json.total_pages === "number" ? json.total_pages : 1;
  return { transactions, totalItems, totalPages, raw: json };
}

export interface ReportingBalance {
  currency: string;
  availableCents: number | null;
  totalCents: number | null;
}

export async function listBalances(opts: {
  baseUrl: string;
  token: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
}): Promise<{ balances: ReportingBalance[]; raw: Record<string, unknown> }> {
  const { json } = await paypalRequest({
    method: "GET",
    path: `${opts.baseUrl}/v1/reporting/balances`,
    token: opts.token,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  const list = json.balances;
  if (!Array.isArray(list)) {
    throw new PayPalError(200, "REPORTING_READ_FAILED", "Balances reply had no balances list");
  }
  const balances: ReportingBalance[] = list.map((entry) => {
    const row = entry as Record<string, unknown>;
    const available = (row.available_balance ?? {}) as Record<string, unknown>;
    const total = (row.total_balance ?? {}) as Record<string, unknown>;
    const currency = readString(row, "currency");
    if (!currency) {
      throw new PayPalError(200, "REPORTING_READ_FAILED", "Balance row had no currency");
    }
    const availableValue = readString(available, "value");
    const totalValue = readString(total, "value");
    return {
      currency,
      availableCents: availableValue === null ? null : dollarsToCents(availableValue),
      totalCents: totalValue === null ? null : dollarsToCents(totalValue),
    };
  });
  return { balances, raw: json };
}
