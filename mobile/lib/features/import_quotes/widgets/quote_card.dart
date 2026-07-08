import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'package:dayzo_app/data/models/import_quote.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';

final _currencyFormat = NumberFormat('#,##0.00', 'es_VE');

class QuoteCard extends StatelessWidget {
  const QuoteCard({
    super.key,
    required this.item,
    this.onTap,
  });

  final ImportQuoteListItem item;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final profit = item.gananciaTotalUSD;
    final margin = item.margenVentaPct;
    final isProfitable = profit != null && profit > 0;

    return Card(
      color: DayzoColors.bgCard,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header: name + fecha
              Row(
                children: [
                  Expanded(
                    child: Text(
                      item.name,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: DayzoColors.textInk,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    _formatDate(item.createdAt),
                    style: const TextStyle(
                      fontSize: 11,
                      color: DayzoColors.textSoft,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              // Empresa
              if (item.empresaNombre != null)
                Text(
                  item.empresaNombre!,
                  style: const TextStyle(
                    fontSize: 13,
                    color: DayzoColors.textSoft,
                  ),
                ),
              const SizedBox(height: 8),
              // Filas de valores
              Row(
                children: [
                  _ValueColumn(
                    label: 'Inversión total',
                    value: item.inversionTotalUSD,
                    prefix: '\$',
                  ),
                  const SizedBox(width: 16),
                  if (profit != null)
                    _ValueColumn(
                      label: 'Ganancia',
                      value: profit,
                      prefix: '\$',
                      color: isProfitable ? DayzoColors.green : DayzoColors.red,
                    ),
                  const Spacer(),
                  if (margin != null)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: (isProfitable
                                ? DayzoColors.green
                                : DayzoColors.red)
                            .withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        '${margin.toStringAsFixed(1)}%',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: isProfitable
                              ? DayzoColors.green
                              : DayzoColors.red,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return DateFormat('dd/MM/yy', 'es_VE').format(dt);
    } catch (_) {
      return iso;
    }
  }
}

class _ValueColumn extends StatelessWidget {
  const _ValueColumn({
    required this.label,
    required this.value,
    this.prefix = '',
    this.color,
  });

  final String label;
  final double? value;
  final String prefix;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            color: DayzoColors.textSoft,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value != null
              ? '$prefix${_currencyFormat.format(value)}'
              : '—',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: color ?? DayzoColors.textInk,
          ),
        ),
      ],
    );
  }
}
