import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'mobile', width: 390, height: 844 }]) {
  for (const state of ['loading', 'error', 'demo'] as const) {
    test(`fixture payment detail ${state}: ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/showcase.html?detail=${state}`);
      const detail = page.locator('.ops-detail').last();
      if (state === 'loading') {
        await expect(detail).toHaveAttribute('role', 'status');
        await expect(detail).toContainText('Loading the payment record');
      }
      if (state === 'error') {
        await expect(detail.getByRole('alert')).toContainText('could not be loaded');
        await detail.getByRole('button', { name: 'Try again' }).click();
        await expect(detail.getByRole('alert')).toBeVisible();
      }
      if (state === 'demo') {
        await expect(detail.getByText(/Demonstration record/)).toBeVisible();
        await expect(detail.getByText(/no ledger payment or ledger audit trail/)).toBeVisible();
      }
      await detail.screenshot({ path: `evidence/design-system/${viewport.name}-detail-${state}.png` });
      const results = await new AxeBuilder({ page }).include('.ops-detail').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.html) }))).toEqual([]);
    });
  }
}
