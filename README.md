# Calc Pro

App Node (Express + SQLite + WebSocket) con frontend estático en `public/`.

## Estructura

| Ruta | Contenido |
|------|-----------|
| `src/server.js` | Servidor HTTP, API, WebSocket, lógica de tasas |
| `public/` | HTML, CSS, JS del cliente (sirve Express) |
| `styles/tailwind-entry.css` | Entrada Tailwind (compilada a `public/tailwind.css`) |
| `data/` | `historial.db` (tasas, cotizaciones import, usuarios, sesiones) |
| `scripts/migrate.js` | Migración opcional `historial_tasas.json` → SQLite (coloca el JSON en `data/` si la usas) |
| `docs/` | Documentación de diseño / análisis |
| `mobile/` | App Flutter (APK nativa, cliente de la API) |

## Comandos

```bash
npm ci
npm run build:css    # si cambias clases Tailwind en public/
npm start            # o: node src/server.js
npm run migrate      # solo si añades historial_tasas.json en data/ y aún no tienes .db
```

Variables útiles:

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3001` | Puerto HTTP |
| `HOST` | `127.0.0.1` | Interfaz de escucha; producción exige loopback |
| `DATA_DIR` | `./data` | Directorio de SQLite y datos |
| `SESSION_SECRET` | sin default | Secreto de al menos 64 caracteres en producción |
| `ADMIN_BOOTSTRAP` | sin default | `1` únicamente durante el bootstrap inicial explícito |
| `ADMIN_USERNAME` | sin default | Usuario del bootstrap inicial |
| `ADMIN_PASSWORD` | sin default | Contraseña del bootstrap inicial; se ignora si ya existe admin |

`ecosystem.config.cjs` no contiene secretos. Inyecta `SESSION_SECRET` desde el
entorno/secret manager del host. Para una DB nueva, ejecuta una vez con
`ADMIN_BOOTSTRAP=1`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`, comprueba el acceso y
retira las tres variables antes del arranque normal. Nunca pegues la contraseña
en Git o logs.

Para rotar una contraseña administrativa existente, detén el servicio y usa:

```bash
read -rsp 'Nueva contraseña: ' ADMIN_RESET_PASSWORD; export ADMIN_RESET_PASSWORD
export ADMIN_RESET_USERNAME='<usuario-admin>' CONFIRM_ADMIN_RESET=YES
npm run admin:reset
unset ADMIN_RESET_PASSWORD ADMIN_RESET_USERNAME CONFIRM_ADMIN_RESET
```

La rotación invalida todas las sesiones. No existe reset automático al reiniciar.

## PM2

Ver sección final del último mensaje en el chat o:

```bash
cd /var/www/calculadora
pm2 delete calculadora
pm2 start ecosystem.config.cjs
pm2 save
```
