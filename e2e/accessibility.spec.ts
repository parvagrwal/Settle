import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, transactions } from './support/fixtures.ts';

test('reachable product views: automated accessibility smoke', async ({ page }) => {
  await mockApi(page, transactions(6));
  await page.route('**/api/allocation/demo-context', route => route.fulfill({ json: { contextId: 'FIXTURE', capturedAt: '2026-01-01', clearedFundsCents: 0, reserveCents: 0, committedCents: 0, obligations: [], source: 'TEST FIXTURE — NOT LIVE' } }));
  await page.route('**/api/product/session', route => route.fulfill({ json: { authenticated: false, workspaces: [] } }));
  await page.goto('/legacy');
  for (const name of ['Verified transactions', 'Allocation agent', 'Operational workspace', 'Legacy payout workflow']) {
    await page.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name }).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ html: n.html, summary: n.failureSummary })) })), name).toEqual([]);
  }
});

test('navigation works with keyboard and honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page, transactions(2));
  await page.route('**/api/allocation/demo-context', route => route.fulfill({ json: { contextId: 'FIXTURE', capturedAt: '2026-01-01', clearedFundsCents: 0, reserveCents: 0, committedCents: 0, obligations: [], source: 'TEST FIXTURE — NOT LIVE' } }));
  await page.goto('/legacy');
  // Wait until React and the grid have mounted before sending the first key.
  await expect(page.getByRole('gridcell', { name: 'TEST-POI-1' }).first()).toBeVisible();
  await page.keyboard.press('Tab');
  const workspace = page.getByRole('navigation', { name: 'Product views' }).getByRole('button', { name: 'Operational workspace' });
  await expect(workspace).toBeFocused();
  const styles = await workspace.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, duration: getComputedStyle(el).transitionDuration }));
  expect(styles.outline).not.toBe('none');
  expect(parseFloat(styles.duration)).toBeLessThanOrEqual(0.001);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Allocation agent' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Coordinate priorities/ })).toBeVisible();
});
