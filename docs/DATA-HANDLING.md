# Data handling

Scope: what leaves this server, what is stored, and what a model provider can
see. The system is a sandbox for test money; the rules still apply, because the
shape of the data does not change when the money becomes real.

## What the model receives

`src/server/groqAgent.ts` and `src/server/model.ts` build the request. Each
candidate is reduced to:

- an internal `job_id`
- `amountCents`, `currency`
- `due` date (when known)
- `priority`
- the run budget and the remaining cap

The model does **not** receive recipient names, postal addresses, emails,
transaction ids, batch ids, ledger history, audit rows, or the owner token. It
cannot see the per-payment cap as an instruction it can negotiate; it only sees
the budget and returns a selection, and the server enforces the caps itself.

Recipient email addresses are required by PayPal's payload, not by the model.
They are stored in the financial ledger because the provider payload contains
them, and they are shown to the signed-in owner in the receipt view.

## What is stored, and for how long

SQLite (`SETTLE_DB_PATH`, default `data/settle.db`, git-ignored):

| Table | Contents | Why it is retained |
| --- | --- | --- |
| `payments` | job id, recipient email, amount, state, policy version, origin, run id | the authorization record |
| `payout_items` | provider ids, status, timestamps, raw payload | provider evidence; the only basis for "paid" |
| `provider_spend` | provider-timestamped confirmed and returned amounts | rolling cap arithmetic |
| `fee_estimates` | policy id/version/formula/source, amount | what the estimate was based on |
| `provider_fee_evidence` | reported fee, whether PayPal called it an estimate, source ids | never conflated with the estimate |
| `execution_runs`, `execution_run_payments` | run identity and per-item provider ids | answer "what did this run actually do" |
| `confirmation_jobs` | due times, attempt counts, last error | work that must survive a restart |
| `financial_control` | emergency stop and who changed it | a stop that survives a restart |
| `financial_audit` | append-only actor/action/state rows | tamper-evident history (triggers refuse updates and deletes) |

Raw provider payloads are kept because they are evidence. If retention becomes a
requirement, prune `payout_items.raw_json` for items older than the retention
window while keeping the typed columns; nothing in the ledger reads `raw_json`
except the receipt view.

## Secrets

- PayPal client id/secret and the owner token come from `.env` only.
- No secret is returned by any route; `GET /api/jobs`, `/api/grid`,
  `/api/financial/report` and the workspace snapshot contain no credentials.
- The browser receives an HttpOnly session cookie after signing in with the owner
  token; the token itself is never stored server-side in a readable column.
- Logs print token *presence*, never the token value.

## Third parties

| Third party | Data | Purpose |
| --- | --- | --- |
| PayPal (sandbox) | recipient email, amount, currency, sender batch/item ids | execute and verify payouts |
| Groq (optional) | job id, amount, due date, priority, budget | choose which approved jobs to pay |

With no Groq key, the system holds for the owner to select jobs by hand. Nothing
is sent to a model provider in that mode.

## Deletion and demonstration data

The demonstration workspace holds only synthetic records, and the database
triggers refuse to let those records become ledger payments. Deleting
`data/settle.db` removes every stored record; `data/seed.json` is a fixture and
contains no real recipient.
