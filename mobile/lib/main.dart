import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'package:dayzo_app/features/rates/tasas_provider.dart';
import 'package:dayzo_app/features/rates/home_screen.dart';
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

class DayzoApp extends StatelessWidget {
  const DayzoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => TasasProvider(),
      child: MaterialApp(
        title: 'DAYZO',
        debugShowCheckedModeBanner: false,
        theme: buildDayzoTheme(),
        home: const HomeScreen(),
      ),
    );
  }
}
