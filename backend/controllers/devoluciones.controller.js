'use strict';

/**
 * Devoluciones y Cambios de Mercancía
 * Revierte stock, registra el historial y emite nota de crédito interna.
 */

const { getOne, getAll, run, transaction } = require('../config/db');
const { asyncHandler, httpError } = require('../utils/asyncHandler');
const {
  loadDevolucionesPreviasMap,
  resolverTasaBcvVenta,
  calcularTotalBsDevolucion
} = require('../utils/devolucionesSaldo');

/* ─── LISTAR ─────────────────────────────────────────────────────────────── */
async function list(req, res) {
  const limit  = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const q      = req.query.q ? String(req.query.q).trim() : '';

  // Bug-35: build WHERE + params explicitly for both the main query and the count
  // query instead of doing a fragile placeholder replace with regex.
  const baseWhere = `d.estado != 'anulada'`;
  const searchParams = [];
  let searchClause = '';
  if (q) {
    searchClause = ` AND (d.numero_devolucion LIKE ? COLLATE NOCASE OR c.nombre LIKE ? COLLATE NOCASE)`;
    searchParams.push(`%${q}%`, `%${q}%`);
  }

  const rows = getAll(`
    SELECT d.id, d.numero_devolucion, d.tipo, d.estado, d.total_usd, d.total_bs,
           d.motivo, d.metodo_reembolso, d.creado_en,
           v.numero_venta,
           c.nombre AS cliente_nombre,
           u.nombre_completo AS cajero_nombre
    FROM devoluciones d
    LEFT JOIN ventas v    ON v.id = d.venta_id
    LEFT JOIN clientes c  ON c.id = d.cliente_id
    LEFT JOIN usuarios u  ON u.id = d.cajero_id
    WHERE ${baseWhere}${searchClause}
    ORDER BY d.creado_en DESC
    LIMIT ? OFFSET ?
  `, [...searchParams, limit, offset]);

  const totalRow = getOne(
    `SELECT COUNT(*) AS n
     FROM devoluciones d
     LEFT JOIN clientes c ON c.id = d.cliente_id
     WHERE ${baseWhere}${searchClause}`,
    searchParams
  );

  res.json({ devoluciones: rows, total: totalRow.n });
}

/* ─── GET BY ID ──────────────────────────────────────────────────────────── */
async function getById(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID inválido');

  const row = getOne(`
    SELECT d.*,
           v.numero_venta,
           c.nombre AS cliente_nombre, c.cedula_rif AS cliente_cedula, c.telefono AS cliente_telefono,
           u.nombre_completo AS cajero_nombre
    FROM devoluciones d
    LEFT JOIN ventas v   ON v.id = d.venta_id
    LEFT JOIN clientes c ON c.id = d.cliente_id
    LEFT JOIN usuarios u ON u.id = d.cajero_id
    WHERE d.id = ?
  `, [id]);
  if (!row) throw httpError(404, 'Devolución no encontrada');

  // lineas TEXT JSON → array (PG devolvía JSONB)
  if (typeof row.lineas === 'string') {
    try { row.lineas = JSON.parse(row.lineas); } catch (_e) { row.lineas = []; }
  }
  res.json(row);
}

/* ─── CREAR DEVOLUCIÓN ───────────────────────────────────────────────────── */
async function create(req, res) {
  const {
    venta_id,
    tipo = 'devolucion',
    motivo,
    metodo_reembolso,
    lineas = [],
    notas
  } = req.body || {};

  if (!lineas || !Array.isArray(lineas) || lineas.length === 0) {
    throw httpError(400, 'Debe incluir al menos una línea para devolver');
  }
  if (!['devolucion', 'cambio'].includes(tipo)) {
    throw httpError(400, 'Tipo inválido (devolucion | cambio)');
  }
  // Bug-34: precio must come from the original sale, not the client
  if (venta_id == null || venta_id === '') {
    throw httpError(400, 'venta_id es obligatorio para fijar precios desde la venta original');
  }

  const ahoraIso = new Date().toISOString();

  // SQLite: los advisory locks PG se eliminan — transaction() serializa todas las
  // escrituras (mismo proceso, WAL), por lo que no hay carreras de numeración ni de saldo.
  const result = transaction(() => {
    // Verificar venta original
    const venta = getOne(
      `SELECT id, cliente_id, estado, total_usd, tasa_bcv_aplicada, tasa_cambio_aplicada,
              total_ref_usd_bcv, fecha_venta
       FROM ventas WHERE id = ?`,
      [Number(venta_id)]
    );
    if (!venta) throw httpError(404, 'Venta no encontrada');
    if (venta.estado === 'anulada') throw httpError(400, 'No se puede devolver una venta anulada');

    const tasaBcvVenta = resolverTasaBcvVenta(null, venta);
    if (tasaBcvVenta > 0) venta.tasa_bcv_aplicada = tasaBcvVenta;

    // Bug-34: load sale line details to get authoritative prices and quantities
    const detallesVenta = getAll(
      `SELECT producto_id, cantidad, precio_unitario_usd, subtotal_usd, descuento_porcentaje
       FROM detalles_ventas WHERE venta_id = ?`,
      [Number(venta_id)]
    );
    const ventaLineMap = new Map();
    detallesVenta.forEach((d) => {
      const pid = Number(d.producto_id);
      const qty = Number(d.cantidad) || 0;
      const precio = Number(d.precio_unitario_usd) || 0;
      const prev = ventaLineMap.get(pid);
      if (prev) {
        prev.cantidadVendida += qty;
      } else {
        ventaLineMap.set(pid, { cantidadVendida: qty, precioUsd: precio });
      }
    });

    const devPrevMap = loadDevolucionesPreviasMap(null, Number(venta_id));

    // Validar y normalizar líneas
    let totalUsd = 0;
    const lineasNorm = [];
    const acumEnPeticion = new Map();
    for (const l of lineas) {
      const productoId = Number(l.producto_id);
      const cantidad   = Number(l.cantidad);
      if (!productoId || productoId < 1) throw httpError(400, 'producto_id inválido en línea');
      if (!cantidad || cantidad <= 0)     throw httpError(400, 'cantidad inválida en línea');

      const prod = getOne(`SELECT id, nombre FROM productos WHERE id = ?`, [productoId]);
      if (!prod) throw httpError(404, `Producto ${productoId} no encontrado`);

      // Bug-34: price from venta, not from client body
      const ventaLine = ventaLineMap.get(productoId);
      if (!ventaLine) {
        throw httpError(400, `El producto "${prod.nombre}" no está en la venta #${venta_id}`);
      }
      const yaDevuelto = devPrevMap.get(productoId) || 0;
      const maxDevolvable = Math.max(
        0,
        Math.round((ventaLine.cantidadVendida - yaDevuelto) * 1000) / 1000
      );
      if (maxDevolvable <= 0) {
        throw httpError(
          400,
          `El producto "${prod.nombre}" ya fue devuelto por completo en esta venta`
        );
      }
      const acumLinea = (acumEnPeticion.get(productoId) || 0) + cantidad;
      if (acumLinea > maxDevolvable) {
        throw httpError(
          400,
          `No se puede devolver ${acumLinea} unidades de "${prod.nombre}" en esta operación: quedan ${maxDevolvable} por devolver (vendidas ${ventaLine.cantidadVendida}, ya devueltas ${yaDevuelto})`
        );
      }
      acumEnPeticion.set(productoId, acumLinea);

      const existenteNorm = lineasNorm.find((x) => x.producto_id === productoId);
      if (existenteNorm) {
        existenteNorm.cantidad = acumLinea;
        existenteNorm.subtotal_usd = parseFloat((ventaLine.precioUsd * acumLinea).toFixed(4));
        totalUsd += parseFloat((ventaLine.precioUsd * cantidad).toFixed(4));
        // Stock ya se actualizará abajo con esta cantidad parcial de la línea duplicada
      } else {
        const precioUsd = ventaLine.precioUsd;
        const subtotal  = parseFloat((precioUsd * cantidad).toFixed(4));
        totalUsd += subtotal;
        lineasNorm.push({
          producto_id: productoId,
          producto_nombre: prod.nombre,
          cantidad,
          precio_unitario_usd: precioUsd,
          subtotal_usd: subtotal
        });
      }

      // Bug-32/36: capture previous stock, update, then audit
      const prevRow = getOne(`SELECT stock_actual FROM productos WHERE id = ?`, [productoId]);
      const prevStock = parseFloat(prevRow.stock_actual);
      const newStock  = prevStock + cantidad;

      run(
        `UPDATE productos SET stock_actual = ?, actualizado_en = ? WHERE id = ?`,
        [newStock, ahoraIso, productoId]
      );

      run(
        `INSERT INTO ajustes_inventario (
           producto_id, tipo, cantidad,
           cantidad_anterior, cantidad_nueva,
           referencia_id, referencia_tipo, usuario_id, motivo
         ) VALUES (?, 'entrada_devolucion', ?, ?, ?, ?, 'devolucion', ?, ?)`,
        [
          productoId,
          cantidad,
          prevStock,
          newStock,
          Number(venta_id),
          req.user?.id || null,
          motivo || 'Devolución'
        ]
      );
    }

    totalUsd = parseFloat(totalUsd.toFixed(4));
    const totalBs = calcularTotalBsDevolucion(lineasNorm, venta, detallesVenta);

    // Numeración DEV-AAAA-NNNNNN: MAX en JS (sin advisory lock, tx serializada)
    const year = new Date().getFullYear();
    const prefix = `DEV-${year}-`;
    const lastDev = getOne(
      `SELECT numero_devolucion FROM devoluciones
       WHERE numero_devolucion LIKE ?
       ORDER BY numero_devolucion DESC LIMIT 1`,
      [`${prefix}%`]
    );
    let next = 1;
    if (lastDev && lastDev.numero_devolucion) {
      const n = parseInt(String(lastDev.numero_devolucion).slice(prefix.length), 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    const numDev = `${prefix}${String(next).padStart(6, '0')}`;

    const rDev = run(`
      INSERT INTO devoluciones
        (numero_devolucion, venta_id, cliente_id, cajero_id, tipo, motivo, estado,
         total_usd, total_bs, metodo_reembolso, lineas, notas)
      VALUES (?,?,?,?,?,?,'completada',?,?,?,?,?)
    `, [
      numDev,
      Number(venta_id),
      venta.cliente_id,
      req.user?.id || null,
      tipo,
      motivo || null,
      totalUsd,
      totalBs,
      metodo_reembolso || null,
      JSON.stringify(lineasNorm),
      notas || null
    ]);

    return getOne(`SELECT * FROM devoluciones WHERE id = ?`, [rDev.lastInsertRowid]);
  });

  res.status(201).json(result);
}

/* ─── ANULAR DEVOLUCIÓN ──────────────────────────────────────────────────── */
async function anular(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID inválido');

  const ahoraIso = new Date().toISOString();

  const result = transaction(() => {
    const dev = getOne(`SELECT * FROM devoluciones WHERE id = ?`, [id]);
    if (!dev) throw httpError(404, 'Devolución no encontrada');
    if (dev.estado === 'anulada') throw httpError(400, 'Ya está anulada');

    // Bug-32/36: use stock_actual and record in ajustes_inventario
    const lineas = Array.isArray(dev.lineas) ? dev.lineas : JSON.parse(dev.lineas || '[]');
    for (const l of lineas) {
      const qty = Number(l.cantidad);
      const pid = Number(l.producto_id);

      const prevRow = getOne(`SELECT stock_actual FROM productos WHERE id = ?`, [pid]);
      const prevStock = parseFloat(prevRow.stock_actual);
      const newStock  = Math.max(0, prevStock - qty);

      run(
        `UPDATE productos SET stock_actual = ?, actualizado_en = ? WHERE id = ?`,
        [newStock, ahoraIso, pid]
      );

      run(
        `INSERT INTO ajustes_inventario (
           producto_id, tipo, cantidad,
           cantidad_anterior, cantidad_nueva,
           referencia_id, referencia_tipo, usuario_id, motivo
         ) VALUES (?, 'salida_anulacion_devolucion', ?, ?, ?, ?, 'devolucion', ?, ?)`,
        [
          pid,
          qty,
          prevStock,
          newStock,
          id,
          req.user?.id || null,
          'Anulación de devolución'
        ]
      );
    }

    run(
      `UPDATE devoluciones SET estado = 'anulada', actualizado_en = ? WHERE id = ?`,
      [ahoraIso, id]
    );
    return getOne(`SELECT * FROM devoluciones WHERE id = ?`, [id]);
  });

  res.json(result);
}

module.exports = {
  list:    asyncHandler(list),
  getById: asyncHandler(getById),
  create:  asyncHandler(create),
  anular:  asyncHandler(anular)
};
