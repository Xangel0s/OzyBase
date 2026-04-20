import { expect, test } from '@playwright/test';
import { apiRequest, login } from './helpers/app.js';

test('workspace header and themed table controls stay coherent', async ({ page }) => {
    test.setTimeout(300000);

    const qaSuffix = Date.now().toString().slice(-8);
    const tableName = `qa_theme_${qaSuffix}`;
    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });

    await page.setViewportSize({ width: 1440, height: 960 });
    await login(page);

    const activeWorkspace = await page.evaluate(async () => {
        const workspaceId = localStorage.getItem('ozy_workspace_id');
        const token = localStorage.getItem('ozy_token');
        if (!workspaceId || !token) {
            return null;
        }

        const response = await fetch('/api/workspaces', {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'same-origin',
        });
        if (!response.ok) {
            return { id: workspaceId, name: null };
        }

        const payload = await response.json();
        const workspace = Array.isArray(payload)
            ? payload.find((entry) => String(entry?.id || '') === String(workspaceId))
            : null;

        return {
            id: workspaceId,
            name: typeof workspace?.name === 'string' ? workspace.name : null,
        };
    });

    expect(activeWorkspace?.id).toBeTruthy();
    await expect(page.locator('header')).toContainText('OzyBase');
    await expect(page.locator('header')).not.toContainText('Global Context');
    await expect(page.locator('header')).not.toContainText('No Scoped Project');
    if (activeWorkspace?.name) {
        await expect(page.locator('header')).toContainText(activeWorkspace.name);
    }

    const createTableRes = await apiRequest(page, '/api/collections', {
        method: 'POST',
        body: JSON.stringify({
            name: tableName,
            display_name: tableName,
            schema: [
                { name: 'title', type: 'text', required: false, unique: false, is_primary: false, references: null },
                { name: 'status', type: 'text', required: false, unique: false, is_primary: false, references: null },
                { name: 'stage', type: 'text', required: false, unique: false, is_primary: false, references: null },
                { name: 'amount', type: 'int8', required: false, unique: false, is_primary: false, references: null },
                { name: 'score', type: 'int8', required: false, unique: false, is_primary: false, references: null },
                { name: 'owner', type: 'text', required: false, unique: false, is_primary: false, references: null },
            ],
            rls_enabled: false,
            rls_rule: '',
            rls_policies: {},
            realtime_enabled: false,
        }),
    });
    expect(createTableRes.ok).toBe(true);

    const importRowsRes = await apiRequest(page, `/api/tables/${tableName}/import`, {
        method: 'POST',
        body: JSON.stringify([
            { title: `row-${qaSuffix}`, status: 'open', stage: 'draft', amount: 7, score: 9, owner: 'qa' },
        ]),
    });
    expect(importRowsRes.ok).toBe(true);

    try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Table Editor' }).click();
        await expect(page.getByRole('button', { name: /Saved Views/i })).toBeVisible({ timeout: 20000 });
        await page.getByRole('button', { name: tableName, exact: true }).first().click();
        await expect(page.getByRole('button', { name: new RegExp(`Table\\s+${tableName}`, 'i') })).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(`row-${qaSuffix}`)).toBeVisible({ timeout: 20000 });
        await expect(page.getByRole('button', { name: /Realtime Off/i })).toBeVisible({ timeout: 15000 });
        const footer = page.getByTestId('table-editor-footer');
        await expect(footer).toBeVisible({ timeout: 15000 });
        await expect(footer.getByText(/^1-1 \/ 1 records$/i)).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(/^Live off$/i)).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(/^Showing 1-1$/i)).toHaveCount(0);
        await expect(page.getByText(/scroll for more columns/i)).toHaveCount(0);
        await expect(page.getByText(/^Data$/i)).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('button', { name: /^Definition$/i })).toBeVisible({ timeout: 15000 });

        await page.getByRole('button', { name: /^Insert$/i }).click();
        const insertMenu = page.locator('.ozy-floating-panel').filter({ has: page.getByText('Insert Row') }).last();
        await expect(insertMenu.getByText('Insert Row')).toBeVisible({ timeout: 10000 });
        await expect(insertMenu.getByText('Add Column')).toBeVisible({ timeout: 10000 });
        const insertBox = await insertMenu.boundingBox();
        const viewport = page.viewportSize();
        expect(insertBox).not.toBeNull();
        expect(viewport).not.toBeNull();
        expect(insertBox.x).toBeGreaterThanOrEqual(0);
        expect(insertBox.y).toBeGreaterThanOrEqual(0);
        expect(insertBox.x + insertBox.width).toBeLessThanOrEqual(viewport.width);
        expect(insertBox.y + insertBox.height).toBeLessThanOrEqual(viewport.height);
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: /100 rows/i }).last().click();
        const footerListbox = page.getByRole('listbox').last();
        await expect(footerListbox).toBeVisible({ timeout: 10000 });
        await expect(footerListbox.getByRole('option', { name: '50 rows', exact: true })).toBeVisible();
        const footerBackground = await footerListbox.evaluate((node) => getComputedStyle(node).backgroundColor);
        expect(footerBackground).not.toBe('rgb(255, 255, 255)');
        expect(footerBackground).toBe('rgb(11, 11, 11)');
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: /^Filter$/i }).click();
        await page.getByRole('button', { name: /Add Filter/i }).click();
        const filterSelect = page.getByRole('button', { name: 'Select column', exact: true }).first();
        await filterSelect.click();
        const filterListbox = page.getByRole('listbox').last();
        await expect(filterListbox).toBeVisible({ timeout: 10000 });
        const filterBackground = await filterListbox.evaluate((node) => getComputedStyle(node).backgroundColor);
        expect(filterBackground).not.toBe('rgb(255, 255, 255)');
        expect(filterBackground).toBe('rgb(11, 11, 11)');
        await expect(filterListbox.getByRole('option', { name: 'title', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');

        expect(pageErrors, `Unexpected browser page errors: ${pageErrors.join('\n')}`).toEqual([]);
        expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('\n')}`).toEqual([]);
    } finally {
        if (!page.isClosed()) {
            await apiRequest(page, `/api/collections/${tableName}`, { method: 'DELETE' });
        }
    }
});
