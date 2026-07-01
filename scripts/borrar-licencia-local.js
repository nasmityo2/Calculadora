#!/usr/bin/env node
'use strict';

/**
 * Borra la licencia guardada en configuracion (solo desarrollo / pruebas).
 * Opera sobre la BD SQLite local (NEXUS_SQLITE_DIR o %APPDATA%\NexusCore_data).
 *
 * Uso: node scripts/borrar-licencia-local.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { run, closeDB } = require('../backend/config/db');

try {
  const r = run(`DELETE FROM configuracion WHERE clave LIKE 'licencia_%'`);
  console.log(`Listo. Filas eliminadas en configuracion: ${r.changes}`);
  closeDB();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
