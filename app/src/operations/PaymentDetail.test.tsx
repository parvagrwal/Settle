// Payment investigation view. The record decides what is shown: an identifier
// the ledger does not hold is stated as absent, never filled in; history the
// caller may not see is announced as withheld, never rendered as "none".
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentDetail } from "./PaymentDetail.tsx";
import { detail, row } from "../test/operationsFixtures.ts";
import type { PaymentOperationDetail } from "./contract.ts";

const confirmed = row({
  operationId: "workspace/confirmed", jobId: "confirmed", title: "Homepage illustration", paymentStatus: "provider_confirmed", paymentStatusLabel: "Confirmed by PayPal",
  payoutBatchId: "BATCH-1", batchReferenceKind: "provider_item", payoutItemId: "ITEM-1", transactionId: "TX-1", providerStatus: "SUCCESS", providerTimestamp: "2026-11-09T10:05:00.000Z",
  submittedAt: "2026-11-09T10:00:00.000Z", confirmedAt: "2026-11-09T10:05:00.000Z", verificationState: "reconciled", reconciliationState: "reconciled", lastReconciledAt: "2026-11-10T11:55:00.000Z",
  feeState: "provider_reported", feeEstimateCents: 25, providerFeeCents: 25, executionRunId: "run-1", isPendingObligation: false, isReadyToPay: false, isDueSoon: false,
});

function loader(result: PaymentOperationDetail | Error) {
  return vi.fn((_: string, signal: AbortSignal) => new Promise<PaymentOperationDetail>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    if (result instanceof Error) reject(result); else resolve(result);
  }));
}

describe("PaymentDetail", () => {
  it("shows the identifiers, approval, provider evidence, fees, reconciliation and audit history the ledger holds", async () => {
    const load = loader(detail(confirmed, {
      fees: { state: "provider_reported", estimate: { estimatedFeeMinor: 25, currency: "USD", policyId: "paypal-us-payouts-api-flat-2026-10", policyVersion: 1, formula: "USD 0.25 flat per payout item", sourceUrl: "https://www.paypal.com/us/business/paypal-business-fees" }, provider: { reportedFeeMinor: 25, currency: "USD", source: "payout_item_fee", isProviderEstimate: true, observedAt: "2026-11-09T10:05:00.000Z" }, consistent: true, explanation: "The provider-reported fee matches the policy estimate." },
      reconciliation: { state: "reconciled", lastReconciledAt: "2026-11-10T11:55:00.000Z", reconciliationRunId: "recon-1", discrepancyCount: 0, discrepancies: [] },
      executionRun: { runId: "run-1", kind: "product", status: "succeeded", startedAt: "2026-11-09T10:00:00.000Z", completedAt: "2026-11-09T10:05:00.000Z", itemCount: 1 },
      audit: { access: "granted", note: "Ledger and workspace audit rows for this record, oldest first.", events: [
        { source: "workspace", sequence: 1, at: "2026-11-09T08:59:00.000Z", actor: "owner-1", action: "job_created", from: null, to: null, note: "Application-generated operational obligation." },
        { source: "ledger", sequence: 2, at: "2026-11-09T09:00:00.000Z", actor: "owner", action: "payment_approved", from: null, to: "approved", note: null },
        { source: "ledger", sequence: 5, at: "2026-11-09T10:05:00.000Z", actor: "system", action: "provider_item_updated", from: "submitted", to: "provider_confirmed", note: null },
      ] },
    }));
    render(<PaymentDetail operationId="workspace/confirmed" version="v1" load={load} />);
    const region = await screen.findByRole("region", { name: /Payment record Homepage illustration/ });
    expect(within(region).getByText("11111111-1111-4111-8111-111111111111")).toBeInTheDocument();
    for (const value of ["BATCH-1", "ITEM-1", "TX-1", "SUCCESS", "run-1", "recon-1", "fixture-contractor@example.test"]) expect(within(region).getAllByText(new RegExp(value)).length).toBeGreaterThan(0);
    expect(within(region).getByText("USD 0.25 flat per payout item")).toBeInTheDocument();
    expect(within(region).getByText("The provider-reported fee matches the policy estimate.")).toBeInTheDocument();
    const audit = within(region).getByRole("table", { name: /Audit history/ });
    expect(within(audit).getAllByRole("row")).toHaveLength(4);
    expect(within(audit).getByText("payment_approved")).toBeInTheDocument();
    expect(within(audit).getByText("provider_item_updated")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("workspace/confirmed", expect.any(AbortSignal));
  });

  it("states that identifiers are absent for a demonstration record instead of inventing them", async () => {
    const seeded = row({ operationId: "legacy/demo-waiting-1", source: "legacy_grid", jobId: "demo-waiting-1", title: null, recordOrigin: "seed", isDemonstration: true, providerEnvironment: "none", paymentStatus: "not_submitted", paymentStatusLabel: "Not submitted", paymentId: null, policyVersion: null, verificationState: "demonstration", feeState: "not_applicable", workspaceId: null, workspaceName: null });
    const load = loader(detail(seeded, {
      sensitiveAccess: false,
      identity: { operationId: seeded.operationId, paymentId: null, jobId: "demo-waiting-1", workspaceId: null, workspaceName: null, recipient: seeded.recipient, recipientEmail: null, idempotencyKey: null },
      fees: { state: "not_applicable", estimate: null, provider: null, consistent: null, explanation: "No ledger payment exists for this record, so there is no fee estimate and no provider-reported fee." },
      audit: { access: "not_applicable", note: "This record has no ledger payment, so there is no ledger audit trail.", events: [] },
    }));
    render(<PaymentDetail operationId="legacy/demo-waiting-1" version="v1" load={load} />);
    const region = await screen.findByRole("region", { name: /Payment record demo-waiting-1/ });
    expect(within(region).getByText(/Demonstration record/)).toBeInTheDocument();
    for (const label of ["Internal payment ID", "PayPal batch ID", "Payout item ID", "Transaction ID", "Provider status"]) {
      const term = within(region).getByText(label);
      expect(term.nextElementSibling?.textContent).toMatch(/None recorded|No ledger payment/);
    }
    expect(within(region).getByText("This record has no ledger payment, so there is no ledger audit trail.")).toBeInTheDocument();
    expect(within(region).queryByRole("table", { name: /Audit history/ })).toBeNull();
    expect(region.textContent).not.toMatch(/undefined|null|NaN/);
  });

  it("says the audit trail is withheld when the caller is not the owner", async () => {
    const load = loader(detail(confirmed, { sensitiveAccess: false, identity: { operationId: confirmed.operationId, paymentId: confirmed.paymentId, jobId: confirmed.jobId, workspaceId: null, workspaceName: null, recipient: confirmed.recipient, recipientEmail: null, idempotencyKey: null }, audit: { access: "owner_required", note: "This record has a ledger audit trail. It is shown only to the owner: sign in to the operational workspace or enter the owner token.", events: [] } }));
    render(<PaymentDetail operationId="workspace/confirmed" version="v1" load={load} />);
    expect(await screen.findByText(/shown only to the owner/)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /Audit history/ })).toBeNull();
    expect(screen.getByText("Recipient email").nextElementSibling?.textContent).toMatch(/owner/i);
  });

  it("lists attention reasons and evidence gaps from the record", async () => {
    const unknown = row({ operationId: "workspace/unknown", title: "Podcast edit", paymentStatus: "outcome_unknown", paymentStatusLabel: "Outcome unknown", needsAttention: true, attentionReasons: ["The submission response was lost. Reconcile with PayPal before any retry; never resubmit blindly."], hasIncompleteEvidence: true, evidenceGaps: ["No PayPal batch ID was recorded for this submission."] });
    render(<PaymentDetail operationId="workspace/unknown" version="v1" load={loader(detail(unknown))} />);
    expect(await screen.findByText(/The submission response was lost/)).toBeInTheDocument();
    expect(screen.getByText("No PayPal batch ID was recorded for this submission.")).toBeInTheDocument();
  });

  it("reports a failed load and retries on request", async () => {
    const user = userEvent.setup();
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValueOnce(detail(confirmed));
    render(<PaymentDetail operationId="workspace/confirmed" version="v1" load={load} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: /Payment record Homepage illustration/ })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("aborts its request when it is removed, and reloads when the record changes", async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((_: string, signal: AbortSignal) => { signals.push(signal); return new Promise<PaymentOperationDetail>(() => undefined); });
    const view = render(<PaymentDetail operationId="workspace/confirmed" version="v1" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    view.rerender(<PaymentDetail operationId="workspace/confirmed" version="v2" load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(signals[0].aborted).toBe(true);
    view.unmount();
    expect(signals[1].aborted).toBe(true);
  });
});
