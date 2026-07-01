'use strict';

const express = require('express');
const router = express.Router();
const { getOne, getAll, run, transaction } = require('../config/db');
const { asyncHandler, httpError } = require('../utils/asyncHandler');
const { registrarAuditoria } = require('../middleware/audit.middleware');
const { requirePermission } = require('../middleware/permissions.middleware');
const cxpSvc = require('../services/cuentasPagarService');
const PreciosService = require('../services/preciosService');

router.use(requirePermission('compras_all'));

function generarNumeroCompra() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `C${yy}${mm}${dd}-${rand}`;
}

// GET /api/compras
router.get('/', asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const estado = req.query.estado ? String(req.query.estado) : null;
  const q      = req.query.q ? String(req.query.q).trim() : '';

  const filterParams = [];
  const filterConditions = [];
  if (estado && ['pendiente','recibida','cancelada','parcial'].includes(estado)) {
    filterConditions.push(`c.estado = ?`);
    filterParams.push(estado);
  }
  if (q) {
    filterConditions.push(`(p.nombre LIKE ? COLLATE NOCASE OR c.numero_compra LIKE ? COLLATE NOCASE)`);
    filterParams.push(`%${q}%`, `%${q}%`);
  }
  const where = filterConditions.length ? 'WHERE ' + filterConditions.join(' AND ') : '';

  const rows = getAll(
    `SELECT c.id, c.numero_compra, c.fecha_compra, c.estado,
            c.total_usd, c.notas,
            c.tipo_pago, c.dias_credito,
            p.nombre AS proveedor,
            u.nombre_completo AS usuario,
            (SELECT COUNT(*) FROM detalles_compras dc WHERE dc.compra_id = c.id) AS num_items,
            CASE WHEN c.estado = 'pendiente'
              THEN CAST(julianday(date('now')) - julianday(date(c.fecha_compra)) AS INTEGER)
              ELSE NULL
            END AS dias_abierta
     FROM compras c
     LEFT JOIN proveedores p ON p.id = c.proveedor_id
     JOIN usuarios u         ON u.id = c.usuario_id
     ${where}
     ORDER BY c.fecha_compra DESC LIMIT ? OFFSET ?`,
    [...filterParams, limit, offset]
  );

  const totalRow = getOne(
    `SELECT COUNT(*) AS total FROM compras c LEFT JOIN proveedores p ON p.id=c.proveedor_id ${where}`,
    filterParams
  );

  // Alertas de órdenes pendientes viejas (>7 días)
  const alertasPendientes = rows.filter(function(r) { return r.estado === 'pendiente' && (r.dias_abierta || 0) > 7; });

  res.json({ rows, total: totalRow.total, alertas_pendientes: alertasPendientes });
}));

// GET /api/compras/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const compra = getOne(
    `SELECT c.*, p.nombre AS proveedor_nombre,
            u.nombre_completo AS usuario_nombre
     FROM compras c
     LEFT JOIN proveedores p ON p.id = c.proveedor_id
     JOIN usuarios u         ON u.id = c.usuario_id
     WHERE c.id = ?`,
    [req.params.id]
  );
  if (!compra) return res.status(404).json({ error: 'Compra no encontrada' });

  const detalles = getAll(
    `SELECT dc.*, pr.nombre AS producto_nombre, pr.codigo_barras
     FROM detalles_compras dc
     JOIN productos pr ON pr.id = dc.producto_id
     WHERE dc.compra_id = ?`,
    [req.params.id]
  );

  res.json({ ...compra, detalles });
}));

// POST /api/compras — crear nueva compra
router.post('/', asyncHandler(async (req, res) => {
  const { proveedor_id, notas, items, tipo_pago = 'contado', dias_credito = 0 } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debes agregar al menos un producto a la compra' });
  }

  // Una compra a crédito SIEMPRE debe tener proveedor: sin él no se puede generar
  // la cuenta por pagar al recibir, y la deuda quedaría huérfana.
  if (tipo_pago === 'credito' && !proveedor_id) {
    return res.status(400).json({ error: 'Una compra a crédito requiere un proveedor asignado' });
  }

  // Validar y normalizar cada línea en el servidor: nunca confiar en totales del cliente.
  const lineas = [];
  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    if (!item.producto_id) {
      return res.status(400).json({ error: `Ítem ${idx + 1}: producto_id obligatorio` });
    }
    const cantidad = Math.round(parseFloat(item.cantidad) * 1000) / 1000;
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: `Ítem ${idx + 1}: cantidad debe ser mayor a 0` });
    }
    const costoUnit = Math.round(parseFloat(item.costo_unitario_usd) * 10000) / 10000;
    if (!Number.isFinite(costoUnit) || costoUnit <= 0) {
      return res.status(400).json({ error: `Ítem ${idx + 1}: costo_unitario_usd debe ser mayor a 0` });
    }
    // Subtotal recalculado en servidor (4 decimales).
    const subtotal = Math.round(cantidad * costoUnit * 10000) / 10000;
    lineas.push({ producto_id: Number(item.producto_id), cantidad, costoUnit, subtotal });
  }

  // Total recalculado en servidor — ignora cualquier total enviado por el cliente.
  const totalUsd = Math.round(lineas.reduce((s, l) => s + l.subtotal, 0) * 10000) / 10000;

  const compra = transaction(() => {
    const numero = generarNumeroCompra();

    // Verificar que todos los productos existan antes de insertar.
    for (const l of lineas) {
      const prod = getOne(`SELECT id, activo FROM productos WHERE id = ?`, [l.producto_id]);
      if (!prod) {
        throw Object.assign(new Error(`Producto ${l.producto_id} no existe`), { status: 400 });
      }
    }

    const tipoPagoVal = ['contado','credito'].includes(tipo_pago) ? tipo_pago : 'contado';
    const diasCredVal  = tipoPagoVal === 'credito' ? Math.max(0, parseInt(dias_credito) || 30) : 0;

    const r = run(
      `INSERT INTO compras (numero_compra, proveedor_id, usuario_id, total_usd, notas, tipo_pago, dias_credito)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [numero, proveedor_id || null, req.user.id, totalUsd.toFixed(4), notas || null, tipoPagoVal, diasCredVal]
    );
    const c = getOne(`SELECT * FROM compras WHERE id = ?`, [r.lastInsertRowid]);

    for (const l of lineas) {
      // cantidad_recibida = 0 al crear: la entrada de stock y el costo promedio
      // se aplican en POST /:id/recibir (la lógica del antiguo trigger PG vive allí).
      run(
        `INSERT INTO detalles_compras
           (compra_id, producto_id, cantidad_pedida, cantidad_recibida, costo_unitario_usd, subtotal_usd)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [c.id, l.producto_id, l.cantidad, l.costoUnit, l.subtotal.toFixed(4)]
      );
    }

    return c;
  });

  res.status(201).json({ ok: true, compra });
}));

// POST /api/compras/:id/recibir — confirmar recepción y actualizar stock
router.post('/:id/recibir', asyncHandler(async (req, res) => {
  const compraId = parseInt(req.params.id);

  const compra = getOne(`SELECT * FROM compras WHERE id = ?`, [compraId]);
  if (!compra) return res.status(404).json({ error: 'Compra no encontrada' });
  if (compra.estado === 'recibida') {
    return res.status(409).json({ error: 'Esta compra ya fue recibida anteriormente' });
  }
  if (compra.estado === 'cancelada') {
    return res.status(409).json({ error: 'No puedes recibir una compra cancelada' });
  }

  const detalles = getAll(`SELECT * FROM detalles_compras WHERE compra_id = ?`, [compraId]);

  // Tasa BCV para la CxP (async): se resuelve ANTES de la transacción síncrona.
  let tasaBcvCxp = 1;
  if (compra.tipo_pago === 'credito' && compra.proveedor_id) {
    try {
      const tasas = await PreciosService.resolverTasasOperativas();
      if (Number(tasas.tasa_bcv) > 0) tasaBcvCxp = Number(tasas.tasa_bcv);
    } catch (_e) { /* sin tasas: CxP queda con tasa 1 (igual que tasaBcvVigente) */ }
  }

  const ahoraIso = new Date().toISOString();
  transaction(() => {
    for (const det of detalles) {
      const prod = getOne(
        `SELECT stock_actual, costo_promedio_ponderado_usd
         FROM productos WHERE id = ?`,
        [det.producto_id]
      );
      if (!prod) {
        throw httpError(
          400,
          `Producto ID ${det.producto_id} no encontrado — operación cancelada`
        );
      }

      /* ── Lógica del trigger PG calcular_costo_promedio (001), ahora explícita ── */
      const stockActual   = parseFloat(prod.stock_actual) || 0;
      const costoActual   = parseFloat(prod.costo_promedio_ponderado_usd) || parseFloat(det.costo_unitario_usd);
      const cantNueva     = parseFloat(det.cantidad_recibida) || parseFloat(det.cantidad_pedida);
      const costoNuevo    = parseFloat(det.costo_unitario_usd);

      const stockTotal = stockActual + cantNueva;
      const costoPonderado = stockTotal > 0
        ? (stockActual * costoActual + cantNueva * costoNuevo) / stockTotal
        : costoNuevo;

      run(
        `UPDATE productos SET
           stock_actual = ?,
           costo_promedio_ponderado_usd = ?,
           costo_usd = ?,
           actualizado_en = ?
         WHERE id = ?`,
        [stockTotal, costoPonderado.toFixed(4), costoNuevo, ahoraIso, det.producto_id]
      );

      run(
        `INSERT INTO ajustes_inventario
           (producto_id, tipo, cantidad, cantidad_anterior, cantidad_nueva,
            costo_unitario_usd, referencia_id, referencia_tipo, usuario_id)
         VALUES (?, 'entrada_compra', ?, ?, ?, ?, ?, 'compra', ?)`,
        [
          det.producto_id, cantNueva,
          stockActual, stockTotal,
          costoNuevo, compraId, req.user.id
        ]
      );

      // Reflejar la recepción en detalles_compras (cantidad_recibida).
      run(
        `UPDATE detalles_compras
            SET cantidad_recibida = ?
          WHERE id = ?`,
        [cantNueva, det.id]
      );
    }

    run(
      `UPDATE compras SET estado = 'recibida', fecha_recepcion = ? WHERE id = ?`,
      [ahoraIso, compraId]
    );

    // Si la compra es a crédito y tiene proveedor asignado, crear CxP automáticamente
    if (compra.tipo_pago === 'credito' && compra.proveedor_id) {
      cxpSvc.crearDesdCompra({ compra, usuario_id: req.user.id, ip_address: req.ip, tasaBcv: tasaBcvCxp });
    }
  });

  await registrarAuditoria(null, {
    usuario_id: req.user.id,
    accion: 'RECIBIR_COMPRA',
    tabla_afectada: 'compras',
    registro_id: compraId,
    datos_anteriores: { estado: 'pendiente' },
    datos_nuevos: { estado: 'recibida' },
    ip_address: req.ip
  });

  res.json({ ok: true, message: 'Mercancía recibida. Stock actualizado correctamente.' });
}));

// POST /api/compras/:id/cancelar
router.post('/:id/cancelar', asyncHandler(async (req, res) => {
  const compra = getOne(`SELECT * FROM compras WHERE id = ?`, [req.params.id]);
  if (!compra) return res.status(404).json({ error: 'Compra no encontrada' });
  if (compra.estado === 'recibida') {
    return res.status(409).json({ error: 'No puedes cancelar una compra que ya fue recibida' });
  }

  run(`UPDATE compras SET estado = 'cancelada' WHERE id = ?`, [req.params.id]);
  res.json({ ok: true, message: 'Compra cancelada' });
}));

module.exports = router;
