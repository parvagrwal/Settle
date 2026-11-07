// Proposer — the model proposes payments, it never instructs one.
// The decision check is the ground truth, not the model output: every
// proposal goes through the decision check before any PayPal call.
// No model API is called in this file. The shipped proposer is
// rule-based, labelled as such, not AI-decided. A free-tier or local
// model can plug in later through the proposer hook without changing
// the check, and a proposal from a model is labelled "model".
// Sandbox only, test money, no real money moves.
import type { Job } from "./jobs.ts";

export interface Proposal {
  jobId: string;
  recipient: string;
  amountCents: number;
  /** Where the proposal came from. Rule-based is the default. */
  source: "rule-based" | "model";
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
 * Propose payments for the agent loop. Pass a proposer to plug in a
 * free-tier or local model; without one, the rule-based proposer runs.
 * Whatever the proposer returns, the agent loop still runs the decision
 * check on each proposal, and a proposal that fails the check never
 * reaches Payouts.
 */
export function proposePayments(jobs: Job[], proposer: Proposer = ruleBasedProposal): Proposal[] {
  return proposer(jobs);
}
