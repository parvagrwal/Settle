# Product delivery, tests and limitations

## Delivered product

The application now opens as a coherent studio payment-operations product. It includes persistent authenticated operational setup, a separate illustrative workspace, durable jobs and decisions, owner policy controls, explicit record provenance, payment lifecycle receipts, independent reconciliation identities, and responsive/accessibility states.

Detailed documents:

- `PRODUCT-EXPERIENCE-AUDIT.md`: initial diagnosis and findings 36–38.
- `PRODUCT-ARCHITECTURE.md`: identity, schema, provenance, isolation and receipt architecture.
- `DEMONSTRATION.md`: timed demonstration workflow.
- `FRESH-READER-VALIDATION.md`: participant protocol and explicit uncompleted status.
- `REQUIREMENTS-EVIDENCE-MATRIX.md`: requirement-by-requirement evidence and pending external proof.

## Code changes and rationale

| Files | Reason | Relevant tests |
|---|---|---|
| `src/server/productStore.ts` **new** | Durable users/sessions/workspaces/memberships/jobs/decisions/policies/receipts/audit; explicit provenance; database isolation triggers. | `tests/productStore.test.ts`, database inspection |
| `src/server/productRoutes.ts` **new** | Server-verified sessions, workspace APIs, operational-only payment and reconciliation, receipt detail/raw provider evidence. | `tests/productApi.test.ts`, existing adversarial API regression |
| `src/server/ownerAuth.ts` | Reuse existing owner secret verification for session issuance without trusting browser identity. | `tests/ownerAuth.test.ts`, product auth tests |
| `src/server/server.ts`, `routes.ts` | Wire the shared durable product store and product API alongside the existing dashboard routes; the legacy approve/pay/execution routes stay live and owner-guarded. | Product API tests plus all existing route/financial tests |
| `src/server/financialStore.ts` | Add reconciliation runs and per-item ingestion/reconciliation/run fields; preserve full payment timing in projections; additive migration. | `financialStore.test.ts`, `financialPayments.test.ts` |
| `src/server/financialPayments.ts` | Associate independent provider reads with a durable run and specific payout items; mark failed runs without claiming success. | Existing crash/orphan tests and new evidence persistence test |
| `app/src/productApi.ts` **new** | Typed same-origin product API client and error handling. No dashboard consumer in this pack yet; the API is exercised by the Node product API tests. | `tests/productApi.test.ts` (server side) |
| `app/index.html` | Product metadata and title. | Dashboard build |
| `app/src/testSetup.ts`, `vitest.config.ts` **new** | React Testing Library runner and setup, installed for future component tests. No component test ships in this pack (the one written covered the superseded product UI). | None yet |
| `tests/productStore.test.ts`, `productApi.test.ts` **new** | Persistence, ownership, provenance, legacy-route coexistence, and complete provider-fixture lifecycle. | Included in Node regression |
| `tests/financialStore.test.ts` | Reconciliation evidence and restart assertions. | Included in Node regression |
| `scripts/inspect-product-db.ts` **new** | Direct read-only provenance/isolation inspection without exposing sessions or operational recipients. | `evidence/database/product-inspection.json` |
| `docs/PRODUCT-*.md`, `DEMONSTRATION.md`, `FRESH-READER-VALIDATION.md` **new** | Product architecture, delivery record, experience audit, evidence matrix, demo workflow and fresh-reader protocol. | Documentation review |
| `docs/USER-RESEARCH.md` | Pointer to the fresh-reader protocol; the unvalidated-research limitation is unchanged. | Documentation review |
| Package manifests/locks | React Testing Library / Vitest / jsdom test tooling in the dashboard. | Install/build results |

The dashboard is unchanged in this pack: it is still the existing grid-and-allocation dashboard, and it is the main React bundle. The product work lands as a backend surface (the product API, workspace store and receipt model) with its own docs and Node tests, not as a replacement dashboard. The product UI that this delivery originally replaced the dashboard with is not in this pack, and the product API has no dashboard consumer yet.

## TDD record

1. **RED/GREEN:** product-model tests were run against the missing store, then implemented; reconciliation-run persistence and raw provider-evidence tests were run against missing fields, then implemented.
2. **REGRESSION:** the complete Node suite below, plus the strict type check and the dashboard production build.

The first-run UI tests and the product browser journeys were written against the product UI described in the original delivery. That UI is not in this pack, so their evidence files are not included here; the runner and setup for future component tests are installed.

## Actual test results

| Check | Actual result | Evidence |
|---|---|---|
| Node unit/integration/database/API | **205 passed, 0 failed** | `evidence/engineering/final-regression.tap` |
| React Testing Library | **Not shipped in this pack.** The component test covered the superseded product UI; the runner and setup are installed for future component tests. | — |
| TypeScript + Vite production build | **Passed**; dashboard bundle 5,866 kB JS / 1,638 kB gzip (the existing grid dashboard, unchanged) | Build output |
| Playwright product workflows | **Not shipped in this pack.** The product journeys covered the superseded product UI. The legacy browser spec is unchanged. | — |
| Direct SQLite inspection | 4 synthetic demo jobs; 1 historical-only receipt; 0 linked demo payments; isolation triggers present | `evidence/database/product-inspection.json` |
| Dependency audit | 0 production vulnerabilities; test tooling updated to 0 audit findings | npm audit output during delivery |
| Live PayPal calls | **Not performed** | External credentials unavailable |
| Fresh-reader participants | **0; not conducted** | `FRESH-READER-VALIDATION.md` |

## Measured iterative improvement loops

| Loop | Measurable weakness and root cause | Improvement and measured result |
|---|---|---|
| A — Product identity | First screen led with transaction tooling and three technical destinations. | The product UI that carried the audience/problem/agent/owner first screen is not in this pack; the dashboard is unchanged. The product backend (workspace, provenance, receipts) is in place, and the fresh-reader protocol describes the task path. No participant evidence yet. |
| B — Workspace completeness | Process-local jobs and shared token had no durable owner/studio relation. | Owner/session/workspace/job/policy restart tests pass in Node. The operational browser reload journey is not in this pack. |
| C — Provenance | Origin inferred from seed prose and separate stores. | Explicit origin/environment on every product job/receipt; direct SQLite inspection confirms values. |
| D — Financial trust | Global reconciliation time and incomplete receipt chain. | Per-item run/time plus six-stage timeline and raw provider object; fixture lifecycle passes. |
| E — Cognitive load | 5.87 MB dashboard bundle and technical navigation obscured core task. | Not shipped in this pack: the dashboard bundle is still 5.87 MB, and the lighter product UI that replaced it is not included. |
| F — Interaction quality | Mobile overflow and contrast failures found in actual Chromium. | The mobile/contrast fixes were for the superseded product UI and are not in this pack. Backend error recovery (401/409 on the product API, owner-token refusal on legacy routes) is tested in Node. |
| G — Three-minute comprehension | No participants available. | Protocol and demo script prepared; experiment explicitly remains uncompleted. |
| H — Technical correctness | Legacy demo routes could bypass the new boundary. | Not adopted in this pack: the legacy approve/pay/execution routes stay live and owner-guarded, because the locked live run and the dashboard demo use them. The product API enforces its own session/membership checks, and a Node test asserts the legacy routes are live and still require the owner token. All 205 backend tests, including financial adversarial cases, pass. |

## Remaining limitations

1. **No fresh-reader evidence.** Five external participants still need to run the five-second and three-minute protocol. The 4/5 thresholds are not claimed.
2. **No new live PayPal execution.** The new lifecycle was verified with stateful provider fixtures, not a newly credentialed PayPal Sandbox account. Historical Sandbox artifacts remain separate historical evidence.
3. **Single-owner/single-operational-ledger scope.** The existing shared owner-token provider is upgraded with real server sessions, not replaced by a multi-user IdP. One operational workspace per authenticated owner avoids implying workspace-level isolation in the older global financial ledger.
4. **Sandbox only.** Production configuration remains refused. `paypal_production` is a provenance enum for future support, not a claim of Production capability.
5. **Reconciliation window.** Existing reconciliation reads the provider’s recent 169-hour window. Older historical references may remain historical-only rather than being reconciled by this workflow.
6. **Accessibility scope.** Automated checks cover key views and mobile/keyboard flows; they are not a complete manual WCAG audit or screen-reader user study.
7. **Missing source artifacts.** The original pitch deck and demonstration video were absent from the audited repository and could not be assessed.
8. **Market validation remains open.** The studio problem and time-saving value have not been validated with actual studio owners; the demo is software evidence, not customer research.

## Reviewer next steps

- Explore the live demonstration and inspect its historical receipt without credentials.
- Review direct SQLite provenance and isolation evidence.
- Run the full automated suite independently.
- Configure a separate PayPal Sandbox account and perform a live provider/reconciliation check, saving provider-side evidence.
- Recruit five fresh participants and complete the research register without developer coaching.
