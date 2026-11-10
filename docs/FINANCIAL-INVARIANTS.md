# Financial invariants

Formalized 2026-11-10 from the behaviour the ledger already demonstrated, so
that every future change is tested against an explicit contract instead of an
implied one. Each invariant names its enforcement point and its tests.

| # | Invariant | Enforced by | Tested by |
|---|-----------|-------------|-----------|
| I1 | A job can never hold more than one payment identity, and therefore never more than one successful payment. | `payments.job_id UNIQUE`, `payments.idempotency_key UNIQUE`, `approvePayment` refusal | `financialInvariants.property.test.ts` (I1), `financialStore.test.ts`, `financialHttpAdversarial.test.ts` |
| I2 | Concurrent or repeated payment commands cannot bypass duplicate protection. | `decide()` DuplicatePayout; `reservePayment`/`beginSubmission` single-attempt rows; provider `sender_batch_id` idempotency | `hardening.test.ts` (A), adversarial concurrency tests, property test I2 |
| I3 | Committed spend plus active reservations can never exceed the owner's rolling cap. | `reservePayment` inside one `BEGIN IMMEDIATE` transaction against `getCapSummary` | property test I3, `financialStore.test.ts`, adversarial `[200,409]` races |
| I4 | Ambiguous payment outcomes retain their reservations. | `outcome_unknown` ∈ `EXPOSURE_STATES`; no release path from ambiguity except reconciliation | `asyncConfirmation.test.ts`, `financialHttpAdversarial.test.ts` |
| I5 | A reservation is released only by an explicit safe transition (back to `approved`, or forward via provider evidence). | `paymentState.ts` transition table | `financialStore.test.ts`, `paymentState` transition tests |
| I6 | Reconciliation cannot silently overwrite authoritative history: late or conflicting provider events are ignored-with-audit or recorded as discrepancies. | `recordPayoutItem` rank/time rules, `reconciliation_discrepancies` | `transactionStore.test.ts`, `financialPayments.test.ts` |
| I7 | Every financial transition is traceable: `financial_audit` is append-only (UPDATE/DELETE raise), and the legacy audit log is equally immutable and now durable. | SQLite triggers on `financial_audit` and `legacy_audit` | `financialStore.test.ts`, `hardening.test.ts` (C) |
| I8 | Every policy decision pins the policy version that was active; history never re-labels itself after a policy change. | `payments.policy_version`, `owner_policies` append-only versioning | property test I8, `hardening.test.ts` (I) |
| I9 | Demo/seeded records can never contaminate operational financial calculations. | `record_origin` checks in `reservePayment`/`beginSubmission`, `DEMO_RECORD_NOT_PAYABLE` | `ledgerProvenance.test.ts`, `financialReport.test.ts` |
| I10 | A failed payment can never be represented as successful. FAILED/BLOCKED/RETURNED/REVERSED/REFUNDED never map to `provider_confirmed`, and unknown provider statuses are refused outright. | `PROVIDER_ITEM_STATE` whitelist, `recordPayoutItem` status refusal | property test I10, `productExecution.test.ts` |

## Provider state → financial exposure policy

A payment must not escape the cap arithmetic merely because it is not yet
marked paid. The single source of truth is `EXPOSURE_STATES` in
`src/server/paymentState.ts`, and `getCapSummary` consumes it directly
(fixed 2026-11-10: `awaiting_confirmation` and `reconciliation_required`
previously escaped the reservation sum).

| Provider / internal state | Meaning | Exposure treatment |
|---|---|---|
| `reserved`, `submitted`, `awaiting_confirmation` | money may be moving | counts as active exposure |
| PENDING → `pending` | item accepted, funds not credited | counts as active exposure |
| UNCLAIMED → `unclaimed` | recipient has no account yet (auto-returns ~30 days) | counts as active exposure |
| ONHOLD → `onhold` | item held for review | counts as active exposure |
| SUCCESS → `provider_confirmed` | funds delivered | confirmed spend (`provider_spend` SUCCESS evidence inside the rolling window) |
| FAILED / BLOCKED → `failed` / `blocked` | obligation not met | no exposure; failure recorded; never spend |
| RETURNED / REVERSED / REFUNDED | money came back after success | windowed adjustment credited against confirmed spend |
| `outcome_unknown`, `reconciliation_required` | unresolved | counts as active exposure until reconciled |

Unknown or future provider statuses are refused by `recordPayoutItem`
(`unsupported provider item status`), producing a discrepancy path rather
than a guessed classification.

## Audit event semantics (legacy log)

The legacy audit log (`/api/audit`, table `legacy_audit`) distinguishes:

- `accepted` — authorization passed (owner approval or policy check). Never
  implies provider success.
- `rejected` — a policy refusal, including DuplicatePayout commands. A
  rejected duplicate never alters the paid row (Invariant I2).
- `provider_failed` — PayPal refused or failed an item *after* authorization
  passed. Kept distinct from `rejected` so authorization and execution can
  never be confused, and appended after the original `accepted` row, which is
  never rewritten.
- `paid` — provider-confirmed execution.
- `held` — held for the owner (run budget, manual selection).
- `invoiced` — invoicing evidence.

The durable `financial_audit` table carries the fine-grained ledger
transitions (`payment_approved`, `payment_reserved`, `payment_submitted`,
`payment_awaiting_confirmation`, `payment_submission_refused`,
`provider_item_updated`, `reconciliation_discrepancy`, `policy_changed`,
`emergency_stopped`, …) with actor, previous/new state, correlation id and
timestamp, protected by immutability triggers.
