import 'package:flutter/foundation.dart';

import 'package:dayzo_app/features/alerts/alert_rule.dart';
import 'package:dayzo_app/features/alerts/alerts_repository.dart';

class AlertsProvider extends ChangeNotifier {
  final AlertsRepository _repository = AlertsRepository();

  List<AlertRule> _rules = [];
  List<AlertRule> get rules => List.unmodifiable(_rules);

  /// Tracks last-fire time per rule id to debounce (10s).
  final Map<String, int> _lastFiredAt = {};

  Future<void> init() async {
    _rules = await _repository.load();
    notifyListeners();
  }

  Future<void> addRule(AlertRule rule) async {
    _rules = [..._rules, rule];
    await _repository.save(_rules);
    notifyListeners();
  }

  Future<void> toggleRule(String id) async {
    _rules = [
      for (final r in _rules)
        if (r.id == id) r.copyWith(activo: !r.activo) else r,
    ];
    await _repository.save(_rules);
    notifyListeners();
  }

  Future<void> removeRule(String id) async {
    _rules = _rules.where((r) => r.id != id).toList();
    _lastFiredAt.remove(id);
    await _repository.save(_rules);
    notifyListeners();
  }

  /// Evaluates all active rules against current rate values.
  /// Returns a list of (rule, value) pairs that fired.
  List<(AlertRule, double)> evaluate(TasasSnapshotForAlerts data) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final triggered = <(AlertRule, double)>[];

    for (final rule in _rules) {
      if (!rule.activo) continue;

      final value = _getValue(rule, data);
      if (value == null) continue;

      final bool fired;
      switch (rule.condicion) {
        case AlertCondicion.mayorQue:
          fired = value > rule.umbral;
        case AlertCondicion.menorQue:
          fired = value < rule.umbral;
      }

      if (!fired) continue;

      // Debounce: skip if fired less than 10s ago
      final last = _lastFiredAt[rule.id];
      if (last != null && (now - last) < 10000) continue;

      _lastFiredAt[rule.id] = now;
      triggered.add((rule, value));
    }

    return triggered;
  }

  double? _getValue(AlertRule rule, TasasSnapshotForAlerts data) {
    switch (rule.tipo) {
      case AlertTipo.binance:
        return data.binance;
      case AlertTipo.binanceCompra:
        return data.binanceCompra;
      case AlertTipo.bcv:
        return data.bcv;
      case AlertTipo.bcvPublicada:
        return data.bcvPublicada;
      case AlertTipo.brecha:
        return data.diffBs;
    }
  }
}

/// Lightweight snapshot of just the values needed for alert evaluation.
/// Avoids coupling AlertsProvider to the full TasasSnapshot model.
class TasasSnapshotForAlerts {
  const TasasSnapshotForAlerts({
    required this.binance,
    required this.binanceCompra,
    required this.bcv,
    required this.bcvPublicada,
    required this.diffBs,
  });

  final double binance;
  final double binanceCompra;
  final double bcv;
  final double bcvPublicada;
  final double diffBs;
}
