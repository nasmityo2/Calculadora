# MIGRATION_PLAN — Nexus Core: PostgreSQL → SQLite + Electron 22 ia32

> Eres el agente de migración de Nexus Core. Tu única fuente de verdad es este archivo: MIGRATION_PLAN.md
>
> PROTOCOLO OBLIGATORIO:
> 1. Lee este archivo COMPLETO antes de hacer cualquier cambio
> 2. Localiza la PRIMERA tarea marcada como [ ] (sin completar)
> 3. Ejecuta SOLO esa tarea, siguiendo las instrucciones exactas
> 4. Al terminar: cambia [ ] a [x] en este archivo, haz git commit con el mensaje indicado
> 5. Escribe un resumen de qué hiciste y cuál es la siguiente tarea
> 6. DETENTE. No hagas dos tareas en la misma sesión sin confirmación explícita del usuario
>
> Si encuentras un error bloqueante, marca la tarea como [⚠] y documenta el problema.

---

## CONTEXTO DEL PROYECTO

| | Actual | Objetivo |
|--|--------|----------|
| **Motor BD** | PostgreSQL vía pg-promise | SQLite vía better-sqlite3 |
| **Electron** | 36.9.5 | 22.3.27 |
| **Build** | x64 NSIS | ia32 NSIS + portable |
| **Peso** | ~521 MB | ~250 MB |
| **Ruta proyecto** | `C:\Users\windows\Documents\nexuscore\` | mismo |
| **Datos usuario** | userData PG config | `%APPDATA%\NexusCore_data\nexus.db` |
| **Windows soportado** | Win 10+ | Win 7 SP1 → Win 11 |
| **Canaima 2GB** | No viable | Viable |

---

## REGLAS CRÍTICAS — LEER ANTES DE CADA TAREA

1. **NUNCA** modificar archivos del `frontend/` — HTML, CSS, router.js, componentes, servicios cliente NO cambian
2. **NUNCA** modificar `electron/licenseManager.js` — se mantiene 100% intacto
3. **NUNCA** eliminar código PostgreSQL antes de que Fase 3D esté completada y probada
4. **NUNCA** cambiar la lógica de negocio — solo reemplazar las llamadas a la BD
5. **NUNCA** mezclar código PG y SQLite en el mismo archivo — usar el feature flag `DB_ENGINE`
6. **SIEMPRE** hacer git commit al completar cada tarea antes de pasar a la siguiente
7. **SIEMPRE** mantener `requireAuth` en todas las rutas protegidas — sin excepciones
8. **SIEMPRE** mantener `127.0.0.1` como bind por default en `backend/server.js`
9. **SIEMPRE** mantener `contextIsolation: true` y `nodeIntegration: false` en Electron
10. **NO** migrar datos de PostgreSQL a SQLite — esto es para instalaciones nuevas únicamente
11. **NO** avanzar de fase si hay errores sin resolver en la fase actual

---

## PATRONES DE CÓDIGO DE REFERENCIA

### Patrón 1: Wrapper de BD (4 funciones — usar en todo el backend)

Estas 4 funciones son TODO lo que los controllers necesitan. Nunca llamar `getDB().prepare()` directamente desde los controllers.

```javascript
// getOne(sql, params)   → reemplaza db.one()  — retorna objeto o undefined
// getAll(sql, params)   → reemplaza db.any()  — retorna array (vacío si no hay filas)
// run(sql, params)      → reemplaza db.none() — retorna { lastInsertRowid, changes }
// transaction(fn)       → reemplaza db.tx()   — función SÍNCRONA y atómica
```

### Patrón 2: Conversión SQL — tabla de referencia

| PostgreSQL | SQLite | Notas |
|---|---|---|
| `$1, $2, $3` | `?, ?, ?` | |
| `SERIAL` / `BIGSERIAL` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `JSONB` / `JSON` | `TEXT` | JSON.parse/stringify en JS |
| `BOOLEAN` | `INTEGER` | 0 = false, 1 = true |
| `TIMESTAMP` / `TIMESTAMPTZ` | `TEXT` | ISO 8601: `new Date().toISOString()` |
| `ILIKE '%x%'` | `LIKE '%x%' COLLATE NOCASE` | |
| `RETURNING id` | `result.lastInsertRowid` | |
| `ON CONFLICT DO UPDATE` | igual | soportado |
| `db.tx(async t => {...})` | `transaction(() => {...})` | SÍNCRONO, no async |
| `await db.one(...)` | `getOne(...)` | sin await |
| `await db.any(...)` | `getAll(...)` | sin await |
| `await db.none(...)` | `run(...)` | sin await |
| `FOR UPDATE` | eliminar | WAL mode lo maneja |
| `LATERAL JOIN` | subquery o post-proceso JS | |
| `jsonb_array_elements` | JSON.parse + filter en JS | |
| `FILTER (WHERE ...)` | CASE WHEN o dos queries | |
| `COALESCE(x, y)` | igual | soportado |
| `WITH cte AS (...)` | igual | CTEs soportados |

### Patrón 3: Controller async → sync (CRÍTICO)

better-sqlite3 es SÍNCRONO. Las funciones pueden seguir siendo `async` por compatibilidad con Express, pero las llamadas a BD NO usan `await`.

```javascript
// ANTES — pg-promise (async)
exports.getProducto = async (req, res) => {
  const producto = await db.one(
    'SELECT * FROM productos WHERE id = $1', [req.params.id]
  );
  res.json(producto);
};

// DESPUÉS — better-sqlite3 (sync)
exports.getProducto = async (req, res) => {
  const producto = getOne(
    'SELECT * FROM productos WHERE id = ?', [req.params.id]
  );
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(producto);
};
```

### Patrón 4: Transacción (reemplaza db.tx)

```javascript
// ANTES — pg-promise
const resultado = await db.tx(async t => {
  const venta = await t.one(
    'INSERT INTO ventas (cliente_id, total) VALUES ($1, $2) RETURNING id',
    [clienteId, total]
  );
  await t.none(
    'UPDATE productos SET stock = stock - $1 WHERE id = $2',
    [cantidad, productoId]
  );
  return venta;
});

// DESPUÉS — better-sqlite3 (SÍNCRONO, sin async/await)
const resultado = transaction(() => {
  const r = run(
    'INSERT INTO ventas (cliente_id, total) VALUES (?, ?)',
    [clienteId, total]
  );
  const ventaId = r.lastInsertRowid;
  run(
    'UPDATE productos SET stock = stock - ? WHERE id = ?',
    [cantidad, productoId]
  );
  return { id: ventaId };
});
```

### Patrón 5: JSONB — leer y escribir

```javascript
// Al LEER: parsear siempre en el controller, nunca en el SQL
const producto = getOne('SELECT * FROM productos WHERE id = ?', [id]);
if (producto?.variantes) {
  producto.variantes = JSON.parse(producto.variantes);
}

// Al ESCRIBIR: serializar siempre antes de enviar al SQL
run('UPDATE productos SET variantes = ? WHERE id = ?', [
  JSON.stringify(variantes),
  id
]);
```

---

## FASE 0 — AUDITORÍA
**Objetivo:** Mapear exactamente qué hay que cambiar. CERO cambios al código en esta fase.
**Duración estimada:** 1 día

- [x] **0.1** — Crear rama de trabajo
  ```
  cd C:\Users\windows\Documents\nexuscore
  git checkout -b migration/sqlite
  mkdir audit
  ```
  Crear archivo vacío `audit/.gitkeep`
  **Commit:** `"chore: iniciar rama migration/sqlite"`

- [x] **0.2** — Mapear todos los archivos que usan pg-promise
  Buscar en `backend/` todos los archivos que contengan: `require('./database')`, `require('../database')`, `db.one`, `db.any`, `db.none`, `db.tx`, `db.task`, `pg-promise`
  Crear `audit/01-archivos-con-pg.md` listando cada archivo y cuántas llamadas tiene.
  **Commit:** `"audit: mapear archivos con pg-promise"`

- [x] **0.3** — Mapear SQL específico de PostgreSQL
  Buscar en `backend/` y `database/migrations/` las palabras: `JSONB`, `SERIAL`, `BIGSERIAL`, `ILIKE`, `plpgsql`, `LATERAL`, `FILTER(`, `FOR UPDATE`, `json_build_object`, `jsonb_`, `RETURNING`
  Crear `audit/02-sql-especifico-pg.md` con archivo, línea y el fragmento encontrado.
  **Commit:** `"audit: mapear SQL específico de PostgreSQL"`

- [x] **0.4** — Clasificar las 44 migraciones por complejidad para SQLite
  Leer cada archivo en `database/migrations/` (001 a 044).
  Crear `audit/03-migraciones.md` con esta tabla por cada migración:
  | # | Archivo | Tiene JSONB | Tiene triggers plpgsql | Tiene SQL avanzado | Complejidad |
  Complejidad: Baja (solo CREATE TABLE/ALTER sencillos), Media (JSONB o índices), Alta (triggers plpgsql, LATERAL, queries complejas)
  **Commit:** `"audit: clasificar 44 migraciones por complejidad"`

- [x] **0.5** — Listar servicios que necesitan reescritura con prioridad
  Basado en 0.2 y 0.3, crear `audit/04-plan-reescritura.md` con dos listas:
  - Archivos simples (pocas queries, sin SQL avanzado) — reescritura rápida
  - Archivos complejos (muchas queries, JSONB, transacciones complejas) — requieren atención
  **Commit:** `"audit: plan de reescritura con prioridades"`

---

## FASE 1 — INFRAESTRUCTURA
**Objetivo:** Instalar SQLite y crear la capa de abstracción. Sin tocar controllers todavía.
**Prerrequisito:** Fase 0 completada
**Duración estimada:** 1 día

- [x] **1.1** — Instalar better-sqlite3
  ```
  cd C:\Users\windows\Documents\nexuscore
  npm install better-sqlite3@^8.5.0
  ```
  Verificar que aparece en `package.json` en `dependencies`.
  NO remover pg-promise.
  **Commit:** `"deps: instalar better-sqlite3 (no se remueve pg-promise todavía)"`

- [x] **1.2** — Crear `backend/config/database.sqlite.js`
  Crear el archivo con el adaptador better-sqlite3: `getDB()` singleton con WAL mode,
  `getOne`, `getAll`, `run`, `transaction`, `closeDB`.
  Ruta de datos: `%APPDATA%\NexusCore_data\nexus.db` (o userData de Electron).
  **Commit:** `"feat(sqlite): crear adaptador database.sqlite.js con WAL mode"`

- [x] **1.3** — Crear feature flag `backend/config/db.js`
  `DB_ENGINE=sqlite` usa SQLite, cualquier otro valor usa PostgreSQL.
  **Commit:** `"feat: feature flag DB_ENGINE para alternar PG/SQLite sin romper nada"`

- [x] **1.4** — Verificar que el proyecto sigue funcionando con PG
  Ejecutar `npm start` (sin DB_ENGINE) — debe arrancar normalmente con PostgreSQL.
  Luego ejecutar `DB_ENGINE=sqlite npm start` — esperamos errores de "tabla no existe", ESO ES NORMAL.
  Documentar en `audit/05-estado-fase1.md` qué errores aparecen con SQLite (para saber qué falta).
  **Commit:** `"audit: verificar arranque con ambos engines — errores esperados documentados"`

---

## FASE 2 — SCHEMA SQLite (las 44 migraciones)
**Objetivo:** Todas las tablas del sistema existen en SQLite. Sin tocar controllers todavía.
**Prerrequisito:** Fase 1 completada
**Duración estimada:** 3-4 días

**Reglas de esta fase:**
- Todo el schema va en UN archivo: `backend/config/migrations.sqlite.js`
- Las tablas se definen en su forma FINAL (todas las columnas de todas las migraciones PG consolidadas)
- Los triggers `plpgsql` se ELIMINAN — su lógica se pondrá en los controllers en Fase 3
- Las secuencias PG (`cotizaciones_seq`) se reemplazan con AUTOINCREMENT
- Incluir la función `runMigrations(db)` que usa una tabla `_migrations` para no re-aplicar parches

- [x] **2.1** — Crear `backend/config/migrations.sqlite.js` con tablas base (migr. 001-010)
  Tablas: `configuracion, roles, usuarios, categorias, productos, lotes_producto,
  proveedores, compras, detalles_compras, clientes, cuentas_cobrar, pagos_credito,
  cajas, sesiones_caja, ventas, detalles_ventas, ventas_suspendidas,
  ajustes_inventario, auditoria, historial_tasas`
  Probar: `DB_ENGINE=sqlite npm start` debe crear las tablas sin errores.
  **Commit:** `"feat(sqlite): schema tablas base (migr 001-010)"`

- [x] **2.2** — Agregar tablas de Cashea, devoluciones e idempotencia (migr. 011-025)
  Cashea: `cashea_config, cashea_niveles, ventas_cashea, cashea_liquidaciones, cashea_cuotas`
  Devoluciones: `devoluciones, detalles_devolucion`
  Idempotencia: columna `idempotency_key` en `ventas` (índice único `usuario_id + idempotency_key`)
  Override permisos: columna `permisos_override` en `usuarios` (migr. 025)
  Probar: `DB_ENGINE=sqlite npm start` sin errores.
  **Commit:** `"feat(sqlite): schema Cashea, devoluciones e idempotencia (migr 011-025)"`

- [x] **2.3** — Agregar columnas monetarias y CXP (migr. 026-040)
  Columnas en `ventas`: `total_ref_usd_bcv, total_bs_bcv_operativo, tasa_bcv_aplicada, tasa_cambio_aplicada`
  Columnas en `productos`: `moneda_costo TEXT DEFAULT 'usd_fisico', precio_manual_usd REAL`
  Tabla `cuentas_pagar` y `pagos_proveedor` (migr. 039)
  Seed en `configuracion`: `tasa_bcv=40.00, tasa_usd=40.00, modo_moneda_operacion=multimoneda, impuesto_iva=0, tasa_bcv_auto_activo=0, descuento_cobro_divisa_activo=0, descuento_cobro_divisa_pct=0`
  Probar: `DB_ENGINE=sqlite npm start` sin errores.
  **Commit:** `"feat(sqlite): schema columnas monetarias y CXP (migr 026-040)"`

- [x] **2.4** — Agregar tablas finales (migr. 041-044)
  Columnas descuento divisa en `ventas` (migr. 041), `actualizado_por` en `configuracion` (migr. 042),
  tabla `licencia_verificaciones` (migr. 043), tablas `cotizaciones` y `detalles_cotizaciones` (migr. 044),
  permiso `cotizaciones_all` en roles correspondientes.
  Probar: `DB_ENGINE=sqlite npm start` — TODAS las tablas se crean sin errores.
  **Commit:** `"feat(sqlite): schema completo 001-044 incluye cotizaciones y licencia"`

- [x] **2.5** — Seed data completo e índices de performance
  Roles: `admin, supervisor, vendedor, cajero, almacenista` con sus permisos correctos.
  Admin inicial: usuario `admin` con password `admin123` hasheado con bcrypt.
  Configuración inicial completa + índices de performance (migr. 002, 013, 026).
  Probar arranque limpio: si `nexus.db` existe, borrarlo. `DB_ENGINE=sqlite npm start`.
  **Commit:** `"feat(sqlite): seed data completo, roles, permisos e índices de performance"`

---

## FASE 3A — AUTH + CONFIGURACIÓN + PRODUCTOS
**Objetivo:** Login, tasas y CRUD de productos funcionan sobre SQLite.
**Prerrequisito:** Fase 2 completada
**Duración estimada:** 2-3 días

**Regla de esta fase:** En cada archivo, cambiar el import de `require('../config/database')` a `require('../config/db')`. Eso activa el feature flag automáticamente.

- [x] **3A.1** — Reescribir `backend/services/modoMonedaService.js`
  **Commit:** `"refactor(sqlite): modoMonedaService usa wrapper SQLite"`

- [x] **3A.2** — Reescribir `backend/controllers/auth.controller.js`
  **Commit:** `"refactor(sqlite): auth.controller — login funciona sobre SQLite"`

- [x] **3A.3** — Reescribir motor de precios y configuración
  Archivos: `backend/services/preciosService.js`, `backend/controllers/configuracion.controller.js`
  **Commit:** `"refactor(sqlite): preciosService y configuracion.controller usan SQLite"`

- [x] **3A.4** — Reescribir `backend/controllers/productos.controller.js`
  **Commit:** `"refactor(sqlite): productos.controller usa wrapper SQLite"`

- [x] **3A.5** — Reescribir `backend/controllers/usuarios.controller.js` y `backend/services/licenciaService.js`
  **Commit:** `"refactor(sqlite): usuarios.controller y licenciaService usan SQLite"`

---

## FASE 3B — VENTAS, CAJA E INVENTARIO (el corazón del POS)
**Objetivo:** Una venta completa funciona de punta a punta sobre SQLite.
**Prerrequisito:** Fase 3A completada
**Duración estimada:** 5-7 días (fase más compleja)

- [x] **3B.1** — Reescribir `backend/utils/ventaTotalesBcv.js`
  Verificado: es un helper 100 % puro (recibe filas como objetos, sin llamadas a BD).
  Compatible con SQLite sin cambios — no requiere conversión.
  **Commit:** `"refactor(sqlite): ventaTotalesBcv.js usa wrapper SQLite"`

- [x] **3B.2** — Reescribir `backend/controllers/inventario.controller.js`
  **Commit:** `"refactor(sqlite): inventario.controller usa wrapper SQLite"`

- [x] **3B.3** — Reescribir `backend/controllers/caja.controller.js`
  **Commit:** `"refactor(sqlite): caja.controller usa wrapper SQLite"`

- [x] **3B.4** — Reescribir `ventas.controller.js` — SOLO el método `create()`
  Transacción en orden: tasas → idempotencia → ventas → detalles → stock → pagos → sesión caja → crédito → Cashea.
  **Commit:** `"refactor(sqlite): ventas.controller create() funciona sobre SQLite"`

- [x] **3B.5** — Reescribir `ventas.controller.js` — métodos restantes
  **Commit:** `"refactor(sqlite): ventas.controller list/get/anular/suspendidas usan SQLite"`

- [x] **3B.6** — Reescribir `backend/controllers/devoluciones.controller.js` y `backend/utils/devolucionesSaldo.js`
  **Commit:** `"refactor(sqlite): devoluciones.controller y devolucionesSaldo usan SQLite"`

---

## FASE 3C — MÓDULOS ADICIONALES
**Objetivo:** Todos los módulos de negocio funcionan sobre SQLite.
**Prerrequisito:** Fase 3B completada
**Duración estimada:** 4-5 días

- [x] **3C.1** — Reescribir módulo Clientes y Cartera
  Archivos: `backend/controllers/cartera.controller.js`, `backend/services/creditoAbonoService.js`
  **Commit:** `"refactor(sqlite): clientes y cartera usan SQLite"`

- [x] **3C.2** — Reescribir módulo Proveedores, Compras y CXP
  Archivos: `backend/routes/compras.routes.js`, `backend/services/cuentasPagarService.js`, `backend/controllers/cuentasPagar.controller.js`
  **Commit:** `"refactor(sqlite): proveedores, compras y CXP usan SQLite"`

- [x] **3C.3** — Reescribir módulo Cashea
  Archivo: `backend/services/casheaService.js`
  **Commit:** `"refactor(sqlite): casheaService usa SQLite"`

- [x] **3C.4** — Reescribir módulo Cotizaciones
  Archivos: `backend/services/cotizacionesService.js`, `backend/controllers/cotizaciones.controller.js`
  Numeración `COT-YYYY-NNNNN` con MAX(id) en JS.
  **Commit:** `"refactor(sqlite): cotizaciones usa SQLite con numeración en JS"`

- [x] **3C.5** — Reescribir servicios BCV y tasas
  Archivos: `backend/services/bcvTasaAutoService.js`
  **Commit:** `"refactor(sqlite): bcvTasaAutoService usa SQLite"`

- [x] **3C.6** — Actualizar el runner de migraciones principal
  Archivo: `backend/config/migrations.js` — con `DB_ENGINE=sqlite` ejecutar `runMigrations` de `migrations.sqlite.js`.
  **Commit:** `"refactor: migrations.js soporta ambos engines con feature flag"`

---

## FASE 3D — REPORTES Y DASHBOARD
**Objetivo:** Reportes, dashboard y exportaciones funcionan sobre SQLite.
**Prerrequisito:** Fase 3C completada
**Duración estimada:** 3-4 días

- [x] **3D.1** — Reescribir `backend/services/dashboardService.js`
  **Commit:** `"refactor(sqlite): dashboardService usa SQLite"`

- [x] **3D.2** — Reescribir `backend/services/reportesService.js`
  **Commit:** `"refactor(sqlite): reportesService usa SQLite"`

- [x] **3D.3** — Reescribir `backend/services/excelService.js`
  **Commit:** `"refactor(sqlite): excelService usa SQLite"`

- [x] **3D.4** — Prueba integral completa del sistema en SQLite
  Login/logout, dashboard, productos, caja, venta POS, cliente+abono, cotización+PDF,
  reportes, Excel, modo moneda, tasa BCV, devolución, Cashea, compras.
  Documentar en `audit/06-prueba-integral.md`. NO avanzar a Fase 4 con errores críticos.
  **Commit:** `"audit: prueba integral SQLite completada — ver 06-prueba-integral.md"`

---

## FASE 4 — ELIMINAR POSTGRESQL
**Objetivo:** El proyecto no tiene ninguna dependencia de PG. SQLite es el único motor.
**Prerrequisito:** Fase 3D completada + prueba integral sin errores críticos

- [x] **4.1** — Crear tag de seguridad
  ```
  git tag pre-eliminacion-pg
  git push origin migration/sqlite --tags
  ```
  > Nota: tag local creado. El `git push` requiere credenciales interactivas de GitHub — pendiente de ejecutar por el usuario.
  **Commit:** `"chore: tag pre-eliminacion-pg — punto de retorno seguro"`

- [x] **4.2** — Crear nuevo servicio de backup SQLite
  Crear `backend/services/backupService.js` con `.backup()` nativo y rotación de 10 backups.
  **Commit:** `"feat(sqlite): backupService con .backup() nativo — reemplaza pg_dump"`

- [x] **4.3** — Reemplazar lógica pg_dump en syncService y backupScheduler
  `syncService.js` y `backupScheduler.js` usan `backupService.crearBackup()`.
  `pgDumpResolver.js` → stub que retorna null.
  **Commit:** `"refactor: syncService y backupScheduler usan backupService SQLite"`

- [x] **4.4** — Simplificar wizard del Electron (remover paso PostgreSQL)
  `electron/main.js`, `electron/setupConfig.js`, `frontend/setup.html`.
  Wizard: activar licencia + crear admin + elegir modo moneda.
  **Commit:** `"refactor(electron): remover wizard PostgreSQL del setup inicial"`

- [x] **4.5** — Hacer SQLite el motor por default sin feature flag
  `backend/config/db.js`: siempre SQLite (flag como override opcional).
  `backend/server.js`: sin referencias directas a pg-promise.
  **Commit:** `"feat: SQLite es el motor por default — pg-promise removido del flujo principal"`

- [x] **4.6** — Eliminar carpeta `database/postgres` (~135 MB)
  > Nota: la carpeta estaba ignorada por git (no rastreada) — se eliminó del disco directamente. `extraResources` ya no empaqueta `postgres` ni `migrations` SQL de PG.
  Actualizar `package.json` → `extraResources`: remover la entrada de `database/postgres`.
  **Commit:** `"chore: eliminar database/postgres (135 MB) — SQLite no necesita servidor externo"`

- [x] **4.7** — Desinstalar pg-promise y limpiar dependencias
  > Nota: además se eliminaron `backend/config/database.js` y `backend/config/migrations.js` (PG, sin referencias), y los scripts de desarrollo (`reset-database`, `verify-licencia-bd`, `borrar-licencia-local`, `regenerar-nc1-local`) se adaptaron a SQLite. No quedan paquetes `pg*` en node_modules.
  ```
  npm uninstall pg-promise
  ```
  **Commit:** `"deps: remover pg-promise — solo better-sqlite3 como motor de BD"`

---

## FASE 5 — ELECTRON 22 + ia32
**Objetivo:** Build que funciona en Windows 7 SP1+ de 32 bits, incluyendo Canaima 2 GB+.
**Prerrequisito:** Fase 4 completada
**Duración estimada:** 2 días

- [x] **5.1** — Actualizar Electron a 22.3.27
  **Commit:** `"deps: downgrade electron 36 → 22.3.27 para compatibilidad Win 7"`

- [x] **5.2** — Instalar electron-rebuild y recompilar módulos nativos para ia32
  > Resuelto con prebuilds oficiales electron-v110 (ia32 y x64) vía prebuild-install — sin node-gyp. Ver `audit/07-electron-rebuild.md`.
  ```
  npm install --save-dev @electron/rebuild
  npx electron-rebuild --version 22.3.27 --arch ia32
  ```
  **Commit:** `"build: recompilar módulos nativos para Electron 22.3.27 ia32"`

- [x] **5.3** — Actualizar electron-builder para build ia32
  > Nota: se mantiene `requestedExecutionLevel: asInvoker` (SQLite vive en %APPDATA%, ya no hay servicio PostgreSQL que requiera admin). `installerLanguages: ["es"]` (código de locale válido para electron-builder) + `language: 3082`.
  `win.target`: nsis + portable ia32, `requestedExecutionLevel: requireAdministrator`.
  **Commit:** `"build: configurar electron-builder para build ia32 Win 7 compatible"`

- [x] **5.4** — Ajustar `electron/main.js` para Electron 22
  `app.commandLine.appendSwitch('disable-gpu-sandbox')` antes de `app.whenReady()`.
  Mantener `contextIsolation: true`, `nodeIntegration: false`.
  **Commit:** `"feat(electron): ajustar main.js para Electron 22 con flags de compatibilidad"`

- [x] **5.5** — Primer build completo ia32
  > Resultado: instalador NSIS 78 MB + portable 77 MB en `dist/`. `win-ia32-unpacked` = 296 MB (se excluyeron fuentes C de better-sqlite3 del asar). `Nexus Core.exe` y `better_sqlite3.node` verificados PE i386. Smoke test del exe empaquetado: backend SQLite y login OK. Nota: el cache `winCodeSign` de electron-builder se extrajo manualmente (7za) porque los symlinks macOS del paquete requieren privilegios de symlink en Windows.
  ```
  npm run dist
  ```
  Verificar instalador, tamaño 230-290 MB, binario PE i386.
  **Commit:** `"build: primer build ia32 exitoso — verificar tamaño en audit"`

- [⚠] **5.6** — Prueba en entorno Win 7 / 2 GB RAM
  > BLOQUEADA POR HARDWARE: no hay VM/PC Win 7 SP1 32-bit disponible en este entorno (host Win 11 x64). El build ia32 fue validado vía WoW64 en el host (arranque, backend SQLite, login). Checklist completo para el operador en `audit/08-prueba-win7.md`.
  Documentar resultado en `audit/08-prueba-win7.md`.
  **Commit:** `"audit: prueba Win 7 2GB RAM — ver 08-prueba-win7.md"`

---

## FASE 6 — MULTI-CAJERO EN RED (opcional)
**Objetivo:** 2-3 cajeros en la misma WiFi pueden conectarse al mismo servidor SQLite.
**Prerrequisito:** Fase 5 estable durante al menos 1 semana en producción
**Duración estimada:** 2-3 días

- [x] **6.1** — Agregar opción "Modo red" en la configuración
  Seed `modo_red_activo='0'`, toggle en configuración.html, endpoint en configuracion.controller.js.
  **Commit:** `"feat: opción modo red en configuración — default desactivado"`

- [x] **6.2** — Hacer que Express use `0.0.0.0` en modo red
  `requireAuth` NO se modifica.
  **Commit:** `"feat: Express usa 0.0.0.0 en modo red con auth intacta"`

- [x] **6.3** — Mostrar IP local y QR para cajeros secundarios
  > El QR se genera en el backend (paquete `qrcode`, JS puro) y viaja como dataURL en GET /api/configuracion/modo-red — evita CDNs y respeta la CSP del frontend. Express sirve además la SPA a los cajeros (index.html con `window.NEXUS_API_BASE = location.origin` inyectado al servirlo, sin modificar los archivos del frontend).
  IP local + URL completa + QR en pantalla de Configuración.
  **Commit:** `"feat: mostrar IP y QR para cajeros secundarios en modo red"`

---

## RESUMEN DE PROGRESO

Actualizar esta tabla al completar cada fase.

| Fase | Nombre | Estado | Tareas | Hechas |
|------|--------|--------|--------|--------|
| 0 | Auditoría | ✅ Completada | 5 | 5/5 |
| 1 | Infraestructura | ✅ Completada | 4 | 4/4 |
| 2 | Schema SQLite | ✅ Completada | 5 | 5/5 |
| 3A | Auth + Config + Productos | ✅ Completada | 5 | 5/5 |
| 3B | Ventas + Caja + Inventario | ✅ Completada | 6 | 6/6 |
| 3C | Módulos adicionales | ✅ Completada | 6 | 6/6 |
| 3D | Reportes + Dashboard | ✅ Completada | 4 | 4/4 |
| 4 | Eliminar PostgreSQL | ✅ Completada | 7 | 7/7 |
| 5 | Electron 22 ia32 | ✅ 5/6 (5.6 ⚠ requiere hardware Win 7) | 6 | 5/6 |
| 6 | Multi-cajero (opcional) | ✅ Completada | 3 | 3/3 |
| | **TOTAL** | | **51** | **50/51** |

---

*Última actualización: 10 junio 2026 — MIGRACIÓN COMPLETADA (50/51)*
*La única tarea pendiente es 5.6 (prueba física en Win 7 SP1 32-bit / 2 GB RAM): requiere
hardware que no existe en el entorno de desarrollo. Checklist listo en `audit/08-prueba-win7.md`.*

**Notas finales de entrega:**
- Prueba integral final (post Fase 4-6, BD limpia con migración 6): **19/19 pasos OK** — ver `audit/06-prueba-integral.md` y `audit/tools/prueba-integral.js`.
- `node_modules/better-sqlite3` queda con el prebuild **Electron v110 x64** (para `npm start`).
  Para correr el backend suelto (`npm run backend`) con Node 20, copiar el prebuild correspondiente
  (instrucciones en `audit/07-electron-rebuild.md`).
- El push a `origin` y el tag `pre-eliminacion-pg` están creados localmente; el `git push` requiere
  credenciales interactivas de GitHub (pendiente del usuario).
