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
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, type SettleConfig } from "./config.ts";
import { PayPalAuth } from "./auth.ts";
import { createSettleServer } from "./routes.ts";
import { createAuditLog } from "./audit.ts";
import { seedJobs } from "./seed.ts";
import { TransactionStore } from "./transactionStore.ts";
import { AllocationStore } from "./allocationStore.ts";
import { FinancialStore } from "./financialStore.ts";
import { ProductStore } from "./productStore.ts";
import { confirmDuePayments } from "./financialPayments.ts";
import { confirmationPolicyFromEnv } from "./paymentState.ts";

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
// Email of the client being billed, set by the owner in local .env.
// Missing means invoicing is skipped with a clear reason; the payout
// still works. Never throw at startup for a missing client email.
const clientEmailRaw = (process.env.PAYPAL_SANDBOX_CLIENT_EMAIL ?? "").trim();
const clientEmail = clientEmailRaw === "" ? undefined : clientEmailRaw;
const jobs = seedJobs(receiverEmail);
const dbPath = process.env.SETTLE_DB_PATH ?? "data/settle.db";
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
const transactionStore = new TransactionStore(dbPath);
const allocationStore = new AllocationStore(dbPath);
const financialStore = new FinancialStore(dbPath);
const productStore = new ProductStore(dbPath);
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "dist");
const distReady = existsSync(join(appDir, "index.html"));
if (!distReady) {
  console.log("Dashboard is not built yet. Build it, then restart this server:");
  console.log("  cd app && npm install && npm run build");
}

const app = createSettleServer({
  jobs,
  // Durable: the legacy audit history lives in the same SQLite file as the
  // ledger and survives restarts. ":memory:" keeps the in-memory behaviour.
  audit: dbPath === ":memory:" ? undefined : createAuditLog(dbPath),
  allowlistedEmails: new Set([receiverEmail]),
  baseUrl: config?.baseUrl,
  token,
  refreshToken,
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  clientEmail,
  transactionStore,
  allocationStore,
  financialStore,
  productStore,
  webhookId: process.env.PAYPAL_WEBHOOK_ID,
  staticDir: distReady ? appDir : undefined,
});

// Durable confirmation work survives a restart. Re-arm anything that was in
// flight when the process stopped, then run the sweep on a timer so an accepted
// batch resolves without a human clicking anything.
const rearmed = financialStore.rearmConfirmations({ at: new Date().toISOString() });
if (rearmed > 0) console.log(`Re-armed ${rearmed} in-flight payment(s) for confirmation after restart.`);
const confirmationPolicy = confirmationPolicyFromEnv();
let confirming = false;
async function confirmationSweep(): Promise<void> {
  if (confirming || token === undefined || config === null) return;
  confirming = true;
  try {
    const result = await confirmDuePayments({
      store: financialStore,
      baseUrl: config.baseUrl,
      token,
      refreshToken,
      policy: confirmationPolicy,
      limit: 25,
    });
    if (result.checked > 0) {
      console.log(`Confirmation sweep: ${result.checked} due, ${result.confirmed} confirmed, ${result.stillPending} still pending, ${result.errors} read error(s).`);
    }
  } catch (err) {
    console.log(`Confirmation sweep failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    confirming = false;
  }
}
const confirmationTimer = setInterval(() => { void confirmationSweep(); }, Number(process.env.SETTLE_CONFIRM_INTERVAL_MS ?? "30000"));
confirmationTimer.unref();

const port = config?.port ?? Number(process.env.PORT ?? "3000");
const actualPort = await app.listen(port);
console.log(`Settle dashboard: http://localhost:${actualPort}/`);
console.log(`Paying is ${token !== undefined ? "on (sandbox)" : "off (no PayPal credentials)"}.`);
console.log(
  `Owner token is ${(process.env.SETTLE_OWNER_TOKEN ?? "").trim() !== "" ? "configured" : "NOT configured, approve and pay return 503 until SETTLE_OWNER_TOKEN is set in local .env"}.`,
);
console.log(
  `Invoicing is ${clientEmail !== undefined ? "on (client email set in local .env)" : "off (no client email in local .env, payouts still work)"}.`,
);
console.log("Sandbox only. Test money, no real money moves.");

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(confirmationTimer);
  await app.close();
  transactionStore.close();
  allocationStore.close();
  financialStore.close();
  productStore.close();
}
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
