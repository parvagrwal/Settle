// The agent's recommendation panel.
//
// This is the screen that has to make one distinction unmistakable:
//
//   The agent recommends. The owner authorises. The financial engine enforces.
//
// The recommendation is therefore presented as a proposal: an amount, a
// breakdown, the reasoning, and the limits of that reasoning. It never uses the
// language of authorisation, it never shows a payment state, and it always
// carries the boundary note.
import { useMemo } from "react";
import { Alert, Button, Card, CardHeader, EmptyState, Pill } from "../ui.tsx";
import { dateTime, money, percent } from "../format.ts";
import type { Snapshot } from "../../productApi.ts";
import type { OperationsSnapshot } from "../../operations/contract.ts";
import { useTask } from "../ui.tsx";
import { useRoute } from "../router.ts";

export interface RecommendationPanelProps {
  snapshot: Snapshot | null;
  operations: OperationsSnapshot | null;
  onGenerate: () => Promise<boolean>;
  busy: boolean;
}

/** The latest recommendation the server has recorded for this workspace. */
export function latestDecision(snapshot: Snapshot | null) {
  return snapshot?.decisions[0] ?? null;
}

export function RecommendationPanel({ snapshot, operations, onGenerate, busy }: RecommendationPanelProps) {
  const task = useTask();
  const { navigate } = useRoute();
  const decision = latestDecision(snapshot);
  const policy = snapshot?.policy ?? null;
  const jobs = snapshot?.jobs ?? [];
  const capabilities = snapshot?.capabilities;

  const recommended = useMemo(() => {
    if (decision === null) return [];
    return decision.recommendedJobIds
      .map((jobId) => jobs.find((job) => job.jobId === jobId))
      .filter((job): job is NonNullable<typeof job> => job !== undefined);
  }, [decision, jobs]);

  const proposedCents = recommended.reduce((sum, job) => sum + job.amountCents, 0);
  const residualCents = policy === null ? null : Math.max(0, policy.rollingCapCents - proposedCents);
  const capacity = operations?.capacity ?? null;

  const uncertainties = useMemo(() => {
    const notes: string[] = [];
    const unapproved = jobs.filter((job) => job.approvalState !== "approved");
    if (unapproved.length > 0) notes.push(`${unapproved.length} obligation${unapproved.length === 1 ? "" : "s"} still need${unapproved.length === 1 ? "s" : ""} an owner approval and cannot be recommended.`);
    if (policy !== null) {
      const overCap = jobs.filter((job) => job.amountCents > policy.perPaymentCapCents);
      if (overCap.length > 0) notes.push(`${overCap.length} obligation${overCap.length === 1 ? "" : "s"} exceed the ${money(policy.perPaymentCapCents)} per-payment cap.`);
    }
    if (capacity !== null && capacity.fresh === false) notes.push("The provider state is not fresh. The server refreshes it before any reservation, which can change what fits inside the cap.");
    if (decision === null) notes.push("No recommendation has been produced for this workspace yet.");
    return notes;
  }, [jobs, policy, capacity, decision]);

  const constraints = policy === null ? [] : [
    { label: "Per-payment cap", value: money(policy.perPaymentCapCents) },
    { label: "Rolling cap", value: `${money(policy.rollingCapCents)} / ${policy.windowHours}h` },
    { label: "Approval lifetime", value: `${policy.approvalExpiryDays} day${policy.approvalExpiryDays === 1 ? "" : "s"}` },
    { label: "Policy version", value: String(capacity?.policyVersion ?? "—") },
  ];

  return <Card className="recommendation-card">
    <CardHeader
      eyebrow="Agent allocation recommendation"
      title={decision === null ? "No recommendation yet" : "Proposed allocation"}
      description="The agent ranks owner-approved work inside the policy and returns a proposal. It cannot approve, reserve or send anything."
      actions={decision === null ? undefined : <Pill tone="info" title={`Decision ${decision.decisionId}`}>{decision.status === "recommendation_ready" ? "Recommendation ready" : decision.status}</Pill>}
    />

    {task.error !== null && <Alert tone="danger" title="The recommendation could not be produced">{task.error}</Alert>}

    {decision === null ? (
      <EmptyState
        title="Generate a recommendation"
        action={<Button variant="primary" busy={busy || task.busy !== null} busyLabel="Evaluating…" onClick={() => { void task.run("recommend", async () => { const ok = await onGenerate(); return ok ? "Recommendation recorded. Nothing has been approved or paid." : "The recommendation was not recorded."; }); }}>Evaluate the workspace</Button>}
      >
        The agent will rank the approved obligations in this workspace against the policy and return a
        proposed allocation with its reasoning. Generating a recommendation never authorises a payment.
      </EmptyState>
    ) : (
      <>
        <div className="proposed-total">
          <span className="figure-label">Proposed allocation</span>
          <span className="proposed-amount">{money(proposedCents)}</span>
          <span className="proposed-caption">across {recommended.length} approved obligation{recommended.length === 1 ? "" : "s"} · within owner policy</span>
        </div>

        {recommended.length === 0 ? (
          <EmptyState title="Nothing is eligible for a proposal right now">
            The agent found no approved obligation that fits inside the per-payment and rolling caps. The
            obligations it held back are listed below with the reason.
          </EmptyState>
        ) : (
          <ol className="allocation-list">
            {recommended.map((job) => {
              const width = proposedCents === 0 ? 0 : Math.round((job.amountCents / proposedCents) * 100);
              return <li key={job.jobId} className="allocation-item">
                <div className="allocation-head">
                  <span className="allocation-name">{job.title}</span>
                  <span className="allocation-amount">{money(job.amountCents)}</span>
                </div>
                <div className="allocation-bar" role="img" aria-label={`${job.title}: ${money(job.amountCents)} of ${money(proposedCents)}`}>
                  <div style={{ width: `${width}%` }} />
                </div>
                <p className="allocation-meta">{job.recipientName} · {job.priority} priority · {width}% of the proposal</p>
              </li>;
            })}
          </ol>
        )}

        {residualCents !== null && (
          <div className="residual">
            <div><span className="figure-label">Residual after this proposal</span><span className="figure-value">{money(residualCents)}</span></div>
            <div><span className="figure-label">Rolling cap</span><span className="figure-value">{money(policy?.rollingCapCents ?? 0)}</span></div>
            <div className="residual-meter" role="img" aria-label={`${percent(proposedCents, policy?.rollingCapCents ?? 0)}% of the rolling cap proposed`}>
              <div style={{ width: `${percent(proposedCents, policy?.rollingCapCents ?? 0)}%` }} />
            </div>
          </div>
        )}

        <section className="rationale">
          <h3>Why this was proposed</h3>
          <p>{decision.rationale}</p>
          <p className="rationale-meta">Recorded {dateTime(decision.createdAt)} · origin {decision.origin} · {decision.summary}</p>
        </section>

        {uncertainties.length > 0 && (
          <section className="uncertainties">
            <h3>What could change this recommendation</h3>
            <ul>{uncertainties.map((line) => <li key={line}>{line}</li>)}</ul>
          </section>
        )}

        {constraints.length > 0 && (
          <section className="constraints">
            <h3>Policy constraints applied</h3>
            <dl>{constraints.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>
          </section>
        )}
      </>
    )}

    <div className="decision-boundary">
      <Alert tone="warning" title="Decision boundary">
        This recommendation is not an approval and does not authorise a payment. The owner approves each
        obligation, and the financial engine enforces the caps before anything reaches PayPal.
      </Alert>
    </div>

    {decision !== null && (
      <div className="recommendation-actions">
        <Button variant="secondary" onClick={() => navigate("/jobs")}>Review the obligations</Button>
        <Button variant="primary" onClick={() => navigate("/jobs")}>Owner approval required</Button>
      </div>
    )}

    {capabilities?.canApprove !== true && (
      <p className="panel-note">Recommendations need an owner session. Sign in to evaluate this workspace.</p>
    )}
  </Card>;
}
