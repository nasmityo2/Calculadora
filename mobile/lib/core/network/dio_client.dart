import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:cookie_jar/cookie_jar.dart';
import 'package:path_provider/path_provider.dart';

import 'package:dayzo_app/core/auth/token_store.dart';
import 'package:dayzo_app/core/config/api_config.dart';

class DioClient {
  DioClient._();

  static DioClient? _instance;
  late final Dio dio;
  late final CookieJar _jar;

  static Future<DioClient> getInstance() async {
    if (_instance != null) return _instance!;
    final instance = DioClient._();
    await instance._init();
    _instance = instance;
    return _instance!;
  }

  Future<void> _init() async {
    final dir = await getApplicationDocumentsDirectory();
    _jar = PersistCookieJar(
      ignoreExpires: false,
      storage: FileStorage('${dir.path}/.cookies'),
    );

    dio = Dio(
      BaseOptions(
        baseUrl: ApiConfig.baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 20),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      ),
    );

    dio.interceptors.add(CookieManager(_jar));
    dio.interceptors.add(_CsrfInterceptor());
  }
}

class _CsrfInterceptor extends Interceptor {
  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final path = options.path;
    final isMutating = options.method == 'POST' ||
        options.method == 'PUT' ||
        options.method == 'DELETE';
    final isAuthEndpoint =
        path.contains('/api/auth/login') || path.contains('/api/auth/register');

    if (isMutating && !isAuthEndpoint) {
      final token = await TokenStore.instance.read();
      if (token != null) {
        options.headers['x-csrf-token'] = token;
      }
    }

    handler.next(options);
  }
}
