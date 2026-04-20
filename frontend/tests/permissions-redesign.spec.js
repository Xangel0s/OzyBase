import { expect, test } from '@playwright/test';
import { apiRequest, login } from './helpers/app.js';

test('permissions surface stays searchable, scrollable, and focused by table', async ({ page }) => {
  test.setTimeout(300000);

  const prefix = `qa_policy_${Date.now().toString().slice(-8)}`;
  const tableNames = Array.from({ length: 6 }, (_, index) => `${prefix}_${index + 1}`);

  await page.setViewportSize({ width: 1440, height: 960 });
  await login(page);

  try {
    for (const tableName of tableNames) {
      const response = await apiRequest(page, '/api/collections', {
        method: 'POST',
        body: JSON.stringify({
          name: tableName,
          display_name: tableName,
          schema: [
            { name: 'owner_id', type: 'text', required: false, unique: false, is_primary: false, references: null },
            { name: 'title', type: 'text', required: false, unique: false, is_primary: false, references: null },
          ],
          rls_enabled: false,
          rls_rule: '',
          rls_policies: {},
          realtime_enabled: false,
        }),
      });
      expect(response.ok, `failed creating ${tableName}`).toBe(true);
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Authentication' }).click();
    await page.getByTestId('explorer-submenu-policies').click();

    await expect(page.getByRole('heading', { name: 'Policies' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByPlaceholder('Filter tables and policies')).toBeVisible();

    const searchInput = page.getByPlaceholder('Filter tables and policies');
    await searchInput.fill(prefix);

    const gapsScroll = page.getByTestId('permissions-gaps-scroll');
    const tablesScroll = page.getByTestId('permissions-tables-scroll');
    await expect(gapsScroll).toBeVisible();
    await expect(tablesScroll).toBeVisible();

    const gapOverflow = await gapsScroll.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));
    expect(gapOverflow.scrollHeight).toBeGreaterThan(gapOverflow.clientHeight);

    await expect(tablesScroll.getByText(tableNames[2], { exact: true })).toBeVisible();
    await expect(tablesScroll.getByText(tableNames[4], { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(`${tableNames[2].replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')} select`, 'i'))).toBeVisible();

    await gapsScroll.getByText(tableNames[4], { exact: true }).click();
    await expect(page.locator(`[data-policy-card="${tableNames[4]}"]`)).toBeVisible();

    const actionButtons = page.locator('[data-policy-menu-root] button');
    await expect(actionButtons.first()).toBeVisible();
  } finally {
    for (const tableName of tableNames) {
      await apiRequest(page, `/api/collections/${tableName}`, { method: 'DELETE' });
    }
  }
});
