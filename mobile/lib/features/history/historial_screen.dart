import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import 'package:dayzo_app/data/models/historial_point.dart';
import 'package:dayzo_app/features/history/historial_provider.dart';
import 'package:dayzo_app/features/history/widgets/rate_line_chart.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';
import 'package:dayzo_app/shared/widgets/offline_banner.dart';

class HistorialScreen extends StatefulWidget {
  const HistorialScreen({super.key});

  @override
  State<HistorialScreen> createState() => _HistorialScreenState();
}

class _HistorialScreenState extends State<HistorialScreen> {
  final _provider = HistorialProvider();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _provider.load();
    });
  }

  @override
  void dispose() {
    _provider.dispose();
    super.dispose();
  }

  static const _rangeOptions = [
    ('24h', '24h'),
    ('7d', '7D'),
    ('month', 'Mes'),
    ('all', 'Todo'),
  ];

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: _provider,
      child: Consumer<HistorialProvider>(
        builder: (context, provider, _) {
          return Scaffold(
            appBar: AppBar(
              title: const Text('Historial'),
              leading: IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => context.pop(),
              ),
            ),
            body: Column(
              children: [
                const OfflineBanner(),
                _StaleBanner(provider: provider),
                const SizedBox(height: 8),
                _RangeToggle(
                  selected: provider.range,
                  onSelected: (value) => provider.setRange(value),
                ),
                const SizedBox(height: 8),
                Expanded(
                  child: _buildBody(provider),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildBody(HistorialProvider provider) {
    if (provider.loading) {
      return const Center(
        child: CircularProgressIndicator(color: DayzoColors.accent),
      );
    }

    if (provider.error != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, color: DayzoColors.red, size: 48),
            const SizedBox(height: 12),
            Text(
              'No se pudo cargar el historial',
              style: displayLogoStyle().copyWith(fontSize: 18),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              provider.error!,
              style: const TextStyle(color: DayzoColors.textSoft, fontSize: 13),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => provider.load(),
              style: FilledButton.styleFrom(
                backgroundColor: DayzoColors.accent,
              ),
              child: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Leyenda
          const _LegendRow(),
          const SizedBox(height: 12),
          // Gráfico
          RateLineChart(points: provider.points),
          const SizedBox(height: 16),
          // Stats
          if (provider.stats != null) _StatsRow(stats: provider.stats!),
        ],
      ),
    );
  }
}

class _RangeToggle extends StatelessWidget {
  const _RangeToggle({
    required this.selected,
    required this.onSelected,
  });

  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final items = _HistorialScreenState._rangeOptions;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: SegmentedButton<String>(
        segments: items
            .map(
              (opt) => ButtonSegment(value: opt.$1, label: Text(opt.$2)),
            )
            .toList(),
        selected: {selected},
        onSelectionChanged: (set) => onSelected(set.first),
        style: SegmentedButton.styleFrom(
          backgroundColor: DayzoColors.bgCard,
          selectedBackgroundColor: DayzoColors.accent.withValues(alpha: 0.25),
          foregroundColor: DayzoColors.textSoft,
          selectedForegroundColor: DayzoColors.accent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
    );
  }
}

class _LegendRow extends StatelessWidget {
  const _LegendRow();

  @override
  Widget build(BuildContext context) {
    return const Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _LegendDot(color: DayzoColors.green, label: 'Compra'),
        SizedBox(width: 18),
        _LegendDot(color: DayzoColors.red, label: 'Venta'),
        SizedBox(width: 18),
        _LegendDot(color: DayzoColors.blue, label: 'BCV'),
      ],
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 5),
        Text(
          label,
          style: const TextStyle(fontSize: 12, color: DayzoColors.textSoft),
        ),
      ],
    );
  }
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.stats});

  final ChartStats stats;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: DayzoColors.bgCard,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          _StatItem(label: 'Mín', value: stats.min),
          _StatItem(label: 'Máx', value: stats.max),
          _StatItem(label: 'Prom', value: stats.avg),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({required this.label, required this.value});

  final String label;
  final double value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
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
            NumberFormat('#,##0.00', 'es_VE').format(value),
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: DayzoColors.textInk,
            ),
          ),
        ],
      ),
    );
  }
}

class _StaleBanner extends StatelessWidget {
  const _StaleBanner({required this.provider});

  final HistorialProvider provider;

  @override
  Widget build(BuildContext context) {
    if (!provider.stale) return const SizedBox.shrink();
    final label = provider.cachedAt != null
        ? DateFormat('d/M/y HH:mm', 'es_VE')
            .format(DateTime.fromMillisecondsSinceEpoch(provider.cachedAt!))
        : '';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      color: DayzoColors.amber.withValues(alpha: 0.15),
      child: Row(
        children: [
          const Icon(Icons.access_time, size: 14, color: DayzoColors.amber),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Datos guardados · $label',
              style: const TextStyle(
                color: DayzoColors.amber,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
