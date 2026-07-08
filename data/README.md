# Datos de la aplicación

Por defecto el servidor usa este directorio para:

- `historial.db` — SQLite (histórico de tasas, cotizaciones de importación, usuarios y sesiones)
- `import_cotizaciones.json` — solo existe antes de la primera migración automática al arrancar; luego se renombra a `import_cotizaciones.json.migrated`

Variables de entorno relacionadas con autenticación (ver también `README.md`):

| Variable | Default | Descripción |
|----------|---------|-------------|
| `SESSION_SECRET` | `'cambiar-en-produccion-usar-variable-de-entorno'` | Secreto para cookies de sesión |
| `ADMIN_USERNAME` | `'admin'` | Usuario admin inicial |
| `ADMIN_PASSWORD` | `'admin123'` | Contraseña admin inicial |

Para usar otra ruta (p. ej. volumen Docker):

```bash
export DATA_DIR=/ruta/absoluta/a/datos
node src/server.js
```

Los archivos `historial.db-wal` y `historial.db-shm` aparecen con el journal en modo WAL; son normales.

`historial_tasas.json` no forma parte del runtime: solo hace falta si ejecutas `npm run migrate` para crear el `.db` desde un export JSON (conserva una copia externa si vas a migrar de nuevo).
