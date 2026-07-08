import 'package:flutter/material.dart';

import 'package:dayzo_app/data/models/tasas_data.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';
import 'package:dayzo_app/core/utils/formatters.dart';

class ShareableRateCard extends StatelessWidget {
  const ShareableRateCard({
    super.key,
    required this.snapshot,
    this.dateLabel,
  });

  final TasasSnapshot snapshot;
  final String? dateLabel;

  @override
  Widget build(BuildContext context) {
    final t = snapshot.tasas;
    final date = dateLabel ?? _formattedDate(snapshot.lastUpdate);

    return Container(
      width: 340,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: DayzoColors.bgPage,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: DayzoColors.accent.withValues(alpha: 0.3)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Logo / Header ──
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: DayzoColors.accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Center(
                  child: Text(
                    'D',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                      color: DayzoColors.accent,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'DAYZO',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                      color: DayzoColors.textInk,
                      letterSpacing: 0.5,
                    ),
                  ),
                  Text(
                    'Tasas del día',
                    style: TextStyle(
                      fontSize: 10,
                      color: DayzoColors.textSoft,
                    ),
                  ),
                ],
              ),
              const Spacer(),
              Text(
                date,
                style: const TextStyle(
                  fontSize: 10,
                  color: DayzoColors.textSoft,
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),

          // ── Divider ──
          Container(height: 1, color: DayzoColors.textSoft.withValues(alpha: 0.15)),
          const SizedBox(height: 14),

          // ── Binance Compra ──
          _RateRow(
            label: 'Binance · Compra',
            value: formatMoney(t.binanceCompra),
            color: DayzoColors.green,
            change: snapshot.binanceStats,
          ),
          const SizedBox(height: 10),

          // ── Binance Venta ──
          _RateRow(
            label: 'Binance · Venta',
            value: formatMoney(t.binance),
            color: DayzoColors.red,
          ),
          const SizedBox(height: 10),

          // ── BCV ──
          _RateRow(
            label: 'BCV',
            value: formatMoney(t.bcv),
            color: DayzoColors.blue,
            subtitle: formatBcvDate(snapshot.bcvMeta.publicadaEl),
            change: snapshot.bcvStats,
          ),
          const SizedBox(height: 14),

          // ── Divider ──
          Container(height: 1, color: DayzoColors.textSoft.withValues(alpha: 0.15)),
          const SizedBox(height: 12),

          // ── Brecha ──
          Row(
            children: [
              const Icon(Icons.compare_arrows, size: 14, color: DayzoColors.accent),
              const SizedBox(width: 6),
              const Text(
                'Brecha',
                style: TextStyle(
                  fontSize: 11,
                  color: DayzoColors.textSoft,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const Spacer(),
              Text(
                '${formatMoney(snapshot.diffBs)} Bs  ·  ${formatMoney(snapshot.diffPct)}%',
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: DayzoColors.accent,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          // ── Footer ──
          Text(
            'dayzove.lat',
            style: TextStyle(
              fontSize: 10,
              color: DayzoColors.textSoft.withValues(alpha: 0.6),
              letterSpacing: 0.8,
            ),
          ),
        ],
      ),
    );
  }

  String _formattedDate(String lastUpdate) {
    try {
      if (lastUpdate.isEmpty) return '--/--/----';
      final parts = lastUpdate.split(', ');
      if (parts.length >= 2) return parts[0].trim();
      return lastUpdate;
    } catch (_) {
      return lastUpdate;
    }
  }
}

class _RateRow extends StatelessWidget {
  const _RateRow({
    required this.label,
    required this.value,
    required this.color,
    this.subtitle,
    this.change,
  });

  final String label;
  final String value;
  final Color color;
  final String? subtitle;
  final RateStats? change;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 11,
                color: DayzoColors.textSoft,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (subtitle != null && subtitle!.isNotEmpty)
              Text(
                subtitle!,
                style: const TextStyle(
                  fontSize: 9,
                  color: DayzoColors.textSoft,
                ),
              ),
          ],
        ),
        const Spacer(),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '$value Bs',
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: DayzoColors.textInk,
              ),
            ),
            if (change != null && change!.change24h != 0)
              Text(
                _changeText(change!),
                style: TextStyle(
                  fontSize: 9,
                  color: change!.change24h >= 0
                      ? DayzoColors.green
                      : DayzoColors.red,
                ),
              ),
          ],
        ),
      ],
    );
  }

  String _changeText(RateStats s) {
    final up = s.change24h >= 0;
    return '${up ? '▲' : '▼'} ${up ? '+' : ''}${formatMoney(s.change24h)} (${formatMoney(s.changePct24h)}%)';
  }
}
