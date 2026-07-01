'use strict';

/**
 * Cuentas por Pagar — Servicio de negocio.
 * Gestiona deudas con proveedores por compras a crédito y sus abonos.
 */

const { getOne, getAll, run, transaction } = require('../config/db');
const { httpError } = require('../utils/asyncHandler');
const { logger } = require('../config/logger');
const { registrarAuditoria } = require('../middleware/audit.middleware');
const PreciosService = require('./preciosService');

/** Días desde el vencimiento (TEXT ISO → julianday). */
const DIAS_VENCIDOS_CP_SQL = `CAST(julianday(date('now')) - julianday(date(cp.fecha_vencimiento)) AS INTEGER)`;

/**
 * Obtiene la tasa BCV operativa vigente usando la fuente unificada del proyecto
 * (configuracion + historial_tasas, respetando modo solo_bcv y feriados BCV).
 * Async: NO usar dentro de transaction(); resolver antes y pasar el valor.
 * @returns {Promise<number>} tasa BCV (>0) o 1 si no hay registro válido
 */
async function tasaBcvVigente(_t) {
  const tasas = await PreciosService.resolverTasasOperativas();
  const tasa = Number(tasas.tasa_bcv || tasas.bcv || 0);
  return Number.isFinite(tasa) && tasa > 0 ? tasa : 1;
}

/**
 * Fecha (YYYY-MM-DD) en zona horaria de Venezuela (America/Caracas).
 * Evita el desfase de ±1 día que produce toISOString() (UTC) cerca de medianoche.
 * @param {Date} date
 * @returns {string} fecha local de Caracas en formato ISO corto
 */
function fechaLocalCaracas(date) {
  // 'en-CA' produce el formato YYYY-MM-DD de forma estable.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/**
 * Calcula la fecha de vencimiento a partir de los días de crédito,
 * anclada al calendario local de Caracas.
 * @param {number} dias
 * @returns {string|null}
 */
function calcularFechaVencimiento(dias) {
  const d = Number(dias);
  if (!Number.isFinite(d) || d <= 0) return null;
  return fechaLocalCaracas(new Date(Date.now() + d * 86400000));
}

/** Resumen de aging (vencimiento por buckets) + KPIs de deuda total. */
async function resumen() {
  // Actualizar estado 'vencida' donde corresponde antes de leer
  run(`
    UPDATE cuentas_pagar
       SET estado = 'vencida', actualizado_en = ?
     WHERE estado IN ('pendiente','parcial')
       AND fecha_vencimiento IS NOT NULL
       AND date(fecha_vencimiento) < date('now')
  `, [new Date().toISOString()]);

  const tasa = await tasaBcvVigente();

  const totales = getOne(`
    SELECT
      COUNT(*)                                                  AS total_cuentas,
      COALESCE(SUM(cp.saldo_usd), 0)                            AS total_deuda_usd,
      COALESCE(SUM(cp.saldo_usd * COALESCE(cp.tasa_bcv_pactada, ?)), 0)
                                                                AS total_deuda_bcv,
      SUM(CASE WHEN cp.estado = 'vencida' THEN 1 ELSE 0 END)    AS cuentas_vencidas,
      COALESCE(SUM(CASE WHEN cp.estado='vencida' THEN cp.saldo_usd ELSE 0 END), 0)
                                                                AS deuda_vencida_usd,
      COALESCE(SUM(CASE WHEN cp.estado='vencida' THEN cp.saldo_usd * COALESCE(cp.tasa_bcv_pactada, ?) ELSE 0 END), 0)
                                                                AS deuda_vencida_bcv
    FROM cuentas_pagar cp
    WHERE cp.estado IN ('pendiente','parcial','vencida')
  `, [tasa, tasa]);
  const buckets = getAll(`
    SELECT
      CASE
        WHEN cp.fecha_vencimiento IS NULL OR date(cp.fecha_vencimiento) >= date('now') THEN 'corriente'
        WHEN ${DIAS_VENCIDOS_CP_SQL} <= 30    THEN '1_30'
        WHEN ${DIAS_VENCIDOS_CP_SQL} <= 60    THEN '31_60'
        WHEN ${DIAS_VENCIDOS_CP_SQL} <= 90    THEN '61_90'
        ELSE '91_mas'
      END AS bucket,
      COUNT(*)                                              AS cuentas,
      COALESCE(SUM(cp.saldo_usd), 0)                        AS monto_usd,
      COALESCE(SUM(cp.saldo_usd * COALESCE(cp.tasa_bcv_pactada, ?)), 0)
                                                            AS monto_bcv
    FROM cuentas_pagar cp
    WHERE cp.estado IN ('pendiente','parcial','vencida')
    GROUP BY 1
    ORDER BY 1
  `, [tasa]);
  const alertas = getAll(`
    SELECT
      p.id, p.nombre, p.telefono,
      COALESCE(SUM(cp.saldo_usd), 0)                       AS deuda_usd,
      COALESCE(SUM(cp.saldo_usd * COALESCE(cp.tasa_bcv_pactada, ?)), 0)
                                                           AS deuda_bcv,
      MIN(cp.fecha_vencimiento)                            AS vencimiento_mas_viejo,
      SUM(CASE WHEN cp.estado='vencida' THEN 1 ELSE 0 END) AS cuentas_vencidas
    FROM cuentas_pagar cp
    JOIN proveedores p ON p.id = cp.proveedor_id
    WHERE cp.estado IN ('pendiente','parcial','vencida')
      AND date(cp.fecha_vencimiento) < date('now')
    GROUP BY p.id, p.nombre, p.telefono
    ORDER BY deuda_usd DESC
    LIMIT 10
  `, [tasa]);

  return { totales, buckets, tasa_bcv: tasa, alertas_vencidas: alertas };
}

/** Listado paginado de cuentas con filtros. */
async function listCuentas({ estado, proveedor_id, page = 1, limit = 50 }) {
  const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const offset   = (Math.max(Number(page) || 1, 1) - 1) * limitNum;
  const tasa     = await tasaBcvVigente();

  const filterParams = [];
  const conds = ["cp.estado IN ('pendiente','parcial','vencida')"];

  if (estado && ['pendiente','parcial','vencida','pagada','anulada'].includes(estado)) {
    conds.length = 0;
    filterParams.push(estado);
    conds.push(`cp.estado = ?`);
  }
  if (proveedor_id) {
    filterParams.push(Number(proveedor_id));
    conds.push(`cp.proveedor_id = ?`);
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  // Orden de params en la query de listado: tasa×2 (SELECT), ...filterParams, limit, offset
  const rows = getAll(`
    SELECT
      cp.id, cp.compra_id, cp.proveedor_id,
      p.nombre                               AS proveedor_nombre,
      p.rif                                  AS proveedor_rif,
      p.telefono                             AS proveedor_telefono,
      c.numero_compra,
      cp.numero_referencia,
      cp.monto_original_usd,
      cp.monto_pagado_usd,
      cp.saldo_usd,
      (cp.saldo_usd * COALESCE(cp.tasa_bcv_pactada, ?))           AS saldo_bcv,
      (cp.monto_original_usd * COALESCE(cp.tasa_bcv_pactada, ?))  AS monto_original_bcv,
      cp.tasa_bcv_pactada,
      cp.fecha_vencimiento,
      cp.estado,
      cp.notas,
      cp.creado_en,
      CASE
        WHEN cp.fecha_vencimiento IS NULL THEN NULL
        WHEN date(cp.fecha_vencimiento) < date('now') THEN ${DIAS_VENCIDOS_CP_SQL}
        ELSE 0
      END AS dias_vencida
    FROM cuentas_pagar cp
    JOIN proveedores p ON p.id = cp.proveedor_id
    LEFT JOIN compras c ON c.id = cp.compra_id
    ${where}
    ORDER BY cp.estado DESC, cp.fecha_vencimiento ASC NULLS LAST
    LIMIT ? OFFSET ?
  `, [tasa, tasa, ...filterParams, limitNum, offset]);
  const totalRow = getOne(`
    SELECT COUNT(*) AS total
    FROM cuentas_pagar cp
    ${where}
  `, filterParams);

  return { cuentas: rows, total: totalRow.total, page: Number(page) || 1, limit: limitNum, tasa_bcv: tasa };
}

/** Crea una CxP manualmente (no vinculada a compra). */
async function crear({ proveedor_id, monto_usd, dias_credito = 30, notas, numero_referencia, usuario_id, ip_address }) {
  if (!proveedor_id) throw httpError(400, 'proveedor_id es obligatorio');
  const monto = parseFloat(monto_usd);
  if (!Number.isFinite(monto) || monto <= 0) throw httpError(400, 'monto_usd debe ser mayor a 0');

  const tasa = await tasaBcvVigente();
  const fechaVenc = calcularFechaVencimiento(dias_credito);

  const r = run(`
    INSERT INTO cuentas_pagar
      (proveedor_id, numero_referencia, monto_original_usd, saldo_usd,
       tasa_bcv_pactada, fecha_vencimiento, notas, usuario_id)
    VALUES (?,?,?,?,?,?,?,?)
  `, [
    Number(proveedor_id),
    numero_referencia || null,
    monto.toFixed(4),
    monto.toFixed(4),
    tasa,
    fechaVenc,
    notas || null,
    usuario_id || null
  ]);
  const cuenta = getOne(`SELECT * FROM cuentas_pagar WHERE id = ?`, [r.lastInsertRowid]);

  await registrarAuditoria(null, {
    usuario_id,
    accion: 'CREAR_CUENTA_PAGAR',
    tabla_afectada: 'cuentas_pagar',
    registro_id: cuenta.id,
    datos_nuevos: {
      proveedor_id: Number(proveedor_id),
      monto_original_usd: monto.toFixed(4),
      tasa_bcv_pactada: tasa,
      fecha_vencimiento: fechaVenc
    },
    ip_address: ip_address || null
  });

  return { ok: true, cuenta };
}

/**
 * Crea una CxP ligada a una compra (llamado desde compras.routes al recibir).
 * SÍNCRONA: se ejecuta dentro del transaction() que gestiona la recepción;
 * la tasa BCV se resuelve ANTES de la transacción y se pasa en `tasaBcv`.
 */
function crearDesdCompra({ compra, usuario_id, ip_address, tasaBcv }) {
  const tasa = Number.isFinite(Number(tasaBcv)) && Number(tasaBcv) > 0 ? Number(tasaBcv) : 1;
  const dias = Number(compra.dias_credito) || 30;
  const fechaVenc = calcularFechaVencimiento(dias);

  const r = run(`
    INSERT INTO cuentas_pagar
      (compra_id, proveedor_id, numero_referencia, monto_original_usd, saldo_usd,
       tasa_bcv_pactada, fecha_vencimiento, notas, usuario_id)
    VALUES (?,?,?,?,?,?,?,?,?)
  `, [
    compra.id,
    compra.proveedor_id,
    compra.numero_compra,
    Number(compra.total_usd).toFixed(4),
    Number(compra.total_usd).toFixed(4),
    tasa,
    fechaVenc,
    `Compra a crédito ${compra.numero_compra}`,
    usuario_id || null
  ]);
  const cuenta = getOne(`SELECT * FROM cuentas_pagar WHERE id = ?`, [r.lastInsertRowid]);

  void registrarAuditoria(null, {
    usuario_id,
    accion: 'CREAR_CUENTA_PAGAR_COMPRA',
    tabla_afectada: 'cuentas_pagar',
    registro_id: cuenta.id,
    datos_nuevos: {
      compra_id: compra.id,
      numero_compra: compra.numero_compra,
      monto_original_usd: Number(compra.total_usd).toFixed(4),
      tasa_bcv_pactada: tasa,
      fecha_vencimiento: fechaVenc
    },
    ip_address: ip_address || null
  });

  logger.info('CxP creada automáticamente desde compra', {
    cuenta_id: cuenta.id,
    compra_id: compra.id,
    monto_usd: compra.total_usd
  });

  return cuenta;
}

/** Registra un abono (pago parcial o total) a una CxP. */
async function abonar({ cuentaId, monto_usd, monto_bs, tasa_cambio, metodo_pago, referencia, notas, usuario_id, ip_address }) {
  if (!cuentaId || cuentaId < 1) throw httpError(400, 'ID de cuenta inválido');

  const montoAplicar = parseFloat(monto_usd);
  if (!Number.isFinite(montoAplicar) || montoAplicar <= 0) {
    throw httpError(400, 'monto_usd debe ser mayor a 0');
  }

  // Tasa fallback resuelta ANTES de la transacción síncrona.
  const tasaFallback = await tasaBcvVigente();
  const ahoraIso = new Date().toISOString();

  const result = transaction(() => {
    const cuenta = getOne(`
      SELECT cp.*, p.nombre AS proveedor_nombre
      FROM cuentas_pagar cp
      JOIN proveedores p ON p.id = cp.proveedor_id
      WHERE cp.id = ? AND cp.estado IN ('pendiente','parcial','vencida')
    `, [cuentaId]);

    if (!cuenta) throw httpError(404, 'Cuenta no encontrada o ya liquidada/anulada');

    const saldoActual = Number(cuenta.saldo_usd);
    const aplicar    = Math.min(montoAplicar, saldoActual);
    const nuevoSaldo = Math.max(0, saldoActual - aplicar);
    const nuevoPagado = Number(cuenta.monto_pagado_usd) + aplicar;

    let estadoNuevo = 'parcial';
    if (nuevoSaldo <= 0) estadoNuevo = 'pagada';
    else if (cuenta.fecha_vencimiento && new Date(cuenta.fecha_vencimiento) < new Date()) {
      estadoNuevo = 'vencida';
    }

    run(`
      UPDATE cuentas_pagar
         SET saldo_usd       = ?,
             monto_pagado_usd = ?,
             estado           = ?,
             actualizado_en   = ?
       WHERE id = ?
    `, [nuevoSaldo.toFixed(4), nuevoPagado.toFixed(4), estadoNuevo, ahoraIso, cuentaId]);

    const tasaUsar = tasa_cambio
      ? Number(tasa_cambio)
      : (cuenta.tasa_bcv_pactada ? Number(cuenta.tasa_bcv_pactada) : tasaFallback);

    const montoBsCalculado = monto_bs != null
      ? Number(monto_bs)
      : aplicar * tasaUsar;

    run(`
      INSERT INTO pagos_proveedor
        (cuenta_pagar_id, proveedor_id, monto_usd, monto_bs, tasa_cambio,
         metodo_pago, referencia, notas, usuario_id)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, [
      cuentaId,
      cuenta.proveedor_id,
      aplicar.toFixed(4),
      montoBsCalculado.toFixed(2),
      tasaUsar.toFixed(4),
      metodo_pago || 'efectivo_usd',
      referencia || null,
      notas || null,
      usuario_id || null
    ]);

    void registrarAuditoria(null, {
      usuario_id,
      accion: 'PAGO_PROVEEDOR',
      tabla_afectada: 'cuentas_pagar',
      registro_id: cuentaId,
      datos_anteriores: { saldo_usd: saldoActual.toFixed(4), estado: cuenta.estado },
      datos_nuevos: {
        monto_aplicado_usd: aplicar.toFixed(4),
        monto_bs: montoBsCalculado.toFixed(2),
        tasa_cambio: tasaUsar.toFixed(4),
        metodo_pago: metodo_pago || 'efectivo_usd',
        saldo_usd: nuevoSaldo.toFixed(4),
        estado: estadoNuevo
      },
      ip_address: ip_address || null
    });

    return {
      ok: true,
      cuenta_id: cuentaId,
      proveedor_nombre: cuenta.proveedor_nombre,
      monto_aplicado_usd: aplicar,
      monto_bs_registrado: montoBsCalculado,
      tasa_aplicada: tasaUsar,
      saldo_anterior: saldoActual,
      saldo_nuevo: nuevoSaldo,
      estado_nuevo: estadoNuevo
    };
  });

  return result;
}

/** Historial de pagos de una cuenta. */
async function historialPagos(cuentaId) {
  const cuenta = getOne(`
    SELECT cp.*, p.nombre AS proveedor_nombre, p.rif, c.numero_compra
    FROM cuentas_pagar cp
    JOIN proveedores p ON p.id = cp.proveedor_id
    LEFT JOIN compras c ON c.id = cp.compra_id
    WHERE cp.id = ?
  `, [cuentaId]);
  const pagos = getAll(`
    SELECT pp.*, u.nombre_completo AS registrado_por
    FROM pagos_proveedor pp
    LEFT JOIN usuarios u ON u.id = pp.usuario_id
    WHERE pp.cuenta_pagar_id = ?
    ORDER BY pp.creado_en DESC
  `, [cuentaId]);

  if (!cuenta) throw httpError(404, 'Cuenta no encontrada');
  return { cuenta, pagos };
}

/** Anula una CxP (solo si está pendiente, parcial o vencida). */
async function anular(cuentaId, { motivo, usuario_id, ip_address }) {
  const ahoraIso = new Date().toISOString();
  transaction(() => {
    const cuenta = getOne(
      `SELECT * FROM cuentas_pagar
        WHERE id = ? AND estado IN ('pendiente','parcial','vencida')`,
      [cuentaId]
    );
    if (!cuenta) throw httpError(404, 'Cuenta no encontrada o no anulable en su estado actual');

    run(`
      UPDATE cuentas_pagar
         SET estado = 'anulada', notas = COALESCE(notas,'') || ?, actualizado_en = ?
       WHERE id = ?
    `, [`\n[Anulada: ${motivo || 'sin motivo'}]`, ahoraIso, cuentaId]);

    void registrarAuditoria(null, {
      usuario_id,
      accion: 'ANULAR_CUENTA_PAGAR',
      tabla_afectada: 'cuentas_pagar',
      registro_id: cuentaId,
      datos_anteriores: { estado: cuenta.estado, saldo_usd: cuenta.saldo_usd },
      datos_nuevos: { estado: 'anulada', motivo: motivo || 'sin motivo' },
      ip_address: ip_address || null
    });
  });

  logger.info('CxP anulada', { cuenta_id: cuentaId, usuario_id });
  return { ok: true };
}

module.exports = {
  resumen,
  listCuentas,
  crear,
  crearDesdCompra,
  abonar,
  historialPagos,
  anular
};
