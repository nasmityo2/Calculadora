'use strict';

/**
 * Texto legible para “Expira” en pantalla de licencia (zona horaria del equipo).
 * El backend suele enviar ISO en UTC; aquí se muestra en calendario local.
 *
 * @param {string|null|undefined} raw ISO 8601, "Perpetua", etc.
 * @returns {string}
 */
window.formatExpiraLicenciaUi = function formatExpiraLicenciaUi(raw) {
  if (raw == null || raw === '') return 'Sin fecha límite (perpetua)';
  var s = String(raw).trim();
  if (/^perpetua$/i.test(s)) return 'Sin fecha límite (perpetua)';
  var d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  try {
    return new Intl.DateTimeFormat('es', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(d);
  } catch (_e) {
    return d.toLocaleString('es');
  }
};

/**
 * Banner de expiración / estado de licencia (Fase 4.4.6).
 *
 * Comportamiento:
 *   - Prueba (trial): banner visible siempre con «Versión de prueba · N día(s) restantes».
 *   - Suscripción: banner cuando faltan ≤ UMBRAL días (default 15).
 *   - Permanente: sin banner de vencimiento (salvo suspensión).
 *   - Estados bloqueantes (suspendida/revocada/vencida/gracia excedida): overlay que impide
 *     usar el sistema hasta reactivar.
 *
 * Se auto-monta solo en la ventana principal (detecta window.NexusComponents) y consulta el
 * estado local vía window.nexusLicense.getStatus() (IPC, sin red). Reevalúa cada hora y al
 * volver el foco a la ventana.
 */
(function () {
  var UMBRAL_DEFAULT = 15;
  var BANNER_ID = 'nexus-lic-banner';
  var OVERLAY_ID = 'nexus-lic-overlay';

  var BLOQUEANTES = {
    suspended:      'Licencia suspendida. Contacta a tu proveedor para reactivarla.',
    revoked:        'Esta licencia fue revocada. Contacta a tu proveedor.',
    expired:        'Tu licencia venció. Renueva con tu proveedor para continuar.',
    grace_exceeded: 'No se ha podido verificar la licencia. Conéctate a internet para revalidar.',
    tampered:       'El archivo de licencia no es válido. Reactiva el sistema.',
    foreign:        'La licencia pertenece a otro equipo. Reactiva en este equipo.',
    none:           'Sin licencia activa. Activa Nexus Core para continuar.'
  };

  var WARN_ICON_SVG =
    '<svg class="lic-banner-icon" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M7.5 1L1 13.5h13L7.5 1z" stroke="currentColor" stroke-width="1.1" fill="none"/>' +
      '<path d="M7.5 5.5v3.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>' +
      '<circle cx="7.5" cy="11.25" r="0.6" fill="currentColor"/>' +
    '</svg>';

  function removeEl(id) { var e = document.getElementById(id); if (e) e.remove(); }

  function stateClass(dias) {
    if (dias != null && dias <= 1) return 'is-critical';
    return 'is-trial';
  }

  function renderBanner(textHtml, cls) {
    removeEl(BANNER_ID);
    var bar = document.createElement('div');
    bar.id = BANNER_ID;
    bar.className = 'lic-banner ' + cls;
    bar.innerHTML = WARN_ICON_SVG +
      '<span class="lic-banner-text">' + textHtml + '</span>' +
      '<button class="lic-banner-cta">Activar licencia</button>';
    // TODO: conectar con acción existente de activación (ej. abrir config → sección licencia)
    var host = document.querySelector('.layout-main') || document.querySelector('main') || document.body;
    host.insertBefore(bar, host.firstChild);
  }

  function renderOverlay(reason) {
    removeEl(OVERLAY_ID);
    var ov = document.createElement('div');
    ov.id = OVERLAY_ID;
    var card = document.createElement('div');
    card.className = 'nlo-card';
    var h = document.createElement('h2');
    h.textContent = 'Licencia no activa';
    var p = document.createElement('p');
    p.textContent = reason;
    card.appendChild(h); card.appendChild(p);
    ov.appendChild(card);
    document.body.appendChild(ov);
  }

  function apply(status) {
    if (!status) return;
    removeEl(OVERLAY_ID);
    removeEl(BANNER_ID);

    if (!status.ok) {
      var msg = BLOQUEANTES[status.state] || status.reason || 'Licencia no activa.';
      renderOverlay(msg);
      return;
    }

    var info = status.info || {};
    if (info.isPermanent) return;
    var dias = info.daysRemaining;
    var umbral = UMBRAL_DEFAULT;

    if (info.isTrial) {
      // Mostrar el aviso SOLO el último día (cuando queda 1 día o menos para vencer).
      if (dias != null && dias <= 1) {
        var txt = dias >= 1
          ? 'Versión de prueba · <strong>1</strong> día restante'
          : 'Versión de prueba · <strong>vence hoy</strong>';
        renderBanner(txt, 'is-critical');
      }
      return;
    }
    if (dias != null && dias <= umbral) {
      renderBanner('Tu licencia vence en <strong>' + dias + '</strong> día(s). Renueva para evitar interrupciones.', stateClass(dias));
    }
  }

  function check() {
    if (!window.nexusLicense || typeof window.nexusLicense.getStatus !== 'function') return;
    Promise.resolve(window.nexusLicense.getStatus()).then(apply).catch(function () {});
  }

  function autoMount() {
    if (!window.NexusComponents) return;
    check();
    setInterval(check, 60 * 60 * 1000);
    window.addEventListener('focus', check);
  }

  window.mountLicenseBanner = check;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
})();
