import { expect, test } from '@playwright/test';
import { apiRequest, login, runSQL } from './helpers/app.js';

async function getDatasetSummary(page) {
    const collectionsRes = await apiRequest(page, '/api/collections');
    expect(collectionsRes.ok).toBe(true);

    const statsRes = await runSQL(page, `
        SELECT relname, COALESCE(n_live_tup, 0)::bigint AS estimated_rows
        FROM pg_stat_user_tables
        ORDER BY estimated_rows DESC, relname ASC
    `);
    expect(statsRes.ok).toBe(true);

    const collections = Array.isArray(collectionsRes.body) ? collectionsRes.body : [];
    const tableStats = Array.isArray(statsRes.body?.rows)
        ? statsRes.body.rows.map((row) => ({
            table: String(row[0]),
            estimatedRows: Number(row[1] || 0),
        }))
        : [];

    return {
        tableCount: collections.length,
        tables: collections.map((item) => String(item.name)),
        tableStats,
    };
}

async function cleanupArtifacts(page, { functionName, tableName, bucketName }) {
    if (page.isClosed()) {
        return;
    }

    await apiRequest(page, `/api/functions/${functionName}`, { method: 'DELETE' }).catch(() => {});
    await apiRequest(page, `/api/collections/${tableName}`, { method: 'DELETE' }).catch(() => {});
    await runSQL(page, `
        DELETE FROM _v_storage_objects
        WHERE bucket_id IN (SELECT id FROM _v_buckets WHERE name = '${bucketName}')
        RETURNING id
    `).catch(() => {});
    await runSQL(page, `
        DELETE FROM _v_buckets
        WHERE name = '${bucketName}'
        RETURNING id
    `).catch(() => {});
}

test('production QA smoke: overlays + storage + tables + edge functions', async ({ page }) => {
    test.setTimeout(300000);
    await page.setViewportSize({ width: 1280, height: 720 });

    const qaSuffix = Date.now().toString().slice(-8);
    const tableName = `qa_ui_${qaSuffix}`;
    const bucketName = `qa_bucket_${qaSuffix}`;
    const functionName = `qa_edge_${qaSuffix}`;
    const nativeDialogs = [];
    const consoleErrors = [];
    const pageErrors = [];
    const apiFailures = [];

    page.on('dialog', async (dialog) => {
        nativeDialogs.push(dialog.message());
        await dialog.dismiss();
    });
    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });
    page.on('response', (response) => {
        if (!response.url().includes('/api/')) {
            return;
        }
        const pathname = new URL(response.url()).pathname;
        if (response.status() >= 400 && pathname !== '/api/health' && pathname !== '/api/project/health' && pathname !== '/api/auth/csrf') {
            apiFailures.push(`${response.status()} ${pathname}`);
        }
    });

    await login(page);

    const before = await getDatasetSummary(page);

    try {
        const createTableRes = await apiRequest(page, '/api/collections', {
            method: 'POST',
            body: JSON.stringify({
                name: tableName,
                display_name: tableName,
                schema: [
                    { name: 'title', type: 'text', required: false, unique: false, is_primary: false, references: null },
                    { name: 'amount', type: 'int8', required: false, unique: false, is_primary: false, references: null },
                ],
                rls_enabled: false,
                rls_rule: '',
                rls_policies: {},
                realtime_enabled: false,
            }),
        });
        expect(createTableRes.ok).toBe(true);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('module-shell')).toBeVisible({ timeout: 30000 });

        await page.getByRole('button', { name: 'Table Editor' }).click();
        await expect(page.getByRole('button', { name: /Saved Views/i })).toBeVisible({ timeout: 20000 });
        await expect(page.getByText('Current Table')).toHaveCount(0);
        await expect(page.getByRole('button', { name: new RegExp(tableName, 'i') }).first()).toBeVisible({ timeout: 20000 });
        await page.getByRole('button', { name: new RegExp(tableName, 'i') }).first().click();

        await page.getByRole('button', { name: /^Insert$/i }).click();
        await page.getByRole('button', { name: /Insert Row Add a new record/i }).click();
        await page.getByPlaceholder('Enter title...').fill(`row-${qaSuffix}`);
        await page.getByRole('spinbutton').first().fill('7');
        await page.getByRole('button', { name: /^Insert Row$/i }).last().click();
        await expect(page.getByText(`row-${qaSuffix}`)).toBeVisible({ timeout: 20000 });

        const rowsRes = await apiRequest(page, `/api/collections/${tableName}/records?limit=10`);
        expect(rowsRes.ok).toBe(true);
        expect(Array.isArray(rowsRes.body?.data)).toBe(true);
        expect(rowsRes.body.data.length).toBeGreaterThanOrEqual(1);

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

        await page.getByRole('button', { name: 'Storage' }).click();
        await expect(page.getByRole('button', { name: 'Create bucket' })).toBeVisible({ timeout: 15000 });
        const bucketButton = page.getByRole('button', { name: new RegExp(bucketName, 'i') });
        await expect(bucketButton).toBeVisible({ timeout: 15000 });
        await bucketButton.click();
        await expect(page.getByRole('heading', { name: bucketName })).toBeVisible({ timeout: 15000 });
        const filesRes = await apiRequest(page, `/api/files?bucket=${bucketName}`);
        expect(filesRes.ok).toBe(true);
        expect(Array.isArray(filesRes.body)).toBe(true);

        const createFunctionRes = await apiRequest(page, '/api/functions', {
            method: 'POST',
            body: JSON.stringify({
                name: functionName,
                script: `return { ok: true, marker: "${qaSuffix}" };`,
            }),
        });
        expect(createFunctionRes.ok).toBe(true);

        await page.getByRole('button', { name: 'Edge Functions' }).click();
        await expect(page.getByText('Edge Functions').first()).toBeVisible({ timeout: 15000 });
        const functionRow = page.locator('tbody tr').filter({ has: page.getByText(functionName, { exact: true }) }).first();
        await expect(functionRow).toBeVisible({ timeout: 20000 });
        const invokeRes = await apiRequest(page, `/api/functions/${functionName}/invoke`, {
            method: 'POST',
            body: JSON.stringify({ test: true }),
        });
        expect(invokeRes.ok).toBe(true);
        expect(invokeRes.body?.result?.marker).toBe(qaSuffix);

        const after = await getDatasetSummary(page);
        const tableRowRes = await runSQL(page, `SELECT COUNT(*)::bigint FROM ${tableName}`);
        expect(tableRowRes.ok).toBe(true);

        const qaSummary = {
            beforeTableCount: before.tableCount,
            afterTableCount: after.tableCount,
            createdTable: tableName,
            createdBucket: bucketName,
            createdFunction: functionName,
            createdTableRowCount: Number(tableRowRes.body?.rows?.[0]?.[0] || 0),
            topTablesByEstimatedRows: after.tableStats.slice(0, 8),
            nativeDialogs,
            consoleErrors,
            pageErrors,
            apiFailures,
        };

        console.log(`QA_SUMMARY ${JSON.stringify(qaSummary)}`);

        expect(nativeDialogs).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(pageErrors).toEqual([]);
        expect(apiFailures).toEqual([]);
    } finally {
        await cleanupArtifacts(page, { functionName, tableName, bucketName });
    }
});
