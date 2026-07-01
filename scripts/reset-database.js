#!/usr/bin/env node
'use strict';

/**
 * Reset de la base de datos SQLite local (solo desarrollo / pruebas).
 * Elimina nexus.db (+ -wal / -shm). El backend la recrea con el schema completo
 * y el seed inicial (migrations.sqlite.js) en el próximo arranque.
 *
 * Directorio de datos: NEXUS_SQLITE_DIR > %APPDATA%\NexusCore_data.
 *
 * Uso: node scripts/reset-database.js --confirm
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

if (!process.argv.includes('--confirm')) {
  console.error('Esta operación BORRA la base de datos local. Ejecuta con --confirm para continuar.');
  process.exit(1);
}

function resolveDataDir() {
  if (process.env.NEXUS_SQLITE_DIR && String(process.env.NEXUS_SQLITE_DIR).trim()) {
    return String(process.env.NEXUS_SQLITE_DIR).trim();
  }
  return path.join(process.env.APPDATA || require('os').homedir(), 'NexusCore_data');
}

const dataDir = resolveDataDir();
const objetivos = ['nexus.db', 'nexus.db-wal', 'nexus.db-shm'].map((f) => path.join(dataDir, f));

let eliminados = 0;
for (const file of objetivos) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`Eliminado: ${file}`);
    eliminados += 1;
  }
}

if (eliminados === 0) {
  console.log(`No había base de datos en ${dataDir} — nada que borrar.`);
} else {
  console.log('Listo. El backend recreará la BD (schema + seed) en el próximo arranque.');
}
