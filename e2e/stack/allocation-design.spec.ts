import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`allocation alternatives and decision status: ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => sessionStorage.setItem('settle-owner-token', 'e2e-owner-token'));
    await page.goto('/legacy');
    await page.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name: 'Allocation agent' }).click();
    await page.getByRole('button', { name: 'Evaluate current scenario' }).click();
    await expect(page.getByText('NO PAYMENT AUTHORIZED')).toBeVisible();
    await expect(page.locator('.scenario-grid [role="grid"]')).toBeVisible();
    await page.screenshot({ path: `evidence/design-system/${size.name}-allocation-alternatives.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ html: n.html, summary: n.failureSummary })) }))).toEqual([]);
  });
}
