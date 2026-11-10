import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`isolated operations components: ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/showcase.html');
    await expect(page.getByText('DESIGN REVIEW FIXTURES — NOT LIVE PAYMENT DATA')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Payment capacity and exceptions' })).toBeVisible();
    await expect(page.getByRole('region', { name: /Payment record Podcast edit/ })).toBeVisible();
    await page.getByRole('region', { name: 'Payment capacity and exceptions' }).getByRole('button', { name: /^Needs attention/ }).click();
    await expect(page.getByRole('region', { name: 'Payment capacity and exceptions' }).getByRole('button', { name: /^Needs attention/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('region', { name: 'Payment capacity and exceptions' }).getByRole('button', { name: /^Needs attention/ }).click();
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await expect(page.getByTestId('investigation-result')).toBeVisible();
    await page.screenshot({ path: `evidence/design-system/${size.name}-operations-showcase.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) }))).toEqual([]);
  });
}

test('operations grid expands a payment record with accessible master/detail semantics', async ({ page }) => {
  await page.goto('/showcase.html');
  const grid = page.getByTestId('operations-grid');
  await expect(grid.getByRole('treegrid')).toBeVisible();
  await grid.getByRole('button', { name: 'Inspect Podcast edit' }).click();
  await expect(grid.getByRole('region', { name: 'Payment record Podcast edit' })).toBeVisible();
  await expect(grid.getByText('Outcome unknown').first()).toBeVisible();
  const scan = await new AxeBuilder({ page }).include('[data-testid="operations-grid"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) }))).toEqual([]);
});
