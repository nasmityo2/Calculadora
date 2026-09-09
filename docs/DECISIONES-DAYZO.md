# Decisiones técnicas DAYZO

## ADR-001 — Web primero y compatibilidad aditiva

- Estado: aceptada.
- Decisión: cerrar y verificar backend/web antes de modificar `mobile/`. Los contratos nuevos conservarán un adaptador temporal para payloads legacy.
- Motivo: reduce cambios simultáneos en servidor, contrato, UI y mobile, y facilita rollback.
- Alternativas descartadas: reescritura en framework y migración conjunta; elevan riesgo, bundle y RAM.
- Riesgo/rollback: código de compatibilidad temporal; retirarlo solo tras desplegar clientes nuevos.

## ADR-002 — SQLite de una instancia

- Estado: aceptada.
- Decisión: mantener SQLite con WAL, `foreign_keys`, `busy_timeout`, backups consistentes y transacciones.
- Motivo: una sola instancia y VPS de 1 GB no justifican otro servicio de base de datos.
- Alternativas descartadas: PostgreSQL/MySQL en el mismo VPS por consumo y complejidad operativa.
- Riesgo/rollback: escrituras serializadas; restaurar backup verificado con la aplicación detenida.

## ADR-003 — Backend como fuente monetaria canónica

- Estado: aceptada.
- Decisión: entradas base validadas y derivados recalculados por funciones puras versionadas en el servidor. El cliente solo previsualiza.
- Contrato: `calculationVersion="dayzo-import-v2"`. Entradas base: empresa/tarifa, cajas, unidades por caja, dimensiones, peso por caja, precio unitario USD, envío China por caja, comisiones y precio de venta opcional. La salida conserva los campos planos legacy, añade `input` normalizado y un `rateSnapshot`; cualquier total, ROI o margen enviado por el cliente se descarta y recalcula.
- Compatibilidad: `empresaEnvioUSD` se acepta temporalmente como alias de `empresaTarifaUSD`; los campos planos existentes continúan en la respuesta. `unidadesTotales` puede llegar, pero debe coincidir exactamente con `cajas × unidadesPorCaja`.
- Precisión: no se redondean costos internos; el redondeo es solo de presentación. El flete import2ven conserva los `ceil` del contrato legacy. Tolerancia de regresión automatizada: `1e-9`.
- Motivo: impide persistir totales manipulados o inconsistentes.
- Alternativas descartadas: comparar solamente `Number.isFinite` o confiar en la UI.
- Riesgo/rollback: datos legacy incompletos; se conservan mediante adaptador y campos originales, sin migración destructiva.

## ADR-004 — Tooling de medición solo en desarrollo

- Estado: aceptada.
- Decisión: añadir `@playwright/test`, Lighthouse y PM2 como dependencias de desarrollo reproducibles.
- Necesidad: capturas/E2E, auditoría de rendimiento/accesibilidad y medición comparable de RSS.
- Costo: no se instalan en producción con `npm ci --omit=dev`; no aumentan RAM ni bundle del runtime.
- Licencias: Apache-2.0 (`@playwright/test`), Apache-2.0 (Lighthouse), AGPL-3.0 (PM2). PM2 ya es la herramienta operativa declarada por el proyecto; se usa como proceso externo, no se distribuye enlazado con la app.
- Alternativa sin dependencia: capturas y memoria manuales, no reproducibles.
- Rollback: retirar paquetes dev y `scripts/capture-baseline.js`.

## ADR-005 — Secretos y bootstrap fail-closed

- Estado: aceptada.
- Decisión: producción exige `SESSION_SECRET` fuerte; PM2 no contiene valores por defecto. `ADMIN_PASSWORD` solo se admite con una señal explícita de bootstrap cuando aún no hay admin. Los cambios posteriores usan una CLI de reset, sin imprimir contraseñas.
- Motivo: evita credenciales públicas y resets silenciosos en reinicios.
- Alternativas descartadas: password aleatorio impreso en logs y reset automático desde entorno.
- Riesgo/rollback: una instalación nueva sin bootstrap no inicia; el runbook documenta el comando explícito.

## ADR-006 — API de cotizaciones resumida y paginada

- Estado: aceptada.
- Decisión: lista con `limit<=50`, `offset`, orden estable y resúmenes; detalle completo por UUID. Respuesta incluye metadatos de paginación.
- Motivo: reduce payload, DOM y memoria en móvil.
- Alternativas descartadas: 1000 registros completos y virtualización del JSON completo.
- Riesgo/rollback: cliente web viejo; mantener adaptador/versionado durante el despliegue.

## ADR-007 — Dependencias visuales self-hosted

- Estado: aceptada.
- Decisión: servir Chart.js 4.5.1 y Font Awesome Free 7.3.1 desde versiones fijadas por `package-lock`, exponiendo solo rutas allowlist; logo/manifest usan SVG local. Se eliminaron handlers/scripts inline y CDNs. Tipografías usan stacks del sistema.
- Necesidad/costo: Chart.js conserva el gráfico existente; Font Awesome evita reescribir decenas de iconos en el mismo cambio. Son assets de navegador, no se `require()` en Node y no añaden heap al proceso; sí añaden disco de instalación y bytes transferidos cacheables.
- Licencias: Chart.js MIT; Font Awesome Free combina código MIT, fuentes SIL OFL 1.1 e iconos CC BY 4.0.
- Alternativa sin dependencia: Canvas/SVG e iconos propios reducirían disco pero amplían código y riesgo visual; queda como optimización posterior medible.
- Motivo: CSP estricta, disponibilidad y build reproducible.
- Alternativas descartadas: CDN “latest” y múltiples hosts sin SRI.
- Riesgo/rollback: aumento pequeño de archivos estáticos; restaurar referencias fijadas con SRI si un asset local falla.

## ADR-008 — Presupuesto VPS

- Estado: aceptada provisionalmente.
- Decisión: iniciar con heap V8 320 MB y `max_memory_restart` 350 MB, una instancia, cache SQLite 8 MB. Ajustar solo con observación real.
- Evidencia: baseline local ~76.5 MB RSS bajo PM2; no sustituye medición de 24 h en VPS.
- Riesgo/rollback: picos no observados localmente; rollback a límites previos mientras se investiga, sin aumentar instancias.

## ADR-010 — Precio de compra CNY/USD v3 aditivo

- Estado: aceptada.
- Decisión: introducir `purchasePrice { amount, currency }` y
  `calculationVersion=dayzo-import-v3` de forma aditiva. La conversión CNY→USD
  ocurre solo en el servidor; USD no se reconvierte. Se persisten original,
  contraparte, snapshot y equivalentes finales. Lectura v1/v2 se adapta sin
  migración destructiva.
- Motivo: trazabilidad monetaria y evitar reinterpretar históricas con tasa actual.
- Alternativas descartadas: adivinar moneda por magnitud; confiar en tasa del cliente;
  migración SQL que reescriba cotizaciones.
- Riesgo/rollback: clientes viejos siguen enviando `precioMercanciaPorUnidadUSD`;
  el adaptador lo trata como compra USD. Rollback de código conserva JSON v3 legible.

## ADR-011 — Login editorial “Mesa de costos”

- Estado: aceptada.
- Decisión: sustituir el split SaaS con preview ficticio por composición editorial
  asimétrica, cadena Producto→CNY/USD→Comisiones→Flete→Costo final con CSS/SVG y
  tasas públicas, formulario sobrio anclado a la derecha; en móvil el formulario va primero.
- Motivo: identidad propia sin plantilla generada ni claims técnicos decorativos.
- Alternativas descartadas: glassmorphism, blobs, stock photos, fake dashboard.
- Riesgo/rollback: revertir `login.html`/`auth.css`/`auth.js` restaura el layout previo.

## ADR-012 — Flutter local no bloqueado por VPS

- Estado: aceptada (supersede parcialmente ADR-001 respecto al gate remoto).
- Decisión: completar Flutter localmente aunque el deploy VPS siga bloqueado externo.
- Motivo: el plan final exige paridad móvil ejecutable sin acceso SSH.
- Riesgo/rollback: la publicación remota y el keystore siguen siendo bloqueos externos.

## ADR-009 — Contrato canónico y frescura de tasas

- Estado: aceptada.
- Decisión: exponer `p2pBuyVesPerUsdt` y `p2pSellVesPerUsdt`, manteniendo `binance`/`binance_compra` como aliases legacy. `cny` significa CNY por USD y se deriva de las publicaciones BCV `USD_VES / CNY_VES`.
- Frescura: cada fuente expone `lastAttemptAt`, `lastSuccessAt`, `status`, `stale` y fallos consecutivos. Un intento fallido nunca avanza la fecha de éxito; el último valor cacheado puede mostrarse como degraded/stale.
- Red: BCV usa TLS estricto por defecto. El fallback sin validación de certificado requiere `BCV_TLS_FALLBACK=1`, ocurre solo después del intento estricto, se registra sin contenido y pasa el mismo parser/rangos/validación de salto.
- Scheduling: Binance usa un solo ciclo recursivo con lock, backoff exponencial y jitter; no `setInterval`.
- Compatibilidad: aliases y `last_update` permanecen durante web/mobile v1. Clientes nuevos usan nombres canónicos y estados de fuente.
- Riesgo/rollback: saltos mayores al 50% se rechazan y conservan cache; ante redenominación real se ajusta el umbral mediante cambio revisado, no desactivando validación.

## ADR-013 — El USDT siempre se toma del precio de compra

- Estado: aceptada.
- Decisión: toda conversión a/desde USDT en la app usa `p2pBuyVesPerUsdt`
  (`binance`, tradeType BUY). En el cliente hay una sola puerta, `getUsdtRate()`.
  El precio de venta (`p2pSellVesPerUsdt`, columna legacy `binance_compra`) queda
  únicamente como dato de mercado en las tarjetas de tasas y en el gráfico.
- Motivo: antes convivían dos criterios (`binance_compra || binance` en la
  calculadora y en los equivalentes BCV, `binance` en la brecha y el ticker), así
  que la misma cotización daba dos números según la pantalla. El precio de compra
  es además el que refleja lo que cuesta reponer los dólares de la importación.
- Nota de nomenclatura: la columna `binance_compra` guarda el precio de VENTA. El
  nombre es histórico y no se renombra para no romper bases existentes; queda
  documentado en `src/server.js` junto a la sentencia de inserción.
- Riesgo/rollback: cambiar `getUsdtRate()` revierte el criterio en un punto.

## ADR-014 — Cotizaciones en USDT, dólar BCV y yuan (sin bolívares)

- Estado: aceptada.
- Decisión: el módulo de importación y el simulador de venta presentan cada monto
  en tres monedas y en orden fijo: USDT (base del cálculo) → dólar BCV → yuan. Se
  eliminó el renglón en bolívares y el modo «Precio (Bs.)» del simulador, que pasó
  a ser «Precio (¥)». La calculadora de divisas sí conserva los bolívares: su
  función es justamente convertir montos en Bs.
- Motivo: las cuentas de importación se hacen y se cierran en USDT y yuanes; el
  bolívar solo añadía una cifra que envejece en minutos.
- Riesgo/rollback: `crossCurrencies()` en `public/app.js` concentra el formato de
  la línea secundaria; el modo `priceVes` sigue existiendo en
  `public/js/sale-calculations.js` por si hiciera falta reponerlo.

## ADR-015 — El yuan se guarda con cada snapshot de tasas

- Estado: aceptada.
- Decisión: la tabla `tasas` gana una columna aditiva `cny` (yuanes por dólar) que
  se persiste en cada registro y se devuelve en `/api/tasas-historicas`.
- Motivo: «calcular con la tasa de otra fecha» mezclaba el USDT y el BCV de esa
  fecha con el yuan de hoy. Además, tras un reinicio la app mostraba el yuan
  estimado (6,53) hasta que el scraper del BCV volviera a responder.
- Compatibilidad: los registros anteriores traen `cny = 0`; en ese caso la
  calculadora usa el yuan de hoy y lo advierte en el pie, en vez de inventar una
  tasa histórica.
