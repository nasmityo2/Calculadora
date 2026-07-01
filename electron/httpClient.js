'use strict';

/**
 * Cliente HTTP mínimo para el proceso principal de Electron.
 * Electron 22 usa Node 16, que no expone fetch global — usar http/https nativos.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

function requestJson(method, urlStr, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const payload = body != null ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (payload != null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers,
        timeout: timeoutMs
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch (_e) { /* cuerpo no JSON */ }
          const status = res.statusCode || 0;
          resolve({ status, ok: status >= 200 && status < 300, body: json });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    if (payload != null) req.write(payload);
    req.end();
  });
}

function getJson(urlStr, timeoutMs) {
  return requestJson('GET', urlStr, null, timeoutMs);
}

function postJson(urlStr, body, timeoutMs) {
  return requestJson('POST', urlStr, body, timeoutMs);
}

module.exports = { getJson, postJson };
