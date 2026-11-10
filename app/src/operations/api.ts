// HTTP client for the payment operations endpoints. Three calls, all reads from
// the ledger's point of view: the snapshot, one record's detail, and an
// investigation. Every response is validated against the contract before it is
// returned, and every call takes an AbortSignal.
import { ownerHeaders } from "../api.ts";
import { parseDetail, parseInvestigation, parseSnapshot } from "./contract.ts";
import type { OperationsApi } from "./store.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

async function json(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (!response.ok) throw new HttpError(response.status, `${init.method ?? "GET"} ${path} failed with HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

export const operationsApi: OperationsApi = {
  async snapshot(signal) {
    return parseSnapshot(await json("/api/operations", { signal }));
  },
  async detail(operationId, signal) {
    // The owner token, when the owner entered one in this tab, unlocks the ledger audit trail for legacy records.
    return parseDetail(await json(`/api/operations/payments/${encodeURIComponent(operationId)}`, { signal, headers: ownerHeaders() }));
  },
  async investigate(question, signal) {
    return parseInvestigation(await json("/api/operations/investigate", {
      method: "POST", signal, headers: { "Content-Type": "application/json", ...ownerHeaders() }, body: JSON.stringify({ question }),
    }));
  },
};
