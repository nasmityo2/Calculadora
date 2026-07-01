'use strict';

const { getOne, getAll, run } = require('../config/db');
const { asyncHandler, httpError } = require('../utils/asyncHandler');
const { normalizarTelefonoMovilVeOpcional } = require('../utils/telefonoVe');

const INSERTABLE = [
  'nombre',
  'rif',
  'contacto_nombre',
  'telefono',
  'email',
  'direccion',
  'pais',
  'moneda_trabajo',
  'condicion_pago',
  'notas',
  'activo'
];

function normalizeNullable(v) {
  if (v === undefined) return undefined;
  if (v === '' || v === null) return null;
  return v;
}

function proveedoresSearchClause(req) {
  const q = req.query.q ? String(req.query.q).trim() : '';
  if (!q.length) return { clause: '', params: [] };
  return {
    clause: ` AND (
      pr.nombre LIKE ? COLLATE NOCASE OR COALESCE(pr.rif, '') LIKE ? COLLATE NOCASE
      OR COALESCE(pr.contacto_nombre, '') LIKE ? COLLATE NOCASE
      OR COALESCE(pr.telefono, '') LIKE ? COLLATE NOCASE
    )`,
    params: [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
  };
}

async function list(req, res) {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const search = proveedoresSearchClause(req);

  const rows = getAll(
    `SELECT pr.* FROM proveedores pr WHERE 1=1 ${search.clause}
     ORDER BY pr.nombre ASC LIMIT ? OFFSET ?`,
    [...search.params, limit, offset]
  );

  const totalRow = getOne(
    `SELECT COUNT(*) AS total FROM proveedores pr WHERE 1=1 ${search.clause}`,
    search.params
  );

  res.json({ data: rows, total: totalRow.total, limit, offset });
}

async function getById(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID inválido');

  const row = getOne(`SELECT * FROM proveedores WHERE id = ?`, [id]);
  if (!row) throw httpError(404, 'Proveedor no encontrado');
  res.json(row);
}

async function create(req, res) {
  const body = req.body || {};
  if (!body.nombre || String(body.nombre).trim().length === 0) {
    throw httpError(400, 'El nombre es obligatorio');
  }

  const cols = [];
  const vals = [];
  const placeholders = [];

  for (let i = 0; i < INSERTABLE.length; i += 1) {
    const key = INSERTABLE[i];
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let v = body[key];
    if (key === 'nombre' && typeof v === 'string') v = v.trim();
    if (['rif', 'contacto_nombre', 'email', 'direccion', 'notas', 'condicion_pago'].includes(key)) {
      v = normalizeNullable(v);
    }
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
    cols.push(key);
    vals.push(v);
    placeholders.push('?');
  }

  if (!cols.includes('nombre')) {
    cols.push('nombre');
    vals.push(String(body.nombre).trim());
    placeholders.push('?');
  }

  const r = run(
    `INSERT INTO proveedores (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
    vals
  );
  const inserted = getOne(`SELECT * FROM proveedores WHERE id = ?`, [r.lastInsertRowid]);
  res.status(201).json(inserted);
}

async function update(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID inválido');

  const prev = getOne(`SELECT id FROM proveedores WHERE id = ?`, [id]);
  if (!prev) throw httpError(404, 'Proveedor no encontrado');

  const body = req.body || {};
  const pairs = [];
  const vals = [];
  const skip = new Set(['id', 'creado_en']);

  Object.keys(body).forEach((key) => {
    if (skip.has(key)) return;
    if (!INSERTABLE.includes(key)) return;
    pairs.push(`${key} = ?`);
    let v = body[key];
    if (key === 'nombre' && typeof v === 'string') v = v.trim();
    if (['rif', 'contacto_nombre', 'email', 'direccion', 'notas', 'condicion_pago'].includes(key)) {
      v = normalizeNullable(v);
    }
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
    vals.push(v);
  });

  if (pairs.length === 0) throw httpError(400, 'No hay campos para actualizar');
  vals.push(id);

  run(`UPDATE proveedores SET ${pairs.join(', ')} WHERE id = ?`, vals);
  const updated = getOne(`SELECT * FROM proveedores WHERE id = ?`, [id]);

  res.json(updated);
}

async function softDelete(req, res) {
  const id = Number(req.params.id);
  if (!id || id < 1) throw httpError(400, 'ID inválido');

  const r = run(`UPDATE proveedores SET activo = 0 WHERE id = ?`, [id]);
  if (r.changes === 0) throw httpError(404, 'Proveedor no encontrado');
  const updated = getOne(`SELECT * FROM proveedores WHERE id = ?`, [id]);
  res.json(updated);
}

module.exports = {
  list: asyncHandler(list),
  getById: asyncHandler(getById),
  create: asyncHandler(create),
  update: asyncHandler(update),
  softDelete: asyncHandler(softDelete)
};
