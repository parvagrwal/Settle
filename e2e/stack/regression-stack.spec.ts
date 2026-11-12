// Regression checks that need the real server: the legacy dashboard and the
// allocation planner read real routes. Written before any component changed and
// run first against the audited commit.
import { test, expect } from "@playwright/test";
import { agProblems, gridRowIds, horizontalOverflow, recordConsole } from "../support/fixtures.ts";

test("[preserved] legacy dashboard: the Studio payouts grid lists the seeded rows and the plain grid view takes over on request", async ({ page }) => {
  await page.goto("/legacy");
  await page.getByRole("button", { name: "Legacy payout workflow" }).click();
  const dashboard = page.getByLabel("Payouts dashboard");
  await expect(dashboard.getByText("settle-audit-1").first()).toBeVisible({ timeout: 20_000 });
  const wrapped = dashboard.locator(".studio-wrapped-cell").first();
  await expect(wrapped).toBeVisible();
  await expect(wrapped).toHaveCSS("white-space", "normal");
  await expect(dashboard.locator("canvas").first()).toBeVisible();
  await dashboard.getByRole("button", { name: "Use plain grid view" }).click();
  await expect(dashboard.getByRole("button", { name: "Use dashboard view" })).toBeVisible();
  await expect.poll(async () => (await gridRowIds(page, "[aria-label='Payouts dashboard']")).length).toBeGreaterThanOrEqual(8);
  await dashboard.getByLabel("Filter by freelancer").selectOption("freelancer-1");
  await expect.poll(async () => (await gridRowIds(page, "[aria-label='Payouts dashboard']")).length).toBe(4);
});

test("[preserved] allocation planner: evaluating the scenario renders the alternatives grid", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("settle-owner-token", "e2e-owner-token"));
  await page.goto("/legacy");
  await page.getByRole("button", { name: "Allocation agent" }).click();
  await page.getByRole("button", { name: "Evaluate current scenario" }).click();
  await expect(page.locator(".scenario-grid .ag-root-wrapper")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await gridRowIds(page, ".scenario-grid")).length).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("NO PAYMENT AUTHORIZED")).toBeVisible();
});

test("[issues 1, 12] production build: the existing grids log no AG Grid error or warning", async ({ page }) => {
  const consoleEntries = recordConsole(page);
  await page.addInitScript(() => sessionStorage.setItem("settle-owner-token", "e2e-owner-token"));
  await page.goto("/legacy");
  await page.getByRole("button", { name: "Verified transactions" }).click();
  await expect(page.getByText("Every status has a receipt.")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Allocation agent" }).click();
  await page.getByRole("button", { name: "Evaluate current scenario" }).click();
  await expect(page.locator(".scenario-grid .ag-root-wrapper")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Legacy payout workflow" }).click();
  await expect(page.getByLabel("Payouts dashboard").getByText("settle-audit-1").first()).toBeVisible({ timeout: 20_000 });
  expect(agProblems(consoleEntries)).toEqual([]);
});

for (const view of ["Verified transactions", "Legacy payout workflow", "Allocation agent", "Operational workspace"]) {
  test(`[preserved] production build, 390 px: "${view}" has no horizontal overflow`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto("/legacy");
    await page.getByRole("button", { name: view }).click();
    await page.waitForTimeout(3000);
    const result = await horizontalOverflow(page);
    expect(result.scrollWidth, JSON.stringify(result)).toBeLessThanOrEqual(result.clientWidth);
    expect(result.offenders).toEqual([]);
    await context.close();
  });
}
