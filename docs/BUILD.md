# DAYZO App Nativa — Guía de build

## Requisitos

- Flutter 3.44.x (stable), JDK 17, Android SDK 36 (ver `docs/STACK.md`).
- Variables de entorno del build host: `ANDROID_HOME`, `JAVA_HOME`.

## Configuración vía `--dart-define`

| Variable | Default | Descripción |
|---|---|---|
| `API_BASE_URL` | `https://dayzove.lat` | Backend REST + WS |
| `VERBOSE_NETWORK_LOGS` | `false` | Logs de red (solo debug) |

```bash
# Debug
flutter build apk --debug

# Release (producción)
flutter build appbundle --release --dart-define=API_BASE_URL=https://dayzove.lat
```

## Firma de release

1. Generar keystore (una sola vez, guardarlo FUERA del repo con backup seguro):

```bash
keytool -genkey -v -keystore ~/secure/dayzo-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias dayzo
```

2. Copiar `android/key.properties.example` → `android/key.properties`
   (ignorado por git) y rellenar rutas/contraseñas.
3. `flutter build appbundle --release` usa automáticamente esa firma.
   Si `key.properties` no existe, el build release usa la firma debug
   (solo para desarrollo, NUNCA subir a Play).

## Secretos

- `android/key.properties`, `*.jks`, `google-services.json` y `.env` están en
  `.gitignore`. Nunca commitearlos.
- `google-services.json` se obtiene de la consola Firebase para el appId
  `lat.dayzove.dayzo_app` y se coloca en `android/app/` en el host de build
  (o se inyecta por CI desde un secret base64).

## Backend (variables nuevas Fase 9)

| Variable | Descripción |
|---|---|
| `FCM_SERVICE_ACCOUNT` | Ruta al JSON de service account de Firebase (para push server-side). Alternativa: `FCM_SERVICE_ACCOUNT_JSON` con el contenido inline. |

El backend funciona sin estas variables (el motor de push queda deshabilitado y
lo registra en logs; el resto de la API no se ve afectada).
