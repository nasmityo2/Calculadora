'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dayzo-production-smoke-'));
const PORT = String(33_000 + Math.floor(Math.random() * 1000));
const username = `smoke_${crypto.randomBytes(4).toString('hex')}`;
const password = `${crypto.randomBytes(18).toString('base64url')}7a`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT,
      DATA_DIR,
      SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
      ADMIN_BOOTSTRAP: '1',
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
      BCV_TLS_FALLBACK: '0',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  try {
    const baseUrl = `http://127.0.0.1:${PORT}`;
    const deadline = Date.now() + 20_000;
    let response;
    while (Date.now() < deadline) {
      if (child.exitCode != null) throw new Error(`Servidor terminó con código ${child.exitCode}`);
      try {
        response = await fetch(`${baseUrl}/health-internal`);
        if (response.ok) break;
      } catch (_) {
        // Esperar bind.
      }
      await delay(150);
    }
    if (!response?.ok) throw new Error('Health interno no respondió.');
    const health = await response.json();
    const login = await fetch(`${baseUrl}/login`);
    if (!login.ok) throw new Error(`Login smoke respondió ${login.status}`);
    const csp = login.headers.get('content-security-policy') || '';
    if (!csp.includes("script-src 'self'")) throw new Error('CSP de producción inválida.');
    console.log(JSON.stringify({
      success: true,
      ready: health.ready,
      status: health.status,
      memoryRssMb: health.memoryRssMb,
      bind: `127.0.0.1:${PORT}`,
      csp: 'ok',
    }));
  } finally {
    if (child.exitCode == null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(12_000).then(() => child.kill()),
      ]);
    }
    fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(`smoke:production falló: ${error.message}`);
  process.exitCode = 1;
});
