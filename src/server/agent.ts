// Agent loop — the model proposes, the decision check disposes.
// Every proposal goes through the decision check first. A proposal
// that fails the check is written to the audit trail with its exact
// label and never reaches Payouts. A proposal that passes the check
// but does not match the approved job record — a different amount or
// a different recipient than the studio approved — is also refused,
// because the studio approved the job as recorded, not the proposal.
// Only proposals that pass the check AND match the job record are
// paid, through the existing payout wiring, which runs the decision
// check a second time. Two checks, same rules, no shortcut.
// Sandbox only, test money, no real money moves.
// Worst-case exposure: $1,500 per week, printed wherever a cap is shown.
import { decide } from "./decide.ts";
import { DEFAULT_POLICY } from "./policy.ts";
import { jobToState, payApprovedJobs, type Job, type PayJobsResult } from "./jobs.ts";
import { createAuditLog, rowFromDecision, type AuditLog, type AuditRow } from "./audit.ts";
import { proposePayments, type Proposer } from "./model.ts";
import type { Policy } from "../shared/types.ts";
import type { FetchFn } from "./paypalClient.ts";

export interface RejectedProposal {
  job: Job | null;
  proposalJobId: string;
  label: string;
  reason: string;
}

export interface AgentLoopResult {
  accepted: Job[];
  rejected: RejectedProposal[];
  payoutBatchId: string | null;
  batchStatus: string | null;
  senderBatchId: string | null;
  auditRows: AuditRow[];
}

export type PayFn = (opts: {
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
}) => Promise<PayJobsResult>;

/**
 * Run one agent loop over the jobs. The proposer names jobs to pay;
 * the decision check decides each one. The audit log gets a row for
 * every decision, accepted or rejected, plus a paid row for every job
 * the payout call actually paid. A caller that passes its own audit
 * log keeps one trail across loops; without one, a fresh log is made.
 */
export async function runAgentLoop(opts: {
  jobs: Job[];
  allowlistedEmails: Set<string>;
  policy?: Policy;
  nowMs?: number;
  spentInWindowCents?: number;
  proposer?: Proposer;
  payFn?: PayFn;
  audit?: AuditLog;
  baseUrl?: string;
  token?: string;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
  poll?: boolean;
}): Promise<AgentLoopResult> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const nowMs = opts.nowMs ?? Date.now();
  const audit = opts.audit ?? createAuditLog();
  const proposals = proposePayments(opts.jobs, opts.proposer);
  const accepted: Job[] = [];
  const rejected: RejectedProposal[] = [];
  let spent = opts.spentInWindowCents ?? 0;

  for (const proposal of proposals) {
    const job = opts.jobs.find((j) => j.job_id === proposal.jobId) ?? null;
    if (job === null) {
      const reason = "JobNotApproved: no such job, the proposal names a job that does not exist";
      audit.write({
        actor: "agent",
        job_id: proposal.jobId,
        action: "rejected",
        reason,
        amount_cents: proposal.amountCents,
        payout_batch_id: null,
        paypal_transaction_id: null,
      });
      rejected.push({ job: null, proposalJobId: proposal.jobId, label: "JobNotApproved", reason });
      continue;
    }

    const recipientAllowed =
      proposal.recipient === job.paypal_email && opts.allowlistedEmails.has(proposal.recipient);
    const state = jobToState(job, spent, recipientAllowed);
    const decision = decide(
      policy,
      state,
      { jobId: job.job_id, recipient: proposal.recipient, amountCents: proposal.amountCents },
      nowMs,
    );

    if (decision.decision === "reject") {
      audit.write(rowFromDecision({ actor: "agent", jobId: job.job_id, amountCents: proposal.amountCents, decision }));
      job.decision_reason = `${decision.label}: ${decision.reason}`;
      job.status =
        decision.label === "WindowCapExceeded" || decision.label === "PerRequestCapExceeded"
          ? "waiting_for_meera"
          : "blocked";
      rejected.push({
        job,
        proposalJobId: proposal.jobId,
        label: decision.label,
        reason: decision.reason,
      });
      continue;
    }

    // The check passed on the proposal as stated. The studio approved
    // the job as recorded, so a proposal that names a different amount
    // or recipient than the record is still refused, and audited.
    if (proposal.amountCents !== job.amount_cents || proposal.recipient !== job.paypal_email) {
      const reason =
        `proposal does not match the approved job record: proposed ${proposal.amountCents} cents to ` +
        `${proposal.recipient}, approved job is ${job.amount_cents} cents to ${job.paypal_email}`;
      audit.write({
        actor: "agent",
        job_id: job.job_id,
        action: "rejected",
        reason,
        amount_cents: proposal.amountCents,
        payout_batch_id: null,
        paypal_transaction_id: null,
      });
      job.decision_reason = reason;
      job.status = "blocked";
      rejected.push({ job, proposalJobId: proposal.jobId, label: "Mismatch", reason });
      continue;
    }

    audit.write(rowFromDecision({ actor: "agent", jobId: job.job_id, amountCents: proposal.amountCents, decision }));
    accepted.push(job);
    spent += job.amount_cents;
  }

  if (accepted.length === 0) {
    return { accepted, rejected, payoutBatchId: null, batchStatus: null, senderBatchId: null, auditRows: audit.rows() };
  }

  const payFn: PayFn = opts.payFn ?? payApprovedJobs;
  if (opts.payFn === undefined && (opts.baseUrl === undefined || opts.token === undefined)) {
    throw new Error("agent: no payout path configured. Pass baseUrl and token, or pass a pay function.");
  }
  const paid = await payFn({
    baseUrl: opts.baseUrl ?? "",
    token: opts.token ?? "",
    jobs: accepted,
    policy,
    nowMs,
    spentInWindowCents: opts.spentInWindowCents ?? 0,
    allowlistedEmails: opts.allowlistedEmails,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
    poll: opts.poll,
  });

  for (const job of paid.accepted) {
    audit.write({
      actor: "agent",
      job_id: job.job_id,
      action: "paid",
      reason: `paid in batch ${paid.payoutBatchId ?? "unknown"}, status ${paid.batchStatus ?? "unknown"}`,
      amount_cents: job.amount_cents,
      payout_batch_id: paid.payoutBatchId,
      paypal_transaction_id: null,
    });
  }

  return {
    accepted: paid.accepted,
    rejected,
    payoutBatchId: paid.payoutBatchId,
    batchStatus: paid.batchStatus,
    senderBatchId: paid.senderBatchId,
    auditRows: audit.rows(),
  };
}
