# DAYZO App Nativa — Stack técnico (decisión final Fase 0.4)

> Fijado en Julio 2026 durante la ejecución del plan `PLAN-APP-NATIVA-DAYZO.md`.

## Toolchain

| Herramienta | Versión | Nota |
|---|---|---|
| Flutter | 3.44.4 (stable) | instalado en `/opt/flutter` |
| Dart | 3.12.2 | constraint `>=3.9.0 <4.0.0` |
| JDK | 17 (OpenJDK) | `/usr/lib/jvm/java-17-openjdk-amd64` |
| Android SDK | Platform 36 + build-tools 36.0.0 | `/opt/android-sdk` |
| Gradle | 9.1.0 | wrapper del proyecto |
| AGP | 9.0.1 | `settings.gradle.kts` |
| Kotlin | 2.3.20 | `settings.gradle.kts` |
| minSdk | 24 (Android 7.0) | fijado explícito en `app/build.gradle.kts` |
| target/compileSdk | según Flutter (36) | requisito Play 2026 |

## Paquetes (dependencias directas)

| Área | Paquete | Justificación |
|---|---|---|
| Estado | `provider` | Ya en uso en v1; riesgo mínimo. **Decisión: NO migrar a riverpod.** |
| Navegación | `go_router` | Rutas declarativas, guards de auth, deep links. |
| HTTP | `dio` + `dio_cookie_manager` + `cookie_jar` | Interceptores (errores, CSRF), cookies persistentes `dayzo.sid`. |
| WebSocket | `web_socket_channel` | Ya en uso; cliente propio con backoff en `core/network/ws_client.dart`. |
| Conectividad | `connectivity_plus` | Estado online/offline global. |
| Caché local | `sqflite` | **Decisión: sqflite en lugar de drift.** Ver nota abajo. |
| Secure storage | `flutter_secure_storage` | Token CSRF y credenciales de sesión. |
| Prefs | `shared_preferences` | Preferencias simples (rango de gráfico, modo calc). |
| Gráficos | `fl_chart` | Reemplazo nativo de Chart.js. |
| Push | `firebase_core` + `firebase_messaging` + `flutter_local_notifications` | FCM + notifs foreground. |
| Widget home | `home_widget` | Puente Flutter ↔ AppWidgetProvider Kotlin. |
| Compartir | `screenshot` + `share_plus` + `path_provider` | Compartir tasas como imagen. |
| Formato | `intl` 0.20.x | es-VE. |
| Fuentes | `google_fonts` | Playfair Display / DM Mono / DM Sans. |

### Dev

`flutter_test`, `integration_test`, `mocktail`, `flutter_lints`, `flutter_native_splash`.

## Desviaciones documentadas respecto al plan

1. **`sqflite` en lugar de `drift`** (plan sugería drift). Motivo: drift exige
   codegen con `build_runner`, muy costoso en el entorno de build disponible
   (1 GB RAM) y añade complejidad sin beneficio para un esquema de caché de 5
   tablas. sqflite da SQLite directo, sin codegen, con DAOs manuales tipados en
   `core/storage/`. El esquema espejo se mantiene igual al planificado.
2. **Sin `workmanager`**: la actualización periódica del widget de home se hace
   con `updatePeriodMillis` del AppWidgetProvider + fetch nativo en Kotlin
   (más fiable que callbacks Dart en background) + actualización al abrir la app
   y al recibir push. Evita una dependencia extra con historial de breaking
   changes.
3. **JavaVersion 17** en Gradle (plan pedía confirmar JDK 17): plantilla
   moderna de Flutter 3.44 usa 17; se adoptó.
4. **AGP 9.0.1 / Gradle 9.1 / Kotlin 2.3.20**: el proyecto v1 traía AGP 8.1 y
   Gradle 8.3, incompatibles con Flutter 3.44; se migró a la plantilla actual
   (`settings.gradle.kts` + `build.gradle.kts`).
5. **`http` se elimina** al finalizar la migración a dio (Fase 1).
