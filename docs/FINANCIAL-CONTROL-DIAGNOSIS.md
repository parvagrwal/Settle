# Financial control forensic diagnosis — HEAD 0e8bc65

**Review:** current source and executed baseline of 173 passing Node tests plus frontend build. This report distinguishes existing controls from missing controls; prior assumptions are not reused.

## Actual HTTP/payment architecture

- `POST /api/approve` and `/api/pay` call `requireOwner`; a static owner bearer/token header is required. The allocation recommendation and execution writes are also guarded. Missing configuration fails 503; missing/wrong token fails 401.
- `/api/approve` no longer accepts a replacement recipient. `/api/pay` uses server-stored jobs. `/api/pay-selected` uses owner-selected IDs and server-stored recipients.
- Legacy jobs, paid state, recipient allowlist, invoice IDs and audit rows remain process memory. Startup reseeds jobs from `data/seed.json`.
- Legacy cap arithmetic sums all currently paid in-memory job rows; it is neither a provider-timestamped rolling 168-hour calculation nor reservation-aware.
- `executeApprovedPlan` durably reserves a plan, revalidates context, submits with a stable sender batch ID, polls and checks each item. Legacy `payApprovedJobs` still maps batch status to every accepted job.
- `TransactionStore` durably retains verified Payouts-item/Payment-Capture events and projections. It is not yet the internal authorization/payment-intent ledger.
- PayPal Invoicing create/send performs genuine API read-back. Existing committed invoice evidence files are still application-generated summaries and are not raw provider evidence.

## Findings 12–22

| Finding | Root cause / actual runtime | Consequence | Architectural correction | Acceptance and verification |
|---|---|---|---|---|
| **12 — durable history** | Legacy `SettleStore` contains arrays/sets; startup calls `seedJobs`. Allocation and webhook tables are separate partial ledgers. | Restart resets paid jobs, invoice state, recipient allowlist and legacy audit. | One SQLite financial ledger linking obligations, recipients, payments, batches, items, attempts, reservations, settings, approvals, provider evidence and audit. Migrate seed rows as explicitly seeded obligations, not paid facts. | Restart integration proves every entity and identifier survives; no reseeding over existing rows. |
| **13 — seven-day cap** | `/api/pay` sums paid job amounts in memory, regardless of provider timestamp or rolling window. | Over/under-spend; restart bypasses cap; pending concurrent requests not counted. | Owner-versioned 168-hour UTC policy. Sum provider-confirmed successful item expenditure using provider timestamps, subtract only documented returned/reversed adjustments, add active reservations atomically. | Boundary tests at t−168h and t; concurrent reservations cannot exceed cap; stale reporting fails closed. |
| **14 — duplicate protection** | Legacy duplicate test is `job.status === paid`; generated batch IDs are new per run. Plan path is better but ambiguous create/poll failures become failed. | Restart/refresh/timeout can repeat payment; failed state invites unsafe retry. | Permanent internal payment ID + idempotency key, unique active/successful reservation per obligation, durable attempts and provider sender IDs. Ambiguous outcomes become `outcome_unknown` and reconcile by sender batch ID. | Replay/restart/concurrency tests make at most one provider call; crash-after-accept recovers original batch without resubmission. |
| **15 — unauthenticated approval** | `requireOwner` now exists and HTTP tests exercise it. Static token has no expiry, per-user identity, revocation, replay nonce or rate limit. | Original unauthenticated defect is addressed; token replay/theft and cross-user resource isolation remain. | Preserve fail-closed guard; add actor/session abstraction, request replay/rate controls, durable auth-failure audit and resource ownership. Do not accept body actor flags. | HTTP tests: no/wrong/forged/non-owner/replayed requests produce no side effects; valid owner works. |
| **16 — unauthenticated payment** | Payment routes now use the same guard, but server-side durable payment intent is incomplete. | Token gate alone cannot prove approval or prevent replay after restart. | Execution requires authenticated owner + server approval + verified recipient + current policy + atomic reservation. | Direct/unapproved/replay/concurrent execution tests before any provider call. |
| **17 — recipient substitution/allowlist** | Current approval ignores request recipient and payment reads job email. Allowlist is still an in-memory mutable set. | Restart loses owner authorization; no durable recipient verification history. | Server-owned recipient table, verified-at/by, allowlist version and approved-payment recipient snapshot. Separate recipient-management endpoint; execution never reads request email. | Unauthorized recipient/allowlist changes return 403; restart retains verified recipients; provider mismatch raises discrepancy. |
| **18 — hard-coded limits** | `DEFAULT_POLICY` and `/api/caps` expose $200/$1,500 constants. | Owner cannot actually configure/version safety policy; UI estimates are treated as authoritative. | Persist owner settings with effective/version history and freshness thresholds. Reservations reference policy version. | Owner-only HTTP updates validated integer minor units; old/new/actor/effective audit; restart persistence. |
| **19 — batch marked paid** | New plan execution checks item SUCCESS, recipient and amount. Legacy `payApprovedJobs` still assigns all accepted jobs paid on batch SUCCESS. | Legacy path can falsely mark failed items paid and ignores partial outcomes. | Persist item states from Payouts GET/webhooks: PENDING, SUCCESS, FAILED, UNCLAIMED, RETURNED, ONHOLD, BLOCKED, REFUNDED, REVERSED. Never use batch acknowledgement as item success. | Mixed-item integration preserves distinct statuses and identifiers; dashboard projection matches item evidence. |
| **20 — verifier outside operations** | `verifier.ts` compares stored/reporting/payout data but has no durable runs/discrepancies or scheduler. Webhook ledger is independent. | Discrepancies are not operationalized; dashboard can drift between runs. | Durable reconciliation runs/discrepancies; initial/manual/restart/stale-pending scheduling; provider orphan detection; never overwrite away conflicts. | Matching/missing/duplicate/mismatch/stale/reversed cases persist explicit results; restart schedules unresolved work. |
| **21 — invoice evidence** | Invoicing code reads genuine provider objects, but stored invoice history resets and repository evidence includes app summaries. | Invoice existence/status/payment linkage cannot be independently reconstructed after restart; invoice may be mistaken for payment proof. | Durable invoice and protected provider-response tables with endpoint, environment, retrieval time, correlation and SHA-256 integrity. Separate invoice, payout and reporting evidence classes. | GET provider invoice stored verbatim; identifiers/amount/jobs survive restart; no invoice implies paid claim. |
| **22 — dashboard evidence** | Legacy grid reads memory; transaction grid reads verified events; cap UI derives from paid rows. | Two views can disagree and legacy status is not independently reconciled. | Single server reconciliation projection joining internal intent/approval and provider item evidence; cap API returns server-calculated spend, reservations, window and freshness. | UI contains no financial authority; independent API comparison matches provider fixtures; discrepancies visible. |

## Additional weaknesses

- `ownerAuth` authenticates one shared owner only; no non-owner role model at HTTP boundary, expiration/revocation, CSRF model documentation, CORS policy or rate limiting.
- `planExecution` catches provider create/poll errors and calls `failExecution`; an accepted-but-unrecorded request can therefore be mistaken for safe-to-retry failure.
- `TransactionStore` does not preserve sender batch ID, internal payment/idempotency IDs, activity ID or execution-attempt relationship.
- Provider raw JSON is stored without a general integrity/reference model or retention policy.
- No durable job scheduler exists for restart/stale reconciliation.
- No migration imports existing paid seed rows into provider-confirmed expenditure; they must not silently become verified spend.
- Shared static token in browser sessionStorage is appropriate only for a single-owner Sandbox prototype, not production identity.

## Target architecture

```text
Owner authentication → function/resource authorization
                            ↓
Server obligations + verified recipients + owner policy versions
                            ↓
        Atomic SQLite BEGIN IMMEDIATE reservation transaction
  current provider-backed spend + active reservations + proposal <= cap
  permanent payment ID / idempotency key / approved recipient / policy hash
                            ↓
Durable execution attempts → PayPal sender_batch_id = stable internal key
       ↓ ambiguous: OUTCOME_UNKNOWN, never blind retry
Payout batch + item reads / verified webhooks / Transaction Search
                            ↓
Durable provider evidence + reconciliation runs + discrepancies
                            ↓
Item-level payment state machine and rolling-spend projection
                            ↓
Dashboard: internal authorization + independently reconciled provider truth
```

PayPal establishes external execution. SQLite establishes internal authorization, intent, reservation, idempotency and audit. Neither alone is presented as the other's proof.

## Dependency-ordered migration plan

1. **Exposure:** preserve owner guards; add adversarial HTTP coverage and durable security audit. Stop legacy batch-level paid projection from being used as evidence.
2. **Ledger:** additive financial schema/migrations, recipient/policy/approval/payment identity, stable attempt and provider item chain. Migrate existing verified events by reference, not duplicate event facts.
3. **Controls:** versioned owner policy, provider-timestamp rolling-spend reader, freshness gate, atomic reservations and permanent replay protection.
4. **Recovery/reconciliation:** ambiguous attempt recovery, item state transitions, durable runs/discrepancies/scheduling, genuine invoice evidence.
5. **Projection/UI:** authoritative cap/status/discrepancy endpoints and dashboard migration. Keep old routes working through the new service or return explicit legacy-disabled responses rather than silently bypassing controls.
6. **Proof:** permanent financial-invariants suite, adversarial HTTP, restart/concurrency/crash recovery and provider-fixture reconciliation. Live PayPal evidence only when credentials are available.

### Cap semantics proposed for explicit owner configuration

Default policy remains USD, 168 rolling hours inclusive of `t`, based on the provider payout-item `time_processed` (fallback only to a documented provider timestamp, never local receipt time). SUCCESS counts as expenditure. RETURNED/REVERSED/REFUNDED create separately visible adjustments against the original payment; FAILED/UNCLAIMED/PENDING/ONHOLD/BLOCKED do not count as confirmed spend. Active reservations count in full. No mixed-currency summation. If fresh provider-backed reconciliation is unavailable beyond the owner threshold, new reservations fail closed. Existing local data cannot be relabelled provider-confirmed.

## Implementation & Verification Status

- **Durable financial core (`src/server/financialStore.ts`)**: SQLite WAL ledger (`BEGIN IMMEDIATE` reservation & submission transactions, immutable trigger-guarded `financial_audit`, owner-versioned 168-hour USD policy, verified recipients, permanent payment identities `settle-payment-<jobId>`, single-flight `execution_attempts`, item-level `payout_items`, provider-timestamped `provider_spend` with bounded reversal adjustments, `reconciliation_state`, idempotent `reconciliation_discrepancies` keyed by canonical fact identity, and SHA-256 `invoice_evidence`). Provider recipient/amount/currency mismatches persist a discrepancy outside the rejected item transaction, so a rollback cannot erase the conflict.
- **Provider submission & reconciliation (`src/server/financialPayments.ts`, `src/server/planExecution.ts`)**: Pre-submission reconciliation establishes freshness before reservation; reservations capture timestamps monotonically after reconciliation completes; every payout item is submitted with its permanent `sender_batch_id` / `sender_item_id` and confirmed strictly from terminal item-level provider evidence (`SUCCESS`), never from batch-create acknowledgement alone; network/polling drops after submission transition to durable `outcome_unknown` (HTTP `202`), retain active cap reservations, refuse blind resubmission, and recover via `reconcilePayPal`. Pre-submission refusals (`CAP_EXCEEDED`, stale reconciliation) fail cleanly without falsely claiming `outcome_unknown`.
- **HTTP control plane & restart synchronization (`src/server/routes.ts`, `src/server/server.ts`, `app/src/`)**:
  - `GET /api/caps` reports durable policy version, freshness threshold, 168-hour rolling `eligibleSpendCents`, `activeReservationsCents`, `remainingCents`, and reconciliation `fresh` state; `ApprovalPanel.tsx` and `App.tsx` read these server-computed numbers rather than summing local grid rows.
  - `FinancialControls.tsx` provides owner-only policy updates, provider reconciliation, and unresolved discrepancy visibility; the result screen treats HTTP `202` / `OUTCOME_UNKNOWN` as an explicit unresolved state with a reconcile action and never claims either paid or unpaid.
  - Owner-guarded `PUT /api/financial/policy`, `GET /api/financial/discrepancies`, `POST /api/financial/reconcile`, `POST /api/approve`, `POST /api/pay`, and `POST /api/allocation/plans/:id/execute`. Policy inputs are validated as integer USD minor units with `0 <= perPaymentCapCents <= capCents` and positive freshness.
  - Startup synchronizes verified recipients, approved jobs, confirmed payouts, item-level failed payouts, ambiguous/non-terminal provider holds, and invoiced job IDs from `FinancialStore` across restarts (`SETTLE_DB_PATH` / `data/settle.db` with clean `SIGINT`/`SIGTERM` shutdown), while pre-seeded demo paid rows are never imported as verified provider spend.
- **Executed local verification (offline / mocked provider fixtures)**:
  - Full Node test suite: **194/194 passing** (`evidence/engineering/full-regression.tap`), including `tests/financialStore.test.ts` (**11/11**), `tests/financialPayments.test.ts` (**3/3**), `tests/planExecution.test.ts` (**4/4**), and `tests/financialHttpAdversarial.test.ts` (**7/7** covering auth boundaries and invalid policy values, full server restart durability, durable failed-item projection, same-job and cross-job cap concurrency races, HTTP `202` `OUTCOME_UNKNOWN` + `/api/financial/reconcile` recovery, ambiguous plan execution, and idempotent orphan discrepancy surfacing).
  - Frontend production build (`cd app && npm run build`): **passing** (`tsc -b && vite build`, `evidence/engineering/frontend-build.txt`).
- **Explicit non-claims**: Live PayPal Sandbox API calls, live webhook postbacks, live Groq calls, and Playwright browser E2E runs were **not** executed in this sandbox (credentials absent and Chromium system libraries unavailable offline); mocked provider tests are recorded strictly as local engineering verification, not live provider evidence.
