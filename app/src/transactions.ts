// Client contract for the verified provider events API. The shapes mirror what
// the server returns (`TransactionRecord` and `EventHistoryRecord` in
// src/server/transactionStore.ts): amounts and currency can be absent, and a
// history event carries `eventReceivedAt`, `correlationId` and `rawEvent`.
export interface Transaction {
  rowKey: string;
  originalTransactionId: string | null;
  associatedOrderId: string | null;
  latestEventId: string;
  originalEventId: string;
  transactionTimestamp: string | null;
  eventCreatedAt: string;
  eventReceivedAt: string;
  status: string;
  grossCents: number | null;
  currency: string | null;
  feeCents: number | null;
  netCents: number | null;
  payerEmail: string | null;
  payeeEmail: string | null;
  paymentMethod: string | null;
  payoutBatchId: string | null;
  payoutItemId: string | null;
  jobId: string | null;
  relatedTransactionId: string | null;
  lastEventSequence: number;
}

export interface HistoryEvent {
  sequence: number;
  eventId: string;
  eventType: string;
  eventCreatedAt: string;
  eventReceivedAt: string;
  outcome: string;
  correlationId: string | null;
  rawEvent: Record<string, unknown>;
}

export interface Investigation {
  question: string;
  answer: string;
  facts: { label: string; value: string; evidence: string[] }[];
  hypotheses: string[];
  supportingTransactionIds: string[];
  gridFilter: { transactionIds: string[] };
  generatedAt: string;
  source: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const transactionApi = {
  async since(cursor: number, signal?: AbortSignal): Promise<{ transactions: Transaction[]; cursor: number; serverTime: string; source: string }> {
    return request(`/api/transactions?since=${cursor}`, { signal });
  },
  async history(rowKey: string, signal?: AbortSignal): Promise<{ transaction: Transaction; events: HistoryEvent[] }> {
    return request(`/api/transactions/${encodeURIComponent(rowKey)}/history`, { signal });
  },
  async investigate(question: string, signal?: AbortSignal): Promise<Investigation> {
    return request("/api/investigate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }), signal,
    });
  },
};

/** An absent amount or currency is "Not reported"; it is never formatted as zero or guessed. */
export function formatMoney(cents: number | null | undefined, currency: string | null | undefined): string {
  if (cents === null || cents === undefined) return "Not reported";
  if (!currency) return `${(cents / 100).toFixed(2)} (currency not reported)`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
