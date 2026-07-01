'use strict';

const { getOne, getAll } = require('../config/db');
const PreciosService = require('./preciosService');
const bcvVigencia = require('../utils/bcvVigenciaVe');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

function mapFecha(r) {
  if (r.fecha instanceof Date) {
    const y = r.fecha.getFullYear();
    const m = String(r.fecha.getMonth() + 1).padStart(2, '0');
    const d = String(r.fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(r.fecha || '').slice(0, 10);
}

/**
 * Límites de día en UTC para el día operativo de Venezuela (America/Caracas, UTC−4 fijo).
 * Las fechas en SQLite son TEXT ISO UTC; PG usaba CURRENT_DATE con el huso local del server.
 */
function limitesDiaCaracas(offsetDias = 0) {
  const ymd = bcvVigencia.ymdCaracas();
  const inicioHoy = new Date(`${ymd}T00:00:00-04:00`);
  const inicio = new Date(inicioHoy.getTime() + offsetDias * 86400000);
  const fin = new Date(inicio.getTime() + 86400000);
  return { inicio: inicio.toISOString(), fin: fin.toISOString() };
}

/** Primer instante (UTC ISO) del mes en curso según calendario de Caracas. */
function inicioMesCaracasIso() {
  const ymd = bcvVigencia.ymdCaracas();
  return new Date(`${ymd.slice(0, 7)}-01T00:00:00-04:00`).toISOString();
}

class DashboardService {

  /** KPIs hero + tarjetas (una pasada sobre ventas recientes). */
  static async obtenerKpis(_db) {
    const hoy = limitesDiaCaracas(0);
    const ayer = limitesDiaCaracas(-1);
    const hace6d = limitesDiaCaracas(-6);
    const inicioMes = inicioMesCaracasIso();
    const desdeBase = new Date(new Date(inicioMes).getTime() - 86400000).toISOString();

    const row = getOne(`
      SELECT
        COALESCE(SUM(CASE WHEN v.fecha_venta >= ? AND v.fecha_venta < ?
          THEN v.total_usd ELSE 0 END), 0) AS ventas_hoy,
        COALESCE(SUM(CASE WHEN v.fecha_venta >= ? AND v.fecha_venta < ?
          THEN COALESCE(v.total_ref_usd_bcv, v.total_usd) ELSE 0 END), 0) AS ventas_hoy_bcv,
        SUM(CASE WHEN v.fecha_venta >= ? AND v.fecha_venta < ? THEN 1 ELSE 0 END) AS num_ventas,
        COALESCE(AVG(CASE WHEN v.fecha_venta >= ? AND v.fecha_venta < ?
          THEN v.total_usd END), 0) AS ticket_promedio,
        COALESCE(AVG(CASE WHEN v.fecha_venta >= ? AND v.fecha_venta < ?
          THEN COALESCE(v.total_ref_usd_bcv, v.total_usd) END), 0) AS ticket_promedio_bcv,
        COALESCE(SUM(CASE WHEN v.fecha_venta >= ? AND v.fecha_venta < ?
          THEN v.total_usd ELSE 0 END), 0) AS ventas_ayer,
        COALESCE(SUM(CASE WHEN v.fecha_venta >= ? AND v.fecha_venta < ?
          THEN COALESCE(v.total_ref_usd_bcv, v.total_usd) ELSE 0 END), 0) AS ventas_ayer_bcv,
        COALESCE(SUM(CASE WHEN v.fecha_venta >= ?
          THEN v.total_usd ELSE 0 END), 0) AS ventas_7d,
        COALESCE(SUM(CASE WHEN v.fecha_venta >= ?
          THEN COALESCE(v.total_ref_usd_bcv, v.total_usd) ELSE 0 END), 0) AS ventas_7d_bcv,
        COALESCE(SUM(CASE WHEN v.fecha_venta >= ?
          THEN v.total_usd ELSE 0 END), 0) AS ventas_mes,
        COALESCE(SUM(CASE WHEN v.fecha_venta >= ?
          THEN COALESCE(v.total_ref_usd_bcv, v.total_usd) ELSE 0 END), 0) AS ventas_mes_bcv
      FROM ventas v
      WHERE v.estado = 'completada'
        AND v.fecha_venta >= ?
    `, [
      hoy.inicio, hoy.fin,
      hoy.inicio, hoy.fin,
      hoy.inicio, hoy.fin,
      hoy.inicio, hoy.fin,
      hoy.inicio, hoy.fin,
      ayer.inicio, ayer.fin,
      ayer.inicio, ayer.fin,
      hace6d.inicio,
      hace6d.inicio,
      inicioMes,
      inicioMes,
      desdeBase
    ]);

    const margenRow = getOne(`
      SELECT COALESCE(
        SUM(dv.subtotal_usd - dv.costo_unitario_usd * dv.cantidad)
        / NULLIF(SUM(dv.subtotal_usd), 0) * 100,
        0
      ) AS margen_bruto
      FROM detalles_ventas dv
      INNER JOIN ventas v ON v.id = dv.venta_id
      WHERE v.estado = 'completada'
        AND v.fecha_venta >= ?
        AND v.fecha_venta < ?
    `, [hoy.inicio, hoy.fin]);

    let tasaBcv = 0;
    try {
      // resolverTasasOperativas: defensa en lectura (unifica tasa_usd = tasa_bcv en solo_bcv).
      const tasas = await PreciosService.resolverTasasOperativas();
      tasaBcv = tasas.tasa_bcv || 0;
    } catch (_) { /* tasas no configuradas */ }

    return {
      ventas_hoy: num(row.ventas_hoy),
      ventas_hoy_bcv: round2(row.ventas_hoy_bcv),
      num_ventas: parseInt(row.num_ventas, 10) || 0,
      ticket_promedio: num(row.ticket_promedio),
      ticket_promedio_bcv: round2(row.ticket_promedio_bcv),
      margen_bruto: round2(margenRow && margenRow.margen_bruto),
      ventas_ayer: num(row.ventas_ayer),
      ventas_ayer_bcv: round2(row.ventas_ayer_bcv),
      ventas_7d: num(row.ventas_7d),
      ventas_7d_bcv: round2(row.ventas_7d_bcv),
      ventas_mes: num(row.ventas_mes),
      ventas_mes_bcv: round2(row.ventas_mes_bcv),
      tasa_bcv_usada: tasaBcv
    };
  }

  /** Ganancia real del día (ingresos − costo − comisión Cashea), en ref. $ BCV. */
  static async obtenerGananciaHoy(_db) {
    const hoy = limitesDiaCaracas(0);

    const hoyGananciaReal = getOne(`
      SELECT
        COALESCE(SUM(
          (d.subtotal_usd - d.cantidad * d.costo_unitario_usd)
          * CASE
              WHEN v.total_usd > 0
              THEN COALESCE(v.total_ref_usd_bcv, v.total_usd) / v.total_usd
              ELSE 1
            END
        ), 0) AS ganancia_bruta_bcv
      FROM detalles_ventas d
      JOIN ventas v ON v.id = d.venta_id
      WHERE v.estado = 'completada'
        AND v.fecha_venta >= ?
        AND v.fecha_venta < ?
    `, [hoy.inicio, hoy.fin]);

    const ventasCasheaHoy = getOne(`
      SELECT
        COALESCE(SUM(
          vc.total_comisiones_usd
          * CASE
              WHEN v.total_usd > 0
              THEN COALESCE(v.total_ref_usd_bcv, v.total_usd) / v.total_usd
              ELSE 1
            END
        ), 0) AS comision_total_bcv,
        COALESCE(SUM(
          vc.total_venta_usd
          * CASE
              WHEN v.total_usd > 0
              THEN COALESCE(v.total_ref_usd_bcv, v.total_usd) / v.total_usd
              ELSE 1
            END
        ), 0) AS total_cashea_bcv,
        COUNT(*) AS num_cashea
      FROM ventas_cashea vc
      INNER JOIN ventas v ON v.id = vc.venta_id
      WHERE v.fecha_venta >= ? AND v.fecha_venta < ?
        AND v.estado != 'anulada'
        AND vc.estado_liquidacion != 'ANULADA'
    `, [hoy.inicio, hoy.fin]);

    const gananciaBrutaBcv = num(hoyGananciaReal && hoyGananciaReal.ganancia_bruta_bcv);
    const comisionCasheaBcv = num(ventasCasheaHoy && ventasCasheaHoy.comision_total_bcv);
    const numCasheaHoy = parseInt(ventasCasheaHoy && ventasCasheaHoy.num_cashea, 10) || 0;
    const gananciaRealBcv = Math.round((gananciaBrutaBcv - comisionCasheaBcv) * 100) / 100;

    return {
      gananciaRealBcv,
      comisionCasheaBcv: round2(comisionCasheaBcv),
      totalCasheaBcv: round2(ventasCasheaHoy && ventasCasheaHoy.total_cashea_bcv),
      numCashea: numCasheaHoy,
      hayVentasCashea: numCasheaHoy > 0
    };
  }

  /** Serie de 7 días calendario (incluye hoy) con ref. BCV persistida por venta. */
  static async obtenerVentas7Dias(_db) {
    const hace6d = limitesDiaCaracas(-6);

    // Día Caracas por venta: fecha UTC desplazada −4 h (Venezuela no usa DST).
    const rows = getAll(`
      SELECT DATE(v.fecha_venta, '-4 hours') AS fecha,
             COUNT(*) AS num_ventas,
             COALESCE(SUM(v.total_usd), 0) AS total_usd,
             COALESCE(SUM(COALESCE(v.total_ref_usd_bcv, v.total_usd)), 0) AS total_bcv
      FROM ventas v
      WHERE v.estado = 'completada'
        AND v.fecha_venta >= ?
      GROUP BY DATE(v.fecha_venta, '-4 hours')
      ORDER BY fecha
    `, [hace6d.inicio]);

    const map = {};
    rows.forEach((r) => {
      map[mapFecha(r)] = {
        fecha: mapFecha(r),
        num_ventas: parseInt(r.num_ventas, 10) || 0,
        total_usd: num(r.total_usd),
        total_bcv: round2(r.total_bcv)
      };
    });

    const hoyYmd = bcvVigencia.ymdCaracas();
    const base = new Date(`${hoyYmd}T12:00:00-04:00`);
    const serie = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(base.getTime() - i * 86400000);
      const iso = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(d);
      serie.push(map[iso] || { fecha: iso, num_ventas: 0, total_usd: 0, total_bcv: 0 });
    }
    return serie;
  }

  static async obtenerUltimasVentas(_db, limite = 10) {
    const hoy = limitesDiaCaracas(0);
    const rows = getAll(`
      SELECT v.id, v.numero_venta, v.fecha_venta,
             v.total_usd,
             COALESCE(v.total_ref_usd_bcv, v.total_usd) AS total_bcv,
             v.metodo_pago,
             u.nombre_completo AS cajero,
             COALESCE(c.nombre, 'Cliente general') AS cliente
      FROM ventas v
      JOIN usuarios u ON u.id = v.usuario_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.estado = 'completada'
        AND v.fecha_venta >= ? AND v.fecha_venta < ?
      ORDER BY v.fecha_venta DESC
      LIMIT ?
    `, [hoy.inicio, hoy.fin, limite]);

    return rows.map((r) => ({
      id: r.id,
      numero_venta: r.numero_venta,
      fecha_venta: r.fecha_venta,
      total_bcv: round2(r.total_bcv),
      metodo_pago: r.metodo_pago,
      cajero: r.cajero,
      cliente: r.cliente
    }));
  }

  static async obtenerAlertasStock(_db, limite = 10) {
    const rows = getAll(`
      SELECT nombre,
             stock_actual,
             stock_minimo,
             CASE
               WHEN stock_actual <= 0                  THEN 'agotado'
               WHEN stock_actual <= stock_minimo       THEN 'critico'
               WHEN stock_actual <= stock_minimo * 1.5 THEN 'bajo'
               ELSE 'ok'
             END AS nivel
      FROM productos
      WHERE activo = 1 AND stock_actual <= stock_minimo * 1.5
      ORDER BY stock_actual ASC
      LIMIT ?
    `, [limite]);

    return rows.map((r) => ({
      nombre: r.nombre,
      stock_actual: num(r.stock_actual),
      stock_minimo: num(r.stock_minimo),
      nivel: r.nivel
    }));
  }

  static async obtenerPorVencer(_db, limite = 8) {
    const hoyYmd = bcvVigencia.ymdCaracas();
    const rows = getAll(`
      SELECT nombre, fecha_vencimiento
      FROM productos
      WHERE activo = 1
        AND fecha_vencimiento IS NOT NULL
        AND date(fecha_vencimiento) <= date(?, '+15 days')
        AND date(fecha_vencimiento) >= date(?)
      ORDER BY fecha_vencimiento ASC
      LIMIT ?
    `, [hoyYmd, hoyYmd, limite]);

    return rows.map((r) => ({
      nombre: r.nombre,
      fecha_vencimiento: r.fecha_vencimiento
    }));
  }

  static async obtenerDeudasVencidas(_db, limiteLista = 10) {
    const saldoBcvExpr = `
      COALESCE(
        cc.monto_usd_bcv * cc.saldo_pendiente_usd / NULLIF(cc.monto_original_usd, 0),
        v.total_ref_usd_bcv * cc.saldo_pendiente_usd / NULLIF(v.total_usd, 0),
        cc.saldo_pendiente_usd
      )
    `;
    const hoyYmd = bcvVigencia.ymdCaracas();

    let totales = null;
    try {
      totales = getOne(`
        SELECT
          COUNT(*) AS total_deudores,
          COALESCE(SUM((${saldoBcvExpr})), 0) AS total_deuda_vencida_bcv
        FROM cuentas_cobrar cc
        LEFT JOIN ventas v ON v.id = cc.venta_id
        WHERE cc.estado = 'pendiente'
          AND date(cc.fecha_vencimiento) < date(?)
      `, [hoyYmd]);
    } catch (_e) { totales = null; }

    let rows = [];
    try {
      rows = getAll(`
        SELECT c.nombre,
               (${saldoBcvExpr}) AS saldo_pendiente_bcv,
               cc.fecha_vencimiento
        FROM cuentas_cobrar cc
        JOIN clientes c ON c.id = cc.cliente_id
        LEFT JOIN ventas v ON v.id = cc.venta_id
        WHERE cc.estado = 'pendiente'
          AND date(cc.fecha_vencimiento) < date(?)
        ORDER BY cc.fecha_vencimiento ASC
        LIMIT ?
      `, [hoyYmd, limiteLista]);
    } catch (_e) { rows = []; }

    return {
      items: rows.map((r) => ({
        nombre: r.nombre,
        saldo_pendiente_bcv: round2(r.saldo_pendiente_bcv),
        fecha_vencimiento: r.fecha_vencimiento
      })),
      total_deudores: totales ? parseInt(totales.total_deudores, 10) || 0 : 0,
      total_deuda_vencida_bcv: round2(totales && totales.total_deuda_vencida_bcv)
    };
  }

  static async obtenerTopProductos(_db, limite = 5) {
    const desde = new Date(Date.now() - 30 * 86400000).toISOString();
    const rows = getAll(`
      SELECT p.nombre,
             COALESCE(SUM(dv.cantidad), 0) AS total_unidades,
             COALESCE(SUM(
               dv.subtotal_usd
               * CASE
                   WHEN v.total_usd > 0
                   THEN COALESCE(v.total_ref_usd_bcv, v.total_usd) / v.total_usd
                   ELSE 1
                 END
             ), 0) AS total_bcv
      FROM detalles_ventas dv
      JOIN productos p ON p.id = dv.producto_id
      JOIN ventas v ON v.id = dv.venta_id
      WHERE v.estado = 'completada'
        AND v.fecha_venta >= ?
      GROUP BY p.id, p.nombre
      ORDER BY total_bcv DESC
      LIMIT ?
    `, [desde, limite]);

    return rows.map((r) => ({
      nombre: r.nombre,
      total_unidades: num(r.total_unidades),
      total_bcv: round2(r.total_bcv)
    }));
  }

  static async obtenerVentasPorHora(_db) {
    const hoy = limitesDiaCaracas(0);
    const ayer = limitesDiaCaracas(-1);

    // Hora local Caracas (UTC−4 fijo, sin DST)
    const rows = getAll(`
      SELECT CAST(strftime('%H', fecha_venta, '-4 hours') AS INTEGER) AS hora,
             COALESCE(SUM(COALESCE(total_ref_usd_bcv, total_usd)), 0) AS total_bcv
      FROM ventas
      WHERE estado = 'completada'
        AND fecha_venta >= ? AND fecha_venta < ?
      GROUP BY hora
      ORDER BY hora
    `, [hoy.inicio, hoy.fin]);

    const ventasHoy = Array(24).fill(0);
    rows.forEach((r) => { ventasHoy[r.hora] = round2(r.total_bcv); });

    const rowsAyer = getAll(`
      SELECT CAST(strftime('%H', fecha_venta, '-4 hours') AS INTEGER) AS hora,
             COALESCE(SUM(COALESCE(total_ref_usd_bcv, total_usd)), 0) AS total_bcv
      FROM ventas
      WHERE estado = 'completada'
        AND fecha_venta >= ? AND fecha_venta < ?
      GROUP BY hora
      ORDER BY hora
    `, [ayer.inicio, ayer.fin]);

    const ventasAyer = Array(24).fill(0);
    rowsAyer.forEach((r) => { ventasAyer[r.hora] = round2(r.total_bcv); });

    return {
      horas: Array.from({ length: 24 }, (_, i) => `${i}:00`),
      ventasHoy,
      ventasAyer
    };
  }

  /**
   * Resumen consolidado del dashboard (1 round-trip).
   * @param {{ includeGerencial?: boolean }} opts
   */
  static async obtenerResumen(_db, opts = {}) {
    const includeGerencial = opts.includeGerencial === true;

    const resumen = {
      kpis: await DashboardService.obtenerKpis(),
      ganancia: await DashboardService.obtenerGananciaHoy(),
      ventas7d: await DashboardService.obtenerVentas7Dias(),
      ultimasVentas: await DashboardService.obtenerUltimasVentas(null, 10),
      alertasStock: await DashboardService.obtenerAlertasStock(null, 10),
      porVencer: await DashboardService.obtenerPorVencer(null, 8)
    };

    if (includeGerencial) {
      resumen.deudasVencidas = await DashboardService.obtenerDeudasVencidas(null, 10);
      resumen.topProductos   = await DashboardService.obtenerTopProductos(null, 5);
      resumen.ventasPorHora  = await DashboardService.obtenerVentasPorHora(null);
    }

    return resumen;
  }
}

module.exports = DashboardService;
