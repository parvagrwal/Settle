# Settle

An AI agent reads approved work, decides who gets paid how much, and pays them with PayPal, inside a weekly cap the owner sets.

Sandbox only. No live money. Total out-of-pocket build cost: $0.

## The problem, in one sentence

Meera runs a 6-person design studio. Every Friday she loses 3 hours matching approved work to freelancer invoices and paying them one by one. Meera is illustrative, not a real user. The 3-hour total is illustrative, not a surveyed real user.

## The demo moment

Meera approves 3 jobs in one click. The agent pays 3 freelancers with PayPal. Two payments land now. One waits, because it is over the cap Meera set. The client is billed at the same time, with a PayPal invoice for the same work. The dashboard grid is planned to update live, with the PayPal payout ID next to every payment.

Proof, from PayPal sandbox: payout batch 4P79GAKFE3XA4, SUCCESS, 2 payments paid. First sandbox payout batch YFBPVYJBHM9GU, SUCCESS.

Guardrail, proposed, to be confirmed by talking to a real studio owner: $200 per payment, $1,500 per week combined across all freelancers. Worst case: $1,500 per week. A payment over the cap waits for Meera. A payment for unapproved work, a duplicate payment, or a payment to someone not on the list is refused, and the refusal is recorded.

The sender in this demo is a US sandbox test account, not a real Indian studio. A real Indian studio would still be blocked from sending payouts in live use.

## Setup

```bash
cp .env.example .env
# Fill in .env locally. Never paste secrets in a message. Never commit .env.
bash scripts/payouts-smoke-test.sh
```

Run the decision-rules tests:

```bash
node --test tests/decide.test.ts
```

Run the Payouts integration tests (mocked, no live PayPal):

```bash
node --test tests/api.test.ts
```

Run the rejection test (no server, no PayPal, no money moved):

```bash
bash scripts/rejection-test.sh
```

Run the live Payouts smoke test (sandbox only, $1 x 2):

```bash
node --experimental-strip-types scripts/run-payout.ts
```

## Repo layout

```text
settle/
├── LICENSE                  # MIT, visible at top of repo
├── README.md                # this file
├── .env.example             # variable names only, no values, no secrets
├── .gitignore
├── docs/
│   └── ARCHITECTURE.md      # threat model: roles, caps, attacks, load-bearing answers
├── src/
│   ├── server/              # decision rules, Payouts integration, jobs
│   └── shared/              # labels, types
├── scripts/
│   ├── payouts-smoke-test.sh  # first sandbox Payouts test, curl only, no app code
│   ├── rejection-test.sh      # rejection test, no server, no PayPal
│   └── run-payout.ts          # live Payouts smoke test, sandbox only, $1 x 2
├── tests/
│   ├── decide.test.ts       # decision-rules tests, all 256 combinations
│   ├── rejection.test.ts    # rejection test
│   └── api.test.ts          # Payouts integration tests, mocked
└── evidence/
    ├── payouts-first-test/  # first sandbox Payouts test: command, raw output, receipt
    ├── decide/              # decision-rules test output
    ├── threat-model/        # rejection test output
    └── payouts/             # Payouts integration evidence
```

`data/` does not exist yet. The dashboard, the invoicing code, and the reporting code are not built yet.

## PayPal, sandbox only

- Payouts REST `POST /v1/payments/payouts`, money out, direct REST, not in the Agent Toolkit.
- Invoicing v2 via the Agent Toolkit, `create_invoice` + `send_invoice`. Not built yet.
- Reporting via the Agent Toolkit, `list_transactions`, second independent read path, recomputes the grid from PayPal. Not built yet.

## AG Grid

AG Studio 3.0 + `ag-grid-react@36.2.0` + AG Charts 14.2, verified compatible pair. Plain AG Grid Community is the free fallback if Studio blocks setup. The dashboard is not built yet.

## Hackathon

Build What's Next with PayPal and AI, Devpost. Real submit-by: Wed Nov 11, 2026 evening IST. Official deadline: Fri Nov 13, 2026, 1:30am IST.
