// Controls & audit.
//
// The safety surface. Four things live here:
//
//   the policy the owner set, the execution control that can stop everything,
//   the provider actions that close an open loop, and the immutable history
//   that shows what happened.
//
// The emergency stop is deliberately the loudest thing on this screen: while it
// is engaged, no payment can be reserved or submitted.
import { useEffect, useState } from "react";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Pill, TextInput, useTask } from "../ui.tsx";
import { useWorkspace } from "../WorkspaceProvider.tsx";
import { client } from "../client.ts";
import { dateTime, money, percent } from "../format.ts";
import { Investigation } from "./Investigation.tsx";

function dollarsToCents(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function Controls() {
  const { snapshot, operations, workspace, applySnapshot, refresh } = useWorkspace();
  const task = useTask();
  const control = snapshot?.control ?? null;
  const policy = snapshot?.policy ?? null;
  const capacity = operations?.capacity ?? null;
  const capabilities = snapshot?.capabilities;

  const [rolling, setRolling] = useState("");
  const [perPayment, setPerPayment] = useState("");
  const [policyErrors, setPolicyErrors] = useState<Record<string, string>>({});
  const [stopReason, setStopReason] = useState("");

  useEffect(() => {
    if (policy === null) return;
    setRolling((policy.rollingCapCents / 100).toFixed(2));
    setPerPayment((policy.perPaymentCapCents / 100).toFixed(2));
  }, [policy?.rollingCapCents, policy?.perPaymentCapCents]);

  const workspaceId = workspace?.workspaceId ?? null;
  const isOperational = workspace?.kind === "operational";

  const savePolicy = async () => {
    if (workspaceId === null) return;
    const rollingCents = dollarsToCents(rolling);
    const perPaymentCents = dollarsToCents(perPayment);
    const errors: Record<string, string> = {};
    if (rollingCents === null) errors.rolling = "Enter the rolling cap in dollars.";
    if (perPaymentCents === null || perPaymentCents <= 0) errors.perPayment = "Enter a per-payment cap above zero.";
    if (rollingCents !== null && perPaymentCents !== null && perPaymentCents > rollingCents) errors.perPayment = "The per-payment cap cannot exceed the rolling cap.";
    setPolicyErrors(errors);
    if (Object.keys(errors).length > 0) return;
    await task.run("policy", async () => {
      await client.policy(workspaceId, { perPaymentCapCents: perPaymentCents!, rollingCapCents: rollingCents! });
      await refresh();
      return "Owner policy saved. The enforced financial policy was updated with it.";
    });
  };

  const setStop = async (engaged: boolean) => {
    if (workspaceId === null) return;
    await task.run("stop", async () => {
      const next = await client.control(workspaceId, engaged, stopReason.trim() || (engaged ? "workspace owner engaged the emergency stop" : "workspace owner cleared the emergency stop"));
      applySnapshot(next);
      setStopReason("");
      return engaged
        ? "Emergency stop engaged. No payment can be reserved or submitted until it is cleared."
        : "Emergency stop cleared. Payments can be reserved and submitted again, subject to the policy.";
    });
  };

  const reconcile = async () => {
    if (workspaceId === null) return;
    await task.run("reconcile", async () => {
      const result = await client.reconcile(workspaceId);
      applySnapshot(result.workspace);
      return `Reconciliation read ${result.result.batchesRead} provider batch(es) and stored ${result.result.itemsRecorded} item(s). It never creates a payment.`;
    });
  };

  const sweep = async () => {
    if (workspaceId === null) return;
    await task.run("confirm", async () => {
      const result = await client.confirm(workspaceId);
      applySnapshot(result.workspace);
      return `Confirmation sweep checked ${result.sweep.checked} payment(s): ${result.sweep.confirmed} confirmed, ${result.sweep.stillPending} still pending, ${result.sweep.errors} read error(s).`;
    });
  };

  const audit = snapshot?.audit ?? [];
  const used = (capacity?.rollingSpendCents ?? 0) + (capacity?.activeExposureCents ?? 0);

  return <div className="controls-layout">
    {control?.emergencyStop === true && (
      <Alert tone="danger" title="Emergency stop engaged">
        No payment can be reserved or submitted while the stop is engaged.
        {control.reason ? ` Reason: ${control.reason}.` : ""}
        {control.changedAt ? ` Changed at ${dateTime(control.changedAt)}.` : ""}
      </Alert>
    )}
    {task.error !== null && <Alert tone="danger" title="The action could not be completed">{task.error}</Alert>}
    {task.notice !== null && <Alert tone="success" title={task.notice} />}

    <div className="controls-grid">
      <Card className="policy-card">
        <CardHeader
          eyebrow="Owner financial policy"
          title="The limits the server enforces"
          description="These are the caps every submission is checked against. They belong to the owner, and they are versioned."
          actions={policy !== null ? <Pill tone="info">Policy v{capacity?.policyVersion ?? "—"}</Pill> : undefined}
        />
        {policy === null ? <EmptyState title="No policy is readable for this workspace" /> : (
          <>
            <div className="policy-figures">
              <div><span className="figure-label">Rolling cap</span><span className="figure-value">{money(policy.rollingCapCents)}</span><span className="figure-note">per {policy.windowHours}-hour window</span></div>
              <div><span className="figure-label">Per-payment cap</span><span className="figure-value">{money(policy.perPaymentCapCents)}</span><span className="figure-note">largest single payment</span></div>
              <div><span className="figure-label">Provider freshness</span><span className="figure-value">{capacity?.freshnessSeconds ?? "—"} s</span><span className="figure-note">maximum age of a provider read</span></div>
              <div><span className="figure-label">Approval lifetime</span><span className="figure-value">{policy.approvalExpiryDays} d</span><span className="figure-note">an approval older than this expires</span></div>
            </div>
            <div className="policy-form">
              <Field label="Rolling cap (USD)" error={policyErrors.rolling}>
                {({ id, describedBy, invalid }) => <TextInput id={id} aria-describedby={describedBy} invalid={invalid} type="number" min="0" step="0.01" value={rolling} disabled={capabilities?.canControl !== true} onChange={(event) => setRolling(event.target.value)} />}
              </Field>
              <Field label="Per-payment cap (USD)" error={policyErrors.perPayment}>
                {({ id, describedBy, invalid }) => <TextInput id={id} aria-describedby={describedBy} invalid={invalid} type="number" min="0.01" step="0.01" value={perPayment} disabled={capabilities?.canControl !== true} onChange={(event) => setPerPayment(event.target.value)} />}
              </Field>
              <Button variant="primary" busy={task.busy === "policy"} busyLabel="Saving…" disabled={capabilities?.canControl !== true} onClick={() => { void savePolicy(); }}>Save owner policy</Button>
            </div>
            <p className="panel-note">
              Last updated {dateTime(policy.updatedAt)} by {policy.updatedBy}. The provider freshness window is
              set by the server's enforced policy and is shown here for reference.
            </p>
          </>
        )}
      </Card>

      <Card className={`stop-card ${control?.emergencyStop === true ? "stop-card-engaged" : ""}`.trim()}>
        <CardHeader eyebrow="Execution control" title="Emergency stop" description="One control that halts every reservation and submission." />
        {control === null ? <EmptyState title="Control state is not readable" /> : (
          <>
            <div className="stop-state">
              <Pill tone={control.emergencyStop ? "danger" : "success"}>{control.emergencyStop ? "Engaged" : "Clear"}</Pill>
              <p className="stop-copy">
                {control.emergencyStop
                  ? "Payments are blocked. Nothing can be reserved or submitted until the stop is cleared."
                  : "Payments are allowed, subject to the caps and to provider freshness."}
              </p>
            </div>
            {control.reason !== null && (
              <p className="stop-reason"><strong>Reason:</strong> {control.reason}{control.changedBy ? ` — ${control.changedBy}` : ""}{control.changedAt ? `, ${dateTime(control.changedAt)}` : ""}</p>
            )}
            <Field label="Reason for the change" hint="Recorded in the audit trail with your identity and the time.">
              {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} value={stopReason} disabled={capabilities?.canControl !== true} onChange={(event) => setStopReason(event.target.value)} placeholder="Incident reference / owner reason" />}
            </Field>
            <Button
              variant={control.emergencyStop ? "secondary" : "danger"}
              busy={task.busy === "stop"}
              busyLabel="Applying…"
              disabled={capabilities?.canControl !== true}
              onClick={() => { void setStop(!control.emergencyStop); }}
            >
              {control.emergencyStop ? "Clear emergency stop" : "Engage emergency stop"}
            </Button>
          </>
        )}
      </Card>
    </div>

    <div className="controls-grid">
      <Card className="exposure-card">
        <CardHeader eyebrow="Exposure" title="What the cap is committed to" description="The ledger's own arithmetic, on the same rolling window the cap uses." />
        <div className="policy-figures">
          <div><span className="figure-label">Rolling budget</span><span className="figure-value">{money(capacity?.budgetCents ?? 0)}</span><span className="figure-note">{capacity?.windowHours ?? 168}-hour window</span></div>
          <div><span className="figure-label">Rolling spend</span><span className="figure-value">{money(capacity?.rollingSpendCents ?? 0)}</span><span className="figure-note">confirmed provider spend</span></div>
          <div><span className="figure-label">Active exposure</span><span className="figure-value">{money(capacity?.activeExposureCents ?? 0)}</span><span className="figure-note">reserved or in flight</span></div>
          <div><span className="figure-label">Awaiting confirmation</span><span className="figure-value">{money(capacity?.awaitingConfirmationCents ?? 0)}</span><span className="figure-note">acknowledged, not settled</span></div>
        </div>
        <div className="capacity-meter" role="img" aria-label={`${percent(used, capacity?.budgetCents ?? 0)}% of the rolling cap is committed`}>
          <div style={{ width: `${percent(used, capacity?.budgetCents ?? 0)}%` }} />
        </div>
        <p className="capacity-caption">
          {percent(used, capacity?.budgetCents ?? 0)}% committed · {money(capacity?.remainingCents ?? 0)} remaining of {money(capacity?.budgetCents ?? 0)}.
        </p>
        <p className="capacity-source">
          {capacity?.fresh === true
            ? `Provider state re-read at ${capacity.lastSuccessfulReconciliation === null ? "an unrecorded time" : dateTime(capacity.lastSuccessfulReconciliation)}.`
            : "Provider state is not fresh. The server refreshes it before a reservation and refuses reconciliation until then."}
        </p>
      </Card>

      <Card className="provider-card">
        <CardHeader eyebrow="Provider actions" title="Close an open loop" description="Both actions read the provider's own state. Neither creates a payment." />
        <div className="provider-actions">
          <Button variant="primary" busy={task.busy === "confirm"} busyLabel="Sweeping…" disabled={!isOperational || capabilities?.canReconcile !== true} onClick={() => { void sweep(); }}>
            Run confirmation sweep
          </Button>
          <Button variant="secondary" busy={task.busy === "reconcile"} busyLabel="Reconciling…" disabled={!isOperational || capabilities?.canReconcile !== true} onClick={() => { void reconcile(); }}>
            Reconcile with PayPal
          </Button>
        </div>
        <p className="panel-note">
          The confirmation sweep asks PayPal about the payments that are still open. Reconciliation re-reads the
          provider's state for the batches this application has submitted. Both need a configured PayPal Sandbox
          and an owner session.
        </p>
        {capabilities?.canReconcile !== true && (
          <Alert tone="warning" title="Provider actions are unavailable">
            {capabilities?.canControl !== true
              ? "These actions need the workspace owner."
              : "PayPal Sandbox is not configured on this server, so the provider cannot be read."}
          </Alert>
        )}
      </Card>
    </div>

    <Card className="audit-card">
      <CardHeader eyebrow="Audit" title="Control history" description="Append-only. Every row names who acted, what they acted on and why." />
      {audit.length === 0 ? (
        <EmptyState title="No audit rows yet">Actions in this workspace are recorded here as they happen.</EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Workspace audit history</caption>
            <thead><tr><th scope="col">Sequence</th><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Resource</th><th scope="col">Reason</th></tr></thead>
            <tbody>
              {audit.map((row) => (
                <tr key={row.sequence}>
                  <td className="mono">{row.sequence}</td>
                  <td><time dateTime={row.at}>{dateTime(row.at)}</time></td>
                  <td>{row.actor_id}</td>
                  <td className="mono">{row.action}</td>
                  <td className="mono">{row.resource_id ?? "workspace"}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>

    <Investigation />
  </div>;
}
