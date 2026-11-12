import { test, expect } from '@playwright/test';
import { mockApi } from './support/fixtures.ts';

test('published spacing tokens drive the shell and navigation', async ({ page }) => {
  await mockApi(page, []);
  await page.goto('/legacy');
  const shell = page.locator('.page');
  const nav = page.getByRole('navigation', { name: 'Product views' });
  await expect(shell).toHaveCSS('padding-top', '32px');
  await expect(nav).toHaveCSS('gap', '8px');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--settle-space-6', '28px');
    document.documentElement.style.setProperty('--settle-space-2', '10px');
  });
  await expect(shell).toHaveCSS('padding-top', '28px');
  await expect(nav).toHaveCSS('gap', '10px');
});
