// Proposer — the model allocates payments, the owner can pick by hand,
// and the decision check is the ground truth either way. Every
// proposal goes through the decision check before any PayPal call.
// No model API is called in this file. The model allocator lives in
// groqProposer.ts and groqAgent.ts; this file holds the proposal shape
// and the owner-selection proposer, which proposes exactly the jobs
// the owner picked, nothing more.
// Sandbox only, test money, no real money moves.
import type { Job } from "./jobs.ts";

export interface Proposal {
  jobId: string;
  recipient: string;
  amountCents: number;
  /** Why this job was chosen for this run, when the proposer gives one. */
  reason?: string;
  /** Where the proposal came from. Rule-based is the default. */
  source: "rule-based" | "model" | "owner";
}

export type Proposer = (jobs: Job[]) => Proposal[];

/**
 * Rule-based proposer: approved jobs that are still waiting to be paid.
 * It does NOT check caps, the allowlist, or duplicates — that is the
 * decision check's job, and it runs on every proposal. Proposing a job
 * the check then refuses is a normal outcome, not an error.
 */
export function ruleBasedProposal(jobs: Job[]): Proposal[] {
  return jobs
    .filter((job) => job.approval_state === "approved" && job.status === "waiting")
    .map((job) => ({
      jobId: job.job_id,
      recipient: job.paypal_email,
      amountCents: job.amount_cents,
      source: "rule-based" as const,
    }));
}

/**
 * Owner-selection proposer: proposes exactly the jobs the owner picked,
 * in the order given, nothing more. It does NOT check caps, the
 * allowlist, or duplicates — that is the decision check's job, and it
 * runs on every proposal. A picked job the check then refuses is a
 * normal outcome, not an error. An unknown job id is skipped here;
 * the route rejects unknown ids before the loop runs.
 */
export function ownerSelectedProposal(jobs: Job[], selectedJobIds: string[]): Proposer {
  return () =>
    selectedJobIds
      .map((jobId) => jobs.find((job) => job.job_id === jobId) ?? null)
      .filter((job): job is Job => job !== null)
      .map((job) => ({
        jobId: job.job_id,
        recipient: job.paypal_email,
        amountCents: job.amount_cents,
        reason: "owner picked this job for this run",
        source: "owner" as const,
      }));
}

/**
 * Propose payments for the agent loop. Pass a proposer to plug in a
 * free-tier or local model; without one, the rule-based proposer runs.
 * Whatever the proposer returns, the agent loop still runs the decision
 * check on each proposal, and a proposal that fails the check never
 * reaches Payouts.
 */
export function proposePayments(jobs: Job[], proposer: Proposer = ruleBasedProposal): Proposal[] {
  return proposer(jobs);
}
