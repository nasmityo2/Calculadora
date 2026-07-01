'use strict';

const crypto = require('crypto');
const { getOne, getAll, run, transaction } = require('../config/db');
const PreciosService = require('../services/preciosService');
const { asyncHandler, httpError } = require('../utils/asyncHandler');
const { rejectSpreadsheetFormulaPrefix } = require('../utils/validators');
const {
  CAMPOS_PRECIO_PRODUCTO,
  registrarAuditoria,
  clientIp
} = require('../middleware/audit.middleware');

const INSERTABLE = [
  'codigo_barras',
  'codigo_interno',
  'nombre',
  'descripcion',
  'categoria_id',
  'proveedor_id',
  'stock_actual',
  'stock_minimo',
  'stock_maximo',
  'unidad_medida',
  'costo_usd',
  'costo_promedio_ponderado_usd',
  'margen_ganancia_pct',
  'precio_manual_usd',
  'precio_mayorista_usd',
  'precio_especial_usd',
  'aplica_iva',
  'maneja_lotes',
  'fecha_vencimiento',
  'imagen_path',
  'ubicacion_almacen',
  'notas',
  'activo',
  'creado_por',
  'moneda_costo'
];

function normalizeNullable(v) {
  if (v === undefined) return undefined;
  if (v === '' || v === null) return null;
  return v;
}

function generarCodigoInternoUnico() {
  for (let i = 0; i < 15; i += 1) {
    const part = crypto.randomBytes(4).toString('hex').toUpperCase();
    const sku = `NC-${part}`;
    const exists = getOne(
      `SELECT 1 AS ok FROM productos WHERE codigo_interno = ? LIMIT 1`,
      [sku]
    );
    if (!exists) return sku;
  }
  throw httpError(500, 'No se pudo generar un código interno único');
}

/** Detecta violación de restricción UNIQUE de better-sqlite3 (antes era PG 23505). */
function esErrorUnique(e) {
  return e && (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY');
}

async function list(req, res) {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const q = req.query.q ? String(req.query.q).trim() : '';

  let activoClause = ' AND p.activo = 1';
  if (req.query.activo === 'false') {
    activoClause = ' AND p.activo = 0';
  } else if (req.query.activo === 'all') {
    activoClause = '';
  }

  let stockAlertaClause = '';
  const stockAlerta = req.query.stock_alerta ? String(req.query.stock_alerta).toLowerCase() : '';
  if (stockAlerta === 'agotados') {
    stockAlertaClause = ' AND p.stock_actual <= 0';
  } else if (stockAlerta === 'bajo') {
    stockAlertaClause = ' AND p.stock_actual <= COALESCE(p.stock_minimo, 1)';
  }

  let searchClause = '';
  const searchParams = [];
  if (q.length > 0) {
    searchClause = ` AND (
      p.nombre LIKE ? COLLATE NOCASE OR p.codigo_barras LIKE ? COLLATE NOCASE
      OR p.codigo_interno LIKE ? COLLATE NOCASE
    )`;
    searchParams.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const rows = getAll(
    `SELECT p.*, c.nombre AS categoria_nombre, pr.nombre AS proveedor_nombre
     FROM productos p
     LEFT JOIN categorias c ON c.id = p.categoria_id
     LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
     WHERE 1=1 ${activoClause} ${searchClause} ${stockAlertaClause}
     ORDER BY p.stock_actual DESC NULLS LAST, p.nombre ASC
     LIMIT ? OFFSET ?`,
    [...searchParams, limit, offset]
  );

  const totalRow = getOne(
    `SELECT COUNT(*) AS total FROM productos p
     WHERE 1=1 ${activoClause} ${searchClause} ${stockAlertaClause}`,
    searchParams
  );

  res.json({ data: rows, total: totalRow.total, limit, offset });
}

async function getById(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de producto inválido');

  const row = getOne(
    `SELECT p.*, c.nombre AS categoria_nombre, pr.nombre AS proveedor_nombre
     FROM productos p
     LEFT JOIN categorias c ON c.id = p.categoria_id
     LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
     WHERE p.id = ?`,
    [id]
  );

  if (!row) throw httpError(404, 'Producto no encontrado');

  let precios = null;
  try {
    const costoBase = parseFloat(row.costo_usd);
    const margen = parseFloat(row.margen_ganancia_pct);
    const hasManual = PreciosService.tienePrecioManualActivo(row.precio_manual_usd);
    const manualVal = hasManual ? parseFloat(row.precio_manual_usd) : null;

    // Calcular precios por margen si hay costo (puede ser sobreescrito por manual)
    if (costoBase > 0 && !Number.isNaN(costoBase)) {
      precios = await PreciosService.calcularPreciosConTasasActuales(
        null,
        costoBase,
        Number.isNaN(margen) ? 0 : margen
      );
    }

    // M4: calcular vía manual incluso si no hay costo; L1: corregir metadata de margen
    if (hasManual) {
      try {
        // resolverTasasOperativas: defensa en lectura (unifica tasa_usd = tasa_bcv en solo_bcv).
        const tasas = await PreciosService.resolverTasasOperativas();
        const cadena = PreciosService.aplicarCadenaPorPrecioEfectivo(
          manualVal,
          tasas.tasa_bcv,
          tasas.tasa_usd,
          { precisionPe: 4 }
        );
        // L1: margen real desde precio manual (no el del camino por margen lineal)
        const margenUsdReal = costoBase > 0
          ? Math.round((cadena.precio_usd_efectivo - costoBase) * 10000) / 10000
          : null;
        const margenPctReal = costoBase > 0 && margenUsdReal !== null
          ? Math.round((margenUsdReal / costoBase) * 10000) / 100
          : null;
        precios = {
          ...(precios || {}),
          precio_usd_efectivo: cadena.precio_usd_efectivo,
          precio_usd_bcv: cadena.precio_usd_bcv,
          precio_bs: cadena.precio_bs,
          bs_usd_equiv: cadena.bs_usd_equiv,
          precio_usd_efectivo_manual: manualVal,
          precio_via_manual: true,
          nota: 'precio_manual_usd activo; valores según cadena BCV exacta (4 dec USD)'
        };
        if (margenUsdReal !== null) precios.margen_usd = margenUsdReal;
        if (margenPctReal !== null) precios.margen_pct_real = margenPctReal;
      } catch (manualErr) {
        precios = {
          ...(precios || {}),
          precio_usd_efectivo_manual: manualVal,
          nota: 'precio_manual_usd definido; error al calcular cadena: ' + manualErr.message
        };
      }
    }
  } catch (e) {
    precios = { error: e.message };
  }

  res.json({ ...row, precios_calculados: precios });
}

async function create(req, res) {
  const body = req.body || {};
  if (!body.nombre || String(body.nombre).trim().length === 0) {
    throw httpError(400, 'El nombre es obligatorio');
  }
  // Anti CSV/Excel injection en altas manuales (los productos terminan en
  // exportaciones a Excel que se entregan al SENIAT/contabilidad).
  const camposTexto = ['nombre', 'codigo_barras', 'codigo_interno', 'descripcion', 'notas', 'ubicacion_almacen', 'unidad_medida'];
  for (const k of camposTexto) {
    if (body[k] != null) {
      const r = rejectSpreadsheetFormulaPrefix(body[k], k);
      if (!r.ok) throw httpError(400, r.error);
    }
  }

  // Si moneda_costo es 'bcv', el frontend ya convirtió costo_usd; validar que llegó > 0
  if (body.moneda_costo === 'bcv') {
    const costoUsdVal = Number(body.costo_usd);
    if (isNaN(costoUsdVal) || costoUsdVal <= 0) {
      throw httpError(400, 'Si el costo es en $BCV, el valor convertido a USD no puede ser cero. Verifica que las tasas BCV y USD estén configuradas.');
    }
  }

  // M3: validar precio_manual_usd cuando se envía (0 = desactivar precio fijo; negativo = inválido)
  if (Object.prototype.hasOwnProperty.call(body, 'precio_manual_usd') &&
      body.precio_manual_usd != null && body.precio_manual_usd !== '') {
    const manualVal = Number(body.precio_manual_usd);
    if (!Number.isFinite(manualVal) || manualVal < 0) {
      throw httpError(400, 'precio_manual_usd debe ser un número ≥ 0 (0 desactiva el precio fijo BCV)');
    }
  }

  const ciRaw = body.codigo_interno;
  let ciNorm = normalizeNullable(ciRaw);
  if (typeof ciNorm === 'string') ciNorm = ciNorm.trim() || null;
  if (ciNorm == null) {
    body.codigo_interno = generarCodigoInternoUnico();
  } else {
    body.codigo_interno = ciNorm;
  }

  const usaDesgloseBulto =
    Object.prototype.hasOwnProperty.call(body, 'stock_bultos') ||
    Object.prototype.hasOwnProperty.call(body, 'unidades_por_bulto') ||
    Object.prototype.hasOwnProperty.call(body, 'stock_cantidad');
  if (usaDesgloseBulto) {
    const bultos = Math.max(0, Number(body.stock_bultos) || 0);
    const upb = Math.max(0, Number(body.unidades_por_bulto) || 0);
    const sueltas = Math.max(0, Number(body.stock_cantidad) || 0);
    if (bultos > 0 && upb <= 0) {
      throw httpError(
        400,
        'Si indica bultos, debe especificar cuántas unidades trae cada bulto (mayor a 0)'
      );
    }
    body.stock_actual = Math.round(bultos * upb + sueltas);
  }

  // INV-09: always set creado_por from the authenticated user; ignore any client-sent value
  body.creado_por = req.user && req.user.id ? Number(req.user.id) : null;

  const cols = [];
  const vals = [];
  const placeholders = [];

  for (let i = 0; i < INSERTABLE.length; i += 1) {
    const key = INSERTABLE[i];
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let v = body[key];
    if (key === 'nombre' && typeof v === 'string') v = v.trim();
    if (['codigo_barras', 'codigo_interno', 'descripcion', 'notas', 'imagen_path', 'ubicacion_almacen'].includes(key)) {
      v = normalizeNullable(v);
    }
    // SQLite no acepta booleans como bind value: normalizar a 0/1
    if (typeof v === 'boolean') v = v ? 1 : 0;
    cols.push(key);
    vals.push(v);
    placeholders.push('?');
  }

  if (!cols.includes('nombre')) {
    cols.push('nombre');
    vals.push(String(body.nombre).trim());
    placeholders.push('?');
  }

  if (!cols.includes('costo_promedio_ponderado_usd')) {
    const cu = Number(body.costo_usd) || 0;
    const cpp =
      body.costo_promedio_ponderado_usd != null ? Number(body.costo_promedio_ponderado_usd) : cu;
    cols.push('costo_promedio_ponderado_usd');
    vals.push(cpp);
    placeholders.push('?');
  }

  const sql = `INSERT INTO productos (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
  let inserted;
  try {
    // INV-03: wrap in transaction so the initial stock movement is atomic with the product INSERT
    inserted = transaction(() => {
      const r = run(sql, vals);
      const row = getOne(`SELECT * FROM productos WHERE id = ?`, [r.lastInsertRowid]);
      const stockInicial = Math.round(parseFloat(row.stock_actual) || 0);
      if (stockInicial > 0) {
        const costoUsd = row.costo_usd != null ? parseFloat(row.costo_usd) : null;
        const usuarioId = req.user && req.user.id ? Number(req.user.id) : null;
        run(
          `INSERT INTO ajustes_inventario (
             producto_id, lote_id, tipo, cantidad,
             cantidad_anterior, cantidad_nueva, costo_unitario_usd,
             referencia_id, referencia_tipo, usuario_id, motivo
           ) VALUES (?, NULL, 'entrada_inicial', ?, 0, ?, ?, ?, 'producto', ?, ?)`,
          [
            row.id,
            stockInicial,
            stockInicial,
            Number.isNaN(costoUsd) ? null : costoUsd,
            row.id,
            usuarioId,
            'Stock inicial al crear producto'
          ]
        );
      }
      return row;
    });
  } catch (e) {
    if (esErrorUnique(e)) throw httpError(409, 'Código de barras o interno duplicado');
    throw e;
  }
  res.status(201).json(inserted);
}

function diffPrecioProducto(beforeRow, afterRow) {
  const antes = {};
  const despues = {};
  let changed = false;
  for (let i = 0; i < CAMPOS_PRECIO_PRODUCTO.length; i += 1) {
    const k = CAMPOS_PRECIO_PRODUCTO[i];
    const a = beforeRow[k];
    const b = afterRow[k];
    const sa = a != null && a !== '' ? String(a) : null;
    const sb = b != null && b !== '' ? String(b) : null;
    if (sa !== sb) {
      changed = true;
      antes[k] = a;
      despues[k] = b;
    }
  }
  return changed ? { antes, despues } : null;
}

async function update(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de producto inválido');

  const prev = getOne(`SELECT * FROM productos WHERE id = ?`, [id]);
  if (!prev) throw httpError(404, 'Producto no encontrado');

  const body = req.body || {};

  // Anti CSV/Excel injection en updates manuales (defensa en profundidad).
  const camposTextoUpd = ['nombre', 'codigo_barras', 'codigo_interno', 'descripcion', 'notas', 'ubicacion_almacen', 'unidad_medida'];
  for (const k of camposTextoUpd) {
    if (Object.prototype.hasOwnProperty.call(body, k) && body[k] != null) {
      const r = rejectSpreadsheetFormulaPrefix(body[k], k);
      if (!r.ok) throw httpError(400, r.error);
    }
  }

  if (body.moneda_costo === 'bcv' && Object.prototype.hasOwnProperty.call(body, 'costo_usd')) {
    const costoUsdVal = Number(body.costo_usd);
    if (isNaN(costoUsdVal) || costoUsdVal <= 0) {
      throw httpError(400, 'Si el costo es en $BCV, el valor convertido a USD no puede ser cero. Verifica que las tasas BCV y USD estén configuradas.');
    }
  }

  // M3: validar precio_manual_usd cuando se envía (0 = desactivar precio fijo; negativo = inválido)
  if (Object.prototype.hasOwnProperty.call(body, 'precio_manual_usd') &&
      body.precio_manual_usd != null && body.precio_manual_usd !== '') {
    const manualVal = Number(body.precio_manual_usd);
    if (!Number.isFinite(manualVal) || manualVal < 0) {
      throw httpError(400, 'precio_manual_usd debe ser un número ≥ 0 (0 desactiva el precio fijo BCV)');
    }
  }

  const stockManualRequested = Object.prototype.hasOwnProperty.call(body, 'stock_actual');
  const pairs = [];
  const vals = [];

  const skip = new Set(['id', 'creado_en']);

  Object.keys(body).forEach((key) => {
    if (skip.has(key)) return;
    if (!INSERTABLE.includes(key) && key !== 'actualizado_en') return;
    pairs.push(`${key} = ?`);
    let v = body[key];
    if (key === 'nombre' && typeof v === 'string') v = v.trim();
    if (['codigo_barras', 'codigo_interno', 'descripcion', 'notas', 'imagen_path', 'ubicacion_almacen'].includes(key)) {
      v = normalizeNullable(v);
    }
    if (typeof v === 'boolean') v = v ? 1 : 0;
    vals.push(v);
  });

  if (pairs.length === 0) throw httpError(400, 'No hay campos para actualizar');

  pairs.push('actualizado_en = ?');
  vals.push(new Date().toISOString());
  vals.push(id);

  let updated;
  try {
    const r = run(`UPDATE productos SET ${pairs.join(', ')} WHERE id = ?`, vals);
    if (r.changes === 0) throw httpError(404, 'Producto no encontrado');
    updated = getOne(`SELECT * FROM productos WHERE id = ?`, [id]);
  } catch (e) {
    if (esErrorUnique(e)) throw httpError(409, 'Código duplicado (barras o interno)');
    throw e;
  }

  const delta = diffPrecioProducto(prev, updated);
  if (delta && req.user && req.user.id) {
    await registrarAuditoria(null, {
      usuario_id: req.user.id,
      accion: 'CAMBIO_PRECIO_PRODUCTO',
      tabla_afectada: 'productos',
      registro_id: id,
      datos_anteriores: delta.antes,
      datos_nuevos: delta.despues,
      ip_address: clientIp(req)
    });
  }

  if (stockManualRequested) {
    const antes = parseFloat(prev.stock_actual);
    const despues = parseFloat(updated.stock_actual);
    if (!Number.isNaN(antes) && !Number.isNaN(despues)) {
      const diffQty = despues - antes;
      if (Math.abs(diffQty) > 1e-12) {
        const costoUsd =
          updated.costo_usd != null ? parseFloat(updated.costo_usd) : parseFloat(prev.costo_usd);
        const usuario_id =
          req.user && req.user.id ? Number(req.user.id) : null;
        run(
          `INSERT INTO ajustes_inventario (
            producto_id, lote_id, tipo, cantidad,
            cantidad_anterior, cantidad_nueva, costo_unitario_usd,
            referencia_id, referencia_tipo, usuario_id, motivo
          ) VALUES (?, NULL, 'ajuste_manual', ?, ?, ?, ?, ?, 'producto', ?, ?)`,
          [
            id,
            diffQty,
            antes,
            despues,
            Number.isNaN(costoUsd) ? null : costoUsd,
            id,
            usuario_id,
            'Cambio manual de stock (PATCH productos)'
          ]
        );
      }
    }
  }

  res.json(updated);
}

async function softDelete(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID de producto inválido');

  const r = run(
    `UPDATE productos SET activo = 0, actualizado_en = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  );
  if (r.changes === 0) throw httpError(404, 'Producto no encontrado');
  const updated = getOne(`SELECT * FROM productos WHERE id = ?`, [id]);
  res.json(updated);
}

module.exports = {
  list: asyncHandler(list),
  getById: asyncHandler(getById),
  create: asyncHandler(create),
  update: asyncHandler(update),
  softDelete: asyncHandler(softDelete)
};
