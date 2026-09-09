(function initSaleCalculations(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DayzoSaleCalculations = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSaleCalculations() {
  'use strict';

  const LIMITS = Object.freeze({
    costUsd: 10_000_000,
    input: 1_000_000_000,
    count: 10_000_000,
    rate: 1_000_000,
    roiPct: 10_000,
  });

  function positive(value, max) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number <= max ? number : null;
  }

  function nonNegative(value, max) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
  }

  /**
   * Simula una venta. `mode` decide en qué moneda escribes el precio:
   *   priceUsd → USDT (base de todos los cálculos)
   *   priceCny → yuanes, convertidos con `cnyPerUsd`
   *   priceVes → bolívares, convertidos con `vesPerUsd` (compatibilidad)
   *   roi      → porcentaje de rentabilidad sobre el costo
   * El resultado siempre sale en USD/USDT; la vista añade BCV y yuanes.
   */
  function calculateSaleSimulation({
    costUsd,
    inputValue,
    mode = 'priceUsd',
    vesPerUsd = 0,
    cnyPerUsd = 0,
    count = 1,
  }) {
    const cost = positive(costUsd, LIMITS.costUsd);
    const input = nonNegative(inputValue, LIMITS.input);
    const quantity = positive(count, LIMITS.count);
    if (cost == null) return { ok: false, code: 'INVALID_COST', message: 'El costo debe ser mayor que cero.' };
    if (input == null || input === 0) return { ok: false, code: 'INVALID_INPUT', message: 'Ingresa un valor mayor que cero.' };
    if (quantity == null) return { ok: false, code: 'INVALID_COUNT', message: 'La cantidad no es válida.' };

    let saleUsd;
    if (mode === 'priceUsd') {
      saleUsd = input;
    } else if (mode === 'priceVes') {
      const rate = positive(vesPerUsd, LIMITS.rate);
      if (rate == null) return { ok: false, code: 'INVALID_RATE', message: 'No hay una tasa P2P válida.' };
      saleUsd = input / rate;
    } else if (mode === 'priceCny') {
      const rate = positive(cnyPerUsd, LIMITS.rate);
      if (rate == null) return { ok: false, code: 'INVALID_CNY_RATE', message: 'No hay una tasa de yuan válida.' };
      saleUsd = input / rate;
    } else if (mode === 'roi') {
      if (input > LIMITS.roiPct) return { ok: false, code: 'ROI_OUT_OF_RANGE', message: 'El ROI supera el máximo permitido.' };
      saleUsd = cost * (1 + input / 100);
    } else {
      return { ok: false, code: 'INVALID_MODE', message: 'Modo de simulación inválido.' };
    }

    if (!Number.isFinite(saleUsd) || saleUsd <= 0 || saleUsd > LIMITS.input) {
      return { ok: false, code: 'INVALID_SALE_PRICE', message: 'El precio de venta no es válido.' };
    }
    const profitUsd = saleUsd - cost;
    const roiPct = (profitUsd / cost) * 100;
    const marginPct = (profitUsd / saleUsd) * 100;
    return {
      ok: true,
      value: {
        costUsd: cost,
        saleUsd,
        profitUsd,
        totalProfitUsd: profitUsd * quantity,
        roiPct,
        marginPct,
        breakEvenUsd: cost,
        count: quantity,
      },
    };
  }

  return { LIMITS, calculateSaleSimulation };
}));
