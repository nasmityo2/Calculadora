'use strict';

const { getOne } = require('../config/db');

/** Clave única de modo operativo (reemplaza pos_moneda_principal, pos_mostrar_bcv, moneda_principal). */
const CLAVE_MODO = 'modo_moneda_operacion';

const MODOS_VALIDOS = new Set(['multimoneda', 'solo_bcv']);

/**
 * Lee el modo de moneda operativo desde configuracion (SQLite, síncrono).
 * @param {*} [_db] Parámetro legacy ignorado: los call sites antiguos pasaban el db de
 *                  pg-promise; el wrapper SQLite es singleton y no lo necesita.
 * @returns {Promise<'multimoneda'|'solo_bcv'>} async por compatibilidad con los llamadores.
 */
async function leerModo(_db) {
  const row = getOne(
    `SELECT valor FROM configuracion WHERE clave = ? LIMIT 1`,
    [CLAVE_MODO]
  );
  const raw = String(row && row.valor != null ? row.valor : 'multimoneda')
    .trim()
    .toLowerCase();
  return MODOS_VALIDOS.has(raw) ? raw : 'multimoneda';
}

function esSoloBcv(modo) {
  return modo === 'solo_bcv';
}

module.exports = {
  CLAVE_MODO,
  MODOS_VALIDOS,
  leerModo,
  esSoloBcv
};
