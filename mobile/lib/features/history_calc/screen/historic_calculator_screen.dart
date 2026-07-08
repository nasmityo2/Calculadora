import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import 'package:dayzo_app/core/utils/formatters.dart';
import 'package:dayzo_app/data/models/historic_rates_result.dart';
import 'package:dayzo_app/features/calculator/currency_calculator.dart';
import 'package:dayzo_app/features/history_calc/provider/historic_calc_provider.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';

class HistoricCalculatorScreen extends StatefulWidget {
  const HistoricCalculatorScreen({super.key, required this.provider});

  final HistoricCalcProvider provider;

  @override
  State<HistoricCalculatorScreen> createState() =>
      _HistoricCalculatorScreenState();
}

class _HistoricCalculatorScreenState extends State<HistoricCalculatorScreen> {
  late final TextEditingController _controller;
  final _dateFmt = DateFormat('yyyy-MM-dd');

  HistoricCalcProvider get provider => widget.provider;

  static const _modes = [
    (CalcMode.ves, 'VES'),
    (CalcMode.usdt, 'USDT'),
    (CalcMode.bcv, 'BCV'),
    (CalcMode.cny, 'CNY'),
  ];

  static const _labels = {
    CalcMode.ves: ('MONTO EN BOLÍVARES', 'Bs'),
    CalcMode.usdt: ('MONTO EN USDT', '₮'),
    CalcMode.bcv: ('MONTO EN DÓLAR BCV', '\$'),
    CalcMode.cny: ('MONTO EN YUANES', '¥'),
  };

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: provider.amountRaw);
    provider.addListener(_syncFromProvider);
  }

  @override
  void dispose() {
    provider.removeListener(_syncFromProvider);
    _controller.dispose();
    super.dispose();
  }

  void _syncFromProvider() {
    if (_controller.text != provider.amountRaw) {
      _controller.text = provider.amountRaw;
      _controller.selection = TextSelection.collapsed(
        offset: provider.amountRaw.length,
      );
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: provider.selectedDate,
      firstDate: DateTime(2020),
      lastDate: now,
      helpText: 'Seleccionar fecha',
      cancelText: 'Cancelar',
      confirmText: 'Aceptar',
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            datePickerTheme: DatePickerThemeData(
              backgroundColor: DayzoColors.bgCard,
              headerBackgroundColor: DayzoColors.bgElevated,
              todayForegroundColor: WidgetStateProperty.all(DayzoColors.accent),
              dayForegroundColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.selected)) {
                  return Colors.white;
                }
                return DayzoColors.textInk;
              }),
              dayBackgroundColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.selected)) {
                  return DayzoColors.accent;
                }
                return null;
              }),
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked != null) {
      provider.setDate(picked);
    }
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: provider.selectedTime ?? TimeOfDay.now(),
      helpText: 'Seleccionar hora (opcional)',
      cancelText: 'Cancelar',
      confirmText: 'Aceptar',
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            timePickerTheme: const TimePickerThemeData(
              backgroundColor: DayzoColors.bgCard,
              hourMinuteColor: DayzoColors.bgElevated,
              hourMinuteTextColor: DayzoColors.textInk,
              dayPeriodTextColor: DayzoColors.textInk,
              helpTextStyle:
                  TextStyle(color: DayzoColors.textSoft, fontSize: 14),
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked != null) {
      provider.setTime(picked);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: provider,
      builder: (context, _) {
        final mode = provider.calcMode;
        final (title, suffix) = _labels[mode]!;
        final result = provider.result;
        final calc = provider.calcResult;

        return Scaffold(
          backgroundColor: DayzoColors.bgPage,
          appBar: AppBar(
            title: const Text('Calculadora histórica'),
            leading: IconButton(
              icon: const Icon(Icons.arrow_back, color: DayzoColors.textSoft),
              onPressed: () => context.pop(),
            ),
          ),
          body: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // --- Date & time selector ---
                  _DateTimeSelector(
                    provider: provider,
                    dateFmt: _dateFmt,
                    onPickDate: _pickDate,
                    onPickTime: _pickTime,
                    onClearTime: () => provider.setTime(null),
                  ),
                  const SizedBox(height: 16),

                  // --- Mode selector ---
                  Row(
                    children: _modes.map((entry) {
                      final selected = entry.$1 == mode;
                      return Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 3),
                          child: TextButton(
                            onPressed: () => provider.setCalcMode(entry.$1),
                            style: TextButton.styleFrom(
                              backgroundColor: selected
                                  ? DayzoColors.accent.withValues(alpha: 0.18)
                                  : DayzoColors.bgElevated,
                              foregroundColor: selected
                                  ? DayzoColors.textInk
                                  : DayzoColors.textSoft,
                              padding:
                                  const EdgeInsets.symmetric(vertical: 10),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                                side: BorderSide(
                                  color: selected
                                      ? DayzoColors.accent
                                          .withValues(alpha: 0.5)
                                      : Colors.transparent,
                                ),
                              ),
                            ),
                            child: Text(
                              entry.$2,
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 16),

                  // --- Amount input ---
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 11,
                      color: DayzoColors.textSoft,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.6,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _controller,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'[\d,.\-]')),
                    ],
                    style: monoValueStyle(size: 22),
                    decoration: InputDecoration(
                      hintText: '0,00',
                      suffixText: suffix,
                      suffixStyle:
                          const TextStyle(color: DayzoColors.textSoft),
                    ),
                    onChanged: provider.setAmount,
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: provider.clearAmount,
                      icon: const Icon(Icons.clear, size: 16),
                      label: const Text('Limpiar'),
                      style: TextButton.styleFrom(
                        foregroundColor: DayzoColors.textSoft,
                      ),
                    ),
                  ),

                  const SizedBox(height: 8),

                  // --- Fetch button ---
                  FilledButton.icon(
                    onPressed: provider.loading ? null : provider.fetch,
                    style: FilledButton.styleFrom(
                      backgroundColor: DayzoColors.accent,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    icon: provider.loading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.search, size: 20),
                    label: Text(
                      provider.loading
                          ? 'Consultando…'
                          : 'Consultar tasas históricas',
                    ),
                  ),

                  const SizedBox(height: 16),

                  // --- Error ---
                  if (provider.error != null)
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: DayzoColors.red.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: DayzoColors.red.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline,
                              color: DayzoColors.red, size: 18),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              provider.error!,
                              style: const TextStyle(
                                color: DayzoColors.red,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                  // --- Desfase warning ---
                  if (result != null && result.desfaseMin > 10)
                    Container(
                      margin: const EdgeInsets.only(top: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: DayzoColors.amber.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: DayzoColors.amber.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.access_time,
                              color: DayzoColors.amber, size: 18),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Dato más cercano: hace ${result.desfaseMin} min',
                              style: const TextStyle(
                                color: DayzoColors.amber,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                  // --- Historic rates summary ---
                  if (result != null)
                    _HistoricRatesSummary(result: result),

                  const SizedBox(height: 16),

                  // --- Calc results ---
                  if (calc != null)
                    ...calc.lines.map(
                      (line) => _ResultRow(
                        label: line.label,
                        value: formatMoney(line.value),
                      ),
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _DateTimeSelector extends StatelessWidget {
  const _DateTimeSelector({
    required this.provider,
    required this.dateFmt,
    required this.onPickDate,
    required this.onPickTime,
    required this.onClearTime,
  });

  final HistoricCalcProvider provider;
  final DateFormat dateFmt;
  final VoidCallback onPickDate;
  final VoidCallback onPickTime;
  final VoidCallback onClearTime;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DayzoColors.bgCard,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Fecha y hora',
            style: TextStyle(
              fontSize: 13,
              color: DayzoColors.textSoft,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: InkWell(
                  onTap: onPickDate,
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: DayzoColors.bgInput,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.08),
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.calendar_today,
                            size: 16, color: DayzoColors.textSoft),
                        const SizedBox(width: 8),
                        Text(
                          dateFmt.format(provider.selectedDate),
                          style: monoValueStyle(size: 14),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: InkWell(
                  onTap: onPickTime,
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: DayzoColors.bgInput,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.08),
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.access_time,
                            size: 16, color: DayzoColors.textSoft),
                        const SizedBox(width: 8),
                        Text(
                          provider.selectedTime != null
                              ? '${provider.selectedTime!.hour.toString().padLeft(2, '0')}:${provider.selectedTime!.minute.toString().padLeft(2, '0')}'
                              : '--:--',
                          style: monoValueStyle(size: 14),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              if (provider.selectedTime != null) ...[
                const SizedBox(width: 6),
                IconButton(
                  onPressed: onClearTime,
                  icon: const Icon(Icons.close, size: 18, color: DayzoColors.textSoft),
                  tooltip: 'Sin hora específica',
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Si no seleccionas hora, se usará el cierre del día',
            style: TextStyle(
              fontSize: 11,
              color: DayzoColors.textSoft,
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoricRatesSummary extends StatelessWidget {
  const _HistoricRatesSummary({required this.result});

  final HistoricRatesResult result;

  @override
  Widget build(BuildContext context) {
    final dateLabel = DateFormat('d MMM yyyy', 'es_VE').format(result.consulta);
    final timeLabel = DateFormat('HH:mm').format(result.consulta);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DayzoColors.bgCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.history, size: 16, color: DayzoColors.textSoft),
              const SizedBox(width: 6),
              Text(
                'Tasas al $dateLabel · $timeLabel',
                style: const TextStyle(
                  fontSize: 12,
                  color: DayzoColors.textSoft,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _RateRow(label: 'Binance (venta)', value: result.binance),
          _RateRow(label: 'Binance (compra)', value: result.binanceCompra),
          _RateRow(label: 'BCV', value: result.bcv),
          _RateRow(
            label: 'BCV registrada',
            value: result.bcvRegistrada,
            isLast: true,
          ),
          if (result.diffBs != 0) ...[
            const SizedBox(height: 8),
            const Divider(color: DayzoColors.bgElevated, height: 1),
            const SizedBox(height: 8),
            _RateRow(
              label: 'Brecha',
              value: result.diffBs,
              suffix: ' Bs',
              valueColor: result.diffBs > 0 ? DayzoColors.green : DayzoColors.red,
            ),
          ],
        ],
      ),
    );
  }
}

class _RateRow extends StatelessWidget {
  const _RateRow({
    required this.label,
    required this.value,
    this.suffix = ' VES',
    this.valueColor,
    this.isLast = false,
  });

  final String label;
  final double value;
  final String suffix;
  final Color? valueColor;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: EdgeInsets.only(bottom: isLast ? 0 : 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                color: DayzoColors.textSoft,
              ),
            ),
          ),
          Text(
            '${formatMoney(value)}$suffix',
            style: monoValueStyle(size: 14, color: valueColor),
          ),
        ],
      ),
    );
  }
}

class _ResultRow extends StatelessWidget {
  const _ResultRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: DayzoColors.bgInput,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white.withValues(alpha: 0.05)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontSize: 12, color: DayzoColors.textSoft),
            ),
          ),
          Text(value, style: monoValueStyle(size: 16)),
          IconButton(
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.copy, size: 16, color: DayzoColors.textSoft),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: value));
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Copiado: $value'),
                  duration: const Duration(milliseconds: 1200),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
