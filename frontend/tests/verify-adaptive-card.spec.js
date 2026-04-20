import { expect, test } from '@playwright/test';
import { login } from './helpers/app.js';

test('database card is adaptive to long text', async ({ page }) => {
    // Mock the project info API to return a long domain
    await page.route('**/api/project/info', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                name: 'Primary Database',
                database: 'ozybase',
                version: '1.0.0',
                app_domain: 'base.long-subdomain-for-testing-purposes.geofal.com.pe',
                api_url: 'https://base.long-subdomain-for-testing-purposes.geofal.com.pe',
                db_size_bytes: 1024 * 1024 * 10, // 10MB
                deploy_country_code: 'pe',
                user_table_count: 5,
                system_table_count: 12,
                schema_count: 2,
                metrics: {
                    cpu_history: [10, 20, 15],
                    ram_history: [30, 35, 32],
                }
            }),
        });
    });

    await login(page);

    // Locate the database card
    const card = page.getByTestId('overview-database-card');
    await expect(card).toBeVisible();

    // Check max-width (440px)
    const cardStyle = await card.evaluate((node) => {
        const style = window.getComputedStyle(node);
        return {
            maxWidth: style.maxWidth,
            width: node.offsetWidth,
        };
    });
    expect(cardStyle.maxWidth).toBe('440px');

    // Check title wrapping
    const title = card.locator('h2');
    await expect(title).toBeVisible();
    await expect(title).toHaveClass(/break-words/);
    await expect(title).toHaveClass(/leading-tight/);

    // Verify it doesn't overflow horizontally
    const cardRect = await card.boundingBox();
    const titleRect = await title.boundingBox();
    
    expect(titleRect.width).toBeLessThanOrEqual(cardRect.width - 40); // 40px left+right padding (p-5 = 20px each)

    // Check grid items for break-words
    const domainValue = card.getByText('base.long-subdomain-for-testing-purposes.geofal.com.pe').first();
    await expect(domainValue).toHaveClass(/break-words/);

    const apiValue = card.getByText('https://base.long-subdomain-for-testing-purposes.geofal.com.pe').first();
    await expect(apiValue).toHaveClass(/break-words/);
    
    // Take a screenshot for comparison
    await card.screenshot({ path: 'tests/screenshots/adaptive-card-verified.png' });
});
