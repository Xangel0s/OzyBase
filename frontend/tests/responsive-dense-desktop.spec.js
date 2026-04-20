import { expect, test } from '@playwright/test';
import { apiRequest, login } from './helpers/app.js';

const VIEWPORTS = [
  { label: '1280x720', width: 1280, height: 720, maxFooterHeight: 78 },
  { label: '1366x768', width: 1366, height: 768, maxFooterHeight: 84 },
  { label: '1536x864', width: 1536, height: 864, maxFooterHeight: 88 },
];

for (const viewport of VIEWPORTS) {
  test(`responsive dense desktop: storage + table editor stay intact at ${viewport.label}`, async ({ page }) => {
    test.setTimeout(300000);

    const suffix = `${viewport.width}${Date.now().toString().slice(-6)}`;
    const tableName = `qa_dense_${suffix}`;
    const bucketName = `qa_dense_bucket_${suffix}`;

    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await login(page);

    try {
      const createTableRes = await apiRequest(page, '/api/collections', {
        method: 'POST',
        body: JSON.stringify({
          name: tableName,
          display_name: tableName,
          schema: [
            { name: 'title', type: 'text', required: false, unique: false, is_primary: false, references: null },
            { name: 'amount', type: 'int8', required: false, unique: false, is_primary: false, references: null },
            { name: 'status', type: 'text', required: false, unique: false, is_primary: false, references: null },
            { name: 'owner', type: 'text', required: false, unique: false, is_primary: false, references: null },
            { name: 'notes', type: 'text', required: false, unique: false, is_primary: false, references: null },
            { name: 'category', type: 'text', required: false, unique: false, is_primary: false, references: null },
            { name: 'priority', type: 'int4', required: false, unique: false, is_primary: false, references: null },
            { name: 'is_live', type: 'bool', required: false, unique: false, is_primary: false, references: null },
          ],
          rls_enabled: false,
          rls_rule: '',
          rls_policies: {},
          realtime_enabled: false,
        }),
      });
      expect(createTableRes.ok).toBe(true);

      const createBucketRes = await apiRequest(page, '/api/files/buckets', {
        method: 'POST',
        body: JSON.stringify({
          name: bucketName,
          public: true,
          rls_enabled: false,
          rls_rule: '',
          max_file_size_bytes: 0,
          max_total_size_bytes: 0,
          lifecycle_delete_after_days: 0,
        }),
      });
      expect(createBucketRes.ok).toBe(true);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('module-shell')).toBeVisible({ timeout: 30000 });

      await page.getByRole('button', { name: 'Storage', exact: true }).click();
      await expect(page.getByTestId('explorer-sidebar')).toHaveCount(0);
      await expect(page.getByTestId('storage-sidebar')).toBeVisible({ timeout: 15000 });
      const bucketButton = page.getByRole('button', { name: new RegExp(bucketName, 'i') }).first();
      await expect(bucketButton).toBeVisible({ timeout: 15000 });
      await bucketButton.click();

      await page.getByTestId('storage-hero').locator('input[type="file"]').setInputFiles([
        {
          name: 'the-restaurant-plan-official-specification-vfinal.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: Buffer.from('responsive-storage-qa'),
        },
      ]);

      await expect(page.getByText(/restaurant-plan-official-specification/i)).toBeVisible({ timeout: 20000 });

      const storageViewport = page.viewportSize();
      expect(storageViewport).not.toBeNull();

      const [sidebarBox, heroBox, uploadButtonBox] = await Promise.all([
        page.getByTestId('storage-sidebar').boundingBox(),
        page.getByTestId('storage-hero').boundingBox(),
        page.getByRole('button', { name: /Upload file/i }).boundingBox(),
      ]);
      expect(sidebarBox).not.toBeNull();
      expect(heroBox).not.toBeNull();
      expect(uploadButtonBox).not.toBeNull();
      expect(sidebarBox.width).toBeLessThan(viewport.width * 0.3);
      expect(heroBox.x + heroBox.width).toBeLessThanOrEqual(storageViewport.width + 4);
      expect(heroBox.height).toBeLessThanOrEqual(viewport.height * 0.48);
      expect(uploadButtonBox.x + uploadButtonBox.width).toBeLessThanOrEqual(storageViewport.width + 4);

      const uploadedObjectBox = await page.getByText(/restaurant-plan-official-specification/i).first().boundingBox();
      expect(uploadedObjectBox).not.toBeNull();
      expect(uploadedObjectBox.y + uploadedObjectBox.height).toBeLessThanOrEqual(storageViewport.height + 24);

      const storageOverflow = await page.getByTestId('storage-main-scroll').evaluate((node) => {
        return node.scrollWidth - node.clientWidth;
      });
      expect(storageOverflow).toBeLessThanOrEqual(6);

      await page.getByRole('button', { name: 'Edge Functions', exact: true }).click();
      await expect(page.getByTestId('explorer-sidebar')).toHaveCount(0);
      await expect(page.getByTestId('module-shell')).toContainText(/Edge Functions|Functions/i);

      await page.getByRole('button', { name: 'Table Editor', exact: true }).click();
      await expect(page.getByRole('button', { name: /Saved Views/i })).toBeVisible({ timeout: 20000 });
      const tableButton = page.getByRole('button', { name: new RegExp(tableName, 'i') }).first();
      await expect(tableButton).toBeVisible({ timeout: 20000 });
      await tableButton.click();

      const footer = page.getByTestId('table-editor-footer');
      await expect(footer).toBeVisible({ timeout: 15000 });
      await expect(footer.getByText(/^Showing /i)).toHaveCount(0);
      await expect(footer.getByText(/records/i)).toBeVisible();
      await expect(footer.getByText('Live off')).toBeVisible();
      await expect(footer.getByText('Data', { exact: true })).toBeVisible();
      await expect(footer.getByText('Definition', { exact: true })).toBeVisible();
      await expect(footer.getByRole('button', { name: 'CSV' })).toBeVisible();

      const footerBox = await footer.boundingBox();
      expect(footerBox).not.toBeNull();
      expect(footerBox.height).toBeLessThanOrEqual(viewport.maxFooterHeight);
      expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(storageViewport.height + 2);
    } finally {
      if (!page.isClosed()) {
        await apiRequest(page, `/api/files/buckets/${bucketName}`, { method: 'DELETE' }).catch(() => {});
        await apiRequest(page, `/api/collections/${tableName}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  });
}
