'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  backoffDelay,
  parseBcvHtml,
  sourceStatus,
  validateRate,
} = require('../../src/rates/rate-sources');

const validHtml = `
  <!doctype html><html><body>
    <div id="dolar"><strong>732,48</strong></div>
    <div id="yuan"><strong>101,22</strong></div>
    Fecha Valor: <span content="2026-07-17T00:00:00-04:00"></span>
  </body></html>
`;

test('parseBcvHtml extrae USD, CNY y fecha valor solo de bloques canónicos', () => {
  const parsed = parseBcvHtml(validHtml);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    usd: 732.48,
    cny: 101.22,
    fechaValor: '2026-07-17',
  });
});

test('parseBcvHtml falla cerrado si USD no existe o el documento está vacío', () => {
  assert.equal(parseBcvHtml('').error.code, 'BCV_EMPTY_DOCUMENT');
  const missing = parseBcvHtml(`<html>${'x'.repeat(120)}<div id="yuan"><strong>100,00</strong></div></html>`);
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'BCV_USD_NOT_FOUND');
});

test('validateRate rechaza saltos anómalos y límites físicos', () => {
  assert.equal(validateRate(105, { min: 10, max: 10_000, previous: 100 }).ok, true);
  assert.equal(validateRate(200, { min: 10, max: 10_000, previous: 100 }).code, 'RATE_JUMP_REJECTED');
  assert.equal(validateRate(0, { min: 10, max: 10_000 }).code, 'RATE_NOT_POSITIVE');
});

test('sourceStatus conserva cache como degraded y marca stale sin éxito reciente', () => {
  const now = Date.parse('2026-07-17T12:00:00Z');
  const cached = sourceStatus({
    lastAttemptAt: '2026-07-17T12:00:00Z',
    lastSuccessAt: '2026-07-17T11:59:30Z',
    staleAfterMs: 60_000,
    now,
    failures: 2,
  });
  assert.equal(cached.stale, false);
  assert.equal(cached.status, 'degraded');

  const down = sourceStatus({
    lastAttemptAt: '2026-07-17T12:00:00Z',
    lastSuccessAt: null,
    staleAfterMs: 60_000,
    now,
    failures: 1,
  });
  assert.equal(down.stale, true);
  assert.equal(down.status, 'unavailable');
});

test('backoffDelay aplica exponencial acotado y jitter determinista', () => {
  assert.equal(backoffDelay({
    baseMs: 10_000,
    failureCount: 2,
    maxMs: 120_000,
    jitterRatio: 0.2,
    random: () => 0.5,
  }), 44_000);
  assert.equal(backoffDelay({
    baseMs: 10_000,
    failureCount: 10,
    maxMs: 120_000,
    jitterRatio: 0.2,
    random: () => 1,
  }), 120_000);
});

test('scheduler Binance no usa setInterval y conserva lock in-flight', () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'server.js'), 'utf8');
  assert.doesNotMatch(serverSource, /setInterval\s*\(\s*updateBinance/);
  assert.match(serverSource, /if \(binanceInFlight\) return false;/);
  assert.match(serverSource, /backoffDelay\(/);
});
