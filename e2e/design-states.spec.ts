import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, transaction } from './support/fixtures.ts';

for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`transaction evidence, error and analytics: ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockApi(page, [transaction]);
    await page.route('**/api/investigate', route => route.fulfill({ status: 500, json: { error: 'TEST FIXTURE: investigation unavailable' } }));
    await page.goto('/legacy');
    await expect(page.getByRole('gridcell', { name: 'TEST-POI-1' }).first()).toBeVisible();
    await page.locator("[aria-label='Verified transaction operations'] [row-id='TEST-POI-1'] input[type='checkbox']").first().check();
    await page.getByRole('button', { name: 'Open selected' }).click();
    await expect(page.getByLabel('Transaction history').getByText('PAYMENT.PAYOUTS-ITEM.PENDING')).toBeVisible();
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await expect(page.getByLabel('Evidence-grounded transaction investigation').getByRole('alert')).toBeVisible();
    await page.screenshot({ path: `evidence/design-system/${size.name}-transaction-evidence-error.png`, fullPage: true });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) }))).toEqual([]);
    await page.getByRole('tab', { name: 'AG Studio analytics' }).click();
    await expect(page.locator('.transaction-studio canvas').first()).toBeVisible();
    await page.screenshot({ path: `evidence/design-system/${size.name}-analytics.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`empty verified transaction state: ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockApi(page, []);
    await page.goto('/legacy');
    await expect(page.getByText(/No verified rows is a truthful empty state/)).toBeVisible();
    await page.screenshot({ path: `evidence/design-system/${size.name}-empty-transactions.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
