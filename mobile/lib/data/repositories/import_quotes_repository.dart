import 'package:dio/dio.dart';

import 'package:dayzo_app/core/network/dio_client.dart';
import 'package:dayzo_app/data/models/import_quote.dart';

class SessionExpired implements Exception {
  const SessionExpired();
}

class ImportQuotesRepository {
  ImportQuotesRepository._();

  static final ImportQuotesRepository instance = ImportQuotesRepository._();

  late final Dio _dio;

  Future<void> _ensureDio() async {
    _dio = (await DioClient.getInstance()).dio;
  }

  Future<({int total, List<ImportQuoteListItem> quotes})> list() async {
    await _ensureDio();

    try {
      final response = await _dio.get('/api/import-quotes');
      final data = response.data as Map<String, dynamic>;
      final rawList = data['quotes'] as List<dynamic>? ?? [];
      final quotes = rawList
          .cast<Map<String, dynamic>>()
          .map((json) => ImportQuoteListItem.fromJson(json))
          .toList();
      final total = (data['total'] as num?)?.toInt() ?? quotes.length;
      return (total: total, quotes: quotes);
    } on DioException catch (e) {
      _handleDioError(e);
      rethrow;
    }
  }

  Future<ImportQuoteListItem> getById(int id) async {
    await _ensureDio();

    try {
      final response = await _dio.get('/api/import-quotes/$id');
      final data = response.data as Map<String, dynamic>;
      final quoteJson = data['quote'] as Map<String, dynamic>;
      return ImportQuoteListItem.fromJson(quoteJson);
    } on DioException catch (e) {
      _handleDioError(e);
      rethrow;
    }
  }

  Future<int> create({
    required String name,
    required Map<String, dynamic> quote,
  }) async {
    await _ensureDio();

    try {
      final response = await _dio.post(
        '/api/import-quotes',
        data: {'name': name, 'quote': quote},
      );
      final data = response.data as Map<String, dynamic>;
      return (data['id'] as num).toInt();
    } on DioException catch (e) {
      _handleDioError(e);
      rethrow;
    }
  }

  Future<void> update(
    int id, {
    String? name,
    Map<String, dynamic>? quote,
  }) async {
    await _ensureDio();

    try {
      final body = <String, dynamic>{};
      if (name != null) body['name'] = name;
      if (quote != null) body['quote'] = quote;
      await _dio.put('/api/import-quotes/$id', data: body);
    } on DioException catch (e) {
      _handleDioError(e);
      rethrow;
    }
  }

  Future<void> delete(int id) async {
    await _ensureDio();

    try {
      await _dio.delete('/api/import-quotes/$id');
    } on DioException catch (e) {
      _handleDioError(e);
      rethrow;
    }
  }

  void _handleDioError(DioException e) {
    if (e.response?.statusCode == 401) {
      throw const SessionExpired();
    }
  }
}
