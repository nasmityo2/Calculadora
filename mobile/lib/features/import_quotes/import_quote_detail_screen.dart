import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import 'package:dayzo_app/data/models/import_quote.dart';
import 'package:dayzo_app/data/repositories/import_quotes_repository.dart';
import 'package:dayzo_app/features/auth/auth_provider.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';
import 'package:provider/provider.dart';

final _numberFormat = NumberFormat('#,##0.00', 'es_VE');

class ImportQuoteDetailScreen extends StatefulWidget {
  const ImportQuoteDetailScreen({super.key, required this.quoteId});

  final int quoteId;

  @override
  State<ImportQuoteDetailScreen> createState() =>
      _ImportQuoteDetailScreenState();
}

class _ImportQuoteDetailScreenState extends State<ImportQuoteDetailScreen> {
  final _repository = ImportQuotesRepository.instance;

  ImportQuoteListItem? _item;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final item = await _repository.getById(widget.quoteId);
      if (mounted) {
        setState(() {
          _item = item;
          _loading = false;
        });
      }
    } on SessionExpired {
      if (mounted) context.read<AuthProvider>().bootstrap();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_item?.name ?? 'Detalle'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(
        child: CircularProgressIndicator(color: DayzoColors.accent),
      );
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, color: DayzoColors.red, size: 48),
              const SizedBox(height: 12),
              const Text(
                'No se pudo cargar el detalle',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              Text(
                _error!,
                style:
                    const TextStyle(color: DayzoColors.textSoft, fontSize: 13),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _load,
                style: FilledButton.styleFrom(
                    backgroundColor: DayzoColors.accent),
                child: const Text('Reintentar'),
              ),
            ],
          ),
        ),
      );
    }

    final item = _item!;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Encabezado
          Text(
            item.name,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: DayzoColors.textInk,
            ),
          ),
          if (item.empresaNombre != null) ...[
            const SizedBox(height: 4),
            Text(
              item.empresaNombre!,
              style: const TextStyle(
                fontSize: 14,
                color: DayzoColors.textSoft,
              ),
            ),
          ],
          const SizedBox(height: 4),
          Text(
            _formatDate(item.createdAt),
            style: const TextStyle(fontSize: 12, color: DayzoColors.textSoft),
          ),
          const SizedBox(height: 20),

          // Resumen de inversión
          _SectionCard(
            title: 'Inversión',
            children: [
              _Row(label: 'Inversión total', value: item.inversionTotalUSD, prefix: '\$'),
              _Row(label: 'Tarifa (empresa)', value: item.empresaTarifaUSD, prefix: '\$'),
            ],
          ),
          const SizedBox(height: 12),

          // Costos
          _SectionCard(
            title: 'Costos',
            children: [
              _Row(label: 'Costo unitario', value: item.costoUnitarioUSD, prefix: '\$'),
              _Row(label: 'Costo por caja', value: item.costoPorCajaUSD, prefix: '\$'),
            ],
          ),
          const SizedBox(height: 12),

          // Logística
          _SectionCard(
            title: 'Logística',
            children: [
              _Row(label: 'Volumen', value: item.volumenM3, suffix: ' m³'),
              _Row(label: 'Peso', value: item.pesoKg, suffix: ' kg'),
            ],
          ),
          const SizedBox(height: 12),

          // Plan de venta
          _SectionCard(
            title: 'Plan de venta',
            children: [
              _Row(label: 'Precio venta unitario', value: item.ventaUnitarioUSD, prefix: '\$'),
            ],
          ),
          const SizedBox(height: 12),

          // Rentabilidad
          _SectionCard(
            title: 'Rentabilidad',
            children: [
              _Row(
                label: 'Ganancia total',
                value: item.gananciaTotalUSD,
                prefix: '\$',
                color: (item.gananciaTotalUSD ?? 0) >= 0
                    ? DayzoColors.green
                    : DayzoColors.red,
              ),
              _Row(
                label: 'Margen de venta',
                value: item.margenVentaPct,
                suffix: '%',
                color: (item.margenVentaPct ?? 0) >= 0
                    ? DayzoColors.green
                    : DayzoColors.red,
              ),
            ],
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return DateFormat("d 'de' MMMM 'de' yyyy", 'es_VE').format(dt);
    } catch (_) {
      return iso;
    }
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DayzoColors.bgCard,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: DayzoColors.textSoft,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 8),
          ...children,
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({
    required this.label,
    this.value,
    this.prefix = '',
    this.suffix = '',
    this.color,
  });

  final String label;
  final double? value;
  final String prefix;
  final String suffix;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 14,
                color: DayzoColors.textSoft,
              ),
            ),
          ),
          Text(
            value != null
                ? '$prefix${_numberFormat.format(value)}$suffix'
                : '—',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: color ?? DayzoColors.textInk,
            ),
          ),
        ],
      ),
    );
  }
}
