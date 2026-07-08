import 'package:flutter/foundation.dart';

import 'package:dayzo_app/data/models/auth_user.dart';
import 'package:dayzo_app/data/repositories/auth_repository.dart';

class AuthProvider extends ChangeNotifier {
  final AuthRepository _repo;

  AuthProvider({AuthRepository? repo}) : _repo = repo ?? AuthRepository.instance;

  AuthUser? _user;
  bool _loading = false;
  String? _error;
  bool _bootstrapped = false;

  AuthUser? get user => _user;
  bool get loading => _loading;
  String? get error => _error;
  bool get isLoggedIn => _user != null;
  bool get bootstrapped => _bootstrapped;

  Future<void> bootstrap() async {
    if (_bootstrapped) return;
    _loading = true;
    notifyListeners();

    try {
      _user = await _repo.me();
    } catch (_) {
      _user = null;
    } finally {
      _loading = false;
      _bootstrapped = true;
      notifyListeners();
    }
  }

  Future<void> login(String identifier, String password) async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      _user = await _repo.login(identifier, password);
    } on AuthException catch (e) {
      _error = e.message;
      rethrow;
    } catch (_) {
      _error = 'Error de conexión. Intente de nuevo.';
      rethrow;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> register({
    required String fullName,
    required String username,
    required String email,
    required String password,
  }) async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      await _repo.register(
        fullName: fullName,
        username: username,
        email: email,
        password: password,
      );
    } on AuthException catch (e) {
      _error = e.message;
      rethrow;
    } catch (_) {
      _error = 'Error de conexión. Intente de nuevo.';
      rethrow;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await _repo.logout();
    _user = null;
    _error = null;
    notifyListeners();
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }
}
