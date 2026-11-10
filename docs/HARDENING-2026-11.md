# Hardening report — 2026-11-10

Scope: financial controls, audit durability, HTTP semantics, public-hosting
security, PayPal contract fidelity, end-to-end verification, CI.

## Phase 0 — forensic baseline

- Commit: `24efacb` (branch `arena/39ea2ba1-settle`, clean tree).
- Baseline verification: **314/314** server tests pass; app tests 122/122;
  production build clean; E2E startup **broken** (see finding 7).
- Stores: one SQLite file (`data/settle.db` by default) holding the
  financial ledger (payments, attempts, payout items, provider spend,
  policies, immutable `financial_audit`), transactions projection,
  allocation store and product store. WAL mode, `BEGIN IMMEDIATE`
  transactions, immutability triggers.

### Reported findings, reproduced and classified

| # | Finding | Classification | Evidence at baseline |
|---|---|---|---|
| 1 | Duplicate Pay shows `blocked — DuplicatePayout` over a paid row | **Partially confirmed.** Status stayed `paid` (an earlier fix preserved it) but the duplicate command **overwrote the row's reason** with `DuplicatePayout: this job has already been paid`, surviving until the next ledger sync. | HTTP repro: grid row after 2nd pay = `paid | reason: DuplicatePayout: …` |
| 2 | Older audit log is process memory, lost on restart | **Confirmed.** 5 rows before restart → 0 after. | HTTP repro against restarted server |
| 3 | Approving above per-payment cap → HTTP 500 | **Confirmed.** `POST /api/approve` (job $250, cap $200) → `500 {"error":"amount exceeds per-payment cap"}`. | HTTP repro |
| 4 | Hardcoded `$1,500 weekly cap` message after cap change | **Confirmed.** `decide()`, the accepted-audit text, the run-budget error and the Groq prompt embedded fixed dollar figures regardless of `owner_policies`. | code + HTTP repro |
| 5 | Unauthenticated reads expose private data | **Confirmed.** `/api/jobs` leaked recipient emails; `/api/audit`, `/api/financial/report`, `/api/transactions*`, `/api/investigate` were anonymous; `/api/product/workspaces/demo/recommend` accepted anonymous writes. No security headers, no rate limiting anywhere. | HTTP repro |
| 6 | PayPal fixtures encode wrong item shape / list endpoint / event names | **Largely already resolved** (adversarial mock uses the nested `payout_item` shape and fails the test if the undocumented list endpoint is called; `paypalShapeFixes.test.ts` guards it). **Confirmed residue:** fixtures could fabricate `PAYMENT.PAYOUTS-ITEM.PENDING`, an event PayPal does not publish; the mocked E2E asserted it. | code inspection |
| 7 | Browser E2E unreliable | **Confirmed, infrastructure.** `@sparticuz/chromium` stopped exporting `./package.json`, so `chromiumLaunchOptions()` threw before any test ran. Additionally the Studio test polled a stale localStorage key (`settle.studio.report` vs shipped `settle.studio.report.v2`) and `.ag-chart-canvas` matches no element any shipped AG package renders. | `npx playwright test` at baseline |
| 8 | CI runs only unit tests + build | **Confirmed.** No typecheck, no app tests, no E2E, no security checks, no artifacts. | `.github/workflows/ci.yml` |
| 9 | `unsafeTestOnlySql` callable from production code | **Confirmed.** Public method on both stores with no gate. | code inspection |
| 10 | Pending exposure can escape the cap | **Partially confirmed.** PENDING/UNCLAIMED/ONHOLD already counted; **`awaiting_confirmation` and `reconciliation_required` did not**, diverging from the documented `EXPOSURE_STATES`. | code inspection + new test J |
| — | Preserved strengths (one payment per job, duplicate/concurrency/cap protection, reservations, restart persistence, policy versioning, immutable financial audit, discrepancies, stale-reconciliation refusal, demo isolation, constant-time token compare, webhook verification, traversal protection, body limits, no committed secrets) | **Re-verified before and after** — all still enforced; property tests now pin them. | 325-test regression + property suite |

## Changes (root cause → fix → tests)

| File | Root cause | Change | Tests |
|---|---|---|---|
| `src/server/jobs.ts`, `src/server/agent.ts` | duplicate rejection wrote `decision_reason` onto the paid row (command outcome overwrote domain state) | DuplicatePayout no longer touches the job row at all; the rejection lives in the response + audit only | `hardening.test.ts` A, `api.test.ts` duplicate test (updated to authoritative-state semantics) |
| `src/server/audit.ts` | audit rows lived in process memory | SQLite-backed `createAuditLog(dbPath)` (`legacy_audit`, append-only triggers, same interface); memory fallback kept for pure unit tests; new `provider_failed` action separates execution failure from policy rejection; accepted-reason text now derives from the active policy | `hardening.test.ts` C, `agent.test.ts` |
| `src/server/server.ts` | — | wires the durable audit log to `SETTLE_DB_PATH` | `hardening.test.ts` C |
| `src/server/decide.ts`, `routes.ts`, `groqProposer.ts`, `app/src/App.tsx` | compiled-in `$200`/`$1,500` texts | all policy messages render the owner's configured caps (`capText`), and the model prompt no longer claims cap figures | `hardening.test.ts` I |
| `src/server/financialStore.ts` | per-payment-cap refusal threw a bare message (→500); exposure query drifted from `EXPOSURE_STATES`; `unsafeTestOnlySql` ungated | structured `PER_PAYMENT_CAP_EXCEEDED: …(policy vN)` error; `getCapSummary` consumes `EXPOSURE_STATES`; test-runner gate on `unsafeTestOnlySql` | `hardening.test.ts` B, J, H; property suite |
| `src/server/allocationStore.ts` | ungated test SQL | same gate | `hardening.test.ts` H |
| `src/server/routes.ts` | no error taxonomy, no auth on sensitive reads, no headers, no rate limits | `classifyRouteError` (400/409/413/422/500+correlation-id, internal detail logged not returned); owner/session gates on audit, report, transactions, history, investigate; email masking on `/api/jobs`; security headers everywhere; rate limits on financial writes and investigation | `hardening.test.ts` B, D, E, F; full regression |
| `src/server/productRoutes.ts` | anonymous demo `recommend`; raw 500 messages; cookie never `Secure` | session required + rate limit on recommend; login rate limit; 422 cap mapping; sanitized 500; `Secure` cookie behind HTTPS/flag; security headers on `send()` | `hardening.test.ts` G, K |
| `src/server/rateLimit.ts`, `src/server/httpSecurity.ts` | — | new modules (fixed-window limiter; headers) | `hardening.test.ts` E, G |
| `tests/fixtures/paypalEvents.ts` | fixture could invent `PAYMENT.PAYOUTS-ITEM.PENDING` | status→event map restricted to the documented Payouts event names; undocumented statuses throw unless an explicit `eventType` is passed | property suite fixture-contract test |
| `tests/transactionStore.test.ts`, `e2e/transactions.spec.ts` | consumed the invented event | stale-event scenario uses `HELD`/ONHOLD (documented) | suite runs |
| `e2e/support/browser.ts` | `require.resolve("@sparticuz/chromium/package.json")` broken by the package's exports map | resolve the main entry and derive `bin/` | E2E preflight + full run |
| `e2e/transactions.spec.ts` | `.ag-chart-canvas` matches nothing; stale storage key; no state-changing interaction before asserting serialization | stable `.transaction-studio canvas` target, versioned-key prefix check, real chart click before the persistence assertion | 30/30 E2E |
| `app/src/api.ts`, `app/src/App.tsx` | frontend assumed anonymous access to protected reads | owner-token/session headers on reads; public grid loads for anonymous visitors with audit/report panels degrading gracefully | app tests 122/122, stack E2E |
| `.github/workflows/ci.yml` | minimal pipeline | three jobs: checks (lockfile install, server typecheck, server+property+integration+contract tests, app tests, production build, TAP artifact), browser E2E (preflight separates browser-setup failure from app failure; report/screenshot artifacts), security (prod-dependency audit, committed-secret scan, security regression tests) | Experiment 8 locally |
| `package.json` | — | `fast-check` devDependency | property suite |

## Final verification (all executed, this workspace)

- Server suite: **331/331 pass** (baseline-era tests, updated where semantics
  deliberately changed, + `hardening.test.ts` acceptance tests + the 6-test
  property suite — final run: `evidence/engineering/hardening-2026-11.tap`).
- App suite: **122/122 pass**; production build clean; server typecheck clean.
- Browser E2E: **30/30 pass** — mocked UI project **and** the real-server
  stack project (actual routes, SQLite stores, scripted PayPal boundary,
  production build served by the real server).
### Acceptance experiments

| # | Experiment | Executed as | Result |
|---|---|---|---|
| 1 | Duplicate payment: pay once, pay again — row stays `paid`, no reason overwrite, rejection audited | `tests/hardening.test.ts` A; property suite I1/I2; stack E2E legacy workflow | pass |
| 2 | Audit persistence: write decisions, kill and restart the process, rows survive | `tests/hardening.test.ts` C (new process on same DB) | pass |
| 3 | Partial failure: batch where provider accepts some items and fails others — per-item `accepted`/`provider_failed` events, acceptance never overwritten | `tests/hardening.test.ts` D; `agent.test.ts` partial-failure cases | pass |
| 4 | Pending exposure: PENDING/UNCLAIMED/ONHOLD/awaiting-confirmation funds count against the weekly cap; unknown provider statuses are refused | `tests/hardening.test.ts` J; property suite I10; `financialStore` tests | pass |
| 5 | Public security sweep: anonymous requests to every sensitive read/write are denied or masked; headers + rate limits present | `tests/hardening.test.ts` E/F/G/K; `financialHttpAdversarial.test.ts`; stack E2E anonymous-dashboard test | pass |
| 6 | Error semantics: over-cap approval → 422 with stable code + policy version; malformed input → 4xx; internals never leak, 500s carry a correlation id only | `tests/hardening.test.ts` B; `financialHttpAdversarial.test.ts` | pass |
| 7 | Real-server browser payment: full workflow in a real browser against the real server + SQLite + scripted provider boundary (no API stubbing) | `e2e/stack/*` Playwright project (7 tests) | pass |
| 8 | Clean pipeline: typecheck + server/property/integration/contract tests + app tests + build + full E2E from a clean state | this verification sweep; CI mirrors it in `.github/workflows/ci.yml` | pass |

Artifacts: `evidence/engineering/hardening-2026-11.tap`,
`evidence/browser/` (screenshots + Playwright report).

## Remaining limitations

See `docs/SECURITY-HARDENING.md` (shared owner token, sessionStorage token in
the legacy dashboard, in-process rate limiting, CSRF depth, audit gating).
PayPal Sandbox webhook captures could not be refreshed from this offline
workspace; fixtures are built from the documented event contract plus the
sanitized GET evidence already in `evidence/payouts/`, and the fixture now
refuses to fabricate undocumented events.
