// Sample data for the landing page, clearly labelled as sample data.
// Shown until the live sandbox data loads, then replaced. Nothing here
// is a live payment, and the batch id is SAMPLE-1 on purpose, so it can
// never be mistaken for a real PayPal receipt.
import type { DashboardRow } from "../api.ts";

export const sampleRows: DashboardRow[] = [
  {
    job_id: "sample-job-1",
    freelancer: "freelancer-1",
    amount_cents: 100,
    amount_usd: 1.0,
    due: null,
    priority: null,
    status: "paid",
    status_label: "Paid",
    reason: null,
    payout_batch_id: "SAMPLE-1",
    fee_cents: 2,
    fee_usd: 0.02,
    fee_label: "$0.02",
    net_usd: 1.0,
    record_origin: "application",
    provenance_label: "Sample row: invented for the landing page, not a payment",
    seeded: false,
    fee_state: "provider_reported",
    fee_estimate_cents: null,
    execution_run_id: null,
  },
  {
    job_id: "sample-job-2",
    freelancer: "freelancer-2",
    amount_cents: 100,
    amount_usd: 1.0,
    due: null,
    priority: null,
    status: "waiting",
    status_label: "Waiting",
    reason: null,
    payout_batch_id: null,
    fee_cents: null,
    fee_usd: null,
    fee_label: "Not reported",
    net_usd: 1.0,
    record_origin: "application",
    provenance_label: "Sample row: invented for the landing page, not a payment",
    seeded: false,
    fee_state: "unavailable",
    fee_estimate_cents: null,
    execution_run_id: null,
  },
];

export const sampleResult = {
  batchId: "SAMPLE-1",
  status: "SUCCESS",
  paidCount: 1,
  paidTotalUsd: 1.0,
  waitingCount: 1,
};
