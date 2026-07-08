# DAYZO / Calc Pro — Documentación Completa del Sistema

> Fecha: Julio 2026  
> Repositorio: `/var/www/calculadora`  
> Dominio: `https://dayzove.lat`  
> Marca: **DAYZO** (también llamado "Calc Pro")

---

## Índice

1. [Vista General del Sistema](#1-vista-general-del-sistema)
2. [Backend (Servidor Node.js)](#2-backend-servidor-nodejs)
3. [Frontend Web (SPA Vanilla JS)](#3-frontend-web-spa-vanilla-js)
4. [App Móvil (Flutter / Android Nativo)](#4-app-móvil-flutter--android-nativo)
5. [API REST — Endpoints](#5-api-rest--endpoints)
6. [WebSocket — Tiempo Real](#6-websocket--tiempo-real)
7. [Autenticación y Seguridad](#7-autenticación-y-seguridad)
8. [Base de Datos SQLite](#8-base-de-datos-sqlite)
9. [Scraping y Fuentes de Datos](#9-scraping-y-fuentes-de-datos)
10. [Módulo de Importación](#10-módulo-de-importación)
11. [App Móvil — Estructura Detallada](#11-app-móvil--estructura-detallada)
12. [PWA — Progressive Web App](#12-pwa--progressive-web-app)
13. [Despliegue y PM2](#13-despliegue-y-pm2)

---

## 1. Vista General del Sistema

DAYZO es una aplicación de **doble plataforma** (web + Android nativo) para el monitoreo en tiempo real de tasas de cambio en Venezuela. Consiste en:

- **Backend**: Servidor Node.js con Express 5 que scrapea tasas del BCV y Binance P2P, las persiste en SQLite y las sirve vía REST + WebSocket.
- **Frontend Web**: SPA (Single Page Application) construida con HTML/CSS/JS vanilla + Tailwind CSS + Chart.js. Es una PWA instalable.
- **App Android Nativa**: Cliente Flutter/Dart que consume exactamente la misma API REST y WebSocket del backend.

### 1.1 Propósito de Negocio

La aplicación resuelve tres necesidades principales:

1. **Tasas de cambio en tiempo real**: Binance P2P (compra/venta) y tasa oficial BCV, con cálculo de brecha.
2. **Calculadora multi-moneda**: Convierte entre VES (bolívares), USDT, dólar BCV y yuanes (CNY).
3. **Calculadora de costos de importación**: Simula el costo total de importar productos desde China a Venezuela, seleccionando entre empresas de envío predefinidas.

### 1.2 Stack Tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Runtime servidor | Node.js | — |
| Framework HTTP | Express | ^5.2.1 |
| Base de datos | SQLite (better-sqlite3) | ^12.10.0 |
| WebSocket | ws | ^8.20.0 |
| HTTP Client | axios | ^1.14.0 |
| Auth | bcrypt + express-session | ^6.0.0 / ^1.19.0 |
| Seguridad | helmet + express-rate-limit | ^8.2.0 / ^8.5.2 |
| Compresión | compression | ^1.8.1 |
| CSS | Tailwind CSS (solo utilidades) | ^3.4.17 |
| Charts | Chart.js (CDN) | — |
| Mobile | Flutter / Dart | SDK >=3.2.0 |
| Mobile HTTP | package http | ^1.2.2 |
| Mobile WS | web_socket_channel | ^3.0.1 |
| Mobile Estado | provider | ^6.1.2 |
| PM2 | Process Manager | — |

---

## 2. Backend (Servidor Node.js)

### 2.1 Archivo Principal: `src/server.js` (~1512 líneas)

El servidor es un archivo único que contiene toda la lógica: creación de Express, rutas, WebSocket, scraping, base de datos y caché.

#### 2.1.1 Arranque

```js
// Archivo: src/server.js (líneas 1446-1471)
const intervalBinance   = setInterval(updateBinance,   10 * 1000);      // Cada 10 segundos
const intervalOficiales = setInterval(updateOficiales, 15 * 60 * 1000); // Cada 15 minutos

updateOficiales(); // Ejecución inmediata al arrancar
updateBinance();   // Ejecución inmediata al arrancar
```

#### 2.1.2 Middleware (en orden de aplicación)

1. **helmet** — Configura CSP estricta (solo self, CDNs de Chart.js, Font Awesome, Google Fonts).
2. **compression** — Gzip/deflate con threshold de 512 bytes. Reduce payload de JSON histórico ~70-80%.
3. **express.json / urlencoded** — Límite de 512KB por body.
4. **express-session** — Sesiones persistentes en SQLite. Cookie `dayzo.sid`, httpOnly, secure en producción, sameSite strict, maxAge 7 días.
5. **rate-limiters** — 3 limitadores separados: auth (10 req/15min), tasas (60 req/min), mutaciones (40 req/min).
6. **csrfProtect** — Middleware custom que verifica token CSRF en toda mutación (excepto login/register).
7. **express.static** — Sirve `public/` con caché agresiva (7 días en prod, excepto HTML/JS que usan no-cache).

#### 2.1.3 Cache en Memoria

```js
// src/server.js (líneas 761-774)
let CACHE_TASAS = {
  binance: 0, binance_compra: 0, bcv: 0, bcv_publicada: 0, cny: 0,
  bcv_meta: null,
  lastUpdateBinance: null, lastUpdateBCV: null, lastUpdateTasas: null,
};
```

El cache se hidrata al arrancar con el último registro de SQLite y se actualiza cada vez que se reciben nuevos datos de Binance o BCV.

### 2.2 Scraping de Fuentes

#### 2.2.1 Binance P2P (`getBinanceRate`)

```js
// src/server.js (líneas 926-943)
// POST a https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search
// Parámetros: fiat='VES', asset='USDT', rows=5
// tradeType alterna entre 'BUY' y 'SELL'
// Calcula el promedio simple de los precios de los 5 anuncios principales
// Incluye retry con backoff exponencial (3 intentos, delay base 2s)
```

- Se ejecuta **cada 10 segundos**.
- Calcula el promedio de precios de los 5 mejores anuncios.
- Usa `withRetry` con 3 intentos y backoff exponencial (2s, 4s, 8s).

#### 2.2.2 BCV Oficial (`getBCVData`)

```js
// src/server.js (líneas 872-923)
// GET a https://www.bcv.org.ve/ con User-Agent de Chrome 124
// Extrae con regex:
//   - USD: <strong> dentro del bloque id="dolar"
//   - CNY: <strong> dentro del bloque id="yuan"  
//   - Fecha Valor: <span content="YYYY-MM-DD"> (según schema.org)
// SSL: rejectUnauthorized: false (problemas conocidos del certificado BCV)
```

- Se ejecuta **cada 15 minutos** (la publicación del BCV ocurre ~4-5 PM VET).
- Extrae 3 valores: tasa USD, tasa CNY, y la **fecha valor** real.

### 2.3 Algoritmo de Vigencia BCV

El archivo `src/bcv-vigencia.js` implementa la lógica legal de la tasa oficial según el BCV y el Artículo 25 de la Ley del IVA.

#### Reglas de Vigencia

1. **Publicación vespertina**: El BCV publica cada día hábil en la tarde (después de las 3 PM VET).
2. **Fecha Valor**: La tasa publicada tiene una "Fecha Valor" que es el **siguiente día hábil**.
3. **Medianoche**: La nueva tasa entra en vigencia a las 00:00 del día de la Fecha Valor. Esto significa que el día de la publicación se sigue usando la tasa vigente anterior hasta la medianoche.
4. **Fines de semana y feriados**: Rige la tasa del día hábil inmediato siguiente (la última publicada). Ej: la publicada el viernes con fecha valor lunes rige sábado, domingo y todo el lunes.

#### Resolución de Tasa Vigente

```js
// src/bcv-vigencia.js (función resolveBcvVigente)
// 1. Calcula el día efectivo (diaEfectivo): si hoy es no hábil, avanza al siguiente hábil
// 2. Busca en tabla bcv_publicaciones la publicación con fecha_valor <= día efectivo
// 3. Si no encuentra, usa heurística sobre el historial de capturas
// 4. Último fallback: el valor publicado actualmente en bcv.org.ve
```

#### Rollover de Medianoche

```js
// src/server.js (checkRolloverVigenciaBcv, línea 632)
// Se ejecuta en cada tick de Binance (cada 10s)
// Si el día en Caracas cambió y hay una nueva tasa vigente, la activa
// y hace broadcast por WebSocket
```

### 2.4 Persistencia de Historial

```js
// src/server.js (guardarHistorialSiCambio, línea 646)
// Guarda un registro SOLO si:
//   - El valor de binance o bcv cambió en más de 0.01, O
//   - Pasó más de 1 hora desde el último registro
// Esto evita llenar la DB con valores idénticos
```

### 2.5 Consultas de Historial

El servidor soporta 4 rangos de historial:

| Rango | Agrupación | Puntos máx. | Query |
|---|---|---|---|
| 24h | Sin agrupar (todos los puntos) | 10,000 | `stmtHist24h` |
| 7d | Promedio por hora | ~168 | `stmtHistHourlySince` |
| Month | Promedio cada 4h | ~180 | `stmtHistEvery4hSince` |
| All | Promedio por día | Ilimitado | `stmtHistGroupedAll` |

### 2.6 WebSocket

```js
// src/server.js (líneas 1416-1443)
// Servidor WebSocket independiente en el mismo puerto HTTP
// Ruta: /tasas-ws
// Manejo de upgrade: noServer: true + event handler en server 'upgrade'

function broadcastTasas() {
  // Envía a TODOS los clientes conectados el snapshot actual de CACHE_TASAS
  // Payload: { type: 'tasas_update', data: { tasas, bcv_meta, diff_bs, diff_pct, last_update } }
}
```

### 2.7 Graceful Shutdown

```js
// src/server.js (líneas 1475-1511)
// Maneja SIGTERM y SIGINT:
// 1. Detiene los intervals de scraping
// 2. Notifica a clientes WS con { type: 'server_shutdown' }
// 3. Cierra todos los WS después de 250ms
// 4. Hace WAL checkpoint y cierra SQLite
// 5. Fuerza cierre tras 10s de timeout
```

---

## 3. Frontend Web (SPA Vanilla JS)

### 3.1 Archivo Principal: `public/app.js` (~2897 líneas)

**Arquitectura**: Functional vanilla JS sin frameworks. Estado global en variables `let`.

#### 3.1.1 Estado Global

```js
// public/app.js (líneas 38-84)
let d = { bcv: 0, binance: 0, binance_compra: 0, cny: 0 };  // Tasas actuales
let m = 'VES';          // Modo de calculadora
let histMode = null;    // Tasas históricas para la calculadora
let historialData = []; // Datos del historial (24h)
let chartInstance = null;
let chartRange = '24h';
let importTarifaBase = 1030;  // Tarifa de import2ven (default)
// ... más variables de importación
```

#### 3.1.2 Flujo de Carga Inicial

```js
// La app se inicia con <body onload="initApp()">
async function initApp() {
  // 1. Carga inicial de tasas: fetch('/api/tasas-venezuela?stats=1&limit=1')
  // 2. Carga stats: fetch('/api/stats')
  // 3. Inicia WebSocket
  // 4. Renderiza tarjetas, chart, historial y brecha
  // 5. Verifica sesión con /api/auth/me
}
```

#### 3.1.3 Conexión WebSocket

```js
// Reconexión automática cada 5 segundos en caso de caída
function wsConnect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/tasas-ws');
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'tasas_update') {
      updateTasas(msg.data);  // Actualiza d global, tarjetas, brecha, calculadora, ticker
    }
  };
  ws.onclose = () => setTimeout(wsConnect, 5000);
}
```

#### 3.1.4 Ticker (Barra Superior)

- Marquesina CSS animada que muestra las tasas en vivo desplazándose horizontalmente.
- Duplica el contenido para loop infinito.
- Actualiza con cada mensaje WebSocket.

#### 3.1.5 Calculadora de Divisas

Misma lógica que la app móvil. Recibe tasas del objeto `d` (o `histMode` si se usa tasa histórica).

Fórmulas:
- **VES → USDT**: `v / tasaBinanceCompra`
- **VES → BCV**: `v / tasaBCV`
- **VES → CNY**: `(v / tasaBinanceCompra) * 6.53`
- **USDT → VES**: `v * tasaBinanceCompra`
- **USDT → BCV**: `(v * tasaBinanceCompra) / tasaBCV`
- **USDT → CNY**: `v * 6.53`
- **BCV → VES**: `v * tasaBCV`
- **BCV → USDT**: `(v * tasaBCV) / tasaBinanceCompra`
- **BCV → CNY**: `((v * tasaBCV) / tasaBinanceCompra) * 6.53`
- **CNY → USDT**: `v / 6.53`
- **CNY → VES**: `(v / 6.53) * tasaBinanceCompra`
- **CNY → BCV**: `((v / 6.53) * tasaBinanceCompra) / tasaBCV`

Donde `tasaSegura = 6.53` es la tasa fija USD/CNY de referencia.

#### 3.1.6 Calculadora con Tasas Históricas

- Botón "Calcular con tasa de otra fecha" que muestra un panel con inputs type="date" y type="time".
- Hace fetch a `/api/tasas-historicas?fecha=YYYY-MM-DD&hora=HH:MM`.
- Muestra banner indicando que la calculadora usa tasas históricas.
- Botón "Volver a hoy" para restaurar tasas actuales.

#### 3.1.7 Gráfico de Tendencia (Chart.js)

- 4 rangos: 24H, 7D, MES, TODO.
- 3 datasets: Comprar (verde), Vender (rojo), BCV (azul).
- Leyendas toggleables para mostrar/ocultar datasets.
- Stats: Máx, Prom, Mín.
- Scroll horizontal para rangos largos.

#### 3.1.8 Historial

- Tabla de registros históricos con scroll infinito (IntersectionObserver).
- Filtros por fecha y hora.
- Cada fila muestra: fecha, diff_bs, diff_pct, binance compra, binance venta, BCV.

#### 3.1.9 Compartir Tasas

- Función `shareRatesImage()` que captura el DOM de las tarjetas de tasas y genera una imagen.
- Usa `html2canvas` o similar para renderizar a canvas.

#### 3.1.10 Sistema de Auth en Frontend

```js
// public/app.js - PWA auth integration
// La página de login está en /login.html (independiente)
// La app detecta sesión con /api/auth/me
// Muestra botón de login/salir en la topbar según estado
```

---

## 4. App Móvil (Flutter / Android Nativo)

### 4.1 Información General

- **Ubicación**: `/var/www/calculadora/mobile/`
- **Nombre del paquete**: `dayzo_app`
- **App ID Android**: `lat.dayzove.dayzo_app`
- **SDK Dart**: `>=3.2.0 <4.0.0`
- **Versión**: `1.0.0+1`
- **Tema**: Dark (DAYZO)

### 4.2 Dependencias

```yaml
dependencies:
  flutter:
    sdk: flutter
  http: ^1.2.2              # Cliente HTTP para REST API
  web_socket_channel: ^3.0.1  # Cliente WebSocket
  intl: ^0.19.0             # Formateo de fechas/números en español Venezuela
  google_fonts: ^6.2.1      # Fuentes: DM Sans, DM Mono, Playfair Display
  provider: ^6.1.2          # State management
```

### 4.3 Arquitectura

```
mobile/lib/
├── config/
│   └── api_config.dart       # URL base, URIs de endpoints, WS URI
├── models/
│   └── tasas_data.dart        # Modelos: Tasas, BcvMeta, RateStats, TasasSnapshot
├── services/
│   └── tasas_repository.dart   # HTTP + WebSocket client con auto-reconnect
├── providers/
│   └── tasas_provider.dart     # ChangeNotifier provider (estado global)
├── screens/
│   └── home_screen.dart        # Pantalla principal con Scaffold y layout
├── widgets/
│   ├── rate_card.dart          # Tarjeta individual de tasa
│   └── calculator_panel.dart   # Panel de calculadora con tabs y resultados
├── theme/
│   └── dayzo_theme.dart        # Paleta de colores, tema Material, estilos
└── utils/
    ├── currency_calculator.dart # Lógica de conversión de monedas
    └── formatters.dart          # Formatos de número, fecha, parsing local
```

### 4.4 Flujo de Datos

```
TasasRepository.fetchTasas()
  → HTTP GET /api/tasas-venezuela?range=24h&stats=1
  → TasasSnapshot.fromApi(json)
  → TasasProvider (setState)

TasasRepository.connectWebSocket()
  → ws://dayzove.lat/tasas-ws
  → onMessage: json.type === 'tasas_update'
  → TasasSnapshot.fromApi(msg.data)
  → TasasProvider._onWsUpdate()
  → notifyListeners()

TasasProvider
  → Consumer<TasasProvider> en HomeScreen
  → RateCard (4 tarjetas)
  → CalculatorPanel
```

### 4.5 Modelos de Datos

```dart
class Tasas {
  final double binance;        // Tasa compra USDT (precio al que Binance compra USDT)
  final double binanceCompra;  // Tasa venta USDT (precio al que Binance vende USDT)
  final double bcv;            // Tasa BCV vigente (legalmente aplicable hoy)
  final double bcvPublicada;   // Tasa BCV publicada hoy en bcv.org.ve (puede ser futura)
  final double cny;            // Tasa CNY/USD desde BCV
}

class BcvMeta {
  final String? vigentePara;
  final String? publicadaEl;
  final String? nota;          // "Nueva tasa X · rige desde mañana"
  final bool hayNuevaPublicada;
}

class RateStats {
  final double change24h;      // Cambio absoluto en 24h
  final double changePct24h;   // Cambio porcentual en 24h
}

class TasasSnapshot {
  final Tasas tasas;
  final BcvMeta bcvMeta;
  final double diffBs;         // Brecha absoluta: binance - bcv
  final double diffPct;        // Brecha porcentual: (diffBs / bcv) * 100
  final String lastUpdate;     // Fecha-hora de la última actualización
  final RateStats? binanceStats;
  final RateStats? bcvStats;
}
```

### 4.6 Pantalla Principal

La `HomeScreen` construye un `CustomScrollView` con estos elementos en orden:

1. **TopBar**: Logo "DAYZO" + hora última actualización + botón refresh
2. **SpreadBanner**: Brecha Binance vs BCV (gradiente naranja)
3. **RateGrid**: Grid de 2×2 (o 4 en tablets) con tarjetas:
   - Binance Comprar (verde)
   - Binance Vender (rojo)
   - BCV vigente (azul, con subtítulo de fecha)
   - CNY/USD (ámbar)
4. **CalculatorPanel**: Calculadora completa

### 4.7 Temas y Estilo Visual

```dart
class DayzoColors {
  static const bgPage  = Color(0xFF0B0E11);  // Fondo principal oscuro
  static const bgCard  = Color(0xFF1E2329);  // Fondo de tarjetas
  static const bgElevated = Color(0xFF2B3139);
  static const bgInput = Color(0xFF181C20);
  static const textInk = Color(0xFFEAECEF);  // Texto principal
  static const textSoft = Color(0xFF848E9C); // Texto secundario
  static const accent  = Color(0xFFE8541A);  // Naranja DAYZO
  static const green   = Color(0xFF0ECB81);  // Binance compra / positivo
  static const red     = Color(0xFFF6465D);  // Binance venta / negativo
  static const blue    = Color(0xFF3B82F6);  // BCV
  static const amber   = Color(0xFFF0B90B);  // CNY
}
```

- **Fuentes**: Playfair Display (logotipo), DM Mono (valores numéricos), DM Sans (texto general)
- **Material**: Tema oscuro con Material 3, inputs con borde naranja en focus

### 4.8 Calculadora (Mobile)

Misma lógica que la web, implementada en `CurrencyCalculator.compute()`.

Modos: VES, USDT, BCV, CNY. Para cada modo, calcula 3 resultados (conversión a las otras 3 monedas). Constante `tasaSegura = 6.53` (CNY/USD fijo de referencia del BCV).

Resultados con botón de copiar al portapapeles.

### 4.9 WebSocket con Auto-Reconexión

```dart
class TasasRepository {
  void connectWebSocket(void Function(TasasSnapshot) onUpdate) {
    _channel = WebSocketChannel.connect(ApiConfig.wsUri());
    _wsSub = _channel!.stream.listen(
      (event) {
        final msg = jsonDecode(event);
        if (msg['type'] != 'tasas_update') return;
        onUpdate(TasasSnapshot.fromApi(msg['data']));
      },
      onError: (_) => _scheduleReconnect(onUpdate),
      onDone: () => _scheduleReconnect(onUpdate),
    );
  }

  void _scheduleReconnect(void Function(TasasSnapshot) onUpdate) {
    // Reintenta cada 5 segundos
    Timer(const Duration(seconds: 5), () => connectWebSocket(onUpdate));
  }
}
```

### 4.10 Pruebas Unitarias

```dart
// test/currency_calculator_test.dart
// 2 tests:
// - VES a USDT usa binance_compra
// - USDT a bolívares
```

### 4.11 Lo QUE NO TIENE la App Mobile (vs la Web)

La app mobile es **v1** y carece de:
- Gráfico histórico (Chart.js)
- Módulo de importación (login + cotizaciones guardadas)
- Autenticación (login/register)
- Ticker animado
- PWA service worker
- Compartir tasas como imagen
## 5. API REST — Endpoints

### 5.1 Endpoints de Tasas

#### `GET /api/tasas-venezuela`

Devuelve las tasas actuales en caché + historial.

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| `range` | string | `'24h'` | `24h`, `7d`, `month`, `all` |
| `limit` | number | `5000` | Máx. registros de historial (max 10000) |
| `stats` | string | — | `'1'` o `'true'` para incluir chartStats |
| `fecha` | string | — | Filtra historial por fecha (LIKE) |

**Respuesta**:
```json
{
  "tasas": {
    "binance": 100.50,
    "binance_compra": 98.30,
    "bcv": 85.20,
    "bcv_publicada": 85.50,
    "cny": 6.53
  },
  "bcv_meta": {
    "vigente_para": "2026-07-03",
    "dia_efectivo": "2026-07-03",
    "fecha_valor": "2026-07-06",
    "publicada_el": "2026-07-02",
    "hay_nueva_publicada": true,
    "proxima_tasa": 86.10,
    "nota": "Nueva tasa 86,10 · rige desde mañana",
    "fuente": "publicaciones"
  },
  "diff_bs": 15.30,
  "diff_pct": 17.96,
  "fecha": "07/03/2026, 11:57:00 p. m.",
  "last_update": "07/03/2026, 11:57:00 p. m.",
  "historial": [...],
  "rango": { "start": 1700000000000, "end": 1740000000000 },
  "chartStats": { "count": 500, "min": 95.0, "max": 105.0, "avg": 100.2, "range": "24h" }
}
```

#### `GET /api/stats`

Estadísticas agregadas de 24 horas.

**Respuesta**:
```json
{
  "binance": {
    "min": 99.50, "max": 101.20, "avg": 100.35,
    "current": 100.50, "change24h": 1.20, "changePct24h": 1.21
  },
  "bcv": {
    "current": 85.20, "change24h": 0.50, "changePct24h": 0.59,
    "lastUpdate": "07/03/2026, 4:30:00 p. m."
  },
  "spread": { "current": 17.96, "avg24h": 18.10 },
  "lastUpdate": "07/03/2026, 11:57:00 p. m."
}
```

#### `GET /api/tasas-historicas`

Tasas guardadas en una fecha/hora específicas para cálculos históricos.

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `fecha` | string | Sí | `YYYY-MM-DD` |
| `hora` | string | No | `HH:MM` (24h). Sin hora → cierre del día |

**Respuesta**:
```json
{
  "consulta": { "fecha": "2026-07-01", "hora": null, "timestamp": 1740000000000 },
  "tasas": {
    "binance": 99.80,
    "binance_compra": 97.50,
    "bcv": 84.90,
    "bcv_registrada": 84.90
  },
  "registro": {
    "timestamp": 1740000000000,
    "fecha": "07/01/2026, 11:59:59 p. m.",
    "desfase_min": 0
  },
  "diff_bs": 14.90,
  "diff_pct": 17.55,
  "bcv_meta": { ... }
}
```

### 5.2 Endpoints de Autenticación

#### `POST /api/auth/login`

| Body | Tipo | Descripción |
|---|---|---|
| `username` | string | Usuario o email |
| `password` | string | Contraseña |

- Rate limit: 10 intentos por 15 minutos por IP
- Delay progresivo tras 3 intentos fallidos (500ms × intentos, max 5s)
- Protección timing attack: siempre compara con bcrypt (hash dummy si usuario no existe)
- Regenera sesión en login exitoso
- Devuelve `csrfToken` que debe enviarse en header `X-CSRF-Token` para mutaciones

**Respuesta exitosa**:
```json
{
  "success": true,
  "role": "viewer",
  "username": "juan_perez",
  "fullName": "Juan Pérez",
  "csrfToken": "a1b2c3d4e5..."
}
```

#### `POST /api/auth/register`

| Body | Tipo | Descripción |
|---|---|---|
| `fullName` | string | Nombre completo (2-80 chars) |
| `username` | string | 3-32 chars, solo letras/números/._- |
| `email` | string | Email válido |
| `password` | string | ≥8 chars, con letra y número |

- Todos los usuarios se crean con rol `viewer`
- El rol `admin` solo se crea via `seedAdminUser()` al arrancar

#### `GET /api/auth/me`

Devuelve la sesión actual (sin password). Si no hay sesión, `{ loggedIn: false }`.

#### `POST /api/auth/logout`

Destruye la sesión y limpia la cookie.

#### Endpoints de Admin (requieren rol `admin`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/auth/users` | Lista todos los usuarios |
| POST | `/api/auth/users` | Crea usuario (admin o viewer) |
| DELETE | `/api/auth/users/:id` | Elimina usuario |
| GET | `/health` | Health check con stats del servidor |

### 5.3 Endpoints de Cotizaciones de Importación

Todos requieren autenticación (`requireAuth`).

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/import-quotes` | Lista cotizaciones del usuario (máx 1000) |
| GET | `/api/import-quotes/:id` | Detalle de una cotización |
| POST | `/api/import-quotes` | Crear cotización |
| PUT | `/api/import-quotes/:id` | Actualizar cotización |
| DELETE | `/api/import-quotes/:id` | Eliminar cotización |

**Esquema de Quote** (validado por `sanitizeImportQuote`):

Campos numéricos: `version, empresaTarifaUSD, empresaEnvioUSD, cajas, unidadesPorCaja, unidadesTotales, pesoPorCajaKg, precioMercanciaPorUnidadUSD, envioChinaPorCajaUSD, volumenM3, volumenPorCajaM3, pesoKg, costoMercanciaUSD, envioChinaUSD, plataformaUSD, comisionBancoUSD, subtotalUSD, envioInternacionalUSD, fletePorCajaUSD, inversionTotalUSD, costoUnitarioUSD, costoPorCajaUSD, feePlataforma, feeBanco, ventaUnitarioUSD, ventaPorCajaUSD, gananciaUnitariaUSD, gananciaTotalUSD, roiVentaPct, margenVentaPct`

Campos string: `entradaRaw, empresaNombre, tipoCobro`

Campos boolean: `tarifaMinAplicada`

Objeto anidado: `dimensionesCm: { l, w, h }`

---

## 6. WebSocket — Tiempo Real

### 6.1 Conexión

```
URL: wss://dayzove.lat/tasas-ws
```

### 6.2 Mensajes

**Server → Client** (broadcast cada ~10s):
```json
{
  "type": "tasas_update",
  "data": {
    "tasas": {
      "binance": 100.50,
      "binance_compra": 98.30,
      "bcv": 85.20,
      "bcv_publicada": 85.50,
      "cny": 6.53
    },
    "bcv_meta": { ... },
    "diff_bs": 15.30,
    "diff_pct": 17.96,
    "fecha": "07/03/2026, 11:57:00 p. m.",
    "last_update": "07/03/2026, 11:57:00 p. m."
  }
}
```

**Server → Client** (shutdown):
```json
{ "type": "server_shutdown" }
```

El broadcast se dispara desde dos lugares:
1. `updateBinance()` — cada 10s (cuando hay cambios)
2. `updateOficiales()` — cada 15min (cuando hay cambios)
3. `checkRolloverVigenciaBcv()` — en cada tick de Binance si hubo rollover de medianoche

### 6.3 Reconexión

Tanto la web como la app móvil implementan auto-reconexión con intervalos de 5 segundos.

---

## 7. Autenticación y Seguridad

### 7.1 Sistema de Sesiones

- **Cookie**: `dayzo.sid` (httpOnly, secure en prod, sameSite strict, maxAge 7 días)
- **Store**: SQLite (tabla `sessions`) con limpieza cada 15 minutos
- **Secreto**: `SESSION_SECRET` (mínimo 32 chars, recomendado 64 en prod)
- **Rolling**: `true` (renueva expiración con cada request)
- **Regeneración**: Se regenera la sesión en cada login exitoso

### 7.2 Protección CSRF

- Token generado con `crypto.randomBytes(32)` guardado en `req.session.csrfToken`
- Verificado en cada mutación (POST/PUT/DELETE) excepto login/register
- Header: `X-CSRF-Token`

### 7.3 Rate Limiting

| Limiter | Ventana | Máx | Aplica a |
|---|---|---|---|
| `authLimiter` | 15 min | 10 | login, register |
| `tasasLimiter` | 1 min | 60 | /api/tasas-*, /api/stats |
| `mutationLimiter` | 1 min | 40 | CRUD cotizaciones |

### 7.4 Protección contra Fuerza Bruta

- Delay progresivo por IP tras 3 intentos fallidos: `min(attempts × 500ms, 5000ms)`
- Limpieza automática cada hora de IPs inactivas
- Timing attack mitigation: bcrypt hash dummy para usuarios inexistentes

### 7.5 Roles de Usuario

| Rol | Permisos |
|---|---|
| `admin` | CRUD usuarios, health check, CRUD cotizaciones |
| `viewer` | CRUD propias cotizaciones |

### 7.6 Usuario Admin Inicial

Creado automáticamente al arrancar el servidor si no existe:
- `ADMIN_USERNAME` (env, default: `admin`)
- `ADMIN_PASSWORD` (env, default: genera aleatorio de 16 bytes)
- Si `ADMIN_PASSWORD` está definido y el admin ya existe, actualiza la contraseña
- La variable de entorno se elimina (`delete process.env.ADMIN_PASSWORD`) tras usarla por seguridad

---

## 8. Base de Datos SQLite

### 8.1 Esquema

```sql
-- Tabla principal de historial de tasas
CREATE TABLE tasas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      INTEGER NOT NULL,            -- Unix timestamp en ms
  fecha          TEXT NOT NULL,                -- Fecha-hora en locale Venezuela
  binance        REAL NOT NULL DEFAULT 0,      -- Tasa compra USDT P2P
  binance_compra REAL NOT NULL DEFAULT 0,      -- Tasa venta USDT P2P
  bcv            REAL NOT NULL DEFAULT 0,      -- Tasa BCV (la que estaba publicada al capturar)
  diff_bs        REAL NOT NULL DEFAULT 0,      -- Diferencia absoluta
  diff_pct       REAL NOT NULL DEFAULT 0       -- Diferencia porcentual
);
CREATE INDEX idx_timestamp  ON tasas (timestamp DESC);
CREATE INDEX idx_fecha      ON tasas (fecha);
CREATE INDEX idx_ts_binance ON tasas (timestamp DESC, binance);

-- Publicaciones oficiales del BCV (fecha valor real)
CREATE TABLE bcv_publicaciones (
  fecha_valor  TEXT PRIMARY KEY,   -- Día en que la tasa rige (YYYY-MM-DD)
  bcv          REAL NOT NULL,
  publicada_el TEXT NOT NULL,      -- Día en que se publicó
  timestamp    INTEGER NOT NULL,
  fuente       TEXT NOT NULL DEFAULT 'scraper'  -- 'scraper' | 'backfill'
);

-- Cotizaciones de importación guardadas
CREATE TABLE import_quotes (
  id         TEXT PRIMARY KEY,       -- UUID
  name       TEXT NOT NULL,
  quote      TEXT NOT NULL,          -- JSON con todos los campos calculados
  user_id    TEXT,                   -- FK a users.id
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Usuarios
CREATE TABLE users (
  id         TEXT PRIMARY KEY,       -- UUID
  username   TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,          -- bcrypt hash
  role       TEXT NOT NULL DEFAULT 'viewer',  -- 'admin' | 'viewer'
  created_at INTEGER NOT NULL,
  last_login INTEGER,
  full_name  TEXT,                   -- Migración aditiva
  email      TEXT                    -- Migración aditiva, UNIQUE WHERE NOT NULL
);

-- Sesiones (creada por SQLiteSessionStore)
CREATE TABLE sessions (
  sid     TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
  sess    TEXT NOT NULL,
  expired INTEGER NOT NULL
);
```

### 8.2 Configuración

```sql
PRAGMA journal_mode = WAL;    -- Write-Ahead Logging para mejor concurrencia
PRAGMA synchronous  = NORMAL; -- Balance rendimiento/seguridad
PRAGMA cache_size   = -8000;  -- 8 MB de cache
```

### 8.3 Migraciones

- Aditivas: nunca borran datos existentes
- `ALTER TABLE users ADD COLUMN ...` envuelto en try/catch
- Backfill de `bcv_publicaciones` desde el historial al arrancar

---

## 9. Scraping y Fuentes de Datos

### 9.1 Binance P2P

- **URL**: `POST https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search`
- **Frecuencia**: cada 10 segundos
- **Lógica**: Promedio simple de los 5 mejores anuncios (más baratos para comprar, más caros para vender)
- **Retry**: 3 intentos con backoff exponencial (2s, 4s, 8s)

### 9.2 BCV (Banco Central de Venezuela)

- **URL**: `GET https://www.bcv.org.ve/`
- **Frecuencia**: cada 15 minutos
- **Extracción**: Regex sobre el HTML para encontrar:
  - Bloque `id="dolar"` → tasa USD
  - Bloque `id="yuan"` → tasa CNY
  - `Fecha Valor` en atributo `content` de un `<span>` con schema.org
- **SSL**: `rejectUnauthorized: false` (certificado problemático del BCV)

### 9.3 Feriados Bancarios

- **Archivo**: `data/feriados-ve.json`
- Contiene feriados nacionales y bancarios de Venezuela para 2026-2027
- Se carga al arrancar en un `Set<string>` para búsqueda O(1)

---

## 10. Módulo de Importación

### 10.1 Empresas de Envío Soportadas

| Empresa | Tarifa (USD) | Tipo de cobro |
|---|---|---|
| GCCARGO | 770 | Por volumen puro. Sin mínimo. |
| Orinoco | 865 | Por volumen. Mínimo $35/caja si volumen < 0.035 m³. |
| import2ven | 1030 | Por densidad: peso si den > 1000; volumen+$50 si 380-1000; volumen puro si den < 380. |
| Personalizado | Variable | Configurable por el usuario. |

### 10.2 Cálculo de Costos

1. **Volumen por caja**: `largo × ancho × alto / 1,000,000` (cm → m³)
2. **Densidad**: `pesoKg / volumenM3`
3. **Tipo de cobro** (según empresa):
   - Volumen: `volumenTotal × tarifa`
   - Peso: `pesoTotal × (tarifa / 1000)` (tarifa por tonelada)
   - Mixto: tarifa por volumen si densidad < threshold, por peso si no
4. **Costo mercancía**: `unidades × precioUnitarioCNY / tasaCNY`
5. **Comisiones**: Plataforma (3%) + Banco (1.25%) sobre subtotal
6. **Inversión total**: mercancía + envío China + comisiones + flete internacional
7. **Costo unitario**: inversión total / unidades totales

### 10.3 Simulador de Venta

- Calcula ganancia, ROI, margen sobre venta y punto de equilibrio
- Modos: precio fijo ($), precio en Bs., o margen (%)
- Margen rápido: botones +20%, +30%, +50%, +80%, ×2, ×3
- Sparkline de ganancia proyectada

### 10.4 Cotizaciones Guardadas

- CRUD completo: crear, leer, actualizar, eliminar
- Almacena el quote completo (JSON) + nombre + link de producto + precio de venta
- Filtros: por empresa, por nombre (búsqueda)
- Orden: más reciente, mayor inversión, empresa, nombre

---

## 11. App Móvil — Estructura Detallada

### 11.1 Configuración de API: `config/api_config.dart`

```dart
class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://dayzove.lat',
  );

  // /api/tasas-venezuela?range=24h&stats=1
  static Uri tasasUri({String range = '24h', bool stats = true}) { ... }

  // /api/stats
  static Uri statsUri() => Uri.parse('$baseUrl/api/stats');

  // wss://dayzove.lat/tasas-ws
  static Uri wsUri() { ... }  // Convierte https → wss, http → ws
}
```

La URL base se puede cambiar en tiempo de compilación con:
```bash
flutter build apk --dart-define=API_BASE_URL=https://otro-dominio.com
```

### 11.2 Provider: `providers/tasas_provider.dart`

```dart
class TasasProvider extends ChangeNotifier {
  TasasSnapshot? snapshot;
  bool loading = true;
  bool refreshing = false;
  String? error;
  CalcMode calcMode = CalcMode.ves;
  String amountRaw = '';
  CalcResult? calcResult;

  Future<void> init();        // refresh() + WebSocket
  Future<void> refresh();     // fetchTasas + stats
  void setCalcMode(mode);     // Cambia modo y recalcula
  void setAmount(raw);        // Input del usuario, recalcula
  void clearAmount();         // Limpia input
}
```

### 11.3 Cycle de Vida

1. `HomeScreen.initState()` → `context.read<TasasProvider>().init()`
2. `init()` → `refresh()` (HTTP) + `connectWebSocket(onUpdate)`
3. Cada update WS → `_onWsUpdate()` → actualiza snapshot + recalcula + `notifyListeners()`
4. UI se reconstruye via `Consumer<TasasProvider>`

### 11.4 Diferencias con la Versión Web

| Funcionalidad | Web | Mobile v1 |
|---|---|---|
| Tasas en vivo | Sí (WS + REST) | Sí (WS + REST) |
| Calculadora divisas | Sí | Sí |
| Gráfico tendencia (Chart.js) | Sí | **No** |
| Historial con scroll infinito | Sí | **No** |
| Calculadora histórica | Sí | **No** |
| Módulo importación | Sí | **No** |
| Autenticación (login) | Sí | **No** |
| Cotizaciones guardadas | Sí | **No** |
| Simulador de venta | Sí | **No** |
| Compartir tasas (imagen) | Sí | **No** |
| Ticker animado | Sí | **No** |
| PWA (offline) | Sí | **No** (es nativa) |

### 11.5 Cómo Compilar

```bash
cd mobile
flutter pub get
flutter build apk --release
# Para cambiar URL:
flutter build apk --release --dart-define=API_BASE_URL=https://tu-dominio.com
```

---

## 12. PWA — Progressive Web App

### 12.1 Manifest: `public/manifest.json`

```json
{
  "name": "DAYZO — Tasas e Importación",
  "short_name": "DAYZO",
  "start_url": "/calculadoraa",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0B0E11",
  "theme_color": "#0B0E11"
}
```

### 12.2 Service Worker: `public/service-worker.js`

Estrategia **network-first** con fallback a caché:

1. **Precache del shell**: HTML, CSS, JS y manifest al instalar
2. **Shell estático**: Network-first (fresco si hay red, cache si no)
3. **API tasas**: Network-first con respaldo a última respuesta cacheada (stale data)
4. **Resto de API** (auth, cotizaciones): Siempre red (nunca cachear datos sensibles)
5. **CDNs** (Chart.js, Font Awesome, Google Fonts): Directo a red (origin externo)
6. **Cache naming**: `dayzo-v2`, limpia caches antiguas al activar
7. **skipWaiting + clientsClaim**: Actualiza todos los clientes al instalar nuevo SW

---

## 13. Despliegue y PM2

### 13.1 Configuración `ecosystem.config.cjs`

```js
module.exports = {
  apps: [{
    name: 'calculadora',
    script: 'src/server.js',
    node_args: '--max-old-space-size=512',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production', PORT: 3001 }
  }]
};
```

### 13.2 Scripts en `package.json`

```json
{
  "start": "node src/server.js",
  "dev": "node src/server.js",
  "build:css": "tailwindcss -i ./styles/tailwind-entry.css -o ./public/tailwind.css --minify",
  "migrate": "node scripts/migrate.js",
  "pm2:start": "pm2 start ecosystem.config.cjs",
  "pm2:restart": "pm2 restart calculadora"
}
```

### 13.3 Variables de Entorno

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `PORT` | No | 3001 | Puerto del servidor HTTP |
| `NODE_ENV` | No | — | `'production'` para HTTPS y seguridad |
| `SESSION_SECRET` | Sí (prod) | Generado en dev | Secreto de sesión (min 32 chars) |
| `ADMIN_USERNAME` | No | `'admin'` | Usuario admin inicial |
| `ADMIN_PASSWORD` | No | Aleatorio 16 bytes | Contraseña admin inicial |
| `DATA_DIR` | No | `./data` | Directorio de datos (SQLite + JSON) |

### 13.4 Health Check

`GET /health` (requiere auth admin) devuelve:
- Uptime, uso de memoria (RSS, heap, external)
- Registros en DB, cotizaciones guardadas, sesiones activas
- Clientes WebSocket conectados, estado de timers
- Última actualización de cada fuente
- Valores actuales del caché de tasas

---

## Notas Finales para una IA

### Patrones Clave

1. **La app mobile es una versión reducida de la web**: solo tiene tasas en vivo + calculadora de divisas. No tiene login, ni importación, ni gráficos, ni historial.

2. **El backend es stateless excepto el caché en memoria y las sesiones SQLite**: todo el estado de las tasas vive en `CACHE_TASAS`, que se hidrata desde SQLite al arrancar.

3. **La persistencia es append-only**: los registros de tasas solo se insertan, nunca se modifican ni eliminan (a menos que sea migración). Las cotizaciones y publicaciones BCV sí se actualizan.

4. **El scraping es pull-based**: el servidor NO recibe webhooks de Binance o BCV. Todo es polling: 10s para Binance, 15min para BCV.

5. **La tasa BCV tiene lógica legal compleja**: no es simplemente "el último valor del BCV". Hay que aplicar las reglas de fecha valor, medianoche, fines de semana y feriados.

6. **La app mobile comparte el mismo backend**: no necesita su propio servidor. La URL de API es configurable en tiempo de compilación.

7. **CSRF y sesiones**: Aunque la app mobile no implementa login aún, el backend está preparado para autenticar requests desde la app si se añade en el futuro.

8. **El módulo de importación es la feature más compleja**: involucra 3 empresas con diferentes lógicas de cobro, comisiones, cálculo de volumen/densidad, y un simulador de venta con ROI.
