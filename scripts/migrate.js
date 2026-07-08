/**
 * Migra historial_tasas.json → historial.db (SQLite)
 *
 * Uso (desde la raíz del proyecto):
 *   npm run migrate
 *   node scripts/migrate.js
 *
 * Variables de entorno opcionales:
 *   DATA_DIR   directorio de datos (default: <proyecto>/data)
 *   BATCH_SIZE filas por transacción (default: 5000)
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');

const ROOT     = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const JSON_FILE  = path.join(DATA_DIR, 'historial_tasas.json');
const DB_FILE    = path.join(DATA_DIR, 'historial.db');
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5000', 10);

// ── Verificaciones previas ────────────────────────────────────────

if (!fs.existsSync(JSON_FILE)) {
  console.error(`❌  No se encontró: ${JSON_FILE}`);
  process.exit(1);
}

if (fs.existsSync(DB_FILE)) {
  console.log(`⚠️  Ya existe ${DB_FILE}`);
  console.log('   Si quieres re-migrar, borra el .db primero:');
  console.log(`   rm ${DB_FILE}`);
  process.exit(0);
}

// ── Leer JSON ─────────────────────────────────────────────────────

console.log(`📂  Leyendo ${JSON_FILE} …`);
const raw = fs.readFileSync(JSON_FILE, 'utf8');

let registros;
try {
  registros = JSON.parse(raw);
} catch (e) {
  console.error('❌  El JSON está corrupto:', e.message);
  process.exit(1);
}

if (!Array.isArray(registros)) {
  console.error('❌  Se esperaba un array en el JSON');
  process.exit(1);
}

console.log(`✅  ${registros.length.toLocaleString()} registros encontrados`);

// ── Crear base de datos ───────────────────────────────────────────

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');
db.pragma('synchronous  = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp      INTEGER NOT NULL,
    fecha          TEXT    NOT NULL,
    binance        REAL    NOT NULL DEFAULT 0,
    binance_compra REAL    NOT NULL DEFAULT 0,
    bcv            REAL    NOT NULL DEFAULT 0,
    diff_bs        REAL    NOT NULL DEFAULT 0,
    diff_pct       REAL    NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_timestamp ON tasas (timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_fecha     ON tasas (fecha);
`);

const insert = db.prepare(`
  INSERT INTO tasas (timestamp, fecha, binance, binance_compra, bcv, diff_bs, diff_pct)
  VALUES (@timestamp, @fecha, @binance, @binance_compra, @bcv, @diff_bs, @diff_pct)
`);

const insertBatch = db.transaction((batch) => {
  for (const r of batch) insert.run(r);
});

let insertados = 0;
let omitidos   = 0;
const total    = registros.length;
const inicio   = Date.now();

for (let i = 0; i < total; i += BATCH_SIZE) {
  const batch   = registros.slice(i, i + BATCH_SIZE);
  const limpios = [];

  for (const r of batch) {
    const ts  = typeof r.timestamp === 'number' ? r.timestamp : null;
    const b   = typeof r.binance   === 'number' ? r.binance   : null;
    const bcv = typeof r.bcv       === 'number' ? r.bcv       : null;

    if (!ts || !b || !bcv) { omitidos++; continue; }

    const binance_compra = typeof r.binance_compra === 'number' ? r.binance_compra : 0;
    const diff_bs        = typeof r.diff_bs        === 'number' ? r.diff_bs        : b - bcv;
    const diff_pct       = typeof r.diff_pct       === 'number' ? r.diff_pct       : (bcv > 0 ? (diff_bs / bcv) * 100 : 0);
    const fecha          = r.fecha || new Date(ts).toLocaleString('es-VE', { timeZone: 'America/Caracas' });

    limpios.push({ timestamp: ts, fecha, binance: b, binance_compra, bcv, diff_bs, diff_pct });
  }

  if (limpios.length > 0) insertBatch(limpios);
  insertados += limpios.length;

  const pct = Math.round(((i + batch.length) / total) * 100);
  process.stdout.write(`\r   Progreso: ${pct}%  (${insertados.toLocaleString()} insertados)`);
}

console.log('\n');

const count   = db.prepare('SELECT COUNT(*) as c FROM tasas').get().c;
const minTS   = db.prepare('SELECT MIN(timestamp) as t FROM tasas').get().t;
const maxTS   = db.prepare('SELECT MAX(timestamp) as t FROM tasas').get().t;
const elapsed = ((Date.now() - inicio) / 1000).toFixed(1);
const sizeMB  = (fs.statSync(DB_FILE).size / 1024 / 1024).toFixed(2);

console.log('══════════════════════════════════════════');
console.log(`✅  Migración completada en ${elapsed}s`);
console.log(`   Registros insertados : ${insertados.toLocaleString()}`);
console.log(`   Registros omitidos   : ${omitidos} (sin timestamp/binance/bcv)`);
console.log(`   Total en DB          : ${count.toLocaleString()}`);
if (minTS) console.log(`   Rango               : ${new Date(minTS).toLocaleDateString('es-VE')} → ${new Date(maxTS).toLocaleDateString('es-VE')}`);
console.log(`   Tamaño del .db       : ${sizeMB} MB`);
console.log('══════════════════════════════════════════');
console.log(`\n💡  Backup del JSON y arranque:`);
console.log(`   cp ${JSON_FILE} ${JSON_FILE}.bak`);
console.log(`   cd ${ROOT} && pm2 restart calculadora`);

db.close();
