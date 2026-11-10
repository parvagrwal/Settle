// Live verifier run — recompute the grid from PayPal, not from the app.
// Sandbox only, test money, no real money moves.
// Run: node --experimental-strip-types scripts/run-verify.ts
// Needs local .env with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_ENV=sandbox, PAYPAL_SANDBOX_RECEIVER_EMAIL. Never paste secrets
// in a message.
// The stored copy is evidence/payouts/payouts-create.json, the payout
// record. Path 1 reads Reporting live, through the Toolkit's
// list_transactions tool. Path 2 reads the Payouts batch live. The verifier compares all three and prints MATCH or DRIFT.
// Reporting can lag behind Payouts by hours, so a drift that says a
// transaction is not found in Reporting yet is a real finding, not a
// script failure. Re-run later to see if Reporting has caught up.
// Saves evidence/verifier/recompute.json and verifier-output.txt.
// Pass: VERIFIER: MATCH. A drift exits 1 and needs attention.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "../src/server/config.ts";
import { PayPalAuth } from "../src/server/auth.ts";
import { pollPayoutBatch } from "../src/server/payouts.ts";
import { listBalances } from "../src/server/reporting.ts";
import { listTransactionsViaToolkit } from "../src/server/toolkitReporting.ts";
import {
  verifyGrid,
  hashFileText,
  payoutItemsFromPoll,
  storedRowsFromCreate,
} from "../src/server/verifier.ts";

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
// getToken() returns the token string itself, not an object. On a 401 the
// cached token is no good, so drop it and fetch a fresh one.
const refreshToken = async (): Promise<string> => {
  auth.invalidate();
  return auth.getToken();
};

// The stored copy: the payout record, evidence/payouts/payouts-create.json.
// It holds the jobs the app paid, with the payout batch ID. It never
// recorded a payout item ID or a transaction ID, those come from the live
// Payouts read, and the join is the job ID.
let createRaw: Record<string, unknown>;
try {
  createRaw = JSON.parse(readFileSync("evidence/payouts/payouts-create.json", "utf8")) as Record<string, unknown>;
} catch {
  throw new Error(
    "verifier: evidence/payouts/payouts-create.json is missing. Run the payout first, or copy the payout record in.",
  );
}
const storedRows = storedRowsFromCreate(createRaw);
const payoutBatchId = storedRows[0].payoutBatchId;

// Path 2: the Payouts batch, read live.
const poll = await pollPayoutBatch({
  baseUrl: config.baseUrl,
  token,
  payoutBatchId,
  refreshToken,
  maxAttempts: 1,
});
// Save the raw Payouts reply before parsing it, so the evidence is kept
// even if the shape differs from the one the parser expects.
mkdirSync("evidence/verifier", { recursive: true });
writeFileSync("evidence/verifier/payouts-read.json", JSON.stringify(poll.raw, null, 2) + "\n");
const payoutItems = payoutItemsFromPoll(poll.raw);
out(`Payouts read: batch ${payoutBatchId}, ${poll.batchStatus}, ${payoutItems.length} items.`);

// Path 1: Reporting, the last 7 days, which covers the payout. Read through
// the PayPal Agent Toolkit's list_transactions tool, which calls the same
// Reporting endpoint as the direct REST path. The Toolkit returns successful
// transactions only, so this count can be lower than a plain REST read.
const endDate = new Date();
const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
const reporting = await listTransactionsViaToolkit({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
  sandbox: config.env === "sandbox",
  startDate,
  endDate,
});
const ourTxIds = new Set(payoutItems.map((item) => item.transactionId).filter((id) => id !== null));
const matching = reporting.transactions.filter((tx) => ourTxIds.has(tx.transactionId));
out(
  `Reporting read: ${reporting.totalItems} transactions in the last 7 days, ${matching.length} matching our batch.`,
);

// Balances, evidence only, not a gate. If the read fails, say so and continue.
try {
  const balances = await listBalances({ baseUrl: config.baseUrl, token, refreshToken });
  for (const balance of balances.balances) {
    out(
      `Balance: ${balance.currency}, available ${balance.availableCents === null ? "unknown" : `$${(balance.availableCents / 100).toFixed(2)}`}, total ${balance.totalCents === null ? "unknown" : `$${(balance.totalCents / 100).toFixed(2)}`}.`,
    );
  }
} catch (err) {
  out(`Balances read: not available, ${(err as Error).message}`);
}

// Code identity: the enforcement files, hashed now. The baseline is
// evidence/verifier/code-hashes.json. The first run records it; later
// runs compare against it, and a changed file fails the check.
const decideText = readFileSync("src/server/decide.ts", "utf8");
const policyText = readFileSync("src/server/policy.ts", "utf8");
const currentCodeHashes = { decide: hashFileText(decideText), policy: hashFileText(policyText) };
let expectedCodeHashes: { decide: string; policy: string } | undefined;
try {
  expectedCodeHashes = JSON.parse(readFileSync("evidence/verifier/code-hashes.json", "utf8")) as {
    decide: string;
    policy: string;
  };
  out("Code identity: baseline found, comparing.");
} catch {
  mkdirSync("evidence/verifier", { recursive: true });
  writeFileSync("evidence/verifier/code-hashes.json", JSON.stringify(currentCodeHashes, null, 2) + "\n");
  out("Code identity: no baseline yet, current hashes recorded as the baseline.");
}

const result = verifyGrid({
  storedRows,
  reporting: reporting.transactions,
  payoutItems,
  payoutBatchId: poll.payoutBatchId,
  allowlistEmails: [config.receiverEmail],
  // The agent has no PayPal account. This label must never appear as a
  // payer or a receiver in any PayPal read.
  agentEmail: "agent@settle.internal",
  expectedCodeHashes,
  currentCodeHashes,
});

out(`Rows checked: ${result.rowsChecked}, Reporting transactions: ${result.reportingCount}, Payouts items: ${result.payoutsCount}.`);
if (result.ok) {
  out("VERIFIER: MATCH. The stored copy, Reporting, and Payouts all agree.");
} else {
  out("VERIFIER: DRIFT. The grid does not match PayPal:");
  for (const line of result.diff) out(`  - ${line}`);
}

mkdirSync("evidence/verifier", { recursive: true });
writeFileSync(
  "evidence/verifier/recompute.json",
  JSON.stringify(
    {
      payoutBatchId,
      storedRows,
      reporting: reporting.raw,
      payouts: poll.raw,
      verifyResult: result,
      codeHashes: currentCodeHashes,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync("evidence/verifier/verifier-output.txt", lines.join("\n") + "\n");
out("Done. Evidence in evidence/verifier/recompute.json and evidence/verifier/verifier-output.txt.");

if (!result.ok) process.exit(1);
