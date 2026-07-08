import 'package:dayzo_app/core/utils/formatters.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('es_VE');
  });

  group('formatMoney', () {
    test('formats whole numbers', () {
      expect(formatMoney(1000), '1.000,00');
    });

    test('formats decimals', () {
      expect(formatMoney(1234.56), '1.234,56');
    });

    test('formats zero', () {
      expect(formatMoney(0), '0,00');
    });
  });

  group('formatBcvDate', () {
    test('formats valid date', () {
      final result = formatBcvDate('2024-01-15');
      expect(result, contains('15'));
      expect(result, contains('enero'));
    });

    test('returns empty for null', () {
      expect(formatBcvDate(null), '');
    });

    test('returns empty for empty string', () {
      expect(formatBcvDate(''), '');
    });
  });

  group('extractTimeFromUpdate', () {
    test('extracts time from comma-separated string', () {
      expect(extractTimeFromUpdate('2024-01-15, 10:30'), '10:30');
    });

    test('returns placeholder for empty', () {
      expect(extractTimeFromUpdate(''), '--:--');
    });

    test('returns original if no comma', () {
      expect(extractTimeFromUpdate('10:30'), '10:30');
    });
  });

  group('parseLocaleAmount', () {
    test('parses integer', () {
      expect(parseLocaleAmount('1000'), 1000.0);
    });

    test('parses with comma as decimal separator', () {
      expect(parseLocaleAmount('1000,50'), 1000.50);
    });

    test('parses with dot as thousand separator and comma as decimal', () {
      expect(parseLocaleAmount('1.000,50'), 1000.50);
    });

    test('returns 0 for empty string', () {
      expect(parseLocaleAmount(''), 0);
    });

    test('handles negative values', () {
      expect(parseLocaleAmount('-100'), -100.0);
    });

    test('strips non-numeric characters', () {
      expect(parseLocaleAmount('  1.234,56 abc '), 1234.56);
    });
  });
}
