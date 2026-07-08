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
npm install
npm run build:css    # si cambias clases Tailwind en public/
npm start            # o: node src/server.js
npm run migrate      # solo si añades historial_tasas.json en data/ y aún no tienes .db
```

Variables útiles:

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3001` | Puerto HTTP |
| `DATA_DIR` | `./data` | Directorio de SQLite y datos |
| `SESSION_SECRET` | `'cambiar-en-produccion-usar-variable-de-entorno'` | Secreto para firmar cookies de sesión |
| `ADMIN_USERNAME` | `'admin'` | Usuario admin inicial (solo primer arranque) |
| `ADMIN_PASSWORD` | `'admin123'` | Contraseña admin inicial (cambiar de inmediato en producción) |

En PM2, define `SESSION_SECRET`, `ADMIN_USERNAME` y `ADMIN_PASSWORD` en `env_production` de `ecosystem.config.cjs` o en el entorno del host.

## PM2

Ver sección final del último mensaje en el chat o:

```bash
cd /var/www/calculadora
pm2 delete calculadora
pm2 start ecosystem.config.cjs
pm2 save
```
