// S4 paypalClient — one place that talks to PayPal.
// Bearer header, unique PayPal-Request-Id, 401 refresh-once, 429 backoff,
// 5xx retry with the SAME PayPal-Request-Id and the SAME sender_batch_id.
// A retry must never create a second payment. That is the idempotency rule.
import { PayPalAuthError } from "./auth.ts";

export type FetchFn = typeof fetch;

export class PayPalError extends Error {
  status: number;
  paypalName: string;
  debugId: string | null;
  constructor(status: number, paypalName: string, message: string, debugId: string | null = null) {
    super(message);
    this.status = status;
    this.paypalName = paypalName;
    this.debugId = debugId;
  }
}

export interface PayPalRequestOptions {
  method: "GET" | "POST";
  path: string;
  token: string;
  body?: unknown;
  requestId?: string;
  /** Called once on a 401, must return a fresh token. If absent, 401 throws. */
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
  maxAttempts?: number;
}

export interface PayPalResponse {
  status: number;
  json: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function paypalRequest(opts: PayPalRequestOptions): Promise<PayPalResponse> {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxAttempts = opts.maxAttempts ?? 3;
  let token = opts.token;
  // One requestId per logical request, reused on every retry of that request.
  const requestId = opts.requestId ?? crypto.randomUUID();
  let refreshed = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // opts.path is a full URL. Callers pass baseUrl + path, see payouts.ts.
    const res = await fetchFn(opts.path, {
      method: opts.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "PayPal-Request-Id": requestId,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.ok) return { status: res.status, json };

    // 401: refresh once, then retry with the fresh token, same requestId.
    if (res.status === 401 && opts.refreshToken && !refreshed) {
      refreshed = true;
      token = await opts.refreshToken();
      continue;
    }
    // 429: back off, then retry, same requestId. Respect Retry-After if present.
    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfter = res.headers?.get?.("Retry-After");
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : 1000 * attempt;
      await sleep(Number.isFinite(waitMs) ? waitMs : 1000 * attempt);
      continue;
    }
    // 5xx: retry with the SAME requestId, so PayPal does not create a second payment.
    if (res.status >= 500 && attempt < maxAttempts) {
      await sleep(1000 * attempt);
      continue;
    }
    const name = typeof json.name === "string" ? json.name : "PAYPAL_ERROR";
    const message = typeof json.message === "string" ? json.message : `PayPal request failed, HTTP ${res.status}`;
    const debugId = typeof json.debug_id === "string" ? json.debug_id : null;
    throw new PayPalError(res.status, name, message, debugId);
  }
  throw new PayPalError(429, "RETRY_EXHAUSTED", "PayPal request failed after retries");
}

export { PayPalAuthError };
