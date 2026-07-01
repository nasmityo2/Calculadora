# Auditoría 1.4 — Estado del arranque con ambos engines (fin Fase 1)

Fecha: 2026-06-10 — Rama: `migration/sqlite`

## Entorno de pruebas de esta máquina

- Node.js del sistema: v24.16.0 (sin prebuild de better-sqlite3 8.x). Para el desarrollo de la
  migración se usa **Node 20.19.0 portable** (`%LOCALAPPDATA%\node20-portable`), con el que
  better-sqlite3 8.5.0 instala su binario precompilado `node-v115-win32-x64` sin compilador.
- **No hay Visual Studio Build Tools** en el equipo. No es bloqueante: better-sqlite3 8.x
  publica prebuilds para Electron 22 (ABI 110) en win32 **x64 e ia32** (verificado contra los
  assets del release v8.7.0/v8.5.0 en GitHub), que es el target de la Fase 5.
- **No hay servidor PostgreSQL en ejecución** en esta máquina (puerto 5432 cerrado, sin
  servicio Windows). `database/postgres/` es un bundle portable no inicializado.

## Resultado `node backend/server.js` (motor PG, sin DB_ENGINE)

```
warn: Intento de conexión a BD fallido connect ECONNREFUSED 127.0.0.1:5432 | attempt=1..5
```

El backend intenta conectar a PG con retry/backoff (comportamiento intacto, sin regresión:
ningún archivo del flujo PG fue modificado). El fallo es por ausencia de servidor PG local,
no por la migración.

## Resultado `DB_ENGINE=sqlite node backend/server.js`

```
warn: Intento de conexión a BD fallido connect ECONNREFUSED 127.0.0.1:5432 | attempt=1..5
```

**Idéntico al caso PG — esperado en esta fase:** `backend/server.js` todavía importa
`./config/database` (pg-promise) directamente y ejecuta `initDatabaseWithRetry()` + los
44 parches PG. El feature flag `backend/config/db.js` existe pero ningún consumidor lo usa aún.

## Qué falta para que el arranque SQLite funcione (se hace en Fase 2/3C.6)

1. `backend/server.js` debe bifurcar con `DB_ENGINE=sqlite`:
   - NO llamar `initDatabaseWithRetry()` de PG.
   - NO ejecutar los parches `runPatch00X` de PG.
   - Ejecutar `runMigrations(getDB())` de `backend/config/migrations.sqlite.js` (Fase 2.1).
   - Los endpoints `/health` y `/health/db` deben usar el wrapper.
2. `migrations.sqlite.js` con el schema completo (tareas 2.1–2.5).
3. Conversión progresiva de controllers/services (Fases 3A–3D).

## Verificación del adaptador SQLite (smoke test independiente)

`backend/config/database.sqlite.js` probado standalone: CREATE TABLE, INSERT con
`lastInsertRowid`, `getOne`, `transaction()` — todo OK con WAL activo en BD desechable.
