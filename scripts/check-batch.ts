// Batch check — one payout batch, read live from PayPal, for a practice run.
// Sandbox only, test money, no real money moves.
// Run: node --experimental-strip-types scripts/check-batch.ts <payout_batch_id> [output_path]
// Needs local .env with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_ENV=sandbox, PAYPAL_SANDBOX_RECEIVER_EMAIL. Never paste secrets
// in a message.
// It polls the batch live, prints the batch status and, for every item,
// the job, the receiver, the amount, the item status, and the transaction
// ID. It then checks PayPal Reporting for transactions matching the
// batch and prints how many match. Reporting can lag behind Payouts by
// hours: if nothing matches yet, that is a finding, not a failure, and
// the check still passes. Re-run later to see if Reporting has caught up.
// Saves the full result as JSON, default evidence/rehearsal/batch-check.json.
// Pass: exit 0. Fail: exit 1, only if the batch itself failed, or a settled
// batch is missing items or transaction IDs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/server/config.ts";
import { PayPalAuth } from "../src/server/auth.ts";
import { pollPayoutBatch } from "../src/server/payouts.ts";
import { listTransactions } from "../src/server/reporting.ts";
import { payoutItemsFromPoll, type PayoutItemRead } from "../src/server/verifier.ts";

export interface BatchCheckReporting {
  totalItems: number;
  matched: number;
  matchedTransactionIds: string[];
  /** True when the batch has transaction IDs but none are in Reporting yet. */
  lagging: boolean;
}

export interface CheckBatchResult {
  batchId: string;
  batchStatus: string;
  /** Wall-clock time of the check, ISO string. Not a transaction time. */
  checkedAt: string;
  items: PayoutItemRead[];
  reporting: BatchCheckReporting;
  ok: boolean;
  /** Plain-words reason when the check fails, or a note when it passes. */
  note: string | null;
}

const FAILED_BATCH_STATUSES = ["DENIED", "CANCELED"];

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

function dollars(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}

/**
 * Check one payout batch live: poll the batch, read the items out of it,
 * and count how many of its transactions Reporting has seen. No printing
 * and no file writing here, so tests can call it with a mock fetch.
 */
export async function checkBatch(opts: {
  baseUrl: string;
  token: string;
  payoutBatchId: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: typeof fetch;
}): Promise<CheckBatchResult> {
  const poll = await pollPayoutBatch({
    baseUrl: opts.baseUrl,
    token: opts.token,
    payoutBatchId: opts.payoutBatchId,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
    maxAttempts: 1,
  });
  const items = payoutItemsFromPoll(poll.raw);

  // Reporting, the last 7 days, which covers a batch paid today.
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const reporting = await listTransactions({
    baseUrl: opts.baseUrl,
    token: opts.token,
    startDate,
    endDate,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });
  const txIds = new Set(items.map((item) => item.transactionId).filter((id) => id !== null));
  const matched = reporting.transactions.filter((tx) => txIds.has(tx.transactionId));
  const matchedTransactionIds = matched.map((tx) => tx.transactionId);

  let ok = true;
  let note: string | null = null;
  if (FAILED_BATCH_STATUSES.includes(poll.batchStatus)) {
    ok = false;
    note = `batch failed with status ${poll.batchStatus}`;
  } else if (poll.batchStatus === "SUCCESS") {
    if (items.length === 0) {
      ok = false;
      note = "batch is SUCCESS but has no items";
    } else {
      const missing = items.find((item) => item.transactionId === null);
      if (missing) {
        ok = false;
        note = `batch is SUCCESS but item ${missing.payoutItemId} for job ${missing.jobId} has no transaction ID, the payment has no receipt`;
      }
    }
  } else {
    note = `batch is ${poll.batchStatus}, not settled yet, re-run the check later`;
  }

  return {
    batchId: opts.payoutBatchId,
    batchStatus: poll.batchStatus,
    checkedAt: new Date().toISOString(),
    items,
    reporting: {
      totalItems: reporting.totalItems,
      matched: matched.length,
      matchedTransactionIds,
      lagging: txIds.size > 0 && matched.length === 0,
    },
    ok,
    note,
  };
}

/** Exit code for a check result: 0 when it passes, 1 when it fails. */
export function exitCodeFor(result: CheckBatchResult): number {
  return result.ok ? 0 : 1;
}

/** Plain-words lines for one check result. No secrets in any line. */
export function printResult(result: CheckBatchResult): string[] {
  const lines: string[] = [];
  lines.push(`Batch ${result.batchId}: ${result.batchStatus}.`);
  for (const item of result.items) {
    lines.push(
      `  ${item.jobId} -> ${item.receiverEmail}, ${dollars(item.amountCents)}, ${item.status}, transaction ${item.transactionId ?? "no transaction ID yet"}.`,
    );
  }
  lines.push(
    `Reporting: ${result.reporting.totalItems} transactions in the last 7 days, ${result.reporting.matched} matching this batch.`,
  );
  if (result.reporting.lagging) {
    lines.push(
      "Reporting has not caught up yet. No transaction from this batch is in Reporting. Re-run this check later; this is not a failure.",
    );
  }
  if (result.note !== null) lines.push(result.note);
  lines.push(result.ok ? "Batch check: PASS." : "Batch check: FAIL.");
  return lines;
}

/** Save the full result as JSON, creating the folder if needed. */
export function saveResult(result: CheckBatchResult, outputPath: string): string {
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
  return outputPath;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) {
    console.error(
      "Usage: node --experimental-strip-types scripts/check-batch.ts <payout_batch_id> [output_path]",
    );
    return 2;
  }
  const payoutBatchId = args[0];
  const outputPath = args[1] ?? "evidence/rehearsal/batch-check.json";

  loadEnv();
  const config = loadConfig();
  const auth = new PayPalAuth(config.baseUrl, config.clientId, config.clientSecret);
  const token = await auth.getToken();
  console.log("Token: HTTP 200, token received. Token is NOT printed, NOT saved to a committed file.");
  const refreshToken = async (): Promise<string> => {
    auth.invalidate();
    return auth.getToken();
  };

  const result = await checkBatch({
    baseUrl: config.baseUrl,
    token,
    payoutBatchId,
    refreshToken,
  });
  for (const line of printResult(result)) console.log(line);
  const savedPath = saveResult(result, outputPath);
  console.log(`Saved: ${savedPath}.`);
  return exitCodeFor(result);
}

// Run the command line only when this file is the script being run, not
// when a test imports it. With strip-types, argv[1] is the script path.
const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  process.exit(await main());
}
