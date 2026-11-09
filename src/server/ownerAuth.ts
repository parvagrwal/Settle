// Owner token — the one secret that guards the money-moving routes.
// The token lives in local .env only, as SETTLE_OWNER_TOKEN. It never
// reaches the repo, the bundle, or a log. Without it configured, the
// guarded routes refuse with 503; with it configured, a missing or
// wrong token is 401. The comparison is constant-time, so a wrong token
// reveals nothing about the right one.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function ownerTokenConfigured(): boolean {
  return (process.env.SETTLE_OWNER_TOKEN ?? "").trim() !== "";
}

function presentedToken(req: IncomingMessage): string | null {
  const header = req.headers["x-settle-owner-token"];
  if (typeof header === "string" && header !== "") return header;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    if (token !== "") return token;
  }
  return null;
}

export function requireOwner(
  req: IncomingMessage,
): { ok: true } | { ok: false; status: number; error: string } {
  const configured = (process.env.SETTLE_OWNER_TOKEN ?? "").trim();
  if (configured === "") {
    return {
      ok: false,
      status: 503,
      error: "owner token is not configured, set SETTLE_OWNER_TOKEN in local .env only",
    };
  }
  const presented = presentedToken(req);
  if (presented === null) {
    return { ok: false, status: 401, error: "owner token is required for this route" };
  }
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(configured, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "owner token is wrong" };
  }
  return { ok: true };
}
