# Evidence — S3 threat model

Threat model: `docs/ARCHITECTURE.md`, S3, Fri Nov 6, 2026.
Rejection test: `tests/rejection.test.ts`, run with
`bash scripts/rejection-test.sh`, no server, no PayPal call, no money moved.

Files in this folder:
- `README.md` — this file
- `rejection-test-output.txt` — output of the rejection test run in the repo.
  Created by the script, not by hand. If this file is missing, S3.3 is
  "not run", not done.

Pass: 5 tests pass, 0 fail, policy hash before equals policy hash after.
Fail: any attempt succeeds, or policy changes, or a PayPal call is made.
If any attempt succeeds, work stops, the item is recorded in the tracker
first, and Parv is asked one sharp question.
