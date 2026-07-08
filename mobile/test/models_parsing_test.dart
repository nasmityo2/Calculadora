import 'package:dayzo_app/data/models/historial_point.dart';
import 'package:dayzo_app/data/models/historic_rates_result.dart';
import 'package:dayzo_app/data/models/import_quote.dart';
import 'package:dayzo_app/data/models/tasas_data.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Tasas fromJson', () {
    test('parses full json correctly', () {
      final json = {
        'binance': 100.5,
        'binance_compra': 98.3,
        'bcv': 80.1,
        'bcv_publicada': 80.1,
        'cny': 7.2,
      };
      final tasas = Tasas.fromJson(json);
      expect(tasas.binance, 100.5);
      expect(tasas.binanceCompra, 98.3);
      expect(tasas.bcv, 80.1);
      expect(tasas.bcvPublicada, 80.1);
      expect(tasas.cny, 7.2);
    });

    test('handles string values', () {
      final json = {
        'binance': '100.5',
        'binance_compra': '98.3',
        'bcv': '80.1',
        'bcv_publicada': '80.1',
        'cny': '7.2',
      };
      final tasas = Tasas.fromJson(json);
      expect(tasas.binance, 100.5);
      expect(tasas.binanceCompra, 98.3);
    });

    test('handles missing fields as 0', () {
      final json = <String, dynamic>{};
      final tasas = Tasas.fromJson(json);
      expect(tasas.binance, 0);
      expect(tasas.binanceCompra, 0);
      expect(tasas.bcv, 0);
    });
  });

  group('BcvMeta fromJson', () {
    test('parses full meta', () {
      final json = {
        'vigente_para': '2024-01-15',
        'publicada_el': '2024-01-14',
        'nota': 'Nueva tasa BCV publicada',
        'hay_nueva_publicada': true,
      };
      final meta = BcvMeta.fromJson(json);
      expect(meta.vigentePara, '2024-01-15');
      expect(meta.publicadaEl, '2024-01-14');
      expect(meta.nota, 'Nueva tasa BCV publicada');
      expect(meta.hayNuevaPublicada, true);
    });

    test('handles null json with defaults', () {
      final meta = BcvMeta.fromJson(null);
      expect(meta.vigentePara, isNull);
      expect(meta.publicadaEl, isNull);
      expect(meta.nota, isNull);
      expect(meta.hayNuevaPublicada, false);
    });
  });

  group('TasasSnapshot fromApi', () {
    test('parses full snapshot', () {
      final json = {
        'tasas': {
          'binance': 100.5,
          'binance_compra': 98.3,
          'bcv': 80.1,
          'bcv_publicada': 80.1,
          'cny': 7.2,
        },
        'bcv_meta': {
          'vigente_para': '2024-01-15',
          'publicada_el': '2024-01-14',
          'nota': null,
          'hay_nueva_publicada': false,
        },
        'diff_bs': 20.4,
        'diff_pct': 25.5,
        'last_update': '2024-01-15, 10:30',
      };
      final snap = TasasSnapshot.fromApi(json);
      expect(snap.tasas.binance, 100.5);
      expect(snap.diffBs, 20.4);
      expect(snap.diffPct, 25.5);
      expect(snap.lastUpdate, '2024-01-15, 10:30');
      expect(snap.binanceStats, isNull);
      expect(snap.bcvStats, isNull);
    });

    test('copyWithStats sets stats', () {
      final json = {
        'tasas': {
          'binance': 100.0,
          'binance_compra': 98.0,
          'bcv': 80.0,
          'bcv_publicada': 80.0,
          'cny': 7.0,
        },
        'bcv_meta': null,
        'diff_bs': 20.0,
        'diff_pct': 25.0,
        'last_update': '',
      };
      final snap = TasasSnapshot.fromApi(json);
      final withStats = snap.copyWithStats({
        'binance': {'change24h': 2.5, 'changePct24h': 2.5},
        'bcv': {'change24h': -0.5, 'changePct24h': -0.62},
      });
      expect(withStats.binanceStats!.change24h, 2.5);
      expect(withStats.binanceStats!.changePct24h, 2.5);
      expect(withStats.bcvStats!.change24h, -0.5);
    });

    test('applyWsUpdate preserves stats', () {
      final original = TasasSnapshot.fromApi({
        'tasas': {
          'binance': 100.0,
          'binance_compra': 98.0,
          'bcv': 80.0,
          'bcv_publicada': 80.0,
          'cny': 7.0,
        },
        'bcv_meta': null,
        'diff_bs': 20.0,
        'diff_pct': 25.0,
        'last_update': '',
      });
      final withStats = original.copyWithStats({
        'binance': {'change24h': 2.5, 'changePct24h': 2.5},
        'bcv': {'change24h': -0.5, 'changePct24h': -0.62},
      });

      final updated = withStats.applyWsUpdate({
        'tasas': {
          'binance': 102.0,
          'binance_compra': 100.0,
          'bcv': 81.0,
          'bcv_publicada': 81.0,
          'cny': 7.0,
        },
        'bcv_meta': {
          'vigente_para': null,
          'publicada_el': null,
          'nota': null,
          'hay_nueva_publicada': false,
        },
        'diff_bs': 21.0,
        'diff_pct': 25.9,
        'last_update': '',
      });

      expect(updated.tasas.binance, 102.0);
      expect(updated.diffBs, 21.0);
      // Stats should be preserved
      expect(updated.binanceStats!.change24h, 2.5);
      expect(updated.bcvStats!.change24h, -0.5);
    });

    test('cache round-trip restores binance_stats and bcv_stats', () {
      // Simulate the JSON that LocalDb.saveSnapshot() produces
      final cacheJson = {
        'tasas': {
          'binance': 100.5,
          'binance_compra': 98.3,
          'bcv': 80.1,
          'bcv_publicada': 80.1,
          'cny': 7.2,
        },
        'bcv_meta': {
          'vigente_para': '2024-01-15',
          'publicada_el': '2024-01-14',
          'nota': null,
          'hay_nueva_publicada': false,
        },
        'diff_bs': 20.4,
        'diff_pct': 25.5,
        'last_update': '2024-01-15, 10:30',
        'binance_stats': {'change24h': 2.5, 'changePct24h': 3.1},
        'bcv_stats': {'change24h': -0.5, 'changePct24h': -0.62},
      };

      final restored = TasasSnapshot.fromApi(cacheJson);

      expect(restored.binanceStats, isNotNull);
      expect(restored.binanceStats!.change24h, 2.5);
      expect(restored.binanceStats!.changePct24h, 3.1);
      expect(restored.bcvStats, isNotNull);
      expect(restored.bcvStats!.change24h, -0.5);
      expect(restored.bcvStats!.changePct24h, -0.62);
      // Core fields still OK
      expect(restored.tasas.binance, 100.5);
      expect(restored.diffBs, 20.4);
    });
  });

  group('HistorialPoint fromJson', () {
    test('parses correctly', () {
      final json = {
        'timestamp': 1705000000000,
        'binance': 100.5,
        'binance_compra': 98.3,
        'bcv': 80.1,
      };
      final point = HistorialPoint.fromJson(json);
      expect(point.time.millisecondsSinceEpoch, 1705000000000);
      expect(point.binance, 100.5);
      expect(point.binanceCompra, 98.3);
      expect(point.bcv, 80.1);
    });

    test('round-trips through toJson', () {
      final original = HistorialPoint(
        time: DateTime.fromMillisecondsSinceEpoch(1705000000000),
        binance: 100.5,
        binanceCompra: 98.3,
        bcv: 80.1,
      );
      final json = original.toJson();
      final restored = HistorialPoint.fromJson(json);
      expect(restored.time, original.time);
      expect(restored.binance, original.binance);
      expect(restored.binanceCompra, original.binanceCompra);
      expect(restored.bcv, original.bcv);
    });
  });

  group('ChartStats fromJson', () {
    test('parses correctly', () {
      final json = {
        'count': 100,
        'min': 80.0,
        'max': 105.0,
        'avg': 92.5,
        'range': '2024-01-01 - 2024-01-15',
      };
      final stats = ChartStats.fromJson(json);
      expect(stats.count, 100);
      expect(stats.min, 80.0);
      expect(stats.max, 105.0);
      expect(stats.avg, 92.5);
      expect(stats.range, '2024-01-01 - 2024-01-15');
    });
  });

  group('HistoricRatesResult fromJson', () {
    test('parses full response', () {
      final json = {
        'consulta': {'timestamp': '2024-01-15T10:30:00.000Z'},
        'tasas': {
          'binance': 100.5,
          'binance_compra': 98.3,
          'bcv': 80.1,
          'bcv_registrada': 80.0,
        },
        'diff_bs': 20.4,
        'diff_pct': 25.5,
        'registro': {'desfase_min': 5, 'fecha': '2024-01-15'},
      };
      final result = HistoricRatesResult.fromJson(json);
      expect(result.binance, 100.5);
      expect(result.binanceCompra, 98.3);
      expect(result.bcv, 80.1);
      expect(result.bcvRegistrada, 80.0);
      expect(result.diffBs, 20.4);
      expect(result.diffPct, 25.5);
      expect(result.desfaseMin, 5);
      expect(result.fecha, '2024-01-15');
    });
  });

  group('ImportQuoteListItem fromJson', () {
    test('parses full item', () {
      final json = {
        'id': 1,
        'name': 'Cotización prueba',
        'createdAt': '2024-01-15T10:00:00.000Z',
        'empresaNombre': 'Empresa XYZ',
        'empresaTarifaUSD': 5.0,
        'inversionTotalUSD': 10000.0,
        'costoUnitarioUSD': 50.0,
        'costoPorCajaUSD': 500.0,
        'volumenM3': 2.5,
        'pesoKg': 150.0,
        'ventaUnitarioUSD': 75.0,
        'gananciaTotalUSD': 5000.0,
        'margenVentaPct': 33.33,
        'quote': {'key': 'value'},
      };
      final item = ImportQuoteListItem.fromJson(json);
      expect(item.id, 1);
      expect(item.name, 'Cotización prueba');
      expect(item.empresaNombre, 'Empresa XYZ');
      expect(item.empresaTarifaUSD, 5.0);
      expect(item.inversionTotalUSD, 10000.0);
      expect(item.costoUnitarioUSD, 50.0);
      expect(item.costoPorCajaUSD, 500.0);
      expect(item.volumenM3, 2.5);
      expect(item.pesoKg, 150.0);
      expect(item.ventaUnitarioUSD, 75.0);
      expect(item.gananciaTotalUSD, 5000.0);
      expect(item.margenVentaPct, 33.33);
      expect(item.quote, {'key': 'value'});
    });

    test('handles null numerics', () {
      final json = {
        'id': 1,
        'name': 'Test',
        'createdAt': '2024-01-15T10:00:00.000Z',
      };
      final item = ImportQuoteListItem.fromJson(json);
      expect(item.empresaTarifaUSD, isNull);
      expect(item.inversionTotalUSD, isNull);
    });
  });
}
