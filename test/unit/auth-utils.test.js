'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { apiErrorMessage, safeNextPath, validatePassword } = require('../../public/js/auth');

test('safeNextPath acepta solo rutas same-origin', () => {
  const origin = 'https://dayzove.lat';
  assert.equal(safeNextPath('/calculadoraa?view=import#quotes', origin), '/calculadoraa?view=import#quotes');
  assert.equal(safeNextPath('//evil.example/path', origin), '/calculadoraa');
  assert.equal(safeNextPath('https://evil.example/path', origin), '/calculadoraa');
  assert.equal(safeNextPath('/\\evil.example', origin), '/calculadoraa');
  assert.equal(safeNextPath('', origin), '/calculadoraa');
});

test('apiErrorMessage soporta contrato v2 y adaptador legacy', () => {
  assert.equal(apiErrorMessage({ error: { code: 'X', message: 'V2' } }, 'fallback'), 'V2');
  assert.equal(apiErrorMessage({ error: 'Legacy' }, 'fallback'), 'Legacy');
  assert.equal(apiErrorMessage({}, 'fallback'), 'fallback');
});

test('validatePassword coincide con mínimos del servidor', () => {
  assert.equal(validatePassword('segura123').valid, true);
  assert.equal(validatePassword('sin-numeros').valid, false);
  assert.equal(validatePassword('12345678').valid, false);
});
