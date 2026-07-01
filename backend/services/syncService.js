'use strict';

const fs = require('fs').promises;
const path = require('path');

const { logger } = require('../config/logger');
const { crearBackup } = require('./backupService');
const { getDbPath } = require('../config/database.sqlite');

const STATE_FILENAME = 'nexus_backup_state.json';

/**
 * Respaldo completo de la BD SQLite con rotación y estado en disco.
 * Reemplaza el flujo pg_dump: usa backupService (.backup() nativo de better-sqlite3).
 * Directorio: NEXUS_BACKUP_DIR (Electron → userData/backups) o ./backups en backend suelto.
 */
class SyncService {
  static getBackupDir() {
    const fromEnv = process.env.NEXUS_BACKUP_DIR;
    if (fromEnv && String(fromEnv).trim().length > 0) {
      return path.resolve(String(fromEnv).trim());
    }
    return path.join(process.cwd(), 'backups');
  }

  /** Compatibilidad con el flujo PG de server.js — ya no hay binario que precalentar. */
  static async ensurePgDumpReady(_dbConn) {
    return null;
  }

  static async mergeState(partial) {
    const dir = this.getBackupDir();
    const statePath = path.join(dir, STATE_FILENAME);
    let prev = {};
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      prev = JSON.parse(raw);
    } catch (_e) {
      prev = {};
    }
    const next = { ...prev, ...partial };
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(next, null, 2), 'utf8');
  }

  /**
   * @param {{ source?: string }} [options]
   * @returns {Promise<{ ok: boolean, filePath?: string, fileName?: string, error?: string }>}
   */
  static async runFullBackup(options) {
    const source = (options && options.source) || 'unknown';
    const dir = this.getBackupDir();

    let filePath;
    try {
      filePath = await crearBackup(getDbPath(), dir);
    } catch (e) {
      const msg = `Respaldo SQLite fallido: ${e.message}`;
      logger.error(msg, { source });
      try {
        await this.mergeState({
          lastErrorCode: 'sqlite_backup_failed',
          lastErrorAt: new Date().toISOString(),
          lastErrorMessage: e.message
        });
      } catch (_s) {}
      return { ok: false, error: msg };
    }

    const fileName = path.basename(filePath);
    const lastSuccessAt = new Date().toISOString();
    try {
      await this.mergeState({
        lastSuccessAt,
        lastFile: fileName,
        lastSource: source,
        lastErrorCode: null,
        lastErrorAt: null,
        lastErrorMessage: null
      });
    } catch (e) {
      logger.warn('Respaldo creado pero no se pudo guardar el estado', { error: e.message });
    }

    logger.info('Respaldo completo generado', { file: fileName, source });
    return { ok: true, filePath, fileName, lastSuccessAt };
  }

  /**
   * @returns {Promise<{
   *   lastSuccessAt: string|null,
   *   lastFile: string|null,
   *   directorio: string,
   *   lastErrorCode: string|null,
   *   lastErrorAt: string|null,
   *   lastErrorMessage: string|null
   * }>}
   */
  static async getBackupStatus() {
    const dir = this.getBackupDir();
    const statePath = path.join(dir, STATE_FILENAME);
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      const j = JSON.parse(raw);
      const lastSuccessAt = j.lastSuccessAt != null ? String(j.lastSuccessAt) : null;
      const lastErrorCode =
        j.lastErrorCode !== undefined && j.lastErrorCode !== null ? String(j.lastErrorCode) : null;
      return {
        lastSuccessAt,
        lastFile: j.lastFile != null ? String(j.lastFile) : null,
        directorio: dir,
        lastErrorCode,
        lastErrorAt: j.lastErrorAt != null ? String(j.lastErrorAt) : null,
        lastErrorMessage:
          j.lastErrorMessage !== undefined && j.lastErrorMessage !== null
            ? String(j.lastErrorMessage)
            : null
      };
    } catch (_e) {
      return {
        lastSuccessAt: null,
        lastFile: null,
        directorio: dir,
        lastErrorCode: null,
        lastErrorAt: null,
        lastErrorMessage: null
      };
    }
  }
}

module.exports = SyncService;
