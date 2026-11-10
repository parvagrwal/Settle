# Implementation ledger

One row per behaviour change: file, root cause, decision, tests written, result
actually observed, evidence, and what is still risky. Commands were run from the
repository root on 2026-11-10.

Test totals quoted here are from the full run:

```
npm test  ->  # tests 260   # pass 260   # fail 0
npm --prefix app run build -> ✓ built
```

---

## 1. Canonical payment state

- **Files:** `src/server/paymentState.ts` (new), `src/server/financialStore.ts`
- **Root cause:** one state string carried four different meanings. "Unknown"
  covered a lost response, a batch PayPal had accepted, a batch still processing,
  and an abandoned retry, so every consumer guessed.
- **Decision:** a closed vocabulary — `approved, reserved, submitted,
  awaiting_confirmation, pending, unclaimed, onhold, provider_confirmed, failed,
  blocked, returned, reversed, refunded, outcome_unknown,
  reconciliation_required` — with explicit terminal/in-flight/ambiguous/exposure
  sets and an allowed-transition table enforced by the store. Provider item and
  batch statuses are mapped in one place.
- **Tests:** `tests/ledgerProvenance.test.ts`, `tests/asyncConfirmation.test.ts`
- **Result:** 12/12 and 9/9 pass.
- **Evidence:** `src/server/paymentState.ts`; `payments` CHECK constraint.
- **Risk:** the vocabulary is wider than the UI; a state added later must be added
  to `publicStateLabel` and to the report projection or it will render raw.

## 2. Durable confirmation instead of "unknown"

- **Files:** `src/server/financialStore.ts` (`confirmation_jobs`, `scheduleConfirmation`,
  `listDueConfirmations`, `recordConfirmationFailure`, `rearmConfirmations`),
  `src/server/financialPayments.ts` (`confirmDuePayments`), `src/server/server.ts`
  (restart re-arm + 30 s sweep)
- **Root cause:** after a create succeeded, the only follow-up was a request-scoped
  poll. If that poll failed, the payment became `outcome_unknown`, which needs a
  human even though the batch id was known and the batch was fine.
- **Decision:** a provider-accepted batch is `awaiting_confirmation` with a
  durable job. Reads are retried with exponential backoff; exhaustion becomes
  `reconciliation_required`. A read failure never marks a payment failed.
- **Tests:** `tests/asyncConfirmation.test.ts` (poll failure after batch id →
  retry work and exactly one POST; still-processing is rescheduled not failed),
  `tests/ledgerProvenance.test.ts` (restart re-arm is idempotent).
- **Result:** pass.
- **Evidence:** `confirmDuePayments`, `POST /api/financial/confirm`.
- **Risk:** the sweep is in-process. Two server processes on the same database
  would both read the same job; the job row is idempotent for reads but attempt
  counters could interleave. Single-process deployment is assumed.

## 3. Ambiguous submission is never replayed automatically

- **Files:** `src/server/financialPayments.ts` (`reconcilePayPal`),
  `src/server/routes.ts`, `src/server/productRoutes.ts`
- **Root cause:** reconciliation used to POST the same `sender_batch_id` by
  default. That is a write hidden inside a read, and it is the one action that can
  create a second payout if an assumption is wrong.
- **Decision:** with no batch id, record `AMBIGUOUS_SUBMISSION_WITHOUT_BATCH_ID`
  and stop. A replay requires `idempotentReplay: true`, is audited as
  `idempotent_replay_attempted` *before* the request, and follows the HATEOAS link
  in PayPal's duplicate rejection to the original batch.
- **Tests:** `tests/financialPayments.test.ts` ("recovers attempt without batch ID
  via sender_batch_id duplicate link"), `tests/financialHttpAdversarial.test.ts`
  (default reconcile records a discrepancy and moves no money; explicit replay
  recovers without a second batch), `tests/asyncConfirmation.test.ts`.
- **Result:** pass. The adversarial test asserts the default call returns
  `itemsRecorded: 0` and leaves `activeReservationsCents` unchanged.
- **Evidence:** API responses include `idempotentReplay` so a caller can see which
  mode ran.
- **Risk:** the replay probe is still a POST. It is only safe because PayPal
  documents sender-id uniqueness for 30 days; beyond that window the probe would
  create a new batch. The audit row is the only guard, so the UI keeps replay off
  a normal button path.

## 4. Seed rows can never become money

- **Files:** `src/server/seed.ts`, `src/server/jobs.ts`, `data/seed.json`,
  `src/server/financialStore.ts` (triggers and guards), `src/server/routes.ts`
  (startup bridge deleted), `src/server/productStore.ts` (already had triggers)
- **Root cause:** `createSettleServer` copied every `approval_state: "approved"`
  job into the ledger at startup. Seeded rows therefore had payment identities,
  could be reserved, and a click could submit them.
- **Decision:** `origin: "seed"` on every seed row; approval and payment refuse
  them with `DEMO_RECORD_NOT_PAYABLE` (HTTP 409) before any provider call; the
  database refuses the insert (`payments_origin_insert`) and the submission
  (`payments_no_demo_submit`). The four rows claiming a past batch are shown as
  `historical_reference` with a label stating no artifact verifies them.
- **Tests:** `tests/financialReport.test.ts` (approve and pay both 409, zero
  POSTs, grid labels), `tests/ledgerProvenance.test.ts` (database-level refusal),
  restated legacy tests in `tests/server.test.ts`, `tests/pay-invoice.test.ts`,
  `tests/productApi.test.ts`, `tests/financialHttpAdversarial.test.ts`.
- **Result:** pass. The live server shows eight seed rows, all `record_origin:
  seed`, and `lifetimeConfirmedGross: 0`.
- **Evidence:** `curl /api/grid`, `curl /api/financial/report` output in the
  README.
- **Risk:** tests that used to exercise payments through seed rows now use
  `tests/helpers/payableJobs.ts`, which constructs application-origin fixtures.
  That helper is test-only; no production path creates application origin without
  an owner action.

## 5. Execution runs replace "one batch id for the run"

- **Files:** `src/server/financialStore.ts` (`execution_runs`,
  `execution_run_payments`, `attachPaymentToRun`, `finishExecutionRun`,
  `summarizeRun`), `src/server/routes.ts`, `src/server/productRoutes.ts`
- **Root cause:** a run's single `payout_batch_id` was whichever batch happened to
  be first, so a partial run looked like one batch and a failed second submission
  could be invisible.
- **Decision:** a run row exists before the first provider call; each payment is
  attached with its own provider ids; the run status is derived from its items
  (`succeeded`, `partial`, `failed`, `outcome_unknown`) and `partial` is explicit.
- **Tests:** `tests/financialReport.test.ts` (two items → two batches, each with
  one item; partial run with a FAILED item), `tests/productExecution.test.ts`.
- **Result:** pass.
- **Risk:** `finishExecutionRun` refuses a second close. A route that throws
  before it closes leaves the run `running`; `getExecutionRun` derives a status
  for a `running` row, so the display is still truthful, but the stored row is not
  closed until the next attempt.

## 6. Provider refusals are visible, not swallowed

- **Files:** `src/server/routes.ts`
- **Root cause:** the agent loop returned only policy rejections. A job whose
  payout item came back `FAILED` appeared in neither `accepted` nor `rejected`, so
  a failed payout looked like a job that was never selected.
- **Decision:** provider refusals are collected with a `PROVIDER_ITEM_*` label,
  merged into `rejected`, and written to the audit trail.
- **Tests:** `tests/financialReport.test.ts` (partial run asserts the refused job
  appears with the provider status).
- **Result:** pass.
- **Risk:** the legacy response now has two rejection shapes (`label` from the
  policy, `PROVIDER_ITEM_*` from the provider). The UI prints the label verbatim,
  so nothing is hidden, but a consumer that keys on `label` must expect both.

## 7. One financial projection

- **Files:** `src/server/financialReport.ts` (new), `src/server/routes.ts`
  (`GET /api/financial/report`), `app/src/App.tsx`, `app/src/FinancialControls.tsx`
- **Root cause:** the dashboard summed grid rows for "total paid" and ledger rows
  for "rolling spend". Both queries were correct; the labels were not comparable,
  and seeded rows leaked into the first.
- **Decision:** one projection where every metric carries `definition`, `window`,
  `includes`, `source` and `verification`. The dashboard renders those strings
  next to the numbers. Lifetime and rolling are shown side by side with an
  explanation of why they differ.
- **Tests:** `tests/financialReport.test.ts` (8 tests: seed exclusion, lifetime vs
  rolling across an 8-day-old confirmation, fee totals, unknown fee, restart).
- **Result:** pass.
- **Evidence:** `curl /api/financial/report`.
- **Risk:** `buildFinancialReport` runs several aggregate queries per poll (5 s).
  At this data size it is microseconds; at scale it would need caching.

## 8. Fees: estimate and evidence, never one number

- **Files:** `src/server/fees.ts`, `src/server/money.ts`,
  `src/server/financialStore.ts` (`fee_estimates`, `provider_fee_evidence`,
  `getFeeRecord`), `tests/moneyFees.test.ts`
- **Root cause:** the dashboard showed `payout_item_fee` as "actual PayPal fee"
  and, separately, would have shown a generic formula as if it were a charge.
  A missing fee rendered as `$0.00`.
- **Decision:** a versioned policy (`paypal-us-payouts-api-flat-2026-10`, 25¢ per
  item) is stored before submission; provider amounts are stored as PayPal
  *estimates*; a missing fee yields `consistent: null` and explicit "unavailable,
  not zero" wording. The 2¢ sandbox observation is retained as evidence and does
  not change the policy.
- **Tests:** `tests/moneyFees.test.ts` (11), fee assertions in
  `tests/financialReport.test.ts` and `tests/productExecution.test.ts`.
- **Result:** pass.
- **Risk:** only US/USD is modelled; any other combination must add a cited policy
  or the system must refuse to estimate. `docs/FEE-POLICY.md` records this.

## 9. Owner control that survives a restart

- **Files:** `src/server/financialStore.ts` (`financial_control`,
  `setEmergencyStop`, `isEmergencyStopped`, `getControlState`), routes
  `/api/financial/control`, `/api/product/workspaces/:id/control`,
  `app/src/FinancialControls.tsx`, `app/src/WorkspaceApp.tsx`
- **Root cause:** there was no way to stop a run except by not clicking. A stale
  approval or a compromised model selection had no kill switch.
- **Decision:** a durable, owner-only, audited stop that blocks `reservePayment`
  and `beginSubmission` before any provider call and is surfaced in capabilities
  so the UI disables Pay with the reason.
- **Tests:** `tests/financialReport.test.ts` (409 + zero provider calls + clear),
  `tests/productExecution.test.ts` (durability across reopen, demo refusal).
- **Result:** pass.
- **Evidence:** `curl /api/financial/control`.
- **Risk:** the stop is global, not per workspace. That is deliberate for a
  single-owner deployment and would need rework for tenancy.

## 10. Operational workspace screen

- **Files:** `app/src/WorkspaceApp.tsx` (new), `app/src/productApi.ts`,
  `app/src/App.tsx`
- **Root cause:** `/api/product/*` had a client but no screen. The only UI was the
  demonstration dashboard, so the product's real path could not be exercised by a
  user at all.
- **Decision:** a screen driven by the server snapshot: capabilities decide which
  buttons exist, the provenance notice is always visible, an obligation can be
  created, approved, declined (before approval), paid, and inspected per item with
  the execution run id and the separated fee facts.
- **Tests:** covered at the API layer by `tests/productExecution.test.ts`; the
  build is verified with `npm --prefix app run build`. There is no browser test
  for this screen.
- **Result:** builds; pay/reject/control verified over HTTP.
- **Risk:** no E2E coverage of the React screen, and no loading/empty state
  beyond the ones written.

## 11. Non-changes, deliberately

- **`src/server/reporting.ts` was not replaced.** It is PayPal's Reporting API
  client used by the verifier. The new projection lives in
  `financialReport.ts`; an early attempt to overwrite `reporting.ts` broke
  `tests/check-batch.test.ts` and `tests/verifier.test.ts`, which is why the file
  was restored and the new module renamed.
- **The legacy `/api/pay` path was kept** for application-origin jobs, because it
  is the agent-loop demonstration and it is now provably unable to pay a seed row.
  `pay-invoice` and `server` tests still cover it with application fixtures.
- **`paypal/agent-toolkit` is not used for payouts.** It has no Payouts tool, so
  adding it would be a false claim.
- **No benchmark was invented.** The 2026-11-09 three-way tie at $130 stands as the
  recorded result.

## 12. Remaining risks, ranked

1. **No live end-to-end run against PayPal in this session.** Every provider
   interaction is exercised against mocks and recorded shapes. A real sandbox run
   with the owner token and live credentials is still the strongest proof and has
   not been done here.
2. **Single-process assumption** for the confirmation sweep and the global stop.
3. **No browser test** for the operational screen.
4. **Replay probe** is safe only inside PayPal's documented 30-day idempotency
   window.
5. **Fee policy coverage** is US/USD only.
6. **Requirements A/B/D** remain unavailable; nothing was reconstructed.
