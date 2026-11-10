// PayPal Payouts webhook fixtures.
//
// Event names follow the documented Payouts webhook contract
// (https://developer.paypal.com/api/rest/webhooks/event-names/#payouts):
//
//   PAYMENT.PAYOUTS-ITEM.BLOCKED    item status BLOCKED
//   PAYMENT.PAYOUTS-ITEM.CANCELED   item status CANCELED
//   PAYMENT.PAYOUTS-ITEM.DENIED     item status DENIED
//   PAYMENT.PAYOUTS-ITEM.FAILED     item status FAILED
//   PAYMENT.PAYOUTS-ITEM.HELD       item status ONHOLD
//   PAYMENT.PAYOUTS-ITEM.REFUNDED   item status REFUNDED
//   PAYMENT.PAYOUTS-ITEM.RETURNED   item status RETURNED
//   PAYMENT.PAYOUTS-ITEM.SUCCEEDED  item status SUCCESS
//   PAYMENT.PAYOUTS-ITEM.UNCLAIMED  item status UNCLAIMED
//
// There is NO documented PAYMENT.PAYOUTS-ITEM.PENDING or .REVERSED event: a
// PENDING or REVERSED transaction_status is observed through the payouts GET
// (reconciliation), not through an item webhook. Asking this fixture for such
// an event without an explicit, deliberate eventType override is an error, so
// a test cannot silently invent a provider contract.
//
// The resource shape mirrors a sanitized Sandbox payouts_item webhook body:
// item identifiers, transaction_status and payout_item_fee at the top level
// of `resource`, with the submitted payout_item (sender_item_id, receiver,
// amount) nested below it — the same nesting the Payouts GET returns per item
// (evidence/payouts/payouts-poll.json).
const ITEM_EVENT_BY_STATUS: Record<string, string> = {
  SUCCESS: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  FAILED: "PAYMENT.PAYOUTS-ITEM.FAILED",
  ONHOLD: "PAYMENT.PAYOUTS-ITEM.HELD",
  UNCLAIMED: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  RETURNED: "PAYMENT.PAYOUTS-ITEM.RETURNED",
  BLOCKED: "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  REFUNDED: "PAYMENT.PAYOUTS-ITEM.REFUNDED",
  DENIED: "PAYMENT.PAYOUTS-ITEM.DENIED",
  CANCELED: "PAYMENT.PAYOUTS-ITEM.CANCELED",
};

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
  payoutBatchId?: string;
  senderItemId?: string;
} = {}): Record<string, unknown> {
  const status = overrides.status ?? "SUCCESS";
  const eventType = overrides.eventType ?? ITEM_EVENT_BY_STATUS[status];
  if (eventType === undefined) {
    throw new Error(
      `PayPal publishes no payouts-item webhook for transaction_status ${status}; ` +
      "pass an explicit eventType if the test deliberately exercises an undocumented event",
    );
  }
  const resource: Record<string, unknown> = {
    payout_item_id: overrides.payoutItemId ?? "POI-1",
    transaction_id: overrides.transactionId === undefined ? "TX-1" : overrides.transactionId,
    transaction_status: status,
    payout_item_fee: { currency: "USD", value: overrides.fee ?? "0.02" },
    payout_batch_id: overrides.payoutBatchId ?? "BATCH-1",
    payout_item: {
      sender_item_id: overrides.senderItemId ?? "job-1",
      receiver: overrides.receiver ?? "receiver@example.com",
      amount: { currency: "USD", value: overrides.amount ?? "1.00" },
      recipient_wallet: "PAYPAL",
    },
    time_processed: overrides.timeProcessed ?? "2026-11-09T10:00:00Z",
  };
  return {
    id: overrides.id ?? "WH-1",
    event_version: "1.0",
    create_time: overrides.createTime ?? "2026-11-09T10:00:01Z",
    resource_type: "payouts_item",
    event_type: eventType,
    summary: "Automated contract fixture — not a live event",
    resource,
  };
}
