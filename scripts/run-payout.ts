// Live smoke test — Payouts, sandbox only, $1 x 2.
// Run: node --experimental-strip-types scripts/run-payout.ts
// Needs local .env with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_ENV=sandbox, PAYPAL_SANDBOX_RECEIVER_EMAIL. Never paste secrets in a message.
// Saves raw JSON to evidence/payouts/payouts-create.json and evidence/payouts/payouts-poll.json.
// Pass: payout_batch_id present, poll shows SUCCESS. UNCLAIMED means the
// receiver is not a sandbox account, swap the email and re-run with a fresh batch.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "../src/server/config.ts";
import { PayPalAuth } from "../src/server/auth.ts";
import { payApprovedJobs, type Job } from "../src/server/jobs.ts";

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

loadEnv();
const config = loadConfig();
const auth = new PayPalAuth(config.baseUrl, config.clientId, config.clientSecret);
const token = await auth.getToken();
console.log("Token: HTTP 200, token received. Token is NOT printed, NOT saved to a committed file.");

const nowMs = Date.now();
const jobs: Job[] = [
  {
    job_id: "settle-s4-1",
    freelancer_id: "freelancer-1",
    paypal_email: config.receiverEmail,
    amount_cents: 100, // $1.00
    currency: "USD",
    approval_state: "approved",
    approved_at: nowMs,
    status: "waiting",
    payout_batch_id: null,
    payout_item_id: null,
    decision_reason: null,
  },
  {
    job_id: "settle-s4-2",
    freelancer_id: "freelancer-2",
    paypal_email: config.receiverEmail,
    amount_cents: 100, // $1.00
    currency: "USD",
    approval_state: "approved",
    approved_at: nowMs,
    status: "waiting",
    payout_batch_id: null,
    payout_item_id: null,
    decision_reason: null,
  },
];

const result = await payApprovedJobs({
  baseUrl: config.baseUrl,
  token,
  jobs,
  nowMs,
  allowlistedEmails: new Set([config.receiverEmail]),
  refreshToken: () => auth.getToken(),
});

console.log(`payout_batch_id: ${result.payoutBatchId}`);
console.log(`batch_status: ${result.batchStatus}`);
console.log(`accepted: ${result.accepted.length}, rejected: ${result.rejected.length}`);
for (const job of [...result.accepted, ...result.rejected]) {
  console.log(`${job.job_id}: status=${job.status}, reason=${job.decision_reason ?? "none"}`);
}

mkdirSync("evidence/payouts", { recursive: true });
writeFileSync(
  "evidence/payouts/payouts-create.json",
  JSON.stringify({ payout_batch_id: result.payoutBatchId, batch_status: result.batchStatus, sender_batch_id: result.senderBatchId, jobs }, null, 2),
);
writeFileSync(
  "evidence/payouts/payouts-poll.json",
  JSON.stringify({ payout_batch_id: result.payoutBatchId, batch_status: result.batchStatus }, null, 2),
);
console.log("Done. Evidence in evidence/payouts/payouts-create.json and evidence/payouts/payouts-poll.json.");
console.log("Pass = payout_batch_id present, poll shows SUCCESS.");
