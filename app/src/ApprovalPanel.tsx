// Approval panel — the running weekly total and the remaining cap, per
// job, before the owner approves. The waiting queue is always visible
// here, with a reason per row. A job that waits for the owner shows the
// exact reason and the amount over the cap, in words, not as a silent
// failure. The fee estimate is shown before the batch is sent, computed
// from PayPal's published rates. The fee is never claimed to be removed.
import type { Caps, JobRow, DashboardRow } from "./api.ts";
import { estimateFeeUsd, estimateNetUsd, usd, overCapCents } from "./fees.ts";
import { statusLabel } from "./status.ts";

interface ApprovalPanelProps {
  jobs: JobRow[];
  rows: DashboardRow[];
  caps: Caps | null;
  paying: boolean;
  payError: string | null;
  onApprove: (jobId: string) => void;
  /** Run budget in dollars, set by the owner before Pay. */
  runBudgetDollars: number;
  onRunBudgetChange: (dollars: number) => void;
  onPay: (runBudgetCents: number) => void;
  /** Candidates the last run held for the owner to pick by hand. */
  holdCandidates: string[];
  holdReason: string | null;
  selectedIds: Set<string>;
  onToggleSelect: (jobId: string) => void;
  onPaySelected: () => void;
  /** False until the owner enters the token: approve and pay stay off. */
  ownerTokenSet: boolean;
}

export default function ApprovalPanel(props: ApprovalPanelProps) {
  const { jobs, rows, caps, paying, payError, onApprove, onPay } = props;
  const { runBudgetDollars, onRunBudgetChange, holdCandidates, holdReason, selectedIds, onToggleSelect, onPaySelected, ownerTokenSet } = props;
  const perPaymentCap = caps?.per_payment_cap_cents ?? 20000;
  const weeklyCap = caps?.weekly_cap_cents ?? 150000;

  const paidRows = rows.filter((row) => row.status === "paid");
  const waitingRows = rows.filter((row) => row.status === "waiting" || row.status === "waiting_for_meera");
  const totalPaidCents = paidRows.reduce((sum, row) => sum + row.amount_cents, 0);
  const remainingCents = weeklyCap - totalPaidCents;
  const needsApproval = jobs.filter((job) => job.approval_state !== "approved");
  // Only approved, waiting jobs can be paid: the count on the button must
  // match what the pay run will actually pay, so a job that still needs
  // approval is never counted here.
  const approvedIds = new Set(
    jobs.filter((job) => job.approval_state === "approved").map((job) => job.job_id),
  );
  const payableRows = rows.filter((row) => row.status === "waiting" && approvedIds.has(row.job_id));
  const payableTotalCents = payableRows.reduce((sum, row) => sum + row.amount_cents, 0);
  const payableFeeUsd = payableRows.reduce((sum, row) => sum + estimateFeeUsd(row.amount_usd), 0);
  const payableNetUsd = payableRows.reduce((sum, row) => sum + estimateNetUsd(row.amount_usd), 0);

  return (
    <section className="panel" aria-label="Approval">
      <h2>Approve and pay</h2>
      <p className="panel-line">
        Paid this week: <strong>{usd(totalPaidCents)}</strong> of a {usd(weeklyCap)} weekly cap.{" "}
        <strong>{usd(remainingCents)} left</strong>.
      </p>
      <p className="panel-line">{caps?.worst_case_exposure ?? "Worst-case exposure: $1,500 per week."}</p>
      {!ownerTokenSet && (
        <p className="panel-line" role="status">
          Enter the owner token at the top of the page to approve and pay. Approve and pay stay off
          until it is entered.
        </p>
      )}

      {needsApproval.length > 0 && (
        <div className="approve-list">
          <h3>Jobs waiting for approval</h3>
          <ul>
            {needsApproval.map((job) => (
              <li key={job.job_id}>
                <span>
                  {job.job_id} — {job.freelancer_id} — {usd(job.amount_cents)}
                </span>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => onApprove(job.job_id)}
                  disabled={!ownerTokenSet}
                >
                  Approve {job.job_id}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="waiting-queue">
        <h3>Waiting queue — always visible</h3>
        {waitingRows.length === 0 && <p>No jobs are waiting.</p>}
        <ul>
          {waitingRows.map((row) => {
            const overPayment = overCapCents(row.amount_cents, perPaymentCap);
            const overWeek = overCapCents(totalPaidCents + row.amount_cents, weeklyCap);
            const leftAfter = remainingCents - row.amount_cents;
            return (
              <li key={row.job_id}>
                <span>
                  <strong>{row.job_id}</strong> — {row.freelancer} — {usd(row.amount_cents)} —{" "}
                  {statusLabel(row.status)}
                  {row.due ? ` — due ${row.due}` : ""}
                  {row.priority ? ` — ${row.priority} priority` : ""}
                  {row.reason ? ` — ${row.reason}` : ""}
                  {overPayment > 0 ? ` Over the per-payment cap by ${usd(overPayment)}.` : ""}
                  {overWeek > 0 ? ` Over the weekly cap by ${usd(overWeek)}.` : ""}
                  {overPayment === 0 && overWeek === 0
                    ? ` ${usd(leftAfter)} of the weekly cap would be left after this job.`
                    : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <label className="panel-line">
        Run budget ($) — the most this run may pay. The model chooses which approved jobs fit it, soonest
        due and highest priority first. It starts at the weekly cap left.
        <input
          type="number"
          min="0"
          step="0.01"
          value={runBudgetDollars}
          onChange={(e) => onRunBudgetChange(Number(e.target.value))}
          disabled={paying}
        />
      </label>

      <button
        type="button"
        className="button button-primary"
        onClick={() => onPay(Math.round(runBudgetDollars * 100))}
        disabled={paying || payableRows.length === 0 || !ownerTokenSet}
      >
        {paying ? "Paying…" : `Pay approved jobs (${payableRows.length})`}
      </button>
      {holdCandidates.length > 0 && (
        <div className="approve-list">
          <h3>Pick the jobs to pay by hand</h3>
          <p className="panel-line">{holdReason ?? "The run held for the owner to pick."}</p>
          <ul>
            {holdCandidates.map((jobId) => {
              const row = rows.find((r) => r.job_id === jobId);
              return (
                <li key={jobId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(jobId)}
                      onChange={() => onToggleSelect(jobId)}
                      disabled={paying}
                    />{" "}
                    {jobId}
                    {row ? ` — ${row.freelancer} — ${usd(row.amount_cents)}` : ""}
                    {row?.due ? ` — due ${row.due}` : ""}
                    {row?.priority ? ` — ${row.priority} priority` : ""}
                  </label>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="button button-secondary"
            onClick={onPaySelected}
            disabled={paying || selectedIds.size === 0 || !ownerTokenSet}
          >
            {paying ? "Paying…" : `Pay selected (${selectedIds.size})`}
          </button>
        </div>
      )}
      <p className="panel-line">
        About to pay: {usd(payableTotalCents)}. Estimated fees {`$${payableFeeUsd.toFixed(2)}`}, freelancers
        receive about {`$${payableNetUsd.toFixed(2)}`}. Estimated from PayPal&apos;s published rates
        (4.40% + $0.30 + about 3% currency conversion). The fee is not removed.
      </p>
      {payError !== null && (
        <p className="error-text" role="alert">
          Paying failed: {payError}
        </p>
      )}
    </section>
  );
}
