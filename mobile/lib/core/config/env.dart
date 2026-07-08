/// Configuración de entorno inyectada en compile-time vía `--dart-define`.
///
/// Ejemplo:
/// ```bash
/// flutter build appbundle --release \
///   --dart-define=API_BASE_URL=https://dayzove.lat
/// ```
/// Nunca hardcodear secretos aquí ni en ningún otro archivo del repo.
class Env {
  Env._();

  /// URL base del backend (REST + WebSocket).
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://dayzove.lat',
  );

  /// Bandera para logging detallado de red (solo debug local).
  static const bool verboseNetworkLogs = bool.fromEnvironment(
    'VERBOSE_NETWORK_LOGS',
  );
}
