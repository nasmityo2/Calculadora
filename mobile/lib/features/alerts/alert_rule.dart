enum AlertTipo { binance, binanceCompra, bcv, bcvPublicada, brecha }

extension AlertTipoLabel on AlertTipo {
  String get label {
    switch (this) {
      case AlertTipo.binance:
        return 'Binance · Vender';
      case AlertTipo.binanceCompra:
        return 'Binance · Comprar';
      case AlertTipo.bcv:
        return 'BCV';
      case AlertTipo.bcvPublicada:
        return 'BCV Publicada';
      case AlertTipo.brecha:
        return 'Brecha Binance vs BCV';
    }
  }
}

enum AlertCondicion { mayorQue, menorQue }

class AlertRule {
  const AlertRule({
    required this.id,
    required this.tipo,
    required this.condicion,
    required this.umbral,
    this.activo = true,
  });

  final String id;
  final AlertTipo tipo;
  final AlertCondicion condicion;
  final double umbral;
  final bool activo;

  AlertRule copyWith({bool? activo}) {
    return AlertRule(
      id: id,
      tipo: tipo,
      condicion: condicion,
      umbral: umbral,
      activo: activo ?? this.activo,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'tipo': tipo.name,
        'condicion': condicion.name,
        'umbral': umbral,
        'activo': activo,
      };

  factory AlertRule.fromJson(Map<String, dynamic> json) => AlertRule(
        id: json['id'] as String,
        tipo: AlertTipo.values.firstWhere(
          (e) => e.name == json['tipo'],
          orElse: () => AlertTipo.binance,
        ),
        condicion: AlertCondicion.values.firstWhere(
          (e) => e.name == json['condicion'],
          orElse: () => AlertCondicion.mayorQue,
        ),
        umbral: (json['umbral'] as num).toDouble(),
        activo: json['activo'] as bool? ?? true,
      );

  String get tipoLabel => tipo.label;

  String get condicionLabel {
    switch (condicion) {
      case AlertCondicion.mayorQue:
        return 'mayor que';
      case AlertCondicion.menorQue:
        return 'menor que';
    }
  }
}
