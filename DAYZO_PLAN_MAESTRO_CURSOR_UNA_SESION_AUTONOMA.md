# DAYZO — Auditoría técnica, plan maestro y prompt exacto para Cursor

**Fecha de auditoría:** 17 de julio de 2026  
**Repositorio auditado:** ZIP `calculadora.zip`  
**Alcance:** web Node/Express/SQLite, frontend estático, seguridad, cálculos, UX, despliegue en VPS de 1 GB y app Flutter Android.

---

# MANDATO PRINCIPAL: UNA SOLA SESIÓN, EJECUCIÓN AUTÓNOMA HASTA EL FINAL

Este documento y el prompt incluido están diseñados para ejecutarse **completos dentro de una única sesión de chat de Cursor**, usando un modelo/agente potente con acceso total al repositorio, terminal y herramientas de desarrollo. No se debe dividir en conversaciones nuevas, no se debe pedir al usuario que copie la siguiente fase y no se debe detener el trabajo después de mostrar un plan, un diagnóstico, un `git diff` o el resultado de una prueba.

## Contrato de autonomía obligatorio

El agente que reciba el prompt debe cumplir estas reglas durante toda la sesión:

1. **Una única sesión continua:** cargar contexto una vez y ejecutar consecutivamente Fase 0, Fase 1, Fase 2… hasta la última fase aplicable.
2. **No esperar confirmaciones entre fases:** después de cerrar el gate de una fase, actualizar el tracker y comenzar inmediatamente la siguiente.
3. **No hacer preguntas de preferencia:** si aparece una decisión técnica, visual, de arquitectura, nombres, estructura, librería, migración compatible o estrategia de pruebas, elegir autónomamente la alternativa más segura, simple, mantenible y apropiada para un VPS de 1 GB.
4. **No detenerse ante errores corregibles:** investigar la causa, corregirla, volver a ejecutar el comando y repetir hasta dejarlo verde.
5. **No declarar éxito parcial como éxito total:** un cambio no está terminado mientras falle lint, sintaxis, test, build, smoke test, E2E o criterio de aceptación relacionado.
6. **No omitir tareas por falta de tiempo o tokens:** compactar explicaciones, registrar evidencia en archivos y continuar ejecutando. Priorizar acciones y pruebas sobre narración extensa en el chat.
7. **No rehacer desde cero sin necesidad:** aplicar cambios incrementales, pequeños y reversibles, manteniendo compatibilidad y datos existentes.
8. **Tomar decisiones con criterio profesional:** documentar cada decisión relevante en `docs/DECISIONES-DAYZO.md`, incluyendo motivo, alternativas descartadas, riesgos y rollback; no pedir al usuario que decida.
9. **Resolver dependencias automáticamente:** si falta una dependencia o herramienta necesaria, verificar compatibilidad/licencia/costo, instalarla de manera reproducible y continuar. No instalar paquetes innecesarios en producción.
10. **Trabajar de forma segura con datos:** crear backup consistente antes de migraciones, usar una copia o DB temporal en pruebas y nunca imprimir secretos o PII.
11. **Si falta un secreto externo real** (keystore, credencial Firebase, SMTP, DNS o acceso VPS), no inventarlo ni exponerlo. Implementar todo lo que pueda quedar preparado, crear validación fail-closed, registrar el único bloqueo externo y continuar con todas las tareas independientes. Al final, indicar exactamente el único dato/acción externa pendiente.
12. **Si una operación es destructiva en producción:** preferir simulación/local/staging, preparar el comando y rollback y continuar con el resto. No borrar datos reales ni rotar credenciales sin acceso autorizado.
13. **No pausar para reportar:** los resúmenes de cada fase se escriben en el tracker. En el chat solo debe emitirse la respuesta final cuando se hayan agotado todas las fases y verificaciones posibles.
14. **Reintento disciplinado:** máximo razonable por la misma causa; si persiste, cambiar de enfoque, aislar el fallo, crear una prueba mínima y continuar. Nunca repetir ciegamente el mismo comando.
15. **Definición de final:** terminar únicamente cuando web, backend, despliegue documentado y mobile hayan sido auditados, corregidos y verificados según sus gates, o cuando quede exclusivamente un bloqueo externo imposible de resolver sin credenciales/infraestructura ajena al repositorio.

## Protocolo autónomo para decisiones

Cuando exista ambigüedad, el agente debe decidir en este orden:

1. Seguridad y preservación de datos.
2. Cero regresiones y compatibilidad temporal.
3. Exactitud monetaria y trazabilidad.
4. Menor RAM/CPU y menor complejidad operativa.
5. Accesibilidad y claridad para una persona nueva.
6. Mantenibilidad y facilidad de pruebas.
7. Consistencia con la identidad DAYZO existente.

Debe escoger una opción, registrarla y continuar. **“¿Cuál prefieres?” no es una respuesta permitida.**

---

## 1. Veredicto ejecutivo

DAYZO tiene una base mejor de lo que aparentan las capturas: usa sesiones server-side persistidas en SQLite, bcrypt, CSRF, rate limiting, consultas preparadas, Helmet, compresión, WebSocket, WAL, caché offline básica y una app Flutter bastante avanzada. No recomiendo reescribirla en React/Next ni cambiar SQLite: con un VPS de 1 GB, la arquitectura actual puede funcionar bien si se modulariza y se corrigen los defectos críticos.

Sin embargo, **no está lista para considerarse “optimizada y sin bugs”**. Hay fallos verificables que deben resolverse antes del rediseño:

1. La configuración PM2 contiene credenciales inseguras de producción y puede restablecer el admin a `admin123`.
2. La app Flutter trata los IDs UUID de cotizaciones como enteros; el módulo de cotizaciones falla contra la API real.
3. El backend acepta totales calculados por el cliente sin recalcularlos y admite negativos/extremos; un cliente alterado puede guardar cotizaciones incoherentes.
4. La tasa CNY está fijada en `6.53` en web y Flutter aunque el backend entrega una tasa dinámica.
5. Las cotizaciones web se renderizan completas y abiertas, hasta 1000 registros con el JSON entero; esto explica la mala experiencia y escala mal.
6. El simulador mezcla demasiadas decisiones simultáneas y no tiene una acción explícita para simular desde una cotización guardada.
7. El proceso escucha en todas las interfaces aunque la documentación afirma que solo escucha en loopback.
8. La obtención BCV desactiva validación TLS y puede marcar una actualización fallida como “reciente”.
9. No existen pruebas automatizadas para backend/web; solo hay pruebas Flutter, y no fue posible ejecutarlas en este entorno porque el SDK Flutter no venía en el ZIP.
10. `src/server.js` (1511 líneas), `public/app.js` (2896), `styles.css` (3569) y `login.html` (749) son demasiado monolíticos.

**Prioridad correcta:** estabilizar y asegurar la web → corregir UX y contratos → medir/desplegar → continuar la app móvil.

---

## 2. Evidencia y validaciones realizadas

- Se revisaron los 500 archivos del ZIP y el historial Git incluido.
- Se leyó el backend completo y las áreas críticas de frontend, autenticación, cotizaciones, simulador, fuentes de tasas, SQLite, PM2, service worker y Flutter.
- `node --check` pasó para:
  - `src/server.js`
  - `src/validators.js`
  - `src/sqlite-session-store.js`
  - `public/app.js`
- Las versiones del lockfile fueron contrastadas con `package.json`.
- No se detectaron secretos reales mediante búsqueda estática, pero sí **valores de fallback inseguros**.
- No se pudo ejecutar `npm ci`: el sandbox no tenía los paquetes en caché y no tenía red.
- No se pudo ejecutar `flutter analyze/test/build`: el ZIP no incluye SDK Flutter y el sandbox no lo tiene instalado.
- Por tanto, las afirmaciones sobre fallos de contrato Flutter son de análisis estático directo y deben confirmarse al compilar en la máquina de desarrollo.

---

## 3. Hallazgos priorizados

### CRÍTICOS

#### SEC-001 — Credenciales inseguras y reset automático del admin

**Archivos:** `ecosystem.config.cjs`, `README.md`, `SETUP.md`, `src/server.js:358-384`.

`env_production` usa:

- `SESSION_SECRET: ... || 'cambiar-en-produccion-usar-variable-de-entorno'`
- `ADMIN_USERNAME: ... || 'admin'`
- `ADMIN_PASSWORD: ... || 'admin123'`

En cada arranque, si `ADMIN_PASSWORD` existe, `seedAdminUser()` vuelve a hashear y actualizar la contraseña del admin. En producción, el fallback `admin123` cuenta como definido. Si el operador no exportó la variable, cada reinicio puede dejar al admin con una contraseña pública y predecible.

**Corrección obligatoria:** eliminar todos los fallbacks de secretos; abortar producción si faltan; usar `ADMIN_PASSWORD` solo para bootstrap inicial explícito o un comando CLI de reset, nunca en cada arranque.

#### APP-001 — IDs de cotización incompatibles en Flutter

**Archivos:**

- `mobile/lib/data/models/import_quote.dart`
- `mobile/lib/data/repositories/import_quotes_repository.dart`
- `mobile/lib/features/import_quotes/import_quotes_provider.dart`
- `mobile/lib/features/import_quotes/import_quotes_screen.dart`
- `mobile/lib/features/import_quotes/import_quote_detail_screen.dart`
- `mobile/lib/core/router/app_router.dart`

El backend genera `crypto.randomUUID()` y valida UUID. Flutter declara `id` y `quoteId` como `int`, hace `(json['id'] as num).toInt()`, `int.parse(...)` y espera `(data['id'] as num)`. El listado/detalle/crear/borrar fallará en runtime con IDs reales.

**Corrección:** migrar el flujo completo a `String`, actualizar fixtures y agregar pruebas con UUID reales.

#### DATA-001 — El servidor confía en totales monetarios enviados por el cliente

**Archivos:** `src/validators.js`, `src/server.js:843-852`, rutas POST/PUT de cotizaciones.

`sanitizeImportQuote()` verifica que los campos sean números finitos, pero no recalcula inversión, flete, comisiones, costo unitario, ganancia, ROI ni margen. Tampoco impone rangos positivos y consistentes. Un cliente modificado puede guardar cifras negativas o contradictorias.

**Corrección:** el servidor debe recibir entradas base, recalcular todos los derivados con una función canónica y rechazar diferencias. La UI puede previsualizar, pero el backend es la fuente de verdad.

#### OPS-001 — Exposición de puerto contraria a la documentación

**Archivo:** `src/server.js:1465`.

`server.listen(PORT)` escucha normalmente en `0.0.0.0`. `SETUP.md` afirma que 3001/3002 solo escuchan en `127.0.0.1`. Si UFW/security group está mal configurado, Express queda accesible directamente, saltándose Nginx.

**Corrección:** `HOST=127.0.0.1` en producción y `server.listen(PORT, HOST, ...)`; verificar con `ss -lntp`.

### ALTOS

#### DATA-002 — CNY hardcodeado e inconsistente

**Archivos:** `public/app.js:85` y múltiples usos; `mobile/lib/features/calculator/currency_calculator.dart`.

La web y Flutter usan `tasaSegura = 6.53` aunque `/api/tasas-venezuela` entrega `tasas.cny`. Cotizaciones, conversiones y simulaciones pueden quedar desactualizadas.

**Corrección:** usar la tasa del snapshot; conservar 6.53 solo como fallback identificado y mostrar estado “estimada” cuando se use.

#### DATA-003 — Una consulta BCV fallida puede aparecer como actualización exitosa

**Archivo:** `src/server.js:970-990`.

`getBCVData()` atrapa errores y devuelve ceros. `updateOficiales()` actualiza `lastUpdateBCV` y `lastUpdateTasas` aunque no haya recibido USD/CNY válido. El usuario puede creer que una tasa antigua es fresca.

**Corrección:** separar `lastAttemptAt`, `lastSuccessAt`, `sourceStatus`; actualizar frescura solo con datos válidos; añadir umbrales de stale.

#### SEC-002 — TLS del BCV desactivado

**Archivo:** `src/server.js:875-879`.

`rejectUnauthorized:false` permite MITM de la fuente oficial. Aunque el sitio BCV haya tenido problemas históricos, la tasa usada para cálculos no debe aceptar silenciosamente contenido sin autenticidad.

**Corrección:** intentar TLS estricto; usar fallback aislado y explícito solo si está documentado; validar host/certificado/contenido y comparar con la última tasa dentro de un rango razonable.

#### PERF-001 — Polling Binance puede solaparse

**Archivo:** `src/server.js:946-967`, intervalo cada 10 s.

Cada actualización puede ejecutar dos peticiones con hasta tres reintentos y timeouts de 15 s. `setInterval` no espera la ejecución anterior; una caída de Binance puede acumular ciclos concurrentes.

**Corrección:** lock `inFlight`, ciclo recursivo con `setTimeout` al finalizar, backoff y jitter; métricas de fallo; no lanzar otro ciclo mientras uno siga activo.

#### PERF-002 — API/listado devuelve hasta 1000 cotizaciones completas y las renderiza abiertas

**Archivos:** `src/server.js:505`, `mapImportQuoteListItem()`, `public/app.js:2085-2247`.

El endpoint de lista incluye el objeto `quote` completo y la UI construye desglose, KPIs, totales, links, proyección y acciones para cada registro. No hay paginación. Esto aumenta JSON, DOM, tiempo de render y consumo móvil.

**Corrección:** lista resumida paginada; detalles bajo demanda; acordeón con una sola cotización abierta; virtualización o “cargar más” si el volumen crece.

#### WEB-001 — Arquitectura frontend monolítica y propensa a regresiones

**Archivos:** `public/app.js`, `public/styles.css`, `public/index.html`, `public/login.html`.

La lógica de API, estado, tasas, gráficos, importación, simulación, cotizaciones, modales y canvas vive en un único archivo global con 69 handlers inline en HTML. Cambiar una sección puede romper otras silenciosamente.

**Corrección:** modularizar Vanilla JS gradualmente, sin migración masiva de framework.

#### SEC-003 — CSP debilitada y dependencias CDN sin fijación/SRI

**Archivo:** `src/server.js:62-80`, `public/index.html`, `public/login.html`.

CSP admite `unsafe-inline` para scripts/estilos y carga Chart.js “latest”, Font Awesome, fuentes e iconos externos. No hay Subresource Integrity. Esto reduce protección XSS y hace el build no reproducible.

**Corrección:** self-host o fijar versiones+SRI, eliminar handlers inline, usar nonce/hash y retirar `unsafe-inline` por etapas.

#### SEC-004 — URL de producto mal normalizada

**Archivos:** `public/app.js:1847`, `src/validators.js:77`.

Para URLs sin esquema se construye literalmente ``{{https://${url}}}``, que no es una URL válida. Los enlaces sin `https://` se rechazan o se pierden.

**Corrección:** ``https://${url}``; pruebas para dominios, protocolos rechazados y longitud.

#### REL-001 — Excepciones fatales no reinician el proceso

**Archivo:** `src/server.js:1510-1511`.

Se loguean `uncaughtException` y `unhandledRejection` pero el proceso continúa potencialmente corrupto.

**Corrección:** log, iniciar graceful shutdown y terminar con código != 0 para que PM2 reinicie.

#### QA-001 — No hay pruebas web/backend

No existen pruebas del contrato, autenticación, CSRF, aislamiento por usuario, cálculos de flete, redondeos, tasas históricas ni UI web.

**Corrección:** `node:test` para dominio/validadores; integración con DB temporal y servidor en puerto efímero; Playwright para flujos críticos.

### MEDIOS

#### UX-001 — Simulador con demasiada carga cognitiva

Muestra simultáneamente fuente, unidad/caja, modo precio USD/Bs/margen, tasas, costo, input, seis presets, sparkline y múltiples indicadores. El usuario debe deducir el orden correcto.

**Corrección:** flujo progresivo de tres pasos, lenguaje natural, resumen fijo y ayuda contextual.

#### UX-002 — No existe “Simular venta” desde cada cotización guardada

Las tarjetas solo ofrecen Editar, Imagen y Eliminar. Debe añadirse una acción primaria que precargue costo/cantidades en un contexto de simulación sin mutar la cotización.

#### UX-003 — Login visualmente correcto pero genérico y excesivamente embebido

`login.html` tiene 749 líneas, con gran CSS inline y el patrón habitual “marca + tres tasas + tarjeta + pestañas”. Falta una propuesta de valor propia, identidad DAYZO más distintiva, contexto de seguridad y recuperación de cuenta.

#### DATA-004 — Semántica BUY/SELL confusa

`binance` recibe `BUY` y `binance_compra` recibe `SELL`; la UI usa etiquetas compra/venta y comentarios distintos. Aunque las cifras puedan ser correctas, los nombres internos son ambiguos.

**Corrección:** definir contrato formal (`p2pBuyVesPerUsdt`, `p2pSellVesPerUsdt`) y migrar con adaptadores para no romper clientes.

#### DATA-005 — Fechas inválidas del historial caen en “ahora”

`parseHistorialDate()` devuelve `new Date()` cuando no puede analizar el dato. Esto puede dibujar puntos falsos actuales.

**Corrección:** devolver `null`, filtrar y registrar telemetría.

#### DB-001 — Faltan controles operativos de SQLite

No se observa `foreign_keys=ON`, `busy_timeout`, backups automáticos verificados, restore drill ni política de retención. El ZIP omite la DB, por lo que no se auditó su integridad real.

#### DB-002 — Eliminar usuarios deja cotizaciones/sesiones huérfanas

No hay claves foráneas ni transacción de limpieza/transferencia. Debe definirse política: archivar, transferir o eliminar en cascada de forma explícita.

#### OPS-002 — Presupuesto de memoria demasiado holgado para 1 GB

El proceso calculadora permite heap 512 MB y restart 512 MB; SETUP añade BCV API 200 MB, Nginx, PM2, OS y caché de archivos. En picos puede entrar en swap/OOM.

**Corrección inicial recomendada:** heap 256–320 MB, restart 350 MB, BCV API 160–192 MB, swap de emergencia 1 GB con baja swappiness, medición real antes de fijar.

#### OPS-003 — Documentación desactualizada/inconsistente

README indica defaults que ya no coinciden con `server.js`; STACK menciona Firebase que no está en `pubspec.yaml`; el plan móvil conserva 287 pendientes aunque ya hay funciones implementadas.

#### APP-002 — Release Android puede firmarse con debug silenciosamente

`build.gradle.kts` permite release con signing debug si falta `key.properties`. Útil localmente, peligroso para CI/publicación.

**Corrección:** fallar release/CI si no existe keystore; permitir fallback solo mediante flag explícito para builds locales no publicables.

---

## 4. Diseño objetivo: cotizaciones guardadas

### Estado inicial

Cada cotización debe aparecer **cerrada** como una fila/tarjeta compacta de 88–120 px:

- Nombre.
- Empresa.
- Fecha.
- Inversión total.
- Costo por unidad.
- Si existe: precio de venta y ganancia/margen.
- Botón primario **Simular venta**.
- Chevron accesible “Ver detalle”.
- Menú secundario: Editar, Compartir imagen, Eliminar.

No mostrar inicialmente dimensiones, volumen, peso, desglose de comisiones ni plan completo.

### Interacción

- Solo una tarjeta abierta a la vez en móvil.
- Expandir con botón semántico, `aria-expanded` y `aria-controls`.
- Conservar en URL o estado el ID abierto solo si aporta valor; no conservar múltiples IDs.
- En detalle: Resumen → Costos → Logística → Plan de venta → acciones peligrosas al final.
- Búsqueda con debounce de 250–350 ms.
- Filtros por empresa y “con/sin plan de venta”.
- Orden: recientes, inversión, nombre, ganancia.
- API paginada (`limit` máximo 50, cursor o `offset` estable).
- Skeleton inicial, estado vacío útil y reintento.

### “Simular venta” desde guardadas

Agregar `simularVentaDesdeCotizacion(id)`:

1. Obtener detalle por ID si no está en caché.
2. Crear un objeto de sesión de simulación separado; **no modificar el registro**.
3. Precargar:
   - costo unitario/caja,
   - unidades por caja,
   - unidades totales,
   - inversión total,
   - precio guardado si existe.
4. Mostrar banner: “Simulando: <nombre> · costos congelados de la cotización”.
5. Permitir elegir “usar tasas actuales” o “usar tasas guardadas”, si se empiezan a persistir snapshots.
6. CTA final separado:
   - “Guardar plan en la cotización” (PUT explícito),
   - “Cerrar sin guardar”.
7. Volver a la cotización y refrescar solo esa fila.

---

## 5. Diseño objetivo: simulador de venta

### Flujo progresivo

**Paso 1 — ¿Qué estás simulando?**

- “Cotización actual”, “Cotización guardada” o “Costo manual”.
- Si es guardada, selector buscable.
- Mostrar un resumen del costo detectado.

**Paso 2 — ¿Cómo venderás?**

- Por unidad / por caja.
- Precio en USD / precio en Bs. / rentabilidad deseada.
- Evitar llamar “Margen (%)” al ROI. Ofrecer dos conceptos si ambos son necesarios:
  - “Rentabilidad sobre costo (ROI)”.
  - “Margen sobre precio de venta”.
- Texto corto explicativo y ejemplo.

**Paso 3 — Resultado**

Primero mostrar solo:

- Precio de venta.
- Ganancia por unidad/caja.
- Ganancia total proyectada.
- ROI y margen, claramente diferenciados.
- Punto de equilibrio.

Los equivalentes BCV, Bs., recuperación de inversión y sparkline deben ir bajo “Ver análisis completo”.

### Reglas funcionales

- Bloquear cero, negativos, `NaN`, infinitos y valores fuera de rangos razonables.
- No calcular hasta tener costo válido.
- Mostrar qué tasa se utilizó, su hora y si está obsoleta.
- Redondear únicamente para mostrar; calcular con precisión completa.
- Mantener funciones puras y cubrirlas con vectores de prueba.
- Definir exactamente si los presets +20/+30/+50 son ROI sobre costo; rotularlos así.

---

## 6. Diseño objetivo: login DAYZO

No debe ser una tarjeta genérica centrada. Propuesta:

- Layout dividido en desktop; una sola columna limpia en móvil.
- Panel de identidad con logo DAYZO, una frase propia: **“Costos reales para importar y vender en Venezuela.”**
- Muestra de producto auténtica: mini resumen de cotización, no tres tarjetas decorativas de tasas.
- Formulario con jerarquía simple, sin exceso de iconos.
- Un único CTA dominante.
- Registro en ruta propia o transición clara, no dos pestañas visualmente idénticas.
- Indicador discreto: “Sesión segura · cookie HttpOnly · 7 días”.
- Autocomplete correcto (ya existe en web; conservar).
- Estados de error junto al campo y resumen accesible.
- `aria-live`, focus management y targets >=44 px.
- Añadir recuperación de contraseña solo después de diseñar el flujo real (token de un uso, expiración, email); no crear un botón falso.
- No revelar si existe un correo en recuperación/registro más allá de lo necesario.
- Reducir CSS inline: `public/css/auth.css` y `public/js/auth.js`.

---

## 7. Plan maestro por fases — ejecución continua en una única sesión

> **Instrucción central:** las fases siguientes no son prompts separados ni puntos de espera. Son una sola cadena de ejecución. El agente debe completar el gate de cada fase, registrar evidencia y continuar inmediatamente con la siguiente dentro del mismo chat. Si algo falla, lo corrige y repite; no pregunta ni se detiene.

### Convención de seguimiento obligatoria

Cursor debe crear `docs/MEJORA-MAESTRA-DAYZO.md` con esta cabecera:

```md
# Estado de mejora DAYZO
Última actualización: <ISO>
Rama: <rama>
Commit base: <hash>
Fase actual: <número y nombre>

## Estados
- [ ] PENDIENTE
- [~] EN CURSO
- [x] COMPLETADO
- [!] BLOQUEADO

## Registro por tarea
- ID:
- Estado:
- Archivos:
- Evidencia:
- Comandos:
- Resultado:
- Riesgo/rollback:
- Pendiente siguiente:
```

Nunca marcar `[x]` sin evidencia de comandos y prueba manual/automática.

### Fase 0 — Línea base, respaldo y mapa

- [ ] Crear rama `improvement/dayzo-web-first-2026`.
- [ ] Registrar commit base y `git status`.
- [ ] Copia segura de DB con API de backup de SQLite o `.backup`; no copiar en caliente con `cp`.
- [ ] Exportar esquema e integridad: `PRAGMA quick_check`, conteos sin PII.
- [ ] Documentar contratos actuales y ejemplos anonimizados.
- [ ] Instalar exactamente desde lockfile en máquina de desarrollo.
- [ ] Añadir scripts `check`, `test`, `test:integration`, `test:e2e`.
- [ ] Tomar capturas desktop 1440, móvil 390 y 360 de login, simulador y cotizaciones.
- [ ] Medir Lighthouse/Performance, payloads, memoria PM2 y tamaño DB.

**Gate:** no modificar funcionalidad hasta tener baseline y rollback.

### Fase 1 — Emergencia de seguridad y producción

- [ ] Eliminar secretos fallback del ecosystem.
- [ ] Separar bootstrap/reset admin del arranque normal.
- [ ] Exigir `SESSION_SECRET` fuerte en producción.
- [ ] Añadir `HOST=127.0.0.1` y bind explícito.
- [ ] Corregir manejo fatal de excepciones.
- [ ] Corregir normalización de URL.
- [ ] Revisar UFW: solo 22,80,443; 3001/3002 no públicos.
- [ ] Rotar password admin y session secret al desplegar; cerrar sesiones antiguas.
- [ ] Pruebas de login, CSRF, logout y roles.

**Gate:** pruebas y smoke local; deploy canary/ventana corta; rollback probado.

### Fase 2 — Núcleo canónico de cálculos

- [ ] Crear módulo de dominio de importación sin DOM.
- [ ] Definir DTO de entradas base y derivados.
- [ ] Validar rangos y unidades.
- [ ] Recalcular cotización en servidor.
- [ ] Congelar versión de fórmula (`calculationVersion`).
- [ ] Añadir snapshot de parámetros: tarifa empresa, comisiones, CNY, timestamp.
- [ ] Añadir vectores de prueba de GCCARGO, Orinoco mínimo, import2ven por peso/volumen, múltiples cajas, envío China, ROI/margen.
- [ ] Migrar datos legacy de forma aditiva; nunca destruir originales sin backup.

**Gate:** resultados actuales válidos deben mantenerse dentro de tolerancia documentada.

### Fase 3 — Contrato/API de cotizaciones

- [ ] Lista resumida sin `quote` completo.
- [ ] Paginación y límite máximo.
- [ ] Detalle por UUID.
- [ ] Respuestas de error uniformes `{success:false,error:{code,message}}`.
- [ ] Aislamiento por usuario e IDOR tests.
- [ ] Política al eliminar usuario.
- [ ] Índices/`foreign_keys`, `busy_timeout` y transacciones.
- [ ] Compatibilidad temporal para web vieja durante despliegue.

### Fase 4 — Cotizaciones compactas

- [ ] Acordeón cerrado por defecto.
- [ ] Solo una abierta.
- [ ] Búsqueda/filtrado/orden/paginación.
- [ ] Carga de detalle bajo demanda.
- [ ] Menú secundario y confirmaciones accesibles.
- [ ] Acción primaria “Simular venta”.
- [ ] E2E con 0, 1, 20, 100+ cotizaciones.

### Fase 5 — Simulador comprensible

- [ ] Flujo de tres pasos.
- [ ] Fuente guardada/manual/actual.
- [ ] Precarga desde cotización sin mutación.
- [ ] Diferenciar ROI y margen.
- [ ] Estado de tasa y frescura.
- [ ] Guardar plan solo con confirmación.
- [ ] Pruebas de cálculo y E2E móvil.

### Fase 6 — Login con identidad DAYZO

- [ ] Separar CSS/JS.
- [ ] Rediseño propio responsive.
- [ ] Mantener autocomplete.
- [ ] Estados de carga/error accesibles.
- [ ] Validar `next` solo same-origin (el código actual ya parece filtrar; añadir tests).
- [ ] Preparar, no fingir, recuperación de contraseña.
- [ ] Capturas y revisión visual 390/1440.

### Fase 7 — Consistencia de tasas

- [ ] Reemplazar CNY fijo por snapshot dinámico + fallback visible.
- [ ] Renombrar semántica BUY/SELL con adaptador.
- [ ] `lastAttemptAt` vs `lastSuccessAt`.
- [ ] Estado stale en web.
- [ ] Lock de actualización Binance.
- [ ] TLS BCV estricto/fallback controlado.
- [ ] Validación de saltos anómalos y telemetría.
- [ ] Fechas inválidas no deben convertirse en “ahora”.

### Fase 8 — Modularización, rendimiento y accesibilidad

- [ ] Dividir `app.js` por dominios sin cambiar framework.
- [ ] Retirar handlers inline.
- [ ] Dividir CSS por componentes/tokens.
- [ ] Fijar/self-host dependencias.
- [ ] Endurecer CSP gradualmente.
- [ ] Reducir DOM, payload y trabajo en cambios WebSocket.
- [ ] Debounce, abort controllers y reconexión WS con backoff+jitter/heartbeat.
- [ ] WCAG AA, teclado, focus, reduced motion, 44x44.
- [ ] Lighthouse móvil y presupuesto de rendimiento.

### Fase 9 — Operación VPS de 1 GB

- [ ] Medir RSS real 24 h antes de fijar límites.
- [ ] Heap calculadora 256–320 MB como punto inicial; `max_memory_restart` ~350 MB.
- [ ] BCV API 160–192 MB si sigue separada.
- [ ] Swap 1 GB de emergencia, no sustituto de RAM.
- [ ] Logrotate PM2/Nginx y límites.
- [ ] Backup diario SQLite con verificación y retención 7/4/6 (diario/semanal/mensual).
- [ ] Copia off-site cifrada y restore drill mensual.
- [ ] Health interno mínimo sin secretos; readiness de DB/fuentes por separado.
- [ ] Nginx timeouts, WebSocket, body limit y headers.
- [ ] Runbook de deploy atómico y rollback.

### Fase 10 — Cierre web

- [ ] Unit, integration y E2E verdes.
- [ ] Pruebas de regresión de cálculos.
- [ ] Seguridad: auth/CSRF/IDOR/rate limits/CSP.
- [ ] Pruebas responsive y accesibilidad.
- [ ] Deploy y observación 30–60 min.
- [ ] No avanzar a móvil hasta firmar el gate web.

### Fase 11 — App Flutter después de la web

- [ ] Cambiar IDs de cotización a String UUID en todo el flujo.
- [ ] Sincronizar DTO/API nueva y errores.
- [ ] Reutilizar las mismas reglas/fixtures de cálculo.
- [ ] Sustituir CNY fijo.
- [ ] Corregir auth bootstrap/router refresh si las pruebas muestran redirecciones obsoletas.
- [ ] Mejorar lista/detalle de cotizaciones y añadir simulación desde guardadas.
- [ ] Revisar alertas, offline, historial y widget.
- [ ] Actualizar plan móvil real; eliminar documentación obsoleta.
- [ ] `flutter analyze`, `flutter test`, `flutter build apk --debug`.
- [ ] Release debe fallar sin keystore; AAB firmado reproducible.
- [ ] Pruebas en Android 7, Android reciente, red lenta/offline y proceso reiniciado.

---
--

## 9. Comandos mínimos que Cursor debe dejar disponibles

Propuesta de scripts:

```json
{
  "scripts": {
    "check:js": "node --check src/server.js && node --check src/validators.js && node --check src/sqlite-session-store.js && node --check public/app.js",
    "test": "node --test test/unit/**/*.test.js",
    "test:integration": "node --test test/integration/**/*.test.js",
    "test:e2e": "playwright test",
    "check": "npm run check:js && npm test && npm run test:integration && npm run build:css"
  }
}
```

Si el shell no expande `**`, usar un runner/directorio compatible o listar `node --test test/unit`.

Producción:

```bash
npm ci --omit=dev
npm run build:css
NODE_ENV=production node src/server.js
```

Verificaciones VPS:

```bash
ss -lntp | grep -E ':3001|:3002'
ufw status verbose
pm2 status
pm2 monit
curl -fsS http://127.0.0.1:3001/health-internal
sqlite3 data/historial.db 'PRAGMA quick_check;'
```

No crear `/health-internal` público sin protección de red; puede ser loopback-only o token de monitoreo correctamente gestionado.

---

## 10. Criterio de “100%” realista

No existe garantía absoluta de cero bugs. La definición profesional para este proyecto debe ser:

- Cero críticos/altos conocidos abiertos.
- Tests unitarios/integración/E2E verdes.
- Cálculos canónicos y versionados.
- Rollback y restore probados.
- Accesibilidad y responsive verificados.
- Presupuesto de memoria y rendimiento medido.
- Producción observada sin regresiones.
- Checklist con evidencia, no solo afirmaciones de la IA.

Ese estándar sí convierte la mejora en verificable y evita que Cursor “termine” dejando fases incompletas.
