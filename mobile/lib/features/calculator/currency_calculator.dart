import 'package:dayzo_app/data/models/tasas_data.dart';

/// Misma constante que la web (`public/app.js`).
const double tasaSegura = 6.53;

enum CalcMode { ves, usdt, bcv, cny }

class CalcResultLine {
  const CalcResultLine({required this.label, required this.value});

  final String label;
  final double value;
}

class CalcResult {
  const CalcResult({required this.lines});

  final List<CalcResultLine> lines;
}

class CurrencyCalculator {
  static CalcResult compute({
    required CalcMode mode,
    required double amount,
    required Tasas tasas,
  }) {
    final tr = tasas.binanceCompra > 0 ? tasas.binanceCompra : tasas.binance;
    double v1 = 0, v2 = 0, v3 = 0;
    String l1 = '', l2 = '', l3 = '';

    switch (mode) {
      case CalcMode.ves:
        l1 = 'USDT (P2P)';
        v1 = tr > 0 ? amount / tr : 0;
        l2 = 'Dólar BCV';
        v2 = tasas.bcv > 0 ? amount / tasas.bcv : 0;
        l3 = 'Yuanes';
        v3 = tr > 0 ? (amount / tr) * tasaSegura : 0;
      case CalcMode.usdt:
        l1 = 'Bolívares';
        v1 = amount * tr;
        l2 = 'Dólar BCV (Ref)';
        v2 = tasas.bcv > 0 ? (amount * tr) / tasas.bcv : 0;
        l3 = 'Yuanes';
        v3 = amount * tasaSegura;
      case CalcMode.bcv:
        l1 = 'Bolívares';
        v1 = amount * tasas.bcv;
        l2 = 'USDT (Ref)';
        v2 = tr > 0 ? (amount * tasas.bcv) / tr : 0;
        l3 = 'Yuanes';
        v3 = tr > 0 ? ((amount * tasas.bcv) / tr) * tasaSegura : 0;
      case CalcMode.cny:
        final double u = tasaSegura > 0 ? amount / tasaSegura : 0;
        l1 = 'USDT';
        v1 = u;
        l2 = 'Bolívares';
        v2 = u * tr;
        l3 = 'Dólar BCV';
        v3 = tasas.bcv > 0 ? (u * tr) / tasas.bcv : 0;
    }

    return CalcResult(
      lines: [
        CalcResultLine(label: l1, value: v1),
        CalcResultLine(label: l2, value: v2),
        CalcResultLine(label: l3, value: v3),
      ],
    );
  }
}
