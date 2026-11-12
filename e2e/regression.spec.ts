// Regression suite for the existing AG Grid and AG Studio views.
//
// Written BEFORE any component was changed and run first against the audited
// commit (a459064). Each test is tagged with what it pins:
//
//   [preserved]  behaviour that worked at the audited commit and must keep working
//   [defect]     a reported or newly found defect; expected to fail at the audited
//                commit and pass after the fix
//
// Every API is answered by a labelled fixture; nothing here is PayPal evidence.
import { test, expect, type Page } from "@playwright/test";
import { agProblems, gridRowIds, horizontalOverflow, licenceNotices, mockApi, recordConsole, transaction, transactions, type TransactionFixture } from "./support/fixtures.ts";

async function openProviderEvents(page: Page): Promise<void> {
  await page.goto("/legacy");
  await page.getByRole("button", { name: "Verified transactions" }).click();
  await expect(page.getByText("Every status has a receipt.")).toBeVisible();
}

const eventsGrid = "[aria-label='Verified transaction operations']";

test("[preserved] the provider events grid renders the verified rows and the KPI tiles", async ({ page }) => {
  await mockApi(page, transactions(6));
  await openProviderEvents(page);
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  expect((await gridRowIds(page, eventsGrid)).sort()).toEqual(["TEST-POI-1", "TEST-POI-2", "TEST-POI-3", "TEST-POI-4", "TEST-POI-5", "TEST-POI-6"]);
  const kpis = page.getByLabel("Verified transaction totals");
  await expect(kpis.getByText("6", { exact: true })).toBeVisible();
  await expect(kpis.getByText("$525.00")).toBeVisible();
});

test("[defect A] rows stay in the grid across polls that bring no change", async ({ page }) => {
  await mockApi(page, transactions(6));
  await openProviderEvents(page);
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  // Two more polls (4 s apart) return nothing new. The rows must still be there.
  await page.waitForTimeout(9000);
  expect(await gridRowIds(page, eventsGrid)).toHaveLength(6);
  await expect(page.locator(`${eventsGrid} .ag-paging-row-summary-panel`)).toContainText("6");
  // An unrelated re-render (typing a question) must not empty the grid either.
  await page.getByLabel("Investigation question").fill("still there?");
  expect(await gridRowIds(page, eventsGrid)).toHaveLength(6);
});

test("[preserved] inspection opens the immutable event history with payment and webhook identities", async ({ page }) => {
  await mockApi(page, [transaction]);
  await openProviderEvents(page);
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  const drawer = page.getByLabel("Transaction history");
  await expect(drawer.getByText("PAYMENT.PAYOUTS-ITEM.PENDING")).toBeVisible();
  await expect(drawer.getByText("TEST-WH-1").first()).toBeVisible();
  await expect(drawer.getByText("TEST-TX-1")).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "TEST-POI-1" })).toBeVisible();
});

test("[defect F] the history drawer shows the received time from the server contract", async ({ page }) => {
  await mockApi(page, [transaction]);
  await openProviderEvents(page);
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  const drawer = page.getByLabel("Transaction history");
  await expect(drawer.getByText("PAYMENT.PAYOUTS-ITEM.PENDING")).toBeVisible();
  await expect(drawer.locator(".timeline")).toContainText("2026-11-09T10:00:02Z");
  await expect(drawer.locator(".timeline")).not.toContainText("undefined");
});

test("[preserved] a delta from the durable cursor updates the row in place", async ({ page }) => {
  let rows: TransactionFixture[] = [transaction];
  await mockApi(page, () => rows);
  await openProviderEvents(page);
  await expect(page.getByText("PENDING", { exact: true }).first()).toBeVisible();
  rows = [{ ...transaction, status: "SUCCESS", feeCents: 25, netCents: 12475, latestEventId: "TEST-WH-2", lastEventSequence: 2 }];
  await expect(page.getByText("Cursor 2", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(page.locator(`${eventsGrid} [row-id='TEST-POI-1']`).getByText("SUCCESS", { exact: true }).first()).toBeVisible();
  expect(await gridRowIds(page, eventsGrid)).toEqual(["TEST-POI-1"]);
});

test("[preserved] an empty verified store is stated plainly and never filled with sample payments", async ({ page }) => {
  await mockApi(page, []);
  await openProviderEvents(page);
  await expect(page.getByText("No verified rows is a truthful empty state—not a demo failure. Mixed currencies are never summed; fixtures never enter this database.")).toBeVisible();
  await expect(page.getByText("TEST-POI-1")).toHaveCount(0);
  expect(await gridRowIds(page, eventsGrid)).toEqual([]);
});

test("[defect B] revealing investigation evidence filters the grid to exactly the evidence rows, and clearing restores all rows", async ({ page }) => {
  await mockApi(page, transactions(6));
  await page.route("**/api/investigate", (route) => route.fulfill({ json: {
    question: "Which payments require investigation?", answer: "TEST-POI-1 and TEST-POI-3 need review. Fixture response.",
    facts: [{ label: "Requires attention", value: "2", evidence: ["TEST-POI-1", "TEST-POI-3"] }], hypotheses: [],
    supportingTransactionIds: ["TEST-POI-1", "TEST-POI-3"], gridFilter: { transactionIds: ["TEST-POI-1", "TEST-POI-3"] },
    generatedAt: new Date().toISOString(), source: "Automated fixture",
  } }));
  await openProviderEvents(page);
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(page.getByText("TEST-POI-1 and TEST-POI-3 need review. Fixture response.")).toBeVisible();
  await page.getByRole("button", { name: /Reveal 2 evidence rows/ }).click();
  await expect.poll(async () => (await gridRowIds(page, eventsGrid)).sort()).toEqual(["TEST-POI-1", "TEST-POI-3"]);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect.poll(async () => (await gridRowIds(page, eventsGrid)).length).toBe(6);
});

test("[defect C] a failed investigation request is shown to the user and is not an unhandled rejection", async ({ page }) => {
  const consoleEntries = recordConsole(page);
  await mockApi(page, transactions(3));
  await page.route("**/api/investigate", (route) => route.fulfill({ status: 500, json: { error: "investigation backend unavailable" } }));
  await openProviderEvents(page);
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(page.getByLabel("Evidence-grounded transaction investigation").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Investigate", exact: true })).toBeEnabled();
  expect(consoleEntries.filter((entry) => entry.kind === "pageerror")).toEqual([]);
  expect(await gridRowIds(page, eventsGrid)).toHaveLength(3);
});

test("[issues 1-4, 12] loading the grid logs no AG Grid error, missing-module error or deprecation warning", async ({ page }) => {
  const consoleEntries = recordConsole(page);
  await mockApi(page, transactions(6));
  await openProviderEvents(page);
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(agProblems(consoleEntries)).toEqual([]);
  await expect(page.getByText(/AG Grid found \d+ (error|warning)/)).toHaveCount(0);
});

test("[issues 2, 11] the side bar offers the columns and filters tool panels, and the filters panel lists the column filters", async ({ page }) => {
  await mockApi(page, transactions(6));
  await openProviderEvents(page);
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  const grid = page.locator(eventsGrid);
  await expect(grid.locator(".ag-side-button", { hasText: "Columns" })).toBeVisible();
  await grid.locator(".ag-side-button", { hasText: "Filters" }).click();
  await expect(grid.locator(".ag-filter-toolpanel")).toBeVisible();
  await expect(grid.locator(".ag-filter-toolpanel").getByText("Lifecycle").first()).toBeVisible();
  await expect(grid.locator(".ag-filter-toolpanel").getByText("Payee").first()).toBeVisible();
});

test("[issue 3] the context menu offers copy, export and transaction inspection", async ({ page }) => {
  await mockApi(page, transactions(3));
  await openProviderEvents(page);
  await page.locator(`${eventsGrid} [row-id='TEST-POI-2'] [col-id='status']`).first().click({ button: "right" });
  const menu = page.locator(".ag-menu");
  await expect(menu.getByText("Copy", { exact: true })).toBeVisible();
  await menu.getByText("Inspect transaction history").click();
  await expect(page.getByLabel("Transaction history").getByRole("heading", { name: "TEST-POI-2" })).toBeVisible();
});

test("[issue 4] each row has exactly one selection checkbox, and selecting a row enables Open selected", async ({ page }) => {
  await mockApi(page, transactions(3));
  await openProviderEvents(page);
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  expect(await page.locator(`${eventsGrid} [row-id='TEST-POI-1'] input[type='checkbox']`).count()).toBe(1);
  await expect(page.getByRole("button", { name: "Open selected" })).toBeDisabled();
  await page.locator(`${eventsGrid} [row-id='TEST-POI-3'] input[type='checkbox']`).first().check();
  await expect(page.getByRole("button", { name: "Open selected" })).toBeEnabled();
  await page.getByRole("button", { name: "Open selected" }).click();
  await expect(page.getByLabel("Transaction history").getByRole("heading", { name: "TEST-POI-3" })).toBeVisible();
});

test("[issue 5] switching between the grid and AG Studio while data keeps changing never calls a destroyed grid", async ({ page }) => {
  const consoleEntries = recordConsole(page);
  let version = 0;
  const base = transactions(6);
  await mockApi(page, () => {
    version += 1;
    return base.map((row, index) => index === 0 ? { ...row, status: version % 2 ? "SUCCESS" : "PENDING", lastEventSequence: 10 + version } : row);
  });
  await openProviderEvents(page);
  await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  for (let round = 0; round < 3; round++) {
    await page.getByRole("tab", { name: "AG Studio analytics" }).click();
    await page.waitForTimeout(4500); // at least one poll lands while the grid is unmounted
    await page.getByRole("tab", { name: "Operations grid" }).click();
    await expect(page.getByRole("gridcell", { name: "TEST-POI-1" }).first()).toBeVisible();
  }
  expect(await gridRowIds(page, eventsGrid)).toHaveLength(6);
  expect(agProblems(consoleEntries)).toEqual([]);
});

test("[preserved] AG Studio analytics renders a chart and a grid from the verified rows", async ({ page }) => {
  await mockApi(page, transactions(6));
  await openProviderEvents(page);
  await page.getByRole("tab", { name: "AG Studio analytics" }).click();
  const studio = page.locator(".transaction-studio");
  await expect(studio.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(studio.getByText("Verified gross by status")).toBeVisible();
  await expect(studio.getByText("fixture@example.test").first()).toBeVisible();
});

test("[preserved] AG Studio report state is saved locally when the reader changes it, and restored on return", async ({ page }) => {
  await mockApi(page, transactions(6));
  await openProviderEvents(page);
  await page.getByRole("tab", { name: "AG Studio analytics" }).click();
  const studio = page.locator(".transaction-studio");
  await expect(studio.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  await studio.getByRole("button", { name: /^Status is/ }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("settle.studio.report.v2") !== null)).toBe(true);
  await expect(page.getByText("Report state saved locally")).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("settle.studio.report.v2") ?? "{}") as { pages?: Array<{ id: string }>; selectedPageId?: string });
  expect(saved.selectedPageId).toBe("transaction-analysis");
  expect(saved.pages?.[0]?.id).toBe("transaction-analysis");
  await page.getByRole("tab", { name: "Operations grid" }).click();
  await page.getByRole("tab", { name: "AG Studio analytics" }).click();
  await expect(studio.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
});

test("[issues 6, 8, 11] AG Studio analytics: only the documented trial notice without a key, the Settle theme, and usable page filters", async ({ page }) => {
  const consoleEntries = recordConsole(page);
  await mockApi(page, transactions(6));
  await openProviderEvents(page);
  await page.getByRole("tab", { name: "AG Studio analytics" }).click();
  const studio = page.locator(".transaction-studio");
  await expect(studio.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  expect(agProblems(consoleEntries)).toEqual([]);
  for (const notice of licenceNotices(consoleEntries)) expect(notice).toMatch(/License Key Not Found/);
  // Page filters are listed in the filters panel; the "No filters available" placeholder is no longer shown.
  await expect(studio.getByText("No filters available")).toBeHidden();
  await expect(studio.locator(".ag-studio-root-panel-container-right").getByText("Status", { exact: true })).toBeVisible();
  await expect(studio.locator(".ag-studio-root-panel-container-right").getByText("Payee", { exact: true })).toBeVisible();
  const font = await studio.locator(".ag-studio-root").evaluate((element) => getComputedStyle(element).fontFamily);
  const pageFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(font).toBe(pageFont);
});

for (const view of ["Verified transactions", "Legacy payout workflow", "Allocation agent", "Operational workspace"]) {
  test(`[preserved] 390 px: "${view}" has no horizontal overflow`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await mockApi(page, transactions(6));
    await page.goto("/legacy");
    await page.getByRole("button", { name: view }).click();
    await page.waitForTimeout(2500);
    const before = await horizontalOverflow(page);
    expect(before.scrollWidth, JSON.stringify(before)).toBeLessThanOrEqual(before.clientWidth);
    expect(before.offenders).toEqual([]);
    if (view === "Verified transactions") {
      await page.getByRole("tab", { name: "AG Studio analytics" }).click();
      await page.waitForTimeout(4000);
      const studio = await horizontalOverflow(page);
      expect(studio.scrollWidth, JSON.stringify(studio)).toBeLessThanOrEqual(studio.clientWidth);
    }
    await context.close();
  });
}
