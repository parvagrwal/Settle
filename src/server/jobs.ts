// S4 jobs — the wiring between decide() and Payouts.
// This is the enforcement point. Every job goes through decide() first.
// If decide() rejects, no PayPal call is made for that job, and the job
// is marked blocked or waiting_for_meera, with the exact label as its reason.
// Only accepted jobs go into one Payouts batch. One batch, one sender_batch_id.
import { decide } from "./decide.ts";
import { DEFAULT_POLICY } from "./policy.ts";
import { createPayoutBatch, pollPayoutBatch } from "./payouts.ts";
import type { Policy, State } from "../shared/types.ts";
import type { FetchFn } from "./paypalClient.ts";

export type JobStatus =
  | "waiting"
  | "paid"
  | "waiting_for_meera"
  | "blocked"
  | "unclaimed"
  | "failed";

export interface Job {
  job_id: string;
  freelancer_id: string;
  paypal_email: string;
  amount_cents: number;
  currency: "USD";
  approval_state: "approved" | "not_approved" | "expired";
  approved_at: number | null;
  status: JobStatus;
  payout_batch_id: string | null;
  payout_item_id: string | null;
  decision_reason: string | null;
}

export interface PayJobsResult {
  accepted: Job[];
  rejected: Job[];
  payoutBatchId: string | null;
  batchStatus: string | null;
  senderBatchId: string | null;
}

export function jobToState(job: Job, spentInWindowCents: number, recipientAllowed: boolean): State {
  return {
    actorAuthorized: true,
    systemSuspended: false,
    jobApproved: job.approval_state === "approved",
    approvalExpiresAtMs:
      job.approved_at === null ? null : job.approved_at + DEFAULT_POLICY.approvalExpiryMs,
    recipientAllowed,
    alreadyPaid: job.status === "paid",
    spentInWindowCents,
  };
}

export async function payApprovedJobs(opts: {
  baseUrl: string;
  token: string;
  jobs: Job[];
  policy?: Policy;
  nowMs?: number;
  spentInWindowCents?: number;
  allowlistedEmails: Set<string>;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
  poll?: boolean;
}): Promise<PayJobsResult> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const nowMs = opts.nowMs ?? Date.now();
  let spent = opts.spentInWindowCents ?? 0;
  const accepted: Job[] = [];
  const rejected: Job[] = [];

  for (const job of opts.jobs) {
    const state = jobToState(job, spent, opts.allowlistedEmails.has(job.paypal_email));
    const decision = decide(
      policy,
      state,
      { jobId: job.job_id, recipient: job.paypal_email, amountCents: job.amount_cents },
      nowMs,
    );
    if (decision.decision === "reject") {
      job.decision_reason = `${decision.label}: ${decision.reason}`;
      // Over-cap waits for Meera. Every other rejection blocks the job.
      job.status =
        decision.label === "WindowCapExceeded" || decision.label === "PerRequestCapExceeded"
          ? "waiting_for_meera"
          : "blocked";
      rejected.push(job);
      continue;
    }
    job.decision_reason = null;
    accepted.push(job);
    spent += job.amount_cents;
  }

  if (accepted.length === 0) {
    return { accepted, rejected, payoutBatchId: null, batchStatus: null, senderBatchId: null };
  }

  const batch = await createPayoutBatch({
    baseUrl: opts.baseUrl,
    token: opts.token,
    items: accepted.map((job) => ({
      jobId: job.job_id,
      recipientEmail: job.paypal_email,
      amountCents: job.amount_cents,
      note: `Settle payout ${job.job_id}`,
    })),
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
  });

  let batchStatus = batch.batchStatus;
  if (opts.poll !== false) {
    const polled = await pollPayoutBatch({
      baseUrl: opts.baseUrl,
      token: opts.token,
      payoutBatchId: batch.payoutBatchId,
      refreshToken: opts.refreshToken,
      fetchFn: opts.fetchFn,
      // In tests, delayMs is 0 via the mock. Live, pollPayoutBatch uses 5s.
      delayMs: 5000,
    });
    batchStatus = polled.batchStatus;
  }

  for (const job of accepted) {
    job.payout_batch_id = batch.payoutBatchId;
    job.status = batchStatus === "SUCCESS" ? "paid" : batchStatus === "DENIED" || batchStatus === "CANCELED" ? "failed" : "waiting";
    if (batchStatus === "SUCCESS") job.decision_reason = null;
  }

  return {
    accepted,
    rejected,
    payoutBatchId: batch.payoutBatchId,
    batchStatus,
    senderBatchId: batch.senderBatchId,
  };
}
