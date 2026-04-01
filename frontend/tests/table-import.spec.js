import { expect, test } from '@playwright/test';
import { apiRequest, login, runSQL, waitForOverview } from './helpers/app.js';

test('typed table import coerces typed fields and preserves intentional text spacing', async ({ page }) => {
    test.setTimeout(240000);

    const suffix = Date.now().toString().slice(-8);
    const tableName = `qa_import_${suffix}`;

    try {
        await login(page);
        await waitForOverview(page);

        const createTableRes = await runSQL(page, `
            CREATE TABLE ${tableName} (
                id bigserial PRIMARY KEY,
                name text,
                age integer,
                is_active boolean,
                joined_on date,
                notes text
            )
        `);
        expect(createTableRes.ok).toBe(true);

        const importRes = await apiRequest(page, `/api/tables/${tableName}/import`, {
            method: 'POST',
            body: JSON.stringify([
                {
                    name: ' Alice ',
                    age: '42',
                    is_active: 'true',
                    joined_on: '2026-03-31',
                    notes: '  hello  ',
                },
                {
                    name: 'Bob',
                    age: '7',
                    is_active: 'false',
                    joined_on: '2026-03-30',
                    notes: '   ',
                },
            ]),
        });

        expect(importRes.status).toBe(200);
        expect(importRes.body?.message).toContain('Imported 2 records');

        const rowsRes = await apiRequest(page, `/api/collections/${tableName}/records?order=age.asc&limit=10`);
        expect(rowsRes.ok).toBe(true);
        expect(Array.isArray(rowsRes.body?.data)).toBe(true);
        expect(rowsRes.body.data).toHaveLength(2);

        const [youngest, oldest] = rowsRes.body.data;
        expect(youngest.name).toBe('Bob');
        expect(youngest.age).toBe(7);
        expect(youngest.is_active).toBe(false);
        expect(String(youngest.joined_on)).toContain('2026-03-30');
        expect(youngest.notes).toBeNull();

        expect(oldest.name).toBe(' Alice ');
        expect(oldest.age).toBe(42);
        expect(oldest.is_active).toBe(true);
        expect(String(oldest.joined_on)).toContain('2026-03-31');
        expect(oldest.notes).toBe('  hello  ');
    } finally {
        await runSQL(page, `DROP TABLE IF EXISTS ${tableName}`).catch(() => {});
    }
});
