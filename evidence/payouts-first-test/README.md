# evidence/payouts-first-test/

Save here, per task, command + raw output + receipt. Nothing is done without all three.

- `token-response.json` — raw token reply. Holds an access token. Do NOT commit, do NOT paste in a message. Gitignored.
- `payout-create.json` — raw POST /v1/payments/payouts reply. Must contain `payout_batch_id` and `batch_status`.
- `payout-poll.json` — raw GET /v1/payments/payouts/{payout_batch_id} reply, after ~1 min. Pass = SUCCESS.

First sandbox Payouts test, result: pass or fail, plus error code only: 401, 403, or 400 duplicate. 401 = fix credentials, re-run once, NOT a fail. 403 means the sender is not allowed to send payouts. 400 duplicate = fresh BATCH_ID, re-run.
