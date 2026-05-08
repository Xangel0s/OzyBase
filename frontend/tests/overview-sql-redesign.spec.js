import { expect, test } from '@playwright/test';
import { login, waitForOverview } from './helpers/app.js';

test('overview and sql editor expose the simplified redesign', async ({ page }) => {
    test.setTimeout(240000);

    await page.setViewportSize({ width: 1280, height: 640 });
    await login(page);
    await waitForOverview(page);

    await expect(page.locator('header')).toContainText('OzyBase');
    await expect(page.locator('header')).toContainText('Primary Project');
    await expect(page.getByText(/Project overview/i)).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('overview-database-card')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Domain', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Database', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /Copy/i })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Open tables', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Open SQL', exact: true }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('overview-card-status')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('overview-card-tables')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('overview-card-functions')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('overview-card-storage')).toBeVisible({ timeout: 30000 });

    const overviewScrollMetrics = await page.getByTestId('overview-scroll-root').evaluate((node) => {
        const element = node;
        const before = element.scrollTop;
        element.scrollTop = 320;
        return {
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            before,
            after: element.scrollTop,
        };
    });
    expect(overviewScrollMetrics.scrollHeight).toBeGreaterThan(overviewScrollMetrics.clientHeight);
    expect(overviewScrollMetrics.after).toBeGreaterThan(overviewScrollMetrics.before);

    const summaryPanels = await page.evaluate(() => {
        const runtime = document.querySelector('[data-testid="overview-runtime-panel"]');
        const issues = document.querySelector('[data-testid="overview-issues-panel"]');
        const issuesScroll = document.querySelector('[data-testid="overview-issues-scroll"]');
        let issuesScrollBefore = 0;
        let issuesScrollAfter = 0;
        if (issuesScroll instanceof HTMLElement) {
            issuesScrollBefore = issuesScroll.scrollTop;
            issuesScroll.scrollTop = 240;
            issuesScrollAfter = issuesScroll.scrollTop;
        }
        return {
            runtime: runtime ? {
                clientHeight: runtime.clientHeight,
                scrollHeight: runtime.scrollHeight,
            } : null,
            issues: issues ? {
                clientHeight: issues.clientHeight,
                scrollHeight: issues.scrollHeight,
            } : null,
            issuesScroll: issuesScroll ? {
                clientHeight: issuesScroll.clientHeight,
                scrollHeight: issuesScroll.scrollHeight,
                before: issuesScrollBefore,
                after: issuesScrollAfter,
            } : null,
        };
    });
    expect(summaryPanels.runtime).not.toBeNull();
    expect(summaryPanels.issues).not.toBeNull();
    expect(summaryPanels.issuesScroll).not.toBeNull();
    expect(summaryPanels.runtime.clientHeight).toBeGreaterThan(180);
    expect(summaryPanels.issues.clientHeight).toBeGreaterThan(180);
    expect(summaryPanels.runtime.clientHeight).toBeLessThan(460);
    expect(summaryPanels.issuesScroll.scrollHeight).toBeGreaterThanOrEqual(summaryPanels.issuesScroll.clientHeight);
    expect(summaryPanels.issuesScroll.after).toBeGreaterThanOrEqual(summaryPanels.issuesScroll.before);

    await page.getByTestId('overview-card-storage').click();
    await expect(page.getByText(/Ozy Kernel :: Storage Node/i)).toBeVisible({ timeout: 30000 });

    await page.getByTestId('primary-nav-overview').click();
    await expect(page.getByTestId('overview-card-functions')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('overview-card-functions').click();
    await expect(page.getByRole('heading', { name: /^Edge Functions$/i })).toBeVisible({ timeout: 30000 });

    await page.getByTestId('primary-nav-overview').click();
    await expect(page.getByTestId('overview-card-status')).toBeVisible({ timeout: 30000 });

    await page.getByTestId('primary-nav-overview').click();
    await page.getByTestId('primary-nav-sql').click();
    await expect(page.getByRole('button', { name: /^Templates$/i })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /^Quickstarts$/i })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Table Preview/i)).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: /^Quickstarts$/i }).click();
    await expect(page.getByText(/Table Volume/i)).toBeVisible({ timeout: 30000 });
});
