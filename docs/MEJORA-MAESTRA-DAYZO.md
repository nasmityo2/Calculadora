# Estado de mejora DAYZO

Última actualización: 2026-07-17T08:35:00Z  
Rama: `improvement/dayzo-web-first-2026`  
Commit base: `0c2973ca428a9e9df9ba65d288a92e475bdcad55`  
Fase actual: 5 — Simulador

## Estados

- [ ] PENDIENTE
- [~] EN CURSO
- [x] COMPLETADO
- [!] BLOQUEADO

## Resumen de fases

- [x] Fase 0 — Baseline, respaldo y mapa
- [x] Fase 1 — Seguridad urgente
- [x] Fase 2 — Cálculos canónicos
- [x] Fase 3 — API/lista de cotizaciones
- [x] Fase 4 — UX cotizaciones
- [~] Fase 5 — Simulador
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

## Fase 1 — Seguridad urgente

- ID: F1-01 / secretos, bootstrap y reset admin
- Estado: [x] COMPLETADO
- Archivos: `ecosystem.config.cjs`, `src/server.js`, `scripts/admin-reset.js`, `README.md`, `SETUP.md`.
- Evidencia: PM2 ya no contiene secretos ni credenciales fallback. Producción aborta con `SESSION_SECRET` menor de 64 caracteres. El bootstrap exige `ADMIN_BOOTSTRAP=1`, usuario válido y password de 12+ caracteres; no imprime contraseñas. Un admin existente nunca se resetea en arranque. La CLI de rotación exige confirmación explícita y elimina sesiones en una transacción.
- Comandos: `npm run check`; integración de bootstrap, reinicio con variable legacy y `npm run admin:reset`.
- Resultado: admin original conserva password frente a una variable vieja; CLI cambia password e invalida sesión anterior.
- Riesgo/rollback: instalaciones nuevas sin bootstrap abortan en producción de forma intencional. Rollback de código solo tras retirar variables `ADMIN_*`; no restaurar la DB salvo corrupción.
- Pendiente siguiente: bind y cierre fatal.

- ID: F1-02 / loopback y errores fatales
- Estado: [x] COMPLETADO
- Archivos: `src/server.js`, `ecosystem.config.cjs`.
- Evidencia: `HOST=127.0.0.1`; producción rechaza `0.0.0.0`; `server.listen(PORT, HOST)`; errores de bind, excepciones no capturadas y promesas rechazadas pasan por shutdown y salen distinto de cero.
- Comandos: test de integración con segundo proceso en el mismo puerto (exit 1); test de producción con host no-loopback (exit 1).
- Resultado: PM2 puede reiniciar un proceso fatal en vez de mantener estado potencialmente corrupto.
- Riesgo/rollback: contenedores que requieran bind público deben usar un proxy sidecar/loopback o una excepción diseñada; no abrir producción por defecto.
- Pendiente siguiente: URL, auth y dependencias.

- ID: F1-03 / URL de producto y pruebas auth
- Estado: [x] COMPLETADO
- Archivos: `test/unit/validators.test.js`, `test/integration/auth.test.js`, `package.json`.
- Evidencia: tests para URL sin esquema, protocolos rechazados, longitud y regresión de `{{https...}}`; login válido/inválido, regeneración de sesión, invalidación de ID previo, logout, CSRF, roles admin/viewer, UUID, IDOR y aislamiento por usuario.
- Comandos: `npm test`; `npm run test:integration`.
- Resultado: 6 unit tests y 3 integration tests verdes.
- Prueba manual/smoke: servidor real en DB temporal, dos viewers y admin; crear cotización con CSRF, lectura/borrado cruzado 404, logout invalida acceso.
- Riesgo/rollback: test usa solo DB temporal y datos anonimizados.
- Pendiente siguiente: auditoría de dependencias.

- ID: F1-04 / dependencias vulnerables
- Estado: [x] COMPLETADO
- Archivos: `package.json`, `package-lock.json`.
- Evidencia: Axios actualizado a 1.18.1, `ws` a 8.21.1; overrides auditados `form-data=4.0.6`, `qs=6.15.3`. Lighthouse se fijó en 12.6.1 porque la última 13.4.0 arrastraba una cadena vulnerable de telemetría solo-dev.
- Comandos: `npm install axios@latest ws@latest`; `npm view form-data version`; `npm view qs version`; `npm audit`; `npm audit --omit=dev`.
- Resultado: `npm audit` final: 0 vulnerabilidades en 373 paquetes.
- Costo/licencia: sin nueva dependencia runtime; versiones existentes actualizadas. Lighthouse sigue solo en desarrollo y no entra con `npm ci --omit=dev`.
- Riesgo/rollback: Axios/`ws` mantienen API usada; tests y smoke verdes. Lockfile permite rollback exacto.
- Pendiente siguiente: Fase 2, extraer dominio monetario y recalcular en servidor.

- ID: F1-GATE / cierre
- Estado: [x] COMPLETADO
- Archivos modificados: `.gitignore` no cambia en esta fase; `ecosystem.config.cjs`, `src/server.js`, `scripts/admin-reset.js`, `README.md`, `SETUP.md`, `package.json`, `package-lock.json`, tests y este tracker.
- Resumen git diff: seguridad de arranque/bind/shutdown, CLI de rotación, actualización de dependencias y primera suite backend.
- Comandos exactos: `npm run check`; `npm audit --omit=dev --audit-level=high`; `npm audit`.
- Resultado: sintaxis, 6 unit, 3 integration y build CSS verdes; auditoría completa 0 vulnerabilidades.
- Métricas antes/después: vulnerabilidades producción 5 → 0; heap/bundle runtime sin dependencia nueva.
- Riesgo/rollback: revertir el commit de Fase 1 restaura comportamiento anterior, pero reintroduce credenciales/reset inseguro; rollback recomendado solo del release completo, nunca de la DB.
- Siguiente tarea exacta: crear `src/domain/import-calculation.js`, congelar DTO/version y vectores.

## Fase 2 — Cálculos canónicos

- ID: F2-01 / dominio puro y DTO versionado
- Estado: [x] COMPLETADO
- Archivos: `src/domain/import-calculation.js`, `docs/DECISIONES-DAYZO.md`.
- Evidencia: funciones puras para normalización, flete, comisiones, inversión, costos y plan de venta; `calculationVersion=dayzo-import-v2`; entrada normalizada preservada en `input`; salida plana compatible.
- Comandos: `node --check src/domain/import-calculation.js`; `npm test`.
- Resultado: reglas GCCARGO, Orinoco e import2ven/personalizado extraídas sin DOM ni dependencias.
- Riesgo/rollback: la validación ahora rechaza ceros/extremos que antes podían persistirse; rollback del commit restaura aceptación insegura, sin tocar registros existentes.
- Pendiente siguiente: integrar POST/PUT.

- ID: F2-02 / recálculo autoritativo
- Estado: [x] COMPLETADO
- Archivos: `src/server.js`, `src/validators.js` (sin cambio requerido de esquema).
- Evidencia: `prepareIncomingQuote()` sanea entradas base, recalcula todo con el dominio, descarta derivados cliente y añade snapshot CNY con fuente/timestamp. `empresaEnvioUSD` permanece como alias legacy.
- Comandos: integración POST con inversión/costo manipulados y PUT con ganancia/ROI manipulados; GET confirmó valores canónicos.
- Resultado: backend es fuente de verdad; `unidadesTotales` inconsistente devuelve 400.
- Riesgo/rollback: payloads antiguos incompletos no pueden reescribirse hasta aportar bases; lectura de registros legacy no cambia.
- Pendiente siguiente: vectores.

- ID: F2-03 / regresión monetaria
- Estado: [x] COMPLETADO
- Archivos: `test/unit/import-calculation.test.js`, `test/integration/auth.test.js`, `package.json`.
- Evidencia: 9 vectores de dominio: GCCARGO, Orinoco mínimo, import2ven por peso/densidad media/volumen, custom, envío China, múltiples cajas, ROI vs margen, precisión y entradas inválidas.
- Comandos: `npm run check`.
- Resultado: 15 unit + 3 integration verdes; vector legacy Orinoco conserva inversión 89.21 dentro de tolerancia `1e-9`; build CSS verde.
- Prueba manual: flujo API crea y actualiza una cotización manipulada, luego detalle devuelve `dayzo-import-v2` y derivados recalculados.
- Métricas: dependencia runtime nueva 0; módulo puro ~sin estado y sin impacto persistente de RAM.
- Riesgo/rollback: redondeo se mantiene solo en UI; flete import2ven conserva `Math.ceil` legacy.
- Pendiente siguiente: lista resumida paginada, errores y DB.

- ID: F2-GATE / cierre
- Estado: [x] COMPLETADO
- Archivos modificados: dominio, servidor, tests, scripts npm, ADR y tracker.
- Resumen git diff: módulo canónico nuevo y adaptación de escritura sin migración destructiva.
- Comandos exactos: `npm run check`; `npm run test:integration`.
- Resultado: gate verde.
- Riesgo/rollback: revertir el commit; no hay migración de DB que deshacer.
- Siguiente tarea exacta: Fase 3, reemplazar lista completa por resumen `limit<=50`/`offset` y contrato de error uniforme.

## Fase 3 — API/lista de cotizaciones

- ID: F3-01 / lista resumida paginada
- Estado: [x] COMPLETADO
- Archivos: `src/server.js`, `docs/API-COTIZACIONES.md`.
- Evidencia: `limit` 1–50, `offset`, orden estable, búsqueda, empresa, con/sin plan y cinco órdenes; cada item excluye `quote`; detalle permanece en `GET /:uuid`; facets de empresa y metadatos `hasMore/nextOffset`.
- Comandos: integración con páginas 2+1, no solapadas, filtros, orden inválido y límites.
- Resultado: API v2 documentada; adaptador `legacy=1` limitado a 20 y marcado deprecated mantiene la web anterior durante la transición.
- Riesgo/rollback: clientes que dependan del objeto completo deben usar temporalmente `legacy=1`; Fase 4 lo elimina de la web.
- Pendiente siguiente: carga bajo demanda en tarjetas.

- ID: F3-02 / contrato de errores y aislamiento
- Estado: [x] COMPLETADO
- Archivos: `src/server.js`, `public/login.html`, `public/app.js`, `test/integration/auth.test.js`.
- Evidencia: errores API `{success:false,error:{code,message},message}`; adaptador superior mantiene mensajes legacy. Tests 400/401/403/404, UUID, CSRF, IDOR y filtros.
- Comandos: `npm run check`.
- Resultado: 15 unit + 3 integration verdes; login y tasas históricas interpretan objeto o string durante compatibilidad.
- Riesgo/rollback: clientes nuevos deben usar `error.code`; `message` superior se retira solo tras mobile.
- Pendiente siguiente: integridad DB.

- ID: F3-03 / FK y política de usuario
- Estado: [x] COMPLETADO
- Archivos: `src/server.js`, `test/integration/auth.test.js`.
- Evidencia: `foreign_keys=ON`, `busy_timeout=5000`; migración transaccional preserva filas y añade `REFERENCES users(id) ON DELETE RESTRICT`; índice por usuario/actualización. Eliminar usuario con cotizaciones devuelve 409; sin cotizaciones elimina usuario y sus sesiones en transacción.
- Comandos: test inspecciona `PRAGMA foreign_key_list(import_quotes)` y ejecuta ambos caminos de borrado.
- Resultado: no quedan cotizaciones huérfanas ni se borran datos implícitamente.
- Riesgo/rollback: primera ejecución reconstruye solo la tabla de cotizaciones dentro de una transacción; backup F0 verificado. Revertir código no requiere revertir el esquema porque la FK es compatible.
- Pendiente siguiente: métricas.

- ID: F3-GATE / cierre
- Estado: [x] COMPLETADO
- Archivos: backend, compatibilidad web, tests, contrato, tracker y `artifacts/phase3`.
- Resumen git diff: paginación/consulta resumida, error uniforme, FK y política RESTRICT.
- Comandos exactos: `npm run check`; `CAPTURE_LABEL=phase3 CAPTURE_LIGHTHOUSE=0 node scripts/capture-baseline.js`.
- Resultado: checks verdes; 20 cotizaciones, 10,285 bytes frente a 26,461 baseline (−61.1%); 81 MB RSS; cero overflow 1440/390/360.
- Prueba manual: capturas phase3 con login, simulador y lista legacy; API resumen verificada separadamente.
- Riesgo/rollback: adaptador legacy evita regresión visual hasta F4; rollback de código conserva FK válida.
- Siguiente tarea exacta: Fase 4, consumir resumen, acordeón único y detalle lazy con skeleton/reintento.

## Fase 4 — UX cotizaciones

- ID: F4-01 / tarjeta compacta y detalle lazy
- Estado: [x] COMPLETADO
- Archivos: `public/index.html`, `public/app.js`, `public/styles.css`.
- Evidencia: resumen cerrado por defecto con nombre, empresa, fecha, inversión, costo/unidad y ganancia; un solo `aria-expanded=true`; detalle por UUID bajo demanda, cache, skeleton, error y reintento.
- Comandos: Playwright abre primera, fuerza 503, reintenta, abre segunda y confirma que la primera se cierra.
- Resultado: el listado ya consume API v2 sin `legacy=1`; edición, imagen y eliminar permanecen en menú secundario.
- Riesgo/rollback: el detalle requiere red la primera vez; cache por sesión y reintento reducen impacto. Revertir UI y activar `legacy=1` restaura temporalmente el cliente anterior.
- Pendiente siguiente: filtros/paginación.

- ID: F4-02 / búsqueda, filtros y cargar más
- Estado: [x] COMPLETADO
- Archivos: `public/index.html`, `public/app.js`.
- Evidencia: búsqueda debounce 300 ms; filtros empresa/con-sin-plan; cinco órdenes server-side; páginas de 20 y CTA “Cargar más”.
- Comandos: E2E con 0, 1, 20 y 100 registros en viewport 390.
- Resultado: estados vacío/error/reintento y conteo cargados/total; 100 registros se obtienen en cinco páginas sin perder orden.
- Riesgo/rollback: filtros reinician expansión de forma intencional para evitar detalle huérfano.
- Pendiente siguiente: acción primaria.

- ID: F4-03 / Simular venta y acciones
- Estado: [x] COMPLETADO
- Archivos: `public/app.js`, `public/index.html`, `public/styles.css`.
- Evidencia: CTA primario “Simular venta”; carga detalle, clona la cotización en `saleSimulationSession`, precarga costos/cantidad/precio y muestra banner sin PUT. Menú conserva editar/imagen/eliminar.
- Comandos: E2E compara JSON SQLite antes/después de simular y confirma igualdad.
- Resultado: la acción navega al simulador y no muta el registro.
- Riesgo/rollback: Fase 5 completa el flujo progresivo y guardado explícito; por ahora usa controles existentes.
- Pendiente siguiente: métricas visuales.

- ID: F4-GATE / cierre
- Estado: [x] COMPLETADO
- Archivos: web, Playwright/config, servidor E2E, capturas `artifacts/phase4`, tracker.
- Resumen git diff: lista resumida compacta, lazy detail, filtros/paginación, acción simular y E2E responsive.
- Comandos exactos: `npm run check`; `npm run test:e2e`; `CAPTURE_LABEL=phase4 node scripts/capture-baseline.js`.
- Resultado: 15 unit + 3 integration + 1 E2E verdes. Dos intentos iniciales del E2E no interceptaron requests por el service worker; se diagnosticó y aisló con `serviceWorkers:'block'`, luego quedó verde.
- Pruebas manuales: capturas 1440/390/360; cero overflow; targets principales 44 px; menú accesible.
- Métricas antes/después: DOM con 20 cotizaciones 2,341 → 1,268 nodos (−45.8%); payload 26,461 → 10,285 B (−61.1%); Lighthouse app performance 74 → 76; RSS 79 → 81 MB.
- Riesgo/rollback: JS/CSS crecen temporalmente por convivencia con renderer legacy, que se elimina en Fase 8; rollback al commit F3 mantiene API.
- Siguiente tarea exacta: Fase 5, convertir simulador a fuente → forma de venta → resultado y separar guardado/cancelación.
