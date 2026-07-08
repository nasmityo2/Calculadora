import 'package:flutter/foundation.dart';

import 'package:dayzo_app/data/models/import_quote.dart';
import 'package:dayzo_app/data/repositories/import_quotes_repository.dart';

class ImportQuotesProvider extends ChangeNotifier {
  ImportQuotesProvider({ImportQuotesRepository? repository})
      : _repository = repository ?? ImportQuotesRepository.instance;

  final ImportQuotesRepository _repository;

  List<ImportQuoteListItem> items = [];
  bool loading = false;
  String? error;
  int total = 0;

  /// Retorna true si la excepción es SessionExpired.
  static bool isSessionExpired(Object e) => e is SessionExpired;

  Future<void> load() async {
    loading = true;
    error = null;
    notifyListeners();

    try {
      final result = await _repository.list();
      items = result.quotes;
      total = result.total;
    } on SessionExpired {
      loading = false;
      error = 'Sesión expirada';
      notifyListeners();
      rethrow;
    } catch (e) {
      error = e.toString();
      items = [];
      total = 0;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// Elimina una cotización con actualización optimista.
  /// Si el servidor rechaza, restaura el item.
  Future<bool> remove(int id) async {
    final index = items.indexWhere((q) => q.id == id);
    if (index == -1) return false;

    final removed = items.removeAt(index);
    total = total > 0 ? total - 1 : 0;
    notifyListeners();

    try {
      await _repository.delete(id);
      return true;
    } on SessionExpired {
      // Rollback
      items.insert(index, removed);
      total = total + 1;
      error = 'Sesión expirada';
      notifyListeners();
      rethrow;
    } catch (e) {
      // Rollback
      items.insert(index, removed);
      total = total + 1;
      error = e.toString();
      notifyListeners();
      return false;
    }
  }
}
