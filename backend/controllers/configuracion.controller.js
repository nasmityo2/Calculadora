'use strict';

const { getOne, getAll: getAllRows, run, transaction } = require('../config/db');
const PreciosService = require('../services/preciosService');
const SyncService = require('../services/syncService');
const BackupScheduler = require('../services/backupScheduler');
const BcvTasaAutoService = require('../services/bcvTasaAutoService');
const ModoMonedaService = require('../services/modoMonedaService');
const { asyncHandler, httpError } = require('../utils/asyncHandler');
const { normalizarTelefonoMovilVeOpcional } = require('../utils/telefonoVe');
const { clientIp, registrarAuditoria } = require('../middleware/audit.middleware');

const CLAVES_EMPRESA = [
  'empresa_nombre','empresa_rif','empresa_telefono','empresa_direccion',
  'empresa_email','empresa_logo_url',
  'impresora_interfaz','impresora_nombre','impresora_activa'
];

/* ─── GET /api/configuracion/tasas-actuales ─── */
async function getTasasActuales(req, res) {
  // resolverTasasOperativas: misma fuente legal que ventas (respeta feriados y días no
  // hábiles) y unifica tasa_usd = tasa_bcv en modo solo_bcv. Único punto de entrada.
  const tasas = await PreciosService.resolverTasasOperativas();
  res.json({
    tasa_bcv: tasas.tasa_bcv,
    tasa_usd: tasas.tasa_usd,
    bcv: tasas.tasa_bcv,
    usd: tasas.tasa_usd,
    modo_moneda_operacion: tasas.modo_moneda_operacion,
    dia_habil_referencia: tasas.dia_habil_referencia,
    congelada_por_no_habil: tasas.congelada_por_no_habil
  });
}

/* ─── GET /api/configuracion ─── */
async function getAll(req, res) {
  const rows = getAllRows(`SELECT clave, valor FROM configuracion ORDER BY clave`);
  const cfg = {};
  rows.forEach((r) => { cfg[r.clave] = r.valor; });
  res.json(cfg);
}

/* ─── PATCH /api/configuracion ─── */
async function updateGeneral(req, res) {
  const body = req.body || {};

  // El modo monetario NO se cambia por este endpoint genérico: tiene su propia ruta
  // con validación de caja cerrada y auditoría (PATCH /api/configuracion/modo-moneda).
  // Evita un bypass de la regla "caja cerrada" (restricción no negociable #3).
  if (Object.prototype.hasOwnProperty.call(body, ModoMonedaService.CLAVE_MODO)) {
    throw httpError(400, 'Usa PATCH /api/configuracion/modo-moneda para cambiar el modo monetario');
  }

  const updates = Object.entries(body).filter(([k]) => CLAVES_EMPRESA.includes(k));
  if (!updates.length) throw httpError(400, 'No hay parámetros válidos');

  // Normalización (puede lanzar 400) ANTES de la transacción síncrona.
  const normalizados = updates.map(([clave, valor]) => {
    let strVal = String(valor ?? '').trim();
    if (
      (clave === 'empresa_telefono' || clave === 'telefono_empresa') &&
      strVal !== ''
    ) {
      const r = normalizarTelefonoMovilVeOpcional(strVal);
      if (!r.ok) throw httpError(400, r.error);
      strVal = r.normalizado;
    }
    return [clave, strVal];
  });

  const ahoraIso = new Date().toISOString();
  transaction(() => {
    for (const [clave, strVal] of normalizados) {
      run(
        `INSERT INTO configuracion (clave, valor, actualizado_en, actualizado_por)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (clave) DO UPDATE
         SET valor = excluded.valor, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por`,
        [clave, strVal, ahoraIso, req.user?.id || null]
      );
    }
  });
  res.json({ ok: true });
}

/**
 * PATCH /api/configuracion/modo-moneda
 * Cambia modo_moneda_operacion (multimoneda | solo_bcv). Solo admin (tasas_edit).
 * Body: { modo_moneda_operacion: 'multimoneda'|'solo_bcv', tasa_usd?: number }
 *
 * Reglas no negociables:
 *  - Rechaza con 409 si hay alguna sesión de caja abierta.
 *  - solo_bcv  → fuerza tasa_usd = tasa_bcv de inmediato.
 *  - multimoneda → solo toca tasa_usd si se envía una nueva (la UI la pide al salir de solo_bcv).
 *  - Registra auditoría del cambio (tabla auditoria).
 *  - Nunca modifica ventas, historial ni tasas históricas: solo inserta filas/parámetros nuevos.
 */
async function patchModoMoneda(req, res) {
  const body = req.body || {};
  const modo = String(body.modo_moneda_operacion ?? body.modo ?? '').trim().toLowerCase();
  if (!ModoMonedaService.MODOS_VALIDOS.has(modo)) {
    throw httpError(400, 'modo_moneda_operacion debe ser multimoneda o solo_bcv');
  }

  const usuario_id = req.user && req.user.id ? Number(req.user.id) : null;
  if (!usuario_id || usuario_id < 1) throw httpError(401, 'Usuario no autenticado');

  const ipCliente = clientIp(req);

  // Restricción no negociable: el cambio de modo exige caja cerrada (validación en backend).
  const cajaAbierta = getOne(
    `SELECT id FROM sesiones_caja WHERE estado = 'abierta' AND fecha_cierre IS NULL LIMIT 1`
  );
  if (cajaAbierta) {
    throw httpError(
      409,
      'No se puede cambiar el modo monetario con una caja abierta. Cierra la caja primero.'
    );
  }

  const modoActual = await ModoMonedaService.leerModo();
  const rawUsdNueva = body.tasa_usd != null && body.tasa_usd !== '' ? body.tasa_usd : null;
  const ahoraIso = new Date().toISOString();

  // transaction() es síncrona: actualizarTasasSync anida con savepoint automático.
  const result = transaction(() => {
    const prev = PreciosService.leerTasasPreviasConfig();

    // 1) Persistir el modo PRIMERO: así la unificación de tasas usa el modo nuevo.
    run(
      `INSERT INTO configuracion (clave, valor, categoria, descripcion, actualizado_en, actualizado_por)
       VALUES (?, ?, 'moneda', 'Modo operativo: multimoneda | solo_bcv', ?, ?)
       ON CONFLICT (clave) DO UPDATE
       SET valor = excluded.valor, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por`,
      [ModoMonedaService.CLAVE_MODO, modo, ahoraIso, usuario_id]
    );

    let usdFinal = prev.tasa_usd;

    if (ModoMonedaService.esSoloBcv(modo)) {
      if (prev.tasa_bcv == null || prev.tasa_bcv <= 0) {
        throw httpError(400, 'No hay tasa BCV configurada para unificar las tasas');
      }
      const r = PreciosService.actualizarTasasSync(
        prev.tasa_bcv, prev.tasa_bcv, usuario_id, ipCliente, modo
      );
      usdFinal = r.tasa_usd;
    } else if (rawUsdNueva != null) {
      const usdNueva4 = PreciosService.redondearTasa4(rawUsdNueva);
      if (Number.isNaN(usdNueva4) || usdNueva4 <= 0) {
        throw httpError(400, 'La tasa USD proporcionada no es válida');
      }
      if (prev.tasa_bcv == null || prev.tasa_bcv <= 0) {
        throw httpError(400, 'No hay tasa BCV configurada');
      }
      if (usdNueva4 < prev.tasa_bcv) {
        throw httpError(400, 'La tasa USD no puede ser menor que la tasa BCV');
      }
      const r = PreciosService.actualizarTasasSync(
        prev.tasa_bcv, usdNueva4, usuario_id, ipCliente, modo
      );
      usdFinal = r.tasa_usd;
    }
    // multimoneda sin tasa_usd nueva → no se toca tasa_usd vigente.

    void registrarAuditoria(null, {
      usuario_id,
      accion: 'CAMBIAR_MODO_MONEDA',
      tabla_afectada: 'configuracion',
      registro_id: null,
      datos_anteriores: { modo_moneda_operacion: modoActual, tasa_usd: prev.tasa_usd },
      datos_nuevos: { modo_moneda_operacion: modo, tasa_usd: usdFinal },
      ip_address: ipCliente
    });

    return { modo_moneda_operacion: modo, tasa_bcv: prev.tasa_bcv, tasa_usd: usdFinal };
  });

  res.json({ ok: true, ...result });
}

/**
 * POST /api/configuracion/tasas
 * Body: { tasa_bcv, tasa_usd } o { bcv, usd }
 * Permite actualización parcial: si falta uno de los dos valores, se conserva el vigente en BD.
 */
async function saveTasas(req, res) {
  const body = req.body || {};
  const rawBcv =
    body.tasa_bcv !== undefined && body.tasa_bcv !== null
      ? body.tasa_bcv
      : body.bcv;
  const rawUsd =
    body.tasa_usd !== undefined && body.tasa_usd !== null ? body.tasa_usd : body.usd;

  const usuario_id = req.user && req.user.id ? Number(req.user.id) : null;
  if (!usuario_id || usuario_id < 1) {
    throw httpError(401, 'Usuario no autenticado');
  }

  const needsMerge = rawBcv === undefined || rawBcv === null || rawUsd === undefined || rawUsd === null;
  const ipCliente = clientIp(req);

  // Modo leído antes de la transacción síncrona (sin awaits dentro de transaction()).
  const modo = await ModoMonedaService.leerModo();

  // Leer previo y escribir en una sola transacción para evitar race condition con job medianoche
  const result = transaction(() => {
    let tasasBcvFinal = rawBcv;
    let tasasUsdFinal = rawUsd;

    if (needsMerge) {
      const prev = PreciosService.leerTasasPreviasConfig();
      if (rawBcv === undefined || rawBcv === null) {
        if (prev.tasa_bcv == null) throw httpError(400, 'No hay tasa BCV configurada y no se proporcionó una nueva');
        tasasBcvFinal = prev.tasa_bcv;
      }
      if (rawUsd === undefined || rawUsd === null) {
        if (prev.tasa_usd == null) throw httpError(400, 'No hay tasa USD configurada y no se proporcionó una nueva');
        tasasUsdFinal = prev.tasa_usd;
      }
    }

    // actualizarTasasSync anida su transaction() con savepoint automático.
    return PreciosService.actualizarTasasSync(tasasBcvFinal, tasasUsdFinal, usuario_id, ipCliente, modo);
  });

  res.json({
    ok: true,
    tasa_bcv: result.tasa_bcv,
    tasa_usd: result.tasa_usd
  });
}

/** GET público para POS (vendedores sin config_read): % IVA de ventas. */
async function getImpuestoIvaVenta(req, res) {
  const pct = await PreciosService.leerImpuestoIvaPorcentaje();
  res.json({ impuesto_iva: pct });
}

/* ─── Estado del respaldo (archivos pg_dump + programa periódico) ─── */
async function getRespaldoStatus(req, res) {
  const status = await SyncService.getBackupStatus();
  const scheduler = await BackupScheduler.getPublicState();
  res.json({ ...status, scheduler });
}

/** PATCH programa de respaldos por intervalo (configuracion.backup_*). */
async function patchRespaldoScheduler(req, res) {
  const body = req.body || {};

  const autoExplicit = typeof body.backup_automatico !== 'undefined' ? Boolean(body.backup_automatico) : null;
  if (autoExplicit === null) throw httpError(400, 'Se requiere backup_automatico (boolean)');
  let minutos = Number.parseInt(body.intervalo_minutos, 10);
  if (!Number.isFinite(minutos)) throw httpError(400, 'intervalo_minutos inválido');

  minutos = Math.round(minutos);

  let minutosStored = minutos;

  const usuarioId =
    typeof req.user !== 'undefined' && req.user?.id !== undefined ? Number(req.user.id) || null : null;

  const ahoraIso = new Date().toISOString();
  transaction(() => {
    run(
      `INSERT INTO configuracion (clave, valor, actualizado_en, actualizado_por)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (clave) DO UPDATE
       SET valor = excluded.valor, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por`,
      [BackupScheduler.CFG_AUTO, autoExplicit ? 'true' : 'false', ahoraIso, usuarioId]
    );

    if (autoExplicit) {
      if (
        minutos < BackupScheduler.MIN_SCHEDULE_MINUTES ||
        minutos > BackupScheduler.MAX_SCHEDULE_MINUTES
      ) {
        throw httpError(
          400,
          `intervalo_minutos debe estar entre ${BackupScheduler.MIN_SCHEDULE_MINUTES} y ${BackupScheduler.MAX_SCHEDULE_MINUTES}`
        );
      }
      minutosStored = Math.min(
        BackupScheduler.MAX_SCHEDULE_MINUTES,
        Math.max(BackupScheduler.MIN_SCHEDULE_MINUTES, minutosStored)
      );
      const horasTxt = BackupScheduler.intervaloMinutosAHorasTexto(minutosStored);
      run(
        `INSERT INTO configuracion (clave, valor, actualizado_en, actualizado_por)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (clave) DO UPDATE
         SET valor = excluded.valor, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por`,
        [BackupScheduler.CFG_INTERVALO_HORAS, horasTxt, ahoraIso, usuarioId]
      );
    }
  });

  await BackupScheduler.restart();

  const scheduler = await BackupScheduler.getPublicState();

  const rawEnvMs = process.env.NEXUS_BACKUP_INTERVAL_MINUTES;
  let avisoPrioridadEntorno = null;
  if (rawEnvMs !== undefined && rawEnvMs !== null && String(rawEnvMs).trim() !== '') {
    avisoPrioridadEntorno =
      'La variable NEXUS_BACKUP_INTERVAL_MINUTES está definida en el entorno; prevalece sobre la configuración guardada hasta eliminarla o vaciarla.';
  }

  res.json({
    ok: true,
    scheduler,
    aviso: avisoPrioridadEntorno
  });
}

async function getTasaBcvAuto(req, res) {
  const estado = await BcvTasaAutoService.leerEstado(null);
  res.json(estado);
}

async function patchTasaBcvAuto(req, res) {
  const body = req.body || {};
  if (typeof body.activo !== 'boolean') {
    throw httpError(400, 'Se requiere activo (boolean)');
  }
  const usuarioId = req.user?.id != null ? Number(req.user.id) : null;
  const estado = await BcvTasaAutoService.setActivo(
    null,
    body.activo,
    body.feriados,
    usuarioId
  );
  res.json({ ok: true, estado });
}

async function postTasaBcvAutoSync(req, res) {
  const r = await BcvTasaAutoService.sincronizarManual(null);
  res.json({ ok: true, resultado: r });
}

/**
 * POST /api/configuracion/tasa-bcv-auto/feriados/sincronizar
 * Trae el calendario de feriados del servidor (año actual + siguiente) sin tocar la tasa.
 * Solo admins (tasas_edit). Requiere NEXUS_BCV_API_KEY (scope holidays:read).
 */
async function postTasaBcvAutoFeriadosSync(req, res) {
  const r = await BcvTasaAutoService.sincronizarFeriadosManual(null);
  if (r && r.resultado && r.resultado.omitido && r.resultado.motivo === 'sin_api_key') {
    throw httpError(
      409,
      'La sincronización de feriados requiere configurar la clave de la API BCV en el servidor (NEXUS_BCV_API_KEY).'
    );
  }
  res.json({ ok: true, resultado: r });
}

/**
 * Fuerza la aplicación inmediata de la tasa pendiente sin esperar a la medianoche
 * del día fecha valor. Solo disponible para admins (tasas_edit).
 * Útil cuando la tasa semilla inicial es obsoleta y ya existe un pendiente.
 */
async function postTasaBcvAutoForzarAplicar(req, res) {
  const aplicacion = await BcvTasaAutoService.intentarAplicarPendiente(null, {
    forzarInstalacionInicial: true
  });
  const estado = await BcvTasaAutoService.leerEstado(null);
  res.json({ ok: true, aplicacion, estado });
}

/* ─── PATCH /api/configuracion/descuento-cobro-divisa ─────────────────────────
   Guarda el toggle + porcentaje del descuento al cobrar en divisa.
   Requiere config_write. Solo relevante en modo multimoneda.
   Body: { activo: boolean, pct: number (0–100) }
   ─────────────────────────────────────────────────────────────────────────── */
async function patchDescuentoCobroDivisa(req, res) {
  const body = req.body || {};

  if (typeof body.activo !== 'boolean') {
    throw httpError(400, 'Se requiere activo (boolean)');
  }
  const pct = parseFloat(String(body.pct ?? '0').replace(',', '.'));
  if (Number.isNaN(pct) || pct < 0 || pct > 100) {
    throw httpError(400, 'pct debe ser un número entre 0 y 100');
  }
  // step 0.5 — redondear a 1 decimal (0.5 mínimo)
  const pctRed = Math.round(pct * 2) / 2;

  const usuarioId = req.user?.id != null ? Number(req.user.id) : null;

  const ahoraIso = new Date().toISOString();
  transaction(() => {
    run(
      `INSERT INTO configuracion (clave, valor, categoria, actualizado_en, actualizado_por)
       VALUES ('descuento_cobro_divisa_activo', ?, 'ventas', ?, ?)
       ON CONFLICT (clave) DO UPDATE
       SET valor = excluded.valor, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por`,
      [body.activo ? 'true' : 'false', ahoraIso, usuarioId]
    );
    run(
      `INSERT INTO configuracion (clave, valor, categoria, actualizado_en, actualizado_por)
       VALUES ('descuento_cobro_divisa_pct', ?, 'ventas', ?, ?)
       ON CONFLICT (clave) DO UPDATE
       SET valor = excluded.valor, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por`,
      [String(pctRed), ahoraIso, usuarioId]
    );
  });

  res.json({ ok: true, activo: body.activo, pct: pctRed });
}

/* ─── Modo red multi-cajero (Fase 6) ──────────────────────────────────────────
   El backend solo escucha en 0.0.0.0 cuando modo_red_activo='1' (bind decidido al
   arrancar en server.js). Cambiarlo requiere reiniciar la aplicación; JWT y permisos
   se mantienen intactos en todas las rutas. */

/** IPs IPv4 locales no internas (para cajeros secundarios en la misma red). */
function ipsLocales() {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

/* ─── GET /api/configuracion/modo-red ─── */
async function getModoRed(req, res) {
  const row = getOne(`SELECT valor FROM configuracion WHERE clave = 'modo_red_activo' LIMIT 1`);
  const activo = row?.valor === '1';
  const puerto = Number(process.env.PORT || 3000);
  const ips = activo ? ipsLocales() : [];
  const urls = ips.map((ip) => `http://${ip}:${puerto}`);

  let qrDataUrl = null;
  if (activo && urls.length > 0) {
    try {
      const QRCode = require('qrcode');
      qrDataUrl = await QRCode.toDataURL(urls[0], { margin: 1, width: 220 });
    } catch (e) {
      // Sin QR no se bloquea la respuesta: la URL en texto sigue siendo utilizable.
      qrDataUrl = null;
    }
  }

  res.json({ activo, puerto, ips, urls, qr: qrDataUrl });
}

/* ─── PATCH /api/configuracion/modo-red ─── */
async function patchModoRed(req, res) {
  const body = req.body || {};
  if (typeof body.activo !== 'boolean') {
    throw httpError(400, 'activo (boolean) es obligatorio');
  }

  const usuarioId = req.user?.id != null ? Number(req.user.id) : null;
  const ahoraIso = new Date().toISOString();
  run(
    `INSERT INTO configuracion (clave, valor, categoria, actualizado_en, actualizado_por)
     VALUES ('modo_red_activo', ?, 'sistema', ?, ?)
     ON CONFLICT (clave) DO UPDATE
     SET valor = excluded.valor, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por`,
    [body.activo ? '1' : '0', ahoraIso, usuarioId]
  );

  registrarAuditoria(null, {
    usuario_id: usuarioId,
    accion: body.activo ? 'MODO_RED_ACTIVADO' : 'MODO_RED_DESACTIVADO',
    tabla: 'configuracion',
    ip: clientIp(req)
  });

  res.json({
    ok: true,
    activo: body.activo,
    requiere_reinicio: true,
    mensaje: body.activo
      ? 'Modo red activado. Reinicia la aplicación para que el servidor acepte cajeros en la red local.'
      : 'Modo red desactivado. Reinicia la aplicación para volver a escuchar solo en este equipo.'
  });
}

module.exports = {
  getAll:            asyncHandler(getAll),
  getTasasActuales:  asyncHandler(getTasasActuales),
  getImpuestoIvaVenta: asyncHandler(getImpuestoIvaVenta),
  updateGeneral:     asyncHandler(updateGeneral),
  patchModoMoneda:   asyncHandler(patchModoMoneda),
  saveTasas:         asyncHandler(saveTasas),
  getRespaldoStatus: asyncHandler(getRespaldoStatus),
  patchRespaldoScheduler: asyncHandler(patchRespaldoScheduler),
  getTasaBcvAuto:    asyncHandler(getTasaBcvAuto),
  patchTasaBcvAuto:  asyncHandler(patchTasaBcvAuto),
  postTasaBcvAutoSync: asyncHandler(postTasaBcvAutoSync),
  postTasaBcvAutoFeriadosSync: asyncHandler(postTasaBcvAutoFeriadosSync),
  postTasaBcvAutoForzarAplicar: asyncHandler(postTasaBcvAutoForzarAplicar),
  patchDescuentoCobroDivisa: asyncHandler(patchDescuentoCobroDivisa),
  getModoRed:        asyncHandler(getModoRed),
  patchModoRed:      asyncHandler(patchModoRed)
};
