'use strict';

const CALCULATION_VERSION = 'dayzo-import-v2';

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
  const unitPrice = requiredPositive(raw, 'precioMercanciaPorUnidadUSD', LIMITS.unitPriceUsd);
  if (!unitPrice.ok) return unitPrice;
  const chinaShipping = optionalNonNegative(
    raw,
    'envioChinaPorCajaUSD',
    LIMITS.chinaShippingPerBoxUsd
  );
  if (!chinaShipping.ok) return chinaShipping;
  const platformFee = optionalNonNegative(raw, 'feePlataforma', LIMITS.feeRate, 0.03);
  if (!platformFee.ok) return platformFee;
  const bankFee = optionalNonNegative(raw, 'feeBanco', LIMITS.feeRate, 0.0125);
  if (!bankFee.ok) return bankFee;
  const salePrice = optionalNonNegative(raw, 'ventaUnitarioUSD', LIMITS.saleUnitPriceUsd, 0);
  if (!salePrice.ok) return salePrice;

  return {
    ok: true,
    value: {
      empresaNombre: String(raw.empresaNombre || inferCompanyName(tariff.value)).slice(0, 120),
      empresaTarifaUSD: tariff.value,
      cajas: boxes.value,
      unidadesPorCaja: unitsPerBox.value,
      dimensionesCm: { l: length.value, w: width.value, h: height.value },
      pesoPorCajaKg: weight.value,
      precioMercanciaPorUnidadUSD: unitPrice.value,
      envioChinaPorCajaUSD: chinaShipping.value,
      feePlataforma: platformFee.value,
      feeBanco: bankFee.value,
      ventaUnitarioUSD: salePrice.value,
      entradaRaw: raw.entradaRaw == null ? '' : String(raw.entradaRaw).slice(0, 600),
      productoLink: raw.productoLink || null,
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

  const output = {
    version: 2,
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
    precioMercanciaPorUnidadUSD: input.precioMercanciaPorUnidadUSD,
    envioChinaPorCajaUSD: input.envioChinaPorCajaUSD,
    ...shipping,
    costoMercanciaUSD: merchandiseUsd,
    envioChinaUSD: chinaShippingUsd,
    plataformaUSD: platformUsd,
    comisionBancoUSD: bankUsd,
    subtotalUSD: subtotalUsd,
    inversionTotalUSD: investmentUsd,
    costoUnitarioUSD: unitCostUsd,
    costoPorCajaUSD: boxCostUsd,
    feePlataforma: input.feePlataforma,
    feeBanco: input.feeBanco,
    input: {
      empresaTarifaUSD: input.empresaTarifaUSD,
      cajas: input.cajas,
      unidadesPorCaja: input.unidadesPorCaja,
      dimensionesCm: { ...input.dimensionesCm },
      pesoPorCajaKg: input.pesoPorCajaKg,
      precioMercanciaPorUnidadUSD: input.precioMercanciaPorUnidadUSD,
      envioChinaPorCajaUSD: input.envioChinaPorCajaUSD,
      feePlataforma: input.feePlataforma,
      feeBanco: input.feeBanco,
      ventaUnitarioUSD: input.ventaUnitarioUSD || null,
    },
  };
  if (input.productoLink) output.productoLink = input.productoLink;
  if (salePlan) Object.assign(output, salePlan);
  return output;
}

function canonicalizeImportQuote(raw) {
  const normalized = normalizeImportInput(raw);
  if (!normalized.ok) return normalized;
  return { ok: true, value: calculateImportQuote(normalized.value) };
}

module.exports = {
  CALCULATION_VERSION,
  COMPANY_TARIFFS,
  LIMITS,
  ORINOCO_MIN_USD,
  ORINOCO_MIN_VOLUME_M3,
  calculateImportQuote,
  calculateSalePlan,
  calculateShipping,
  canonicalizeImportQuote,
  companyKind,
  inferCompanyName,
  normalizeImportInput,
};
