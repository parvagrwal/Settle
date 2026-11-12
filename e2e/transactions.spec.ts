import { test, expect, type Page } from "@playwright/test";

const transaction = {
  rowKey: "TEST-POI-1", originalTransactionId: "TEST-TX-1", associatedOrderId: null,
  latestEventId: "TEST-WH-1", originalEventId: "TEST-WH-1", transactionTimestamp: "2026-11-09T10:00:00Z",
  eventCreatedAt: "2026-11-09T10:00:01Z", eventReceivedAt: "2026-11-09T10:00:02Z",
  status: "ONHOLD", grossCents: 12500, currency: "USD", feeCents: null, netCents: null,
  payerEmail: null, payeeEmail: "fixture@example.test", paymentMethod: "PAYPAL",
  payoutBatchId: "TEST-BATCH-1", payoutItemId: "TEST-POI-1", jobId: "test-job-1", relatedTransactionId: null,
  lastEventSequence: 1,
};

async function mockApplication(page: Page) {
  await page.route("**/api/grid", (route) => route.fulfill({ json: { rows: [] } }));
  await page.route("**/api/jobs", (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route("**/api/audit", (route) => route.fulfill({ json: { rows: [] } }));
  await page.route("**/api/caps", (route) => route.fulfill({ json: { per_payment_cap_cents: 20000, weekly_cap_cents: 150000, window_days: 7, approval_expiry_days: 7, worst_case_exposure: "$1,500" } }));
}

test("labeled fixture exercises inspection, evidence filtering and persisted delta update", async ({ page }) => {
  let cursor = 0;
  await mockApplication(page);
  await page.route("**/api/transactions?since=*", (route) => {
    const updated = { ...transaction, status: cursor === 0 ? "ONHOLD" : "SUCCESS", feeCents: cursor === 0 ? null : 25, netCents: cursor === 0 ? null : 12475, latestEventId: cursor === 0 ? "TEST-WH-1" : "TEST-WH-2", lastEventSequence: cursor === 0 ? 1 : 2 };
    const response = { transactions: cursor === 0 ? [transaction] : [updated], cursor: cursor === 0 ? 1 : 2, serverTime: new Date().toISOString(), source: "AUTOMATED TEST FIXTURE — NOT PAYPAL" };
    cursor = response.cursor;
    return route.fulfill({ json: response });
  });
  await page.route("**/api/transactions/TEST-POI-1/history", (route) => route.fulfill({ json: { transaction, events: [{ sequence: 1, eventId: "TEST-WH-1", eventType: "PAYMENT.PAYOUTS-ITEM.HELD", eventCreatedAt: transaction.eventCreatedAt, receivedAt: transaction.eventReceivedAt, transmissionId: "TEST-TRANSMISSION", outcome: "applied", resource: {} }] } }));
  await page.route("**/api/investigate", (route) => route.fulfill({ json: { question: "Which payments require investigation?", answer: "TEST-POI-1 is ONHOLD. Fixture response.", facts: [{ label: "Requires attention", value: "1", evidence: ["TEST-POI-1"] }], hypotheses: [], supportingTransactionIds: ["TEST-POI-1"], gridFilter: { transactionIds: ["TEST-POI-1"] }, generatedAt: new Date().toISOString(), source: "Automated fixture" } }));
  await page.goto("/legacy");
  await expect(page.getByText("Every status has a receipt.")).toBeVisible();
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(page.getByText("PAYMENT.PAYOUTS-ITEM.HELD")).toBeVisible();
  await expect(page.getByText("TEST-WH-1").first()).toBeVisible();
  await page.screenshot({ path: "evidence/browser/transaction-inspection.png", fullPage: true });
  await page.getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(page.getByText("TEST-POI-1 is ONHOLD. Fixture response.")).toBeVisible();
  await page.getByRole("button", { name: /Reveal 1 evidence rows/ }).click();
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  await expect(page.getByText("Cursor 2", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("SUCCESS", { exact: true }).first()).toBeVisible();
});

test("AG Studio mounts native chart/grid and serializes report state", async ({ page }) => {
  await mockApplication(page);
  await page.route("**/api/transactions?since=*", (route) => route.fulfill({ json: { transactions: [transaction], cursor: 1, serverTime: new Date().toISOString(), source: "AUTOMATED TEST FIXTURE — NOT PAYPAL" } }));
  await page.goto("/legacy");
  await page.getByRole("tab", { name: "AG Studio analytics" }).click();
  await expect(page.getByText("From pattern to payment population")).toBeVisible();
  await expect(page.locator(".transaction-studio canvas").first()).toBeVisible({ timeout: 20_000 });
  await page.locator(".transaction-studio").getByRole("button", { name: /^Status is/ }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("settle.studio.report.v2") !== null)).toBe(true);
  await page.screenshot({ path: "evidence/browser/studio-analytics.png", fullPage: true });
});

test("empty verified store stays explicit and never substitutes sample payments", async ({ page }) => {
  await mockApplication(page);
  await page.route("**/api/transactions?since=*", (route) => route.fulfill({ json: { transactions: [], cursor: 0, serverTime: new Date().toISOString(), source: "persisted verified PayPal events" } }));
  await page.goto("/legacy");
  await expect(page.getByText("No verified rows is a truthful empty state—not a demo failure. Mixed currencies are never summed; fixtures never enter this database.")).toBeVisible();
  await expect(page.getByText("TEST-POI-1")).toHaveCount(0);
});
