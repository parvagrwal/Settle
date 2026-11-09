# Phase 0 — transaction-system technical diagnosis

**Baseline:** `4a384d29d5888f0095c0ef8c2b5a4127b4e26c4b`  
**Runtime investigated:** Node 22.22.3, npm 10.9.8; baseline suite run before changes: **93 tests, 93 pass, 0 fail**.  
**Evidence rule:** the original application contains no PayPal webhook receiver, no webhook verification, no transaction database, no recording implementation, and no browser-test configuration. These are absences, not inferred capabilities.

## Existing architecture and actual lifecycle

```text
Owner clicks Pay in React
  -> POST /api/pay (no owner authentication)
  -> Groq copies every approved job, or rule fallback makes the same selection
  -> decide() checks process-memory job/cap inputs
  -> POST /v1/payments/payouts
  -> GET /v1/payments/payouts/{batch}
  -> batch-level status written to in-memory jobs
  -> optional Invoicing create/send
  -> /api/grid returns current process-memory jobs
  -> React polls every 5 seconds and replaces rows
  -> AG Studio receives a new data array / fallback AG Grid receives rowData

Separately, a command-line verifier can read one old batch through:
PayPal Payouts GET + PayPal Reporting GET -> evidence/verifier/recompute.json
That verifier is not connected to the runtime grid.
```

There is **no actual PayPal-event-to-grid lifecycle** at baseline. PayPal generates batch/item state remotely; the app polls only the batch header. It does not receive an event, verify a signature, preserve an event ID, persist a transaction, or update a row from a durable transaction record.

## Original five weaknesses — root causes

1. **No independently verifiable event lifecycle.** Root cause: architecture starts at an owner-initiated API call and ends at an in-memory batch status. Evidence: `src/server/routes.ts`, `src/server/jobs.ts`; no webhook route exists.
2. **Identity and history are lost.** Root cause: `Job` stores only `payout_batch_id`; `payout_item_id` stays null and paid audit rows set `paypal_transaction_id:null`. Evidence: `src/server/jobs.ts:127-130`, `src/server/agent.ts:163-170`.
3. **Grid state is not backend truth.** Root cause: arrays in `SettleStore` and `createAuditLog()` are memory-only and restart from `data/seed.json`. Evidence: `src/server/routes.ts:25-32`, `src/server/server.ts:72`.
4. **AG Grid is a reporting surface rather than an operations interface.** Root cause: one static AG Studio grid mapping, a separate AG Charts summary and a simple fallback; no transaction inspection, identity filters, row-level evidence or delta updates. Evidence: `app/src/StudioDashboard.tsx`, `app/src/GridFallback.tsx`.
5. **AI is disconnected from transaction investigation.** Root cause: Groq receives only approved job records and is instructed to copy them exactly. Evidence: `src/server/groqProposer.ts:54-65`. It cannot query payments, cite transaction evidence or drive a grid filter.

## Data-integrity, security and correctness findings

| Finding | Root cause / evidence |
|---|---|
| No webhook authenticity check | No listener, webhook ID or verification call exists. |
| No duplicate/out-of-order event policy | No event store, event timestamps or state-transition logic exists. |
| Batch success is treated as item success | `jobs.ts` marks every accepted job paid when batch status is SUCCESS. |
| Rolling cap is not rolling | `/api/pay` sums current `status==='paid'` memory rows; no timestamps. |
| Owner authority is not authenticated | `/api/approve` and `/api/pay` have no auth; `jobToState()` hardcodes authorized. |
| Recipient can be replaced by caller | `/api/approve` accepts `recipient`, changes the job and adds it to allowlist. |
| Persistence and migration constraints absent | No database/schema/migration files exist. |
| Reconnection cannot be correct | React only replaces arrays on a five-second timer; no durable cursor or delta contract. |
| Payment vs webhook metadata is conflated | Existing rows mix historical receipt IDs and seeded job metadata in one shape. |
| Fee/net shown as facts adjacent to real receipts | Existing fee fields are estimates using a hardcoded formula, not actual event fees. New transaction UI must keep these separate. |

## Existing and missing AG capabilities

**Installed:** `ag-grid-react`/`ag-grid-community` 36.2.0, `ag-studio`/`ag-studio-react` 3.0.0, `ag-charts-*` 14.2.0. AG Studio's installed README confirms built-in chart cross-filtering and serializable state with `onStateUpdated`. Its docs provide `column-chart-grouped` mappings.

**Technically valid in installed Community Grid:** custom renderers and external filters, stable `getRowId`, `api.applyTransaction` deltas, column/filter sidebars, row selection, sorting, pagination, CSV export and state APIs. These will be used only where operationally useful.

**Not claimed:** direct master/detail, row grouping/pivoting or Excel export as free Community features. `ag-grid-enterprise` is present transitively, but its presence is not a license justification. The valid alternative is a selected-row transaction inspector beside the grid, backed by a history endpoint.

**AG Studio target:** a second analytical view over the same persisted transaction records, with a grid and `column-chart-grouped` widget so Studio's native chart cross-filtering does real work. Save Studio JSON to local storage through its actual state API. No invented custom-widget or agent-framework claim.

## Performance and testing deficiencies

- Baseline bundle is about 5.5 MB minified; Studio is always loaded even when fallback is used.
- All existing dashboard checks are narrative; no Playwright tests or recording implementation exists.
- Existing server tests mock Payouts but have no webhook signature, event contract, database failure, reconnection or browser tests.
- Repeated five-second whole-array replacement prevents a precise persisted-delta proof and can reset grid interaction state.
- No large-transaction fixture or render/update measurement exists.

## Feasible versus externally blocked

**Feasible at $0 and implemented next:** fail-closed PayPal postback verification, raw-body handling, idempotent durable SQLite event ingestion, ordered item projection, event/transaction correlation, cursor-based delta API, reconnection, payment-specific Community Grid inspector/filter/export/delta updates, native Studio cross-filter/state, evidence-grounded investigation API and optional Groq narration, unit/integration/contract/failure/Playwright tests, and a reproducible recording harness.

**Not truthfully completable without external setup:** a real PayPal Sandbox webhook delivery, PayPal-hosted verification result, live database proof for that delivery, or a final live live contract and browser proof video. Missing: PayPal sandbox credentials, webhook ID/subscription, public HTTPS listener reachable by PayPal and sandbox sender/receivers. PayPal's simulator cannot use the postback verification endpoint, so simulator payloads must not be represented as verified live proof. Test fixtures will exercise the same projection only after a mocked verifier and will be labelled automated-test data, never live transactions.
