# Forensic report — Settle payment system at HEAD `2dea9ac`

**Scope.** This report is written before any product code change. It establishes what the
repository actually does at the audited commit, which reported findings reproduce, and which
claims in the repository cannot be supported by the financial evidence it contains.

**Method.** Read-only inspection of the full tracked tree, followed by execution of the existing
suites and the frontend production build. Nothing below is inferred from the supplied report's line
numbers; every finding was re-established from the current source, database schema and tests.

---

## 1. Repository state

| Item | Observed value |
| --- | --- |
| Commit | `2dea9acbe95a69eb10c948a98cd7c72b64328ae8` (`main`, one commit in the checkout) |
| Working tree | Clean at audit time |
| Runtime | Node `v22.22.3`, npm `10.9.8` |
| Server dependencies | None at runtime. Dev-only: `@playwright/test`, `@sparticuz/chromium` |
| Dashboard dependencies | React 19.3, Vite 8.3, AG Grid 36.2, AG Charts 14.2, AG Studio 3.0, TypeScript 7.0 (beta range), Vitest 5.1 |
| Persistence | `node:sqlite` (`DatabaseSync`), one file, default `data/settle.db` |
| Migrations | No migration framework. Each store runs `CREATE TABLE IF NOT EXISTS` at construction and a few ad-hoc `ALTER TABLE` column checks. `TransactionStore` keeps a `schema_migrations` table with a single hard-coded row (`version = 1`). |
| Auth | One shared owner bearer token (`SETTLE_OWNER_TOKEN`), compared with `timingSafeEqual`; exchanged for an HttpOnly session cookie for the product API |
| Tests | 213 server tests, 0 failures (`npm test`, 9.4 s). Frontend `tsc -b && vite build` passes. |

Environment configuration is read from `.env` (git-ignored). Names only: `PAYPAL_CLIENT_ID`,
`PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`, `PAYPAL_SANDBOX_RECEIVER_EMAIL`, `PAYPAL_SANDBOX_CLIENT_EMAIL`,
`GROQ_API_KEY`, `SETTLE_OWNER_TOKEN`, `SETTLE_OWNER_NAME`, `SETTLE_OWNER_EMAIL`, `PAYPAL_WEBHOOK_ID`,
`SETTLE_DB_PATH`, `PORT`. No PayPal, Groq or owner credential is present in this sandbox, and no
credential value is reproduced here.

**Authored source inventory** (by area, all tracked): 37 server modules in `src/server`, 3 shared
modules, 23 dashboard modules, 31 test files, 12 script files, 14 docs, ~1.4 MB of checked-in
`evidence/` artifacts. The complete file list is reproducible with `git ls-files`.

### Persisted schema (as executed, not as documented)

| Store | Tables | Notes |
| --- | --- | --- |
| `FinancialStore` | `recipients`, `owner_policies`, `payments`, `execution_attempts`, `payout_items`, `provider_spend`, `reconciliation_state`, `reconciliation_runs`, `reconciliation_discrepancies`, `invoice_evidence`, `financial_audit` | Audit table is append-only via triggers. Amounts are integer cents. `owner_policies` is versioned by autoincrement. |
| `AllocationStore` | `allocation_contexts`, `allocation_plans`, `plan_approvals`, `plan_executions`, `control_state`, `decision_audit` | One `provider_batch_id` column per execution; one execution row per plan. |
| `ProductStore` | `product_users`, `product_workspaces`, `product_memberships`, `product_sessions`, `product_workspace_policies`, `product_jobs`, `product_decisions`, `product_receipts`, `product_audit` | Provenance columns plus triggers preventing a demo job or receipt from entering an operational payment state. |
| `TransactionStore` | `paypal_events`, `payment_transactions`, `schema_migrations` | Verified-webhook projection, deduplicated by `event_id`. |
| Legacy | none | `SettleStore` jobs, allowlist, invoice set and audit log are **process memory** and are re-seeded on every start. |

### Execution architecture at HEAD

1. `server.ts` loads `.env`, optionally obtains a PayPal sandbox token, seeds eight jobs from
   `data/seed.json`, opens four SQLite stores, and serves one HTTP port.
2. `routes.ts` at construction **migrates every approved seed job into the financial ledger**
   (verifies a recipient and creates a permanent `payments` row), except jobs above the per-payment
   cap.
3. `POST /api/pay` runs `runAgentLoop`: a proposer (owner selection, or `groqAllocator`) chooses jobs,
   `decide()` re-checks each one, then a `payFn` calls `submitApprovedPayment` **once per job**.
4. `submitApprovedPayment` runs `reconcilePayPal`, reserves against the rolling cap, writes an
   execution attempt, `POST`s a one-item Payouts batch, then polls the batch up to 18 × 5 s.
5. `reconcilePayPal` reads stored batch IDs; for any attempt with no batch ID it **`POST`s a payout
   again** with the same `sender_batch_id` and treats `400 DUPLICATE_REQUEST_ID` as recovery.
6. Verified webhooks are stored by `TransactionStore` and also pushed into `FinancialStore`.
7. The dashboard reads `/api/grid` (legacy memory), `/api/caps` (financial store) and
   `/api/transactions` (webhook projection) — three different projections of "paid".

### AI execution architecture at HEAD

| Path | Model | What the model actually decides |
| --- | --- | --- |
| `groqProposer` → agent loop | `openai/gpt-oss-20b` via Groq, strict JSON schema | Picks a subset/order of approved jobs under a run budget. **However**, the prompt states "Pay the most urgent first: soonest due, then highest priority" and the candidate list is already sorted soonest-due/highest-priority, so the expected answer is the deterministic prefix the application could compute itself. |
| `groqScenarioSelector` → `orchestrateAllocation` | same model | Chooses **one of three pre-generated complete plans**. It cannot change amounts. It receives recipient email addresses. |
| `narrateInvestigation` | `llama-3.3-70b-versatile` | Rewrites numbers into prose. No decision. |
| Product workspace recommendation | **no model** | `ProductStore.createRecommendation` is a priority/due sort with a running budget. |

The `toolTrace` returned by `orchestrateAllocation` is a literal array of strings
(`["get_validated_context", "list_valid_scenarios", ...]`). No tool was called.

---

## 2. Blockers A, B and D — input unavailable

The mission refers to "Section 7, Section 8 and Section 10" of an original audit and to Blockers A,
B and D. **No document containing that numbering exists in the repository.** The repository contains
diagnosis documents with different numbering and different content:

- `docs/ARCHITECTURE.md` §7 is "Rejection test", §8 is "Residual risks".
- `docs/AGENTIC-ALLOCATION-DIAGNOSIS.md` §7 is "Proposed agentic architecture", §8 is "Comparative
  evaluation protocol".

Neither defines Blockers A/B/D. The only "blocker" hits in the tree refer to a Playwright/Chromium
launch failure in `docs/IMPLEMENTATION-EVIDENCE.md` and in test names
(`tests/financialPayments.test.ts` uses the string `blocker-a` in temporary directory names, with no
definition attached).

I therefore record **A, B and D as unverifiable inputs**. They are not reconstructed by guesswork.
What I can do is what the mission also asks for: establish the most severe classes of failure from
the code itself and fix those. The three failures below are at least as severe as anything a blocker
list would contain, and each was reproduced from source:

| ID (mine) | Failure | Evidence |
| --- | --- | --- |
| **F-A** | Seeded demonstration rows receive permanent payment identities and can be submitted to PayPal, while the UI states the paid rows are sandbox receipts. | `routes.ts` construction-time migration loop; `/api/pay` accepts `demo-waiting-*`; `data/seed.json` marks four rows `status: "paid"` with batch IDs but no provider evidence file. |
| **F-B** | A normal `PENDING`/`PROCESSING` provider state is escalated to `outcome_unknown` at plan level, and a failed poll after a successful create is escalated to `outcome_unknown` even though the batch ID is known. | `planExecution.ts` returns `outcome_unknown` for `pending`/`onhold`; `financialPayments.ts` marks unknown on poll error even when `batchId` was persisted. |
| **F-D** | Reconciliation can issue a payout `POST` for an attempt it is unsure about, and the ledger accepts a seed job as an operational obligation. `reserved` is included in the reconcilable set. | `financialPayments.reconcilePayPal` → `createPayoutBatch` for any attempt without a batch ID; `FinancialStore.listReconcilableAttempts` includes `'reserved'`. |

Acceptance criteria applied to each are stated in §5 and encoded as tests.

---

## 3. Reported findings, independently classified

| # | Reported issue | Classification | Evidence at this HEAD |
| --- | --- | --- | --- |
| 1 | Fee UI shows $0.75 estimate, $1.25 net, from 4.40% + $0.30 + 3% | **Already resolved / partially confirmed** | `app/src/fees.ts` no longer contains any percentage formula; the dashboard shows only `payout_item_fee`. The *unrelated formula* is gone. What remains is the harder defect: an **estimated** fee is not shown at all, and provenance of the fee is not stored. |
| 2 | A $2.00 payout showed a $0.04 sender fee, contradicting the formula | **Confirmed as provider evidence, with a correction to the report** | `evidence/payouts-first-test/payout-poll.json` is a **two-item** batch: two $1.00 items, `payout_item_fee` `0.02` each, batch `fees` `0.04`. It is not one $2.00 item. Both readings give 2%, which contradicts the 4.4%/$0.30/3% formula. |
| 3 | One immediate poll only, so normal processing becomes "unknown" | **Partially confirmed** | `submitApprovedPayment` polls up to 18 attempts (90 s) and returns `pending`; but `planExecution` maps `pending` to `outcome_unknown`, and a poll *error* is recorded as `outcome_unknown` even when the batch ID is known. No backoff, no jitter, no durable schedule, no restart re-arm. |
| 4 | Unknown outcome can lead to resubmission | **Partially confirmed** | No *blind* resubmission of a new payment exists: the payment row is reused and `submitApprovedPayment` refuses `outcome_unknown`. But reconciliation re-`POST`s with the same `sender_batch_id`, and `reserved` is reconcilable. The recovery path is not gated or explicitly labelled as an idempotent probe. |
| 5 | One batch per job, and a single batch ID reported for the run | **Confirmed** | `submitApprovedPayment` creates one single-item batch per job. `PlanExecutionResult` and `plan_executions` carry one `payoutBatchId`. `/api/pay` returns `payout_batch_id` = `providerItems[0]`. |
| 6 | Audit rows copy the first batch ID / null transaction IDs | **Not reproduced for paid rows** | `routes.ts` `payFn` writes `job.payout_batch_id` and `job.paypal_transaction_id` per job; `agent.ts` uses `job.payout_batch_id ?? paid.payoutBatchId`. A test (`tests/productApi.test.ts`) asserts two distinct batch IDs and transaction IDs. Rows for *invoicing* and *refusals* correctly carry no transaction ID. Residual risk remains in `executeApprovedPlan`, which has no audit rows at all. |
| 7 | Dashboard claims "live sandbox data" and real receipts | **Confirmed** | `app/src/App.tsx` renders "Live sandbox data." when a fetch succeeds, and "Paid rows are real sandbox receipts from live test runs." The four paid rows come from `data/seed.json`; there is no PayPal connection in this sandbox. |
| 8 | Allocation asks the model to repeat a deterministic order | **Confirmed** | `groqProposer` prompt imposes the ordering and receives a pre-sorted list; `decisionEngine` asks the model to pick 1 of 3 fully-formed plans. |
| 9 | $200/$1,500 hardcoded in the model prompt | **Confirmed** | `groqProposer.ts`: `"Caps: $200 per payment, $1,500 per week combined."` Meanwhile the enforced policy is a versioned DB row. |
| 10 | Recipient emails sent to Groq | **Confirmed** | `groqProposer` sends `recipient` (email) per job; `groqScenarioSelector` sends the whole context including `recipient`. |
| 11 | Tool trace is a fixed list of strings | **Confirmed** | `decisionEngine.ts` pushes literal strings; `AllocationPlanner.tsx` renders them as "Tool trace". |
| 12 | Allocation screen cannot approve or execute | **Confirmed** | `AllocationPlanner.tsx` has only evaluate/counterfactual buttons. `/api/allocation/plans/:id/execute` exists but nothing calls it. There is no approve route at all, though `AllocationStore.approvePlan` exists. |
| 13 | `setEmergencyStop` unused, routes 404 | **Confirmed** | `AllocationStore.setEmergencyStop`/`isStopped` are never routed. No emergency stop exists on the financial ledger, so it would not stop a payout even if routed. |
| 14 | Product workspace recommendation does not use a model | **Confirmed** | `ProductStore.createRecommendation` is deterministic and writes a fixed rationale. |
| 15 | Total paid $4.00 vs rolling spend $0.00 | **Confirmed, and the two numbers are both wrong for the label** | Total is the sum of four *seed* rows; rolling spend is `provider_spend` (empty). Neither is a lifetime provider-confirmed application total. |
| 16 | No PayPal Agent Toolkit integration | **Confirmed and justified** | The official `paypal/agent-toolkit` exposes invoices, orders, disputes, shipment, catalog, subscriptions, reporting/insights. **It has no Payouts tool**, and the Payouts API is not in `paypal-rest-api-specifications` for the toolkit. Integration would add a dependency without adding a capability this product needs. |

Additional defects found that were not in the report:

- **D-1 (high).** A late or duplicate `PENDING` webhook can regress a `SUCCESS` payout item:
  `recordPayoutItem` overwrites `payments.status` unconditionally. Out-of-order events are handled in
  `TransactionStore` but not in the authoritative ledger.
- **D-2 (high).** `payout_item_fee` is described by PayPal's own OpenAPI as an **estimate**, populated
  from `PENDING` onward and not necessarily final. The product presents it as the definitive fee.
  Batch-level `fees` are ignored entirely.
- **D-3 (medium).** `reconcilePayPal` marks the whole run failed if one unknown attempt cannot be
  recovered, discarding the evidence already gathered in that run.
- **D-4 (medium).** `executeApprovedPlan` does not write any audit rows to the allocation store for
  per-item outcomes, and its `outcome_unknown` for a normal `PENDING` is exactly F-B.
- **D-5 (medium).** `syncLegacyFromFinancial` runs on read; a receipt's verification state can change
  as a side effect of a `GET`, including a DB write. Reads should not mutate financial evidence.
- **D-6 (low).** `owner_policies.window_hours` is fixed at 168 by the schema, while the product policy
  table also fixes `window_hours = 168` by `CHECK`. The two policy stores can disagree on caps.
- **D-7 (low).** `createPayoutBatch` ignores the documented `402`/`422` distinctions and treats any
  create error as retryable by the caller.

---

## 4. Why these classes of failure exist

1. **Two financial worlds.** The legacy in-memory `Job[]` and the durable `FinancialStore` describe
   the same money. The bridge is a startup migration plus a read-time sync. Every disagreement
   (totals, status, fee) comes from that seam.
2. **No explicit run/batch/item model.** Execution identity (`plan_executions.execution_id`) and
   provider identity (`payout_batch_id`) are stored one-to-one, so a multi-batch run has nowhere to
   put its second batch.
3. **Time is not modelled.** Confirmation is a synchronous loop, so "not yet" and "never" are the
   same state to the caller. There is no scheduled work, so nothing resolves after a restart.
4. **Money is modelled as a number with a label.** One `fee_cents`, one `amount_cents`, one
   `payout_batch_id`. No policy version, no provenance, no distinction between estimate and fact.
5. **The agent is asked to narrate.** The decision variables are pre-computed, the constraints are
   in the prompt instead of in the tool layer, and the trace is text, so neither the model's
   contribution nor its compliance can be measured.

---

## 5. Corrections, dependency order and acceptance criteria

Each item is implemented test-first in this branch. The README and architecture docs are updated in
the same change as the code, so no document can claim behaviour the code does not have.

| Order | Correction | Acceptance criterion |
| --- | --- | --- |
| 1 | Canonical money and fee model (`src/server/money.ts`, `src/server/fees.ts`) | Integer minor units only; fee policy is versioned with source and retrieval date; observed fee and estimated fee are separate facts; no formula is inherited from another PayPal product |
| 2 | Ledger provenance and state machine (`financialStore`) | Seeds cannot be submitted; item status is monotonic over provider timestamps; estimate and provider fee are both retained; every payment keeps job/payment/attempt/sender-batch/batch/item/transaction identity |
| 3 | Asynchronous confirmation (`paymentConfirmation`, `financialPayments`) | `PENDING`/`PROCESSING` is `awaiting_confirmation`, never `outcome_unknown`; bounded exponential backoff with jitter, configurable; restart re-arms durable work; duplicate webhook is a no-op; out-of-order webhook cannot regress a terminal item |
| 4 | Execution runs and multi-batch contract (`planExecution`, routes) | A run of N jobs reports N items with their own batch/item/transaction IDs and a per-item status; partial success is representable; no first-batch aliasing |
| 5 | Provenance and reporting (`reporting`) | Every displayed figure names its origin, environment, window, as-of time, verification state and query; seeds are excluded from all financial totals; the UI states connection status instead of "live" |
| 6 | Agent tools and decision contract (`agentTools`, `agentPlanner`) | Model calls real tools, produces a validated structured decision, cannot invent recipients or change policy, receives no email addresses, and is refused by the server if it breaks a hard constraint |
| 7 | Approval, execution, emergency stop (`routes`, `productRoutes`, `allocationStore`) | Owner can propose → inspect → approve → execute → reconcile in the app; emergency stop persists, is audited, and blocks new submissions under concurrency |
| 8 | Benchmark and ablation (`evaluation/`) | ≥30 scenarios; deterministic, single-shot and tool-using systems scored by an independent validator; results reported as executed or explicitly not executed |

**Non-goal.** No claim of AI superiority is made in this report or in the README unless the benchmark
run in `evidence/evaluation/` supports it. If no Groq key is available in the build environment, the
model-dependent rows are recorded as not executed.

---

## 6. Limitations of this audit

- No PayPal Sandbox credential is available here, so no new provider call can be made from this
  environment. All provider behaviour is verified against the checked-in raw Sandbox artifact, the
  official OpenAPI description, and mocks that reproduce those shapes.
- The original audit document (Sections 7, 8, 10; Blockers A, B, D) is not in the repository and
  cannot be reviewed. That is recorded as a missing input, not filled in by assumption.
- `evidence/` contains historical run artifacts. They are treated as historical evidence and are
  never re-imported into the ledger.


---

## Status of this report

This document was written **before** any code changed. It records what was found
and what was decided, not what was shipped.

What shipped, with file-level decisions, tests and observed results, is in
[`IMPLEMENTATION-LEDGER.md`](IMPLEMENTATION-LEDGER.md). The findings map as
follows:

| Finding here | Implemented as | Tests |
| --- | --- | --- |
| F-A seed data acquiring payment identity | `origin: seed`, `DEMO_RECORD_NOT_PAYABLE`, `payments_origin_insert`, startup bridge deleted | `financialReport`, `ledgerProvenance` |
| F-B "not yet" stored as "unknown" | `awaiting_confirmation` + durable `confirmation_jobs` + sweep | `asyncConfirmation`, `ledgerProvenance` |
| F-C one batch id per run | `execution_runs` with per-item provider identity | `financialReport`, `productExecution` |
| F-D reserved rows seen as reconcilable | reconcilable set narrowed; `reserved` excluded | `ledgerProvenance` |
| D-1 out-of-order provider events | rank-first ordering, timestamp as tie-break | `ledgerProvenance` |
| D-2 fee estimates not retained | `provider_fee_evidence.is_provider_estimate`, `fee_estimates` | `moneyFees`, `financialReport` |
| D-3..D-7 see the ledger | state machine, replay opt-in, report projection, stop, provenance labels | full suite |

Requirements A/B/D remain **unavailable**: the original Section 7/8/10 text is not
in this repository or its history, so nothing here reconstructs it.
