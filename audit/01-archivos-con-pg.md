# Auditoría 0.2 — Archivos del backend que usan pg-promise

Fecha: 2026-06-10 — Rama: `migration/sqlite`

Método: búsqueda con ripgrep sobre `backend/` de los patrones:
`require('./database')`, `require('../config/database')`, `db.one`, `db.oneOrNone`, `db.any`,
`db.many`, `db.manyOrNone`, `db.none`, `db.tx`, `db.task`, `db.result`, `db.query`, `pg-promise`.
Se incluyen también las llamadas `t.*` / `tx.*` dentro de transacciones.

## Tabla por archivo (ordenada por volumen de llamadas)

| Archivo | one/oneOrNone | any/many | none | tx | otros (task/result/query) | TOTAL |
|---|---|---|---|---|---|---|
| `backend/config/migrations.js` | 39 | 2 | 19 | 16 | 15 | **91** |
| `backend/controllers/ventas.controller.js` | 25 | 8 | 10 | 2 | 1 | **46** |
| `backend/controllers/caja.controller.js` | 16 | 9 | 3 | 0 | 0 | **28** |
| `backend/controllers/devoluciones.controller.js` | 12 | 2 | 4 | 2 | 0 | **20** |
| `backend/services/pdfService.js` | 15 | 4 | 0 | 0 | 0 | **19** |
| `backend/services/setupAdminService.js` | 8 | 0 | 7 | 3 | 0 | **18** |
| `backend/routes/compras.routes.js` (handlers inline) | 7 | 3 | 6 | 2 | 0 | **18** |
| `backend/controllers/clientes.controller.js` | 8 | 5 | 3 | 1 | 0 | **17** |
| `backend/services/cuentasPagarService.js` | 7 | 4 | 4 | 2 | 0 | **17** |
| `backend/routes/usuarios.routes.js` (handlers inline) | 9 | 3 | 5 | 0 | 0 | **17** |
| `backend/controllers/cartera.controller.js` | 4 | 6 | 4 | 1 | 0 | **15** |
| `backend/services/reportesService.js` | 0 | 15 | 0 | 0 | 0 | **15** |
| `backend/controllers/reportes.controller.js` | 11 | 3 | 0 | 0 | 0 | **14** |
| `backend/controllers/configuracion.controller.js` | 1 | 1 | 6 | 6 | 0 | **14** |
| `backend/services/dashboardService.js` | 5 | 8 | 0 | 0 | 0 | **13** |
| `backend/services/casheaService.js` | 4 | 5 | 2 | 1 | 0 | **12** |
| `backend/services/cotizacionesService.js` | 7 | 3 | 1 | 1 | 0 | **12** |
| `backend/controllers/inventario.controller.js` | 4 | 4 | 2 | 1 | 1 | **12** |
| `backend/controllers/productos.controller.js` | 6 | 1 | 2 | 1 | 0 | **10** |
| `backend/services/preciosService.js` | 0 | 3 | 4 | 2 | 0 | **9** |
| `backend/services/importProductosService.js` | 2 | 2 | 0 | 4 | 0 | **8** |
| `backend/controllers/proveedores.controller.js` | 6 | 1 | 0 | 0 | 0 | **7** |
| `backend/services/excelService.js` | 0 | 6 | 0 | 0 | 0 | **6** |
| `backend/controllers/auth.controller.js` | 3 | 1 | 1 | 0 | 0 | **5** |
| `backend/services/impresionService.js` | 2 | 2 | 0 | 0 | 0 | **4** |
| `backend/services/licenciaService.js` | 2 | 0 | 1 | 1 | 0 | **4** |
| `backend/routes/dashboard.routes.js` (handlers inline) | 1 | 2 | 0 | 0 | 0 | **3** |
| `backend/middleware/audit.middleware.js` | 1 | 0 | 1 | 0 | 0 | **2** |
| `backend/middleware/cajaAbierta.middleware.js` | 2 | 0 | 0 | 0 | 0 | **2** |
| `backend/services/bcvTasaAutoService.js` | 0 | 1 | 1 | 0 | 0 | **2** |
| `backend/server.js` | 2 | 0 | 0 | 0 | 0 | **2** |
| `backend/services/backupScheduler.js` | 0 | 1 | 0 | 0 | 0 | **1** |
| `backend/services/modoMonedaService.js` | 1 | 0 | 0 | 0 | 0 | **1** |
| `backend/routes/licencia.routes.js` | 1 | 0 | 0 | 0 | 0 | **1** |
| `backend/services/creditoAbonoService.js` (recibe `t` de transacción externa) | 1 | 0 | 0 | 0 | 0 | **1** |
| `backend/utils/devolucionesSaldo.js` (recibe `t`; mención a pg-promise en docs) | 0 | 0 | 0 | 0 | 0 | (helper) |
| `backend/utils/pgDumpResolver.js` (utilidad pg_dump, no queries) | 0 | 0 | 0 | 0 | 0 | (infra PG) |

**Total aproximado de llamadas a BD a convertir: ~480**

## Archivos que importan `require('../config/database')` o `require('./database')` (27)

```
backend/server.js
backend/config/migrations.js
backend/middleware/cajaAbierta.middleware.js
backend/controllers/auth.controller.js
backend/controllers/caja.controller.js
backend/controllers/cartera.controller.js
backend/controllers/clientes.controller.js
backend/controllers/configuracion.controller.js
backend/controllers/devoluciones.controller.js
backend/controllers/inventario.controller.js
backend/controllers/productos.controller.js
backend/controllers/proveedores.controller.js
backend/controllers/reportes.controller.js
backend/controllers/ventas.controller.js
backend/routes/compras.routes.js
backend/routes/dashboard.routes.js
backend/routes/licencia.routes.js
backend/routes/pdf.routes.js
backend/routes/productos.routes.js
backend/routes/reportes.routes.js
backend/routes/setup.routes.js
backend/routes/usuarios.routes.js
backend/services/casheaService.js
backend/services/cotizacionesService.js
backend/services/cuentasPagarService.js
backend/services/impresionService.js
backend/services/syncService.js
```

Nota: varios services NO importan la BD directamente sino que reciben `db`/`t` por parámetro
(`dashboardService`, `reportesService`, `excelService`, `preciosService`, `setupAdminService`,
`creditoAbonoService`, `devolucionesSaldo`, `licenciaService`, `modoMonedaService`,
`bcvTasaAutoService`, `importProductosService`, `pdfService`, `audit.middleware`) — hay que
revisar cada firma al convertir.

## Archivos con mención directa a `pg-promise` (14)

```
backend/config/database.js          ← el adaptador PG actual (se mantiene hasta Fase 4)
backend/services/setupAdminService.js
backend/services/syncService.js     ← usa pg_dump para respaldos
backend/services/importProductosService.js
backend/services/casheaService.js
backend/services/preciosService.js
backend/utils/devolucionesSaldo.js
backend/middleware/audit.middleware.js
backend/services/modoMonedaService.js
backend/services/cuentasPagarService.js
backend/controllers/ventas.controller.js
backend/services/pdfService.js
backend/utils/pgDumpResolver.js     ← localiza el binario pg_dump (Fase 4.3: stub)
backend/controllers/configuracion.controller.js
```

## Observaciones

- `backend/config/migrations.js` es el archivo con más llamadas (91) pero NO se convierte
  línea a línea: en Fase 3C.6 se bifurca con el feature flag hacia `migrations.sqlite.js`.
- `backend/utils/ventaTotalesBcv.js` no contiene llamadas db directas (helper puro que recibe
  filas); la tarea 3B.1 verificará su firma.
- `backend/routes/usuarios.routes.js`, `compras.routes.js` y `dashboard.routes.js` tienen los
  handlers inline en la ruta (no hay controller separado).
- `backend/services/alertasService.js` e `inventarioService.js` no aparecieron en los greps
  de llamadas db directas; reciben datos ya consultados o usan helpers.
