'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const CAPTURE_LABEL = (process.env.CAPTURE_LABEL || 'baseline').replace(/[^a-z0-9_-]/gi, '');
const OUT_DIR = path.join(ROOT, 'artifacts', CAPTURE_LABEL);
const DATA_DIR = path.join(OUT_DIR, 'data');
const PORT = Number(process.env.BASELINE_PORT || 3101);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const USERNAME = `baseline_${crypto.randomBytes(4).toString('hex')}`;
const PASSWORD = `${crypto.randomBytes(18).toString('base64url')}7a`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`El servidor baseline terminó con código ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/login`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`El servidor baseline no respondió: ${lastError?.message || 'timeout'}`);
}

async function loginAsBaselineAdmin(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.locator('#f-user').fill(USERNAME);
  await page.locator('#f-pass').fill(PASSWORD);
  await Promise.all([
    page.waitForURL('**/calculadoraa'),
    page.locator('#btn-login').click(),
  ]);
}

async function seedQuotes(page, count) {
  const result = await page.evaluate(async ({ count }) => {
    const me = await fetch('/api/auth/me').then((response) => response.json());
    const token = me.csrfToken;
    const fixtures = Array.from({ length: count }, (_, index) => index);
    for (const index of fixtures) {
      const cajas = index % 3 + 1;
      const unidadesPorCaja = 24;
      const unidadesTotales = cajas * unidadesPorCaja;
      const costoMercanciaUSD = unidadesTotales * 2;
      const envioChinaUSD = cajas * 4;
      const baseComisiones = costoMercanciaUSD + envioChinaUSD;
      const plataformaUSD = baseComisiones * 0.03;
      const comisionBancoUSD = baseComisiones * 0.0125;
      const subtotalUSD = baseComisiones + plataformaUSD + comisionBancoUSD;
      const envioInternacionalUSD = cajas * 35;
      const inversionTotalUSD = subtotalUSD + envioInternacionalUSD;
      const costoUnitarioUSD = inversionTotalUSD / unidadesTotales;
      const ventaUnitarioUSD = costoUnitarioUSD * 1.3;
      const gananciaUnitariaUSD = ventaUnitarioUSD - costoUnitarioUSD;
      const quote = {
        version: 1,
        entradaRaw: `20x20x20 5 ${unidadesPorCaja} 13.06 4 ${cajas}`,
        empresaNombre: 'Orinoco',
        empresaTarifaUSD: 865,
        empresaEnvioUSD: 865,
        cajas,
        unidadesPorCaja,
        unidadesTotales,
        dimensionesCm: { l: 20, w: 20, h: 20 },
        pesoPorCajaKg: 5,
        precioMercanciaPorUnidadUSD: 2,
        envioChinaPorCajaUSD: 4,
        volumenM3: 0.008 * cajas,
        volumenPorCajaM3: 0.008,
        pesoKg: 5 * cajas,
        tipoCobro: 'Vol. (mín. $35)',
        costoMercanciaUSD,
        envioChinaUSD,
        plataformaUSD,
        comisionBancoUSD,
        subtotalUSD,
        envioInternacionalUSD,
        fletePorCajaUSD: 35,
        tarifaMinAplicada: true,
        inversionTotalUSD,
        costoUnitarioUSD,
        costoPorCajaUSD: inversionTotalUSD / cajas,
        feePlataforma: 0.03,
        feeBanco: 0.0125,
        ventaUnitarioUSD,
        ventaPorCajaUSD: ventaUnitarioUSD * unidadesPorCaja,
        gananciaUnitariaUSD,
        gananciaTotalUSD: gananciaUnitariaUSD * unidadesTotales,
        roiVentaPct: 30,
        margenVentaPct: (gananciaUnitariaUSD / ventaUnitarioUSD) * 100,
      };
      const response = await fetch('/api/import-quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ name: `Producto baseline ${index + 1}`, quote }),
      });
      if (!response.ok) throw new Error(`seed quote ${index + 1}: ${response.status}`);
    }
    return true;
  }, { count });
  if (!result) throw new Error('No se pudieron crear cotizaciones baseline');
}

async function captureViewport(browser, width, suffix) {
  const context = await browser.newContext({ viewport: { width, height: width >= 1000 ? 1000 : 844 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT_DIR, `login-${suffix}.png`), fullPage: true });

  await loginAsBaselineAdmin(page);
  await page.goto(`${BASE_URL}/calculadoraa`, { waitUntil: 'networkidle' });
  await page.locator('#nav-import').click();
  await page.screenshot({ path: path.join(OUT_DIR, `simulador-${suffix}.png`), fullPage: true });
  await page.locator('#import-quotes-list').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, `cotizaciones-${suffix}.png`), fullPage: true });

  const metrics = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    quoteCards: document.querySelectorAll('.c-quote-card').length,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  await context.close();
  return metrics;
}

async function captureLighthouse() {
  const [{ default: lighthouse }, chromeLauncher] = await Promise.all([
    import('lighthouse'),
    import('chrome-launcher'),
  ]);
  const scores = {};
  for (const [name, pathname] of [['login', '/login'], ['app', '/calculadoraa']]) {
    const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless', '--no-sandbox'] });
    try {
      let result;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        result = await lighthouse(`${BASE_URL}${pathname}`, {
          port: chrome.port,
          output: 'json',
          logLevel: 'error',
          onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        });
        if (!result.lhr.runtimeError) break;
        if (attempt < 2) await sleep(750);
      }
      if (result.lhr.runtimeError) {
        throw new Error(`Lighthouse ${name}: ${result.lhr.runtimeError.code}`);
      }
      fs.writeFileSync(path.join(OUT_DIR, `lighthouse-${name}.json`), result.report);
      scores[name] = Object.fromEntries(
        Object.entries(result.lhr.categories).map(([key, category]) => [key, Math.round(category.score * 100)])
      );
    } finally {
      try {
        await chrome.kill();
      } catch (error) {
        // En Windows Chrome puede terminar correctamente mientras Defender aún
        // mantiene un handle breve sobre el perfil temporal de Lighthouse.
        if (error?.code !== 'EPERM') throw error;
        await sleep(750);
        try {
          fs.rmSync(error.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
        } catch (_) {
          // El perfil vive en %TEMP% y no contiene datos de la aplicación.
        }
      }
    }
  }
  return scores;
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR,
      SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
      ADMIN_BOOTSTRAP: '1',
      ADMIN_USERNAME: USERNAME,
      ADMIN_PASSWORD: PASSWORD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverErrors = '';
  child.stderr.on('data', (chunk) => {
    serverErrors += chunk.toString().replace(PASSWORD, '[REDACTED]');
  });

  let browser;
  try {
    await waitForServer(child);
    browser = await chromium.launch();
    const seedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const seedPage = await seedContext.newPage();
    await loginAsBaselineAdmin(seedPage);
    await seedQuotes(seedPage, 20);

    const listResponse = await seedPage.request.get(`${BASE_URL}/api/import-quotes`);
    const listBody = await listResponse.body();
    const healthResponse = await seedPage.request.get(`${BASE_URL}/health`);
    const health = healthResponse.ok() ? await healthResponse.json() : null;
    await seedContext.close();

    const viewports = {};
    viewports.desktop1440 = await captureViewport(browser, 1440, '1440');
    viewports.mobile390 = await captureViewport(browser, 390, '390');
    viewports.mobile360 = await captureViewport(browser, 360, '360');
    const lighthouseScores = process.env.CAPTURE_LIGHTHOUSE === '0'
      ? null
      : await captureLighthouse();

    const sizes = {};
    for (const relative of ['public/index.html', 'public/app.js', 'public/styles.css', 'public/login.html', 'public/tailwind.css']) {
      sizes[relative] = fs.statSync(path.join(ROOT, relative)).size;
    }

    const report = {
      capturedAt: new Date().toISOString(),
      baseCommit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      seededQuoteCount: 20,
      importQuotesPayloadBytes: listBody.length,
      viewports,
      lighthouseScores,
      processMemoryMb: health?.memory || null,
      staticBytes: sizes,
      serverErrors: serverErrors.trim() || null,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
  } finally {
    if (browser) await browser.close();
    if (child.exitCode == null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        sleep(12_000).then(() => child.kill()),
      ]);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
