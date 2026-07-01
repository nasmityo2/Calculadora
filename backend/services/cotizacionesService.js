'use strict';

const { getOne, getAll, run, transaction } = require('../config/db');
const { logger } = require('../config/logger');
const { httpError } = require('../utils/asyncHandler');
const { formatBolivares, formatUsdRef, formatTasaBcv } = require('../utils/formatters');
const PreciosService = require('./preciosService');

/**
 * Genera número de cotización con formato COT-YYYY-NNNNN.
 * SQLite: la secuencia PG cotizaciones_seq se reemplaza con MAX(id) en JS
 * dentro de transaction() (escrituras serializadas — sin carrera).
 */
function generarNumeroCotizacion() {
  const year = new Date().getFullYear();
  const ultimo = getOne(`SELECT MAX(id) AS ultimo FROM cotizaciones`);
  const seq = (ultimo && Number(ultimo.ultimo) ? Number(ultimo.ultimo) : 0) + 1;
  return `COT-${year}-${String(seq).padStart(5, '0')}`;
}

/** Calcula totales a partir de las líneas + descuento + IVA */
function calcularTotales(lineas, descuentoPct, ivaPct) {
  const subtotal = lineas.reduce((s, l) => s + Number(l.subtotal_usd || 0), 0);
  const descMonto = subtotal * (Number(descuentoPct) / 100);
  const baseIva = subtotal - descMonto;
  const ivaMonto = baseIva * (Number(ivaPct) / 100);
  const total = baseIva + ivaMonto;
  return {
    subtotal_usd: Math.round(subtotal * 10000) / 10000,
    descuento_monto_usd: Math.round(descMonto * 10000) / 10000,
    iva_monto_usd: Math.round(ivaMonto * 10000) / 10000,
    total_usd: Math.round(total * 10000) / 10000
  };
}

function usdToBs(usd, tasa) {
  const u = Number(usd);
  const t = Number(tasa);
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return 0;
  try {
    return PreciosService.totalBolivaresDesdeRefUsdBcv(u, t);
  } catch (_e) {
    return Math.round(u * t * 100) / 100;
  }
}

/** Lee la tasa BCV actual desde configuracion (SÍNCRONA — usable en transaction). */
function tasaBcvActual() {
  const row = getOne(`SELECT valor FROM configuracion WHERE clave = 'tasa_bcv' LIMIT 1`);
  const tasa = row ? Number(row.valor) : 0;
  return Number.isFinite(tasa) && tasa > 0 ? tasa : 0;
}

/* ─── QUERIES ────────────────────────────────────────────── */

async function list({ estado, clienteId, page, limit }) {
  const pg = Math.max(1, Number(page) || 1);
  const lim = Math.min(100, Math.max(1, Number(limit) || 50));
  const offset = (pg - 1) * lim;

  const conditions = [];
  const params = [];

  if (estado) {
    conditions.push(`c.estado = ?`);
    params.push(estado);
  }
  if (clienteId) {
    conditions.push(`c.cliente_id = ?`);
    params.push(Number(clienteId));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = getAll(
    `SELECT c.id, c.numero, c.estado, c.fecha_emision, c.fecha_vencimiento,
            c.total_usd, c.total_bs, c.tasa_bcv,
            cl.nombre AS cliente_nombre, cl.cedula_rif AS cliente_doc,
            u.nombre_completo AS usuario_nombre
     FROM cotizaciones c
     LEFT JOIN clientes cl ON cl.id = c.cliente_id
     LEFT JOIN usuarios u  ON u.id  = c.usuario_id
     ${where}
     ORDER BY c.fecha_emision DESC
     LIMIT ? OFFSET ?`,
    [...params, lim, offset]
  );

  const countRow = getOne(
    `SELECT COUNT(*) AS total FROM cotizaciones c ${where}`,
    params
  );

  return { rows, total: countRow.total, page: pg, limit: lim };
}

async function getById(id) {
  const cotizacion = getOne(
    `SELECT c.*,
            cl.nombre AS cliente_nombre, cl.cedula_rif AS cliente_doc,
            cl.telefono AS cliente_telefono, cl.direccion AS cliente_direccion,
            u.nombre_completo AS usuario_nombre
     FROM cotizaciones c
     LEFT JOIN clientes cl ON cl.id = c.cliente_id
     LEFT JOIN usuarios u  ON u.id  = c.usuario_id
     WHERE c.id = ?`,
    [id]
  );
  if (!cotizacion) throw httpError(404, `Cotización #${id} no encontrada`);

  const detalles = getAll(
    `SELECT d.*, p.nombre AS producto_nombre, p.codigo_interno
     FROM detalles_cotizaciones d
     LEFT JOIN productos p ON p.id = d.producto_id
     WHERE d.cotizacion_id = ? ORDER BY d.id`,
    [id]
  );

  return { ...cotizacion, detalles };
}

async function crear({ clienteId, fechaVencimiento, ivaPorcentaje, descuentoPorcentaje, notas, lineas, usuarioId }) {
  if (!lineas || !lineas.length) {
    throw httpError(400, 'La cotización debe tener al menos un ítem');
  }
  if (!fechaVencimiento) {
    throw httpError(400, 'La fecha de vencimiento es obligatoria');
  }

  const descPct = Number(descuentoPorcentaje) || 0;
  const ivaPct  = Number(ivaPorcentaje) || 0;

  const lineasNorm = lineas.map((l) => ({
    producto_id:          l.producto_id ? Number(l.producto_id) : null,
    descripcion:          String(l.descripcion || l.nombre || '').trim().slice(0, 255),
    cantidad:             Math.max(0.001, Number(l.cantidad) || 1),
    precio_unitario_usd:  Number(l.precio_unitario_usd || 0),
    subtotal_usd:         Math.round(Number(l.cantidad || 1) * Number(l.precio_unitario_usd || 0) * 10000) / 10000
  }));

  if (lineasNorm.some((l) => !l.descripcion)) {
    throw httpError(400, 'Cada ítem debe tener descripción');
  }

  const totales = calcularTotales(lineasNorm, descPct, ivaPct);

  return transaction(() => {
    const tasa = tasaBcvActual();
    const numero = generarNumeroCotizacion();
    const totalBs = usdToBs(totales.total_usd, tasa);

    const rCot = run(
      `INSERT INTO cotizaciones
         (numero, cliente_id, usuario_id, fecha_vencimiento,
          iva_porcentaje, iva_monto_usd,
          descuento_porcentaje, descuento_monto_usd,
          subtotal_usd, total_usd, total_bs, tasa_bcv, notas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        numero,
        clienteId ? Number(clienteId) : null,
        usuarioId ? Number(usuarioId) : null,
        fechaVencimiento,
        ivaPct,
        totales.iva_monto_usd,
        descPct,
        totales.descuento_monto_usd,
        totales.subtotal_usd,
        totales.total_usd,
        totalBs,
        tasa,
        notas || null
      ]
    );
    const cot = getOne(`SELECT * FROM cotizaciones WHERE id = ?`, [rCot.lastInsertRowid]);

    for (const l of lineasNorm) {
      run(
        `INSERT INTO detalles_cotizaciones
           (cotizacion_id, producto_id, descripcion, cantidad, precio_unitario_usd, subtotal_usd)
         VALUES (?,?,?,?,?,?)`,
        [cot.id, l.producto_id, l.descripcion, l.cantidad, l.precio_unitario_usd, l.subtotal_usd]
      );
    }

    logger.info('Cotización creada', { numero, id: cot.id, usuarioId });
    return { ...cot, detalles: lineasNorm };
  });
}

async function actualizarEstado(id, nuevoEstado, usuarioId) {
  const validos = ['borrador', 'enviada', 'aceptada', 'rechazada', 'vencida', 'anulada'];
  if (!validos.includes(nuevoEstado)) {
    throw httpError(400, `Estado inválido: ${nuevoEstado}`);
  }

  const cot = getOne(`SELECT id, estado FROM cotizaciones WHERE id = ?`, [id]);
  if (!cot) throw httpError(404, `Cotización #${id} no encontrada`);

  if (cot.estado === 'anulada') {
    throw httpError(409, 'Una cotización anulada no puede modificar su estado');
  }

  run(
    `UPDATE cotizaciones SET estado = ?, updated_at = ? WHERE id = ?`,
    [nuevoEstado, new Date().toISOString(), id]
  );
  const updated = getOne(`SELECT * FROM cotizaciones WHERE id = ?`, [id]);

  logger.info('Estado de cotización actualizado', { id, nuevoEstado, usuarioId });
  return updated;
}

async function anular(id, usuarioId) {
  return actualizarEstado(id, 'anulada', usuarioId);
}

/**
 * Construye el contexto completo para generar el PDF de una cotización.
 * Retorna empresa + cotizacion + detalles + totales formateados.
 */
async function fetchCotizacionPdfContext(id) {
  const cotizacion = await getById(id);

  const cfgRows = getAll(
    `SELECT clave, valor FROM configuracion
     WHERE clave IN ('nombre_empresa','rif_empresa','direccion_empresa','telefono_empresa','email_empresa')`
  );
  const cfg = {};
  cfgRows.forEach((r) => { cfg[r.clave] = r.valor; });

  const empresa = {
    nombre:    cfg.nombre_empresa    || 'Nexus Core POS',
    rif:       cfg.rif_empresa       || '',
    direccion: cfg.direccion_empresa  || '',
    telefono:  cfg.telefono_empresa   || '',
    email:     cfg.email_empresa      || ''
  };

  const tasa = Number(cotizacion.tasa_bcv) || 0;

  const lineas = cotizacion.detalles.map((d) => ({
    descripcion:          d.descripcion || d.producto_nombre || 'Ítem',
    cantidad:             Number(d.cantidad),
    precio_unitario_usd:  Number(d.precio_unitario_usd),
    subtotal_usd:         Number(d.subtotal_usd),
    precio_unitario_bs:   usdToBs(d.precio_unitario_usd, tasa),
    subtotal_bs:          usdToBs(d.subtotal_usd, tasa)
  }));

  return {
    empresa,
    cotizacion,
    lineas,
    tasa,
    formatBolivares,
    formatUsdRef,
    formatTasaBcv
  };
}

module.exports = {
  list,
  getById,
  crear,
  actualizarEstado,
  anular,
  fetchCotizacionPdfContext
};
