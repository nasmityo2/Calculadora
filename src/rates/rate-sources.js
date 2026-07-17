'use strict';

function parseDecimal(raw) {
  if (raw == null) return null;
  const value = Number.parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function parseBcvHtml(html) {
  if (typeof html !== 'string' || html.length < 100) {
    return { ok: false, error: { code: 'BCV_EMPTY_DOCUMENT', message: 'Documento BCV vacío o incompleto.' } };
  }
  const dollarBlock = html.match(/id=["']dolar["'][^]*?(?=id=["'](?:euro|yuan|lira|rublo)|<div class="pull-right|$)/i);
  const dollarSource = dollarBlock ? dollarBlock[0] : '';
  const dollarMatch = dollarSource.match(/<strong[^>]*>\s*([\d]+[,.][\d]+)\s*<\/strong>/i);
  const usd = parseDecimal(dollarMatch?.[1]);
  if (!(usd > 0)) {
    return { ok: false, error: { code: 'BCV_USD_NOT_FOUND', message: 'No se encontró una tasa USD BCV válida.' } };
  }

  const yuanBlock = html.match(/id=["']yuan["'][^]*?(?=id=["'](?:dolar|euro|lira|rublo)|<div class="pull-right|$)/i);
  const yuanMatch = yuanBlock?.[0]?.match(/<strong[^>]*>\s*([\d]+[,.][\d]+)\s*<\/strong>/i);
  const cny = parseDecimal(yuanMatch?.[1]);
  const valueDateMatch = html.match(/Fecha\s*Valor:?\s*<span[^>]*content=["'](\d{4}-\d{2}-\d{2})/i);

  return {
    ok: true,
    value: {
      usd,
      cny: cny > 0 ? cny : null,
      fechaValor: valueDateMatch?.[1] || null,
    },
  };
}

function validateRate(value, {
  min,
  max,
  previous = null,
  maxChangeRatio = 0.5,
} = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return { ok: false, code: 'RATE_NOT_POSITIVE' };
  }
  if (Number.isFinite(min) && number < min) return { ok: false, code: 'RATE_BELOW_MIN' };
  if (Number.isFinite(max) && number > max) return { ok: false, code: 'RATE_ABOVE_MAX' };
  if (Number(previous) > 0) {
    const ratio = Math.abs(number - Number(previous)) / Number(previous);
    if (ratio > maxChangeRatio) return { ok: false, code: 'RATE_JUMP_REJECTED', ratio };
  }
  return { ok: true, value: number };
}

function sourceStatus({ lastAttemptAt, lastSuccessAt, staleAfterMs, now = Date.now(), failures = 0 }) {
  const successTime = lastSuccessAt ? new Date(lastSuccessAt).getTime() : Number.NaN;
  const stale = !Number.isFinite(successTime) || now - successTime > staleAfterMs;
  return {
    lastAttemptAt: lastAttemptAt || null,
    lastSuccessAt: lastSuccessAt || null,
    stale,
    status: failures > 0 ? (stale ? 'unavailable' : 'degraded') : (stale ? 'stale' : 'ok'),
    consecutiveFailures: failures,
  };
}

function backoffDelay({
  baseMs,
  failureCount,
  maxMs,
  jitterRatio = 0.2,
  random = Math.random,
}) {
  const exponential = Math.min(maxMs, baseMs * (2 ** Math.max(0, failureCount)));
  const jitter = exponential * jitterRatio * Math.max(0, Math.min(1, random()));
  return Math.round(Math.min(maxMs, exponential + jitter));
}

module.exports = {
  backoffDelay,
  parseBcvHtml,
  sourceStatus,
  validateRate,
};
