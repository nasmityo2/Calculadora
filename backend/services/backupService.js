'use strict';
/**
 * backupService — respaldo nativo de la BD SQLite (reemplaza pg_dump).
 * Usa la API .backup() de better-sqlite3: copia consistente incluso con la BD en uso (WAL).
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const MAX_BACKUPS = 10;

/**
 * Crea un respaldo de la BD SQLite y rota los antiguos.
 * @param {string} dbPath Ruta del archivo nexus.db origen.
 * @param {string} backupDir Carpeta destino de los respaldos.
 * @returns {Promise<string>} Ruta del archivo .db generado.
 */
async function crearBackup(dbPath, backupDir) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error(`backupService.crearBackup: BD origen no existe (${dbPath})`);
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const fecha = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(backupDir, `nexus-backup-${fecha}.db`);

  const source = new Database(dbPath, { readonly: true });
  try {
    await source.backup(backupPath);
  } finally {
    source.close();
  }

  // Rotar: mantener solo los últimos MAX_BACKUPS respaldos
  const archivos = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('nexus-backup-') && f.endsWith('.db'))
    .sort();
  while (archivos.length > MAX_BACKUPS) {
    fs.unlinkSync(path.join(backupDir, archivos.shift()));
  }

  return backupPath;
}

module.exports = { crearBackup, MAX_BACKUPS };
