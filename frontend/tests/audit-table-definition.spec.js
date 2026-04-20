import { test, expect } from '@playwright/test';

const PROBE_TABLE = '_v_users';

test('table definition endpoint is reachable for existing table', async ({ page }) => {
  const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'OzyBase123!';
  const candidateEmails = [
    process.env.E2E_ADMIN_EMAIL || 'system@ozybase.local',
    'admin@ozybase.local',
    'system@ozybase.local',
  ];

  const csrfRes = await page.request.get('/api/auth/csrf');
  expect(csrfRes.ok()).toBe(true);
  const csrfPayload = await csrfRes.json();
  const csrfToken = typeof csrfPayload?.csrf_token === 'string' ? csrfPayload.csrf_token.trim() : '';
  expect(csrfToken).toBeTruthy();

  let token = '';
  for (const email of candidateEmails) {
    const loginRes = await page.request.post('/api/auth/login', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      data: {
        email,
        password: adminPassword,
      },
    });
    if (!loginRes.ok()) {
      continue;
    }
    const loginPayload = await loginRes.json().catch(() => null);
    const maybeToken = typeof loginPayload?.token === 'string' ? loginPayload.token : '';
    if (maybeToken) {
      token = maybeToken;
      break;
    }
  }
  expect(token).toBeTruthy();

  const definitionRes = await page.request.get(`/api/schema/${encodeURIComponent(PROBE_TABLE)}/definition`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const definitionPayload = await definitionRes.json().catch(() => null);
  expect(definitionRes.ok(), JSON.stringify(definitionPayload ?? null)).toBe(true);
  expect(definitionRes.status()).toBe(200);
  expect(typeof definitionPayload?.definition_sql).toBe('string');
});
