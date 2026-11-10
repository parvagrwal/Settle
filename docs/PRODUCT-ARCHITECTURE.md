# Updated product architecture

## Product boundary

Settle is one studio payment-operations product, not three dashboard demos. Its smallest coherent information architecture is:

- **Overview:** what Settle does, who controls it, what needs attention.
- **Jobs & decisions:** obligations, provenance, agent recommendation, owner approval, guarded execution.
- **Payments & receipts:** payment history, lifecycle evidence, discrepancies and reconciliation.
- **Controls & audit:** authenticated identity, persistent policy and immutable history.

The AG Studio analytics, allocation comparison and legacy payout components remain in source for historical/technical reference but are no longer in the main product path. The original financial decision and execution modules remain active and covered by regression tests.

## Runtime architecture

```text
React task UI
   │ same-origin /api/product/*
   ▼
Product routes ── server session + workspace membership + operation checks
   │
   ├── ProductStore (SQLite)
   │     users / sessions / workspaces / memberships
   │     jobs / decisions / workspace policies / receipt projections / audit
   │
   ├── FinancialStore (same durable SQLite deployment)
   │     recipients / policy versions / permanent payment identities
   │     reservations / attempts / payout items / provider spend
   │     discrepancies / reconciliation runs / financial audit
   │
   ├── Existing allocation and policy engines (validated recommendations)
   │
   └── PayPal Sandbox client (only after operational owner authorization)

TransactionStore remains the independent verified-webhook projection.
```

The browser never calls PayPal directly and never supplies an owner ID. PayPal and owner secrets remain server-side.

## Identity and authorization

1. The operator configures the existing `SETTLE_OWNER_TOKEN` server secret.
2. `POST /api/product/auth/login` verifies it using constant-time comparison.
3. The server gets or creates the primary authenticated user. The default name is the neutral “Workspace owner”; real optional metadata comes only from server environment configuration.
4. A high-entropy session token is returned in an `HttpOnly; SameSite=Strict; Path=/` cookie. Only its SHA-256 hash is stored in SQLite.
5. Sessions expire after 12 hours and persist across process restarts. Logout deletes the persisted session.
6. Operational reads require membership. Writes require the workspace owner role. Demo access is public but has no financial capabilities; demo reset requires an authenticated owner.

One operational workspace per authenticated owner is intentional: the existing financial ledger has one provider account and one rolling exposure policy. This avoids falsely implying multi-tenant provider isolation. A future multi-owner deployment should first add workspace identity to the financial ledger itself.

## Durable product schema

`ProductStore` creates these additive tables in the existing SQLite file:

| Table | Purpose |
|---|---|
| `product_users` | Authenticated user and provider subject; no client-selected identity. |
| `product_sessions` | Hashed session, user, creation and expiry. |
| `product_workspaces` | Studio name, demo/operational kind, owner and provider environment. |
| `product_memberships` | Owner/operator/viewer workspace permissions. |
| `product_workspace_policies` | Per-payment cap, rolling cap/window and approval lifetime. |
| `product_jobs` | Obligation, recipient, amount, due/priority, approval and provenance. |
| `product_decisions` | Durable recommendation, rationale, held jobs, origin and actor. |
| `product_receipts` | Workspace/payment link, evidence projection and verification state. |
| `product_audit` | Append-only product actions; update/delete triggers reject mutation. |

Financial schema additions:

- `reconciliation_runs(run_id, started_at, completed_at, status, batches_read, items_recorded)`
- `payout_items.ingested_at`
- `payout_items.last_reconciled_at`
- `payout_items.reconciliation_run_id`

The constructor adds missing payout-item columns to older databases with `ALTER TABLE … ADD COLUMN`, preserving existing records. No operational financial history is deleted by a demo reset.

## Provenance model

Origin and verification are separate dimensions.

### Record origin

| Origin | Meaning |
|---|---|
| `synthetic` | Invented demonstration scenario; no operational meaning. |
| `seed` | Repository/database-seeded historical input. |
| `application` | Created by Settle in an operational workspace. |
| `paypal_sandbox` | Provider-originated PayPal Sandbox record where such direct ingestion is used. |
| `paypal_production` | Reserved model value for a future supported Production environment; current config refuses Production. |

An operational payment created by Settle retains `application` origin and `sandbox` provider environment when submitted. This preserves who created the internal record and where provider evidence came from rather than overwriting one with the other.

### Verification state

| State | Exact semantics |
|---|---|
| `synthetic` | Illustrative only. |
| `unverified` | Internal approval exists; no provider item evidence. |
| `provider_response_received` | A provider item exists but is not a successful confirmed outcome. |
| `provider_confirmed` | Successful provider item recorded; not independently reconciled yet. |
| `reconciled` | The specific payout item was read in a completed provider reconciliation run. |
| `discrepancy_detected` | Internal and provider facts conflict; never presented as reconciled. |
| `verification_unavailable` | Submission outcome is ambiguous or evidence cannot currently be established. |
| `historical_evidence_only` | Seed/reference evidence exists; Settle has not independently reconciled it. |

### Timestamp distinctions

- Job/receipt `created_at`: internal record creation.
- `approved_at`: owner authorization.
- `submitted_at`: provider submission attempt.
- `provider_timestamp`: provider processing/outcome time.
- `source_timestamp`: source event time where available.
- `ingested_at`: Settle evidence ingestion time.
- `last_reconciled_at`: independent provider read of that item.
- `reconciliation_run_id`: the exact run supporting the preceding timestamp.

## Demo/operational isolation

Isolation is enforced in three layers:

1. **Schema:** workspace kind and origin/environment constraints. Demo receipt triggers prohibit permanent `payment_id`, application/provider origin, operational verification states and reconciliation timestamps. Operational receipts reject synthetic origin.
2. **Store:** operational-only create/approve/payment guards and membership checks. Demo reset deletes/recreates only `workspace_id='demo'` product rows.
3. **Routes:** demo payment/reconciliation attempts fail before recipient/payment creation. When `ProductStore` is enabled, legacy demo approval, payment and allocation execution return 410, and legacy seed-to-financial migration is skipped.

Demo decisions are `synthetic`; operational decisions are `application`. Neither counts as approval. Demo receipts never enter `payments`, `execution_attempts`, `payout_items`, or `provider_spend`, and therefore cannot affect rolling limits.

## Receipt evidence projection

`product_receipts` joins the internal job/payment relationship without duplicating financial authority. On workspace/receipt reads, `productSnapshot` projects current `FinancialStore` payment/item/discrepancy facts and computes the verification state in this precedence:

1. unresolved discrepancy → `discrepancy_detected`
2. item reconciliation run/time → `reconciled`
3. ambiguous payment → `verification_unavailable`
4. successful provider item → `provider_confirmed`
5. other provider item → `provider_response_received`
6. otherwise → `unverified`

The UI renders six lifecycle stages: authorization, submission, provider acknowledgement, item outcome, transaction evidence, reconciliation. It never fills unsupported IDs, fees or times with example values.

## Financial correctness preserved

- Permanent job/payment idempotency identities.
- Owner-verified recipients and substitution refusal.
- Policy-versioned approvals and per-payment cap.
- Rolling cap based on provider-time spend plus active reservations.
- Fresh reconciliation required before reservation.
- Durable sender identities reused during recovery.
- Ambiguous outcome blocks blind retry.
- Provider amount/currency/recipient mismatch creates durable discrepancy.
- Immutable financial and product audit histories.

## API summary

- `GET /api/product/session`
- `POST /api/product/auth/login`, `POST /api/product/auth/logout`
- `GET/POST /api/product/workspaces`
- `GET /api/product/workspaces/:id`
- `POST /api/product/workspaces/:id/jobs`
- `POST /api/product/workspaces/:id/recommend`
- `POST /api/product/workspaces/:id/jobs/:jobId/approve`
- `POST /api/product/workspaces/:id/jobs/:jobId/pay`
- `POST /api/product/workspaces/:id/reconcile`
- `PUT /api/product/workspaces/:id/policy`
- `GET /api/product/workspaces/:id/receipts/:receiptId`
- `POST /api/product/workspaces/demo/reset`

Legacy read APIs remain for compatibility and existing tests. Their demo financial mutations are disabled in product mode.
