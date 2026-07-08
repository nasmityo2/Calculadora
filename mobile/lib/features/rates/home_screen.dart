import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:dayzo_app/features/rates/tasas_provider.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';
import 'package:dayzo_app/features/calculator/currency_calculator.dart';
import 'package:dayzo_app/core/utils/formatters.dart';
import 'package:dayzo_app/features/calculator/widgets/calculator_panel.dart';
import 'package:dayzo_app/features/rates/widgets/rate_card.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<TasasProvider>().init();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<TasasProvider>(
      builder: (context, provider, _) {
        return Scaffold(
          body: SafeArea(
            child: provider.loading
                ? const Center(
                    child: CircularProgressIndicator(color: DayzoColors.accent),
                  )
                : provider.error != null && provider.snapshot == null
                    ? _ErrorView(
                        message: provider.error!,
                        onRetry: provider.refresh,
                      )
                    : RefreshIndicator(
                        color: DayzoColors.accent,
                        onRefresh: provider.refresh,
                        child: CustomScrollView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          slivers: [
                            SliverToBoxAdapter(child: _TopBar(provider: provider)),
                            SliverPadding(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                              sliver: SliverList(
                                delegate: SliverChildListDelegate([
                                  _SpreadBanner(provider: provider),
                                  const SizedBox(height: 14),
                                  _RateGrid(provider: provider),
                                  const SizedBox(height: 18),
                                  CalculatorPanel(provider: provider),
                                ]),
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

class _TopBar extends StatelessWidget {
  const _TopBar({required this.provider});

  final TasasProvider provider;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Row(
        children: [
          Text('DAYZO', style: displayLogoStyle()),
          const Spacer(),
          Text(
            provider.lastUpdateTime,
            style: const TextStyle(fontSize: 12, color: DayzoColors.green),
          ),
          const SizedBox(width: 8),
          IconButton(
            onPressed: provider.refreshing ? null : provider.refresh,
            icon: provider.refreshing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: DayzoColors.accent,
                    ),
                  )
                : const Icon(Icons.sync, color: DayzoColors.textSoft, size: 20),
            tooltip: 'Actualizar',
          ),
        ],
      ),
    );
  }
}

class _SpreadBanner extends StatelessWidget {
  const _SpreadBanner({required this.provider});

  final TasasProvider provider;

  @override
  Widget build(BuildContext context) {
    final snap = provider.snapshot;
    if (snap == null) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            DayzoColors.accent.withValues(alpha: 0.15),
            DayzoColors.bgCard,
          ],
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: DayzoColors.accent.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          const Icon(Icons.compare_arrows, color: DayzoColors.accent, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Brecha Binance vs BCV',
                  style: TextStyle(fontSize: 11, color: DayzoColors.textSoft),
                ),
                Text(
                  '${formatMoney(snap.diffBs)} Bs · ${formatMoney(snap.diffPct)}%',
                  style: monoValueStyle(size: 16, color: DayzoColors.accent),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RateGrid extends StatelessWidget {
  const _RateGrid({required this.provider});

  final TasasProvider provider;

  @override
  Widget build(BuildContext context) {
    final snap = provider.snapshot!;
    final t = snap.tasas;

    return LayoutBuilder(
      builder: (context, constraints) {
        final crossCount = constraints.maxWidth > 520 ? 4 : 2;
        final cards = [
          RateCard(
            label: 'Binance · Comprar',
            value: t.binance,
            currency: 'VES',
            accentColor: DayzoColors.green,
            delta: snap.binanceStats,
          ),
          RateCard(
            label: 'Binance · Vender',
            value: t.binanceCompra,
            currency: 'VES',
            accentColor: DayzoColors.red,
          ),
          RateCard(
            label: 'BCV',
            value: t.bcv,
            currency: 'VES',
            accentColor: DayzoColors.blue,
            subtitle: provider.bcvDateLabel,
            delta: snap.bcvStats,
          ),
          const RateCard(
            label: 'CNY / USD',
            value: tasaSegura,
            currency: '¥',
            accentColor: DayzoColors.amber,
          ),
        ];

        return GridView.count(
          crossAxisCount: crossCount,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: crossCount == 4 ? 1.35 : 1.15,
          children: cards,
        );
      },
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, color: DayzoColors.red, size: 48),
            const SizedBox(height: 12),
            Text(
              'No se pudieron cargar las tasas',
              style: displayLogoStyle().copyWith(fontSize: 18),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: const TextStyle(color: DayzoColors.textSoft, fontSize: 13),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: onRetry,
              style: FilledButton.styleFrom(backgroundColor: DayzoColors.accent),
              child: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }
}
