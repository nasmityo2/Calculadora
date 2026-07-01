'use strict';

function currencyDisplay(usd, bs) {
  return { usd: usd, bs: bs };
}

/** Ref. $ BCV cadena — 2 decimales, locale es-VE. NEXUS-DUAL: backend/utils/formatters.js */
function formatRefUsdBcv(value) {
  var x = Number(value);
  var n = Number.isFinite(x) ? x : 0;
  return n.toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/** Modo monetario operativo ('multimoneda' | 'solo_bcv'). Default multimoneda. */
function _modoMonedaMoneda() {
  if (window.NexusComponents && typeof window.NexusComponents.getModoMoneda === 'function') {
    return window.NexusComponents.getModoMoneda();
  }
  try {
    return localStorage.getItem('nexus_modo_moneda') === 'solo_bcv' ? 'solo_bcv' : 'multimoneda';
  } catch (e) { return 'multimoneda'; }
}
/** true cuando el modo operativo es Solo BCV. */
function esSoloBcv() { return _modoMonedaMoneda() === 'solo_bcv'; }
/** Monto de referencia: "$0,00 BCV" (multimoneda) o "$0,00 USD" (solo BCV). Sin espacio tras "$". */
function formatMontoRef(value) {
  return '$' + formatRefUsdBcv(value) + (esSoloBcv() ? ' USD' : ' BCV');
}
/** Monto en USD de mercado (siempre): "$0,00 USD". Sin espacio tras "$". */
function formatMontoUsd(value) {
  return '$' + formatRefUsdBcv(value) + ' USD';
}

window.NexusComponents = window.NexusComponents || {};
window.NexusComponents.currencyDisplay = currencyDisplay;
window.NexusComponents.formatRefUsdBcv = formatRefUsdBcv;
window.NexusComponents.esSoloBcv = esSoloBcv;
window.NexusComponents.formatMontoRef = formatMontoRef;
window.NexusComponents.formatMontoUsd = formatMontoUsd;
