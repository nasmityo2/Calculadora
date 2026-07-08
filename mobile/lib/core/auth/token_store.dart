import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class TokenStore {
  TokenStore._();

  static final TokenStore instance = TokenStore._();

  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  static const _csrfKey = 'csrf';

  Future<String?> read() => _storage.read(key: _csrfKey);

  Future<void> save(String token) => _storage.write(key: _csrfKey, value: token);

  Future<void> clear() => _storage.delete(key: _csrfKey);
}
