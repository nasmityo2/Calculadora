'use strict';

const { logger } = require('../config/logger');

/**
 * Mapeo de errores de better-sqlite3 / red a respuestas HTTP claras y en español.
 *
 * Objetivos:
 *   - El cajero NUNCA ve un mensaje técnico tipo "UNIQUE constraint failed: ventas...".
 *   - Errores transitorios de BD (SQLITE_BUSY, archivo bloqueado) se devuelven como 503
 *     para que el frontend muestre el toast de reintento sin perder el carrito.
 *   - Errores de validación de negocio (httpError 400/409) mantienen su status intactos.
 *   - Violaciones de constraints conocidos (stock >= 0, idempotency_key) reciben
 *     códigos específicos que el POS interpreta (STOCK_INSUFICIENTE, DUPLICATE_OPERATION).
 *   - En producción los 500 NO revelan stack traces ni nombres de tablas/columnas.
 *
 * better-sqlite3 lanza SqliteError con `code` extendido: SQLITE_CONSTRAINT_UNIQUE,
 * SQLITE_CONSTRAINT_CHECK, SQLITE_BUSY, SQLITE_CANTOPEN, etc. Algunas builds reportan
 * solo el código base (SQLITE_CONSTRAINT), por eso también se inspecciona el mensaje.
 */

const NET_CONN_ERRORS = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH',
  'EAI_AGAIN', 'EPIPE'
]);

/** Código SQLITE_* del error (better-sqlite3) o null. */
function sqliteCode(err) {
  return err && typeof err.code === 'string' && err.code.startsWith('SQLITE_')
    ? err.code
    : null;
}

function isDbConnectionError(err) {
  if (!err) return false;
  if (NET_CONN_ERRORS.has(err.code)) return true;
  const sc = sqliteCode(err);
  if (sc) {
    // Archivo de BD inaccesible, corrupto o de solo lectura → no disponible.
    if (
      sc.startsWith('SQLITE_CANTOPEN') ||
      sc.startsWith('SQLITE_NOTADB') ||
      sc.startsWith('SQLITE_CORRUPT') ||
      sc.startsWith('SQLITE_READONLY') ||
      sc.startsWith('SQLITE_IOERR') ||
      sc === 'SQLITE_FULL'
    ) {
      return true;
    }
  }
  const msg = String(err.message || '');
  return (
    msg.includes('database disk image is malformed') ||
    msg.includes('unable to open database file')
  );
}

function isDbResourceError(err) {
  if (!err) return false;
  const sc = sqliteCode(err);
  if (sc && (sc.startsWith('SQLITE_BUSY') || sc.startsWith('SQLITE_LOCKED'))) return true;
  const msg = String(err.message || '');
  return msg.includes('database is locked') || msg.includes('database table is locked');
}

/**
 * Decide status HTTP y mensaje según el error.
 * Devuelve { status, message, code } donde `code` es opcional para que el
 * frontend pueda reaccionar específicamente (ej: STOCK_INSUFICIENTE → modal).
 */
function classifyError(err) {
  // Errores HTTP explícitos (httpError(400, '...') de los controllers)
  if (err && err.status && err.status < 500) {
    return { status: err.status, message: err.message, code: err.code || null };
  }

  const sc = sqliteCode(err);
  const msg = String((err && err.message) || '');

  // BD inaccesible/corrupta → 503 reintentable
  if (isDbConnectionError(err)) {
    return {
      status: 503,
      message: 'Base de datos no disponible. Reinicia la aplicación o contacta al administrador.',
      code: 'DB_UNAVAILABLE'
    };
  }

  // BD ocupada (WAL lock de otro proceso) → 503 reintentable a corto plazo
  if (isDbResourceError(err)) {
    return {
      status: 503,
      message: 'La base de datos está ocupada en este momento. Reintenta en unos segundos.',
      code: 'DB_BUSY'
    };
  }

  // CHECK constraint (stock >= 0 del schema SQLite, montos, etc.)
  if ((sc && sc.startsWith('SQLITE_CONSTRAINT') && msg.includes('CHECK constraint failed')) ||
      msg.includes('CHECK constraint failed')) {
    if (msg.includes('stock_actual') || msg.includes('stock_no_negativo') || msg.includes('STOCK')) {
      return {
        status: 409,
        message: 'Stock insuficiente para completar la operación. Otro usuario pudo haber vendido el último ítem.',
        code: 'STOCK_INSUFICIENTE'
      };
    }
    return {
      status: 409,
      message: 'La operación viola una regla de integridad de datos.',
      code: 'CHECK_VIOLATION'
    };
  }

  // UNIQUE constraint (idempotencia de ventas, números correlativos, claves únicas)
  if ((sc && sc.startsWith('SQLITE_CONSTRAINT') && msg.includes('UNIQUE constraint failed')) ||
      msg.includes('UNIQUE constraint failed')) {
    if (msg.includes('idempotency_key')) {
      return {
        status: 409,
        message: 'Esta venta ya fue registrada anteriormente (operación duplicada detectada).',
        code: 'DUPLICATE_OPERATION'
      };
    }
    return {
      status: 409,
      message: 'Ya existe un registro con esos datos.',
      code: 'UNIQUE_VIOLATION'
    };
  }

  // Foreign key
  if ((sc && sc.startsWith('SQLITE_CONSTRAINT') && msg.includes('FOREIGN KEY constraint failed')) ||
      msg.includes('FOREIGN KEY constraint failed')) {
    return {
      status: 409,
      message: 'Operación rechazada: el registro referenciado no existe o está en uso.',
      code: 'FK_VIOLATION'
    };
  }

  // Not null
  if ((sc && sc.startsWith('SQLITE_CONSTRAINT') && msg.includes('NOT NULL constraint failed')) ||
      msg.includes('NOT NULL constraint failed')) {
    return {
      status: 400,
      message: 'Falta un campo obligatorio en la operación.',
      code: 'NOT_NULL_VIOLATION'
    };
  }

  // Catch-all 500: en producción no se filtra el mensaje interno (tablas/columnas/SQL).
  const esProd = process.env.NODE_ENV === 'production';
  return {
    status: err && err.status ? err.status : 500,
    message: esProd
      ? 'Error interno del servidor'
      : (err && err.message ? err.message : 'Error interno'),
    code: null
  };
}

function errorHandlerMiddleware(err, req, res, next) {
  const { status, message, code } = classifyError(err);

  // Logging estructurado: 5xx siempre, 503 con menos ruido
  if (status >= 500 && status !== 503) {
    logger.error('Error interno del servidor', {
      method: req.method,
      url: req.originalUrl,
      status,
      error: err && err.message ? err.message : message,
      dbCode: err && err.code,
      stack: err && err.stack ? err.stack : ''
    });
  } else if (status === 503) {
    logger.warn('Servicio temporalmente no disponible', {
      method: req.method,
      url: req.originalUrl,
      dbCode: err && err.code,
      error: err && err.message
    });
  }

  const body = { error: message };
  if (code) body.code = code;
  res.status(status).json(body);
}

module.exports = {
  errorHandlerMiddleware,
  classifyError,
  isDbConnectionError,
  isDbResourceError
};
