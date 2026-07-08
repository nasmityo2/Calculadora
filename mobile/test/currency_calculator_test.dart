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

  test('VES a USDT usa binance_compra', () {
    final r = CurrencyCalculator.compute(
      mode: CalcMode.ves,
      amount: 9800,
      tasas: tasas,
    );
    expect(r.lines[0].value, closeTo(100, 0.01));
  });

  test('USDT a bolívares', () {
    final r = CurrencyCalculator.compute(
      mode: CalcMode.usdt,
      amount: 10,
      tasas: tasas,
    );
    expect(r.lines[0].value, closeTo(980, 0.01));
  });
}
