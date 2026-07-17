'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'src', 'server.js');
const RESET_SCRIPT = path.join(ROOT, 'scripts', 'admin-reset.js');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomPassword = () => `${crypto.randomBytes(18).toString('base64url')}7a`;

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function startServer({ dataDir, port, adminUsername, adminPassword, bootstrap = false }) {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: dataDir,
    SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
    ADMIN_USERNAME: adminUsername,
  };
  if (adminPassword) env.ADMIN_PASSWORD = adminPassword;
  if (bootstrap) env.ADMIN_BOOTSTRAP = '1';

  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Servidor terminó con ${child.exitCode}: ${output.replace(adminPassword || '', '[REDACTED]')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/auth/me`);
      if (response.ok) return { child, baseUrl, output: () => output };
    } catch (_) {
      // El socket todavía no está listo.
    }
    await delay(100);
  }
  child.kill();
  throw new Error('Timeout esperando el servidor de integración');
}

async function stopServer(instance) {
  if (!instance || instance.child.exitCode != null) return;
  instance.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => instance.child.once('exit', resolve)),
    delay(12_000).then(() => instance.child.kill()),
  ]);
}

class SessionClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async request(pathname, { method = 'GET', body, csrfToken, cookie = this.cookie } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';', 1)[0];
    const data = await response.json().catch(() => null);
    return { response, data };
  }

  login(username, password) {
    return this.request('/api/auth/login', { method: 'POST', body: { username, password } });
  }
}

function quoteFixture() {
  return {
    version: 1,
    entradaRaw: '20x20x20 5 24 13.06 4 1',
    empresaNombre: 'Orinoco',
    empresaTarifaUSD: 865,
    empresaEnvioUSD: 865,
    cajas: 1,
    unidadesPorCaja: 24,
    unidadesTotales: 24,
    dimensionesCm: { l: 20, w: 20, h: 20 },
    pesoPorCajaKg: 5,
    precioMercanciaPorUnidadUSD: 2,
    envioChinaPorCajaUSD: 4,
    volumenM3: 0.008,
    volumenPorCajaM3: 0.008,
    pesoKg: 5,
    tipoCobro: 'Vol. (mín. $35)',
    costoMercanciaUSD: 48,
    envioChinaUSD: 4,
    plataformaUSD: 1.56,
    comisionBancoUSD: 0.65,
    subtotalUSD: 54.21,
    envioInternacionalUSD: 35,
    fletePorCajaUSD: 35,
    tarifaMinAplicada: true,
    inversionTotalUSD: 89.21,
    costoUnitarioUSD: 89.21 / 24,
    costoPorCajaUSD: 89.21,
    feePlataforma: 0.03,
    feeBanco: 0.0125,
  };
}

test('auth, sesiones, CSRF, roles, aislamiento y bootstrap son fail-closed', { timeout: 90_000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayzo-auth-'));
  const port = await freePort();
  const adminUsername = `admin_${crypto.randomBytes(3).toString('hex')}`;
  const adminPassword = randomPassword();
  const stalePassword = randomPassword();
  const resetPassword = randomPassword();
  const viewer1 = `viewer_${crypto.randomBytes(3).toString('hex')}`;
  const viewer2 = `viewer_${crypto.randomBytes(3).toString('hex')}`;
  const viewerPassword = randomPassword();
  let server;

  t.after(async () => {
    await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  server = await startServer({
    dataDir,
    port,
    adminUsername,
    adminPassword,
    bootstrap: true,
  });

  const anonymous = new SessionClient(server.baseUrl);
  let result = await anonymous.login('usuario-inexistente', viewerPassword);
  assert.equal(result.response.status, 401);
  assert.equal(result.data.success, false);

  for (const [username, suffix] of [[viewer1, 'uno'], [viewer2, 'dos']]) {
    result = await anonymous.request('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: `Usuario prueba ${suffix}`,
        username,
        email: `${username}@example.test`,
        password: viewerPassword,
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.success, true);
  }

  const admin = new SessionClient(server.baseUrl);
  result = await admin.login(adminUsername, adminPassword);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.role, 'admin');
  const adminCsrf = result.data.csrfToken;
  result = await admin.request('/api/auth/users');
  assert.equal(result.response.status, 200);

  const firstViewer = new SessionClient(server.baseUrl);
  result = await firstViewer.login(viewer1, viewerPassword);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.role, 'viewer');
  const firstCookie = firstViewer.cookie;

  result = await firstViewer.login(viewer1, viewerPassword);
  assert.equal(result.response.status, 200);
  const viewerCsrf = result.data.csrfToken;
  assert.notEqual(firstViewer.cookie, firstCookie, 'el ID de sesión debe regenerarse al autenticar');

  result = await firstViewer.request('/api/auth/me', { cookie: firstCookie });
  assert.equal(result.data.loggedIn, false, 'la sesión anterior debe quedar invalidada');

  result = await firstViewer.request('/api/auth/users');
  assert.equal(result.response.status, 403);

  result = await firstViewer.request('/api/import-quotes', {
    method: 'POST',
    body: { name: 'Sin CSRF', quote: quoteFixture() },
  });
  assert.equal(result.response.status, 403);

  result = await firstViewer.request('/api/import-quotes', {
    method: 'POST',
    csrfToken: viewerCsrf,
    body: { name: 'Aislada', quote: quoteFixture() },
  });
  assert.equal(result.response.status, 200);
  const quoteId = result.data.id;
  assert.match(quoteId, /^[0-9a-f-]{36}$/i);

  const secondViewer = new SessionClient(server.baseUrl);
  result = await secondViewer.login(viewer2, viewerPassword);
  const secondCsrf = result.data.csrfToken;
  result = await secondViewer.request(`/api/import-quotes/${quoteId}`);
  assert.equal(result.response.status, 404);
  result = await secondViewer.request(`/api/import-quotes/${quoteId}`, {
    method: 'DELETE',
    csrfToken: secondCsrf,
  });
  assert.equal(result.response.status, 404);

  result = await firstViewer.request('/api/auth/logout', {
    method: 'POST',
    csrfToken: viewerCsrf,
  });
  assert.equal(result.response.status, 200);
  result = await firstViewer.request('/api/auth/me');
  assert.equal(result.data.loggedIn, false);

  // Un segundo proceso en el mismo puerto debe terminar con código no cero.
  const conflictingData = fs.mkdtempSync(path.join(os.tmpdir(), 'dayzo-conflict-'));
  const conflict = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: conflictingData,
      SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
    },
    stdio: 'ignore',
  });
  const conflictCode = await Promise.race([
    new Promise((resolve) => conflict.once('exit', resolve)),
    delay(15_000).then(() => null),
  ]);
  if (conflict.exitCode == null) conflict.kill();
  fs.rmSync(conflictingData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  assert.equal(conflictCode, 1, 'un fallo fatal de bind debe terminar con código 1');

  await stopServer(server);
  server = null;

  // Compatibilidad segura: una variable ADMIN_PASSWORD antigua nunca resetea.
  server = await startServer({
    dataDir,
    port,
    adminUsername,
    adminPassword: stalePassword,
    bootstrap: false,
  });
  const afterRestart = new SessionClient(server.baseUrl);
  result = await afterRestart.login(adminUsername, stalePassword);
  assert.equal(result.response.status, 401);
  result = await afterRestart.login(adminUsername, adminPassword);
  assert.equal(result.response.status, 200);
  await stopServer(server);
  server = null;

  const reset = spawnSync(process.execPath, [RESET_SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      ADMIN_RESET_USERNAME: adminUsername,
      ADMIN_RESET_PASSWORD: resetPassword,
      CONFIRM_ADMIN_RESET: 'YES',
    },
    encoding: 'utf8',
  });
  assert.equal(reset.status, 0, reset.stderr);

  server = await startServer({ dataDir, port, adminUsername });
  const afterReset = new SessionClient(server.baseUrl);
  result = await afterReset.login(adminUsername, adminPassword);
  assert.equal(result.response.status, 401);
  result = await afterReset.login(adminUsername, resetPassword);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.role, 'admin');

  // La sesión admin original no debe sobrevivir a la rotación.
  result = await admin.request('/api/auth/me');
  assert.equal(result.data.loggedIn, false);
  assert.ok(adminCsrf);
});

test('producción aborta sin SESSION_SECRET fuerte', () => {
  const env = { ...process.env, NODE_ENV: 'production' };
  delete env.SESSION_SECRET;
  const result = spawnSync(process.execPath, [SERVER], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
});

test('producción aborta si HOST no es loopback', () => {
  const result = spawnSync(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
    },
    stdio: 'ignore',
    timeout: 10_000,
  });
  assert.equal(result.status, 1);
});
