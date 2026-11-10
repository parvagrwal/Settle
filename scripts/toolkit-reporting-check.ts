// Toolkit vs REST comparison — proves the Toolkit path reads the same
// Reporting truth as the direct REST path, on live sandbox data.
// Sandbox only, test money, no real money moves.
// Run: node --experimental-strip-types scripts/toolkit-reporting-check.ts
// Needs local .env with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_ENV=sandbox. Never paste secrets in a message.
// Both paths call GET /v1/reporting/transactions for the same 7-day range.
// One difference is expected and is not a failure: the Toolkit's
// list_transactions returns successful transactions only, while the REST
// path returns every status. So REST-only rows with a status other than S
// are listed separately and do not fail the check. A REST-only row with
// status S, a Toolkit-only row, or a field that disagrees on a shared
// transaction is a real difference and exits 1.
// Saves evidence/toolkit-verifier/comparison.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "../src/server/config.ts";
import { PayPalAuth } from "../src/server/auth.ts";
import { listTransactions, type ReportingTransaction } from "../src/server/reporting.ts";
import { listTransactionsViaToolkit } from "../src/server/toolkitReporting.ts";

function loadEnv(path = ".env"): void {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // No .env file. loadConfig will throw a clear error naming the missing key.
  }
}

const lines: string[] = [];
function out(line: string): void {
  lines.push(line);
  console.log(line);
}

loadEnv();
const config = loadConfig();
const auth = new PayPalAuth(config.baseUrl, config.clientId, config.clientSecret);
const token = await auth.getToken();
out("Token: HTTP 200, token received. Token is NOT printed, NOT saved to a committed file.");
const refreshToken = async (): Promise<string> => {
  auth.invalidate();
  return auth.getToken();
};

const endDate = new Date();
const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
out(`Range: ${startDate.toISOString()} to ${endDate.toISOString()}, last 7 days.`);

// Toolkit path: the verifier's Reporting read.
const toolkit = await listTransactionsViaToolkit({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
  sandbox: config.env === "sandbox",
  startDate,
  endDate,
});
out(`Toolkit list_transactions: ${toolkit.transactions.length} transactions (successful only).`);

// REST path: the same endpoint, direct, every status.
const rest = await listTransactions({
  baseUrl: config.baseUrl,
  token,
  startDate,
  endDate,
  refreshToken,
});
out(`REST Reporting: ${rest.transactions.length} transactions (every status).`);

function byId(rows: ReportingTransaction[]): Map<string, ReportingTransaction> {
  const map = new Map<string, ReportingTransaction>();
  for (const row of rows) map.set(row.transactionId, row);
  return map;
}

const toolkitById = byId(toolkit.transactions);
const restById = byId(rest.transactions);
const restOnly: { transactionId: string; status: string; amountCents: number }[] = [];
const restOnlySuccessful: string[] = [];
for (const row of rest.transactions) {
  if (!toolkitById.has(row.transactionId)) {
    restOnly.push({ transactionId: row.transactionId, status: row.status, amountCents: row.amountCents });
    if (row.status === "S") restOnlySuccessful.push(row.transactionId);
  }
}
const toolkitOnly: string[] = [];
for (const row of toolkit.transactions) {
  if (!restById.has(row.transactionId)) toolkitOnly.push(row.transactionId);
}
const fieldDiffs: string[] = [];
for (const row of toolkit.transactions) {
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
    fieldDiffs.push(`${row.transactionId}: payer is ${row.payerEmail ?? "none"} via Toolkit but ${other.payerEmail ?? "none"} via REST`);
  }
}

out(`REST-only rows: ${restOnly.length}. Of those, successful (status S): ${restOnlySuccessful.length}.`);
for (const row of restOnly) {
  out(`  REST-only: ${row.transactionId}, status ${row.status}, ${row.amountCents} cents.`);
}
out(`Toolkit-only rows: ${toolkitOnly.length}.`);
for (const id of toolkitOnly) out(`  Toolkit-only: ${id}.`);
out(`Field differences on shared transactions: ${fieldDiffs.length}.`);
for (const line of fieldDiffs) out(`  - ${line}.`);

const match = restOnlySuccessful.length === 0 && toolkitOnly.length === 0 && fieldDiffs.length === 0;
if (match) {
  out("COMPARISON: MATCH. The Toolkit path and the REST path agree on every shared transaction.");
} else {
  out("COMPARISON: DIFFERENCE. The two paths disagree, see the lines above.");
}

mkdirSync("evidence/toolkit-verifier", { recursive: true });
writeFileSync(
  "evidence/toolkit-verifier/comparison.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      range: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      toolkitVersion: "1.11.0",
      toolkit: {
        count: toolkit.transactions.length,
        transactionIds: toolkit.transactions.map((row) => row.transactionId),
      },
      rest: {
        count: rest.transactions.length,
        transactionIds: rest.transactions.map((row) => row.transactionId),
      },
      restOnly,
      toolkitOnly,
      fieldDiffs,
      match,
    },
    null,
    2,
  ) + "\n",
);
out("Done. Evidence in evidence/toolkit-verifier/comparison.json.");

if (!match) process.exit(1);
