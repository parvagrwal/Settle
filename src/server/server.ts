// Dashboard server — serves the API plus the built dashboard, on one port.
// Run from the repo root: npm start
// Then open http://localhost:3000/ in a browser.
// The dashboard is served from app/dist, so build it first:
//   cd app && npm install && npm run build
// If the dashboard is not built yet, the server still starts, serves the
// API with the seed jobs, and says so on the home page.
// PayPal is optional at startup: without sandbox credentials in local
// .env, the dashboard still loads with the seed jobs, and paying returns
// a clear "not configured" answer instead of failing. No PayPal secret
// reaches the browser, ever. Sandbox only, test money, no real money moves.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, type SettleConfig } from "./config.ts";
import { PayPalAuth } from "./auth.ts";
import { createSettleServer } from "./routes.ts";
import { seedJobs } from "./seed.ts";

function loadEnv(path = ".env"): void {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // No .env file. loadConfig will throw a clear error naming the missing key.
  }
}

loadEnv();

let config: SettleConfig | null = null;
try {
  config = loadConfig();
} catch (err) {
  const message = err instanceof Error ? err.message : "unknown error";
  console.log(`PayPal is not configured, dashboard runs with seed data only: ${message}`);
}

let token: string | undefined;
let refreshToken: (() => Promise<string>) | undefined;
if (config !== null) {
  const auth = new PayPalAuth(config.baseUrl, config.clientId, config.clientSecret);
  try {
    token = await auth.getToken();
    console.log("PayPal sandbox token received. Token is NOT printed.");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.log(`PayPal token fetch failed, paying is off until credentials are fixed: ${message}`);
  }
  refreshToken = async (): Promise<string> => {
    auth.invalidate();
    return auth.getToken();
  };
}

const receiverEmail = config?.receiverEmail ?? "sandbox-receiver@example.com";
const jobs = seedJobs(receiverEmail);
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "dist");
const distReady = existsSync(join(appDir, "index.html"));
if (!distReady) {
  console.log("Dashboard is not built yet. Build it, then restart this server:");
  console.log("  cd app && npm install && npm run build");
}

const app = createSettleServer({
  jobs,
  allowlistedEmails: new Set([receiverEmail]),
  baseUrl: config?.baseUrl,
  token,
  refreshToken,
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  staticDir: distReady ? appDir : undefined,
});

const port = config?.port ?? Number(process.env.PORT ?? "3000");
const actualPort = await app.listen(port);
console.log(`Settle dashboard: http://localhost:${actualPort}/`);
console.log(`Paying is ${token !== undefined ? "on (sandbox)" : "off (no PayPal credentials)"}.`);
console.log("Sandbox only. Test money, no real money moves.");
