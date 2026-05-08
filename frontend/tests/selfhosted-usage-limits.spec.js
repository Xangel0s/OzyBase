import { expect, test } from "@playwright/test";
import { login } from "./helpers/app.js";

test("self-hosted settings expose Usage & Limits instead of billing", async ({ page }) => {
  test.setTimeout(180000);

  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);

  await page.getByTestId("primary-nav-settings").click();
  await expect(page.getByRole("heading", { name: /General Settings/i })).toBeVisible({
    timeout: 30000,
  });

  await page.locator("aside").getByText("Usage & Limits", { exact: true }).click();
  await expect(page.getByRole("heading", { name: /Usage & Limits/i })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText(/Single-project local scope/i)).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("settings-selfhosted-scope-note")).toContainText(
    "does not provision another PostgreSQL database",
  );
  await expect(page.locator("p").filter({ hasText: /^Rows hard limit$/i }).last()).toBeVisible();
  await expect(page.locator("p").filter({ hasText: /^Storage hard limit \(bytes\)$/i }).last()).toBeVisible();
  await expect(page.locator("text=/^Billing$/i")).toHaveCount(0);
});
