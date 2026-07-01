# Auditoría 0.5 — Plan de reescritura con prioridades

Fecha: 2026-06-10 — Rama: `migration/sqlite`
Basado en `01-archivos-con-pg.md` y `02-sql-especifico-pg.md`.

## Lista A — Archivos simples (reescritura rápida)

Pocas queries, sin SQL avanzado. Conversión mecánica `$n→?`, sin transacciones complejas.

| Archivo | Llamadas | Fase plan |
|---|---|---|
| `backend/services/modoMonedaService.js` | 1 | 3A.1 |
| `backend/controllers/auth.controller.js` | 5 | 3A.2 |
| `backend/services/licenciaService.js` | 4 | 3A.5 |
| `backend/services/bcvTasaAutoService.js` | 2 | 3C.5 |
| `backend/middleware/cajaAbierta.middleware.js` | 2 | 3B (junto a caja) |
| `backend/middleware/audit.middleware.js` | 2 | 3A (transversal) |
| `backend/utils/ventaTotalesBcv.js` | helper (sin db directa) | 3B.1 |
| `backend/services/backupScheduler.js` | 1 | 4.3 |
| `backend/routes/licencia.routes.js` | 1 | 3A.5 |
| `backend/routes/dashboard.routes.js` | 3 | 3D.1 |
| `backend/services/preciosService.js` | 9 | 3A.3 |
| `backend/services/impresionService.js` | 4 | 3B (lecturas de venta) |
| `backend/controllers/proveedores.controller.js` | 7 (ILIKE×4) | 3C.2 |
| `backend/services/excelService.js` | 6 (LATERAL×2) | 3D.3 |
| `backend/controllers/productos.controller.js` | 10 (ILIKE×6, RETURNING×3) | 3A.4 |

## Lista B — Archivos complejos (requieren atención)

Muchas queries, JSONB, transacciones multi-paso, FOR UPDATE, FILTER, lógica de triggers a absorber.

| Archivo | Llamadas | Riesgos | Fase plan |
|---|---|---|---|
| `backend/controllers/ventas.controller.js` | 46 | FOR UPDATE×5, idempotencia, absorbe trigger stock, JSONB pagos, numeración secuencia | 3B.4 / 3B.5 |
| `backend/controllers/caja.controller.js` | 28 | LATERAL jsonb_array_elements×8, FILTER×24, cuadre multimoneda | 3B.3 |
| `backend/controllers/devoluciones.controller.js` | 20 | FOR UPDATE×3, tx de reversa stock/caja/cartera, JSONB lineas | 3B.6 |
| `backend/config/migrations.js` | 91 | runner completo PG — se bifurca por feature flag, NO se convierte línea a línea | 3C.6 |
| `backend/services/pdfService.js` | 19 | jsonb_array_elements + FILTER (cierres caja PDF) | 3D (junto a reportes) |
| `backend/services/setupAdminService.js` | 18 | tx setup inicial, FOR UPDATE | 3A.5 (con usuarios) |
| `backend/routes/compras.routes.js` | 18 | handlers inline, tx recibir mercancía, absorbe trigger costo promedio, FOR UPDATE | 3C.2 |
| `backend/controllers/clientes.controller.js` | 17 | FOR UPDATE, RETURNING, ILIKE | 3C.1 |
| `backend/services/cuentasPagarService.js` | 17 | FILTER×6, FOR UPDATE×2, tx abonos | 3C.2 |
| `backend/routes/usuarios.routes.js` | 17 | handlers inline, RETURNING×3, permisos_override JSONB | 3A.5 |
| `backend/controllers/cartera.controller.js` | 15 | FILTER×4, FOR UPDATE, tx abonos crédito | 3C.1 |
| `backend/services/reportesService.js` | 15 | jsonb_agg/jsonb_build_object, agregaciones complejas | 3D.2 |
| `backend/controllers/reportes.controller.js` | 14 | jsonb_array_elements×8 (prorrateo pagos) | 3D.2 |
| `backend/controllers/configuracion.controller.js` | 14 | tx×6, absorbe trigger historial_tasas | 3A.3 |
| `backend/services/dashboardService.js` | 13 | FILTER×11 | 3D.1 |
| `backend/services/casheaService.js` | 12 | FOR UPDATE (Bug-30), tx liquidaciones | 3C.3 |
| `backend/services/cotizacionesService.js` | 12 | secuencia COT, tx crear/editar | 3C.4 |
| `backend/controllers/inventario.controller.js` | 12 | tx ajustes, absorbe protección stock>=0 | 3B.2 |
| `backend/services/creditoAbonoService.js` | 1 (recibe t) | helper dentro de tx de cartera | 3C.1 |
| `backend/utils/devolucionesSaldo.js` | helper (recibe t) | usado por devoluciones | 3B.6 |
| `backend/services/importProductosService.js` | 8 | tx import masivo | 3A.4 (con productos) |
| `backend/services/syncService.js` | — | pg_dump → backupService SQLite | 4.3 |
| `backend/utils/pgDumpResolver.js` | — | stub null | 4.3 |
| `backend/server.js` | 2 | arranque/health, bind 127.0.0.1 se mantiene | 3C.6 / 4.5 |

## Orden de ejecución (el del plan, validado)

1. **3A**: modoMoneda → auth → precios/configuracion → productos (+import) → usuarios/licencia/setupAdmin
2. **3B**: ventaTotalesBcv → inventario → caja (+cajaAbierta middleware) → ventas.create → ventas resto (+impresion) → devoluciones
3. **3C**: cartera/clientes/creditoAbono → proveedores/compras/CXP → cashea → cotizaciones → bcvTasaAuto → migrations runner
4. **3D**: dashboard → reportes (controller+service) → excel (+pdfService) → prueba integral
5. **4**: backups SQLite, wizard, default engine, limpieza PG

## Riesgos transversales identificados

- `audit.middleware.js` registra en `auditoria` — se usa en muchas rutas; convertir temprano (3A).
- `setupAdminService.js` es necesario para el wizard de primer arranque — convertir en 3A.5.
- `impresionService.js` lee ventas para tickets — convertir con ventas (3B.5).
- `pdfService.js` (19 queries, no estaba explícito en el plan) — se convierte en 3D.3 junto a Excel.
- Booleans: en SQLite `activo=1/0`; el frontend recibe `1/0` en vez de `true/false` — los JSON
  de respuesta deben normalizarse donde el frontend haga comparaciones estrictas (revisar en pruebas).
- Fechas `TEXT ISO`: `fecha_venta >= ?` funciona lexicográficamente con ISO-8601 UTC.
  Cuidado con `CURRENT_DATE` PG → usar fechas calculadas en JS para rangos de día local (UTC-4).
