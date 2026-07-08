class HistoricRatesResult {
  const HistoricRatesResult({
    required this.consulta,
    required this.binance,
    required this.binanceCompra,
    required this.bcv,
    required this.bcvRegistrada,
    required this.diffBs,
    required this.diffPct,
    required this.desfaseMin,
    required this.fecha,
  });

  final DateTime consulta;
  final double binance;
  final double binanceCompra;
  final double bcv;
  final double bcvRegistrada;
  final double diffBs;
  final double diffPct;
  final int desfaseMin;
  final String fecha;

  static double _toDouble(dynamic v) {
    if (v is num) return v.toDouble();
    return double.tryParse('$v') ?? 0;
  }

  static DateTime _parseDateTime(String raw) {
    return DateTime.tryParse(raw) ?? DateTime(1970);
  }

  factory HistoricRatesResult.fromJson(Map<String, dynamic> json) {
    final consultaRaw = json['consulta'] as Map<String, dynamic>? ?? {};
    final tasas = json['tasas'] as Map<String, dynamic>? ?? {};
    final registro = json['registro'] as Map<String, dynamic>? ?? {};

    return HistoricRatesResult(
      consulta: _parseDateTime(consultaRaw['timestamp'] as String? ?? ''),
      binance: _toDouble(tasas['binance']),
      binanceCompra: _toDouble(tasas['binance_compra']),
      bcv: _toDouble(tasas['bcv']),
      bcvRegistrada: _toDouble(tasas['bcv_registrada']),
      diffBs: _toDouble(json['diff_bs']),
      diffPct: _toDouble(json['diff_pct']),
      desfaseMin: _toDouble(registro['desfase_min']).toInt(),
      fecha: registro['fecha'] as String? ?? '',
    );
  }
}
