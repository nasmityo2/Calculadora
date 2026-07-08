double _toDouble(dynamic v) {
  if (v is num) return v.toDouble();
  return double.tryParse('$v') ?? 0;
}

class HistorialPoint {
  const HistorialPoint({
    required this.time,
    required this.binance,
    required this.binanceCompra,
    required this.bcv,
  });

  final DateTime time;
  final double binance;
  final double binanceCompra;
  final double bcv;

  factory HistorialPoint.fromJson(Map<String, dynamic> json) {
    final timestamp = _toDouble(json['timestamp']);
    return HistorialPoint(
      time: DateTime.fromMillisecondsSinceEpoch(timestamp.toInt()),
      binance: _toDouble(json['binance']),
      binanceCompra: _toDouble(json['binance_compra']),
      bcv: _toDouble(json['bcv']),
    );
  }

  Map<String, dynamic> toJson() => {
        'timestamp': time.millisecondsSinceEpoch,
        'binance': binance,
        'binance_compra': binanceCompra,
        'bcv': bcv,
      };
}

class ChartStats {
  const ChartStats({
    required this.count,
    required this.min,
    required this.max,
    required this.avg,
    required this.range,
  });

  final int count;
  final double min;
  final double max;
  final double avg;
  final String range;

  factory ChartStats.fromJson(Map<String, dynamic> json) {
    return ChartStats(
      count: (json['count'] as num?)?.toInt() ?? 0,
      min: _toDouble(json['min']),
      max: _toDouble(json['max']),
      avg: _toDouble(json['avg']),
      range: (json['range'] as String?) ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
        'count': count,
        'min': min,
        'max': max,
        'avg': avg,
        'range': range,
      };
}
