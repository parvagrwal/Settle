// Wiring — the async model proposer meets the sync loop proposer.
// groqPropose is async; the agent loop takes a sync proposer. This
// adapter awaits the model once, then hands the loop a sync proposer
// that returns the model's proposals. On any model failure (no key,
// 429, bad reply), it falls back to the rule-based proposer and says
// so, never pays on a failed model call. The decision check still
// runs on every proposal either way, model or rule-based.
// Sandbox only, test money, no real money moves.
import { groqPropose } from "./groqProposer.ts";
import { ruleBasedProposal, type Proposer } from "./model.ts";
import type { Job } from "./jobs.ts";
import type { FetchFn } from "./paypalClient.ts";

export interface WiredProposer {
  proposer: Proposer;
  source: "model" | "rule-based";
  reason: string | null;
  ms: number | null;
}

/** Ask the model to propose, fall back to rule-based on any failure.
 * The returned proposer is sync, so it plugs straight into the loop. */
export async function groqOrRuleBasedProposer(opts: {
  jobs: Job[];
  apiKey: string;
  model?: string;
  fetchFn?: FetchFn;
}): Promise<WiredProposer> {
  if (!opts.apiKey) {
    return {
      proposer: ruleBasedProposal,
      source: "rule-based",
      reason: "no GROQ_API_KEY, falling back to the rule-based proposer",
      ms: null,
    };
  }
  try {
    const result = await groqPropose({
      jobs: opts.jobs,
      apiKey: opts.apiKey,
      model: opts.model,
      fetchFn: opts.fetchFn,
    });
    const proposals = result.proposals;
    return { proposer: () => proposals, source: "model", reason: null, ms: result.ms };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      proposer: ruleBasedProposal,
      source: "rule-based",
      reason: `model call failed (${reason}), falling back to the rule-based proposer`,
      ms: null,
    };
  }
}
