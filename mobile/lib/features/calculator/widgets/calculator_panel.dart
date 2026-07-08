import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import 'package:dayzo_app/features/rates/tasas_provider.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';
import 'package:dayzo_app/features/calculator/currency_calculator.dart';
import 'package:dayzo_app/core/utils/formatters.dart';

class CalculatorPanel extends StatefulWidget {
  const CalculatorPanel({super.key, required this.provider});

  final TasasProvider provider;

  @override
  State<CalculatorPanel> createState() => _CalculatorPanelState();
}

class _CalculatorPanelState extends State<CalculatorPanel> {
  late final TextEditingController _controller;

  TasasProvider get provider => widget.provider;

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

  @override
  Widget build(BuildContext context) {
    final mode = provider.calcMode;
    final (title, suffix) = _labels[mode]!;
    final result = provider.calcResult;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DayzoColors.bgCard,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(
                'Calculadora',
                style: displayLogoStyle().copyWith(fontSize: 18),
              ),
              const Spacer(),
              SizedBox(
                height: 28,
                child: TextButton.icon(
                  onPressed: () => context.push('/calculadora-historica'),
                  icon: const Icon(Icons.history, size: 14),
                  label: const Text('Usar fecha pasada', style: TextStyle(fontSize: 11)),
                  style: TextButton.styleFrom(
                    foregroundColor: DayzoColors.textSoft,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
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
                      foregroundColor:
                          selected ? DayzoColors.textInk : DayzoColors.textSoft,
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                        side: BorderSide(
                          color: selected
                              ? DayzoColors.accent.withValues(alpha: 0.5)
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
          const SizedBox(height: 14),
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
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[\d,.\-]')),
            ],
            style: monoValueStyle(size: 22),
            decoration: InputDecoration(
              hintText: '0,00',
              suffixText: suffix,
              suffixStyle: const TextStyle(color: DayzoColors.textSoft),
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
          if (result != null)
            ...result.lines.map(
              (line) => _ResultRow(
                label: line.label,
                value: formatMoney(line.value),
              ),
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
