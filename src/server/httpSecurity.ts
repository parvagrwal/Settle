// Baseline security headers for every HTTP response the application serves.
//
// The CSP permits exactly what the built dashboard needs: same-origin
// scripts and connections, inline styles for AG Grid/Charts dynamic
// styling, data: URIs for icons and fonts. frame-ancestors 'none' replaces
// X-Frame-Options; HSTS is opt-in because it must only ever be sent over
// HTTPS deployments (SETTLE_HSTS=1).
export function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (process.env.SETTLE_HSTS === "1") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}
