// Live agent loop run — the loop proposes, the decision check disposes,
// and the audit trail records every decision. Two parts.
// Part 1 pays two $1.00 demo jobs to the sandbox receiver email, live.
// Part 2 feeds the loop an invented $999 proposal for a fresh job and
// shows the check refuse it, with no PayPal call for that job.
// Sandbox only, test money, no real money moves. Total test money: $2.00.
// Run: node --experimental-strip-types scripts/run-agent.ts
// Needs local .env with PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
// PAYPAL_ENV=sandbox, PAYPAL_SANDBOX_RECEIVER_EMAIL. Never paste secrets
// in a message.
// Saves evidence/audit/run-output.json and audit-log.json.
// Pass: AGENT_LOOP: PAID with a payout batch id, plus a refused $999 row.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "../src/server/config.ts";
import { PayPalAuth } from "../src/server/auth.ts";
import { runAgentLoop } from "../src/server/agent.ts";
import { createAuditLog } from "../src/server/audit.ts";
import type { Job } from "../src/server/jobs.ts";

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

const audit = createAuditLog();
const now = Date.now();
function demoJob(jobId: string): Job {
  return {
    job_id: jobId,
    freelancer_id: `freelancer-${jobId}`,
    paypal_email: config.receiverEmail,
    amount_cents: 100, // $1.00
    currency: "USD",
    approval_state: "approved",
    approved_at: now,
    status: "waiting",
    payout_batch_id: null,
    payout_item_id: null,
    decision_reason: null,
  };
}

// Part 1: two real $1.00 demo jobs, paid live.
const jobs = [demoJob("settle-audit-1"), demoJob("settle-audit-2")];
const allowlisted = new Set<string>([config.receiverEmail]);
const paid = await runAgentLoop({
  jobs,
  allowlistedEmails: allowlisted,
  audit,
  baseUrl: config.baseUrl,
  token,
  refreshToken,
});
out(`Part 1: accepted ${paid.accepted.length}, rejected ${paid.rejected.length}.`);
out(`AGENT_LOOP: ${paid.payoutBatchId !== null ? "PAID" : "NOTHING_PAID"} batch ${paid.payoutBatchId ?? "none"}, status ${paid.batchStatus ?? "none"}.`);
for (const job of jobs) {
  out(`  ${job.job_id}: ${job.status}, batch ${job.payout_batch_id ?? "none"}, reason ${job.decision_reason ?? "none"}.`);
}

// Part 2: an invented $999 proposal for a fresh approved job. The check
// must refuse it, and no PayPal call is made for that job.
const freshJob = demoJob("settle-audit-3");
const refused = await runAgentLoop({
  jobs: [freshJob],
  allowlistedEmails: allowlisted,
  audit,
  proposer: () => [
    { jobId: "settle-audit-3", recipient: config.receiverEmail, amountCents: 99900, source: "model" as const },
  ],
  baseUrl: config.baseUrl,
  token,
  refreshToken,
});
out(`Part 2: invented $999 proposal rejected as ${refused.rejected[0]?.label ?? "not rejected"}, payout batch ${refused.payoutBatchId ?? "none"}.`);
out(`  settle-audit-3: ${freshJob.status}, reason ${freshJob.decision_reason ?? "none"}.`);

mkdirSync("evidence/audit", { recursive: true });
writeFileSync(
  "evidence/audit/run-output.json",
  JSON.stringify(
    {
      part1: { accepted: paid.accepted.map((job) => job.job_id), payoutBatchId: paid.payoutBatchId, batchStatus: paid.batchStatus },
      part2: { rejected: refused.rejected.map((r) => ({ job_id: r.proposalJobId, label: r.label, reason: r.reason })) },
    },
    null,
    2,
  ),
);
writeFileSync("evidence/audit/audit-log.json", JSON.stringify(audit.rows(), null, 2));
writeFileSync("evidence/audit/run-output.txt", lines.join("\n") + "\n");
out("Saved evidence/audit/run-output.json, audit-log.json, run-output.txt.");
out(`Audit rows written: ${audit.rows().length}.`);
if (paid.payoutBatchId === null) {
  throw new Error("agent: part 1 paid nothing, expected a payout batch id");
}
if (refused.rejected[0]?.label !== "PerRequestCapExceeded") {
  throw new Error(`agent: part 2 should refuse the $999 proposal as PerRequestCapExceeded, got ${refused.rejected[0]?.label ?? "nothing"}`);
}
