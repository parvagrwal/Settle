# Verifier evidence

The grid is recomputed from PayPal, not from the app's own memory.
Two independent PayPal reads, plus the stored copy the payout recorded.

- `recompute.json` — the stored rows, the Reporting reply, the Payouts
  batch reply, the verifier result, and the code hashes, all in one file.
- `verifier-output.txt` — the printed lines from the live run.
- `code-hashes.json` — the hashes of the decision and policy files at
  the last run. A later run compares against these. If a file changed,
  the verifier fails the code identity check.

What a match means: the stored copy, Reporting, and Payouts all agree
on who was paid, how much, in what currency, and the PayPal transaction
ID for each payment.

What a drift means: one of the three disagrees. The output names the
job, the field, and both values. Reporting can lag behind Payouts by
hours, so a drift that says a transaction is not found in Reporting
yet is a real finding. Re-run later to see if Reporting has caught up.
A drift is never averaged away and never passed silently.
