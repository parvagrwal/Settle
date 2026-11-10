// App — one landing page, one dashboard, one flow result.
// Landing: what it is, who it is for, the money step, one sample result
// clearly labelled as sample data. Dashboard: live sandbox data in the
// same layout, with totals, the approval panel, the grid, and the audit
// trail. Result: what the last payment run did, batch id and all.
// The grid updates live: new rows arrive every few seconds from the
// server, and again right after a payment completes.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveJob,
  fetchAudit,
  fetchCaps,
  fetchGrid,
  fetchJobs,
  ownerToken,
  payJobs,
  reconcileFinancial,
  setOwnerToken,
  toDashboardRow,
  type AuditRow,
  type Caps,
  type DashboardRow,
  type JobRow,
  type PayResult,
} from "./api.ts";
import { usd } from "./fees.ts";
import { statusLabel } from "./status.ts";
import { sampleRows, sampleResult } from "./data/sample.ts";
import StudioDashboard from "./StudioDashboard.tsx";
import FinancialControls from "./FinancialControls.tsx";
import ApprovalPanel from "./ApprovalPanel.tsx";
import TransactionsDashboard from "./TransactionsDashboard.tsx";
import AllocationPlanner from "./AllocationPlanner.tsx";

type View = "landing" | "dashboard" | "result" | "transactions" | "allocation";

export default function App() {
  const [view, setView] = useState<View>("transactions");
  const [rows, setRows] = useState<DashboardRow[]>(sampleRows);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [live, setLive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [reconcileNotice, setReconcileNotice] = useState<string | null>(null);
  const [lastPay, setLastPay] = useState<PayResult | null>(null);
  /** Run budget in dollars, set by the owner. Null means the default:
   * the weekly cap left, which the panel computes from live rows. */
  const [runBudgetDollars, setRunBudgetDollars] = useState<number | null>(null);
  const [holdCandidates, setHoldCandidates] = useState<string[]>([]);
  const [holdReason, setHoldReason] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Owner token for this tab only. Asked once per session, kept in
   * session storage, never saved to disk or baked into the page. */
  const [ownerTokenInput, setOwnerTokenInput] = useState("");
  const [ownerTokenSet, setOwnerTokenSet] = useState(() => ownerToken() !== null);

  function saveOwnerToken() {
    setOwnerToken(ownerTokenInput);
    setOwnerTokenSet(ownerTokenInput !== "");
    setOwnerTokenInput("");
  }

  function clearOwnerToken() {
    setOwnerToken("");
    setOwnerTokenSet(false);
    setOwnerTokenInput("");
  }

  const loadAll = useCallback(async () => {
    const [gridRows, jobRows, auditRows, capsBody] = await Promise.all([
      fetchGrid(),
      fetchJobs(),
      fetchAudit(),
      fetchCaps(),
    ]);
    setRows(gridRows.map(toDashboardRow));
    setJobs(jobRows);
    setAudit(auditRows);
    setCaps(capsBody);
    setLive(true);
    setLoadError(null);
  }, []);

  const refreshGrid = useCallback(async () => {
    const [gridRows, jobRows, auditRows, capsBody] = await Promise.all([
      fetchGrid(),
      fetchJobs(),
      fetchAudit(),
      fetchCaps(),
    ]);
    setRows(gridRows.map(toDashboardRow));
    setJobs(jobRows);
    setAudit(auditRows);
    setCaps(capsBody);
  }, []);

  useEffect(() => {
    loadAll().catch((err: unknown) => {
      setLoadError(err instanceof Error ? err.message : "could not load the dashboard");
    });
  }, [loadAll]);

  useEffect(() => {
    if (view === "landing" || !live) return;
    const timer = setInterval(() => {
      refreshGrid().catch(() => {
        // A failed poll leaves the last good rows on screen.
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [view, live, refreshGrid]);

  const totalPaidCents = useMemo(
    () => rows.filter((row) => row.status === "paid").reduce((sum, row) => sum + row.amount_cents, 0),
    [rows],
  );
  const totalWaitingCents = useMemo(
    () =>
      rows
        .filter((row) => row.status === "waiting" || row.status === "waiting_for_meera")
        .reduce((sum, row) => sum + row.amount_cents, 0),
    [rows],
  );
  const waitingCount = useMemo(
    () => rows.filter((row) => row.status === "waiting" || row.status === "waiting_for_meera").length,
    [rows],
  );
  const weeklyCapCents = caps?.rolling_cap_cents ?? caps?.weekly_cap_cents ?? 150000;
  const remainingCapCents = caps?.remainingCents ?? Math.max(0, weeklyCapCents - totalPaidCents);
  const budgetDollars = runBudgetDollars ?? remainingCapCents / 100;
  const recentAudit = useMemo(() => [...audit].slice(-8).reverse(), [audit]);

  async function handleReconcile() {
    setPaying(true);
    setReconcileError(null);
    setReconcileNotice(null);
    try {
      await reconcileFinancial();
      await refreshGrid();
      setReconcileNotice("Provider reconciliation complete. Durable cap, grid and paid status are refreshed.");
      if (lastPay?.outcomeUnknown || lastPay?.batch_status === "PROCESSING") {
        // The ambiguous or processing result is superseded by reconciliation.
        setLastPay(null);
        setView("dashboard");
      }
    } catch (err) {
      setReconcileError(err instanceof Error ? err.message : "reconcile failed");
    } finally {
      setPaying(false);
    }
  }

  async function handleApprove(jobId: string) {
    try {
      await approveJob(jobId);
      await refreshGrid();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "approve failed");
    }
  }

  async function handlePay(runBudgetCents: number) {
    setPaying(true);
    setPayError(null);
    setReconcileError(null);
    setReconcileNotice(null);
    try {
      const result = await payJobs({ runBudgetCents });
      await refreshGrid();
      if (!result.outcomeUnknown && (result.held_for_selection ?? []).length > 0) {
        setHoldCandidates(result.held_for_selection ?? []);
        setHoldReason(result.hold_reason);
        setSelectedIds(new Set());
      } else {
        setHoldCandidates([]);
        setHoldReason(null);
        setLastPay(result);
        setView("result");
      }
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "pay failed");
    } finally {
      setPaying(false);
    }
  }

  function handleToggleSelect(jobId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  async function handlePaySelected() {
    setPaying(true);
    setPayError(null);
    setReconcileError(null);
    setReconcileNotice(null);
    try {
      const result = await payJobs({
        runBudgetCents: Math.round(budgetDollars * 100),
        selectedJobIds: [...selectedIds],
      });
      setHoldCandidates([]);
      setHoldReason(null);
      setSelectedIds(new Set());
      setLastPay(result);
      await refreshGrid();
      setView("result");
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "pay failed");
    } finally {
      setPaying(false);
    }
  }

  function retryLoad() {
    loadAll().catch((err: unknown) => {
      setLoadError(err instanceof Error ? err.message : "could not load the dashboard");
    });
  }

  return (
    <div className="page">
      <header>
        <p className="sandbox-badge">Sandbox only. Test money, no real money moves.</p>
        <h1>Settle — payouts for a small studio</h1>
        <p>
          An agent reads approved work, decides who gets paid how much, and pays them with PayPal,
          inside a weekly cap the owner sets.
        </p>
        <nav className="app-nav" aria-label="Product views">
          <button onClick={() => setView("allocation")}>Allocation agent</button>
          <button onClick={() => setView("transactions")}>Verified transactions</button>
          <button onClick={() => setView("dashboard")}>Legacy payout workflow</button>
        </nav>
        <p>
          Sender: US sandbox test account, not a real Indian studio.{" "}
          {caps?.worst_case_exposure ?? "Worst-case configured exposure: $1500.00 per rolling 168 hours."}
        </p>
        <p className="panel-line">
          Owner token:{" "}
          {ownerTokenSet ? (
            <>
              entered for this tab.{" "}
              <button type="button" className="button button-secondary" onClick={clearOwnerToken}>
                Clear it
              </button>
            </>
          ) : (
            <>
              <input
                type="password"
                value={ownerTokenInput}
                onChange={(e) => setOwnerTokenInput(e.target.value)}
                placeholder="Enter the owner token"
                aria-label="Owner token"
              />{" "}
              <button
                type="button"
                className="button button-secondary"
                onClick={saveOwnerToken}
                disabled={ownerTokenInput === ""}
              >
                Save for this tab
              </button>{" "}
              Approve and pay stay off until it is entered. It lives in this tab only.
            </>
          )}
        </p>
      </header>

      {view === "landing" && (
        <main>
          <section aria-label="Who this is for">
            <h2>Who this is for</h2>
            <p>
              Meera runs a six-person design studio. Every Friday she loses three hours matching
              approved work to freelancer invoices and paying them one by one. Meera is an
              illustrative example, not a real user.
            </p>
            <p>
              Settle fixes it in one flow. Meera approves the week&apos;s jobs in one click. The
              agent chooses which approved jobs to pay now, under the run budget Meera sets, the
              rules check every chosen job against the $200 per-payment cap and the $1,500 weekly
              cap, and PayPal pays the ones that pass. One that is over the cap waits for Meera,
              with the reason on screen.
            </p>
          </section>

          <section className="sample-result" aria-label="Sample result">
            <h2>Sample result</h2>
            <p>
              {sampleResult.paidCount} payment paid, {usd(sampleResult.paidTotalUsd * 100)}, batch{" "}
              {sampleResult.batchId}, status {sampleResult.status}. {sampleResult.waitingCount} payment
              still waiting.
            </p>
            <p>
              <strong>Sample data, not a live payment.</strong> The live dashboard replaces this
              with real sandbox rows.
            </p>
            <button type="button" className="button button-secondary" onClick={() => setView("result")}>
              See the sample result screen
            </button>
          </section>

          <button type="button" className="button button-primary" onClick={() => setView("transactions")}>
            Open transaction intelligence
          </button>
          <button type="button" className="button button-secondary" onClick={() => setView("dashboard")}>
            Open payout workflow
          </button>
        </main>
      )}

      {view === "dashboard" && (
        <main>
          <p className="data-badge" role="status">
            {live ? "Live sandbox data." : "Sample data — the server has not answered yet."}
          </p>
          {loadError !== null && (
            <p className="error-text" role="alert">
              Could not load live data: {loadError}{" "}
              <button type="button" className="button button-secondary" onClick={retryLoad}>
                Try again
              </button>
            </p>
          )}

          {reconcileNotice !== null && (
            <p className="panel-line" role="status">
              {reconcileNotice}
            </p>
          )}

          <section className="kpis" aria-label="Totals">
            <div className="kpi">
              <div className="kpi-value">{usd(totalPaidCents)}</div>
              <div className="kpi-label">Total paid</div>
            </div>
            <div className="kpi">
              <div className="kpi-value">{usd(totalWaitingCents)}</div>
              <div className="kpi-label">Total waiting</div>
            </div>
            <div className="kpi">
              <div className="kpi-value">{waitingCount}</div>
              <div className="kpi-label">Jobs waiting</div>
            </div>
            <div className="kpi">
              <div className="kpi-value">{usd(remainingCapCents)}</div>
              <div className="kpi-label">Rolling cap left</div>
            </div>
          </section>

          <FinancialControls
            caps={caps}
            ownerTokenSet={ownerTokenSet}
            onRefresh={refreshGrid}
          />

          <ApprovalPanel
            jobs={jobs}
            rows={rows}
            caps={caps}
            paying={paying}
            payError={payError}
            onApprove={handleApprove}
            runBudgetDollars={budgetDollars}
            onRunBudgetChange={setRunBudgetDollars}
            onPay={handlePay}
            holdCandidates={holdCandidates}
            holdReason={holdReason}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onPaySelected={handlePaySelected}
            ownerTokenSet={ownerTokenSet}
          />

          <StudioDashboard rows={rows} />

          <section className="audit-trail" aria-label="Audit trail">
            <h2>Why each payment was paid, held, or blocked</h2>
            {recentAudit.length === 0 && <p>No decisions recorded yet.</p>}
            <ul>
              {recentAudit.map((row) => (
                <li key={row.audit_id}>
                  <strong>{row.actor}</strong> — {row.action} — {row.job_id} — {usd(row.amount_cents)}
                  {row.payout_batch_id ? ` — batch ${row.payout_batch_id}` : ""} — {row.reason}
                </li>
              ))}
            </ul>
          </section>

          <footer>
            <p>
              Paid rows are real sandbox receipts from live test runs. Waiting rows are seeded demo
              jobs for this run. Fees shown use PayPal&apos;s actual <code>payout_item_fee</code>{" "}
              (sender-side fee). Sandbox only. Test money, no real money moves.
            </p>
            <p>
              <button type="button" className="button button-secondary" onClick={() => setView("landing")}>
                Back to the start
              </button>
            </p>
          </footer>
        </main>
      )}

      {view === "transactions" && <TransactionsDashboard />}
      {view === "allocation" && <AllocationPlanner />}

      {view === "result" && (
        <main>
          <section aria-label="Payment result">
            <h2>{lastPay === null ? "Sample result" : "Payment result"}</h2>
            {lastPay === null && (
              <p>
                <strong>Sample data, not a live payment.</strong> Pay the approved jobs from the
                dashboard to see a live result here.
              </p>
            )}
            {lastPay !== null && (
              <>
                {lastPay.outcomeUnknown && (
                  <div className="error-text" role="alert">
                    <p>
                      <strong>Payment outcome unknown — do not retry blindly.</strong> PayPal may
                      have accepted this submission. The durable reservation still counts against
                      the rolling cap; only provider reconciliation can decide whether it paid.
                    </p>
                    <p>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={handleReconcile}
                        disabled={paying || !ownerTokenSet}
                      >
                        {paying ? "Reconciling…" : "Reconcile with PayPal"}
                      </button>
                    </p>
                    {reconcileError !== null && <p>Reconcile failed: {reconcileError}</p>}
                  </div>
                )}
                <p>
                  Batch: <strong>{lastPay.payout_batch_id ?? "none"}</strong> — status{" "}
                  <strong>{lastPay.batch_status ?? "none"}</strong>.
                  {lastPay.actual_fee_cents !== null && lastPay.actual_fee_cents !== undefined ? (
                    <>
                      {" "}
                      Actual PayPal fee (<code>payout_item_fee</code>):{" "}
                      <strong>{usd(lastPay.actual_fee_cents)}</strong>.
                    </>
                  ) : null}
                </p>
                {lastPay.batch_status === "PROCESSING" && !lastPay.outcomeUnknown && (
                  <div className="panel-line" role="status">
                    <p>
                      PayPal accepted this batch and it is still processing. Reconcile with PayPal
                      or wait for the verified webhook to confirm final settlement.
                    </p>
                    <p>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={handleReconcile}
                        disabled={paying || !ownerTokenSet}
                      >
                        {paying ? "Reconciling…" : "Reconcile with PayPal"}
                      </button>
                    </p>
                    {reconcileError !== null && <p>Reconcile failed: {reconcileError}</p>}
                  </div>
                )}
                <p>
                  Chosen by:{" "}
                  <strong>
                    {lastPay.proposer === "model"
                      ? "the model"
                      : lastPay.proposer === "owner"
                        ? "the owner"
                        : lastPay.proposer === "manual-hold"
                          ? "held for the owner"
                          : "rule-based"}
                  </strong>
                  {lastPay.proposer_reason ? ` — ${lastPay.proposer_reason}` : ""}. The rules checked
                  every chosen job before any payment.
                </p>
                {lastPay.invoice_status !== undefined && lastPay.invoice_status !== null && (
                  <p>
                    Invoice:{" "}
                    {lastPay.invoice_status === "SENT" && lastPay.invoice_id !== null ? (
                      <>
                        <strong>{lastPay.invoice_id}</strong> — SENT —{" "}
                        {usd(lastPay.invoice_total_cents ?? 0)}.
                      </>
                    ) : (
                      <>
                        not sent ({lastPay.invoice_error ?? lastPay.invoice_status}), bill by hand.
                      </>
                    )}
                  </p>
                )}
                <h3>{lastPay.outcomeUnknown ? "Confirmed paid" : "Paid"} ({lastPay.accepted.length})</h3>
                {lastPay.accepted.length === 0 && (
                  <p>
                    {lastPay.outcomeUnknown
                      ? "No payment is confirmed by this response. The provider outcome is unresolved."
                      : "No payments went out."}
                  </p>
                )}
                <ul>
                  {lastPay.accepted.map((jobId) => (
                    <li key={jobId}>
                      {jobId} — {statusLabel("paid")}
                    </li>
                  ))}
                </ul>
                {(lastPay.processing ?? []).length > 0 && (
                  <>
                    <h3>Processing at PayPal ({(lastPay.processing ?? []).length})</h3>
                    <ul>
                      {(lastPay.processing ?? []).map((item) => (
                        <li key={item.job_id}>
                          {item.job_id} — {statusLabel("processing")}
                          {item.payout_batch_id ? ` — batch ${item.payout_batch_id}` : ""}
                          {item.reason ? ` — ${item.reason}` : ""}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <h3>Held for a later run ({(lastPay.held ?? []).length})</h3>
                {(lastPay.held ?? []).length === 0 && <p>Nothing was held for a later run.</p>}
                <ul>
                  {(lastPay.held ?? []).map((item) => (
                    <li key={item.job_id}>
                      {item.job_id} — {item.reason}
                    </li>
                  ))}
                </ul>
                <h3>Held or blocked ({lastPay.rejected.length})</h3>
                {lastPay.rejected.length === 0 && <p>Nothing was held or blocked.</p>}
                <ul>
                  {lastPay.rejected.map((item) => (
                    <li key={item.job_id}>
                      {item.job_id} — {item.label} — {item.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button type="button" className="button button-primary" onClick={() => setView("dashboard")}>
              Back to the dashboard
            </button>
          </section>
        </main>
      )}
    </div>
  );
}
