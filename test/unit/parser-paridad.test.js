'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const servidor = require('../../src/domain/purchase-price');
const web = require('../../public/js/import-parser');

// El parser vive duplicado: el servidor valida lo que se guarda y la web calcula
// el preview sin ida y vuelta de red. Si divergen, la web enseña un número que
// el servidor rechaza recién al guardar, y el error no apunta al campo culpable.
const CASOS = [
  '30x30x30 15 50 32.5cny',
  '30x30x30 15 50 ¥32,5',
  '30x30x30 15 50 4.98usd 4 2',
  '30x30x30 15 50 32.5 CNY 4 2',
  '30x30x30 15 50 32,5cny 28cny 2',
  '30x30x30 15 50 4usdt 32.5cny 2',
  '30x30x30 15 50 US$4.98',
  '30x30x30 15 50',
  '30x30 15 50 32.5cny',
  '30x30x30 0 50 32.5cny',
  '30x30x30 15 0 32.5cny',
  '30x30x30 15 50 32.5',
  '30x30x30 15 50 -5cny',
  '30x30x30 15 50 9999999cny',
  '30x30x30 15 50 32.5cny 0 -2',
  '30x30x30 15 50 32.5cny 99999999usdt',
  '',
];

test('el parser del servidor y el de la web dan el mismo resultado', () => {
  for (const linea of CASOS) {
    for (const defaultCurrency of ['CNY', 'USD']) {
      assert.deepEqual(
        web.parseQuickImportLine(linea, { defaultCurrency }),
        servidor.parseQuickImportLine(linea, { defaultCurrency }),
        `divergen en "${linea}" con defaultCurrency=${defaultCurrency}`
      );
    }
  }
});

test('ambos parsers comparten el mismo tope de monto', () => {
  assert.equal(web.AMOUNT_LIMIT, servidor.AMOUNT_LIMIT);
});
