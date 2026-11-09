// Wiring — the async model allocator meets the sync loop proposer.
// groqPropose is async; the agent loop takes a sync proposer. This
// adapter awaits the model once, then hands the loop a sync proposer
// that returns the model's chosen jobs, in the model's order, plus the
// jobs the model held, with reasons. On any model failure (no key,
// 429, bad reply), it holds the run for the owner to pick the jobs by
// hand: the proposer returns nothing, so nothing is paid, and the
// caller shows the candidates. It never falls back to auto-paying the
// full set. The decision check still runs on every chosen job.
// Sandbox only, test money, no real money moves.
import { groqPropose, type GroqHeldJob } from "./groqProposer.ts";
import type { Proposer } from "./model.ts";
import type { Job } from "./jobs.ts";
import type { FetchFn } from "./paypalClient.ts";

export interface WiredProposer {
  proposer: Proposer;
  source: "model" | "manual-hold";
  reason: string | null;
  ms: number | null;
  /** The jobs the model held for a later run, with reasons. Empty on a hold. */
  held: GroqHeldJob[];
}

/** Ask the model to allocate, hold for the owner on any failure.
 * The returned proposer is sync, so it plugs straight into the loop.
 * With no jobs to allocate, no model call is made. */
export async function groqAllocator(opts: {
  jobs: Job[];
  apiKey: string;
  runBudgetCents: number;
  model?: string;
  fetchFn?: FetchFn;
}): Promise<WiredProposer> {
  const hold = (reason: string): WiredProposer => ({
    proposer: () => [],
    source: "manual-hold",
    reason,
    ms: null,
    held: [],
  });
  if (opts.jobs.length === 0) {
    return {
      proposer: () => [],
      source: "model",
      reason: "no approved jobs are waiting to be paid",
      ms: null,
      held: [],
    };
  }
  if (!opts.apiKey) {
    return hold("no GROQ_API_KEY, this run holds for the owner to pick the jobs by hand");
  }
  try {
    const result = await groqPropose({
      jobs: opts.jobs,
      apiKey: opts.apiKey,
      runBudgetCents: opts.runBudgetCents,
      model: opts.model,
      fetchFn: opts.fetchFn,
    });
    const proposals = result.proposals;
    return { proposer: () => proposals, source: "model", reason: null, ms: result.ms, held: result.held };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return hold(`model call failed (${reason}), this run holds for the owner to pick the jobs by hand`);
  }
}
