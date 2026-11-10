# Settle — payouts for a small studio

> **2026-11-09 transaction-intelligence update:** the default dashboard now reads a durable ledger of PayPal-postback-verified events, with AG Grid operations, a separate AG Studio analytical view, and evidence-grounded investigation. Configure `PAYPAL_WEBHOOK_ID` and `SETTLE_DB_PATH` as shown in `.env.example`. With no verified events, the dashboard is intentionally empty.
>
> **Proof status:** 173 Node tests pass and the frontend production build passes. Browser E2E runs now, 2 of 3 pass, the chart spec fails; live webhook proof has not been performed. Read [the Phase-0 diagnosis](docs/TRANSACTION-TECHNICAL-DIAGNOSIS.md) and [implementation/evidence matrix](docs/IMPLEMENTATION-EVIDENCE.md) before interpreting older demonstration claims below.
>
> **2026-11-09 agentic-allocation update:** Settle now coordinates competing payment obligations through validated allocation scenarios, contextual agent selection, counterfactual re-planning, owner-bound approvals and idempotent execution controls. The default planner uses a clearly labelled illustrative scenario and never authorizes payment. Verified PayPal events remain available in the transaction view.
>
> **Proof status:** 173 Node tests pass and the frontend production build passes. Live AI comparison ran on 2026-11-09: all three systems tied at $130, the counterfactual flipped the plan when funds dropped $50, and AI-beats-baseline stays unproven. Browser E2E runs now, 2 of 3 pass; live webhook proof has not been performed. The model-assisted path is one selection over the scenarios; the agent path validates the pick, and on a rule break escalates and tries the next scenario, so the two can now be compared; the counterfactual takes a one-condition change to the input. Approve, pay, and allocation writes now need the owner token, and an approved plan can be paid through PayPal and is marked succeeded only when every item settles. Read the [forensic diagnosis](docs/AGENTIC-ALLOCATION-DIAGNOSIS.md), [implementation status](docs/AGENTIC-IMPLEMENTATION.md), [India feasibility screen](docs/INDIA-FEASIBILITY.md) and [unvalidated user-research status](docs/USER-RESEARCH.md). Older receipt claims below do not establish allocation intelligence.

An agent reads approved work, decides who gets paid how much, and pays them with PayPal, inside a weekly cap the owner sets.

Meera runs a six-person design studio. Every Friday she loses three hours matching approved work to freelancer invoices and paying them one by one. Meera is an example, not a real person, and the three hours is an example, not a measured result.

Sandbox only. Test money, no real money moves. The demo sender is a US sandbox test account, not a real Indian studio.

## Proof it works

These are real sandbox receipts from live test runs, not mock data:

| What happened | Receipt | Result |
| --- | --- | --- |
| First Payouts test, two $1.00 payments | `YFBPVYJBHM9GU` | SUCCESS |
| Payouts integration test, two $1.00 payments | `4P79GAKFE3XA4` | SUCCESS |
| Agent loop run, two $1.00 payments | `RBZ4V8LCSSK5W` | SUCCESS |
| Model proposing inside the loop, two $1.00 payments | `JHG24Y874LK58` | SUCCESS |
| Dashboard pay run, three $1.00 payments | `FY7MPJGJKTA62` | SUCCESS |
| Second dashboard pay run, three $1.00 payments | `GZ6XT3FLM95QJ` | SUCCESS |
| Practice run 1, three $1.00 payments | `85WA4HAMM9QLA` | SUCCESS |
| Practice run 2, three $1.00 payments | `43CX2PZFD8RAU` | SUCCESS |
| Practice run 3, three $1.00 payments | `MKZFSY2ENSC86` | SUCCESS |
| Practice run 4, three $1.00 payments | `H5DYE42K9RT7G` | SUCCESS |
| Practice run 5, three $1.00 payments | `GB736QR4BZJUG` | SUCCESS |
| Client invoice sent, $2.00 total | `INV2-QZ27-GV5H-DM37-T8TH` | SENT |

Twenty-nine $1.00 test payments in total, $29.00, all sandbox test money. The server test suite passes 173 checks, 0 fail (`npm test`).

## How it works

1. The owner approves jobs in the dashboard.
2. The model chooses which approved jobs to pay now and in what order, under the run budget the owner sets for this run, with one reason per chosen job and per held job.
3. Eight decision rules check every chosen job before any PayPal call. If a rule fails, the payment is refused, the refusal is written to the audit trail with its reason, and no PayPal call is made for that job.
4. Payments that pass go out in one PayPal Payouts batch. The client is billed at the same time with a PayPal invoice for the same work.
5. The dashboard grid updates live, with the PayPal payout batch next to every payment.

The model is `gpt-oss-20b` through Groq, free tier. It chooses the jobs to pay in structured output, and the decision rules check every chosen job against the approved job record. Without a Groq key, the run holds for the owner to pick the jobs by hand, and says so on screen.

PayPal tools used: Payouts REST API (pay the batch), Invoicing API v2 (bill the client), Reporting API (check the payout landed, from an independent read).

The dashboard is built with AG Studio 3.0 (AG Grid's dashboard builder) plus `ag-grid-react` 36.2.0 and AG Charts 14.2. If AG Studio fails to load, the plain grid view takes over at once, so the payout rows are never a blank screen.

## Product workspace API

Beyond the dashboard, the server also exposes a durable workspace API under `/api/product/*`. A workspace is a studio with an owner, a session, jobs, decisions, a policy and receipts, all stored in the same SQLite file as the financial ledger. The demo workspace is illustrative (synthetic jobs, one historical-only receipt); an operational workspace is private to the signed-in owner. Demo and operational data are kept apart by database triggers, so a demo job can never obtain a permanent payment identity.

The API covers: owner sign-in (the owner token is exchanged for a server session cookie), workspace setup, job creation and approval, payment through the same ledger flow, reconciliation, receipt detail with the raw provider evidence, and policy changes (per-payment and weekly caps, approval expiry). Every operational write requires the owner session; anonymous reads of an operational workspace are refused.

There is no dashboard screen for this API yet. Inspect it from a terminal with `npm run inspect:db`, which prints the workspaces, their jobs and receipts, and the isolation triggers, without exposing sessions or operational recipients. See `docs/PRODUCT-ARCHITECTURE.md` and `docs/PRODUCT-DELIVERY.md`.

## The guardrails

- **$200 per payment.** A payment over $200 waits for the owner, with the exact reason and the amount over the cap on screen.
- **$1,500 per week combined**, rolling 7 days, counted on the PayPal sandbox transaction time. Worst-case exposure: $1,500 per week.
- **Approvals run out after 7 days.** An approval that has run out is treated as not approved.
- **Same job, paid once.** A job that is already paid is refused as a duplicate.
- **Allowed recipients only.** A payment to an address that is not on the allowed list is refused.
- **Every decision is written down.** Accepted and refused, with the reason, in the audit trail.

The dashboard shows the estimated PayPal fee and the net amount the freelancer receives for each payout, from PayPal's published rates. The fee is not removed.

## What is real, and what is seeded

| Item | Real or seeded |
| --- | --- |
| The eleven payout batches above | Real sandbox receipts |
| The sent invoice above | Real sandbox receipt |
| The four paid rows in the dashboard on first load | Real sandbox receipts |
| The waiting, over-cap, and not-approved rows | Seeded demo jobs, labelled in `data/seed.json` |
| Meera and the studio | Example, not a real person or studio |
| The sender | US sandbox test account, not a real Indian studio |

## Run it yourself

You need Node.js 22 or newer, and nothing else. No account is needed to look at the dashboard. To pay live in the sandbox, you need keys, see below.

```bash
git clone https://github.com/parvagrwal/Settle.git
cd Settle
bash scripts/cold-start.sh
```

Then open http://localhost:3000/ in a browser.

The script installs the dependencies, builds the dashboard, and starts the server. The first run takes about a minute. If no `.env` file exists, it makes a blank one from `.env.example` (names only, no values) and the dashboard opens with the seeded demo data. Paying stays off until you add keys and run the script again.

## Get the keys

No values are in this repo. You make every key yourself, and every key stays in your local `.env` file, which is never committed.

**PayPal sandbox keys.** Go to [developer.paypal.com](https://developer.paypal.com), sign in, open Dashboard, then My Apps & Credentials, then the Sandbox tab, then Create App. Copy the Client ID and the Client Secret into `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. For the receiver email, use a sandbox Personal account email: in the same dashboard, open Sandbox, then Accounts, and make a Personal account if you do not have one. Put its email in `.env` as `PAYPAL_SANDBOX_RECEIVER_EMAIL`.

**Groq key (for the model allocator).** Go to [console.groq.com](https://console.groq.com), sign in, open API Keys, then Create API Key. Put it in `.env` as `GROQ_API_KEY`. Free tier, no card needed. Without it, the dashboard still works and a Pay click holds for the owner to pick the jobs by hand.

**Owner token (for approve, pay, and allocation writes).** Choose a long random value and put it in `.env` as `SETTLE_OWNER_TOKEN`. You can make one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never commit it, never paste it anywhere. The dashboard asks for it once per session at the top of the page and keeps it in that browser tab only; approve and pay stay off until it is entered. Without it set, those routes refuse with 503; a wrong token is 401.

## Try the flow

1. Open the dashboard. You see 8 rows: 4 paid, 2 waiting at $1.00, 1 over the cap at $250.00, 1 waiting for approval. First enter the owner token at the top of the page; approve and pay stay off until it is entered.
2. Click **Approve demo-approve-1**. The running weekly total and the cap left update.
3. Set the run budget for this run (it starts at the weekly cap left). Click **Pay approved jobs**. The model chooses which waiting jobs fit the budget, soonest due and highest priority first, the chosen jobs are paid live in sandbox test money, and the result screen shows the payout batch, its status, who chose the jobs, and which jobs the model held with reasons.
4. The over-cap job stays held, with its reason and the $50.00 over the cap on screen.

## Run the tests

```bash
npm test
```

The server suite covers the decision rules (all 256 combinations of the eight rules), the payout and invoice calls, the audit trail, the independent check from PayPal reporting, and the dashboard server. It also covers the owner token (401 without one, 401 with the wrong one, 503 when unset), approved-plan execution with mocked PayPal, stale-plan refusal at approval and execution, and the comparison harness. No PayPal credentials are needed; the tests use mock replies.

## Cost

$0 to build and run. PayPal sandbox is free, the Groq free tier is free, AG Studio runs on a 45-day free trial with the plain grid as the free fallback, and GitHub Actions is free for public repos. No step asks for a card. In live use, PayPal would charge its normal payout and cross-border fees; in the sandbox, no real money moves.

## If something goes wrong

- **401, credentials wrong.** Check the values in `.env` and run the script again.
- **403, Payouts not allowed.** Payouts is not enabled for that sandbox app, or the sender country is not allowed. Use a US sandbox test account as the sender.
- **400, duplicate batch.** The batch was already sent. The server makes a fresh batch on each run.
- **Payment shows as unclaimed.** The receiver email has no sandbox Personal account behind it. Swap in a real sandbox Personal email and run it again.
- **429, free-tier limit hit.** Wait a short while and run it again. The run holds for the owner to pick the jobs by hand.
- **Paying is off on the dashboard.** `.env` has no keys. The dashboard still works with the seeded data. Add the keys and restart the server to pay.
- **Port 3000 is in use.** Stop the other server, or set `PORT` in `.env` to another port.
- **A warning about a chunk larger than 500 kB during the build.** Expected. The build still passes; the dashboard library is large.

## Repo layout

- `README.md` — this file.
- `LICENSE` — MIT license.
- `.env.example` — the key names, no values.
- `package.json` — `npm start` runs the server, `npm test` runs the server suite.
- `src/server/` — the decision rules, Payouts, invoicing, reporting check, audit trail, agent loop, model allocator, and dashboard server.
- `src/shared/` — the shared types and rule labels.
- `scripts/` — the one-command setup script and the live run scripts.
- `tests/` — the server test suite.
- `app/` — the dashboard (AG Studio, AG Grid, charts).
- `data/seed.json` — the seeded demo jobs, labelled as seeded test data.
- `evidence/` — the run output and receipts behind the proof table above.
- `.github/workflows/ci.yml` — runs the tests and the dashboard build on every push.
