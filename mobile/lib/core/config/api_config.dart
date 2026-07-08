import 'env.dart';

/// URL base de la API (mismo servidor que la web).
class ApiConfig {
  static const String baseUrl = Env.apiBaseUrl;

  static Uri tasasUri({String range = '24h', bool stats = true}) {
    return Uri.parse('$baseUrl/api/tasas-venezuela').replace(
      queryParameters: {
        'range': range,
        if (stats) 'stats': '1',
      },
    );
  }

  static Uri statsUri() => Uri.parse('$baseUrl/api/stats');

  static Uri wsUri() {
    final base = Uri.parse(baseUrl);
    final scheme = base.scheme == 'https' ? 'wss' : 'ws';
    return Uri(
      scheme: scheme,
      host: base.host,
      port: base.hasPort ? base.port : null,
      path: '/tasas-ws',
    );
  }

  static Uri historialUri({required String range}) {
    return Uri.parse('$baseUrl/api/tasas-venezuela').replace(
      queryParameters: {
        'range': range,
        'stats': '1',
      },
    );
  }

  static Uri tasasHistoricasUri({required String fecha, String? hora}) {
    final params = <String, String>{'fecha': fecha};
    if (hora != null && hora.isNotEmpty) {
      params['hora'] = hora;
    }
    return Uri.parse('$baseUrl/api/tasas-historicas').replace(
      queryParameters: params,
    );
  }
}
