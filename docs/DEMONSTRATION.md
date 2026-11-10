# Three-minute demonstration workflow

This script is a presentation aid, not a substitute for the unmoderated fresh-reader experiment.

The on-camera demo uses the dashboard: the grid of approved work, the model recommendation under a run budget, and a live PayPal Sandbox payment. The product workspace API (durable studios, sessions, receipts, reconciliation) is a backend surface in this pack; it has no dashboard screen yet, and it is shown with the inspection script, not on camera.

## Before starting

```bash
npm ci
npm --prefix app ci
npm --prefix app run build
SETTLE_OWNER_TOKEN='your-local-owner-secret' npm start
```

PayPal Sandbox credentials are required for the live payment on camera; without them the Pay button correctly stays off. Never enter real secrets into a shared screen recording.

## 0:00–0:30 — Purpose and control

Start on the dashboard. Point to three things:

- The grid of approved work, with the amount and the decision for each job.
- The run budget: the owner sets how much this run may spend.
- The per-payment and weekly limits the owner sets.

Say: “Settle reads approved work, the model recommends what fits the budget, and the owner authorizes every payout.”

## 0:30–1:00 — Demonstration boundary

Point to the sample data label and the honest labels:

- The demo sender is a US sandbox test account, not a real Indian studio.
- The jobs are illustrative; no real money moves.
- The studio named in the demo is illustrative, not a real client.

Do not call the demo studio a real studio, and do not call the sandbox payments live payments.

## 1:00–2:00 — Jobs and agent reasoning

Open the allocation view.

- Explain the recommendation: due date and priority decide the order, and the run budget decides what fits.
- Point to the job held over the run budget, and read its reason aloud.
- Emphasize: the recommendation is not approval, and nothing is paid until the owner approves and pays.

## 2:00–2:45 — Pay and inspect the evidence

Approve the recommended jobs, then pay.

- Show the payout batch ID and the invoice ID the Pay click creates.
- Open the transactions view and point to the batch, the item IDs and the receipt.
- Explain the distinction: the batch is provider-confirmed, and the receipt is reconciled only when the independent read-back matches it.

## 2:45–3:00 — Product workspace (backend)

If time permits, show the product API from a terminal, not on camera:

```bash
npm run inspect:db
```

Point to the demo workspace, its synthetic jobs, the historical-only receipt, and the isolation triggers. Do not imply a dashboard screen exists for this yet.

## Claims to avoid

- “All receipts are independently verified.”
- “The demo pays real money.”
- “Provider acknowledgement means reconciliation.”
- “Five users validated the three-minute experience.”
- “This implementation made a live PayPal payment” unless a separate live run is actually performed and its provider evidence is saved.
