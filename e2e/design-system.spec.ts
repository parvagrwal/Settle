import { test, expect } from "@playwright/test";
import { mockApi, transactions } from "./support/fixtures.ts";

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "tablet", width: 768, height: 1024 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`design review: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockApi(page, transactions(6));
    await page.route("**/api/allocation/demo-context", route => route.fulfill({ json: { contextId: "FIXTURE", capturedAt: "2026-01-01", clearedFundsCents: 0, reserveCents: 0, committedCents: 0, obligations: [], source: "TEST FIXTURE — NOT LIVE" } }));
    await page.route("**/api/product/session", route => route.fulfill({ json: { authenticated: false, workspaces: [] } }));
    await page.goto("/");
    for (const [label, name] of [["Verified transactions", "transactions"], ["Allocation agent", "allocation"], ["Operational workspace", "workspace"], ["Legacy payout workflow", "legacy"]]) {
      await page.getByRole("button", { name: label }).click();
      await expect(page.getByRole("button", { name: label })).toHaveAttribute("aria-current", "page");
      await page.screenshot({ path: `evidence/design-system/${viewport.name}-${name}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
