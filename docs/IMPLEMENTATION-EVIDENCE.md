# Transaction intelligence implementation evidence

**Date:** 2026-11-09  
**Branch:** `arena/39066b83-settle`  
**Scope:** durable verified PayPal lifecycle, AG Grid operations, AG Studio analytics, evidence-grounded investigation.

This is an implementation report, not a claim that the live live contract and browser proof demonstration is complete. The Phase-0 reconstruction and five root causes are in [TRANSACTION-TECHNICAL-DIAGNOSIS.md](./TRANSACTION-TECHNICAL-DIAGNOSIS.md).

## Verified results

| Check | Result | Reproduction/evidence |
|---|---|---|
| Baseline before implementation | 93/93 passing | Phase-0 engineering log |
| Current Node tests | **107/107 passing** | `npm test`; `evidence/engineering/regression-after-slice3.tap` |
| Store lifecycle | 6/6 passing | `tests/transactionStore.test.ts`; `evidence/engineering/tdd-log.md` |
| Webhook/API integration | 4/4 passing | `tests/webhook.test.ts`; fail-closed, malformed JSON, duplicate delivery, cursor/history |
| Investigation | 4/4 passing | `tests/investigation.test.ts`; evidence IDs, uncertainty, empty data, model contract |
| Frontend TypeScript + Vite | Passing | `cd app && npm run build` |
| Browser E2E | **0 executed; 3 failed at browser launch** | `npm run test:e2e`; `evidence/browser/e2e-results.txt` |
| Live PayPal Sandbox live contract and browser proof | **Not performed** | Missing credentials, webhook subscription/ID and public HTTPS listener |

No test uses a live payment credential. E2E responses are explicitly named automated fixtures and are intercepted in the browser; they never enter SQLite or the webhook endpoint.

## TDD record

1. **Store RED:** six tests failed because `transactionStore.ts` did not exist. **GREEN:** six passed after the ledger/projection implementation. One test initially used an invalid terminal SUCCESS→UNCLAIMED transition; the fixture was changed to a separate payment, not the conflict rule.
2. **Webhook RED:** all four integration tests failed at the missing HTTP routes. **GREEN:** PayPal postback verification, fail-closed validation, ingestion and read APIs passed.
3. **Investigation RED:** module missing. First implementation produced three passes/one failure because the no-causal-claim assertion matched the words “root cause.” The factual wording was changed to “recorded status only.” **GREEN:** four passed.
4. **Frontend compile checks:** installed AG Studio types rejected `dims/measures` for a grouped-column chart (`categoryKey/valueKey` are correct) and AG Grid rejected `headerCheckbox` for single-row selection. Both were corrected; the production build then passed.
5. **Browser RED/blocker:** Playwright CDN and Debian packages are network-blocked. npm-hosted Chromium installed, but its process cannot load `libnspr4.so` and `libnss3.so`. No page-level assertion or screenshot ran. This is not a passing E2E result.

## Target architecture and actual data flow

```text
PayPal Sandbox event
  → POST /api/webhooks/paypal (raw JSON object)
  → required transmission headers
  → PayPal /v1/notifications/verify-webhook-signature
       using configured webhook ID + sandbox access token
  → single SQLite transaction
       unique event ledger insert
       projection upsert + chronology/conflict rules
  → durable event sequence cursor
  → GET /api/transactions?since=N
  → AG Grid applyTransaction({ add, update })
  → selection/context action
  → GET /api/transactions/:rowKey/history
  → payment/event metadata + immutable event timeline

Natural-language question
  → POST /api/investigate
  → deterministic SQLite projection query and calculations
  → facts + exact row keys + gridFilter + explicit uncertainty
  → optional Groq narration constrained to computed evidence
  → Reveal evidence rows applies AG Grid set filter

AG Studio tab
  → same verified projection rows (read-only analytical copy)
  → native grouped-column chart + analytical grid
  → format.crossFilter highlight/filter
  → onStateUpdated serializes report JSON to localStorage
```

The operational AG Grid and Studio analytical grid intentionally have different roles. They are not two independently editable payment grids.

## Correctness and security assessment

- **Fail closed:** missing transmission headers return 400; malformed JSON returns 400; failed PayPal postback returns 401; missing configuration returns 503. None stores an event.
- **Raw event preservation:** all accepted nonduplicate raw resources are retained. The full event is supplied to PayPal verification before ingestion. Duplicate event IDs cannot be rewritten.
- **Ordering:** event chronology prevents stale overwrites. Terminal success cannot regress to a different status. Conflicting and superseded events remain auditable.
- **Identity:** payout-item identity, original transaction ID, associated order ID, latest/original event IDs, batch ID and application job ID are separate nullable fields. Missing values display “Not reported.”
- **Money:** integer cents; fee/net are null when absent. SQLite enforces `net = gross - fee` where fee and net exist. The browser does not sum mixed currencies.
- **Recovery:** cursor comes from the persisted ledger. A browser retry after an outage resumes at its last cursor; restart recovery is covered by store tests.
- **No demo bypass:** no unauthenticated fixture-ingestion endpoint exists. There is no simulator fallback because PayPal documents that simulator events cannot use postback verification.
- **Remaining risks:** SQLite is single-writer and suitable for one sandbox instance, not a horizontally scaled production deployment. Browser cursor loss causes a full re-read, which is correct but not bandwidth-optimal. Groq output is optional narration, not independent factual validation. Route authentication is not added here; deployment must restrict operational APIs and protect the webhook from resource-exhaustion attacks without weakening verification.

## AG capability evidence and limits

Installed packages were inspected before use. Community APIs used: stable `getRowId`, `applyTransaction`, custom status/action renderers, text/number/set filters, external attention filter, sorting, single-row selection, context menu, column/filter sidebars, pagination, column reset and visible-row CSV export. No Enterprise master-detail, row grouping or paid license is claimed.

Studio uses the installed `column-chart-grouped` mapping, native `format.crossFilter`, and `onStateUpdated` serializable report state. Browser execution is blocked, so mounting, click cross-filter behavior and state restoration remain unverified in this environment. Custom AI-generated widgets are neither used nor claimed.

## Performance assessment

- Delta polling transfers only changed projections after initial load; AG Grid receives add/update transactions rather than a full client array replacement. Polling is four seconds, not a claimed realtime socket.
- SQLite WAL mode and indexed event/cursor queries avoid scanning JSON files. No large-volume benchmark has been run; no latency or throughput guarantee is made.
- The production bundle is approximately **5.85 MB (1.63 MB gzip)** and Vite emits a large-chunk warning. Studio is the major legacy dependency. Route-level lazy loading is the next performance improvement; no bundle-speed claim is made.

## Requirements-to-evidence matrix

| Requirement | Implementation/evidence | Status |
|---|---|---|
| Phase-0 lifecycle/root-cause diagnosis | `docs/TRANSACTION-TECHNICAL-DIAGNOSIS.md` | Complete |
| Verified webhooks, no insecure fallback | `webhooks.ts`, route, four integration tests | Code/tests verified; live contract pending |
| Durable identity, audit and ordering | `transactionStore.ts`, six lifecycle tests | Verified with fixtures |
| Recovery/reconnection and delta sync | durable cursor API, grid `applyTransaction` | Server verified; browser pending |
| Central AG Grid interactions | `TransactionsDashboard.tsx` | Built; browser pending |
| Native AG Studio cross-filter/state | `StudioAnalytics.tsx`, installed types/config | Built; browser pending |
| Evidence-grounded AI + grid navigation | `investigation.ts`, four tests, Reveal button | Engine verified; browser pending |
| Unit/integration/contract/regression | 107 passing Node tests | Verified |
| Playwright failure/regression/E2E | three specs + launch failure log | Specs present; execution blocked |
| Real Sandbox live contract and browser proof recording | none | **Blocked, not complete** |
| $0 / Sandbox only | built-in SQLite, free packages, no live calls | Maintained |

## File-by-file rationale

| File | Why it changed |
|---|---|
| `src/server/transactionStore.ts` | Built-in SQLite migration, immutable event ledger, transaction projection, chronology/conflict rules, history and cursor queries. |
| `src/server/webhooks.ts` | Required-header parsing and PayPal postback request; keeps provider verification separate from persistence. |
| `src/server/routes.ts` | Raw-body webhook endpoint, transaction delta/history APIs and deterministic investigation endpoint. Existing payout routes remain. |
| `src/server/investigation.ts` | Computed facts, exact supporting row keys, uncertainty and optional constrained narration. |
| `src/server/server.ts` | Configures durable DB and optional webhook ID without introducing a fake verification mode. |
| `app/src/TransactionsDashboard.tsx` | Operational AG Grid, cursor synchronization, inspection, actions, investigation and evidence navigation. |
| `app/src/StudioAnalytics.tsx` | Separate native Studio chart/grid analysis and persisted report state. |
| `app/src/transactions.ts` | Browser API contracts and nullable payment/event fields. |
| `app/src/App.tsx`, `main.tsx`, `transaction.css` | Makes transaction intelligence the default while retaining the existing payout workflow; accessible responsive presentation. |
| `tests/fixtures/paypalEvents.ts`, three new test files | Clearly labeled automated Payouts events and TDD coverage. |
| `e2e/transactions.spec.ts`, `playwright.config.ts` | Real browser specifications using intercepted labeled fixtures; no payment-truth pollution. |
| `.env.example`, `.gitignore`, `package.json` | Webhook/DB configuration; excludes local DB/test artifacts; scripts and zero-cost test tooling. |
| `evidence/engineering/*`, `evidence/browser/e2e-results.txt` | Actual red/green/regression and browser-blocker output. |

## Prioritized roadmap / external unblock protocol

1. **live contract live contract:** configure Sandbox sender/receivers, `PAYPAL_WEBHOOK_ID`, and a real public HTTPS listener. Subscribe to the required Payouts/Capture events. Send one small Sandbox payment; retain raw postback `SUCCESS`, event ID, transmission ID and DB projection. Never substitute the simulator.
2. **browser proof browser proof:** provide Chromium runtime libraries or run `npm run test:e2e` on a normal Node 22 machine. Capture one uninterrupted trace from PayPal event → cursor delta → AG Grid update → inspection → chart cross-filter → saved-state reload → AI evidence navigation. Record the cold start and console.
3. **Operational hardening:** authenticated operator access, rate/body limits and deployment health checks; load-test out-of-order bursts and DB contention. Migrate to managed transactions if multi-writer scale is required.
4. **UX/performance:** lazy-load Studio, verify keyboard/context workflows, test cross-filter/state reload, benchmark large ledgers, and measure initial JS/LCP. Do not add visual widgets without an operational decision they improve.

The strongest verified alternative to live proof is therefore: 107 passing server tests, a compiling production application, an honest empty verified store, and reproducible E2E specs with a preserved launch blocker—not a fabricated end-to-end receipt.
