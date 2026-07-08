# DAYZO — App móvil (Flutter)

Cliente **nativo** para Android que consume la API de la calculadora web en `https://dayzove.lat`.

## Qué incluye (v1)

- Tasas en vivo: Binance compra/venta, BCV, CNY
- WebSocket `/tasas-ws` para actualizaciones automáticas
- Brecha Binance vs BCV
- Calculadora de divisas (misma lógica que la web)
- Tema oscuro DAYZO

## Requisitos en tu PC

1. [Flutter SDK](https://docs.flutter.dev/get-started/install) (3.16+)
2. Android Studio o solo Android SDK + JDK 17
3. Un teléfono Android o emulador

Verificar:

```bash
flutter doctor
```

## Compilar el APK

```bash
cd mobile
flutter pub get
flutter build apk --release
```

El APK queda en:

```
mobile/build/app/outputs/flutter-apk/app-release.apk
```

### APK de prueba (debug, más rápido)

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

## Estructura

```
mobile/
├── lib/
│   ├── config/api_config.dart      # URL base y endpoints
│   ├── models/tasas_data.dart      # Modelos de respuesta API
│   ├── services/tasas_repository.dart # HTTP + WebSocket
│   ├── providers/tasas_provider.dart
│   ├── utils/currency_calculator.dart
│   ├── screens/home_screen.dart
│   └── widgets/
├── android/                        # Proyecto Android (Gradle)
└── pubspec.yaml
```

## Próximas fases (no incluidas aún)

- Gráfico histórico
- Módulo de importación (requiere login)
- Login / cotizaciones guardadas

## Nota

Este código vive en el mismo repo que el servidor Node. **Compilar el APK se hace en tu computadora**, no en el VPS de producción (falta RAM y Android SDK).
