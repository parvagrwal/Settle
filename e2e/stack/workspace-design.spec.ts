import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`authenticated fixture workspace: ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/legacy');
    await page.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name: 'Operational workspace' }).click();
    const main = page.locator('main.workspace-page');
    await expect(main.getByRole('heading', { name: 'Owner sign-in' })).toBeVisible();
    await main.getByLabel('Owner token').fill('e2e-owner-token');
    await main.getByRole('button', { name: 'Sign in' }).click();
    await expect(main.getByRole('region', { name: 'Obligations' })).toBeVisible();
    await expect(main.getByText('Podcast edit')).toBeVisible();
    await page.screenshot({ path: `evidence/design-system/${size.name}-authenticated-workspace.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) }))).toEqual([]);
  });
}
