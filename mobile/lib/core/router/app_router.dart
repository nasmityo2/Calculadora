import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:dayzo_app/features/auth/auth_provider.dart';
import 'package:dayzo_app/features/auth/login_screen.dart';
import 'package:dayzo_app/features/auth/register_screen.dart';
import 'package:dayzo_app/features/history/historial_screen.dart';
import 'package:dayzo_app/features/history_calc/provider/historic_calc_provider.dart';
import 'package:dayzo_app/features/history_calc/screen/historic_calculator_screen.dart';
import 'package:dayzo_app/features/import_quotes/import_quote_detail_screen.dart';
import 'package:dayzo_app/features/import_quotes/import_quotes_screen.dart';
import 'package:dayzo_app/features/alerts/alerts_screen.dart';
import 'package:dayzo_app/features/rates/home_screen.dart';

GoRouter buildRouter() {
  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final auth = context.read<AuthProvider>();
      final isLoggedIn = auth.isLoggedIn;
      final location = state.uri.path;

      final publicRoutes = {'/', '/login', '/registro', '/calculadora-historica', '/alertas', '/historial'};
      final isPublic = publicRoutes.contains(location);

      if (!isLoggedIn && !isPublic) {
        return '/login';
      }

      if (isLoggedIn && (location == '/login' || location == '/registro')) {
        return '/';
      }

      return null;
    },
    routes: [
      GoRoute(
        path: '/',
        name: 'home',
        builder: (_, _) => const HomeScreen(),
      ),
      GoRoute(
        path: '/historial',
        name: 'historial',
        builder: (_, _) => const HistorialScreen(),
      ),
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (_, _) => const LoginScreen(),
      ),
      GoRoute(
        path: '/registro',
        name: 'registro',
        builder: (_, _) => const RegisterScreen(),
      ),
      GoRoute(
        path: '/calculadora-historica',
        name: 'calculadora-historica',
        builder: (_, _) => HistoricCalculatorScreen(
          provider: HistoricCalcProvider(),
        ),
      ),
      GoRoute(
        path: '/alertas',
        name: 'alertas',
        builder: (_, _) => const AlertsScreen(),
      ),
      GoRoute(
        path: '/cotizaciones',
        name: 'cotizaciones',
        builder: (_, _) => const ImportQuotesScreen(),
        routes: [
          GoRoute(
            path: ':id',
            name: 'cotizacion-detalle',
            builder: (_, state) {
              final id = int.parse(state.pathParameters['id']!);
              return ImportQuoteDetailScreen(quoteId: id);
            },
          ),
        ],
      ),
    ],
  );
}

