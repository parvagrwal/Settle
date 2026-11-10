// Property-based financial invariants (fast-check).
//
// These generate many randomized payment scenarios against the real
// FinancialStore (in-memory SQLite, the same engine production uses) and
// assert the invariants from docs/FINANCIAL-INVARIANTS.md:
//
//   I1  a job can never hold more than one payment identity;
//   I3  no interleaving of approvals and reservations can push
//       committed-plus-reserved exposure beyond the owner's cap;
//   I8  every payment identity records the policy version it was
//       approved under, and that version never changes retroactively;
//   I10 a failed provider item can never surface as a successful payment,
//       and an unknown provider status is refused outright.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { FinancialStore } from "../src/server/financialStore.ts";
import { decide } from "../src/server/decide.ts";
import { DEFAULT_POLICY } from "../src/server/policy.ts";

const owner = { actorId: "owner-prop", role: "owner" as const };
const T0 = "2026-11-09T12:00:00Z";

function freshStore(capCents: number, perPaymentCapCents: number): FinancialStore {
  const store = new FinancialStore(":memory:");
  store.updatePolicy({ capCents, perPaymentCapCents, freshnessSeconds: 300, actor: owner, at: T0 });
  store.verifyRecipient({ recipientId: "rec-prop", email: "contractor@example.test", actor: owner, at: T0 });
  store.markReconciled(T0);
  return store;
}

test("I1: no sequence of duplicate approvals creates a second payment identity for a job", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 20000 }),
      fc.integer({ min: 2, max: 6 }),
      (amountCents, attempts) => {
        const store = freshStore(150000, 20000);
        store.approvePayment({ jobId: "job-dup", recipientId: "rec-prop", amountCents, currency: "USD", actor: owner, at: T0 });
        for (let i = 1; i < attempts; i++) {
          assert.throws(
            () => store.approvePayment({ jobId: "job-dup", recipientId: "rec-prop", amountCents, currency: "USD", actor: owner, at: T0 }),
            /already has a permanent payment identity/,
          );
        }
        const payment = store.getPaymentByJob("job-dup");
        assert.ok(payment);
        assert.equal(payment!.amountCents, amountCents);
        store.close();
      },
    ),
    { numRuns: 25 },
  );
});

test("I3: random reservation interleavings never push exposure past the owner's cap", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 500, max: 5000 }),
      fc.array(fc.integer({ min: 1, max: 3000 }), { minLength: 1, maxLength: 12 }),
      (capCents, amounts) => {
        const store = freshStore(capCents, Math.min(capCents, 3000));
        let reserved = 0;
        for (const [index, amount] of amounts.entries()) {
          const jobId = `job-cap-${index}`;
          try {
            store.approvePayment({ jobId, recipientId: "rec-prop", amountCents: amount, currency: "USD", actor: owner, at: T0 });
            store.reservePayment({ jobId, at: T0 });
            reserved += amount;
          } catch (error) {
            const message = (error as Error).message;
            assert.match(message, /CAP_EXCEEDED|PER_PAYMENT_CAP_EXCEEDED/, `only cap refusals are acceptable, got: ${message}`);
          }
        }
        const summary = store.getCapSummary(T0);
        assert.ok(
          summary.eligibleSpendCents + summary.activeReservationsCents <= capCents,
          `exposure ${summary.eligibleSpendCents + summary.activeReservationsCents} exceeded cap ${capCents}`,
        );
        assert.equal(summary.activeReservationsCents, reserved);
        store.close();
      },
    ),
    { numRuns: 25 },
  );
});

test("I8: each payment identity pins the policy version active at approval, forever", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1000, max: 100000 }), { minLength: 1, maxLength: 5 }),
      (capUpdates) => {
        const store = freshStore(150000, 20000);
        const seen: Array<{ jobId: string; version: number }> = [];
        for (const [index, cap] of capUpdates.entries()) {
          const jobId = `job-policy-${index}`;
          store.approvePayment({ jobId, recipientId: "rec-prop", amountCents: 100, currency: "USD", actor: owner, at: T0 });
          seen.push({ jobId, version: store.getPolicy().version });
          store.updatePolicy({ capCents: Math.max(cap, 100), perPaymentCapCents: 100, freshnessSeconds: 300, actor: owner, at: T0 });
        }
        for (const entry of seen) {
          assert.equal(store.getPaymentByJob(entry.jobId)!.policyVersion, entry.version, "historical decisions keep their original policy version");
        }
        store.close();
      },
    ),
    { numRuns: 20 },
  );
});

test("I10: a FAILED provider item never becomes a confirmed payment; unknown statuses are refused", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 3000 }),
      fc.constantFrom("FAILED", "BLOCKED", "RETURNED", "REVERSED", "REFUNDED"),
      fc.string({ minLength: 1, maxLength: 12 }),
      (amountCents, badStatus, randomStatus) => {
        const store = freshStore(150000, 3000);
        store.approvePayment({ jobId: "job-fail", recipientId: "rec-prop", amountCents, currency: "USD", actor: owner, at: T0 });
        store.reservePayment({ jobId: "job-fail", at: T0 });
        const payment = store.getPaymentByJob("job-fail")!;
        const attempt = store.beginSubmission(payment.paymentId, T0);
        const item = {
          paymentId: payment.paymentId, senderBatchId: attempt.senderBatchId, payoutBatchId: "B-PROP",
          payoutItemId: "POI-PROP", transactionId: null, activityId: null,
          recipientEmail: "contractor@example.test", amountCents, currency: "USD",
          providerTimestamp: T0, raw: {},
        };
        const supported = ["SUCCESS", "FAILED", "PENDING", "UNCLAIMED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"];
        if (!supported.includes(randomStatus)) {
          assert.throws(
            () => store.recordPayoutItem({ ...item, status: randomStatus }),
            /unsupported provider item status/,
            "an unrecognized future provider status must be refused, never guessed at",
          );
        }
        store.recordPayoutItem({ ...item, status: badStatus });
        const after = store.getPaymentByJob("job-fail")!;
        assert.notEqual(after.status, "provider_confirmed", `status ${badStatus} must never read as success`);
        // The failure also never counts as confirmed spend.
        assert.equal(store.getCapSummary(T0).confirmedSpendCents, 0);
        store.close();
      },
    ),
    { numRuns: 25 },
  );
});

test("I2/I10 (reference model): an already-paid job is rejected for every input combination", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 1_000_000 }),
      fc.integer({ min: 0, max: 150000 }),
      fc.boolean(),
      (amountCents, spent, recipientAllowed) => {
        const decision = decide(
          DEFAULT_POLICY,
          {
            actorAuthorized: true, systemSuspended: false, jobApproved: true,
            approvalExpiresAtMs: null, recipientAllowed, alreadyPaid: true, spentInWindowCents: spent,
          },
          { jobId: "job-x", recipient: "r@example.test", amountCents },
          Date.now(),
        );
        assert.equal(decision.decision, "reject");
        if (recipientAllowed) {
          assert.equal((decision as { label: string }).label, "DuplicatePayout");
        }
      },
    ),
    { numRuns: 100 },
  );
});

test("fixture contract: no payouts-item webhook can be fabricated for an undocumented status", async () => {
  const { payoutItemEvent } = await import("./fixtures/paypalEvents.ts");
  for (const status of ["PENDING", "REVERSED", "SOMETHING_NEW"]) {
    assert.throws(() => payoutItemEvent({ status }), /publishes no payouts-item webhook/);
  }
  for (const [status, suffix] of [["SUCCESS", "SUCCEEDED"], ["ONHOLD", "HELD"], ["FAILED", "FAILED"], ["UNCLAIMED", "UNCLAIMED"], ["RETURNED", "RETURNED"], ["BLOCKED", "BLOCKED"], ["REFUNDED", "REFUNDED"], ["DENIED", "DENIED"], ["CANCELED", "CANCELED"]] as const) {
    assert.equal(payoutItemEvent({ status }).event_type, `PAYMENT.PAYOUTS-ITEM.${suffix}`);
  }
});
