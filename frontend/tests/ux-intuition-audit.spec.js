import { test, expect } from "@playwright/test";
import { login } from "./helpers/app.js";

test("ux audit: core surfaces explain themselves clearly", async ({ page }) => {
  test.setTimeout(240000);

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  await page.getByRole("button", { name: "Home" }).hover();
  await expect(page.getByRole("button", { name: /Open project switcher/i })).toBeVisible();

  await page.getByRole("button", { name: /^Settings$/ }).click();
  await expect(page.getByText("General Settings")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Project ID").first()).toBeVisible();
  await expect(page.getByText("Production Readiness")).toBeVisible({
    timeout: 15000,
  });

  await page.getByRole("button", { name: /Open project switcher/i }).click();
  await expect(page.getByText("Project Settings")).toBeVisible();
  await expect(page.getByText("Project Directory")).toBeVisible();
  await page.getByText("Project Directory").click();
  await expect(page.getByRole("button", { name: /New Project/i })).toBeVisible({
    timeout: 15000,
  });

  await page.getByRole("button", { name: "Table Editor" }).click();
  await expect(page.getByRole("button", { name: /Saved Views/i })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Current Table")).toHaveCount(0);
  await expect(page.getByText("Visible Columns")).toHaveCount(0);
  await page.getByRole("button", { name: /Saved Views/i }).click();
  await expect(page.getByText("Save This Layout")).toBeVisible();
  await page.getByRole("button", { name: /Saved Views/i }).click({ force: true });
  await page.getByRole("button", { name: /^Insert$/ }).click();
  await expect(page.getByText("Add Column")).toBeVisible();
  await page.getByRole("button", { name: /^Insert$/ }).click({ force: true });

  await page.getByRole("button", { name: "SQL Editor" }).click();
  await expect(page.getByRole("button", { name: /Run Query/i })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Direct SQL access")).toHaveCount(0);
  await expect(page.getByText("Quick Brief")).toHaveCount(0);
  await page.getByRole("button", { name: /Run Query/i }).click();
  await expect(page.getByText("Query Results")).toBeVisible({
    timeout: 15000,
  });

  await page.getByRole("button", { name: "Storage" }).click();
  await expect(page.getByRole("button", { name: /Create bucket/i })).toBeVisible({
    timeout: 15000,
  });

  await page.getByRole("button", { name: "Authentication" }).click();
  await expect(page.getByRole("button", { name: "RBAC Console" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("explorer-submenu-policies")).toBeVisible({
    timeout: 15000,
  });

  expect(pageErrors, `Unexpected browser page errors: ${pageErrors.join("\n")}`).toEqual([]);
});
