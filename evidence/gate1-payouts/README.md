# evidence/gate1-payouts/

Save here, per task, command + raw output + receipt. Nothing ticked without all three.

- `token-response.json` — raw token reply. Holds an access token. Do NOT commit, do NOT paste in chat. Gitignored.
- `payout-create.json` — raw POST /v1/payments/payouts reply. Must contain `payout_batch_id` and `batch_status`.
- `payout-poll.json` — raw GET /v1/payments/payouts/{payout_batch_id} reply, after ~1 min. Pass = SUCCESS.

Gate 1 verdict, write it in the tracker S1.6, pass / fail, plus error code only: 401, 403, or 400 duplicate. 401 = fix credentials, re-run once, NOT a fail. 403 = real fail, flip to KeepSub tonight. 400 duplicate = fresh BATCH_ID, re-run.
