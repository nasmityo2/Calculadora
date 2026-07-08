import 'package:intl/intl.dart';

final moneyFmt = NumberFormat('#,##0.00', 'es_VE');

String formatMoney(num value) => moneyFmt.format(value);

String formatBcvDate(String? ymd) {
  if (ymd == null || ymd.isEmpty) return '';
  final d = DateTime.parse('${ymd}T12:00:00-04:00');
  final s = DateFormat('EEEE, d MMMM', 'es_VE').format(d);
  if (s.isEmpty) return ymd;
  return s[0].toUpperCase() + s.substring(1);
}

String extractTimeFromUpdate(String lastUpdate) {
  if (lastUpdate.isEmpty) return '--:--';
  final parts = lastUpdate.split(',');
  if (parts.length > 1) return parts[1].trim();
  return lastUpdate;
}

double parseLocaleAmount(String raw) {
  final cleaned = raw.trim().replaceAll(RegExp(r'[^\d,.\-]'), '');
  if (cleaned.isEmpty) return 0;
  final normalized = cleaned.contains(',') && cleaned.contains('.')
      ? cleaned.replaceAll('.', '').replaceAll(',', '.')
      : cleaned.replaceAll(',', '.');
  return double.tryParse(normalized) ?? 0;
}
