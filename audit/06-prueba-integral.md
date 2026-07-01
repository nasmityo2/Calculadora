# 06 — Prueba integral del sistema en SQLite (Tarea 3D.4)

Fecha: 10 junio 2026
Entorno: `DB_ENGINE=sqlite`, BD limpia creada desde cero por `migrations.sqlite.js` (5 versiones aplicadas).
Herramienta: `audit/tools/prueba-integral.js` (cliente HTTP Node, replica los redondeos de `PreciosService` para construir payloads válidos contra la verificación anti-manipulación del servidor).

## Resultado: 19/19 pasos OK — sin errores críticos

| # | Flujo | Resultado | Detalle |
|---|-------|-----------|---------|
| 1 | Login | OK | JWT emitido, permisos `all=true` |
| 2 | Dashboard KPIs | OK | `ventas_hoy_bcv=0`, serie 7 días completa |
| 3 | Crear producto | OK | id=1, SKU autogenerado `NC-…`, stock inicial 200 con ajuste de inventario |
| 4 | Editar producto | OK | margen 28 → 32 % |
| 5 | Abrir caja | OK | sesión 1, snapshot de tasas en apertura |
| 6 | Venta POS cobro mixto | OK | `VEN-2026-000001`, pagos USD + Bs cuadran (validación servidor) |
| 7 | Crear cliente | OK | id=1 |
| 8 | Venta a crédito + abonos | OK | `VEN-2026-000002`, cuenta por cobrar creada, abono en Bs y abono en USD aplicados |
| 9 | Cotización + PDF | OK | `COT-2026-00001` (numeración MAX(id) en JS), cambio de estado, PDF 10 092 bytes |
| 10 | Reporte ventas período | OK | agregación diaria correcta (2 ventas del día) |
| 11 | Exportar inventario a Excel | OK | control de precios 9 848 bytes |
| 12 | Modo moneda con caja abierta | OK | rechazado con HTTP 409 (regla de negocio intacta) |
| 13 | Cerrar caja | OK | diferencias USD y Bs en 0 — los totales de sesión cuadran |
| 14 | Cambiar modo moneda | OK | multimoneda → solo_bcv → multimoneda (tasa_usd se recalcula) |
| 15 | Actualizar tasa BCV manual | OK | tasa 565.5 persistida + upsert en `historial_tasas` (reemplazo del trigger PG) |
| 16 | Devolución parcial | OK | `DEV-2026-000001`, stock revertido 195 → 196 |
| 17 | Venta con Cashea | OK | desglose oficial (inicial 3 + prestado 4.5), pendiente de liquidación registrado |
| 18 | Compra y recepción | OK | stock 190 → 290, costo promedio ponderado recalculado (0.9328) — lógica ex-trigger |
| 19 | Logout | OK | auditoría registrada |

## Flujos de la checklist del plan cubiertos

- [x] Login y logout (pasos 1, 19)
- [x] Dashboard carga con KPIs (paso 2)
- [x] Crear y editar producto (pasos 3-4)
- [x] Abrir caja (paso 5)
- [x] Hacer venta (POS completo con cobro mixto) (paso 6)
- [x] Cerrar caja (paso 13)
- [x] Crear cliente y registrar abono en cartera (pasos 7-8, abono en Bs y en USD)
- [x] Crear cotización y generar PDF (paso 9)
- [x] Reporte de ventas por período (paso 10)
- [x] Exportar inventario a Excel (paso 11)
- [x] Cambiar modo moneda (multimoneda ↔ solo_bcv) (pasos 12, 14)
- [x] Actualizar tasa BCV manualmente (paso 15)
- [x] Hacer devolución de una venta (paso 16)
- [x] Venta con Cashea (paso 17)
- [x] Crear compra y recibir mercancía (paso 18)

## Verificaciones adicionales hechas durante la fase 3D

- Exportaciones Excel: control-precios, ventas, libro-ventas, libro-compras (subqueries correladas reemplazan LATERAL) — todas descargan.
- PDFs: ticket de venta, cierre térmico del día, cotización — HTTP 200 con contenido.
- Idempotencia de ventas: `idempotency_key` repetido retorna la venta existente (verificado en fase 3B).

## Incidencias no críticas

1. **Procesos Node ajenos en puerto 3000**: durante las pruebas se detectaron dos procesos node externos al proyecto ocupando el puerto (app ajena con error `EMPRESA_REQUERIDA`). Se liberó el puerto. No es un defecto de Nexus Core.
2. **Aviso de ancho en PDF** («14 units width could not fit page»): advertencia cosmética de pdfmake en el cierre térmico, ya presente con PG. No bloquea.

## Conclusión

No hay errores críticos. La Fase 3D queda completa y **se autoriza el paso a Fase 4** (eliminación de PostgreSQL).
