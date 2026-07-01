# Auditoría 0.3 — SQL específico de PostgreSQL

Fecha: 2026-06-10 — Rama: `migration/sqlite`

Estrategia general de conversión a SQLite (better-sqlite3 incluye la extensión JSON1):
`jsonb_array_elements(x)` → `json_each(x)` · `p.obj->>'k'` → `json_extract(p.value,'$.k')` ·
`jsonb_typeof` → `json_type` · `FILTER (WHERE c)` → `SUM(CASE WHEN c THEN v ELSE 0 END)` ·
`FOR UPDATE` → eliminar (transacciones serializadas WAL) · secuencias → `AUTOINCREMENT`/`MAX()` en JS.

## 1. `FOR UPDATE` (eliminar — better-sqlite3 serializa escrituras dentro de transaction())

| Archivo | Línea | Fragmento |
|---|---|---|
| `backend/controllers/ventas.controller.js` | 492 | `SELECT * FROM productos WHERE id = $1 FOR UPDATE` |
| `backend/controllers/ventas.controller.js` | 917 | `SELECT * FROM ventas WHERE id = $1 FOR UPDATE` |
| `backend/controllers/ventas.controller.js` | 925 | `SELECT estado_liquidacion FROM ventas_cashea ... FOR UPDATE` |
| `backend/controllers/ventas.controller.js` | 943 | `SELECT stock_actual FROM productos ... FOR UPDATE` |
| `backend/controllers/ventas.controller.js` | 976 | `FROM cuentas_cobrar WHERE venta_id = $1 ... FOR UPDATE` |
| `backend/controllers/devoluciones.controller.js` | 206, 283, 295 | locks de stock/devolución |
| `backend/controllers/clientes.controller.js` | 164 | lock de cuenta por cobrar |
| `backend/controllers/cartera.controller.js` | 164 | `FOR UPDATE OF cc` |
| `backend/services/cuentasPagarService.js` | 294, 406 | `FOR UPDATE OF cp` |
| `backend/services/casheaService.js` | 774 | `FOR UPDATE OF vc` (Bug-30 lock) |
| `backend/routes/compras.routes.js` | 209 | lock de producto al recibir compra |
| `backend/services/setupAdminService.js` | 129 | lock en setup admin |

## 2. `FILTER (WHERE ...)` (→ `CASE WHEN`)

| Archivo | Líneas | Contexto |
|---|---|---|
| `backend/services/dashboardService.js` | 30-67 (11 usos) | KPIs ventas hoy/semana/mes en USD y BCV |
| `backend/services/cuentasPagarService.js` | 74-107 | resumen CXP vencidas |
| `backend/controllers/cartera.controller.js` | 23-26 | resumen cartera vencida |
| `backend/services/pdfService.js` | 1366-1371, 1504-1510 | desglose de pagos por método (cierre caja PDF) |
| `backend/controllers/caja.controller.js` | (24 usos FILTER/jsonb) | cuadre de caja por método de pago |

## 3. `jsonb_array_elements` / `jsonb_typeof` / `LATERAL` (→ `json_each` + `json_extract`)

| Archivo | Líneas | Contexto |
|---|---|---|
| `backend/controllers/caja.controller.js` | 31-57, 284-307, 349-350, 510-511, 687-712 | explode de `ventas.pagos` JSONB con desglose cashea |
| `backend/services/pdfService.js` | 1373-1374, 1513-1514 | explode de pagos para PDF cierre |
| `backend/controllers/reportes.controller.js` | 27-106 (8 usos) | prorrateo de pagos por método en reportes |
| `backend/services/excelService.js` | 730, 744 | `LEFT JOIN LATERAL` últimas compras/ventas por producto |
| `backend/services/reportesService.js` | 77 | `jsonb_agg(jsonb_build_object(...))` agregación de detalle |

## 4. `ILIKE` (→ `LIKE ... COLLATE NOCASE`)

| Archivo | Usos |
|---|---|
| `backend/controllers/productos.controller.js` | 6 |
| `backend/controllers/proveedores.controller.js` | 4 |
| `backend/controllers/clientes.controller.js` | 4 |
| `backend/routes/compras.routes.js` | 2 |
| `backend/controllers/devoluciones.controller.js` | 2 |

## 5. `RETURNING` (→ `result.lastInsertRowid` o SELECT posterior dentro de la misma tx)

Archivos con usos: `clientes.controller.js` (3), `caja.controller.js` (1), `devoluciones.controller.js` (2),
`usuarios.routes.js` (3), `ventas.controller.js` (2), `casheaService.js` (1), `productos.controller.js` (3),
`cuentasPagarService.js` (2), `importProductosService.js` (2), `inventario.controller.js` (1),
`cotizacionesService.js` (2), `proveedores.controller.js` (3), `compras.routes.js` (1), `setupAdminService.js` (1).
Total: **27 usos**.

Nota SQLite ≥ 3.35 soporta `RETURNING`, pero better-sqlite3 lo expone vía `.get()/.all()`, no `.run()`.
Convención adoptada: usar `lastInsertRowid` para INSERT y re-SELECT cuando se necesita la fila completa.

## 6. Triggers y funciones plpgsql en `database/migrations/` (lógica → controllers en Fase 3)

| Migración | Objeto | Qué hace | Dónde irá la lógica |
|---|---|---|---|
| `001_initial_schema.sql` (342-471) | `actualizar_stock_venta()` + `trg_stock_en_venta` | descuenta stock al insertar `detalles_ventas` | `ventas.controller.create()` dentro de `transaction()` |
| `001_initial_schema.sql` | `calcular_costo_promedio()` + `trg_costo_promedio_compra` | recalcula costo promedio al recibir compra | `compras.routes.js` handler recibir |
| `007/011/035` | `registrar_historial_tasa()` + `trg_historial_tasas` | INSERT en `historial_tasas` al cambiar tasa en `configuracion` | `preciosService.js` / `configuracion.controller.js` al guardar tasa |
| `019_stock_constraints.sql` (30-77) | `actualizar_stock_venta()` v2 | versión con validación stock ≥ 0 | misma que 001, con CHECK en schema SQLite |
| `020_sesiones_huerfanas.sql` (19-34) | `cerrar_sesiones_huerfanas(horas)` | cierra sesiones de caja viejas | helper JS llamado al abrir caja / arranque |

## 7. Secuencias PG

| Migración | Secuencia | Conversión |
|---|---|---|
| `016_credito_sequence_cuentas_cobrar.sql` | `ventas_numero_seq` (numeración correlativa de ventas) | tabla contador o `MAX(numero)` dentro de `transaction()` |
| `044_cotizaciones.sql` (49) | `cotizaciones_seq` (`COT-YYYY-NNNNN`) | `MAX(id)+1` en JS dentro de `transaction()` |

## 8. Tipos en migraciones (consolidación schema Fase 2)

- `SERIAL/BIGSERIAL`: en todas las tablas (001, 007, 012, 017, 039, 043, 044) → `INTEGER PRIMARY KEY AUTOINCREMENT`
- `JSONB`: `ventas.pagos`, `ventas_suspendidas.items`, `usuarios.permisos_override` (025),
  `roles.permisos` (009), `auditoria.datos_antes/datos_despues`, `cashea_config`,
  `cotizaciones.items_snapshot` (044) → `TEXT` con JSON.parse/stringify
- `BOOLEAN`: `productos.activo`, `usuarios.activo`, `configuracion.*_activo`, etc. → `INTEGER 0/1`
- `TIMESTAMP/TIMESTAMPTZ`: `created_at`, `updated_at`, `fecha_*` → `TEXT` ISO-8601
- `NUMERIC(x,y)`: montos → SQLite los almacena como REAL/TEXT según afinidad; se mantiene
  `NUMERIC` en el DDL (afinidad NUMERIC) y se redondea en JS donde aplica
- `ON CONFLICT`: soportado igual en SQLite (upserts de configuracion)
- `NOW()` / `CURRENT_TIMESTAMP`: → `datetime('now')` o ISO string desde JS (se usará
  `new Date().toISOString()` para consistencia con TEXT)
