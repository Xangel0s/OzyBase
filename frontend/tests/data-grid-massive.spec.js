import { expect, test } from '@playwright/test';
import { login, runSQL, waitForOverview } from './helpers/app.js';

test('massive table workflows stay usable in table editor and sql editor', async ({ page }) => {
    test.setTimeout(300000);

    const suffix = Date.now().toString().slice(-8);
    const tableName = `qa_massive_${suffix}`;
    const rowCount = 1200;
    let resizedTitleWidth = 0;

    try {
        await login(page);
        await waitForOverview(page);

        const createTableRes = await runSQL(page, `
            CREATE TABLE ${tableName} (
                id bigserial PRIMARY KEY,
                title text NOT NULL,
                amount integer NOT NULL,
                status text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            )
        `);
        expect(createTableRes.ok).toBe(true);

        const insertRowsRes = await runSQL(page, `
            INSERT INTO ${tableName} (title, amount, status)
            SELECT
                'item-' || gs::text,
                gs,
                CASE WHEN gs % 2 = 0 THEN 'active' ELSE 'queued' END
            FROM generate_series(1, ${rowCount}) AS gs
        `);
        expect(insertRowsRes.ok).toBe(true);

        await page.reload({ waitUntil: 'networkidle' });

        await page.getByRole('button', { name: 'Table Editor' }).click();
        await expect(page.getByRole('button', { name: /Saved Views/i })).toBeVisible({ timeout: 20000 });
        await page.getByRole('button', { name: new RegExp(tableName, 'i') }).first().click();

        await expect(page.getByText(`${rowCount} rows`)).toBeVisible({ timeout: 20000 });
        await expect(page.getByText('page 1 / 12')).toBeVisible({ timeout: 20000 });

        await page.getByRole('button', { name: 'Compact' }).click();
        await expect(page.getByRole('button', { name: 'Compact' })).toHaveClass(/text-primary/);

        const titleHeader = page.getByTestId('table-header-title');
        const titleResizeHandle = page.getByTestId('table-resize-title');
        const initialTitleBox = await titleHeader.boundingBox();
        expect(initialTitleBox).not.toBeNull();
        const resizeHandleBox = await titleResizeHandle.boundingBox();
        expect(resizeHandleBox).not.toBeNull();
        await page.mouse.move(
            resizeHandleBox.x + resizeHandleBox.width / 2,
            resizeHandleBox.y + resizeHandleBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
            resizeHandleBox.x + resizeHandleBox.width / 2 + 90,
            resizeHandleBox.y + resizeHandleBox.height / 2,
            { steps: 12 },
        );
        await page.mouse.up();
        await page.waitForTimeout(300);
        const resizedTitleBox = await titleHeader.boundingBox();
        expect(resizedTitleBox).not.toBeNull();
        resizedTitleWidth = resizedTitleBox.width;
        expect(resizedTitleWidth).toBeGreaterThan(initialTitleBox.width + 40);

        const storedColumnWidths = await page.evaluate((currentTableName) => {
            return JSON.parse(localStorage.getItem(`ozybase_column_widths_${currentTableName}`) || '{}');
        }, tableName);
        expect(storedColumnWidths.title).toBeGreaterThan(initialTitleBox.width + 40);

        await page.getByRole('button', { name: 'Columns' }).click();
        await expect(page.getByText('Visible Columns')).toBeVisible({ timeout: 10000 });
        await page.getByTestId('column-freeze-amount').click();
        await expect(page.getByText('frozen: amount')).toBeVisible({ timeout: 10000 });
        await page.getByTestId('column-visibility-status').uncheck();
        await expect(page.getByText('1 hidden columns')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('table-header-status')).toHaveCount(0);
        await page.locator('div.fixed.inset-0.z-40.outline-none').click({ force: true });

        await page.getByRole('button', { name: /^Sort/i }).click();
        await page.getByRole('button', { name: /Add Sort/i }).click();
        await page.getByRole('button', { name: /Add Sort/i }).click();
        const sortColumns = page.locator('[data-testid^="sort-column-"]');
        const sortDirections = page.locator('[data-testid^="sort-direction-"]');
        await sortColumns.nth(0).selectOption('amount');
        await sortDirections.nth(0).selectOption('desc');
        await sortColumns.nth(1).selectOption('title');
        await sortDirections.nth(1).selectOption('asc');
        await expect(page.getByText('sort: amount desc')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('sort: title asc')).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('button', { name: /^Sort/i })).toContainText('2');

        const pageJump = page.locator('label').filter({ hasText: /^Page$/i }).locator('input');
        await pageJump.fill('10');
        await pageJump.press('Enter');
        await expect(page.getByRole('textbox', { name: 'Page' })).toHaveValue('10', { timeout: 10000 });
        await expect(page.getByText('901-1000')).toBeVisible({ timeout: 10000 });

        await page.reload({ waitUntil: 'networkidle' });
        const afterReloadStorage = await page.evaluate((currentTableName) => ({
            hidden: localStorage.getItem(`ozybase_hidden_columns_${currentTableName}`),
            pinned: localStorage.getItem(`ozybase_pinned_columns_${currentTableName}`),
            widths: localStorage.getItem(`ozybase_column_widths_${currentTableName}`),
        }), tableName);
        expect(afterReloadStorage.hidden).toBe('["status"]');
        expect(afterReloadStorage.pinned).toBe('["amount"]');
        expect(afterReloadStorage.widths).toContain('"title"');
        await page.getByRole('button', { name: 'Table Editor' }).click();
        await expect(page.getByRole('button', { name: /Saved Views/i })).toBeVisible({ timeout: 20000 });
        await page.getByRole('button', { name: new RegExp(tableName, 'i') }).first().click();
        await expect(page.getByText(`${rowCount} rows`)).toBeVisible({ timeout: 20000 });
        const reloadedTitleBox = await page.getByTestId('table-header-title').boundingBox();
        expect(reloadedTitleBox).not.toBeNull();
        expect(Math.abs(reloadedTitleBox.width - resizedTitleWidth)).toBeLessThan(12);

        const searchInput = page.getByPlaceholder('Search records...');
        await searchInput.fill('item-1199');
        await expect(page.getByText('search: item-1199')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('item-1199')).toBeVisible({ timeout: 15000 });

        await page.getByRole('button', { name: 'reset view' }).click();
        await expect(page.getByText('search: item-1199')).not.toBeVisible({ timeout: 15000 });
        await expect(searchInput).toHaveValue('');
        await page.getByRole('button', { name: 'Dismiss', exact: true }).click();

        await page.getByRole('button', { name: /^SQL$/i }).click();
        await expect(page.getByRole('button', { name: /Run Query/i })).toBeVisible({ timeout: 15000 });

        const cappedPreviewRes = await runSQL(page, `SELECT * FROM ${tableName} ORDER BY id ASC;`);
        expect(cappedPreviewRes.ok).toBe(true);
        expect(cappedPreviewRes.body?.resultLimit).toBe(1000);
        expect(cappedPreviewRes.body?.truncated).toBe(true);
        expect(cappedPreviewRes.body?.rows?.length).toBe(1000);

        await page.getByRole('button', { name: /Run Query/i }).click();

        const previewFilter = page.getByPlaceholder('Filter preview rows...');
        await expect(previewFilter).toBeVisible({ timeout: 15000 });
        await previewFilter.fill('item-49');
        await expect(page.getByText('1/50 preview rows')).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('item-49')).toBeVisible({ timeout: 15000 });
    } finally {
        await runSQL(page, `DROP TABLE IF EXISTS ${tableName}`).catch(() => {});
    }
});
