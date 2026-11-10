// Compare two Reporting reads of the same range, the Toolkit's
// list_transactions and the direct REST list, and say whether they agree.
// Pure function, no PayPal call, so the verdict logic is testable.
// A match means: the transaction sets agree (no Toolkit-only row, no
// REST-only successful row), and every shared transaction agrees on the
// money fields, amount, currency, status, and date. One difference is
// expected and does not fail the check: the Toolkit does not surface the
// payer email on payout transactions, so a shared transaction whose payer
// is none via the Toolkit but named via REST is listed under payerDiffs,
// not under fieldDiffs. Verified live 2026-11-10, 29 of 70 shared
// transactions. The verifier does not need the payer: its payer check only
// fires if a payer IS named and equals the agent email, so a missing payer
// never triggers a diff, and its money checks use only the fields that
// agree here. Any other payer disagreement, a payer named by the Toolkit
// but not by REST, or two different named payers, is a real difference.
import type { ReportingTransaction } from "./reporting.ts";

export interface ReportingComparison {
  match: boolean;
  restOnly: { transactionId: string; status: string; amountCents: number }[];
  restOnlySuccessful: string[];
  toolkitOnly: string[];
  /** Real differences on shared transactions: amount, currency, status, date, or any payer disagreement other than the expected one. */
  fieldDiffs: string[];
  /** Expected differences only: payer none via the Toolkit but named via REST. */
  payerDiffs: string[];
}

function byId(rows: ReportingTransaction[]): Map<string, ReportingTransaction> {
  const map = new Map<string, ReportingTransaction>();
  for (const row of rows) map.set(row.transactionId, row);
  return map;
}

export function compareReportingPaths(
  toolkit: ReportingTransaction[],
  rest: ReportingTransaction[],
): ReportingComparison {
  const toolkitById = byId(toolkit);
  const restById = byId(rest);
  const restOnly: { transactionId: string; status: string; amountCents: number }[] = [];
  const restOnlySuccessful: string[] = [];
  for (const row of rest) {
    if (!toolkitById.has(row.transactionId)) {
      restOnly.push({ transactionId: row.transactionId, status: row.status, amountCents: row.amountCents });
      if (row.status === "S") restOnlySuccessful.push(row.transactionId);
    }
  }
  const toolkitOnly: string[] = [];
  for (const row of toolkit) {
    if (!restById.has(row.transactionId)) toolkitOnly.push(row.transactionId);
  }
  const fieldDiffs: string[] = [];
  const payerDiffs: string[] = [];
  for (const row of toolkit) {
    const other = restById.get(row.transactionId);
    if (!other) continue;
    if (other.amountCents !== row.amountCents) {
      fieldDiffs.push(`${row.transactionId}: amount is ${row.amountCents} cents via Toolkit but ${other.amountCents} via REST`);
    }
    if (other.currency !== row.currency) {
      fieldDiffs.push(`${row.transactionId}: currency is ${row.currency} via Toolkit but ${other.currency} via REST`);
    }
    if (other.status !== row.status) {
      fieldDiffs.push(`${row.transactionId}: status is ${row.status} via Toolkit but ${other.status} via REST`);
    }
    if (other.date !== row.date) {
      fieldDiffs.push(`${row.transactionId}: date is ${row.date} via Toolkit but ${other.date} via REST`);
    }
    if (other.payerEmail !== row.payerEmail) {
      if (row.payerEmail === null && other.payerEmail !== null) {
        payerDiffs.push(`${row.transactionId}: payer is none via Toolkit but ${other.payerEmail} via REST`);
      } else {
        fieldDiffs.push(`${row.transactionId}: payer is ${row.payerEmail ?? "none"} via Toolkit but ${other.payerEmail ?? "none"} via REST`);
      }
    }
  }
  const match = restOnlySuccessful.length === 0 && toolkitOnly.length === 0 && fieldDiffs.length === 0;
  return { match, restOnly, restOnlySuccessful, toolkitOnly, fieldDiffs, payerDiffs };
}
