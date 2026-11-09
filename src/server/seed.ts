// Seed jobs for the dashboard server — the demo jobs the dashboard shows
// on first load. The jobs live in data/seed.json, which is the single
// source for them; this file only stamps the times and puts in the
// receiver email from the server settings. Four paid rows are real
// sandbox receipts from live test runs on 2026-11-07: batch
// RBZ4V8LCSSK5W (two $1.00 payments) and batch JHG24Y874LK58 (two
// $1.00 payments). The waiting rows are seeded demo jobs, so the pay
// flow can be shown live. One seeded job is over the $200 per-payment
// cap on purpose, so the waiting-for-owner state is visible with its
// reason and the amount over the cap. One seeded job is not approved
// yet, so the approve flow can be shown live.
// Sandbox only, test money, no real money moves.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Job } from "./jobs.ts";

interface SeedRow {
  job_id: string;
  freelancer_id: string;
  amount_cents: number;
  currency: string;
  /** ISO date the work is due, when known. */
  due?: string;
  /** How urgent the job is: high, normal, or low. */
  priority?: string;
  approval_state: string;
  status: string;
  payout_batch_id: string | null;
  decision_reason: string | null;
  approved_days_ago: number;
}

function loadSeedRows(): SeedRow[] {
  const seedPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "seed.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(seedPath, "utf8"));
  } catch {
    throw new Error(`seed: could not read ${seedPath}. The file must exist and hold valid JSON.`);
  }
  const jobs = (parsed as Record<string, unknown>).jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("seed: data/seed.json must hold a non-empty jobs list.");
  }
  for (const row of jobs) {
    const item = row as Record<string, unknown>;
    if (
      typeof item.job_id !== "string" ||
      typeof item.freelancer_id !== "string" ||
      typeof item.amount_cents !== "number" ||
      item.currency !== "USD" ||
      typeof item.approval_state !== "string" ||
      typeof item.status !== "string" ||
      typeof item.approved_days_ago !== "number" ||
      (item.due !== undefined && typeof item.due !== "string") ||
      (item.priority !== undefined &&
        item.priority !== "high" &&
        item.priority !== "normal" &&
        item.priority !== "low")
    ) {
      throw new Error(`seed: a row in data/seed.json is missing a required field, job ${String(item.job_id ?? "unknown")}.`);
    }
  }
  return jobs as SeedRow[];
}

export function seedJobs(receiverEmail: string, nowMs: number = Date.now()): Job[] {
  return loadSeedRows().map((row) => ({
    job_id: row.job_id,
    freelancer_id: row.freelancer_id,
    paypal_email: receiverEmail,
    amount_cents: row.amount_cents,
    currency: "USD",
    due: row.due ?? null,
    priority: (row.priority ?? null) as Job["priority"],
    approval_state: row.approval_state as Job["approval_state"],
    approved_at:
      row.approval_state === "not_approved"
        ? null
        : nowMs - row.approved_days_ago * 24 * 60 * 60 * 1000,
    status: row.status as Job["status"],
    payout_batch_id: row.payout_batch_id,
    payout_item_id: null,
    decision_reason: row.decision_reason,
  }));
}
