import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gridRowIds } from '../support/fixtures.ts';

for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`legacy plain grid fallback: ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name: 'Legacy payout workflow' }).click();
    const dashboard = page.getByLabel('Payouts dashboard');
    await expect(dashboard.getByText('settle-audit-1').first()).toBeVisible({ timeout: 20_000 });
    await dashboard.getByRole('button', { name: 'Use plain grid view' }).click();
    await expect(dashboard.getByRole('button', { name: 'Use dashboard view' })).toBeVisible();
    await expect.poll(async () => (await gridRowIds(page, '[aria-label="Payouts dashboard"]')).length).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: `evidence/design-system/${size.name}-legacy-fallback.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) }))).toEqual([]);
  });
}
