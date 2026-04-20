import { expect, test } from '@playwright/test';
import { apiRequest, login } from './helpers/app.js';

test('table editor applies realtime insert update delete traffic without manual reload', async ({ page }) => {
    test.setTimeout(300000);

    const suffix = Date.now().toString().slice(-8);
    const tableName = `qa_live_${suffix}`;
    const insertedTitle = `live-insert-${suffix}`;
    const updatedTitle = `live-updated-${suffix}`;
    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await login(page);

    const createTableRes = await apiRequest(page, '/api/collections', {
        method: 'POST',
        body: JSON.stringify({
            name: tableName,
            display_name: tableName,
            schema: [
                { name: 'title', type: 'text', required: false, unique: false, is_primary: false, references: null },
                { name: 'status', type: 'text', required: false, unique: false, is_primary: false, references: null },
                { name: 'amount', type: 'int8', required: false, unique: false, is_primary: false, references: null },
                { name: 'owner', type: 'text', required: false, unique: false, is_primary: false, references: null },
            ],
            rls_enabled: false,
            rls_rule: '',
            rls_policies: {},
            realtime_enabled: true,
        }),
    });
    expect(createTableRes.ok).toBe(true);

    const seedRowRes = await apiRequest(page, `/api/tables/${tableName}/import`, {
        method: 'POST',
        body: JSON.stringify([
            { title: `seed-${suffix}`, status: 'queued', amount: 1, owner: 'qa' },
        ]),
    });
    expect(seedRowRes.ok).toBe(true);

    try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('module-shell')).toBeVisible({ timeout: 30000 });

        await page.getByRole('button', { name: 'Table Editor', exact: true }).click();
        await expect(page.getByRole('button', { name: /Saved Views/i })).toBeVisible({ timeout: 20000 });
        await page.getByRole('button', { name: new RegExp(tableName, 'i') }).first().click();

        const footer = page.getByTestId('table-editor-footer');
        await expect(footer).toBeVisible({ timeout: 20000 });
        await expect(page.getByRole('button', { name: /Realtime On/i })).toBeVisible({ timeout: 15000 });
        await expect(footer.getByText(/^Live on$/i)).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(`seed-${suffix}`)).toBeVisible({ timeout: 20000 });

        const insertRes = await apiRequest(page, `/api/tables/${tableName}/rows`, {
            method: 'POST',
            body: JSON.stringify({
                title: insertedTitle,
                status: 'active',
                amount: 7,
                owner: 'worker-a',
            }),
        });
        expect(insertRes.ok).toBe(true);
        const insertedId = String(insertRes.body?.id || insertRes.body?.data?.id || '');
        expect(insertedId).toBeTruthy();

        await expect(page.getByText('Live update applied')).toBeVisible({ timeout: 20000 });
        await expect(page.getByText(insertedTitle)).toBeVisible({ timeout: 20000 });

        const updateRes = await apiRequest(page, `/api/tables/${tableName}/rows/${encodeURIComponent(insertedId)}`, {
            method: 'PATCH',
            body: JSON.stringify({
                title: updatedTitle,
                status: 'done',
                amount: 9,
                owner: 'worker-b',
            }),
        });
        expect(updateRes.ok).toBe(true);

        await expect(page.getByText(updatedTitle)).toBeVisible({ timeout: 20000 });
        await expect(page.getByText(insertedTitle)).toHaveCount(0);

        const deleteRes = await apiRequest(page, `/api/tables/${tableName}/rows/${encodeURIComponent(insertedId)}`, {
            method: 'DELETE',
        });
        expect(deleteRes.ok).toBe(true);

        await expect(page.getByText(updatedTitle)).toHaveCount(0, { timeout: 20000 });
        await expect(footer.getByText(/records$/i)).toBeVisible({ timeout: 15000 });

        expect(pageErrors, `Unexpected browser page errors: ${pageErrors.join('\n')}`).toEqual([]);
        expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('\n')}`).toEqual([]);
    } finally {
        if (!page.isClosed()) {
            await apiRequest(page, `/api/collections/${tableName}`, { method: 'DELETE' }).catch(() => {});
        }
    }
});
