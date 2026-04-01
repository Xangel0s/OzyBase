import { expect } from "@playwright/test";

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "system@ozybase.local";
export const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD || "OzyBase123!";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function ensureSystemInitialized(page) {
  const statusResponse = await page.request.get("/api/system/status");
  expect(statusResponse.ok()).toBe(true);

  const statusBody = await statusResponse.json();
  if (statusBody?.initialized) {
    return;
  }

  const setupResponse = await page.request.post("/api/system/setup", {
    data: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      mode: "clean",
    },
  });
  expect(setupResponse.ok()).toBe(true);
}

export async function login(page) {
  await ensureSystemInitialized(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const emailInput = page.locator(
    'input[placeholder="system@ozybase.local"], input[placeholder="Enter admin email"]',
  ).first();
  const passwordInput = page.locator(
    'input[placeholder="Enter your admin password"], input[placeholder="Enter your 32-char password"]',
  ).first();

  await emailInput.waitFor({ state: "visible", timeout: 30000 });
  await emailInput.fill(ADMIN_EMAIL);
  await passwordInput.waitFor({ state: "visible", timeout: 30000 });
  await passwordInput.fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Establish Link/i }).click();

  await expect
    .poll(
      () => page.evaluate(() => Boolean(localStorage.getItem("ozy_token"))),
      { timeout: 30000 },
    )
    .toBe(true);
  await expect(page.getByTestId("module-shell")).toBeVisible({
    timeout: 30000,
  });

  const selectedWorkspaceId = await page.evaluate(async () => {
    const currentWorkspaceId = localStorage.getItem("ozy_workspace_id");
    if (currentWorkspaceId) {
      return currentWorkspaceId;
    }

    const token = localStorage.getItem("ozy_token");
    const response = await fetch("/api/workspaces", {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: "same-origin",
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const firstWorkspaceId =
      Array.isArray(payload) && payload.length > 0 && payload[0]?.id
        ? String(payload[0].id)
        : null;
    if (firstWorkspaceId) {
      localStorage.setItem("ozy_workspace_id", firstWorkspaceId);
    }
    return firstWorkspaceId;
  });

  if (selectedWorkspaceId) {
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("module-shell")).toBeVisible({
      timeout: 30000,
    });
  }
}

export async function waitForOverview(page) {
  await expect(page.getByRole("button", { name: "Project Status" })).toBeVisible(
    { timeout: 30000 },
  );
}

export async function apiRequest(page, url, options = {}) {
  return page.evaluate(
    async ({ url, options, safeMethods }) => {
      const token = localStorage.getItem("ozy_token");
      const workspaceId = localStorage.getItem("ozy_workspace_id");
      const method = String(options.method || "GET").toUpperCase();
      const headers = new Headers(options.headers || {});

      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      if (workspaceId && !headers.has("X-Workspace-Id")) {
        headers.set("X-Workspace-Id", workspaceId);
      }
      if (options.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      if (!safeMethods.includes(method) && !headers.has("X-CSRF-Token")) {
        try {
          const csrfResponse = await fetch("/api/auth/csrf", {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "same-origin",
          });
          if (csrfResponse.ok) {
            const csrfPayload = await csrfResponse.json();
            const csrfToken =
              typeof csrfPayload?.csrf_token === "string"
                ? csrfPayload.csrf_token.trim()
                : "";
            if (csrfToken) {
              headers.set("X-CSRF-Token", csrfToken);
            }
          }
        } catch {
          // Let the request fail naturally so the test captures the backend error.
        }
      }

      const response = await fetch(url, {
        ...options,
        headers,
        credentials: "same-origin",
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }

      return {
        ok: response.ok,
        status: response.status,
        body,
      };
    },
    { url, options, safeMethods: Array.from(SAFE_METHODS) },
  );
}

export async function runSQL(page, query) {
  return apiRequest(page, "/api/sql", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}
