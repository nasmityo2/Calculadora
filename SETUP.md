# SETUP — Calculadora Pro + BCV API

> Este archivo contiene toda la configuración exacta para que una IA
> (Cursor, ChatGPT, Claude, etc.) pueda reinstalar el proyecto desde cero
> en un VPS recién formateado. Solo necesitas subir los archivos del backup.

---

## 1. Descripción general

Son **dos microservicios Node.js** que corren detrás de **nginx** como reverse
proxy con **SSL (Let's Encrypt / Certbot)**.

| Servicio     | Ruta                         | Puerto | Framework | Base de datos     |
|-------------|------------------------------|--------|-----------|-------------------|
| calculadora | `/var/www/calculadora`       | `3001` | Express 5 | SQLite (better-sqlite3) |
| bcv-api     | `/var/www/bcv-api`           | `3002` | Fastify 5 | SQLite (better-sqlite3) |

Dominio: **dayzove.lat** y **www.dayzove.lat**

---

## 2. Requisitos del sistema

### 2.1. Sistema operativo
- Ubuntu 22.04 o 24.04 LTS (x86_64)

### 2.2. Paquetes del sistema

```bash
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx curl
```

Para Node.js (versión 20 LTS):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
# Verificar: node --version  → v20.x.x
```

### 2.3. Instalar PM2 globalmente

```bash
npm install -g pm2
pm2 --version  # debe mostrar 5.x
```

### 2.4. Certbot / Let's Encrypt (SSL)

Los certificados SSL se gestionan con Certbot usando el plugin de nginx:

```bash
certbot --nginx -d dayzove.lat -d www.dayzove.lat
```

Esto modifica automáticamente `/etc/nginx/sites-available/default`.

---

## 3. Estructura de archivos del proyecto

### 3.1. calculadora (`/var/www/calculadora`)

```
/var/www/calculadora/
├── src/
│   ├── server.js          # Servidor Express (entrada principal)
│   ├── validators.js      # Validaciones
│   ├── bcv-vigencia.js    # Lógica de vigencia de tasas
│   └── sqlite-session-store.js  # Store de sesiones en SQLite
├── public/                # Frontend estático
├── styles/
│   └── tailwind-entry.css # Entrada de Tailwind
├── data/
│   ├── historial.db       # Base de datos SQLite (~127 MB)
│   ├── historial.db-shm   # WAL (se regenera solo)
│   ├── historial.db-wal   # WAL (se regenera solo)
│   ├── feriados-ve.json   # Calendario de feriados Venezuela
│   └── import_cotizaciones.json.migrated  # Migración legacy
├── scripts/
│   └── migrate.js         # Script de migración
├── docs/                  # Documentación
├── ecosystem.config.cjs   # Configuración PM2
├── package.json
├── tailwind.config.js
└── SETUP.md               # Este archivo
```

### 3.2. bcv-api (`/var/www/bcv-api`)

```
/var/www/bcv-api/
├── src/
│   ├── server.js          # Servidor Fastify (entrada principal)
│   ├── app.js             # Configuración de la app Fastify
│   ├── config/            # Configuración
│   ├── db/                # Capa de base de datos
│   ├── plugins/           # Plugins Fastify
│   ├── routes/            # Rutas de la API
│   ├── scheduler/         # Tareas programadas (scraping BCV)
│   ├── services/          # Lógica de negocio
│   └── utils/             # Utilidades
├── bin/
│   └── bcv-admin.js       # CLI admin
├── data/
│   ├── bcv.sqlite         # Base de datos SQLite
│   ├── bcv.sqlite-shm     # WAL (se regenera solo)
│   └── bcv.sqlite-wal     # WAL (se regenera solo)
├── logs/
│   ├── bcv-api.error.log  # Log de errores
│   └── bcv-api.out.log    # Log de salida
├── deploy/                # Scripts de deploy
├── backups/               # Backups automáticos
├── test/                  # Tests
├── .env                   # Variables de entorno (SECRETO — no compartir)
├── .env.example           # Template de variables de entorno
├── ecosystem.config.cjs   # Configuración PM2
├── package.json
└── README.md
```

---

## 4. Configuración de nginx

Ruta del archivo: `/etc/nginx/sites-available/default`

```
server {
    server_name dayzove.lat www.dayzove.lat;

    # API BCV — endpoint legado (raíz)
    location = /bcv-api {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 20s;
        proxy_read_timeout 25s;
    }

    # API BCV — resto bajo /bcv/
    location /bcv/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 20s;
        proxy_read_timeout 25s;
    }

    # Web principal (calculadora)
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade          $http_upgrade;
        proxy_set_header Connection       'upgrade';
        proxy_set_header Host             $host;
        proxy_set_header X-Real-IP        $remote_addr;
        proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/dayzove.lat/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dayzove.lat/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# Redirigir HTTP → HTTPS
server {
    if ($host = www.dayzove.lat) {
        return 301 https://$host$request_uri;
    }
    if ($host = dayzove.lat) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    server_name dayzove.lat www.dayzove.lat;
    return 404; # managed by Certbot
}
```

### Verificar sintaxis y recargar nginx

```bash
nginx -t
systemctl reload nginx
```

---

## 5. Configuración de PM2

### 5.1. Ecosystem calculadora

Ruta: `/var/www/calculadora/ecosystem.config.cjs`

```javascript
module.exports = {
  apps: [
    {
      name: 'calculadora',
      cwd: '/var/www/calculadora',
      script: '/var/www/calculadora/src/server.js',
      node_args: '--max-old-space-size=320',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOST: '127.0.0.1',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        HOST: '127.0.0.1',
        // SESSION_SECRET se inyecta desde el secret manager/entorno del host.
      },
    },
  ],
};
```

### 5.2. Ecosystem bcv-api

Ruta: `/var/www/bcv-api/ecosystem.config.cjs`

```javascript
module.exports = {
  apps: [
    {
      name: 'bcv-api',
      cwd: '/var/www/bcv-api',
      script: '/var/www/bcv-api/src/server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      node_args: '--max-old-space-size=192',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        HOST: '127.0.0.1',
      },
      error_file: '/var/www/bcv-api/logs/bcv-api.error.log',
      out_file: '/var/www/bcv-api/logs/bcv-api.out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
```

### 5.3. Variables de entorno bcv-api

Archivo: `/var/www/bcv-api/.env`

```
NODE_ENV=production
HOST=127.0.0.1
PORT=3002
LOG_LEVEL=info

BCV_URL=https://www.bcv.org.ve/
BCV_TIMEOUT_MS=20000
BCV_TLS_STRICT=0
BCV_MAX_RETRIES=3

SCHEDULER_ENABLED=1
TZ_BCV=America/Caracas
REFRESH_CRON=5 14-18 * * 1-5
SAFETY_CRON=0 9 * * *
FETCH_ON_BOOT=1
STALE_AFTER_HOURS=24

REQUIRE_KEY_FOR_RATE=0
CORS_ORIGIN=*
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW=1 minute
TRUST_PROXY=1

SEED_ADMIN_KEY=1
```

### 5.4. Comandos PM2

Antes del primer arranque de una base nueva, realiza el bootstrap una sola vez
desde una consola privada. Los prompts no muestran los secretos:

```bash
export SESSION_SECRET="$(openssl rand -hex 48)"
read -rp 'Usuario admin inicial: ' ADMIN_USERNAME
read -rsp 'Contraseña admin inicial: ' ADMIN_PASSWORD; echo
export ADMIN_USERNAME ADMIN_PASSWORD ADMIN_BOOTSTRAP=1
npm start
# Tras comprobar el arranque, Ctrl+C y retirar variables de bootstrap:
unset ADMIN_USERNAME ADMIN_PASSWORD ADMIN_BOOTSTRAP
```

Si la base ya contiene un admin, el arranque ignora `ADMIN_PASSWORD`; nunca lo
restablece. Para una rotación controlada, detener el servicio y ejecutar
`npm run admin:reset` como se describe en `README.md`; esto invalida sesiones.

```bash
# Iniciar procesos
cd /var/www/calculadora && pm2 start ecosystem.config.cjs
cd /var/www/bcv-api && pm2 start ecosystem.config.cjs

# Habilitar inicio automático con el sistema
pm2 save
pm2 startup systemd   # ya ejecuta systemctl enable pm2-root

# Ver estado
pm2 list
pm2 status

# Logs
pm2 logs calculadora
pm2 logs bcv-api

# Reiniciar
pm2 restart calculadora
pm2 restart bcv-api
```

---

## 6. Instalación paso a paso (desde VPS formateado)

```bash
# 1. Actualizar sistema
apt update && apt upgrade -y

# 2. Instalar nginx
apt install -y nginx

# 3. Instalar Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 4. Instalar PM2
npm install -g pm2

# 5. Subir el backup y extraerlo
#    Desde tu máquina local: scp calculadora-full-backup.tar.gz root@<IP>:/root/
cd /var/www
tar -xzf /root/calculadora-full-backup.tar.gz

# 6. Instalar dependencias de calculadora
cd /var/www/calculadora
npm ci --omit=dev

# 7. Construir CSS de Tailwind
npm run build:css

# 8. Instalar dependencias de bcv-api
cd /var/www/bcv-api
npm install

# 9. Copiar .env desde .env.example (si no existe)
cp .env.example .env
#    Editar .env si es necesario (nano .env)

# 10. Verificar que las bases de datos SQLite estén presentes
ls -lah /var/www/calculadora/data/historial.db
ls -lah /var/www/bcv-api/data/bcv.sqlite

# 11. Configurar nginx
#     Copiar la configuración del paso 4 en /etc/nginx/sites-available/default
#     o crearla desde cero. Luego:
nginx -t
systemctl reload nginx

# 12. Configurar SSL con Certbot
certbot --nginx -d dayzove.lat -d www.dayzove.lat

# 13. Iniciar servicios con PM2
cd /var/www/calculadora && pm2 start ecosystem.config.cjs
cd /var/www/bcv-api && pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd

# 14. Verificar que todo funcione
pm2 list
curl -I http://localhost:3001
curl -I http://127.0.0.1:3002/health
```

---

## 7. Notas importantes

- **Puertos**: El VPS solo expone 80 y 443 (nginx). Los puertos 3001 y 3002
  solo escuchan en `127.0.0.1` (localhost).
- **SQLite**: No requiere instalación de motor de BD. Los archivos `.db` son
  portables — solo hay que copiarlos.
- **Logs de PM2**: Están en `/root/.pm2/logs/` y en el caso de bcv-api también
  en `/var/www/bcv-api/logs/`.
- **Variables secretas**: `SESSION_SECRET` se inyecta desde el host y nunca se
  escribe en `ecosystem.config.cjs`. `ADMIN_PASSWORD` solo existe durante un
  bootstrap explícito y se retira antes del arranque normal.
- **Migraciones**: Si es primera vez, en bcv-api ejecutar
  `cd /var/www/bcv-api && node bin/bcv-admin.js db:setup`
- **Tailwind**: Si modificas clases CSS en `public/`, re-ejecuta
  `npm run build:css` en calculadora.
- **App Flutter mobile**: Está en `/var/www/calculadora/mobile/`. Compila
  con Flutter SDK apuntando a `https://dayzove.lat`.
