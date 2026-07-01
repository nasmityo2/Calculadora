'use strict';
// Verificación de la tarea 2.5: tablas, roles+permisos, admin con bcrypt y config.
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database(process.argv[2], { readonly: true });

const tablas = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((r) => r.name);
console.log(`TABLAS (${tablas.length}):`, tablas.join(', '));

const roles = db.prepare('SELECT nombre, permisos FROM roles ORDER BY nombre').all();
for (const r of roles) {
  const p = JSON.parse(r.permisos);
  const claves = Object.keys(p);
  console.log(`ROL ${r.nombre}: ${claves.length} claves`, p.all === true ? '(all:true)' : `cotizaciones_all=${p.cotizaciones_all} cuentas_pagar_all=${p.cuentas_pagar_all} tasas_edit=${p.tasas_edit}`);
}

const admin = db.prepare(`SELECT username, password_hash, activo, rol_id FROM usuarios WHERE username='admin'`).get();
console.log('ADMIN login admin123 valido:', bcrypt.compareSync('admin123', admin.password_hash), '| activo:', admin.activo);

const cfg = db.prepare(`SELECT clave, valor FROM configuracion ORDER BY clave`).all();
console.log('CONFIG:', cfg.map((c) => `${c.clave}=${c.valor.length > 30 ? c.valor.slice(0, 27) + '...' : c.valor}`).join(' | '));

const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name`).all().map((r) => r.name);
console.log(`INDICES (${idx.length}):`, idx.join(', '));

const caja = db.prepare('SELECT nombre FROM cajas').all();
console.log('CAJAS:', JSON.stringify(caja));
const ht = db.prepare('SELECT fecha, tasa_bcv, tasa_usd FROM historial_tasas').all();
console.log('HISTORIAL_TASAS:', JSON.stringify(ht));
db.close();
