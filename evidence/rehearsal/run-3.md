# Practice run 3 of 5

- Date and time (IST): Sat Nov 7, 2026, around 14:56 IST
- Started at (server up): around 14:55 IST
- Finished at (batch check done): around 14:56 IST
- Time taken (minutes, budget 15): around 50 seconds
- Proposer (model / built-in): model
- Payout batch ID: MKZFSY2ENSC86
- Batch status: SUCCESS
- Jobs paid (3 expected): demo-waiting-1, demo-waiting-2, demo-approve-1, $1.00 each
- Jobs held or blocked, with reasons: demo-over-cap, PerRequestCapExceeded, over the $200 per-payment cap; settle-audit-1, settle-audit-2, settle-groq-1, settle-groq-2, DuplicatePayout, already paid
- Transaction IDs (one per paid job): 2XD24470Y2783963M, 1DX82873BC525254X, 3E006672M3947325X
- Invoice ID: INV2-QZ27-GV5H-DM37-T8TH
- Batch check result (all items found / Reporting not caught up yet): PASS, all 3 items found; Reporting 0 matching yet, re-run later
- What went wrong, if anything (exact error): output file mistake — the check was saved to batch-check-2.json instead of batch-check-3.json, so it overwrote run 2's file. Run 2's transaction IDs are safe in run-2.md. Fix: re-run the run 2 check with batch-check-2.json and the run 3 check with batch-check-3.json.
- Notes: 50 seconds, well inside budget
