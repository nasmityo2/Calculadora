'use strict';

/**
 * Cliente API para el módulo de Cotizaciones.
 * Todas las llamadas pasan por NexusAuth.authFetch (token incluido).
 */
window.CotizacionesClient = (function () {
  function apiBase() {
    return String(window.NEXUS_API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
  }

  function BASE() {
    return apiBase() + '/api/cotizaciones';
  }

  async function _fetch(url, opts = {}) {
    return window.NexusAuth.authFetch(url, opts);
  }

  async function listar({ estado, cliente_id, page = 1, limit = 50 } = {}) {
    const p = new URLSearchParams({ page, limit });
    if (estado)     p.set('estado', estado);
    if (cliente_id) p.set('cliente_id', cliente_id);
    const r = await _fetch(`${BASE()}?${p}`);
    if (!r.ok) throw new Error('Error al cargar cotizaciones');
    return r.json();
  }

  async function obtener(id) {
    const r = await _fetch(`${BASE()}/${id}`);
    if (!r.ok) throw new Error(`Error al cargar cotización #${id}`);
    return r.json();
  }

  async function crear(datos) {
    const r = await _fetch(BASE(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos)
    });
    if (!r.ok) {
      let msg = `Error ${r.status} al crear cotización`;
      try { const e = await r.json(); msg = e.message || msg; } catch (_e) {}
      throw new Error(msg);
    }
    return r.json();
  }

  async function actualizarEstado(id, estado) {
    const r = await _fetch(`${BASE()}/${id}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado })
    });
    if (!r.ok) {
      let msg = `Error al cambiar estado`;
      try { const e = await r.json(); msg = e.message || msg; } catch (_e) {}
      throw new Error(msg);
    }
    return r.json();
  }

  async function anular(id) {
    const r = await _fetch(`${BASE()}/${id}/anular`, { method: 'POST' });
    if (!r.ok) {
      let msg = 'Error al anular cotización';
      try { const e = await r.json(); msg = e.message || msg; } catch (_e) {}
      throw new Error(msg);
    }
    return r.json();
  }

  function urlPdf(id) {
    return `${BASE()}/${id}/pdf`;
  }

  return { listar, obtener, crear, actualizarEstado, anular, urlPdf };
})();
