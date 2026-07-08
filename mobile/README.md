# DAYZO — App móvil (Flutter)

Cliente **nativo** para Android que consume la API de la calculadora web en `https://dayzove.lat`.

## Qué incluye (v1)

- Tasas en vivo: Binance compra/venta, BCV, CNY
- WebSocket `/tasas-ws` para actualizaciones automáticas
- Brecha Binance vs BCV con estadística de 24h
- Calculadora de divisas (VES, USDT, BCV, CNY) — misma lógica que la web
- Calculadora histórica (consultar tasas de una fecha/hora pasada)
- Gráfico de historial con selección de rango (24h, 7D, Mes, Todo)
- Login/registro de usuarios
- Cotizaciones de importación (CRUD)
- Alertas de tasas con notificaciones push
- Widget de inicio (Android Home Screen Widget)
- Tema oscuro DAYZO
- Pantalla de splash nativa (Android 12+)

## Requisitos en tu PC

1. [Flutter SDK](https://docs.flutter.dev/get-started/install) (3.16+)
2. Android Studio o solo Android SDK + JDK 17
3. Un teléfono Android o emulador

Verificar:

```bash
flutter doctor
```

## Compilar el APK

### Release (producción)

```bash
cd mobile
flutter pub get
flutter build apk --release --dart-define=API_BASE_URL=https://dayzove.lat
```

El APK firmado queda en:

```
mobile/build/app/outputs/flutter-apk/app-release.apk
```

### Debug (pruebas)

```bash
flutter build apk --debug
```

### Instalar directo en un teléfono conectado por USB

```bash
flutter run --release
```

## Cambiar la URL de la API

Por defecto apunta a `https://dayzove.lat`. Para otro servidor:

```bash
flutter build apk --release --dart-define=API_BASE_URL=https://tu-dominio.com
```

## Tests

```bash
# Análisis estático (0 warnings)
flutter analyze

# Tests unitarios y de widgets (49 tests)
flutter test
```

## Estructura del proyecto

```
mobile/
├── lib/
│   ├── core/
│   │   ├── auth/token_store.dart
│   │   ├── config/
│   │   │   ├── api_config.dart      # URL base y endpoints
│   │   │   └── env.dart             # Variables de entorno (compile-time)
│   │   ├── db/local_db.dart         # Caché SQLite
│   │   ├── network/
│   │   │   ├── connectivity_service.dart
│   │   │   └── dio_client.dart
│   │   ├── notifications/notifications_service.dart
│   │   ├── router/app_router.dart
│   │   ├── utils/formatters.dart
│   │   └── widget/home_widget_service.dart
│   ├── data/
│   │   ├── models/                  # TasasData, HistorialPoint, etc.
│   │   └── repositories/           # TasasRepository, AuthRepository, etc.
│   ├── features/                   # feature-first architecture
│   │   ├── alerts/                 # Alertas de tasas
│   │   ├── auth/                   # Login + Registro
│   │   ├── calculator/             # CurrencyCalculator
│   │   ├── history/                # Historial (gráfico)
│   │   ├── history_calc/           # Calculadora histórica
│   │   ├── import_quotes/          # Cotizaciones de importación
│   │   └── rates/                  # HomeScreen (tasas en vivo)
│   └── shared/
│       ├── theme/dayzo_theme.dart
│       └── widgets/offline_banner.dart
├── test/                           # Tests (49 tests)
│   ├── currency_calculator_test.dart
│   ├── formatters_test.dart
│   ├── home_screen_widget_test.dart
│   ├── login_screen_widget_test.dart
│   └── models_parsing_test.dart
├── assets/
│   └── dayzo_splash_logo.png       # Logo para splash screen
├── flutter_native_splash.yaml      # Config de splash
├── tool/
│   └── generate_splash_logo_test.dart  # Script para regenerar logo
└── pubspec.yaml
```

## Widget de inicio (Android Home Screen Widget)

Se implementó con el paquete [`home_widget`](https://pub.dev/packages/home_widget) (v0.9.3).

### Archivos creados / modificados

| Archivo | Propósito |
|---|---|
| `android/app/src/main/kotlin/.../DayzoHomeWidget.kt` | `AppWidgetProvider` que lee datos desde `SharedPreferences` y actualiza las `RemoteViews`. |
| `android/app/src/main/res/xml/home_widget_info.xml` | Metadatos del widget: tamaño mínimo, categoría, layout inicial. |
| `android/app/src/main/res/layout/home_widget_layout.xml` | Layout XML con textos para Binance compra, BCV y timestamp. |
| `android/app/src/main/AndroidManifest.xml` | Registro del `<receiver>` con el filtro `APPWIDGET_UPDATE`. |
| `lib/core/widget/home_widget_service.dart` | Servicio Dart que guarda datos (`saveWidgetData`) y gatilla la actualización (`updateWidget`). |
| `lib/features/rates/tasas_provider.dart` | Llama a `HomeWidgetService.updateHomeWidget` tras cada `refresh()` y cada WebSocket update. |

### Pasos manuales de Android

1. **No requieren acción** — el `AndroidManifest.xml` ya tiene el `<receiver>` apuntando a `DayzoHomeWidget`.
2. El widget se agrega desde el menú de widgets del launcher de Android arrastrando "DAYZO" a la pantalla de inicio.
3. Para ver cambios después de una actualización de datos, el widget se refresca automáticamente al recibir un update vía WebSocket o al abrir la app (pull-to-refresh).
4. Si se desea cambiar el layout o añadir más campos:
   - Editar `res/layout/home_widget_layout.xml`
   - Actualizar `DayzoHomeWidget.kt` con los nuevos `R.id.*`
   - Agregar las claves en `HomeWidgetService.updateHomeWidget`
5. Nota: `updatePeriodMillis` está en `86400000` (24 h). El widget se actualiza principalmente cuando la app está abierta y recibe datos.

## Core library desugaring

`flutter_local_notifications` requiere desugaring de Java 8+.
Ya está configurado en `android/app/build.gradle.kts`:

```kotlin
compileOptions {
    isCoreLibraryDesugaringEnabled = true
    // ...
}
dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
```

## Nota

Este código vive en el mismo repo que el servidor Node. **Compilar el APK se hace en tu computadora**, no en el VPS de producción (falta RAM y Android SDK).
