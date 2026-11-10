// Shared helpers for the browser tests: labelled fixtures, API mocks and a
// console recorder. Fixtures are always labelled as fixtures; nothing here is
// presented as PayPal evidence.
import type { Page } from "@playwright/test";

export const FIXTURE_SOURCE = "AUTOMATED TEST FIXTURE — NOT PAYPAL";

export interface TransactionFixture {
  rowKey: string; originalTransactionId: string | null; associatedOrderId: string | null; latestEventId: string; originalEventId: string;
  transactionTimestamp: string | null; eventCreatedAt: string; eventReceivedAt: string; status: string; grossCents: number | null;
  currency: string | null; feeCents: number | null; netCents: number | null; payerEmail: string | null; payeeEmail: string | null;
  paymentMethod: string | null; payoutBatchId: string | null; payoutItemId: string | null; jobId: string | null;
  relatedTransactionId: string | null; lastEventSequence: number;
}

export const transaction: TransactionFixture = {
  rowKey: "TEST-POI-1", originalTransactionId: "TEST-TX-1", associatedOrderId: null,
  latestEventId: "TEST-WH-1", originalEventId: "TEST-WH-1", transactionTimestamp: "2026-11-09T10:00:00Z",
  eventCreatedAt: "2026-11-09T10:00:01Z", eventReceivedAt: "2026-11-09T10:00:02Z",
  status: "PENDING", grossCents: 12500, currency: "USD", feeCents: null, netCents: null,
  payerEmail: null, payeeEmail: "fixture@example.test", paymentMethod: "PAYPAL",
  payoutBatchId: "TEST-BATCH-1", payoutItemId: "TEST-POI-1", jobId: "test-job-1", relatedTransactionId: null,
  lastEventSequence: 1,
};

export function transactions(count: number): TransactionFixture[] {
  const statuses = ["PENDING", "SUCCESS", "FAILED", "SUCCESS", "UNCLAIMED", "SUCCESS", "RETURNED", "SUCCESS"];
  return Array.from({ length: count }, (_, index) => {
    const status = statuses[index % statuses.length];
    const gross = 2500 * (index + 1);
    return {
      ...transaction,
      rowKey: `TEST-POI-${index + 1}`, payoutItemId: `TEST-POI-${index + 1}`, originalTransactionId: `TEST-TX-${index + 1}`,
      latestEventId: `TEST-WH-${index + 1}`, originalEventId: `TEST-WH-${index + 1}`, status, grossCents: gross,
      feeCents: status === "SUCCESS" ? 25 : null, netCents: status === "SUCCESS" ? gross - 25 : null,
      jobId: `test-job-${index + 1}`, lastEventSequence: index + 1, eventCreatedAt: `2026-11-0${(index % 9) + 1}T10:00:01Z`,
    };
  });
}

/** History in the shape the server really returns (`transactionStore.getHistory`). */
export function historyFor(row: TransactionFixture) {
  return {
    transaction: row,
    events: [{
      sequence: 1, eventId: row.latestEventId, eventType: "PAYMENT.PAYOUTS-ITEM.PENDING", eventCreatedAt: row.eventCreatedAt,
      eventReceivedAt: row.eventReceivedAt, outcome: "applied", correlationId: "TEST-TRANSMISSION", rawEvent: {},
    }],
  };
}

/** Every API call gets an explicit answer. Unmocked routes fail loudly instead of reaching a proxy. */
export async function mockApi(page: Page, rows: TransactionFixture[] | (() => TransactionFixture[])): Promise<void> {
  const current = () => (typeof rows === "function" ? rows() : rows);
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: `not mocked: ${new URL(route.request().url()).pathname}` } }));
  await page.route("**/api/grid", (route) => route.fulfill({ json: { rows: [] } }));
  await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route("**/api/audit", (route) => route.fulfill({ json: { rows: [] } }));
  await page.route("**/api/caps", (route) => route.fulfill({ json: { per_payment_cap_cents: 20000, weekly_cap_cents: 150000, window_days: 7, approval_expiry_days: 7, worst_case_exposure: "$1,500" } }));
  await page.route("**/api/transactions?since=*", (route) => {
    const since = Number(new URL(route.request().url()).searchParams.get("since") ?? "0");
    const list = current();
    const cursor = list.reduce((max, row) => Math.max(max, row.lastEventSequence), 0);
    return route.fulfill({ json: { transactions: list.filter((row) => row.lastEventSequence > since), cursor, serverTime: new Date().toISOString(), source: FIXTURE_SOURCE } });
  });
  await page.route("**/api/transactions/*/history", (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-2) ?? "");
    const row = current().find((candidate) => candidate.rowKey === key);
    return row ? route.fulfill({ json: historyFor(row) }) : route.fulfill({ status: 404, json: { error: "transaction not found" } });
  });
}

export interface ConsoleEntry { kind: "console" | "pageerror"; type: string; text: string }

export function recordConsole(page: Page): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  page.on("console", (message) => entries.push({ kind: "console", type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => entries.push({ kind: "pageerror", type: "error", text: String(error?.stack ?? error) }));
  return entries;
}

/** The documented trial notice printed when no licence key is configured. It is the only AG output allowed without a key. */
const LICENCE_NOTICE = /^\*{20,}|AG (Grid|Studio|Charts)[\w ]* License|License Key Not Found|features are unlocked for trial|hide the watermark|^\* +\*$/;

export function agProblems(entries: ConsoleEntry[]): string[] {
  return entries
    .filter((entry) => entry.kind === "pageerror" || entry.type === "error" || entry.type === "warning")
    .filter((entry) => entry.kind === "pageerror" || /AG Grid|AG Studio|AG Charts|ag-grid|ag-studio|ag-charts/i.test(entry.text) || /^\*{20,}/.test(entry.text))
    .map((entry) => entry.text.replace(/\s+/g, " ").trim())
    .filter((text) => !LICENCE_NOTICE.test(text));
}

export function licenceNotices(entries: ConsoleEntry[]): string[] {
  return entries.map((entry) => entry.text.replace(/\s+/g, " ").trim()).filter((text) => /License Key Not Found|Invalid License|Incompatible License|Trial Period Expired|Incompatible Software Version/i.test(text));
}

export async function gridRowIds(page: Page, scope = "body"): Promise<string[]> {
  return page.evaluate((selector) => [...new Set([...document.querySelectorAll(`${selector} [role='row'][row-id]`)].map((element) => element.getAttribute("row-id") ?? ""))], scope);
}

export async function horizontalOverflow(page: Page): Promise<{ clientWidth: number; scrollWidth: number; offenders: string[] }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const offenders: string[] = [];
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= root.clientWidth + 1) continue;
      if (getComputedStyle(element).position === "fixed") continue;
      let parent = element.parentElement;
      let contained = false;
      while (parent && parent !== document.body) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden" || overflowX === "clip") { contained = true; break; }
        parent = parent.parentElement;
      }
      if (!contained) offenders.push(`${element.tagName.toLowerCase()}.${String((element as HTMLElement).className).slice(0, 60)}`);
    }
    return { clientWidth: root.clientWidth, scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth), offenders: offenders.slice(0, 10) };
  });
}
