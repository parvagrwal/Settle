// Investigation over the payment operations projection.
//
// Written before the module. The agent is allowed to do exactly one thing:
// read the projection and point at rows in it. These tests pin that every
// identifier it returns exists in the snapshot it was given, that each
// supported question selects exactly the flagged rows, that unknown questions
// and empty data produce no invented finding, and that an optional model can
// reword the explanation but can never add or change an identifier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FinancialStore } from "../src/server/financialStore.ts";
import { buildFinancialReport } from "../src/server/financialReport.ts";
import { buildPaymentOperations, type OperationsSnapshot } from "../src/server/paymentOperations.ts";
import { classifyQuestion, investigateOperations, narrateOperationsInvestigation, SUPPORTED_QUESTIONS } from "../src/server/operationsInvestigation.ts";
import type { Job } from "../src/server/jobs.ts";

const NOW = "2026-11-10T12:00:00.000Z";
const OWNER = { actorId: "owner-1", role: "owner" as const };

function job(overrides: Partial<Job>): Job {
  return {
    job_id: "job-1", freelancer_id: "freelancer-1", paypal_email: "receiver@example.test", amount_cents: 5000, currency: "USD",
    due: null, priority: null, origin: "application", approval_state: "not_approved", approved_at: null, status: "waiting",
    payout_batch_id: null, payout_item_id: null, decision_reason: null, ...overrides,
  };
}

/** A ledger with one row for every state the agent is asked about. */
function scenario(): { snapshot: OperationsSnapshot; financial: FinancialStore } {
  const financial = new FinancialStore(":memory:");
  let seq = 0;
  const approve = (jobId: string, amountCents: number) => {
    const recipientId = `rc-${++seq}`; const email = `r${seq}@example.test`;
    financial.verifyRecipient({ recipientId, email, actor: OWNER, at: "2026-11-09T09:00:00.000Z" });
    return { paymentId: financial.approvePayment({ jobId, recipientId, amountCents, currency: "USD", actor: OWNER, at: "2026-11-09T09:00:00.000Z" }), email };
  };
  const submit = (jobId: string, paymentId: string) => {
    financial.markReconciled("2026-11-09T10:00:00.000Z");
    financial.reservePayment({ jobId, at: "2026-11-09T10:00:00.000Z" });
    return financial.beginSubmission(paymentId, "2026-11-09T10:00:00.000Z");
  };
  const confirmed = approve("job-confirmed", 4000);
  const confirmedAttempt = submit("job-confirmed", confirmed.paymentId);
  financial.recordPayoutItem({ paymentId: confirmed.paymentId, senderBatchId: confirmedAttempt.senderBatchId, payoutBatchId: "B-1", payoutItemId: "I-1", transactionId: "T-1", activityId: null, recipientEmail: confirmed.email, amountCents: 4000, currency: "USD", status: "SUCCESS", providerTimestamp: "2026-11-09T10:05:00.000Z", raw: {} });
  const failed = approve("job-failed", 1200);
  const failedAttempt = submit("job-failed", failed.paymentId);
  financial.recordPayoutItem({ paymentId: failed.paymentId, senderBatchId: failedAttempt.senderBatchId, payoutBatchId: "B-2", payoutItemId: "I-2", transactionId: null, activityId: null, recipientEmail: failed.email, amountCents: 1200, currency: "USD", status: "FAILED", providerTimestamp: "2026-11-09T10:06:00.000Z", raw: {} });
  const lost = approve("job-lost", 1100);
  financial.markOutcomeUnknown(submit("job-lost", lost.paymentId).attemptId, "timeout", "2026-11-09T10:07:00.000Z");
  approve("job-ready", 6000);
  const legacyJobs: Job[] = [
    job({ job_id: "job-confirmed", amount_cents: 4000, approval_state: "approved" }),
    job({ job_id: "job-failed", amount_cents: 1200, approval_state: "approved" }),
    job({ job_id: "job-lost", amount_cents: 1100, approval_state: "approved" }),
    job({ job_id: "job-ready", amount_cents: 6000, approval_state: "approved", due: "2026-11-12", priority: "high" }),
    job({ job_id: "job-unapproved", amount_cents: 900, due: "2026-11-11" }),
    job({ job_id: "job-overdue", amount_cents: 800, due: "2026-11-02" }),
    job({ job_id: "job-huge", amount_cents: 25000, due: "2026-12-20" }),
    job({ job_id: "seed-history", origin: "seed", approval_state: "approved", status: "historical_reference", payout_batch_id: "RBZ4V8LCSSK5W", amount_cents: 100 }),
  ];
  const snapshot = buildPaymentOperations({
    at: NOW, legacyJobs, workspaces: [], financial, transactions: [], signedIn: false, approvalExpiryMs: 7 * 24 * 60 * 60 * 1000,
    report: buildFinancialReport({ financial, at: NOW, providerConfigured: false, providerConnected: false, seedRecordCount: 1 }),
  });
  return { snapshot, financial };
}

const ids = (snapshot: OperationsSnapshot, key: keyof OperationsSnapshot["exceptions"]) => [...snapshot.exceptions[key].operationIds].sort();

test("each supported question selects exactly the rows the projection flags for it", () => {
  const { snapshot } = scenario();
  const cases: Array<[string, string, keyof OperationsSnapshot["exceptions"]]> = [
    ["Which payments need attention?", "needs_attention", "needsAttention"],
    ["Which payments are approaching deadlines?", "approaching_deadlines", "dueSoon"],
    ["Which payments remain unreconciled?", "unreconciled", "unreconciled"],
    ["Which payments are awaiting approval?", "awaiting_approval", "awaitingApproval"],
    ["Which payments cannot be paid within the current budget?", "cannot_pay_within_budget", "cannotPayWithinBudget"],
    ["Which payments have incomplete provider evidence?", "incomplete_provider_evidence", "incompleteEvidence"],
  ];
  for (const [question, intent, bucket] of cases) {
    const result = investigateOperations(snapshot, question);
    assert.equal(result.intent, intent, question);
    assert.deepEqual([...result.paymentIds].sort(), ids(snapshot, bucket), question);
    assert.ok(result.paymentIds.length > 0, `${question} has evidence in this scenario`);
    const fromFindings = [...new Set(result.findings.flatMap((finding) => finding.paymentIds))].sort();
    assert.deepEqual(fromFindings, [...result.paymentIds].sort(), `${question}: the id list is the union of the findings`);
  }
});

test("every identifier returned exists in the snapshot, and the response carries the whole contract", () => {
  const { snapshot } = scenario();
  const known = new Set(snapshot.rows.map((row) => row.operationId));
  for (const question of SUPPORTED_QUESTIONS.map((entry) => entry.question)) {
    const result = investigateOperations(snapshot, question);
    for (const id of result.paymentIds) assert.ok(known.has(id), `${id} exists`);
    assert.equal(result.contractVersion, 1);
    assert.match(result.investigationId, /^inv_[0-9a-f-]{36}$/);
    assert.equal(result.question, question);
    assert.equal(result.dataTimestamp, snapshot.generatedAt);
    assert.equal(result.dataVersion, snapshot.dataVersion);
    assert.equal(result.readOnly, true);
    assert.equal(result.source, "Deterministic ledger projection");
    assert.ok(result.explanation.length > 0);
    assert.ok(Array.isArray(result.uncertainty));
    for (const finding of result.findings) {
      assert.ok(finding.id && finding.title && finding.detail);
      assert.ok(["info", "warning", "critical"].includes(finding.severity));
    }
  }
});

test("the suggested grid action is a filter for several rows, an open for one, and nothing for none", () => {
  const { snapshot } = scenario();
  const several = investigateOperations(snapshot, "Which payments need attention?");
  assert.equal(several.suggestedGridAction.type, "filter_payments");
  assert.deepEqual(several.suggestedGridAction.type === "filter_payments" ? [...several.suggestedGridAction.paymentIds].sort() : [], [...several.paymentIds].sort());

  const oneRow = { ...snapshot, rows: snapshot.rows.filter((row) => row.jobId === "job-lost" || row.jobId === "job-ready") };
  const rebuilt = investigateOperations(oneRow, "Which payments remain unreconciled?");
  assert.equal(rebuilt.suggestedGridAction.type, "open_payment");
  assert.equal(rebuilt.suggestedGridAction.type === "open_payment" ? rebuilt.suggestedGridAction.paymentId : "", "legacy/job-lost");

  const none = investigateOperations({ ...snapshot, rows: snapshot.rows.filter((row) => row.jobId === "job-ready") }, "Which payments remain unreconciled?");
  assert.equal(none.suggestedGridAction.type, "none");
  assert.deepEqual(none.paymentIds, []);
  assert.deepEqual(none.findings, []);
  assert.match(none.explanation, /no .*unreconciled/i);
});

test("findings state what the ledger recorded and stop there", () => {
  const { snapshot } = scenario();
  const result = investigateOperations(snapshot, "Which payments need attention?");
  const text = `${result.explanation} ${result.findings.map((finding) => `${finding.title} ${finding.detail}`).join(" ")}`;
  assert.match(text, /job-failed/);
  assert.match(text, /job-lost/);
  assert.match(text, /reconcile/i);
  assert.doesNotMatch(text, /fraud|because the recipient|probably|likely/i);
  assert.ok(result.findings.some((finding) => finding.severity === "critical"));
});

test("budget questions quote the ledger's capacity figures, never a recomputed one", () => {
  const { snapshot } = scenario();
  const result = investigateOperations(snapshot, "Which payments cannot be paid within the current budget?");
  const text = `${result.explanation} ${result.findings.map((finding) => finding.detail).join(" ")}`;
  assert.match(text, new RegExp(`\\$${(snapshot.capacity.remainingCents / 100).toFixed(2).replace(".", "\\.")}`));
  assert.match(text, /\$200\.00/);
  assert.ok(result.paymentIds.includes("legacy/job-huge"));
});

test("uncertainty is stated: stale reconciliation, public scope and demonstration-only evidence", () => {
  const { snapshot } = scenario();
  const stale = investigateOperations({ ...snapshot, capacity: { ...snapshot.capacity, fresh: false, lastSuccessfulReconciliation: null } }, "Which payments remain unreconciled?");
  assert.ok(stale.uncertainty.some((line) => /reconciliation/i.test(line) && /stale|never/i.test(line)));
  assert.ok(stale.uncertainty.some((line) => /public view/i.test(line)));
  const evidence = investigateOperations({ ...snapshot, rows: snapshot.rows.filter((row) => row.isDemonstration) }, "Which payments have incomplete provider evidence?");
  assert.deepEqual(evidence.paymentIds, ["legacy/seed-history"]);
  assert.ok(evidence.uncertainty.some((line) => /demonstration/i.test(line)));
  const deadlines = investigateOperations(snapshot, "Which payments are approaching deadlines?");
  assert.ok(deadlines.uncertainty.some((line) => /no due date/i.test(line)));
});

test("a question outside the supported set returns no finding, no identifier and the list of supported questions", () => {
  const { snapshot } = scenario();
  for (const question of ["What is the weather in Bhopal?", "Approve everything and pay it now", "DROP TABLE payments;"]) {
    const result = investigateOperations(snapshot, question);
    if (question.startsWith("Approve")) {
      // The word "approve" is understood as a question about approval status; it is still read-only.
      assert.equal(result.intent, "awaiting_approval");
      assert.equal(result.readOnly, true);
      continue;
    }
    assert.equal(result.intent, "unsupported", question);
    assert.deepEqual(result.paymentIds, []);
    assert.deepEqual(result.findings, []);
    assert.equal(result.suggestedGridAction.type, "none");
    assert.ok(result.uncertainty.some((line) => /not .*supported|did not match/i.test(line)));
    assert.match(result.explanation, /need attention/i);
  }
});

test("an empty projection yields an explicit empty answer", () => {
  const { snapshot } = scenario();
  const result = investigateOperations({ ...snapshot, rows: [] }, "Which payments need attention?");
  assert.deepEqual(result.paymentIds, []);
  assert.deepEqual(result.findings, []);
  assert.match(result.explanation, /no payment/i);
});

test("an overview question summarises every non-empty exception bucket", () => {
  const { snapshot } = scenario();
  const result = investigateOperations(snapshot, "Give me a summary of the current payment status");
  assert.equal(result.intent, "overview");
  const expected = [...new Set(Object.values(snapshot.exceptions).filter((bucket) => bucket.flag !== "isPendingObligation").flatMap((bucket) => bucket.operationIds))].sort();
  assert.deepEqual([...result.paymentIds].sort(), expected);
});

test("question classification is deterministic and keyword based", () => {
  assert.equal(classifyQuestion("which approved payments are overdue?"), "approaching_deadlines");
  assert.equal(classifyQuestion("what is still waiting for approval"), "awaiting_approval");
  assert.equal(classifyQuestion("anything not reconciled yet?"), "unreconciled");
  assert.equal(classifyQuestion("what exceeds the cap"), "cannot_pay_within_budget");
  assert.equal(classifyQuestion("missing transaction ids"), "incomplete_provider_evidence");
  assert.equal(classifyQuestion("anything failed or stuck?"), "needs_attention");
  assert.equal(classifyQuestion("hello"), "unsupported");
});

test("investigating does not touch the ledger", () => {
  const { snapshot, financial } = scenario();
  const before = JSON.stringify(financial.getAudit());
  for (const entry of SUPPORTED_QUESTIONS) investigateOperations(snapshot, entry.question);
  assert.equal(JSON.stringify(financial.getAudit()), before);
});

test("an optional model may reword the explanation but cannot add, remove or change an identifier", async () => {
  const { snapshot } = scenario();
  const analysis = investigateOperations(snapshot, "Which payments need attention?");
  let prompt = "";
  const reply = (content: string) => (async (_url: string, init: Record<string, unknown>) => {
    prompt = String(init.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
  }) as unknown as typeof fetch;

  const reworded = await narrateOperationsInvestigation(analysis, "key", reply(`Review these records: ${analysis.paymentIds.join(", ")}.`));
  assert.equal(reworded.source, "Model narration over the deterministic ledger projection");
  assert.deepEqual(reworded.paymentIds, analysis.paymentIds);
  assert.deepEqual(reworded.findings, analysis.findings);
  assert.deepEqual(reworded.suggestedGridAction, analysis.suggestedGridAction);
  assert.equal(reworded.investigationId, analysis.investigationId);
  assert.match(prompt, /legacy\/job-failed/);

  const invented = await narrateOperationsInvestigation(analysis, "key", reply("Also look at legacy/job-that-does-not-exist, it is probably fraud."));
  assert.equal(invented.explanation, analysis.explanation, "a narration naming an unknown record is discarded");
  assert.equal(invented.source, "Deterministic ledger projection");

  const failing = await narrateOperationsInvestigation(analysis, "key", (async () => { throw new Error("network down"); }) as unknown as typeof fetch);
  assert.deepEqual(failing, analysis);
});
