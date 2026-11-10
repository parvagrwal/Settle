import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProductStore, ProductPermissionError } from "../src/server/productStore.ts";

const NOW = "2026-11-10T12:00:00.000Z";
function setup() {
  const path = join(mkdtempSync(join(tmpdir(), "settle-product-")), "product.db");
  return { path, store: new ProductStore(path) };
}
function owner(store: ProductStore) {
  const login = store.createOwnerSession({ displayName: "Workspace owner", email: null }, NOW, 60_000);
  return { user: login.user, session: login.sessionToken };
}

test("demo records have explicit origins and historical evidence is not reconciliation", () => {
  const { store } = setup();
  const demo = store.getWorkspace("demo", null);
  assert.equal(demo.kind, "demo");
  assert.equal(demo.owner, null);
  const jobs = store.listJobs(demo.workspaceId, null);
  assert.ok(jobs.length >= 3);
  assert.ok(jobs.every((job) => job.origin === "synthetic" || job.origin === "seed"));
  assert.ok(jobs.every((job) => job.workspaceId === demo.workspaceId));
  const receipt = store.listReceipts(demo.workspaceId, null)[0];
  assert.equal(receipt.origin, "seed");
  assert.equal(receipt.providerEnvironment, "sandbox");
  assert.equal(receipt.verificationState, "historical_evidence_only");
  assert.equal(receipt.lastReconciledAt, null);
  assert.equal(receipt.paymentId, null);
  assert.ok(receipt.timeline.some((event) => event.state === "missing" && event.kind === "reconciliation"));
});

test("authenticated identity, workspace ownership, jobs, decisions and policy survive restart", () => {
  const { store, path } = setup();
  const { user, session } = owner(store);
  const workspace = store.createOperationalWorkspace(user.userId, "Actual Studio", NOW);
  const job = store.createJob(workspace.workspaceId, user.userId, {
    title: "Approved illustration work", recipientName: "Contractor A", recipientEmail: "contractor@example.test",
    amountCents: 7500, dueAt: "2026-11-15", priority: "high",
  }, NOW);
  assert.equal(job.origin, "application");
  assert.equal(job.providerEnvironment, "sandbox");
  assert.equal(job.approvalState, "not_approved");
  store.approveJob(workspace.workspaceId, job.jobId, user.userId, NOW);
  const decision = store.createRecommendation(workspace.workspaceId, user.userId, NOW);
  assert.equal(decision.origin, "application");
  assert.equal(decision.status, "recommendation_ready");
  store.updatePolicy(workspace.workspaceId, user.userId, { perPaymentCapCents: 9000, rollingCapCents: 50000 }, NOW);
  store.close();

  const reopened = new ProductStore(path);
  assert.equal(reopened.getUserBySession(session, "2026-11-10T12:00:30.000Z")?.userId, user.userId);
  const restored = reopened.getWorkspace(workspace.workspaceId, user.userId);
  assert.equal(restored.name, "Actual Studio");
  assert.equal(restored.owner?.userId, user.userId);
  assert.equal(reopened.listJobs(workspace.workspaceId, user.userId)[0].title, "Approved illustration work");
  assert.equal(reopened.listDecisions(workspace.workspaceId, user.userId).length, 1);
  assert.equal(reopened.getPolicy(workspace.workspaceId, user.userId).perPaymentCapCents, 9000);
});

test("server-side membership blocks another owner and client identity cannot be supplied", () => {
  const { store } = setup();
  const first = owner(store);
  const workspace = store.createOperationalWorkspace(first.user.userId, "Private Studio", NOW);
  assert.throws(() => store.createOperationalWorkspace(first.user.userId, "Ambiguous Second Ledger", NOW), /already has an operational workspace/);
  const second = store.createUser({ displayName: "Another authenticated owner", email: null }, NOW);
  assert.throws(() => store.getWorkspace(workspace.workspaceId, second.userId), (error: unknown) => error instanceof ProductPermissionError && error.status === 403);
  assert.throws(() => store.listJobs(workspace.workspaceId, null), (error: unknown) => error instanceof ProductPermissionError && error.status === 401);
  assert.throws(() => store.createJob(workspace.workspaceId, second.userId, {
    title: "Intrusion", recipientName: "Nobody", recipientEmail: "nobody@example.test", amountCents: 100,
    dueAt: null, priority: "normal",
  }, NOW), /permission/i);
});

test("demo cannot create operational jobs or enter real financial states", () => {
  const { store } = setup();
  const { user } = owner(store);
  assert.throws(() => store.createJob("demo", user.userId, {
    title: "Fake operational", recipientName: "Fake", recipientEmail: "fake@example.test", amountCents: 100,
    dueAt: null, priority: "normal",
  }, NOW), /operational workspace/i);
  assert.throws(() => store.approveJob("demo", "demo-approval", user.userId, NOW), /operational workspace/i);
});

test("demo reset is owner-controlled and cannot remove operational history", () => {
  const { store } = setup();
  const { user } = owner(store);
  const workspace = store.createOperationalWorkspace(user.userId, "Keep Me", NOW);
  store.createJob(workspace.workspaceId, user.userId, {
    title: "Durable obligation", recipientName: "Real recipient", recipientEmail: "real@example.test", amountCents: 100,
    dueAt: null, priority: "normal",
  }, NOW);
  store.resetDemo(user.userId, NOW);
  assert.equal(store.listJobs(workspace.workspaceId, user.userId).length, 1);
  assert.ok(store.listJobs("demo", null).length >= 3);
  assert.ok(store.listReceipts(workspace.workspaceId, user.userId).every((receipt) => receipt.origin !== "synthetic"));
});
