// Test fixture: application-origin jobs.
//
// The shipped dashboard seeds `data/seed.json`, and those rows are deliberately
// refused by every payment path. Tests that exercise payment execution must
// therefore hand the server records this process itself would have created:
// origin `application`, no claimed provider batch id. The demonstration rows
// (which claim a past sandbox batch) are left out entirely, because a paid row
// with no ledger payment behind it is exactly the state this rebuild removes.
import type { Job } from "../../src/server/jobs.ts";
import { seedJobs } from "../../src/server/seed.ts";

export function payableJobs(email = "freelancer@example.com", nowMs: number = Date.now()): Job[] {
  return seedJobs(email, nowMs)
    .filter((job) => job.status !== "historical_reference")
    .map((job) => ({ ...job, origin: "application" as const }));
}
