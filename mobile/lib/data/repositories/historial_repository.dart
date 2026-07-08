import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:dayzo_app/core/config/api_config.dart';
import 'package:dayzo_app/core/db/local_db.dart';
import 'package:dayzo_app/data/models/historial_point.dart';

class HistorialRepository {
  HistorialRepository({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  Future<({List<HistorialPoint> points, ChartStats? stats})> fetchHistorial(
    String range,
  ) async {
    final uri = ApiConfig.historialUri(range: range);
    final response = await _client.get(uri);

    if (response.statusCode != 200) {
      throw Exception('Error ${response.statusCode} al cargar historial');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;

    final rawList = body['historial'] as List<dynamic>? ?? [];
    // La API devuelve orden DESC; invertimos a ASC para graficar.
    final points = rawList.cast<Map<String, dynamic>>().reversed.map(
      (json) => HistorialPoint.fromJson(json),
    ).toList();

    ChartStats? stats;
    final statsJson = body['chartStats'] as Map<String, dynamic>?;
    if (statsJson != null) {
      stats = ChartStats.fromJson(statsJson);
    }

    // Persistir en caché local tras un fetch exitoso.
    unawaited(_cacheHistorial(range, points, stats));

    return (points: points, stats: stats);
  }

  Future<void> _cacheHistorial(
    String range,
    List<HistorialPoint> points,
    ChartStats? stats,
  ) async {
    try {
      await LocalDb().saveHistorial(range, points, stats);
    } catch (_) {
      // Fallo de caché no crítico.
    }
  }

  Future<({List<HistorialPoint> points, ChartStats? stats})?>
      getCachedHistorial(String range) async {
    try {
      return await LocalDb().getHistorial(range);
    } catch (_) {
      return null;
    }
  }

  void dispose() {
    _client.close();
  }
}
