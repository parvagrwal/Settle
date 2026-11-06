// Payouts config — PayPal sandbox only, never live.
// Secrets live in local .env only, never in code, never in a message, never committed.
// Read .env.example for the names. Do NOT paste a secret in a message.
export interface SettleConfig {
  clientId: string;
  clientSecret: string;
  env: "sandbox";
  baseUrl: string;
  receiverEmail: string;
  port: number;
}

export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export function loadConfig(env: Record<string, string | undefined> = process.env): SettleConfig {
  const paypalEnv = env.PAYPAL_ENV ?? "sandbox";
  if (paypalEnv !== "sandbox") {
    throw new Error("config: PAYPAL_ENV must be 'sandbox'. Live money is never used in Settle.");
  }
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  const receiverEmail = env.PAYPAL_SANDBOX_RECEIVER_EMAIL;
  if (!clientId) throw new Error("config: PAYPAL_CLIENT_ID is missing. Fill it in local .env only.");
  if (!clientSecret) throw new Error("config: PAYPAL_CLIENT_SECRET is missing. Fill it in local .env only.");
  if (!receiverEmail) throw new Error("config: PAYPAL_SANDBOX_RECEIVER_EMAIL is missing. Fill it in local .env only.");
  return {
    clientId,
    clientSecret,
    env: "sandbox",
    baseUrl: SANDBOX_BASE_URL,
    receiverEmail,
    port: Number(env.PORT ?? "3000"),
  };
}
