(function initImportParser(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DayzoImportParser = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createImportParser() {
  'use strict';

  const CURRENCIES = Object.freeze(['CNY', 'USD']);
  // Mismo tope que src/domain/purchase-price.js: sin él, la web calculaba una
  // cotización que el servidor rechazaba recién al guardarla.
  const AMOUNT_LIMIT = 1000000;

  function parseLocaleAmount(raw) {
    if (raw == null) return null;
    let s = String(raw).trim();
    if (!s) return null;
    s = s.replace(/\s+/g, '').replace(/[^\d.,\-]/g, '');
    if (!s || s === '-' || s === '.' || s === ',') return null;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
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

  function fail(code, message) {
    return { ok: false, error: { code, message } };
  }

  function parsePurchasePriceToken(token, defaultCurrency = null) {
    if (token == null) return fail('MISSING_PURCHASE_PRICE', 'Falta el precio de compra.');
    const raw = String(token).trim();
    if (!raw) return fail('MISSING_PURCHASE_PRICE', 'Falta el precio de compra.');

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
    if (!currency) currency = normalizeCurrency(defaultCurrency);
    if (!currency) {
      return fail(
        'AMBIGUOUS_PURCHASE_CURRENCY',
        'Indica la moneda con ¥/$ o sufijo cny/usd, o elige CNY/USD en el selector.'
      );
    }
    const amount = parseLocaleAmount(amountPart);
    if (amount == null || !(amount > 0)) {
      return fail('INVALID_PURCHASE_AMOUNT', 'El precio de compra debe ser un número mayor que cero.');
    }
    if (amount > AMOUNT_LIMIT) {
      return fail('VALUE_OUT_OF_RANGE', `El precio de compra supera el máximo permitido (${AMOUNT_LIMIT}).`);
    }
    return { ok: true, value: { amount, currency } };
  }

  /**
   * Entrada rápida: LxAxA peso unidades precio[moneda] [envio[moneda]] [cajas]
   * Ej: 30x30x30 15 50 32.5cny 4usdt 2
   */
  function parseQuickImportLine(line, { defaultCurrency = 'CNY' } = {}) {
    if (line == null || !String(line).trim()) {
      return fail('EMPTY_QUICK_INPUT', 'Escribe dimensiones, peso, unidades y precio.');
    }
    const clean = String(line).trim().replace(/[/\\*]/g, 'x').replace(/\s+/g, ' ');
    const tokens = clean.split(' ');
    if (tokens.length < 4) {
      return fail('INVALID_QUICK_FORMAT', 'Formato: 30x30x30 15 50 32.5cny 4usdt 2');
    }
    const dims = (tokens[0] || '').toLowerCase().split('x');
    if (dims.length !== 3) return fail('INVALID_DIMENSIONS', 'Las dimensiones deben ser LxAxA.');
    const l = parseLocaleAmount(dims[0]);
    const w = parseLocaleAmount(dims[1]);
    const h = parseLocaleAmount(dims[2]);
    const peso = parseLocaleAmount(tokens[1]);
    const unidades = Number.parseInt(tokens[2], 10);
    if ([l, w, h, peso].some((n) => n == null || !(n > 0)) || !Number.isSafeInteger(unidades) || unidades <= 0) {
      return fail('INVALID_QUICK_NUMBERS', 'Revisa dimensiones, peso y unidades; deben ser mayores que cero.');
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
        return fail('INVALID_CHINA_SHIPPING', 'El envío China debe ser un monto válido en CNY o USDT.');
      }
      shippingPrice = shipping.value;
      next = shippingEnd;
    }
    const cajasRaw = next < tokens.length ? Number.parseInt(tokens[next], 10) : 1;
    if (next < tokens.length && (!Number.isSafeInteger(cajasRaw) || cajasRaw <= 0)) {
      return fail('INVALID_BOXES', 'El número de cajas debe ser un entero mayor que cero.');
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

  function purchaseToUsd(purchasePrice, cnyRate) {
    const amount = Number(purchasePrice?.amount);
    const currency = normalizeCurrency(purchasePrice?.currency);
    const rate = Number(cnyRate);
    if (!(amount > 0) || !currency) return null;
    if (currency === 'USD') return amount;
    if (!(rate > 0)) return null;
    return amount / rate;
  }

  function convertDisplayedAmount(amount, fromCurrency, toCurrency, cnyRate) {
    const a = Number(amount);
    const rate = Number(cnyRate);
    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);
    if (!(a > 0) || !from || !to || !(rate > 0)) return null;
    if (from === to) return a;
    if (from === 'CNY' && to === 'USD') return a / rate;
    if (from === 'USD' && to === 'CNY') return a * rate;
    return null;
  }

  function formatAmountForInput(value) {
    if (!(Number(value) > 0)) return '';
    const n = Number(value);
    const fixed = Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(4).replace(/\.?0+$/, '');
    return fixed;
  }

  return {
    AMOUNT_LIMIT,
    CURRENCIES,
    convertDisplayedAmount,
    formatAmountForInput,
    normalizeCurrency,
    parseLocaleAmount,
    parsePurchasePriceToken,
    parseQuickImportLine,
    purchaseToUsd,
  };
}));
