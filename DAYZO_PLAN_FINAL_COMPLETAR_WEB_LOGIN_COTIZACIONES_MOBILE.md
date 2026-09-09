# DAYZO — Plan final de corrección y terminación total

**Base auditada:** `Calculadora-main.zip` recibido el 17 de julio de 2026  
**Objetivo:** cerrar los pendientes reales de la web, rehacer el login con calidad premium no genérica, reparar cotizaciones guardadas, añadir entrada inteligente CNY/USD, mostrar el desglose completo sin sobrecargar y terminar después la app Flutter.

---

# MANDATO PRINCIPAL: TODO EN UNA ÚNICA SESIÓN AUTÓNOMA

Este plan está diseñado para entregarse completo a un agente potente de Cursor y ejecutarse en **una sola sesión de chat**, de principio a fin.

El agente:

- No debe separar las fases en conversaciones nuevas.
- No debe detenerse al terminar una fase.
- No debe pedir “confírmame”, “¿continúo?” o “¿qué diseño prefieres?”.
- Debe tomar decisiones conservadoras según seguridad, exactitud monetaria, cero regresiones, experiencia premium, accesibilidad, mantenibilidad y consumo bajo de recursos.
- Si un comando falla, debe diagnosticar, corregir y repetirlo hasta dejarlo verde.
- Si falta una dependencia o herramienta necesaria, debe instalarla de forma reproducible y continuar.
- Debe registrar todo en documentos persistentes para no perder contexto durante la sesión larga.
- Debe terminar primero la web; después debe completar Flutter dentro de la misma sesión.
- Solo puede dejar bloqueado aquello que requiera un secreto o acceso externo real que no exista: SSH del VPS, keystore privado, DNS, SMTP o Firebase. Incluso entonces debe terminar todo lo demás y preparar el punto bloqueado en modo fail-closed.
- La única respuesta al usuario debe producirse al finalizar todo lo técnicamente ejecutable.

---

## 1. Estado real encontrado

El plan anterior produjo mejoras importantes y verificables:

- Seguridad de producción fail-closed.
- Backend autoritativo para cálculos monetarios.
- API v2 paginada de cotizaciones.
- Tarjetas compactas y detalle bajo demanda.
- Simulación desde una cotización guardada.
- CNY dinámico en la web.
- Pruebas Node, integración y Playwright.
- CSP de scripts más estricta y assets locales.
- Scripts de backup, deploy y rollback.

Sin embargo, el proyecto **no está terminado**. El documento `docs/MEJORA-MAESTRA-DAYZO.md` marca web local como completa y mobile como bloqueado, pero el código actual todavía conserva huecos importantes relacionados directamente con la nueva solicitud.

### Pendientes confirmados en código

1. **La cotización rápida acepta únicamente CNY.**
   - `public/index.html` etiqueta `g-precio` como “Precio unidad (CNY)”.
   - El formato rápido interpreta siempre el cuarto valor como CNY.
   - `calcImport()` divide siempre el precio por `getCnyRate()`.

2. **No se persiste correctamente la moneda original de compra.**
   - Solo se almacena `precioMercanciaPorUnidadUSD`.
   - No existen campos canónicos para moneda original, importe original ni conversión usada.
   - Al reconstruir una cotización para editar, se convierte otra vez desde USD a CNY usando la tasa actual, no la tasa congelada de la cotización.

3. **El detalle compacto de cotización está incompleto.**
   - `buildImportQuoteLazyDetailHTML()` no muestra el precio inicial de compra en USD/CNY.
   - Tampoco muestra el costo final unitario en ambas monedas de forma destacada.
   - El detalle antiguo contiene parte de esos datos, pero el flujo nuevo de “Ver detalle” usa el renderer lazy incompleto.

4. **Los equivalentes CNY de cotizaciones guardadas cambian con la tasa actual.**
   - `computeImportQuoteDetailLabels()` usa `getCnyRate()`.
   - El backend ya guarda `rateSnapshot.cny`, pero la UI no lo usa para representar el valor histórico.
   - Una cotización guardada hoy puede verse con otro equivalente CNY mañana, perdiendo trazabilidad.

5. **Conviven dos sistemas de detalle.**
   - Renderer compacto/lazy nuevo.
   - Renderer legacy completo y panel móvil para edición.
   - Esto aumenta `public/app.js` a 3394 líneas y crea riesgo de diferencias entre “ver”, “editar”, “imagen” y “simular”.

6. **Las cotizaciones pueden parecer rotas al abrir el proyecto localmente.**
   - El ZIP de GitHub no incluye `historial.db` ni sesiones/usuarios reales.
   - Abrir `public/index.html` mediante `file://` no puede acceder a Express, SQLite, sesión ni CSRF.
   - Sin `npm ci`, faltan Chart.js y Font Awesome locales.
   - La UI solo presenta “No se pudieron cargar las cotizaciones”, sin diagnóstico útil del entorno.
   - La copia local comienza sin cotizaciones del usuario, porque los datos reales no se versionan, lo cual es correcto pero debe explicarse.

7. **El login fue rediseñado, pero sigue usando un patrón reconocible de plantilla.**
   - Layout dividido 50/50.
   - Hero con titular grande.
   - Tarjeta ficticia de ejemplo.
   - Pestañas Ingresar/Crear cuenta.
   - Lista de claims “Sesión segura / Cookie HttpOnly / 7 días”.
   - Es funcional y accesible, pero visualmente puede sentirse generado por IA porque combina patrones muy repetidos de SaaS/fintech.

8. **La app Flutter continúa sin adaptar.**
   - UUID del backend tratados como `int`.
   - Repositorio y rutas antiguas.
   - CNY fijo `6.53`.
   - API v2 paginada no implementada.
   - No incorpora la nueva entrada USD/CNY ni el desglose final.
   - Release puede caer en firma debug si no hay keystore.

9. **Hay afirmaciones del tracker que deben revalidarse.**
   - El ZIP entregado no contiene `.git`, por lo que no se pueden comprobar los commits pequeños mencionados.
   - Los artefactos y documentos declaran tests verdes, pero la nueva sesión debe ejecutar nuevamente todo desde instalación limpia.

---

## 2. Diagnóstico de cotizaciones guardadas en local

Antes de modificar funcionalidad, el agente debe reproducir cuatro escenarios distintos:

### Escenario A — Apertura incorrecta con `file://`

Resultado esperado: la página debe detectar que no está siendo servida por HTTP y mostrar un aviso claro:

> “DAYZO necesita ejecutarse con el servidor local. Usa `npm run dev` y abre la URL indicada.”

No debe mostrar simplemente “Error cargando cotizaciones”.

### Escenario B — Servidor local limpio, sin DB previa

- `npm ci`.
- `npm run dev`.
- Abrir `http://127.0.0.1:3001/calculadoraa`.
- Crear una cuenta de prueba mediante registro.
- Login.
- Crear, listar, abrir, editar, simular y eliminar una cotización.

Resultado esperado: SQLite se crea automáticamente y el flujo funciona sin requerir admin.

### Escenario C — Sesión expirada o CSRF inválido

Resultado esperado:

- Conservar `next`.
- Redirigir al login.
- Después del login, regresar a la vista de importación.
- No perder los datos no guardados de una cotización actual si pueden conservarse de forma segura en `sessionStorage`.

### Escenario D — API caída o contrato inválido

La UI debe diferenciar:

- Sin backend.
- No autenticado.
- Sesión expirada.
- CSRF inválido.
- Error de validación monetaria.
- Error interno.
- Sin cotizaciones todavía.

No exponer stack ni detalles sensibles.

---

## 3. Entrada inteligente CNY/USD

### Decisión de UX

No intentar adivinar la moneda únicamente por el valor numérico. `4.5` puede ser CNY o USD. La inteligencia debe venir de señales explícitas y una selección persistente, no de una heurística peligrosa.

### Modo guiado

Reemplazar el campo fijo “Precio unidad (CNY)” por:

- Label: **Precio de compra por unidad**.
- Segmented control dentro del campo: `CNY ¥` / `USD $`.
- Un único input numérico.
- Debajo, equivalencia en vivo:
  - Si escribe `¥32,50`: “≈ $4.98 por unidad · tasa 6,53 CNY/USD”.
  - Si escribe `$4.98`: “≈ ¥32,52 por unidad”.
- Guardar la última selección del dispositivo en `localStorage`, pero cada cotización debe guardar su propia moneda.
- El cambio de moneda no debe reinterpretar silenciosamente el mismo número. Debe convertir el valor para mantener el mismo costo económico y mostrar una microconfirmación visual.

### Modo rápido

Aceptar sintaxis explícita:

```text
30x30x30 15 50 32.5cny
30x30x30 15 50 ¥32,5
30x30x30 15 50 4.98usd
30x30x30 15 50 $4.98
30x30x30 15 50 32.5 CNY 4 2
30x30x30 15 50 4.98 USD 4 2
```

Reglas:

1. Sufijos no sensibles a mayúsculas: `cny`, `rmb`, `yuan`, `usd`.
2. Prefijos: `¥`, `$`, `US$`.
3. Si el valor no incluye moneda, usar la moneda seleccionada en el control CNY/USD y mostrarla claramente en el hint.
4. No inferir por magnitud.
5. Soportar coma o punto decimal y separadores locales sin confundir miles.
6. Mostrar error específico con ejemplo válido si la cadena es ambigua.
7. El parser rápido debe producir el mismo DTO estructurado que el modo guiado.
8. Agregar tests unitarios para todas las variantes y casos ambiguos.

### Contrato canónico v3

Evolucionar de `dayzo-import-v2` a `dayzo-import-v3`, de forma aditiva:

```json
{
  "purchasePrice": {
    "amount": 32.5,
    "currency": "CNY"
  },
  "cnyRateRequested": null,
  "empresaTarifaUSD": 865,
  "cajas": 2,
  "unidadesPorCaja": 50,
  "dimensionesCm": { "l": 30, "w": 30, "h": 30 },
  "pesoPorCajaKg": 15,
  "envioChinaPorCajaUSD": 4,
  "feePlataforma": 0.03,
  "feeBanco": 0.0125
}
```

El backend debe:

- Validar `currency` contra `CNY|USD`.
- Para CNY, convertir usando la tasa CNY del servidor.
- Para USD, no aplicar conversión al cálculo base.
- Guardar el precio original y su moneda.
- Guardar la contraparte convertida.
- Guardar `rateSnapshot.cny`, `source`, `capturedAt` y `stale`.
- Ignorar tasas arbitrarias enviadas por el cliente.
- Mantener lectura de v1/v2 mediante adaptador.
- No migrar destructivamente las 12 cotizaciones existentes.

Campos derivados recomendados:

```json
{
  "purchasePriceOriginalAmount": 32.5,
  "purchasePriceOriginalCurrency": "CNY",
  "precioMercanciaPorUnidadUSD": 4.9770290965,
  "precioMercanciaPorUnidadCNY": 32.5,
  "costoMercanciaUSD": 497.70290965,
  "costoMercanciaCNYEquivalent": 3250,
  "costoUnitarioUSD": 7.21,
  "costoUnitarioCNYEquivalent": 47.08,
  "costoPorCajaUSD": 360.5,
  "costoPorCajaCNYEquivalent": 2354.07
}
```

Los equivalentes CNY deben calcularse con la tasa congelada de la cotización, no con la tasa actual.

---

## 4. Nuevo detalle premium de cotización guardada

### Principio

Mostrar primero la respuesta a tres preguntas:

1. ¿Cuánto costaba el producto originalmente?
2. ¿Cuánto terminó costando puesto en Venezuela?
3. ¿Qué parte del costo provino de cada gasto?

### Nivel 1 — Resumen visible al expandir

Encabezado:

- Nombre.
- Empresa.
- Fecha/hora.
- Badge de moneda original: `Compra en CNY` o `Compra en USD`.
- Estado de tasa: oficial/fallback/stale.

Comparador principal de dos columnas:

**Precio de compra por unidad — sin gastos**

- Principal: moneda original.
- Secundario: contraparte convertida.
- Ejemplo: `¥32,50` y `$4.98`.

**Costo final por unidad — con todos los gastos**

- Principal: `$7.21`.
- Secundario: `≈ ¥47,08`.
- Badge: `+$2.23 por unidad en gastos` o `+44,8% sobre compra`.

Debajo:

- Inversión total.
- Costo por caja USD/CNY.
- Unidades totales.
- Número de cajas.

### Nivel 2 — “Cómo se formó el costo”

Un waterfall compacto, no un bloque enorme:

1. Mercancía.
2. Envío dentro de China.
3. Plataforma.
4. Banco.
5. Envío internacional.
6. Total.

Cada fila:

- Nombre.
- USD.
- Equivalente CNY en texto secundario.
- Porcentaje de la inversión total.

Visualmente usar una barra proporcional sutil por categoría, sin gráficos recargados.

### Nivel 3 — Logística

Colapsado inicialmente:

- Dimensiones por caja.
- Volumen por caja y total.
- Peso por caja y total.
- Densidad.
- Método de cobro.
- Tarifa de empresa.
- Mínimo aplicado.
- Link del producto.

### Nivel 4 — Venta

Si existe plan:

- Precio venta/unidad.
- Precio por caja.
- Ganancia unitaria.
- Ganancia total.
- ROI sobre costo.
- Margen sobre venta.
- Punto de equilibrio.

Si no existe:

- CTA **Simular venta con esta cotización**.

### Reglas de presentación

- Una sola cotización abierta a la vez.
- No duplicar panel legacy y panel lazy.
- Detalle accesible por teclado.
- Máximo dos niveles abiertos simultáneamente.
- No usar mini tarjetas para cada número.
- Usar tipografía tabular para dinero.
- CNY histórico con rate snapshot; equivalentes actuales solo bajo una acción separada “Ver con tasa actual”.
- Etiquetar “equivalente” para no confundir moneda realmente pagada con conversión informativa.

---

## 5. Login premium no genérico

### Problema del diseño actual

Aunque tiene buenos resultados Lighthouse, usa el patrón de SaaS generado por plantilla: hero a la izquierda, formulario a la derecha, tarjeta de ejemplo y lista de claims de seguridad. Cambiar colores o agregar glassmorphism no resolverá el problema.

### Dirección visual obligatoria: “Mesa de costos de importación”

Crear una experiencia editorial y operativa propia de DAYZO:

- Fondo carbón profundo, sin degradados decorativos genéricos.
- Masthead DAYZO pequeño y preciso en la esquina superior.
- Composición asimétrica, no división 50/50.
- El elemento distintivo será una **ruta de formación del costo**, dibujada con CSS/SVG local:
  - Producto en China.
  - Conversión CNY→USD.
  - Comisiones.
  - Flete internacional.
  - Costo final.
- Cada nodo usa datos reales de una simulación anónima y se actualiza con la tasa pública disponible.
- El formulario se integra como una superficie sobria, no como tarjeta flotante genérica.
- Título corto y específico: **“Tus costos, sin adivinar.”**
- Subtítulo: **“Cotiza importaciones, congela tus números y simula cuánto vender.”**
- CTA: **“Entrar a mi mesa de costos”**.
- Registro en una ruta/estado claro, pero sin pestañas tipo dashboard si visualmente se siente genérico.
- Animación mínima: un pulso o recorrido de 500–700 ms en la cadena de costos; respetar reduced-motion.
- Sin fotos de stock, ilustraciones de IA, blobs, orbes, tarjetas flotantes aleatorias, emojis ni exceso de iconos.
- Sin frases como “Bienvenido de vuelta” o “Tu espacio” si no aportan identidad.
- No mostrar claims técnicos como Cookie HttpOnly al usuario como contenido principal. La seguridad debe estar implementada, no usada como decoración.

### Layout desktop

- Encabezado fino superior: DAYZO + “Tasas públicas” + enlace para volver.
- Columna editorial central 55–60% con la cadena de costo.
- Formulario anclado a la derecha, ancho 380–430 px, alineado con el centro visual.
- Mucho espacio negativo.
- Una sola acción primaria.

### Layout móvil

- Marca + frase corta.
- Formulario primero.
- Cadena de costos resumida debajo en cuatro pasos horizontales/verticales.
- Sin altura innecesaria antes del primer campo.
- Teclado no debe ocultar CTA.

### Calidad y validación visual

- Capturas obligatorias en 1440×1000, 1024×768, 390×844 y 360×800.
- Probar login, registro, loading, error, rate limit y offline.
- WCAG AA.
- Targets >=44 px.
- No overflow.
- Inspección visual real, no solo Lighthouse.
- Pedir a una segunda pasada del agente que critique específicamente “¿parece plantilla de IA?” y corregir cualquier patrón genérico detectado.

---

## 6. Plan de ejecución por fases

> Todas las fases se ejecutan continuamente dentro de la misma sesión. El agente corrige gates fallidos y avanza sin pedir permiso.

### Fase 0 — Revalidar la entrega anterior

- [ ] Instalar con `npm ci` desde el ZIP actual.
- [ ] Ejecutar `npm run check`, integración y E2E.
- [ ] Verificar que `public/tailwind.css` esté generado.
- [ ] Crear DB temporal limpia.
- [ ] Reproducir file://, servidor limpio, sesión expirada y API caída.
- [ ] Capturar estado actual de login/cotizaciones/importación.
- [ ] Comparar tracker contra código y crear lista honesta de falsos completados/parciales.
- [ ] Crear rama nueva si existe Git; si el ZIP no contiene `.git`, inicializar solo un repositorio local de trabajo o documentar el hash del ZIP, sin afirmar commits inexistentes.

**Gate:** baseline reproducible y causa del “guardado roto” identificada con evidencia.

### Fase 1 — Entorno local y diagnóstico robusto

- [ ] Añadir `npm run doctor:local`.
- [ ] Validar Node, dependencias, writable `DATA_DIR`, DB, migraciones, puerto y URL.
- [ ] `npm run dev` debe imprimir una única URL correcta.
- [ ] Detectar file:// y mostrar instrucción concreta.
- [ ] Añadir guía “Primer arranque local” de cinco comandos máximo.
- [ ] Estados específicos de error en cotizaciones.
- [ ] Preservar borrador actual durante re-login con sessionStorage, sin guardar secretos.
- [ ] E2E desde copia limpia sin DB.

### Fase 2 — Modelo monetario CNY/USD v3

- [ ] Crear parser puro de moneda de compra.
- [ ] Diseñar DTO v3 aditivo.
- [ ] Backend convierte CNY con tasa server-side y guarda snapshot.
- [ ] USD entra sin conversión base.
- [ ] Guardar original, contraparte y equivalentes finales.
- [ ] Adaptar v1/v2 al leer.
- [ ] No reinterpretar históricas con tasa actual.
- [ ] Tests unitarios, integración y fixtures compartidos.

### Fase 3 — UI guiada y rápida dual

- [ ] Segmented control CNY/USD.
- [ ] Conversión visible en vivo.
- [ ] Cambio de moneda convierte el valor, no cambia su significado.
- [ ] Parser rápido con símbolos/sufijos.
- [ ] Hint dinámico y ejemplos.
- [ ] Errores de ambigüedad.
- [ ] Persistir preferencia local y moneda por cotización.
- [ ] Probar coma/punto, móvil y pegado desde portapapeles.

### Fase 4 — Reparar de extremo a extremo las cotizaciones

- [ ] Crear/listar/abrir/editar/simular/guardar plan/imagen/eliminar.
- [ ] Corregir sesión, CSRF, paginación y errores.
- [ ] Eliminar dependencia del renderer legacy para ver detalle.
- [ ] Unificar transformaciones y labels.
- [ ] Edición conserva moneda original y rate snapshot.
- [ ] Imagen exportada incluye precio inicial/final USD/CNY.
- [ ] E2E con compra original CNY y USD.
- [ ] E2E limpio desde GitHub ZIP sin DB real.

### Fase 5 — Nuevo detalle premium

- [ ] Comparador compra vs costo final.
- [ ] Waterfall de costos.
- [ ] Logística colapsable.
- [ ] Plan de venta.
- [ ] Rate snapshot visible.
- [ ] Acción “equivalente con tasa actual” separada.
- [ ] Una sola cotización expandida.
- [ ] Sin sobrecarga y con visual QA 390/1440.

### Fase 6 — Login premium no plantilla

- [ ] Sustituir split SaaS y tarjeta ficticia.
- [ ] Implementar dirección “Mesa de costos”.
- [ ] Cadena de formación del costo con CSS/SVG propio.
- [ ] Formulario sobrio y editorial.
- [ ] Estados completos.
- [ ] Mantener seguridad y accesibilidad.
- [ ] Capturas e inspección crítica anti-plantilla.
- [ ] No sacrificar rendimiento.

### Fase 7 — Modularización final de web

- [ ] Extraer import parser/calculator/view-model.
- [ ] Extraer quote list/detail/editor/simulator.
- [ ] Eliminar renderer legacy muerto.
- [ ] Reducir `app.js` significativamente sin reescribir framework.
- [ ] CSS por componentes.
- [ ] Pruebas de contrato de módulos.
- [ ] Eliminar TODOs reales y docs obsoletos.

### Fase 8 — Gate web completo

- [ ] Unit/integration/E2E verdes.
- [ ] Auditoría 0 vulnerabilidades conocidas.
- [ ] Lighthouse y WCAG.
- [ ] Pruebas locales desde cero.
- [ ] Pruebas de cálculo con CNY/USD.
- [ ] Backup/restore.
- [ ] Smoke production.
- [ ] Runbook actualizado.
- [ ] Si no hay VPS, dejar deploy como bloqueo externo, pero no bloquear Flutter por una regla artificial: completar Flutter localmente y dejar únicamente publicación remota bloqueada.

### Fase 9 — Flutter: contrato y arquitectura

- [ ] Instalar/verificar Flutter estable, JDK y Android SDK.
- [ ] `flutter pub get`, analyze/test baseline.
- [ ] IDs UUID `String` en modelo, repo, provider, ruta, detalle y tests.
- [ ] API v2 paginada + filtros + detalle.
- [ ] Error uniforme y SessionExpired.
- [ ] CNY dinámico/fallback visible.
- [ ] Router refresca correctamente al cambiar auth.
- [ ] Eliminar documentación falsa/obsoleta.

### Fase 10 — Flutter: paridad funcional

- [ ] Login/registro premium coherente, no copia literal web.
- [ ] Tasas/historial/offline.
- [ ] Cotizaciones compactas.
- [ ] Detalle compra vs costo final USD/CNY.
- [ ] CRUD completo.
- [ ] Cotización guiada y rápida CNY/USD.
- [ ] Simulación desde guardada.
- [ ] Guardar/cancelar plan.
- [ ] Compartir imagen con desglose.
- [ ] Alertas y widget funcionales.
- [ ] Deep links y estados vacíos/error.

### Fase 11 — Flutter: QA y release

- [ ] Unit tests de moneda/cálculos/modelos.
- [ ] Widget tests de auth/cotizaciones/simulador.
- [ ] Integration tests del flujo principal.
- [ ] Offline, red lenta, sesión expirada y proceso muerto.
- [ ] Android 7 y Android reciente.
- [ ] `flutter analyze` 0 issues.
- [ ] `flutter test` verde.
- [ ] APK debug.
- [ ] Release debe fallar sin keystore.
- [ ] AAB firmado solo con keystore real/CI.
- [ ] README y changelog finales.

### Fase 12 — Cierre único

- [ ] Reejecutar web y Flutter desde instalaciones limpias.
- [ ] Informe de archivos, tests, métricas y riesgos.
- [ ] Checklist sin pendientes internos.
- [ ] Solo bloqueos externos legítimos.
- [ ] Comandos exactos de deploy web y publicación móvil.

---

## 7. Matriz mínima de pruebas nuevas

### Moneda

- CNY guiado.
- USD guiado.
- `32.5cny`, `32,5 CNY`, `¥32.5`.
- `4.98usd`, `4,98 USD`, `$4.98`, `US$4.98`.
- Sin sufijo usa selector.
- Moneda inválida.
- Número ambiguo.
- Cambio CNY→USD→CNY conserva valor económico dentro de tolerancia.
- Tasa fallback y stale visibles.

### Persistencia

- Guarda moneda original.
- Guarda amount original.
- Guarda snapshot.
- Lectura futura no cambia CNY histórico.
- Editar empresa no cambia precio original.
- Editar con tasa actual no reescribe snapshot sin confirmación.
- Legacy v1/v2 sigue abriendo.

### Desglose

- Compra inicial sin gastos USD/CNY.
- Mercancía total.
- Envío China.
- Plataforma.
- Banco.
- Internacional.
- Inversión total.
- Final por unidad/caja USD/CNY.
- Porcentajes suman de forma coherente.
- Redondeo solo visual.

### Local

- file://.
- npm sin instalar.
- DB inexistente.
- DB readonly.
- Puerto ocupado.
- Usuario no autenticado.
- Sesión expirada.
- CSRF inválido.
- Backend caído.

### Visual

- Login 1440/1024/390/360.
- Cotizaciones 0/1/20/100.
- Nombres largos.
- Cifras grandes.
- CNY/USD.
- Plan positivo/negativo/sin plan.
- Teclado y focus.
- Reduced motion.

---

