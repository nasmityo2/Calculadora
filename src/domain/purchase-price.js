'use strict';

/**
 * Parser puro de precio de compra CNY/USD (DAYZO import v3).
 * No adivina moneda por magnitud. Requiere señal explícita o moneda por defecto.
 */

const CURRENCIES = Object.freeze(['CNY', 'USD']);
const AMOUNT_LIMIT = 1_000_000;

function error(code, message) {
  return { ok: false, error: { code, message } };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Parsea montos con punto o coma decimal (formato VE/ES).
 * No trata puntos/comas como miles si hay un solo separador decimal.
 */
function parseLocaleAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/\s+/g, '').replace(/[^\d.,\-]/g, '');
  if (!s || s === '-' || s === '.' || s === ',') return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeCurrency(raw) {
  if (raw == null || raw === '') return null;
  const c = String(raw).trim().toUpperCase();
  if (c === 'RMB' || c === 'YUAN' || c === 'CN¥' || c === '¥') return 'CNY';
  if (c === 'US$' || c === 'U$S' || c === '$' || c === 'USDT') return 'USD';
  if (CURRENCIES.includes(c)) return c;
  return null;
}

/**
 * Extrae moneda y monto de un token de precio rápido.
 * Ejemplos: 32.5cny, ¥32,5, $4.98, 4.98usd, US$4.98, 32.5 CNY
 */
function parsePurchasePriceToken(token, defaultCurrency = null) {
  if (token == null) {
    return error('MISSING_PURCHASE_PRICE', 'Falta el precio de compra.');
  }
  const raw = String(token).trim();
  if (!raw) {
    return error('MISSING_PURCHASE_PRICE', 'Falta el precio de compra.');
  }

  let currency = null;
  let amountPart = raw;

  const prefixMatch = raw.match(/^(US\$|U\$S|\$|¥|CN¥)\s*(.+)$/i);
  if (prefixMatch) {
    currency = normalizeCurrency(prefixMatch[1]);
    amountPart = prefixMatch[2];
  } else {
    const suffixMatch = raw.match(/^(.+?)(?:\s*)(cny|rmb|yuan|usd|us\$|usdt)$/i);
    if (suffixMatch) {
      amountPart = suffixMatch[1];
      currency = normalizeCurrency(suffixMatch[2]);
    }
  }

  if (!currency) {
    currency = normalizeCurrency(defaultCurrency);
  }
  if (!currency) {
    return error(
      'AMBIGUOUS_PURCHASE_CURRENCY',
      'Indica la moneda con ¥/$ o sufijo cny/usd, o elige CNY/USD en el selector.'
    );
  }

  const amount = parseLocaleAmount(amountPart);
  if (amount == null || !(amount > 0)) {
    return error('INVALID_PURCHASE_AMOUNT', 'El precio de compra debe ser un número mayor que cero.');
  }
  if (amount > AMOUNT_LIMIT) {
    return error('VALUE_OUT_OF_RANGE', `El precio de compra supera el máximo permitido (${AMOUNT_LIMIT}).`);
  }

  return { ok: true, value: { amount, currency } };
}

/**
 * Valida un objeto purchasePrice { amount, currency }.
 */
function normalizePurchasePrice(raw, { defaultCurrency = null } = {}) {
  if (raw == null) {
    return error('MISSING_PURCHASE_PRICE', 'Falta el precio de compra.');
  }

  if (typeof raw === 'string' || typeof raw === 'number') {
    return parsePurchasePriceToken(raw, defaultCurrency);
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return error('INVALID_PURCHASE_PRICE', 'El precio de compra es inválido.');
  }

  const currency = normalizeCurrency(raw.currency) || normalizeCurrency(defaultCurrency);
  if (!currency) {
    return error('INVALID_PURCHASE_CURRENCY', 'La moneda debe ser CNY o USD.');
  }

  const amount = finiteNumber(raw.amount);
  if (amount == null || !(amount > 0)) {
    return error('INVALID_PURCHASE_AMOUNT', 'El precio de compra debe ser un número mayor que cero.');
  }
  if (amount > AMOUNT_LIMIT) {
    return error('VALUE_OUT_OF_RANGE', `El precio de compra supera el máximo permitido (${AMOUNT_LIMIT}).`);
  }

  return { ok: true, value: { amount, currency } };
}

/**
 * Convierte precio de compra a USD canónico usando tasa server-side.
 * USD no se reconvierte. CNY usa cnyRate (CNY por USD).
 */
function resolvePurchasePriceToUsd(purchasePrice, cnyRate) {
  const normalized = normalizePurchasePrice(purchasePrice);
  if (!normalized.ok) return normalized;

  const { amount, currency } = normalized.value;
  const rate = finiteNumber(cnyRate);
  if (currency === 'CNY') {
    if (rate == null || !(rate > 0)) {
      return error('INVALID_CNY_RATE', 'La tasa CNY del servidor no está disponible.');
    }
    return {
      ok: true,
      value: {
        purchasePriceOriginalAmount: amount,
        purchasePriceOriginalCurrency: 'CNY',
        precioMercanciaPorUnidadUSD: amount / rate,
        precioMercanciaPorUnidadCNY: amount,
        cnyRateUsed: rate,
      },
    };
  }

  // USD: no reconvertir base; CNY equivalente informativo si hay tasa
  const cnyEquivalent = rate != null && rate > 0 ? amount * rate : null;
  return {
    ok: true,
    value: {
      purchasePriceOriginalAmount: amount,
      purchasePriceOriginalCurrency: 'USD',
      precioMercanciaPorUnidadUSD: amount,
      precioMercanciaPorUnidadCNY: cnyEquivalent,
      cnyRateUsed: rate != null && rate > 0 ? rate : null,
    },
  };
}

/**
 * Parser de entrada rápida: dims peso unidades precio[moneda] [envio[moneda]] [cajas]
 * Ej: 30x30x30 15 50 32.5cny 4usdt 2
 * La moneda puede ir pegada al monto (32.5cny) o como token aparte (32.5 CNY).
 */
function parseQuickImportLine(line, { defaultCurrency = 'CNY' } = {}) {
  if (line == null || !String(line).trim()) {
    return error('EMPTY_QUICK_INPUT', 'Escribe dimensiones, peso, unidades y precio.');
  }
  const clean = String(line).trim().replace(/[/\\*]/g, 'x').replace(/\s+/g, ' ');
  const tokens = clean.split(' ');
  if (tokens.length < 4) return error('INVALID_QUICK_FORMAT', 'Formato: 30x30x30 15 50 32.5cny 4usdt 2');

  const dims = (tokens[0] || '').toLowerCase().split('x');
  if (dims.length !== 3) return error('INVALID_DIMENSIONS', 'Las dimensiones deben ser LxAxA.');
  const l = parseLocaleAmount(dims[0]);
  const w = parseLocaleAmount(dims[1]);
  const h = parseLocaleAmount(dims[2]);
  const peso = parseLocaleAmount(tokens[1]);
  const unidades = Number.parseInt(tokens[2], 10);
  if ([l, w, h, peso].some((n) => n == null || !(n > 0)) || !Number.isSafeInteger(unidades) || unidades <= 0) {
    return error('INVALID_QUICK_NUMBERS', 'Revisa dimensiones, peso y unidades; deben ser mayores que cero.');
  }

  let priceIndex = 3;
  let priceToken = tokens[3];
  let currencyHint = defaultCurrency;
  if (tokens.length >= 5 && normalizeCurrency(tokens[4]) && !normalizeCurrency(tokens[3]) && parseLocaleAmount(tokens[3]) != null) {
    currencyHint = normalizeCurrency(tokens[4]);
    priceToken = tokens[3];
    priceIndex = 4;
  }
  const purchase = parsePurchasePriceToken(priceToken, currencyHint);
  if (!purchase.ok) return purchase;

  let next = priceIndex === 4 ? 5 : priceIndex + 1;
  let shippingPrice = { amount: 0, currency: 'USD' };
  if (next < tokens.length) {
    let shippingToken = tokens[next];
    let shippingEnd = next + 1;
    if (tokens[next + 1] && normalizeCurrency(tokens[next + 1]) && parseLocaleAmount(shippingToken) != null) {
      shippingToken = `${shippingToken}${tokens[next + 1]}`;
      shippingEnd += 1;
    }
    const shipping = parsePurchasePriceToken(shippingToken, 'USD');
    if (!shipping.ok || !(shipping.value.amount >= 0)) {
      return error('INVALID_CHINA_SHIPPING', 'El envío China debe ser un monto válido en CNY o USDT.');
    }
    shippingPrice = shipping.value;
    next = shippingEnd;
  }
  const cajasRaw = next < tokens.length ? Number.parseInt(tokens[next], 10) : 1;
  if (next < tokens.length && (!Number.isSafeInteger(cajasRaw) || cajasRaw <= 0)) {
    return error('INVALID_BOXES', 'El número de cajas debe ser un entero mayor que cero.');
  }

  return {
    ok: true,
    value: {
      dimensionesCm: { l, w, h },
      pesoPorCajaKg: peso,
      unidadesPorCaja: unidades,
      purchasePrice: purchase.value,
      envioChinaPrice: shippingPrice,
      envioChinaPorCajaUSD: shippingPrice.currency === 'USD' ? shippingPrice.amount : null,
      cajas: Number.isSafeInteger(cajasRaw) && cajasRaw > 0 ? cajasRaw : 1,
      entradaRaw: String(line).trim().slice(0, 600),
    },
  };
}

function convertDisplayedAmount(amount, fromCurrency, toCurrency, cnyRate) {
  const a = finiteNumber(amount);
  const rate = finiteNumber(cnyRate);
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  if (a == null || !(a > 0) || !from || !to || rate == null || !(rate > 0)) {
    return error('INVALID_CURRENCY_CONVERT', 'No se pudo convertir el precio.');
  }
  if (from === to) return { ok: true, value: a };
  if (from === 'CNY' && to === 'USD') return { ok: true, value: a / rate };
  if (from === 'USD' && to === 'CNY') return { ok: true, value: a * rate };
  return error('INVALID_CURRENCY_CONVERT', 'Conversión no soportada.');
}

module.exports = {
  AMOUNT_LIMIT,
  CURRENCIES,
  convertDisplayedAmount,
  normalizeCurrency,
  normalizePurchasePrice,
  parseLocaleAmount,
  parsePurchasePriceToken,
  parseQuickImportLine,
  resolvePurchasePriceToUsd,
};
