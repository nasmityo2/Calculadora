import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:intl/intl.dart';

import 'package:dayzo_app/data/models/historial_point.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';

class RateLineChart extends StatelessWidget {
  const RateLineChart({
    super.key,
    required this.points,
  });

  final List<HistorialPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) {
      return const SizedBox(
        height: 220,
        child: Center(
          child: Text(
            'Sin datos disponibles',
            style: TextStyle(color: DayzoColors.textSoft),
          ),
        ),
      );
    }

    final allValues = <double>[
      for (final p in points) ...[p.binance, p.binanceCompra, p.bcv],
    ];
    final minY = allValues.reduce((a, b) => a < b ? a : b);
    final maxY = allValues.reduce((a, b) => a > b ? a : b);
    final padding = (maxY - minY) * 0.1;
    final adjustedMin = (minY - padding).floorToDouble();
    final adjustedMax = (maxY + padding).ceilToDouble();

    return SizedBox(
      height: 220,
      child: LineChart(
        LineChartData(
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            horizontalInterval: _niceInterval(adjustedMin, adjustedMax),
            getDrawingHorizontalLine: (value) => const FlLine(
              color: DayzoColors.bgElevated,
              strokeWidth: 1,
            ),
          ),
          titlesData: FlTitlesData(
            leftTitles: AxisTitles(
              axisNameWidget: null,
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 52,
                getTitlesWidget: (value, meta) {
                  if (value == meta.min) return const SizedBox.shrink();
                  return Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: Text(
                      _formatAxisValue(value),
                      style: const TextStyle(
                        fontSize: 10,
                        color: DayzoColors.textSoft,
                      ),
                    ),
                  );
                },
              ),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 28,
                interval: _bottomInterval(points.length),
                getTitlesWidget: (value, meta) {
                  if (value == meta.min || value == meta.max) {
                    return const SizedBox.shrink();
                  }
                  final idx = value.toInt();
                  if (idx < 0 || idx >= points.length) {
                    return const SizedBox.shrink();
                  }
                  return Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      DateFormat('d/M').format(points[idx].time),
                      style: const TextStyle(
                        fontSize: 10,
                        color: DayzoColors.textSoft,
                      ),
                    ),
                  );
                },
              ),
            ),
            topTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            rightTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
          ),
          borderData: FlBorderData(show: false),
          minX: 0,
          maxX: (points.length - 1).toDouble(),
          minY: adjustedMin,
          maxY: adjustedMax,
          lineTouchData: LineTouchData(
            handleBuiltInTouches: true,
            touchTooltipData: LineTouchTooltipData(
              getTooltipItems: (touchedSpots) {
                return touchedSpots.map((spot) {
                  final p = points[spot.spotIndex];
                  final label = switch (spot.barIndex) {
                    0 => 'Compra',
                    1 => 'Venta',
                    _ => 'BCV',
                  };
                  return LineTooltipItem(
                    '$label: ${_formatAxisValue(spot.y)}\n${DateFormat('d/M HH:mm').format(p.time)}',
                    TextStyle(
                      color: _seriesColor(spot.barIndex),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  );
                }).toList();
              },
            ),
          ),
          lineBarsData: [
            _lineData(
              points,
              (p) => p.binanceCompra,
              DayzoColors.green,
              'Compra',
            ),
            _lineData(
              points,
              (p) => p.binance,
              DayzoColors.red,
              'Venta',
            ),
            _lineData(
              points,
              (p) => p.bcv,
              DayzoColors.blue,
              'BCV',
            ),
          ],
        ),
        duration: const Duration(milliseconds: 300),
      ),
    );
  }

  LineChartBarData _lineData(
    List<HistorialPoint> pts,
    double Function(HistorialPoint) getY,
    Color color,
    String _,
  ) {
    return LineChartBarData(
      spots: List.generate(
        pts.length,
        (i) => FlSpot(i.toDouble(), getY(pts[i])),
      ),
      isCurved: true,
      curveSmoothness: 0.2,
      color: color,
      barWidth: 2,
      isStrokeCapRound: true,
      dotData: const FlDotData(show: false),
      belowBarData: BarAreaData(
        show: true,
        color: color.withValues(alpha: 0.08),
      ),
    );
  }

  Color _seriesColor(int barIndex) => switch (barIndex) {
    0 => DayzoColors.green,
    1 => DayzoColors.red,
    _ => DayzoColors.blue,
  };

  double _niceInterval(double min, double max) {
    final raw = (max - min) / 4;
    if (raw <= 0) return 1;
    final magnitude = _pow10((raw).toStringAsFixed(0).length - 1).toDouble();
    final normalized = raw / magnitude;
    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return magnitude * 2;
    if (normalized <= 5) return magnitude * 5;
    return magnitude * 10;
  }

  int _pow10(int exp) {
    int result = 1;
    for (int i = 0; i < exp; i++) {
      result *= 10;
    }
    return result;
  }

  double _bottomInterval(int count) {
    if (count <= 6) return 1;
    if (count <= 24) return (count / 6).ceilToDouble();
    if (count <= 60) return (count / 8).ceilToDouble();
    return (count / 10).ceilToDouble();
  }

  String _formatAxisValue(double value) {
    if (value >= 100) return value.toStringAsFixed(0);
    if (value >= 1) return value.toStringAsFixed(1);
    return value.toStringAsFixed(2);
  }
}
