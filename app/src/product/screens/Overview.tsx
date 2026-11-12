// Overview — the owner's command centre.
//
// One screen that answers: what needs my decision, what can move, what is
// waiting on the provider, how much room is left, and what is wrong.
//
// Every figure on this screen is read from the server's projection. Nothing is
// counted from a record the server has not classified, and demonstration
// records are never included in an operational amount.
import { useMemo } from "react";
import { Alert, Button, Card, CardHeader, EmptyState, Metric, Pill, Skeleton } from "../ui.tsx";
import { useWorkspace } from "../WorkspaceProvider.tsx";
import { useRoute } from "../router.ts";
import {
  isAwaitingApproval, isAwaitingProvider, isReadyWithinPolicy, operationalRows, originLabel,
  recordLabel, sortRows, statusTone, totals, verificationLabel, verificationTone, workspaceRows,
} from "../model.ts";
import { date, dateTime, duePhrase, money, percent } from "../format.ts";
import type { PaymentOperationRow } from "../../operations/contract.ts";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function ObligationRow({ row, onOpen }: { row: PaymentOperationRow; onOpen: (row: PaymentOperationRow) => void }) {
  const due = duePhrase(row.dueDate);
  return <tr>
    <th scope="row">
      <button type="button" className="row-link" onClick={() => onOpen(row)}>{recordLabel(row)}</button>
      <span className="row-meta">{originLabel(row.recordOrigin)}{row.source === "legacy_grid" ? " · legacy grid" : ""}</span>
    </th>
    <td>{row.recipient}</td>
    <td className="numeric">{money(row.amountCents)}</td>
    <td>{row.dueDate ? <>{date(row.dueDate)}<span className="row-meta">{due}</span></> : <span className="absent">No due date</span>}</td>
    <td><Pill tone={statusTone(row)}>{row.paymentStatusLabel}</Pill></td>
    <td><Pill tone={verificationTone(row)}>{verificationLabel(row)}</Pill></td>
  </tr>;
}

export function Overview() {
  const { navigate } = useRoute();
  const { snapshot, operations, workspace, dataStatus, dataError, stale, session, refresh } = useWorkspace();

  const operational = useMemo(() => operationalRows(operations), [operations]);
  const mine = useMemo(() => workspaceRows(operations, workspace?.workspaceId ?? null), [operations, workspace?.workspaceId]);

  const needsApproval = useMemo(() => operational.filter(isAwaitingApproval), [operational]);
  const ready = useMemo(() => operational.filter(isReadyWithinPolicy), [operational]);
  const awaitingProvider = useMemo(() => operational.filter(isAwaitingProvider), [operational]);
  const capacity = operations?.capacity ?? null;

  const exceptions = operations?.exceptions ?? null;
  const attention = useMemo(() => {
    if (exceptions === null) return [];
    return [
      { key: "awaitingApproval", label: "Awaiting approval", bucket: exceptions.awaitingApproval },
      { key: "unreconciled", label: "Unreconciled", bucket: exceptions.unreconciled },
      { key: "dueSoon", label: "Due soon", bucket: exceptions.dueSoon },
      { key: "incompleteEvidence", label: "Incomplete evidence", bucket: exceptions.incompleteEvidence },
    ];
  }, [exceptions]);

  const recent = useMemo(() => sortRows(mine, "updated").slice(0, 6), [mine]);
  const control = snapshot?.control ?? null;
  const provider = snapshot?.provider ?? null;

  const alerts: Array<{ tone: "danger" | "warning" | "info"; title: string; body: string }> = [];
  if (control?.emergencyStop === true) {
    alerts.push({ tone: "danger", title: "The emergency stop is engaged", body: `No payment can be reserved or submitted.${control.reason ? ` Reason: ${control.reason}` : ""}${control.changedAt ? ` Changed at ${control.changedAt}.` : ""}` });
  }
  if (provider && provider.configured === false && workspace?.kind === "operational") {
    alerts.push({ tone: "warning", title: "PayPal Sandbox is not configured on this server", body: "Obligations can be recorded and approved, but nothing can be submitted until the server has sandbox credentials." });
  }
  if (capacity && capacity.fresh === false) {
    alerts.push({ tone: "warning", title: "Provider state is not fresh", body: "The last successful provider read is older than the freshness window. A submission refreshes it first, and reconciliation is refused until it is refreshed." });
  }
  const discrepancyCount = operations?.rows.reduce((sum, row) => sum + (row.reconciliationState === "discrepancy" ? 1 : 0), 0) ?? 0;
  if (discrepancyCount > 0) {
    alerts.push({ tone: "danger", title: `${discrepancyCount} reconciliation discrepanc${discrepancyCount === 1 ? "y" : "ies"} recorded`, body: "Internal and provider facts disagree. These records are never presented as reconciled." });
  }
  if (operations?.access.scope === "public") {
    alerts.push({ tone: "info", title: "You are looking at the public view", body: operations.access.note });
  }

  if (dataStatus === "loading" && snapshot === null) {
    return <>
      <div className="metric-row"><Skeleton rows={4} label="Loading the operational summary" /></div>
      <Skeleton rows={6} label="Loading the workspace" />
    </>;
  }

  if (dataStatus === "error" && snapshot === null) {
    return <Alert tone="danger" title="The workspace could not be loaded" actions={<Button onClick={() => { void refresh(); }}>Try again</Button>}>
      {dataError ?? "The server did not answer."}
    </Alert>;
  }

  const remaining = capacity?.remainingCents ?? 0;
  const budget = capacity?.budgetCents ?? 0;
  const used = (capacity?.rollingSpendCents ?? 0) + (capacity?.activeExposureCents ?? 0);
  const ownerName = session?.user?.displayName ?? null;

  return <>
    <p className="page-lead">
      {greeting()}{ownerName === null ? "." : `, ${ownerName}.`}{" "}
      {needsApproval.length > 0
        ? `${needsApproval.length} obligation${needsApproval.length === 1 ? "" : "s"} need${needsApproval.length === 1 ? "s" : ""} your decision.`
        : "Nothing is waiting on your decision."}
    </p>
    {stale && <Alert tone="warning" title="Showing the last successful read" actions={<Button onClick={() => { void refresh(); }}>Refresh now</Button>}>
      {dataError ?? "The latest refresh failed."}
    </Alert>}
    {alerts.map((alert) => <Alert key={alert.title} tone={alert.tone} title={alert.title}>{alert.body}</Alert>)}

    <section className="metric-row" aria-label="Operational summary">
      <Metric label="Needs approval" value={String(needsApproval.length).padStart(2, "0")} note={needsApproval.length === 0 ? "Nothing is waiting on you." : `${money(totals(needsApproval).amountCents)} across ${needsApproval.length} obligation${needsApproval.length === 1 ? "" : "s"}`} tone={needsApproval.length > 0 ? "warning" : "neutral"} />
      <Metric label="Ready within policy" value={String(ready.length).padStart(2, "0")} note={ready.length === 0 ? "No approved work is ready to send." : `${money(totals(ready).amountCents)} approved and inside the caps`} tone={ready.length > 0 ? "info" : "neutral"} />
      <Metric label="Awaiting provider" value={String(awaitingProvider.length).padStart(2, "0")} note={awaitingProvider.length === 0 ? "Nothing is in flight." : `${money(totals(awaitingProvider).amountCents)} submitted, not settled`} tone={awaitingProvider.length > 0 ? "info" : "neutral"} />
      <Metric label="Remaining capacity" value={money(remaining)} note={`Rolling ${capacity?.windowHours ?? 168}-hour cap of ${money(budget)}`} tone={remaining === 0 ? "danger" : "neutral"} />
    </section>

    <div className="overview-grid">
      <Card className="capacity-card">
        <CardHeader eyebrow="Financial capacity" title="Payment capacity" description="The ledger's own arithmetic, shown before anything can move." />
        <div className="capacity-figures">
          <div><span className="figure-label">Rolling spend</span><span className="figure-value">{money(capacity?.rollingSpendCents ?? 0)}</span></div>
          <div><span className="figure-label">Active exposure</span><span className="figure-value">{money(capacity?.activeExposureCents ?? 0)}</span></div>
          <div><span className="figure-label">Awaiting confirmation</span><span className="figure-value">{money(capacity?.awaitingConfirmationCents ?? 0)}</span></div>
          <div><span className="figure-label">Remaining</span><span className="figure-value">{money(remaining)}</span></div>
        </div>
        <div className="capacity-meter" role="img" aria-label={`${percent(used, budget)}% of the rolling cap is committed`}>
          <div style={{ width: `${percent(used, budget)}%` }} />
        </div>
        <p className="capacity-caption">
          {percent(used, budget)}% of the rolling budget committed. {capacity?.formula ?? "remaining = budget − rolling expenditure − active exposure, never below zero"}
        </p>
        <p className="capacity-source">
          {capacity?.fresh === true
            ? `Provider state re-read at ${capacity.lastSuccessfulReconciliation === null ? "an unrecorded time" : dateTime(capacity.lastSuccessfulReconciliation)}.`
            : "Provider state is not fresh; a submission refreshes it before anything is reserved."}
        </p>
      </Card>

      <Card className="attention-card">
        <CardHeader eyebrow="Exception queue" title="Attention queue" description="What the ledger has flagged for a decision." />
        {attention.length === 0 ? <EmptyState title="No exceptions">Nothing is flagged in the current data.</EmptyState> : (
          <ul className="attention-list">
            {attention.map((entry) => (
              <li key={entry.key}>
                <button type="button" className="attention-tile" onClick={() => navigate(entry.key === "awaitingApproval" ? "/jobs" : entry.key === "incompleteEvidence" ? "/payments" : "/payments")}>
                  <span className="attention-count">{String(entry.bucket.operational.count).padStart(2, "0")}</span>
                  <span className="attention-label">{entry.label}</span>
                  <span className="attention-note">{entry.bucket.definition}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>

    <Card className="recent-card">
      <CardHeader
        eyebrow="Latest work"
        title="Recent obligations"
        description="The most recently changed records in this workspace."
        actions={<Button onClick={() => navigate("/jobs")}>Open jobs & decisions</Button>}
      />
      {recent.length === 0 ? (
        <EmptyState title="No obligations yet" action={<Button variant="primary" onClick={() => navigate("/jobs")}>Create the first obligation</Button>}>
          Record the work, the recipient and the amount. Nothing is sent to a provider until you approve it.
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Recent obligations in this workspace</caption>
            <thead><tr><th scope="col">Obligation</th><th scope="col">Recipient</th><th scope="col" className="numeric">Amount</th><th scope="col">Due</th><th scope="col">Payment state</th><th scope="col">Verification</th></tr></thead>
            <tbody>{recent.map((row) => <ObligationRow key={row.operationId} row={row} onOpen={() => navigate(`/payments/${encodeURIComponent(row.operationId)}`)} />)}</tbody>
          </table>
        </div>
      )}
    </Card>

    {session?.authenticated !== true && (
      <Alert tone="info" title="You are reading the public demonstration">
        These records are synthetic. They are never counted as operational money and cannot be approved or paid.
      </Alert>
    )}
  </>;
}
