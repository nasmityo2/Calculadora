'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { calculateSaleSimulation } = require('../../public/js/sale-calculations');

function approx(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} no está dentro de ${tolerance} de ${expected}`);
}

test('precio USD diferencia ROI sobre costo y margen sobre venta', () => {
  const result = calculateSaleSimulation({
    costUsd: 10,
    inputValue: 15,
    mode: 'priceUsd',
    count: 20,
  });
  assert.equal(result.ok, true);
  approx(result.value.profitUsd, 5);
  approx(result.value.totalProfitUsd, 100);
  approx(result.value.roiPct, 50);
  approx(result.value.marginPct, 100 / 3);
  approx(result.value.breakEvenUsd, 10);
});

test('precio en bolívares usa la tasa P2P indicada', () => {
  const result = calculateSaleSimulation({
    costUsd: 8,
    inputValue: 1200,
    mode: 'priceVes',
    vesPerUsd: 100,
    count: 1,
  });
  assert.equal(result.ok, true);
  approx(result.value.saleUsd, 12);
  approx(result.value.profitUsd, 4);
});

test('preset ROI calcula precio multiplicando el costo', () => {
  const result = calculateSaleSimulation({
    costUsd: 7.5,
    inputValue: 30,
    mode: 'roi',
    count: 4,
  });
  assert.equal(result.ok, true);
  approx(result.value.saleUsd, 9.75);
  approx(result.value.roiPct, 30);
  approx(result.value.totalProfitUsd, 9);
});

test('rechaza costo, tasa, cantidad y valores fuera de rango', () => {
  const cases = [
    [{ costUsd: 0, inputValue: 10, mode: 'priceUsd', count: 1 }, 'INVALID_COST'],
    [{ costUsd: 10, inputValue: -1, mode: 'priceUsd', count: 1 }, 'INVALID_INPUT'],
    [{ costUsd: 10, inputValue: 100, mode: 'priceVes', vesPerUsd: 0, count: 1 }, 'INVALID_RATE'],
    [{ costUsd: 10, inputValue: 20, mode: 'roi', count: 0 }, 'INVALID_COUNT'],
    [{ costUsd: 10, inputValue: 10_001, mode: 'roi', count: 1 }, 'ROI_OUT_OF_RANGE'],
  ];
  for (const [input, code] of cases) {
    const result = calculateSaleSimulation(input);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
  }
});
