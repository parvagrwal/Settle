# Practice runs — how to run one

Five practice runs of the demo, one after another, each timed. Each run starts the server fresh, pays the approved jobs, and records every ID. Sandbox only. Test money, no real money moves.

## Before the first run

- Apply the labels pack (unzip it into the project), rebuild, and make sure the grid fix is in place. The runs must be on the final code.
- Stop the old server if it is running.
- Local `.env` must have the PayPal sandbox keys and the Groq key. If the Groq key is missing, the built-in proposer takes over and says so on screen. Either way, write down which proposer ran.

## Time budget

15 minutes per run. Start the timer when the server says it is paying in sandbox. Stop it when the batch check finishes. The 15 minutes is a proposed budget, not a rule from the plan: the whole task has 3 hours in total. If a run takes longer, write down why, do not hide it.

## Steps for each run

1. Start fresh: `bash scripts/cold-start.sh`. This resets the demo jobs to 8 rows. Start the timer when the server prints that paying is on in sandbox.
2. Open http://localhost:3000/ and hard-refresh (Ctrl+Shift+R). Check the grid shows 8 rows.
3. Approve the not-approved job (`demo-approve-1`) in the dashboard.
4. Click Pay approved jobs. Wait for the result screen. Write down the payout batch ID and its status, which jobs were paid, and which were held or blocked and why.
5. Check the batch: `node --experimental-strip-types scripts/check-batch.ts <payout_batch_id>`. Write down each item's transaction ID. Keep the JSON file it writes. If the script file is not in your folder yet, do the pay run now and run this step when the script pack arrives.
6. The invoice: there is one real sent invoice, `INV2-QZ27-GV5H-DM37-T8TH`, $2.00, sent earlier. Write it down in the report. Do NOT run the invoice script again. It bills the same two old jobs again.
7. Stop the timer. Fill in the run report (`run-1.md` and so on). If anything failed, write down the exact error and what you did, word for word.

## What a good run looks like

- Paid: 3 jobs, $1.00 each — the two waiting jobs and the job you approved in step 3.
- Held: 1 job, $250.00, over the $200 per-payment cap, waiting for the owner.
- Blocked: 4 jobs, already paid in earlier runs, refused as duplicates.
- Batch status: SUCCESS.
- Batch check: all 3 items found, each with a transaction ID.

If the numbers differ, the run is not good. Write down what differed and stop.

## If something fails

- Login failed (401): fix the keys and run once more. That is not a failed run.
- Payouts not allowed (403): stop the run and write down the exact error. That is a real failure.
- The batch check says Reporting has not caught up yet: that is normal, PayPal's records can lag by hours. Run the check again later. Do not write it down as a failure.

## What each run costs

3 × $1.00 sandbox test money per run, $3.00 per run, $15.00 for all five. No real money moves. The proof table in the README will need one final touch-up after run 5, because the totals change.

## After all five

The five filled-in reports finish this part. The video, the Devpost draft, and the final checklist come later, as a separate step.
