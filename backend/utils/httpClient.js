'use strict';

/**
 * Cliente HTTP mínimo para el backend embebido en Electron 22 (Node 16 sin fetch global).
 * Usar en bcvApiClient y licenciaService — únicas salidas de red permitidas.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * @param {'GET'|'POST'} method
 * @param {string} urlStr
 * @param {object|null} [body]
 * @param {{ headers?: Record<string,string>, timeoutMs?: number }} [opts]
 * @returns {Promise<{ status:number, ok:boolean, body:object|null, raw:string }>}
 */
function requestJson(method, urlStr, body, opts = {}) {
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 8000;
  const extraHeaders = opts.headers || {};

  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const payload = body != null ? JSON.stringify(body) : null;
    const headers = Object.assign({ Accept: 'application/json' }, extraHeaders);
    if (payload != null) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
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
          resolve({
            status,
            ok: status >= 200 && status < 300,
            body: json,
            raw: data
          });
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

function getJson(urlStr, opts) {
  return requestJson('GET', urlStr, null, opts);
}

function postJson(urlStr, body, opts) {
  return requestJson('POST', urlStr, body, opts);
}

module.exports = { getJson, postJson, requestJson };
