'use strict';

/**
 * Vigencia legal de la tasa BCV.
 *
 * Cómo funciona la tasa oficial (BCV + Art. 25 de la Ley del IVA):
 *  - Cada día hábil bancario, en la tarde, el BCV publica un tipo de cambio
 *    cuya «Fecha Valor» es el SIGUIENTE día hábil bancario.
 *  - La tasa nueva entra en vigencia a la MEDIANOCHE (00:00 hora Caracas):
 *    el día de la publicación se sigue usando la tasa vigente de ese día.
 *  - En días no hábiles (fin de semana / feriado bancario) se aplica la tasa
 *    del día hábil inmediato siguiente — que es la última publicada. Ej.: la
 *    publicada el viernes (fecha valor lunes) rige sábado, domingo y todo el
 *    lunes; la publicada el lunes en la tarde rige a partir del martes 00:00.
 *
 * La fuente primaria es la tabla `bcv_publicaciones` (fecha valor real
 * extraída de bcv.org.ve). Si no hay datos ahí, se cae al método heurístico
 * anterior sobre el historial de capturas.
 */

const fs   = require('fs');
const path = require('path');

const TZ = 'America/Caracas';

function fechaCaracas(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

/** Hora (0-23) en Caracas para un Date/timestamp. */
function horaCaracas(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', hour12: false,
  }).formatToParts(date);
  return parseInt(parts.find((p) => p.type === 'hour').value, 10) % 24;
}

function parseYmd(ymd) {
  return new Date(`${ymd}T12:00:00-04:00`);
}

function addDays(ymd, n) {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fechaCaracas(d);
}

function esFinDeSemana(ymd) {
  const dow = parseYmd(ymd).getUTCDay();
  return dow === 0 || dow === 6;
}

function esFeriado(ymd, feriados) {
  return feriados.has(ymd);
}

function esDiaNoHabil(ymd, feriados) {
  return esFinDeSemana(ymd) || esFeriado(ymd, feriados);
}

/**
 * Día hábil cuya tasa rige para `ymd`: el mismo día si es hábil; si es fin de
 * semana o feriado, el siguiente día hábil (Art. 25 LIVA).
 */
function diaEfectivo(ymd, feriados) {
  let d = ymd;
  let guard = 0;
  while (esDiaNoHabil(d, feriados) && guard < 14) {
    d = addDays(d, 1);
    guard++;
  }
  return d;
}

/** Siguiente día hábil estrictamente posterior a `ymd`. */
function siguienteDiaHabil(ymd, feriados) {
  return diaEfectivo(addDays(ymd, 1), feriados);
}

/** Día hábil bancario anterior a `fechaObjetivo` (heurística legacy). */
function diaPublicacionVigente(fechaObjetivo, feriados) {
  let d = parseYmd(fechaObjetivo);
  d.setUTCDate(d.getUTCDate() - 1);
  while (esDiaNoHabil(fechaCaracas(d), feriados)) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return fechaCaracas(d);
}

function retrocederDiaHabil(ymd, feriados) {
  let d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() - 1);
  while (esDiaNoHabil(fechaCaracas(d), feriados)) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return fechaCaracas(d);
}

function formatYmdLargo(ymd) {
  const s = parseYmd(ymd).toLocaleDateString('es-VE', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function loadFeriados(dataDir) {
  const file = path.join(dataDir, 'feriados-ve.json');
  try {
    const raw  = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = raw.feriados || raw.nacionales || raw.bancarios || [];
    const extra = [...(raw.nacionales || []), ...(raw.bancarios || [])];
    const merged = Array.isArray(list) ? [...list, ...extra] : extra;
    return new Set(merged.filter(Boolean));
  } catch (_) {
    return new Set();
  }
}

const fmtBs = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/**
 * Resuelve la tasa BCV legalmente vigente para una fecha dada.
 *
 * @param {object} opts
 * @param {Set<string>} opts.feriados
 * @param {(ymd: string) => object | null} [opts.getPublicacionHasta]
 *        Publicación más reciente con fecha_valor <= ymd (tabla bcv_publicaciones).
 * @param {(ymd: string) => object | null} [opts.getPublicacionDespues]
 *        Publicación más próxima con fecha_valor > ymd (la "tasa de mañana").
 * @param {(ymd: string) => { bcv: number, timestamp?: number, fecha?: string } | null} [opts.getBcvByPublicationDay]
 *        Fallback heurístico: captura del historial en el día de publicación.
 * @param {number} [opts.bcvPublicada] Valor mostrado actualmente en bcv.org.ve.
 * @param {Date}   [opts.fecha]
 */
function resolveBcvVigente({
  feriados,
  getPublicacionHasta = null,
  getPublicacionDespues = null,
  getBcvByPublicationDay = null,
  bcvPublicada = 0,
  fecha = new Date(),
}) {
  const hoy      = fechaCaracas(fecha);
  const efectivo = diaEfectivo(hoy, feriados);

  let vigente = 0;
  let fechaValor = null;
  let publicadaEl = null;
  let pubTs = null;
  let pubFechaHora = null;
  let fuente = null;

  // 1) Fuente primaria: publicaciones con Fecha Valor real del BCV
  const pub = getPublicacionHasta ? getPublicacionHasta(efectivo) : null;
  if (pub && pub.bcv > 0) {
    vigente      = pub.bcv;
    fechaValor   = pub.fecha_valor;
    publicadaEl  = pub.publicada_el || null;
    pubTs        = pub.timestamp ?? null;
    fuente       = 'publicaciones';
  } else if (getBcvByPublicationDay) {
    // 2) Fallback: heurística sobre el historial de capturas
    let pubDay   = diaPublicacionVigente(hoy, feriados);
    let row      = null;
    let attempts = 0;
    while (attempts < 21) {
      row = getBcvByPublicationDay(pubDay);
      if (row?.bcv > 0) break;
      pubDay = retrocederDiaHabil(pubDay, feriados);
      attempts++;
    }
    if (row?.bcv > 0) {
      vigente      = row.bcv;
      publicadaEl  = pubDay;
      pubTs        = row.timestamp ?? null;
      pubFechaHora = row.fecha ?? null;
      fuente       = 'historial';
    }
  }

  if (!(vigente > 0)) {
    vigente = bcvPublicada || 0;
    fuente  = vigente > 0 ? 'publicada' : null;
  }

  // ¿Existe ya una tasa publicada que regirá próximamente?
  const next = getPublicacionDespues ? getPublicacionDespues(efectivo) : null;
  let hayNueva    = !!(next && next.bcv > 0);
  let proximaTasa = hayNueva ? next.bcv : null;
  let proximaFv   = hayNueva ? (next.fecha_valor || null) : null;

  // Compatibilidad: sin tabla de publicaciones, detectar por diferencia de valor
  if (!hayNueva && !next && bcvPublicada > 0 && vigente > 0 &&
      Math.abs(bcvPublicada - vigente) >= 0.01) {
    hayNueva    = true;
    proximaTasa = bcvPublicada;
  }

  // La tasa publicada hoy empieza a aplicarse mañana a las 00:00 (aunque su
  // fecha valor sea el lunes, en fin de semana rige por el Art. 25 LIVA).
  const proximaVigencia = hayNueva ? addDays(hoy, 1) : null;

  const nota = hayNueva
    ? `Nueva tasa ${fmtBs.format(proximaTasa)} · rige desde mañana`
    : formatYmdLargo(fechaValor || publicadaEl || hoy);

  return {
    bcv_vigente: vigente,
    bcv_meta: {
      vigente_para:         hoy,
      dia_efectivo:         efectivo,
      fecha_valor:          fechaValor,
      publicada_el:         publicadaEl,
      publicada_fecha_hora: pubFechaHora,
      publicada_timestamp:  pubTs,
      bcv_publicada:        bcvPublicada || 0,
      hay_nueva_publicada:  hayNueva,
      proxima_tasa:         proximaTasa,
      proxima_fecha_valor:  proximaFv,
      proxima_vigencia:     proximaVigencia,
      es_fin_de_semana:     esFinDeSemana(hoy),
      es_feriado:           esFeriado(hoy, feriados),
      fuente,
      nota,
    },
  };
}

module.exports = {
  TZ,
  fechaCaracas,
  horaCaracas,
  addDays,
  esFinDeSemana,
  esFeriado,
  esDiaNoHabil,
  diaEfectivo,
  siguienteDiaHabil,
  diaPublicacionVigente,
  formatYmdLargo,
  loadFeriados,
  resolveBcvVigente,
};
