# Settle — payment truth for a small studio's payouts

Settle pays approved work with the PayPal Payouts REST API inside a cap the owner
sets. It is a sandbox-only system: test money, a US sandbox sender, no real money.

This README describes **what the code does now**, how to check each claim, and
what is still unproven. Every number quoted below was produced by a command that
is printed next to it.

- `npm test` → **260 tests, 260 pass, 0 fail**
- `npm --prefix app run build` → production bundle builds
- One checked-in PayPal artifact: `evidence/payouts-first-test/` (batch
  `YFBPVYJBHM9GU`, 2026-11-06, two items, `payout_item_fee` 0.02 + 0.02 = 0.04)
- Everything else in `data/seed.json` is **seed data** and is labelled as such on
  screen and in the database.

Older documents and older claims in git history (for example a list of sandbox
batch ids that are not in this repository) are not evidence. Only artifacts that
are checked into `evidence/` are treated as artifacts.

---

## Guardrails

- **$200 per payment, $1,500 per week combined.** The weekly cap is a 7-day rolling window. The worst case is $1,500 in a week.
- An approval expires after 7 days. A job can only be paid once; a second attempt is blocked as a duplicate.
- Only the studio owner can approve or pay. The owner token guards every money-moving route.
- Every decision is recorded with a reason: who gets paid, who is held, who is blocked, and why.
- **Meera is illustrative, not a real user.** The demo story is a six-person studio that loses three hours every Friday to payouts. No studio owner was interviewed. The demo sender is a US sandbox test account, not a real Indian studio.

## Live sandbox receipts

Every batch below is a real PayPal sandbox run. Each row names the file that records it. Two batch ids that appeared in an earlier draft of this README (FY7MPJGJKTA62, GZ6XT3FLM95QJ) are not listed: no checked-in file records them, so they are cut, not claimed.

| Batch | What it proves | Artifact |
| --- | --- | --- |
| YFBPVYJBHM9GU | Gate-1 re-test, 2026-11-06: 2 jobs paid, $1.00 each, SUCCESS | evidence/payouts-first-test/payout-poll.json |
| 4P79GAKFE3XA4 | Live payout, 2 jobs, $1.00 each, SUCCESS | evidence/payouts/payouts-poll.json |
| RBZ4V8LCSSK5W | Agent loop, 2 jobs (settle-audit-1/2), SUCCESS | evidence/audit/run-output.json |
| JHG24Y874LK58 | Groq agent loop, 2 jobs (settle-groq-1/2), SUCCESS | evidence/audit/run-output-groq.json |
| 85WA4HAMM9QLA | Rehearsal run 1: 3 jobs, $1.00 each, SUCCESS | evidence/rehearsal/batch-check-1.json |
| 43CX2PZFD8RAU | Rehearsal run 2: 3 jobs, $1.00 each, SUCCESS | evidence/rehearsal/batch-check-2.json |
| MKZFSY2ENSC86 | Rehearsal run 3: 3 jobs, $1.00 each, SUCCESS | evidence/rehearsal/batch-check-3.json |
| H5DYE42K9RT7G | Rehearsal run 4: 3 jobs, $1.00 each, SUCCESS | evidence/rehearsal/batch-check-4.json |
| GB736QR4BZJUG | Rehearsal run 5: 3 jobs, $1.00 each, SUCCESS | evidence/rehearsal/batch-check-5.json |

23 sandbox payments, $23.00 in total. The invoice is separate: INV2-QZ27-GV5H-DM37-T8TH, $2.00, SENT (evidence/invoicing/invoice-create.json, invoice-send.json).

Only one raw PayPal payout response is checked in (evidence/payouts-first-test/payout-poll.json, batch YFBPVYJBHM9GU). The other rows are recorded in checked-in run outputs and batch-check files, which name the batch id, the jobs, and the SUCCESS status. That is the evidence; nothing more is claimed.

## 1. What was wrong, and what changed

The forensic report (`docs/FORENSIC-REPORT.md`) found five ways this system
produced a confident, wrong answer. Each one is now closed by a mechanism, not by
a message:

| Failure | What happened before | What happens now |
| --- | --- | --- |
| **F-A: seed data became money** | On startup the server copied every `approval_state: "approved"` seed job into the payment ledger, so a demo row could be reserved and even submitted. | `jobs.origin` is `seed` for every row from `data/seed.json`. The ledger refuses `seed` rows at the database level (`payments_origin_insert` trigger) and at every entry point (`DEMO_RECORD_NOT_PAYABLE`, HTTP 409, zero provider calls). The startup copy loop is deleted. |
| **F-B: "not yet" was stored as "unknown"** | PayPal accepting a batch and PayPal finishing an item were the same state. A timeout after accept became `outcome_unknown` and the payment could only be resolved by a human. | `awaiting_confirmation` is a first-class state with durable `confirmation_jobs`. A background sweep and `POST /api/financial/confirm` resolve it by reading the batch. Only a lost *submission response* is `outcome_unknown`. |
| **F-C: one batch id for the whole run** | The dashboard showed one `payout_batch_id` per run even though the run could span several batches, and a failed second call could be hidden. | Every submission creates an `execution_runs` row before the provider call. Each payment is attached with its own `payout_batch_id`, `payout_item_id`, `transaction_id` and provider status. The run's status is derived (`succeeded`, `partial`, `failed`, `outcome_unknown`) from its items. |
| **F-D: reserved rows looked reconcilable** | Reconciliation walked payments that had not been submitted, producing meaningless reads. | The reconcilable set is `submitted/awaiting_confirmation/pending/unclaimed/onhold/outcome_unknown/reconciliation_required`. `reserved` is excluded. |
| **F-E: two different totals** | "Total paid" summed grid rows (including seeded ones); "rolling spend" summed provider events. Both were real queries, so both looked right. | One projection, `GET /api/financial/report`, defines every figure with its window, origin filter, source and verification note. The dashboard renders those definitions instead of computing its own totals. |

Two more classes were closed at the same time:

- **Ambiguous submission never replayed by default.** `reconcilePayPal` reads by
  batch id. With no batch id it records `AMBIGUOUS_SUBMISSION_WITHOUT_BATCH_ID`
  and leaves the payment alone. A replay happens only when the caller passes
  `idempotentReplay: true`, which is an explicit owner decision, is written to the
  audit trail as `idempotent_replay_attempted` before the request, and uses the
  same `sender_batch_id` PayPal documents as idempotent for 30 days. PayPal's
  duplicate rejection contains a HATEOAS link to the original batch; that link is
  followed instead of asserting a new payout.
- The model proposes; `decide()` and the ledger enforce the caps. The caps and the run budget appear in the model prompt as context, but a model reply cannot raise them, and there is no bypass of the server. Emergency stop is stored in
  `financial_control`, audited, survives restart, and blocks `reservePayment` /
  `beginSubmission` before any provider call.

## 2. Run it

```bash
git clone https://github.com/parvagrwal/Settle.git
cd Settle
bash scripts/cold-start.sh   # installs, builds the dashboard, starts the server on http://localhost:3000
```

No account is needed to look at the dashboard; it opens with seeded demo data. To pay live in the sandbox, copy `.env.example` to `.env`, fill in the PayPal sandbox keys and the owner token, and run the script again.

```bash
npm test                      # node:test suite, no network
npm start                     # server + built dashboard on http://localhost:3000
npm --prefix app run build    # rebuild the dashboard
```

PayPal is optional at startup. Without credentials in `.env` the dashboard still
loads, says "PayPal Sandbox is not connected in this process", and refuses every
submission. `SETTLE_OWNER_TOKEN` guards every money-moving route.

Views: **Operational workspace** (the only screen that can pay),
**Legacy payout workflow** (demonstration grid, read-only for seeded rows),
**Verified transactions**, **Allocation agent**.

## 3. Verify the claims without trusting this README

Each command below is a check you can run yourself.

```bash
# 1. Seeded rows cannot be paid, and the refusal happens before any provider call.
curl -s -X POST localhost:3000/api/approve -H "x-settle-owner-token: $SETTLE_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"job_id":"demo-waiting-1"}'
# -> 409 {"code":"DEMO_RECORD_NOT_PAYABLE", ...}

# 2. Every figure names its origin, window, source and verification.
curl -s localhost:3000/api/financial/report | python3 -m json.tool | head -40

# 3. The grid says what each row is.
curl -s localhost:3000/api/grid | python3 -c \
  "import json,sys;[print(r['job_id'],r['record_origin'],r['status'],'|',r['provenance_label']) for r in json.load(sys.stdin)['rows']]"

# 4. Durable confirmation work is visible and never lost on restart.
curl -s -X POST localhost:3000/api/financial/confirm -H "x-settle-owner-token: $SETTLE_OWNER_TOKEN"
# -> {"checked":n,"confirmed":n,"stillPending":n,"errors":n}

# 5. The emergency stop is stored, audited and enforced.
curl -s -X POST localhost:3000/api/financial/control -H "x-settle-owner-token: $SETTLE_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"emergencyStop":true,"reason":"drill"}'
curl -s -X POST localhost:3000/api/pay -H "x-settle-owner-token: $SETTLE_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"selectedJobIds":["demo-waiting-1"]}'
# -> 409 EMERGENCY_STOP (or DEMO_RECORD_NOT_PAYABLE first, for a seeded row)
```

The tests that pin these behaviours:

| Claim | Test file | Tests |
| --- | --- | --- |
| State vocabulary, allowed transitions, backoff policy | `tests/ledgerProvenance.test.ts`, `tests/moneyFees.test.ts` | 12 + 11 |
| Accepted-not-settled, retry, replay, refusal, stop | `tests/asyncConfirmation.test.ts` | 9 |
| Seed refusal, report semantics, execution runs, partial runs, stop, unknown fee | `tests/financialReport.test.ts` | 8 |
| Workspace run, reject, stop durability, failed item | `tests/productExecution.test.ts` | 6 |
| Existing behaviour, restated against the new contracts | `tests/financialPayments.test.ts`, `tests/financialHttpAdversarial.test.ts`, `tests/pay-invoice.test.ts`, `tests/productApi.test.ts`, `tests/server.test.ts`, `tests/paypalShapeFixes.test.ts` | rest of 260 |

## 4. The payment state machine

Defined in `src/server/paymentState.ts`; the database rejects impossible moves.

```
approved ──reserve──▶ reserved ──begin──▶ submitted ──provider ack──▶ awaiting_confirmation
                                                                        │        │
                                       provider item PENDING/UNCLAIMED ─┘        │
                                                                                 ▼
                              provider_confirmed ◀── item SUCCESS ── (poll/webhook/reconcile)
                                        │
                     returned / reversed / refunded  ◀── later provider fact
failed ◀── definite 4xx refusal            blocked ◀── policy/stop refusal
outcome_unknown ◀── lost submission response (no batch id known)
reconciliation_required ◀── confirmation budget exhausted without a terminal item
```

- **`outcome_unknown` means one thing only**: a submission whose response was
  lost, so the server does not know whether a batch exists. It carries no batch
  id and is never resubmitted automatically.
- **`awaiting_confirmation` is not a failure and not a success.** The batch
  exists, the item has not settled, and durable work is scheduled.
- **Exhaustion is `reconciliation_required`**, not `failed`. A payment that could
  not be read is not a payment that did not happen.
- **Provider facts are ordered by status rank, then timestamp**
  (`PENDING/UNCLAIMED/ONHOLD` = 10, `FAILED/BLOCKED` = 20, `SUCCESS` = 30,
  `RETURNED/REVERSED/REFUNDED` = 40). A webhook `SUCCESS` that shares the stored
  `PENDING` timestamp still wins; ordering by timestamp alone silently dropped it.

Backoff for confirmation: base 2000 ms, ×2, max 60000 ms, 12 attempts, ±20%
jitter (`SETTLE_CONFIRM_*`). The timer in `server.ts` sweeps every 30 s
(`SETTLE_CONFIRM_INTERVAL_MS`).

## 5. Money and caps: lifetime is not rolling

`GET /api/financial/report` returns both, each with its window:

- `lifetimeConfirmedGross` — every stored provider `SUCCESS` item, all time,
  application origin only.
- `rollingWindowSpend` — provider-timestamped `SUCCESS` inside the 168-hour
  window, minus documented returns/reversals. **This is the only figure the cap
  is enforced against.**

They differ whenever a confirmed payout is older than the window. The dashboard
prints both definitions next to the numbers. Exposure (`reserved`, `submitted`,
`awaiting_confirmation`, `pending`, `unclaimed`, `onhold`, `outcome_unknown`,
`reconciliation_required`) counts against the cap so an in-flight payout cannot
be spent twice.

## 6. Fees: an estimate is not a charge

Full policy, citations and the observation that does **not** generalise:
[`docs/FEE-POLICY.md`](docs/FEE-POLICY.md).

- Policy `paypal-us-payouts-api-flat-2026-10` v1: **USD 0.25 flat per payout
  item** for the US Payouts API, from PayPal's published merchant fees page
  (retrieved 2026-11-10). Stored with every payment before submission.
- `payout_item_fee` and the batch `fees` field are **PayPal estimates**, not
  audited costs. They are stored in `provider_fee_evidence` with
  `is_provider_estimate = 1`.
- A missing reported fee produces `consistent: null` and the words "unavailable,
  not zero". It never produces `$0.00`.
- The checked-in sandbox artifact reports `$0.02` on a `$1.00` item. That is an
  observation from one sandbox batch; it is shown as evidence and is not used to
  change the policy or to infer a schedule.
- Recipients receive the full payout amount. The fee is charged to the sender.

## 7. Provenance rules

| Origin | Where it comes from | Counted in totals | Can be paid |
| --- | --- | --- | --- |
| `application` | an owner action on this server | yes, when provider evidence exists | yes |
| `seed` | `data/seed.json` | never | never (409, database trigger) |
| `synthetic` | product demo workspace | never | never |

`record_origin` is set on insert and enforced by
`payments_origin_insert`; a second trigger `payments_no_demo_submit` refuses a
provider attempt for a non-application payment. The four seeded rows that claim a
2026-11-07 batch are shown as `historical_reference`. They are verified by the
checked-in run outputs that record those exact batches and jobs as SUCCESS
(evidence/audit/run-output.json for RBZ4V8LCSSK5W, evidence/audit/run-output-groq.json
for JHG24Y874LK58); the only raw PayPal payout response checked in is
evidence/payouts-first-test/payout-poll.json. See the receipts table above.

## 8. Workspace

`/api/product/*` is the operational surface: owner sign-in (owner token exchanged
for an HttpOnly session), workspace creation, obligations, approve, decline,
pay, reconcile, policy and execution control. Demo and operational data are
separated by database triggers, so a demo obligation can never obtain a payment
identity.

The UI now has a screen for it (**Operational workspace**): sign in, create an
obligation, approve, decline, pay, and see the run id with each provider item id.
Buttons are rendered from server capabilities; when PayPal is not configured or
the emergency stop is engaged, the pay button is disabled and the reason is on
screen. Declining is only possible before approval — once an approval created a
payment identity, the honest way to stop the payment is the emergency stop or the
provider's refusal, and the server says so.

## 9. Honest limitations

- **Sandbox only.** No production credentials, no production verification.
- **The AI claim is unproven.** In the recorded 2026-11-09 comparison all three
  systems tied at **$130**. That result is reported as a tie. There is no
  benchmark evidence that the model is better than the rule-based or manual path,
  and this README does not claim otherwise.
- **The Toolkit is used for one read path, not for payouts.** The verifier's
  Reporting read runs through the Toolkit's `list_transactions` tool. There is
  still no Payouts tool in `paypal/agent-toolkit`, so payouts, invoices, and
  everything that moves money stay direct REST, and this repository does not
  pretend otherwise. The Toolkit's read omits the payer email on payout
  transactions (verified live 2026-11-10, 29 of 70); the verifier's money
  checks do not use it.
- **Requirements A/B/D cannot be quoted.** The original "Sections 7/8/10" text is
  not present anywhere in this repository or its history. They are recorded as
  unavailable rather than reconstructed.
- **Live webhook proof has not been performed end to end**; the webhook path is
  covered by tests with a verification mock.
- **The receipts are listed above.** Nine sandbox batches (23 payments, $23.00) and one sent invoice are recorded in checked-in files; each row names its file. Two batch ids from an earlier draft (FY7MPJGJKTA62, GZ6XT3FLM95QJ) are not listed because no checked-in file records them.
- The interface is English-only and the sender is a US sandbox account; the
  India feasibility screen is in `docs/INDIA-FEASIBILITY.md` and is a screen, not
  a rollout plan.

## 10. Data handling

See [`docs/DATA-HANDLING.md`](docs/DATA-HANDLING.md). Short version: the model
receives job ids, amounts, dates, priorities, the run budget, and the recipient's
email for each job (the email is in the model request because the proposer copies
it there; PayPal needs it in the payout itself, the model does not). No names, no
addresses, no ledger history. Every stored provider payload is retained as evidence in SQLite, and the owner sees it through
the receipt endpoint.

## 11. Map of the code

| File | Role |
| --- | --- |
| `src/server/paymentState.ts` | state vocabulary, transitions, provider status maps, backoff |
| `src/server/financialStore.ts` | SQLite ledger: payments, payout items, fees, execution runs, confirmation jobs, control |
| `src/server/financialPayments.ts` | submit, confirm, reconcile; the only provider-calling module |
| `src/server/financialReport.ts` | the single financial projection |
| `src/server/fees.ts`, `money.ts` | fee policy and integer money arithmetic |
| `src/server/routes.ts` | HTTP API, legacy demonstration grid, financial endpoints |
| `src/server/productRoutes.ts` | operational workspace API |
| `app/src/WorkspaceApp.tsx` | the operational screen |
| `app/src/App.tsx` | demonstration dashboard, report view, result screen |
| `docs/IMPLEMENTATION-LEDGER.md` | per-change record: cause, decision, test, result, risk |

## 12. Older documents

`docs/ARCHITECTURE.md`, `docs/AGENTIC-*.md`, `docs/PRODUCT-*.md` and
`docs/IMPLEMENTATION-EVIDENCE.md` were written before this rebuild. They are kept
for history. Where they contradict this README about payments, provenance or
fees, this README and the tests are the current description.
