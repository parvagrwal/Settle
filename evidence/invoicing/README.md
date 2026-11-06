# Invoicing proof

What this folder holds: the raw proof that the client was billed with a
PayPal invoice for the same approved jobs the payout paid.

- `invoice-create.json`: the create reply, invoice ID starting with INV2-,
  status DRAFT, the job IDs, and the total in cents.
- `invoice-send.json`: the send reply, invoice ID starting with INV2-,
  status SENT, the same job IDs.

How it is proved: run `node --test tests/api.test.ts` for the mock tests,
then run `node --experimental-strip-types scripts/run-invoice.ts` for the
live sandbox run. The live run bills the same two jobs the payout paid,
settle-s4-1 and settle-s4-2, $1.00 each, total $2.00.

If the bill fails: the payout still stands. Nothing in invoicing changes a
job, so every payout ID and status stays as it was. The invoice row is
labelled manual, and the owner bills the client by hand.

Sandbox only. Test money, no real money moves. The sender is a US sandbox
test account, not a real Indian studio.

Not run yet. These files appear after the live run.
