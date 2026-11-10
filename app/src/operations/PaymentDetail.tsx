// Payment investigation view: one record, everything the stores hold about it.
//
// Rendered as the detail row of the operations grid (AG Grid Master Detail).
// It shows what the record supports and says so when something is absent or
// withheld; it never fills a gap with a placeholder identifier.
import { useEffect, useState, type ReactNode } from "react";
import type { ICellRendererParams } from "ag-grid-community";
import type { PaymentOperationDetail, TimelineState } from "./contract.ts";
import type { OperationsStore } from "./store.ts";
import { approvalTone, feeLabel, formatCents, formatDateTime, originLabel, recordName, statusTone, toView, verificationTone, type OperationView, type Tone } from "./view.ts";

type Loader = (operationId: string, signal: AbortSignal) => Promise<PaymentOperationDetail>;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; detail: PaymentOperationDetail }
  | { status: "error" };

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`ops-pill ops-pill-${tone}`}>{children}</span>;
}

const ABSENT = "None recorded";

function Fact({ label, value, absent = ABSENT, mono = false }: { label: string; value: string | null | undefined; absent?: string; mono?: boolean }) {
  const present = value !== null && value !== undefined && value !== "";
  return <div className="ops-fact">
    <dt>{label}</dt>
    <dd className={present ? (mono ? "ops-mono" : undefined) : "ops-absent"}>{present ? value : absent}</dd>
  </div>;
}

const TIMELINE_LABEL: Record<TimelineState, string> = { complete: "Recorded", missing: "Missing", historical: "Historical reference", not_applicable: "Not applicable" };

/**
 * @param version changes whenever the record changes, so the detail is re-read.
 */
export function PaymentDetail({ operationId, version, load }: { operationId: string; version: string; load: Loader }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    load(operationId, controller.signal)
      .then((detail) => { if (!controller.signal.aborted) setState({ status: "ready", detail }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, [operationId, version, load, attempt]);

  if (state.status === "loading") return <div className="ops-detail" role="status" aria-live="polite">Loading the payment record…</div>;
  if (state.status === "error") {
    return <div className="ops-detail">
      <p role="alert" className="ops-error">The payment record could not be loaded. Nothing was changed.</p>
      <button type="button" className="ops-button" onClick={() => setAttempt((count) => count + 1)}>Try again</button>
    </div>;
  }

  const { detail } = state;
  const view: OperationView = toView(detail.row);
  const name = recordName(detail.row);
  const withheld = detail.sensitiveAccess ? ABSENT : "Shown to the owner only";
  const noPayment = "No ledger payment exists for this record";

  return <section className="ops-detail" role="region" aria-label={`Payment record ${name}`}>
    <header className="ops-detail-header">
      <div>
        <p className="ops-eyebrow">Payment record</p>
        <h3>{name}</h3>
        <p className="ops-detail-sub">{formatCents(view.amountCents)} to {view.recipient} · {view.sourceLabel} · {originLabel(view.recordOrigin)}</p>
      </div>
      <div className="ops-detail-pills">
        <Pill tone={statusTone(view.paymentStatus)}>{view.paymentStatusLabel}</Pill>
        <Pill tone={approvalTone(view.approvalState)}>{view.approvalLabel}</Pill>
        <Pill tone={verificationTone(view.verificationState)}>{view.verificationLabel}</Pill>
      </div>
    </header>

    {view.isDemonstration && <p className="ops-callout ops-callout-info">Demonstration record. It has never been submitted to PayPal, cannot be paid, and is excluded from every monetary total.</p>}
    {view.attentionReasons.length > 0 && <div className="ops-callout ops-callout-danger"><strong>Needs attention</strong><ul>{view.attentionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
    {view.budgetReason && !view.attentionReasons.some((reason) => reason.includes("per-payment cap")) && <p className="ops-callout ops-callout-warning"><strong>Budget:</strong> {view.budgetReason}</p>}

    <ol className="ops-timeline" aria-label="Evidence timeline">
      {detail.timeline.map((step) => <li key={step.kind} className={`ops-step ops-step-${step.state}`}>
        <span className="ops-step-state">{TIMELINE_LABEL[step.state]}</span>
        <strong>{step.label}</strong>
        <span>{step.detail}</span>
        {step.at && <time dateTime={step.at}>{formatDateTime(step.at)}</time>}
      </li>)}
    </ol>

    <div className="ops-detail-grid">
      <section aria-label="Identity and approval">
        <h4>Identity and approval</h4>
        <dl>
          <Fact label="Record" value={detail.identity.operationId} mono />
          <Fact label="Internal payment ID" value={detail.identity.paymentId} absent={`${ABSENT}: ${noPayment.toLowerCase()}`} mono />
          <Fact label="Job" value={detail.identity.jobId} mono />
          <Fact label="Recipient" value={detail.identity.recipient} />
          <Fact label="Recipient email" value={detail.identity.recipientEmail} absent={withheld} />
          <Fact label="Idempotency identity" value={detail.identity.idempotencyKey} absent={detail.identity.paymentId ? withheld : ABSENT} mono />
          <Fact label="Approval" value={view.approvalLabel} />
          <Fact label="Approved by" value={detail.approval.approvedBy} />
          <Fact label="Approved at" value={detail.approval.approvedAt ? formatDateTime(detail.approval.approvedAt) : null} />
          <Fact label="Approval expires" value={detail.approval.expiresAt ? formatDateTime(detail.approval.expiresAt) : null} absent="Not applicable" />
          <Fact label="Policy version" value={detail.approval.policyVersion === null ? null : String(detail.approval.policyVersion)} />
        </dl>
      </section>

      <section aria-label="Provider evidence">
        <h4>Provider evidence</h4>
        <dl>
          <Fact label="Provider environment" value={view.environmentLabel} />
          <Fact label="PayPal batch ID" value={detail.provider.payoutBatchId ? `${detail.provider.payoutBatchId}${detail.provider.batchReferenceKind === "historical_claim" ? " (cited by the record, not verified here)" : detail.provider.batchReferenceKind === "provider_acknowledgement" ? " (acknowledged, item outcome pending)" : ""}` : null} mono />
          <Fact label="Payout item ID" value={detail.provider.payoutItemId} mono />
          <Fact label="Transaction ID" value={detail.provider.transactionId} mono />
          <Fact label="Provider status" value={detail.provider.providerStatus} />
          <Fact label="Provider time" value={detail.provider.providerTimestamp ? formatDateTime(detail.provider.providerTimestamp) : null} />
          <Fact label="Execution run" value={detail.executionRun ? `${detail.executionRun.runId} · ${detail.executionRun.status}` : null} mono />
          <Fact label="Confirmation work" value={detail.confirmation ? `${detail.confirmation.state}, ${detail.confirmation.attemptCount} attempt(s)${detail.confirmation.lastError ? ` · last error: ${detail.confirmation.lastError}` : ""}` : null} absent="None scheduled" />
        </dl>
        {view.evidenceGaps.length > 0 && <div className="ops-gaps"><strong>Evidence gaps</strong><ul>{view.evidenceGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}
      </section>

      <section aria-label="Fees and reconciliation">
        <h4>Fees and reconciliation</h4>
        <dl>
          <Fact label="Fee evidence" value={feeLabel(view.feeState)} />
          <Fact label="Policy estimate" value={detail.fees.estimate ? formatCents(detail.fees.estimate.estimatedFeeMinor) : null} />
          <Fact label="Estimate formula" value={detail.fees.estimate?.formula ?? null} />
          <Fact label="Reported by PayPal" value={detail.fees.provider ? `${formatCents(detail.fees.provider.reportedFeeMinor)}${detail.fees.provider.isProviderEstimate ? " (PayPal describes this field as an estimate)" : ""}` : null} absent={detail.identity.paymentId ? "Not reported. Unknown, not zero" : ABSENT} />
          <Fact label="Reconciliation" value={view.reconciliationLabel} />
          <Fact label="Last independent re-read" value={detail.reconciliation.lastReconciledAt ? formatDateTime(detail.reconciliation.lastReconciledAt) : null} absent="Never re-read" />
          <Fact label="Reconciliation run" value={detail.reconciliation.reconciliationRunId} mono />
          <Fact label="Discrepancies" value={detail.reconciliation.discrepancyCount > 0 ? `${detail.reconciliation.discrepancyCount} unresolved` : null} absent="None recorded" />
        </dl>
        <p className="ops-note">{detail.fees.explanation}</p>
        {detail.reconciliation.discrepancies.length > 0 && <ul className="ops-discrepancies">{detail.reconciliation.discrepancies.map((entry, index) => <li key={`${entry.type}-${index}`}><strong>{entry.type}</strong> · {formatDateTime(entry.detectedAt)}<br /><span className="ops-mono">{String(entry.details)}</span></li>)}</ul>}
      </section>
    </div>

    <section aria-label="Timestamps" className="ops-detail-block">
      <h4>Timestamps</h4>
      {detail.timestamps.length > 0
        ? <ul className="ops-stamps">{detail.timestamps.map((stamp) => <li key={stamp.key}><span>{stamp.label}</span><time dateTime={stamp.at}>{formatDateTime(stamp.at)}</time></li>)}</ul>
        : <p className="ops-absent">No timestamp is recorded for this record.</p>}
    </section>

    <section aria-label="Audit history" className="ops-detail-block">
      <h4>Audit history</h4>
      {detail.audit.access === "granted" && detail.audit.events.length > 0
        ? <div className="ops-table-scroll"><table className="ops-audit" aria-label="Audit history">
            <caption className="ops-visually-hidden">{detail.audit.note}</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">Source</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Change</th></tr></thead>
            <tbody>{detail.audit.events.map((event) => <tr key={`${event.source}-${event.sequence}`}>
              <td><time dateTime={event.at}>{formatDateTime(event.at)}</time></td>
              <td>{event.source === "ledger" ? "Ledger" : event.source === "workspace" ? "Workspace" : "Decision log"}</td>
              <td>{event.actor}</td>
              <td className="ops-mono">{event.action}</td>
              <td>{event.from || event.to ? `${event.from ?? "—"} → ${event.to ?? "—"}` : event.note ?? ""}</td>
            </tr>)}</tbody>
          </table></div>
        : <p className={detail.audit.access === "owner_required" ? "ops-callout ops-callout-warning" : "ops-absent"}>{detail.audit.access === "granted" ? "No audit event is recorded for this record." : detail.audit.note}</p>}
    </section>

    {detail.providerEvents.length > 0 && <section aria-label="Verified provider events" className="ops-detail-block">
      <h4>Verified provider events</h4>
      <ul className="ops-stamps">{detail.providerEvents.map((event) => <li key={event.rowKey}><span><span className="ops-mono">{event.rowKey}</span> · {event.status} · webhook {event.latestEventId}</span><time dateTime={event.eventCreatedAt}>{formatDateTime(event.eventCreatedAt)}</time></li>)}</ul>
    </section>}

    <p className="ops-note">Read at {formatDateTime(detail.generatedAt)}. This view is read-only.</p>
  </section>;
}

/** AG Grid detail cell renderer: the grid's `context` carries the shared store. */
export function PaymentDetailRenderer(params: ICellRendererParams<OperationView, unknown, { store: OperationsStore }>) {
  const row = params.data;
  if (!row) return null;
  return <PaymentDetail operationId={row.operationId} version={`${row.paymentStatus}|${row.lastUpdatedAt ?? ""}|${row.verificationState}|${row.reconciliationState}`} load={params.context.store.api.detail} />;
}
