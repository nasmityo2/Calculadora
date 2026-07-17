# Estado de mejora DAYZO

Última actualización: 2026-07-17T08:03:00Z  
Rama: `improvement/dayzo-web-first-2026`  
Commit base: `0c2973ca428a9e9df9ba65d288a92e475bdcad55`  
Fase actual: 1 — Seguridad urgente

## Estados

- [ ] PENDIENTE
- [~] EN CURSO
- [x] COMPLETADO
- [!] BLOQUEADO

## Resumen de fases

- [x] Fase 0 — Baseline, respaldo y mapa
- [~] Fase 1 — Seguridad urgente
- [ ] Fase 2 — Cálculos canónicos
- [ ] Fase 3 — API/lista de cotizaciones
- [ ] Fase 4 — UX cotizaciones
- [ ] Fase 5 — Simulador
- [ ] Fase 6 — Login DAYZO
- [ ] Fase 7 — Tasas y frescura
- [ ] Fase 8 — Modularización/performance/CSP
- [ ] Fase 9 — VPS 1 GB
- [ ] Fase 10 — Cierre web
- [ ] Fase 11 — Mobile, después del gate web

## Fase 0 — Baseline, respaldo y mapa

- ID: F0-01 / rama y estado base
- Estado: [x] COMPLETADO
- Archivos: sin cambios funcionales.
- Evidencia: rama creada desde `0c2973c`; estado inicial `main...origin/main`; no se modificaron `calculadora.zip` ni el plan maestro sin seguimiento.
- Comandos: `git switch -c improvement/dayzo-web-first-2026`; `git status --short --branch`; `git log -1`.
- Resultado: rama aislada y base recuperable.
- Riesgo/rollback: ninguno; volver a `main` preserva el baseline.
- Pendiente siguiente: instalación desde lock.

- ID: F0-02 / lectura y mapa
- Estado: [x] COMPLETADO
- Archivos: `DAYZO_PLAN_MAESTRO_CURSOR_UNA_SESION_AUTONOMA.md`, `README.md`, `SETUP.md`, `ecosystem.config.cjs`, `package.json`, backend, web y archivos móviles relacionados.
- Evidencia: el archivo solicitado `DAYZO_AUDITORIA_PLAN_PROMPT_CURSOR.md` no existe; el plan maestro presente contiene la auditoría completa (título “Auditoría técnica, plan maestro…” y 616 líneas), por lo que se usó como fuente equivalente sin inventar otro documento.
- Comandos: búsquedas de archivos y lectura completa por bloques.
- Resultado: confirmados los hallazgos críticos del mandato.
- Riesgo/rollback: solo lectura.
- Pendiente siguiente: dependencias y checks.

- ID: F0-03 / instalación y checks iniciales
- Estado: [x] COMPLETADO
- Archivos: `package.json`, `package-lock.json`, `public/tailwind.css`.
- Evidencia: Node `v24.15.0`, npm `11.12.1`; `npm ci` instaló 199 paquetes; sintaxis de servidor, validadores, store y cliente verde; CSS compilado.
- Comandos: `npm ci`; `node --check src/server.js`; `node --check src/validators.js`; `node --check src/sqlite-session-store.js`; `node --check public/app.js`; `npm run build:css`.
- Resultado: baseline reproducible. `npm audit` inicial: 5 vulnerabilidades (2 moderadas, 3 altas), concentradas en Axios, `ws` y transitivas; se corrigen en Fase 1.
- Riesgo/rollback: tooling dev se omite en producción con `npm ci --omit=dev`.
- Pendiente siguiente: backup/restore.

- ID: F0-04 / backup SQLite e integridad
- Estado: [x] COMPLETADO
- Archivos: copia local ignorada `data/backups/historial-2026-07-17T07-55-37-259Z.db`.
- Evidencia: backup consistente mediante API `better-sqlite3`, 132,665,344 bytes; `PRAGMA quick_check=ok` tanto en backup como en restauración temporal; conteos sin PII: 710,496 tasas, 12 cotizaciones, 10 usuarios.
- Comandos: script Node inline con `Database#backup`, apertura read-only, `PRAGMA quick_check`, backup inverso de restore drill y eliminación de la restauración temporal.
- Resultado: rollback de datos disponible antes de cualquier cambio de esquema.
- Riesgo/rollback: la copia contiene datos reales y permanece fuera de Git; restaurar con aplicación detenida y conservar el original.
- Pendiente siguiente: captura visual/métricas.

- ID: F0-05 / baseline visual y performance
- Estado: [x] COMPLETADO
- Archivos: `scripts/capture-baseline.js`, `artifacts/baseline/metrics.json`, capturas PNG 1440/390/360 y reportes Lighthouse.
- Evidencia: 20 cotizaciones anonimizadas en DB temporal; listado 26,461 bytes; 2,325–2,341 nodos DOM; 20 tarjetas completas; cero overflow horizontal; proceso 79 MB RSS/19 MB heap usado. PM2 local: 76.5 MB RSS estable. Tamaños: HTML 47,275 B, JS 133,601 B, CSS 86,900 B, login 33,053 B.
- Comandos: `node scripts/capture-baseline.js`; `npx pm2 start ...`; `npx pm2 status`; `npx pm2 delete dayzo-baseline`; `npx pm2 flush`; `npx pm2 kill`.
- Resultado: Lighthouse móvil baseline login 87/95/100/100 y app 74/91/100/100 (performance/accesibilidad/buenas prácticas/SEO). Un error transitorio `NO_NAVSTART` y un bloqueo EPERM de perfil temporal en Windows se diagnosticaron; se aislaron navegadores y se añadió reintento/cleanup, luego el comando quedó verde.
- Prueba manual: capturas de login, simulador y cotizaciones en 1440, 390 y 360; anchura de documento igual a viewport en los tres casos.
- Riesgo/rollback: artefactos de medición no afectan runtime; eliminar `artifacts/baseline` y dependencias dev revierte tooling.
- Pendiente siguiente: Fase 1, secretos/bootstrap/bind/shutdown/URL y pruebas de auth.

## Hallazgos confirmados

- `ecosystem.config.cjs` incluye fallbacks de `SESSION_SECRET` y `ADMIN_PASSWORD=admin123`.
- `seedAdminUser()` cambia la contraseña en cada arranque si existe `ADMIN_PASSWORD` y llega a imprimir una contraseña generada.
- `server.listen(PORT)` no fija loopback.
- El backend confía en totales derivados enviados por cliente.
- Web y Flutter usan CNY fijo `6.53`.
- `updateOficiales()` marca frescura aun sin extracción válida.
- BCV desactiva TLS con `rejectUnauthorized:false`.
- `setInterval(updateBinance, 10s)` permite solapamiento.
- Listado devuelve hasta 1000 objetos completos y renderiza todas las tarjetas expandidas.
- No existe acción “Simular venta” desde guardada.
- La normalización URL ya aparece corregida en el árbol actual (`https://${url}`); queda congelarla con pruebas para evitar regresión.
- Errores fatales se registran pero no provocan salida.
- CSP permite inline y CDNs sin versionado/SRI.
- No había pruebas automatizadas web/backend.

## Registro de fases siguientes

Esta sección se amplía al cerrar cada gate con archivos, diff, comandos, resultado, pruebas manuales, métricas, riesgos, rollback y siguiente tarea exacta.
