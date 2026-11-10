// Ledger tests, written before the implementation.
// Covers the failure classes the forensic report identified:
//   F-A  seeded/synthetic records acquiring payment identities or submissions
//   F-B  "not yet" being recorded as "unknown", and no durable confirmation work
//   F-D  a reserved payment being treated as reconcilable
//   D-1  out-of-order provider events regressing a terminal item
//   D-2  provider fee estimates not being retained as evidence
// plus the execution-run model that replaces "one batch id for the whole run".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FinancialStore } from "../src/server/financialStore.ts";
import {
  DEFAULT_CONFIRMATION_POLICY,
  confirmationPolicyFromEnv,
  nextConfirmationDelayMs,
  type ConfirmationPolicy,
} from "../src/server/paymentState.ts";

const owner = { actorId: "owner", role: "owner" } as const;
const T0 = "2026-11-10T12:00:00.000Z";

function dbPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), `settle-${name}-`)), "ledger.db");
}

function approvedJob(store: FinancialStore, jobId = "job-1", amountCents = 1000, at = T0): void {
  const recipientId = `r-${jobId}`;
  if (!store.getRecipient(recipientId)) {
    store.verifyRecipient({ recipientId, email: `${jobId}@example.test`, actor: owner, at });
  }
  store.approvePayment({ jobId, recipientId, amountCents, currency: "USD", actor: owner, at });
}

function payoutItem(store: FinancialStore, opts: { jobId: string; status: string; timestamp: string; fee?: string | null; transactionId?: string }): { applied: boolean; reason: string } {
  const payment = store.getPaymentByJob(opts.jobId)!;
  return store.recordPayoutItem({
    paymentId: payment.paymentId,
    senderBatchId: payment.idempotencyKey,
    payoutBatchId: `BATCH-${opts.jobId}`,
    payoutItemId: `ITEM-${opts.jobId}`,
    transactionId: opts.transactionId ?? (opts.status === "SUCCESS" ? `TX-${opts.jobId}` : null),
    activityId: null,
    recipientEmail: payment.recipientEmail,
    amountCents: payment.amountCents,
    currency: payment.currency,
    status: opts.status,
    providerTimestamp: opts.timestamp,
    raw: {
      payout_item_id: `ITEM-${opts.jobId}`,
      payout_batch_id: `BATCH-${opts.jobId}`,
      transaction_status: opts.status,
      ...(opts.fee === null ? {} : { payout_item_fee: { value: opts.fee ?? "0.25", currency: "USD" } }),
      payout_item: {
        sender_item_id: payment.idempotencyKey,
        receiver: payment.recipientEmail,
        amount: { value: (payment.amountCents / 100).toFixed(2), currency: payment.currency },
      },
    },
  });
}

test("a seed-origin payment cannot be reserved or submitted, at the API and at the database", () => {
  const store = new FinancialStore(dbPath("provenance"));
  approvedJob(store, "seeded-job");
  store.unsafeTestOnlySql("UPDATE payments SET record_origin='seed' WHERE job_id='seeded-job'");
  store.markReconciled(T0);
  assert.throws(() => store.reservePayment({ jobId: "seeded-job", at: T0 }), /DEMO_RECORD_NOT_PAYABLE/);
  // The database refuses the transition even if application code is bypassed.
  assert.throws(
    () => store.unsafeTestOnlySql("UPDATE payments SET status='submitted' WHERE job_id='seeded-job'"),
    /demonstration records cannot be submitted/,
  );
  assert.equal(store.getPaymentByJob("seeded-job")?.status, "approved");
  store.close();
});

test("payments default to an application origin and record their execution run", () => {
  const store = new FinancialStore(dbPath("origin"));
  approvedJob(store);
  const payment = store.getPaymentByJob("job-1")!;
  assert.equal(payment.recordOrigin, "application");
  assert.equal(payment.executionRunId, null);
  const run = store.createExecutionRun({ kind: "legacy", requestedBy: "owner", actorRole: "owner", policyVersion: payloadVersion(store), at: T0 });
  store.attachPaymentToRun({ runId: run.runId, paymentId: payment.paymentId, ordinal: 0 });
  assert.equal(store.getPaymentByJob("job-1")?.executionRunId, run.runId);
  store.close();
});

function payloadVersion(store: FinancialStore): number {
  return store.getPolicy().version;
}

test("fee estimate and provider-reported fee are separate, versioned facts", () => {
  const store = new FinancialStore(dbPath("fees"));
  approvedJob(store, "job-fee", 100);
  const payment = store.getPaymentByJob("job-fee")!;
  store.recordFeeEstimate({
    paymentId: payment.paymentId,
    policyId: "paypal-us-payouts-api-flat-2026-10",
    policyVersion: 1,
    amountMinor: 100,
    estimatedFeeMinor: 25,
    currency: "USD",
    method: "flat_per_item",
    formula: "USD 0.25 flat per payout item",
    sourceUrl: "https://www.paypal.com/us/business/paypal-business-fees",
    sourceRetrievedAt: "2026-11-10",
    at: T0,
  });
  let fees = store.getFeeRecord(payment.paymentId);
  assert.equal(fees.estimate?.estimatedFeeMinor, 25);
  assert.equal(fees.estimate?.policyId, "paypal-us-payouts-api-flat-2026-10");
  assert.equal(fees.provider, null);

  payoutItem(store, { jobId: "job-fee", status: "SUCCESS", timestamp: "2026-11-10T12:01:00.000Z", fee: "0.02" });
  fees = store.getFeeRecord(payment.paymentId);
  assert.equal(fees.estimate?.estimatedFeeMinor, 25);
  assert.equal(fees.provider?.reportedFeeMinor, 2);
  assert.equal(fees.provider?.currency, "USD");
  assert.equal(fees.provider?.feePayer, "sender");
  assert.equal(fees.provider?.source, "payout_item_fee");
  assert.equal(fees.provider?.sourceItemId, "ITEM-job-fee");
  assert.equal(fees.provider?.sourceBatchId, "BATCH-job-fee");
  assert.equal(fees.provider?.isProviderEstimate, true);
  assert.equal(fees.consistent, false);
  store.close();
});

test("an unreported provider fee stays unknown rather than becoming zero", () => {
  const store = new FinancialStore(dbPath("nofee"));
  approvedJob(store, "job-nofee", 100);
  payoutItem(store, { jobId: "job-nofee", status: "PENDING", timestamp: "2026-11-10T12:01:00.000Z", fee: null });
  const payment = store.getPaymentByJob("job-nofee")!;
  const fees = store.getFeeRecord(payment.paymentId);
  assert.equal(fees.provider, null);
  assert.equal(fees.consistent, null);
  assert.match(fees.explanation, /not reported|unavailable/i);
  store.close();
});

test("a late PENDING event cannot regress a SUCCESS item, and duplicates are idempotent", () => {
  const store = new FinancialStore(dbPath("ooo"));
  approvedJob(store, "job-ooo", 100);
  const first = payoutItem(store, { jobId: "job-ooo", status: "SUCCESS", timestamp: "2026-11-10T12:05:00.000Z" });
  assert.equal(first.applied, true);
  assert.equal(store.getPaymentByJob("job-ooo")?.status, "provider_confirmed");
  const late = payoutItem(store, { jobId: "job-ooo", status: "PENDING", timestamp: "2026-11-10T12:04:00.000Z", fee: null });
  assert.equal(late.applied, false);
  assert.equal(late.reason, "stale_provider_timestamp");
  assert.equal(store.getPaymentByJob("job-ooo")?.status, "provider_confirmed");
  assert.equal(store.getPayoutItem(store.getPaymentByJob("job-ooo")!.paymentId)?.status, "SUCCESS");

  const duplicate = payoutItem(store, { jobId: "job-ooo", status: "SUCCESS", timestamp: "2026-11-10T12:05:00.000Z" });
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.reason, "duplicate_event");
  assert.equal(store.getPaymentByJob("job-ooo")?.status, "provider_confirmed");
  // The same success must not be counted twice in the rolling spend.
  assert.equal(store.getCapSummary("2026-11-10T12:10:00.000Z").confirmedSpendCents, 100);
  store.close();
});

test("a later RETURNED event is accepted, and the rolling spend is reduced", () => {
  const store = new FinancialStore(dbPath("returned"));
  approvedJob(store, "job-ret", 500);
  payoutItem(store, { jobId: "job-ret", status: "SUCCESS", timestamp: "2026-11-10T12:05:00.000Z" });
  assert.equal(store.getCapSummary("2026-11-10T12:10:00.000Z").eligibleSpendCents, 500);
  const returned = payoutItem(store, { jobId: "job-ret", status: "RETURNED", timestamp: "2026-11-10T13:05:00.000Z" });
  assert.equal(returned.applied, true);
  assert.equal(store.getPaymentByJob("job-ret")?.status, "returned");
  assert.equal(store.getCapSummary("2026-11-10T13:10:00.000Z").eligibleSpendCents, 0);
  store.close();
});

test("emergency stop is owner-only, persistent, audited and blocks new submissions", () => {
  const path = dbPath("stop");
  const store = new FinancialStore(path);
  approvedJob(store, "job-stop", 100);
  store.markReconciled(T0);
  assert.throws(() => store.setEmergencyStop({ stopped: true, actor: { actorId: "agent", role: "agent" }, at: T0 }), /owner/i);
  store.setEmergencyStop({ stopped: true, actor: owner, at: T0, reason: "owner pressed stop" });
  assert.equal(store.isEmergencyStopped(), true);
  assert.throws(() => store.reservePayment({ jobId: "job-stop", at: T0 }), /EMERGENCY_STOP/);
  store.close();

  const reopened = new FinancialStore(path);
  assert.equal(reopened.isEmergencyStopped(), true, "stop survives a restart");
  reopened.setEmergencyStop({ stopped: false, actor: owner, at: "2026-11-10T12:10:00.000Z", reason: "resume" });
  assert.equal(reopened.isEmergencyStopped(), false);
  const actions = reopened.getAudit().map((row) => String(row.action));
  assert.ok(actions.includes("emergency_stopped"));
  assert.ok(actions.includes("emergency_resumed"));
  reopened.close();
});

test("a reserved payment is never reconcilable, so reconciliation cannot submit it", () => {
  const store = new FinancialStore(dbPath("reserved"));
  approvedJob(store, "job-res", 100);
  store.markReconciled(T0);
  store.reservePayment({ jobId: "job-res", at: T0 });
  assert.equal(store.listReconcilableAttempts(T0).length, 0);
  store.close();
});

test("one execution run holds several payments, each with its own batch, item and transaction", () => {
  const store = new FinancialStore(dbPath("run"));
  for (const id of ["job-a", "job-b", "job-c"]) approvedJob(store, id, 100);
  const run = store.createExecutionRun({ kind: "plan", planId: "plan-1", requestedBy: "owner", actorRole: "owner", policyVersion: store.getPolicy().version, at: T0 });
  let ordinal = 0;
  for (const id of ["job-a", "job-b", "job-c"]) {
    const payment = store.getPaymentByJob(id)!;
    store.attachPaymentToRun({ runId: run.runId, paymentId: payment.paymentId, ordinal: ordinal++ });
    payoutItem(store, { jobId: id, status: id === "job-c" ? "FAILED" : "SUCCESS", timestamp: `2026-11-10T12:0${ordinal}:00.000Z` });
  }
  const loaded = store.getExecutionRun(run.runId)!;
  assert.equal(loaded.items.length, 3);
  assert.deepEqual(loaded.items.map((row) => row.jobId), ["job-a", "job-b", "job-c"]);
  assert.deepEqual(loaded.items.map((row) => row.payoutBatchId), ["BATCH-job-a", "BATCH-job-b", "BATCH-job-c"]);
  assert.deepEqual(loaded.items.map((row) => row.payoutItemId), ["ITEM-job-a", "ITEM-job-b", "ITEM-job-c"]);
  assert.deepEqual(loaded.items.map((row) => row.transactionId), ["TX-job-a", "TX-job-b", null]);
  assert.deepEqual(loaded.items.map((row) => row.status), ["provider_confirmed", "provider_confirmed", "failed"]);
  assert.equal(new Set(loaded.items.map((row) => row.payoutBatchId)).size, 3);
  assert.equal(loaded.batches.length, 3);
  assert.equal(loaded.status, "partial");
  // Every item's audit trail points at its own provider identity.
  const audit = store.getAudit();
  for (const id of ["job-a", "job-b"]) {
    const payment = store.getPaymentByJob(id)!;
    const rows = audit.filter((row) => row.resource_id === payment.paymentId && row.action === "provider_item_updated");
    assert.ok(rows.length >= 1);
    assert.equal(rows.at(-1)?.correlation_id, `ITEM-${id}`);
  }
  store.close();
});

test("confirmation backoff is bounded, increases, and carries jitter", () => {
  const policy: ConfirmationPolicy = { baseMs: 1_000, factor: 2, maxMs: 8_000, maxAttempts: 8, jitterRatio: 0.2 };
  assert.equal(nextConfirmationDelayMs(policy, 0, () => 0.5), 1_000);
  assert.equal(nextConfirmationDelayMs(policy, 1, () => 0.5), 2_000);
  assert.equal(nextConfirmationDelayMs(policy, 2, () => 0.5), 4_000);
  const capped = nextConfirmationDelayMs(policy, 10, () => 0.5);
  assert.equal(capped, 8_000);
  const low = nextConfirmationDelayMs(policy, 0, () => 0);
  const high = nextConfirmationDelayMs(policy, 0, () => 0.999999);
  assert.ok(low < high);
  assert.ok(low >= 800, `jitter floor ${low}`);
  assert.ok(high <= 1_200, `jitter ceiling ${high}`);
  assert.equal(DEFAULT_CONFIRMATION_POLICY.maxAttempts > 0, true);
  assert.equal(DEFAULT_CONFIRMATION_POLICY.maxMs <= 15 * 60 * 1000, true);
});

test("confirmation work is durable, due by time, and re-armed after restart without duplicating", () => {
  const path = dbPath("confirm");
  const store = new FinancialStore(path);
  approvedJob(store, "job-conf", 100);
  payoutItem(store, { jobId: "job-conf", status: "PENDING", timestamp: T0, fee: null });
  const payment = store.getPaymentByJob("job-conf")!;
  store.scheduleConfirmation({ paymentId: payment.paymentId, at: T0, delayMs: 2_000 });
  store.scheduleConfirmation({ paymentId: payment.paymentId, at: T0, delayMs: 2_000 });
  assert.equal(store.listDueConfirmations("2026-11-10T12:00:01.000Z").length, 0);
  assert.equal(store.listDueConfirmations("2026-11-10T12:00:02.000Z").length, 1);
  assert.equal(store.listDueConfirmations("2026-11-10T12:00:03.000Z")[0].payoutBatchId, "BATCH-job-conf");
  store.close();

  const reopened = new FinancialStore(path);
  // The work was already durable, so restart adds nothing and duplicates nothing.
  assert.equal(reopened.rearmConfirmations({ at: "2026-11-10T12:05:00.000Z" }), 0);
  assert.equal(reopened.listDueConfirmations("2026-11-10T12:05:00.000Z").length, 1);
  // A payment that was in flight when the process died with no durable work is re-armed once.
  approvedJob(reopened, "job-late", 100);
  payoutItem(reopened, { jobId: "job-late", status: "PENDING", timestamp: "2026-11-10T12:05:30.000Z", fee: null });
  assert.equal(reopened.rearmConfirmations({ at: "2026-11-10T12:06:00.000Z" }), 1);
  assert.equal(reopened.rearmConfirmations({ at: "2026-11-10T12:06:00.000Z" }), 0);
  const due = reopened.listDueConfirmations("2026-11-10T12:06:00.000Z");
  assert.equal(due.length, 2);
  assert.equal(due[0].attemptCount, 0);
  reopened.recordConfirmationFailure({ paymentId: payment.paymentId, error: "timeout", at: "2026-11-10T12:06:00.000Z", policy: { ...DEFAULT_CONFIRMATION_POLICY, baseMs: 1_000, maxMs: 4_000, jitterRatio: 0 }, random: () => 0.5 });
  assert.equal(reopened.getPaymentByJob("job-conf")?.status, "pending", "a poll failure is not a payment failure");
  reopened.close();
});

test("exhausted confirmation work becomes reconciliation_required, never failed or unknown", () => {
  const store = new FinancialStore(dbPath("exhausted"));
  approvedJob(store, "job-ex", 100);
  payoutItem(store, { jobId: "job-ex", status: "PENDING", timestamp: T0, fee: null });
  const payment = store.getPaymentByJob("job-ex")!;
  store.scheduleConfirmation({ paymentId: payment.paymentId, at: T0, delayMs: 0 });
  const policy: ConfirmationPolicy = { baseMs: 1, factor: 2, maxMs: 2, maxAttempts: 1, jitterRatio: 0 };
  store.recordConfirmationFailure({ paymentId: payment.paymentId, error: "still pending", at: "2026-11-10T12:00:01.000Z", policy, random: () => 0.5 });
  const state = store.getPaymentByJob("job-ex")!;
  assert.equal(state.status, "reconciliation_required");
  assert.match(String(state.failureReason), /still pending/);
  store.close();
});

test("confirmation backoff settings accept a zero jitter and fall back on nonsense", () => {
  const deterministic = confirmationPolicyFromEnv({ SETTLE_CONFIRM_JITTER: "0", SETTLE_CONFIRM_ATTEMPTS: "nope", SETTLE_CONFIRM_MAX_ATTEMPTS: "7" });
  assert.equal(deterministic.jitterRatio, 0, "0 is a meaningful jitter setting, not a missing one");
  assert.equal(deterministic.maxAttempts, 7);
  assert.equal(deterministic.baseMs, DEFAULT_CONFIRMATION_POLICY.baseMs, "an unknown variable name falls back");
  assert.equal(nextConfirmationDelayMs(deterministic, 3, () => 0.99), 8 * DEFAULT_CONFIRMATION_POLICY.baseMs);

  const nonsense = confirmationPolicyFromEnv({ SETTLE_CONFIRM_JITTER: "-1", SETTLE_CONFIRM_BASE_MS: "0", SETTLE_CONFIRM_FACTOR: "1.5" });
  assert.equal(nonsense.jitterRatio, DEFAULT_CONFIRMATION_POLICY.jitterRatio);
  assert.equal(nonsense.baseMs, DEFAULT_CONFIRMATION_POLICY.baseMs);
  assert.equal(nonsense.factor, DEFAULT_CONFIRMATION_POLICY.factor);

  // Jitter stays inside the documented +/- band and never goes negative.
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const random of [() => 0, () => 0.5, () => 0.999999]) {
      const delay = nextConfirmationDelayMs({ ...DEFAULT_CONFIRMATION_POLICY, baseMs: 100, maxMs: 10_000, jitterRatio: 0.2 }, attempt, random);
      const nominal = Math.min(10_000, 100 * Math.pow(2, attempt));
      assert.ok(delay >= Math.floor(nominal * 0.8) && delay <= Math.ceil(nominal * 1.2), `delay ${delay} outside band around ${nominal}`);
    }
  }
});
