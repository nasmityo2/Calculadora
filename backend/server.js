'use strict';

// Carga .env antes que cualquier otro módulo lea process.env.
// En producción empaquetada no habrá .env; las variables vienen del entorno del sistema.
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { logger } = require('./config/logger');
const { errorHandlerMiddleware } = require('./middleware/errorHandler.middleware');

const authRoutes = require('./routes/auth.routes');
const { requireAuth } = require('./middleware/auth.middleware');

const productosRoutes = require('./routes/productos.routes');
const ventasRoutes = require('./routes/ventas.routes');
const inventarioRoutes = require('./routes/inventario.routes');
const clientesRoutes = require('./routes/clientes.routes');
const proveedoresRoutes = require('./routes/proveedores.routes');
const cajaRoutes = require('./routes/caja.routes');
const reportesRoutes = require('./routes/reportes.routes');
const configuracionRoutes = require('./routes/configuracion.routes');
const usuariosRoutes = require('./routes/usuarios.routes');
const pdfRoutes = require('./routes/pdf.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const comprasRoutes = require('./routes/compras.routes');
const casheaRoutes        = require('./routes/cashea.routes');
const devolucionesRoutes  = require('./routes/devoluciones.routes');
const licenciaRoutes      = require('./routes/licencia.routes');
const setupRoutes         = require('./routes/setup.routes');
const cuentasPagarRoutes   = require('./routes/cuentasPagar.routes');
const cotizacionesRoutes   = require('./routes/cotizaciones.routes');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');

// Validación obligatoria en arranque (regla VARIABLES-DE-ENTORNO):
// si NODE_ENV=production y JWT_SECRET es el fallback de desarrollo o está vacío,
// el servidor DEBE abortar inmediatamente. Esto evita firmar tokens con un secret
// público en producción si alguien olvidó configurar el .env.
(function assertSecretsForProduction() {
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) return;

  const DEV_FALLBACK = 'nexus-core-dev-jwt-secret-cambiar-en-produccion';
  const secret = process.env.JWT_SECRET;
  const insecure = !secret || String(secret).trim() === '' || secret === DEV_FALLBACK || String(secret).trim().length < 32;

  if (insecure) {
    const msg =
      '[Nexus-Core] FATAL: JWT_SECRET no configurado o usa el valor por defecto inseguro. ' +
      'Define JWT_SECRET (≥48 bytes hex) en el entorno de producción antes de iniciar.';
    console.error(msg);
    logger.error(msg);
    process.exit(1);
  }

  if (!process.env.NEXUS_LICENSE_PUBLIC_KEY) {
    logger.warn(
      '[Nexus-Core] NEXUS_LICENSE_PUBLIC_KEY no definida; se usará la clave pública embebida por defecto.'
    );
  }
})();

// Modo red multi-cajero: se resuelve en start() leyendo configuracion.modo_red_activo.
// Mientras es false, el server solo escucha en 127.0.0.1 (sin exposición externa).
let modoRedActivo = false;

/** Origen de red privada RFC1918 (cajeros secundarios en la misma LAN). */
function esOrigenRedPrivada(origin) {
  return /^https?:\/\/(10\.(\d{1,3}\.){2}\d{1,3}|172\.(1[6-9]|2\d|3[01])\.(\d{1,3}\.)\d{1,3}|192\.168\.(\d{1,3}\.)\d{1,3})(:\d+)?$/.test(
    origin
  );
}

// CORS: permite peticiones desde file:// (origin: null) y localhost.
// En modo red también acepta orígenes de la propia LAN (el frontend servido por
// este mismo Express); requireAuth/JWT siguen siendo obligatorios en todas las rutas.
app.use(cors({
  origin: (origin, callback) => {
    // origin es null para carga desde file:// (Electron) o peticiones sin origen
    if (!origin || origin === 'null') return callback(null, true);
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    if (modoRedActivo && esOrigenRedPrivada(origin)) {
      return callback(null, true);
    }
    callback(new Error('CORS: origen no permitido'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', function (req, res) {
  try {
    require('./config/db').getOne('SELECT 1 AS ok');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    logger.error('health falló (sqlite)', { error: err.message });
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

app.get('/health/db', (req, res) => {
  try {
    const row = require('./config/db').getOne(
      `SELECT 'nexus.db' AS name, strftime('%Y-%m-%dT%H:%M:%fZ','now') AS server_time`
    );
    res.json({ ok: true, database: row.name, serverTime: row.server_time });
  } catch (err) {
    logger.error('health/db falló (sqlite)', { error: err.message });
    res.status(503).json({ ok: false, error: 'Sin conexión a SQLite' });
  }
});

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso. Espera 15 minutos.' }
});

app.use('/api/auth/login', loginRateLimiter);
app.use('/api/setup/admin-inicial', loginRateLimiter);
app.use('/api/setup/empresa-cashea-inicial', loginRateLimiter);
app.use('/api/setup/modo-moneda-inicial', loginRateLimiter);
// activar-inicial es sin JWT: rate-limit igual que login para evitar fuerza bruta de códigos
app.use('/api/licencia/activar-inicial', loginRateLimiter);
app.use('/api/auth', authRoutes);

// Licencia y setup inicial deben ir ANTES de app.use('/api', apiProtected).
app.use('/api/licencia', licenciaRoutes);
app.use('/api/setup', setupRoutes);

const apiProtected = express.Router();
apiProtected.use(requireAuth);
apiProtected.use('/productos', productosRoutes);
apiProtected.use('/ventas', ventasRoutes);
apiProtected.use('/inventario', inventarioRoutes);
apiProtected.use('/clientes', clientesRoutes);
apiProtected.use('/proveedores', proveedoresRoutes);
apiProtected.use('/caja', cajaRoutes);
apiProtected.use('/reportes', reportesRoutes);
apiProtected.use('/configuracion', configuracionRoutes);
apiProtected.use('/usuarios', usuariosRoutes);
apiProtected.use('/pdf', pdfRoutes);
apiProtected.use('/dashboard', dashboardRoutes);
apiProtected.use('/compras', comprasRoutes);
apiProtected.use('/cashea', casheaRoutes);
apiProtected.use('/devoluciones', devolucionesRoutes);
apiProtected.use('/cuentas-pagar', cuentasPagarRoutes);
apiProtected.use('/cotizaciones',  cotizacionesRoutes);

app.use('/api', apiProtected);

// ── Frontend para cajeros secundarios (modo red) ───────────────────────────────
// El mismo Express sirve la SPA: un cajero en la LAN abre http://IP:3000 en Chromium.
// index.html se entrega con window.NEXUS_API_BASE = location.origin inyectado al vuelo
// (los archivos del frontend NO se modifican; en Electron se sigue cargando vía file://).
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

function servirIndexConApiBase(req, res, next) {
  fs.readFile(path.join(FRONTEND_DIR, 'index.html'), 'utf8', (err, html) => {
    if (err) return next(err);
    const inyectado = html.replace(
      /<head([^>]*)>/i,
      `<head$1>\n  <script>window.NEXUS_API_BASE = window.location.origin;</script>`
    );
    res.type('html').send(inyectado);
  });
}

app.get('/', servirIndexConApiBase);
app.get('/index.html', servirIndexConApiBase);
app.use(express.static(FRONTEND_DIR, { index: false }));

app.use(errorHandlerMiddleware);

let server;

/**
 * Arranque SQLite: aplica el schema consolidado (migrations.sqlite.js),
 * cierra sesiones de caja huérfanas y levanta Express en 127.0.0.1.
 */
async function start() {
  const { getDB } = require('./config/db');
  const { runMigrations, cerrarSesionesHuerfanas } = require('./config/migrations.sqlite');

  const database = getDB();
  const resultado = runMigrations(database);
  if (resultado.aplicadas > 0) {
    logger.info('[SQLite] Base de Datos Nexus-Core inicializada/actualizada', resultado);
  }

  try {
    const cleanup = cerrarSesionesHuerfanas(database, 24);
    if (cleanup.cerradas > 0) {
      logger.warn(`${cleanup.cerradas} sesión(es) de caja huérfana(s) cerradas automáticamente al arrancar`);
    }
  } catch (cleanupErr) {
    logger.warn('Cleanup de sesiones huérfanas omitido', { error: cleanupErr.message });
  }

  // Modo red multi-cajero (Fase 6): bind 0.0.0.0 SOLO si modo_red_activo='1'.
  // Default seguro: 127.0.0.1. requireAuth sigue protegiendo todas las rutas.
  let bindAddress = '127.0.0.1';
  try {
    const { getOne } = require('./config/db');
    const modoRedRow = getOne(`SELECT valor FROM configuracion WHERE clave = 'modo_red_activo' LIMIT 1`);
    if (modoRedRow?.valor === '1') {
      bindAddress = '0.0.0.0';
      modoRedActivo = true;
      logger.warn('[Modo red] Activo: el servidor aceptará cajeros de la red local (JWT requerido en todas las rutas).');
    }
  } catch (e) {
    logger.warn('[Modo red] No se pudo leer modo_red_activo; usando 127.0.0.1', { error: e.message });
  }

  // Importante: async start() debe esperar el evento 'listening'. Si resolvemos antes,
  // Electron puede llamar a /api/licencia/estado demasiado pronto y fallar con ECONNREFUSED,
  // mostrando la activación aunque la licencia esté en la BD.
  await new Promise((resolve, reject) => {
    server = app.listen(PORT, bindAddress);
    server.once('listening', () => {
      logger.info(`Nexus-Core backend (SQLite) en http://${bindAddress}:${PORT}`);
      resolve();
    });
    server.once('error', reject);
  });

  try {
    const BackupScheduler = require('./services/backupScheduler');
    await BackupScheduler.start(null);
  } catch (err) {
    logger.warn('Programa de respaldos automáticos periódicos no iniciado', { error: err.message });
  }

  try {
    const BcvTasaAutoService = require('./services/bcvTasaAutoService');
    await BcvTasaAutoService.start(null);
  } catch (err) {
    logger.warn('Sincronización automática tasa BCV no iniciada', { error: err.message });
  }

  return server;
}

async function shutdown() {
  try {
    const BackupScheduler = require('./services/backupScheduler');
    BackupScheduler.stop();
  } catch (err) {
    logger.warn('BackupScheduler.stop omitido', { error: err.message });
  }

  try {
    const BcvTasaAutoService = require('./services/bcvTasaAutoService');
    BcvTasaAutoService.stop();
  } catch (err) {
    logger.warn('BcvTasaAutoService.stop omitido', { error: err.message });
  }

  try {
    const SyncService = require('./services/syncService');
    const r = await SyncService.runFullBackup({ source: 'app_shutdown' });
    if (r.ok) {
      logger.info('Respaldo al cerrar la aplicación completado', { file: r.fileName });
    } else {
      logger.warn('Respaldo al cerrar no se completó', { error: r.error });
    }
  } catch (err) {
    logger.warn('Respaldo al cerrar omitido o con error', { error: err.message });
  }

  return new Promise((resolve) => {
    const cerrarSqlite = () => {
      try {
        require('./config/db').closeDB();
      } catch (err) {
        logger.warn('closeDB SQLite omitido', { error: err.message });
      }
      resolve();
    };
    if (server) {
      server.close(cerrarSqlite);
    } else {
      cerrarSqlite();
    }
  });
}

if (require.main === module) {
  start().catch((err) => {
    logger.error('No se pudo iniciar el servidor', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', () => shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
}

module.exports = { app, PORT, start, shutdown };
