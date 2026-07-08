import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';

import 'package:dayzo_app/core/network/connectivity_service.dart';
import 'package:dayzo_app/data/repositories/tasas_repository.dart';
import 'package:dayzo_app/features/auth/auth_provider.dart';
import 'package:dayzo_app/features/rates/home_screen.dart';
import 'package:dayzo_app/features/rates/tasas_provider.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';

class MockTasasRepository extends Mock implements TasasRepository {}

Widget buildTestApp(TasasProvider tasasProvider) {
  return MaterialApp(
    theme: buildDayzoTheme(),
    home: MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: tasasProvider),
        ChangeNotifierProvider(create: (_) => ConnectivityService()),
        ChangeNotifierProvider(create: (_) => AuthProvider()),
      ],
      child: const HomeScreen(),
    ),
  );
}

void main() {
  testWidgets('muestra loading indicator inicial', (tester) async {
    final repo = MockTasasRepository();
    when(() => repo.fetchTasas()).thenAnswer((_) => Future.error('test'));
    when(() => repo.getCachedSnapshot()).thenAnswer((_) => Future.value(null));
    when(() => repo.dispose()).thenAnswer((_) {});

    final tasasProvider = TasasProvider(repository: repo);
    addTearDown(tasasProvider.dispose);

    await tester.pumpWidget(buildTestApp(tasasProvider));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('muestra error view con retry cuando hay error', (tester) async {
    final repo = MockTasasRepository();
    when(() => repo.fetchTasas()).thenAnswer((_) => Future.error('test'));
    when(() => repo.getCachedSnapshot()).thenAnswer((_) => Future.value(null));
    when(() => repo.dispose()).thenAnswer((_) {});

    final tasasProvider = TasasProvider(repository: repo);
    addTearDown(tasasProvider.dispose);

    // Pump and let init cycle complete (will show error via refresh failure)
    await tester.pumpWidget(buildTestApp(tasasProvider));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // Now the init (refresh) has failed and error should be set to 'Exception: test'
    expect(find.text('No se pudieron cargar las tasas'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
  });
}
