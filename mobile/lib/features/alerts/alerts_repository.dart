import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'package:dayzo_app/features/alerts/alert_rule.dart';

class AlertsRepository {
  static const _key = 'dayzo_alerts_rules';

  Future<List<AlertRule>> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) return [];
    final list = jsonDecode(raw) as List<dynamic>;
    return list
        .map((e) => AlertRule.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> save(List<AlertRule> rules) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = jsonEncode(rules.map((r) => r.toJson()).toList());
    await prefs.setString(_key, raw);
  }
}
