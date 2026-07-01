'use strict';

const { getOne, getAll, run, transaction } = require('../config/db');
const PreciosService = require('../services/preciosService');
const CasheaService = require('../services/casheaService');
const ModoMonedaService = require('../services/modoMonedaService');
const { asyncHandler, httpError } = require('../utils/asyncHandler');
const { registrarAuditoria, clientIp } = require('../middleware/audit.middleware');
const {
  loadDevolucionesPreviasMap,
  buildSaldoPorDetalle
} = require('../utils/devolucionesSaldo');

/**
 * Métodos de cobro en divisa de mercado (USD físico / digital). En modo solo_bcv no
 * existe dólar calle: estos métodos quedan prohibidos en backend (cierre del bypass API).
 * Cashea y crédito NO entran aquí: operan sobre la cadena BCV (referencia $BCV).
 */
const METODOS_USD_CALLE = new Set(['efectivo_usd', 'zelle']);

/**
 * Numeración correlativa VEN-YYYY-NNNNNN.
 * SQLite: reemplaza la SEQUENCE PG + advisory lock con MAX() dentro de la
 * transacción (better-sqlite3 serializa las escrituras: sin carrera posible).
 * SÍNCRONA — solo llamar dentro de transaction().
 */
function nextNumeroVenta() {
  const year = new Date().getFullYear();
  const prefix = `VEN-${year}-`;

  const last = getOne(
    `SELECT numero_venta FROM ventas WHERE numero_venta LIKE ? ORDER BY numero_venta DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let seq = 1;
  if (last && last.numero_venta) {
    const n = parseInt(String(last.numero_venta).slice(prefix.length), 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normalizarPagosVentaJson(pagos) {
  if (pagos == null) return [];
  if (Array.isArray(pagos)) return pagos;
  if (typeof pagos === 'string') {
    try {
      const j = JSON.parse(pagos);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

/**
 * Total ref. $ BCV para API / listados: usa columna si es > 0; si no, reconstruye desde
 * cashea_desglose en pagos (ventas sin total_ref_usd_bcv persistido o previas al parche 029).
 */
function resolverTotalRefUsdBcvParaApi(row) {
  const col = Number(row && row.total_ref_usd_bcv);
  if (Number.isFinite(col) && col > 0) return col;

  const pagos = normalizarPagosVentaJson(row && row.pagos);
  for (let i = 0; i < pagos.length; i += 1) {
    const p = pagos[i];
    if (!p || String(p.metodo || '').toLowerCase() !== 'cashea') continue;
    const d = p.cashea_desglose;
    if (!d || typeof d !== 'object') continue;

    const tvRef = Number(d.totalVentaUsdBcvRef ?? d.totalUsdBcvRef);
    if (Number.isFinite(tvRef) && tvRef > 0) return round4(tvRef);

    const ri = Number(d.refInicialUsdBcv);
    const rp = Number(d.refPrestadoUsdBcv);
    if (
      Number.isFinite(ri) &&
      ri >= 0 &&
      Number.isFinite(rp) &&
      rp >= 0 &&
      ri + rp > 0
    ) {
      return round4(ri + rp);
    }
  }

  const metodo = String(row && row.metodo_pago || '').toLowerCase();
  const reconCadenaDesdeTotalUsd =
    metodo === 'efectivo_bs' ||
    metodo === 'transferencia_bs' ||
    metodo === 'pago_movil' ||
    metodo === 'punto' ||
    metodo === 'mixto';

  if (reconCadenaDesdeTotalUsd) {
    const tbcv =
      Number(row.tasa_bcv_aplicada) ||
      Number(row.historial_tasa_bcv_dia) ||
      NaN;
    const tusd = Number(row.tasa_cambio_aplicada);
    const pe = Number(row.total_usd);
    if (
      Number.isFinite(tbcv) &&
      tbcv > 0 &&
      Number.isFinite(tusd) &&
      tusd > 0 &&
      Number.isFinite(pe) &&
      pe > 0
    ) {
      try {
        const chain = PreciosService.aplicarCadenaPorPrecioEfectivo(pe, tbcv, tusd, { precisionPe: 4 });
        const r = round4(chain.precio_usd_bcv);
        if (r > 0) return r;
      } catch (_) {
        /* tasa inválida o precio cero en cadena */
      }
    }
  }

  return null;
}

/** Tolerancia verificación total USD declarado vs servidor (precios). */
const EPS_USD_PRECIOS = 0.01;
/** Alineado con POS (ajuste operativo USD‑BCV; ~1 céntimo USD). */
const EPS_USD_PAGOS = 0.01;
const EPS_BS_TOTAL = 0.01;

/** SÍNCRONA (lee configuracion via wrapper SQLite). */
function obtenerDescuentoMaxVentaPct(_t, user) {
  if (user.permisos && user.permisos.all) return 100;
  const rn = user.rol_nombre ? String(user.rol_nombre).toLowerCase() : '';
  if (rn === 'admin' || rn === 'supervisor') return 100;
  const row = getOne(`SELECT valor FROM configuracion WHERE clave = 'venta_descuento_max_pct'`);
  const v = row ? parseFloat(String(row.valor).replace(/\s/g, '').replace(',', '.')) : 25;
  if (Number.isNaN(v) || v < 0) return 25;
  return Math.min(100, Math.round(v * 100) / 100);
}

/**
 * Precio unitario USD efectivo según catálogo y tasas vigentes (ignora lo enviado por el cliente).
 * Delega a PreciosService.precioVentaUnitarioCatalogo (M2 — DRY).
 */
function precioUnitarioUsdServidor(producto, tasaBcv, tasaUsd) {
  try {
    return round4(
      PreciosService.precioVentaUnitarioCatalogo(
        producto.costo_usd,
        producto.margen_ganancia_pct,
        producto.precio_manual_usd,
        tasaBcv,
        tasaUsd
      ).precio_usd_efectivo
    );
  } catch (e) {
    throw httpError(400, `Producto "${producto.nombre}": ${e.message}`);
  }
}

/**
 * Ref. USD BCV por unidad — misma cadena que PreciosServiceClient/recalcLine usa en el POS.
 * Delega a PreciosService.precioVentaUnitarioCatalogo (M2 — DRY).
 */
function precioUsdBcvPorUnidad(producto, tasaBcv, tasaUsd) {
  try {
    return round4(
      PreciosService.precioVentaUnitarioCatalogo(
        producto.costo_usd,
        producto.margen_ganancia_pct,
        producto.precio_manual_usd,
        tasaBcv,
        tasaUsd
      ).precio_usd_bcv
    );
  } catch (e) {
    throw httpError(400, `Producto "${producto.nombre}": ${e.message}`);
  }
}

function buildVentasListFilters(req) {
  let where = 'WHERE 1=1';
  const params = [];

  if (req.query.estado) {
    where += ` AND v.estado = ?`;
    params.push(String(req.query.estado));
  }
  if (req.query.desde) {
    where += ` AND v.fecha_venta >= ?`;
    params.push(String(req.query.desde));
  }
  if (req.query.hasta) {
    // ISO-8601 TEXT: < día siguiente 00:00 (comparación lexicográfica)
    where += ` AND v.fecha_venta < date(?, '+1 day')`;
    params.push(String(req.query.hasta));
  }

  return { where, params };
}

async function list(req, res) {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const filtros = buildVentasListFilters(req);

  const rows = getAll(
    `SELECT v.*, c.nombre AS cliente_nombre, ht.tasa_bcv AS historial_tasa_bcv_dia
     FROM ventas v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN historial_tasas ht ON ht.fecha = DATE(v.fecha_venta)
     ${filtros.where}
     ORDER BY v.fecha_venta DESC, v.id DESC
     LIMIT ? OFFSET ?`,
    [...filtros.params, limit, offset]
  );

  const data = rows.map((v) => {
    const ref = resolverTotalRefUsdBcvParaApi(v);
    const { historial_tasa_bcv_dia: _htBcv, ...rest } = v;
    return { ...rest, total_ref_usd_bcv: ref };
  });

  const totalRow = getOne(
    `SELECT COUNT(*) AS total FROM ventas v ${filtros.where}`,
    filtros.params
  );

  res.json({ data, total: totalRow.total, limit, offset });
}

async function getById(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de venta inválido');

  const venta = getOne(
    `SELECT v.*, c.nombre AS cliente_nombre, u.nombre_completo AS usuario_nombre
     FROM ventas v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN usuarios u ON u.id = v.usuario_id
     WHERE v.id = ?`,
    [id]
  );
  if (!venta) throw httpError(404, 'Venta no encontrada');

  if (
    venta.tasa_bcv_aplicada == null &&
    venta.fecha_venta != null
  ) {
    const ht = getOne(
      `SELECT tasa_bcv FROM historial_tasas WHERE fecha = DATE(?) LIMIT 1`,
      [venta.fecha_venta]
    );
    if (ht && ht.tasa_bcv != null) {
      venta.tasa_bcv_aplicada = ht.tasa_bcv;
    }
  }

  venta.total_ref_usd_bcv = resolverTotalRefUsdBcvParaApi(venta);

  const detalles = getAll(
    `SELECT d.*, p.nombre AS producto_nombre, p.codigo_barras, p.codigo_interno
     FROM detalles_ventas d
     JOIN productos p ON p.id = d.producto_id
     WHERE d.venta_id = ?
     ORDER BY d.id ASC`,
    [id]
  );

  let pagos = venta.pagos;
  if (pagos == null) pagos = [];
  else if (typeof pagos === 'string') {
    try {
      pagos = JSON.parse(pagos);
    } catch (_) {
      pagos = [];
    }
  }
  if (!Array.isArray(pagos)) pagos = [];

  const devPrevMap = await loadDevolucionesPreviasMap(null, id);
  const { saldos: devoluciones_saldo, hayPendiente: devolucion_pendiente } =
    buildSaldoPorDetalle(detalles, devPrevMap);

  res.json({ ...venta, pagos, detalles, devoluciones_saldo, devolucion_pendiente });
}

async function create(req, res) {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw httpError(400, 'La venta debe incluir al menos un ítem');

  const usuario_id = req.user && req.user.id ? Number(req.user.id) : null;
  if (!usuario_id || usuario_id < 1) throw httpError(401, 'Usuario no autenticado');

  /* ── Idempotency key: protección contra doble-clic / reintentos automáticos ──
     El cliente debe generar un UUID antes de enviar el POST. Si el servidor
     recibe la misma key dos veces, devuelve la venta original sin duplicar.
     Si la key viene vacía/null, la venta NO es idempotente (modo legacy).
     El check se hace DENTRO de la transacción para evitar la ventana de carrera
     entre el SELECT de duplicado y el INSERT de la venta real. */
  const idempotency_key =
    body.idempotency_key != null && String(body.idempotency_key).trim() !== ''
      ? String(body.idempotency_key).trim().slice(0, 64)
      : null;

  // Usar la sesión resuelta por el middleware cajaAbierta.
  // Para usuarios con caja_operar, el middleware ya exige su propia sesión.
  // Para vendedores (sin caja_operar), el middleware permite usar cualquier sesión abierta.
  const sesionAbiertaUsuario = req.sesionCajaAbierta || null;
  if (!sesionAbiertaUsuario) {
    throw httpError(403, 'Debe realizar la apertura de caja antes de vender');
  }

  const sesion_caja_id = Number(sesionAbiertaUsuario.id);
  const sesionEsPropia = Number(sesionAbiertaUsuario.usuario_id) === usuario_id;

  // Bug-16 guard: si el cliente envió sesion_caja_id, verificar que coincide con la sesión autorizada.
  if (body.sesion_caja_id != null && body.sesion_caja_id !== '') {
    const clientSesId = Number(body.sesion_caja_id);
    if (!Number.isNaN(clientSesId) && clientSesId > 0 && clientSesId !== sesion_caja_id) {
      throw httpError(403, 'sesion_caja_id no coincide con la sesión de caja abierta del usuario');
    }
  }

  const cliente_id =
    body.cliente_id != null && body.cliente_id !== '' ? Number(body.cliente_id) : null;

  const descuento_porcentaje = Number(body.descuento_porcentaje) || 0;
  const descuento_monto_usd = Number(body.descuento_monto_usd) || 0;

  // El método de pago final se resuelve dentro de la transacción (depende del modo monetario).
  const metodoPagoBody = body.metodo_pago ? String(body.metodo_pago) : null;
  const pagos = body.pagos != null ? body.pagos : [];
  const notas = body.notas != null ? String(body.notas) : null;

  const totalUsdClienteRaw = body.total_usd;
  if (totalUsdClienteRaw === undefined || totalUsdClienteRaw === null || totalUsdClienteRaw === '') {
    throw httpError(400, 'total_usd es obligatorio para verificación de precios');
  }
  const total_usd_cliente_declarado = round4(Number(totalUsdClienteRaw));
  if (Number.isNaN(total_usd_cliente_declarado) || total_usd_cliente_declarado < 0) {
    throw httpError(400, 'total_usd inválido');
  }

  let total_bs_cliente_declarado;
  if (
    Object.prototype.hasOwnProperty.call(body, 'total_bs') &&
    body.total_bs !== null &&
    body.total_bs !== ''
  ) {
    const tb = Number(body.total_bs);
    if (Number.isNaN(tb)) throw httpError(400, 'total_bs inválido');
    total_bs_cliente_declarado = round2(tb);
  } else {
    throw httpError(400, 'total_bs es obligatorio');
  }

  /* ── Lecturas async ANTES de la transacción síncrona de better-sqlite3 ──
     (configuración estable: tasas, IVA, descuento divisa; sin awaits dentro del tx). */
  let tasas;
  try {
    // resolverTasasOperativas: único punto de entrada a las tasas operativas.
    // En modo solo_bcv unifica tasa_usd = tasa_bcv antes del recálculo de precios.
    tasas = await PreciosService.resolverTasasOperativas();
  } catch (e) {
    throw httpError(400, e.message || 'No se pudieron leer las tasas de cambio');
  }
  const iva_porcentaje_cfg = await PreciosService.leerImpuestoIvaPorcentaje();
  let divisaCfgPre;
  try {
    divisaCfgPre = await PreciosService.resolverDescuentoCobroDivisaConfig();
  } catch (_e) {
    divisaCfgPre = { activo: false, pct: 0 };
  }

  const result = transaction(() => {
    /* ── 0) Idempotency: check-or-create inside the transaction ── */
    if (idempotency_key) {
      const ventaPrevia = getOne(
        `SELECT v.*, c.nombre AS cliente_nombre
         FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id
         WHERE v.idempotency_key = ? AND v.usuario_id = ?`,
        [idempotency_key, usuario_id]
      );
      if (ventaPrevia) {
        const detallesPrev = getAll(
          `SELECT d.*, p.nombre AS producto_nombre FROM detalles_ventas d
           JOIN productos p ON p.id = d.producto_id WHERE d.venta_id = ? ORDER BY d.id`,
          [ventaPrevia.id]
        );
        // Signal a replay by returning a special object; handled outside the tx.
        return { _idempotentReplay: true, venta: ventaPrevia, detalles: detallesPrev };
      }
    }

    /* ── 1) Verificar que la sesión de caja sigue abierta ── */
    // Si la sesión es propia del usuario, verificar también que el usuario_id coincide.
    // Si es sesión compartida (vendedor usa la caja de un cajero), solo verificar que está abierta.
    const sesCheck = sesionEsPropia
      ? getOne(
          `SELECT id FROM sesiones_caja
           WHERE id = ? AND usuario_id = ? AND estado = 'abierta' AND fecha_cierre IS NULL`,
          [sesion_caja_id, usuario_id]
        )
      : getOne(
          `SELECT id FROM sesiones_caja
           WHERE id = ? AND estado = 'abierta' AND fecha_cierre IS NULL`,
          [sesion_caja_id]
        );
    if (!sesCheck) {
      throw httpError(403, 'Sesión de caja cerrada o no válida');
    }

    const tasa_bcv = tasas.tasa_bcv;
    const tasa_usd_calle = tasas.tasa_usd;
    const esSoloBcvVenta = ModoMonedaService.esSoloBcv(tasas.modo_moneda_operacion);

    /* ── AUD-01: en solo_bcv no se admiten cobros en divisa de mercado (USD físico/Zelle) ──
       El POS los oculta, pero un cliente HTTP o un modal desactualizado podría enviarlos.
       Se rechaza tanto el método de cabecera como cualquier línea de pago en USD calle. */
    if (esSoloBcvVenta) {
      const pagosParaValidar = Array.isArray(pagos) ? pagos : [];
      const hayPagoUsdCalle = pagosParaValidar.some(
        (p) => p && METODOS_USD_CALLE.has(String(p.metodo || '').toLowerCase())
      );
      const cabeceraUsdCalle =
        metodoPagoBody != null && METODOS_USD_CALLE.has(metodoPagoBody.toLowerCase());
      if (hayPagoUsdCalle || cabeceraUsdCalle) {
        throw httpError(
          400,
          'En modo Solo BCV no se permiten cobros en USD físico ni Zelle. Usa Bs, Cashea o crédito $BCV.'
        );
      }
    }

    /* ── AUD-02: método de pago de cabecera según el modo cuando el cliente lo omite ── */
    const metodo_pago =
      metodoPagoBody || (esSoloBcvVenta ? 'efectivo_bs' : 'efectivo_usd');

    /* IVA: solo desde configuración; el body del cliente no define el % usado en cálculo. */
    const iva_porcentaje = iva_porcentaje_cfg;

    /* Descuento global y por línea: tope según rol + configuracion.venta_descuento_max_pct */
    const descuentoMaxPermitido = obtenerDescuentoMaxVentaPct(null, req.user);
    if (descuento_porcentaje > descuentoMaxPermitido) {
      throw httpError(
        400,
        `Descuento de cabecera (${descuento_porcentaje}%) supera el máximo permitido para su rol (${descuentoMaxPermitido}%)`
      );
    }

    const numero_venta = nextNumeroVenta();

    /* ── 2) Líneas: precio unitario recalculado en servidor (ignora precio_unitario_usd del cliente) ──
       Sort items by producto_id ASC before locking to prevent deadlocks when two concurrent
       transactions lock the same products in different orders. */
    const sortedItems = items.slice().sort((a, b) => Number(a.producto_id) - Number(b.producto_id));
    const lineSnapshots = [];

    let sumLineNet = 0;
    /** Suma líneas — ref USD BCV (antes desc. cabecera), igual lógica que cartTotals.uBcv en POS. */
    let sumLineNetBcvUsd = 0;

    for (let i = 0; i < sortedItems.length; i += 1) {
      const it = sortedItems[i];
      const producto_id = Number(it.producto_id);
      const cantidad = Number(it.cantidad);
      if (!producto_id || producto_id < 1 || !cantidad || cantidad <= 0) {
        throw httpError(400, `Ítem ${i + 1}: producto_id y cantidad válidos son obligatorios`);
      }

      // SQLite: sin FOR UPDATE — transaction() serializa las escrituras (WAL).
      const producto = getOne(`SELECT * FROM productos WHERE id = ?`, [producto_id]);
      if (!producto) throw httpError(400, `Producto ${producto_id} no existe`);
      if (!producto.activo) throw httpError(400, `Producto ${producto.nombre} está inactivo`);

      const stock = parseFloat(producto.stock_actual);
      if (Number.isNaN(stock) || stock < cantidad) {
        throw httpError(400, `Stock insuficiente para "${producto.nombre}" (disponible: ${stock})`);
      }

      const precio_unitario_usd = precioUnitarioUsdServidor(producto, tasa_bcv, tasa_usd_calle);

      const desc_line = Number(it.descuento_porcentaje) || 0;
      if (desc_line > descuentoMaxPermitido) {
        throw httpError(
          400,
          `Ítem ${i + 1}: descuento de línea (${desc_line}%) supera el máximo permitido (${descuentoMaxPermitido}%)`
        );
      }

      const lineNet = round4(cantidad * precio_unitario_usd * (1 - desc_line / 100));

      const precio_usd_bcv = precioUsdBcvPorUnidad(producto, tasa_bcv, tasa_usd_calle);
      const lineNetBcvUsd = round4(cantidad * precio_usd_bcv * (1 - desc_line / 100));
      sumLineNetBcvUsd += lineNetBcvUsd;

      const costo_unitario_usd =
        parseFloat(producto.costo_promedio_ponderado_usd) ||
        parseFloat(producto.costo_usd) ||
        0;

      let lote_id = it.lote_id != null && it.lote_id !== '' ? Number(it.lote_id) : null;
      if (lote_id) {
        const lote = getOne(
          `SELECT id FROM lotes_producto WHERE id = ? AND producto_id = ?`,
          [lote_id, producto_id]
        );
        if (!lote) throw httpError(400, `Lote ${lote_id} no corresponde al producto`);
      }

      // SQLite: aplica_iva es INTEGER 0/1 (o NULL legacy = aplica)
      const aplicaIva = producto.aplica_iva == null || Number(producto.aplica_iva) === 1;
      sumLineNet += lineNet;

      const margenUnit = round4(precio_unitario_usd - costo_unitario_usd);
      const margen_contribucion_usd = round4(margenUnit * cantidad * (1 - desc_line / 100));
      const margen_porcentaje =
        costo_unitario_usd > 0
          ? Math.round((margenUnit / costo_unitario_usd) * 10000) / 100
          : null;

      lineSnapshots.push({
        producto_id,
        lote_id,
        cantidad,
        precio_unitario_usd,
        costo_unitario_usd: round4(costo_unitario_usd),
        descuento_porcentaje: desc_line,
        subtotal_usd: lineNet,
        aplica_iva: aplicaIva,
        margen_contribucion_usd,
        margen_porcentaje,
        stock_previo: stock // para la lógica de stock (reemplaza al trigger PG)
      });
    }

    if (sumLineNet <= 0) throw httpError(400, 'Subtotal de líneas inválido');

    const factorBruto =
      (sumLineNet * (1 - descuento_porcentaje / 100) - descuento_monto_usd) / sumLineNet;
    if (factorBruto < 0) throw httpError(400, 'El descuento de cabecera deja el total negativo');

    let discountedNet = 0;
    let iva_monto_usd = 0;
    for (let k = 0; k < lineSnapshots.length; k += 1) {
      const ln = lineSnapshots[k];
      const allocated = round4(ln.subtotal_usd * factorBruto);
      discountedNet += allocated;
      if (ln.aplica_iva && iva_porcentaje > 0) {
        iva_monto_usd += round4(allocated * (iva_porcentaje / 100));
      }
    }
    discountedNet = round4(discountedNet);
    iva_monto_usd = round4(iva_monto_usd);
    const total_usd = round4(discountedNet + iva_monto_usd);

    /** Bs cobro operativo (cadena BCV) — igual criterio que cartTotals.totalBsBcv en POS. */
    const refUsdBcvCabServidor = round4(sumLineNetBcvUsd * factorBruto);
    let total_bs_bcv_operativo = null;
    if (refUsdBcvCabServidor > 0 && tasa_bcv > 0) {
      try {
        total_bs_bcv_operativo = PreciosService.totalBolivaresDesdeRefUsdBcv(
          refUsdBcvCabServidor,
          tasa_bcv
        );
      } catch (_e) {
        total_bs_bcv_operativo = null;
      }
    }

    /* ── 3) Descuento divisa: calcular total a cobrar en USD si aplica ─────────────
       Regla: solo multimoneda + config activa + pct > 0 + pago 100 % efectivo_usd/zelle.
       En ese caso el total cobrado en USD difiere del total_usd a tasa calle:
         totalUsdCobro = total_ref_usd_bcv × (1 − pctDivisa / 100)
       El resto del sistema (Bs BCV, factura, líneas) NO cambia.                     ── */
    const total_ref_usd_bcv = round4(refUsdBcvCabServidor);
    const pagosArr = Array.isArray(pagos) ? pagos : [];

    let descuentoDivisaPct = 0;
    let descuentoDivisaMontoUsd = null;
    let totalUsdEfectivoCobro = total_usd; // default: sin descuento divisa

    if (!esSoloBcvVenta && pagosArr.length > 0) {
      const METODOS_DIVISA_COBRO = new Set(['efectivo_usd', 'zelle']);
      /* Solo cuentan los pagos con monto > 0: el descuento divisa aplica únicamente cuando el
         cobro real (lo que efectivamente entra a caja) es 100 % USD/Zelle. Esto evita que una
         fila en cero de otro método (ruido o cliente manipulado) habilite o anule el descuento
         de forma incorrecta, y reproduce la regla emergente del POS (cobroPaymentsArray filtra
         montos <= 0 antes de enviar). */
      const pagosConMonto = pagosArr.filter((p) => p && Number(p.monto) > 0);
      const esPago100Divisa =
        pagosConMonto.length > 0 &&
        pagosConMonto.every(
          (p) => METODOS_DIVISA_COBRO.has(String(p.metodo || '').toLowerCase())
        );

      if (esPago100Divisa) {
        const divisaCfg = divisaCfgPre;

        if (divisaCfg.activo && divisaCfg.pct > 0) {
          // Verificar que el % no supera el tope de descuento máximo permitido para el rol
          // (misma política que el descuento global de POS).
          if (divisaCfg.pct > descuentoMaxPermitido) {
            throw httpError(
              400,
              `Descuento divisa (${divisaCfg.pct}%) supera el máximo permitido para su rol (${descuentoMaxPermitido}%)`
            );
          }
          const cobro = PreciosService.resolverTotalUsdCobro(total_ref_usd_bcv, divisaCfg.pct);
          totalUsdEfectivoCobro = cobro;
          descuentoDivisaPct = divisaCfg.pct;
          descuentoDivisaMontoUsd = round4(total_ref_usd_bcv - cobro);
        }
      }
    }

    /* ── 3b) Totales USD/Bs vs lo declarado por el POS (detección de manipulación) ── */
    // Cuando aplica descuento divisa, el POS envía totalUsdCobro en lugar del USD calle.
    const totalUsdEsperadoServidor = totalUsdEfectivoCobro;
    if (Math.abs(totalUsdEsperadoServidor - total_usd_cliente_declarado) > EPS_USD_PRECIOS) {
      throw httpError(400, 'Inconsistencia de Precios');
    }

    if (total_bs_bcv_operativo == null || !(total_bs_bcv_operativo > 0)) {
      throw httpError(400, 'No se pudo calcular el total Bs BCV de la venta');
    }
    if (Math.abs(total_bs_bcv_operativo - total_bs_cliente_declarado) > EPS_BS_TOTAL) {
      throw httpError(
        400,
        'Inconsistencia en total Bs BCV: el monto no corresponde a la cadena BCV del ticket'
      );
    }

    const total_bs = total_bs_bcv_operativo;

    /* ── 4) Cuadre de pagos ─────────────────────────────────────────────────────────
       Descuento divisa activo (100 % USD/Zelle): validar directamente en USD (sin
       conversión a tasa calle, los pagos ya son USD físico). La referencia es
       totalUsdEfectivoCobro (= totalUsdCobro descontado).
       Sin descuento divisa: flujo original (sumaPagosEquivUsdCalle vs total_usd). ── */
    let sumaPagosUsd;
    try {
      sumaPagosUsd = PreciosService.sumaPagosEquivUsdCalle(pagosArr, tasa_usd_calle, tasa_bcv);
    } catch (e) {
      throw httpError(400, e.message || 'Error al validar pagos');
    }
    if (totalUsdEfectivoCobro > 0 && pagosArr.length === 0) {
      throw httpError(400, 'Debe indicar al menos un pago para completar la venta');
    }
    const residualPagosUsd = round4(round4(sumaPagosUsd) - round4(totalUsdEfectivoCobro));
    if (Math.abs(residualPagosUsd) > EPS_USD_PAGOS) {
      /* Descuento divisa (100 % USD/Zelle): el ticket Bs sigue en ref. BCV completa; solo el
         cobro USD está descontado. No usar cadena BCV como fallback (siempre fallaría). */
      if (descuentoDivisaPct > 0) {
        throw httpError(400, 'Los pagos no cuadran con el total de la venta (USD equivalente)');
      }
      const bsPayments = pagosArr.filter(
        (p) => p && String(p.moneda || '').toUpperCase() === 'BS'
      );
      const usdPayments = pagosArr.filter(
        (p) => p && String(p.moneda || '').toUpperCase() === 'USD'
      );

      const EPS_BS_CADENA = 1.0; // tolerancia por redondeo cadena BCV

      const soloBS =
        bsPayments.length === pagosArr.length &&
        pagosArr.length > 0 &&
        total_bs_bcv_operativo != null;

      // Pago mixto USD + Bs: el POS calcula el remanente Bs desde la cadena BCV operativa,
      // por lo que sumUSD×tasa_calle + sumBs ≈ total_bs_bcv_operativo (no desde tasa calle pura).
      const mixtoUsdBs =
        !soloBS &&
        bsPayments.length > 0 &&
        usdPayments.length > 0 &&
        total_bs_bcv_operativo != null;

      if (soloBS) {
        const sumBs = round2(bsPayments.reduce((s, p) => s + (Number(p.monto) || 0), 0));
        if (Math.abs(sumBs - total_bs_bcv_operativo) > EPS_BS_CADENA) {
          throw httpError(400, 'Los pagos no cuadran con el total de la venta (USD equivalente)');
        }
      } else if (mixtoUsdBs) {
        const sumUsdDirect = round2(usdPayments.reduce((s, p) => s + (Number(p.monto) || 0), 0));
        const sumBsDirect  = round2(bsPayments.reduce((s, p) => s + (Number(p.monto) || 0), 0));
        const totalBsReconstruido = round2(sumUsdDirect * tasa_usd_calle + sumBsDirect);
        if (Math.abs(totalBsReconstruido - total_bs_bcv_operativo) > EPS_BS_CADENA) {
          throw httpError(400, 'Los pagos no cuadran con el total de la venta (USD equivalente)');
        }
      } else if (total_bs_bcv_operativo != null) {
        // Crédito USD_BCV, Cashea u otros: validar en cadena Bs BCV (como el POS).
        let sumBsCadena;
        try {
          sumBsCadena = PreciosService.sumaPagosEquivBsBcvOperativo(
            pagosArr,
            tasa_usd_calle,
            tasa_bcv,
            { totalVentaUsd: totalUsdEfectivoCobro, totalBsBcvOperativo: total_bs_bcv_operativo }
          );
        } catch (e) {
          throw httpError(400, e.message || 'Error al validar pagos');
        }
        if (Math.abs(round2(sumBsCadena) - round2(total_bs_bcv_operativo)) > EPS_BS_CADENA) {
          throw httpError(400, 'Los pagos no cuadran con el total de la venta (USD equivalente)');
        }
      } else {
        throw httpError(400, 'Los pagos no cuadran con el total de la venta (USD equivalente)');
      }
    }

    const tasa_cambio_aplicada = round4(tasa_usd_calle);
    const tasa_bcv_aplicada = round4(tasa_bcv);
    const ahoraIso = new Date().toISOString();

    const rVenta = run(
      `INSERT INTO ventas (
        numero_venta, sesion_caja_id, cliente_id, usuario_id,
        subtotal_usd, descuento_porcentaje, descuento_monto_usd,
        iva_porcentaje, iva_monto_usd, total_usd, total_bs, total_bs_bcv_operativo, total_bs_cliente,
        tasa_cambio_aplicada,
        tasa_bcv_aplicada,
        total_ref_usd_bcv,
        descuento_divisa_pct, descuento_divisa_monto_usd,
        metodo_pago, pagos, estado, notas, idempotency_key
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?,
        ?,
        ?,
        ?, ?,
        ?, ?, 'completada', ?, ?
      )`,
      [
        numero_venta,
        sesion_caja_id,
        cliente_id,
        usuario_id,
        round4(sumLineNet),
        descuento_porcentaje,
        round4(descuento_monto_usd),
        iva_porcentaje,
        iva_monto_usd,
        totalUsdEfectivoCobro,       // total_usd: lo que se cobró realmente en USD
        total_bs,
        total_bs_bcv_operativo,
        total_bs_cliente_declarado,
        tasa_cambio_aplicada,
        tasa_bcv_aplicada,
        total_ref_usd_bcv,
        descuentoDivisaPct > 0 ? descuentoDivisaPct : null,
        descuentoDivisaMontoUsd,
        metodo_pago,
        JSON.stringify(pagosArr),
        notas,
        idempotency_key
      ]
    );

    const venta_id = rVenta.lastInsertRowid;
    const ventaRow = getOne(`SELECT * FROM ventas WHERE id = ?`, [venta_id]);

    for (let j = 0; j < lineSnapshots.length; j += 1) {
      const ln = lineSnapshots[j];
      const allocatedSubtotal = round4(ln.subtotal_usd * factorBruto);
      run(
        `INSERT INTO detalles_ventas (
          venta_id, producto_id, lote_id,
          cantidad, precio_unitario_usd, costo_unitario_usd,
          descuento_porcentaje, subtotal_usd,
          margen_contribucion_usd, margen_porcentaje
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          venta_id,
          ln.producto_id,
          ln.lote_id,
          ln.cantidad,
          ln.precio_unitario_usd,
          ln.costo_unitario_usd,
          ln.descuento_porcentaje,
          allocatedSubtotal,
          ln.margen_contribucion_usd != null ? round4(ln.margen_contribucion_usd * factorBruto) : null,
          ln.margen_porcentaje
        ]
      );

      /* ── Lógica del trigger PG actualizar_stock_venta (001+019), ahora explícita ──
         Guarda STOCK_INSUFICIENTE ya validada arriba; el CHECK stock_actual >= 0 del
         schema SQLite protege a nivel BD ante cualquier carrera residual. */
      run(
        `UPDATE productos
         SET stock_actual = stock_actual - ?, actualizado_en = ?
         WHERE id = ?`,
        [ln.cantidad, ahoraIso, ln.producto_id]
      );
      run(
        `INSERT INTO ajustes_inventario (
          producto_id, lote_id, tipo, cantidad,
          cantidad_anterior, cantidad_nueva, costo_unitario_usd,
          referencia_id, referencia_tipo, usuario_id
        ) VALUES (?, ?, 'salida_venta', ?, ?, ?, ?, ?, 'venta', ?)`,
        [
          ln.producto_id,
          ln.lote_id,
          ln.cantidad,
          ln.stock_previo,
          ln.stock_previo - ln.cantidad,
          ln.costo_unitario_usd,
          venta_id,
          usuario_id
        ]
      );
    }

    const cp = pagosArr.find((p) => p && String(p.metodo || '').toLowerCase() === 'cashea');
    if (cp && cp.cashea_desglose && typeof cp.cashea_desglose === 'object') {
      CasheaService.registrarPagoCashea(venta_id, cp.cashea_desglose, cp.cashea_nivel, null);
    }

    /* ── 5) Crédito: registrar cuenta por cobrar y actualizar saldo cliente ── */
    const creditoPago = pagosArr.find(
      (p) => p && String(p.metodo || '').toLowerCase() === 'credito'
    );
    if (creditoPago) {
      if (!cliente_id) {
        throw httpError(400, 'Para ventas a crédito debe seleccionar un cliente');
      }
      const montoCreditoUsdBcv = round4(Number(creditoPago.monto) || 0);
      if (montoCreditoUsdBcv <= 0) {
        throw httpError(400, 'El monto del pago a crédito debe ser mayor a 0');
      }

      // Validar límite de crédito si hay cliente asociado.
      if (cliente_id) {
        const clienteRow = getOne(
          `SELECT limite_credito_usd, saldo_deuda_usd FROM clientes WHERE id = ?`,
          [cliente_id]
        );
        if (clienteRow) {
          const limite = parseFloat(clienteRow.limite_credito_usd) || 0;
          const saldoActual = parseFloat(clienteRow.saldo_deuda_usd) || 0;
          // monto_usd_bcv en USD BCV → comparar en USD efectivo contra límite
          const montoEfectivo = round4((montoCreditoUsdBcv * tasa_bcv) / tasa_usd_calle);
          if (limite > 0 && saldoActual + montoEfectivo > limite) {
            throw httpError(
              400,
              `Límite de crédito insuficiente. Disponible: $${round4(limite - saldoActual)} USD. Solicitado: $${montoEfectivo} USD equiv.`
            );
          }
          // Actualizar saldo deuda del cliente (en USD efectivo equiv).
          run(
            `UPDATE clientes SET saldo_deuda_usd = saldo_deuda_usd + ? WHERE id = ?`,
            [montoEfectivo, cliente_id]
          );
        }
      }

      // Registrar en cuentas_cobrar.
      const montoUsdEfectivoEquiv = round4((montoCreditoUsdBcv * tasa_bcv) / tasa_usd_calle);
      run(
        `INSERT INTO cuentas_cobrar (
          venta_id, cliente_id,
          monto_original_usd, monto_usd_bcv,
          saldo_pendiente_usd,
          tasa_bcv_pactada, tasa_usd_pactada,
          estado
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente')`,
        [
          venta_id,
          cliente_id,
          montoUsdEfectivoEquiv, // USD efectivo equiv
          montoCreditoUsdBcv,    // USD BCV (denominación pactada)
          montoUsdEfectivoEquiv,
          tasa_bcv,
          tasa_usd_calle
        ]
      );
    }

    return ventaRow;
  });

  // Idempotent replay: return the existing sale without touching inventario/stock again
  if (result && result._idempotentReplay) {
    return res.status(200).json({ ...result.venta, detalles: result.detalles, idempotent_replay: true });
  }

  const full = getOne(
    `SELECT v.*, c.nombre AS cliente_nombre FROM ventas v
     LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`,
    [result.id]
  );
  const detalles = getAll(
    `SELECT d.*, p.nombre AS producto_nombre FROM detalles_ventas d
     JOIN productos p ON p.id = d.producto_id WHERE d.venta_id = ? ORDER BY d.id`,
    [result.id]
  );

  res.status(201).json({ ...full, detalles });
}

async function anular(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de venta inválido');

  const usuario_id = req.user && req.user.id ? Number(req.user.id) : null;
  if (!usuario_id || usuario_id < 1) throw httpError(401, 'Usuario no autenticado');

  const body = req.body || {};
  const motivo = body.motivo_anulacion ? String(body.motivo_anulacion).trim() : '';
  if (!motivo) throw httpError(400, 'motivo_anulacion es obligatorio');

  const ventaPrev = getOne(`SELECT * FROM ventas WHERE id = ?`, [id]);
  if (!ventaPrev) throw httpError(404, 'Venta no encontrada');
  const detallesPrev = getAll(
    `SELECT * FROM detalles_ventas WHERE venta_id = ? ORDER BY id ASC`,
    [id]
  );

  const ahoraIso = new Date().toISOString();
  transaction(() => {
    // SQLite: sin FOR UPDATE — transaction() serializa las escrituras (WAL).
    const venta = getOne(`SELECT * FROM ventas WHERE id = ?`, [id]);
    if (!venta) throw httpError(404, 'Venta no encontrada');
    if (venta.estado === 'anulada') throw httpError(409, 'La venta ya está anulada');
    if (venta.estado !== 'completada') {
      throw httpError(409, `No se puede anular una venta en estado "${venta.estado}"`);
    }

    const casheaLiquidacion = getOne(
      `SELECT estado_liquidacion FROM ventas_cashea WHERE venta_id = ?`,
      [id]
    );
    if (
      casheaLiquidacion &&
      String(casheaLiquidacion.estado_liquidacion || '').toUpperCase() === 'LIQUIDADO'
    ) {
      throw httpError(
        409,
        'No se puede anular: la venta ya consta como liquidada en Cashea.'
      );
    }

    const detalles = getAll(`SELECT * FROM detalles_ventas WHERE venta_id = ?`, [id]);

    for (let i = 0; i < detalles.length; i += 1) {
      const d = detalles[i];
      const prev = getOne(`SELECT stock_actual FROM productos WHERE id = ?`, [d.producto_id]);
      const v_prev = parseFloat(prev.stock_actual);
      const qty = parseFloat(d.cantidad);
      run(
        `UPDATE productos SET stock_actual = stock_actual + ?, actualizado_en = ? WHERE id = ?`,
        [qty, ahoraIso, d.producto_id]
      );
      run(
        `INSERT INTO ajustes_inventario (
          producto_id, lote_id, tipo, cantidad,
          cantidad_anterior, cantidad_nueva, costo_unitario_usd,
          referencia_id, referencia_tipo, usuario_id, motivo
        ) VALUES (?, ?, 'entrada_anulacion_venta', ?, ?, ?, ?, ?, 'venta', ?, ?)`,
        [
          d.producto_id,
          d.lote_id,
          qty,
          v_prev,
          v_prev + qty,
          d.costo_unitario_usd,
          id,
          usuario_id,
          motivo
        ]
      );
    }

    /* ── Reversa de crédito: si la venta tenía cuenta por cobrar, anularla
       y restituir el límite de crédito del cliente. ── */
    const cuentasCredito = getAll(
      `SELECT id, cliente_id, saldo_pendiente_usd, monto_pagado_usd, monto_original_usd, estado
       FROM cuentas_cobrar WHERE venta_id = ? AND estado != 'anulada'`,
      [id]
    );

    for (const cc of cuentasCredito) {
      const saldoPendiente = parseFloat(cc.saldo_pendiente_usd) || 0;
      const yaPagado = parseFloat(cc.monto_pagado_usd) || 0;

      // Marcar cuenta como anulada
      run(
        `UPDATE cuentas_cobrar
            SET estado = 'anulada',
                saldo_pendiente_usd = 0,
                actualizado_en = ?,
                notas = COALESCE(notas || char(10), '') || 'Anulada por reversa de venta #' || ?
          WHERE id = ?`,
        [ahoraIso, id, cc.id]
      );

      // Restituir saldo de deuda del cliente: descontar el saldo pendiente
      // (no el original, porque puede haber pagos parciales que no se devuelven)
      if (cc.cliente_id && saldoPendiente > 0) {
        run(
          `UPDATE clientes
              SET saldo_deuda_usd = MAX(0, COALESCE(saldo_deuda_usd, 0) - ?),
                  actualizado_en = ?
            WHERE id = ?`,
          [saldoPendiente, ahoraIso, cc.cliente_id]
        );
      }

      // Si el cliente ya hizo pagos parciales, registrar nota informativa
      if (yaPagado > 0) {
        run(
          `INSERT INTO pagos_credito (
             cuenta_cobrar_id, cliente_id, monto_usd, metodo_pago,
             notas, usuario_id, fecha_pago
           ) VALUES (?, ?, 0, 'ajuste_anulacion',
                    'Venta #' || ? || ' anulada. Pagos previos por $' || ? || ' deben devolverse manualmente.',
                    ?, ?)`,
          [cc.id, cc.cliente_id, id, yaPagado.toFixed(2), usuario_id, ahoraIso]
        );
      }
    }

    run(
      `UPDATE ventas SET
        estado = 'anulada',
        motivo_anulacion = ?,
        fecha_anulacion = ?,
        anulada_por = ?
       WHERE id = ?`,
      [motivo, ahoraIso, usuario_id, id]
    );

    // Marcar ventas_cashea como ANULADA si existe registro para esta venta.
    // Evita que liquidaciones pendientes incluyan comisiones de ventas anuladas.
    run(
      `UPDATE ventas_cashea
          SET estado_liquidacion = 'ANULADA'
        WHERE venta_id = ?
          AND estado_liquidacion != 'ANULADA'`,
      [id]
    );
  });

  const venta = getOne(`SELECT * FROM ventas WHERE id = ?`, [id]);

  await registrarAuditoria(null, {
    usuario_id,
    accion: 'ANULAR_VENTA',
    tabla_afectada: 'ventas',
    registro_id: id,
    datos_anteriores: {
      venta: {
        id: ventaPrev.id,
        numero_venta: ventaPrev.numero_venta,
        estado: ventaPrev.estado,
        subtotal_usd: ventaPrev.subtotal_usd,
        total_usd: ventaPrev.total_usd,
        total_bs: ventaPrev.total_bs,
        cliente_id: ventaPrev.cliente_id,
        usuario_id: ventaPrev.usuario_id,
        metodo_pago: ventaPrev.metodo_pago,
        fecha_venta: ventaPrev.fecha_venta
      },
      lineas: detallesPrev.map((d) => ({
        id: d.id,
        producto_id: d.producto_id,
        cantidad: d.cantidad,
        precio_unitario_usd: d.precio_unitario_usd,
        subtotal_usd: d.subtotal_usd,
        lote_id: d.lote_id
      }))
    },
    datos_nuevos: {
      estado: venta.estado,
      motivo_anulacion: venta.motivo_anulacion,
      anulada_por: venta.anulada_por,
      fecha_anulacion: venta.fecha_anulacion
    },
    ip_address: clientIp(req)
  });

  res.json(venta);
}

/**
 * Payload guardado en ventas_suspendidas.items (JSONB):
 * { version, tasas:{bcv,usd}, lines, payments, globalDiscPct }
 */
async function listSuspendidas(req, res) {
  const usuario_id = req.user && req.user.id ? Number(req.user.id) : null;
  if (!usuario_id || usuario_id < 1) throw httpError(401, 'Usuario no autenticado');

  const rows = getAll(
    `SELECT vs.id, vs.referencia, vs.cliente_id, vs.subtotal_usd, vs.tasa_momento,
            vs.creado_en, vs.items,
            c.nombre AS cliente_nombre
     FROM ventas_suspendidas vs
     LEFT JOIN clientes c ON c.id = vs.cliente_id
     WHERE vs.usuario_id = ?
     ORDER BY vs.creado_en DESC
     LIMIT 200`,
    [usuario_id]
  );

  // items es TEXT JSON en SQLite → objeto para el frontend (PG devolvía JSONB)
  const data = rows.map((r) => {
    let items = r.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (_e) { items = null; }
    }
    return { ...r, items };
  });

  res.json({ data });
}

async function createSuspendida(req, res) {
  const usuario_id = req.user && req.user.id ? Number(req.user.id) : null;
  if (!usuario_id || usuario_id < 1) throw httpError(401, 'Usuario no autenticado');

  const body = req.body || {};
  const referencia = body.referencia != null ? String(body.referencia).trim().slice(0, 50) : null;
  const cliente_id =
    body.cliente_id != null && body.cliente_id !== '' ? Number(body.cliente_id) : null;
  const sesion_caja_id =
    body.sesion_caja_id != null && body.sesion_caja_id !== ''
      ? Number(body.sesion_caja_id)
      : null;

  // Bug-17: validate sesion_caja_id belongs to this user if provided
  if (sesion_caja_id != null) {
    const sesCheck = getOne(
      `SELECT id FROM sesiones_caja
       WHERE id = ? AND usuario_id = ? AND estado = 'abierta' AND fecha_cierre IS NULL`,
      [sesion_caja_id, usuario_id]
    );
    if (!sesCheck) {
      throw httpError(403, 'sesion_caja_id no corresponde a la sesión de caja abierta del usuario');
    }
  }

  const lines = Array.isArray(body.lines) ? body.lines : Array.isArray(body.items) ? body.items : [];
  if (lines.length === 0) throw httpError(400, 'No hay líneas para suspender');

  const payments = Array.isArray(body.payments) ? body.payments : [];
  const globalDiscPct = Number(body.globalDiscPct != null ? body.globalDiscPct : body.descuento_global || 0);

  const tasasBody = body.tasas && typeof body.tasas === 'object' ? body.tasas : {};
  const bcv = Number(tasasBody.bcv != null ? tasasBody.bcv : body.tasa_bcv);
  const tasaMercadoRaw =
    tasasBody.usd != null && tasasBody.usd !== ''
      ? tasasBody.usd
      : body.tasa_momento != null && body.tasa_momento !== ''
        ? body.tasa_momento
        : body.tasa_usd;
  const usd = Number(tasaMercadoRaw);
  if (!Number.isFinite(usd) || usd <= 0) throw httpError(400, 'tasa_momento / tasas.usd inválida');

  /* ── AUD: tasas server-authoritative al suspender ──────────────────────────────────
     En solo_bcv NO existe tasa de mercado: ignoramos la tasa "calle" enviada por el
     cliente y persistimos la tasa operativa del servidor (tasa_usd = tasa_bcv). Así, al
     reanudar la venta, los precios no se recalculan con una tasa divergente residual.
     En multimoneda se conserva la tasa de mercado del momento (comportamiento original). */
  let usdOperativo = usd;
  let bcvOperativo = Number.isFinite(bcv) && bcv > 0 ? bcv : null;
  try {
    const tasasOp = await PreciosService.resolverTasasOperativas();
    if (ModoMonedaService.esSoloBcv(tasasOp.modo_moneda_operacion)) {
      usdOperativo = tasasOp.tasa_usd; // = tasa_bcv en solo_bcv
      bcvOperativo = tasasOp.tasa_bcv;
    }
  } catch (_e) { /* sin tasas configuradas: conservar lo enviado por el cliente */ }

  let subtotal_usd = body.subtotal_usd != null ? Number(body.subtotal_usd) : null;
  if (subtotal_usd == null || Number.isNaN(subtotal_usd)) {
    subtotal_usd = round4(lines.reduce((acc, l) => acc + Number(l.subtotal_usd || 0), 0));
  }

  const payload = {
    version: 1,
    tasas: { bcv: bcvOperativo, usd: usdOperativo },
    lines,
    payments,
    globalDiscPct
  };

  const r = run(
    `INSERT INTO ventas_suspendidas (
      referencia, usuario_id, sesion_caja_id, items, cliente_id, subtotal_usd, tasa_momento
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      referencia,
      usuario_id,
      sesion_caja_id,
      JSON.stringify(payload),
      cliente_id,
      subtotal_usd,
      PreciosService.redondearTasa4(usdOperativo)
    ]
  );
  const row = getOne(`SELECT * FROM ventas_suspendidas WHERE id = ?`, [r.lastInsertRowid]);

  res.status(201).json(row);
}

async function getSuspendida(req, res) {
  const usuario_id = req.user && req.user.id ? Number(req.user.id) : null;
  if (!usuario_id || usuario_id < 1) throw httpError(401, 'Usuario no autenticado');

  const id = Number(req.params.suspId);
  if (!id || id < 1) throw httpError(400, 'ID de suspensión inválido');

  const row = getOne(
    `SELECT * FROM ventas_suspendidas WHERE id = ? AND usuario_id = ?`,
    [id, usuario_id]
  );
  if (!row) throw httpError(404, 'Venta suspendida no encontrada');

  // items TEXT JSON → objeto (PG devolvía JSONB)
  if (typeof row.items === 'string') {
    try { row.items = JSON.parse(row.items); } catch (_e) { /* conservar texto */ }
  }

  res.json(row);
}

async function deleteSuspendida(req, res) {
  const usuario_id = req.user && req.user.id ? Number(req.user.id) : null;
  if (!usuario_id || usuario_id < 1) throw httpError(401, 'Usuario no autenticado');

  const id = Number(req.params.suspId);
  if (!id || id < 1) throw httpError(400, 'ID de suspensión inválido');

  const r = run(`DELETE FROM ventas_suspendidas WHERE id = ? AND usuario_id = ?`, [
    id,
    usuario_id
  ]);
  if (r.changes === 0) throw httpError(404, 'Venta suspendida no encontrada');

  res.status(204).end();
}

module.exports = {
  list: asyncHandler(list),
  getById: asyncHandler(getById),
  create: asyncHandler(create),
  anular: asyncHandler(anular),
  listSuspendidas: asyncHandler(listSuspendidas),
  createSuspendida: asyncHandler(createSuspendida),
  getSuspendida: asyncHandler(getSuspendida),
  deleteSuspendida: asyncHandler(deleteSuspendida)
};
