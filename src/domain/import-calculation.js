'use strict';

const PurchasePrice = require('./purchase-price');

const CALCULATION_VERSION = 'dayzo-import-v3';

const COMPANY_TARIFFS = Object.freeze({
  gccargo: 770,
  orinoco: 865,
  import2ven: 1030,
});

const LIMITS = Object.freeze({
  boxes: 10_000,
  unitsPerBox: 1_000_000,
  totalUnits: 10_000_000,
  dimensionCm: 100_000,
  weightPerBoxKg: 1_000_000,
  unitPriceUsd: 1_000_000,
  chinaShippingPerBoxUsd: 1_000_000,
  companyTariffUsd: 100_000,
  feeRate: 0.5,
  saleUnitPriceUsd: 10_000_000,
});

const ORINOCO_MIN_USD = 35;
const ORINOCO_MIN_VOLUME_M3 = 0.035;
const CNY_FALLBACK_RATE = 6.53;

function error(code, message) {
  return { ok: false, error: { code, message } };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requiredPositive(raw, field, max) {
  const value = finiteNumber(raw[field]);
  if (value == null || value <= 0) {
    return error('INVALID_POSITIVE_NUMBER', `El campo "${field}" debe ser mayor que cero.`);
  }
  if (value > max) {
    return error('VALUE_OUT_OF_RANGE', `El campo "${field}" supera el máximo permitido (${max}).`);
  }
  return { ok: true, value };
}

function requiredInteger(raw, field, max) {
  const result = requiredPositive(raw, field, max);
  if (!result.ok) return result;
  if (!Number.isSafeInteger(result.value)) {
    return error('INVALID_INTEGER', `El campo "${field}" debe ser un entero seguro.`);
  }
  return result;
}

function optionalNonNegative(raw, field, max, fallback = 0) {
  if (raw[field] == null || raw[field] === '') return { ok: true, value: fallback };
  const value = finiteNumber(raw[field]);
  if (value == null || value < 0) {
    return error('INVALID_NON_NEGATIVE_NUMBER', `El campo "${field}" no puede ser negativo.`);
  }
  if (value > max) {
    return error('VALUE_OUT_OF_RANGE', `El campo "${field}" supera el máximo permitido (${max}).`);
  }
  return { ok: true, value };
}

function companyKind(tariff) {
  if (tariff === COMPANY_TARIFFS.gccargo) return 'gccargo';
  if (tariff === COMPANY_TARIFFS.orinoco) return 'orinoco';
  if (tariff === COMPANY_TARIFFS.import2ven) return 'import2ven';
  return 'custom';
}

function inferCompanyName(tariff) {
  const kind = companyKind(tariff);
  if (kind === 'gccargo') return 'GCCARGO';
  if (kind === 'orinoco') return 'Orinoco';
  if (kind === 'import2ven') return 'import2ven';
  return 'Personalizado';
}

/**
 * Envío dentro de China por caja. Acepta `envioChinaPrice` { amount, currency }
 * (CNY o USD) y, por compatibilidad, `envioChinaPorCajaUSD` numérico.
 * Siempre devuelve el monto en USD más la moneda original para poder mostrarlo.
 */
function resolveChinaShipping(raw, cnyRate) {
  const price = raw.envioChinaPrice;
  if (price != null && typeof price === 'object' && !Array.isArray(price)) {
    const amount = finiteNumber(price.amount);
    if (amount == null || amount < 0) {
      return error('INVALID_CHINA_SHIPPING', 'El envío China no puede ser negativo.');
    }
    const currency = PurchasePrice.normalizeCurrency(price.currency);
    if (!currency) {
      return error('INVALID_CHINA_SHIPPING_CURRENCY', 'La moneda del envío China debe ser CNY o USD.');
    }
    const usd = currency === 'CNY' ? amount / cnyRate : amount;
    if (!Number.isFinite(usd) || usd > LIMITS.chinaShippingPerBoxUsd) {
      return error('VALUE_OUT_OF_RANGE', `El envío China supera el máximo permitido (${LIMITS.chinaShippingPerBoxUsd}).`);
    }
    return { ok: true, value: usd, currency, originalAmount: amount };
  }

  const legacy = optionalNonNegative(raw, 'envioChinaPorCajaUSD', LIMITS.chinaShippingPerBoxUsd);
  if (!legacy.ok) return legacy;
  return { ok: true, value: legacy.value, currency: 'USD', originalAmount: legacy.value };
}

function normalizeImportInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return error('INVALID_QUOTE', 'El objeto de cotización es inválido.');
  }

  const tariffSource = raw.empresaTarifaUSD ?? raw.empresaEnvioUSD;
  const normalizedRaw = { ...raw, empresaTarifaUSD: tariffSource };
  const tariff = requiredPositive(normalizedRaw, 'empresaTarifaUSD', LIMITS.companyTariffUsd);
  if (!tariff.ok) return tariff;
  const boxes = requiredInteger(raw, 'cajas', LIMITS.boxes);
  if (!boxes.ok) return boxes;
  const unitsPerBox = requiredInteger(raw, 'unidadesPorCaja', LIMITS.unitsPerBox);
  if (!unitsPerBox.ok) return unitsPerBox;

  const totalUnits = boxes.value * unitsPerBox.value;
  if (!Number.isSafeInteger(totalUnits) || totalUnits > LIMITS.totalUnits) {
    return error('TOTAL_UNITS_OUT_OF_RANGE', `El total de unidades supera ${LIMITS.totalUnits}.`);
  }
  if (raw.unidadesTotales != null && Number(raw.unidadesTotales) !== totalUnits) {
    return error(
      'INCONSISTENT_TOTAL_UNITS',
      'unidadesTotales debe ser igual a cajas × unidadesPorCaja.'
    );
  }

  const dimensions = raw.dimensionesCm;
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) {
    return error('INVALID_DIMENSIONS', 'Las dimensiones son requeridas.');
  }
  const length = requiredPositive(dimensions, 'l', LIMITS.dimensionCm);
  if (!length.ok) return length;
  const width = requiredPositive(dimensions, 'w', LIMITS.dimensionCm);
  if (!width.ok) return width;
  const height = requiredPositive(dimensions, 'h', LIMITS.dimensionCm);
  if (!height.ok) return height;

  const weight = requiredPositive(raw, 'pesoPorCajaKg', LIMITS.weightPerBoxKg);
  if (!weight.ok) return weight;

  // Tasa CNY solo desde servidor (options) o snapshot congelado en lectura.
  // Nunca confiar en cnyRateRequested del cliente para convertir.
  const serverCnyRate = finiteNumber(raw._serverCnyRate);
  const snapshotCny = finiteNumber(raw.rateSnapshot?.cny);
  const cnyRate = serverCnyRate > 0
    ? serverCnyRate
    : (snapshotCny > 0 ? snapshotCny : CNY_FALLBACK_RATE);
  const cnySource = serverCnyRate > 0
    ? (raw._serverCnySource || 'live')
    : (snapshotCny > 0 ? (raw.rateSnapshot?.cnySource || 'snapshot') : 'fallback');

  let purchaseResolved;
  if (raw.purchasePrice != null) {
    purchaseResolved = PurchasePrice.resolvePurchasePriceToUsd(raw.purchasePrice, cnyRate);
    if (!purchaseResolved.ok) return purchaseResolved;
  } else {
    const unitPrice = requiredPositive(raw, 'precioMercanciaPorUnidadUSD', LIMITS.unitPriceUsd);
    if (!unitPrice.ok) return unitPrice;
    // Compat v1/v2: precio ya en USD; CNY equivalente con tasa de snapshot/servidor.
    purchaseResolved = {
      ok: true,
      value: {
        purchasePriceOriginalAmount: unitPrice.value,
        purchasePriceOriginalCurrency: 'USD',
        precioMercanciaPorUnidadUSD: unitPrice.value,
        precioMercanciaPorUnidadCNY: unitPrice.value * cnyRate,
        cnyRateUsed: cnyRate,
        legacyUsdOnly: true,
      },
    };
  }

  const chinaShipping = resolveChinaShipping(raw, cnyRate);
  if (!chinaShipping.ok) return chinaShipping;
  const platformFee = optionalNonNegative(raw, 'feePlataforma', LIMITS.feeRate, 0.03);
  if (!platformFee.ok) return platformFee;
  const bankFee = optionalNonNegative(raw, 'feeBanco', LIMITS.feeRate, 0.0125);
  if (!bankFee.ok) return bankFee;
  const salePrice = optionalNonNegative(raw, 'ventaUnitarioUSD', LIMITS.saleUnitPriceUsd, 0);
  if (!salePrice.ok) return salePrice;

  const purchase = purchaseResolved.value;
  return {
    ok: true,
    value: {
      empresaNombre: String(raw.empresaNombre || inferCompanyName(tariff.value)).slice(0, 120),
      empresaTarifaUSD: tariff.value,
      cajas: boxes.value,
      unidadesPorCaja: unitsPerBox.value,
      dimensionesCm: { l: length.value, w: width.value, h: height.value },
      pesoPorCajaKg: weight.value,
      precioMercanciaPorUnidadUSD: purchase.precioMercanciaPorUnidadUSD,
      precioMercanciaPorUnidadCNY: purchase.precioMercanciaPorUnidadCNY,
      purchasePriceOriginalAmount: purchase.purchasePriceOriginalAmount,
      purchasePriceOriginalCurrency: purchase.purchasePriceOriginalCurrency,
      purchasePrice: {
        amount: purchase.purchasePriceOriginalAmount,
        currency: purchase.purchasePriceOriginalCurrency,
      },
      envioChinaPorCajaUSD: chinaShipping.value,
      envioChinaPrice: {
        amount: chinaShipping.originalAmount,
        currency: chinaShipping.currency,
      },
      feePlataforma: platformFee.value,
      feeBanco: bankFee.value,
      ventaUnitarioUSD: salePrice.value,
      entradaRaw: raw.entradaRaw == null ? '' : String(raw.entradaRaw).slice(0, 600),
      productoLink: raw.productoLink || null,
      productoFotos: Array.isArray(raw.productoFotos) ? raw.productoFotos.slice() : [],
      _cnyRateUsed: purchase.cnyRateUsed || cnyRate,
      _cnySource: cnySource,
      _legacyUsdOnly: Boolean(purchase.legacyUsdOnly),
    },
  };
}

function calculateShipping(input) {
  const {
    empresaTarifaUSD: tariff,
    cajas,
    dimensionesCm,
    pesoPorCajaKg,
  } = input;
  const volumePerBoxM3 = (
    dimensionesCm.l * dimensionesCm.w * dimensionesCm.h
  ) / 1_000_000;
  const weightKg = pesoPorCajaKg * cajas;
  const kind = companyKind(tariff);

  let volumeM3;
  let shippingUsd;
  let shippingPerBoxUsd;
  let chargeType;
  let minimumApplied = false;

  if (kind === 'gccargo') {
    volumeM3 = volumePerBoxM3 * cajas;
    shippingPerBoxUsd = tariff * volumePerBoxM3;
    shippingUsd = tariff * volumeM3;
    chargeType = 'Volumen';
  } else if (kind === 'orinoco') {
    volumeM3 = volumePerBoxM3 * cajas;
    const volumePrice = volumePerBoxM3 * tariff;
    shippingPerBoxUsd = volumePerBoxM3 < ORINOCO_MIN_VOLUME_M3
      ? Math.max(volumePrice, ORINOCO_MIN_USD)
      : volumePrice;
    minimumApplied = (
      volumePerBoxM3 < ORINOCO_MIN_VOLUME_M3
      && shippingPerBoxUsd === ORINOCO_MIN_USD
    );
    shippingUsd = shippingPerBoxUsd * cajas;
    chargeType = minimumApplied ? 'Vol. (mín. $35)' : 'Volumen';
  } else {
    // Contrato legado import2ven/personalizado: volumen total redondeado hacia
    // arriba a milésimas antes de evaluar densidad.
    volumeM3 = Math.ceil(volumePerBoxM3 * cajas * 1000) / 1000;
    const density = volumeM3 > 0 ? weightKg / volumeM3 : 0;
    let computed;
    if (density > 1000) {
      computed = weightKg * (tariff / 1000);
      chargeType = 'Peso';
    } else {
      let effectiveTariff = tariff;
      if (density >= 380 && density <= 1000) {
        effectiveTariff += 50;
        chargeType = 'Volumen (+Den)';
      } else {
        chargeType = 'Volumen';
      }
      computed = volumeM3 * effectiveTariff;
    }
    shippingUsd = Math.ceil(computed);
    shippingPerBoxUsd = shippingUsd / cajas;
  }

  return {
    volumenM3: volumeM3,
    volumenPorCajaM3: volumePerBoxM3,
    pesoKg: weightKg,
    envioInternacionalUSD: shippingUsd,
    fletePorCajaUSD: shippingPerBoxUsd,
    tipoCobro: chargeType,
    tarifaMinAplicada: minimumApplied,
  };
}

function calculateSalePlan({ unitCostUsd, unitsPerBox, totalUnits, saleUnitPriceUsd }) {
  if (!(saleUnitPriceUsd > 0)) return null;
  const unitProfitUsd = saleUnitPriceUsd - unitCostUsd;
  return {
    ventaUnitarioUSD: saleUnitPriceUsd,
    ventaPorCajaUSD: saleUnitPriceUsd * unitsPerBox,
    gananciaUnitariaUSD: unitProfitUsd,
    gananciaTotalUSD: unitProfitUsd * totalUnits,
    roiVentaPct: unitCostUsd > 0 ? (unitProfitUsd / unitCostUsd) * 100 : 0,
    margenVentaPct: (unitProfitUsd / saleUnitPriceUsd) * 100,
  };
}

function cnyEquivalent(usdAmount, cnyRate) {
  const usd = finiteNumber(usdAmount);
  const rate = finiteNumber(cnyRate);
  if (usd == null || rate == null || !(rate > 0)) return null;
  return usd * rate;
}

function calculateImportQuote(input) {
  const shipping = calculateShipping(input);
  const totalUnits = input.cajas * input.unidadesPorCaja;
  const merchandiseUsd = totalUnits * input.precioMercanciaPorUnidadUSD;
  const chinaShippingUsd = input.envioChinaPorCajaUSD * input.cajas;
  const commissionBaseUsd = merchandiseUsd + chinaShippingUsd;
  const platformUsd = commissionBaseUsd * input.feePlataforma;
  const bankUsd = commissionBaseUsd * input.feeBanco;
  const subtotalUsd = commissionBaseUsd + platformUsd + bankUsd;
  const investmentUsd = subtotalUsd + shipping.envioInternacionalUSD;
  const unitCostUsd = investmentUsd / totalUnits;
  const boxCostUsd = investmentUsd / input.cajas;
  const salePlan = calculateSalePlan({
    unitCostUsd,
    unitsPerBox: input.unidadesPorCaja,
    totalUnits,
    saleUnitPriceUsd: input.ventaUnitarioUSD,
  });

  const cnyRate = finiteNumber(input._cnyRateUsed) > 0
    ? Number(input._cnyRateUsed)
    : CNY_FALLBACK_RATE;
  const unitCny = input.precioMercanciaPorUnidadCNY != null
    ? input.precioMercanciaPorUnidadCNY
    : cnyEquivalent(input.precioMercanciaPorUnidadUSD, cnyRate);

  const output = {
    version: 3,
    calculationVersion: CALCULATION_VERSION,
    entradaRaw: input.entradaRaw,
    empresaNombre: input.empresaNombre,
    empresaTarifaUSD: input.empresaTarifaUSD,
    empresaEnvioUSD: input.empresaTarifaUSD,
    cajas: input.cajas,
    unidadesPorCaja: input.unidadesPorCaja,
    unidadesTotales: totalUnits,
    dimensionesCm: { ...input.dimensionesCm },
    pesoPorCajaKg: input.pesoPorCajaKg,
    purchasePrice: {
      amount: input.purchasePriceOriginalAmount,
      currency: input.purchasePriceOriginalCurrency,
    },
    purchasePriceOriginalAmount: input.purchasePriceOriginalAmount,
    purchasePriceOriginalCurrency: input.purchasePriceOriginalCurrency,
    precioMercanciaPorUnidadUSD: input.precioMercanciaPorUnidadUSD,
    precioMercanciaPorUnidadCNY: unitCny,
    envioChinaPorCajaUSD: input.envioChinaPorCajaUSD,
    envioChinaPrice: { ...input.envioChinaPrice },
    ...shipping,
    costoMercanciaUSD: merchandiseUsd,
    costoMercanciaCNYEquivalent: cnyEquivalent(merchandiseUsd, cnyRate),
    envioChinaUSD: chinaShippingUsd,
    envioChinaCNYEquivalent: cnyEquivalent(chinaShippingUsd, cnyRate),
    plataformaUSD: platformUsd,
    plataformaCNYEquivalent: cnyEquivalent(platformUsd, cnyRate),
    comisionBancoUSD: bankUsd,
    comisionBancoCNYEquivalent: cnyEquivalent(bankUsd, cnyRate),
    subtotalUSD: subtotalUsd,
    envioInternacionalCNYEquivalent: cnyEquivalent(shipping.envioInternacionalUSD, cnyRate),
    inversionTotalUSD: investmentUsd,
    inversionTotalCNYEquivalent: cnyEquivalent(investmentUsd, cnyRate),
    costoUnitarioUSD: unitCostUsd,
    costoUnitarioCNYEquivalent: cnyEquivalent(unitCostUsd, cnyRate),
    costoPorCajaUSD: boxCostUsd,
    costoPorCajaCNYEquivalent: cnyEquivalent(boxCostUsd, cnyRate),
    feePlataforma: input.feePlataforma,
    feeBanco: input.feeBanco,
    rateSnapshot: {
      cny: cnyRate,
      cnySource: input._cnySource || 'fallback',
      capturedAt: new Date().toISOString(),
      stale: input._cnySource === 'fallback',
    },
    input: {
      empresaTarifaUSD: input.empresaTarifaUSD,
      cajas: input.cajas,
      unidadesPorCaja: input.unidadesPorCaja,
      dimensionesCm: { ...input.dimensionesCm },
      pesoPorCajaKg: input.pesoPorCajaKg,
      purchasePrice: {
        amount: input.purchasePriceOriginalAmount,
        currency: input.purchasePriceOriginalCurrency,
      },
      precioMercanciaPorUnidadUSD: input.precioMercanciaPorUnidadUSD,
      envioChinaPorCajaUSD: input.envioChinaPorCajaUSD,
      envioChinaPrice: { ...input.envioChinaPrice },
      feePlataforma: input.feePlataforma,
      feeBanco: input.feeBanco,
      ventaUnitarioUSD: input.ventaUnitarioUSD || null,
    },
  };
  if (input.productoLink) output.productoLink = input.productoLink;
  if (Array.isArray(input.productoFotos) && input.productoFotos.length) {
    output.productoFotos = input.productoFotos.slice();
  }
  if (salePlan) Object.assign(output, salePlan);
  return output;
}

/**
 * @param {object} raw
 * @param {{ cnyRate?: number, cnySource?: string }} [options]
 */
function canonicalizeImportQuote(raw, options = {}) {
  const payload = {
    ...raw,
    _serverCnyRate: options.cnyRate,
    _serverCnySource: options.cnySource,
  };
  // Ignorar tasa arbitraria del cliente
  delete payload.cnyRateRequested;
  const normalized = normalizeImportInput(payload);
  if (!normalized.ok) return normalized;
  return { ok: true, value: calculateImportQuote(normalized.value) };
}

/**
 * Enriquece una cotización legacy/v2 con equivalentes CNY usando snapshot congelado
 * (o fallback marcado), sin recalcular costos USD.
 */
function enrichQuoteWithHistoricalCny(quote) {
  if (!quote || typeof quote !== 'object') return quote;
  const snapRate = finiteNumber(quote.rateSnapshot?.cny);
  const rate = snapRate > 0 ? snapRate : CNY_FALLBACK_RATE;
  const source = snapRate > 0
    ? (quote.rateSnapshot?.cnySource || 'snapshot')
    : 'fallback';
  const out = { ...quote };
  if (!out.rateSnapshot || !finiteNumber(out.rateSnapshot.cny)) {
    out.rateSnapshot = {
      cny: rate,
      cnySource: source,
      capturedAt: quote.rateSnapshot?.capturedAt || null,
      stale: source === 'fallback',
    };
  }
  if (out.purchasePriceOriginalAmount == null && out.precioMercanciaPorUnidadUSD != null) {
    out.purchasePriceOriginalAmount = Number(out.precioMercanciaPorUnidadUSD);
    out.purchasePriceOriginalCurrency = 'USD';
    out.purchasePrice = {
      amount: out.purchasePriceOriginalAmount,
      currency: 'USD',
    };
  }
  if (out.precioMercanciaPorUnidadCNY == null && out.precioMercanciaPorUnidadUSD != null) {
    out.precioMercanciaPorUnidadCNY = cnyEquivalent(out.precioMercanciaPorUnidadUSD, rate);
  }
  const moneyFields = [
    ['costoMercanciaUSD', 'costoMercanciaCNYEquivalent'],
    ['envioChinaUSD', 'envioChinaCNYEquivalent'],
    ['plataformaUSD', 'plataformaCNYEquivalent'],
    ['comisionBancoUSD', 'comisionBancoCNYEquivalent'],
    ['envioInternacionalUSD', 'envioInternacionalCNYEquivalent'],
    ['inversionTotalUSD', 'inversionTotalCNYEquivalent'],
    ['costoUnitarioUSD', 'costoUnitarioCNYEquivalent'],
    ['costoPorCajaUSD', 'costoPorCajaCNYEquivalent'],
  ];
  for (const [usdKey, cnyKey] of moneyFields) {
    if (out[cnyKey] == null && out[usdKey] != null) {
      out[cnyKey] = cnyEquivalent(out[usdKey], rate);
    }
  }
  return out;
}

module.exports = {
  CALCULATION_VERSION,
  CNY_FALLBACK_RATE,
  COMPANY_TARIFFS,
  LIMITS,
  ORINOCO_MIN_USD,
  ORINOCO_MIN_VOLUME_M3,
  calculateImportQuote,
  calculateSalePlan,
  calculateShipping,
  canonicalizeImportQuote,
  companyKind,
  cnyEquivalent,
  enrichQuoteWithHistoricalCny,
  inferCompanyName,
  normalizeImportInput,
};
