// Rate limiting for abuse-prone public routes.
//
// Fixed-window counters per client address and bucket, in process memory.
// This deployment is a single Node process in front of SQLite, so a
// process-local limiter matches the architecture; a multi-instance
// deployment would move the counters into a shared store. Webhook
// processing and reconciliation are deliberately NOT rate limited, so a
// burst of legitimate provider notifications can never be refused.
import type { IncomingMessage, ServerResponse } from "node:http";

export interface RateRule {
  /** Maximum requests per window for one client. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(bucket: string, clientKey: string, rule: RateRule, nowMs?: number): RateDecision;
}

export function createRateLimiter(): RateLimiter {
  const counters = new Map<string, { windowStart: number; count: number }>();
  return {
    check(bucket, clientKey, rule, nowMs = Date.now()): RateDecision {
      const key = `${bucket}\u0000${clientKey}`;
      const entry = counters.get(key);
      if (!entry || nowMs - entry.windowStart >= rule.windowMs) {
        counters.set(key, { windowStart: nowMs, count: 1 });
        if (counters.size > 50_000) {
          // Bounded memory: drop expired windows when the table grows.
          for (const [staleKey, stale] of counters) {
            if (nowMs - stale.windowStart >= rule.windowMs) counters.delete(staleKey);
          }
        }
        return { allowed: true, retryAfterSeconds: 0 };
      }
      entry.count += 1;
      if (entry.count <= rule.limit) return { allowed: true, retryAfterSeconds: 0 };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + rule.windowMs - nowMs) / 1000)),
      };
    },
  };
}

/** The client key: the direct socket address. The first X-Forwarded-For hop is
 * used only when the operator explicitly declares a trusted proxy, because an
 * attacker can otherwise rotate the header to dodge every limit. */
export function clientKey(req: IncomingMessage): string {
  if (process.env.SETTLE_TRUST_PROXY === "1") {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded !== "") return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

export const RATE_RULES = {
  /** Owner sign-in brute force. */
  login: { limit: 10, windowMs: 5 * 60_000 },
  /** Model-backed investigation: the Groq key must never become a public proxy. */
  investigate: { limit: 20, windowMs: 60_000 },
  /** Demo recommendation generation. */
  recommend: { limit: 20, windowMs: 60_000 },
  /** Financial writes (approve, pay, policy, control, execute). */
  financialWrite: { limit: 60, windowMs: 60_000 },
} satisfies Record<string, RateRule>;

/** Apply one bucket to this request. Returns true when the request was
 * refused (a 429 with Retry-After has been written). */
export function refuseIfLimited(opts: {
  limiter: RateLimiter;
  bucket: keyof typeof RATE_RULES;
  req: IncomingMessage;
  res: ServerResponse;
}): boolean {
  if (process.env.SETTLE_RATE_LIMIT_DISABLED === "1") return false;
  const rule = RATE_RULES[opts.bucket];
  const decision = opts.limiter.check(opts.bucket, clientKey(opts.req), rule);
  if (decision.allowed) return false;
  opts.res.writeHead(429, {
    "Content-Type": "application/json",
    "Retry-After": String(decision.retryAfterSeconds),
  });
  opts.res.end(JSON.stringify({
    error: "too many requests for this operation, try again shortly",
    code: "RATE_LIMITED",
    retryAfterSeconds: decision.retryAfterSeconds,
  }));
  return true;
}
