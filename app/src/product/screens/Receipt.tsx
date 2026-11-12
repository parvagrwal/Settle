// The receipt.
//
// This is the screen that has to earn the product's trust, so it shows the
// evidence chain rather than a single status:
//
//   1 Obligation            the work the studio owes
//   2 Owner approval        the owner's authorisation, with its time
//   3 Submission            the attempt to reach PayPal
//   4 Provider response     PayPal's acknowledgement of the batch
//   5 Provider confirmation the item outcome and its transaction evidence
//   6 Independent re-read   a later, separate read of the provider's own state
//
// Every stage states which of those things has actually been recorded. A stage
// that has not happened is marked missing, not implied. A historical reference
// says it is historical. A missing fee says it is unknown, not zero.
import { useEffect, useState } from "react";
import { Alert, Button, Card, CardHeader, Fact, Pill, Skeleton } from "../ui.tsx";
import { client, describeError } from "../client.ts";
import { dateTime, money } from "../format.ts";
import type { PaymentOperationDetail, TimelineState } from "../../operations/contract.ts";
import type { Tone } from "../model.ts";

const STAGE_LABELS: Record<string, string> = {
  authorization: "Owner approval",
  submission: "Submission",
  provider_acknowledgement: "Provider response",
  item_outcome: "Provider confirmation",
  transaction: "Transaction evidence",
  reconciliation: "Independent re-read",
};

const STATE_LABEL: Record<TimelineState, string> = {
  complete: "Recorded",
  missing: "Missing",
  historical: "Historical reference",
  not_applicable: "Not applicable",
};

const STATE_TONE: Record<TimelineState, Tone> = {
  complete: "success",
  missing: "warning",
  historical: "info",
  not_applicable: "neutral",
};

/** The words a server-side state is shown with. A raw enum never reaches the page. */
const RECONCILIATION_WORDS: Record<string, string> = {
  not_applicable: "Not applicable",
  not_reconciled: "Not reconciled",
  reconciled: "Reconciled",
  required: "Reconciliation required",
  discrepancy: "Discrepancy",
};

const CONFIRMATION_WORDS: Record<string, string> = {
  scheduled: "Scheduled",
  pending: "Pending",
  running: "Running",
  done: "Complete",
  confirmed: "Confirmed by the provider",
  failed: "Failed",
  blocked: "Blocked",
};

const APPROVAL_WORDS: Record<string, string> = {
  not_approved: "Not approved",
  approved: "Approved",
  expired: "Approval expired",
};

const FEE_WORDS: Record<string, string> = {
  not_applicable: "Not applicable",
  unavailable: "Unavailable — unknown, not zero",
  estimate_only: "Estimate only",
  provider_reported: "Reported by PayPal",
};

const words = (table: Record<string, string>, value: string | null | undefined): string | null => {
  if (value === null || value === undefined || value === "") return null;
  return table[value] ?? value.replace(/_/g, " ");
};

export function Receipt({ operationId, onClose }: { operationId: string; onClose?: () => void }) {
  const [detail, setDetail] = useState<PaymentOperationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    client.operationDetail(operationId, { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) { setDetail(next); setError(null); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(describeError(cause, "The receipt could not be loaded.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [operationId, attempt]);

  if (loading && detail === null) return <Skeleton rows={8} label="Loading the receipt" />;
  if (error !== null && detail === null) {
    return <Alert tone="danger" title="The receipt could not be loaded" actions={<Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>}>
      {error}
    </Alert>;
  }
  if (detail === null) return null;

  const { row } = detail;
  const stages = [
    {
      key: "obligation",
      title: "Obligation",
      state: "complete" as TimelineState,
      at: row.approvedAt ?? row.lastUpdatedAt ?? null,
      detail: `${row.title ?? row.jobId ?? row.operationId} · ${money(row.amountCents)} to ${row.recipient}`,
    },
    ...detail.timeline
      .filter((entry) => entry.kind !== "transaction")
      .map((entry) => ({ key: entry.kind, title: STAGE_LABELS[entry.kind] ?? entry.label, state: entry.state, at: entry.at, detail: entry.detail })),
  ];
  const transaction = detail.timeline.find((entry) => entry.kind === "transaction");

  return <div className="receipt">
    <header className="receipt-head">
      <div>
        <p className="eyebrow">Payment receipt</p>
        <h2>{row.title ?? row.jobId ?? row.operationId} <span className="receipt-recipient">· {row.recipient}</span></h2>
        <p className="receipt-sub">
          {money(row.amountCents)} USD · {row.providerEnvironment === "sandbox" ? "PayPal Sandbox" : "Not sent to a provider"}
          {detail.executionRun ? ` · Execution run ${detail.executionRun.runId}` : ""}
          {row.policyVersion !== null ? ` · Policy v${row.policyVersion}` : ""}
        </p>
      </div>
      <div className="receipt-pills">
        <Pill tone={row.paymentStatus === "provider_confirmed" ? "success" : "warning"}>{row.paymentStatusLabel}</Pill>
        <Pill tone={row.isDemonstration ? "neutral" : "info"}>{detail.sensitiveAccess ? "Owner view" : "Public view"}</Pill>
        {onClose !== undefined && <Button variant="ghost" onClick={onClose}>Close</Button>}
      </div>
    </header>

    {row.isDemonstration && (
      <Alert tone="info" title="Demonstration record">
        This record was never submitted to PayPal, cannot be paid, and is excluded from every monetary total.
      </Alert>
    )}

    <Card>
      <CardHeader eyebrow="Evidence lifecycle" title="What has been proven" description="Each stage is marked only when the ledger holds it." />
      <ol className="lifecycle" aria-label="Evidence lifecycle stages">
        {stages.map((stage) => (
          <li key={stage.key} className={`lifecycle-stage lifecycle-${stage.state}`}>
            <span className="lifecycle-state"><Pill tone={STATE_TONE[stage.state]}>{STATE_LABEL[stage.state]}</Pill></span>
            <strong className="lifecycle-title">{stage.title}</strong>
            <span className="lifecycle-detail">{stage.detail}</span>
            {stage.at !== null && <time className="lifecycle-time" dateTime={stage.at}>{dateTime(stage.at)}</time>}
          </li>
        ))}
      </ol>
      {transaction && (
        <p className="lifecycle-transaction">
          Transaction evidence: {transaction.state === "complete" ? transaction.detail : `Not recorded — ${transaction.detail.toLowerCase()}`}
        </p>
      )}
    </Card>

    <div className="receipt-grid">
      <Card>
        <CardHeader eyebrow="Identity & approval" title="Internal record" />
        <dl className="fact-list">
          <Fact label="Record" value={detail.identity.operationId} mono />
          <Fact label="Internal payment ID" value={detail.identity.paymentId} mono absent="None — no owner approval created a payment identity" />
          <Fact label="Job" value={detail.identity.jobId} mono />
          <Fact label="Recipient" value={detail.identity.recipient} />
          <Fact label="Recipient email" value={detail.identity.recipientEmail} absent={detail.sensitiveAccess ? "Not recorded" : "Shown to the owner only"} />
          <Fact label="Approved by" value={detail.approval.approvedBy} />
          <Fact label="Approved at" value={detail.approval.approvedAt ? dateTime(detail.approval.approvedAt) : null} />
          <Fact label="Approval expires" value={detail.approval.expiresAt ? dateTime(detail.approval.expiresAt) : null} absent="Not applicable" />
          <Fact label="Approval state" value={words(APPROVAL_WORDS, detail.approval.state)} />
          <Fact label="Policy version" value={detail.approval.policyVersion === null ? null : String(detail.approval.policyVersion)} />
        </dl>
      </Card>

      <Card>
        <CardHeader eyebrow="Provider evidence" title="What PayPal said" />
        <dl className="fact-list">
          <Fact label="Provider environment" value={detail.provider.environment === "sandbox" ? "PayPal Sandbox" : detail.provider.environment} />
          <Fact label="PayPal batch ID" value={detail.provider.payoutBatchId} mono absent="None recorded" />
          <Fact label="Batch reference kind" value={detail.provider.batchReferenceKind === "historical_claim" ? "Historical reference — not this application's submission" : detail.provider.batchReferenceKind === "provider_item" ? "Provider item reference" : detail.provider.batchReferenceKind === "provider_acknowledgement" ? "Provider acknowledgement" : null} absent="None recorded" />
          <Fact label="Payout item ID" value={detail.provider.payoutItemId} mono absent="None recorded" />
          <Fact label="Transaction ID" value={detail.provider.transactionId} mono absent="None recorded" />
          <Fact label="Provider status" value={detail.provider.providerStatus} />
          <Fact label="Provider time" value={detail.provider.providerTimestamp ? dateTime(detail.provider.providerTimestamp) : null} />
          <Fact label="Execution run" value={detail.executionRun ? `${detail.executionRun.runId} · ${detail.executionRun.status}` : null} mono absent="No execution run recorded" />
          <Fact label="Confirmation work" value={detail.confirmation ? `${words(CONFIRMATION_WORDS, detail.confirmation.state)}, ${detail.confirmation.attemptCount} attempt${detail.confirmation.attemptCount === 1 ? "" : "s"}` : null} absent="None scheduled" />
          <Fact label="Next confirmation attempt" value={detail.confirmation?.nextAttemptAt ? dateTime(detail.confirmation.nextAttemptAt) : null} absent="Not scheduled" />
          <Fact label="Last confirmation error" value={detail.confirmation?.lastError ?? null} absent="No error recorded" />
        </dl>
        {row.evidenceGaps.length > 0 && (
          <div className="evidence-gaps">
            <h4>Evidence gaps</h4>
            <ul>{row.evidenceGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader eyebrow="Fees & reconciliation" title="The money side" />
        <dl className="fact-list">
          <Fact label="Fee evidence" value={words(FEE_WORDS, detail.fees.state)} />
          <Fact label="Policy estimate" value={detail.fees.estimate ? money(detail.fees.estimate.estimatedFeeMinor) : null} absent="No estimate stored" />
          <Fact label="Reported by PayPal" value={detail.fees.provider ? `${money(detail.fees.provider.reportedFeeMinor)}${detail.fees.provider.isProviderEstimate ? " (PayPal calls this an estimate)" : ""}` : null} absent={detail.identity.paymentId ? "Not reported — unknown, not zero" : "Not applicable"} />
          <Fact label="Reconciliation" value={words(RECONCILIATION_WORDS, detail.reconciliation.state)} />
          <Fact label="Last independent re-read" value={detail.reconciliation.lastReconciledAt ? dateTime(detail.reconciliation.lastReconciledAt) : null} absent="Never re-read" />
          <Fact label="Reconciliation run" value={detail.reconciliation.reconciliationRunId} mono />
          <Fact label="Discrepancies" value={detail.reconciliation.discrepancyCount > 0 ? `${detail.reconciliation.discrepancyCount} unresolved` : null} absent="None recorded" />
        </dl>
        <p className="receipt-note">{detail.fees.explanation}</p>
        {detail.reconciliation.discrepancies.length > 0 && (
          <ul className="discrepancy-list">
            {detail.reconciliation.discrepancies.map((entry, index) => (
              <li key={`${entry.type}-${index}`}><strong>{entry.type}</strong><span>{dateTime(entry.detectedAt)}</span><code>{String(entry.details)}</code></li>
            ))}
          </ul>
        )}
      </Card>
    </div>

    <Card>
      <CardHeader eyebrow="Timestamps" title="When each fact was recorded" description="Every timestamp comes from the store that holds it. They are not interchangeable." />
      {detail.timestamps.length === 0 ? <p className="receipt-note">No timestamp is recorded for this record.</p> : (
        <ul className="stamp-list">
          {detail.timestamps.map((stamp) => <li key={stamp.key}><span>{stamp.label}</span><time dateTime={stamp.at}>{dateTime(stamp.at)}</time></li>)}
        </ul>
      )}
    </Card>

    <Card>
      <CardHeader eyebrow="Audit history" title="Who did what" />
      {detail.audit.access === "granted" && detail.audit.events.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Audit events for this record</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">Source</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Change</th></tr></thead>
            <tbody>
              {detail.audit.events.map((event) => (
                <tr key={`${event.source}-${event.sequence}`}>
                  <td><time dateTime={event.at}>{dateTime(event.at)}</time></td>
                  <td>{event.source === "ledger" ? "Ledger" : event.source === "workspace" ? "Workspace" : "Decision log"}</td>
                  <td>{event.actor}</td>
                  <td className="mono">{event.action}</td>
                  <td>{event.from || event.to ? <span className="audit-change"><span className="mono">{event.from ?? "—"}</span> → <span className="mono">{event.to ?? "—"}</span></span> : event.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={detail.audit.access === "owner_required" ? "receipt-note" : "receipt-note"}>{detail.audit.note}</p>
      )}
    </Card>

    {detail.providerEvents.length > 0 && (
      <Card>
        <CardHeader eyebrow="Verified provider events" title="Postback-verified PayPal events" />
        <ul className="stamp-list">
          {detail.providerEvents.map((event) => (
            <li key={event.rowKey}><span><code>{event.rowKey}</code> · {event.status}</span><time dateTime={event.eventCreatedAt}>{dateTime(event.eventCreatedAt)}</time></li>
          ))}
        </ul>
      </Card>
    )}

    <p className="receipt-foot">Read at {dateTime(detail.generatedAt)}. This receipt is read-only.</p>
  </div>;
}
