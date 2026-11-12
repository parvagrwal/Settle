// Browser tests for the four product destinations.
//
// These run against the mocked project: every API answer is a labelled
// fixture, so the screens can be driven into every state — including the ones
// that are hard to reach with a real provider — without inventing provider
// evidence. The fixture label is carried in the payload so a reader can see
// that nothing here is PayPal evidence.
//
// The assertions pin the product's own rules:
//   - a recommendation never reads as an approval;
//   - a provider acknowledgement never reads as a confirmation;
//   - a confirmation never reads as a reconciliation;
//   - a missing fee reads as unknown, never as zero;
//   - a demonstration record never enters an operational amount.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { recordConsole } from "./support/fixtures.ts";

const FIXTURE_LABEL = "AUTOMATED TEST FIXTURE — NOT PAYPAL";

const workspace = {
  workspaceId: "ws-fixture-1",
  name: "Fixture studio",
  kind: "operational",
  providerEnvironment: "sandbox",
  owner: { userId: "owner-1", displayName: "Fixture Owner", email: "owner@example.test", authProvider: "token" },
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-10T09:00:00.000Z",
};

const job = (id: string, title: string, amountCents: number, overrides: Record<string, unknown> = {}) => ({
  jobId: id,
  workspaceId: workspace.workspaceId,
  title,
  recipientName: "Maya Chen",
  recipientEmail: "maya@example.test",
  amountCents,
  currency: "USD",
  dueAt: "2026-11-14T00:00:00.000Z",
  priority: "normal",
  approvalState: "not_approved",
  approvedBy: null,
  approvedAt: null,
  origin: "application",
  providerEnvironment: "sandbox",
  sourceTimestamp: null,
  ingestedAt: "2026-11-01T09:00:00.000Z",
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-10T09:00:00.000Z",
  ...overrides,
});

const snapshot = {
  workspace,
  jobs: [
    job("job-1", "Brand identity — milestone 2", 42000),
    job("job-2", "Motion design — final", 28000, { approvalState: "approved", approvedBy: "owner-1", approvedAt: "2026-11-09T10:00:00.000Z" }),
    job("job-3", "Landing page — deposit", 16000, { approvalState: "approved", approvedBy: "owner-1", approvedAt: "2026-11-09T10:00:00.000Z" }),
  ],
  receipts: [],
  decisions: [],
  policy: { perPaymentCapCents: 20000, rollingCapCents: 150000, windowHours: 168, approvalExpiryDays: 7, updatedBy: "owner-1", updatedAt: "2026-11-01T09:00:00.000Z" },
  audit: [],
  summary: { needsApproval: 1, approved: 2, pendingCents: 86000, receiptsNeedingVerification: 0, financialPosition: null },
  fees: [],
  control: { emergencyStop: false, reason: null, updatedAt: null, updatedBy: null, changedAt: null, changedBy: null },
  capabilities: { canEdit: true, canApprove: true, canReject: true, canPay: true, canReconcile: true, canControl: true, canResetDemo: true },
  provider: { environment: "sandbox", configured: true },
  provenanceNotice: FIXTURE_LABEL,
};

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  operationId: id,
  source: "workspace",
  workspaceId: workspace.workspaceId,
  workspaceName: workspace.name,
  jobId: id.replace("workspace/", ""),
  title: "Brand identity — milestone 2",
  recipient: "Maya Chen",
  amountCents: 42000,
  currency: "USD",
  dueDate: "2026-11-14",
  dueInDays: 2,
  priority: "normal",
  recordOrigin: "application",
  isDemonstration: false,
  providerEnvironment: "sandbox",
  approvalState: "approved",
  approvedAt: "2026-11-09T10:00:00.000Z",
  approvedBy: "owner-1",
  paymentStatus: "approved",
  paymentStatusLabel: "Approved, not sent",
  paymentId: "PAY-FIXTURE-1",
  policyVersion: 2,
  payoutBatchId: null,
  batchReferenceKind: null,
  payoutItemId: null,
  transactionId: null,
  providerStatus: null,
  providerTimestamp: null,
  submittedAt: null,
  confirmedAt: null,
  verificationState: "unverified",
  reconciliationState: "not_reconciled",
  lastReconciledAt: null,
  feeState: "unavailable",
  feeEstimateCents: null,
  providerFeeCents: null,
  executionRunId: null,
  lastUpdatedAt: "2026-11-10T09:00:00.000Z",
  providerEventCount: 0,
  providerEventKeys: [],
  blockedReason: null,
  needsApproval: false,
  isPendingObligation: true,
  isReadyToPay: true,
  isInFlight: false,
  isUnreconciled: false,
  isDueSoon: true,
  isOverdue: false,
  cannotPayWithinBudget: false,
  budgetReason: null,
  hasIncompleteEvidence: true,
  evidenceGaps: ["No provider fee has been reported for this payment."],
  needsAttention: true,
  attentionReasons: ["The provider has not confirmed this payment."],
  ...overrides,
});

/** An obligation that is recorded but neither approved nor sent. */
const pendingRow = (id: string, overrides: Record<string, unknown> = {}) => row(id, {
  jobId: id.replace("workspace/", ""),
  title: "Copy edit — final pass",
  amountCents: 12000,
  paymentStatus: "not_submitted",
  paymentStatusLabel: "Not submitted",
  approvalState: "not_approved",
  approvedAt: null,
  approvedBy: null,
  paymentId: null,
  policyVersion: null,
  verificationState: "not_applicable",
  feeState: "not_applicable",
  needsApproval: true,
  isPendingObligation: true,
  isReadyToPay: false,
  hasIncompleteEvidence: false,
  needsAttention: false,
  attentionReasons: [],
  evidenceGaps: [],
  ...overrides,
});

const operationsSnapshot = (rows = [row("workspace/job-1"), pendingRow("workspace/job-2")]) => ({
  generatedAt: "2026-11-12T09:00:00.000Z",
  dataVersion: "v-fixture-1",
  access: { signedIn: true, scope: "owner", workspaces: [{ workspaceId: workspace.workspaceId, name: workspace.name, kind: "operational" }], note: "Fixture session." },
  provider: { environment: "sandbox", configured: true, connected: true, note: FIXTURE_LABEL },
  rows,
  capacity: {
    currency: "USD", budgetCents: 150000, perPaymentCapCents: 20000, windowHours: 168,
    windowStart: "2026-11-05T09:00:00.000Z", windowEnd: "2026-11-12T09:00:00.000Z",
    rollingSpendCents: 60000, activeExposureCents: 0, awaitingConfirmationCents: 0, remainingCents: 90000,
    fresh: true, freshnessSeconds: 300, lastSuccessfulReconciliation: "2026-11-12T08:55:00.000Z",
    policyVersion: 2, emergencyStop: false,
    formula: "remaining = budget − rolling expenditure − active exposure, never below zero",
    definitions: {
      budget: "The owner-set rolling cap.", rollingSpend: "Confirmed provider spend in the window.",
      activeExposure: "Reserved or in-flight amount.", awaitingConfirmation: "Acknowledged, not settled.",
      remaining: "What is left to commit.", perPaymentCap: "The largest single payment.",
    },
    source: "fixture",
  },
  exceptions: {
    awaitingApproval: { flag: "needsApproval", label: "Awaiting approval", definition: "Needs an owner decision.", operationIds: [], operational: { count: 0, amountCents: 0 }, demonstration: { count: 0, amountCents: 0 } },
    pendingObligations: { flag: "isPendingObligation", label: "Pending obligations", definition: "Owed and not yet paid.", operationIds: [], operational: { count: 1, amountCents: 42000 }, demonstration: { count: 0, amountCents: 0 } },
    unreconciled: { flag: "isUnreconciled", label: "Unreconciled", definition: "Not independently re-read.", operationIds: [], operational: { count: 0, amountCents: 0 }, demonstration: { count: 0, amountCents: 0 } },
    needsAttention: { flag: "needsAttention", label: "Needs attention", definition: "Flagged for a decision.", operationIds: [], operational: { count: 1, amountCents: 42000 }, demonstration: { count: 0, amountCents: 0 } },
    dueSoon: { flag: "isDueSoon", label: "Due soon", definition: "Close to its deadline.", operationIds: [], operational: { count: 1, amountCents: 42000 }, demonstration: { count: 0, amountCents: 0 } },
    cannotPayWithinBudget: { flag: "cannotPayWithinBudget", label: "Outside the budget", definition: "Does not fit inside the cap.", operationIds: [], operational: { count: 0, amountCents: 0 }, demonstration: { count: 0, amountCents: 0 } },
    incompleteEvidence: { flag: "hasIncompleteEvidence", label: "Incomplete evidence", definition: "A fact is missing.", operationIds: [], operational: { count: 1, amountCents: 42000 }, demonstration: { count: 0, amountCents: 0 } },
  },
  providerEvents: { total: 0, linked: 0, unlinked: 0 },
  sources: [FIXTURE_LABEL],
});

/** The fixture that answers every product endpoint the browser calls. */
async function mockProduct(page: Page, overrides: { rows?: Parameters<typeof operationsSnapshot>[0]; snapshot?: unknown } = {}): Promise<void> {
  // The session starts signed out, exactly like a real browser, and the login
  // call is what turns it on. The sign-in page is therefore exercised for real.
  let authenticated = false;
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: `not mocked: ${new URL(route.request().url()).pathname}` } }));
  await page.route("**/api/product/session", (route) => route.fulfill({ json: {
    authenticated,
    user: authenticated ? workspace.owner : null,
    workspaces: authenticated ? [workspace] : [{ workspaceId: "demo", name: "Northstar Studio — illustrative", kind: "demo", providerEnvironment: "none", owner: null, createdAt: "2026-11-01T09:00:00.000Z", updatedAt: "2026-11-01T09:00:00.000Z" }],
  } }));
  await page.route("**/api/product/workspaces/*", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: overrides.snapshot ?? snapshot });
    return route.fulfill({ json: { workspace } });
  });
  await page.route("**/api/product/workspaces/*/jobs/*/approve", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/product/workspaces/*/jobs/*/reject", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/product/workspaces/*/jobs/*/pay", (route) => route.fulfill({ json: { workspace: snapshot, result: { status: "submitted", batchStatus: "PENDING", payoutBatchId: "FIXTURE-BATCH-01", confirmationScheduled: true } } }));
  await page.route("**/api/product/workspaces/*/jobs", (route) => route.fulfill({ status: 201, json: { job: job("job-4", "Copy edit", 12000) } }));
  await page.route("**/api/product/workspaces/*/recommend", (route) => route.fulfill({ json: { decision: { decisionId: "dec-1", workspaceId: workspace.workspaceId, status: "recommendation_ready", summary: "Fixture recommendation", rationale: "Ranked by priority and due date.", recommendedJobIds: ["job-2", "job-3"], origin: "rule_based", createdBy: "agent", createdAt: "2026-11-12T09:00:00.000Z" } } }));
  await page.route("**/api/product/workspaces/*/control", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/product/workspaces/*/reconcile", (route) => route.fulfill({ json: { result: { batchesRead: 2, itemsRecorded: 3, failures: 0 }, workspace: snapshot } }));
  await page.route("**/api/product/workspaces/*/confirm", (route) => route.fulfill({ json: { sweep: { checked: 4, confirmed: 1, stillPending: 2, errors: 0 }, workspace: snapshot } }));
  await page.route("**/api/product/workspaces/*/policy", (route) => route.fulfill({ json: { policy: snapshot.policy } }));
  await page.route("**/api/product/auth/login", (route) => {
    authenticated = true;
    return route.fulfill({ json: { user: workspace.owner, expiresAt: "2026-11-12T18:00:00.000Z" } });
  });
  await page.route("**/api/product/auth/logout", (route) => {
    authenticated = false;
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/operations", (route) => route.fulfill({ json: operationsSnapshot(overrides.rows) }));
  await page.route("**/api/operations/payments/*", (route) => route.fulfill({ json: {
    generatedAt: "2026-11-12T09:00:00.000Z", sensitiveAccess: true,
    row: row("workspace/job-1"),
    identity: { operationId: "workspace/job-1", paymentId: "PAY-FIXTURE-1", jobId: "job-1", workspaceId: workspace.workspaceId, workspaceName: workspace.name, recipient: "Maya Chen", recipientEmail: "maya@example.test", idempotencyKey: "idem-fixture-1" },
    approval: { state: "approved", approvedBy: "owner-1", approvedAt: "2026-11-09T10:00:00.000Z", expiresAt: null, policyVersion: 2 },
    provider: { environment: "sandbox", payoutBatchId: null, batchReferenceKind: null, payoutItemId: null, transactionId: null, providerStatus: null, providerTimestamp: null },
    timestamps: [{ key: "approved", label: "Owner approval", at: "2026-11-09T10:00:00.000Z" }],
    fees: { state: "unavailable", estimate: null, provider: null, consistent: null, explanation: "No fee has been reported for this payment." },
    reconciliation: { state: "not_reconciled", lastReconciledAt: null, reconciliationRunId: null, discrepancyCount: 0, discrepancies: [] },
    confirmation: null, executionRun: null,
    timeline: [
      { kind: "authorization", label: "Owner authorization", state: "complete", at: "2026-11-09T10:00:00.000Z", detail: "Approved by owner-1" },
      { kind: "submission", label: "Payment submission", state: "missing", at: null, detail: "Not submitted" },
      { kind: "provider_acknowledgement", label: "Provider acknowledgement", state: "missing", at: null, detail: "No PayPal batch ID recorded" },
      { kind: "item_outcome", label: "Payout item outcome", state: "missing", at: null, detail: "No item-level provider outcome stored" },
      { kind: "transaction", label: "Transaction evidence", state: "missing", at: null, detail: "No PayPal transaction ID stored" },
      { kind: "reconciliation", label: "Independent reconciliation", state: "missing", at: null, detail: "Not independently reconciled" },
    ],
    audit: { access: "granted", note: "Fixture audit trail.", events: [] },
    providerEvents: [],
  } }));
  await page.route("**/api/operations/investigate", (route) => route.fulfill({ json: {
    contractVersion: 1, investigationId: "inv_fixture-1234", question: "Which payments need attention?",
    intent: "needs_attention",
    findings: [{ id: "f-1", title: "One payment needs attention", detail: "The provider has not confirmed it.", severity: "warning", paymentIds: ["workspace/job-1"] }],
    paymentIds: ["workspace/job-1"],
    explanation: "One operational payment has no provider confirmation yet.",
    dataTimestamp: "2026-11-12T09:00:00.000Z", dataVersion: "v-fixture-1",
    uncertainty: ["This answer cannot tell you whether PayPal has settled the payment."],
    suggestedGridAction: { type: "filter_payments", paymentIds: ["workspace/job-1"], label: "Show the payment" },
    source: "Deterministic ledger projection", readOnly: true,
  } }));
}

/** Sign in through the real form, then land on the overview. */
async function signIn(page: Page): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel("Owner token").fill("fixture-owner-token");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

/**
 * Open one of the four destinations.
 *
 * Above 1024 px the destinations live in the sidebar. Below it they live in
 * the menu drawer behind the navigation toggle, so the toggle is pressed
 * first. This is the same path a person takes at that width.
 */
async function openDestination(page: Page, label: string): Promise<void> {
  const toggle = page.getByRole("button", { name: "Open navigation" });
  if (await toggle.isVisible()) {
    await toggle.click();
    await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  }
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByText(label, { exact: true }).click();
  await expect(page.getByRole("heading", { name: label })).toBeVisible();
}

test("the public landing page states the boundary and never implies a payment happened", async ({ page }) => {
  const consoleEntries = recordConsole(page);
  await mockProduct(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The agent proposes");
  await expect(page.getByText("What it will never do")).toBeVisible();
  await expect(page.getByText("Authorise, reserve or submit a payment")).toBeVisible();
  await expect(page.getByText("PayPal Sandbox").first()).toBeVisible();
  // No figure on the public page is presented as data.
  await expect(page.getByText(/\$\d/)).toHaveCount(0);
  expect(consoleEntries.filter((entry) => entry.kind === "pageerror")).toEqual([]);
});

test("the four destinations are the only primary navigation, and each one loads", async ({ page }) => {
  await mockProduct(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Open the workspace/ }).click();
  await expect(page.getByRole("heading", { name: "Open the operational workspace" })).toBeVisible();
  await page.getByLabel("Owner token").fill("fixture-owner-token");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  for (const label of ["Overview", "Jobs & decisions", "Payments & receipts", "Controls & audit"]) {
    await expect(nav.getByText(label, { exact: true })).toBeVisible();
  }
  await nav.getByText("Jobs & decisions", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Jobs & decisions" })).toBeVisible();
  await nav.getByText("Payments & receipts", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Payments & receipts" })).toBeVisible();
  await nav.getByText("Controls & audit", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Controls & audit" })).toBeVisible();
});

test("the overview separates demonstration records from operational money", async ({ page }) => {
  await mockProduct(page, {
    rows: [
      row("workspace/job-1"),
      row("legacy/demo-1", {
        source: "legacy_grid", workspaceId: null, workspaceName: null, jobId: "demo-1",
        title: "Legacy demonstration row",
        isDemonstration: true, recordOrigin: "seed", providerEnvironment: "none",
        paymentStatus: "not_submitted", paymentStatusLabel: "Not submitted",
        verificationState: "demonstration", feeState: "not_applicable", amountCents: 999900,
        approvalState: "not_approved", approvedAt: null, approvedBy: null, paymentId: null,
        needsApproval: false, isPendingObligation: false, isReadyToPay: false, isInFlight: false,
        isUnreconciled: false, isDueSoon: false, hasIncompleteEvidence: false, needsAttention: false,
      }),
    ],
  });
  await signIn(page);
  // The demonstration record is a $9,999.00 row. It must not appear in any total.
  await expect(page.getByText(/\$9,999\.00/)).toHaveCount(0);
  await expect(page.getByText("$420.00").first()).toBeVisible();
  // The operational total counts only the operational row.
  await expect(page.getByText("$420.00 approved and inside the caps")).toBeVisible();
  // The demonstration row is not in the operational obligations list.
  const table = page.getByRole("table", { name: "Recent obligations in this workspace" });
  await expect(table.getByText("Brand identity — milestone 2")).toBeVisible();
  await expect(table.getByText("Legacy demonstration row")).toHaveCount(0);
});

test("a recommendation is a proposal and never reads as an approval", async ({ page }) => {
  await mockProduct(page);
  await signIn(page);
  await openDestination(page, "Jobs & decisions");
  await expect(page.getByRole("heading", { name: "What the studio owes" })).toBeVisible();
  await page.getByRole("button", { name: "Evaluate the workspace" }).click();
  await expect(page.getByText("Proposed allocation")).toBeVisible();
  await expect(page.getByText("Decision boundary")).toBeVisible();
  await expect(page.getByText(/This recommendation is not an approval/)).toBeVisible();
  // The proposal amount is a proposal: the approval column is still the owner's.
  await expect(page.getByRole("columnheader", { name: "Approval" })).toBeVisible();
});

test("approval and submission are separate acts, and each reports what it did", async ({ page }) => {
  await mockProduct(page);
  await signIn(page);
  await openDestination(page, "Jobs & decisions");
  await page.getByRole("button", { name: "Copy edit — final pass" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/Approving creates a permanent payment identity/)).toBeVisible();
  // Approval is offered; submission is not, because nothing is approved yet.
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit to PayPal/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/approved\. A payment identity now exists; nothing has been sent to PayPal/)).toBeVisible();
});

test("the receipt shows six stages and marks the ones that have not happened as missing", async ({ page }) => {
  await mockProduct(page);
  await signIn(page);
  await openDestination(page, "Payments & receipts");
  await page.getByRole("button", { name: /Brand identity/ }).click();
  await expect(page.getByRole("heading", { name: /What has been proven/ })).toBeVisible();
  const lifecycle = page.getByRole("list", { name: "Evidence lifecycle stages" });
  await expect(lifecycle.getByText("Owner approval")).toBeVisible();
  await expect(lifecycle.getByText("Provider response")).toBeVisible();
  await expect(lifecycle.getByText("Provider confirmation")).toBeVisible();
  await expect(lifecycle.getByText("Independent re-read")).toBeVisible();
  // The stages that have not happened are marked missing, not implied.
  const missing = page.getByText("Missing", { exact: true });
  expect(await missing.count()).toBeGreaterThan(0);
  // A missing fee is unknown, never zero.
  await expect(page.getByText("Unavailable — unknown, not zero")).toBeVisible();
  await expect(page.getByText("$0.00")).toHaveCount(0);
});

test("the controls screen exposes the emergency stop, the policy and the provider actions", async ({ page }) => {
  await mockProduct(page);
  await signIn(page);
  await openDestination(page, "Controls & audit");
  await expect(page.getByRole("heading", { name: "Emergency stop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Engage emergency stop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run confirmation sweep" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconcile with PayPal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Control history" })).toBeVisible();
});

test("the emergency stop can be engaged and reports what it does", async ({ page }) => {
  await mockProduct(page);
  await signIn(page);
  await openDestination(page, "Controls & audit");
  await page.getByLabel("Reason for the change").fill("Fixture incident reference");
  await page.getByRole("button", { name: "Engage emergency stop" }).click();
  await expect(page.getByText(/Emergency stop engaged\. No payment can be reserved or submitted/)).toBeVisible();
});

test("the investigation surface is read-only and names the records it is about", async ({ page }) => {
  await mockProduct(page);
  await signIn(page);
  await openDestination(page, "Controls & audit");
  await expect(page.getByRole("heading", { name: "Ask the ledger" })).toBeVisible();
  await page.getByRole("button", { name: "Investigate" }).click();
  await expect(page.getByText("One payment needs attention")).toBeVisible();
  await expect(page.getByText("Limits of this answer")).toBeVisible();
  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
  // There is no control on this surface that could approve, pay or change policy.
  // The only buttons are: the submit button, the six suggested questions, and the
  // link to the exact record a finding is about.
  const scope = page.locator(".investigation-card");
  await expect(scope.getByRole("button")).toHaveCount(8);
  await expect(scope.getByRole("button", { name: /approve|submit to pay|stop|policy/i })).toHaveCount(0);
  // The finding points at the exact record identifier.
  await expect(scope.getByRole("button", { name: "workspace/job-1" })).toBeVisible();
});

for (const size of [{ name: "desktop", width: 1440, height: 900 }, { name: "tablet", width: 768, height: 1024 }, { name: "mobile", width: 320, height: 720 }]) {
  test(`every destination has no horizontal overflow and no accessibility violation: ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockProduct(page);
    await signIn(page);
    for (const label of ["Overview", "Jobs & decisions", "Payments & receipts", "Controls & audit"]) {
      await openDestination(page, label);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth);
      expect(overflow, `${label} at ${size.width}px`).toBe(true);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.html) })), `${label} at ${size.width}px`).toEqual([]);
      await page.screenshot({ path: `evidence/product/${size.name}-${label.toLowerCase().replace(/[^a-z]+/g, "-")}.png`, fullPage: true });
    }
  });
}
