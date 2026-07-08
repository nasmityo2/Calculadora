import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:dayzo_app/core/config/api_config.dart';
import 'package:dayzo_app/data/models/historic_rates_result.dart';

class HistoricRatesRepository {
  HistoricRatesRepository({http.Client? client})
      : _client = client ?? http.Client();

  final http.Client _client;

  /// Fetches historic rates for a given [fecha] (YYYY-MM-DD) and optional
  /// [hora] (HH:MM).
  ///
  /// Throws [HistoricRatesException] on 400 (invalid/future date) or 404 (no
  /// data available).
  Future<HistoricRatesResult> fetch({
    required String fecha,
    String? hora,
  }) async {
    final uri = ApiConfig.tasasHistoricasUri(fecha: fecha, hora: hora);
    final response = await _client.get(uri);

    if (response.statusCode == 200) {
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      return HistoricRatesResult.fromJson(json);
    }

    if (response.statusCode == 400 || response.statusCode == 404) {
      String message;
      try {
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        message = body['error'] as String? ?? '';
      } catch (_) {
        message = '';
      }

      if (message.isEmpty) {
        message = response.statusCode == 400
            ? 'Fecha u hora inválida'
            : 'No hay datos disponibles para esta fecha';
      }

      throw HistoricRatesException(message, statusCode: response.statusCode);
    }

    throw HistoricRatesException(
      'Error del servidor (${response.statusCode})',
      statusCode: response.statusCode,
    );
  }

  void dispose() {
    _client.close();
  }
}

class HistoricRatesException implements Exception {
  const HistoricRatesException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}
