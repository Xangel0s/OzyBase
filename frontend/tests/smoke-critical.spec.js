import { test, expect } from '@playwright/test';
import { login } from './helpers/app.js';

test('critical UI smoke: login + modules + authenticated project endpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);

  await page.getByRole('button', { name: 'SQL Editor' }).click();
  await expect(page.getByRole('button', { name: /^Templates$/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /^Quickstarts$/i })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Table Editor' }).click();
  await expect(page.getByRole('heading', { name: /Create your first table/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /Create first table/i })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Authentication' }).click();
  await expect(page.getByRole('heading', { name: /Authentication/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /RBAC Console/i })).toBeVisible({ timeout: 15000 });

  const projectKeysStatus = await page.evaluate(async () => {
    const token = localStorage.getItem('ozy_token');
    const res = await fetch('/api/project/keys', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return res.status;
  });

  expect(projectKeysStatus).toBe(200);
});
