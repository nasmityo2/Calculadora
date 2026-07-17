'use strict';

/**
 * Módulo central de validación y sanitización (DAYZO).
 * Punto único para validar entradas de usuario antes de tocar la base de datos.
 * Sin dependencias externas para mantener el consumo de RAM bajo.
 */

const EMAIL_RE        = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE     = /^[a-zA-Z0-9._-]+$/;
const UUID_RE         = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCTO_LINK_MAX_LEN = 2048;

// ─── Strings ────────────────────────────────────────────────────────────────

/** Convierte a string recortado y con tope de longitud (evita payloads enormes). */
function cleanString(raw, maxLen = 256) {
  if (raw == null) return '';
  const s = String(raw).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** Elimina caracteres de control que romperían JSON/HTML logs. */
function stripControlChars(s) {
  return String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, '');
}

// ─── Usuario / credenciales ──────────────────────────────────────────────────

function validateUsername(username) {
  const u = cleanString(username, 64);
  if (!u || u.length < 3)  return 'El nombre de usuario debe tener al menos 3 caracteres.';
  if (u.length > 32)       return 'El nombre de usuario no puede superar 32 caracteres.';
  if (!USERNAME_RE.test(u)) return 'El nombre de usuario solo puede contener letras, números, puntos, guiones y guión bajo.';
  if (EMAIL_RE.test(u))    return 'El nombre de usuario no puede ser un correo electrónico.';
  return null;
}

function validatePassword(password) {
  const p = password == null ? '' : String(password);
  if (p.length < 8)        return 'La contraseña debe tener al menos 8 caracteres.';
  if (p.length > 200)      return 'La contraseña es demasiado larga.';
  if (!/[a-zA-Z]/.test(p)) return 'La contraseña debe contener al menos una letra.';
  if (!/[0-9]/.test(p))    return 'La contraseña debe contener al menos un número.';
  return null;
}

function validateFullName(name) {
  const n = cleanString(name, 80);
  if (!n || n.length < 2) return 'El nombre completo es requerido (mínimo 2 caracteres).';
  return null;
}

function validateEmail(email) {
  const e = cleanString(email, 254).toLowerCase();
  if (!e || !EMAIL_RE.test(e)) return 'El correo electrónico no es válido.';
  return null;
}

function isEmail(s) {
  return EMAIL_RE.test(cleanString(s, 254));
}

function isUUID(s) {
  return UUID_RE.test(String(s ?? ''));
}

// ─── URLs de producto ─────────────────────────────────────────────────────────

function sanitizeProductoLink(raw) {
  const s = cleanString(raw, PRODUCTO_LINK_MAX_LEN + 64);
  if (!s) return null;
  if (/[\u0000-\u001F\u007F{}]/.test(s)) return null;
  let url = s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    if (!/^https?:\/\//i.test(url)) return null;
  } else {
    url = `https://${url}`;
  }
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || u.username || u.password) return null;
    const href = u.href;
    return href.length > PRODUCTO_LINK_MAX_LEN ? href.slice(0, PRODUCTO_LINK_MAX_LEN) : href;
  } catch (_) {
    return null;
  }
}

// ─── Cotizaciones de importación ──────────────────────────────────────────────
// Esquema estricto: se descartan campos desconocidos y se valida el tipo de cada
// campo conocido. Un error de cálculo en producción puede costar dinero real, así
// que sólo se persiste lo que coincide con el esquema esperado.

const QUOTE_NUMBER_FIELDS = [
  'version', 'empresaTarifaUSD', 'empresaEnvioUSD',
  'cajas', 'unidadesPorCaja', 'unidadesTotales',
  'pesoPorCajaKg', 'precioMercanciaPorUnidadUSD', 'envioChinaPorCajaUSD',
  'volumenM3', 'volumenPorCajaM3', 'pesoKg',
  'costoMercanciaUSD', 'envioChinaUSD', 'plataformaUSD', 'comisionBancoUSD',
  'subtotalUSD', 'envioInternacionalUSD', 'fletePorCajaUSD', 'inversionTotalUSD',
  'costoUnitarioUSD', 'costoPorCajaUSD', 'feePlataforma', 'feeBanco',
  // Plan de venta (proyección de ganancia guardada con la cotización)
  'ventaUnitarioUSD', 'ventaPorCajaUSD', 'gananciaUnitariaUSD', 'gananciaTotalUSD',
  'roiVentaPct', 'margenVentaPct',
];
const QUOTE_STRING_FIELDS  = ['entradaRaw', 'empresaNombre', 'tipoCobro'];
const QUOTE_BOOL_FIELDS    = ['tarifaMinAplicada'];

/**
 * Valida y devuelve una versión saneada del objeto `quote`.
 * @returns {{ ok: boolean, error?: string, value?: object }}
 */
function sanitizeImportQuote(quote) {
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) {
    return { ok: false, error: 'El objeto de cotización es inválido.' };
  }

  const out = {};

  for (const key of QUOTE_NUMBER_FIELDS) {
    if (quote[key] == null) continue;
    const n = Number(quote[key]);
    if (!Number.isFinite(n)) {
      return { ok: false, error: `El campo "${key}" debe ser numérico.` };
    }
    out[key] = n;
  }

  for (const key of QUOTE_STRING_FIELDS) {
    if (quote[key] == null) continue;
    out[key] = stripControlChars(cleanString(quote[key], 600));
  }

  for (const key of QUOTE_BOOL_FIELDS) {
    if (quote[key] == null) continue;
    out[key] = Boolean(quote[key]);
  }

  // dimensionesCm: objeto { l, w, h } numérico y positivo
  if (quote.dimensionesCm != null) {
    const dim = quote.dimensionesCm;
    if (typeof dim !== 'object' || Array.isArray(dim)) {
      return { ok: false, error: 'Las dimensiones son inválidas.' };
    }
    const l = Number(dim.l), w = Number(dim.w), h = Number(dim.h);
    if (![l, w, h].every((x) => Number.isFinite(x) && x >= 0)) {
      return { ok: false, error: 'Las dimensiones deben ser números válidos.' };
    }
    out.dimensionesCm = { l, w, h };
  }

  // productoLink opcional (sanitizado o eliminado)
  if (quote.productoLink != null && quote.productoLink !== '') {
    const link = sanitizeProductoLink(quote.productoLink);
    if (link) out.productoLink = link;
  }

  if (out.version == null) out.version = 1;

  return { ok: true, value: out };
}

module.exports = {
  EMAIL_RE,
  cleanString,
  stripControlChars,
  validateUsername,
  validatePassword,
  validateFullName,
  validateEmail,
  isEmail,
  isUUID,
  sanitizeProductoLink,
  sanitizeImportQuote,
  PRODUCTO_LINK_MAX_LEN,
};
