'use strict';

const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const { test, expect } = require('@playwright/test');
const { canonicalizeImportQuote } = require('../../src/domain/import-calculation');

const DB_FILE = path.resolve(__dirname, '..', '..', '.tmp', 'e2e', 'historial.db');

function quoteInput(index) {
  const hasPlan = index % 2 === 0;
  const company = index % 2 === 0
    ? { empresaNombre: 'Orinoco', empresaTarifaUSD: 865 }
    : { empresaNombre: 'GCCARGO', empresaTarifaUSD: 770 };
  return {
    ...company,
    cajas: index % 3 + 1,
    unidadesPorCaja: 24,
    dimensionesCm: { l: 20, w: 20, h: 20 },
    pesoPorCajaKg: 5,
    precioMercanciaPorUnidadUSD: 2,
    envioChinaPorCajaUSD: 4,
    feePlataforma: 0.03,
    feeBanco: 0.0125,
    ventaUnitarioUSD: hasPlan ? 6 + index / 100 : 0,
  };
}

function seedQuotes(username, count) {
  const db = new Database(DB_FILE);
  try {
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!user) throw new Error('Usuario E2E no encontrado');
    const remove = db.prepare('DELETE FROM import_quotes WHERE user_id = ?');
    const insert = db.prepare(`
      INSERT INTO import_quotes (id, name, quote, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now() - count * 1000;
    db.transaction(() => {
      remove.run(user.id);
      for (let index = 1; index <= count; index += 1) {
        const calculated = canonicalizeImportQuote(quoteInput(index));
        if (!calculated.ok) throw new Error(calculated.error.message);
        const quote = {
          ...calculated.value,
          rateSnapshot: {
            cny: 6.53,
            cnySource: 'e2e',
            capturedAt: new Date(now + index * 1000).toISOString(),
          },
        };
        insert.run(
          crypto.randomUUID(),
          `Producto ${String(index).padStart(3, '0')}`,
          JSON.stringify(quote),
          user.id,
          now + index * 1000,
          now + index * 1000
        );
      }
    })();
  } finally {
    db.close();
  }
}

function readQuoteJson(id) {
  const db = new Database(DB_FILE, { readonly: true });
  try {
    return db.prepare('SELECT quote FROM import_quotes WHERE id = ?').get(id)?.quote;
  } finally {
    db.close();
  }
}

async function refreshQuotes(page) {
  await page.evaluate(() => window.cargarCotizacionesImport({ reset: true }));
  await expect(page.locator('#import-quotes-list')).toHaveAttribute('aria-busy', 'false');
}

test('cotizaciones compactas escalan de 0 a 100 y cargan un detalle a la vez', async ({ page }) => {
  const username = `e2e_${crypto.randomBytes(4).toString('hex')}`;
  const password = `E2e${crypto.randomBytes(12).toString('base64url')}7`;
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const registration = await page.evaluate(async ({ username, password }) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Usuario E2E',
        username,
        email: `${username}@example.test`,
        password,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { username, password });
  expect(registration.status).toBe(200);

  await page.locator('#f-user').fill(username);
  await page.locator('#f-pass').fill(password);
  await Promise.all([
    page.waitForURL('**/calculadoraa'),
    page.locator('#btn-login').click(),
  ]);
  await page.locator('#nav-import').click();

  seedQuotes(username, 0);
  await refreshQuotes(page);
  await expect(page.locator('.c-quote-card--compact')).toHaveCount(0);
  await expect(page.locator('#import-quotes-list')).toContainText('Aún no tienes cotizaciones');

  seedQuotes(username, 1);
  await refreshQuotes(page);
  let cards = page.locator('.c-quote-card--compact');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator('.c-quote-lazy-detail')).toBeHidden();
  const compactBox = await cards.first().boundingBox();
  expect(compactBox.height).toBeLessThanOrEqual(230);

  seedQuotes(username, 20);
  await refreshQuotes(page);
  cards = page.locator('.c-quote-card--compact');
  await expect(cards).toHaveCount(20);
  await expect(page.locator('#import-quotes-count')).toHaveText('20/20');
  await expect(page.locator('#import-quotes-load-more')).toBeHidden();

  seedQuotes(username, 100);
  await refreshQuotes(page);
  cards = page.locator('.c-quote-card--compact');
  await expect(cards).toHaveCount(20);
  for (const expectedCount of [40, 60, 80, 100]) {
    await page.locator('#import-quotes-load-more').click();
    await expect(cards).toHaveCount(expectedCount);
  }
  await expect(page.locator('#import-quotes-count')).toHaveText('100/100');
  await expect(page.locator('#import-quotes-load-more')).toBeHidden();

  await page.locator('#import-quotes-search').fill('Producto 099');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Producto 099');
  await page.locator('#import-quotes-search').fill('');
  await expect(cards).toHaveCount(20);

  await page.locator('#import-quotes-company-filter').selectOption('Orinoco');
  await expect(page.locator('#import-quotes-count')).toHaveText('20/50');
  await page.locator('#import-quotes-company-filter').selectOption('ALL');
  await expect(page.locator('#import-quotes-count')).toHaveText('20/100');
  await page.locator('#import-quotes-plan-filter').selectOption('with');
  await expect(page.locator('#import-quotes-count')).toHaveText('20/50');
  await page.locator('#import-quotes-plan-filter').selectOption('all');
  await expect(page.locator('#import-quotes-count')).toHaveText('20/100');

  const firstCard = cards.nth(0);
  const secondCard = cards.nth(1);
  const firstId = await firstCard.getAttribute('data-quote-id');
  let failFirstDetail = true;
  const detailPattern = `**/api/import-quotes/${firstId}`;
  await page.route(detailPattern, async (route) => {
    if (failFirstDetail && route.request().method() === 'GET') {
      failFirstDetail = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'E2E_FAILURE', message: 'Fallo temporal E2E' },
        }),
      });
      return;
    }
    await route.continue();
  });

  await firstCard.locator('[data-quote-action="toggle"]').click();
  await expect(firstCard.locator('.c-quote-detail-error')).toBeVisible();
  await page.unroute(detailPattern);
  await firstCard.locator('[data-quote-action="retry-detail"]').click();
  await expect(firstCard.locator('.c-quote-lazy-detail__section').first()).toBeVisible();

  await secondCard.locator('[data-quote-action="toggle"]').click();
  await expect(firstCard.locator('.c-quote-lazy-detail')).toBeHidden();
  await expect(firstCard.locator('[data-quote-action="toggle"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(secondCard.locator('.c-quote-lazy-detail__section').first()).toBeVisible();
  await expect(secondCard.locator('[data-quote-action="toggle"]')).toHaveAttribute('aria-expanded', 'true');

  const secondId = await secondCard.getAttribute('data-quote-id');
  const beforeSimulation = readQuoteJson(secondId);
  await secondCard.locator('[data-quote-action="simulate"]').click();
  await expect(page.locator('#sim-source-banner')).toBeVisible();
  await expect(page.locator('#sim-source-banner')).toContainText('costos congelados');
  expect(readQuoteJson(secondId)).toBe(beforeSimulation);
  await expect(page.locator('#sim-saved-actions')).toBeVisible();
  await page.locator('#sim-cancel-saved').click();
  await expect(page.locator('#sim-source-banner')).toBeHidden();
  expect(readQuoteJson(secondId)).toBe(beforeSimulation);

  await secondCard.locator('[data-quote-action="simulate"]').click();
  await page.locator('#sim-input').fill('9.99');
  await page.locator('#sim-save-plan').click();
  await expect(page.locator('#sim-source-banner')).toContainText('Plan guardado');
  expect(JSON.parse(readQuoteJson(secondId)).ventaUnitarioUSD).toBe(9.99);

  await secondCard.locator('.c-quote-menu summary').click();
  await expect(secondCard.locator('[data-quote-action="edit"]')).toBeVisible();
  await expect(secondCard.locator('[data-quote-action="image"]')).toBeVisible();
  await expect(secondCard.locator('[data-quote-action="delete"]')).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
