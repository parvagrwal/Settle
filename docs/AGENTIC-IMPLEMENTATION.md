# Agentic allocation implementation and evidence

**Date:** 2026-11-09  
**Architecture approval:** user approved the Phase-0 proposal on 2026-11-09.

## Current result

The transcription proposer is no longer the only allocation capability. A new, separate decision path validates financial context, generates alternative integer-cent plans, lets an agent select only a supplied valid scenario, records rationale/uncertainty/change triggers, and exposes a delayed-receipt counterfactual in the default UI. AI absence produces no recommendation and no payment authorization.

This is meaningful implementation progress, **not completion of the final acceptance standard**. The plan store is now connected to PayPal execution through an approved-plan runner that pays with the same Payouts path and marks a plan succeeded only when every item settles; approve, pay, and allocation writes now need the owner token, and approval and execution revalidate the plan against its stored context, including expiry. Live model comparison, browser proof, real-user validation and Indian production feasibility remain unresolved.

## Executed evidence

| Evidence | Result |
|---|---|
| Full server regression | **173/173 passing** (`npm test` after the review fixes) |
| Allocation unit/property tests | 8 passing; 250 generated contexts, all generated plans independently valid |
| Agent orchestration | 5 passing; tool trace, no-AI behavior, scenario injection rejection, counterfactual |
| Durable controls | 8 passing; RBAC methods, exact plan hash, idempotency, stop, restart, immutable SQL audit, stale-plan refusal at approval and execution, mandatory-rule refusal at approval |
| Groq selector contract | 4 passing with mocked provider; malformed/429 fail closed |
| Allocation API integration | 3 passing; no-AI, mocked valid model, counterfactual |
| Comparative harness | 4 passing with mock selector; does not prove model quality |
| Owner token | 8 passing; 401 without a token, 401 with the wrong token, 503 when unset, 200 with the correct token, on approve, pay, and allocation writes |
| Approved-plan execution | 4 passing with mocked PayPal; all settled, one failed item, PayPal unreachable, never-approved plan denied |
| Live model experiment | **Blocked:** `BLOCKED_NO_GROQ_CREDENTIAL`; `evidence/allocation/comparison.json` |

The comparison entries labelled ai_assisted and agentic now run different paths: ai_assisted is one model selection over the generated scenarios, returned as-is even when it breaks a rule; agentic is the full loop, which validates the pick and, on a rule break, escalates and tries the next scenario, recommending only a plan that passes the validator. The counterfactual takes a caller-supplied one-condition mutation of the input context instead of a fixed demo context.
| Frontend build | Passing; large-bundle warning remains |
| Browser E2E | Still blocked before page launch by Chromium shared libraries |
| Real-user research | Not performed; `USER-RESEARCH.md` |
| India production feasibility | Not established; `INDIA-FEASIBILITY.md` |

## Deterministic baseline finding from actual runner

The illustrative scenario has $130 discretionary budget after reserve. Current deadline-first fallback fully funds `brand-refresh` ($80) and `urgent-retouch` ($50), leaving mandatory `studio-software` ($90) unfunded. Alternative scenarios make that trade-off visible; operational-stability protects the mandatory obligation. This shows a meaningful decision problem, but does **not** prove an LLM selects better until the live model evaluation runs.

## Improvement loops completed

- **Decision quality:** scenario alternatives and a changed-funds counterfactual; mandatory unaffordable obligations block discretionary diversion.
- **AI contribution:** no-AI response removes selection/reasoning and never silently executes. Live incremental value still unmeasured.
- **Financial safety:** property tests caught per-payment caps accidentally creating unauthorized partial payments. Generator fixed; validator retained. Owner approval binds an exact SHA-256 plan hash.
- **User experience:** obligations, alternatives, residuals, deferrals, uncertainties, tool trace and no-authorization state are visible. Approval/challenge UI is not yet connected.
- **Engineering quality:** pure allocation functions are separated from orchestration, provider selector and durable control store. Legacy execution remains technical debt.
- **Differentiation:** deterministic fallback can leave a later mandatory obligation unfunded; the agent's task is explicit contextual trade-off selection. No superiority claim without live comparison.

## Requirements-to-evidence matrix

| Requirement | Implementation | Independent evidence | Status |
|---|---|---|---|
| Decision rights | Approved diagnosis | `AGENTIC-ALLOCATION-DIAGNOSIS.md` | Defined |
| Obligation protection | `allocation.ts` | 250-case invariant run + adversarial tests | Verified in fixtures |
| Alternative scenario evaluation | Three deterministic strategies + selector | unit/orchestration tests | Verified in fixtures |
| Context adaptation | delayed-receipt counterfactual | unit/API tests | Verified in fixtures |
| No silent AI fallback | orchestrator/API | AI-disabled tests | Verified |
| Durable decisions | `allocationStore.ts` | restart + immutable audit tests | Verified |
| Owner approval/RBAC/stop | store methods | role/approval/stop tests | Store verified; HTTP auth pending |
| Idempotent execution | plan execution record | duplicate-execution tests | Gate verified; PayPal not connected |
| Agent selects valid scenario | `decisionEngine.ts`, Groq selector | mock contract tests | Live model pending |
| AI beats baseline | evaluator + runner | credential-blocked output | **Unproven** |
| Secure legacy payment API | none yet | diagnosis finds unauthenticated routes | **Unresolved** |
| Reconciliation-triggered re-plan | verified event store exists separately | no trigger integration | Pending |
| Complete demo | planner UI | compile only; browser blocked | Pending |
| Real problem evidence | research protocol | no participants | **Unvalidated** |
| India deployment | provider/legal matrix | external docs only | **Not production-feasible as-is** |

## New file rationale

| File | Necessary responsibility |
|---|---|
| `src/server/allocation.ts` | Integer obligations, discretionary budget, alternatives and independent financial validator. |
| `src/server/decisionEngine.ts` | Tool-traced scenario orchestration with no execution authority and no silent fallback. |
| `src/server/groqScenarioSelector.ts` | Strict structured model selection; untrusted notes cannot become tools or permissions. |
| `src/server/allocationStore.ts` | Durable context/plan/approval/execution/control tables and immutable decision audit. |
| `src/server/allocationEvaluation.ts` | Predeclared three-system metrics and counterfactual records. |
| `src/server/scenarioFixtures.ts` | Server-owned labelled illustrative contexts, never customer/cash claims. |
| `scripts/run-allocation-evaluation.ts` | Reproducible live-model runner with explicit blocked output. |
| `app/src/AllocationPlanner.tsx`, `allocation.css` | AG Grid alternative comparison and decision/trade-off UI. |
| New allocation tests | Strict red/green financial, agent, security, API and evaluation contracts. |
| `docs/AGENTIC-*`, `INDIA-*`, `USER-*` | Forensic diagnosis, honest implementation status, feasibility and research limitations. |

## Next required increments

1. Protect or remove legacy unauthenticated approve/pay routes; implement request authentication and role tokens/sessions without insecure defaults.
2. Bind the approved plan to the PayPal batch idempotency key; reconcile unknown outcomes before any retry. Connect verified item failures to a new plan version.
3. Add owner approve/challenge/reject UI and immutable version history. Never approve through model output.
4. Supply real Groq credentials and run repeated live three-system scenarios, recording latency, selection consistency, factual explanation accuracy and failures.
5. Repair the Chromium environment and execute Playwright approval/counterfactual/security flows; capture actual evidence.
6. Conduct field research and provider/legal/tax/privacy review before production or Indian feasibility claims.
