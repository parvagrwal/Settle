import type { IncomingHttpHeaders } from "node:http";
import { paypalRequest, type FetchFn } from "./paypalClient.ts";

export interface Transmission {
  id: string;
  time: string;
  certUrl: string;
  authAlgo: string;
  signature: string;
}

export function transmissionFromHeaders(headers: IncomingHttpHeaders): Transmission {
  const required = {
    id: headers["paypal-transmission-id"],
    time: headers["paypal-transmission-time"],
    certUrl: headers["paypal-cert-url"],
    authAlgo: headers["paypal-auth-algo"],
    signature: headers["paypal-transmission-sig"],
  };
  for (const [name, value] of Object.entries(required)) {
    if (typeof value !== "string" || value.length === 0) throw new Error(`webhook: missing PayPal transmission header ${name}`);
  }
  return required as Transmission;
}

export async function verifyWithPayPal(opts: {
  baseUrl: string;
  token: string;
  webhookId: string;
  transmission: Transmission;
  event: Record<string, unknown>;
  refreshToken?: () => Promise<string>;
  fetchFn?: FetchFn;
}): Promise<boolean> {
  const { json } = await paypalRequest({
    method: "POST",
    path: `${opts.baseUrl}/v1/notifications/verify-webhook-signature`,
    token: opts.token,
    refreshToken: opts.refreshToken,
    fetchFn: opts.fetchFn,
    body: {
      transmission_id: opts.transmission.id,
      transmission_time: opts.transmission.time,
      cert_url: opts.transmission.certUrl,
      auth_algo: opts.transmission.authAlgo,
      transmission_sig: opts.transmission.signature,
      webhook_id: opts.webhookId,
      webhook_event: opts.event,
    },
  });
  return json.verification_status === "SUCCESS";
}
