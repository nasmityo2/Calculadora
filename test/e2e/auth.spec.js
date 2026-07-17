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
  await expect(page.locator('#auth-value-title')).toContainText('Costos reales');
  await expect(page.locator('.auth-quote-preview')).toBeVisible();

  await page.locator('#btn-reg').click();
  await expect(page.locator('#r-name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#r-name-err')).not.toBeEmpty();

  await page.locator('#r-name').fill(user.fullName);
  await page.locator('#r-user').fill(user.username);
  await page.locator('#r-email').fill(user.email);
  await page.locator('#r-pass').fill(user.password);
  await page.locator('#r-pass2').fill(user.password);
  await page.locator('#btn-reg').click();
  await expect(page.locator('#reg-msg-success')).toBeVisible();
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
    const identityBox = await page.locator('.auth-identity').boundingBox();
    const accessBox = await page.locator('.auth-access').boundingBox();
    expect(identityBox.x).toBeLessThan(accessBox.x);
    expect(identityBox.width).toBeGreaterThan(500);

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

    await page.goto('/login');
    let last;
    for (let index = 0; index < 9; index += 1) {
      last = await page.evaluate(async () => {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        return { status: response.status, data: await response.json() };
      });
    }
    // El registro y login válidos anteriores ya consumieron dos de las diez
    // solicitudes de esta IP; la novena inválida debe quedar limitada.
    expect(last.status).toBe(429);
    expect(last.data.error.code).toBe('RATE_LIMITED');
  } finally {
    await context.close();
  }
});
