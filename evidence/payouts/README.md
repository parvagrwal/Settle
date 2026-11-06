# Evidence — S4 Payouts integration

Files in this folder:
- `README.md` — this file
- `s4-create.json` — live Payouts create result, from `scripts/run-payout.ts`,
  payout_batch_id, batch_status, sender_batch_id, jobs. Created by the script.
- `s4-poll.json` — live Payouts poll result, payout_batch_id, batch_status.
  Created by the script.

Mock tests, no live PayPal, no money moved:
- `tests/api.test.ts`, run with `node --test tests/api.test.ts`
- Pass: 12 tests pass, 0 fail, in the repo run. See the test output in chat.

Live test, sandbox only, $1 x 2:
- Run: `node --experimental-strip-types scripts/run-payout.ts`
- Pass: payout_batch_id present, poll shows SUCCESS.
- UNCLAIMED means the receiver is not a sandbox account, swap the email
  and re-run with a fresh batch. 403 PAYOUT_NOT_AVAILABLE means the sender
  country is not allowed, use the US sandbox app, see Gate 1.
- Never paste a Client Secret or an access token in chat. Never commit `.env`.
