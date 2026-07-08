/// URL base de la API (mismo servidor que la web).
class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://dayzove.lat',
  );

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
}
