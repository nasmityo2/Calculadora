# 07 — Recompilación de módulos nativos para Electron 22.3.27 (Tarea 5.2)

Fecha: 10 junio 2026

## Estrategia: prebuilds oficiales (sin node-gyp)

No fue necesario compilar con `node-gyp` (el equipo de desarrollo no tiene Visual Studio
Build Tools). `better-sqlite3@8.5.0` publica binarios precompilados para el ABI de
Electron 22 (electron-v110) en win32, tanto ia32 como x64:

- `better-sqlite3-v8.5.0-electron-v110-win32-ia32.tar.gz` → para el build de distribución (Win 7 de 32 bits)
- `better-sqlite3-v8.5.0-electron-v110-win32-x64.tar.gz` → para `npm start` en la máquina de desarrollo (x64)

Instalación realizada con `prebuild-install` directamente:

```
node node_modules/prebuild-install/bin.js --runtime=electron --target=22.3.27 --arch=ia32   # build dist
node node_modules/prebuild-install/bin.js --runtime=electron --target=22.3.27 --arch=x64    # dev local
```

(ejecutado dentro de `node_modules/better-sqlite3/`).

## Verificación

- Cabecera PE del `better_sqlite3.node` ia32 confirma `Machine = 0x014c (i386, 32-bit)`.
- Copias de ambos binarios guardadas en `build-resources/prebuilds/`:
  - `better_sqlite3-electron-v110-win32-ia32.node`
  - `better_sqlite3-electron-v110-win32-x64.node`
- `node_modules/better-sqlite3/build/Release/better_sqlite3.node` queda en **x64**
  para que `npm start` funcione en la máquina de desarrollo.
- Arranque real con Electron 22.3.27: app inicia, genera `config.env`, muestra wizard
  de licencia y el backend Express + SQLite responde `/health` en ~2 s.

## Nota para el build ia32 (tarea 5.5)

`electron-builder` ejecuta `install-app-deps` para el arch de destino antes de empaquetar;
con el prebuild ia32 ya cacheado en `%APPDATA%\npm-cache\_prebuilds\` la resolución es
inmediata y offline. Si algún entorno limpio fallara, basta copiar
`build-resources/prebuilds/better_sqlite3-electron-v110-win32-ia32.node` sobre
`node_modules/better-sqlite3/build/Release/better_sqlite3.node` antes de `npm run dist`.

## @electron/rebuild

Se instaló `@electron/rebuild` como devDependency (requisito del plan), pero no fue
necesario invocarlo: los prebuilds oficiales cubren ambas arquitecturas sin compilación.
