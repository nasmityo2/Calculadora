'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let _db = null;

function resolveDataDir() {
  if (process.env.NEXUS_SQLITE_DIR && String(process.env.NEXUS_SQLITE_DIR).trim()) {
    return String(process.env.NEXUS_SQLITE_DIR).trim();
  }
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'NexusCore_data');
  } catch {
    return path.join(
      process.env.APPDATA || require('os').homedir(),
      'NexusCore_data'
    );
  }
}

function getDB() {
  if (!_db) {
    const dbDir = resolveDataDir();
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'nexus.db');

    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('cache_size = -32000'); // 32 MB cache
    _db.pragma('temp_store = MEMORY');
  }
  return _db;
}

// Reemplaza db.one() — retorna objeto o undefined (nunca lanza si no encuentra)
function getOne(sql, params = []) {
  return getDB().prepare(sql).get(...params);
}

// Reemplaza db.any() — retorna array vacío si no hay resultados
function getAll(sql, params = []) {
  return getDB().prepare(sql).all(...params);
}

// Reemplaza db.none() e INSERT RETURNING — retorna { lastInsertRowid, changes }
function run(sql, params = []) {
  return getDB().prepare(sql).run(...params);
}

// Reemplaza db.tx() — SÍNCRONO, atómico, hace rollback automático si lanza error
function transaction(fn) {
  return getDB().transaction(fn)();
}

function closeDB() {
  if (_db) { _db.close(); _db = null; }
}

// Ruta absoluta del archivo nexus.db (para respaldos con backupService)
function getDbPath() {
  return path.join(resolveDataDir(), 'nexus.db');
}

module.exports = { getDB, getOne, getAll, run, transaction, closeDB, getDbPath };
