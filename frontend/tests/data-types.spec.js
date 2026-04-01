import { test, expect } from '@playwright/test';
import { login, runSQL, waitForOverview } from './helpers/app.js';

test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForOverview(page);
});

test('should create a table with all data types', async ({ page }) => {
    test.setTimeout(240000);
    const tableName = `test_types_${Date.now()}`;

    try {
        await page.getByRole('button', { name: 'Table Editor' }).click({ force: true });
        await expect(page.getByRole('heading', { name: /User Tables/ })).toBeVisible({ timeout: 60000 });

        const newTableBtn = page.getByRole('button', { name: 'New table' });
        await newTableBtn.waitFor({ state: 'visible', timeout: 30000 });
        await newTableBtn.click({ force: true });

        await expect(page.getByText('Create a new table under')).toBeVisible({ timeout: 30000 });
        await page.getByPlaceholder('e.g. invoices').fill(tableName);

        const dataTypes = ['text', 'int4', 'bool', 'jsonb', 'uuid', 'date'];
        let i = 0;
        for (const type of dataTypes) {
            await page.getByRole('button', { name: 'Add column' }).click();

            const rowIndex = 3 + i;
            const row = page.locator('.grid.grid-cols-12.items-center').nth(rowIndex);

            await expect(row).toBeVisible({ timeout: 5000 });
            await row.locator('input[type="text"]').first().fill(`col_${type}`);
            await row.locator('select').selectOption(type);
            i++;
        }

        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByText(tableName)).toBeVisible({ timeout: 60000 });

        await expect
            .poll(async () => {
                const schemaRes = await runSQL(page, `
                    SELECT column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = '${tableName}'
                    ORDER BY ordinal_position
                `);
                if (!schemaRes.ok || !Array.isArray(schemaRes.body?.rows)) {
                    return [];
                }
                return schemaRes.body.rows.map((row) => [String(row[0]), String(row[1])]);
            }, { timeout: 20000, intervals: [500, 1000, 2000] })
            .toEqual(
                expect.arrayContaining([
                    ['col_text', 'text'],
                    ['col_int4', 'integer'],
                    ['col_bool', 'boolean'],
                    ['col_jsonb', 'jsonb'],
                    ['col_uuid', 'uuid'],
                    ['col_date', 'date'],
                ]),
            );
    } finally {
        await runSQL(page, `DROP TABLE IF EXISTS ${tableName}`).catch(() => { });
    }
});

test('should open project status dropdown', async ({ page }) => {
    const statusBtn = page.getByRole('button', { name: 'Project Status' });
    await statusBtn.click({ force: true });

    await expect(page.getByText('Infrastructure')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Security Gate')).toBeVisible({ timeout: 30000 });
});

test('should verify CSV import availability in Create Table modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Table Editor' }).click({ force: true });

    // Wait for the sidebar/explorer to load
    await expect(page.getByRole('heading', { name: /User Tables/ })).toBeVisible({ timeout: 60000 });

    // Click the "New table" button
    const newTableBtn = page.getByRole('button', { name: 'New table' });
    await newTableBtn.waitFor({ state: 'visible', timeout: 30000 });
    await newTableBtn.click({ force: true });

    // Wait for the Create Table Modal to appear
    await expect(page.getByText('Create a new table under')).toBeVisible({ timeout: 30000 });

    // Now check for the CSV import option
    await expect(page.locator('label').filter({ hasText: /Import data from CSV/ })).toBeVisible({ timeout: 30000 });
});
