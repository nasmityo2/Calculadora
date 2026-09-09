'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CALCULATION_VERSION,
  calculateSalePlan,
  canonicalizeImportQuote,
} = require('../../src/domain/import-calculation');

function approx(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `esperado ${expected} ± ${tolerance}; recibido ${actual}`
  );
}

function baseInput(overrides = {}) {
  return {
    empresaNombre: 'Orinoco',
    empresaTarifaUSD: 865,
    cajas: 1,
    unidadesPorCaja: 24,
    unidadesTotales: 24,
    dimensionesCm: { l: 20, w: 20, h: 20 },
    pesoPorCajaKg: 5,
    precioMercanciaPorUnidadUSD: 2,
    envioChinaPorCajaUSD: 4,
    feePlataforma: 0.03,
    feeBanco: 0.0125,
    ...overrides,
  };
}

test('GCCARGO cobra volumen puro sin mínimo', () => {
  const result = canonicalizeImportQuote(baseInput({
    empresaNombre: 'GCCARGO',
    empresaTarifaUSD: 770,
    cajas: 2,
    unidadesTotales: 48,
    dimensionesCm: { l: 100, w: 100, h: 100 },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.tipoCobro, 'Volumen');
  assert.equal(result.value.tarifaMinAplicada, false);
  approx(result.value.volumenM3, 2);
  approx(result.value.fletePorCajaUSD, 770);
  approx(result.value.envioInternacionalUSD, 1540);
});

test('Orinoco conserva mínimo de 35 USD por caja', () => {
  const result = canonicalizeImportQuote(baseInput({
    cajas: 2,
    unidadesTotales: 48,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.tipoCobro, 'Vol. (mín. $35)');
  assert.equal(result.value.tarifaMinAplicada, true);
  approx(result.value.fletePorCajaUSD, 35);
  approx(result.value.envioInternacionalUSD, 70);
  approx(result.value.inversionTotalUSD, 178.42);
  approx(result.value.costoUnitarioUSD, 178.42 / 48);
});

test('import2ven selecciona peso para densidad mayor a 1000', () => {
  const result = canonicalizeImportQuote(baseInput({
    empresaNombre: 'import2ven',
    empresaTarifaUSD: 1030,
    dimensionesCm: { l: 10, w: 10, h: 10 },
    pesoPorCajaKg: 2,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.tipoCobro, 'Peso');
  approx(result.value.volumenM3, 0.001);
  // 2 kg × 1.03 = 2.06; contrato legacy redondea el flete al dólar superior.
  approx(result.value.envioInternacionalUSD, 3);
});

test('import2ven aplica +50 por densidad media y volumen puro por densidad baja', () => {
  const medium = canonicalizeImportQuote(baseInput({
    empresaNombre: 'import2ven',
    empresaTarifaUSD: 1030,
    dimensionesCm: { l: 100, w: 100, h: 100 },
    pesoPorCajaKg: 500,
  }));
  assert.equal(medium.ok, true);
  assert.equal(medium.value.tipoCobro, 'Volumen (+Den)');
  approx(medium.value.envioInternacionalUSD, 1080);

  const low = canonicalizeImportQuote(baseInput({
    empresaNombre: 'import2ven',
    empresaTarifaUSD: 1030,
    dimensionesCm: { l: 100, w: 100, h: 100 },
    pesoPorCajaKg: 100,
  }));
  assert.equal(low.ok, true);
  assert.equal(low.value.tipoCobro, 'Volumen');
  approx(low.value.envioInternacionalUSD, 1030);
});

test('tarifa personalizada usa la misma regla de densidad', () => {
  const result = canonicalizeImportQuote(baseInput({
    empresaNombre: 'Mi courier',
    empresaTarifaUSD: 500,
    dimensionesCm: { l: 100, w: 100, h: 100 },
    pesoPorCajaKg: 500,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.tipoCobro, 'Volumen (+Den)');
  approx(result.value.envioInternacionalUSD, 550);
});

test('múltiples cajas, envío China y comisiones mantienen el vector legacy', () => {
  const result = canonicalizeImportQuote(baseInput({
    cajas: 2,
    unidadesTotales: 48,
    ventaUnitarioUSD: 5,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.calculationVersion, CALCULATION_VERSION);
  approx(result.value.costoMercanciaUSD, 96);
  approx(result.value.envioChinaUSD, 8);
  approx(result.value.plataformaUSD, 3.12);
  approx(result.value.comisionBancoUSD, 1.3);
  approx(result.value.subtotalUSD, 108.42);
  approx(result.value.inversionTotalUSD, 178.42);
  approx(result.value.costoPorCajaUSD, 89.21);
  assert.deepEqual(result.value.input.dimensionesCm, { l: 20, w: 20, h: 20 });
});

test('ROI usa costo y margen usa precio de venta', () => {
  const plan = calculateSalePlan({
    unitCostUsd: 10,
    unitsPerBox: 5,
    totalUnits: 20,
    saleUnitPriceUsd: 15,
  });
  approx(plan.gananciaUnitariaUSD, 5);
  approx(plan.gananciaTotalUSD, 100);
  approx(plan.roiVentaPct, 50);
  approx(plan.margenVentaPct, 100 / 3);
  assert.notEqual(plan.roiVentaPct, plan.margenVentaPct);
});

test('no redondea comisiones ni costos internos antes del resultado', () => {
  const result = canonicalizeImportQuote(baseInput({
    precioMercanciaPorUnidadUSD: 1.99,
    envioChinaPorCajaUSD: 0.37,
  }));
  assert.equal(result.ok, true);
  const base = 24 * 1.99 + 0.37;
  approx(result.value.plataformaUSD, base * 0.03);
  approx(result.value.comisionBancoUSD, base * 0.0125);
});

test('rechaza ceros, negativos, extremos y relaciones inconsistentes', () => {
  const invalidCases = [
    [baseInput({ cajas: 0 }), 'INVALID_POSITIVE_NUMBER'],
    [baseInput({ unidadesPorCaja: -1 }), 'INVALID_POSITIVE_NUMBER'],
    [baseInput({ unidadesTotales: 25 }), 'INCONSISTENT_TOTAL_UNITS'],
    [baseInput({ dimensionesCm: { l: 0, w: 20, h: 20 } }), 'INVALID_POSITIVE_NUMBER'],
    [baseInput({ pesoPorCajaKg: Number.POSITIVE_INFINITY }), 'INVALID_POSITIVE_NUMBER'],
    [baseInput({ precioMercanciaPorUnidadUSD: 1_000_001 }), 'VALUE_OUT_OF_RANGE'],
    [baseInput({ feePlataforma: 0.51 }), 'VALUE_OUT_OF_RANGE'],
    [baseInput({ envioChinaPorCajaUSD: -1 }), 'INVALID_NON_NEGATIVE_NUMBER'],
  ];
  for (const [input, code] of invalidCases) {
    const result = canonicalizeImportQuote(input);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
  }
});

test('el envío China en yuanes se convierte con la tasa del servidor', () => {
  const enYuan = canonicalizeImportQuote(
    baseInput({ envioChinaPorCajaUSD: undefined, envioChinaPrice: { amount: 28, currency: 'CNY' } }),
    { cnyRate: 7, cnySource: 'bcv' }
  );
  assert.equal(enYuan.ok, true, enYuan.error?.message);
  // 28 ¥ / 7 = $4 por caja, igual que declararlo directamente en dólares.
  approx(enYuan.value.envioChinaPorCajaUSD, 4);
  approx(enYuan.value.envioChinaUSD, 4);
  assert.deepEqual(enYuan.value.envioChinaPrice, { amount: 28, currency: 'CNY' });

  const enUsd = canonicalizeImportQuote(baseInput({ envioChinaPorCajaUSD: 4 }), {
    cnyRate: 7,
    cnySource: 'bcv',
  });
  approx(enUsd.value.inversionTotalUSD, enYuan.value.inversionTotalUSD);
  assert.deepEqual(enUsd.value.envioChinaPrice, { amount: 4, currency: 'USD' });
});

test('el envío China rechaza montos negativos y monedas desconocidas', () => {
  const negativo = canonicalizeImportQuote(
    baseInput({ envioChinaPorCajaUSD: undefined, envioChinaPrice: { amount: -1, currency: 'CNY' } })
  );
  assert.equal(negativo.ok, false);
  assert.equal(negativo.error.code, 'INVALID_CHINA_SHIPPING');

  const moneda = canonicalizeImportQuote(
    baseInput({ envioChinaPorCajaUSD: undefined, envioChinaPrice: { amount: 10, currency: 'EUR' } })
  );
  assert.equal(moneda.ok, false);
  assert.equal(moneda.error.code, 'INVALID_CHINA_SHIPPING_CURRENCY');
});
