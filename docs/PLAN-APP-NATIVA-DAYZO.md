# 📱 DAYZO — Plan Quirúrgico de App Nativa Android (Flutter)

> **Proyecto:** DAYZO / Calc Pro — Monitor de tasas de cambio Venezuela
> **Objetivo:** Llevar la app Flutter v1 a **paridad total con la web** + **funciones nativas nuevas** (push, widget, offline) y **publicarla en Google Play Store**.
> **Enfoque:** App **100% nativa** con Flutter (compila a ARM real, NO es un WebView de la web).
> **Plataforma:** Solo Android (arquitectura preparada para iOS futuro).
> **Backend:** Se reutiliza el mismo (`https://dayzove.lat`), con extensiones para push/alertas.
> **Última actualización del plan:** Julio 2026

---

## 🧭 Cómo usar este plan (LEER PRIMERO — instrucciones para la IA)

Este documento es la **fuente de verdad** del proyecto. La IA (Cursor u otra) debe seguir estas reglas SIEMPRE:

1. **Trabaja por fases en orden.** No saltes fases salvo que se indique que son paralelizables (marcadas con 🔀).
2. **Marca el progreso en las casillas** a medida que completes cada tarea:
   - `- [ ]` = pendiente
   - `- [x]` = completado y **verificado** (compila + funciona)
   - Si una tarea queda a medias, NO la marques; añade una nota `<!-- EN PROGRESO: ... -->` debajo.
3. **Regla de oro: cada tarea marcada `[x]` debe compilar** (`flutter analyze` sin errores y `flutter build apk --debug` OK). Nunca marques algo que rompe el build.
4. **No redffines la web ni el backend sin necesidad.** Los contratos de API existen; respétalos (ver Anexo A). Si necesitas un endpoint nuevo, documéntalo en la Fase 9 (Backend) antes de consumirlo.
5. **Cambios conservadores y verificables.** Un cambio atómico por commit. Mensaje de commit referenciando la tarea (ej: `feat(chart): F4.3 gráfico de tendencia con fl_chart`).
6. **Actualiza la sección "📊 Estado Global"** al final de cada fase.
7. **Secretos fuera del repo.** Nada de claves en el código; usar `--dart-define`, `.env` ignorado, o `flutter_secure_storage`. Ver Fase 0.5.
8. Al terminar una fase, ejecuta su **checklist de aceptación (DoD)** antes de pasar a la siguiente.

### Leyenda de prioridad
- 🔴 Crítico (bloquea otras fases)
- 🟡 Importante (paridad de features)
- 🟢 Mejora / pulido
- 🔀 Paralelizable
- ⚙️ Requiere cambio en backend

---

## 📊 Estado Global del Proyecto

> La IA debe actualizar esta tabla al cerrar cada fase.

| Fase | Nombre | Estado | Progreso |
|---|---|---|---|
| 0 | Fundaciones y entorno | ⬜ Pendiente | 0% |
| 1 | Arquitectura y capa de datos | ⬜ Pendiente | 0% |
| 2 | Estado global y navegación | ⬜ Pendiente | 0% |
| 3 | Paridad: Tasas en vivo (refinar v1) | ⬜ Pendiente | 0% |
| 4 | Paridad: Gráfico de tendencia | ⬜ Pendiente | 0% |
| 5 | Paridad: Historial + scroll infinito | ⬜ Pendiente | 0% |
| 6 | Paridad: Calculadora histórica | ⬜ Pendiente | 0% |
| 7 | Paridad: Autenticación | ⬜ Pendiente | 0% |
| 8 | Paridad: Módulo de importación + cotizaciones | ⬜ Pendiente | 0% |
| 9 | Backend: soporte push/alertas/widget | ⬜ Pendiente | 0% |
| 10 | Nativo: Notificaciones push (FCM) | ⬜ Pendiente | 0% |
| 11 | Nativo: Widget de pantalla de inicio | ⬜ Pendiente | 0% |
| 12 | Nativo: Offline mejorado | ⬜ Pendiente | 0% |
| 13 | Compartir imagen + Ticker + pulido UI | ⬜ Pendiente | 0% |
| 14 | Testing (unit / widget / integración) | ⬜ Pendiente | 0% |
| 15 | Build, firma y CI/CD | ⬜ Pendiente | 0% |
| 16 | Preparación y publicación Play Store | ⬜ Pendiente | 0% |
| 17 | Post-lanzamiento | ⬜ Pendiente | 0% |

**Símbolos de estado:** ⬜ Pendiente · 🟨 En progreso · ✅ Completo

---

## ✅ Inventario: qué YA existe vs. qué FALTA

### Ya existe en la app Flutter v1
- [x] Estructura base del proyecto (`mobile/`, paquete `dayzo_app`, appId `lat.dayzove.dayzo_app`)
- [x] Tema oscuro DAYZO (`theme/dayzo_theme.dart`, paleta de colores, fuentes)
- [x] Modelos base (`Tasas`, `BcvMeta`, `RateStats`, `TasasSnapshot`)
- [x] Repositorio HTTP + WebSocket con auto-reconexión (`tasas_repository.dart`)
- [x] Provider global (`TasasProvider`)
- [x] Pantalla principal (`home_screen.dart`) con TopBar, SpreadBanner, RateGrid (2×2), CalculatorPanel
- [x] Calculadora de divisas (VES/USDT/BCV/CNY) con lógica `CurrencyCalculator.compute()`
- [x] Tasas en vivo (REST + WS)
- [x] 2 tests unitarios de la calculadora

### Falta para paridad total (todo lo demás de la web)
- [ ] Gráfico de tendencia (24H/7D/MES/TODO) — la web usa Chart.js
- [ ] Historial con scroll infinito y filtros
- [ ] Calculadora con tasas históricas (fecha/hora)
- [ ] Autenticación (login/registro, sesión, CSRF, roles)
- [ ] Módulo de importación (empresas de envío, cálculo de costos, densidad/volumen)
- [ ] Simulador de venta (ROI, margen, punto de equilibrio, sparkline)
- [ ] Cotizaciones guardadas (CRUD, filtros, orden)
- [ ] Compartir tasas como imagen
- [ ] Ticker animado (marquesina de tasas)

### Funciones nativas nuevas (no existen en web ni en móvil)
- [ ] 🔔 Notificaciones push de alertas de tasa (FCM) ⚙️
- [ ] 🧩 Widget de pantalla de inicio (home screen widget)
- [ ] 📴 Offline mejorado / caché local persistente

---

# FASE 0 — Fundaciones y entorno 🔴

**Meta:** Tener el proyecto Flutter actualizado, sano y listo para crecer, con toolchain, dependencias, estructura de carpetas y manejo de secretos definidos.

## 0.1 Verificación del entorno
- [ ] Instalar/actualizar Flutter SDK estable y confirmar `flutter --version` (canal stable)
- [ ] `flutter doctor -v` sin errores bloqueantes (Android toolchain, SDK, licencias aceptadas)
- [ ] Confirmar Android SDK: `compileSdk` y `targetSdk` = 34 (o el requerido actual por Play), `minSdk` = 24 (Android 7.0)
- [ ] Confirmar JDK 17 configurado para Gradle
- [ ] `cd mobile && flutter pub get` sin errores
- [ ] `flutter analyze` en estado limpio (registrar warnings existentes)
- [ ] `flutter build apk --debug` compila OK (línea base verde)

## 0.2 Migración/actualización del proyecto v1
- [ ] Subir Dart SDK constraint a un rango moderno (`>=3.4.0 <4.0.0`) y probar
- [ ] Actualizar dependencias existentes a versiones compatibles (`flutter pub outdated`)
- [ ] Migrar a **Material 3** confirmado (`useMaterial3: true`)
- [ ] Revisar breaking changes de `provider`, `http`, `web_socket_channel`, `intl`, `google_fonts`

## 0.3 Definir estructura de carpetas objetivo (feature-first)
> Reorganizar de forma incremental; no romper imports de golpe.
- [ ] Crear estructura destino:
```
mobile/lib/
├── app/                 # App root, router, theme wiring
├── core/
│   ├── config/          # api_config, env, constants
│   ├── network/         # http client, interceptores, ws client
│   ├── storage/         # cache local (drift/hive), secure storage
│   ├── error/           # manejo de errores/resultados
│   └── utils/           # formatters, extensiones
├── data/
│   ├── models/          # DTOs / entidades
│   ├── repositories/    # repos concretos
│   └── datasources/     # remote (api/ws) + local (cache)
├── features/
│   ├── rates/           # tasas en vivo + tarjetas + ticker
│   ├── calculator/      # calculadora divisas + histórica
│   ├── chart/           # gráfico de tendencia
│   ├── history/         # historial + scroll infinito
│   ├── auth/            # login/registro/sesión
│   ├── import_calc/     # importación + simulador venta
│   ├── quotes/          # cotizaciones guardadas (CRUD)
│   ├── alerts/          # config de alertas push
│   └── settings/        # ajustes, tema, offline
├── native/
│   ├── push/            # FCM + notificaciones locales
│   └── widget/          # home screen widget bridge
└── shared/              # widgets reutilizables, tema, i18n
```
- [ ] Mover código v1 existente a su feature correspondiente (rates, calculator) sin cambiar comportamiento
- [ ] `flutter analyze` verde tras el movimiento

## 0.4 Elección y fijación del stack de paquetes
> Decidir aquí para no cambiar de librería a mitad del proyecto.
- [ ] **Estado:** mantener `provider` (ya en uso) — o migrar a `riverpod` si se decide (documentar decisión)
- [ ] **HTTP:** migrar de `http` a `dio` (interceptores, cookies, reintentos, cancelación) — recomendado por auth/CSRF
- [ ] **Cookies de sesión:** `dio_cookie_manager` + `cookie_jar` (para `dayzo.sid`)
- [ ] **Gráficos:** `fl_chart` (reemplazo nativo de Chart.js)
- [ ] **Caché local:** `drift` (SQLite tipado) o `hive` — elegir `drift` para reflejar el modelo relacional del backend
- [ ] **Secure storage:** `flutter_secure_storage` (tokens/credenciales)
- [ ] **Prefs simples:** `shared_preferences`
- [ ] **Push:** `firebase_core` + `firebase_messaging` + `flutter_local_notifications`
- [ ] **Widget home:** `home_widget`
- [ ] **Compartir imagen:** `screenshot` + `share_plus` + `path_provider`
- [ ] **Conectividad:** `connectivity_plus`
- [ ] **Formato:** `intl` (ya presente) para es-VE
- [ ] Registrar el stack final en `docs/STACK.md`

## 0.5 Manejo de secretos y configuración
- [ ] Crear `core/config/env.dart` con lectura de `String.fromEnvironment` (`API_BASE_URL`, etc.)
- [ ] NUNCA hardcodear claves; documentar `--dart-define` en `docs/BUILD.md`
- [ ] Añadir a `.gitignore`: `*.jks`, `key.properties`, `google-services.json` (si se decide no versionar), `.env`
- [ ] Crear `key.properties.example` y `.env.example` como plantillas

### ✅ DoD Fase 0
- [ ] Proyecto reestructurado, compila en debug, `flutter analyze` limpio
- [ ] Stack de paquetes fijado y documentado
- [ ] Manejo de secretos definido y verificado

---

# FASE 1 — Arquitectura y capa de datos 🔴

**Meta:** Una capa de datos robusta que unifique REST + WebSocket + caché local con un patrón claro (Repository) y manejo de errores.

## 1.1 Cliente de red
- [ ] Configurar `Dio` en `core/network/api_client.dart` con `baseUrl`, timeouts, logging (solo debug)
- [ ] Interceptor de errores → mapear a un tipo `AppFailure` (network, server, auth, parse)
- [ ] Interceptor de cookies para persistir la sesión `dayzo.sid` entre reinicios
- [ ] Interceptor CSRF: adjuntar header `X-CSRF-Token` en mutaciones cuando haya sesión
- [ ] Cliente WebSocket reutilizable en `core/network/ws_client.dart` (reconexión 5s, backoff, estado de conexión expuesto como stream)

## 1.2 Modelos (DTOs) — completar y endurecer
> Alinear 1:1 con el contrato de API (Anexo A). Serialización defensiva (nulls, tipos).
- [ ] Revisar/ampliar `Tasas` (binance, binance_compra, bcv, bcv_publicada, cny)
- [ ] `BcvMeta` completo (vigente_para, dia_efectivo, fecha_valor, publicada_el, hay_nueva_publicada, proxima_tasa, nota, fuente)
- [ ] `RateStats` (change24h, changePct24h, min, max, avg, current)
- [ ] `TasasSnapshot` (tasas, bcvMeta, diffBs, diffPct, lastUpdate, binanceStats, bcvStats)
- [ ] `HistorialPunto` (timestamp, fecha, binance, binance_compra, bcv, diff_bs, diff_pct)
- [ ] `ChartStats` (count, min, max, avg, range)
- [ ] `TasaHistorica` (respuesta de `/api/tasas-historicas`)
- [ ] `User` / `AuthSession` (role, username, fullName, csrfToken)
- [ ] `ImportQuote` (todos los campos numéricos/string/bool + `dimensionesCm{l,w,h}`) — ver Anexo A.6
- [ ] `EmpresaEnvio` (nombre, tarifaUSD, tipoCobro, reglas)
- [ ] Tests de serialización `fromJson`/`toJson` para cada modelo (round-trip)

## 1.3 Caché local (offline base)
- [ ] Definir esquema `drift` con tablas espejo: `tasas_cache`, `historial_cache`, `bcv_meta_cache`, `quotes_cache`, `alerts_config`
- [ ] DAO para leer/escribir el último snapshot de tasas
- [ ] DAO para historial (upsert por timestamp, consultas por rango)
- [ ] Política de retención (ej: historial 24h detallado, agregados para rangos largos)

## 1.4 Repositorios
- [ ] `RatesRepository`: `getSnapshot()` (REST), `streamUpdates()` (WS), fallback a caché si offline
- [ ] `HistoryRepository`: `getHistory(range, limit, fecha?)` con paginación
- [ ] `HistoricalRateRepository`: `getRateAt(fecha, hora?)`
- [ ] `AuthRepository`: login, register, me, logout, gestión de CSRF/cookie
- [ ] `QuotesRepository`: CRUD import-quotes con cola offline (sincroniza al reconectar)
- [ ] `AlertsRepository`: registrar device token, CRUD reglas de alerta ⚙️
- [ ] Patrón `Result<T, AppFailure>` en todos los métodos (nada de excepciones sin capturar en UI)

### ✅ DoD Fase 1
- [ ] Todos los repos con tests unitarios (mock de Dio/WS)
- [ ] Caché local funcionando (guardar y leer último snapshot)
- [ ] `flutter analyze` limpio, cobertura de modelos con round-trip tests

---

# FASE 2 — Estado global y navegación 🔴

**Meta:** Navegación escalable y estado por feature, reemplazando el single-screen de v1.

## 2.1 Navegación
- [ ] Adoptar `go_router` (o Navigator 2.0) con rutas: `/` (tasas), `/calculadora`, `/historial`, `/importacion`, `/cotizaciones`, `/alertas`, `/login`, `/ajustes`
- [ ] Barra de navegación inferior (NavigationBar M3) con secciones principales
- [ ] Guards de ruta: rutas que requieren sesión redirigen a `/login`
- [ ] Deep links para abrir desde notificación push (ej: `dayzo://alertas` o https app links)

## 2.2 Estado por feature
- [ ] Refactor `TasasProvider` → `RatesProvider` (solo tasas en vivo)
- [ ] `ConnectivityProvider` (online/offline, estado del WS)
- [ ] `AuthProvider` (sesión, rol, csrf)
- [ ] `ThemeProvider` (por si se agrega claro/oscuro)
- [ ] Inyección de dependencias (`MultiProvider` en `app/app.dart` o `get_it`)

### ✅ DoD Fase 2
- [ ] Navegación entre todas las secciones funciona (aunque las pantallas estén vacías)
- [ ] Guards de auth operativos
- [ ] App arranca y muestra tasas en la sección inicial (sin regresión de v1)

---

# FASE 3 — Paridad: Tasas en vivo (refinar v1) 🟡

**Meta:** Pulir lo existente para robustez, estados de carga/error y offline.

- [ ] TopBar: logo DAYZO + hora última actualización + botón refresh + indicador de conexión (verde/rojo WS)
- [ ] SpreadBanner: brecha Binance vs BCV con gradiente naranja + variación 24h
- [ ] RateGrid 2×2: Binance Comprar (verde), Binance Vender (rojo), BCV vigente (azul + subtítulo fecha valor), CNY/USD (ámbar)
- [ ] Mostrar `bcv_meta.nota` ("Nueva tasa X · rige desde mañana") cuando `hay_nueva_publicada`
- [ ] Estados: loading (skeletons), error (retry), offline (banner "datos en caché")
- [ ] Pull-to-refresh
- [ ] Animación suave al actualizar valores (evitar parpadeo)
- [ ] Reconexión WS visible y transparente para el usuario
- [ ] Formateo es-VE de todos los números (separador de miles, decimales)

### ✅ DoD Fase 3
- [ ] Tasas en vivo estables 10+ min sin fugas de memoria
- [ ] Comportamiento correcto al perder/recuperar red
- [ ] Widget test de RateGrid y SpreadBanner

---

# FASE 4 — Paridad: Gráfico de tendencia 🟡🔀

**Meta:** Reproducir el gráfico Chart.js de la web con `fl_chart`.

- [ ] Selector de rango: 24H / 7D / MES / TODO (chips)
- [ ] 3 series: Comprar (verde), Vender (rojo), BCV (azul)
- [ ] Leyendas toggleables (mostrar/ocultar cada serie)
- [ ] Tooltips al tocar (fecha + valores)
- [ ] Stats bajo el gráfico: Máx / Prom / Mín (desde `chartStats` o calculado)
- [ ] Manejo de densidad de puntos por rango (24h: crudo; 7d: por hora; mes: cada 4h; todo: por día) — según Anexo A.1
- [ ] Scroll horizontal / zoom para rangos largos
- [ ] Estados loading/error/vacío
- [ ] Caché del último dataset por rango para modo offline

### ✅ DoD Fase 4
- [ ] Gráfico fluido en los 4 rangos con datos reales
- [ ] Sin jank al cambiar de rango; performance ok con miles de puntos

---

# FASE 5 — Paridad: Historial + scroll infinito 🟡🔀

**Meta:** Tabla/lista de historial con paginación y filtros.

- [ ] Lista virtualizada (`ListView.builder`) con paginación (IntersectionObserver → detectar fin de scroll con `ScrollController`)
- [ ] Cada fila: fecha, diff_bs, diff_pct, Binance compra, Binance venta, BCV
- [ ] Filtro por fecha (date picker) y hora
- [ ] Indicador de carga al paginar (spinner al final)
- [ ] Estado vacío y de error
- [ ] Caché local de páginas ya cargadas

### ✅ DoD Fase 5
- [ ] Scroll infinito estable con 1000+ registros
- [ ] Filtros aplican correctamente contra la API

---

# FASE 6 — Paridad: Calculadora (divisas + histórica) 🟡

**Meta:** Completar la calculadora con el modo histórico.

## 6.1 Calculadora de divisas (refinar existente)
- [ ] Verificar TODAS las fórmulas contra Anexo A.4 (12 conversiones)
- [ ] Constante `tasaSegura = 6.53` (CNY/USD) centralizada en config
- [ ] Modos VES / USDT / BCV / CNY con 3 resultados cada uno
- [ ] Botón copiar al portapapeles por resultado
- [ ] Input con formato/parse local (es-VE) y validación
- [ ] Tests unitarios de las 12 conversiones (ampliar los 2 existentes)

## 6.2 Calculadora con tasas históricas
- [ ] Panel "Calcular con tasa de otra fecha" (date picker + time picker)
- [ ] Fetch `/api/tasas-historicas?fecha=YYYY-MM-DD&hora=HH:MM`
- [ ] Banner indicando que se usan tasas históricas + botón "Volver a hoy"
- [ ] Mostrar desfase (`desfase_min`) y fecha del registro usado
- [ ] Manejo de error si no hay datos para esa fecha

### ✅ DoD Fase 6
- [ ] Todas las conversiones correctas (tests verdes)
- [ ] Modo histórico funcional con datos reales

---

# FASE 7 — Paridad: Autenticación 🟡🔴

**Meta:** Login/registro nativos con sesión persistente, CSRF y roles. Necesario para el módulo de importación.

## 7.1 Flujos
- [ ] Pantalla de Login (username/email + password)
- [ ] Pantalla de Registro (fullName 2-80, username 3-32, email, password ≥8 con letra+número) con validación cliente igual al backend
- [ ] Persistir sesión: cookie `dayzo.sid` en cookie jar + almacenar `csrfToken` en secure storage
- [ ] `GET /api/auth/me` al arrancar para restaurar sesión
- [ ] Logout (`POST /api/auth/logout`) + limpiar cookie/estado
- [ ] Manejo de rate limit (10/15min) y delay progresivo: mensajes claros al usuario
- [ ] Estados de error específicos (credenciales, red, servidor)

## 7.2 Roles y guards
- [ ] Guardar rol (`admin` | `viewer`) en `AuthProvider`
- [ ] Ocultar/mostrar funciones admin según rol (si aplica en móvil)
- [ ] Redirección post-login a la ruta previa

## 7.3 Seguridad móvil
- [ ] Nunca guardar password en claro
- [ ] Tokens/cookies en `flutter_secure_storage`
- [ ] Auto-logout al expirar sesión (401 → limpiar y redirigir)

### ✅ DoD Fase 7
- [ ] Login/registro/logout funcionan contra el backend real
- [ ] Sesión persiste tras cerrar y reabrir la app
- [ ] Mutaciones envían CSRF correctamente

---

# FASE 8 — Paridad: Módulo de importación + cotizaciones 🟡🔴

**Meta:** La feature más compleja. Reproducir cálculo de costos, simulador de venta y CRUD de cotizaciones. Requiere sesión (Fase 7).

## 8.1 Datos de empresas de envío
- [ ] Definir empresas y reglas (Anexo A.5): GCCARGO ($770 volumen), Orinoco ($865 volumen, mín $35/caja si <0.035 m³), import2ven ($1030 por densidad), Personalizado (configurable)
- [ ] Selector de empresa + panel de config para "Personalizado"

## 8.2 Motor de cálculo de costos (portar 1:1 desde la web)
- [ ] Volumen por caja: `l × w × h / 1_000_000` (cm → m³)
- [ ] Densidad: `pesoKg / volumenM3`
- [ ] Tipo de cobro: volumen / peso (tarifa/1000 por ton) / mixto según umbral
- [ ] Costo mercancía: `unidades × precioUnitarioCNY / tasaCNY`
- [ ] Comisiones: plataforma 3% + banco 1.25% sobre subtotal
- [ ] Inversión total: mercancía + envío China + comisiones + flete internacional
- [ ] Costo unitario y costo por caja
- [ ] Tests unitarios del motor con casos por cada empresa (comparar con resultados de la web)

## 8.3 Simulador de venta
- [ ] Modos de precio: fijo ($), en Bs., o por margen (%)
- [ ] Botones de margen rápido: +20%, +30%, +50%, +80%, ×2, ×3
- [ ] Cálculo de ganancia unitaria/total, ROI, margen sobre venta, punto de equilibrio
- [ ] Sparkline de ganancia proyectada (`fl_chart`)

## 8.4 Cotizaciones guardadas (CRUD)
- [ ] Listar (`GET /api/import-quotes`, máx 1000) con filtros (empresa, búsqueda por nombre) y orden (reciente, mayor inversión, empresa, nombre)
- [ ] Ver detalle (`GET /api/import-quotes/:id`)
- [ ] Crear (`POST`) — enviar quote completo (JSON) validado por `sanitizeImportQuote`
- [ ] Editar (`PUT /api/import-quotes/:id`)
- [ ] Eliminar (`DELETE /api/import-quotes/:id`) con confirmación
- [ ] Guardar link de producto y precio de venta
- [ ] Cola offline: crear/editar sin red → sincronizar al reconectar (usar `quotes_cache`)

### ✅ DoD Fase 8
- [ ] Cálculos idénticos a la web (validados con tests)
- [ ] CRUD completo funcionando contra backend real
- [ ] Sincronización offline verificada

---

# FASE 9 — Backend: soporte para push / alertas / widget ⚙️🔴

**Meta:** Extender el backend Node.js para habilitar las funciones nativas. Cambios ADITIVOS y no disruptivos (respetar patrón append-only y migraciones seguras).

> ⚠️ Antes de tocar el backend: hacer backup de la SQLite y trabajar en rama aparte. Cambios conservadores y reversibles.

## 9.1 Registro de dispositivos (device tokens)
- [ ] Nueva tabla `device_tokens` (id, user_id nullable, token FCM, platform, created_at, last_seen) — migración aditiva
- [ ] `POST /api/devices/register` (token FCM) + `DELETE /api/devices/:token`
- [ ] Proteger con rate limit y (opcional) auth

## 9.2 Reglas de alerta de tasa
- [ ] Nueva tabla `alert_rules` (id, user_id/token, tipo, condición, umbral, activo, created_at)
- [ ] Tipos de alerta: cruce de umbral (Binance/BCV), cambio % en X tiempo, nueva tasa BCV publicada, brecha supera X%
- [ ] CRUD `/api/alerts` (crear, listar, actualizar, eliminar)

## 9.3 Motor de evaluación + envío push
- [ ] En cada tick relevante (`updateBinance`/`updateOficiales`/`checkRolloverVigenciaBcv`), evaluar reglas activas
- [ ] Integrar FCM Admin SDK para enviar push (server key en env, NUNCA en repo)
- [ ] Anti-spam: no repetir la misma alerta en ventana corta (cooldown por regla)
- [ ] Log de alertas enviadas

## 9.4 Endpoint compacto para widget
- [ ] `GET /api/widget/snapshot` → payload mínimo optimizado (binance compra/venta, bcv, cny, diff, hora) para el widget de home
- [ ] Cache-Control corto; considerar sin auth (datos públicos de tasas)

## 9.5 Documentación
- [ ] Actualizar `docs/API.md` del backend con los nuevos endpoints
- [ ] Variables de entorno nuevas documentadas (`FCM_*`) en `docs/BUILD.md`

### ✅ DoD Fase 9
- [ ] Endpoints nuevos probados (curl/Postman) sin romper los existentes
- [ ] Migraciones aplican sin pérdida de datos
- [ ] Envío de push de prueba llega a un dispositivo real

---

# FASE 10 — Nativo: Notificaciones push (FCM) 🔔⚙️

**Meta:** Alertas de tasa en tiempo real vía FCM, con notificaciones locales y configuración en la app.

## 10.1 Setup Firebase
- [ ] Crear proyecto Firebase + app Android (`lat.dayzove.dayzo_app`)
- [ ] Descargar `google-services.json` (gestionar como secreto)
- [ ] Configurar Gradle (plugin google-services) y `firebase_core`
- [ ] Inicializar Firebase en `main()`

## 10.2 Integración FCM en la app
- [ ] `firebase_messaging`: pedir permiso de notificaciones (Android 13+ runtime permission `POST_NOTIFICATIONS`)
- [ ] Obtener token FCM y registrarlo vía `POST /api/devices/register`
- [ ] Manejar refresh de token (`onTokenRefresh`)
- [ ] Handlers: foreground, background, terminated
- [ ] `flutter_local_notifications` para mostrar notificaciones en foreground (canales, ícono, sonido)
- [ ] Deep link: tocar notificación → abrir sección relevante (ej: `/alertas` o tasas)

## 10.3 Pantalla de configuración de alertas
- [ ] UI para crear/editar reglas (umbral, %, tipo) → `/api/alerts`
- [ ] Toggle global de notificaciones
- [ ] Listar alertas activas + eliminar
- [ ] Guardar preferencia offline y sincronizar

### ✅ DoD Fase 10
- [ ] Push llega en foreground, background y app cerrada
- [ ] Regla creada dispara notificación real cuando se cumple
- [ ] Permiso Android 13+ manejado correctamente

---

# FASE 11 — Nativo: Widget de pantalla de inicio 🧩

**Meta:** Widget Android que muestra las tasas actuales en la home screen, actualizándose periódicamente.

- [ ] Integrar paquete `home_widget`
- [ ] Crear el AppWidgetProvider nativo (Kotlin) + layout XML del widget (tamaños pequeño/mediano)
- [ ] Diseño del widget: Binance compra/venta, BCV, hora de actualización (estilo DAYZO oscuro)
- [ ] Actualización periódica con `WorkManager` (ej: cada 15-30 min) consumiendo `/api/widget/snapshot`
- [ ] Actualizar widget también al recibir push relevante o al abrir la app
- [ ] Tap en el widget abre la app (deep link a tasas)
- [ ] Manejo de estado offline en el widget (mostrar último dato + hora)
- [ ] Probar en distintos launchers y tamaños

### ✅ DoD Fase 11
- [ ] Widget se añade a la home y muestra datos reales
- [ ] Se actualiza en segundo plano de forma fiable
- [ ] Tap abre la app correctamente

---

# FASE 12 — Nativo: Offline mejorado 📴

**Meta:** Experiencia sólida sin conexión, con datos en caché y sincronización.

- [ ] Al abrir sin red: mostrar último snapshot de tasas desde `drift` + banner "sin conexión"
- [ ] Gráfico e historial sirven desde caché cuando no hay red
- [ ] Cola de mutaciones offline para cotizaciones (crear/editar/eliminar) con reintento al reconectar
- [ ] Indicador global de conectividad (`connectivity_plus`) + reintento automático del WS
- [ ] Estrategia de expiración/frescura de caché (mostrar antigüedad del dato)
- [ ] Persistir preferencias del usuario (rango de gráfico, modo calculadora) offline

### ✅ DoD Fase 12
- [ ] App usable en modo avión mostrando últimos datos
- [ ] Cambios offline se sincronizan al recuperar red sin duplicados

---

# FASE 13 — Compartir imagen + Ticker + pulido UI 🟢🔀

**Meta:** Cerrar la paridad visual y detalles finales.

- [ ] **Compartir tasas como imagen:** capturar tarjetas con `screenshot` → compartir con `share_plus` (equivalente a `shareRatesImage()` de la web)
- [ ] **Ticker animado:** marquesina horizontal con tasas en vivo (equivalente CSS de la web) usando animación en Flutter
- [ ] Revisar tema DAYZO: colores exactos (Anexo A.7), fuentes (Playfair Display / DM Mono / DM Sans vía `google_fonts`)
- [ ] Íconos, splash screen y branding (`flutter_native_splash`)
- [ ] Soporte de distintos tamaños de pantalla / densidades
- [ ] Accesibilidad básica (contraste, tamaños de toque, semantics)
- [ ] Animaciones y microinteracciones pulidas
- [ ] Revisión de textos es-VE (sin typos)

### ✅ DoD Fase 13
- [ ] Compartir imagen funciona
- [ ] Ticker fluido
- [ ] UI consistente con el branding DAYZO

---

# FASE 14 — Testing 🔴

**Meta:** Confianza para publicar. Cobertura en las capas críticas.

- [ ] **Unit:** motor calculadora (12 conversiones), motor de importación (por empresa), serialización de modelos, lógica de vigencia BCV (si se replica en cliente)
- [ ] **Widget tests:** RateGrid, SpreadBanner, CalculatorPanel, gráfico, formularios auth/importación
- [ ] **Integration tests** (`integration_test`): flujo login → importación → guardar cotización; flujo tasas en vivo; offline
- [ ] Mock de red (Dio) y WS para tests deterministas
- [ ] `flutter analyze` sin issues; formato con `dart format`
- [ ] Objetivo de cobertura en lógica de negocio ≥ 80%
- [ ] Pruebas manuales en 2-3 dispositivos/emuladores reales (distintas versiones Android)

### ✅ DoD Fase 14
- [ ] Toda la suite pasa en verde
- [ ] Sin crashes en el flujo principal

---

# FASE 15 — Build, firma y CI/CD 🔴

**Meta:** Builds reproducibles y firmados listos para Play.

## 15.1 Firma de la app
- [ ] Generar keystore de release (`keytool`) — guardarlo FUERA del repo y respaldarlo de forma segura
- [ ] Crear `android/key.properties` (ignorado en git) con alias/passwords
- [ ] Configurar `signingConfigs` release en `build.gradle`
- [ ] Habilitar `minifyEnabled` + `shrinkResources` (R8) y probar que no rompe (reglas ProGuard si hace falta)

## 15.2 Build
- [ ] `flutter build appbundle --release` (AAB para Play) OK
- [ ] Verificar tamaño del bundle y dividir por ABI si conviene
- [ ] Configurar `--dart-define` de producción (`API_BASE_URL=https://dayzove.lat`)
- [ ] Versionado: definir esquema `versionName`/`versionCode` y automatizarlo

## 15.3 CI/CD (opcional pero recomendado)
- [ ] Pipeline (GitHub Actions/GitLab CI): `flutter analyze` + tests + build en cada PR
- [ ] Job de build de release firmado (secretos vía secrets del CI)
- [ ] (Opcional) Publicación automática a track interno de Play con Fastlane

### ✅ DoD Fase 15
- [ ] AAB de release firmado se genera de forma reproducible
- [ ] CI en verde (si se implementa)

---

# FASE 16 — Preparación y publicación en Play Store 🔴

**Meta:** App publicada.

## 16.1 Cuenta y ficha
- [ ] Cuenta de Google Play Console (pago único de registro)
- [ ] Crear la app en Console (nombre, idioma por defecto es-VE, categoría Finanzas)
- [ ] Ficha: título, descripción corta y larga, novedades
- [ ] Recursos gráficos: ícono 512×512, gráfico destacado 1024×500, 2-8 capturas de pantalla, (opcional) vídeo

## 16.2 Cumplimiento y políticas
- [ ] **Política de privacidad** (URL pública) — obligatoria; describir datos recabados (tasas no, pero sí cuenta/email y token FCM)
- [ ] Sección "Seguridad de los datos" (Data Safety) completada con veracidad (recolección de email, tokens push, etc.)
- [ ] Declaración de permisos (POST_NOTIFICATIONS, INTERNET, etc.)
- [ ] Clasificación de contenido (cuestionario)
- [ ] Público objetivo y contenido (no dirigido a niños)
- [ ] Cumplir requisitos de `targetSdk` vigente de Play
- [ ] Revisar políticas de apps financieras (disclaimer: tasas informativas, no asesoría financiera)

## 16.3 Lanzamiento gradual
- [ ] Subir AAB a **testing interno** primero; validar con testers reales
- [ ] Corregir hallazgos → **producción** (rollout gradual 10% → 100%)
- [ ] Monitorear reportes de fallos/ANR en Play Console

### ✅ DoD Fase 16
- [ ] App aprobada y publicada en Play Store
- [ ] Sin rechazos de política pendientes

---

# FASE 17 — Post-lanzamiento 🟢

- [ ] Integrar Crashlytics / reporte de errores
- [ ] (Opcional) Analytics de uso (respetando privacidad)
- [ ] Monitoreo de reseñas y feedback
- [ ] Plan de actualizaciones (bugs, mejoras)
- [ ] Revisar métricas de push (entrega, opt-out)
- [ ] Documentar proceso de release para futuras versiones
- [ ] (Futuro) Preparar build iOS reutilizando la misma base Flutter

---

# 📎 Anexo A — Contratos de API y constantes (fuente de verdad)

> La app debe respetar EXACTAMENTE estos contratos. No inventar campos.

## A.1 Rangos de historial
| Rango | Agrupación | Puntos máx. |
|---|---|---|
| 24h | Sin agrupar | 10,000 |
| 7d | Promedio por hora | ~168 |
| month | Promedio cada 4h | ~180 |
| all | Promedio por día | Ilimitado |

## A.2 Endpoints de tasas
- `GET /api/tasas-venezuela?range=24h&stats=1&limit=5000&fecha=` → tasas + bcv_meta + diff + historial + chartStats
- `GET /api/stats` → stats agregadas 24h (binance, bcv, spread)
- `GET /api/tasas-historicas?fecha=YYYY-MM-DD&hora=HH:MM` → tasa histórica puntual

## A.3 WebSocket
- URL: `wss://dayzove.lat/tasas-ws`
- Mensaje server→client: `{ type: 'tasas_update', data: { tasas, bcv_meta, diff_bs, diff_pct, fecha, last_update } }`
- Mensaje shutdown: `{ type: 'server_shutdown' }`
- Reconexión cliente: cada 5s

## A.4 Fórmulas de la calculadora (tasaSegura CNY/USD = 6.53)
```
VES → USDT: v / tasaBinanceCompra
VES → BCV : v / tasaBCV
VES → CNY : (v / tasaBinanceCompra) * 6.53
USDT → VES: v * tasaBinanceCompra
USDT → BCV: (v * tasaBinanceCompra) / tasaBCV
USDT → CNY: v * 6.53
BCV → VES : v * tasaBCV
BCV → USDT: (v * tasaBCV) / tasaBinanceCompra
BCV → CNY : ((v * tasaBCV) / tasaBinanceCompra) * 6.53
CNY → USDT: v / 6.53
CNY → VES : (v / 6.53) * tasaBinanceCompra
CNY → BCV : ((v / 6.53) * tasaBinanceCompra) / tasaBCV
```

## A.5 Empresas de envío (importación)
| Empresa | Tarifa USD | Tipo de cobro |
|---|---|---|
| GCCARGO | 770 | Por volumen puro. Sin mínimo. |
| Orinoco | 865 | Por volumen. Mín $35/caja si volumen < 0.035 m³. |
| import2ven | 1030 | Por densidad: peso si den>1000; volumen+$50 si 380-1000; volumen puro si den<380. |
| Personalizado | Variable | Configurable por el usuario. |

Cálculo: volumen/caja = `l×w×h/1_000_000`; densidad = `pesoKg/volumenM3`; comisiones plataforma 3% + banco 1.25%; inversión total = mercancía + envío China + comisiones + flete internacional; costo unitario = inversión/unidades.

## A.6 Esquema ImportQuote (validado por sanitizeImportQuote)
- **Numéricos:** version, empresaTarifaUSD, empresaEnvioUSD, cajas, unidadesPorCaja, unidadesTotales, pesoPorCajaKg, precioMercanciaPorUnidadUSD, envioChinaPorCajaUSD, volumenM3, volumenPorCajaM3, pesoKg, costoMercanciaUSD, envioChinaUSD, plataformaUSD, comisionBancoUSD, subtotalUSD, envioInternacionalUSD, fletePorCajaUSD, inversionTotalUSD, costoUnitarioUSD, costoPorCajaUSD, feePlataforma, feeBanco, ventaUnitarioUSD, ventaPorCajaUSD, gananciaUnitariaUSD, gananciaTotalUSD, roiVentaPct, margenVentaPct
- **String:** entradaRaw, empresaNombre, tipoCobro
- **Boolean:** tarifaMinAplicada
- **Objeto:** dimensionesCm { l, w, h }

## A.7 Paleta de colores DAYZO
```
bgPage    #0B0E11   bgCard   #1E2329   bgElevated #2B3139   bgInput #181C20
textInk   #EAECEF   textSoft #848E9C   accent(naranja) #E8541A
green(compra) #0ECB81   red(venta) #F6465D   blue(BCV) #3B82F6   amber(CNY) #F0B90B
```
Fuentes: Playfair Display (logo), DM Mono (números), DM Sans (texto).

## A.8 Endpoints de auth y cotizaciones
- Auth: `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`, `POST /api/auth/logout`
- Header CSRF en mutaciones: `X-CSRF-Token`; cookie de sesión: `dayzo.sid`
- Cotizaciones (requieren auth): `GET/POST /api/import-quotes`, `GET/PUT/DELETE /api/import-quotes/:id`

---

# 📎 Anexo B — Dependencias sugeridas (pubspec)

```yaml
dependencies:
  flutter: { sdk: flutter }
  # Estado
  provider: ^6.1.2          # (o flutter_riverpod si se migra)
  # Red
  dio: ^5.x
  dio_cookie_manager: ^3.x
  cookie_jar: ^4.x
  web_socket_channel: ^3.0.1
  connectivity_plus: ^6.x
  # Almacenamiento
  drift: ^2.x
  sqlite3_flutter_libs: ^0.5.x
  path_provider: ^2.x
  path: ^1.x
  flutter_secure_storage: ^9.x
  shared_preferences: ^2.x
  # UI / gráficos
  fl_chart: ^0.6x
  google_fonts: ^6.2.1
  intl: ^0.19.0
  # Nativo
  firebase_core: ^3.x
  firebase_messaging: ^15.x
  flutter_local_notifications: ^17.x
  home_widget: ^0.6.x
  workmanager: ^0.5.x
  # Utilidades
  screenshot: ^3.x
  share_plus: ^10.x
  flutter_native_splash: ^2.x

dev_dependencies:
  flutter_test: { sdk: flutter }
  integration_test: { sdk: flutter }
  drift_dev: ^2.x
  build_runner: ^2.x
  mocktail: ^1.x
```
> Fijar versiones exactas al implementar (evitar rangos abiertos en release).

---

# 📎 Anexo C — Riesgos y decisiones abiertas

- [ ] **Vigencia BCV en cliente:** decidir si se replica la lógica legal (fecha valor/medianoche/feriados) en el cliente para el widget offline, o siempre se confía en el backend. **Recomendado:** confiar en backend; el widget muestra lo que envía el server.
- [ ] **Riverpod vs Provider:** mantener provider reduce riesgo; migrar da mejor escalabilidad. Decidir en Fase 0.4.
- [ ] **Drift vs Hive:** drift refleja mejor el modelo relacional; hive es más simple. Recomendado drift.
- [ ] **google-services.json y keystore:** definir si se versionan cifrados o se inyectan por CI. Recomendado: fuera del repo + backup seguro.
- [ ] **Disclaimer financiero** obligatorio para pasar revisión de Play (tasas informativas).
- [ ] **Costo de scraping/push:** evaluar carga del backend al añadir evaluación de alertas en cada tick.

---

> **Fin del plan.** La IA debe mantener este archivo actualizado marcando casillas y actualizando la tabla de Estado Global tras cada fase. Cualquier desviación del contrato de API (Anexo A) debe documentarse aquí antes de implementarse.
