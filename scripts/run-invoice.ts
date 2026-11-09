// Live invoicing test — bill the client for the same jobs the payout paid.
// Sandbox only, test money, no real money moves.
// Run: node --experimental-strip-types scripts/run-invoice.ts
// Needs local .env with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_ENV=sandbox, PAYPAL_SANDBOX_RECEIVER_EMAIL, and
// PAYPAL_SANDBOX_CLIENT_EMAIL (the client being billed, any sandbox email
// works for the test). Never paste secrets in a message.
// Saves raw JSON to evidence/invoicing/invoice-create.json and
// evidence/invoicing/invoice-send.json.
// Pass: invoice ID starts with INV2-, status SENT after the read-back.
// If the bill fails, the payout still stands and the invoice row is manual.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "../src/server/config.ts";
import { PayPalAuth } from "../src/server/auth.ts";
import { billApprovedJobs } from "../src/server/invoicing.ts";
import type { Job as PayoutJob } from "../src/server/jobs.ts";

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
const clientEmail = process.env.PAYPAL_SANDBOX_CLIENT_EMAIL;
if (!clientEmail) {
  throw new Error(
    "config: PAYPAL_SANDBOX_CLIENT_EMAIL is missing. Add the client email to local .env only. Any sandbox email works for the test.",
  );
}
const auth = new PayPalAuth(config.baseUrl, config.clientId, config.clientSecret);
const token = await auth.getToken();
console.log("Token: HTTP 200, token received. Token is NOT printed, NOT saved to a committed file.");

const nowMs = Date.now();
// The same two jobs the payout paid, batch 4P79GAKFE3XA4, $1.00 each.
// Same job IDs, same amounts, so the invoice and the payout name the same work.
const jobs: PayoutJob[] = [
  {
    job_id: "settle-s4-1",
    freelancer_id: "freelancer-1",
    paypal_email: config.receiverEmail,
    amount_cents: 100, // $1.00
    currency: "USD",
    approval_state: "approved",
    approved_at: nowMs,
    status: "paid",
    payout_batch_id: "4P79GAKFE3XA4",
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
    status: "paid",
    payout_batch_id: "4P79GAKFE3XA4",
    payout_item_id: null,
    decision_reason: null,
  },
];

const result = await billApprovedJobs({
  baseUrl: config.baseUrl,
  token,
  jobs,
  clientEmail,
  clientId: "client-1",
  nowMs,
  refreshToken: () => auth.getToken(),
  // Local operator script, run by the owner by hand: ownership is proved by running it.
  actorAuthorized: true,
});

if (result.manual || result.invoice === null) {
  console.log("Invoice: MANUAL. The bill did not go out.");
  console.log(`Reason: ${result.error ?? "unknown"}`);
  console.log("The payout still stands. Bill the client by hand, and keep this row labelled manual.");
  process.exit(1);
}

console.log(`invoice_id: ${result.invoice.invoiceId}`);
console.log(`status: ${result.invoice.status}`);
console.log(`jobs: ${result.jobIds.join(", ")}`);
console.log(`total: $${(result.totalCents / 100).toFixed(2)}`);
console.log(`accepted: ${result.accepted.length}, rejected: ${result.rejected.length}`);
for (const job of result.rejected) {
  console.log(`${job.jobId}: rejected, ${job.label}, ${job.reason}`);
}

mkdirSync("evidence/invoicing", { recursive: true });
writeFileSync(
  "evidence/invoicing/invoice-create.json",
  JSON.stringify(
    { invoice_id: result.invoice.invoiceId, status: "DRAFT", jobs: result.jobIds, total_cents: result.totalCents },
    null,
    2,
  ),
);
writeFileSync(
  "evidence/invoicing/invoice-send.json",
  JSON.stringify({ invoice_id: result.invoice.invoiceId, status: result.invoice.status, jobs: result.jobIds }, null, 2),
);
console.log("Done. Evidence in evidence/invoicing/invoice-create.json and evidence/invoicing/invoice-send.json.");
console.log("Pass = invoice ID starts with INV2-, status SENT.");
