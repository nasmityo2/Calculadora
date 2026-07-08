import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class DayzoColors {
  static const bgPage = Color(0xFF0B0E11);
  static const bgCard = Color(0xFF1E2329);
  static const bgElevated = Color(0xFF2B3139);
  static const bgInput = Color(0xFF181C20);
  static const textInk = Color(0xFFEAECEF);
  static const textSoft = Color(0xFF848E9C);
  static const accent = Color(0xFFE8541A);
  static const green = Color(0xFF0ECB81);
  static const red = Color(0xFFF6465D);
  static const blue = Color(0xFF3B82F6);
  static const amber = Color(0xFFF0B90B);
}

ThemeData buildDayzoTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: DayzoColors.bgPage,
    colorScheme: const ColorScheme.dark(
      primary: DayzoColors.accent,
      surface: DayzoColors.bgCard,
      onSurface: DayzoColors.textInk,
    ),
  );

  return base.copyWith(
    textTheme: GoogleFonts.dmSansTextTheme(base.textTheme).apply(
      bodyColor: DayzoColors.textInk,
      displayColor: DayzoColors.textInk,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: DayzoColors.bgPage,
      elevation: 0,
      centerTitle: false,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: DayzoColors.bgInput,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: DayzoColors.accent, width: 1.2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
  );
}

TextStyle displayLogoStyle() {
  return GoogleFonts.playfairDisplay(
    fontSize: 22,
    fontWeight: FontWeight.w900,
    color: DayzoColors.textInk,
    letterSpacing: 0.5,
  );
}

TextStyle monoValueStyle({double size = 28, Color? color}) {
  return GoogleFonts.dmMono(
    fontSize: size,
    fontWeight: FontWeight.w500,
    color: color ?? DayzoColors.textInk,
    letterSpacing: -0.5,
  );
}
