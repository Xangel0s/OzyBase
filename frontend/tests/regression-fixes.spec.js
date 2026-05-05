import { expect, test } from '@playwright/test';
import { apiRequest, login, runSQL } from './helpers/app.js';

test('regression fixes: csv import, bucket actions and auth menu', async ({ page }) => {
    test.setTimeout(300000);

    const qaSuffix = Date.now().toString().slice(-8);
    const tableName = `qa_import_${qaSuffix}`;
    const bucketName = `qa_bucket_${qaSuffix}`;

    await login(page);

    try {
        const createTableRes = await apiRequest(page, '/api/collections', {
            method: 'POST',
            body: JSON.stringify({
                name: tableName,
                display_name: tableName,
                schema: [
                    { name: 'name', type: 'text', required: false, unique: false, is_primary: false, references: null },
                    { name: 'total', type: 'int8', required: false, unique: false, is_primary: false, references: null },
                    { name: 'active', type: 'bool', required: false, unique: false, is_primary: false, references: null },
                    { name: 'joined_at', type: 'timestamp', required: false, unique: false, is_primary: false, references: null },
                ],
                rls_enabled: false,
                rls_rule: '',
                rls_policies: {},
                realtime_enabled: false,
            }),
        });
        expect(createTableRes.ok).toBe(true);

        const importRes = await apiRequest(page, `/api/tables/${tableName}/import`, {
            method: 'POST',
            body: JSON.stringify([
                { name: 'Alice', total: '15', active: 'true', joined_at: '2026-03-31 18:45:00' },
                { name: 'Bob', total: '22', active: 'false', joined_at: '2026-03-30 11:20:00' },
            ]),
        });
        expect(importRes.ok).toBe(true);

        const importCheck = await runSQL(page, `SELECT name, total, active, joined_at::date::text FROM ${tableName} ORDER BY name ASC`);
        expect(importCheck.ok).toBe(true);
        expect(importCheck.body?.rows?.[0]?.[0]).toBe('Alice');
        expect(String(importCheck.body?.rows?.[0]?.[1])).toBe('15');
        expect(importCheck.body?.rows?.[0]?.[2]).toBe(true);

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

        await page.getByRole('button', { name: 'Storage', exact: true }).first().click();
        await expect(page.getByRole('button', { name: 'Create bucket' })).toBeVisible({ timeout: 15000 });
        const bucketButton = page.getByRole('button', { name: new RegExp(bucketName, 'i') }).first();
        await expect(bucketButton).toBeVisible({ timeout: 15000 });
        await bucketButton.click();
        await expect(page.getByRole('heading', { name: bucketName })).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('button', { name: /Edit bucket/i })).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('button', { name: /Delete bucket/i })).toBeVisible({ timeout: 15000 });

        await page.getByPlaceholder('Search objects by name or MIME type...').fill('does-not-exist');
        await expect(page.getByText('No objects match this search')).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'Clear search' }).click();
        await expect(page.getByText('No objects match this search')).toHaveCount(0);

        await page.getByRole('button', { name: 'Authentication', exact: true }).first().click();
        await expect(page.getByText('USER ACCOUNTS')).toBeVisible({ timeout: 15000 });
        await page.locator('tbody tr').first().getByRole('button').last().click();
        const userMenu = page.locator('.ozy-floating-panel').filter({ has: page.getByText('View Detail') }).last();
        await expect(userMenu.getByText('View Detail')).toBeVisible({ timeout: 10000 });
        const menuBox = await userMenu.boundingBox();
        expect(menuBox).not.toBeNull();
        expect(menuBox.y + menuBox.height).toBeLessThan(1200);

	        await page.locator('header').getByText('A', { exact: true }).click();
	        await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
	        await page.getByRole('button', { name: 'General' }).click();
	        await expect(page.getByText('Core Release Channel')).toBeVisible({ timeout: 10000 });

        const updateStatus = await apiRequest(page, '/api/project/update-status');
        expect(updateStatus.ok).toBe(true);
        expect(typeof updateStatus.body?.status).toBe('string');
    } finally {
        if (!page.isClosed()) {
            await apiRequest(page, `/api/files/buckets/${bucketName}`, { method: 'DELETE' });
            await apiRequest(page, `/api/collections/${tableName}`, { method: 'DELETE' });
        }
    }
});
