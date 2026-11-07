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
    status: "paid",
    status_label: "Paid",
    reason: null,
    payout_batch_id: "SAMPLE-1",
    fee_usd: 0.37,
    net_usd: 0.63,
  },
  {
    job_id: "sample-job-2",
    freelancer: "freelancer-2",
    amount_cents: 100,
    amount_usd: 1.0,
    status: "waiting",
    status_label: "Waiting",
    reason: null,
    payout_batch_id: null,
    fee_usd: 0.37,
    net_usd: 0.63,
  },
];

export const sampleResult = {
  batchId: "SAMPLE-1",
  status: "SUCCESS",
  paidCount: 1,
  paidTotalUsd: 1.0,
  waitingCount: 1,
};
