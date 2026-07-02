'use strict';

(function () {
  var NS = 'http://www.w3.org/2000/svg';

  /**
   * SVG inline del logotipo de Nexus Core (16px, mismo que sidebar pero más pequeño).
   */
  function logoSvg() {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'titlebar-logo');
    s.setAttribute('viewBox', '0 0 48 48');
    s.setAttribute('fill', 'none');
    s.setAttribute('aria-hidden', 'true');

    function line(x1, y1, x2, y2, w) {
      var el = document.createElementNS(NS, 'line');
      el.setAttribute('x1', String(x1));
      el.setAttribute('y1', String(y1));
      el.setAttribute('x2', String(x2));
      el.setAttribute('y2', String(y2));
      el.setAttribute('stroke', 'currentColor');
      el.setAttribute('stroke-width', String(w));
      el.setAttribute('stroke-linecap', 'round');
      return el;
    }

    // N — tres barras verticales + trazo diagonal
    s.appendChild(line(10, 12, 10, 36, 4.5));
    s.appendChild(line(24, 12, 24, 36, 4.5));
    s.appendChild(line(38, 12, 38, 36, 4.5));
    // Diagonal N (X)
    var d = document.createElementNS(NS, 'line');
    d.setAttribute('x1', '10');
    d.setAttribute('y1', '12');
    d.setAttribute('x2', '38');
    d.setAttribute('y2', '36');
    d.setAttribute('stroke', 'currentColor');
    d.setAttribute('stroke-width', '4.5');
    d.setAttribute('stroke-linecap', 'round');
    s.appendChild(d);

    return s;
  }

  /** SVG de línea (minimizar) */
  function minSvg() {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.5');
    s.setAttribute('stroke-linecap', 'round');
    var l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', '3');
    l.setAttribute('y1', '8');
    l.setAttribute('x2', '13');
    l.setAttribute('y2', '8');
    s.appendChild(l);
    return s;
  }

  /** SVG de cuadrado (maximizar) */
  function maxSvg() {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.5');
    var r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', '2.5');
    r.setAttribute('y', '2.5');
    r.setAttribute('width', '11');
    r.setAttribute('height', '11');
    r.setAttribute('rx', '1');
    s.appendChild(r);
    return s;
  }

  /** SVG de cuadrado superpuesto pequeño (restaurar, cuando está maximizado) */
  function restoreSvg() {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.5');
    // Cuadrado trasero
    var r1 = document.createElementNS(NS, 'rect');
    r1.setAttribute('x', '3');
    r1.setAttribute('y', '5');
    r1.setAttribute('width', '8');
    r1.setAttribute('height', '8');
    r1.setAttribute('rx', '1');
    s.appendChild(r1);
    // Cuadrado delantero
    var r2 = document.createElementNS(NS, 'rect');
    r2.setAttribute('x', '5');
    r2.setAttribute('y', '3');
    r2.setAttribute('width', '8');
    r2.setAttribute('height', '8');
    r2.setAttribute('rx', '1');
    s.appendChild(r2);
    return s;
  }

  /** SVG de X (cerrar) */
  function closeSvg() {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.5');
    s.setAttribute('stroke-linecap', 'round');
    var l1 = document.createElementNS(NS, 'line');
    l1.setAttribute('x1', '3');
    l1.setAttribute('y1', '3');
    l1.setAttribute('x2', '13');
    l1.setAttribute('y2', '13');
    s.appendChild(l1);
    var l2 = document.createElementNS(NS, 'line');
    l2.setAttribute('x1', '13');
    l2.setAttribute('y1', '3');
    l2.setAttribute('x2', '3');
    l2.setAttribute('y2', '13');
    s.appendChild(l2);
    return s;
  }

  /**
   * Renderiza la titlebar personalizada dentro del contenedor.
   * @param {HTMLElement} container
   */
  function renderTitlebar(container) {
    if (!container) return;

    var bar = document.createElement('div');
    bar.className = 'app-titlebar';

    // ── Lado izquierdo: marca ──
    var brand = document.createElement('div');
    brand.className = 'titlebar-brand';
    brand.appendChild(logoSvg());
    var title = document.createElement('span');
    title.className = 'titlebar-title';
    title.textContent = 'NEXUS CORE';
    brand.appendChild(title);
    bar.appendChild(brand);

    // ── Lado derecho: botones de control de ventana ──
    var controls = document.createElement('div');
    controls.className = 'titlebar-controls';

    var ctrl = window.nexusCore && window.nexusCore.windowControls;

    function makeBtn(ariaLabel, svgEl, action) {
      var btn = document.createElement('button');
      btn.className = 'titlebar-btn';
      btn.setAttribute('aria-label', ariaLabel);
      btn.appendChild(svgEl);
      if (ctrl && action) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          action();
        });
      }
      return btn;
    }

    // Botón minimizar
    var minBtn = makeBtn('Minimizar', minSvg(), ctrl ? ctrl.minimize : null);
    controls.appendChild(minBtn);

    // Botón maximizar/restaurar (el SVG se alterna dinámicamente)
    var maxBtn = makeBtn('Maximizar', maxSvg(), ctrl ? ctrl.toggleMaximize : null);
    controls.appendChild(maxBtn);

    // Botón cerrar
    var closeBtn = makeBtn('Cerrar', closeSvg(), ctrl ? ctrl.close : null);
    closeBtn.classList.add('titlebar-btn-close');
    controls.appendChild(closeBtn);

    // Si no hay ctrl (modo navegador), ocultar controles
    if (!ctrl) {
      controls.style.display = 'none';
    } else {
      // Suscribirse a cambios de estado de ventana para alternar icono max/restore
      ctrl.onStateChange(function (state) {
        if (!state) return;
        var isMax = state.maximized === true;
        maxBtn.innerHTML = '';
        maxBtn.appendChild(isMax ? restoreSvg() : maxSvg());
        maxBtn.setAttribute('aria-label', isMax ? 'Restaurar' : 'Maximizar');
      });
    }

    bar.appendChild(controls);
    container.appendChild(bar);
  }

  window.NexusComponents = window.NexusComponents || {};
  window.NexusComponents.renderTitlebar = renderTitlebar;
})();
