'use strict';

const crypto = require('crypto');
const { test, expect } = require('@playwright/test');

function account() {
  const username = `auth_${crypto.randomBytes(4).toString('hex')}`;
  return {
    fullName: 'Persona de prueba',
    username,
    email: `${username}@example.test`,
    password: `Auth${crypto.randomBytes(12).toString('base64url')}7`,
  };
}

test('registro, error, login y logout son accesibles en 390', async ({ page }) => {
  const user = account();
  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#r-name')).toBeFocused();
  await expect(page.locator('#auth-value-title')).toContainText('Tus costos, sin adivinar');
  await expect(page.locator('.auth-cost-chain')).toBeVisible();
  await expect(page.locator('.auth-quote-preview')).toHaveCount(0);

  await page.locator('#btn-register').click();
  await expect(page.locator('#r-name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#r-name-err')).not.toBeEmpty();

  await page.locator('#r-name').fill(user.fullName);
  await page.locator('#r-user').fill(user.username);
  await page.locator('#r-email').fill(user.email);
  await page.locator('#r-pass').fill(user.password);
  await page.locator('#btn-register').click();
  await expect(page.locator('#tab-login')).toHaveAttribute('aria-selected', 'true');

  await page.locator('#f-user').fill(user.username);
  await page.locator('#f-pass').fill('incorrecta7');
  await page.locator('#btn-login').click();
  await expect(page.locator('#login-msg-error')).toBeVisible();
  await expect(page.locator('#login-msg-error')).toBeFocused();

  await page.locator('#f-pass').fill(user.password);
  await Promise.all([
    page.waitForURL('**/calculadoraa'),
    page.locator('#btn-login').click(),
  ]);
  await expect(page.locator('.c-topbar__logout')).toBeVisible();
  await page.locator('.c-topbar__logout').click();
  await page.waitForURL('**/login');

  const targetSizes = await page.locator('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { id: button.id, width: rect.width, height: rect.height };
    })
  );
  for (const target of targetSizes.filter((item) => item.id && item.height > 0)) {
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test('layout 1440, next same-origin y rate limit fail-closed', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:3201',
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.77' },
  });
  const page = await context.newPage();
  const user = account();
  try {
    await page.goto('/login?next=//evil.example/path', { waitUntil: 'domcontentloaded' });
    const editorialBox = await page.locator('.auth-editorial').boundingBox();
    const accessBox = await page.locator('.auth-access').boundingBox();
    expect(editorialBox.x).toBeLessThan(accessBox.x);
    expect(editorialBox.width).toBeGreaterThan(420);
    await expect(page.locator('.auth-cost-chain')).toBeVisible();

    const registration = await page.evaluate(async (payload) => {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return response.status;
    }, user);
    expect(registration).toBe(200);

    await page.locator('#f-user').fill(user.username);
    await page.locator('#f-pass').fill(user.password);
    await Promise.all([
      page.waitForURL('**/calculadoraa'),
      page.locator('#btn-login').click(),
    ]);
    expect(new URL(page.url()).pathname).toBe('/calculadoraa');

    await page.locator('.c-topbar__logout').click();
    await page.waitForURL('**/login');
    await page.goto('/login?next=/calculadoraa', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#f-user')).toBeVisible();

    let limited = { status: 0, code: '' };
    for (let i = 0; i < 30; i += 1) {
      limited = await page.evaluate(async () => {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'noexiste', password: 'wrongpass1' }),
        });
        const data = await response.json().catch(() => ({}));
        return { status: response.status, code: data?.error?.code || data?.code };
      });
      if (limited.status === 429) break;
    }
    expect(limited.status).toBe(429);
    expect(String(limited.code || '')).toMatch(/RATE_LIMIT/i);
  } finally {
    await context.close();
  }
});
