import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AllocationStore, type Actor } from "../src/server/allocationStore.ts";
import { generateAllocationScenarios, type AllocationContext } from "../src/server/allocation.ts";

const owner: Actor = { actorId: "meera", role: "owner" };
const agent: Actor = { actorId: "agent", role: "agent" };
const context: AllocationContext = {
  contextId: "store-ctx", capturedAt: "2026-11-09T10:00:00Z", validUntil: "2026-11-09T11:00:00Z",
  clearedFundsCents: 10000, reserveCents: 0, perPaymentCapCents: 20000, totalCapCents: 10000, committedCents: 0,
  obligations: [{ obligationId: "job-1", recipient: "job@example.test", currency: "USD", owedCents: 10000, settledCents: 0, dueAt: "2026-11-10T00:00:00Z", mandatory: true, partialAllowed: false, priority: "urgent", note: "Approved fixture" }],
};

function store() {
  const path = join(mkdtempSync(join(tmpdir(), "settle-allocation-")), "test.db");
  return { db: new AllocationStore(path), path };
}

function recommend(db: AllocationStore) {
  const plan = generateAllocationScenarios(context)[0];
  db.recordRecommendation(plan, { reason: "Only mandatory job.", uncertainties: [], changeTriggers: ["Funds change"] }, context);
  return plan;
}

test("only owner can approve an exact plan; agent cannot grant itself authority", () => {
  const { db } = store();
  const plan = recommend(db);
  assert.throws(() => db.approvePlan(plan.planId, agent, "2026-11-09T10:05:00Z"), /owner/);
  const approval = db.approvePlan(plan.planId, owner, "2026-11-09T10:05:00Z");
  assert.equal(approval.actorId, owner.actorId);
  assert.equal(approval.planHash.length, 64);
  assert.equal(db.getPlan(plan.planId)?.status, "approved");
});

test("execution requires prior owner approval and never accepts agent authorization", () => {
  const { db } = store();
  const plan = recommend(db);
  assert.throws(() => db.beginExecution(plan.planId, owner, "2026-11-09T10:05:00Z"), /approved/);
  db.approvePlan(plan.planId, owner, "2026-11-09T10:05:00Z");
  assert.throws(() => db.beginExecution(plan.planId, agent, "2026-11-09T10:06:00Z"), /owner or operator/);
  const execution = db.beginExecution(plan.planId, owner, "2026-11-09T10:06:00Z");
  assert.match(execution.idempotencyKey, /store-ctx/);
  assert.throws(() => db.beginExecution(plan.planId, owner, "2026-11-09T10:07:00Z"), /already executing/);
});

test("emergency stop blocks even an approved plan and remains durable", () => {
  const { db, path } = store();
  const plan = recommend(db);
  db.approvePlan(plan.planId, owner, "2026-11-09T10:05:00Z");
  db.setEmergencyStop(true, owner, "2026-11-09T10:05:30Z");
  assert.throws(() => db.beginExecution(plan.planId, owner, "2026-11-09T10:06:00Z"), /emergency stop/);
  assert.throws(() => db.setEmergencyStop(false, agent, "2026-11-09T10:06:00Z"), /owner/);
  db.close();
  const reopened = new AllocationStore(path);
  assert.equal(reopened.isStopped(), true);
});

test("decision, approval, execution and audit survive restart", () => {
  const { db, path } = store();
  const plan = recommend(db);
  db.approvePlan(plan.planId, owner, "2026-11-09T10:05:00Z");
  const execution = db.beginExecution(plan.planId, owner, "2026-11-09T10:06:00Z");
  db.completeExecution(execution.executionId, "BATCH-TEST", "2026-11-09T10:07:00Z");
  db.close();
  const reopened = new AllocationStore(path);
  assert.equal(reopened.getPlan(plan.planId)?.status, "succeeded");
  assert.equal(reopened.getExecution(plan.planId)?.providerBatchId, "BATCH-TEST");
  assert.ok(reopened.getAudit().length >= 4);
});

test("audit history cannot be updated or deleted through SQL", () => {
  const { db } = store();
  recommend(db);
  assert.throws(() => db.unsafeTestOnlySql("UPDATE decision_audit SET reason = 'forged'"), /immutable/);
  assert.throws(() => db.unsafeTestOnlySql("DELETE FROM decision_audit"), /immutable/);
});

test("a plan whose context goes stale before approval is refused, never approved", () => {
  const { db } = store();
  const plan = recommend(db);
  // validUntil is 11:00; approval at 11:30 is past it.
  assert.throws(() => db.approvePlan(plan.planId, owner, "2026-11-09T11:30:00Z"), /failed validation: STALE_CONTEXT/);
  assert.equal(db.getPlan(plan.planId)?.status, "proposed");
});

test("a plan that leaves an overdue mandatory obligation unfunded is refused at approval", () => {
  const { db } = store();
  const ctx: AllocationContext = {
    contextId: "store-ctx-mandatory", capturedAt: "2026-11-09T07:00:00Z", validUntil: "2026-11-09T11:00:00Z",
    clearedFundsCents: 5000, reserveCents: 0, perPaymentCapCents: 20000, totalCapCents: 5000, committedCents: 0,
    obligations: [
      { obligationId: "job-early", recipient: "early@example.test", currency: "USD", owedCents: 5000, settledCents: 0, dueAt: "2026-11-09T08:00:00Z", mandatory: false, partialAllowed: false, priority: "normal", note: "Discretionary, due first" },
      { obligationId: "job-must", recipient: "must@example.test", currency: "USD", owedCents: 10000, settledCents: 0, dueAt: "2026-11-09T09:00:00Z", mandatory: true, partialAllowed: false, priority: "urgent", note: "Mandatory, overdue by approval" },
    ],
  };
  // Deadline-first funds the early discretionary job and leaves the
  // overdue mandatory job with nothing.
  const plan = generateAllocationScenarios(ctx)[0];
  db.recordRecommendation(plan, { reason: "Deadline order.", uncertainties: [], changeTriggers: ["Funds change"] }, ctx);
  assert.throws(() => db.approvePlan(plan.planId, owner, "2026-11-09T10:05:00Z"), /failed validation: MANDATORY_UNFUNDED/);
  assert.equal(db.getPlan(plan.planId)?.status, "proposed");
});

test("a plan approved while fresh is refused at execution once its context goes stale", () => {
  const { db } = store();
  const plan = recommend(db);
  db.approvePlan(plan.planId, owner, "2026-11-09T10:05:00Z");
  assert.throws(() => db.beginExecution(plan.planId, owner, "2026-11-09T11:30:00Z"), /failed validation: STALE_CONTEXT/);
  assert.equal(db.getPlan(plan.planId)?.status, "approved");
  assert.equal(db.getExecution(plan.planId), null);
});
