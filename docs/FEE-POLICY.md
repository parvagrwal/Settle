# Payouts fee policy: what is published, what is observed, and what is not inferred

The system stores three different things and never mixes them:

1. **A policy estimate** — what PayPal's published schedule implies for this
   product, channel, sender country and currency, at a named version, with a
   source URL and a retrieval date.
2. **Provider-reported fee evidence** — what PayPal returned on a specific payout
   item, at a specific provider timestamp. PayPal's own OpenAPI description calls
   `payout_item_fee` an *estimate* ("populated after the item moves to the
   PENDING state") and the batch `fees` field a "total estimate". It is stored as
   `is_provider_estimate = 1`.
3. **An observation** — a single transaction that does not generalise.

## Published policy in this repository

| Policy id | Version | Channel | Formula | Source | Retrieved |
| --- | --- | --- | --- | --- | --- |
| `paypal-us-payouts-api-flat-2026-10` | 1 | Payouts API | USD 0.25 flat per payout item | <https://www.paypal.com/us/business/paypal-business-fees> | 2026-11-10 |
| `paypal-us-payouts-web-2pct-cap-2026-10` | 1 | web | 2% of the item amount, capped at USD 1.00 per item | same page | 2026-11-10 |

The web rate is modelled but is **not** used by this system: Settle pays through
the Payouts REST API, so the API policy is the default. International senders are
not modelled; the system is USD-only and refuses a non-USD provider item rather
than guessing.

The policy is written to `fee_estimates` **before** the create request, so a
payment that is later lost still carries the estimate it was authorised under.

## What the checked-in artifact says

`evidence/payouts-first-test/payout-poll.json`:

- batch `YFBPVYJBHM9GU`, `SUCCESS`, `time_created` 2026-11-06T12:13:54Z
- two items, `$1.00` each, `payout_item_fee` `0.02` + `0.02`
- batch `fees.value` `0.04`

Read correctly: **four cents of reported fee across two one-dollar items in one
sandbox batch.** It is not a $0.25 item fee, and it is not one $2.00 item.

Read honestly: this is a sandbox observation. Sandbox pricing is not guaranteed
to match production pricing, and one batch is not a schedule. The code therefore
records it as evidence, compares it with the policy (`consistent: false` for a
25¢ estimate against a 2¢ observation), and **does not rewrite the policy from
it**.

## How a fee is displayed

- Estimate available, provider fee available → both shown, plus a consistency
  verdict and an explanation.
- Estimate available, provider fee missing → `consistent: null` and the sentence
  "No estimate is stored and the provider fee was not reported. The fee is
  unavailable, not zero." (or the estimate-side equivalent). It never renders
  `$0.00`.
- No estimate, no provider fee → "no estimate stored" and "PayPal reported no
  fee"; the fee total is labelled unavailable.

`GET /api/financial/report` splits `estimatedTotal` (policy estimates stored) from
`providerReportedTotal` (what PayPal reported) and reports
`missingProviderFeeCount` explicitly.

## Why a generic formula is forbidden

A common failure is to compute "2% capped at $1.00" and present it as *the*
Payouts fee. That formula describes the web channel for a US sender. The Payouts
API is a different, flat rate. Using the wrong formula silently produces a
confident wrong number, so the system pins a policy id, a version and a source
per payment, and refuses to compute a fee with no policy.

## Recipients

Recipients receive the full payout amount. The fee is charged to the sender and is
never deducted from the item amount in the ledger or the UI.

## Known gaps

- No production fee evidence is checked in.
- Only the US/USD combination has a policy. Any other combination must be added
  with its own citation before the system will estimate a fee for it.
- The 2¢ observation remains unexplained by PayPal's published pages. It is
  recorded as an anomaly, not as a correction to the policy.
