import { expect, test } from '@playwright/test';
import { apiRequest, login, runSQL } from './helpers/app.js';

test('navigation reset, geo auto-fix flow, and workspace lifecycle stay autonomous', async ({ page }) => {
  test.setTimeout(300000);

  const qaSuffix = Date.now().toString().slice(-8);
  const workspaceName = `QA Project ${qaSuffix}`;
  const autoGeoIP = `179.6.171.${Number(qaSuffix.slice(-2)) % 250}`;
  const manualGeoIP = `179.6.172.${Number(qaSuffix.slice(-2)) % 250}`;
  let createdWorkspaceId = null;
  let originalGeoPolicy = null;

  await login(page);
  const originalPolicies = await apiRequest(page, '/api/project/security/policies');
  if (originalPolicies.ok && originalPolicies.body?.geo_fencing) {
    originalGeoPolicy = originalPolicies.body.geo_fencing;
  }

  try {
    await page.getByRole('button', { name: 'Authentication', exact: true }).first().click();
    await page.getByTestId('explorer-submenu-policies').click();
    const scrollRoot = page.locator('[data-module-scroll-root]');
    await expect(scrollRoot).toBeVisible({ timeout: 15000 });
    const scrolledTop = await scrollRoot.evaluate((node) => {
      if (!(node instanceof HTMLElement)) {
        return -1;
      }
      node.scrollTop = 700;
      return node.scrollTop;
    });
    expect(scrolledTop).toBeGreaterThan(100);

    await page.getByRole('button', { name: 'SQL Editor', exact: true }).first().click();
    await expect(page.getByRole('button', { name: /Run Query/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Direct SQL access')).toHaveCount(0);
    await expect(page.getByText('Quick Brief')).toHaveCount(0);
    const hasResidualScroll = await page.getByTestId('module-shell').evaluate((node) =>
      Array.from(node.querySelectorAll('.custom-scrollbar')).some((element) => element.scrollTop > 0),
    );
    expect(hasResidualScroll).toBe(false);

    await page.getByTestId('workspace-switcher-toggle').click();
    await page.getByRole('button', { name: 'Project Directory' }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /New Project/i }).click();
    const createModal = page.locator('.ozy-dialog-panel').filter({ has: page.getByPlaceholder('Enter project name...') });
    await createModal.getByPlaceholder('Enter project name...').fill(workspaceName);
    await createModal.getByRole('button', { name: /^Create$/i }).click();

    await expect(page.getByText('Project Settings')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`input[value="${workspaceName}"]`)).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('ozy_workspace_id')), { timeout: 15000 })
      .not.toBeNull();
    createdWorkspaceId = await page.evaluate(() => localStorage.getItem('ozy_workspace_id'));

    const duplicateGeoSQL = `
      INSERT INTO _v_security_alerts (type, severity, message, metadata)
      VALUES
        ('geo_breach', 'critical', 'Geo breach detected', '{"ip":"${autoGeoIP}","country":"Peru","city":"Lima"}'::jsonb),
        ('geo_breach', 'critical', 'Geo breach detected', '{"ip":"${autoGeoIP}","country":"Peru","city":"Lima"}'::jsonb)
    `;
    const seedAlerts = await runSQL(page, duplicateGeoSQL);
    expect(seedAlerts.ok).toBe(true);

    await page.waitForTimeout(12000);
    await page.getByLabel('Open notifications').click();
    const autoGeoCard = page.locator('div[class*="cursor-pointer"]').filter({ hasText: 'Geographic Access Breach' }).filter({ hasText: autoGeoIP }).first();
    await expect(autoGeoCard).toBeVisible({ timeout: 15000 });
    await expect(autoGeoCard.getByText('2 events')).toBeVisible({ timeout: 10000 });
    await autoGeoCard.click();
    await expect(page.getByText('Security Shield')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Proceed Anyway/i }).click();
    await expect(page.getByText(/Applied fix for: Geographic Access Breach/i)).toBeVisible({ timeout: 15000 });

    const updatedPolicies = await apiRequest(page, '/api/project/security/policies');
    expect(updatedPolicies.ok).toBe(true);
    expect(updatedPolicies.body?.geo_fencing?.allowed_countries).toContain('Peru');

    await page.getByLabel('Open notifications').click();
    await expect(page.locator('div').filter({ hasText: autoGeoIP })).toHaveCount(0, { timeout: 15000 });
    await page.getByLabel('Open notifications').click();

    await page.getByTestId('workspace-switcher-toggle').click();
    await page.getByRole('button', { name: 'Project Settings' }).click();
    await expect(page.getByRole('banner').getByText('Project Settings')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Danger Zone', exact: true }).click();
    await expect(page.getByText('Termination Protocol')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /^Delete Project$/i }).first().click();
    const deleteModal = page.locator('.ozy-dialog-panel').filter({ has: page.getByText('Project "' + workspaceName + '"') });
    await deleteModal.getByRole('button', { name: /^Delete Project$/i }).click();

    await expect(page.getByText('Projects').first()).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('ozy_workspace_id')), { timeout: 15000 })
      .not.toBe(createdWorkspaceId);
  } finally {
    if (originalGeoPolicy && !page.isClosed()) {
      await apiRequest(page, '/api/project/security/policies', {
        method: 'POST',
        body: JSON.stringify({ type: 'geo_fencing', config: originalGeoPolicy }),
      });
    }
    if (createdWorkspaceId && !page.isClosed()) {
      await apiRequest(page, `/api/workspaces/${createdWorkspaceId}`, { method: 'DELETE' });
    }
    if (!page.isClosed()) {
      await runSQL(page, `DELETE FROM _v_security_alerts WHERE type = 'geo_breach' AND metadata->>'ip' IN ('${autoGeoIP}', '${manualGeoIP}')`);
    }
  }
});
