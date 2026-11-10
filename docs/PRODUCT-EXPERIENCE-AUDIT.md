# Initial product-experience audit

**Audited HEAD:** `fdaa3da`  
**Audit date:** 2026-11-10  
**Method:** repository inspection, SQLite/schema review, API inspection against a running server, baseline automated tests, and Chromium inspection of the existing transaction and receipt UI.

**Adaptation note (this pack):** the 410 correction for the legacy demo routes was not adopted. The legacy approve/pay/execution routes stay live and owner-guarded, because the locked live run and the dashboard demo use them; the product API enforces its own session/membership checks instead. The “Demo path could bypass new boundaries” row below records the original recommendation; the shipped behaviour is described in `PRODUCT-DELIVERY.md`.

## Baseline evidence

- 194 Node tests passed before changes.
- Frontend production build passed, but emitted a 5.87 MB JavaScript bundle warning.
- Existing browser suite reproduced its documented result: 2/3 passed; AG Studio failed.
- The running verified-event API returned an empty ledger, correctly showing an explicit empty state.
- The separate seeded jobs API returned four paid historical references plus synthetic waiting jobs. Those jobs were process-local and had no complete evidence chain.
- The original pitch deck and original demonstration video were not present anywhere in the tracked repository. They were therefore **unavailable audit inputs**, not reviewed artifacts.

## Findings 36–38: root-cause analysis

The mission’s three weaknesses are treated as findings 36–38.

| Finding | Root cause | Relevant component/entity | Behaviour at audited HEAD | User consequence | Required correction | Acceptance criteria | Verification |
|---|---|---|---|---|---|---|---|
| 36 — POC rather than complete product | Three independently introduced feature surfaces were composed behind “Allocation agent,” “Verified transactions,” and “Legacy payout workflow”; no persistent studio/owner product boundary joined them. | `App.tsx`, `server.ts`, process-local `Job[]`, owner token | First view was transaction intelligence; job workflow and allocation were separate destinations. A token input was not a user/session/workspace identity. | A visitor had to infer the product’s primary task and mentally assemble the workflow. Restarted jobs looked current despite being re-seeded. | Establish a persistent owner/workspace model and one task-based IA. Make first-run, setup, empty/error/success and permission states deliberate. | A first screen explains audience/problem/agent/owner; one operational workflow reaches receipt and controls; records survive restart. | `productStore.test.ts`, `productApi.test.ts`, operational Playwright setup/reload test, fresh-reader protocol (research still pending). |
| 37 — sample, historical, current and PayPal evidence difficult to distinguish | Provenance was inferred from prose, job IDs and separate stores. No common origin/environment/verification model joined jobs, receipts and reconciliation. | `seed.json`, `seed.ts`, `Job`, `FinancialStore`, `TransactionStore`, transaction badges | Historical batch IDs appeared beside synthetic jobs. Webhook postback verification and provider payout confirmation used different UI language. A global reconciliation timestamp did not prove a specific payment was read. | A green/paid label could be over-interpreted as independently verified. Historical and current records were easy to conflate. | Add explicit origin, environment, verification state, source/ingestion/provider timestamps, payment links and per-item reconciliation run/time. Enforce demo/operational boundaries in SQLite and backend routes. | Every product job/receipt exposes origin/environment/verification; historical references say not reconciled; demo cannot obtain permanent payment identity; provider-confirmed is not labelled reconciled. | Database triggers and isolation tests, provider-fixture state-transition test, receipt RTL/E2E inspection, SQLite evidence. |
| 38 — no demonstrated three-minute comprehension | Existing docs acknowledged no participant research; UI assumed developer explanation and used internal concepts such as “legacy,” “allocation,” and “AG Studio.” | Landing/header/navigation, `docs/USER-RESEARCH.md` | Product purpose was technically described, but the intended user and agent/human boundary were not consistently visible in the workflow. No five-second or task-test evidence existed. | Team familiarity could be mistaken for usability. | Rebuild the first screen around audience/problem/agent/control; provide a timed script and independent research protocol with measurable tasks. | Product exposes the tested information without narration; five fresh participants can be recruited and evaluated without coaching. Results must be reported only if actually collected. | Automated content/navigation checks support the hypothesis; actual participant validation remains **uncompleted**. |

## Additional maturity issues directly affecting trust or comprehension

| Weakness | Root cause and entity | User consequence | Correction and acceptance | Verification |
|---|---|---|---|---|
| Shared token mistaken for owner identity | `ownerAuth.ts` verified a secret but returned no actor; routes wrote `actorId: "owner"`. | No persistent authenticated identity, membership or owner audit attribution. | Token exchange now creates a server-side persisted session and user; membership is checked on every operational read/write. | Auth API tests; owner persistence test; HttpOnly cookie check. |
| Demo path could bypass new boundaries | Legacy `/api/approve`, `/api/pay`, and allocation execution remained available. | A hidden route could still put demo jobs into the real financial ledger. | Legacy mutations return 410 when `ProductStore` is enabled; legacy seed-to-financial migration is skipped. **Not adopted in this pack:** the legacy routes stay live and owner-guarded; the seed migration is still skipped when the product store is present. | Legacy-coexistence API test (routes live, owner token still required). |
| Receipt lifecycle could imply completeness | Existing history focused on webhook events, not internal authorization/submission/provider/reconciliation distinctions. | Missing evidence was difficult to see; timestamps could be collapsed conceptually. | Six-stage receipt timeline with complete/historical/missing states; unsupported fields say unavailable. | RTL receipt test, desktop/mobile E2E and screenshots. |
| Reconciliation was global rather than payment-specific | `reconciliation_state` held only `last_success_at`. | A successful run did not prove a particular payout item was observed. | `reconciliation_runs` plus per-item `last_reconciled_at`, `reconciliation_run_id`, and `ingested_at`. | Financial-store restart test and operational API state-transition test. |
| Settings appeared disconnected from workspace | Financial policy was durable but had no studio/workspace membership relation. | It was unclear whose policy was displayed or changed. | Workspace policy is owned, audited and persisted; operational updates also update the existing enforced financial policy. | Store restart test, controls UI and backend authorization tests. |
| Error/permission/first-run paths were secondary | Main app began with sample rows and parallel requests to legacy endpoints. | Network failure or missing auth could leave ambiguous sample/current state. | No operational fallback to samples; explicit loading, recoverable error, private sign-in, setup, empty, success and unconfigured-provider states. | RTL error test and Playwright error recovery/setup tests. |
| Excessive frontend machinery | AG Grid/AG Studio/charts loaded into the initial route. | Large bundle and module errors obscured core records. | Core product uses semantic HTML lists/tables/details; legacy components remain in repository but leave the main bundle. | Build: ~254 KB JS; Lighthouse 98 performance; no AG module errors in product E2E. |
| Responsive and accessibility gaps | Dense grid/drawer layout and multiple badge styles. | Harder mobile inspection and keyboard comprehension. | Responsive navigation/receipt layout, visible focus, 44px controls, accessible names, confirmation dialog focus loop/Escape, reduced-motion support. | Mobile keyboard E2E, visual regression, axe and Lighthouse accessibility. |
| Research and external proof claims were easy to overstate | Historical evidence and illustrative scenario docs coexisted with product claims. | Judges might infer customer validation or new live Sandbox execution. | Evidence matrix distinguishes automated fixtures, historical artifacts, unavailable live runs and uncompleted participant research. | Documentation review; no fabricated results. |

## Diagnosis of the original first-time experience

- **Purpose:** technically stated, but buried beneath product-view navigation and transaction terminology.
- **Audience:** “small studio” was present, yet the primary transaction view did not make the studio owner’s task dominant.
- **Agent contribution:** split between allocation and legacy payment selection; its exact boundary required reading multiple screens/docs.
- **Owner identity:** a shared token was present, not an authenticated persistent user/workspace.
- **Financial controls:** enforced by backend code, but their workspace relationship and current authoritative state were not obvious.
- **Provenance:** partial prose labels, no unified data model.
- **Independent payment inspection:** webhook history existed, but did not cover the complete internal-to-provider receipt chain.
- **Historical/current distinction:** seed jobs reappeared as current on restart; financial/webhook records used separate views.
- **Operational completeness:** strong financial primitives, incomplete product shell and task continuity.

## Post-correction status

Implementation acceptance is evidenced by the automated and browser results in `PRODUCT-DELIVERY.md`. The independent three-minute participant experiment remains pending. The product now exposes the information required by that experiment, but exposing information is not proof that fresh participants understand it.
