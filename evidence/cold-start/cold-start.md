# Fresh setup test — clean-room rerun

Run on the VM, Sat 2026-11-07, Node.js v24.22.1, npm 10.9.4. The script needs
Node.js 22 or newer; the VM run used 24, Parv's machine uses 22.23.3, both pass
the check.

## What was tested

A fresh copy of the repo with no local state to help it pass: 61 files, 400K,
no `node_modules`, no `app/dist`, no `.env`, no git history. The copy was made
from the repo work copy, then `bash scripts/cold-start.sh` was run in it, with
no keys supplied anywhere. The full script output is in `run-output.txt` next
to this file.

## Command

```bash
cp -r <repo> /tmp/coldstart/settle
cd /tmp/coldstart/settle
bash scripts/cold-start.sh
```

## Run output (script, verbatim)

```text
No .env file found, so a blank one was made from .env.example.
It holds key names only, no values. The dashboard will open with seeded demo data.
To pay live in the sandbox, fill in the keys in .env and run this script again.
Installing dependencies...

up to date, audited 1 package in 349ms

found 0 vulnerabilities

added 44 packages in 19s

8 packages are looking for funding
  run `npm fund` for details
Building the dashboard...

> settle-dashboard@0.0.0 build
> tsc -b && vite build

vite v8.3.6 building client environment for production...
transforming...
✓ 33 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     0.41 kB │ gzip:     0.28 kB
dist/assets/index-CNCgJKy4.css      3.05 kB │ gzip:     1.06 kB
dist/assets/index-CmIoFbJw.js   5,507.73 kB │ gzip: 1,540.39 kB

[plugin builtin:vite-reporter]
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 3.57s

Starting the server. Open http://localhost:3000/ in a browser.
What to check: the dashboard loads, it shows 8 rows (4 paid, 2 waiting,
1 over the cap, 1 waiting for approval). Paying stays off until .env has keys.

> settle@0.0.0 start
> node --experimental-strip-types src/server/server.ts

PayPal is not configured, dashboard runs with seed data only: config: PAYPAL_CLIENT_ID is missing. Fill it in local .env only.
Settle dashboard: http://localhost:3000/
Paying is off (no PayPal credentials).
Sandbox only. Test money, no real money moves.
```

## Checks against the running server

```text
GET /                     -> 200
GET /api/caps             -> {"per_payment_cap_cents":20000,"weekly_cap_cents":150000,
                              "window_days":7,"approval_expiry_days":7,
                              "worst_case_exposure":"Worst-case exposure: $1,500 per week."}
GET /api/grid             -> 8 rows: settle-audit-1, settle-audit-2, settle-groq-1,
                              settle-groq-2, demo-waiting-1, demo-waiting-2,
                              demo-over-cap, demo-approve-1
GET /api/jobs             -> 8 jobs
POST /api/pay (no keys)   -> 503 {"error":"pay is not configured: sandbox credentials
                              are missing, set them in local .env only"}
```

Browser check, headless Chromium, 1280px: landing page opens, "Open the
dashboard" shows the grid with all 8 job ids, KPIs show $4.00 paid and
$253.00 waiting. Zero page errors. The only console output is the AG Studio
trial license banner, which is expected with no license key.

## Questions a stranger was forced to ask, and the fix for each

1. **"How long does the first run take?"** Nothing said. The install took
   19 seconds and the build 3.57 seconds, but a stranger watches a silent
   install with no idea whether it is stuck. Fix: the script now prints
   "(first run takes about a minute in total)" before installing, and the
   README says the first run takes about a minute.
2. **"Did the build fail? It warns about a chunk larger than 500 kB."**
   The warning looks like an error, but the build ends with "built in
   3.57s" and the script carries on. Fix: the README troubleshooting now
   says the chunk warning is expected and the build still passes.
3. **"Is the blank .env a problem?"** The script makes a blank `.env`
   from `.env.example` when none exists. A stranger could read that as a
   broken setup. Fix: no code change was needed, the script already prints
   that the file holds key names only and that paying stays off until keys
   are added. The README says the same. Recorded here so the question is
   answered in the open.

No other question came up. No guess was needed to complete the run: every
step printed what it was doing, and every check passed on the first attempt.

## What this run does not prove

This rerun used the local repo copy, not a clone from GitHub, and it ran with
no PayPal credentials, so paying was never tried live here. The GitHub-clone
run still needs Parv to commit and push first, then clone fresh and run the
same script. That run is the remaining proof for the fresh setup test.
