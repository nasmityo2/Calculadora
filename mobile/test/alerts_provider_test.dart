import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:dayzo_app/features/alerts/alert_rule.dart';
import 'package:dayzo_app/features/alerts/alerts_provider.dart';
import 'package:dayzo_app/features/alerts/alerts_repository.dart';

class MockAlertsRepository extends Mock implements AlertsRepository {}

void main() {
  group('AlertsProvider — edge-trigger (flanco)', () {
    late AlertsProvider provider;
    late AlertRule rule;

    setUp(() async {
      registerFallbackValue(
        const AlertRule(
          id: '',
          tipo: AlertTipo.binance,
          condicion: AlertCondicion.mayorQue,
          umbral: 0,
        ),
      );
      registerFallbackValue(<AlertRule>[]);

      final repo = MockAlertsRepository();
      when(() => repo.load()).thenAnswer((_) async => []);
      when(() => repo.save(any())).thenAnswer((_) async => {});

      provider = AlertsProvider.test(repo);

      rule = const AlertRule(
        id: 'test-1',
        tipo: AlertTipo.binance,
        condicion: AlertCondicion.mayorQue,
        umbral: 100,
      );
      await provider.addRule(rule);
    });

    TasasSnapshotForAlerts dataWith(double binance) {
      return TasasSnapshotForAlerts(
        binance: binance,
        binanceCompra: 0,
        bcv: 0,
        bcvPublicada: 0,
        diffBs: 0,
      );
    }

    test('primer cruce del umbral dispara la alerta', () {
      expect(provider.evaluate(dataWith(90)), isEmpty);

      final result = provider.evaluate(dataWith(105));
      expect(result, hasLength(1));
      expect(result[0].$1.id, 'test-1');
      expect(result[0].$2, 105);
    });

    test('mantenerse cruzado NO re-dispara', () {
      expect(provider.evaluate(dataWith(105)), hasLength(1));

      // Still above threshold → debounce blocks re-fire
      expect(provider.evaluate(dataWith(110)), isEmpty);
      expect(provider.evaluate(dataWith(120)), isEmpty);
    });

    test('volver por debajo y recruzar dispara de nuevo', () {
      expect(provider.evaluate(dataWith(105)), hasLength(1));

      // Re-arm
      expect(provider.evaluate(dataWith(90)), isEmpty);

      // Clean re-cross → fires (re-arm resets debounce)
      final result = provider.evaluate(dataWith(110));
      expect(result, hasLength(1));
      expect(result[0].$1.id, 'test-1');
      expect(result[0].$2, 110);
    });

    test('menorQue también dispara por flanco', () async {
      final ltRule = const AlertRule(
        id: 'test-lt',
        tipo: AlertTipo.binance,
        condicion: AlertCondicion.menorQue,
        umbral: 50,
      );
      await provider.addRule(ltRule);

      expect(provider.evaluate(dataWith(60)), isEmpty);

      final result = provider.evaluate(dataWith(40));
      expect(result, hasLength(1));
      expect(result[0].$1.id, 'test-lt');
      expect(result[0].$2, 40);
    });

    test('debounce anti-rebote mientras se mantiene en estado fired', () {
      // First cross
      expect(provider.evaluate(dataWith(105)), hasLength(1));

      // Same state (still fired) → no re-fire (flanco puro)
      expect(provider.evaluate(dataWith(110)), isEmpty);

      // Re-arm → _lastFiredAt is cleared
      provider.evaluate(dataWith(90));

      // Re-cross → fires because it's a clean edge
      final result = provider.evaluate(dataWith(105));
      expect(result, hasLength(1));
    });

    test('mantenerse cruzado con reloj avanzado >2s NO re-dispara (flanco puro)', () {
      int fakeNow = 0;
      provider.setNowOverride(() => DateTime.fromMillisecondsSinceEpoch(fakeNow));

      // Primer cruce en t=0
      var result = provider.evaluate(dataWith(105));
      expect(result, hasLength(1));
      expect(result[0].$1.id, 'test-1');

      // Avanzar 3s, seguir sobre el umbral → NO debe re-disparar
      fakeNow = 3000;
      result = provider.evaluate(dataWith(110));
      expect(result, isEmpty);

      // Avanzar 10s más → sigue sin disparar (flanco puro)
      fakeNow = 13000;
      result = provider.evaluate(dataWith(120));
      expect(result, isEmpty);

      provider.clearNowOverride();
    });
  });
}
