# Informe final de mejora DAYZO

Fecha: 2026-07-17  
Rama: `improvement/dayzo-web-first-2026`  
Base: `0c2973ca428a9e9df9ba65d288a92e475bdcad55`

## Resultado

La web queda **aprobada localmente para desplegar**, con tests, producción
smoke, backup/restore, seguridad, responsive y Lighthouse verdes. No se declara
“WEB APROBADA EN PRODUCCIÓN” porque esta sesión no dispone de acceso SSH/VPS,
DNS/Certbot ni destino off-site para ejecutar deploy, rollback real y observar
30–60 minutos. Mobile no se modificó: el mandato exige esperar ese gate remoto.

## Cambios entregados

- Producción fail-closed: secretos sin fallback, bootstrap admin de una vez,
  CLI de reset, loopback y salida fatal no cero.
- Cálculo canónico `dayzo-import-v2`: entradas validadas y todos los derivados
  recalculados por el servidor.
- API v2 de cotizaciones: resumen paginado, detalle UUID, errores uniformes,
  IDOR/CSRF y FK `ON DELETE RESTRICT`.
- Cotizaciones compactas: búsqueda/filtros/orden/cargar más, un detalle lazy,
  reintento, menú secundario y “Simular venta”.
- Simulador en tres pasos, ROI vs margen, fuente guardada aislada y guardar o
  cancelar explícitamente.
- Login DAYZO propio, responsive y accesible, sin recuperación ficticia.
- CNY dinámico, frescura por fuente, cache stale explícito, TLS estricto,
  validación de saltos y scheduler Binance sin solape.
- CSP de scripts estricta, cero handlers/scripts inline, assets self-hosted,
  módulos Vanilla testeables, tokens CSS y WebSocket con heartbeat/backoff.
- VPS 1 GB: heap 320 MB/restart 350 MB, health loopback sin PII, backup diario,
  preflight, deploy/rollback atómico, Nginx/UFW/swap/logrotate/systemd.

## Evidencia final

- Instalación limpia: `npm ci`, 376 paquetes, 0 vulnerabilidades.
- Producción-only: `npm ci --omit=dev`, 136 paquetes, 0 vulnerabilidades.
- Unit: 31/31.
- Integración: 3/3 (auth, sesión, CSRF, roles, IDOR, API, FK, health, CSP).
- E2E: 3/3 (auth 390/1440, rate limit, 0/1/20/100 cotizaciones, lazy retry,
  simulación cancel/save).
- Smoke producción: ready, CSP ok, bind loopback, 76 MB RSS.
- Backup local: quick_check ok y restore drill ok.
- Responsive: 1440/390/360 sin overflow.
- Lighthouse final:
  - Login: 100 performance / 100 accesibilidad / 100 buenas prácticas / 100 SEO.
  - App: 82 / 100 / 96 / 100.
- Cotizaciones (20):
  - payload 26,461 → 10,285 bytes (−61.1%);
  - DOM 2,341 → 1,280 nodos (−45.3%).
- RSS de captura: 82 MB; PM2 production medido: 76.4 MB.

La fuente BCV local falló con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; el resultado
esperado fue fail-closed: no avanzó `lastSuccessAt`, se conservó cache y la UI
mostró degraded/stale. No se activó el fallback TLS inseguro.

## Bloqueos externos exactos

1. Acceso autorizado al VPS para instalar configuración, verificar bind/UFW,
   Nginx/systemd y ejecutar deploy/rollback.
2. Secret real `SESSION_SECRET` de 64+ caracteres en
   `/etc/dayzo/calculadora.env`; no debe enviarse por chat/Git.
3. Destino off-site cifrado y política 7 diarios/4 semanales/6 mensuales.
4. Observación 30–60 min del release y 24 h de RSS/heap/swap.
5. Después del gate web: Flutter SDK/Android SDK y keystore de release en CI.

## Deploy y rollback

En CI, antes de empaquetar:

```bash
npm ci
npm run check
npm run test:e2e
npm audit --audit-level=moderate
```

En VPS:

```bash
sudo deploy/setup-vps.sh
sudo install -m 0640 -o root -g dayzo deploy/calculadora.env.example /etc/dayzo/calculadora.env
# Completar SESSION_SECRET mediante canal seguro.
sudo nginx -t
sudo deploy/deploy.sh /root/dayzo-release.tar.gz
curl -fsS http://127.0.0.1:3001/health-internal
```

Rollback:

```bash
sudo deploy/rollback.sh
```

El procedimiento completo y verificaciones posteriores están en
`docs/RUNBOOK-PRODUCCION.md`.

## Mobile pendiente por orden del gate

La auditoría está confirmada pero no implementada:

- IDs `int` incompatibles con UUID String en modelo/repo/provider/ruta/detalle.
- CNY fijo 6.53 en calculadora y tests.
- Cliente de lista aún espera contrato anterior.
- Release Android cae silenciosamente a firma debug sin keystore.

Estas tareas comienzan únicamente después de desplegar/observar la web y marcar
el gate remoto como aprobado.
