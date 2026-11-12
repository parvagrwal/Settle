import { test, expect } from '@playwright/test';
import { mockApi, transactions } from './support/fixtures.ts';

test('payment status labels remain present in color-vision simulations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page, transactions(6));
  await page.goto('/legacy');
  await expect(page.getByRole('gridcell', { name: 'TEST-POI-1' }).first()).toBeVisible();
  const session = await page.context().newCDPSession(page);
  for (const type of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
    await session.send('Emulation.setEmulatedVisionDeficiency', { type });
    for (const label of ['PENDING', 'FAILED', 'SUCCESS']) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `evidence/design-system/vision-${type}.png`, fullPage: true });
  }
  await session.send('Emulation.setEmulatedVisionDeficiency', { type: 'none' });
  await session.detach();
});
