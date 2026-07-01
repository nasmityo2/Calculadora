# Auditoría 0.4 — Clasificación de migraciones PG por complejidad para SQLite

Fecha: 2026-06-10 — Rama: `migration/sqlite`

Nota: en `database/migrations/` NO existe el archivo `036_*.sql` (numeración salta de 035 a 037).
Total real: **43 archivos** (001–035, 037–044). El plan habla de "44 migraciones" contando el hueco.

| # | Archivo | JSONB | Triggers plpgsql | SQL avanzado | Complejidad | Notas para SQLite |
|---|---|---|---|---|---|---|
| 001 | `001_initial_schema.sql` | Sí (roles.permisos, ventas.pagos, ventas_suspendidas.items, auditoria) | Sí (2: stock venta, costo promedio) | Índice parcial WHERE | **Alta** | Tablas → forma final; triggers → lógica en controllers |
| 002 | `002_indexes.sql` | No | No | No (no-op, `SELECT 1`) | Baja | Ignorar |
| 003 | `003_triggers.sql` | No | No | No (no-op, `SELECT 1`) | Baja | Ignorar |
| 004 | `004_seed_data.sql` | No | No | ON CONFLICT | Baja | Seed caja + admin/admin123 (hash bcrypt incluido) |
| 005 | `005_rename_tasa_usd.sql` | No | No | No | Baja | UPDATE simple de clave |
| 006 | `006_simplify_productos_costo.sql` | No | No | DROP COLUMN IF EXISTS | Baja | Irrelevante: schema final ya no tiene esas columnas |
| 007 | `007_historial_tasas.sql` | No | Sí (registrar_historial_tasa + trigger) | ON CONFLICT DO UPDATE | **Alta** | Tabla historial_tasas; trigger → JS en preciosService |
| 008 | `008_caja_schema_upgrade.sql` | No | No | ALTER múltiple | Baja | Columnas van directo a forma final de sesiones_caja |
| 009 | `009_roles_perm_matrix.sql` | Sí (permisos jsonb) | No | jsonb merge | Media | Seed de permisos → JSON.stringify en seed JS |
| 010 | `010_tasas_edit_admin_only.sql` | Sí (`permisos \|\| jsonb`) | No | jsonb merge | Media | Merge va al seed JS final |
| 011 | `011_fix_trigger_historial_tasas_pg.sql` | No | Sí (replace trigger) | No | Media | Mismo trigger 007 — una sola lógica JS |
| 012 | `012_cashea_integration.sql` | Sí (merge permisos) | No | CHECK constraints | Media | 3 tablas Cashea forma final |
| 013 | `013_search_performance.sql` | No | No | pg_trgm GIN | Media | Sin equivalente directo; usar índices normales + LIKE COLLATE NOCASE |
| 014 | `014_ventas_iva_default_zero.sql` | No | No | ALTER DEFAULT | Baja | Default en schema final |
| 015 | `015_ventas_total_bs_cliente_desc_max.sql` | No | No | COMMENT | Baja | Columna total_bs_cliente + config venta_descuento_max_pct |
| 016 | `016_credito_sequence_cuentas_cobrar.sql` | No | No | SEQUENCE + DO $$ + regexp | **Alta** | ventas_numero_seq → MAX() en JS dentro de transaction() |
| 017 | `017_devoluciones.sql` | Sí (lineas) | No | CHECK | Media | Tabla devoluciones forma final |
| 018 | `018_cartera_missing_columns.sql` | No | No | UPDATE con JOIN | Baja | Columnas a forma final |
| 019 | `019_stock_constraints.sql` | No | Sí (trigger stock v2 con guarda) | DO $$ + NOT VALID | **Alta** | CHECK stock>=0 en schema; guarda STOCK_INSUFICIENTE → JS |
| 020 | `020_sesiones_huerfanas.sql` | No | Sí (función cerrar_sesiones_huerfanas) | UPDATE RETURNING en función | **Alta** | Función → helper JS al arrancar/abrir caja |
| 021 | `021_idempotency_ventas.sql` | No | No | Índice único parcial | Media | SQLite soporta índices parciales — igual |
| 022 | `022_anulacion_credito_reversa.sql` | No | No | DO $$ informativo | Baja | Solo índice cliente+estado |
| 023 | `023_roles_perm_dashboard_merge.sql` | Sí (merge `?` operador) | No | jsonb `?` | Media | Lógica al seed JS (merge de claves faltantes) |
| 024 | `024_fix_idempotency_index.sql` | No | No | Índice único parcial compuesto | Media | `(usuario_id, idempotency_key) WHERE NOT NULL` — igual en SQLite |
| 025 | `025_usuario_permisos_override.sql` | Sí (permisos_override) | No | No | Media | Columna TEXT default '{}' |
| 026 | `026_query_performance_indexes.sql` | No | No | Índice parcial | Baja | Índices directos |
| 027 | `027_cashea_niveles_y_config_express.sql` | No | No | DO $$ múltiples, RENAME, DROP CONSTRAINT dinámico | **Alta** | Solo forma final: columnas niveles semilla→araguaney |
| 028 | `028_moneda_costo_producto.sql` | No | No | CHECK | Baja | Columnas + CHECK en schema final |
| 029 | `029_ventas_total_ref_usd_bcv.sql` | No | No | COMMENT | Baja | Columna directa |
| 030 | `030_ventas_tasa_bcv_aplicada.sql` | No | No | COMMENT | Baja | Columna directa |
| 031 | `031_idempotency_ventas_indice_reconciliar.sql` | No | No | Índices | Baja | Ya cubierto por 024 |
| 032 | `032_ventas_cashea_pct_inicial_numeric.sql` | No | No | ALTER TYPE | Baja | pct_inicial NUMERIC en forma final |
| 033 | `033_cashea_tarifas_comision_oficial.sql` | No | No | CASE | Baja | UPDATE de seed — replicar en seed JS |
| 034 | `034_tasa_bcv_feriados_ve_2026.sql` | No | No | ON CONFLICT | Baja | Seed clave feriados |
| 035 | `035_nomenclatura_tasa_usd_sin_paralela.sql` | No | Sí (replace trigger) | No | Media | Versión final del trigger historial → JS |
| 037 | `037_total_bs_bcv_y_modo_moneda.sql` | No | No | UPDATE derivado | Baja | Columna + seed modo_moneda_operacion |
| 038 | `038_cashea_pct_inicial_semilla_60.sql` | No | No | No | Baja | Default 60.00 en forma final |
| 039 | `039_cuentas_pagar.sql` | No | No | DO $$, CHECKs, índices parciales | Media | 2 tablas forma final |
| 040 | `040_cuentas_pagar_permiso_roles.sql` | Sí (merge permisos) | No | Índice único parcial | Media | Permiso al seed; índice igual |
| 041 | `041_descuento_cobro_divisa.sql` | No | No | No | Baja | 2 claves config + 2 columnas ventas |
| 042 | `042_configuracion_actualizado_por.sql` | No | No | FK ON DELETE SET NULL | Baja | Columna directa |
| 043 | `043_licencia_profesional.sql` | No | No | BIGSERIAL | Baja | Tabla licencia_verificaciones |
| 044 | `044_cotizaciones.sql` | No | No | SEQUENCE + DO $$ | Media | 2 tablas + numeración COT en JS + permiso cotizaciones_all |

## Resumen

- **Alta (6):** 001, 007, 016, 019, 020, 027 — concentran triggers plpgsql y secuencias.
- **Media (13):** 009, 010, 011, 012, 013, 017, 021, 023, 024, 025, 035, 039, 040, 044 (14 contando 044).
- **Baja (resto):** cambios de columnas/seeds triviales que se absorben en la forma final.

## Decisiones de consolidación para `migrations.sqlite.js`

1. Las tablas se crean en su **forma final** (todas las columnas de 001+008+015+016+018+021+025+027+028+029+030+032+037+039+041+042 ya incluidas).
2. Los 3 triggers plpgsql (stock venta, costo promedio, historial tasas) **no se portan como triggers SQLite**: su lógica se implementa en los controllers/services dentro de `transaction()` (Fase 3), conforme al plan.
3. La función `cerrar_sesiones_huerfanas` se implementa como helper JS.
4. Secuencias: `ventas_numero_seq` y `cotizaciones_seq` → contador con `MAX()` dentro de `transaction()`.
5. `pg_trgm` GIN no existe en SQLite → índices B-tree normales sobre nombre/códigos; las búsquedas usan `LIKE ... COLLATE NOCASE` (los campos de búsqueda son cortos, rendimiento aceptable para POS local).
6. CHECK `stock_actual >= 0` se incluye directo en el CREATE TABLE de productos.
7. Seed de roles/permisos: el estado FINAL de la matriz (009+010+012+023+040+044) se construye en JS y se inserta una sola vez.
