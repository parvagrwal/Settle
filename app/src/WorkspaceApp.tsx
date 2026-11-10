// Operational workspace — the only screen in this app that can move money.
//
// Everything here is driven by the server's snapshot: the capabilities it
// grants, the obligations it holds, the provider evidence it stored, and the
// fee records it kept. The screen never computes a total from a row it made up,
// and a button appears only when the server says the operation is available.
import { useCallback, useEffect, useState } from "react";
import { productApi, type Session, type Snapshot, type Workspace } from "./productApi.ts";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function verificationLabel(state: string): string {
  switch (state) {
    case "synthetic": return "Synthetic demo record — no provider evidence";
    case "unverified": return "Authorized — no provider response yet";
    case "provider_response_received": return "Provider response received — not confirmed";
    case "provider_confirmed": return "Provider confirmed";
    case "reconciled": return "Re-read from PayPal";
    case "discrepancy_detected": return "Discrepancy detected";
    case "verification_unavailable": return "Verification unavailable";
    case "historical_evidence_only": return "Historical evidence only — not a live payment";
    default: return state;
  }
}

export default function WorkspaceApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [token, setToken] = useState("");
  const [newWorkspace, setNewWorkspace] = useState("");
  const [job, setJob] = useState({ title: "", recipientName: "", recipientEmail: "", amountDollars: "", priority: "normal" });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<null | {
    runId: string; status: string;
    items: Array<{ jobId: string; status: string; payoutBatchId: string | null; payoutItemId: string | null; transactionId: string | null; providerStatus: string | null }>;
    batches: Array<{ payoutBatchId: string; itemCount: number; status: string }>;
  }>(null);
  const [payStatus, setPayStatus] = useState<null | { status: string; batchStatus: string; confirmationScheduled: boolean }>(null);

  const loadSession = useCallback(async () => {
    try {
      const next = await productApi.session();
      setSession(next);
      const operational = next.workspaces.find((workspace) => workspace.kind === "operational");
      if (next.authenticated && operational && workspaceId === null) setWorkspaceId(operational.workspaceId);
      if (!next.authenticated) setWorkspaceId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not read the session");
    }
  }, [workspaceId]);

  const loadSnapshot = useCallback(async (id: string) => {
    try {
      setSnapshot(await productApi.workspace(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not load the workspace");
    }
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => { if (workspaceId) void loadSnapshot(workspaceId); }, [workspaceId, loadSnapshot]);

  async function act(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "the server refused this action");
    } finally {
      setBusy(false);
    }
  }

  if (session === null) {
    return <main className="workspace-page"><p role="status">Reading session…</p>{error !== null && <p className="error-text" role="alert">{error}</p>}</main>;
  }

  if (!session.authenticated) {
    return (
      <main className="workspace-page workspace-signin">
        <h2>Owner sign-in</h2>
        <p>
          The operational workspace is the only place that can submit a PayPal payment. Sign-in uses
          the owner token; the browser keeps an HttpOnly session cookie and never sees a PayPal
          credential.
        </p>
        <p>
          <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Owner token" aria-label="Owner token" />{" "}
          <button
            type="button"
            className="button button-primary"
            disabled={busy || token === ""}
            onClick={() => act(async () => {
              await productApi.login(token);
              setToken("");
              await loadSession();
            })}
          >
            Sign in
          </button>
        </p>
        {error !== null && <p className="error-text" role="alert">{error}</p>}
        <p className="panel-line">
          Without sign-in, the demonstration workspace below is readable and cannot pay anything.
        </p>
      </main>
    );
  }

  const operational: Workspace[] = session.workspaces.filter((workspace) => workspace.kind === "operational");

  return (
    <main className="workspace-page">
      <h2>Operational workspace</h2>
      <p className="panel-line">
        Signed in as <strong>{session.user?.displayName}</strong>.{" "}
        <button type="button" className="button button-secondary" onClick={() => act(async () => { await productApi.logout(); await loadSession(); })}>
          Sign out
        </button>
      </p>

      {operational.length === 0 && (
        <section className="panel">
          <h3>Create a workspace</h3>
          <p>An operational workspace holds real obligations. The demonstration workspace cannot be converted into one.</p>
          <p>
            <input value={newWorkspace} onChange={(event) => setNewWorkspace(event.target.value)} placeholder="Studio name" aria-label="Studio name" />{" "}
            <button
              type="button"
              className="button button-primary"
              disabled={busy || newWorkspace.trim() === ""}
              onClick={() => act(async () => {
                await productApi.createWorkspace(newWorkspace.trim());
                setNewWorkspace("");
                await loadSession();
              })}
            >
              Create workspace
            </button>
          </p>
        </section>
      )}

      {operational.length > 1 && (
        <p className="panel-line">
          Workspace:{" "}
          <select value={workspaceId ?? ""} onChange={(event) => setWorkspaceId(event.target.value)} aria-label="Workspace">
            {operational.map((workspace) => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.name}</option>)}
          </select>
        </p>
      )}

      {error !== null && <p className="error-text" role="alert">{error}</p>}
      {notice !== null && <p className="panel-line" role="status">{notice}</p>}

      {snapshot !== null && snapshot.workspace.kind === "operational" && (
        <>
          <section className="panel" aria-label="Environment">
            <h3>{snapshot.workspace.name}</h3>
            <p className="panel-line">{snapshot.provenanceNotice}</p>
            <p className="panel-line">
              Provider: {snapshot.provider.environment} — {snapshot.provider.configured ? "configured in this process" : "not configured, so nothing can be submitted"}.
              {" "}Emergency stop: <strong>{snapshot.control.emergencyStop ? "ENGAGED" : "clear"}</strong>
              {snapshot.control.reason ? ` (${snapshot.control.reason}${snapshot.control.changedAt ? `, ${snapshot.control.changedAt}` : ""})` : ""}.
            </p>
            <p className="panel-line">
              Obligations needing approval: <strong>{snapshot.summary.needsApproval}</strong>. Approved:{" "}
              <strong>{snapshot.summary.approved}</strong>. Outstanding: <strong>{money(snapshot.summary.pendingCents)}</strong>.
              {snapshot.summary.financialPosition
                ? ` Confirmed in the rolling window: ${money(snapshot.summary.financialPosition.confirmedSpendCents)}; left: ${money(snapshot.summary.financialPosition.remainingCents)}.`
                : ""}
            </p>
            <p className="panel-line">
              <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for the stop change" aria-label="Reason for the stop change" />{" "}
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || !snapshot.capabilities.canControl}
                onClick={() => act(async () => {
                  const next = await productApi.control(snapshot.workspace.workspaceId, !snapshot.control.emergencyStop, reason.trim() || "workspace owner");
                  setSnapshot(next);
                  setNotice(next.control.emergencyStop ? "Emergency stop engaged: no payment can be reserved or submitted." : "Emergency stop cleared.");
                  setReason("");
                })}
              >
                {snapshot.control.emergencyStop ? "Clear emergency stop" : "Engage emergency stop"}
              </button>{" "}
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || !snapshot.capabilities.canReconcile}
                onClick={() => act(async () => {
                  const result = await productApi.reconcile(snapshot.workspace.workspaceId);
                  setSnapshot(result.workspace);
                  setNotice("Reconciliation read the provider state that is already known. It never creates a payment.");
                })}
              >
                Reconcile with PayPal
              </button>
            </p>
            {!snapshot.capabilities.canPay && (
              <p className="panel-line" role="status">
                Payments are unavailable here: {snapshot.control.emergencyStop ? "the emergency stop is engaged" : "PayPal Sandbox is not configured in this process"}.
              </p>
            )}
          </section>

          <section className="panel" aria-label="Create obligation">
            <h3>Add an obligation</h3>
            <p className="panel-line">
              <input value={job.title} onChange={(event) => setJob({ ...job, title: event.target.value })} placeholder="Work" aria-label="Work title" />{" "}
              <input value={job.recipientName} onChange={(event) => setJob({ ...job, recipientName: event.target.value })} placeholder="Recipient name" aria-label="Recipient name" />{" "}
              <input value={job.recipientEmail} onChange={(event) => setJob({ ...job, recipientEmail: event.target.value })} placeholder="recipient@example.test" aria-label="Recipient email" />{" "}
              <input value={job.amountDollars} onChange={(event) => setJob({ ...job, amountDollars: event.target.value })} placeholder="Amount (USD)" aria-label="Amount in dollars" />{" "}
              <select value={job.priority} onChange={(event) => setJob({ ...job, priority: event.target.value })} aria-label="Priority">
                <option value="high">high</option>
                <option value="normal">normal</option>
                <option value="low">low</option>
              </select>{" "}
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || !snapshot.capabilities.canEdit}
                onClick={() => act(async () => {
                  const cents = Math.round(Number(job.amountDollars) * 100);
                  const next = await productApi.createJob(snapshot.workspace.workspaceId, {
                    title: job.title, recipientName: job.recipientName, recipientEmail: job.recipientEmail,
                    amountCents: cents, dueAt: null, priority: job.priority,
                  });
                  setSnapshot(await productApi.workspace(snapshot.workspace.workspaceId));
                  setNotice(`Obligation ${next.job.jobId} stored. Nothing has been sent to PayPal.`);
                  setJob({ title: "", recipientName: "", recipientEmail: "", amountDollars: "", priority: "normal" });
                })}
              >
                Store obligation
              </button>
            </p>
            <p className="panel-line">
              Storing an obligation is bookkeeping. Approval creates a payment identity; only Pay submits it.
            </p>
          </section>

          <section className="panel" aria-label="Obligations">
            <h3>Obligations</h3>
            {snapshot.jobs.length === 0 && <p>No obligations yet.</p>}
            <ul>
              {snapshot.jobs.map((row) => {
                const receipt = snapshot.receipts.find((entry) => entry.jobId === row.jobId);
                const fee = snapshot.fees.find((entry) => entry.jobId === row.jobId);
                return (
                  <li key={row.jobId}>
                    <strong>{row.title}</strong> — {row.recipientName} — {money(row.amountCents)} —{" "}
                    {row.approvalState === "approved" ? "approved" : "waiting for approval"} —{" "}
                    {receipt ? verificationLabel(receipt.verificationState) : "no receipt"}
                    {receipt?.payoutBatchId ? ` — batch ${receipt.payoutBatchId}` : ""}
                    {receipt?.payoutItemId ? ` — item ${receipt.payoutItemId}` : ""}
                    {" "}
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || !snapshot.capabilities.canApprove || row.approvalState === "approved"}
                      onClick={() => act(async () => {
                        setSnapshot(await productApi.approve(snapshot.workspace.workspaceId, row.jobId));
                        setNotice(`${row.jobId} approved: a payment identity now exists. Nothing has been sent to PayPal.`);
                      })}
                    >
                      Approve
                    </button>{" "}
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || !snapshot.capabilities.canReject || row.approvalState === "approved"}
                      onClick={() => act(async () => {
                        const why = window.prompt("Reason for declining this obligation");
                        if (!why) return;
                        setSnapshot(await productApi.reject(snapshot.workspace.workspaceId, row.jobId, why));
                        setNotice(`${row.jobId} declined; the reason is in the audit trail.`);
                      })}
                    >
                      Decline
                    </button>{" "}
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy || !snapshot.capabilities.canPay || row.approvalState !== "approved" || receipt?.providerStatus === "SUCCESS"}
                      onClick={() => act(async () => {
                        const paid = await productApi.pay(snapshot.workspace.workspaceId, row.jobId);
                        setSnapshot(paid.workspace);
                        setLastRun(paid.execution_run ?? null);
                        setPayStatus(paid.result ? { status: paid.result.status, batchStatus: paid.result.batchStatus, confirmationScheduled: paid.result.confirmationScheduled } : null);
                        setNotice(`Submission recorded for ${row.jobId}. Pay status: ${paid.result?.status ?? "unknown"}.`);
                      })}
                    >
                      Pay
                    </button>
                    {fee && (
                      <div className="panel-line">
                        Fee: {fee.estimate ? `estimate ${money(fee.estimate.estimatedFeeMinor)} (${fee.estimate.policyId} v${fee.estimate.policyVersion})` : "no estimate stored"}
                        {" — "}
                        {fee.provider ? `PayPal reported ${money(fee.provider.reportedFeeMinor)}${fee.provider.isProviderEstimate ? " (PayPal calls this an estimate)" : ""}` : "PayPal reported no fee"}
                        {" — "}
                        {fee.explanation}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {(lastRun !== null || payStatus !== null) && (
            <section className="panel" aria-label="Last execution run">
              <h3>Last execution run</h3>
              {payStatus && (
                <p className="panel-line">
                  Payment state: <strong>{payStatus.status}</strong>; batch state: <strong>{payStatus.batchStatus}</strong>.{" "}
                  {payStatus.confirmationScheduled
                    ? "A durable confirmation job is scheduled; the item is not confirmed yet."
                    : "No confirmation work is scheduled."}
                </p>
              )}
              {lastRun && (
                <>
                  <p className="panel-line">
                    Run <strong>{lastRun.runId}</strong> — {lastRun.status} — {lastRun.items.length} item(s) in {lastRun.batches.length} batch(es).
                  </p>
                  <ul>
                    {lastRun.items.map((item) => (
                      <li key={item.jobId}>
                        {item.jobId} — {item.status}
                        {item.providerStatus ? ` (provider item ${item.providerStatus})` : ""}
                        {item.payoutBatchId ? ` — batch ${item.payoutBatchId}` : ""}
                        {item.payoutItemId ? ` — item ${item.payoutItemId}` : ""}
                        {item.transactionId ? ` — transaction ${item.transactionId}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="panel" aria-label="Workspace audit">
            <h3>Audit trail</h3>
            <ul>
              {snapshot.audit.map((row) => (
                <li key={row.sequence}>
                  {row.at} — <strong>{row.action}</strong> — {row.resource_id ?? "workspace"} — {row.reason}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {snapshot !== null && snapshot.workspace.kind === "demo" && (
        <p className="panel-line">
          This is the demonstration workspace: synthetic obligations, no provider calls, no operational
          ledger activity.
        </p>
      )}
    </main>
  );
}
