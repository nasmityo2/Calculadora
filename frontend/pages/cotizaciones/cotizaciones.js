'use strict';

window.CotizacionesPage = (function () {

  /* ── Toast helper ─────────────────────────────────────── */
  function toast(msg, tipo) {
    if (window.NexusComponents && window.NexusComponents.showToast) {
      window.NexusComponents.showToast(msg, tipo || 'info');
    }
  }

  /* ── Estado de módulo ─────────────────────────────────── */
  let _host = null;
  let _cotizaciones = [];
  let _itemsNueva = [];
  let _clienteSelId = null;
  let _cotDetalleId = null;
  let _prodBusqTimer = null;
  let _clienteBusqTimer = null;

  /* ── Helpers de formato ───────────────────────────────── */
  function fmtUsd(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return '$' + x.toLocaleString('es-VE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }

  function fmtBs(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return 'Bs. ' + x.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtTasa(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return '—';
    return x.toLocaleString('es-VE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }

  function fmtFecha(d) {
    if (!d) return '—';
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
    return dt.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function escTxt(v) {
    return window.NexusDomSafe
      ? window.NexusDomSafe.escapeHtml(v)
      : String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Badges de estado ─────────────────────────────────── */
  const BADGE_CLASS = {
    borrador:  'badge--yellow',
    enviada:   'badge--info',
    aceptada:  'badge-completada',
    rechazada: 'badge-anulada',
    vencida:   'badge--yellow',
    anulada:   'badge-anulada'
  };

  function badgeEstado(estado) {
    const cls = BADGE_CLASS[estado] || 'badge--yellow';
    const span = document.createElement('span');
    span.className = `badge ${cls}`;
    span.textContent = (estado || '—').toUpperCase();
    return span;
  }

  /* ── Referencia a elementos del DOM ──────────────────── */
  function q(sel) { return _host ? _host.querySelector(sel) : document.querySelector(sel); }

  /* ── Modal helpers ─────────────────────────────────────── */
  function abrirModal(id) {
    const el = q(`#${id}`);
    if (el) el.style.display = 'flex';
  }
  function cerrarModal(id) {
    const el = q(`#${id}`);
    if (el) el.style.display = 'none';
  }

  /* ── Cargar tabla principal ──────────────────────────── */
  async function cargarTabla() {
    const tbody = q('#cot-tbody');
    const emptyDiv = q('#cot-empty');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--text-muted)">Cargando…</td></tr>';
    if (emptyDiv) emptyDiv.style.display = 'none';

    try {
      const estado = (q('#cot-filtro-estado') || {}).value || '';
      const data = await window.CotizacionesClient.listar({ estado, limit: 100 });
      _cotizaciones = data.rows || [];
      renderTabla();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--color-danger)">Error: ${escTxt(err.message)}</td></tr>`;
      toast('No se pudieron cargar las cotizaciones', 'error');
    }
  }

  function renderTabla() {
    const tbody = q('#cot-tbody');
    const emptyDiv = q('#cot-empty');
    if (!tbody) return;

    if (!_cotizaciones.length) {
      tbody.innerHTML = '';
      if (emptyDiv) emptyDiv.style.display = 'block';
      return;
    }
    if (emptyDiv) emptyDiv.style.display = 'none';

    tbody.innerHTML = '';
    _cotizaciones.forEach((c) => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';

      const tdNum = document.createElement('td');
      const numSpan = document.createElement('span');
      numSpan.className = 'doc-number';
      numSpan.textContent = c.numero || `#${c.id}`;
      tdNum.appendChild(numSpan);

      const tdCliente = document.createElement('td');
      tdCliente.textContent = c.cliente_nombre || '—';

      const tdEmision = document.createElement('td');
      tdEmision.textContent = fmtFecha(c.fecha_emision);

      const tdVence = document.createElement('td');
      tdVence.textContent = fmtFecha(c.fecha_vencimiento);

      const tdEstado = document.createElement('td');
      tdEstado.appendChild(badgeEstado(c.estado));

      const tdUsd = document.createElement('td');
      tdUsd.className = 'num';
      tdUsd.textContent = fmtUsd(c.total_usd);

      const tdBs = document.createElement('td');
      tdBs.className = 'num';
      tdBs.textContent = fmtBs(c.total_bs);

      const tdTasa = document.createElement('td');
      tdTasa.className = 'num';
      tdTasa.textContent = fmtTasa(c.tasa_bcv);

      const tdAcc = document.createElement('td');
      const btnVer = document.createElement('button');
      btnVer.className = 'btn btn-ghost';
      btnVer.style.fontSize = 'var(--text-xs)';
      btnVer.style.padding = '2px 8px';
      btnVer.textContent = 'Ver';
      btnVer.addEventListener('click', (e) => { e.stopPropagation(); abrirDetalle(c.id); });

      const btnPdf = document.createElement('button');
      btnPdf.className = 'btn btn-secondary';
      btnPdf.style.fontSize = 'var(--text-xs)';
      btnPdf.style.padding = '2px 8px';
      btnPdf.style.marginLeft = '4px';
      btnPdf.textContent = 'PDF';
      btnPdf.addEventListener('click', (e) => { e.stopPropagation(); descargarPdf(c.id, c.numero); });

      tdAcc.appendChild(btnVer);
      tdAcc.appendChild(btnPdf);

      tr.appendChild(tdNum);
      tr.appendChild(tdCliente);
      tr.appendChild(tdEmision);
      tr.appendChild(tdVence);
      tr.appendChild(tdEstado);
      tr.appendChild(tdUsd);
      tr.appendChild(tdBs);
      tr.appendChild(tdTasa);
      tr.appendChild(tdAcc);

      tr.addEventListener('click', () => abrirDetalle(c.id));
      tbody.appendChild(tr);
    });
  }

  /* ── Descargar PDF ─────────────────────────────────────── */
  async function descargarPdf(id, numero) {
    try {
      const url = window.CotizacionesClient.urlPdf(id);
      const token = window.NexusAuth && window.NexusAuth.getAccessToken ? window.NexusAuth.getAccessToken() : '';
      const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${numero || 'cotizacion-' + id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
      toast('Error al generar PDF: ' + err.message, 'error');
    }
  }

  /* ── Modal detalle / cambio de estado ─────────────────── */
  async function abrirDetalle(id) {
    _cotDetalleId = id;
    const body = q('#cot-det-body');
    const titulo = q('#cot-det-titulo');
    if (!body) return;

    abrirModal('cot-modal-detalle');
    body.innerHTML = '<p style="color:var(--text-muted);padding:16px">Cargando…</p>';

    try {
      const c = await window.CotizacionesClient.obtener(id);
      if (titulo) titulo.textContent = `COTIZACIÓN ${c.numero || '#' + id}`;

      const pdfBtn = q('#cot-det-btn-pdf');
      if (pdfBtn) pdfBtn.onclick = () => descargarPdf(c.id, c.numero);

      const selEstado = q('#cot-det-select-estado');
      if (selEstado) {
        selEstado.value = '';
        if (c.estado === 'anulada') selEstado.disabled = true;
        else selEstado.disabled = false;
      }

      // Render del detalle
      let html = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div>
            <div class="form-label">CLIENTE</div>
            <div style="font-size:var(--text-sm)">${escTxt(c.cliente_nombre || 'Sin cliente')}</div>
            ${c.cliente_doc ? `<div style="font-size:var(--text-xs);color:var(--text-muted)">${escTxt(c.cliente_doc)}</div>` : ''}
          </div>
          <div>
            <div class="form-label">ESTADO</div>
            <div>${badgeEstado(c.estado).outerHTML}</div>
          </div>
          <div>
            <div class="form-label">EMISIÓN</div>
            <div style="font-family:var(--font-mono);font-size:var(--text-sm)">${fmtFecha(c.fecha_emision)}</div>
          </div>
          <div>
            <div class="form-label">VENCE</div>
            <div style="font-family:var(--font-mono);font-size:var(--text-sm)">${fmtFecha(c.fecha_vencimiento)}</div>
          </div>
          <div>
            <div class="form-label">TASA BCV</div>
            <div style="font-family:var(--font-mono);font-size:var(--text-sm);color:var(--accent-primary)">${fmtTasa(c.tasa_bcv)} Bs/USD</div>
          </div>
          <div>
            <div class="form-label">ELABORADO POR</div>
            <div style="font-size:var(--text-sm)">${escTxt(c.usuario_nombre || '—')}</div>
          </div>
        </div>`;

      if (c.notas) {
        html += `<div style="margin-bottom:12px"><div class="form-label">NOTAS</div><div style="font-size:var(--text-sm);color:var(--text-secondary)">${escTxt(c.notas)}</div></div>`;
      }

      // Tabla de ítems
      html += `<div class="data-table-wrap" style="max-height:200px;overflow-y:auto;margin-bottom:12px">
        <table class="data-table">
          <thead><tr>
            <th>DESCRIPCIÓN</th>
            <th class="num">CANT.</th>
            <th class="num">P.U. USD</th>
            <th class="num">SUBT. USD</th>
          </tr></thead>
          <tbody>`;
      (c.detalles || []).forEach((d) => {
        html += `<tr>
          <td>${escTxt(d.descripcion)}</td>
          <td class="num">${Number(d.cantidad).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
          <td class="num">${fmtUsd(d.precio_unitario_usd)}</td>
          <td class="num">${fmtUsd(d.subtotal_usd)}</td>
        </tr>`;
      });
      html += '</tbody></table></div>';

      // Totales
      html += `<div class="cotizaciones-resumen" style="display:block">
        <div class="cotizaciones-resumen-fila"><span>Subtotal ref. USD</span><span class="cotizaciones-resumen-monto">${fmtUsd(c.subtotal_usd)}</span></div>`;
      if (Number(c.descuento_porcentaje) > 0) {
        html += `<div class="cotizaciones-resumen-fila"><span>Descuento (${Number(c.descuento_porcentaje)}%)</span><span class="cotizaciones-resumen-monto">−${fmtUsd(c.descuento_monto_usd)}</span></div>`;
      }
      if (Number(c.iva_porcentaje) > 0) {
        html += `<div class="cotizaciones-resumen-fila"><span>IVA (${Number(c.iva_porcentaje)}%)</span><span class="cotizaciones-resumen-monto">${fmtUsd(c.iva_monto_usd)}</span></div>`;
      }
      html += `<div class="cotizaciones-resumen-fila cotizaciones-resumen-total">
        <span>TOTAL ref. USD</span><span class="cotizaciones-resumen-monto">${fmtUsd(c.total_usd)}</span>
      </div>
      <div class="cotizaciones-resumen-fila" style="color:var(--accent-primary)">
        <span>TOTAL BOLÍVARES</span><span class="cotizaciones-resumen-monto">${fmtBs(c.total_bs)}</span>
      </div>
      </div>`;

      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = `<p style="color:var(--color-danger);padding:16px">Error: ${escTxt(err.message)}</p>`;
    }
  }

  /* ── Nueva cotización: búsqueda de cliente ──────────────── */
  function iniciarBusquedaCliente() {
    const inp = q('#cot-buscar-cliente');
    const sugs = q('#cot-cliente-sugerencias');
    const hiddenId = q('#cot-cliente-id');
    const tag = q('#cot-cliente-seleccionado');
    if (!inp) return;

    inp.addEventListener('input', () => {
      clearTimeout(_clienteBusqTimer);
      const v = inp.value.trim();
      if (!sugs) return;
      if (v.length < 2) { sugs.style.display = 'none'; return; }
      _clienteBusqTimer = setTimeout(async () => {
        try {
          const apiBase = String(window.NEXUS_API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
          const r = await window.NexusAuth.authFetch(`${apiBase}/api/clientes?q=${encodeURIComponent(v)}&limit=8`);
          if (!r.ok) return;
          const data = await r.json();
          const items = data.rows || data || [];
          sugs.innerHTML = '';
          if (!items.length) { sugs.style.display = 'none'; return; }
          items.forEach((cl) => {
            const li = document.createElement('div');
            li.className = 'cotizaciones-sugerencia-item';
            li.textContent = `${cl.nombre} ${cl.cedula_rif ? '· ' + cl.cedula_rif : ''}`;
            li.addEventListener('mousedown', (e) => {
              e.preventDefault();
              if (hiddenId) hiddenId.value = cl.id;
              _clienteSelId = cl.id;
              inp.value = '';
              inp.style.display = 'none';
              if (tag) {
                tag.style.display = 'flex';
                tag.innerHTML = '';
                const txt = document.createElement('span');
                txt.textContent = cl.nombre;
                const btn = document.createElement('button');
                btn.className = 'btn btn-icon';
                btn.style.cssText = 'padding:0;width:16px;height:16px;font-size:10px;line-height:1';
                btn.textContent = '✕';
                btn.addEventListener('click', () => {
                  _clienteSelId = null;
                  if (hiddenId) hiddenId.value = '';
                  tag.style.display = 'none';
                  inp.style.display = '';
                  inp.value = '';
                  inp.focus();
                });
                tag.appendChild(txt);
                tag.appendChild(btn);
              }
              sugs.style.display = 'none';
            });
            sugs.appendChild(li);
          });
          sugs.style.display = 'block';
        } catch (_e) { sugs.style.display = 'none'; }
      }, 300);
    });

    inp.addEventListener('blur', () => {
      setTimeout(() => { if (sugs) sugs.style.display = 'none'; }, 200);
    });
  }

  /* ── Nueva cotización: búsqueda de producto ─────────────── */
  function iniciarBusquedaProducto() {
    const inp = q('#cot-buscar-prod');
    const sugs = q('#cot-prod-sugerencias');
    const cantInp = q('#cot-item-cant');
    const precioInp = q('#cot-item-precio');
    if (!inp) return;

    let _prodSel = null;

    inp.addEventListener('input', () => {
      clearTimeout(_prodBusqTimer);
      const v = inp.value.trim();
      if (!sugs) return;
      if (v.length < 2) { sugs.style.display = 'none'; return; }
      _prodBusqTimer = setTimeout(async () => {
        try {
          const apiBase = String(window.NEXUS_API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
          const r = await window.NexusAuth.authFetch(`${apiBase}/api/productos?q=${encodeURIComponent(v)}&limit=8&activo=true`);
          if (!r.ok) return;
          const data = await r.json();
          const items = data.rows || data || [];
          sugs.innerHTML = '';
          if (!items.length) { sugs.style.display = 'none'; return; }
          items.forEach((p) => {
            const precio = Number(p.precio_usd || p.precio || 0);
            const li = document.createElement('div');
            li.className = 'cotizaciones-sugerencia-item';
            li.textContent = `${p.nombre} ${p.codigo_interno ? '[' + p.codigo_interno + ']' : ''} · $${precio.toFixed(4)}`;
            li.addEventListener('mousedown', (e) => {
              e.preventDefault();
              _prodSel = { id: p.id, nombre: p.nombre, precio };
              inp.value = p.nombre;
              if (precioInp && precio > 0) precioInp.value = precio.toFixed(4);
              sugs.style.display = 'none';
              if (cantInp) cantInp.focus();
            });
            sugs.appendChild(li);
          });
          sugs.style.display = 'block';
        } catch (_e) { sugs.style.display = 'none'; }
      }, 300);
    });

    inp.addEventListener('blur', () => {
      setTimeout(() => { if (sugs) sugs.style.display = 'none'; }, 200);
    });

    const btnAdd = q('#cot-btn-add-item');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => {
        const desc = inp.value.trim();
        const cant = Number((cantInp || {}).value || 1);
        const precio = Number((precioInp || {}).value || 0);

        if (!desc) { toast('Indica un producto o descripción', 'warn'); return; }
        if (cant <= 0) { toast('La cantidad debe ser mayor a cero', 'warn'); return; }
        if (precio < 0) { toast('El precio no puede ser negativo', 'warn'); return; }

        _itemsNueva.push({
          producto_id:         _prodSel ? _prodSel.id : null,
          descripcion:         desc,
          cantidad:            cant,
          precio_unitario_usd: precio,
          subtotal_usd:        Math.round(cant * precio * 10000) / 10000
        });

        inp.value = '';
        if (cantInp) cantInp.value = '1';
        if (precioInp) precioInp.value = '0';
        _prodSel = null;

        renderItemsNueva();
        actualizarResumen();
      });
    }
  }

  /* ── Render tabla de ítems en modal nueva ─────────────── */
  function renderItemsNueva() {
    const tbody = q('#cot-items-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!_itemsNueva.length) {
      const tr = document.createElement('tr');
      tr.id = 'cot-items-empty-row';
      const td = document.createElement('td');
      td.colSpan = 5;
      td.style.cssText = 'text-align:center;color:var(--text-muted);padding:20px';
      td.textContent = 'Sin ítems — agrega productos arriba.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    _itemsNueva.forEach((item, idx) => {
      const tr = document.createElement('tr');

      const tdDesc = document.createElement('td');
      tdDesc.textContent = item.descripcion;

      const tdCant = document.createElement('td');
      tdCant.className = 'num';
      tdCant.textContent = Number(item.cantidad).toLocaleString('es-VE', { minimumFractionDigits: 2 });

      const tdPu = document.createElement('td');
      tdPu.className = 'num';
      tdPu.textContent = fmtUsd(item.precio_unitario_usd);

      const tdSub = document.createElement('td');
      tdSub.className = 'num';
      tdSub.textContent = fmtUsd(item.subtotal_usd);

      const tdDel = document.createElement('td');
      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn-icon';
      btnDel.style.cssText = 'padding:2px 6px;font-size:11px';
      btnDel.textContent = '✕';
      btnDel.addEventListener('click', () => {
        _itemsNueva.splice(idx, 1);
        renderItemsNueva();
        actualizarResumen();
      });
      tdDel.appendChild(btnDel);

      tr.appendChild(tdDesc);
      tr.appendChild(tdCant);
      tr.appendChild(tdPu);
      tr.appendChild(tdSub);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
  }

  /* ── Calcular y mostrar resumen ───────────────────────── */
  function actualizarResumen() {
    const resDiv = q('#cot-resumen');
    if (!resDiv) return;

    const subtotal = _itemsNueva.reduce((s, l) => s + Number(l.subtotal_usd || 0), 0);
    const descPct = Number((q('#cot-desc-pct') || {}).value || 0);
    const ivaPct  = Number((q('#cot-iva-pct')  || {}).value || 0);
    const descMonto = subtotal * (descPct / 100);
    const baseIva   = subtotal - descMonto;
    const ivaMonto  = baseIva * (ivaPct / 100);
    const total     = baseIva + ivaMonto;

    const setTxt = (sel, txt) => { const el = q(sel); if (el) el.textContent = txt; };

    setTxt('#cot-res-subtotal', fmtUsd(subtotal));
    setTxt('#cot-res-total',    fmtUsd(total));

    const descRow = q('#cot-res-desc-row');
    if (descRow) descRow.style.display = descPct > 0 ? '' : 'none';
    setTxt('#cot-res-desc-label', `Descuento (${descPct}%)`);
    setTxt('#cot-res-desc', `−${fmtUsd(descMonto)}`);

    const ivaRow = q('#cot-res-iva-row');
    if (ivaRow) ivaRow.style.display = ivaPct > 0 ? '' : 'none';
    setTxt('#cot-res-iva-label', `IVA (${ivaPct}%)`);
    setTxt('#cot-res-iva', fmtUsd(ivaMonto));

    resDiv.style.display = _itemsNueva.length ? 'block' : 'none';
  }

  /* ── Resetear modal nueva ─────────────────────────────── */
  function resetNueva() {
    _itemsNueva = [];
    _clienteSelId = null;

    const ids = ['cot-buscar-cliente', 'cot-fecha-vencimiento', 'cot-notas', 'cot-buscar-prod'];
    ids.forEach((id) => { const el = q(`#${id}`); if (el) el.value = ''; });
    const inp = q('#cot-buscar-cliente');
    if (inp) inp.style.display = '';
    const tag = q('#cot-cliente-seleccionado');
    if (tag) { tag.style.display = 'none'; tag.innerHTML = ''; }
    const hidId = q('#cot-cliente-id');
    if (hidId) hidId.value = '';

    const ivaEl = q('#cot-iva-pct');  if (ivaEl)  ivaEl.value = '0';
    const descEl = q('#cot-desc-pct'); if (descEl) descEl.value = '0';
    const cantEl = q('#cot-item-cant'); if (cantEl) cantEl.value = '1';
    const precEl = q('#cot-item-precio'); if (precEl) precEl.value = '0';

    // Fecha default: 30 días a partir de hoy
    const fechaEl = q('#cot-fecha-vencimiento');
    if (fechaEl) {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      fechaEl.value = d.toISOString().slice(0, 10);
    }

    renderItemsNueva();
    actualizarResumen();
  }

  /* ── Guardar cotización ───────────────────────────────── */
  async function guardarCotizacion() {
    if (!_itemsNueva.length) {
      toast('Agrega al menos un ítem a la cotización', 'warn');
      return;
    }
    const fechaVenc = (q('#cot-fecha-vencimiento') || {}).value;
    if (!fechaVenc) {
      toast('La fecha de vencimiento es obligatoria', 'warn');
      return;
    }

    const btn = q('#cot-btn-guardar');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
      await window.CotizacionesClient.crear({
        cliente_id:           _clienteSelId || null,
        fecha_vencimiento:    fechaVenc,
        iva_porcentaje:       Number((q('#cot-iva-pct') || {}).value || 0),
        descuento_porcentaje: Number((q('#cot-desc-pct') || {}).value || 0),
        notas:                (q('#cot-notas') || {}).value || null,
        lineas:               _itemsNueva
      });

      toast('Cotización creada correctamente', 'success');
      cerrarModal('cot-modal-nueva');
      resetNueva();
      await cargarTabla();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar cotización'; }
    }
  }

  /* ── Cambiar estado desde modal detalle ─────────────────── */
  async function cambiarEstado() {
    if (!_cotDetalleId) return;
    const sel = q('#cot-det-select-estado');
    const nuevoEstado = sel && sel.value;
    if (!nuevoEstado) {
      toast('Selecciona un estado', 'warn');
      return;
    }

    const btn = q('#cot-det-btn-cambiar-estado');
    if (btn) { btn.disabled = true; btn.textContent = 'Aplicando…'; }

    try {
      await window.CotizacionesClient.actualizarEstado(_cotDetalleId, nuevoEstado);
      toast(`Estado cambiado a: ${nuevoEstado}`, 'success');
      cerrarModal('cot-modal-detalle');
      await cargarTabla();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Aplicar'; }
    }
  }

  /* ── Wiring de eventos globales del módulo ─────────────── */
  function bindEventos() {
    // Botón nueva cotización
    const btnNueva = q('#cot-btn-nueva');
    if (btnNueva) btnNueva.addEventListener('click', () => { resetNueva(); abrirModal('cot-modal-nueva'); });

    const btnNuevaEmpty = q('#cot-btn-nueva-empty');
    if (btnNuevaEmpty) btnNuevaEmpty.addEventListener('click', () => { resetNueva(); abrirModal('cot-modal-nueva'); });

    // Recargar
    const btnRecargar = q('#cot-btn-recargar');
    if (btnRecargar) btnRecargar.addEventListener('click', cargarTabla);

    // Filtro estado
    const filtroEstado = q('#cot-filtro-estado');
    if (filtroEstado) filtroEstado.addEventListener('change', cargarTabla);

    // Guardar
    const btnGuardar = q('#cot-btn-guardar');
    if (btnGuardar) btnGuardar.addEventListener('click', guardarCotizacion);

    // Cambiar estado
    const btnCambiar = q('#cot-det-btn-cambiar-estado');
    if (btnCambiar) btnCambiar.addEventListener('click', cambiarEstado);

    // Cerrar modales con overlay click
    ['cot-modal-nueva', 'cot-modal-detalle'].forEach((modalId) => {
      const overlay = q(`#${modalId}`);
      if (!overlay) return;
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cerrarModal(modalId);
      });
    });

    // Botones .modal-close / data-modal / data-modal-close
    _host.querySelectorAll('[data-modal]').forEach((btn) => {
      btn.addEventListener('click', () => cerrarModal(btn.dataset.modal));
    });
    _host.querySelectorAll('[data-modal-close]').forEach((btn) => {
      btn.addEventListener('click', () => cerrarModal(btn.dataset.modalClose));
    });

    // Recalcular resumen al cambiar IVA/descuento
    ['#cot-iva-pct', '#cot-desc-pct'].forEach((sel) => {
      const el = q(sel);
      if (el) el.addEventListener('input', actualizarResumen);
    });

    // Búsquedas
    iniciarBusquedaCliente();
    iniciarBusquedaProducto();
  }

  /* ── Punto de entrada ─────────────────────────────────── */
  function mount(host) {
    _host = host;
    bindEventos();
    resetNueva();
    cargarTabla();
  }

  return { mount };
})();
