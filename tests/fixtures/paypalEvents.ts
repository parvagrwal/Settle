export function payoutItemEvent(overrides: {
  id?: string;
  eventType?: string;
  createTime?: string;
  transactionId?: string | null;
  status?: string;
  amount?: string;
  fee?: string;
  receiver?: string;
  timeProcessed?: string;
  payoutItemId?: string;
} = {}): Record<string, unknown> {
  const status = overrides.status ?? "SUCCESS";
  const resource: Record<string, unknown> = {
    payout_item_id: overrides.payoutItemId ?? "POI-1",
    transaction_id: overrides.transactionId === undefined ? "TX-1" : overrides.transactionId,
    transaction_status: status,
    payout_batch_id: "BATCH-1",
    payout_item: {
      sender_item_id: "job-1",
      receiver: overrides.receiver ?? "receiver@example.com",
      amount: { currency: "USD", value: overrides.amount ?? "1.00" },
      payout_item_fee: { currency: "USD", value: overrides.fee ?? "0.02" },
      recipient_wallet: "PAYPAL",
    },
    time_processed: overrides.timeProcessed ?? "2026-11-09T10:00:00Z",
  };
  return {
    id: overrides.id ?? "WH-1",
    event_version: "1.0",
    create_time: overrides.createTime ?? "2026-11-09T10:00:01Z",
    resource_type: "payouts_item",
    event_type: overrides.eventType ?? `PAYOUTS.ITEM.${status}`,
    summary: "Automated contract fixture — not a live event",
    resource,
  };
}
