import 'package:dio/dio.dart';

import 'package:dayzo_app/core/auth/token_store.dart';
import 'package:dayzo_app/core/network/dio_client.dart';
import 'package:dayzo_app/data/models/auth_user.dart';

class AuthException implements Exception {
  const AuthException(this.message);
  final String message;

  @override
  String toString() => message;
}

class AuthRepository {
  AuthRepository._();

  static final AuthRepository instance = AuthRepository._();

  late final Dio _dio;

  Future<void> _ensureDio() async {
    _dio = (await DioClient.getInstance()).dio;
  }

  Future<AuthUser> login(String identifier, String password) async {
    await _ensureDio();

    try {
      final response = await _dio.post(
        '/api/auth/login',
        data: {'username': identifier, 'password': password},
      );

      final data = response.data as Map<String, dynamic>;
      if (data['success'] != true) {
        throw AuthException(data['error'] as String? ?? 'Error al iniciar sesión');
      }

      final csrfToken = data['csrfToken'] as String?;
      if (csrfToken != null) {
        await TokenStore.instance.save(csrfToken);
      }

      return AuthUser(
        username: data['username'] as String,
        fullName: data['fullName'] as String?,
        email: '',
        role: data['role'] as String,
      );
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        final body = e.response?.data as Map<String, dynamic>?;
        throw AuthException(
          body?['error'] as String? ?? 'Usuario o contraseña incorrectos',
        );
      }
      throw const AuthException('Error de conexión. Intente de nuevo.');
    }
  }

  Future<void> register({
    required String fullName,
    required String username,
    required String email,
    required String password,
  }) async {
    await _ensureDio();

    try {
      final response = await _dio.post(
        '/api/auth/register',
        data: {
          'fullName': fullName,
          'username': username,
          'email': email,
          'password': password,
        },
      );

      final data = response.data as Map<String, dynamic>;
      if (data['success'] != true) {
        throw AuthException(data['error'] as String? ?? 'Error al registrarse');
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 409) {
        final body = e.response?.data as Map<String, dynamic>?;
        throw AuthException(
          body?['error'] as String? ?? 'El usuario ya existe',
        );
      }
      throw const AuthException('Error de conexión. Intente de nuevo.');
    }
  }

  Future<AuthUser?> me() async {
    await _ensureDio();

    try {
      final response = await _dio.get('/api/auth/me');
      final data = response.data as Map<String, dynamic>;

      if (data['loggedIn'] != true) return null;

      final csrfToken = data['csrfToken'] as String?;
      if (csrfToken != null) {
        await TokenStore.instance.save(csrfToken);
      }

      return AuthUser.fromJson(data);
    } on DioException {
      return null;
    }
  }

  Future<void> logout() async {
    await _ensureDio();

    try {
      await _dio.post('/api/auth/logout');
    } on DioException {
      // Fallo en logout — intentamos limpiar local de todas formas.
    }

    await TokenStore.instance.clear();
  }
}
