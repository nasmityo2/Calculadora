# DAYZO — Tracker final (web login, cotizaciones, mobile)

Última actualización: 2026-07-19T06:15:00Z  
Rama: `main` (trabajo local)  
Base commit: `b3cb9f0`  
Plan rector: `DAYZO_PLAN_FINAL_COMPLETAR_WEB_LOGIN_COTIZACIONES_MOBILE.md`  
Fase actual: web local cerrada; mobile PAUSADO por instrucción del usuario

## Estados

- [ ] PENDIENTE
- [~] EN CURSO
- [x] COMPLETADO (solo con evidencia)
- [!] BLOQUEADO EXTERNO
- [-] PAUSADO

## Resumen de fases

- [x] Fase 0 — Revalidación
- [x] Fase 1 — Local robusto
- [x] Fase 2 — Contrato CNY/USD v3
- [x] Fase 3 — Entrada dual
- [x] Fase 4 — Cotizaciones E2E
- [x] Fase 5 — Detalle premium
- [x] Fase 6 — Login premium
- [x] Fase 7 — Modularización
- [x] Fase 8 — Gate web local (deploy VPS [!])
- [~] Fase 9 — Flutter contrato (hecho en background antes del pause; analyze/test verdes; cmdline-tools Android pendiente)
- [-] Fase 10 — Flutter paridad (PAUSADO por usuario)
- [-] Fase 11 — Flutter release (PAUSADO por usuario)
- [ ] Fase 12 — Cierre

## Contraste tracker previo vs código (F0)

Falsos o incompletos respecto al plan final:

| Afirmación previa | Realidad en código |
|---|---|
| Web local “completa” | Entrada solo CNY; sin moneda original; detalle lazy incompleto; CNY histórico usa tasa actual |
| Login DAYZO propio | Patrón split SaaS + preview ficticio + claims HttpOnly |
| Modularización F8 | `app.js` ~3394 líneas; conviven lazy + legacy |
| Mobile bloqueado solo por VPS | Nuevo mandato: completar Flutter localmente; VPS no bloquea mobile |

## Fase 0 — Revalidación

- ID: F0-01 / toolchain e instalación
- Estado: [~]
- Archivos: `package-lock.json`, `node_modules`
- Evidencia: Node `v24.15.0`, npm `11.12.1`; `npm ci` → 376 paquetes, 0 vulnerabilidades; `public/tailwind.css` presente; Flutter CLI ausente al inicio (instalación en curso).
- Comandos: `npm ci`
- Resultado: instalación limpia reproducible.
- Riesgo/rollback: ninguno.
- Siguiente: ejecutar check/E2E y escenarios A–D.

- ID: F0-02 / verdades confirmadas en código
- Estado: [x]
- Archivos: `public/index.html`, `public/app.js`, `src/domain/import-calculation.js`, `mobile/lib/data/models/import_quote.dart`, `public/login.html`
- Evidencia:
  1. `g-precio` label “Precio unidad (CNY)”; hint rápido “Precio CNY”.
  2. `calcImport` hace `parseLocaleAmount(p[3]) / getCnyRate()` siempre.
  3. Dominio v2 solo `precioMercanciaPorUnidadUSD`; sin `purchasePrice`.
  4. `computeImportQuoteDetailLabels` usa `getCnyRate()` no `rateSnapshot.cny`.
  5. Lazy detail omite comparador compra vs final; existe `buildImportQuoteCardHTMLLegacy`.
  6. Login: split + preview + “Cookie HttpOnly” / “Bienvenido”.
  7. Flutter: `ImportQuoteListItem.id` es `int`; `tasaSegura = 6.53`.
- Comandos: grep/lectura estática.
- Resultado: verdades del mandato confirmadas.
- Riesgo/rollback: solo lectura.

- ID: F0-03 / causa exacta “guardado local roto”
- Estado: [~]
- Hipótesis a verificar con evidencia runtime:
  - Abrir `public/index.html` vía `file://` → sin origen HTTP → fetch a API falla → mensaje genérico.
  - ZIP sin `historial.db` de usuario → lista vacía correcta tras registro.
  - Sin `npm ci` → Chart/FA locales ausentes.
- Siguiente: reproducir A–D y capturar mensajes.

## Decisiones de esta sesión

Ver `docs/DECISIONES-DAYZO.md` (ADR-010 en adelante).
