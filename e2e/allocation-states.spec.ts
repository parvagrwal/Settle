import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi } from './support/fixtures.ts';

const context = { contextId: 'TEST-FIXTURE', capturedAt: '2026-11-09T10:00:00Z', clearedFundsCents: 10000, reserveCents: 2000, committedCents: 0, obligations: [], source: 'AUTOMATED TEST FIXTURE — NOT REAL FUNDS' };
const unavailable = { status: 'recommendation_unavailable', recommendation: null, deterministicAlternatives: [], escalations: ['TEST FIXTURE: recommendation service unavailable.'], toolTrace: ['fixture'], context, source: 'AUTOMATED TEST FIXTURE' };

for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`allocation pending, authorization error and unavailable recommendation: ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockApi(page, []);
    await page.route('**/api/allocation/demo-context', route => route.fulfill({ json: context }));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/api/allocation/recommend', async route => {
      requests++;
      if (requests === 1) {
        await gate;
        await route.fulfill({ status: 401, json: { error: 'owner token required' } });
      } else {
        await route.fulfill({ json: unavailable });
      }
    });
    await page.goto('/legacy');
    await page.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name: 'Allocation agent' }).click();
    await expect(page.getByText(context.source)).toBeVisible();
    await page.getByRole('button', { name: 'Evaluate current scenario' }).click();
    await expect(page.getByRole('button', { name: 'Evaluating…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Simulate delayed receipt' })).toBeDisabled();
    await page.screenshot({ path: `evidence/design-system/${size.name}-allocation-loading.png`, fullPage: true });
    let result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) }))).toEqual([]);
    release();
    await expect(page.getByRole('alert')).toContainText('owner token needed');
    await page.screenshot({ path: `evidence/design-system/${size.name}-allocation-authorization-error.png`, fullPage: true });
    result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) }))).toEqual([]);
    await page.getByRole('button', { name: 'Evaluate current scenario' }).click();
    await expect(page.getByRole('heading', { name: 'AI recommendation unavailable' })).toBeVisible();
    await expect(page.getByText('NO PAYMENT AUTHORIZED')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: `evidence/design-system/${size.name}-allocation-unavailable.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) }))).toEqual([]);
    expect(requests).toBe(2);
  });
}
