import 'package:flutter/foundation.dart';

import 'package:dayzo_app/core/db/local_db.dart';
import 'package:dayzo_app/data/models/historial_point.dart';
import 'package:dayzo_app/data/repositories/historial_repository.dart';

class HistorialProvider extends ChangeNotifier {
  HistorialProvider({HistorialRepository? repository})
      : _repository = repository ?? HistorialRepository();

  final HistorialRepository _repository;

  String range = '7d';
  bool loading = true;
  String? error;
  List<HistorialPoint> points = [];
  ChartStats? stats;
  bool stale = false;
  int? cachedAt;

  @override
  void dispose() {
    _repository.dispose();
    super.dispose();
  }

  Future<void> load() async {
    loading = true;
    error = null;
    stale = false;
    notifyListeners();

    try {
      final result = await _repository.fetchHistorial(range);
      points = result.points;
      stats = result.stats;
    } catch (e) {
      final cached = await _repository.getCachedHistorial(range);
      if (cached != null) {
        points = cached.points;
        stats = cached.stats;
        stale = true;
        final updatedAt = await LocalDb().getHistorialUpdatedAt(range);
        cachedAt = updatedAt;
      } else {
        error = e.toString();
        points = [];
        stats = null;
      }
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> setRange(String newRange) async {
    if (newRange == range) return;
    range = newRange;
    await load();
  }
}
