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
      workspace_name: "Primary Project",
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      mode: "clean",
    },
  });
  expect(setupResponse.ok()).toBe(true);
}

export async function login(page) {
  await ensureSystemInitialized(page);
  const candidateEmails = Array.from(
    new Set([ADMIN_EMAIL, "admin@ozybase.local", "system@ozybase.local"]),
  ).filter(Boolean);

  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBe(true);
  const csrfPayload = await csrfResponse.json();
  const csrfToken =
    typeof csrfPayload?.csrf_token === "string"
      ? csrfPayload.csrf_token.trim()
      : "";
  expect(csrfToken).toBeTruthy();

  const isRateLimited = (status, payload) => {
    if (status === 429) {
      return true;
    }
    const errorText =
      typeof payload?.error === "string" ? payload.error.toLowerCase() : "";
    return errorText.includes("rate limit");
  };

  let session = null;
  let lastError = "login failed";
  for (const email of candidateEmails) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const loginResponse = await page.request.post("/api/auth/login", {
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        data: {
          email,
          password: ADMIN_PASSWORD,
        },
      });

      const payload = await loginResponse.json().catch(() => null);
      if (loginResponse.ok() && typeof payload?.token === "string") {
        session = {
          token: payload.token,
          user: payload.user ?? null,
        };
        break;
      }

      if (typeof payload?.error === "string" && payload.error.trim()) {
        lastError = payload.error.trim();
      } else {
        lastError = `login failed with status ${loginResponse.status()}`;
      }

      if (isRateLimited(loginResponse.status(), payload) && attempt < 2) {
        await page.waitForTimeout((attempt + 1) * 750);
        continue;
      }

      break;
    }

    if (session) {
      break;
    }

    if (
      typeof lastError === "string" &&
      lastError.toLowerCase().includes("invalid email or password")
    ) {
      continue;
    }

    if (typeof lastError === "string" && lastError.toLowerCase().includes("rate limit")) {
      continue;
    }

    break;
  }

  expect(session, lastError).not.toBeNull();

  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("ozy_token", token);
    localStorage.removeItem("ozy_api_key");
    localStorage.setItem("ozy_user", JSON.stringify(user ?? null));
  }, session);

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
      return firstWorkspaceId;
    }

    const bootstrapResponse = await fetch("/api/workspaces/bootstrap", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: "same-origin",
    });
    const bootstrapPayload = await bootstrapResponse.json().catch(() => null);
    if (!bootstrapResponse.ok) {
      const needsManualWorkspace =
        bootstrapResponse.status === 409 &&
        String(bootstrapPayload?.error_code || "").trim() ===
          "WORKSPACE_ACCESS_REQUIRED";
      if (!needsManualWorkspace) {
        return null;
      }

      const createResponse = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "E2E Primary Project" }),
        credentials: "same-origin",
      });
      if (!createResponse.ok) {
        return null;
      }
      const createPayload = await createResponse.json().catch(() => null);
      const createdWorkspaceId =
        typeof createPayload?.id === "string" ? createPayload.id.trim() : "";
      if (createdWorkspaceId) {
        localStorage.setItem("ozy_workspace_id", createdWorkspaceId);
        return createdWorkspaceId;
      }
      return null;
    }
    const bootstrapWorkspaceId =
      typeof bootstrapPayload?.workspace_id === "string" &&
      bootstrapPayload.workspace_id.trim()
        ? bootstrapPayload.workspace_id.trim()
        : null;
    if (bootstrapWorkspaceId) {
      localStorage.setItem("ozy_workspace_id", bootstrapWorkspaceId);
    }
    return bootstrapWorkspaceId;
  });

  expect(selectedWorkspaceId, "Unable to resolve or bootstrap workspace for E2E session").toBeTruthy();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("module-shell")).toBeVisible({
    timeout: 30000,
  });
}

export async function waitForOverview(page) {
  await expect(page.getByRole("button", { name: "Open tables", exact: true })).toBeVisible({
    timeout: 30000,
  });
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
