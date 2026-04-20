import { expect, test } from '@playwright/test';
import { apiRequest, login } from './helpers/app.js';

test('overview, connected access, and schema visualizer stay usable in local desktop layout', async ({ page }) => {
    test.setTimeout(300000);

    const qaSuffix = Date.now().toString().slice(-8);
    const tableName = `schema_parent_${qaSuffix}`;
    const relatedTableName = `schema_child_${qaSuffix}`;

    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const createTableRes = await apiRequest(page, '/api/collections', {
        method: 'POST',
        body: JSON.stringify({
            name: tableName,
            display_name: tableName,
            schema: [
                { name: 'title', type: 'text', required: false, unique: false, is_primary: false, references: null },
                { name: 'status', type: 'text', required: false, unique: false, is_primary: false, references: null },
                { name: 'score', type: 'int8', required: false, unique: false, is_primary: false, references: null },
            ],
            rls_enabled: true,
            rls_rule: '',
            rls_policies: {},
            realtime_enabled: false,
        }),
    });
    expect(createTableRes.ok).toBe(true);

    const createRelatedTableRes = await apiRequest(page, '/api/collections', {
        method: 'POST',
        body: JSON.stringify({
            name: relatedTableName,
            display_name: relatedTableName,
            schema: [
                { name: 'parent_id', type: 'uuid', required: false, unique: false, is_primary: false, references: `${tableName}.id` },
                { name: 'summary', type: 'text', required: false, unique: false, is_primary: false, references: null },
            ],
            rls_enabled: true,
            rls_rule: '',
            rls_policies: {},
            realtime_enabled: false,
        }),
    });
    expect(createRelatedTableRes.ok).toBe(true);

    try {
        await page.reload({ waitUntil: 'networkidle' });

        await page.getByTestId('primary-nav-overview').click();
        await expect(page.getByText(/Project overview/i)).toBeVisible({ timeout: 30000 });
        const overviewCard = page.getByTestId('overview-database-card');
        await expect(overviewCard).toBeVisible({ timeout: 30000 });

        const beforeBox = await overviewCard.boundingBox();
        expect(beforeBox).not.toBeNull();
        await page.mouse.move(beforeBox.x + (beforeBox.width / 2), beforeBox.y + 64);
        await page.mouse.down();
        await page.mouse.move(beforeBox.x + (beforeBox.width / 2) + 120, beforeBox.y + 144, { steps: 14 });
        await page.mouse.up();
        await page.waitForTimeout(300);

        const afterBox = await overviewCard.boundingBox();
        expect(afterBox).not.toBeNull();
        expect(Math.abs(afterBox.x - beforeBox.x) + Math.abs(afterBox.y - beforeBox.y)).toBeGreaterThan(1);

        await page.getByTestId('open-connection-modal').click();
        await expect(page.getByText(/Connected project access/i)).toBeVisible({ timeout: 30000 });
        await page.getByTestId('connection-tab-access').click();
        await page.getByTestId('connection-verify-password').fill('OzyBase123!');
        await page.getByTestId('connection-verify-submit').click();
        await expect(page.getByText(/Admin verification confirmed/i)).toBeVisible({ timeout: 30000 });

        await page.getByTestId('connection-reveal-anon').click();
        await page.getByTestId('connection-reveal-service_role').click();
        await expect(page.getByText(/MCP quick access/i)).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(/VS Code `mcp\.json`/i)).toBeVisible({ timeout: 30000 });
        await expect(page.getByTestId('connection-mcp-json')).toContainText('"servers"');
        await expect(page.getByTestId('connection-copy-mcp-json')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('connection-toggle-mcp-advanced').click();
        await expect(page.getByText('Server URL', { exact: true })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('Tools URL', { exact: true })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('Invoke URL', { exact: true })).toBeVisible({ timeout: 30000 });
        await page.getByRole('button', { name: /Close/i }).click();

        await page.getByTestId('primary-nav-database').click();
        await expect(page.getByTestId('schema-visualizer-canvas')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('schema-fit-button').click();
        const schemaTableCard = page.getByTestId(`schema-table-card-${tableName}`);
        const relatedSchemaTableCard = page.getByTestId(`schema-table-card-${relatedTableName}`);
        await expect(schemaTableCard).toBeVisible({ timeout: 30000 });
        await expect(relatedSchemaTableCard).toBeVisible({ timeout: 30000 });
        await expect.poll(async () => page.getByTestId('schema-relationship-path').count(), { timeout: 30000 }).toBeGreaterThanOrEqual(1);

        const cardBox = await schemaTableCard.boundingBox();
        const relatedCardBox = await relatedSchemaTableCard.boundingBox();
        const viewport = page.viewportSize();
        expect(cardBox).not.toBeNull();
        expect(relatedCardBox).not.toBeNull();
        expect(viewport).not.toBeNull();
        expect(cardBox.x).toBeGreaterThanOrEqual(0);
        expect(cardBox.y).toBeGreaterThanOrEqual(0);
        expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width + 32);
        expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(viewport.height + 32);

        await page.mouse.move(cardBox.x + (cardBox.width / 2), cardBox.y + 26);
        await page.mouse.down();
        await page.mouse.move(cardBox.x + (cardBox.width / 2) + 140, cardBox.y + 120, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(250);

        const movedCardBox = await schemaTableCard.boundingBox();
        expect(movedCardBox).not.toBeNull();
        expect(Math.abs(movedCardBox.x - cardBox.x) + Math.abs(movedCardBox.y - cardBox.y)).toBeGreaterThan(1);
        expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    } finally {
        if (!page.isClosed()) {
            await apiRequest(page, `/api/collections/${relatedTableName}`, { method: 'DELETE' });
            await apiRequest(page, `/api/collections/${tableName}`, { method: 'DELETE' });
        }
    }
});
