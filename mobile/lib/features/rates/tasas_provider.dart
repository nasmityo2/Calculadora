import 'package:flutter/foundation.dart';

import 'package:dayzo_app/core/db/local_db.dart';
import 'package:dayzo_app/core/widget/home_widget_service.dart';
import 'package:dayzo_app/data/models/tasas_data.dart';
import 'package:dayzo_app/data/repositories/tasas_repository.dart';
import 'package:dayzo_app/features/calculator/currency_calculator.dart';
import 'package:dayzo_app/core/utils/formatters.dart';

class TasasProvider extends ChangeNotifier {
  TasasProvider({TasasRepository? repository})
      : _repository = repository ?? TasasRepository();

  final TasasRepository _repository;

  /// Optional callback fired after each WebSocket update with the latest values.
  /// Used by AlertsProvider to evaluate alert rules.
  void Function(TasasSnapshot snapshot)? onRateUpdate;

  TasasSnapshot? snapshot;
  bool loading = true;
  bool refreshing = false;
  String? error;
  bool stale = false;
  int? cachedAt;

  CalcMode calcMode = CalcMode.ves;
  String amountRaw = '';
  CalcResult? calcResult;

  @override
  void dispose() {
    _repository.dispose();
    super.dispose();
  }

  Future<void> init() async {
    await refresh();
    _repository.connectWebSocket(_onWsUpdate);
  }

  void _onWsUpdate(TasasSnapshot next) {
    if (snapshot == null) {
      snapshot = next;
    } else {
      snapshot = snapshot!.applyWsUpdate({
        'tasas': {
          'binance': next.tasas.binance,
          'binance_compra': next.tasas.binanceCompra,
          'bcv': next.tasas.bcv,
          'bcv_publicada': next.tasas.bcvPublicada,
          'cny': next.tasas.cny,
        },
        'bcv_meta': {
          'vigente_para': next.bcvMeta.vigentePara,
          'publicada_el': next.bcvMeta.publicadaEl,
          'nota': next.bcvMeta.nota,
          'hay_nueva_publicada': next.bcvMeta.hayNuevaPublicada,
        },
        'diff_bs': next.diffBs,
        'diff_pct': next.diffPct,
        'last_update': next.lastUpdate,
      });
    }
    _recompute();
    notifyListeners();
    onRateUpdate?.call(snapshot!);
    HomeWidgetService.updateHomeWidget(snapshot!);
  }

  Future<void> refresh() async {
    if (snapshot == null) {
      loading = true;
    } else {
      refreshing = true;
    }
    error = null;
    stale = false;
    notifyListeners();

    try {
      snapshot = await _repository.fetchTasas();
      _recompute();
      if (snapshot != null) HomeWidgetService.updateHomeWidget(snapshot!);
    } catch (e) {
      final cached = await _repository.getCachedSnapshot();
      if (cached != null) {
        snapshot = cached;
        stale = true;
        final updatedAt = await LocalDb().getSnapshotUpdatedAt();
        cachedAt = updatedAt;
        _recompute();
      } else {
        error = e.toString();
      }
    } finally {
      loading = false;
      refreshing = false;
      notifyListeners();
    }
  }

  void setCalcMode(CalcMode mode) {
    calcMode = mode;
    _recompute();
    notifyListeners();
  }

  void setAmount(String raw) {
    amountRaw = raw;
    _recompute();
    notifyListeners();
  }

  void clearAmount() {
    amountRaw = '';
    _recompute();
    notifyListeners();
  }

  void _recompute() {
    final tasas = snapshot?.tasas;
    if (tasas == null) {
      calcResult = null;
      return;
    }
    final amount = parseLocaleAmount(amountRaw);
    calcResult = CurrencyCalculator.compute(
      mode: calcMode,
      amount: amount,
      tasas: tasas,
    );
  }

  String get lastUpdateTime =>
      extractTimeFromUpdate(snapshot?.lastUpdate ?? '');

  String get bcvDateLabel {
    final meta = snapshot?.bcvMeta;
    if (meta == null) return '';
    if (meta.hayNuevaPublicada) return meta.nota ?? '';
    return formatBcvDate(meta.publicadaEl);
  }
}
