// S4 auth — PayPal OAuth2 client credentials, sandbox only.
// POST /v1/oauth2/token, Basic Auth, grant_type=client_credentials.
// Token is cached until expires_in, refreshed proactively.
// Never log the token, the Client Secret, or the full Authorization header.
export type FetchFn = typeof fetch;

export interface TokenResult {
  accessToken: string;
  expiresInSeconds: number;
  expiresAtMs: number;
}

export async function fetchAccessToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  fetchFn: FetchFn = fetch,
): Promise<TokenResult> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const res = await fetchFn(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Language": "en_US",
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const name = typeof json.name === "string" ? json.name : "AUTH_FAILED";
    const message = typeof json.error_description === "string" ? json.error_description : "failed to get access token";
    throw new PayPalAuthError(res.status, name, message);
  }
  const accessToken = json.access_token;
  const expiresIn = json.expires_in;
  if (typeof accessToken !== "string" || typeof expiresIn !== "number") {
    throw new PayPalAuthError(res.status, "AUTH_FAILED", "token response had no access_token or expires_in");
  }
  return { accessToken, expiresInSeconds: expiresIn, expiresAtMs: Date.now() + expiresIn * 1000 };
}

export class PayPalAuthError extends Error {
  status: number;
  name: string;
  constructor(status: number, name: string, message: string) {
    super(message);
    this.status = status;
    this.name = name;
  }
}

// Small cache for the live script. Refresh when less than 60 seconds remain.
// Note: no TypeScript parameter properties here. Node strip-only mode does
// not support `private` in a constructor parameter list, so fields are
// declared and assigned explicitly, like the rest of the S2 code.
export class PayPalAuth {
  private cached: TokenResult | null = null;
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private fetchFn: FetchFn;
  constructor(baseUrl: string, clientId: string, clientSecret: string, fetchFn: FetchFn = fetch) {
    this.baseUrl = baseUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetchFn = fetchFn;
  }
  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAtMs - 60_000) {
      return this.cached.accessToken;
    }
    this.cached = await fetchAccessToken(this.baseUrl, this.clientId, this.clientSecret, this.fetchFn);
    return this.cached.accessToken;
  }
  // For tests only: force the next call to fetch a fresh token.
  invalidate(): void {
    this.cached = null;
  }
}
