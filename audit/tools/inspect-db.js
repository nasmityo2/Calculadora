'use strict';
// Herramienta de auditoría: inspección rápida de la BD SQLite generada.
// Uso: node audit/tools/inspect-db.js <ruta nexus.db> [sql]
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
const sql = process.argv[3];
const db = new Database(dbPath, { readonly: true });

if (sql) {
  const rows = db.prepare(sql).all();
  console.log(JSON.stringify(rows, null, 2));
} else {
  const tablas = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((r) => r.name);
  console.log('TABLAS (' + tablas.length + '):', tablas.join(', '));
  if (tablas.includes('roles')) {
    console.log('ROLES:', db.prepare('SELECT nombre FROM roles').all().map((r) => r.nombre).join(', '));
  }
  if (tablas.includes('usuarios')) {
    console.log('USUARIOS:', JSON.stringify(db.prepare('SELECT username, rol_id, activo FROM usuarios').all()));
  }
  if (tablas.includes('configuracion')) {
    console.log('CONFIG_CLAVES:', db.prepare('SELECT COUNT(*) n FROM configuracion').get().n);
  }
  if (tablas.includes('_migrations')) {
    console.log('MIGRACIONES:', JSON.stringify(db.prepare('SELECT version, nombre FROM _migrations').all()));
  }
}
db.close();
