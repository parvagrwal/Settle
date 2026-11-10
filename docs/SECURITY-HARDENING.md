# Public-hosting security hardening (2026-11-10)

The application is demonstrated on a publicly reachable host, so it is
treated as an exposed financial application even though only PayPal Sandbox
money moves. This document is the endpoint inventory, the controls added,
and the residual limitations.

## Endpoint security inventory

Auth legend: **owner** = `SETTLE_OWNER_TOKEN` (constant-time compare) or a
server-verified session cookie; **session** = HttpOnly `settle_session`
cookie only; **public** = intentionally anonymous.

| Route | Auth | Sensitivity / notes | Rate limit |
|---|---|---|---|
| GET `/api/jobs` | public, **recipient emails masked** unless owner/session | public demo grid; amounts and states are the demonstration surface | — |
| GET `/api/grid` | public | no recipient emails in payload | — |
| GET `/api/caps` | public | policy figures are shown on the public demo panel | — |
| GET `/api/audit` | **owner/session** (401 otherwise) | internal audit history | — |
| GET `/api/financial/report` | **owner/session** | financial position | — |
| GET `/api/financial/discrepancies`, `/control`, fees | owner | unchanged | — |
| PUT `/api/financial/policy`, POST `/control`, `/reconcile`, `/confirm` | owner | financial writes | financialWrite 60/min |
| GET `/api/transactions`, GET `/api/transactions/{id}/history` | **owner/session** | payee emails, provider ids | — |
| POST `/api/investigate` | **owner/session** | Groq-backed; must never be a public model proxy | investigate 20/min |
| GET `/api/operations`, `/api/operations/payments/{id}` | public projection, `sensitive` fields only for owner/session (pre-existing redaction) | — |
| POST `/api/operations/investigate` | public (redacted projection); Groq narration only for owner/session (pre-existing) | investigate 20/min |
| POST `/api/approve`, `/api/pay` | owner | financial writes | financialWrite 60/min |
| POST `/api/allocation/recommend`, `/plans/{id}/execute` | owner | financial writes | financialWrite (execute via pay path) |
| POST `/api/product/auth/login` | public by nature | brute-force target | **login 10 / 5 min** |
| POST `/api/product/workspaces/*/recommend` | **session required** (was anonymous — fixed) | demo decision spam | recommend 20/min |
| other `/api/product/*` writes | session + workspace ownership (server-side) | unchanged | — |
| POST `/api/webhooks/paypal` | PayPal signature postback verification | **deliberately never rate limited** so legitimate provider bursts and reconciliation cannot be refused | — |

## Controls added

- **Security headers** on every response (API, static files, fallback page):
  CSP (`default-src 'self'`, `frame-ancestors 'none'`, inline styles only —
  required by AG Grid/Charts; no `unsafe-eval`, no third-party origins),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and
  opt-in HSTS (`SETTLE_HSTS=1`, HTTPS deployments only).
- **Rate limiting** (`src/server/rateLimit.ts`): fixed-window, per client
  address and bucket, in-process (matches the single-process SQLite
  architecture; a multi-instance deployment must move counters to a shared
  store). 429 + `Retry-After`. `X-Forwarded-For` is honoured only with
  `SETTLE_TRUST_PROXY=1`.
- **Error semantics**: business-rule refusals are 4xx with stable codes
  (`PER_PAYMENT_CAP_EXCEEDED` → 422 with limit/requested/policyVersion,
  conflicts → 409, malformed JSON → 400 `MALFORMED_JSON`, oversized body →
  413). Genuine 500s return a correlation id and a generic message; the
  detail goes to the server log only.
- **Session cookies**: HttpOnly + SameSite=Strict preserved; `Secure` added
  automatically behind an HTTPS proxy (`x-forwarded-proto`) or with
  `SETTLE_SECURE_COOKIES=1`. 12-hour expiry and logout deletion preserved.
- **Test-only SQL isolation**: `unsafeTestOnlySql` (financial and allocation
  stores) now throws unless running inside the Node test runner
  (`NODE_TEST_CONTEXT`), `NODE_ENV=test`, or an explicit
  `SETTLE_ALLOW_TEST_SQL=1`. The production server sets none of these, and no
  production route ever calls it.
- **Privacy**: recipient emails masked for anonymous `/api/jobs` readers;
  the operations projection keeps its pre-existing anonymous redaction;
  Groq narration remains owner/session-gated so recipient data is not sent
  to the model for anonymous callers.

## External model data flow

`POST /api/investigate` and operations narration send transaction summaries
to Groq **only for authenticated requesters** and only when the operator has
configured `GROQ_API_KEY`. Anonymous requests never reach the model. The
legacy allocator prompt no longer embeds policy text that could go stale; it
sends job records the owner already approved for payment.

## Residual limitations (documented, not hidden)

1. **Shared owner token.** A single bearer token still authenticates "the
   owner"; sessions derived from it carry a display name but not individual
   identity. Constant-time comparison, HttpOnly sessions and expiry are in
   place, but per-user accounts with individual credentials remain future
   work; the audit trail attributes actions to the session user id where one
   exists.
2. **Owner token in browser sessionStorage** (legacy dashboard only). The
   workspace product uses the HttpOnly cookie; the legacy grid still keeps
   the entered token in sessionStorage for the tab. Tab-scoped, never
   persisted to disk, but XSS in the legacy page could read it — mitigated by
   the CSP (no external or inline scripts).
3. **In-process rate limiting** resets on restart and is per instance.
4. **CSRF**: state-changing routes require either the custom owner-token
   header (not sendable cross-origin without CORS consent — none is granted;
   responses carry no `Access-Control-Allow-Origin`) or a SameSite=Strict
   cookie, which browsers do not attach to cross-site requests. A dedicated
   CSRF token would still harden non-browser edge cases.
5. **npm audit** in CI covers production dependencies at high severity; dev
   tooling is reviewed but not gated.
