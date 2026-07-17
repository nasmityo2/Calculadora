# Runbook de producción DAYZO

Objetivo: desplegar y recuperar DAYZO en un VPS Ubuntu de 1 GB sin exponer Express ni arriesgar SQLite.

## Precondiciones fail-closed

- Node LTS soportado por el lockfile, Nginx, PM2 y `sqlite3`.
- `SESSION_SECRET` aleatorio de al menos 64 caracteres disponible solo en el entorno del host/secret manager.
- Express y BCV API escuchan únicamente en `127.0.0.1`.
- El primer admin se crea con bootstrap explícito; `ADMIN_PASSWORD` no permanece en el ecosystem ni se reutiliza en reinicios.
- El release Android requiere keystore; no se permite firma debug para release.

No pegar secretos en la shell compartida, Git, logs, tickets ni este documento.

## Backup consistente y restore drill

Con la aplicación activa, usar la API de backup de SQLite o `.backup`; nunca copiar el archivo WAL en caliente:

```bash
mkdir -p /var/backups/dayzo
sqlite3 /var/www/calculadora/current/data/historial.db \
  ".timeout 10000" \
  ".backup '/var/backups/dayzo/historial-$(date -u +%Y%m%dT%H%M%SZ).db'"
sqlite3 /var/backups/dayzo/historial-*.db 'PRAGMA quick_check;'
```

Restore drill aislado:

```bash
install -m 0600 /var/backups/dayzo/historial-AAAA.db /tmp/dayzo-restore.db
sqlite3 /tmp/dayzo-restore.db 'PRAGMA quick_check; SELECT COUNT(*) FROM tasas;'
rm -f /tmp/dayzo-restore.db
```

Retención inicial: 7 diarios, 4 semanales y 6 mensuales. Cifrar y copiar off-site; comprobar restauración mensualmente. Nunca imprimir filas de usuarios o cotizaciones en el informe.

## Deploy atómico

Estructura:

```text
/var/www/calculadora/
  releases/<timestamp>/
  shared/data/
  current -> releases/<timestamp>
```

Pasos:

```bash
set -euo pipefail
release="/var/www/calculadora/releases/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$release"
# Extraer artefacto verificado en "$release".
ln -s /var/www/calculadora/shared/data "$release/data"
cd "$release"
npm ci --omit=dev
npm run build:css
npm run check
SESSION_SECRET_FILE=/run/secrets/dayzo_session node scripts/preflight.js
ln -sfn "$release" /var/www/calculadora/current.next
mv -Tf /var/www/calculadora/current.next /var/www/calculadora/current
pm2 reload /var/www/calculadora/current/ecosystem.config.cjs --update-env
curl -fsS http://127.0.0.1:3001/health-internal
```

El secret puede inyectarse por systemd/secret manager en vez de archivo. `scripts/preflight.js` debe validar configuración sin imprimir valores.

## Rollback de un comando

Conservar el symlink anterior en `/var/www/calculadora/previous` durante el deploy:

```bash
ln -sfn "$(readlink -f /var/www/calculadora/previous)" /var/www/calculadora/current.next \
  && mv -Tf /var/www/calculadora/current.next /var/www/calculadora/current \
  && pm2 reload /var/www/calculadora/current/ecosystem.config.cjs --update-env \
  && curl -fsS http://127.0.0.1:3001/health-internal
```

No restaurar DB para un rollback de código si las migraciones fueron aditivas y compatibles. Restaurar DB solo ante corrupción confirmada, con el servicio detenido y preservando una copia forense.

## Nginx mínimo

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    client_max_body_size 512k;
    proxy_connect_timeout 5s;
    proxy_send_timeout 30s;
    proxy_read_timeout 65s;
}
```

Añadir en contexto `http`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
```

Validar: `nginx -t && systemctl reload nginx`.

## Firewall y bind

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ss -lntp | grep -E ':3001|:3002'
```

La salida debe mostrar `127.0.0.1`, nunca `0.0.0.0`/`[::]`, para 3001 y 3002.

## Memoria, swap y logs

Punto inicial, no garantía:

- calculadora: `--max-old-space-size=320`, reinicio PM2 a `350M`, una instancia.
- bcv-api: heap `160–192M`, reinicio bajo medición.
- swap de emergencia 1 GB, `vm.swappiness=10`; no usarlo como capacidad normal.

```bash
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl vm.swappiness=10
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

Observar 24 h: RSS, heap, reinicios, latencia, errores 5xx, fallos de fuentes y uso de swap.

## Verificación posterior

```bash
pm2 status
curl -fsS http://127.0.0.1:3001/health-internal
curl -fsSI https://dayzove.lat/login
sqlite3 /var/www/calculadora/shared/data/historial.db 'PRAGMA quick_check;'
journalctl -u nginx --since '-15 minutes' --no-pager
```

Pruebas manuales sin PII: login válido/inválido, logout, cálculo conocido, crear/ver/simular/editar/eliminar una cotización de prueba y WebSocket.

## Bloqueos externos

Desde una máquina local sin acceso al VPS no se pueden ejecutar UFW, Nginx, Certbot, rotación off-site, deploy, observación 30–60 min ni restore del backup real remoto. Estos gates permanecen bloqueados hasta disponer de acceso autorizado; no se simulan como completados.
