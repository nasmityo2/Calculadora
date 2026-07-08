import 'package:dayzo_app/data/models/tasas_data.dart';
import 'package:dayzo_app/features/calculator/currency_calculator.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const tasas = Tasas(
    binance: 100,
    binanceCompra: 98,
    bcv: 80,
    bcvPublicada: 80,
    cny: 0,
  );

  group('CurrencyCalculator.compute', () {
    test('VES a USDT usa binance_compra', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.ves,
        amount: 9800,
        tasas: tasas,
      );
      expect(r.lines[0].value, closeTo(100, 0.01));
    });

    test('VES a BCV', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.ves,
        amount: 8000,
        tasas: tasas,
      );
      expect(r.lines[1].value, closeTo(100, 0.01));
    });

    test('VES a CNY via USDT', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.ves,
        amount: 980,
        tasas: tasas,
      );
      expect(r.lines[0].value, closeTo(10, 0.01));
      expect(r.lines[2].value, closeTo(10 * 6.53, 0.01));
    });

    test('USDT a bolívares', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.usdt,
        amount: 10,
        tasas: tasas,
      );
      expect(r.lines[0].value, closeTo(980, 0.01)); // 10 * 98 (binanceCompra)
    });

    test('USDT a BCV ref', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.usdt,
        amount: 10,
        tasas: tasas,
      );
      expect(r.lines[1].value, closeTo(980 / 80, 0.01));
    });

    test('USDT a CNY', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.usdt,
        amount: 10,
        tasas: tasas,
      );
      expect(r.lines[2].value, closeTo(10 * 6.53, 0.01));
    });

    test('BCV a bolívares', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.bcv,
        amount: 100,
        tasas: tasas,
      );
      expect(r.lines[0].value, closeTo(8000, 0.01));
    });

    test('BCV a USDT ref', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.bcv,
        amount: 100,
        tasas: tasas,
      );
      expect(r.lines[1].value, closeTo(8000 / 98, 0.01));
    });

    test('BCV a CNY', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.bcv,
        amount: 100,
        tasas: tasas,
      );
      expect(r.lines[2].value, closeTo((8000 / 98) * 6.53, 0.01));
    });

    test('CNY a USDT', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.cny,
        amount: 6.53,
        tasas: tasas,
      );
      expect(r.lines[0].value, closeTo(1, 0.01));
    });

    test('CNY a bolívares', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.cny,
        amount: 6.53,
        tasas: tasas,
      );
      expect(r.lines[1].value, closeTo(98, 0.01));
    });

    test('CNY a BCV', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.cny,
        amount: 6.53,
        tasas: tasas,
      );
      expect(r.lines[2].value, closeTo(98 / 80, 0.01));
    });

    test('fallback a binance cuando binanceCompra es 0', () {
      const tasasSinCompra = Tasas(
        binance: 100,
        binanceCompra: 0,
        bcv: 80,
        bcvPublicada: 80,
        cny: 0,
      );
      final r = CurrencyCalculator.compute(
        mode: CalcMode.ves,
        amount: 10000,
        tasas: tasasSinCompra,
      );
      expect(r.lines[0].value, closeTo(100, 0.01));
    });

    test('retorna ceros cuando amount es 0', () {
      final r = CurrencyCalculator.compute(
        mode: CalcMode.ves,
        amount: 0,
        tasas: tasas,
      );
      for (final line in r.lines) {
        expect(line.value, 0);
      }
    });
  });
}
