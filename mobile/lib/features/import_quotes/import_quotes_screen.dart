import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:dayzo_app/data/repositories/import_quotes_repository.dart';
import 'package:dayzo_app/features/auth/auth_provider.dart';
import 'package:dayzo_app/features/import_quotes/import_quotes_provider.dart';
import 'package:dayzo_app/features/import_quotes/widgets/quote_card.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';

class ImportQuotesScreen extends StatefulWidget {
  const ImportQuotesScreen({super.key});

  @override
  State<ImportQuotesScreen> createState() => _ImportQuotesScreenState();
}

class _ImportQuotesScreenState extends State<ImportQuotesScreen> {
  final _provider = ImportQuotesProvider();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadQuotes();
    });
  }

  Future<void> _loadQuotes() async {
    try {
      await _provider.load();
    } on SessionExpired {
      if (mounted) context.read<AuthProvider>().bootstrap();
    }
  }

  Future<void> _removeQuote(int id) async {
    try {
      await _provider.remove(id);
      if (_provider.error != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_provider.error!),
            backgroundColor: DayzoColors.red,
          ),
        );
      }
    } on SessionExpired {
      if (mounted) context.read<AuthProvider>().bootstrap();
    }
  }

  @override
  void dispose() {
    _provider.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: _provider,
      child: Consumer<ImportQuotesProvider>(
        builder: (context, provider, _) {
          return Scaffold(
            appBar: AppBar(
              title: const Text('Mis cotizaciones'),
              leading: IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => context.pop(),
              ),
            ),
            body: _buildBody(provider),
          );
        },
      ),
    );
  }

  Widget _buildBody(ImportQuotesProvider provider) {
    if (provider.loading) {
      return const Center(
        child: CircularProgressIndicator(color: DayzoColors.accent),
      );
    }

    if (provider.error != null && provider.items.isEmpty) {
      return _ErrorView(
        message: provider.error!,
        onRetry: _loadQuotes,
      );
    }

    if (provider.items.isEmpty) {
      return const _EmptyView();
    }

    return RefreshIndicator(
      color: DayzoColors.accent,
      onRefresh: _loadQuotes,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(top: 8, bottom: 24),
        itemCount: provider.items.length,
        itemBuilder: (context, index) {
          final item = provider.items[index];
          return Dismissible(
            key: ValueKey(item.id),
            direction: DismissDirection.endToStart,
            background: Container(
              alignment: Alignment.centerRight,
              padding: const EdgeInsets.only(right: 24),
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
              decoration: BoxDecoration(
                color: DayzoColors.red.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.delete_outline, color: DayzoColors.red),
            ),
            confirmDismiss: (direction) async {
              return _confirmDelete(context, item.name);
            },
            onDismissed: (_) {
              _removeQuote(item.id);
            },
            child: QuoteCard(
              item: item,
              onTap: () => context.push('/cotizaciones/${item.id}'),
            ),
          );
        },
      ),
    );
  }

  Future<bool> _confirmDelete(BuildContext context, String name) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: DayzoColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: const Text(
          'Eliminar cotización',
          style: TextStyle(color: DayzoColors.textInk, fontSize: 17),
        ),
        content: Text(
          '¿Estás seguro de eliminar "$name"? Esta acción no se puede deshacer.',
          style: const TextStyle(color: DayzoColors.textSoft, fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text(
              'Cancelar',
              style: TextStyle(color: DayzoColors.textSoft),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text(
              'Eliminar',
              style: TextStyle(color: DayzoColors.red),
            ),
          ),
        ],
      ),
    );
    return result ?? false;
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.description_outlined,
                color: DayzoColors.textSoft, size: 56),
            SizedBox(height: 16),
            Text(
              'No tienes cotizaciones',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: DayzoColors.textInk,
              ),
            ),
            SizedBox(height: 8),
            Text(
              'Crea tu primera cotización de importación desde la web.',
              style: TextStyle(fontSize: 13, color: DayzoColors.textSoft),
              textAlign: TextAlign.center,
            ),
          ],
        ),
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
            const Text(
              'No se pudieron cargar las cotizaciones',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
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
              style:
                  FilledButton.styleFrom(backgroundColor: DayzoColors.accent),
              child: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }
}
