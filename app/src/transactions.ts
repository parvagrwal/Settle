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
  grossCents: number;
  currency: string;
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
  receivedAt: string;
  transmissionId: string | null;
  outcome: string;
  resource: Record<string, unknown>;
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
  async since(cursor: number): Promise<{ transactions: Transaction[]; cursor: number; serverTime: string; source: string }> {
    return request(`/api/transactions?since=${cursor}`);
  },
  async history(rowKey: string): Promise<{ transaction: Transaction; events: HistoryEvent[] }> {
    return request(`/api/transactions/${encodeURIComponent(rowKey)}/history`);
  },
  async investigate(question: string): Promise<Investigation> {
    return request("/api/investigate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }),
    });
  },
};
