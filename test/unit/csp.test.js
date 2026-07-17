'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicDir = path.resolve(__dirname, '..', '..', 'public');

test('HTML no contiene handlers ni scripts inline', () => {
  for (const filename of ['index.html', 'login.html']) {
    const html = fs.readFileSync(path.join(publicDir, filename), 'utf8');
    assert.doesNotMatch(html, /\son(?:click|input|change)\s*=/i, filename);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, filename);
  }
});

test('shell no depende de CDNs o fuentes remotas', () => {
  const files = ['index.html', 'login.html', 'styles.css', 'manifest.json'];
  for (const filename of files) {
    const content = fs.readFileSync(path.join(publicDir, filename), 'utf8');
    assert.doesNotMatch(content, /cdn\.jsdelivr|cdnjs\.cloudflare|fonts\.googleapis|cdn-icons-png/i, filename);
  }
});
