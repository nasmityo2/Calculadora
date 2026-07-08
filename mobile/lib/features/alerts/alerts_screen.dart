import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:dayzo_app/features/alerts/alert_rule.dart';
import 'package:dayzo_app/features/alerts/alerts_provider.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';

class AlertsScreen extends StatelessWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Alertas de tasas'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add, color: DayzoColors.accent),
            tooltip: 'Nueva alerta',
            onPressed: () => _showCreateSheet(context),
          ),
        ],
      ),
      body: Consumer<AlertsProvider>(
        builder: (context, provider, _) {
          if (provider.rules.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.notifications_off,
                    size: 56,
                    color: DayzoColors.textSoft.withValues(alpha: 0.4),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Sin alertas',
                    style: TextStyle(
                      color: DayzoColors.textSoft,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Crea una alerta y te avisaremos cuando\nla tasa cruce el umbral.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: DayzoColors.textSoft, fontSize: 13),
                  ),
                ],
              ),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            itemCount: provider.rules.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final rule = provider.rules[index];
              return _AlertRuleTile(rule: rule);
            },
          );
        },
      ),
    );
  }

  void _showCreateSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: DayzoColors.bgCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => const _CreateAlertSheet(),
    );
  }
}

class _AlertRuleTile extends StatelessWidget {
  const _AlertRuleTile({required this.rule});

  final AlertRule rule;

  @override
  Widget build(BuildContext context) {
    final provider = context.read<AlertsProvider>();
    final condColor = rule.condicion == AlertCondicion.mayorQue
        ? DayzoColors.green
        : DayzoColors.red;

    return Opacity(
      opacity: rule.activo ? 1.0 : 0.45,
      child: Container(
        decoration: BoxDecoration(
          color: DayzoColors.bgElevated,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: rule.activo
                ? DayzoColors.accent.withValues(alpha: 0.2)
                : Colors.white.withValues(alpha: 0.05),
          ),
        ),
        child: ListTile(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          title: Text(
            rule.tipoLabel,
            style: const TextStyle(
              color: DayzoColors.textInk,
              fontWeight: FontWeight.w600,
              fontSize: 14,
            ),
          ),
          subtitle: Text(
            '${rule.condicionLabel} ${rule.umbral.toStringAsFixed(2)} VES',
            style: TextStyle(color: condColor, fontSize: 13),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Switch(
                value: rule.activo,
                activeThumbColor: DayzoColors.accent,
                onChanged: (_) => provider.toggleRule(rule.id),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline,
                    color: DayzoColors.red, size: 20),
                onPressed: () => _confirmDelete(context, provider, rule),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _confirmDelete(
      BuildContext context, AlertsProvider provider, AlertRule rule) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DayzoColors.bgCard,
        title: const Text('Eliminar alerta',
            style: TextStyle(color: DayzoColors.textInk)),
        content: Text(
          '¿Eliminar alerta "${rule.tipoLabel}"?',
          style: const TextStyle(color: DayzoColors.textSoft),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar',
                style: TextStyle(color: DayzoColors.textSoft)),
          ),
          TextButton(
            onPressed: () {
              provider.removeRule(rule.id);
              Navigator.pop(ctx);
            },
            child: const Text('Eliminar',
                style: TextStyle(color: DayzoColors.red)),
          ),
        ],
      ),
    );
  }
}

class _CreateAlertSheet extends StatefulWidget {
  const _CreateAlertSheet();

  @override
  State<_CreateAlertSheet> createState() => _CreateAlertSheetState();
}

class _CreateAlertSheetState extends State<_CreateAlertSheet> {
  AlertTipo _tipo = AlertTipo.binance;
  AlertCondicion _condicion = AlertCondicion.mayorQue;
  final _umbralController = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _umbralController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        20 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: DayzoColors.textSoft.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'Nueva alerta',
            style: TextStyle(
              color: DayzoColors.textInk,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 20),
          const Text(
            'Tasa',
            style: TextStyle(color: DayzoColors.textSoft, fontSize: 13),
          ),
          const SizedBox(height: 6),
          DropdownButtonFormField<AlertTipo>(
            initialValue: _tipo,
            dropdownColor: DayzoColors.bgElevated,
            decoration: const InputDecoration(
              hintText: 'Selecciona una tasa',
            ),
            items: AlertTipo.values.map((t) {
              return DropdownMenuItem(value: t, child: Text(t.label));
            }).toList(),
            onChanged: (v) {
              if (v != null) setState(() => _tipo = v);
            },
          ),
          const SizedBox(height: 16),
          const Text(
            'Condición',
            style: TextStyle(color: DayzoColors.textSoft, fontSize: 13),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: _CondicionChip(
                  label: 'Mayor que',
                  selected: _condicion == AlertCondicion.mayorQue,
                  color: DayzoColors.green,
                  onTap: () => setState(() => _condicion = AlertCondicion.mayorQue),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _CondicionChip(
                  label: 'Menor que',
                  selected: _condicion == AlertCondicion.menorQue,
                  color: DayzoColors.red,
                  onTap: () => setState(() => _condicion = AlertCondicion.menorQue),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const Text(
            'Umbral (VES)',
            style: TextStyle(color: DayzoColors.textSoft, fontSize: 13),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: _umbralController,
            keyboardType:
                const TextInputType.numberWithOptions(decimal: true),
            style: const TextStyle(color: DayzoColors.textInk, fontSize: 16),
            decoration: const InputDecoration(
              hintText: '0.00',
              suffixText: 'VES',
            ),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _saving ? null : _create,
            style: FilledButton.styleFrom(
              backgroundColor: DayzoColors.accent,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: _saving
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text(
                    'Crear alerta',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _create() async {
    final umbral = double.tryParse(
      _umbralController.text.replaceAll(',', '.'),
    );
    if (umbral == null || umbral <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Ingresa un umbral válido')),
      );
      return;
    }

    setState(() => _saving = true);

    final rule = AlertRule(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      tipo: _tipo,
      condicion: _condicion,
      umbral: umbral,
    );

    await context.read<AlertsProvider>().addRule(rule);

    if (!mounted) return;
    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Alerta creada'),
        duration: Duration(seconds: 2),
      ),
    );
  }
}

class _CondicionChip extends StatelessWidget {
  const _CondicionChip({
    required this.label,
    required this.selected,
    required this.color,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? color.withValues(alpha: 0.15) : DayzoColors.bgInput,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? color : Colors.white.withValues(alpha: 0.08),
            width: 1.2,
          ),
        ),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              color: selected ? color : DayzoColors.textSoft,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
              fontSize: 14,
            ),
          ),
        ),
      ),
    );
  }
}
