'use strict';

const crypto      = require('crypto');
const express     = require('express');
const http        = require('http');
const https       = require('https');
const axios       = require('axios');
const bcrypt      = require('bcrypt');
const session     = require('express-session');
const rateLimit   = require('express-rate-limit');
const helmet      = require('helmet');
const compression = require('compression');
const fs          = require('fs');
const path        = require('path');
const WebSocket   = require('ws');
const Database     = require('better-sqlite3');
const SQLiteSessionStore = require('./sqlite-session-store');
const V = require('./validators');
const BcvVigencia = require('./bcv-vigencia');
const ImportCalculation = require('./domain/import-calculation');
const RateSources = require('./rates/rate-sources');

// ─── SECCIÓN: LOGGER MÍNIMO ─────────────────────────────────────────────────
// Sin winston/pino: ahorra RAM. Nunca loguear contraseñas ni tokens.

const log = {
  info:  (...a) => console.log(`[${new Date().toISOString()}] INFO `, ...a),
  warn:  (...a) => console.warn(`[${new Date().toISOString()}] WARN `, ...a),
  error: (...a) => console.error(`[${new Date().toISOString()}] ERROR`, ...a),
};

const IS_PROD = process.env.NODE_ENV === 'production';

// ─── SECCIÓN: VALIDACIÓN DE VARIABLES DE ENTORNO ────────────────────────────

let SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_SECRET_MIN_LENGTH = IS_PROD ? 64 : 32;
if (!SESSION_SECRET || SESSION_SECRET.length < SESSION_SECRET_MIN_LENGTH) {
  if (IS_PROD) {
    log.error(`SESSION_SECRET no definido o demasiado corto (mínimo ${SESSION_SECRET_MIN_LENGTH} caracteres). Abortando en producción.`);
    process.exit(1);
  }
  SESSION_SECRET = crypto.randomBytes(48).toString('hex');
  log.warn('SESSION_SECRET temporal generado — las sesiones NO sobrevivirán reinicios. Define SESSION_SECRET (≥32 chars).');
}

const PORT               = Number.parseInt(process.env.PORT || '3001', 10);
const HOST               = V.cleanString(process.env.HOST || '127.0.0.1', 255);
const DATA_DIR           = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const ROOT               = path.join(__dirname, '..');
const PUBLIC_DIR         = path.join(ROOT, 'public');
const DB_FILE            = path.join(DATA_DIR, 'historial.db');
const IMPORT_QUOTES_FILE = path.join(DATA_DIR, 'import_cotizaciones.json');
const MAX_HIST_LIMIT     = 10000; // tope duro de registros devueltos

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  log.error('PORT inválido. Debe ser un entero entre 0 y 65535.');
  process.exit(1);
}
if (IS_PROD && !['127.0.0.1', '::1', 'localhost'].includes(HOST)) {
  log.error('HOST de producción debe ser loopback (127.0.0.1, ::1 o localhost).');
  process.exit(1);
}

// ─── SECCIÓN: EXPRESS + MIDDLEWARE BASE ─────────────────────────────────────

const app = express();

// Confía en el primer proxy (Nginx) para IPs reales en rate-limiting.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'"],
      scriptSrcAttr:   ["'none'"],
      styleSrc:        ["'self'"],
      // Migración intermedia: JS/HTML ya no ejecutan scripts inline; algunos
      // estados visuales aún usan element.style y se restringen a atributos.
      styleSrcAttr:    ["'unsafe-inline'"],
      fontSrc:         ["'self'", "data:"],
      imgSrc:          ["'self'", "data:", "blob:"],
      connectSrc:      ["'self'", "wss:", "ws:"],
      workerSrc:       ["'self'"],
      objectSrc:       ["'none'"],
      baseUri:         ["'self'"],
      frameAncestors:  ["'none'"],
    },
  },
  frameguard: { action: 'deny' }, // X-Frame-Options: DENY (anti-clickjacking)
  crossOriginEmbedderPolicy: false,
}));

// Compresión gzip/deflate: reduce el payload JSON del historial ~70-80%.
// Va inmediatamente después de helmet y antes de servir estáticos.
app.use(compression({
  threshold: 512,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// ─── SECCIÓN: SQLITE ─────────────────────────────────────────────────────────

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous  = NORMAL');
db.pragma('cache_size   = -8000'); // 8 MB de cache
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp      INTEGER NOT NULL,
    fecha          TEXT    NOT NULL,
    binance        REAL    NOT NULL DEFAULT 0,
    binance_compra REAL    NOT NULL DEFAULT 0,
    bcv            REAL    NOT NULL DEFAULT 0,
    diff_bs        REAL    NOT NULL DEFAULT 0,
    diff_pct       REAL    NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_timestamp  ON tasas (timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_fecha      ON tasas (fecha);
  CREATE INDEX IF NOT EXISTS idx_ts_binance ON tasas (timestamp DESC, binance);

  CREATE TABLE IF NOT EXISTS import_quotes (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    quote      TEXT NOT NULL,
    user_id    TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_import_quotes_user ON import_quotes (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_import_quotes_user_updated ON import_quotes (user_id, updated_at DESC, id);

  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'viewer',
    created_at INTEGER NOT NULL,
    last_login INTEGER
  );

  -- Publicaciones oficiales del BCV: una fila por «Fecha Valor» (día en que
  -- la tasa rige). Fuente primaria para resolver la tasa vigente.
  CREATE TABLE IF NOT EXISTS bcv_publicaciones (
    fecha_valor  TEXT PRIMARY KEY,
    bcv          REAL    NOT NULL,
    publicada_el TEXT    NOT NULL,
    timestamp    INTEGER NOT NULL,
    fuente       TEXT    NOT NULL DEFAULT 'scraper'
  );
`);

// Migraciones aditivas (nunca borran datos existentes)
try { db.exec('ALTER TABLE users ADD COLUMN full_name TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN email    TEXT'); } catch (_) {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL"); } catch (_) {}

// ─── SECCIÓN: SESIONES ──────────────────────────────────────────────────────

const sessionStore = new SQLiteSessionStore({ client: db, expired: { clear: true, intervalMs: 900000 } });

const sessionMiddleware = session({
  store:  sessionStore,
  name:   'dayzo.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // renueva la expiración con cada request
  cookie: {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: 'strict',
    maxAge:   7 * 24 * 60 * 60 * 1000,
    path:     '/',
  },
});
app.use(sessionMiddleware);

const DUMMY_BCRYPT_HASH = bcrypt.hashSync('__dummy_timing__', 12);

function apiErrorBody(code, message, details) {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    // Adaptador temporal para clientes web/móviles que todavía leen `message`.
    message,
  };
}

function sendApiError(res, status, code, message, details) {
  return res.status(status).json(apiErrorBody(code, message, details));
}

// ─── SECCIÓN: RATE LIMITERS ─────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: apiErrorBody('RATE_LIMITED', 'Demasiados intentos. Intenta en 15 minutos.'),
});

const tasasLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: apiErrorBody('RATE_LIMITED', 'Demasiadas solicitudes. Intenta en un momento.'),
});

// Limita las mutaciones de cotizaciones (defensa en profundidad sobre requireAuth)
const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: apiErrorBody('RATE_LIMITED', 'Demasiadas operaciones. Espera un momento.'),
});

// ─── SECCIÓN: PROTECCIÓN FUERZA BRUTA (login) ───────────────────────────────
// Delay progresivo por IP tras el 3er intento fallido. En memoria, sin Redis.

const loginAttempts = new Map(); // ip -> { count, last }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getLoginAttempts(ip) {
  return loginAttempts.get(ip)?.count || 0;
}
function recordFailedLogin(ip) {
  const cur = loginAttempts.get(ip) || { count: 0, last: 0 };
  cur.count += 1;
  cur.last = Date.now();
  loginAttempts.set(ip, cur);
}
function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}
// Limpieza cada hora: descarta IPs sin actividad reciente.
const loginAttemptsCleanup = setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [ip, v] of loginAttempts) {
    if (v.last < cutoff) loginAttempts.delete(ip);
  }
}, 60 * 60 * 1000);
loginAttemptsCleanup.unref();

// ─── SECCIÓN: CSRF ──────────────────────────────────────────────────────────

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/api/auth/login' || req.path === '/api/auth/register') return next();

  const sessionToken = req.session?.csrfToken;
  const headerToken  = req.headers['x-csrf-token'];

  if (!sessionToken || !headerToken || sessionToken !== headerToken) {
    return sendApiError(res, 403, 'CSRF_INVALID', 'Token CSRF inválido');
  }
  next();
}

// ─── SECCIÓN: RUTAS ESTÁTICAS / REDIRECCIONES ───────────────────────────────

// Redirecciones legacy a rutas canónicas
app.get('/index.html', (_req, res) => res.redirect(301, '/calculadoraa'));
app.get('/login.html', (_req, res) => res.redirect(301, '/login'));

// Service worker y manifest: nunca cachear el SW para que se propaguen updates.
app.get('/service-worker.js', (req, res) => {
  const sw = path.join(PUBLIC_DIR, 'service-worker.js');
  if (!fs.existsSync(sw)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(sw);
});
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(PUBLIC_DIR, 'manifest.json'));
});

// Assets de navegador fijados por package-lock; no se expone node_modules completo.
app.get('/vendor/chart.js', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'));
});
app.use('/vendor/fontawesome', express.static(
  path.join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free'),
  { maxAge: '365d', immutable: true, etag: true }
));

// Estáticos con caché agresiva para CSS/imágenes y revalidación para HTML/JS de app.
app.use(express.static(PUBLIC_DIR, {
  maxAge: IS_PROD ? '7d' : 0,
  etag: true,
  lastModified: true,
  immutable: false,
  setHeaders(res, filePath) {
    const base = path.basename(filePath);
    if (filePath.endsWith('.html') || base === 'app.js' || base === 'service-worker.js') {
      // Lógica de la app: revalidar siempre para evitar JS/HTML obsoleto.
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// CSRF global (después de la sesión)
app.use(csrfProtect);

// ─── SECCIÓN: POLÍTICAS / MIDDLEWARE DE AUTH ────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session?.userId) return sendApiError(res, 401, 'AUTH_REQUIRED', 'No autenticado');
  const user = db.prepare('SELECT id, username, full_name, email, role FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return sendApiError(res, 401, 'SESSION_INVALID', 'Sesión inválida');
  }
  req.session.role = user.role;
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return sendApiError(res, 403, 'FORBIDDEN', 'Sin permisos');
}

// ─── SECCIÓN: MIGRACIONES DE ARRANQUE ───────────────────────────────────────

function migrateImportQuotesFromJSON() {
  if (!fs.existsSync(IMPORT_QUOTES_FILE)) return;
  let records;
  try {
    records = JSON.parse(fs.readFileSync(IMPORT_QUOTES_FILE, 'utf8'));
    if (!Array.isArray(records)) return;
  } catch (e) {
    log.error('Migración: error leyendo import_cotizaciones.json:', e.message);
    return;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO import_quotes (id, name, quote, user_id, created_at, updated_at)
    VALUES (@id, @name, @quote, @user_id, @created_at, @updated_at)
  `);

  let migrated = 0;
  const tx = db.transaction((rows) => {
    for (const q of rows) {
      if (!q?.id || !q?.name) continue;
      const createdAt = q.createdAt
        ? (typeof q.createdAt === 'string' ? Date.parse(q.createdAt) : Number(q.createdAt))
        : Date.now();
      const ts = Number.isFinite(createdAt) ? createdAt : Date.now();
      const result = insert.run({
        id: String(q.id),
        name: String(q.name),
        quote: JSON.stringify(q.quote || {}),
        user_id: null,
        created_at: ts,
        updated_at: ts,
      });
      if (result.changes > 0) migrated++;
    }
  });
  tx(records);

  const migratedPath = `${IMPORT_QUOTES_FILE}.migrated`;
  fs.renameSync(IMPORT_QUOTES_FILE, migratedPath);
  log.info(`Migración: ${migrated} cotizaciones JSON → SQLite (${path.basename(migratedPath)})`);
}

function assignOrphanImportQuotesToAdmin() {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) return;
  const result = db.prepare('UPDATE import_quotes SET user_id = ? WHERE user_id IS NULL').run(admin.id);
  if (result.changes > 0) log.info(`Migración: ${result.changes} cotizaciones sin dueño asignadas al admin`);
}

function ensureImportQuotesForeignKey() {
  const foreignKeys = db.pragma('foreign_key_list(import_quotes)');
  if (foreignKeys.some((fk) => fk.table === 'users' && fk.from === 'user_id')) return;

  const migrate = db.transaction(() => {
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (admin) {
      db.prepare(`
        UPDATE import_quotes
        SET user_id = ?
        WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM users)
      `).run(admin.id);
    } else {
      db.prepare(`
        UPDATE import_quotes
        SET user_id = NULL
        WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)
      `).run();
    }

    db.exec(`
      CREATE TABLE import_quotes_fk (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        quote      TEXT NOT NULL,
        user_id    TEXT REFERENCES users(id) ON DELETE RESTRICT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO import_quotes_fk (id, name, quote, user_id, created_at, updated_at)
      SELECT id, name, quote, user_id, created_at, updated_at FROM import_quotes;
      DROP TABLE import_quotes;
      ALTER TABLE import_quotes_fk RENAME TO import_quotes;
      CREATE INDEX idx_import_quotes_user ON import_quotes (user_id, created_at DESC);
      CREATE INDEX idx_import_quotes_user_updated ON import_quotes (user_id, updated_at DESC, id);
    `);
  });

  migrate();
  log.info('Migración: import_quotes.user_id protegido con FK ON DELETE RESTRICT.');
}

async function bootstrapAdminUser() {
  const existing = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('admin');
  const requested = process.env.ADMIN_BOOTSTRAP === '1';
  const username = V.cleanString(process.env.ADMIN_USERNAME, 64);
  const password = process.env.ADMIN_PASSWORD == null ? '' : String(process.env.ADMIN_PASSWORD);

  try {
    if (existing) {
      if (requested) {
        throw new Error('ADMIN_BOOTSTRAP fue solicitado, pero ya existe un administrador. Usa la CLI admin:reset.');
      }
      if (password) {
        log.warn('ADMIN_PASSWORD fue ignorado: nunca se actualizan credenciales durante el arranque.');
      }
      return;
    }

    if (!requested) {
      if (IS_PROD) {
        throw new Error('No existe un administrador. Ejecuta un bootstrap explícito antes de iniciar producción.');
      }
      log.warn('No existe un administrador. El modo desarrollo continúa sin crear credenciales implícitas.');
      return;
    }

    const usernameError = V.validateUsername(username);
    if (usernameError) throw new Error(`ADMIN_USERNAME inválido: ${usernameError}`);
    const passwordError = V.validatePassword(password);
    if (passwordError || password.length < 12) {
      throw new Error(`ADMIN_PASSWORD inválido: ${passwordError || 'debe tener al menos 12 caracteres.'}`);
    }

    const hash = await bcrypt.hash(password, 12);
    db.prepare('INSERT INTO users (id, username, password, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), username, hash, 'admin', Date.now());
    log.info(`Bootstrap de administrador completado para "${username}". Retira las variables ADMIN_* antes del siguiente arranque.`);
  } finally {
    // Evita conservar secretos en el entorno del proceso una vez utilizados.
    delete process.env.ADMIN_PASSWORD;
  }
}

migrateImportQuotesFromJSON();
assignOrphanImportQuotesToAdmin();
ensureImportQuotesForeignKey();

// ─── SECCIÓN: SENTENCIAS PREPARADAS ─────────────────────────────────────────
// Se compilan una sola vez al arrancar (no en cada request).

const stmtInsert = db.prepare(`
  INSERT INTO tasas (timestamp, fecha, binance, binance_compra, bcv, diff_bs, diff_pct)
  VALUES (@timestamp, @fecha, @binance, @binance_compra, @bcv, @diff_bs, @diff_pct)
`);
const stmtLast  = db.prepare('SELECT * FROM tasas ORDER BY timestamp DESC LIMIT 1');
const stmtCount = db.prepare('SELECT COUNT(*) AS c FROM tasas');
const stmtRango = db.prepare('SELECT MIN(timestamp) AS s, MAX(timestamp) AS e FROM tasas');

const stmtHist24h     = db.prepare('SELECT * FROM tasas WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?');
const stmtHistByFecha = db.prepare('SELECT * FROM tasas WHERE fecha LIKE ? ORDER BY timestamp DESC LIMIT ?');
const stmtHistDefault = db.prepare('SELECT * FROM tasas ORDER BY timestamp DESC LIMIT ?');
// 7D: un punto por hora (~168 puntos para 7 días)
const stmtHistHourlySince = db.prepare(`
  SELECT
    MAX(fecha) AS fecha, MAX(timestamp) AS timestamp,
    AVG(binance) AS binance, AVG(binance_compra) AS binance_compra,
    AVG(bcv) AS bcv, AVG(diff_bs) AS diff_bs, AVG(diff_pct) AS diff_pct,
    CAST(timestamp/1000/3600 AS INTEGER) AS hora_bucket
  FROM tasas WHERE timestamp >= ?
  GROUP BY hora_bucket ORDER BY timestamp DESC LIMIT ?
`);
// MES: un punto cada 4 horas (~180 puntos para 30 días)
const stmtHistEvery4hSince = db.prepare(`
  SELECT
    MAX(fecha) AS fecha, MAX(timestamp) AS timestamp,
    AVG(binance) AS binance, AVG(binance_compra) AS binance_compra,
    AVG(bcv) AS bcv, AVG(diff_bs) AS diff_bs, AVG(diff_pct) AS diff_pct,
    CAST(timestamp/1000/(4*3600) AS INTEGER) AS bucket4h
  FROM tasas WHERE timestamp >= ?
  GROUP BY bucket4h ORDER BY timestamp DESC LIMIT ?
`);
// TODO: un punto por día
const stmtHistGroupedAll = db.prepare(`
  SELECT
    MAX(fecha) AS fecha, MAX(timestamp) AS timestamp,
    AVG(binance) AS binance, AVG(binance_compra) AS binance_compra,
    AVG(bcv) AS bcv, AVG(diff_bs) AS diff_bs, AVG(diff_pct) AS diff_pct,
    DATE(timestamp/1000 - 4*3600, 'unixepoch') AS dia
  FROM tasas GROUP BY dia ORDER BY timestamp DESC LIMIT ?
`);

const stmtStatsBase    = db.prepare('SELECT COUNT(*) AS count, MIN(binance) AS min, MAX(binance) AS max, AVG(binance) AS avg FROM tasas');
const stmtStatsSince   = db.prepare('SELECT COUNT(*) AS count, MIN(binance) AS min, MAX(binance) AS max, AVG(binance) AS avg, AVG(diff_pct) AS avgSpread FROM tasas WHERE timestamp >= ?');
// Stats por hora (7D) — avg agrupa por hora (igual que el gráfico), min/max son valores reales
const stmtStatsHourlySince = db.prepare(`
  SELECT
    COUNT(*) AS count,
    MIN(binance) AS min,
    MAX(binance) AS max,
    (SELECT AVG(avg_b) FROM (
      SELECT AVG(binance) AS avg_b
      FROM tasas WHERE timestamp >= ?
      GROUP BY CAST(timestamp/1000/3600 AS INTEGER)
    )) AS avg
  FROM tasas WHERE timestamp >= ?
`);
// Stats cada 4 horas (MES) — avg agrupa por 4h (igual que el gráfico), min/max son valores reales
const stmtStatsEvery4hSince = db.prepare(`
  SELECT
    COUNT(*) AS count,
    MIN(binance) AS min,
    MAX(binance) AS max,
    (SELECT AVG(avg_b) FROM (
      SELECT AVG(binance) AS avg_b
      FROM tasas WHERE timestamp >= ?
      GROUP BY CAST(timestamp/1000/(4*3600) AS INTEGER)
    )) AS avg
  FROM tasas WHERE timestamp >= ?
`);
// Stats diarios (TODO) — avg de promedios diarios (igual que el gráfico), min/max son valores reales
const stmtStatsGroupedAll = db.prepare(`
  SELECT
    COUNT(*) AS count,
    MIN(binance) AS min,
    MAX(binance) AS max,
    (SELECT AVG(avg_b) FROM (
      SELECT AVG(binance) AS avg_b
      FROM tasas
      GROUP BY DATE(timestamp/1000 - 4*3600, 'unixepoch')
    )) AS avg
  FROM tasas
`);
const stmtBaselineSince = db.prepare('SELECT binance, bcv FROM tasas WHERE timestamp >= ? ORDER BY timestamp ASC LIMIT 1');
const stmtBcvPubDay     = db.prepare(`
  SELECT bcv, timestamp, fecha FROM tasas
  WHERE timestamp >= ? AND timestamp <= ? AND bcv > 0
  ORDER BY timestamp DESC LIMIT 1
`);

// Publicaciones BCV (fecha valor real)
const stmtPubHasta   = db.prepare('SELECT * FROM bcv_publicaciones WHERE fecha_valor <= ? ORDER BY fecha_valor DESC LIMIT 1');
const stmtPubDespues = db.prepare('SELECT * FROM bcv_publicaciones WHERE fecha_valor > ? ORDER BY fecha_valor ASC LIMIT 1');
const stmtPubGet     = db.prepare('SELECT * FROM bcv_publicaciones WHERE fecha_valor = ?');
const stmtPubInsert  = db.prepare(`
  INSERT OR IGNORE INTO bcv_publicaciones (fecha_valor, bcv, publicada_el, timestamp, fuente)
  VALUES (@fecha_valor, @bcv, @publicada_el, @timestamp, @fuente)
`);
const stmtPubUpdate  = db.prepare('UPDATE bcv_publicaciones SET bcv = @bcv, timestamp = @timestamp, fuente = @fuente WHERE fecha_valor = @fecha_valor');
const stmtPubMaxTs   = db.prepare('SELECT MAX(timestamp) AS t FROM bcv_publicaciones');

// Snapshot del historial en (o antes de) un instante dado
const stmtHistAt = db.prepare('SELECT * FROM tasas WHERE timestamp <= ? ORDER BY timestamp DESC LIMIT 1');
// Cambios de valor BCV en el historial (para inferir publicaciones pasadas)
const stmtBcvCambios = db.prepare(`
  SELECT timestamp, bcv, pb FROM (
    SELECT timestamp, bcv, LAG(bcv) OVER (ORDER BY timestamp) AS pb
    FROM tasas WHERE bcv > 0 AND timestamp >= ?
  ) WHERE pb IS NULL OR ABS(bcv - pb) >= 0.005
  ORDER BY timestamp ASC
`);
const stmtBcvUltimoAntes = db.prepare('SELECT bcv FROM tasas WHERE bcv > 0 AND timestamp < ? ORDER BY timestamp DESC LIMIT 1');

const stmtImportQuoteForUser = db.prepare('SELECT * FROM import_quotes WHERE id = ? AND user_id = ?');
const stmtImportQuoteInsert  = db.prepare(`
  INSERT INTO import_quotes (id, name, quote, user_id, created_at, updated_at)
  VALUES (@id, @name, @quote, @user_id, @created_at, @updated_at)
`);
const stmtImportQuoteUpdate = db.prepare(`
  UPDATE import_quotes SET name = @name, quote = @quote, updated_at = @updated_at
  WHERE id = @id AND user_id = @user_id
`);
const stmtImportQuoteDelete      = db.prepare('DELETE FROM import_quotes WHERE id = ? AND user_id = ?');
const stmtImportQuoteCountByUser = db.prepare('SELECT COUNT(*) AS c FROM import_quotes WHERE user_id = ?');
const stmtImportQuoteCount       = db.prepare('SELECT COUNT(*) AS c FROM import_quotes');

const IMPORT_QUOTE_COMPANY_SQL = `
  COALESCE(
    NULLIF(json_extract(quote, '$.empresaNombre'), ''),
    CASE CAST(COALESCE(
      json_extract(quote, '$.empresaTarifaUSD'),
      json_extract(quote, '$.empresaEnvioUSD')
    ) AS REAL)
      WHEN 770 THEN 'GCCARGO'
      WHEN 865 THEN 'Orinoco'
      WHEN 1030 THEN 'import2ven'
      ELSE 'Personalizado'
    END
  )
`;
const stmtImportQuoteCompanies = db.prepare(`
  SELECT ${IMPORT_QUOTE_COMPANY_SQL} AS company, COUNT(*) AS count
  FROM import_quotes
  WHERE user_id = ?
  GROUP BY company
  ORDER BY company COLLATE NOCASE ASC
`);

// ─── SECCIÓN: BCV VIGENTE (facturación) ─────────────────────────────────────
// Reglas (BCV + Art. 25 Ley IVA):
//  · El BCV publica cada día hábil, en la tarde, la tasa con «Fecha Valor»
//    del siguiente día hábil. Entra en vigencia a la MEDIANOCHE (00:00 VET).
//  · Fines de semana y feriados usan la tasa del día hábil siguiente (la
//    última publicada: la del viernes rige sábado, domingo y todo el lunes).

const FERIADOS_VE = BcvVigencia.loadFeriados(DATA_DIR);

function getBcvByPublicationDay(ymd) {
  const tardeInicio = new Date(`${ymd}T15:00:00-04:00`).getTime();
  const tardeFin    = new Date(`${ymd}T23:59:59.999-04:00`).getTime();
  const tarde       = stmtBcvPubDay.get(tardeInicio, tardeFin);
  if (tarde?.bcv > 0) return tarde;

  const diaInicio = new Date(`${ymd}T00:00:00-04:00`).getTime();
  const diaFin    = new Date(`${ymd}T23:59:59.999-04:00`).getTime();
  return stmtBcvPubDay.get(diaInicio, diaFin);
}

/** Registra una publicación oficial. Devuelve 'insert' | 'update' | null. */
function upsertPublicacionBcv({ fechaValor, bcv, ts, fuente = 'scraper' }) {
  const existing = stmtPubGet.get(fechaValor);
  if (!existing) {
    stmtPubInsert.run({
      fecha_valor: fechaValor, bcv,
      publicada_el: BcvVigencia.fechaCaracas(new Date(ts)),
      timestamp: ts, fuente,
    });
    return 'insert';
  }
  // Solo el scraper (que lee la fecha valor real) puede revisar un valor
  if (fuente === 'scraper' && Math.abs(existing.bcv - bcv) >= 0.005) {
    stmtPubUpdate.run({ fecha_valor: fechaValor, bcv, timestamp: ts, fuente });
    log.warn(`BCV publicación revisada (fv ${fechaValor}): ${existing.bcv} → ${bcv}`);
    return 'update';
  }
  return null;
}

/**
 * Infiere publicaciones pasadas a partir de los cambios de valor en el
 * historial de capturas. Idempotente (INSERT OR IGNORE): nunca pisa filas
 * del scraper y puede correr en cada arranque para cubrir huecos.
 */
function backfillPublicacionesBcv() {
  try {
    const maxTs = stmtPubMaxTs.get()?.t || 0;
    // Con la tabla ya poblada solo se reprocesa una ventana con solape.
    const desde = maxTs > 0 ? maxTs - 14 * 24 * 3600 * 1000 : 0;
    const previo = desde > 0 ? (stmtBcvUltimoAntes.get(desde)?.bcv ?? null) : null;

    const eventos = stmtBcvCambios.all(desde);
    let inserts = 0;
    for (const ev of eventos) {
      const esSeed = ev.pb == null && previo == null;
      // Si hay valor previo a la ventana, el primer "evento" (pb NULL) solo
      // cuenta como cambio real si difiere de ese valor previo.
      if (ev.pb == null && previo != null && Math.abs(ev.bcv - previo) < 0.005) continue;

      const d      = new Date(ev.timestamp);
      const pubDay = BcvVigencia.fechaCaracas(d);
      let fv;
      if (esSeed) {
        fv = pubDay; // la primera tasa conocida ya estaba vigente ese día
      } else if (BcvVigencia.esDiaNoHabil(pubDay, FERIADOS_VE) || BcvVigencia.horaCaracas(d) >= 14) {
        // Publicación vespertina → rige el siguiente día hábil desde las 00:00
        fv = BcvVigencia.siguienteDiaHabil(pubDay, FERIADOS_VE);
      } else {
        // Captura matutina (p. ej. tras caída del servidor): ya rige ese día
        fv = pubDay;
      }
      if (upsertPublicacionBcv({ fechaValor: fv, bcv: ev.bcv, ts: ev.timestamp, fuente: 'backfill' }) === 'insert') {
        inserts++;
      }
    }
    if (inserts > 0) log.info(`BCV backfill: ${inserts} publicaciones inferidas del historial`);
  } catch (e) {
    log.error('backfillPublicacionesBcv:', e.message);
  }
}

function makeBcvResolveOpts(extra) {
  return {
    feriados: FERIADOS_VE,
    getPublicacionHasta:   (ymd) => stmtPubHasta.get(ymd),
    getPublicacionDespues: (ymd) => stmtPubDespues.get(ymd),
    getBcvByPublicationDay,
    ...extra,
  };
}

function resolveAndCacheBcv(fecha = new Date()) {
  const publicada = CACHE_TASAS.bcv_publicada || 0;
  const resolved  = BcvVigencia.resolveBcvVigente(
    makeBcvResolveOpts({ bcvPublicada: publicada, fecha })
  );
  CACHE_TASAS.bcv      = resolved.bcv_vigente;
  CACHE_TASAS.bcv_meta = resolved.bcv_meta;
  return resolved;
}

/** Tasa BCV vigente para una fecha (YYYY-MM-DD) arbitraria, sin tocar cache. */
function resolveBcvVigenteFecha(ymd) {
  return BcvVigencia.resolveBcvVigente(
    makeBcvResolveOpts({ bcvPublicada: 0, fecha: new Date(`${ymd}T12:00:00-04:00`) })
  );
}

/**
 * Rollover de medianoche: si cambió el día en Caracas desde la última
 * resolución, la tasa que entró en vigencia a las 00:00 pasa a mostrarse ya.
 */
function checkRolloverVigenciaBcv() {
  const hoyCaracas = BcvVigencia.fechaCaracas(new Date());
  if (!CACHE_TASAS.bcv_meta || CACHE_TASAS.bcv_meta.vigente_para === hoyCaracas) return false;
  const antes = CACHE_TASAS.bcv;
  resolveAndCacheBcv();
  if (Math.abs((CACHE_TASAS.bcv || 0) - (antes || 0)) >= 0.005) {
    log.info(`BCV vigente rotó a medianoche: ${antes} → ${CACHE_TASAS.bcv} (${hoyCaracas})`);
  }
  broadcastTasas();
  return true;
}

// ─── SECCIÓN: PERSISTENCIA DE HISTORIAL ─────────────────────────────────────

function guardarHistorialSiCambio(cache) {
  const { binance, binance_compra, bcv } = cache;
  if (!binance || !bcv) return;

  const now   = new Date();
  const fecha = now.toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const diff_bs  = binance - bcv;
  const diff_pct = bcv > 0 ? (diff_bs / bcv) * 100 : 0;

  const ultimo = stmtLast.get();
  if (ultimo) {
    const same =
      Math.abs((ultimo.binance        || 0) - binance)        < 0.01 &&
      Math.abs((ultimo.binance_compra || 0) - binance_compra) < 0.01 &&
      Math.abs((ultimo.bcv            || 0) - bcv)            < 0.01;
    if (same && now.getTime() - (ultimo.timestamp || 0) < 60 * 60 * 1000) return;
  }

  stmtInsert.run({ timestamp: now.getTime(), fecha, binance, binance_compra, bcv, diff_bs, diff_pct });
}

// ─── SECCIÓN: CONSULTAS DE HISTORIAL ────────────────────────────────────────

function queryHistorial({ range, fecha, limit }) {
  const lim = Math.min(limit > 0 ? limit : 5000, MAX_HIST_LIMIT);

  if (fecha) {
    return stmtHistByFecha.all(`%${fecha}%`, MAX_HIST_LIMIT);
  }

  const now = Date.now();

  if (range === '24h') {
    return stmtHist24h.all(now - 24 * 60 * 60 * 1000, lim);
  }
  if (range === '7d') {
    // Hourly: ~168 puntos para 7 días
    return stmtHistHourlySince.all(now - 7 * 24 * 60 * 60 * 1000, MAX_HIST_LIMIT);
  }
  if (range === 'month') {
    // Cada 4h: ~180 puntos para 30 días
    return stmtHistEvery4hSince.all(now - 30 * 24 * 60 * 60 * 1000, MAX_HIST_LIMIT);
  }
  if (range === 'all') {
    // Diario
    return stmtHistGroupedAll.all(MAX_HIST_LIMIT);
  }

  return stmtHistDefault.all(lim);
}

function computeChartStats(range) {
  const now = Date.now();
  let row;
  if (range === '24h') {
    row = stmtStatsSince.get(now - 24 * 60 * 60 * 1000);
  } else if (range === '7d') {
    const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;
    row = stmtStatsHourlySince.get(cutoff7d, cutoff7d);
  } else if (range === 'month') {
    const cutoff30d = now - 30 * 24 * 60 * 60 * 1000;
    row = stmtStatsEvery4hSince.get(cutoff30d, cutoff30d);
  } else {
    // Stats sobre promedios diarios
    row = stmtStatsGroupedAll.get();
  }
  if (!row || row.count === 0) return null;
  return { count: row.count, min: row.min, max: row.max, avg: row.avg, range };
}

/** Estadísticas agregadas de 24h en una sola pasada (para tarjetas y login). */
function computeStats24h() {
  const now    = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const agg      = stmtStatsSince.get(cutoff);
  const baseline = stmtBaselineSince.get(cutoff);

  const curBin = CACHE_TASAS.binance || 0;
  const curBcv = CACHE_TASAS.bcv     || 0;
  const baseBin = baseline?.binance || curBin;
  const baseBcv = baseline?.bcv     || curBcv;

  const change24h      = curBin - baseBin;
  const changePct24h   = baseBin > 0 ? (change24h / baseBin) * 100 : 0;
  const bcvChange24h   = curBcv - baseBcv;
  const bcvChangePct   = baseBcv > 0 ? (bcvChange24h / baseBcv) * 100 : 0;
  const spreadCurrent  = curBcv > 0 ? ((curBin - curBcv) / curBcv) * 100 : 0;

  const lastT = CACHE_TASAS.lastUpdateTasas || CACHE_TASAS.lastUpdateBinance || CACHE_TASAS.lastUpdateBCV;
  const lastUpdate = lastT
    ? new Date(lastT).toLocaleString('es-VE', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
    : '';

  return {
    binance: {
      min: agg?.min ?? curBin, max: agg?.max ?? curBin, avg: agg?.avg ?? curBin,
      current: curBin, change24h, changePct24h,
    },
    bcv: {
      current: curBcv, change24h: bcvChange24h, changePct24h: bcvChangePct,
      lastUpdate: CACHE_TASAS.lastUpdateBCV
        ? new Date(CACHE_TASAS.lastUpdateBCV).toLocaleString('es-VE', { timeZone: 'America/Caracas' })
        : '',
    },
    spread: { current: spreadCurrent, avg24h: agg?.avgSpread ?? spreadCurrent },
    lastUpdate,
  };
}

// ─── SECCIÓN: CACHE EN MEMORIA (valores actuales) ───────────────────────────

let CACHE_TASAS = {
  binance: 0, binance_compra: 0, bcv: 0, bcv_publicada: 0, cny: 0,
  bcv_meta: null,
  lastUpdateBinance: null, lastUpdateBCV: null, lastUpdateTasas: null,
};
const RATE_SOURCE_STATE = {
  binance: { lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0 },
  bcv: { lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0 },
};
let binanceInFlight = false;
let bcvInFlight = false;
let ratesStopping = false;

const ultimoRegistro = stmtLast.get();
if (ultimoRegistro) {
  CACHE_TASAS.binance        = ultimoRegistro.binance        || 0;
  CACHE_TASAS.binance_compra = ultimoRegistro.binance_compra || 0;
  CACHE_TASAS.bcv_publicada  = ultimoRegistro.bcv            || 0;
  const cachedAt = new Date(ultimoRegistro.timestamp).toISOString();
  if (CACHE_TASAS.binance > 0) RATE_SOURCE_STATE.binance.lastSuccessAt = cachedAt;
  if (CACHE_TASAS.bcv_publicada > 0) RATE_SOURCE_STATE.bcv.lastSuccessAt = cachedAt;
}
backfillPublicacionesBcv();
resolveAndCacheBcv();

function getRateSourceStatus() {
  return {
    binance: RateSources.sourceStatus({
      ...RATE_SOURCE_STATE.binance,
      failures: RATE_SOURCE_STATE.binance.consecutiveFailures,
      staleAfterMs: 2 * 60 * 1000,
    }),
    bcv: RateSources.sourceStatus({
      ...RATE_SOURCE_STATE.bcv,
      failures: RATE_SOURCE_STATE.bcv.consecutiveFailures,
      staleAfterMs: 24 * 60 * 60 * 1000,
    }),
  };
}

// ─── SECCIÓN: HELPERS DE COTIZACIONES ───────────────────────────────────────

function inferEmpresaNombre(quote) {
  if (!quote || typeof quote !== 'object') return null;
  if (quote.empresaNombre) return quote.empresaNombre;
  const tarifa = Number(quote.empresaTarifaUSD ?? quote.empresaEnvioUSD);
  if (!Number.isFinite(tarifa)) return 'Sin empresa';
  if (tarifa === 770)  return 'GCCARGO';
  if (tarifa === 865)  return 'Orinoco';
  if (tarifa === 1030) return 'import2ven';
  return 'Personalizado';
}

function parseImportQuoteRow(row) {
  if (!row) return null;
  let quote = {};
  try { quote = JSON.parse(row.quote || '{}'); } catch (_) { quote = {}; }
  return { row, quote };
}

function mapImportQuoteListItem(row) {
  const { quote } = parseImportQuoteRow(row);
  const empresaNombre = inferEmpresaNombre(quote);
  const tarifaRaw     = quote.empresaTarifaUSD ?? quote.empresaEnvioUSD ?? null;
  const tarifaUSD     = Number.isFinite(Number(tarifaRaw)) ? Number(tarifaRaw) : null;
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    empresaNombre,
    empresaTarifaUSD:  tarifaUSD,
    inversionTotalUSD: quote.inversionTotalUSD ?? null,
    costoUnitarioUSD:  quote.costoUnitarioUSD  ?? null,
    costoPorCajaUSD:   quote.costoPorCajaUSD   ?? null,
    volumenM3:         quote.volumenM3          ?? null,
    pesoKg:            quote.pesoKg             ?? null,
    // Plan de venta (para badge de ganancia en la lista)
    ventaUnitarioUSD:  quote.ventaUnitarioUSD  ?? null,
    gananciaTotalUSD:  quote.gananciaTotalUSD  ?? null,
    margenVentaPct:    quote.margenVentaPct    ?? null,
    hasSalePlan: Number(quote.ventaUnitarioUSD) > 0,
    calculationVersion: quote.calculationVersion || 'legacy',
  };
}

function mapImportQuoteDetail(row) {
  const { quote } = parseImportQuoteRow(row);
  const empresaNombre = inferEmpresaNombre(quote);
  const tarifaRaw     = quote.empresaTarifaUSD ?? quote.empresaEnvioUSD ?? null;
  const tarifaUSD     = Number.isFinite(Number(tarifaRaw)) ? Number(tarifaRaw) : null;
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    quote: {
      ...quote,
      empresaNombre: quote.empresaNombre ?? empresaNombre,
      empresaTarifaUSD: quote.empresaTarifaUSD ?? tarifaUSD,
    },
  };
}

/** Normaliza una cotización de entrada: sanitiza, infiere empresa y tarifa. */
function prepareIncomingQuote(rawQuote) {
  const result = V.sanitizeImportQuote(rawQuote);
  if (!result.ok) return result;
  const canonical = ImportCalculation.canonicalizeImportQuote(result.value);
  if (!canonical.ok) {
    return {
      ok: false,
      error: canonical.error.message,
      code: canonical.error.code,
    };
  }
  const quote = canonical.value;
  if (!quote.empresaNombre) quote.empresaNombre = inferEmpresaNombre(quote);
  const liveCny = Number(CACHE_TASAS.cny);
  quote.rateSnapshot = {
    cny: liveCny > 0 ? liveCny : 6.53,
    cnySource: liveCny > 0 ? 'bcv' : 'fallback',
    capturedAt: new Date().toISOString(),
  };
  return { ok: true, value: quote };
}

const IMPORT_QUOTE_SORT_SQL = Object.freeze({
  recent: 'created_at DESC, id DESC',
  investment: "CAST(COALESCE(json_extract(quote, '$.inversionTotalUSD'), 0) AS REAL) DESC, created_at DESC, id DESC",
  name: 'name COLLATE NOCASE ASC, created_at DESC, id DESC',
  company: `${IMPORT_QUOTE_COMPANY_SQL} COLLATE NOCASE ASC, created_at DESC, id DESC`,
  profit: "CAST(COALESCE(json_extract(quote, '$.gananciaTotalUSD'), 0) AS REAL) DESC, created_at DESC, id DESC",
});
const importQuoteListStatementCache = new Map();

function parseImportQuoteListQuery(query) {
  const rawLimit = query.limit == null ? '20' : String(query.limit);
  const rawOffset = query.offset == null ? '0' : String(query.offset);
  if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset)) {
    return { ok: false, code: 'INVALID_PAGINATION', message: 'limit y offset deben ser enteros no negativos.' };
  }
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
  if (limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset > 1_000_000) {
    return { ok: false, code: 'INVALID_PAGINATION', message: 'limit debe estar entre 1 y 50; offset no puede superar 1000000.' };
  }

  const sortAlias = { inversion: 'investment', nombre: 'name', empresa: 'company', ganancia: 'profit' };
  const requestedSort = V.cleanString(query.sort || 'recent', 32).toLowerCase();
  const sort = sortAlias[requestedSort] || requestedSort;
  if (!IMPORT_QUOTE_SORT_SQL[sort]) {
    return { ok: false, code: 'INVALID_SORT', message: 'Orden de cotizaciones inválido.' };
  }

  const plan = V.cleanString(query.plan || 'all', 16).toLowerCase();
  if (!['all', 'with', 'without'].includes(plan)) {
    return { ok: false, code: 'INVALID_FILTER', message: 'Filtro de plan inválido.' };
  }
  const legacy = query.legacy === '1';
  if (legacy && limit > 20) {
    return { ok: false, code: 'LEGACY_LIMIT_EXCEEDED', message: 'El adaptador legacy admite un máximo de 20 cotizaciones.' };
  }

  return {
    ok: true,
    value: {
      limit,
      offset,
      sort,
      plan,
      search: V.cleanString(query.search, 120),
      company: V.cleanString(query.company, 120),
      legacy,
    },
  };
}

function getImportQuoteListStatements(sort) {
  if (importQuoteListStatementCache.has(sort)) return importQuoteListStatementCache.get(sort);
  const where = `
    user_id = @userId
    AND (@search = '' OR instr(lower(name), lower(@search)) > 0)
    AND (@company = '' OR ${IMPORT_QUOTE_COMPANY_SQL} = @company)
    AND (
      @plan = 'all'
      OR (@plan = 'with' AND CAST(COALESCE(json_extract(quote, '$.ventaUnitarioUSD'), 0) AS REAL) > 0)
      OR (@plan = 'without' AND CAST(COALESCE(json_extract(quote, '$.ventaUnitarioUSD'), 0) AS REAL) <= 0)
    )
  `;
  const statements = {
    list: db.prepare(`
      SELECT id, name, quote, created_at, updated_at
      FROM import_quotes
      WHERE ${where}
      ORDER BY ${IMPORT_QUOTE_SORT_SQL[sort]}
      LIMIT @limit OFFSET @offset
    `),
    count: db.prepare(`SELECT COUNT(*) AS c FROM import_quotes WHERE ${where}`),
  };
  importQuoteListStatementCache.set(sort, statements);
  return statements;
}

function listImportQuotesForUser(userId, options) {
  const statements = getImportQuoteListStatements(options.sort);
  const filters = {
    userId,
    search: options.search,
    company: options.company,
    plan: options.plan,
  };
  const total = statements.count.get(filters).c;
  const rows = statements.list.all({
    ...filters,
    limit: options.limit,
    offset: options.offset,
  });
  const quotes = rows.map((row) => {
    const summary = mapImportQuoteListItem(row);
    if (!options.legacy) return summary;
    return { ...summary, quote: mapImportQuoteDetail(row).quote };
  });
  return {
    quotes,
    total,
    pagination: {
      limit: options.limit,
      offset: options.offset,
      total,
      hasMore: options.offset + quotes.length < total,
      nextOffset: options.offset + quotes.length < total
        ? options.offset + quotes.length
        : null,
    },
    facets: {
      companies: stmtImportQuoteCompanies.all(userId).map((row) => ({
        name: row.company,
        count: row.count,
      })),
    },
    ...(options.legacy ? { deprecation: 'legacy=1 se retirará después de migrar los clientes a resumen/detalle.' } : {}),
  };
}

// ─── SECCIÓN: SCRAPING / FUENTES EXTERNAS (sin cambios de lógica) ───────────

async function withRetry(fn, { attempts = 3, baseDelay = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(baseDelay * Math.pow(2, i));
    }
  }
  throw lastErr;
}

async function getBCVData() {
  const requestConfig = {
    timeout: 20000,
    maxContentLength: 2 * 1024 * 1024,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DAYZO-Rates/1.0)',
      'Accept-Language': 'es-VE,es;q=0.9',
    },
  };
  let response;
  try {
    // TLS estricto es siempre el primer intento.
    response = await axios.get('https://www.bcv.org.ve/', requestConfig);
  } catch (strictError) {
    if (process.env.BCV_TLS_FALLBACK !== '1') throw strictError;
    log.warn(`BCV_TLS_FALLBACK activo tras fallo TLS (${strictError.code || strictError.name}).`);
    response = await axios.get('https://www.bcv.org.ve/', {
      ...requestConfig,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  }

  const parsed = RateSources.parseBcvHtml(response.data);
  if (!parsed.ok) {
    const extractionError = new Error(parsed.error.message);
    extractionError.code = parsed.error.code;
    throw extractionError;
  }
  const usd = RateSources.validateRate(parsed.value.usd, {
    min: 10,
    max: 100_000,
    previous: CACHE_TASAS.bcv_publicada,
    maxChangeRatio: 0.5,
  });
  if (!usd.ok) {
    const validationError = new Error(`Tasa USD BCV rechazada: ${usd.code}`);
    validationError.code = usd.code;
    throw validationError;
  }

  let cnyPerUsd = null;
  if (parsed.value.cny > 0) {
    const derived = usd.value / parsed.value.cny;
    const cny = RateSources.validateRate(derived, {
      min: 1,
      max: 20,
      previous: CACHE_TASAS.cny,
      maxChangeRatio: 0.5,
    });
    if (cny.ok) cnyPerUsd = cny.value;
    else log.warn(`BCV CNY/USD rechazado: ${cny.code}`);
  }

  return {
    usd: usd.value,
    cny: cnyPerUsd,
    fechaValor: parsed.value.fechaValor,
  };
}

async function getBinanceRate(tradeType) {
  const tasaRef     = CACHE_TASAS.binance > 0 ? CACHE_TASAS.binance : 60;
  const transAmount = Math.floor(tasaRef * 100);
  const { data } = await axios.post(
    'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
    { fiat: 'VES', page: 1, rows: 5, tradeType, asset: 'USDT', countries: [],
      proMerchantAds: false, shieldMerchantAds: false, filterType: 'all', periods: [],
      additionalKycVerifyFilter: 0, publisherType: null, payTypes: [], classifies: [],
      tradedWith: false, followed: false, transAmount },
    { headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json',
        Clienttype: 'web', 'Bnc-Time-Zone': 'America/Caracas', Lang: 'es',
        Origin: 'https://p2p.binance.com', Referer: 'https://p2p.binance.com/' },
      timeout: 15000 }
  );
  if (!data?.data?.length) return 0;
  const prices = data.data.map((i) => parseFloat(i.adv?.price)).filter((n) => Number.isFinite(n) && n > 0);
  if (!prices.length) return 0;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

async function updateBinance() {
  if (binanceInFlight) return false;
  binanceInFlight = true;
  RATE_SOURCE_STATE.binance.lastAttemptAt = new Date().toISOString();
  // A las 00:00 (Caracas) la tasa publicada la víspera entra en vigencia:
  // este guard corre en cada ciclo y rota la vigente al instante.
  try { checkRolloverVigenciaBcv(); } catch (e) { log.error('rollover BCV:', e.message); }
  try {
    const [comprar, vender] = await Promise.all([
      withRetry(() => getBinanceRate('BUY'),  { attempts: 3, baseDelay: 3000 }),
      withRetry(() => getBinanceRate('SELL'), { attempts: 3, baseDelay: 3000 }),
    ]);
    const buy = RateSources.validateRate(comprar, {
      min: 1, max: 1_000_000, previous: CACHE_TASAS.binance, maxChangeRatio: 0.5,
    });
    const sell = RateSources.validateRate(vender, {
      min: 1, max: 1_000_000, previous: CACHE_TASAS.binance_compra, maxChangeRatio: 0.5,
    });
    let changed = false;
    if (buy.ok) { CACHE_TASAS.binance = buy.value; changed = true; }
    if (sell.ok) { CACHE_TASAS.binance_compra = sell.value; changed = true; }
    if (!changed) {
      const invalid = new Error(`Binance rechazado: BUY=${buy.code || 'ok'} SELL=${sell.code || 'ok'}`);
      invalid.code = 'BINANCE_INVALID_RATES';
      throw invalid;
    }
    const successAt = new Date().toISOString();
    RATE_SOURCE_STATE.binance.lastSuccessAt = successAt;
    RATE_SOURCE_STATE.binance.consecutiveFailures = 0;
    CACHE_TASAS.lastUpdateBinance = successAt;
    CACHE_TASAS.lastUpdateTasas = successAt;
    guardarHistorialSiCambio({
      ...CACHE_TASAS,
      bcv: CACHE_TASAS.bcv_publicada || CACHE_TASAS.bcv,
    });
    broadcastTasas();
    return true;
  } catch (e) {
    RATE_SOURCE_STATE.binance.consecutiveFailures += 1;
    log.error(`updateBinance fallido: ${e.code || e.name || 'ERROR'}`);
    return false;
  } finally {
    binanceInFlight = false;
  }
}

async function updateOficiales() {
  if (bcvInFlight) return false;
  bcvInFlight = true;
  RATE_SOURCE_STATE.bcv.lastAttemptAt = new Date().toISOString();
  try {
    const datos = await getBCVData();
    const now   = Date.now();
    CACHE_TASAS.bcv_publicada = datos.usd;
    // Registrar la publicación con su fecha valor REAL (la que dice el BCV)
    if (datos.fechaValor) {
      upsertPublicacionBcv({ fechaValor: datos.fechaValor, bcv: datos.usd, ts: now });
    }
    if (datos.cny > 0) CACHE_TASAS.cny = datos.cny;
    resolveAndCacheBcv();
    const successAt = new Date().toISOString();
    RATE_SOURCE_STATE.bcv.lastSuccessAt = successAt;
    RATE_SOURCE_STATE.bcv.consecutiveFailures = 0;
    CACHE_TASAS.lastUpdateBCV = successAt;
    CACHE_TASAS.lastUpdateTasas = successAt;
    guardarHistorialSiCambio({
      ...CACHE_TASAS,
      bcv: CACHE_TASAS.bcv_publicada || CACHE_TASAS.bcv,
    });
    broadcastTasas();
    return true;
  } catch (e) {
    RATE_SOURCE_STATE.bcv.consecutiveFailures += 1;
    log.error(`updateOficiales fallido: ${e.code || e.name || 'ERROR'}`);
    return false;
  } finally {
    bcvInFlight = false;
  }
}

// ─── SECCIÓN: PÁGINAS ───────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/calculadoraa');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});
app.get('/register', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/calculadoraa');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/calculadoraa', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ─── SECCIÓN: HEALTH CHECK ──────────────────────────────────────────────────

function requireLoopback(req, res, next) {
  const ip = String(req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (['127.0.0.1', '::1'].includes(ip)) return next();
  return res.status(404).end();
}

app.get('/health-internal', requireLoopback, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let database = 'ok';
  try {
    db.prepare('SELECT 1').get();
  } catch (_) {
    database = 'unavailable';
  }
  const sources = getRateSourceStatus();
  const ready = database === 'ok';
  res.status(ready ? 200 : 503).json({
    status: ready ? (sources.binance.stale || sources.bcv.stale ? 'degraded' : 'ok') : 'unavailable',
    ready,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / 1048576),
    database,
    sources: {
      binance: sources.binance.status,
      bcv: sources.bcv.status,
    },
  });
});

app.get('/health', requireAuth, requireAdmin, (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: {
      rss:        Math.round(mem.rss / 1048576),       // MB
      heapUsed:   Math.round(mem.heapUsed / 1048576),
      heapTotal:  Math.round(mem.heapTotal / 1048576),
      external:   Math.round(mem.external / 1048576),
    },
    registrosEnDB:   stmtCount.get().c,
    cotizaciones:    stmtImportQuoteCount.get().c,
    sesionesActivas: sessionStore.countActive(),
    wsClients:       wssTasas?.clients?.size ?? 0,
    timers: {
      binance:   !!timerBinance,
      oficiales: !!intervalOficiales,
    },
    fuentes: {
      lastUpdateBinance: CACHE_TASAS.lastUpdateBinance,
      lastUpdateBCV:     CACHE_TASAS.lastUpdateBCV,
      sourceStatus: getRateSourceStatus(),
    },
    cache: {
      binance: CACHE_TASAS.binance, binance_compra: CACHE_TASAS.binance_compra,
      bcv: CACHE_TASAS.bcv, bcv_publicada: CACHE_TASAS.bcv_publicada, cny: CACHE_TASAS.cny,
      bcv_meta: CACHE_TASAS.bcv_meta,
    },
  });
});

// ─── SECCIÓN: API AUTENTICACIÓN ─────────────────────────────────────────────

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const ip            = req.ip;
    const rawIdentifier = V.cleanString(req.body?.username, 254);
    const password      = (req.body?.password || '').toString();
    const isEmail       = V.isEmail(rawIdentifier);
    const identifier    = isEmail ? rawIdentifier.toLowerCase() : rawIdentifier;

    const user = identifier
      ? db.prepare(`
          SELECT id, username, full_name, email, password, role
          FROM users
          WHERE LOWER(username) = LOWER(?)
             OR (email IS NOT NULL AND email = ?)
        `).get(identifier, identifier)
      : null;

    const hashToCompare = user ? user.password : DUMMY_BCRYPT_HASH;
    const match = await bcrypt.compare(password, hashToCompare);

    if (!user || !match) {
      // Delay progresivo tras el 3er intento fallido (mismo IP), tope 5s.
      const attempts = getLoginAttempts(ip);
      if (attempts >= 3) await sleep(Math.min(attempts * 500, 5000));
      recordFailedLogin(ip);
      return sendApiError(res, 401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos');
    }

    clearLoginAttempts(ip);

    const csrfToken = generateCsrfToken();
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        log.error('Session regenerate error:', regenErr.message);
        return sendApiError(res, 500, 'SESSION_REGENERATE_FAILED', 'Error interno');
      }
      req.session.userId    = user.id;
      req.session.role      = user.role;
      req.session.csrfToken = csrfToken;
      req.session.save((saveErr) => {
        if (saveErr) {
          log.error('Session save error:', saveErr.message);
          return sendApiError(res, 500, 'SESSION_SAVE_FAILED', 'Error interno');
        }
        db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);
        res.json({
          success: true, role: user.role, username: user.username,
          fullName: user.full_name || null, csrfToken,
        });
      });
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return sendApiError(res, 500, 'LOGOUT_FAILED', 'Error al cerrar sesión');
    res.clearCookie('dayzo.sid', { path: '/' });
    res.json({ success: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (req.session?.userId) {
    const user = db.prepare('SELECT username, full_name, email, role FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      if (!req.session.csrfToken) req.session.csrfToken = generateCsrfToken();
      return res.json({
        loggedIn: true, username: user.username, fullName: user.full_name || null,
        email: user.email || null, role: user.role, csrfToken: req.session.csrfToken,
      });
    }
  }
  res.json({ loggedIn: false });
});

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const fullName = V.cleanString(req.body?.fullName, 80);
    const username = V.cleanString(req.body?.username, 64);
    const email    = V.cleanString(req.body?.email, 254).toLowerCase();
    const password = (req.body?.password || '').toString();

    const nameError = V.validateFullName(fullName);
    if (nameError) return sendApiError(res, 400, 'INVALID_FULL_NAME', nameError);
    const userError = V.validateUsername(username);
    if (userError) return sendApiError(res, 400, 'INVALID_USERNAME', userError);
    const emailError = V.validateEmail(email);
    if (emailError) return sendApiError(res, 400, 'INVALID_EMAIL', emailError);
    const passError = V.validatePassword(password);
    if (passError) return sendApiError(res, 400, 'INVALID_PASSWORD', passError);

    const hash = await bcrypt.hash(password, 12);
    const id   = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, username, full_name, email, password, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, username, fullName, email, hash, 'viewer', Date.now());

    res.json({ success: true, message: 'Cuenta creada correctamente. Ya puedes iniciar sesión.' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      const msg = String(e.message).includes('.email')
        ? 'El correo ya está registrado.'
        : 'Ese nombre de usuario ya está en uso.';
      return sendApiError(res, 409, 'USER_ALREADY_EXISTS', msg);
    }
    next(e);
  }
});

app.post('/api/auth/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const username = V.cleanString(req.body?.username, 64);
    const password = (req.body?.password || '').toString();
    const role     = V.cleanString(req.body?.role, 16) || 'viewer';
    const fullName = V.cleanString(req.body?.fullName, 80) || null;
    const email    = V.cleanString(req.body?.email, 254).toLowerCase() || null;

    const userError = V.validateUsername(username);
    if (userError) return sendApiError(res, 400, 'INVALID_USERNAME', userError);
    if (role !== 'admin' && role !== 'viewer') return sendApiError(res, 400, 'INVALID_ROLE', 'Rol inválido');
    if (email) {
      const emailError = V.validateEmail(email);
      if (emailError) return sendApiError(res, 400, 'INVALID_EMAIL', emailError);
    }
    const passError = V.validatePassword(password);
    if (passError) return sendApiError(res, 400, 'INVALID_PASSWORD', passError);

    const hash = await bcrypt.hash(password, 12);
    const id   = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, username, full_name, email, password, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, username, fullName, email, hash, role, Date.now());
    res.json({ success: true, id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return sendApiError(res, 409, 'USER_ALREADY_EXISTS', 'El usuario ya existe');
    }
    next(e);
  }
});

app.get('/api/auth/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, full_name, email, role, created_at, last_login FROM users ORDER BY username').all();
  res.json({ success: true, users });
});

app.delete('/api/auth/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (req.params.id === req.session.userId) {
    return sendApiError(res, 400, 'SELF_DELETE_FORBIDDEN', 'No puedes eliminar tu propio usuario');
  }
  if (!V.isUUID(req.params.id)) {
    return sendApiError(res, 400, 'INVALID_ID', 'Identificador inválido');
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return sendApiError(res, 404, 'USER_NOT_FOUND', 'Usuario no encontrado');
  const quoteCount = stmtImportQuoteCountByUser.get(user.id).c;
  if (quoteCount > 0) {
    return sendApiError(
      res,
      409,
      'USER_HAS_QUOTES',
      'No se puede eliminar el usuario mientras tenga cotizaciones. Transfiere o elimina sus datos primero.',
      { quoteCount }
    );
  }

  const removeUser = db.transaction(() => {
    const sessions = db.prepare('SELECT sid, sess FROM sessions').all();
    const deleteSession = db.prepare('DELETE FROM sessions WHERE sid = ?');
    for (const row of sessions) {
      try {
        if (JSON.parse(row.sess)?.userId === user.id) deleteSession.run(row.sid);
      } catch (_) {
        // Una sesión corrupta no debe impedir la política RESTRICT del usuario.
      }
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  });
  removeUser();
  res.json({ success: true });
});

// ─── SECCIÓN: API TASAS ─────────────────────────────────────────────────────

app.get('/api/tasas-venezuela', tasasLimiter, (req, res, next) => {
  try {
    const { binance, binance_compra, bcv, bcv_publicada, cny, bcv_meta } = CACHE_TASAS;
    const sourceStatus = getRateSourceStatus();
    const diff_bs  = binance - bcv;
    const diff_pct = bcv > 0 ? (diff_bs / bcv) * 100 : 0;
    const ahora    = new Date().toLocaleString('es-VE', {
      timeZone: 'America/Caracas',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const range      = req.query.range || '24h';
    const limit      = req.query.limit === 'all' || req.query.limit === '0' ? 0 : (parseInt(req.query.limit, 10) || 5000);
    const wantsStats = req.query.stats === '1' || req.query.stats === 'true';
    const chartStats = wantsStats ? computeChartStats(range) : null;
    const fechaParam = req.query.fecha ? V.cleanString(req.query.fecha, 32) : null;

    const historialFiltrado = queryHistorial({ range, fecha: fechaParam, limit });

    let last_update = null;
    const lastT = CACHE_TASAS.lastUpdateTasas || CACHE_TASAS.lastUpdateBinance || CACHE_TASAS.lastUpdateBCV;
    if (lastT) {
      last_update = new Date(lastT).toLocaleString('es-VE', {
        timeZone: 'America/Caracas',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      });
    } else if (historialFiltrado.length > 0) {
      last_update = historialFiltrado[0].fecha;
    }

    const rangoRow = stmtRango.get();
    const rango    = { start: rangoRow?.s ?? null, end: rangoRow?.e ?? null };

    res.json({
      tasas: {
        p2pBuyVesPerUsdt: binance,
        p2pSellVesPerUsdt: binance_compra,
        binance,
        binance_compra,
        bcv,
        bcv_publicada,
        cny,
      },
      bcv_meta,
      sourceStatus: {
        ...sourceStatus,
        stale: sourceStatus.binance.stale || sourceStatus.bcv.stale,
      },
      lastAttemptAt: {
        binance: sourceStatus.binance.lastAttemptAt,
        bcv: sourceStatus.bcv.lastAttemptAt,
      },
      lastSuccessAt: {
        binance: sourceStatus.binance.lastSuccessAt,
        bcv: sourceStatus.bcv.lastSuccessAt,
      },
      diff_bs, diff_pct, fecha: ahora, last_update,
      historial: historialFiltrado, rango, chartStats,
    });
  } catch (e) {
    next(e);
  }
});

// Estadísticas agregadas de 24h (variación, máx/mín/prom, brecha) en una consulta.
app.get('/api/stats', tasasLimiter, (req, res, next) => {
  try {
    res.json(computeStats24h());
  } catch (e) {
    next(e);
  }
});

// Tasas guardadas en una fecha (y hora opcional) para cálculos históricos.
//  - binance / binance_compra: snapshot más cercano ANTERIOR al momento pedido.
//  - bcv: tasa legalmente VIGENTE ese día (regla de medianoche + Art. 25 LIVA).
//  - Sin hora → cierre del día.
app.get('/api/tasas-historicas', tasasLimiter, (req, res, next) => {
  try {
    const fecha = V.cleanString(req.query.fecha, 10);
    const hora  = V.cleanString(req.query.hora, 5);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return sendApiError(res, 400, 'INVALID_DATE', 'Fecha inválida. Usa el formato AAAA-MM-DD.');
    }
    if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
      return sendApiError(res, 400, 'INVALID_TIME', 'Hora inválida. Usa el formato HH:MM (24h).');
    }
    const baseDate = new Date(`${fecha}T${hora || '23:59'}:59.999-04:00`);
    if (Number.isNaN(baseDate.getTime())) {
      return sendApiError(res, 400, 'INVALID_DATE', 'Fecha inválida.');
    }
    const hoyCaracas = BcvVigencia.fechaCaracas(new Date());
    if (fecha > hoyCaracas) {
      return sendApiError(res, 400, 'FUTURE_DATE', 'La fecha no puede ser futura.');
    }

    const ts  = Math.min(baseDate.getTime(), Date.now());
    const row = stmtHistAt.get(ts);
    if (!row) {
      return sendApiError(res, 404, 'HISTORICAL_RATE_NOT_FOUND', 'No hay tasas guardadas para esa fecha (es anterior al inicio del historial).');
    }

    const resolved   = resolveBcvVigenteFecha(fecha);
    const bcvVigente = resolved.bcv_vigente > 0 ? resolved.bcv_vigente : (row.bcv || 0);

    const registroFecha = new Date(row.timestamp).toLocaleString('es-VE', {
      timeZone: 'America/Caracas',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });

    const binance = row.binance || 0;
    const diffBs  = binance - bcvVigente;

    res.json({
      consulta: { fecha, hora: hora || null, timestamp: ts },
      tasas: {
        binance,
        binance_compra: row.binance_compra || 0,
        bcv:            bcvVigente,
        bcv_registrada: row.bcv || 0,
      },
      registro: {
        timestamp:   row.timestamp,
        fecha:       registroFecha,
        // Distancia entre el momento pedido y el dato encontrado (para avisos)
        desfase_min: Math.max(0, Math.round((ts - row.timestamp) / 60000)),
      },
      diff_bs:  diffBs,
      diff_pct: bcvVigente > 0 ? (diffBs / bcvVigente) * 100 : 0,
      bcv_meta: resolved.bcv_meta,
    });
  } catch (e) {
    next(e);
  }
});

// ─── SECCIÓN: API COTIZACIONES DE IMPORTACIÓN (por usuario) ─────────────────

app.get('/api/import-quotes', requireAuth, (req, res) => {
  const parsed = parseImportQuoteListQuery(req.query);
  if (!parsed.ok) return sendApiError(res, 400, parsed.code, parsed.message);
  const result = listImportQuotesForUser(req.user.id, parsed.value);
  res.json({ success: true, apiVersion: '2', ...result });
});

app.get('/api/import-quotes/:id', requireAuth, (req, res) => {
  if (!V.isUUID(req.params.id)) return sendApiError(res, 400, 'INVALID_ID', 'Identificador inválido');
  const row = stmtImportQuoteForUser.get(String(req.params.id), req.user.id);
  if (!row) return sendApiError(res, 404, 'QUOTE_NOT_FOUND', 'Cotización no encontrada');
  res.json({ success: true, apiVersion: '2', quote: mapImportQuoteDetail(row) });
});

app.post('/api/import-quotes', requireAuth, mutationLimiter, (req, res, next) => {
  try {
    const cleanName = V.cleanString(req.body?.name, 120);
    if (!cleanName) return sendApiError(res, 400, 'INVALID_NAME', 'Falta el nombre');

    const prepared = prepareIncomingQuote(req.body?.quote);
    if (!prepared.ok) return sendApiError(res, 400, prepared.code || 'INVALID_QUOTE', prepared.error);

    const now = Date.now();
    const id  = crypto.randomUUID();
    stmtImportQuoteInsert.run({
      id, name: cleanName, quote: JSON.stringify(prepared.value),
      user_id: req.user.id, created_at: now, updated_at: now,
    });
    const total = stmtImportQuoteCountByUser.get(req.user.id).c;
    res.json({ success: true, id, total });
  } catch (e) {
    next(e);
  }
});

app.put('/api/import-quotes/:id', requireAuth, mutationLimiter, (req, res, next) => {
  try {
    if (!V.isUUID(req.params.id)) return sendApiError(res, 400, 'INVALID_ID', 'Identificador inválido');
    const row = stmtImportQuoteForUser.get(String(req.params.id), req.user.id);
    if (!row) return sendApiError(res, 404, 'QUOTE_NOT_FOUND', 'Cotización no encontrada');

    const cleanName = V.cleanString(req.body?.name, 120);
    let nextQuote   = parseImportQuoteRow(row).quote;
    if (req.body?.quote != null) {
      const prepared = prepareIncomingQuote(req.body.quote);
      if (!prepared.ok) return sendApiError(res, 400, prepared.code || 'INVALID_QUOTE', prepared.error);
      nextQuote = prepared.value;
    }

    const result = stmtImportQuoteUpdate.run({
      id: row.id, user_id: req.user.id,
      name: cleanName || row.name, quote: JSON.stringify(nextQuote), updated_at: Date.now(),
    });
    if (result.changes === 0) return sendApiError(res, 404, 'QUOTE_NOT_FOUND', 'Cotización no encontrada');
    res.json({ success: true, id: row.id });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/import-quotes/:id', requireAuth, mutationLimiter, (req, res, next) => {
  try {
    if (!V.isUUID(req.params.id)) return sendApiError(res, 400, 'INVALID_ID', 'Identificador inválido');
    const result = stmtImportQuoteDelete.run(String(req.params.id), req.user.id);
    if (result.changes === 0) return sendApiError(res, 404, 'QUOTE_NOT_FOUND', 'Cotización no encontrada');
    const total = stmtImportQuoteCountByUser.get(req.user.id).c;
    res.json({ success: true, total });
  } catch (e) {
    next(e);
  }
});

// ─── SECCIÓN: MANEJO DE ERRORES GLOBAL ──────────────────────────────────────

// 404 para rutas API desconocidas
app.use('/api', (req, res) => {
  sendApiError(res, 404, 'API_NOT_FOUND', 'Recurso no encontrado');
});

// Handler de errores global (último middleware)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) log.error(`${req.method} ${req.path} →`, err.message);
  const message = IS_PROD ? 'Error interno del servidor' : err.message;
  res.status(status).json(apiErrorBody(
    status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
    message,
    IS_PROD ? undefined : { stack: err.stack }
  ));
});

// ─── SECCIÓN: WEBSOCKET ─────────────────────────────────────────────────────

const server   = http.createServer(app);
const wssTasas = new WebSocket.Server({
  noServer: true,
  maxPayload: 16 * 1024,
  perMessageDeflate: false,
});

wssTasas.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
});
const wsHeartbeat = setInterval(() => {
  wssTasas.clients.forEach((socket) => {
    if (socket.isAlive === false) return socket.terminate();
    socket.isAlive = false;
    socket.ping();
  });
}, 30_000);
wsHeartbeat.unref();

server.on('upgrade', (request, socket, head) => {
  if (request.url.split('?')[0] !== '/tasas-ws') return socket.destroy();
  wssTasas.handleUpgrade(request, socket, head, (ws) => wssTasas.emit('connection', ws, request));
});

function broadcastTasas() {
  const { binance, binance_compra, bcv, bcv_publicada, cny, bcv_meta } = CACHE_TASAS;
  const sourceStatus = getRateSourceStatus();
  const diff_bs     = binance - bcv;
  const diff_pct    = bcv > 0 ? (diff_bs / bcv) * 100 : 0;
  const lastT       = CACHE_TASAS.lastUpdateTasas || CACHE_TASAS.lastUpdateBinance || CACHE_TASAS.lastUpdateBCV;
  const last_update = lastT
    ? new Date(lastT).toLocaleString('es-VE', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
    : null;
  const payload = JSON.stringify({
    type: 'tasas_update',
    data: {
      tasas: {
        p2pBuyVesPerUsdt: binance,
        p2pSellVesPerUsdt: binance_compra,
        binance,
        binance_compra,
        bcv,
        bcv_publicada,
        cny,
      },
      bcv_meta,
      sourceStatus: {
        ...sourceStatus,
        stale: sourceStatus.binance.stale || sourceStatus.bcv.stale,
      },
      lastAttemptAt: {
        binance: sourceStatus.binance.lastAttemptAt,
        bcv: sourceStatus.bcv.lastAttemptAt,
      },
      lastSuccessAt: {
        binance: sourceStatus.binance.lastSuccessAt,
        bcv: sourceStatus.bcv.lastSuccessAt,
      },
      diff_bs, diff_pct,
      fecha: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
      last_update,
    },
  });
  wssTasas.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
}

// ─── SECCIÓN: ARRANQUE ──────────────────────────────────────────────────────

let timerBinance = null;
async function runBinanceCycle() {
  if (ratesStopping) return;
  await updateBinance();
  if (ratesStopping) return;
  const delay = RateSources.backoffDelay({
    baseMs: 10 * 1000,
    failureCount: RATE_SOURCE_STATE.binance.consecutiveFailures,
    maxMs: 2 * 60 * 1000,
  });
  timerBinance = setTimeout(runBinanceCycle, delay);
  timerBinance.unref?.();
}
// Cada 15 min: detecta pronto la publicación vespertina del BCV (~4-5 PM VET)
const intervalOficiales = setInterval(updateOficiales, 15 * 60 * 1000);

updateOficiales();
runBinanceCycle();

// Un fallo al enlazar el puerto es fatal: salir para que PM2 reinicie limpio.
server.on('error', (err) => {
  log.error('Error del servidor HTTP:', err.message);
  if (err.code === 'EADDRINUSE' || err.syscall === 'listen') {
    shutdown('HTTP_SERVER_ERROR', 1);
  }
});

(async function start() {
  try {
    await bootstrapAdminUser();
    server.listen(PORT, HOST, () => {
      const address = server.address();
      const listeningPort = typeof address === 'object' && address ? address.port : PORT;
      log.info(`Calculadora disponible en http://${HOST}:${listeningPort}/calculadoraa`);
      log.info(`Health check en        http://${HOST}:${listeningPort}/health`);
      log.info(`Base de datos SQLite:  ${DB_FILE}`);
      log.info(`Total registros en DB: ${stmtCount.get().c.toLocaleString()}`);
    });
  } catch (err) {
    log.error('Arranque abortado:', err.message);
    shutdown('STARTUP_FAILURE', 1);
  }
})();

// ─── SECCIÓN: GRACEFUL SHUTDOWN ─────────────────────────────────────────────

let shuttingDown = false;

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  ratesStopping = true;
  log.info(`[${signal}] Cerrando servidor…`);

  clearTimeout(timerBinance);
  clearInterval(intervalOficiales);
  clearInterval(wsHeartbeat);

  // Avisar a los clientes WS antes de cerrar, luego terminarlos.
  try {
    const bye = JSON.stringify({ type: 'server_shutdown' });
    wssTasas.clients.forEach((c) => { try { if (c.readyState === WebSocket.OPEN) c.send(bye); } catch (_) {} });
  } catch (_) {}
  setTimeout(() => { wssTasas.clients.forEach((c) => c.terminate()); }, 250);

  const finalize = () => {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { log.warn('wal_checkpoint:', e.message); }
    try { db.close(); } catch (_) {}
    log.info('Servidor y DB cerrados correctamente.');
    process.exit(exitCode);
  };

  // Espera a que terminen los requests en curso (máx 10s).
  if (server.listening) server.close(finalize);
  else finalize();

  setTimeout(() => {
    log.warn('Cierre forzado tras timeout.');
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    try { db.close(); } catch (_) {}
    process.exit(exitCode || 1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  log.error('uncaughtException fatal:', err?.name || 'Error');
  shutdown('UNCAUGHT_EXCEPTION', 1);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection fatal:', reason instanceof Error ? reason.name : typeof reason);
  shutdown('UNHANDLED_REJECTION', 1);
});
