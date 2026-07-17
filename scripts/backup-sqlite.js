'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'historial.db');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(ROOT, 'backups'));
const RETENTION_DAYS = Math.max(1, Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10));
const LOCK_FILE = path.join(BACKUP_DIR, '.backup.lock');

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pruneDailyBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(BACKUP_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !/^historial-\d{4}-.*\.db$/.test(entry.name)) continue;
    const fullPath = path.join(BACKUP_DIR, entry.name);
    if (fs.statSync(fullPath).mtimeMs < cutoff) fs.unlinkSync(fullPath);
  }
}

async function main() {
  if (!fs.existsSync(DB_FILE)) throw new Error(`Base de datos no encontrada: ${DB_FILE}`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = fs.openSync(LOCK_FILE, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Ya existe un backup en ejecución.');
    throw error;
  }

  const filename = `historial-${stamp()}.db`;
  const target = path.join(BACKUP_DIR, filename);
  const restoreTarget = path.join(BACKUP_DIR, `.restore-${process.pid}.db`);
  const source = new Database(DB_FILE, { readonly: true, fileMustExist: true });
  try {
    await source.backup(target);
    const backup = new Database(target, { readonly: true, fileMustExist: true });
    try {
      const quickCheck = backup.pragma('quick_check', { simple: true });
      if (quickCheck !== 'ok') throw new Error(`quick_check del backup: ${quickCheck}`);
      await backup.backup(restoreTarget);
    } finally {
      backup.close();
    }

    const restored = new Database(restoreTarget, { readonly: true, fileMustExist: true });
    try {
      const restoreCheck = restored.pragma('quick_check', { simple: true });
      if (restoreCheck !== 'ok') throw new Error(`quick_check del restore drill: ${restoreCheck}`);
    } finally {
      restored.close();
    }
    fs.unlinkSync(restoreTarget);
    pruneDailyBackups();
    const size = fs.statSync(target).size;
    console.log(JSON.stringify({
      success: true,
      file: filename,
      bytes: size,
      quickCheck: 'ok',
      restoreDrill: 'ok',
      retentionDays: RETENTION_DAYS,
    }));
  } catch (error) {
    try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch (_) {}
    try { if (fs.existsSync(restoreTarget)) fs.unlinkSync(restoreTarget); } catch (_) {}
    throw error;
  } finally {
    source.close();
    if (lock != null) fs.closeSync(lock);
    try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
  }
}

main().catch((error) => {
  console.error(`backup-sqlite falló: ${error.message}`);
  process.exitCode = 1;
});
