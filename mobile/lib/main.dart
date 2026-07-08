import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'package:dayzo_app/core/network/connectivity_service.dart';
import 'package:dayzo_app/core/notifications/notifications_service.dart';
import 'package:dayzo_app/core/router/app_router.dart';
import 'package:dayzo_app/data/models/tasas_data.dart';
import 'package:dayzo_app/features/alerts/alert_rule.dart';
import 'package:dayzo_app/features/alerts/alerts_provider.dart';
import 'package:dayzo_app/features/auth/auth_provider.dart';
import 'package:dayzo_app/features/rates/tasas_provider.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: DayzoColors.bgPage,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const DayzoApp());
}

class DayzoApp extends StatefulWidget {
  const DayzoApp({super.key});

  @override
  State<DayzoApp> createState() => _DayzoAppState();
}

class _DayzoAppState extends State<DayzoApp> {
  final _authProvider = AuthProvider();
  final _tasasProvider = TasasProvider();
  final _alertsProvider = AlertsProvider();

  @override
  void initState() {
    super.initState();
    _authProvider.bootstrap();
    _alertsProvider.init();

    // Init notifications
    NotificationsService.instance.init();

    // Wire alert evaluation after each rate update
    _tasasProvider.onRateUpdate = (snapshot) {
      final data = _tasasSnapshotToAlertsData(snapshot);
      final triggered = _alertsProvider.evaluate(data);
      for (final (rule, value) in triggered) {
        final direccion = rule.condicion == AlertCondicion.mayorQue
            ? 'subió de'
            : 'bajó de';
        NotificationsService.instance.showRateAlert(
          id: int.tryParse(rule.id) ?? rule.id.hashCode,
          title: '🔔 Alerta: ${rule.tipoLabel}',
          body: '${rule.tipoLabel} $direccion ${rule.umbral.toStringAsFixed(2)} VES — ahora en ${value.toStringAsFixed(2)} VES',
        );
      }
    };
  }

  @override
  void dispose() {
    _authProvider.dispose();
    _tasasProvider.dispose();
    _alertsProvider.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _authProvider),
        ChangeNotifierProvider.value(value: _tasasProvider),
        ChangeNotifierProvider.value(value: _alertsProvider),
        ChangeNotifierProvider(create: (_) => ConnectivityService()),
      ],
      child: MaterialApp.router(
        title: 'DAYZO',
        debugShowCheckedModeBanner: false,
        theme: buildDayzoTheme(),
        routerConfig: buildRouter(),
      ),
    );
  }
}

/// Converts a TasasSnapshot into the lightweight data needed for alert evaluation.
TasasSnapshotForAlerts _tasasSnapshotToAlertsData(TasasSnapshot snapshot) {
  return TasasSnapshotForAlerts(
    binance: snapshot.tasas.binance,
    binanceCompra: snapshot.tasas.binanceCompra,
    bcv: snapshot.tasas.bcv,
    bcvPublicada: snapshot.tasas.bcvPublicada,
    diffBs: snapshot.diffBs,
  );
}
