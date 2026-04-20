import { test, expect } from '@playwright/test';
import { login } from './helpers/app.js';

test('critical UI smoke: login + modules + authenticated project endpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);

  await page.getByRole('button', { name: 'SQL Editor' }).click();
  await expect(page.getByText(/^Community$/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /View running queries/i })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Table Editor' }).click();
  await expect(page.getByRole('button', { name: /Saved Views/i })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Authentication' }).click();
  await page.getByRole('button', { name: 'Security Hub' }).click();
  await expect(page.getByText('Global Security')).toBeVisible({ timeout: 15000 });

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
