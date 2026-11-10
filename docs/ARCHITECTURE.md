# Settle — Architecture and Threat Model

Sandbox only. No live money. Meera is illustrative, not a real user.
Demo sender is a US sandbox test account, not a real Indian studio.
A real Indian studio would still be blocked from sending Payouts in live use.

What to build is set by the product plan. How to build it, in what order, is set by the build plan.
This file is the threat model, written Fri Nov 6, 2026, before any
Payouts code. It does not add a value-moving path, change a cap,
change a precedence label, or change a gate. Only Parv can change those,
by a named decision, recorded in writing.

## 1. The system, in one page

Meera runs a 6-person design studio. Every Friday she loses 3 hours matching
approved work to freelancer invoices and paying them one by one. That 3-hour
total is Illustrative, not a surveyed real user. Per-step times are Unknown.

Settle fixes it in one flow. Meera approves 3 jobs in one click. The agent
reads the approved work, decides who gets paid how much, checks the cap,
and pays them with PayPal. Two payments land now. One waits, because it is
over the cap Meera set. The client is billed at the same time, with a PayPal
invoice for the same work. The AG Studio grid updates live, with the PayPal
payout ID next to every payment.

In one sentence: an AI agent reads approved work, decides who gets paid how
much, and pays them with PayPal, inside a weekly cap the owner sets.

Caps, proposed, to be confirmed in the 2-hour user check: $200 per payment,
$1,500 per week combined across all freelancers, 7-day rolling window,
clock is the PayPal sandbox transaction timestamp, not the demo machine
wall clock, approval expiry 7 days, worst-case exposure $1,500 per week,
printed wherever a cap is shown.

Precedence order, highest first: unauthorised actor, system suspended,
job not approved, zero amount, recipient not allowed, duplicate payout,
window cap exceeded, per-request cap exceeded. Window cap outranks
per-request cap on purpose.

The reference model is `decide(policy, state, request, now)` in
`src/server/decide.ts`, pure, no I/O, no PayPal call, no model call.
It is the ground truth. Every payment path must call it before any
PayPal call. The model never instructs a payment. The decision-rules tests pass,
10 tests, 0 fail, including all 256 combinations of the eight decision
rules, in the repo.

## 2. Roles

| Role | Who | What they can do | What they hold |
|---|---|---|---|
| Owner | Meera | Only she can change the cap, suspend the agent, replace the agent, or extract money. | Her credential lives away from the machine the agent runs on. |
| Constrained actor | AI agent | Exactly one authorised action: request payment for an approved job, within the cap. | Zero balance, zero approvals granted to anyone, never the authority to create money, never the authority to upgrade the rules, never an allowed destination for funds. |
| Submitter and payer | Server | Submits the PayPal call and pays the PayPal fee. | Only a small, bounded float for fees. No authority at all over policy or money. |

Any design requiring the constrained actor to hold funds is not a variant,
it is wrong, and work stops.

The language model enforces nothing, anywhere. It drafts and acts as the
attacked actor, and no client-side check performed by or around it may be
described as safety. Safety lives only at the enforcement point, in
`decide()`, before any PayPal call.

## 3. Invariants — things that must never succeed

1. A payment for a job that is not approved, or whose approval has expired, must never succeed.
2. A payment over $200, or that would take the week over $1,500 combined, must never succeed.
3. A payment to a recipient who is not on the allowlist must never succeed.
4. A payment for a job that has already been paid must never succeed, a duplicate must never pay twice.
5. A payment requested by an unauthorised actor must never succeed.
6. A payment while the system is suspended must never succeed.
7. A payment of zero or a negative amount must never succeed.
8. The constrained actor must never hold a balance, grant an approval, create money, upgrade a rule, or become an allowed destination.
9. A new value-moving path must never be added without Parv's named decision, recorded in writing.
10. A refusal must never disappear. Every refusal leaves a permanent audit row, see Section 6.

If enforcement depends on any application process running, there is no
enforcement. That is what the rejection test in Section 7 proves.

## 4. Value-moving paths — only two

| Path | What moves | Who starts it | Closing mechanism | Proving test |
|---|---|---|---|---|
| Path 1 | Rule-checked Payouts batch, for an approved job, inside the cap, via `POST /v1/payments/payouts`, REST only, NOT in the Agent Toolkit | Agent, through the server, after `decide()` accepts | `decide()` gate before any PayPal call, in `src/server/decide.ts`; allowlist check; duplicate key is job ID, not freelancer plus amount; `sender_batch_id` unique per batch, `"settle-" + Date.now()`; unique `PayPal-Request-Id` header on POSTs, reuse the same value on retries; amounts integer cents in code, dollars as strings in payloads; all items same currency, USD; poll `GET /v1/payments/payouts/{payout_batch_id}` until a terminal status | Decision-rules tests, all 256 combinations plus boundary tests, 10 pass, 0 fail, in `evidence/decide/`; replay test, retry after a 5xx returns the original batch, not a second payment; error-path tests, 401, 403, 400 duplicate, UNCLAIMED, 429, 5xx, each with its named labelled outcome, in `evidence/payouts/` |
| Path 2 | Owner-only extraction, refund, or cancel, by Meera alone | Meera alone, with her credential, away from the agent machine | Owner credential is not on the agent machine; no agent code path calls an extraction, refund, or cancel; no delegated execution | Rejection test, Section 7, attempt 4, owner function signed by the constrained actor must fail; independent check from PayPal reporting, recompute via two independent paths, in `evidence/verifier/` |

Banned, in every implementation: no generic execution call, no
approval-granting, no delegated execution, no upgradeable proxy
indirection, no catch-all receive handler, no approval, authority-setting,
or account-closing delegated call. A proposal to add a new value-moving
path is a stop-and-ask event, not an implementation detail.

No other value-moving path exists in Settle. Invoicing, `POST /v2/invoicing/invoices`
and send, moves a bill to a client, not money out of the studio. It is built
from the same approved-job list as payouts, same job IDs. If invoicing fails,
the payout still stands, and the invoice row is labelled manual. Invoicing
is cut before payout. Reporting, the Toolkit's `list_transactions` tool,
which calls `GET /v1/reporting/transactions`, only reads. It moves no money.
The Toolkit's read omits the payer email on payout transactions (verified
live 2026-11-10, 29 of 70); the verifier's money checks, amount, currency,
direction, and transaction ID, do not use it.

## 5. Threat model — one row per value-moving path per implementation

Implementation in Settle is one server, plus PayPal as the external
money mover. There is no second implementation. Where the plan says
"per implementation", the row below names the server implementation
and the PayPal implementation separately, so a divergence between
them is a bug by definition, not a difference to average away.

Attacker roster, fixed in advance: an injected constrained actor holding
a valid credential; a hostile submitter or relay; a hostile recipient,
asset, or account; a phished owner credential; replay across
implementation, store, deployment, or actor rotation; a wrong clock or
a lying data source.

| # | Attack | Path it targets | How it tries | Closing mechanism | Proving test |
|---|---|---|---|---|---|
| Payment for unapproved work | Injected constrained actor, holding a valid credential, asks for a payment for an unapproved job | Path 1, server | Calls the payout path with a job ID that is not approved, or whose approval expired 7 days ago | `decide()` returns JobNotApproved, highest after UnauthorisedActor and SystemSuspended; no PayPal call is made | decision-rules boundary test, now exactly at expiry is not approved, 1 second before is, passed; rejection test, attempt 3, over-policy operation, must fail |
| Payment over the cap | Injected constrained actor asks for a payment over the cap | Path 1, server | Amount $200.01, or a batch that would take the week over $1,500 | `decide()` returns PerRequestCapExceeded, or WindowCapExceeded, window cap outranks per-request cap on purpose | decision-rules boundary tests, $200.00 accepts, $200.01 is PerRequestCapExceeded, $1,500 exact fill accepts, one cent over is WindowCapExceeded, passed |
| Payment to someone not on the list | Hostile recipient, not on the allowlist, is named as the payee | Path 1, server | Model output, or a tampered job, names a new PayPal email | `decide()` returns RecipientNotAllowed; allowlist is checked in `decide()`, not in the UI; first payment to a new email needs a confirm-once by Meera, see the confirm-once rule for a first payment to a new email | decision-rules precedence pairs, every co-occurring pair returns the higher label, passed; allowlist plus confirm-once test, in `evidence/audit/` |
| Same payment sent twice after an error | Hostile submitter or relay replays the same batch after a 5xx, expecting a double payment | Path 1, PayPal | Replays the same Payouts POST, same `sender_batch_id`, same `PayPal-Request-Id` | PayPal completes a payment only once for a given `sender_batch_id` within 30 days, retry returns the original batch; duplicate key in Settle is job ID, so a second call for the same job returns DuplicatePayout | replay test, in `evidence/payouts/`; duplicate test, in `evidence/decide/` |
| Old approval used after it ran out | Hostile submitter replays an old approval, after its 7-day expiry | Path 1, server | Reuses an approved job ID after `approved_at + 7 days` | `decide()` checks `nowMs >= approvalExpiresAtMs`, returns JobNotApproved; expiry is now greater than or equal to expiry, the instant itself is expired, in the draft mapping, see Section 6, open question on the expired-approval label | decision-rules boundary test, now exactly at expiry is not approved, passed |
| Owner function called with a stolen owner credential | Phished owner credential, used by the constrained actor to call an owner function | Path 2, server and PayPal | Constrained actor signs an owner function, extraction, refund, cancel, or cap change, with a stolen owner credential | Owner credential lives away from the agent machine; agent holds zero owner credentials; owner functions are not reachable from agent code; a cap change, a label change, a gate change, or a $0 rule change needs Parv's named decision, recorded in writing | rejection test, Section 7, attempt 4, owner function signed by the constrained actor must fail, policy reads back unchanged |
| Wrong clock, or a lying data source | Wrong clock, or a lying data source, says the window is new, or the approval is still live | Path 1, server | Demo machine wall clock is set back, or a stored spent total is read instead of recomputed | Clock source is the PayPal sandbox transaction timestamp, not the demo machine wall clock; window rollover is the caller's job, it passes `spentInWindowCents` for the current window, 0 at the first instant of a new window; the independent check recomputes from PayPal Reporting via two independent paths, trusting neither stored value | decision-rules boundary test, new window with spent reset to 0 accepts a previously impossible spend, passed; independent-check sabotage test, in `evidence/verifier/` |
| Model invents an amount, a job, or a recipient | Agent hallucination, model invents an amount, a job, or a recipient | Path 1, server | Model output is the payment instruction, with no rule check between model and money | Rule-based `decide()` runs before any PayPal call, it is the ground truth, not the model output; a hallucinated amount that breaks the cap, matches no approved job, or names an unlisted recipient is rejected with a label and never reaches Payouts | hallucination-rejection tests per label, in `evidence/audit/`; decision-rules tests, all 256 combinations, passed |
| Spam refusals to burn the payer's money | Griefing, spam refusals to burn the payer's bounded float | Path 1, PayPal | Many refused attempts, each costing a PayPal fee or a retry, to burn the small bounded float held by the submitter | Bounded and rate-limited, not eliminated; Payouts POST rate limit 400 per minute, Verified, exceeding is HTTP 429 RATE_LIMIT_REACHED, handle with backoff; refusals are recorded, see Section 6, and the float is bounded by design | error-path test, 429, in `evidence/payouts/`; residual risk, see Section 8 |
| Same job paid twice by two batches at once | Stale approval, or a job paid twice by two batches at once | Path 1, server and PayPal | Two batches, same job, run at the same time, both pass `decide()` before either is recorded as paid | Duplicate key is job ID, not freelancer plus amount; second call returns DuplicatePayout; `sender_item_id` is stored per recipient, reused on retries; poll writes SUCCESS, PENDING, or UNCLAIMED back to the job row, with payout ID | replay and duplicate tests, in `evidence/payouts/`; independent-check recompute, in `evidence/verifier/` |
| Invoice built from a different list than payouts | Invoicing is used to move money, or a payout is billed twice | Path 1, via invoicing | Invoice is built from a different list than payouts, so a job is paid but not billed, or billed but not paid | Same approved-job list drives Payouts and Invoicing, same job IDs, same grid; invoicing failure leaves payout standing, invoice labelled manual | invoicing test, invoice for unapproved jobs is rejected by `decide()`, in `evidence/invoicing/` |
| Grid shows a payment that never landed | Verifier is lied to, or the grid shows a payment that never landed | Path 1, via reporting | Stored value in the app says paid, PayPal says otherwise, grid shows the stored value | The independent check recomputes from PayPal through two independent paths, Reporting via the Toolkit's `list_transactions` tool and Payouts via direct REST `GET /v1/payments/payouts/{id}`, comparing each against the stored copy and against each other, trusting neither stored value; a mismatch is named and displayed as a mismatch, never averaged away | independent-check sabotage test, change exactly one destination via the owner path, the independent check must fail with a precise diff, in `evidence/verifier/` |

A row is closed only by its named test, not by argument. A row with no
test is open, and the task that owns it is not done.

## 6. Load-bearing answers — written, before any enforcement code

Silent guessing on a load-bearing semantic is the one unforgivable error.
These answers are locked. Only Parv can change them, by a named decision,
recorded in writing, with what must be checked again.

### 6.1 Cap: per point, or combined?

Combined. Per-payment cap $200, weekly cap $1,500 combined across all
freelancers, not per freelancer. Worst-case exposure $1,500 per week,
printed wherever a cap is shown.

A batch that would break the week is refused as a week, not as a single
payment. That is why WindowCapExceeded outranks PerRequestCapExceeded
in precedence. A $200.01 payment is PerRequestCapExceeded. A $200
payment that would take the week to $1,500.01 is WindowCapExceeded.
A $1,500 exact fill accepts. One cent over is WindowCapExceeded.

What must re-run if it changes: boundary tests at the cap exactly,
one unit above, and exact fill, the policy file, the worst-case exposure
text wherever a cap is shown, and the demo script, because it names
the caps in words.

### 6.2 Window: fixed, or rolling, and whose clock governs?

Rolling, 7 days. Window is the 7 days ending now, not a calendar week.
Clock source is the PayPal sandbox transaction timestamp, not the demo
machine wall clock. Window rollover is the caller's job: it passes
`spentInWindowCents` for the current window, 0 at the first instant
of a new window.

Approval expiry is 7 days from `approved_at`. Now exactly equal to
expiry is not approved. 1 second before expiry is approved.

Open question, do not guess: an approval that runs out exactly at its
expiry time is treated as not approved. A separate "expired approval"
label is still undecided. Parv decides. If a ninth label is added, the
combination count becomes 512 and the tests must run again.

What must be checked again if it changes: all 256, or 512, combination
tests, plus boundary tests, plus the purity check, inside the repo,
before the Payouts code calls `decide()`. The decision-rules task list
and the product plan must be corrected in the same session, or the
mismatch stays open.

### 6.3 What, exactly, does the actor sign, so a signature cannot replay elsewhere?

Settle has no on-chain signature. The "signature" is the full request
that `decide()` checks, plus the PayPal idempotency keys that stop a
replay. Do not describe it as a cryptographic signature, and do not
claim a blockchain signature exists.

A payment request is authorised only if all of these match, together,
in one request:

- `job_id`, one approved job, approval state approved, `approved_at`
  within 7 days, `nowMs < approvalExpiresAtMs`
- `freelancer_id` and `paypal_email`, on the allowlist
- `amount_cents`, integer cents, greater than 0, less than or equal to
  $200, and `spentInWindowCents + amount_cents` less than or equal to
  $1,500
- `currency`, USD, all items in a batch share one currency
- `actorAuthorized`, true, and `systemSuspended`, false
- `alreadyPaid`, false, for that `job_id`
- `sender_batch_id`, unique per batch, `"settle-" + Date.now()`,
  less than or equal to 256 characters, reused within 30 days rejected
  by PayPal as duplicate, HTTP 400 DUPLICATE_REQUEST_ID, with a link
  to the original batch
- `PayPal-Request-Id`, unique per POST, reuse the same value on retries
- `sender_item_id`, stored per recipient, reused on retries

Tamper with any one field, and the request is a different request:
a different amount hits a cap label, a different recipient hits
RecipientNotAllowed, a different job ID hits JobNotApproved or
DuplicatePayout, a reused `sender_batch_id` hits PayPal's duplicate
rejection, not a second payment. A replay across implementation,
store, deployment, or actor rotation is the same test: the same
`sender_batch_id` and the same `job_id` must not pay twice.

Deadlines are capped relative to current time. A request with no
deadline, or a deadline far in the future, is not accepted. In Settle,
the deadline is the approval expiry, 7 days, plus the PayPal token
expiry, read from `expires_in`, cached, refreshed proactively, never
assumed to be 8 hours.

### 6.4 What, precisely, counts as a recorded refusal?

A refusal is recorded only if all of these exist, together, in one
audit row, and the row is never deleted:

- `audit_id`, unique
- `at`, PayPal sandbox transaction timestamp, not the demo machine wall clock
- `actor`, owner, agent, or submitter, who asked
- `job_id`, which job was refused
- `action`, hold or block, never just "log"
- `reason`, the exact `decide()` label, for example JobNotApproved,
  WindowCapExceeded, PerRequestCapExceeded, RecipientNotAllowed,
  DuplicatePayout, UnauthorisedActor, SystemSuspended, ZeroAmount
- `amount_cents`, the amount that was refused
- `payout_batch_id`, none for a refusal, and `paypal_transaction_id`,
  none for a refusal, both written as none, not omitted
- The same refusal is shown in the AG Grid row for that job, with the
  label and the reason, so a judge can see it on screen, not only in
  a log file

A console log line is not a recorded refusal. A spoken "no" in a demo
is not a recorded refusal. A refusal that is not in the audit log and
not in the grid did not happen, for grading purposes.

## 7. Rejection test — with all application processes stopped

Goal, in one line: prove enforcement does not depend on any application
process running.

Procedure, run in `~/settle`, with no server running, no app process
on PORT 3000, no PayPal call that moves money:

1. Record the policy before the test. Save the hash of
   `src/server/policy.ts` and `src/server/decide.ts`, and the caps
   $200 and $1,500, in `evidence/threat-model/rejection-test-output.txt`.
2. Attempt 1, plain native transfer by the constrained actor:
   call `decide()` with `actorAuthorized` false, an approved job,
   $100, an allowlisted recipient. Expected: reject, UnauthorisedActor,
   no PayPal call.
3. Attempt 2, plain asset transfer by the constrained actor:
   call `decide()` with an approved job, $100, a recipient who is
   NOT on the allowlist. Expected: reject, RecipientNotAllowed,
   no PayPal call.
4. Attempt 3, over-policy operation by the constrained actor:
   call `decide()` with an approved job, $200.01, and with a second
   call, $200 that would take the week over $1,500. Expected:
   reject, PerRequestCapExceeded, then WindowCapExceeded, no PayPal call.
5. Attempt 4, owner function signed by the constrained actor:
   call `decide()` with a request to change the cap, or to extract
   money, as the constrained actor. In Settle, there is no such
   function in `decide()`, and no agent code path calls an extraction,
   refund, or cancel. Expected: no owner function is reachable, the
   request is rejected as UnauthorisedActor, and no policy file changes.
6. Record the policy after the test. Save the hash of
   `src/server/policy.ts` and `src/server/decide.ts` again.
   Expected: policy reads back unchanged, hash before equals hash after,
   caps still $200 and $1,500.

Pass is all four attempts fail, and policy reads back unchanged.
Fail is any one attempt succeeds, or policy changes, or a PayPal call
is made. If any attempt succeeds, work stops, the item is written down
first, and Parv is asked one sharp question.

The test in this pack is `tests/rejection.test.ts`, run with
`node --test tests/rejection.test.ts`, no server, no PayPal, no money
moved. It checks attempts 1 to 4 at the `decide()` level, and checks
policy is unchanged by deep-equal, not by argument. Run it with
`scripts/rejection-test.sh`, which saves the output to
`evidence/threat-model/rejection-test-output.txt`. That output is the
evidence for the rejection test. Do NOT fake a run. If the script has not been run
in the repo, the rejection test stays "not run yet".

## 8. Residual risks — documented, never hidden

- Griefing can spam refusals to burn the payer's bounded float.
  Bounded and rate-limited, not eliminated. Payouts POST rate limit
  400 per minute, Verified, exceeding is HTTP 429 RATE_LIMIT_REACHED.
- Owner credential compromise is out of scope by custody design.
  Meera's credential lives away from the agent machine. If it is
  compromised, the agent cannot stop it, and the plan does not claim
  otherwise.
- Cross-implementation actions needing two transactions are not atomic,
  with a measured gap. Payouts and invoicing are two PayPal calls.
  If invoicing fails, the payout still stands, and the invoice row is
  labelled manual. That is a named state, not a hidden failure.
- Fixed windows permit a boundary burst up to twice the window cap.
  Settle uses a rolling 7-day window, not a fixed window, to reduce
  this, but a burst at a window edge is still possible in theory.
  The independent check recomputes the window from PayPal Reporting, and the
  worst-case exposure $1,500/week is printed wherever a cap is shown.
- Per-point budgets sum, so worst-case exposure is points times
  per-point cap, printed wherever the cap is displayed. Settle uses a
  combined weekly cap, not per-point, so the worst case is $1,500/week,
  not $200 times the number of freelancers.
- PayPal sandbox rate limits other than Payouts POST 400 per minute
  are Unknown. Do not invent numbers.
- Toolkit total "31 tools" is Inferred, re-count at build time, one
  snapshot counted 26. Name only the tools Settle uses.
- Model provider, free-tier limit, and price are Unknown. Verify on
  the official pricing page before the brief names them.
- No real studio owner has been talked to yet. Caps are proposed.
  Say that honestly to judges.

## 9. What this file does not do

This file does not write enforcement code. That is the Payouts
integration. This file does not write the independent check from PayPal
reporting. This file does not write the audit trail and cap check.
This file does not build the dashboard.

If the Payouts integration, the independent check, or the audit trail
cannot enforce a row in Section 5, the row stays open, the task that owns
it is not done, and the mismatch goes in writing with a stable ID, never
resolved silently.
