'use strict';

const { getOne, getAll, run } = require('../config/db');
const { logger } = require('../config/logger');
const { asyncHandler, httpError } = require('../utils/asyncHandler');
const { registrarAuditoria, clientIp } = require('../middleware/audit.middleware');
const SyncService = require('../services/syncService');
const PreciosService = require('../services/preciosService');
const { hasPermission } = require('../middleware/permissions.middleware');

/** Fragmento SQL reutilizable: explota ventas.pagos (TEXT JSON) con json_each. */
const PAGOS_JSON_EACH = `json_each(
  CASE WHEN json_valid(v.pagos) AND json_type(v.pagos) = 'array' THEN v.pagos ELSE '[]' END
)`;

/**
 * Suma cuota inicial Cashea de la sesión en Bs BCV (cobro en caja) y ref. $ BCV.
 * Prioriza inicialBsBcv / refInicialUsdBcv del JSON pagos; si faltan, aproxima con USD×BCV o BCV/Bs.
 * SQLite: los pagos JSON se procesan en JS (reemplaza el CTE jsonb de PG).
 */
function sumCasheaInicialCobroCierre(sesionId, tasaBcvApertura) {
  let tasa = tasaBcvApertura != null && Number(tasaBcvApertura) > 0 ? Number(tasaBcvApertura) : null;
  if (!tasa) {
    const tRow = getOne(
      `SELECT tasa_bcv FROM historial_tasas ORDER BY fecha DESC NULLS LAST LIMIT 1`
    );
    tasa = tRow && Number(tRow.tasa_bcv) > 0 ? Number(tRow.tasa_bcv) : 0;
  }

  const ventas = getAll(
    `SELECT v.pagos, vc.monto_inicial_usd AS vc_inicial_usd, vc.estado_liquidacion
     FROM ventas v
     LEFT JOIN ventas_cashea vc ON vc.venta_id = v.id
     WHERE v.sesion_caja_id = ? AND v.estado = 'completada'`,
    [sesionId]
  );

  let inicialBsBcv = 0;
  let refInicialUsdBcv = 0;

  for (const venta of ventas) {
    if (venta.estado_liquidacion === 'ANULADA') continue;
    let pagos = [];
    try {
      const parsed = JSON.parse(venta.pagos || '[]');
      pagos = Array.isArray(parsed) ? parsed : [];
    } catch (_e) { pagos = []; }

    for (const pago of pagos) {
      if (!pago || String(pago.metodo || '').trim().toLowerCase() !== 'cashea') continue;
      const d = pago.cashea_desglose && typeof pago.cashea_desglose === 'object'
        ? pago.cashea_desglose
        : null;

      const iniUsdRaw =
        venta.vc_inicial_usd != null
          ? Number(venta.vc_inicial_usd)
          : d && d.montoInicial != null && String(d.montoInicial).trim() !== ''
            ? Number(d.montoInicial)
            : pago.monto != null && String(pago.monto).trim() !== ''
              ? Number(pago.monto)
              : null;
      const iniUsd = Number.isFinite(iniUsdRaw) ? iniUsdRaw : null;

      const iniBsRaw = d && d.inicialBsBcv != null && String(d.inicialBsBcv).trim() !== ''
        ? Number(d.inicialBsBcv)
        : null;
      const iniBs = Number.isFinite(iniBsRaw) ? iniBsRaw : null;

      const refBcvRaw = d && d.refInicialUsdBcv != null && String(d.refInicialUsdBcv).trim() !== ''
        ? Number(d.refInicialUsdBcv)
        : null;
      const refBcv = Number.isFinite(refBcvRaw) ? refBcvRaw : null;

      if (iniBs != null && iniBs > 0) {
        inicialBsBcv += iniBs;
      } else if (tasa > 0 && iniUsd != null) {
        inicialBsBcv += Math.round(iniUsd * tasa * 100) / 100;
      }

      if (refBcv != null && refBcv > 0) {
        refInicialUsdBcv += refBcv;
      } else if (iniBs != null && iniBs > 0 && tasa > 0) {
        refInicialUsdBcv += Math.round((iniBs / tasa) * 100) / 100;
      } else if (iniUsd != null) {
        refInicialUsdBcv += iniUsd;
      }
    }
  }

  return {
    inicialBsBcv: Math.round(inicialBsBcv * 100) / 100,
    refInicialUsdBcv: Math.round(refInicialUsdBcv * 100) / 100
  };
}

/** Desglose por método de pago de una sesión (mismo cálculo en resumenCierre y detalle). */
function totalesPorMetodoSesion(sesionId) {
  return getAll(
    `WITH expanded AS (
       SELECT
         v.id AS venta_id,
         v.tasa_cambio_aplicada,
         CAST(COALESCE(v.total_ref_usd_bcv, v.total_usd, 0) AS NUMERIC) AS ref_venta,
         json_extract(pago.value, '$.metodo') AS metodo,
         UPPER(TRIM(COALESCE(json_extract(pago.value, '$.moneda'), ''))) AS moneda_u,
         CAST(COALESCE(json_extract(pago.value, '$.monto'), 0) AS NUMERIC) AS monto
       FROM ventas v, ${PAGOS_JSON_EACH} AS pago
       WHERE v.sesion_caja_id = ? AND v.estado = 'completada'
         AND json_extract(pago.value, '$.metodo') IS NOT NULL
     ),
     weighted AS (
       SELECT
         venta_id, ref_venta, metodo, moneda_u, monto,
         CASE
           WHEN moneda_u IN ('USD', 'USD_BCV', 'CASHEA') THEN monto
           WHEN moneda_u = 'BS' THEN
             COALESCE(monto / NULLIF(CAST(tasa_cambio_aplicada AS NUMERIC), 0), monto)
           ELSE 0
         END AS w
       FROM expanded
     ),
     sums AS (
       SELECT *, SUM(w) OVER (PARTITION BY venta_id) AS sum_w FROM weighted
     ),
     venta_metodos AS (
       SELECT venta_id, COUNT(DISTINCT metodo) AS num_metodos
       FROM expanded GROUP BY venta_id
     )
     SELECT
       s.metodo,
       COUNT(DISTINCT s.venta_id) AS num_ventas,
       COUNT(DISTINCT CASE WHEN vm.num_metodos > 1 THEN s.venta_id END) AS num_ventas_mixtas,
       COALESCE(SUM(CASE WHEN s.moneda_u IN ('USD', 'USD_BCV', 'CASHEA') THEN s.monto ELSE 0 END), 0) AS total_usd,
       COALESCE(SUM(CASE WHEN s.moneda_u = 'BS' THEN s.monto ELSE 0 END), 0) AS total_bs,
       COALESCE(SUM(CASE WHEN s.sum_w > 0 THEN s.ref_venta * (s.w / s.sum_w) ELSE 0 END), 0) AS total_ref_usd_bcv
     FROM sums s
     INNER JOIN venta_metodos vm ON vm.venta_id = s.venta_id
     GROUP BY s.metodo
     ORDER BY total_ref_usd_bcv DESC`,
    [sesionId]
  );
}

/** Total por método/moneda leyendo el JSON pagos (preciso en ventas mixtas). */
function pagosPorMetodoMoneda(sesionId) {
  return getAll(
    `SELECT
       json_extract(pago.value, '$.metodo') AS metodo,
       json_extract(pago.value, '$.moneda') AS moneda,
       COALESCE(SUM(CAST(json_extract(pago.value, '$.monto') AS NUMERIC)), 0) AS total
     FROM ventas v, ${PAGOS_JSON_EACH} AS pago
     WHERE v.sesion_caja_id = ? AND v.estado = 'completada'
       AND json_extract(pago.value, '$.metodo') IS NOT NULL
     GROUP BY json_extract(pago.value, '$.metodo'), json_extract(pago.value, '$.moneda')`,
    [sesionId]
  );
}

/** Conteo de ventas con más de un método de pago (pago mixto). */
function contarVentasPagoMixto(sesionId) {
  const row = getOne(
    `SELECT COUNT(*) AS n FROM (
       SELECT v.id
       FROM ventas v, ${PAGOS_JSON_EACH} AS pago
       WHERE v.sesion_caja_id = ? AND v.estado = 'completada'
         AND json_extract(pago.value, '$.metodo') IS NOT NULL
       GROUP BY v.id
       HAVING COUNT(DISTINCT json_extract(pago.value, '$.metodo')) > 1
     ) mix`,
    [sesionId]
  );
  return row ? Number(row.n) || 0 : 0;
}

// ─── GET /api/caja/sesion-activa ──────────────────────────────────────────────
async function sesionActiva(req, res) {
  // Buscar primero la sesión propia del usuario
  let sesion = getOne(
    `SELECT sc.*, c.nombre AS caja_nombre, u.nombre_completo AS cajero
     FROM sesiones_caja sc
     JOIN cajas c ON c.id = sc.caja_id
     JOIN usuarios u ON u.id = sc.usuario_id
     WHERE sc.estado = 'abierta' AND sc.fecha_cierre IS NULL AND sc.usuario_id = ?
     ORDER BY sc.fecha_apertura DESC LIMIT 1`,
    [req.user.id]
  );

  // Usuarios con pos_sales pero sin caja_operar (vendedores) pueden vender
  // usando cualquier sesión de caja abierta en el sistema.
  // Se les retorna la sesión disponible para que el POS les habilite el cobro.
  if (!sesion && !hasPermission(req.user, 'caja_operar') && hasPermission(req.user, 'pos_sales')) {
    sesion = getOne(
      `SELECT sc.*, c.nombre AS caja_nombre, u.nombre_completo AS cajero
       FROM sesiones_caja sc
       JOIN cajas c ON c.id = sc.caja_id
       JOIN usuarios u ON u.id = sc.usuario_id
       WHERE sc.estado = 'abierta' AND sc.fecha_cierre IS NULL
       ORDER BY sc.fecha_apertura DESC LIMIT 1`
    );
  }

  // Información secundaria: ¿hay cajas abiertas de OTROS usuarios?
  const otrasAbiertas = getAll(
    `SELECT sc.id, sc.fecha_apertura, u.nombre_completo AS cajero, u.username
     FROM sesiones_caja sc
     JOIN usuarios u ON u.id = sc.usuario_id
     WHERE sc.estado = 'abierta' AND sc.fecha_cierre IS NULL AND sc.usuario_id != ?
     ORDER BY sc.fecha_apertura ASC`,
    [req.user.id]
  );

  res.json({
    sesion: sesion || null,
    abierta: !!sesion,
    otras_abiertas: otrasAbiertas
  });
}

// ─── GET /api/caja/sesiones-abiertas ──────────────────────────────────────────
// Lista TODAS las sesiones abiertas (cualquier usuario). Solo admin/supervisor.
async function listarAbiertas(req, res) {
  const rows = getAll(
    `SELECT sc.id, sc.caja_id, sc.usuario_id, sc.fecha_apertura,
            sc.monto_inicial_usd, sc.monto_inicial_bs,
            sc.tasa_bcv_apertura, sc.tasa_usd_apertura,
            c.nombre AS caja_nombre,
            u.nombre_completo AS cajero, u.username,
            CAST((julianday('now') - julianday(sc.fecha_apertura)) * 86400 AS INTEGER) AS antiguedad_segundos
     FROM sesiones_caja sc
     JOIN cajas c ON c.id = sc.caja_id
     JOIN usuarios u ON u.id = sc.usuario_id
     WHERE sc.estado = 'abierta' AND sc.fecha_cierre IS NULL
     ORDER BY sc.fecha_apertura ASC`
  );
  res.json({ sesiones: rows });
}

// ─── POST /api/caja/forzar-cierre/:id ─────────────────────────────────────────
// Cierre forzado administrativo de sesiones huérfanas. Solo admin/supervisor.
async function forzarCierre(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de sesión inválido');

  const motivo = req.body && req.body.motivo
    ? String(req.body.motivo).trim().slice(0, 500)
    : 'Cierre forzado administrativo';

  const sesion = getOne(
    `SELECT * FROM sesiones_caja WHERE id = ? AND estado = 'abierta' AND fecha_cierre IS NULL`,
    [id]
  );
  if (!sesion) throw httpError(404, 'Sesión no encontrada o ya cerrada');

  run(
    `UPDATE sesiones_caja
        SET estado = 'cerrada',
            fecha_cierre = ?,
            cierre_forzado = 1,
            notas_cierre = COALESCE(notas_cierre || char(10), '') || ?
      WHERE id = ?`,
    [new Date().toISOString(), motivo, id]
  );

  await registrarAuditoria(null, {
    usuario_id: req.user.id,
    accion: 'CIERRE_FORZADO_CAJA',
    tabla_afectada: 'sesiones_caja',
    registro_id: id,
    datos_anteriores: { estado: 'abierta', usuario_id: sesion.usuario_id },
    datos_nuevos: { estado: 'cerrada', motivo, forzado_por: req.user.id },
    ip_address: clientIp(req)
  });

  res.json({ ok: true, sesion_id: id, mensaje: 'Sesión cerrada forzosamente' });
}

// ─── POST /api/caja/abrir ─────────────────────────────────────────────────────
async function abrir(req, res) {
  const { monto_inicial_usd, monto_inicial_bs, tasa_bcv, tasa_usd, caja_id } = req.body;

  const sesionExistente = getOne(
    `SELECT id FROM sesiones_caja WHERE estado = 'abierta' AND fecha_cierre IS NULL AND usuario_id = ?`,
    [req.user.id]
  );
  if (sesionExistente) {
    throw httpError(409, 'Ya tienes una caja abierta. Ciérrala primero antes de abrir una nueva.');
  }

  let cajaIdFinal = caja_id ? Number(caja_id) : null;
  if (!cajaIdFinal || cajaIdFinal < 1) {
    let cajaDef = getOne(`SELECT id FROM cajas WHERE activa = 1 ORDER BY id LIMIT 1`);
    if (!cajaDef) {
      run(`INSERT INTO cajas (nombre, ubicacion, activa) VALUES ('Caja principal', 'Local', 1)`);
      cajaDef = getOne(`SELECT id FROM cajas ORDER BY id ASC LIMIT 1`);
    }
    cajaIdFinal = cajaDef.id;
  }

  if (tasa_bcv != null && tasa_usd != null && String(tasa_bcv).trim() !== '' && String(tasa_usd).trim() !== '') {
    await PreciosService.actualizarTasas(null, tasa_bcv, tasa_usd, req.user.id, clientIp(req));
  }

  // resolverTasasOperativas: en solo_bcv la apertura de caja usa tasa_usd = tasa_bcv.
  const tasas = await PreciosService.resolverTasasOperativas();

  const r = run(
    `INSERT INTO sesiones_caja (
       caja_id, usuario_id,
       monto_inicial_usd, monto_inicial_bs,
       tasa_bcv_apertura, tasa_usd_apertura,
       tasa_dia, estado
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'abierta')`,
    [
      cajaIdFinal,
      req.user.id,
      parseFloat(monto_inicial_usd) || 0,
      parseFloat(monto_inicial_bs)  || 0,
      tasas.tasa_bcv,
      tasas.tasa_usd,
      tasas.tasa_usd   // tasa_dia (legacy, para compatibilidad)
    ]
  );
  const sesion = getOne(`SELECT * FROM sesiones_caja WHERE id = ?`, [r.lastInsertRowid]);

  res.status(201).json({ ok: true, sesion });
}

// ─── GET /api/caja/resumen-cierre ─────────────────────────────────────────────
// Devuelve todo lo necesario para que el cajero haga el arqueo:
//   • resumenDia: estadísticas generales
//   • montosEsperados: cuánto debería haber por cada método, en su moneda nativa
//   • totalesPorMetodo: tabla de detalle para mostrar en pantalla
async function resumenCierre(req, res) {
  const sesion = getOne(
    `SELECT sc.*, c.nombre AS caja_nombre
     FROM sesiones_caja sc
     JOIN cajas c ON c.id = sc.caja_id
     WHERE sc.estado = 'abierta' AND sc.fecha_cierre IS NULL AND sc.usuario_id = ?
     ORDER BY sc.fecha_apertura DESC LIMIT 1`,
    [req.user.id]
  );
  if (!sesion) {
    throw httpError(404, 'No tienes ninguna caja abierta en este momento');
  }

  // Estadísticas generales del día
  const resumenDia = getOne(
    `SELECT
       COUNT(*) AS total_ventas,
       COALESCE(SUM(CASE WHEN estado = 'completada' THEN total_usd ELSE 0 END), 0) AS total_usd_vendido,
       COALESCE(SUM(CASE WHEN estado = 'completada' THEN COALESCE(total_ref_usd_bcv, total_usd) ELSE 0 END), 0) AS total_ref_usd_bcv_vendido,
       COALESCE(SUM(CASE WHEN estado = 'completada' THEN total_bs  ELSE 0 END), 0) AS total_bs_vendido,
       COUNT(CASE WHEN estado = 'anulada' THEN 1 END) AS ventas_anuladas,
       COALESCE(AVG(CASE WHEN estado = 'completada' THEN total_usd END), 0) AS ticket_promedio,
       COALESCE(AVG(CASE WHEN estado = 'completada' THEN COALESCE(total_ref_usd_bcv, total_usd) END), 0) AS ticket_promedio_ref_usd_bcv
     FROM ventas
     WHERE sesion_caja_id = ?`,
    [sesion.id]
  );
  resumenDia.ventas_pago_mixto = contarVentasPagoMixto(sesion.id);

  // Montos esperados leyendo el JSON pagos directamente para precisión en ventas mixtas.
  const pagosResumen = pagosPorMetodoMoneda(sesion.id);

  // Suma por método/moneda para construir montosEsperados.
  const pmMap = {};
  for (const r of pagosResumen) {
    const k = `${r.metodo}__${r.moneda}`;
    pmMap[k] = parseFloat(r.total) || 0;
  }
  const pm = (metodo, moneda) => pmMap[`${metodo}__${moneda}`] || 0;

  const scRow = getOne(
    `SELECT monto_inicial_usd, monto_inicial_bs FROM sesiones_caja WHERE id = ?`,
    [sesion.id]
  );
  const montosEsperados = {
    efectivo_usd: (parseFloat(scRow.monto_inicial_usd) || 0) + pm('efectivo_usd', 'USD'),
    efectivo_bs:  (parseFloat(scRow.monto_inicial_bs) || 0)  + pm('efectivo_bs', 'BS'),
    zelle_usd:    pm('zelle', 'USD'),
    transferencia_bs: pm('transferencia_bs', 'BS'),
    pago_movil_bs: pm('pago_movil', 'BS'),
    punto_bs:     pm('punto', 'BS'),
    credito_usd_bcv: pm('credito', 'USD_BCV'),
  };

  // Desglose por método: USD calle en total_usd/total_bs; volumen cadena oficial por método
  // como reparto proporcional del total_ref_usd_bcv de cada venta (equiv. USD calle por línea).
  const totalesPorMetodo = totalesPorMetodoSesion(sesion.id);

  // Filtrar ventas_cashea excluyendo las anuladas para todos los totales de cierre.
  const casheaRow = getOne(
    `SELECT
       COALESCE(SUM(vc.monto_inicial_usd), 0) AS total_inicial_cobrado,
       COALESCE(SUM(vc.total_venta_usd), 0) AS total_ticket_usd,
       COALESCE(
         SUM(CASE WHEN vc.estado_liquidacion = 'PENDIENTE' THEN vc.monto_prestado_usd ELSE 0 END),
         0
       ) AS total_prestado_pendiente,
       COALESCE(SUM(vc.total_comisiones_usd), 0) AS total_comisiones,
       COALESCE(SUM(vc.neto_liquidacion_usd), 0) AS neto_esperado_banco,
       COUNT(*) AS cantidad_ventas
     FROM ventas_cashea vc
     INNER JOIN ventas v ON v.id = vc.venta_id
     WHERE v.sesion_caja_id = ?
       AND v.estado = 'completada'
       AND vc.estado_liquidacion != 'ANULADA'`,
    [sesion.id]
  ) ?? {
    total_inicial_cobrado: 0,
    total_ticket_usd: 0,
    total_prestado_pendiente: 0,
    total_comisiones: 0,
    neto_esperado_banco: 0,
    cantidad_ventas: 0
  };

  // Cuota inicial Cashea en Bs BCV (cobro caja) y ref. $ BCV — alineado al POS / JSON desglose.
  const cobroCashea = sumCasheaInicialCobroCierre(sesion.id, sesion.tasa_bcv_apertura);
  montosEsperados.cashea_inicial_bs_bcv = cobroCashea.inicialBsBcv;
  montosEsperados.cashea_inicial_ref_usd_bcv = cobroCashea.refInicialUsdBcv;
  // Libro USD (ventas_cashea); ya no se suma al esperado USD del cierre — el cuadre de inicial va en Bs BCV.
  montosEsperados.cashea_inicial_usd = parseFloat(casheaRow.total_inicial_cobrado) || 0;

  const ventasPorUsuario = getAll(
    `SELECT
       v.usuario_id,
       u.nombre_completo,
       u.username,
       COUNT(*) AS cantidad_ventas,
       COALESCE(SUM(v.total_usd), 0) AS total_usd,
       COALESCE(SUM(COALESCE(v.total_ref_usd_bcv, v.total_usd)), 0) AS total_ref_usd_bcv
     FROM ventas v
     JOIN usuarios u ON u.id = v.usuario_id
     WHERE v.sesion_caja_id = ? AND v.estado = 'completada'
     GROUP BY v.usuario_id, u.nombre_completo, u.username
     ORDER BY cantidad_ventas DESC, u.nombre_completo ASC`,
    [sesion.id]
  );

  res.json({
    sesion,
    resumenDia,
    montosEsperados,
    totalesPorMetodo,
    ventasPorUsuario: ventasPorUsuario.map((r) => ({
      usuario_id: Number(r.usuario_id),
      nombre_completo: r.nombre_completo || '',
      username: r.username || '',
      cantidad_ventas: Number(r.cantidad_ventas) || 0,
      total_usd: parseFloat(r.total_usd) || 0,
      total_ref_usd_bcv: parseFloat(r.total_ref_usd_bcv) || 0
    })),
    cashea: {
      totalInicialCobrado: parseFloat(casheaRow.total_inicial_cobrado),
      totalInicialBsBcv: cobroCashea.inicialBsBcv,
      totalInicialRefUsdBcv: cobroCashea.refInicialUsdBcv,
      totalTicketUsd: parseFloat(casheaRow.total_ticket_usd),
      totalPrestadoPendiente: parseFloat(casheaRow.total_prestado_pendiente),
      totalComisiones: parseFloat(casheaRow.total_comisiones),
      netoEsperadoBanco: parseFloat(casheaRow.neto_esperado_banco),
      cantidadVentas: Number(casheaRow.cantidad_ventas) || 0
    }
  });
}

// ─── POST /api/caja/cerrar ────────────────────────────────────────────────────
// Recibe el conteo físico del cajero, calcula las diferencias y cierra la sesión.
// Una vez cerrada, las ventas de esa sesión quedan bloqueadas (ver ventas.controller).
async function cerrar(req, res) {
  const {
    efectivo_usd_contado,
    efectivo_bs_contado,
    zelle_usd,
    cashea_inicial_bs_contado,
    transferencias_bs,
    pagos_moviles_bs,
    punto_bs,
    notas
  } = req.body;

  const sesion = getOne(
    `SELECT * FROM sesiones_caja WHERE estado = 'abierta' AND fecha_cierre IS NULL AND usuario_id = ?`,
    [req.user.id]
  );
  if (!sesion) {
    throw httpError(404, 'No tienes ninguna caja abierta para cerrar');
  }

  // Totales esperados del sistema leyendo JSON pagos (preciso para ventas mixtas).
  const esperadoRows = pagosPorMetodoMoneda(sesion.id);

  const espMap = {};
  for (const r of esperadoRows) {
    const k = `${r.metodo}__${r.moneda}`;
    espMap[k] = parseFloat(r.total) || 0;
  }
  const ep = (metodo, moneda) => espMap[`${metodo}__${moneda}`] || 0;

  const esperado = {
    efectivo_usd:     ep('efectivo_usd', 'USD'),
    zelle_usd:        ep('zelle', 'USD'),
    efectivo_bs:      ep('efectivo_bs', 'BS'),
    transferencia_bs: ep('transferencia_bs', 'BS'),
    pago_movil_bs:    ep('pago_movil', 'BS'),
    punto_bs:         ep('punto', 'BS'),
  };

  // Cuota inicial Cashea: se cuadra en Bs BCV (cobro en caja), no en USD.
  const cobroCasheaEsp = sumCasheaInicialCobroCierre(sesion.id, sesion.tasa_bcv_apertura);
  const casheaInicialBsEsperado = cobroCasheaEsp.inicialBsBcv;

  // Conteos físicos ingresados por el cajero
  const usdCash  = parseFloat(efectivo_usd_contado) || 0;
  const zelleUsd = parseFloat(zelle_usd) || 0;
  const casheaInicialBsContado = Math.max(0, parseFloat(cashea_inicial_bs_contado) || 0);
  const bsCash   = parseFloat(efectivo_bs_contado) || 0;
  const bsTransf = parseFloat(transferencias_bs) || 0;
  const bsPm     = parseFloat(pagos_moviles_bs) || 0;
  const bsPunto  = parseFloat(punto_bs) || 0;

  // Esperado USD: apertura + ventas (sin cuota inicial Cashea — va en Bs BCV).
  const apertura = sesion;
  const esperadoUsdTotal = (parseFloat(apertura.monto_inicial_usd) || 0) +
    esperado.efectivo_usd +
    esperado.zelle_usd;
  const esperadoBsTotal  = (parseFloat(apertura.monto_inicial_bs) || 0) +
    esperado.efectivo_bs +
    esperado.transferencia_bs +
    esperado.pago_movil_bs +
    esperado.punto_bs +
    casheaInicialBsEsperado;

  // Diferencias: positivo = sobra, negativo = falta
  const difUsd = (usdCash + zelleUsd) - esperadoUsdTotal;
  const difBs  = (bsCash + bsTransf + bsPm + bsPunto + casheaInicialBsContado) - esperadoBsTotal;

  run(
    `UPDATE sesiones_caja SET
       estado                     = 'cerrada',
       fecha_cierre               = ?,
       efectivo_usd_contado       = ?,
       efectivo_bs_contado        = ?,
       zelle_usd_contado          = ?,
       transferencias_bs_contado  = ?,
       pagos_moviles_bs_contado   = ?,
       punto_bs_contado           = ?,
       diferencia_usd             = ?,
       diferencia_bs              = ?,
       notas_cierre               = ?
     WHERE id = ?`,
    [new Date().toISOString(), usdCash, bsCash, zelleUsd, bsTransf, bsPm, bsPunto,
     difUsd, difBs, notas || null, sesion.id]
  );

  await registrarAuditoria(null, {
    usuario_id: req.user.id,
    accion: 'CERRAR_CAJA',
    tabla_afectada: 'sesiones_caja',
    registro_id: sesion.id,
    datos_nuevos: {
      diferencia_usd: difUsd,
      diferencia_bs: difBs,
      efectivo_usd_contado: usdCash,
      efectivo_bs_contado: bsCash,
      cashea_inicial_bs_contado: casheaInicialBsContado,
      cashea_inicial_bs_esperado: casheaInicialBsEsperado
    },
    ip_address: clientIp(req)
  });

  let backupOk = true;
  try {
    await SyncService.runFullBackup({ source: 'caja_cierre' });
  } catch (err) {
    backupOk = false;
    logger.error('Nexus caja: respaldo automático post-cierre fallido', {
      sesion_caja_id: sesion.id,
      err: err && err.message ? err.message : String(err)
    });
  }

  res.json({
    ok: true,
    backup_ok: backupOk,
    message: backupOk
      ? 'Caja cerrada correctamente. ¡Buen trabajo hoy!'
      : 'Caja cerrada. Avisar al administrador: el respaldo automático falló (revisar logs y NEXUS_BACKUP_DIR).',
    diferencias: {
      usd: difUsd,
      bs:  difBs,
      usd_estado: Math.abs(difUsd) < 0.50 ? 'cuadra' : (difUsd > 0 ? 'sobra' : 'falta'),
      bs_estado:  Math.abs(difBs)  < 1.00 ? 'cuadra' : (difBs  > 0 ? 'sobra' : 'falta')
    }
  });
}

// ─── GET /api/caja/historial ──────────────────────────────────────────────────
async function historial(req, res) {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);

  const rows = getAll(
    `SELECT
       sc.id, sc.fecha_apertura, sc.fecha_cierre, sc.estado,
       sc.monto_inicial_usd, sc.monto_inicial_bs,
       sc.diferencia_usd, sc.diferencia_bs,
       sc.notas_cierre,
       c.nombre AS caja_nombre,
       u.nombre_completo AS cajero,
       (SELECT COUNT(*)
          FROM ventas v
          WHERE v.sesion_caja_id = sc.id AND v.estado = 'completada') AS total_ventas,
       (SELECT COALESCE(SUM(COALESCE(v.total_ref_usd_bcv, v.total_usd)), 0)
          FROM ventas v
          WHERE v.sesion_caja_id = sc.id AND v.estado = 'completada') AS total_ref_usd_bcv_vendido,
       (SELECT COALESCE(SUM(v.total_usd), 0)
          FROM ventas v
          WHERE v.sesion_caja_id = sc.id AND v.estado = 'completada') AS total_usd_vendido
     FROM sesiones_caja sc
     JOIN cajas c ON c.id = sc.caja_id
     JOIN usuarios u ON u.id = sc.usuario_id
     ORDER BY sc.fecha_apertura DESC
     LIMIT ?`,
    [limit]
  );
  res.json(rows);
}

// ─── GET /api/caja/detalle/:id ────────────────────────────────────────────────
async function detalle(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de sesión inválido');

  const sesion = getOne(
    `SELECT sc.*, c.nombre AS caja_nombre, u.nombre_completo AS cajero
     FROM sesiones_caja sc
     JOIN cajas c ON c.id = sc.caja_id
     JOIN usuarios u ON u.id = sc.usuario_id
     WHERE sc.id = ?`,
    [id]
  );
  if (!sesion) throw httpError(404, 'Sesión de caja no encontrada');

  const ventasResumen = getOne(
    `SELECT
       COUNT(*) AS total_ventas,
       COUNT(CASE WHEN estado = 'completada' THEN 1 END) AS ventas_completadas,
       COUNT(CASE WHEN estado = 'anulada' THEN 1 END) AS ventas_anuladas,
       COALESCE(SUM(CASE WHEN estado = 'completada' THEN total_usd ELSE 0 END), 0) AS total_usd,
       COALESCE(SUM(CASE WHEN estado = 'completada' THEN COALESCE(total_ref_usd_bcv, total_usd) ELSE 0 END), 0) AS total_ref_usd_bcv,
       COALESCE(SUM(CASE WHEN estado = 'completada' THEN total_bs  ELSE 0 END), 0) AS total_bs,
       COALESCE(AVG(CASE WHEN estado = 'completada' THEN COALESCE(total_ref_usd_bcv, total_usd) END), 0) AS ticket_promedio_ref_usd_bcv
     FROM ventas WHERE sesion_caja_id = ?`,
    [id]
  );
  ventasResumen.ventas_pago_mixto = contarVentasPagoMixto(id);

  // Desglose por método de pago (igual lógica que resumenCierre)
  const totalesPorMetodo = totalesPorMetodoSesion(id);

  // Ventas por usuario en esta sesión
  const ventasPorUsuario = getAll(
    `SELECT
       v.usuario_id,
       u.nombre_completo,
       u.username,
       COUNT(*) AS cantidad_ventas,
       COALESCE(SUM(COALESCE(v.total_ref_usd_bcv, v.total_usd)), 0) AS total_ref_usd_bcv,
       COALESCE(SUM(v.total_bs), 0) AS total_bs
     FROM ventas v
     JOIN usuarios u ON u.id = v.usuario_id
     WHERE v.sesion_caja_id = ? AND v.estado = 'completada'
     GROUP BY v.usuario_id, u.nombre_completo, u.username
     ORDER BY cantidad_ventas DESC, u.nombre_completo ASC`,
    [id]
  );

  // Detalle Cashea para la sesión
  const casheaRow = getOne(
    `SELECT
       COALESCE(SUM(vc.monto_inicial_usd), 0) AS total_inicial_cobrado,
       COALESCE(SUM(vc.total_venta_usd), 0) AS total_ticket_usd,
       COALESCE(SUM(CASE WHEN vc.estado_liquidacion = 'PENDIENTE' THEN vc.monto_prestado_usd ELSE 0 END), 0) AS total_prestado_pendiente,
       COALESCE(SUM(vc.total_comisiones_usd), 0) AS total_comisiones,
       COALESCE(SUM(vc.neto_liquidacion_usd), 0) AS neto_esperado_banco,
       COUNT(*) AS cantidad_ventas
     FROM ventas_cashea vc
     INNER JOIN ventas v ON v.id = vc.venta_id
     WHERE v.sesion_caja_id = ?
       AND v.estado = 'completada'
       AND vc.estado_liquidacion != 'ANULADA'`,
    [id]
  );

  const cobroCashea = sumCasheaInicialCobroCierre(id, sesion.tasa_bcv_apertura);

  res.json({
    sesion,
    ventasResumen: {
      total_ventas: Number(ventasResumen.total_ventas) || 0,
      ventas_completadas: Number(ventasResumen.ventas_completadas) || 0,
      ventas_anuladas: Number(ventasResumen.ventas_anuladas) || 0,
      total_usd: parseFloat(ventasResumen.total_usd) || 0,
      total_ref_usd_bcv: parseFloat(ventasResumen.total_ref_usd_bcv) || 0,
      total_bs: parseFloat(ventasResumen.total_bs) || 0,
      ticket_promedio_ref_usd_bcv: parseFloat(ventasResumen.ticket_promedio_ref_usd_bcv) || 0,
      ventas_pago_mixto: Number(ventasResumen.ventas_pago_mixto) || 0
    },
    totalesPorMetodo: totalesPorMetodo.map((m) => ({
      metodo: m.metodo,
      num_ventas: Number(m.num_ventas) || 0,
      num_ventas_mixtas: Number(m.num_ventas_mixtas) || 0,
      total_usd: parseFloat(m.total_usd) || 0,
      total_bs: parseFloat(m.total_bs) || 0,
      total_ref_usd_bcv: parseFloat(m.total_ref_usd_bcv) || 0
    })),
    ventasPorUsuario: ventasPorUsuario.map((r) => ({
      usuario_id: Number(r.usuario_id),
      nombre_completo: r.nombre_completo || '',
      username: r.username || '',
      cantidad_ventas: Number(r.cantidad_ventas) || 0,
      total_ref_usd_bcv: parseFloat(r.total_ref_usd_bcv) || 0,
      total_bs: parseFloat(r.total_bs) || 0
    })),
    cashea: casheaRow && Number(casheaRow.cantidad_ventas) > 0
      ? {
          totalInicialCobrado: parseFloat(casheaRow.total_inicial_cobrado),
          totalInicialBsBcv: cobroCashea.inicialBsBcv,
          totalInicialRefUsdBcv: cobroCashea.refInicialUsdBcv,
          totalTicketUsd: parseFloat(casheaRow.total_ticket_usd),
          totalPrestadoPendiente: parseFloat(casheaRow.total_prestado_pendiente),
          totalComisiones: parseFloat(casheaRow.total_comisiones),
          netoEsperadoBanco: parseFloat(casheaRow.neto_esperado_banco),
          cantidadVentas: Number(casheaRow.cantidad_ventas)
        }
      : null
  });
}

module.exports = {
  sesionActiva:   asyncHandler(sesionActiva),
  abrir:          asyncHandler(abrir),
  resumenCierre:  asyncHandler(resumenCierre),
  cerrar:         asyncHandler(cerrar),
  historial:      asyncHandler(historial),
  detalle:        asyncHandler(detalle),
  listarAbiertas: asyncHandler(listarAbiertas),
  forzarCierre:   asyncHandler(forzarCierre)
};
