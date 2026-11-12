# Requirements-to-evidence matrix

**Status meanings:** “Verified” means the cited local automated/database/browser evidence exists. “Pending” means an external input is still required. No status certifies an unperformed live PayPal run or participant experiment.

| Requirement | Implementation | Automated test | Independent evidence | Status |
|---|---|---|---|---|
| Persistent workspace/studio | `ProductStore`, `product_workspaces` | Restart persistence in `productStore.test.ts` | SQLite inspection JSON | Verified locally |
| Authenticated persistent owner | Owner-token exchange, hashed persisted sessions, `product_users` | Auth API and restart tests | HttpOnly session observed in the API test | Verified locally |
| Server-side ownership/permissions | Session-derived actor + membership/owner checks | Cross-owner and anonymous denial tests | API 401/403 results | Verified locally |
| Workspace configuration and policies | `product_workspace_policies`; operational update also updates enforced financial policy | Policy persistence and adversarial policy tests | Audit records | Verified locally |
| Coherent product IA | Four task sections in the product UI | Product browser tests in `e2e/product.spec.ts` | Browser run, 80 of 80 passing | Verified locally — the product UI ships at /overview, /jobs, /payments, /controls; the older dashboard is under /legacy. |
| First-run/setup/empty/loading/error/success/permission states | Explicit states in the product UI | Backend permission tests (401/403/409) | API results; product screens render loading, empty, error and permission states | Shipped in the product UI; backend permission behaviour is tested in Node. |
| Explicit record origins | Origin/environment columns on jobs/receipts | Provenance store/API tests | SQLite inspection | Verified locally |
| Distinct verification states | Eight-state model and projection precedence | Unverified → confirmed → reconciled API test | Provider-fixture response; historical artifacts separately labelled | Verified with fixtures |
| Source references/timestamps | Job source/ingestion; payment approval/submission/provider/reconciliation fields | Financial-store persistence test | SQLite schema | Verified locally |
| Demo/operational DB separation | SQLite triggers and operational-only store methods | Demo contamination/reset tests | Database triggers and counts | Verified locally |
| Legacy path cannot bypass separation | Legacy approve/pay/execution routes stay live and owner-guarded; the legacy seed-to-financial migration is skipped when the product store is present. Product workspaces are isolated by triggers and membership. | Legacy-coexistence API test (routes live, owner token still required) | API regression output | Verified locally |
| Complete payment receipt | Receipt evidence projection, receipt detail endpoint, related job/audit | Receipt API assertions; historical receipt assertions | Provider-fixture response | Verified with fixtures; the receipt UI ships on the Payments screen |
| Missing evidence remains explicit | Six-stage complete/historical/missing timeline | Historical receipt assertions | — | Verified locally |
| Provider-backed vs reconciled distinction | Per-item reconciliation run/time and state precedence | Financial-store and operational API tests | PayPal fixture only for new path; no new live provider proof | Verified with fixtures; live pending |
| Payment history/audit persistence | Product/financial append-only tables | Restart and immutable-trigger tests | SQLite inspection | Verified locally |
| Consequential-action confirmation | Server-side: demo jobs refuse payment (409), operational actions require an owner session; legacy routes require the owner token | Product API and legacy-coexistence tests | API results | Verified locally; confirmation dialogs ship for decline and pay on the Jobs screen |
| Responsive/keyboard/accessibility | Responsive CSS, semantic controls, focus states in the product UI | Viewport and accessibility checks in `e2e/product.spec.ts` | Browser run, 80 of 80 passing | Shipped in the product UI. |
| Performance | Semantic UI; legacy dashboard libraries removed from main path | Production build | Measured from the production build: main product chunk 340 KB (100 KB gzip); full app/dist 7.3 MB, mostly the lazily loaded AG Grid/Studio chunks for the older screens | Measured from the gate build. |
| Fresh-reader five-second test | Research protocol ready | None | No participants | **Pending — not conducted** |
| Three-minute task test ≥ targets | Research protocol ready | Automated content/task support only | No participants | **Pending — not conducted** |
| Live PayPal Sandbox execution of the new product pay path | Existing provider integration preserved; product pay uses the same ledger flow | Stateful Sandbox fixture only | No new live PayPal call/credentials | **Pending external credentials** |
| Independent reconciliation of new live payment | Per-item run model ready | Fixture read-back verified | No new live provider read | **Pending external credentials** |
| Historical PayPal evidence retained | Existing `evidence/payouts*`, rehearsal and verifier files | Existing tests unaffected | Historical provider artifacts in repository | Historical only |
| Independent product evaluation | Product ready for evaluator | Automated checks are not independent evaluation | No external evaluator | **Pending** |

## Evidence index

- Database: `evidence/database/product-inspection.json`
- Backend regression: `evidence/engineering/final-regression.tap`
- Fresh-reader protocol/results register: `docs/FRESH-READER-VALIDATION.md`
- Historical PayPal: `evidence/payouts/`, `evidence/payouts-first-test/`, `evidence/rehearsal/`, `evidence/verifier/`

An application-rendered green label is not used as the sole proof of financial truth. The receipt exposes provider identifiers and the reconciliation run needed for an external reviewer to compare against PayPal itself.
