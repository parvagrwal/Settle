# Settle

An AI agent reads approved work, decides who gets paid how much, and pays them with PayPal, inside a weekly cap the owner sets.

Sandbox only. No live money. Total out-of-pocket build cost: $0.

## The problem, in one sentence

Meera runs a 6-person design studio. Every Friday she loses 3 hours matching approved work to freelancer invoices and paying them one by one. Meera is illustrative, not a real user. The 3-hour total is illustrative, not a surveyed real user.

## The demo moment

Meera approves 3 jobs in one click. The agent pays 3 freelancers with PayPal. Two payments land now. One waits, because it is over the cap Meera set. The client is billed at the same time, with a PayPal invoice for the same work. The AG Studio grid updates live, with the PayPal payout ID next to every payment.

Caps, proposed, to be confirmed in the 2-hour user check: $200 per payment, $1,500 per week combined. Worst-case exposure: $1,500 per week.

## Setup

```bash
cp .env.example .env
# Fill in .env locally. Never paste secrets in chat. Never commit .env.
bash scripts/gate1-payouts.sh
```

Gate 1 first, before any feature code: Payouts sandbox batch, then AG Studio starter. The operating brief for Muse stays with Muse, not in this repo. See the task tracker for S1-S10, gates, and the submission checklist.

## Repo layout

```
settle/
├── LICENSE                  # MIT, visible at top of repo
├── README.md                # this file
├── .env.example             # variable names only, no values, no secrets
├── .gitignore
├── scripts/
│   └── gate1-payouts.sh     # Gate 1 spike, curl token + POST payout batch, no app code
└── evidence/
    └── gate1-payouts/       # command, raw output, receipt per task
```

`src/`, `tests/`, `data/`, and `docs/` land here as S2-S10 are built, in tracker order. No feature code before Gate 1 passes.

## PayPal, sandbox only

- Payouts REST `POST /v1/payments/payouts`, money out, direct REST, not in the Agent Toolkit.
- Invoicing v2 via the Agent Toolkit, `create_invoice` + `send_invoice`.
- Reporting via the Agent Toolkit, `list_transactions`, second independent read path, recomputes the grid from PayPal.

## AG Grid

AG Studio 3.0 + `ag-grid-react@36.2.0` + AG Charts 14.2, verified compatible pair. Plain AG Grid Community is the free fallback if Studio blocks setup.

## Hackathon

Build What's Next with PayPal and AI, Devpost. Real submit-by: Wed Nov 11, 2026 evening IST. Official deadline: Fri Nov 13, 2026, 1:30am IST.
