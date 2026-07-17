'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRODUCTO_LINK_MAX_LEN,
  sanitizeProductoLink,
  validatePassword,
  validateUsername,
} = require('../../src/validators');
const { normalizeHttpUrl } = require('../../public/js/url-utils');

test('sanitizeProductoLink agrega https a un dominio sin esquema', () => {
  assert.equal(
    sanitizeProductoLink('ejemplo.com/producto?id=7'),
    'https://ejemplo.com/producto?id=7'
  );
});

test('el normalizador web no reintroduce llaves en URLs sin esquema', () => {
  assert.equal(normalizeHttpUrl('ejemplo.com/producto'), 'https://ejemplo.com/producto');
  assert.equal(normalizeHttpUrl('{{https://ejemplo.com}}'), null);
  assert.equal(normalizeHttpUrl('javascript://alert(1)'), null);
});

test('sanitizeProductoLink conserva http y https válidos', () => {
  assert.equal(sanitizeProductoLink('https://example.com/a'), 'https://example.com/a');
  assert.equal(sanitizeProductoLink('http://example.com/a'), 'http://example.com/a');
});

test('sanitizeProductoLink rechaza protocolos ejecutables o no permitidos', () => {
  assert.equal(sanitizeProductoLink('javascript:alert(1)'), null);
  assert.equal(sanitizeProductoLink('data:text/html,test'), null);
  assert.equal(sanitizeProductoLink('ftp://example.com/file'), null);
});

test('sanitizeProductoLink rechaza valores malformados y limita el resultado', () => {
  assert.equal(sanitizeProductoLink('https://'), null);
  const oversized = `https://example.com/${'a'.repeat(PRODUCTO_LINK_MAX_LEN * 2)}`;
  assert.ok(sanitizeProductoLink(oversized).length <= PRODUCTO_LINK_MAX_LEN);
});

test('credenciales aplican los mínimos de formato', () => {
  assert.equal(validateUsername('admin_dayzo'), null);
  assert.match(validateUsername('a'), /3 caracteres/);
  assert.equal(validatePassword('segura123'), null);
  assert.match(validatePassword('sin-numeros'), /número/);
});
