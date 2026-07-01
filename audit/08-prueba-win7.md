# 08 — Prueba en entorno Win 7 / 2 GB RAM (Tarea 5.6)

Fecha: 10 junio 2026
Estado: ⚠ **PENDIENTE DE HARDWARE** — no existe VM/PC con Windows 7 SP1 32-bit disponible
en el entorno de desarrollo (host actual: Windows 11 x64). Todo lo automatizable quedó
verificado; falta únicamente la validación en el equipo objetivo real.

## Verificado en el host de desarrollo (Win 11 x64, ejecutando el build ia32 vía WoW64)

| Check | Resultado |
|---|---|
| `Nexus Core.exe` es PE i386 (32-bit) | OK |
| `better_sqlite3.node` empaquetado es PE i386 | OK |
| App empaquetada arranca (proceso 32-bit) | OK |
| Backend Express + SQLite responde `/health` | OK (~1 s) |
| Login (`admin`) responde JWT | OK |
| Instalador NSIS generado (`Nexus Core Setup 1.0.0.exe`, 78 MB) | OK |
| Portable generado (`Nexus Core 1.0.0.exe`, 77 MB) | OK |
| `win-ia32-unpacked` = 296 MB | OK (< 300 MB) |
| Electron 22.3.27 (último con soporte Win 7 SP1+) | OK |
| `disable-gpu-sandbox` activo antes de `app.whenReady()` | OK |

## Checklist para el operador con el equipo Win 7 real

Requisitos del equipo de prueba:
- Windows 7 SP1 de 32 bits, 2 GB RAM, 1 core
- Visual C++ Redistributable 2015-2022 (x86) instalado — NO requiere .NET Framework

Pasos:
1. Copiar `dist/Nexus Core Setup 1.0.0.exe` e instalar (o usar el portable).
2. Verificar que la app arranca sin crash (si el proceso GPU falla, probar agregando
   `no-sandbox` en `electron/main.js` como indica el comentario existente).
3. Completar el wizard: activar licencia → crear admin → elegir modo moneda → datos de empresa.
4. Login con el admin creado.
5. POS: abrir caja y completar una venta (cobro en Bs y en USD).
6. Abrir Reportes (ventas por período) y el Dashboard — sin crash.
7. Medir RAM en reposo con el Administrador de tareas (objetivo: < 400 MB
   sumando los procesos de Nexus Core).
8. Cerrar la app y verificar que se genera el respaldo `.db` en
   `%APPDATA%\Nexus Core\backups\`.

Documentar aquí los resultados y, si todo pasa, cambiar la tarea 5.6 de [⚠] a [x]
en `MIGRATION_PLAN.md`.
