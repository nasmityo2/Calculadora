'use strict';

const { getOne, getAll, run, transaction } = require('../config/db');
const { asyncHandler, httpError } = require('../utils/asyncHandler');
const { normalizarTelefonoMovilVeOpcional } = require('../utils/telefonoVe');
const { SALDO_BCV_SQL, resolverMontoAbono } = require('../services/creditoAbonoService');

const INSERTABLE = [
  'tipo', 'cedula_rif', 'nombre', 'telefono', 'email',
  'direccion', 'limite_credito_usd', 'descuento_habitual_porcentaje',
  'notas', 'activo'
];

function normalizeNullable(v) {
  if (v === undefined) return undefined;
  if (v === '' || v === null) return null;
  return v;
}

/* ─── LIST ─── */
async function list(req, res) {
  const limit  = Math.min(Number(req.query.limit) || 200, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const q = req.query.q ? String(req.query.q).trim() : '';

  const searchParams = [];
  let searchClause = '';

  if (q.length > 0) {
    searchClause = ` AND (
      c.nombre LIKE ? COLLATE NOCASE OR COALESCE(c.cedula_rif,'') LIKE ? COLLATE NOCASE
      OR COALESCE(c.telefono,'') LIKE ? COLLATE NOCASE OR COALESCE(c.email,'') LIKE ? COLLATE NOCASE
    )`;
    searchParams.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const rows = getAll(
    `SELECT
       c.id, c.nombre, c.cedula_rif, c.telefono, c.email, c.activo,
       COALESCE(c.limite_credito_usd, 0)       AS limite_credito_usd,
       COALESCE(
         (SELECT SUM(cc.saldo_pendiente_usd) FROM cuentas_cobrar cc WHERE cc.cliente_id = c.id AND cc.estado IN ('pendiente','vencida')),
         0
       )                                       AS deuda_total_usd,
       CASE
         WHEN COALESCE(c.limite_credito_usd,0) > 0
         THEN ROUND(
           COALESCE(
             (SELECT SUM(cc.saldo_pendiente_usd) FROM cuentas_cobrar cc WHERE cc.cliente_id = c.id AND cc.estado IN ('pendiente','vencida')),
             0
           ) / c.limite_credito_usd * 100, 1
         )
         ELSE 0
       END                                     AS porcentaje_uso
     FROM clientes c
     WHERE 1=1 ${searchClause}
     ORDER BY c.nombre ASC LIMIT ? OFFSET ?`,
    [...searchParams, limit, offset]
  );

  res.json(rows);
}

/* ─── GET BY ID ─── */
async function getById(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID inválido');
  const row = getOne(`SELECT * FROM clientes WHERE id = ?`, [id]);
  if (!row) throw httpError(404, 'Cliente no encontrado');
  res.json(row);
}

/* ─── PERFIL COMPLETO ─── */
async function perfil(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID inválido');

  const cliente = getOne(
    `SELECT
       c.*,
       COALESCE(
         (SELECT SUM(cc.saldo_pendiente_usd) FROM cuentas_cobrar cc WHERE cc.cliente_id = c.id AND cc.estado IN ('pendiente','vencida')),
         0
       ) AS deuda_total_usd,
       CASE WHEN COALESCE(c.limite_credito_usd,0) > 0
         THEN ROUND(
           COALESCE(
             (SELECT SUM(cc.saldo_pendiente_usd) FROM cuentas_cobrar cc WHERE cc.cliente_id = c.id AND cc.estado IN ('pendiente','vencida')),
             0
           ) / c.limite_credito_usd * 100, 1
         )
         ELSE 0
       END AS porcentaje_uso,
       (SELECT COUNT(*)  FROM ventas WHERE cliente_id = c.id AND estado = 'completada')     AS num_compras,
       (SELECT COALESCE(SUM(total_usd),0) FROM ventas WHERE cliente_id = c.id AND estado = 'completada') AS total_comprado_usd
     FROM clientes c WHERE c.id = ?`,
    [id]
  );
  if (!cliente) throw httpError(404, 'Cliente no encontrado');

  const historial = getAll(
    `SELECT v.id, v.numero_venta, v.fecha_venta, v.total_usd, v.total_bs, v.metodo_pago,
            u.nombre_completo AS cajero
     FROM ventas v
     LEFT JOIN usuarios u ON u.id = v.usuario_id
     WHERE v.cliente_id = ? AND v.estado = 'completada'
     ORDER BY v.fecha_venta DESC LIMIT 30`,
    [id]
  );
  const cuentas = getAll(
    `SELECT cc.*, v.numero_venta
     FROM cuentas_cobrar cc
     LEFT JOIN ventas v ON v.id = cc.venta_id
     WHERE cc.cliente_id = ? AND cc.estado IN ('pendiente','vencida')
     ORDER BY cc.fecha_vencimiento ASC NULLS LAST`,
    [id]
  );
  const pagos = getAll(
    `SELECT pc.*, u.nombre_completo AS registrado_por
     FROM pagos_credito pc
     LEFT JOIN usuarios u ON u.id = pc.usuario_id
     WHERE pc.cliente_id = ?
     ORDER BY pc.fecha DESC NULLS LAST LIMIT 20`,
    [id]
  );

  res.json({ cliente, historial_ventas: historial, cuentas_cobrar: cuentas, pagos });
}

/* ─── REGISTRAR PAGO DE DEUDA ─── */
async function registrarPago(req, res) {
  const clienteId = Number(req.params.id);
  if (!clienteId || clienteId < 1) throw httpError(400, 'ID inválido');

  const { metodo, notas } = req.body || {};

  const cliente = getOne(`SELECT id FROM clientes WHERE id = ?`, [clienteId]);
  if (!cliente) throw httpError(404, 'Cliente no encontrado');

  const ahoraIso = new Date().toISOString();
  const result = transaction(() => {
    const cuentaRef = getOne(
      `SELECT cc.*, (${SALDO_BCV_SQL}) AS saldo_pendiente_bcv
       FROM cuentas_cobrar cc
       LEFT JOIN ventas v ON v.id = cc.venta_id
       WHERE cc.cliente_id = ? AND cc.estado IN ('pendiente','vencida')
       ORDER BY cc.fecha_vencimiento ASC NULLS LAST
       LIMIT 1`,
      [clienteId]
    );
    if (!cuentaRef) throw httpError(400, 'El cliente no tiene cuentas pendientes');

    const resuelto = resolverMontoAbono(req.body || {}, cuentaRef, null);
    let restante = resuelto.montoUsdEfectivo;
    let totalAplicado = 0;

    const cuentas = getAll(
      `SELECT id, saldo_pendiente_usd FROM cuentas_cobrar
       WHERE cliente_id = ? AND estado IN ('pendiente','vencida')
       ORDER BY fecha_vencimiento ASC NULLS LAST`,
      [clienteId]
    );

    for (const cuenta of cuentas) {
      if (restante <= 0) break;
      const saldoActual = Number(cuenta.saldo_pendiente_usd);
      const aplicar = Math.min(restante, saldoActual);
      const nuevoSaldo = Math.max(0, saldoActual - aplicar);
      run(
        `UPDATE cuentas_cobrar
         SET saldo_pendiente_usd = ?,
             estado = CASE WHEN ? <= 0 THEN 'pagada' ELSE estado END,
             actualizado_en = ?
         WHERE id = ?`,
        [nuevoSaldo.toFixed(4), nuevoSaldo.toFixed(4), ahoraIso, cuenta.id]
      );
      restante -= aplicar;
      totalAplicado += aplicar;
    }

    run(
      `INSERT INTO pagos_credito
         (cliente_id, monto_usd, monto_bs, tasa_cambio, metodo_pago, notas, usuario_id, fecha_pago)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clienteId,
        totalAplicado.toFixed(4),
        resuelto.montoBs != null ? Number(resuelto.montoBs).toFixed(2) : null,
        resuelto.tasaCambio != null ? Number(resuelto.tasaCambio).toFixed(4) : null,
        resuelto.metodo || metodo || 'efectivo_usd',
        notas || null,
        req.user?.id || null,
        ahoraIso
      ]
    );

    if (totalAplicado > 0) {
      run(
        `UPDATE clientes
            SET saldo_deuda_usd = MAX(0, COALESCE(saldo_deuda_usd, 0) - ?),
                actualizado_en = ?
          WHERE id = ?`,
        [totalAplicado.toFixed(4), ahoraIso, clienteId]
      );
    }

    return {
      ok: true,
      monto_aplicado: totalAplicado,
      monto_aplicado_bcv: resuelto.refBcv,
      monto_bs_registrado: resuelto.montoBs,
      tasa_bcv_aplicada: resuelto.tasaCambio
    };
  });

  res.json(result);
}

/* ─── CREATE ─── */
async function create(req, res) {
  const body = req.body || {};
  if (!body.nombre || String(body.nombre).trim().length === 0) {
    throw httpError(400, 'El nombre es obligatorio');
  }

  const cols = [], vals = [], placeholders = [];
  for (const key of INSERTABLE) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let v = body[key];
    if (key === 'nombre' && typeof v === 'string') v = v.trim();
    if (['cedula_rif','email','direccion','notas'].includes(key)) v = normalizeNullable(v);
    if (key === 'telefono') {
      v = normalizeNullable(v);
      if (typeof v === 'string') v = v.trim() || null;
      if (v) {
        const r = normalizarTelefonoMovilVeOpcional(v);
        if (!r.ok) throw httpError(400, r.error);
        v = r.normalizado;
      }
    }
    if (typeof v === 'boolean') v = v ? 1 : 0;
    cols.push(key); vals.push(v); placeholders.push('?');
  }
  if (!cols.includes('nombre')) {
    cols.push('nombre'); vals.push(String(body.nombre).trim()); placeholders.push('?');
  }

  let inserted;
  try {
    const r = run(
      `INSERT INTO clientes (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
      vals
    );
    inserted = getOne(`SELECT * FROM clientes WHERE id = ?`, [r.lastInsertRowid]);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw httpError(409, 'Ya existe un cliente con esa cédula/RIF');
    throw e;
  }
  res.status(201).json(inserted);
}

/* ─── UPDATE ─── */
async function update(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID inválido');

  const prev = getOne(`SELECT id FROM clientes WHERE id = ?`, [id]);
  if (!prev) throw httpError(404, 'Cliente no encontrado');

  const body = req.body || {};
  const pairs = [], vals = [];

  Object.keys(body).forEach((key) => {
    if (['id','creado_en'].includes(key)) return;
    if (!INSERTABLE.includes(key)) return;
    let v = body[key];
    if (key === 'nombre' && typeof v === 'string') v = v.trim();
    if (['cedula_rif','email','direccion','notas'].includes(key)) v = normalizeNullable(v);
    if (key === 'telefono') {
      v = normalizeNullable(v);
      if (typeof v === 'string') v = v.trim() || null;
      if (v) {
        const r = normalizarTelefonoMovilVeOpcional(v);
        if (!r.ok) throw httpError(400, r.error);
        v = r.normalizado;
      }
    }
    if (typeof v === 'boolean') v = v ? 1 : 0;
    pairs.push(`${key} = ?`);
    vals.push(v);
  });

  if (pairs.length === 0) throw httpError(400, 'No hay campos para actualizar');
  vals.push(id);

  let updated;
  try {
    run(`UPDATE clientes SET ${pairs.join(', ')} WHERE id = ?`, vals);
    updated = getOne(`SELECT * FROM clientes WHERE id = ?`, [id]);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw httpError(409, 'Ya existe un cliente con esa cédula/RIF');
    throw e;
  }
  res.json(updated);
}

/* ─── SOFT DELETE ─── */
async function softDelete(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID inválido');
  const r = run(`UPDATE clientes SET activo = 0 WHERE id = ?`, [id]);
  if (r.changes === 0) throw httpError(404, 'Cliente no encontrado');
  const updated = getOne(`SELECT * FROM clientes WHERE id = ?`, [id]);
  res.json(updated);
}

module.exports = {
  list:          asyncHandler(list),
  getById:       asyncHandler(getById),
  perfil:        asyncHandler(perfil),
  registrarPago: asyncHandler(registrarPago),
  create:        asyncHandler(create),
  update:        asyncHandler(update),
  softDelete:    asyncHandler(softDelete)
};
