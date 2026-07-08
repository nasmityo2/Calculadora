/// Modelo para un item de la lista de cotizaciones de importación.
/// Campos todos nullable salvo id/name/createdAt por contrato de API.
class ImportQuoteListItem {
  final int id;
  final String name;
  final String createdAt;
  final String? empresaNombre;
  final double? empresaTarifaUSD;
  final double? inversionTotalUSD;
  final double? costoUnitarioUSD;
  final double? costoPorCajaUSD;
  final double? volumenM3;
  final double? pesoKg;
  final double? ventaUnitarioUSD;
  final double? gananciaTotalUSD;
  final double? margenVentaPct;
  final Map<String, dynamic>? quote;

  const ImportQuoteListItem({
    required this.id,
    required this.name,
    required this.createdAt,
    this.empresaNombre,
    this.empresaTarifaUSD,
    this.inversionTotalUSD,
    this.costoUnitarioUSD,
    this.costoPorCajaUSD,
    this.volumenM3,
    this.pesoKg,
    this.ventaUnitarioUSD,
    this.gananciaTotalUSD,
    this.margenVentaPct,
    this.quote,
  });

  factory ImportQuoteListItem.fromJson(Map<String, dynamic> json) {
    return ImportQuoteListItem(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String? ?? '',
      createdAt: json['createdAt'] as String? ?? '',
      empresaNombre: json['empresaNombre'] as String?,
      empresaTarifaUSD: _toDouble(json['empresaTarifaUSD']),
      inversionTotalUSD: _toDouble(json['inversionTotalUSD']),
      costoUnitarioUSD: _toDouble(json['costoUnitarioUSD']),
      costoPorCajaUSD: _toDouble(json['costoPorCajaUSD']),
      volumenM3: _toDouble(json['volumenM3']),
      pesoKg: _toDouble(json['pesoKg']),
      ventaUnitarioUSD: _toDouble(json['ventaUnitarioUSD']),
      gananciaTotalUSD: _toDouble(json['gananciaTotalUSD']),
      margenVentaPct: _toDouble(json['margenVentaPct']),
      quote: json['quote'] as Map<String, dynamic>?,
    );
  }

  static double? _toDouble(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString());
  }
}
