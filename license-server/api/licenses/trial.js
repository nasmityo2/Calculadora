'use strict';

/**
 * POST /api/licenses/trial
 * Prueba gratuita de 7 días vinculada al HWID, con marca anti-reuso en Redis.
 *
 * FLUJO:
 *   1. POST + rate limiting por IP (sin code/código).
 *   2. Validación de HWID.
 *   3. Marca anti-reuso trial:<hashHWID> en Redis. Si existe y la licencia
 *      asociada sigue activa → reanuda (devuelve el mismo token). Si expiró
 *      → rechaza con reason: 'trial_expired'.
 *   4. Si no existe → crea license de tipo trial, firma token, persiste todo.
 *
 * Respuesta: { ok, valid, type, status, expiresAt, token, ... }
 */

const { kv } = require('../../lib/kv');
const L = require('../../lib/licenses');
const { hashHwid } = require('../../lib/crypto');
const { checkAndIncrement, getIp } = require('../../lib/ratelimit');
const { validateTrialInput, sendError, sendOk } = require('../../lib/validate');
const { createLogger, maskCode } = require('../../lib/logger');

const TRIAL_MARKER_PREFIX = 'trial:';
const AUDIT_TRIALS = 'audit:lic:trials';

function trialDays() {
  const n = parseInt(process.env.NEXUS_TRIAL_DAYS, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 7;
}

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  const log = createLogger(req, 'licenses.trial');
  log.step('incoming');

  if (req.method !== 'POST') return sendError(res, 405, 'Método no permitido.');

  try {
    await checkAndIncrement(kv, req, null);
  } catch (rlErr) {
    log.warn('ratelimit_block', { status: rlErr.status || 429 });
    return sendError(res, rlErr.status || 429, rlErr.message);
  }

  let input;
  try {
    input = validateTrialInput(req.body);
  } catch (e) {
    return sendError(res, e.status || 400, e.message);
  }

  const nowMs = Date.now();
  const hh = hashHwid(input.hwid);
  const markerKey = TRIAL_MARKER_PREFIX + hh;
  const actor = { hwid: input.hwid, machineName: input.machineName, appVersion: input.appVersion, ip: getIp(req) };

  let prev = null;
  try { prev = await kv.get(markerKey); } catch (_e) { prev = null; }

  if (prev && prev.licenseKey) {
    let rec = null;
    try { rec = await L.getLicense(prev.licenseKey); } catch (_e) { rec = null; }
    if (rec && rec.status === 'active' && !L.isExpired(rec, nowMs)) {
      try { L.recordActivation(rec, actor, nowMs); } catch (_e) {}
      let token;
      try { token = L.signClientToken(rec, input.hwid); }
      catch (e) { log.error('sign_failed', { err: e && e.message }); return sendError(res, 500, 'Error interno del servidor.'); }
      try { await L.saveLicense(rec); } catch (_e) {}
      log.info('trial_resumed', { keyMasked: maskCode(rec.key), expiresAt: rec.expiresAt });
      return sendOk(res, {
        valid: true, resumed: true, type: rec.type, status: rec.status, expiresAt: rec.expiresAt,
        features: rec.features || [], customerName: rec.customerName || null,
        daysRemaining: L.daysUntilExpiry(rec, nowMs), gracePeriodDays: L.gracePeriodDays(),
        token, licenseKey: rec.key
      });
    }
    log.info('trial_used', { expiredAt: (prev && prev.expiresAt) || (rec && rec.expiresAt) || null });
    return sendOk(res, { valid: false, reason: 'trial_expired', expiredAt: (prev && prev.expiresAt) || (rec && rec.expiresAt) || null });
  }

  let rec;
  try {
    rec = await L.createLicense({ type: 'trial', trialDays: trialDays(), maxActivations: 1, customerName: 'Prueba gratuita', notes: 'Auto-trial ' + hh.slice(0, 12) });
  } catch (e) {
    log.error('create_failed', { err: e && e.message });
    return sendError(res, e.status || 503, 'No se pudo iniciar la prueba. Intenta de nuevo.');
  }

  rec.activatedAt = new Date(nowMs).toISOString();
  rec.expiresAt = L.computeExpiresAt(rec.durationDays, nowMs);
  try { L.recordActivation(rec, actor, nowMs); } catch (_e) {}

  let token;
  try { token = L.signClientToken(rec, input.hwid); }
  catch (e) { log.error('sign_failed', { err: e && e.message }); return sendError(res, 500, 'Error interno del servidor.'); }

  try {
    await L.saveLicense(rec);
    await kv.set(markerKey, { licenseKey: rec.key, issuedAt: rec.activatedAt, expiresAt: rec.expiresAt });
    await L.pushAudit(AUDIT_TRIALS, { at: rec.activatedAt, event: 'trial_issued', keyMasked: maskCode(rec.key), hh: hh.slice(0, 16), ip: getIp(req), machineName: input.machineName || null });
  } catch (e) {
    log.error('commit_failed', { err: e && e.message });
    return sendError(res, 503, 'No se pudo iniciar la prueba. Intenta de nuevo.');
  }

  log.info('trial_issued', { keyMasked: maskCode(rec.key), expiresAt: rec.expiresAt });
  log.timing('request_total', t0, { outcome: '200' });
  return sendOk(res, {
    valid: true, type: rec.type, status: rec.status, expiresAt: rec.expiresAt,
    features: rec.features || [], customerName: rec.customerName || null,
    daysRemaining: L.daysUntilExpiry(rec, nowMs), gracePeriodDays: L.gracePeriodDays(),
    token, licenseKey: rec.key
  });
};
