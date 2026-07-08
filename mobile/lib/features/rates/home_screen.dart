import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:screenshot/screenshot.dart';
import 'package:share_plus/share_plus.dart';

import 'package:dayzo_app/core/utils/formatters.dart';
import 'package:dayzo_app/data/models/tasas_data.dart';
import 'package:dayzo_app/features/auth/auth_provider.dart';
import 'package:dayzo_app/features/calculator/currency_calculator.dart';
import 'package:dayzo_app/features/calculator/widgets/calculator_panel.dart';
import 'package:dayzo_app/features/rates/tasas_provider.dart';
import 'package:dayzo_app/features/rates/widgets/rate_card.dart';
import 'package:dayzo_app/features/rates/widgets/shareable_rate_card.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';
import 'package:dayzo_app/shared/widgets/offline_banner.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _screenshotController = ScreenshotController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<TasasProvider>().init();
    });
  }

  Future<void> _shareRateCard(TasasSnapshot snap) async {
    try {
      final date =
          DateFormat("d 'de' MMMM 'de' y", 'es_VE').format(DateTime.now());
      final Uint8List? png = await _screenshotController.capture(
        delay: const Duration(milliseconds: 50),
        pixelRatio: 3.0,
      );
      if (png == null || !mounted) return;

      final dir = await getTemporaryDirectory();
      final file = File(
        '${dir.path}/dayzo_tasas_${DateTime.now().millisecondsSinceEpoch}.png',
      );
      await file.writeAsBytes(png);

      await SharePlus.instance.share(
        ShareParams(
          files: [XFile(file.path)],
          text: 'Tasas DAYZO — $date 🇻🇪',
        ),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No se pudo generar la imagen para compartir'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<TasasProvider>(
      builder: (context, provider, _) {
        return Scaffold(
          body: SafeArea(
            child: Column(
              children: [
                const OfflineBanner(),
                _StaleBanner(provider: provider),
                Expanded(
                  child: provider.loading
                      ? const Center(
                          child: CircularProgressIndicator(
                            color: DayzoColors.accent,
                          ),
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
                                  SliverToBoxAdapter(
                                    child: _TopBar(
                                      provider: provider,
                                      onShare: () => _shareRateCard(
                                        provider.snapshot!,
                                      ),
                                    ),
                                  ),
                                  SliverPadding(
                                    padding: const EdgeInsets.fromLTRB(
                                        16, 0, 16, 24),
                                    sliver: SliverList(
                                      delegate: SliverChildListDelegate([
                                        // Screenshot-wrapped shareable card
                                        Screenshot(
                                          controller: _screenshotController,
                                          child: _SharePreview(
                                            provider: provider,
                                          ),
                                        ),
                                        const SizedBox(height: 14),
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
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Renders the shareable card in a clipping container so it's visible inline
/// but also capturable by Screenshot.
class _SharePreview extends StatelessWidget {
  const _SharePreview({required this.provider});

  final TasasProvider provider;

  @override
  Widget build(BuildContext context) {
    final snap = provider.snapshot;
    if (snap == null) return const SizedBox.shrink();
    final date =
        DateFormat("d 'de' MMMM 'de' y", 'es_VE').format(DateTime.now());
    return Center(
      child: ShareableRateCard(snapshot: snap, dateLabel: date),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.provider, this.onShare});

  final TasasProvider provider;
  final VoidCallback? onShare;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

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
          if (onShare != null)
            IconButton(
              icon: const Icon(Icons.share, color: DayzoColors.textSoft, size: 20),
              tooltip: 'Compartir',
              onPressed: onShare,
            ),
          IconButton(
            icon: const Icon(Icons.show_chart, color: DayzoColors.textSoft, size: 20),
            tooltip: 'Historial',
            onPressed: () => context.push('/historial'),
          ),
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
          _AccountButton(auth: auth),
        ],
      ),
    );
  }
}

class _AccountButton extends StatelessWidget {
  const _AccountButton({required this.auth});

  final AuthProvider auth;

  @override
  Widget build(BuildContext context) {
    if (!auth.isLoggedIn) {
      return IconButton(
        icon: const Icon(Icons.person_outline, color: DayzoColors.textSoft, size: 20),
        tooltip: 'Iniciar sesión',
        onPressed: () => context.push('/login'),
      );
    }

    return PopupMenuButton<String>(
      offset: const Offset(0, 40),
      color: DayzoColors.bgElevated,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      onSelected: (value) async {
        if (value == 'logout') {
          await context.read<AuthProvider>().logout();
        } else if (value == 'cotizaciones') {
          if (context.mounted) context.push('/cotizaciones');
        } else if (value == 'alertas') {
          if (context.mounted) context.push('/alertas');
        }
      },
      itemBuilder: (_) => [
        PopupMenuItem(
          enabled: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                auth.user!.displayName,
                style: const TextStyle(
                  color: DayzoColors.textInk,
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                ),
              ),
              Text(
                auth.user!.email.isNotEmpty ? auth.user!.email : '@${auth.user!.username}',
                style: const TextStyle(
                  color: DayzoColors.textSoft,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
        const PopupMenuDivider(),
        const PopupMenuItem(
          value: 'cotizaciones',
          child: Row(
            children: [
              Icon(Icons.assignment, color: DayzoColors.accent, size: 18),
              SizedBox(width: 8),
              Text(
                'Mis cotizaciones',
                style: TextStyle(color: DayzoColors.textInk, fontSize: 14),
              ),
            ],
          ),
        ),
        const PopupMenuItem(
          value: 'alertas',
          child: Row(
            children: [
              Icon(Icons.notifications_outlined, color: DayzoColors.accent, size: 18),
              SizedBox(width: 8),
              Text(
                'Alertas de tasas',
                style: TextStyle(color: DayzoColors.textInk, fontSize: 14),
              ),
            ],
          ),
        ),
        const PopupMenuDivider(),
        const PopupMenuItem(
          value: 'logout',
          child: Row(
            children: [
              Icon(Icons.logout, color: DayzoColors.red, size: 18),
              SizedBox(width: 8),
              Text(
                'Cerrar sesión',
                style: TextStyle(color: DayzoColors.red, fontSize: 14),
              ),
            ],
          ),
        ),
      ],
      child: Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: DayzoColors.accent.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Center(
          child: Text(
            auth.user!.displayName.isNotEmpty
                ? auth.user!.displayName[0].toUpperCase()
                : '?',
            style: const TextStyle(
              color: DayzoColors.accent,
              fontWeight: FontWeight.w700,
              fontSize: 14,
            ),
          ),
        ),
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
            value: t.binanceCompra,
            currency: 'VES',
            accentColor: DayzoColors.green,
            delta: snap.binanceStats,
          ),
          RateCard(
            label: 'Binance · Vender',
            value: t.binance,
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

class _StaleBanner extends StatelessWidget {
  const _StaleBanner({required this.provider});

  final TasasProvider provider;

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
