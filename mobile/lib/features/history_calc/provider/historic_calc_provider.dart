import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'package:dayzo_app/data/models/historic_rates_result.dart';
import 'package:dayzo_app/data/models/tasas_data.dart';
import 'package:dayzo_app/data/repositories/historic_rates_repository.dart';
import 'package:dayzo_app/features/calculator/currency_calculator.dart';
import 'package:dayzo_app/core/utils/formatters.dart';

class HistoricCalcProvider extends ChangeNotifier {
  HistoricCalcProvider({HistoricRatesRepository? repository})
      : _repository = repository ?? HistoricRatesRepository();

  final HistoricRatesRepository _repository;

  DateTime selectedDate = DateTime.now();
  TimeOfDay? selectedTime;
  HistoricRatesResult? result;
  bool loading = false;
  String? error;

  CalcMode calcMode = CalcMode.ves;
  String amountRaw = '';
  CalcResult? calcResult;

  String get fechaFormatted => DateFormat('yyyy-MM-dd').format(selectedDate);

  String get horaFormatted =>
      selectedTime != null
          ? '${selectedTime!.hour.toString().padLeft(2, '0')}:${selectedTime!.minute.toString().padLeft(2, '0')}'
          : '';

  void setDate(DateTime date) {
    selectedDate = date;
    notifyListeners();
  }

  void setTime(TimeOfDay? time) {
    selectedTime = time;
    notifyListeners();
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

  Future<void> fetch() async {
    loading = true;
    error = null;
    result = null;
    notifyListeners();

    try {
      result = await _repository.fetch(
        fecha: fechaFormatted,
        hora: horaFormatted.isNotEmpty ? horaFormatted : null,
      );
      _recompute();
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  void _recompute() {
    if (result == null) {
      calcResult = null;
      return;
    }
    final amount = parseLocaleAmount(amountRaw);
    final tasas = Tasas(
      binance: result!.binance,
      binanceCompra: result!.binanceCompra,
      bcv: result!.bcv,
      bcvPublicada: result!.bcvRegistrada,
      cny: 0,
    );
    calcResult = CurrencyCalculator.compute(
      mode: calcMode,
      amount: amount,
      tasas: tasas,
    );
  }

  @override
  void dispose() {
    _repository.dispose();
    super.dispose();
  }
}
