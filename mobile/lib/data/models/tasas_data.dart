class Tasas {
  const Tasas({
    required this.binance,
    required this.binanceCompra,
    required this.bcv,
    required this.bcvPublicada,
    required this.cny,
  });

  final double binance;
  final double binanceCompra;
  final double bcv;
  final double bcvPublicada;
  final double cny;

  factory Tasas.fromJson(Map<String, dynamic> json) {
    return Tasas(
      binance: _toDouble(json['binance']),
      binanceCompra: _toDouble(json['binance_compra']),
      bcv: _toDouble(json['bcv']),
      bcvPublicada: _toDouble(json['bcv_publicada']),
      cny: _toDouble(json['cny']),
    );
  }

  static double _toDouble(dynamic v) {
    if (v is num) return v.toDouble();
    return double.tryParse('$v') ?? 0;
  }
}

class BcvMeta {
  const BcvMeta({
    required this.vigentePara,
    required this.publicadaEl,
    required this.nota,
    required this.hayNuevaPublicada,
  });

  final String? vigentePara;
  final String? publicadaEl;
  final String? nota;
  final bool hayNuevaPublicada;

  factory BcvMeta.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const BcvMeta(
        vigentePara: null,
        publicadaEl: null,
        nota: null,
        hayNuevaPublicada: false,
      );
    }
    return BcvMeta(
      vigentePara: json['vigente_para'] as String?,
      publicadaEl: json['publicada_el'] as String?,
      nota: json['nota'] as String?,
      hayNuevaPublicada: json['hay_nueva_publicada'] == true,
    );
  }
}

class RateStats {
  const RateStats({
    required this.change24h,
    required this.changePct24h,
  });

  final double change24h;
  final double changePct24h;

  factory RateStats.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const RateStats(change24h: 0, changePct24h: 0);
    }
    return RateStats(
      change24h: Tasas._toDouble(json['change24h']),
      changePct24h: Tasas._toDouble(json['changePct24h']),
    );
  }
}

class TasasSnapshot {
  const TasasSnapshot({
    required this.tasas,
    required this.bcvMeta,
    required this.diffBs,
    required this.diffPct,
    required this.lastUpdate,
    this.binanceStats,
    this.bcvStats,
  });

  final Tasas tasas;
  final BcvMeta bcvMeta;
  final double diffBs;
  final double diffPct;
  final String lastUpdate;
  final RateStats? binanceStats;
  final RateStats? bcvStats;

  factory TasasSnapshot.fromApi(Map<String, dynamic> json) {
    return TasasSnapshot(
      tasas: Tasas.fromJson(json['tasas'] as Map<String, dynamic>? ?? {}),
      bcvMeta: BcvMeta.fromJson(json['bcv_meta'] as Map<String, dynamic>?),
      diffBs: Tasas._toDouble(json['diff_bs']),
      diffPct: Tasas._toDouble(json['diff_pct']),
      lastUpdate: json['last_update'] as String? ?? '',
      binanceStats: json['binance_stats'] != null
          ? RateStats.fromJson(
              json['binance_stats'] as Map<String, dynamic>?)
          : null,
      bcvStats: json['bcv_stats'] != null
          ? RateStats.fromJson(
              json['bcv_stats'] as Map<String, dynamic>?)
          : null,
    );
  }

  TasasSnapshot copyWithStats(Map<String, dynamic> statsJson) {
    return TasasSnapshot(
      tasas: tasas,
      bcvMeta: bcvMeta,
      diffBs: diffBs,
      diffPct: diffPct,
      lastUpdate: lastUpdate,
      binanceStats: RateStats.fromJson(
        statsJson['binance'] as Map<String, dynamic>?,
      ),
      bcvStats: RateStats.fromJson(statsJson['bcv'] as Map<String, dynamic>?),
    );
  }

  TasasSnapshot applyWsUpdate(Map<String, dynamic> data) {
    final next = TasasSnapshot.fromApi(data);
    return TasasSnapshot(
      tasas: next.tasas,
      bcvMeta: next.bcvMeta,
      diffBs: next.diffBs,
      diffPct: next.diffPct,
      lastUpdate: next.lastUpdate.isNotEmpty ? next.lastUpdate : lastUpdate,
      binanceStats: binanceStats,
      bcvStats: bcvStats,
    );
  }
}
