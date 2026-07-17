'use strict';

const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const V = require('../src/validators');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'historial.db');
const username = V.cleanString(process.env.ADMIN_RESET_USERNAME, 64);
const password = process.env.ADMIN_RESET_PASSWORD == null ? '' : String(process.env.ADMIN_RESET_PASSWORD);
const confirmed = process.env.CONFIRM_ADMIN_RESET === 'YES';

async function main() {
  if (!confirmed) throw new Error('Define CONFIRM_ADMIN_RESET=YES para confirmar la operación.');
  const usernameError = V.validateUsername(username);
  if (usernameError) throw new Error(`ADMIN_RESET_USERNAME inválido: ${usernameError}`);
  const passwordError = V.validatePassword(password);
  if (passwordError || password.length < 12) {
    throw new Error(`ADMIN_RESET_PASSWORD inválido: ${passwordError || 'debe tener al menos 12 caracteres.'}`);
  }

  const db = new Database(DB_FILE);
  try {
    db.pragma('busy_timeout = 10000');
    const user = db.prepare('SELECT id, role FROM users WHERE LOWER(username) = LOWER(?)').get(username);
    if (!user || user.role !== 'admin') throw new Error('Administrador no encontrado.');

    const hash = await bcrypt.hash(password, 12);
    const reset = db.transaction(() => {
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
      // El store no indexa userId; invalidar todas las sesiones evita dejar
      // sesiones administrativas vigentes después de una rotación.
      db.prepare('DELETE FROM sessions').run();
    });
    reset();
    console.log(`Contraseña rotada e inicio de sesiones invalidado para "${username}".`);
  } finally {
    db.close();
    delete process.env.ADMIN_RESET_PASSWORD;
  }
}

main().catch((error) => {
  console.error(`admin:reset falló: ${error.message}`);
  process.exitCode = 1;
});
