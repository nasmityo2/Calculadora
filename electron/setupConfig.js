'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[nexus-setup]';

const CONFIG_FILENAME = 'config.env';

/**
 * @param {import('electron').App} app
 * @returns {string}
 */
function getUserConfigEnvPath(app) {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

/**
 * @param {string} val
 * @returns {string}
 */
function escapeEnvValue(val) {
  const s = String(val ?? '');
  if (/^[A-Za-z0-9_./:-]+$/.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * Carga variables: .env del proyecto (dev) y config.env en userData (prioridad).
 * @param {import('electron').App} app
 */
function loadNexusEnv(app) {
  const dotenv = require('dotenv');
  const projectEnv = path.join(__dirname, '..', '.env');
  dotenv.config({ path: projectEnv });

  const userEnv = getUserConfigEnvPath(app);
  if (fs.existsSync(userEnv)) {
    dotenv.config({ path: userEnv, override: true });
    console.log(`${LOG_PREFIX} Configuración cargada desde ${userEnv}`);
  }

  if (app.isPackaged && !process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }
}

/**
 * Primera ejecución: aún no existe config.env en userData.
 * SQLite no requiere credenciales — el wizard solo cubre licencia + admin + moneda + empresa.
 * @param {import('electron').App} app
 * @returns {boolean}
 */
function needsFirstRunSetup(app) {
  const force = String(process.env.NEXUS_FORCE_SETUP || '').trim().toLowerCase();
  if (force === '1' || force === 'true') {
    return true;
  }
  return !fs.existsSync(getUserConfigEnvPath(app));
}

/**
 * @returns {string}
 */
function generateJwtSecret() {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * Genera el config.env local (JWT y entorno). Ya no guarda credenciales PostgreSQL:
 * la BD es SQLite en userData/NexusCore_data/nexus.db.
 * @param {import('electron').App} app
 * @returns {Promise<{ ok: boolean, path: string }>}
 */
async function saveUserConfigEnv(app) {
  const jwtSecret = generateJwtSecret();
  const nodeEnv = app.isPackaged ? 'production' : (process.env.NODE_ENV || 'development');

  const lines = [
    '# Nexus Core — configuración local (generado en la primera ejecución)',
    '# No compartas este archivo; contiene el secreto de sesión.',
    '',
    `JWT_SECRET=${escapeEnvValue(jwtSecret)}`,
    'JWT_EXPIRES_IN=12h',
    '',
    `NODE_ENV=${nodeEnv}`,
    'PORT=3000',
    '',
    'DB_ENGINE=sqlite',
    'NEXUS_SETUP_COMPLETE=1'
  ];

  const target = getUserConfigEnvPath(app);
  const tmp = `${target}.tmp`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(tmp, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(tmp, target);

  console.log(`${LOG_PREFIX} Configuración guardada en ${target}`);

  return { ok: true, path: target };
}

/**
 * Aplica al proceso las variables recién guardadas (sin reiniciar Electron).
 * @param {import('electron').App} app
 */
function applySavedConfigToProcess(app) {
  loadNexusEnv(app);
}

module.exports = {
  getUserConfigEnvPath,
  loadNexusEnv,
  needsFirstRunSetup,
  saveUserConfigEnv,
  applySavedConfigToProcess
};
