(function initImportQuoteView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DayzoImportQuoteView = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createImportQuoteView() {
  'use strict';

  /**
   * Traduce un fallo al cargar cotizaciones en un mensaje accionable.
   * Es lo único que aporta este módulo: el detalle de cada cotización se arma en
   * app.js con las tasas en vivo (USDT · BCV · yuan).
   */
  function classifyQuotesLoadError(response, data, { isFileProtocol = false } = {}) {
    if (isFileProtocol || (typeof location !== 'undefined' && location.protocol === 'file:')) {
      return {
        code: 'FILE_PROTOCOL',
        title: 'DAYZO necesita el servidor local',
        message: 'No abras este archivo con file://. Usa npm run dev y abre http://127.0.0.1:3001/calculadoraa',
      };
    }
    if (!response) {
      return {
        code: 'BACKEND_UNREACHABLE',
        title: 'Sin conexión al backend',
        message: 'No se pudo contactar al servidor. Verifica que npm run dev esté en ejecución.',
      };
    }
    const code = data?.error?.code || '';
    const status = response.status;
    if (status === 401 || code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED') {
      return {
        code: 'SESSION_EXPIRED',
        title: 'Sesión expirada',
        message: 'Vuelve a iniciar sesión. Tu borrador de cotización se conservará en este dispositivo.',
      };
    }
    if (status === 403 || code === 'CSRF_INVALID' || code === 'FORBIDDEN') {
      return {
        code: 'CSRF_INVALID',
        title: 'Token de seguridad inválido',
        message: 'Recarga la página e inténtalo de nuevo.',
      };
    }
    if (status === 400 || code.startsWith('INVALID') || code.includes('PURCHASE')) {
      return {
        code: code || 'VALIDATION_ERROR',
        title: 'Datos inválidos',
        message: data?.error?.message || data?.message || 'Revisa los valores de la cotización.',
      };
    }
    if (status >= 500) {
      return {
        code: 'SERVER_ERROR',
        title: 'Error interno',
        message: 'El servidor no pudo completar la operación. Reintenta en unos segundos.',
      };
    }
    return {
      code: code || 'QUOTES_LOAD_FAILED',
      title: 'No se pudieron cargar las cotizaciones',
      message: data?.error?.message || data?.message || 'Error desconocido.',
    };
  }

  return { classifyQuotesLoadError };
}));
