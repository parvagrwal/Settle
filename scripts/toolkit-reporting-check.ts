// Toolkit vs REST comparison — proves the Toolkit path reads the same
// Reporting truth as the direct REST path, on live sandbox data.
// Sandbox only, test money, no real money moves.
// Run: node --experimental-strip-types scripts/toolkit-reporting-check.ts
// Needs local .env with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_ENV=sandbox. Never paste secrets in a message.
// Both paths call GET /v1/reporting/transactions for the same 7-day range.
// Two differences are expected and are not failures: (1) the Toolkit's
// list_transactions returns successful transactions only, while the REST
// path returns every status. So REST-only rows with a status other than S
// are listed separately and do not fail the check. (2) The Toolkit does not
// surface the payer email on payout transactions, so a shared transaction
// whose payer is none via the Toolkit but named via REST is listed
// separately and does not fail the check. Verified live 2026-11-10, 29 of
// 70 shared transactions; the installed Toolkit package never references
// payer_info, and the verifier does not need the payer. A REST-only row
// with status S, a Toolkit-only row, or a field that disagrees on a shared
// transaction, amount, currency, status, date, or any other payer
// disagreement, is a real difference and exits 1.
// Saves evidence/toolkit-verifier/comparison.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "../src/server/config.ts";
import { PayPalAuth } from "../src/server/auth.ts";
import { listTransactions } from "../src/server/reporting.ts";
import { listTransactionsViaToolkit } from "../src/server/toolkitReporting.ts";
import { compareReportingPaths } from "../src/server/reportingCompare.ts";

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

const comparison = compareReportingPaths(toolkit.transactions, rest.transactions);
const { restOnly, restOnlySuccessful, toolkitOnly, fieldDiffs, payerDiffs } = comparison;
out(`REST-only rows: ${restOnly.length}. Of those, successful (status S): ${restOnlySuccessful.length}.`);
for (const row of restOnly) {
  out(`  REST-only: ${row.transactionId}, status ${row.status}, ${row.amountCents} cents.`);
}
out(`Toolkit-only rows: ${toolkitOnly.length}.`);
for (const id of toolkitOnly) out(`  Toolkit-only: ${id}.`);
out(`Field differences on shared transactions: ${fieldDiffs.length}.`);
for (const line of fieldDiffs) out(`  - ${line}.`);
out(`Payer differences on shared transactions (expected, not a failure): ${payerDiffs.length}.`);
for (const line of payerDiffs) out(`  - ${line}.`);

const match = comparison.match;
if (match) {
  out("COMPARISON: MATCH. The Toolkit path and the REST path agree on every shared transaction.");
  if (payerDiffs.length > 0) {
    out(`Expected difference, not a failure: the Toolkit does not surface the payer email on ${payerDiffs.length} shared transaction(s); the verifier does not use it.`);
  }
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
      payerDiffs,
      expectedDifferences:
        "The Toolkit does not surface the payer email on payout transactions (verified live 2026-11-10, 29 of 70 shared transactions); those rows are listed under payerDiffs and do not fail the check. The verifier does not use the payer email.",
      match,
    },
    null,
    2,
  ) + "\n",
);
out("Done. Evidence in evidence/toolkit-verifier/comparison.json.");

if (!match) process.exit(1);
