import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import { apiRequest, login, runSQL } from './helpers/app.js';
const MULTIPART_FILE_SIZE_MB = 65;

test('storage self-host hardening: multipart upload + lifecycle sweep via UI', async ({ page }, testInfo) => {
  test.setTimeout(420000);

  const suffix = Date.now().toString().slice(-8);
  const bucketName = `qa_storage_${suffix}`;
  const fileName = `multipart-${suffix}.bin`;
  const filePath = testInfo.outputPath(fileName);
  const fileBytes = MULTIPART_FILE_SIZE_MB * 1024 * 1024;

  await fs.writeFile(filePath, Buffer.alloc(fileBytes, 65));
  await login(page);

  try {
    const createBucketRes = await apiRequest(page, '/api/files/buckets', {
      method: 'POST',
      body: JSON.stringify({
        name: bucketName,
        public: true,
        rls_enabled: false,
        rls_rule: '',
        max_file_size_bytes: 80 * 1024 * 1024,
        max_total_size_bytes: 90 * 1024 * 1024,
        lifecycle_delete_after_days: 1,
      }),
    });
    expect(createBucketRes.ok).toBe(true);

    await page.getByRole('button', { name: 'Storage', exact: true }).click();
    await expect(page.getByTestId('storage-sidebar')).toBeVisible({ timeout: 15000 });

    const bucketButton = page.getByRole('button', { name: new RegExp(bucketName, 'i') });
    await expect(bucketButton).toBeVisible({ timeout: 20000 });
    await bucketButton.click();

    await page.getByTestId('storage-hero').locator('input[type="file"]').setInputFiles(filePath);

    await expect.poll(async () => {
      const filesRes = await apiRequest(page, `/api/files?bucket=${bucketName}`);
      if (!filesRes.ok || !Array.isArray(filesRes.body)) {
        return 0;
      }
      return filesRes.body.length;
    }, { timeout: 180000, intervals: [1000, 2000, 4000] }).toBeGreaterThanOrEqual(1);

    const bucketRes = await apiRequest(page, `/api/files/buckets/${bucketName}`);
    expect(bucketRes.ok).toBe(true);
    expect(bucketRes.body?.max_file_size_bytes).toBe(80 * 1024 * 1024);
    expect(bucketRes.body?.max_total_size_bytes).toBe(90 * 1024 * 1024);
    expect(bucketRes.body?.lifecycle_delete_after_days).toBe(1);

    await page.getByRole('button', { name: 'Observability', exact: true }).click();
    await expect(page.getByText('Storage Pressure')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Top Buckets')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(bucketName, { exact: true }).first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Storage', exact: true }).click();
    await expect(bucketButton).toBeVisible({ timeout: 15000 });
    await bucketButton.click();

    const backdateRes = await runSQL(page, `
      UPDATE _v_storage_objects
      SET created_at = NOW() - INTERVAL '2 days'
      WHERE bucket_id IN (SELECT id FROM _v_buckets WHERE name = '${bucketName}')
        AND name = '${fileName}'
      RETURNING id
    `);
    expect(backdateRes.ok).toBe(true);

    await page.getByRole('button', { name: /Run sweep/i }).click();

    await expect.poll(async () => {
      const filesRes = await apiRequest(page, `/api/files?bucket=${bucketName}`);
      if (!filesRes.ok || !Array.isArray(filesRes.body)) {
        return -1;
      }
      return filesRes.body.length;
    }, { timeout: 30000, intervals: [1000, 2000, 4000] }).toBe(0);
  } finally {
    if (!page.isClosed()) {
      await apiRequest(page, `/api/files/buckets/${bucketName}`, { method: 'DELETE' }).catch(() => {});
    }
    await fs.unlink(filePath).catch(() => {});
  }
});
