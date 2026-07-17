# Estado de mejora DAYZO

Última actualización: 2026-07-17T09:23:00Z  
Rama: `improvement/dayzo-web-first-2026`  
Commit base: `0c2973ca428a9e9df9ba65d288a92e475bdcad55`  
Fase actual: 10 — Cierre web

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
- [x] Fase 5 — Simulador
- [x] Fase 6 — Login DAYZO
- [x] Fase 7 — Tasas y frescura
- [x] Fase 8 — Modularización/performance/CSP
- [x] Fase 9 — VPS 1 GB (preparación local; ejecución VPS bloqueada)
- [~] Fase 10 — Cierre web
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

## Fase 5 — Simulador

- ID: F5-01 / flujo progresivo y fuentes
- Estado: [x] COMPLETADO
- Archivos: `public/index.html`, `public/app.js`, `public/styles.css`.
- Evidencia: tres secciones numeradas fuente → forma de venta → resultado; fuentes “cotización actual”, “guardada” y “costo manual”; selector de guardadas; banner con nombre/costos congelados.
- Comandos: captura responsive phase5 y E2E desde CTA de una guardada.
- Resultado: la selección guardada vive en `saleSimulationSession`; `lastImportQuote` de la cotización actual ya no se sobreescribe.
- Riesgo/rollback: controles clásicos siguen disponibles dentro de cada paso para conservar compatibilidad.
- Pendiente siguiente: cálculo puro.

- ID: F5-02 / ROI, margen y validación
- Estado: [x] COMPLETADO
- Archivos: `public/js/sale-calculations.js`, `test/unit/sale-calculations.test.js`, `public/service-worker.js`.
- Evidencia: cálculo puro UMD/CommonJS para precio USD, Bs y ROI; positivos/rangos; salida separa ROI sobre costo y margen sobre venta. Presets y copy ahora dicen ROI.
- Comandos: `npm test`.
- Resultado: 4 nuevos vectores; 19 unit totales verdes. Service worker v3 precachea módulo.
- Riesgo/rollback: preview cliente no es fuente persistente; PUT pasa por recálculo canónico servidor.
- Pendiente siguiente: guardado explícito.

- ID: F5-03 / guardar o cancelar
- Estado: [x] COMPLETADO
- Archivos: `public/app.js`, `public/index.html`, `test/e2e/quotes.spec.js`.
- Evidencia: “Guardar plan en la cotización” hace PUT explícito; “Cerrar sin guardar” borra sesión de simulación y no hace mutación. Tasa P2P usada, hora y estado stale/fallback visibles.
- Comandos: E2E compara JSON antes/después de cancelar (idéntico), luego guarda precio 9.99 y confirma persistencia canónica.
- Resultado: cancelar no guarda; guardar refresca solo datos/cache relevantes y muestra confirmación.
- Riesgo/rollback: la sesión es efímera y se pierde al recargar, intencionalmente para evitar escrituras implícitas.
- Pendiente siguiente: gate visual.

- ID: F5-GATE / cierre
- Estado: [x] COMPLETADO
- Archivos: simulador, módulo puro, tests, SW, capturas `artifacts/phase5`, tracker.
- Resumen git diff: estado separado, flujo 3 pasos, cálculo puro, tasa/frescura y CTA guardar/cancelar.
- Comandos exactos: `npm run check`; `npm run test:e2e`; `CAPTURE_LABEL=phase5 CAPTURE_LIGHTHOUSE=0 node scripts/capture-baseline.js`.
- Resultado: 19 unit + 3 integration + 1 E2E verdes; 81 MB RSS; cero overflow 1440/390/360.
- Prueba manual: CTA desde cotización desplaza al simulador, precarga precio y muestra costos congelados; cancelar vuelve a fuente actual.
- Riesgo/rollback: revertir F5 conserva CTA F4 con simulador clásico; DB no requiere rollback.
- Siguiente tarea exacta: Fase 6, extraer auth CSS/JS, rediseñar identidad DAYZO y ampliar E2E/a11y.

## Fase 6 — Login DAYZO

- ID: F6-01 / identidad y separación
- Estado: [x] COMPLETADO
- Archivos: `public/login.html`, `public/css/auth.css`, `public/js/auth.js`, `public/service-worker.js`.
- Evidencia: HTML reducido de 33,272 a 9,041 bytes; cero `<style>`/script inline/handlers; layout dividido desktop y columna móvil; propuesta “Costos reales para importar y vender en Venezuela”; preview honesto de cotización con inversión/costo/venta/ganancia.
- Comandos: sintaxis, capturas 390/360/1440 y Lighthouse.
- Resultado: identidad propia sin CDN de iconos/fuentes en login; autocomplete preservado; no se ofrece recuperación falsa.
- Riesgo/rollback: fuentes caen a sistema/serif local de `styles.css`; no dependencia externa nueva.
- Pendiente siguiente: accesibilidad y seguridad de redirección.

- ID: F6-02 / formulario accesible
- Estado: [x] COMPLETADO
- Archivos: `public/login.html`, `public/css/auth.css`, `public/js/auth.js`, `test/unit/auth-utils.test.js`.
- Evidencia: targets >=44 px, focus visible, errores por campo, `aria-live`, foco al banner, tabs con flechas, reduced motion y password toggle. `safeNextPath` valida origen/ruta y rechaza `//`, URL externa y backslash.
- Comandos: `npm test`.
- Resultado: 3 vectores auth nuevos; 22 unit totales verdes.
- Riesgo/rollback: sin recuperación de contraseña por decisión fail-closed; requiere token one-time/email real en fase separada.
- Pendiente siguiente: E2E.

- ID: F6-03 / auth E2E
- Estado: [x] COMPLETADO
- Archivos: `test/e2e/auth.spec.js`.
- Evidencia: registro inválido/válido, login inválido/válido, logout, rate limit, next seguro, foco y layout 390/1440.
- Comandos: `npm run test:e2e`.
- Resultado: 3 E2E verdes (2 auth + cotizaciones); rate limit retorna `RATE_LIMITED`.
- Riesgo/rollback: DB y cuentas E2E viven en `.tmp/` ignorado.
- Pendiente siguiente: gate visual.

- ID: F6-GATE / cierre
- Estado: [x] COMPLETADO
- Archivos: login, auth CSS/JS, tests, SW, capturas `artifacts/phase6`, tracker.
- Resumen git diff: login reemplazado por shell DAYZO responsive y lógica auth modular/testeable.
- Comandos exactos: `npm run check`; `npm run test:e2e`; `CAPTURE_LABEL=phase6 node scripts/capture-baseline.js`.
- Resultado: 22 unit + 3 integration + 3 E2E verdes. Lighthouse login 98 performance, 100 accesibilidad, 96 buenas prácticas, 100 SEO; baseline 87/95/100/100. Un `NO_LCP` transitorio se hizo explícitamente reintentable y el segundo run quedó medible/verde.
- Pruebas manuales: capturas 1440/390/360, sin overflow; preview y formulario legibles; foco inicial correcto.
- Métricas: login HTML −72.8%; RSS 86 MB en captura; sin dependencia runtime.
- Riesgo/rollback: revertir F6 restaura login anterior; backend auth no cambia.
- Siguiente tarea exacta: Fase 7, fuente CNY dinámica, estados de intento/éxito/stale, scheduler sin solapamiento y TLS estricto.

## Fase 7 — Tasas y frescura

- ID: F7-01 / contrato y CNY
- Estado: [x] COMPLETADO
- Archivos: `src/server.js`, `public/app.js`, `public/index.html`, `docs/DECISIONES-DAYZO.md`, `README.md`.
- Evidencia: contrato canónico `p2pBuyVesPerUsdt`/`p2pSellVesPerUsdt` con aliases legacy; CNY dinámico calculado como `USD_VES/CNY_VES`; web usa `tasas.cny` en conversión, importación, detalles y simulador. Fallback 6,53 aparece “Estimado”.
- Comandos: integración inspecciona campos canónicos/legacy y estados.
- Resultado: no quedan usos de `tasaSegura`; adaptador evita romper clientes anteriores.
- Riesgo/rollback: mobile usa fallback hasta F11; aliases se conservan hasta migrarlo.
- Pendiente siguiente: frescura.

- ID: F7-02 / intentos, éxitos y fuentes caídas
- Estado: [x] COMPLETADO
- Archivos: `src/rates/rate-sources.js`, `src/server.js`, `test/unit/rate-sources.test.js`.
- Evidencia: `lastAttemptAt`, `lastSuccessAt`, estado/stale/fallos por Binance y BCV; un error no avanza el éxito. Parser BCV falla cerrado; rangos y salto máximo 50%; cache se reporta degraded/stale.
- Comandos: 6 tests de parser, salto, stale/cache, backoff y scheduler; E2E ejecutado con BCV TLS caído y UI completa verde.
- Resultado: 28 unit + 3 integration verdes; captura phase7 conserva app usable y registra `UNABLE_TO_VERIFY_LEAF_SIGNATURE` como fuente degradada, no como éxito.
- Riesgo/rollback: un cambio monetario extraordinario >50% requiere revisión; no se acepta automáticamente.
- Pendiente siguiente: scheduler/TLS.

- ID: F7-03 / TLS y scheduler
- Estado: [x] COMPLETADO
- Archivos: `src/server.js`, `src/rates/rate-sources.js`, `README.md`.
- Evidencia: TLS estricto primero; fallback solo con `BCV_TLS_FALLBACK=1`, host fijo, tope 2 MB y validación completa. Binance usa lock, ciclo recursivo, backoff+jitter; BCV tiene lock.
- Comandos: test estático confirma ausencia de `setInterval(updateBinance)` y presencia de lock/backoff; `npm run test:e2e`.
- Resultado: no hay ciclos Binance solapados; 3 E2E verdes aun con BCV no disponible.
- Riesgo/rollback: dejar fallback en 0 es preferido; activarlo solo durante incidente documentado.
- Pendiente siguiente: fecha/UI.

- ID: F7-04 / fecha y estado UI
- Estado: [x] COMPLETADO
- Archivos: `public/app.js`, `public/index.html`.
- Evidencia: `parseHistorialDate` devuelve null y los consumidores filtran/rotulan sin inventar “ahora”; topbar, tarjeta CNY y simulador muestran stale/fallback/último éxito.
- Resultado: cero timestamps fabricados y cero overflow en phase7.
- Riesgo/rollback: filas históricas con fecha inválida se omiten visualmente en lugar de ubicarse hoy.
- Pendiente siguiente: gate.

- ID: F7-GATE / cierre
- Estado: [x] COMPLETADO
- Archivos: módulo de fuentes, servidor, web, tests, docs, capturas `artifacts/phase7`.
- Resumen git diff: contrato canónico, CNY dinámico, estados, TLS, locks y backoff.
- Comandos exactos: `npm run check`; `npm run test:e2e`; `CAPTURE_LABEL=phase7 CAPTURE_LIGHTHOUSE=0 node scripts/capture-baseline.js`.
- Resultado: 28 unit + 3 integration + 3 E2E verdes; fuente BCV caída quedó explícitamente degraded; 80 MB RSS.
- Prueba manual: UI indica CNY estimado y datos stale cuando no existe éxito nuevo.
- Riesgo/rollback: revertir F7 restaura aliases únicamente, pero reintroduce falsa frescura/TLS débil; no recomendado.
- Siguiente tarea exacta: Fase 8, retirar renderer/handlers legacy, self-host assets, endurecer CSP y WebSocket.

## Fase 8 — Modularización, performance y CSP

- ID: F8-01 / módulos y CSS
- Estado: [x] COMPLETADO
- Archivos: `public/js/auth.js`, `sale-calculations.js`, `rates-socket.js`, `url-utils.js`, `public/css/tokens.css`, `public/css/auth.css`, `public/app.js`, `public/styles.css`.
- Evidencia: extracción incremental de auth, cálculo de venta, normalización URL y WebSocket; tokens y auth separados del CSS principal. Vanilla JS preservado, sin framework/bundler.
- Comandos: sintaxis de todos los módulos y 31 unit tests.
- Resultado: módulos UMD/CommonJS testeables; renderer activo de cotizaciones solo usa resumen/lazy detail.
- Riesgo/rollback: `app.js` aún contiene dominios históricos/import/share para no hacer una reescritura masiva; próximos cortes pueden ser mecánicos con la suite actual.
- Pendiente siguiente: handlers/CSP.

- ID: F8-02 / CSP y assets
- Estado: [x] COMPLETADO
- Archivos: `src/server.js`, `public/index.html`, `login.html`, `manifest.json`, `icons/dayzo.svg`, `package.json`, lockfile.
- Evidencia: cero handlers o scripts inline; `script-src 'self'`, `script-src-attr 'none'`; cero CDN/fuentes remotas; Chart.js/Font Awesome fijados y servidos desde allowlist local; icono SVG local.
- Comandos: tests estáticos HTML/CDN, integración de headers y assets, `npm audit`.
- Resultado: audit 0 vulnerabilidades; login 100/100/100/100; app buenas prácticas sin dependencias CDN. `style-src-attr 'unsafe-inline'` queda como etapa explícita porque el renderer legacy usa CSSOM/atributos de estado; scripts ya no admiten inline.
- Costo/licencia: documentado en ADR-007; sin `require()` runtime ni heap adicional.
- Riesgo/rollback: assets dependen de `npm ci --omit=dev`, donde ambos están en dependencies.
- Pendiente siguiente: WS/a11y.

- ID: F8-03 / WebSocket y accesibilidad
- Estado: [x] COMPLETADO
- Archivos: `public/js/rates-socket.js`, `src/server.js`, `public/index.html`, `public/styles.css`, tests.
- Evidencia: backoff+jitter, heartbeat cliente, cola máxima 10; ping/pong servidor, payload 16 KB y sin deflate. Zoom móvil habilitado, contraste corregido, targets y reduced motion.
- Comandos: unit de cola, 3 E2E, captura/Lighthouse phase8.
- Resultado: Lighthouse app 82 performance, 100 accesibilidad, 96 buenas prácticas, 100 SEO; baseline 74/91/100/100. Login 100 en las cuatro categorías. Cero overflow.
- Riesgo/rollback: el heartbeat cliente cierra tras 90 s sin frames y reconecta; el servidor conserva último snapshot.
- Pendiente siguiente: gate.

- ID: F8-GATE / cierre
- Estado: [x] COMPLETADO
- Archivos: frontend modular, servidor CSP/assets/WS, tests, capturas `artifacts/phase8`, ADR/tracker.
- Resumen git diff: handlers retirados, dependencias self-hosted, CSP de scripts estricta, tokens/auth CSS, WS resiliente.
- Comandos exactos: `npm run check`; `npm run test:e2e`; `npm audit --audit-level=moderate`; `CAPTURE_LABEL=phase8 node scripts/capture-baseline.js`.
- Resultado: 31 unit + 3 integration + 3 E2E verdes; audit 0; 82 MB RSS; DOM 1,280 vs 2,341 baseline.
- Prueba manual: 1440/390/360, teclado/zoom/foco, chart e iconos locales, cero overflow.
- Riesgo/rollback: rollback al commit F7 restaura CDN/handlers y CSP débil; solo usar como rollback total de emergencia.
- Siguiente tarea exacta: Fase 9, scripts operativos de backup/preflight/deploy, health interno y runbook VPS.

## Fase 9 — Operación VPS 1 GB

- ID: F9-01 / memoria y proceso
- Estado: [x] COMPLETADO
- Archivos: `ecosystem.config.cjs`, `docs/RUNBOOK-PRODUCCION.md`.
- Evidencia: una instancia, heap 320 MB, restart 350 MB, loopback. Smoke PM2 production con configuración real: online, 0 reinicios, 76.4 MB RSS tras 7 s.
- Comandos: `npx pm2 start ecosystem.config.cjs --env production`; `pm2 status`; delete/flush/kill.
- Resultado: presupuesto inicial muy por debajo de 1 GB; falta observación 24 h real.
- Riesgo/rollback: límites se ajustan solo con métricas VPS; rollback previo 512 MB aumenta riesgo OOM.
- Pendiente siguiente: backup/preflight.

- ID: F9-02 / backup y preflight
- Estado: [x] COMPLETADO
- Archivos: `scripts/backup-sqlite.js`, `scripts/preflight.js`, package scripts, systemd timer/service.
- Evidencia: lock anti-solape, API backup, quick_check, restore drill, retención; preflight valida Node, lock, producción, secreto 64+, loopback y SQLite sin imprimir secreto.
- Comandos: `npm run backup` sobre DB E2E: 241,664 B, quick/restore ok; preflight válido exit 0 y sin secret exit 1.
- Resultado: backup/restore y fail-closed reproducibles.
- Riesgo/rollback: retención solo borra archivos con patrón DAYZO en directorio dedicado; off-site se configura externamente.
- Pendiente siguiente: deploy/infra.

- ID: F9-03 / deploy, rollback, Nginx y host
- Estado: [x] COMPLETADO
- Archivos: `deploy/deploy.sh`, `rollback.sh`, `setup-vps.sh`, `nginx-dayzo.conf`, logrotate, timer/service, env example, runbook.
- Evidencia: release/symlink atómico, backup previo, install production-only, preflight, PM2 como usuario `dayzo`, health loop, rollback automático/de un comando; UFW 22/80/443, swap 1 GB, logrotate, WS/timeouts/body 512 KB, health público bloqueado.
- Prueba local: integración `/health-internal` loopback 200, XFF remoto 404 y sin PII/cache; PM2 production smoke verde.
- Riesgo/rollback: scripts Ubuntu no se ejecutan en Windows; revisión final en VPS exige `nginx -t`, systemd y symlink reales.
- Pendiente siguiente: bloqueo externo.

- ID: F9-EXT / infraestructura real
- Estado: [!] BLOQUEADO
- Bloqueo concreto: esta sesión no dispone de SSH/VPS, DNS, Certbot, destino off-site cifrado ni privilegios UFW/systemd.
- Preparado: comandos exactos en `docs/RUNBOOK-PRODUCCION.md` y `deploy/`.
- Evidencia requerida para desbloquear: `ss -lntp`, `ufw status verbose`, `nginx -t`, timer backup, restore real, deploy+rollback, RSS/swap 24 h y copia off-site.
- Riesgo/rollback: no se simuló acceso ni se alteró producción.
- Siguiente tarea exacta: ejecutar F10 local completo; deploy/observación quedará como único gate web externo.

- ID: F9-GATE / cierre local
- Estado: [x] COMPLETADO
- Comandos exactos: backup/restore, preflight success/failure, PM2 production smoke, tests de health.
- Resultado: controles ejecutables locales verdes; operación remota aislada en F9-EXT.
- Siguiente tarea exacta: Fase 10, suite completa, auditoría final web y artefacto de deploy.
