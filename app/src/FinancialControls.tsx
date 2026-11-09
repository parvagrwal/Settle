// Owner financial controls — durable policy, provider reconciliation and
// unresolved discrepancies. The browser never computes cap authority: it
// displays the server's /api/caps summary and writes owner policy through
// the authenticated server endpoint.
import { useEffect, useState, type FormEvent } from "react";
import {
  fetchFinancialDiscrepancies,
  reconcileFinancial,
  updateFinancialPolicy,
  type Caps,
  type FinancialDiscrepancy,
} from "./api.ts";

interface FinancialControlsProps {
  caps: Caps | null;
  ownerTokenSet: boolean;
  /** Refresh grid, jobs, audit and authoritative cap summary. */
  onRefresh: () => Promise<void>;
}

export default function FinancialControls(props: FinancialControlsProps) {
  const { caps, ownerTokenSet, onRefresh } = props;
  const cap = caps?.rolling_cap_cents ?? caps?.weekly_cap_cents ?? 150000;
  const perPayment = caps?.per_payment_cap_cents ?? 20000;
  const freshness = caps?.freshness_seconds ?? 300;
  const version = caps?.policy_version ?? 1;
  // Only overwrite an unsaved edit when the authoritative server policy
  // actually changes, not on every five-second dashboard poll.
  const policySignature = `${version}:${cap}:${perPayment}:${freshness}`;
  const [capDollars, setCapDollars] = useState((cap / 100).toFixed(2));
  const [perPaymentDollars, setPerPaymentDollars] = useState((perPayment / 100).toFixed(2));
  const [freshnessSeconds, setFreshnessSeconds] = useState(String(freshness));
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discrepancies, setDiscrepancies] = useState<FinancialDiscrepancy[]>([]);

  useEffect(() => {
    setCapDollars((cap / 100).toFixed(2));
    setPerPaymentDollars((perPayment / 100).toFixed(2));
    setFreshnessSeconds(String(freshness));
  }, [policySignature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ownerTokenSet) {
      setDiscrepancies([]);
      return;
    }
    // A missing/stale token is not a dashboard load failure; explicit
    // owner actions below surface HTTP errors with their exact reason.
    fetchFinancialDiscrepancies().then(setDiscrepancies).catch(() => setDiscrepancies([]));
  }, [ownerTokenSet, version]);

  async function refreshDiscrepancies(): Promise<void> {
    if (!ownerTokenSet) return;
    try {
      setDiscrepancies(await fetchFinancialDiscrepancies());
    } catch {
      // Reconciliation itself already succeeded or failed visibly above.
    }
  }

  async function handlePolicySubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (capDollars.trim() === "" || perPaymentDollars.trim() === "" || freshnessSeconds.trim() === "") {
      setError("Enter a rolling cap, a per-payment cap and a freshness threshold.");
      return;
    }
    const capCents = Math.round(Number(capDollars) * 100);
    const perPaymentCapCents = Math.round(Number(perPaymentDollars) * 100);
    const freshness = Number(freshnessSeconds);
    if (
      !Number.isSafeInteger(capCents) || capCents < 0
      || !Number.isSafeInteger(perPaymentCapCents) || perPaymentCapCents <= 0
      || !Number.isSafeInteger(freshness) || freshness <= 0
      || perPaymentCapCents > capCents
    ) {
      setError("Use non-negative USD amounts with a positive per-payment cap no greater than the rolling cap, and a positive whole-second freshness threshold.");
      return;
    }
    setWorking(true);
    try {
      const result = await updateFinancialPolicy({ capCents, perPaymentCapCents, freshnessSeconds: freshness });
      await onRefresh();
      await refreshDiscrepancies();
      setNotice(`Owner policy v${result.policyVersion} saved. New reservations use the new durable policy immediately.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "policy update failed");
    } finally {
      setWorking(false);
    }
  }

  async function handleReconcile(): Promise<void> {
    setError(null);
    setNotice(null);
    setWorking(true);
    try {
      const result = await reconcileFinancial();
      await onRefresh();
      await refreshDiscrepancies();
      setNotice(`Provider reconciliation complete: ${result.batchesRead} batch reads, ${result.itemsRecorded} item facts recorded. Cap and grid are refreshed from durable evidence.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "reconcile failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="panel" aria-label="Financial controls">
      <h2>Financial controls</h2>
      <p className="panel-line">
        Durable owner policy v{version}: rolling {caps?.window_hours ?? 168}-hour cap, USD integer
        minor units. Provider reconciliation is{" "}
        <strong>{caps?.fresh ? "fresh" : "not fresh"}</strong>
        {caps?.lastSuccessfulReconciliation
          ? `; last successful read ${caps.lastSuccessfulReconciliation}`
          : "; no successful read recorded"}
        . Freshness threshold: {freshness} seconds.
      </p>
      <form className="approve-list" onSubmit={handlePolicySubmit}>
        <h3>Owner policy</h3>
        <p className="panel-line">
          <label>
            Rolling cap (USD){" "}
            <input
              type="number"
              min="0"
              step="0.01"
              value={capDollars}
              onChange={(event) => setCapDollars(event.target.value)}
              disabled={working || !ownerTokenSet}
              aria-label="Rolling cap in dollars"
            />
          </label>{" "}
          <label>
            Per-payment cap (USD){" "}
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={perPaymentDollars}
              onChange={(event) => setPerPaymentDollars(event.target.value)}
              disabled={working || !ownerTokenSet}
              aria-label="Per-payment cap in dollars"
            />
          </label>{" "}
          <label>
            Freshness (seconds){" "}
            <input
              type="number"
              min="1"
              step="1"
              value={freshnessSeconds}
              onChange={(event) => setFreshnessSeconds(event.target.value)}
              disabled={working || !ownerTokenSet}
              aria-label="Provider freshness threshold in seconds"
            />
          </label>
        </p>
        <p className="panel-line">
          <button
            type="submit"
            className="button button-secondary"
            disabled={working || !ownerTokenSet}
          >
            {working ? "Working…" : "Save owner policy"}
          </button>{" "}
          <button
            type="button"
            className="button button-secondary"
            onClick={handleReconcile}
            disabled={working || !ownerTokenSet}
          >
            Reconcile with PayPal
          </button>
        </p>
        <p className="panel-line">
          Without the owner token, policy changes and reconciliation stay off. A stale provider
          read refuses new reservations until reconciliation succeeds.
        </p>
      </form>
      {notice !== null && (
        <p className="panel-line" role="status">
          {notice}
        </p>
      )}
      {error !== null && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="approve-list" aria-label="Unresolved reconciliation discrepancies">
        <h3>Unresolved discrepancies ({discrepancies.length})</h3>
        {!ownerTokenSet && <p>Enter the owner token to inspect provider discrepancies.</p>}
        {ownerTokenSet && discrepancies.length === 0 && <p>No unresolved provider discrepancies.</p>}
        <ul>
          {discrepancies.map((row) => (
            <li key={row.discrepancy_id}>
              <strong>{row.type}</strong> — detected {row.detected_at} — {row.details_json}
              {row.payment_id ? ` — payment ${row.payment_id}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
