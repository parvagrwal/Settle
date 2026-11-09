# Phase 0 — Agentic payment-allocation forensic diagnosis

**Review date:** 2026-11-09  
**Branch:** `arena/39066b83-settle`  
**Gate:** investigation and proposed architecture only; no allocation implementation has been started.

## Executive finding

Settle's central claim is **not technically true today**. The application safely copies approved jobs into PayPal Payouts, but the model does not decide who gets paid, how much, or when. It is a structured transcription step in front of deterministic execution. The rule-based fallback makes the same proposals and automatically pays when the model is missing or fails.

The new transaction ledger improves payment truth; it does not fix allocation intelligence. The required product change is therefore not “more agent tools” or better explanations. It is a new decision problem: coordinate competing approved obligations under changing cash and operational constraints, while deterministic controls protect every entitlement and authorization boundary.

## Scope and repository evidence inspected

- All server, shared, frontend, test, script, configuration, evidence and documentation paths, excluding dependencies/build output.
- Grafted Git history: only `4a384d2` is available locally; earlier commits cannot be reconstructed from this checkout. Existing uncommitted transaction-intelligence changes were included as current state.
- `README.md`, `docs/ARCHITECTURE.md`, prior audit/diagnosis, `data/seed.json` and hackathon source material.
- The AI-removal check from the supplied submission checklist: “Remove AI, it breaks. Remove PayPal, it does nothing.”
- Agent/proposer/fallback: `model.ts`, `groqProposer.ts`, `groqAgent.ts`, `agent.ts`.
- Allocation/control/execution: `decide.ts`, `jobs.ts`, `payouts.ts`, `routes.ts`, `policy.ts`.
- OAuth, UI approval, tests, saved sandbox receipts, CI, scripts and recordings inventory.
- Installed durable webhook/transaction code from the preceding work.

No original pitch-deck asset, product-requirements file beyond the supplied checklists, deployment manifest, demo video or recording is present in the checkout. No database migration for jobs, allocations, approvals or decision history exists. SQLite currently stores verified payment events only.

## 1. Existing architecture

```text
Browser (unauthenticated)
  ├─ POST /api/approve { job_id, optional recipient }
  │    └─ mutates job approval + adds recipient allowlist + memory audit
  └─ POST /api/pay
       └─ routes.ts
            ├─ sums currently paid in-memory jobs as weekly spend
            ├─ groqOrRuleBasedProposer(jobs)
            │    ├─ Groq: copy job IDs, recipients and exact amounts
            │    └─ any absence/error → ruleBasedProposal(jobs)
            ├─ runAgentLoop(proposals)
            │    ├─ decide() each proposal (actor/suspend/approval/amount/
            │    │   recipient/duplicate/weekly cap/per-payment cap)
            │    ├─ exact proposal = approved job amount + recipient
            │    └─ payApprovedJobs(accepted jobs)
            │         ├─ decide() a second time
            │         ├─ POST PayPal Sandbox Payouts batch
            │         ├─ poll batch
            │         └─ mutate in-memory job status/batch ID
            ├─ optional PayPal invoice for successful jobs
            └─ response names model or rule-based proposer

PayPal verified webhook → SQLite immutable event ledger → transaction grid
                         (not connected back to allocation/re-planning)
```

### Actual agent decision flow

1. `/api/pay` passes all in-memory jobs to `groqOrRuleBasedProposer` (`routes.ts:289–295`).
2. With a key, `groqPropose` sends only `jobId`, `recipient`, `amountCents`, and `currency` (`groqProposer.ts:61–66`).
3. Its system prompt explicitly says: “Propose a payment for each approved job listed,” copy all fields exactly, and “You never decide whether a payment happens” (`groqProposer.ts:67–68`).
4. The fallback filters approved/waiting jobs and maps every one to the same exact fields (`model.ts:27–35`).
5. `runAgentLoop` iterates the returned list; it does not select scenarios, call contextual tools, revise a plan, or optimize across jobs (`agent.ts:75–80`).
6. `decide()` accepts/rejects individual requests in sequence. Sequential cap accounting means input order decides which jobs survive a shared cap (`agent.ts:78–108`; `jobs.ts:73–94`).
7. Accepted jobs are sent to PayPal and in-memory state is mutated (`jobs.ts:100–139`).

## 2. Pitch, README and implementation contradiction

| Question | Finding | Source evidence |
|---|---|---|
| What does the pitch promise? | “An AI agent reads approved work, decides who gets paid how much, and pays them with PayPal.” | `README.md:11`; `docs/ARCHITECTURE.md:26–27` |
| What does README later admit? | “It only proposes; it never decides.” | `README.md:44–46` |
| What does the agent actually decide? | Which text proposal to copy for each approved job; no allocation decision. | `groqProposer.ts:61–70` |
| What does deterministic code decide? | Eligibility, exact amount/recipient match, cap acceptance, recipients, duplicate status, batch and resulting status. | `decide.ts:20–69`; `agent.ts:80–153`; `jobs.ts:73–139` |
| Does AI influence amounts? | **No.** Model must copy exact cents; mismatches are rejected. | `groqProposer.ts:34,68`; `agent.ts:123–143` |
| Does AI influence prioritization? | **No meaningful priority input or objective exists.** It could theoretically omit/reorder jobs, but is instructed to include all and no deadline/priority context is supplied. Sequential deterministic cap behavior is unchanged. | `groqProposer.ts:61–70`; `jobs.ts:73–94` |
| Can AI choose between competing jobs? | **Not as a designed, defensible allocation.** There is no available-funds field, competing scenario, trade-off score, or selection contract. | `groqProposer.ts:23–44`; `model.ts:11–19` |
| Can AI respond to financial changes? | **No.** No cash ledger, delayed client receipt, reserve, deadline, failure or changed eligibility context is sent. | `groqProposer.ts:61–66`; `Job` in `jobs.ts:20–32` |
| Are AI decisions recorded? | Proposal source and generic accept/reject audits are recorded in memory; model reasons and raw decisions are not durably attached to an allocation plan. | `audit.ts:29–50`; `rowFromDecision` at `audit.ts:58–90`; `groqAgent.ts:44–52` |
| Same outcomes with AI disabled? | **Yes for valid approved/waiting jobs.** Both proposers emit identical fields; absence/error automatically invokes fallback and payment continues. | `model.ts:27–35`; `groqAgent.ts:29–35,46–52`; `routes.ts:286–319` |

The saved Groq sandbox run proves a model was called before two $1 payouts (`evidence/audit/run-output-groq.txt`). It does **not** prove AI changed or improved an allocation. There is no controlled AI-enabled/AI-disabled comparison.

## 3. AI versus non-AI dependency map

| Capability | AI dependency | Actual owner |
|---|---|---|
| Discover approved jobs | None | `ruleBasedProposal` and route-provided array |
| Determine amount | None; AI forbidden to change it | Approved `Job.amount_cents` |
| Determine recipient | None; AI forbidden to change it | Approved `Job.paypal_email` + allowlist |
| Check approval/caps/duplicates | None | `decide()` |
| Choose priority under scarcity | Missing capability | Incidental array order |
| Compare alternative plans | Missing capability | None |
| Re-plan after events | Missing capability | None |
| Explain trade-offs | Missing capability | Generic rule text only |
| Execute batch | None | Server + PayPal REST |
| Reconcile provider lifecycle | None | Poll + new verified webhook ledger |
| Bill client | None | Deterministic invoicing path |

**AI-removal assessment: FAIL on the AI side.** Removing AI does not break or meaningfully change payment allocation. Removing PayPal returns 503 and prevents execution, so only the PayPal-dependency half is supported. The AI-selects check is only superficially supported: model-originated requests can reach PayPal, but the model is explicitly not the decider and the route is not authenticated. The cap-enforcement check is partially supported by deterministic caps; the per-payment receipt check is weakened by volatile audit state and missing model rationale.

## 4. Root causes

1. **Wrong abstraction:** `Proposer = (jobs) => Proposal[]` models transcription, not context acquisition, alternatives, objective selection, validation and re-planning.
2. **Impoverished domain model:** `Job` has amount/approval/status but no contractual obligation type, due date, priority evidence, outstanding amount, dependency, urgency request or eligibility history.
3. **No financial context:** a hard-coded weekly cap is not available cash. There are no received funds, reserves, committed obligations or delayed receipts.
4. **No plan entity:** there is no allocation plan, scenario set, objective, plan version, approval binding or supersedure relationship.
5. **Execution coupled to proposer:** `/api/pay` asks the model and immediately executes accepted output. Recommendation, validated decision, approval and execution are not separate durable states.
6. **Fallback masks missing AI:** automatic pay on model failure makes availability look like intelligence and defeats the removal experiment.
7. **Observability optimized for receipts, not decisions:** existing audits record rule outcomes, not context snapshot, alternatives, trade-offs, uncertainty, human challenge or reason for re-planning.
8. **No evaluation harness:** tests prove safety rules and provider calls, not comparative allocation quality or incremental AI value.

## 5. Security, reliability and technical debt

### Critical/high

- **No application authentication or RBAC.** `/api/approve` lets any caller approve and optionally replace a recipient; `/api/pay` lets any caller initiate payouts (`routes.ts:248–285,286–319`). `auth.ts` is PayPal OAuth only. `jobToState` hard-codes `actorAuthorized: true` and `systemSuspended: false` (`jobs.ts:42–52`).
- **No usable emergency stop.** Suspended exists only as a pure-function input; no persistent stop control or route sets it.
- **Crash/retry duplicate risk.** Payment batch/request IDs default to fresh time/random values (`payouts.ts:45–47`). Job status changes only after provider response. A crash after PayPal acceptance but before mutation can allow a second attempt. Existing duplicate checks are in-memory status checks.
- **Decision and job history is volatile.** Audit log is an array; jobs and invoiced IDs reset on start. The verified event DB does not persist authorization or allocation decisions.
- **Partial batch/item truth is flattened.** Batch status determines all accepted job statuses (`jobs.ts:127–130`); verified item events are not yet used to reconcile obligations or trigger re-planning.

### Medium

- Rolling-window claims do not match summing all currently paid seeded jobs, without transaction timestamps (`routes.ts:288–291`).
- Model fallback still pays despite comments saying a failed call should “never pay”; actual behavior is fallback payment (`groqAgent.ts:46–52`).
- Model reason is dropped by the `Proposal` boundary and generic audit messages.
- No idempotency record links plan approval → execution request → provider batch/item.
- Agent cannot challenge/reject a proposed plan in the UI; only per-job approval and one pay button exist.
- Tests are strong for deterministic rule precedence and malformed model output but do not cover authorization roles, competing-plan validity, allocation invariants, scenario quality, or AI-removal outcomes.
- Browser E2E remains blocked by missing Chromium libraries; no new browser claim is made.

## 6. Proposed product identity and decision rights

**New one-sentence promise:** Settle helps a studio coordinate competing approved payment obligations as cash and deadlines change: its agent compares defensible allocation scenarios, explains trade-offs, and executes only the plan authorized by the owner through PayPal Sandbox.

### Information classes

- **Eligible job:** validated job record with a known recipient, integer minor-unit amount, eligible state, nonexpired obligation approval, and no conflicting execution.
- **Existing payment obligation:** outstanding contractually owed amount derived from approved obligation minus verified executed allocations. It is not erased by deferral.
- **Mandatory obligation:** amount/timing explicitly required by validated contract or owner instruction. The agent may schedule only within those constraints and must escalate scarcity.
- **Discretionary budget:** validated cleared funds minus mandatory reserves, existing committed executions and mandatory due amounts. A model cannot create or increase it.
- **Discretionary allocation:** owner-authorized timing/priority among eligible obligations where contract permits. Any partial payment leaves an explicit residual obligation; it never reduces entitlement.

### Agent may

- Acquire read-only validated context through typed tools.
- Flag missing/conflicting evidence and exclude ineligible items.
- Propose objectives and compare deterministic candidate scenarios.
- Recommend sequencing, permitted partial schedules, deferral and escalation.
- Explain trade-offs with references to immutable context and scenario IDs.
- Re-plan on material context changes while preserving prior history.
- Request execution of the exact owner-approved plan version.

### Human/owner must

- Create/change obligations and contractual terms; approve recipients and policy.
- Set available funds/reserves or connect an authoritative cash source.
- Approve each plan version, permitted partial schedule, deferral of mandatory obligations, and execution.
- Resume after emergency stop and resolve conflicts/uncertainties.

### Agent is prohibited from

- Inventing entitlement, changing owed totals, recipients, currency, limits, its own permissions or approval state.
- Treating untrusted notes/model text as financial facts or instructions.
- Spending above cleared discretionary budget/caps or executing an unapproved/superseded plan.
- Automatically falling back to payment when AI fails.
- Reversing/cancelling payments autonomously.

### Mandatory escalation

Insufficient funds for mandatory due obligations; ambiguous contract/partial-payment permission; stale/conflicting cash or eligibility data; new recipient; provider timeout with unknown execution outcome; conflicting duplicate records; attempted policy change; emergency stop; or model/tool schema failure.

## 7. Proposed agentic architecture

```text
Authoritative sources
  obligations + approvals + policies + cash events + verified PayPal events
                         ↓
                 Context validation service
          typed snapshot + hashes + staleness/conflict flags
                         ↓
        Deterministic obligation and budget calculator
                         ↓
             Scenario generator / integer optimizer
     full-payment, deadline-first, urgency-aware, permitted-partial,
                 reserve-preserving alternatives
                         ↓
 Agent orchestrator (typed read-only tools, no PayPal credential)
  interpret context → request scenarios → compare trade-offs → select
  recommendation → state uncertainties/change triggers → request re-plan
                         ↓
              Independent allocation validator
  entitlement, eligibility, totals, cash, reserve, caps, duplicates,
  objective/evidence references, plan hash and approval requirement
                         ↓
          Immutable allocation plan + decision evidence (SQLite)
                         ↓
          Owner approve / challenge / reject exact plan version
                         ↓
        Authorized execution service (separate from agent process)
  plan hash + approval + idempotency key + stop/RBAC + spend reservation
                         ↓
                  PayPal Sandbox Payouts
                         ↓
        Verified webhooks + item reconciliation + durable audit
                         ↓
       material change detector → new plan version, never history rewrite
```

### Separation of responsibilities

- **Deterministic code:** money arithmetic, constraints, candidate allocations, objective scores, validation, authorization, idempotency and execution.
- **Agent:** contextual interpretation, relevant scenario requests, evidence-based trade-off analysis, selection among valid alternatives, exception explanation and re-plan orchestration.
- **Human:** contractual/policy authority and execution authorization.
- **PayPal:** sandbox execution and independently verified provider outcome.

AI failure produces a clearly labelled **recommendation unavailable** state. The owner may explicitly choose a deterministic plan; there is no silent autonomous fallback.

## 8. Comparative evaluation protocol (defined before experiments)

### Systems

1. **Current fallback:** approved/waiting array order, full amounts, sequential cap rejection.
2. **AI-assisted:** model chooses among supplied valid scenarios in one pass, without re-plan tools.
3. **Agentic:** typed context tools, scenario comparison, exceptions, material-change re-plan and explanation.

All receive identical versioned scenario fixtures and integer-cent data. Model outputs never determine correctness; independent validators and metric code do.

### Predeclared metrics

| Metric | Method | Desired direction |
|---|---|---|
| Allocation validity | independently valid plans / all plans | higher; hard gate 100% for executed plans |
| Obligation protection | no invented/reduced entitlement; residual amount exact | hard gate 100% |
| Budget utilization | allocated eligible discretionary cents / available cents | higher only when objective supports spending |
| Timeliness | weighted amount settled by due date; overdue weighted amount | higher / lower |
| Objective achievement | declared scenario-specific score computed independently | higher than fixed baseline where contextual objective matters |
| Adaptability | valid changed decision after material counterfactual; unchanged after irrelevant change | context-appropriate |
| Consistency | same deterministic context+objective across repeated runs | stable selected scenario or reported equivalent |
| Latency/cost | measured orchestration duration and model calls | lower, reported rather than hidden |
| Human intervention | escalations required and unnecessary escalations | appropriate, not merely minimized |
| Explanation accuracy | sampled claims with exact evidence reference / all claims | independently checked, target 100% factual references |
| Operational time | observed task completion steps/time | only reported after real workflow study |

No aggregate “AI superiority” claim will be made if results are mixed. Deterministic automation is preferable for fixed full-payment queues, simple cap checks, exact arithmetic and cases with no contextual trade-off.

### Scenario families

Simple full funding; scarcity with competing deadlines; delayed receipt; changed eligibility; urgent owner-authorized request; failed/unclaimed payment; permitted partial schedule; missing/stale data; invalid amounts; prompt injection in job notes; duplicate/concurrent approval; provider timeout; and emergency stop. Each important scenario has a one-condition counterfactual recording context hash, old/new plan, reason, independent validation and outcome delta.

## 9. Implementation sequence after approval

1. Domain schema + durable plans/obligations/contexts/approvals/executions; RBAC and emergency stop; migration tests.
2. Integer obligation/budget calculators + scenario generator + independent validator; unit/property/adversarial tests.
3. Agent typed tools and structured recommendation; no execution credentials; deterministic non-AI plan path requiring explicit selection.
4. Versioned approval and idempotent execution bound to validated plan hash; failure/concurrency/retry tests.
5. Reconciliation triggers re-plan; AG Grid scenario/trade-off/approval workflow and challenge controls.
6. Reproducible three-system evaluation and counterfactual report; only then update product claims.
7. Real-user research and India provider/legal feasibility in parallel as research workstreams; no invented participants or production claims.
8. Browser and live Sandbox proof after environment/credentials are available. Existing blockers remain explicit.

## Approval gate decision requested

Approve the proposed direction and decision rights before major implementation. In particular, confirm that:

1. Deferral/partial allocation preserves residual contractual obligations rather than reducing them.
2. AI failure must not silently execute the deterministic fallback.
3. Every execution is bound to an owner-approved immutable plan version.
4. The agent coordinates priorities; deterministic code remains authoritative for arithmetic and controls.

Until then, current README claims of AI deciding who/how much remain contradicted and the AI-removal check remains failed.
