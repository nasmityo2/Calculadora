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

## ADR-009 — Contrato canónico y frescura de tasas

- Estado: aceptada.
- Decisión: exponer `p2pBuyVesPerUsdt` y `p2pSellVesPerUsdt`, manteniendo `binance`/`binance_compra` como aliases legacy. `cny` significa CNY por USD y se deriva de las publicaciones BCV `USD_VES / CNY_VES`.
- Frescura: cada fuente expone `lastAttemptAt`, `lastSuccessAt`, `status`, `stale` y fallos consecutivos. Un intento fallido nunca avanza la fecha de éxito; el último valor cacheado puede mostrarse como degraded/stale.
- Red: BCV usa TLS estricto por defecto. El fallback sin validación de certificado requiere `BCV_TLS_FALLBACK=1`, ocurre solo después del intento estricto, se registra sin contenido y pasa el mismo parser/rangos/validación de salto.
- Scheduling: Binance usa un solo ciclo recursivo con lock, backoff exponencial y jitter; no `setInterval`.
- Compatibilidad: aliases y `last_update` permanecen durante web/mobile v1. Clientes nuevos usan nombres canónicos y estados de fuente.
- Riesgo/rollback: saltos mayores al 50% se rechazan y conservan cache; ante redenominación real se ajusta el umbral mediante cambio revisado, no desactivando validación.
