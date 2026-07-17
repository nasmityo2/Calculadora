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
- Decisión: fijar y servir localmente Chart.js/iconos esenciales o reemplazar iconos decorativos por texto/SVG local; eliminar inline handlers antes de retirar `unsafe-inline`.
- Motivo: CSP estricta, disponibilidad y build reproducible.
- Alternativas descartadas: CDN “latest” y múltiples hosts sin SRI.
- Riesgo/rollback: aumento pequeño de archivos estáticos; restaurar referencias fijadas con SRI si un asset local falla.

## ADR-008 — Presupuesto VPS

- Estado: aceptada provisionalmente.
- Decisión: iniciar con heap V8 320 MB y `max_memory_restart` 350 MB, una instancia, cache SQLite 8 MB. Ajustar solo con observación real.
- Evidencia: baseline local ~76.5 MB RSS bajo PM2; no sustituye medición de 24 h en VPS.
- Riesgo/rollback: picos no observados localmente; rollback a límites previos mientras se investiga, sin aumentar instancias.
