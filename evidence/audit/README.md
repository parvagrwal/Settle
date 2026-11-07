# Audit trail proof

What this folder proves: every decision the agent loop makes writes a
row with a reason, and no PayPal call happens unless the decision
check accepted the proposal.

Files:

- `run-output.txt` — the live script output, in plain words.
- `run-output.json` — the same run as data: the payout batch id from
  part 1, and the refused $999 proposal from part 2.
- `audit-log.json` — every audit row from the live run: accepted rows,
  paid rows with the payout batch id, and the refused row with its
  exact label.

How to read it: a paid row names the job, the amount, and the payout
batch id. A refused row names the job, the amount, and the exact label
that stopped it. A row with no reason is a defect, not a pass.
