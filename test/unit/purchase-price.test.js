'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  convertDisplayedAmount,
  normalizePurchasePrice,
  parseLocaleAmount,
  parsePurchasePriceToken,
  parseQuickImportLine,
  resolvePurchasePriceToUsd,
} = require('../../src/domain/purchase-price');
const {
  CALCULATION_VERSION,
  canonicalizeImportQuote,
  enrichQuoteWithHistoricalCny,
} = require('../../src/domain/import-calculation');

test('parseLocaleAmount acepta punto, coma y formato venezolano', () => {
  assert.equal(parseLocaleAmount('32.5'), 32.5);
  assert.equal(parseLocaleAmount('32,5'), 32.5);
  assert.equal(parseLocaleAmount('1.234,56'), 1234.56);
  assert.equal(parseLocaleAmount('1,234.56'), 1234.56);
  assert.equal(parseLocaleAmount(''), null);
});

test('tokens de precio CNY/USD con prefijos y sufijos', () => {
  assert.deepEqual(parsePurchasePriceToken('32.5cny').value, { amount: 32.5, currency: 'CNY' });
  assert.deepEqual(parsePurchasePriceToken('¥32,5').value, { amount: 32.5, currency: 'CNY' });
  assert.deepEqual(parsePurchasePriceToken('4.98usd').value, { amount: 4.98, currency: 'USD' });
  assert.deepEqual(parsePurchasePriceToken('$4.98').value, { amount: 4.98, currency: 'USD' });
  assert.deepEqual(parsePurchasePriceToken('US$4.98').value, { amount: 4.98, currency: 'USD' });
  assert.deepEqual(parsePurchasePriceToken('32.5', 'CNY').value, { amount: 32.5, currency: 'CNY' });
  assert.equal(parsePurchasePriceToken('32.5').ok, false);
  assert.equal(parsePurchasePriceToken('32.5').error.code, 'AMBIGUOUS_PURCHASE_CURRENCY');
});

test('no adivina moneda por magnitud', () => {
  const low = parsePurchasePriceToken('4.5');
  const high = parsePurchasePriceToken('32.5');
  assert.equal(low.ok, false);
  assert.equal(high.ok, false);
});

test('resolvePurchasePriceToUsd convierte CNY y no reconvierte USD', () => {
  const cny = resolvePurchasePriceToUsd({ amount: 32.5, currency: 'CNY' }, 6.53);
  assert.equal(cny.ok, true);
  assert.ok(Math.abs(cny.value.precioMercanciaPorUnidadUSD - (32.5 / 6.53)) < 1e-12);
  assert.equal(cny.value.precioMercanciaPorUnidadCNY, 32.5);

  const usd = resolvePurchasePriceToUsd({ amount: 4.98, currency: 'USD' }, 6.53);
  assert.equal(usd.ok, true);
  assert.equal(usd.value.precioMercanciaPorUnidadUSD, 4.98);
  assert.ok(Math.abs(usd.value.precioMercanciaPorUnidadCNY - (4.98 * 6.53)) < 1e-12);
});

test('parser rápido produce DTO con purchasePrice', () => {
  const a = parseQuickImportLine('30x30x30 15 50 32.5cny');
  assert.equal(a.ok, true);
  assert.deepEqual(a.value.purchasePrice, { amount: 32.5, currency: 'CNY' });

  const b = parseQuickImportLine('30x30x30 15 50 ¥32,5');
  assert.equal(b.ok, true);
  assert.equal(b.value.purchasePrice.currency, 'CNY');

  const c = parseQuickImportLine('30x30x30 15 50 4.98usd 4 2');
  assert.equal(c.ok, true);
  assert.deepEqual(c.value.purchasePrice, { amount: 4.98, currency: 'USD' });
  assert.equal(c.value.envioChinaPorCajaUSD, 4);
  assert.equal(c.value.cajas, 2);

  const d = parseQuickImportLine('30x30x30 15 50 32.5 CNY 4 2');
  assert.equal(d.ok, true);
  assert.deepEqual(d.value.purchasePrice, { amount: 32.5, currency: 'CNY' });

  const e = parseQuickImportLine('30x30x30 15 50 32.5', { defaultCurrency: 'USD' });
  assert.equal(e.ok, true);
  assert.equal(e.value.purchasePrice.currency, 'USD');

  const f = parseQuickImportLine('30x30x30 15 50 32.5cny 4usdt 2');
  assert.equal(f.ok, true);
  assert.deepEqual(f.value.purchasePrice, { amount: 32.5, currency: 'CNY' });
  assert.deepEqual(f.value.envioChinaPrice, { amount: 4, currency: 'USD' });
  assert.equal(f.value.cajas, 2);

  const g = parseQuickImportLine('30x30x30 15 50 4usdt 32.5cny 2');
  assert.equal(g.ok, true);
  assert.deepEqual(g.value.purchasePrice, { amount: 4, currency: 'USD' });
  assert.deepEqual(g.value.envioChinaPrice, { amount: 32.5, currency: 'CNY' });
  assert.equal(g.value.envioChinaPorCajaUSD, null);
});

test('cambio CNY→USD→CNY conserva valor económico', () => {
  const rate = 6.53;
  const usd = convertDisplayedAmount(32.5, 'CNY', 'USD', rate);
  assert.equal(usd.ok, true);
  const back = convertDisplayedAmount(usd.value, 'USD', 'CNY', rate);
  assert.equal(back.ok, true);
  assert.ok(Math.abs(back.value - 32.5) < 1e-9);
});

test('canonicalize v3 con purchasePrice CNY congela snapshot y equivalentes', () => {
  const result = canonicalizeImportQuote({
    empresaNombre: 'Orinoco',
    empresaTarifaUSD: 865,
    cajas: 1,
    unidadesPorCaja: 50,
    dimensionesCm: { l: 30, w: 30, h: 30 },
    pesoPorCajaKg: 15,
    purchasePrice: { amount: 32.5, currency: 'CNY' },
    envioChinaPorCajaUSD: 0,
    feePlataforma: 0.03,
    feeBanco: 0.0125,
  }, { cnyRate: 6.53, cnySource: 'bcv' });

  assert.equal(result.ok, true);
  assert.equal(result.value.calculationVersion, CALCULATION_VERSION);
  assert.equal(result.value.purchasePriceOriginalCurrency, 'CNY');
  assert.equal(result.value.purchasePriceOriginalAmount, 32.5);
  assert.equal(result.value.precioMercanciaPorUnidadCNY, 32.5);
  assert.ok(Math.abs(result.value.precioMercanciaPorUnidadUSD - (32.5 / 6.53)) < 1e-12);
  assert.equal(result.value.rateSnapshot.cny, 6.53);
  assert.equal(result.value.rateSnapshot.cnySource, 'bcv');
  assert.ok(result.value.costoUnitarioCNYEquivalent > 0);
});

test('canonicalize v3 USD no reconvierte y v2 legacy sigue abriendo', () => {
  const usd = canonicalizeImportQuote({
    empresaTarifaUSD: 865,
    cajas: 1,
    unidadesPorCaja: 24,
    dimensionesCm: { l: 20, w: 20, h: 20 },
    pesoPorCajaKg: 5,
    purchasePrice: { amount: 2, currency: 'USD' },
    envioChinaPorCajaUSD: 4,
  }, { cnyRate: 7, cnySource: 'bcv' });
  assert.equal(usd.ok, true);
  assert.equal(usd.value.precioMercanciaPorUnidadUSD, 2);

  const legacy = canonicalizeImportQuote({
    empresaTarifaUSD: 865,
    cajas: 1,
    unidadesPorCaja: 24,
    unidadesTotales: 24,
    dimensionesCm: { l: 20, w: 20, h: 20 },
    pesoPorCajaKg: 5,
    precioMercanciaPorUnidadUSD: 2,
    envioChinaPorCajaUSD: 4,
  }, { cnyRate: 6.53, cnySource: 'bcv' });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.value.precioMercanciaPorUnidadUSD, 2);
  assert.equal(legacy.value.purchasePriceOriginalCurrency, 'USD');
});

test('enrichQuoteWithHistoricalCny no usa tasa actual inventada sin snapshot', () => {
  const enriched = enrichQuoteWithHistoricalCny({
    precioMercanciaPorUnidadUSD: 2,
    costoUnitarioUSD: 3.72,
    inversionTotalUSD: 178.42,
    rateSnapshot: { cny: 6.53, cnySource: 'bcv', capturedAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.equal(enriched.precioMercanciaPorUnidadCNY, 2 * 6.53);
  assert.equal(enriched.costoUnitarioCNYEquivalent, 3.72 * 6.53);
});

test('normalizePurchasePrice rechaza moneda inválida', () => {
  const bad = normalizePurchasePrice({ amount: 10, currency: 'EUR' });
  assert.equal(bad.ok, false);
});
