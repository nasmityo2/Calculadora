import 'package:flutter/material.dart';

import 'package:dayzo_app/data/models/tasas_data.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';
import 'package:dayzo_app/core/utils/formatters.dart';

class RateCard extends StatelessWidget {
  const RateCard({
    super.key,
    required this.label,
    required this.value,
    required this.currency,
    required this.accentColor,
    this.subtitle,
    this.delta,
  });

  final String label;
  final double value;
  final String currency;
  final Color accentColor;
  final String? subtitle;
  final RateStats? delta;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DayzoColors.bgCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.35),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: accentColor,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: accentColor.withValues(alpha: 0.5),
                      blurRadius: 8,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    fontSize: 12,
                    color: DayzoColors.textSoft,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          if (subtitle != null && subtitle!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              subtitle!,
              style: const TextStyle(
                fontSize: 10,
                color: DayzoColors.textSoft,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Text(
                  formatMoney(value),
                  style: monoValueStyle(size: 24),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 6),
              Text(
                currency,
                style: const TextStyle(
                  fontSize: 11,
                  color: DayzoColors.textSoft,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          if (delta != null && delta!.change24h != 0) ...[
            const SizedBox(height: 6),
            _DeltaLine(stats: delta!),
          ],
        ],
      ),
    );
  }
}

class _DeltaLine extends StatelessWidget {
  const _DeltaLine({required this.stats});

  final RateStats stats;

  @override
  Widget build(BuildContext context) {
    final up = stats.change24h >= 0;
    final color = up ? DayzoColors.green : DayzoColors.red;
    final arrow = up ? '▲' : '▼';
    return Text(
      '$arrow ${up ? '+' : ''}${formatMoney(stats.change24h)} '
      '(${formatMoney(stats.changePct24h)}%) vs. ayer',
      style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.w500),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    );
  }
}
