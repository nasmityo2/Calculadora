#!/usr/bin/env node
'use strict';

/**
 * Diagnóstico de entorno local DAYZO.
 * Fail-closed: exit 1 si falta algo crítico para desarrollo local.
 */

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const lines = [];
let failed = false;

function ok(msg) { lines.push(`OK   ${msg}`); }
function warn(msg) { lines.push(`WARN ${msg}`); }
function bad(msg) { failed = true; lines.push(`FAIL ${msg}`); }

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) bad(`Node ${process.version} < 18`);
  else ok(`Node ${process.version}`);
}

function checkLock() {
  const lock = path.join(root, 'package-lock.json');
  const nm = path.join(root, 'node_modules');
  if (!fs.existsSync(lock)) bad('Falta package-lock.json');
  else ok('package-lock.json presente');
  if (!fs.existsSync(nm)) bad('Falta node_modules — ejecuta: npm ci');
  else ok('node_modules presente');
}

function checkCss() {
  const css = path.join(root, 'public', 'tailwind.css');
  if (!fs.existsSync(css)) bad('Falta public/tailwind.css — ejecuta: npm run build:css');
  else ok(`tailwind.css (${fs.statSync(css).size} bytes)`);
}

function checkAssets() {
  const chart = path.join(root, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
  const fa = path.join(root, 'node_modules', '@fortawesome', 'fontawesome-free', 'css', 'all.min.css');
  if (!fs.existsSync(chart)) bad('Falta Chart.js local — npm ci');
  else ok('Chart.js local');
  if (!fs.existsSync(fa)) bad('Falta Font Awesome local — npm ci');
  else ok('Font Awesome local');
}

function checkDataDir() {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(root, 'data');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const probe = path.join(dataDir, `.doctor-write-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    ok(`DATA_DIR escribible: ${dataDir}`);
  } catch (err) {
    bad(`DATA_DIR no escribible (${dataDir}): ${err.message}`);
  }

  const dbPath = path.join(dataDir, 'historial.db');
  if (fs.existsSync(dbPath)) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const check = db.pragma('quick_check', { simple: true });
      db.close();
      if (check === 'ok') ok('historial.db quick_check=ok');
      else bad(`historial.db quick_check=${check}`);
    } catch (err) {
      warn(`No se pudo abrir historial.db: ${err.message}`);
    }
  } else {
    ok('Sin historial.db (se creará al arrancar el servidor)');
  }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') warn(`Puerto ${port} ocupado`);
      else warn(`Puerto ${port}: ${err.message}`);
      resolve();
    });
    server.once('listening', () => {
      server.close(() => {
        ok(`Puerto ${port} libre`);
        resolve();
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

function printOnboarding() {
  lines.push('');
  lines.push('Primer arranque local (máx. 5 comandos):');
  lines.push('  1) npm ci');
  lines.push('  2) npm run build:css');
  lines.push('  3) npm run doctor:local');
  lines.push('  4) npm run dev');
  lines.push('  5) Abrir http://127.0.0.1:3001/calculadoraa');
  lines.push('');
  lines.push('No abras public/index.html con file:// — DAYZO necesita el servidor Express.');
}

async function main() {
  checkNode();
  checkLock();
  checkAssets();
  checkCss();
  checkDataDir();
  await checkPort(Number(process.env.PORT) || 3001);

  const syntax = spawnSync(
    process.execPath,
    ['--check', path.join(root, 'src', 'server.js')],
    { encoding: 'utf8' }
  );
  if (syntax.status === 0) ok('server.js sintaxis OK');
  else bad('server.js sintaxis inválida');

  printOnboarding();
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
