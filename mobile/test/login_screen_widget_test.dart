import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:dayzo_app/features/auth/auth_provider.dart';
import 'package:dayzo_app/features/auth/login_screen.dart';
import 'package:dayzo_app/shared/theme/dayzo_theme.dart';

Widget buildTestApp() {
  return MaterialApp(
    theme: buildDayzoTheme(),
    home: ChangeNotifierProvider(
      create: (_) => AuthProvider(),
      child: const LoginScreen(),
    ),
  );
}

void main() {
  testWidgets('muestra campos de login y botón', (tester) async {
    await tester.pumpWidget(buildTestApp());
    await tester.pumpAndSettle();

    expect(find.text('DAYZO'), findsOneWidget);
    expect(find.text('Inicia sesión en tu cuenta'), findsOneWidget);
    expect(find.text('Usuario o correo electrónico'), findsOneWidget);
    expect(find.text('Contraseña'), findsOneWidget);
    expect(find.text('Iniciar sesión'), findsOneWidget);
    expect(find.textContaining('No tienes cuenta'), findsOneWidget);
    expect(find.text('Regístrate'), findsOneWidget);
  });

  testWidgets('valida campos vacíos', (tester) async {
    await tester.pumpWidget(buildTestApp());
    await tester.pumpAndSettle();

    // Tap the login button without filling fields
    await tester.tap(find.text('Iniciar sesión'));
    await tester.pumpAndSettle();

    expect(find.text('Ingresa tu usuario o correo'), findsOneWidget);
    expect(find.text('Ingresa tu contraseña'), findsOneWidget);
  });

  testWidgets('alterna visibilidad de contraseña', (tester) async {
    await tester.pumpWidget(buildTestApp());
    await tester.pumpAndSettle();

    // Initially password is obscured
    final passwordField = tester.widget<TextField>(
      find.byType(TextField).last,
    );
    expect(passwordField.obscureText, isTrue);

    // Tap visibility toggle
    await tester.tap(find.byIcon(Icons.visibility_off));
    await tester.pumpAndSettle();

    final passwordFieldAfter = tester.widget<TextField>(
      find.byType(TextField).last,
    );
    expect(passwordFieldAfter.obscureText, isFalse);
  });

  testWidgets('no muestra error al inicio', (tester) async {
    await tester.pumpWidget(buildTestApp());
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.error_outline), findsNothing);
  });
}
