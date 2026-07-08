import 'package:flutter/foundation.dart';

import 'package:dayzo_app/features/alerts/alert_rule.dart';
import 'package:dayzo_app/features/alerts/alerts_repository.dart';

class AlertsProvider extends ChangeNotifier {
  final AlertsRepository _repository;

  AlertsProvider() : _repository = AlertsRepository();

  /// Constructor for testing — accepts a mocked repository.
  AlertsProvider.test(this._repository);

  List<AlertRule> _rules = [];
  List<AlertRule> get rules => List.unmodifiable(_rules);

  /// Tracks whether each rule was in "fired" state at last evaluation.
  final Map<String, bool> _wasFired = {};

  /// Tracks last-fire time per rule id for anti-rebote en el mismo instante.
  /// Solo se usa como safety en flanco limpio; no re-dispara mientras se mantiene fired.
  final Map<String, int> _lastFiredAt = {};

  /// Override de reloj para tests. Si es null, usa DateTime.now().
  DateTime Function()? _nowOverride;

  Future<void> init() async {
    _rules = await _repository.load();
    // Initialize _wasFired from persisted state (all false = not fired).
    for (final r in _rules) {
      _wasFired[r.id] = false;
    }
    notifyListeners();
  }

  Future<void> addRule(AlertRule rule) async {
    _rules = [..._rules, rule];
    _wasFired[rule.id] = false;
    await _repository.save(_rules);
    notifyListeners();
  }

  Future<void> toggleRule(String id) async {
    _rules = [
      for (final r in _rules)
        if (r.id == id) r.copyWith(activo: !r.activo) else r,
    ];
    // Reset edge state when toggling.
    _wasFired[id] = false;
    await _repository.save(_rules);
    notifyListeners();
  }

  Future<void> removeRule(String id) async {
    _rules = _rules.where((r) => r.id != id).toList();
    _wasFired.remove(id);
    _lastFiredAt.remove(id);
    await _repository.save(_rules);
    notifyListeners();
  }

  /// Expone un override de reloj para tests. Retorno a null para usar DateTime.now().
  void setNowOverride(DateTime Function() nowOverride) {
    _nowOverride = nowOverride;
  }

  void clearNowOverride() {
    _nowOverride = null;
  }

  /// Evaluates all active rules against current rate values.
  /// Fires ONLY on edge (flanco): transition from not-fired → fired.
  /// Re-arms when value goes back to the safe side.
  /// Returns a list of (rule, value) pairs that fired.
  List<(AlertRule, double)> evaluate(TasasSnapshotForAlerts data) {
    final now = (_nowOverride?.call() ?? DateTime.now()).millisecondsSinceEpoch;
    final triggered = <(AlertRule, double)>[];

    for (final rule in _rules) {
      if (!rule.activo) continue;

      final value = _getValue(rule, data);
      if (value == null) continue;

      final bool currentlyFired;
      switch (rule.condicion) {
        case AlertCondicion.mayorQue:
          currentlyFired = value > rule.umbral;
        case AlertCondicion.menorQue:
          currentlyFired = value < rule.umbral;
      }

      final wasFired = _wasFired[rule.id] ?? false;

      if (currentlyFired) {
        if (!wasFired) {
          // Clean edge: not-fired → fired.
          _lastFiredAt[rule.id] = now;
          triggered.add((rule, value));
        }
        // else: still fired — NO re-dispara. Flanco puro.
      } else {
        // Re-arm: reset debounce so next clean edge fires.
        _lastFiredAt.remove(rule.id);
      }

      // Update edge state for next evaluation
      _wasFired[rule.id] = currentlyFired;
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
