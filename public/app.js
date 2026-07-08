/** FASE 4: pulso cyan en valores de tasas cuando cambian (WS / primer fetch). */
function flashRateValueElement(el) {
    if (!el) return;
    el.classList.remove('rate-updated');
    void el.offsetWidth;
    el.classList.add('rate-updated');
    setTimeout(() => el.classList.remove('rate-updated'), 600);
}

function isPlaceholderRateTxt(s) {
    const v = String(s ?? '').trim();
    return !v || v === '--';
}

/** Asigna texto a un elemento de tasa (#t-*) y dispara flash si el valor antes era real y distinto. */
function assignRateFieldWithFlash(id, text, allowFlash) {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = String(el.innerText ?? '').trim();
    const next = String(text ?? '').trim();
    el.innerText = text;
    if (!allowFlash) return;
    if (prev !== next && !isPlaceholderRateTxt(prev) && !isPlaceholderRateTxt(next))
        flashRateValueElement(el);
}

function markRateCardsReady() {
    const grid = document.querySelector('.c-rate-cards');
    if (!grid || grid.classList.contains('c-rate-cards--loaded')) return;
    grid.classList.add('c-rate-cards--loaded');
    grid.setAttribute('aria-busy', 'false');
}


// ═══════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════
let d = { bcv: 0, binance: 0, binance_compra: 0, cny: 0 };
let m = 'VES';

// Modo histórico: respuesta de /api/tasas-historicas o null (= tasas en vivo)
let histMode = null;

// Historial independiente del gráfico  ← FIX #1
let historialData = [];          // Siempre registros individuales (24h)
let historialFiltered = null;    // null = sin filtro de fecha activo
let historialVisible = 50;

// Chart state
let chartInstance = null;
let chartRange = '24h';
let chartData = [];              // Datos exclusivos para el gráfico
let chartStats = null;
let chartDateFiltered = false;   // true cuando el historial está filtrado por fecha

// Import
let importTarifaBase = 1030;
let importEmpresaNombre = 'import2ven';
let gCostoUnitario = 0;
let gCostoCaja = 0;
let gUnidadesPorCaja = 0;
let simType = 'unidad';
let simMode = 'precio';
let simSource = 'calc';
let feePlataforma = 0.03;
let feeBanco = 0.0125;
let lastImportQuote = null;
let lastSimPlan = null;
let importQuotesAll = [];
let importCurrentQuoteId = null;
let importCurrentQuoteName = null;
let importCurrentQuote = null;
let importEditBaseName = '';
let importEditedQuote = null;
let importEditedFullName = '';
let importEditedCompanyTarifaUSD = null;

/** Cotizaciones con fila expandida (varias a la vez) */
const importQuotesExpandedIds = new Set();
/** id → registro completo API `/api/import-quotes/:id` */
const importQuoteDetailCache = new Map();
/** Ancla DOM para devolver `#import-quotes-detail` a su sitio original */
let importQuoteDetailPanelAnchor = null;

const tasaSegura = 6.53;

// ═══════════════════════════════════════════════
// TOAST + CONFIRM — reemplazan alert()/confirm() nativos
// ═══════════════════════════════════════════════
const TOAST_ICONS = {
    success: 'fa-circle-check',
    error:   'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info:    'fa-circle-info',
};

function ensureToastContainer() {
    let c = document.getElementById('dz-toasts');
    if (!c) {
        c = document.createElement('div');
        c.id = 'dz-toasts';
        c.className = 'dz-toasts';
        c.setAttribute('aria-live', 'polite');
        document.body.appendChild(c);
    }
    return c;
}

/** Toast no bloqueante. type: success | error | warning | info */
function showToast(message, type = 'info', duration = 3000) {
    const c = ensureToastContainer();
    const el = document.createElement('div');
    el.className = `dz-toast dz-toast--${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<i class="fas ${TOAST_ICONS[type] || TOAST_ICONS.info}" aria-hidden="true"></i><span class="dz-toast__msg"></span>`;
    el.querySelector('.dz-toast__msg').textContent = message;
    c.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const remove = () => {
        el.classList.add('is-out');
        setTimeout(() => el.remove(), 260);
    };
    const timer = setTimeout(remove, duration);
    el.addEventListener('click', () => { clearTimeout(timer); remove(); });
    return el;
}

/** Modal de confirmación propio. Devuelve Promise<boolean>. */
function showConfirm(message, opts = {}) {
    const { title = 'Confirmar', confirmText = 'Aceptar', cancelText = 'Cancelar', danger = false } = opts;
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dz-modal-overlay';
        const okClass = danger ? 'dz-modal__btn--danger' : 'dz-modal__btn--ok';
        overlay.innerHTML = `
          <div class="dz-modal" role="dialog" aria-modal="true" aria-labelledby="dz-modal-title">
            <h3 class="dz-modal__title" id="dz-modal-title"></h3>
            <p class="dz-modal__msg"></p>
            <div class="dz-modal__actions">
              <button type="button" class="dz-modal__btn dz-modal__btn--cancel"></button>
              <button type="button" class="dz-modal__btn ${okClass}"></button>
            </div>
          </div>`;
        overlay.querySelector('.dz-modal__title').textContent = title;
        overlay.querySelector('.dz-modal__msg').textContent   = message;
        overlay.querySelector('.dz-modal__btn--cancel').textContent = cancelText;
        overlay.querySelector('.' + okClass).textContent = confirmText;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('is-in'));

        const close = (result) => {
            overlay.classList.remove('is-in');
            setTimeout(() => overlay.remove(), 200);
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') close(false);
            else if (e.key === 'Enter') close(true);
        };
        overlay.querySelector('.dz-modal__btn--cancel').addEventListener('click', () => close(false));
        overlay.querySelector('.' + okClass).addEventListener('click', () => close(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
        document.addEventListener('keydown', onKey);
        setTimeout(() => overlay.querySelector('.' + okClass)?.focus(), 50);
    });
}

// ═══════════════════════════════════════════════
// AUTH — server-side session, no bypassable overlay
// ═══════════════════════════════════════════════
let currentUser = null;
let csrfToken   = null;

/** Redirect to login, preserving current path as ?next= */
function redirectToLogin() {
    window.location.replace('/login?next=' + encodeURIComponent(window.location.pathname));
}

/**
 * Wrapper around fetch() that automatically injects the CSRF token header
 * for state-changing requests and redirects to login on 401.
 */
async function authFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
    }
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) { redirectToLogin(); return res; }
    return res;
}

async function checkAuth() {
    try {
        const r = await fetch('/api/auth/me');
        const j = await r.json();
        if (j.loggedIn) {
            currentUser = { username: j.username, fullName: j.fullName, email: j.email, role: j.role };
            csrfToken   = j.csrfToken || null;
        } else {
            currentUser = null;
            csrfToken   = null;
        }
        updateAuthUI();
    } catch {
        // Network error; show unauthenticated UI
        currentUser = null;
        updateAuthUI();
    }
}

async function doLogout() {
    try { await authFetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    window.location.replace('/login');
}

function userDisplayLabel(user) {
    if (!user) return '';
    const username = (user.username || '').toString();
    // Cuentas antiguas guardaban el correo como username
    if (user.email && username.toLowerCase() === user.email.toLowerCase() && user.fullName) {
        return user.fullName;
    }
    return username;
}

function updateAuthUI() {
    const el = document.getElementById('topbar-user');
    if (el) {
        if (currentUser) {
            el.innerHTML = `<span class="c-topbar__username">${escapeHtml(userDisplayLabel(currentUser))}</span>
      <button onclick="doLogout()" class="c-topbar__logout" aria-label="Cerrar sesión">
        <i class="fas fa-sign-out-alt"></i>
      </button>`;
            el.style.display = 'flex';
        } else {
            el.innerHTML = `<a href="/login" class="c-topbar__login-btn" aria-label="Iniciar sesión">
        <i class="fas fa-sign-in-alt"></i> Ingresar
      </a>`;
            el.style.display = 'flex';
        }
    }
    document.querySelectorAll('.c-admin-only').forEach(node => {
        node.style.display = currentUser?.role === 'admin' ? '' : 'none';
    });
    document.querySelectorAll('.c-auth-only').forEach(node => {
        node.style.display = currentUser ? '' : 'none';
    });
}

// Formatters
const moneyFmt = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdFmt   = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * Interpreta montos en formato venezolano (1.234.567,89), US (1,234,567.89)
 * o sin separadores de miles. Acepta símbolos de moneda comunes.
 */
function parseLocaleAmount(raw) {
    if (raw == null || raw === '') return 0;
    let s = String(raw).trim().replace(/\s/g, '');
    s = s.replace(/[Bs₮$¥€£]|USDT|USD/gi, '').trim();
    if (!s) return 0;

    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');

    if (lastComma >= 0 && lastDot >= 0) {
        if (lastComma > lastDot) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (lastComma >= 0) {
        const parts = s.split(',');
        s = parts.length > 2 ? parts.join('') : s.replace(',', '.');
    } else if (lastDot >= 0) {
        const parts = s.split('.');
        if (parts.length > 2) {
            s = parts.join('');
        } else {
            const frac = parts[1] || '';
            if (frac.length === 3 && parts[0].length <= 3) s = parts.join('');
        }
    }

    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
}

// ═══════════════════════════════════════════════
// DATE PARSING — FIX #4
// Handles multiple formats from the backend:
//   "16/05/2026, 02:14:58 a. m."  (es-VE)
//   "16/05/2026, 02:14:58"
//   ISO strings
// ═══════════════════════════════════════════════
function parseHistorialDate(dateStr) {
    if (!dateStr) return new Date();
    try {
        // Try ISO / timestamp first
        if (/^\d{4}-/.test(dateStr) || /^\d{13}$/.test(String(dateStr))) {
            const d = new Date(dateStr);
            if (!isNaN(d)) return d;
        }

        // es-VE format: "DD/MM/YYYY, HH:MM:SS [a. m.|p. m.|AM|PM]"
        const m = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):?(\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/i);
        if (m) {
            let [, day, month, year, hh, mm, ss = '0', period = ''] = m;
            let h = parseInt(hh), min = parseInt(mm), sec = parseInt(ss);
            const isAM = /^a/i.test(period.replace(/\./g,'').replace(/\s/g,''));
            const isPM = /^p/i.test(period.replace(/\./g,'').replace(/\s/g,''));
            if (period) {
                if (isPM && h < 12) h += 12;
                if (isAM && h === 12) h = 0;
            }
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, min, sec);
        }
        return new Date();
    } catch { return new Date(); }
}

// ═══════════════════════════════════════════════
// HISTORIAL RENDER
// ═══════════════════════════════════════════════
function renderHistorial() {
    const hDiv = document.getElementById('h-lista');
    if (!hDiv) return;

    // Use filtered data if date filter active, else full historialData
    const source = (historialFiltered !== null) ? historialFiltered : historialData;

    // Time filter  ← FIX #4 (now parseHistorialDate works correctly)
    const timeInput = document.getElementById('filter-time').value;
    let filtered = source;
    if (timeInput) {
        const [hh] = timeInput.split(':');
        const hourInt = parseInt(hh, 10);
        filtered = source.filter(x => {
            const dt = x.timestamp ? new Date(x.timestamp) : parseHistorialDate(x.fecha);
            return dt.getHours() === hourInt;
        });
    }

    if (!filtered.length) {
        hDiv.innerHTML = '<div class="c-hist-empty" role="status"><i class="fas fa-search" aria-hidden="true"></i><p>Sin registros para este filtro</p></div>';
        return;
    }

    const visibleData = filtered.slice(0, historialVisible);
    const listHTML = visibleData.map(x => {
        const dt   = x.timestamp ? new Date(x.timestamp) : parseHistorialDate(x.fecha);
        const label = dt.toLocaleString('es-VE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        });
        return `
        <div class="c-hist-row">
            <div class="c-hist-row__meta">
                <span class="c-hist-row__date">${label}</span>
                <div class="c-hist-row__diff">
                    <span class="c-hist-row__diff-bs">${moneyFmt.format(x.diff_bs || 0)} Bs</span>
                    <span class="c-hist-row__diff-pct">${(x.diff_pct || 0).toFixed(2)}%</span>
                </div>
            </div>
            <div class="c-hist-row__values">
                <div class="c-hist-row__val-group">
                    <span class="c-hist-row__val-label">Comprar</span>
                    <span class="c-hist-row__val c-hist-row__val--green">${moneyFmt.format(x.binance || 0)}</span>
                </div>
                <div class="c-hist-row__val-group">
                    <span class="c-hist-row__val-label">Vender</span>
                    <span class="c-hist-row__val c-hist-row__val--red">${moneyFmt.format(x.binance_compra || 0)}</span>
                </div>
                <div class="c-hist-row__val-group">
                    <span class="c-hist-row__val-label">BCV</span>
                    <span class="c-hist-row__val c-hist-row__val--blue">${moneyFmt.format(x.bcv || 0)}</span>
                </div>
            </div>
        </div>`;
    }).join('');

    const remaining = filtered.length - historialVisible;
    let moreHTML = '';
    if (remaining > 0) {
        moreHTML = ('IntersectionObserver' in window)
            ? `<div id="hist-sentinel" class="c-hist-sentinel"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Cargando ${remaining} registros más…</div>`
            : `<div class="c-load-more-wrap"><button type="button" onclick="cargarMasHistorial()" class="c-load-more"><i class="fas fa-history" aria-hidden="true"></i> ${remaining} registros más</button></div>`;
    }

    hDiv.innerHTML = '<div class="c-hist-rows">' + listHTML + '</div>' + moreHTML;
    setupHistInfiniteScroll();
}

let histObserver = null;
/** Scroll infinito real: observa un centinela al final de la lista del historial. */
function setupHistInfiniteScroll() {
    if (histObserver) { histObserver.disconnect(); histObserver = null; }
    if (!('IntersectionObserver' in window)) return;
    const sentinel = document.getElementById('hist-sentinel');
    if (!sentinel) return;
    const root = document.querySelector('.c-historial-card__list') || null;
    histObserver = new IntersectionObserver((entries) => {
        if (entries.some(e => e.isIntersecting)) cargarMasHistorial();
    }, { root, rootMargin: '120px' });
    histObserver.observe(sentinel);
}

function cargarMasHistorial() { historialVisible += 50; renderHistorial(); }

// ═══════════════════════════════════════════════
// CHART RANGE — FIX #1 + #3 + #8
// ═══════════════════════════════════════════════
async function setChartRange(range) {
    chartRange = range;
    chartDateFiltered = false;

    // Update button styles
    document.querySelectorAll('.chart-filter').forEach(b => {
        b.classList.remove('bg-white/15', 'text-white');
        b.classList.add('text-slate-400');
    });
    const btn = document.getElementById('cf-' + range);
    if (btn) { btn.classList.add('bg-white/15', 'text-white'); btn.classList.remove('text-slate-400'); }

    try {
        // Always request stats=1  ← FIX #3
        const r = await fetch(`/api/tasas-venezuela?range=${range}&stats=1`);
        const j = await r.json();

        // FIX #1: Chart data and historial are kept SEPARATE
        // chartData = what the API returns for the selected range (may be grouped for 7d/all)
        // historialData = always individual records from 24h for the panel below
        if (j.historial) {
            chartData = j.historial;

            // Only update historialData if we're in 24h mode (individual records)
            // For 7d/month/all the server returns grouped data → don't use for historial
            if (range === '24h') {
                historialData = j.historial;
                historialFiltered = null;
                historialVisible = 50;  // Reset visible only when range changes
                renderHistorial();
            }
            // For 7d/month/all: keep historialData unchanged (stays as 24h individual records)
        }

        if (j.chartStats) chartStats = j.chartStats;

        updateChartStats(chartData);
        buildChart(chartData, range);

        // Update date picker bounds
        if (j.rango?.start && j.rango?.end) {
            const el = document.getElementById('filter-date');
            if (el) {
                el.min = new Date(j.rango.start).toISOString().split('T')[0];
                el.max = new Date(j.rango.end).toISOString().split('T')[0];
            }
        }
    } catch (e) { console.error('setChartRange error:', e); }
}

// ═══════════════════════════════════════════════
// CHART STATS
// ═══════════════════════════════════════════════
function updateChartStats(data) {
    const elMax = document.getElementById('stat-max');
    const elMin = document.getElementById('stat-min');
    const elAvg = document.getElementById('stat-avg');

    // Use server stats when available and no date filter active  ← FIX #3
    if (chartStats && !chartDateFiltered) {
        if (elMax) elMax.innerText = moneyFmt.format(chartStats.max);
        if (elMin) elMin.innerText = moneyFmt.format(chartStats.min);
        if (elAvg) elAvg.innerText = moneyFmt.format(chartStats.avg);
        return;
    }

    // Compute from data
    const prices = (data || []).map(h => h.binance).filter(p => typeof p === 'number' && p > 0);
    if (prices.length) {
        if (elMax) elMax.innerText = moneyFmt.format(Math.max(...prices));
        if (elMin) elMin.innerText = moneyFmt.format(Math.min(...prices));
        if (elAvg) elAvg.innerText = moneyFmt.format(prices.reduce((a,b) => a+b, 0) / prices.length);
    } else {
        if (elMax) elMax.innerText = '--';
        if (elMin) elMin.innerText = '--';
        if (elAvg) elAvg.innerText = '--';
    }
}

// ═══════════════════════════════════════════════
// BUILD CHART
// ═══════════════════════════════════════════════
function buildChart(rawData, range) {
    const canvas = document.getElementById('mainChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let data = [...(rawData || [])].sort((a, b) => {
        const ta = a.timestamp || parseHistorialDate(a.fecha).getTime();
        const tb = b.timestamp || parseHistorialDate(b.fecha).getTime();
        return ta - tb;
    });

    if (!data.length) {
        data = [{ binance: d.binance || 0, binance_compra: d.binance_compra || 0, bcv: d.bcv || 0, timestamp: Date.now() }];
    }

    // Downsample para rendimiento: 300 pts máximo (más detalle que antes)
    const MAX_CHART_PTS = 300;
    if (data.length > MAX_CHART_PTS) {
        const step = Math.ceil(data.length / MAX_CHART_PTS);
        data = data.filter((_, i) => i % step === 0 || i === data.length - 1);
    }

    // Etiquetas según rango: 7D muestra fecha+hora, MES muestra dd/mm HH:00, ALL muestra dd/mm
    const labels = data.map(h => {
        const dt = h.timestamp ? new Date(Number(h.timestamp)) : parseHistorialDate(h.fecha);
        if (isNaN(dt.getTime())) return '?';
        if (range === '7d') {
            // Fecha y hora exacta para rango semanal (un punto por hora)
            return dt.toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        }
        if (range === 'month') {
            // Fecha con bloque horario para rango mensual (un punto cada 4h)
            const h4 = Math.floor(dt.getHours() / 4) * 4;
            return `${dt.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' })} ${String(h4).padStart(2,'0')}h`;
        }
        if (range === 'all') {
            return dt.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
        }
        return dt.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    });

    const tooltipLabels = data.map(h => {
        const dt = h.timestamp ? new Date(Number(h.timestamp)) : parseHistorialDate(h.fecha);
        if (isNaN(dt.getTime())) return '?';
        return dt.toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    });

    const binanceData       = data.map(h => h.binance || 0);
    const binanceCompraData = data.map(h => h.binance_compra || 0);
    const bcvData           = data.map(h => h.bcv || 0);

    if (chartInstance) chartInstance.destroy();

    const mkGrad = (c1, c2) => {
        const g = ctx.createLinearGradient(0, 0, 0, 300);
        g.addColorStop(0, c1); g.addColorStop(1, c2); return g;
    };

    const clampChartToContainer = () => {
        const wrap = canvas?.parentElement;
        if (!wrap || !canvas) return;
        const w = wrap.clientWidth;
        if (w > 0) {
            canvas.style.width = w + 'px';
            canvas.style.maxWidth = w + 'px';
        }
    };

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Binance (Comprar)', data: binanceData,
                  borderColor: '#0ECB81', backgroundColor: mkGrad('rgba(14,203,129,0.15)', 'rgba(14,203,129,0)'),
                  borderWidth: 2, tension: 0.35, pointRadius: data.length > 40 ? 0 : 3, fill: true },
                { label: 'Binance (Vender)', data: binanceCompraData,
                  borderColor: '#F6465D', backgroundColor: mkGrad('rgba(246,70,93,0.12)', 'rgba(246,70,93,0)'),
                  borderWidth: 2, tension: 0.35, pointRadius: data.length > 40 ? 0 : 3, fill: true },
                { label: 'BCV', data: bcvData,
                  borderColor: '#3B82F6', backgroundColor: mkGrad('rgba(59,130,246,0.10)', 'rgba(59,130,246,0)'),
                  borderWidth: 2, tension: 0.35, pointRadius: data.length > 40 ? 0 : 3, fill: true, borderDash: [5,4] }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(30,35,41,0.97)',
                    titleColor: '#848E9C', bodyColor: '#EAECEF',
                    borderColor: 'rgba(232,84,26,0.35)', borderWidth: 1,
                    callbacks: {
                        title: (ctx) => tooltipLabels[ctx[0].dataIndex],
                        label: (ctx) => ' ' + ctx.dataset.label + ': ' + moneyFmt.format(ctx.parsed.y) + ' Bs'
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#848E9C', font: { family: 'DM Mono', size: 9 }, maxTicksLimit: 7 } },
                y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#848E9C', font: { family: 'DM Mono', size: 9 }, callback: v => v.toFixed(0) } }
            }
        }
    });

    requestAnimationFrame(() => {
        chartInstance?.resize();
        clampChartToContainer();
        resetHorizontalScroll();
    });
}

function resetHorizontalScroll() {
    const root = document.getElementById('app-root');
    if (root) root.scrollLeft = 0;
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
}

function toggleDataset(index) {
    if (!chartInstance) return;
    const meta = chartInstance.getDatasetMeta(index);
    meta.hidden = !meta.hidden;
    const ids = ['legend-binance', 'legend-compra', 'legend-bcv'];
    const btn = document.getElementById(ids[index]);
    if (btn) btn.classList.toggle('opacity-40', meta.hidden);
    chartInstance.update();
}

// ═══════════════════════════════════════════════
// REAL-TIME CHART UPDATE — FIX #2 + #6
// ═══════════════════════════════════════════════
function updateChartRealTime(data) {
    if (!chartInstance) return;

    // Only add real-time points when viewing 24h (time-based X axis)
    // For 7d/all (date-based) → don't push individual points  ← FIX #6
    if (chartRange !== '24h') return;

    const now = new Date();
    // Use seconds-precision timestamp as key to avoid duplicates  ← FIX #2
    const tsKey = Math.floor(now.getTime() / 60000); // minute bucket
    const label = now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

    const labels  = chartInstance.data.labels;
    const ds      = chartInstance.data.datasets;

    // Check if we already have this minute bucket at the end
    const lastKey = chartInstance._rtLastKey;
    if (lastKey === tsKey) {
        // Update last point in place
        const idx = labels.length - 1;
        if (idx >= 0) {
            ds[0].data[idx] = data.tasas.binance;
            ds[1].data[idx] = data.tasas.binance_compra;
            ds[2].data[idx] = data.tasas.bcv;
        }
    } else {
        chartInstance._rtLastKey = tsKey;
        labels.push(label);
        ds[0].data.push(data.tasas.binance);
        ds[1].data.push(data.tasas.binance_compra);
        ds[2].data.push(data.tasas.bcv);

        // Sliding window: keep max 120 points
        if (labels.length > 120) {
            labels.shift();
            ds.forEach(d => d.data.shift());
        }
    }

    chartInstance.update('none');
}

// ═══════════════════════════════════════════════
// SEARCH HISTORY BY DATE — FIX: don't overwrite chartData
// ═══════════════════════════════════════════════
async function searchHistoryByDate() {
    const dateInput = document.getElementById('filter-date').value;
    if (!dateInput) {
        // Clear filter → restore 24h historial
        historialFiltered = null;
        chartDateFiltered = false;
        historialVisible = 50;
        renderHistorial();
        return;
    }
    const [y, mo, dd] = dateInput.split('-');
    const serverDate = `${dd}/${mo}/${y}`;
    try {
        const r = await fetch(`/api/tasas-venezuela?fecha=${serverDate}`);
        const j = await r.json();

        // FIX: update historialFiltered, NOT historialData and NOT chartData
        historialFiltered = j.historial || [];
        chartDateFiltered = true;
        historialVisible = 50;

        // Update chart stats from this filtered data, but don't rebuild chart
        updateChartStats(historialFiltered);
        renderHistorial();
    } catch (e) { console.error('searchHistoryByDate error:', e); }
}

// ═══════════════════════════════════════════════
// VIEW SWITCH
// ═══════════════════════════════════════════════
function switchView(view) {
    ['divisas','import'].forEach(v => {
        document.getElementById('view-' + v).classList.add('hidden-view');
        document.getElementById('nav-' + v).className = 'px-3 md:px-4 py-1.5 rounded-lg text-xs font-bold transition-smooth text-slate-400 hover:text-white';
    });
    document.getElementById('view-' + view).classList.remove('hidden-view');
    document.getElementById('nav-' + view).className = 'px-3 md:px-4 py-1.5 rounded-lg text-xs font-bold transition-smooth tab-active';
    if (view === 'divisas' && chartInstance) {
        setTimeout(() => {
            chartInstance.resize();
            resetHorizontalScroll();
        }, 100);
    }
}

// ═══════════════════════════════════════════════
// CALC — DIVISAS
// ═══════════════════════════════════════════════
function setM(s) {
    m = s;
    ['VES','USDT','BCV','CNY'].forEach(k => {
        const b = document.getElementById('b-' + k);
        if (b) { b.classList.remove('tab-active','text-white'); b.classList.add('text-slate-400'); }
    });
    const ab = document.getElementById('b-' + s);
    if (ab) { ab.classList.add('tab-active','text-white'); ab.classList.remove('text-slate-400'); }
    const cfg = {
        VES:  ['MONTO EN BOLÍVARES', 'Bs'],
        USDT: ['MONTO EN USDT', '₮'],
        BCV:  ['MONTO EN DÓLAR BCV', '$'],
        CNY:  ['MONTO EN YUANES', '¥']
    };
    document.getElementById('l-input').innerText = cfg[s][0];
    document.getElementById('s-input').innerText = cfg[s][1];
    calc();
}

function clearInput() {
    document.getElementById('monto').value = '';
    document.getElementById('monto').focus();
    calc();
}

function copyToClipboard(id) {
    const t = document.getElementById(id).innerText;
    navigator.clipboard.writeText(t).then(() => {
        const b = document.querySelector(`button[onclick="copyToClipboard('${id}')"] i`);
        if (b) { b.className = 'fas fa-check text-emerald-400'; setTimeout(() => b.className = 'far fa-copy text-xs', 1200); }
        showToast('Copiado: ' + t, 'success', 1500);
    }).catch(() => showToast('No se pudo copiar', 'error', 1800));
}

function calc() {
    const raw = document.getElementById('monto').value;
    const v   = parseLocaleAmount(raw);
    let v1 = 0, v2 = 0, v3 = 0;
    // Fuente de tasas: histórica si está activa, si no las tasas en vivo
    const src = (histMode && histMode.tasas) ? histMode.tasas : d;
    const tr  = src.binance_compra || src.binance;
    const bcv = src.bcv || 0;
    if (m === 'VES') {
        document.getElementById('res1-l').innerText = 'USDT (P2P)';
        v1 = tr > 0 ? v / tr : 0;
        document.getElementById('res2-l').innerText = 'Dólar BCV';
        v2 = bcv > 0 ? v / bcv : 0;
        document.getElementById('res3-l').innerText = 'Yuanes';
        v3 = tr > 0 ? (v / tr) * tasaSegura : 0;
    } else if (m === 'USDT') {
        document.getElementById('res1-l').innerText = 'Bolívares';
        v1 = v * tr;
        document.getElementById('res2-l').innerText = 'Dólar BCV (Ref)';
        v2 = bcv > 0 ? (v * tr) / bcv : 0;
        document.getElementById('res3-l').innerText = 'Yuanes';
        v3 = v * tasaSegura;
    } else if (m === 'BCV') {
        document.getElementById('res1-l').innerText = 'Bolívares';
        v1 = v * bcv;
        document.getElementById('res2-l').innerText = 'USDT (Ref)';
        v2 = tr > 0 ? (v * bcv) / tr : 0;
        document.getElementById('res3-l').innerText = 'Yuanes';
        v3 = tr > 0 ? ((v * bcv) / tr) * tasaSegura : 0;
    } else if (m === 'CNY') {
        const u = tasaSegura > 0 ? v / tasaSegura : 0;
        document.getElementById('res1-l').innerText = 'USDT';
        v1 = u;
        document.getElementById('res2-l').innerText = 'Bolívares';
        v2 = u * tr;
        document.getElementById('res3-l').innerText = 'Dólar BCV';
        v3 = bcv > 0 ? (u * tr) / bcv : 0;
    }
    document.getElementById('res1-v').innerText = moneyFmt.format(v1);
    document.getElementById('res2-v').innerText = moneyFmt.format(v2);
    document.getElementById('res3-v').innerText = moneyFmt.format(v3);
}

// ═══════════════════════════════════════════════
// CALCULADORA CON TASAS HISTÓRICAS
// ═══════════════════════════════════════════════
function fechaCaracasHoyYmd() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
}

function toggleHistPanel() {
    const controls = document.getElementById('hist-controls');
    const btn = document.getElementById('hist-toggle-btn');
    if (!controls) return;
    controls.hidden = !controls.hidden;
    btn?.setAttribute('aria-expanded', String(!controls.hidden));
    btn?.classList.toggle('is-open', !controls.hidden);
    if (!controls.hidden) {
        const dEl = document.getElementById('hist-date');
        if (dEl) {
            if (!dEl.max) dEl.max = fechaCaracasHoyYmd();
            if (!dEl.value) dEl.value = fechaCaracasHoyYmd();
            dEl.focus();
        }
    }
}

async function aplicarTasaHistorica() {
    const fecha = document.getElementById('hist-date')?.value;
    const hora  = document.getElementById('hist-time')?.value;
    if (!fecha) { showToast('Selecciona una fecha', 'warning'); return; }

    const params = new URLSearchParams({ fecha });
    if (hora) params.set('hora', hora);

    const btn = document.getElementById('hist-apply-btn');
    if (btn) btn.disabled = true;
    try {
        const r = await fetch('/api/tasas-historicas?' + params.toString());
        const j = await r.json();
        if (!r.ok) {
            showToast(j?.error || 'No hay datos para esa fecha', 'error', 4000);
            return;
        }
        histMode = j;
        renderHistBanner();
        calc();
        const desf = j.registro?.desfase_min;
        if (Number.isFinite(desf) && desf > 24 * 60) {
            showToast('Aviso: el dato más cercano guardado es del ' + (j.registro?.fecha || 'una fecha anterior'), 'warning', 5000);
        }
    } catch (_) {
        showToast('Error consultando las tasas históricas', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function quitarTasaHistorica() {
    histMode = null;
    const hEl = document.getElementById('hist-time');
    if (hEl) hEl.value = '';
    renderHistBanner();
    calc();
    showToast('Calculadora usando tasas actuales', 'info', 2000);
}

function renderHistBanner() {
    const banner = document.getElementById('hist-banner');
    const card = document.querySelector('.c-calc-card');
    if (!banner) return;

    if (!histMode) {
        banner.hidden = true;
        banner.innerHTML = '';
        card?.classList.remove('c-calc-card--hist');
        return;
    }

    const q = histMode.consulta || {};
    const t = histMode.tasas || {};
    let fechaTxt = q.fecha || '';
    const parts = String(q.fecha || '').split('-');
    if (parts.length === 3) fechaTxt = `${parts[2]}/${parts[1]}/${parts[0]}`;
    const horaTxt = q.hora ? `a las ${q.hora}` : '(cierre del día)';
    const regTxt = histMode.registro?.fecha ? `Dato registrado: ${histMode.registro.fecha}` : '';

    banner.innerHTML = `
      <div class="c-hist-banner__main">
        <i class="fas fa-clock-rotate-left" aria-hidden="true"></i>
        <span class="c-hist-banner__txt">
          <strong>Tasas del ${escapeHtml(fechaTxt)} ${escapeHtml(horaTxt)}</strong>
          <span class="c-hist-banner__rates">BCV ${moneyFmt.format(t.bcv || 0)} · P2P ${moneyFmt.format(t.binance || 0)}</span>
        </span>
        <button type="button" class="c-hist-banner__close" onclick="quitarTasaHistorica()">
          <i class="fas fa-times" aria-hidden="true"></i> Volver a hoy
        </button>
      </div>
      ${regTxt ? `<span class="c-hist-banner__sub">${escapeHtml(regTxt)}</span>` : ''}`;
    banner.hidden = false;
    card?.classList.add('c-calc-card--hist');
}

// ═══════════════════════════════════════════════
// REFRESH — FIX #3 (stats=1 on first load)
// ═══════════════════════════════════════════════
async function refreshManual() {
    const btn = document.getElementById('btn-refresh');
    const icon = btn?.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    await refresh();
    loadStats();
    if (icon) setTimeout(() => icon.classList.remove('fa-spin'), 600);
}

// ═══════════════════════════════════════════════
// VARIACIÓN 24H EN TARJETAS DE TASAS
// ═══════════════════════════════════════════════
function renderRateDelta(id, change, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'delta-bcv' && el.dataset.bcvAlert === '1') return;
    if (typeof change !== 'number' || !Number.isFinite(change) || change === 0) {
        el.textContent = '';
        el.className = 'c-rate-card__delta';
        return;
    }
    const up = change >= 0;
    el.className = 'c-rate-card__delta ' + (up ? 'c-rate-card__delta--up' : 'c-rate-card__delta--down');
    const arrow = up ? '\u25B2' : '\u25BC';
    el.textContent = `${arrow} ${up ? '+' : ''}${moneyFmt.format(change)} (${moneyFmt.format(pct || 0)}%) vs. ayer`;
}

function formatBcvFechaDisplay(meta) {
    // Preferir la «Fecha Valor» oficial del BCV (día en que la tasa rige)
    const ymd = meta?.fecha_valor || meta?.publicada_el;
    if (!ymd) return meta?.nota || '';
    const d = new Date(`${ymd}T12:00:00-04:00`);
    const short = window.matchMedia('(max-width: 480px)').matches;
    const opts = short
        ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Caracas' }
        : { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Caracas' };
    const s = d.toLocaleDateString('es-VE', opts);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatYmdLargoLocal(ymd) {
    const dt = new Date(`${ymd}T12:00:00-04:00`);
    const s = dt.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Caracas' });
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderBcvVigenciaMeta(meta) {
    const notaEl = document.getElementById('bcv-vigencia-nota');
    const deltaEl = document.getElementById('delta-bcv');
    if (!notaEl) return;

    if (!meta?.nota) {
        notaEl.textContent = '';
        notaEl.hidden = true;
        notaEl.removeAttribute('datetime');
        if (deltaEl) deltaEl.dataset.bcvAlert = '0';
        return;
    }

    if (meta.hay_nueva_publicada) {
        notaEl.textContent = '';
        notaEl.hidden = true;
        notaEl.removeAttribute('datetime');
        if (deltaEl) {
            deltaEl.textContent = meta.nota;
            deltaEl.className = 'c-rate-card__delta c-rate-card__delta--alert';
            deltaEl.dataset.bcvAlert = '1';
        }
        return;
    }

    const fechaTxt = formatBcvFechaDisplay(meta);
    notaEl.textContent = fechaTxt;
    notaEl.hidden = false;
    notaEl.className = 'c-rate-card__head-date';
    const ymdRef = meta.fecha_valor || meta.publicada_el;
    if (ymdRef) {
        notaEl.setAttribute('datetime', ymdRef);
        const partes = [];
        if (meta.fecha_valor)  partes.push('Fecha valor: ' + formatYmdLargoLocal(meta.fecha_valor));
        if (meta.publicada_el) partes.push('Publicada el ' + formatYmdLargoLocal(meta.publicada_el));
        notaEl.title = partes.join(' · ');
    } else {
        notaEl.removeAttribute('title');
    }
    if (deltaEl) {
        deltaEl.dataset.bcvAlert = '0';
        if (deltaEl.classList.contains('c-rate-card__delta--alert')) {
            deltaEl.textContent = '';
            deltaEl.className = 'c-rate-card__delta';
        }
    }
}

async function loadStats() {
    try {
        const r = await fetch('/api/stats');
        if (!r.ok) return;
        const s = await r.json();
        renderRateDelta('delta-binance', s.binance?.change24h, s.binance?.changePct24h);
        renderRateDelta('delta-bcv', s.bcv?.change24h, s.bcv?.changePct24h);
        checkRateAlert(s);
    } catch (_) { /* silencioso */ }
}

// Alerta de movimiento brusco (umbral configurable en localStorage)
function checkRateAlert(stats) {
    try {
        const threshold = parseFloat(localStorage.getItem('dz-alert-threshold') || '2');
        const pct = stats?.binance?.changePct24h;
        if (!Number.isFinite(pct) || !Number.isFinite(threshold) || threshold <= 0) return;
        const last = parseFloat(sessionStorage.getItem('dz-last-alert-pct') || 'NaN');
        if (Math.abs(pct) >= threshold && (isNaN(last) || Math.abs(pct - last) >= threshold)) {
            const up = pct >= 0;
            showToast(`Binance ${up ? 'subió' : 'bajó'} ${moneyFmt.format(Math.abs(pct))}% en 24h`, up ? 'success' : 'warning', 4500);
            sessionStorage.setItem('dz-last-alert-pct', String(pct));
        }
    } catch (_) { /* ignore */ }
}

async function refresh() {
    try {
        // FIX #3: always include stats=1 and range=24h
        const r = await fetch('/api/tasas-venezuela?range=24h&stats=1');
        const j = await r.json();

        d = j.tasas;
        historialData = j.historial || [];
        chartData     = j.historial || [];
        chartStats    = j.chartStats || null;

        // Don't reset historialVisible on WS-triggered refreshes  ← FIX implicit
        // Only reset when user explicitly reloads
        historialFiltered = null;
        chartDateFiltered = false;

        if (j.rango?.start && j.rango?.end) {
            const el = document.getElementById('filter-date');
            if (el) {
                el.min = new Date(j.rango.start).toISOString().split('T')[0];
                el.max = new Date(j.rango.end).toISOString().split('T')[0];
            }
            const hd = document.getElementById('hist-date');
            if (hd) {
                hd.min = new Date(j.rango.start).toISOString().split('T')[0];
                hd.max = fechaCaracasHoyYmd();
            }
        }

        updateUI(j);
        updateChartStats(chartData);
        if (!chartInstance) {
            buildChart(chartData, chartRange);
        }
        renderHistorial();
        calc();
    } catch (e) {
        console.error('refresh error:', e);
        const el = document.getElementById('current-rates-time');
        if (el) el.innerText = 'Error al cargar tasas';
    }
}


function updateUI(j) {
    const t = j && j.tasas;
    if (!t) { refreshImpUnitarioRates(); return; }

    const binanceNum = Number(t.binance);
    const bcvNum = Number(t.bcv);
    const bnCompraRaw = Number(t.binance_compra);

    const tickerInner = document.getElementById('ticker-inner');
    if (tickerInner) {
        const bBuy = Number.isFinite(binanceNum) ? binanceNum : 0;
        const bSell = Number.isFinite(bnCompraRaw) ? bnCompraRaw : 0;
        const bBcv = Number.isFinite(bcvNum) ? bcvNum : 0;
        const item = (lab, val) =>
            '<span class="c-ticker__item"><span class="c-ticker__lab">' + lab + '</span>' +
            '<span class="c-ticker__num">' + moneyFmt.format(val) + '</span></span>';
        const rowHtml =
            item('Comprar', bBuy) +
            item('Vender', bSell) +
            item('BCV', bBcv) +
            item('CNY/$', tasaSegura);
        tickerInner.innerHTML =
            '<div class="c-ticker__marquee"><div class="c-ticker__strip">' + rowHtml + '</div>' +
            '<div class="c-ticker__strip" aria-hidden="true">' + rowHtml + '</div></div>';
    }

    const binance = binanceNum;
    const bcv = bcvNum;
    if (!Number.isFinite(binance) || !Number.isFinite(bcv)) {
        refreshImpUnitarioRates();
        return;
    }

    assignRateFieldWithFlash('t-binance', moneyFmt.format(binance), true);
    assignRateFieldWithFlash('t-binance-compra', moneyFmt.format(Number.isFinite(bnCompraRaw) ? bnCompraRaw : 0), true);
    assignRateFieldWithFlash('t-bcv', moneyFmt.format(bcv), true);
    assignRateFieldWithFlash('t-cny', moneyFmt.format(tasaSegura), true);

    renderBcvVigenciaMeta(j.bcv_meta);

    const pct = document.getElementById('b-pct');
    if (pct) pct.innerText = (j.diff_pct || 0).toFixed(2) + '%';

    markRateCardsReady();

    // Last update time
    const fechaMostrada = j.last_update || j.fecha || '';
    let horaTexto = '--:--:--';
    if (fechaMostrada) {
        const parts = fechaMostrada.split(',');
        horaTexto = parts.length > 1 ? parts[1].trim() : fechaMostrada;
    }
    const elHist = document.getElementById('last-update');
    if (elHist) elHist.innerText = horaTexto;
    const elRates = document.getElementById('current-rates-time');
    if (elRates) {
        elRates.innerText = horaTexto;
        elRates.classList.add('text-emerald-400');
        setTimeout(() => elRates.classList.remove('text-emerald-400'), 2000);
    }

    refreshImpUnitarioRates();
}

// ═══════════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════════
function connectWS() {
    try {
        const prot = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws   = new WebSocket(`${prot}//${location.host}/tasas-ws`);

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'tasas_update') {
                    d = msg.data.tasas;
                    const dbs = d.binance - d.bcv;
                    const dp  = d.bcv > 0 ? (dbs / d.bcv) * 100 : 0;
                    updateUI({ ...msg.data, diff_bs: dbs, diff_pct: dp });
                    calc();
                    updateChartRealTime(msg.data);
                    resetHorizontalScroll();

                    // FIX: do NOT reset historialVisible on WS update
                    // historialData gets a new entry only from periodic refresh
                }
            } catch { /* ignore parse errors */ }
        };

        ws.onclose  = () => setTimeout(connectWS, 5000);
        ws.onerror  = () => {};
    } catch (e) { setTimeout(connectWS, 8000); }
}

// ═══════════════════════════════════════════════
// IMPORT CALCULATOR
// ═══════════════════════════════════════════════
const GCCARGO_TARIFA_USD = 770;

/** USD → equivalente $ BCV (P2P compra vs tasa BCV del momento) y yuanes (tasaSegura). */
function formatCostoUnitarioCurrencies(usd) {
    const u = Number(usd) || 0;
    if (!Number.isFinite(u) || u <= 0) {
        return { usd: '$0.00', bcv: '$0.00 (BCV)', cny: '¥0.00' };
    }
    const br   = d.bcv || 0;
    const binr = d.binance_compra || d.binance || 0;
    const bcvUsd = (br > 0 && binr > 0) ? (u * binr) / br : null;
    return {
        usd: usdFmt.format(u),
        bcv: bcvUsd != null ? usdFmt.format(bcvUsd) + ' (BCV)' : '-- (BCV)',
        cny: '¥' + moneyFmt.format(u * tasaSegura),
    };
}

function setImpUnitarioDisplay(usd) {
    const f = formatCostoUnitarioCurrencies(usd);
    const el = document.getElementById('imp-unitario');
    const elBcv = document.getElementById('imp-unitario-bcv');
    const elCny = document.getElementById('imp-unitario-cny');
    if (el) el.innerText = f.usd;
    if (elBcv) elBcv.innerText = f.bcv;
    if (elCny) elCny.innerText = f.cny;
}

function refreshImpUnitarioRates() {
    if (gCostoUnitario > 0) setImpUnitarioDisplay(gCostoUnitario);
    calcGanancia();

    // Mientras se edita, el panel de detalle vive DENTRO del listado; re-renderizar
    // las tarjetas lo destruiría. Solo refrescamos el panel en ese caso.
    const detailEl = document.getElementById('import-quotes-detail');
    const editing = importCurrentQuote && detailEl && !detailEl.classList.contains('hidden');
    if (editing) {
        renderDetalleCotizacionImport(importCurrentQuote);
        return;
    }

    // Re-render de tarjetas para refrescar los equivalentes en BCV/CNY con las
    // nuevas tasas (no hay petición de red: los datos ya están en memoria).
    // Solo si la vista de Importación está visible, para no rehacer trabajo en vano.
    const importView = document.getElementById('view-import');
    const importVisible = importView && !importView.classList.contains('hidden-view');
    if (importVisible && importQuotesAll.length) renderImportQuotesList();
}

const ORINOCO_TARIFA_USD    = 865;
const IMPORT2VEN_TARIFA_USD = 1030;
const ORINOCO_MIN_USD       = 35;     // tarifa mínima Orinoco
const ORINOCO_MIN_VOL_M3    = 0.035;  // umbral de volumen por caja

function isGccargoTarifa(tarifa) {
    return Number(tarifa) === GCCARGO_TARIFA_USD;
}

/** Identifica la empresa por su tarifa base. 'custom' = personalizado (lógica densidad). */
function importCompanyKind(tarifaBase) {
    const t = Number(tarifaBase);
    if (t === GCCARGO_TARIFA_USD)    return 'gccargo';
    if (t === ORINOCO_TARIFA_USD)    return 'orinoco';
    if (t === IMPORT2VEN_TARIFA_USD) return 'import2ven';
    return 'custom';
}

/**
 * Cálculo de envío internacional por empresa. ÚNICA fuente de verdad para flete.
 *  - GCCARGO ($770):    volumen puro, sin mínimo.
 *  - Orinoco ($865):    volumen puro; mínimo $35 por caja si volumen/caja < 0.035 m³.
 *  - import2ven ($1030) / Personalizado: por densidad (peso vs volumen).
 *
 * Devuelve volumen total y por caja, peso total, flete total y por caja, tipo de cobro
 * y si se aplicó la tarifa mínima de Orinoco.
 */
function computeImportShipping(l, w, h, nc, pesoPorCajaKg, tarifaBase) {
    const tarifa     = Number(tarifaBase) || 0;
    const cajas      = nc > 0 ? nc : 1;
    const volPorCaja = (l * w * h) / 1000000;   // m³ por caja
    const pesoTotal  = pesoPorCajaKg * cajas;
    const kind       = importCompanyKind(tarifa);

    let volumenM3, fleteUSD, fletePorCajaUSD, tipoCobro, tarifaMinAplicada = false;

    if (kind === 'gccargo') {
        volumenM3       = volPorCaja * cajas;
        fletePorCajaUSD = tarifa * volPorCaja;
        fleteUSD        = tarifa * volumenM3;
        tipoCobro       = 'Volumen';
    } else if (kind === 'orinoco') {
        volumenM3 = volPorCaja * cajas;
        let basePorCaja = volPorCaja * tarifa;
        // REGLA DE NEGOCIO: tarifa mínima $35 para envíos pequeños (vol/caja < 0.035 m³)
        if (volPorCaja > 0 && volPorCaja < ORINOCO_MIN_VOL_M3) {
            basePorCaja = Math.max(basePorCaja, ORINOCO_MIN_USD);
        }
        tarifaMinAplicada = (volPorCaja > 0 && volPorCaja < ORINOCO_MIN_VOL_M3 && basePorCaja === ORINOCO_MIN_USD);
        fletePorCajaUSD   = basePorCaja;
        fleteUSD          = basePorCaja * cajas;
        tipoCobro         = tarifaMinAplicada ? 'Vol. (mín. $35)' : 'Volumen';
    } else {
        // import2ven / personalizado — cobro por densidad
        volumenM3 = Math.ceil(volPorCaja * cajas * 1000) / 1000;
        const den = volumenM3 > 0 ? pesoTotal / volumenM3 : 0;
        let cEnv = 0;
        if (den > 1000) {
            cEnv = pesoTotal * (tarifa / 1000);
            tipoCobro = 'Peso';
        } else {
            let tar = tarifa;
            if (den >= 380 && den <= 1000) { tar += 50; tipoCobro = 'Volumen (+Den)'; }
            else { tipoCobro = 'Volumen'; }
            cEnv = volumenM3 * tar;
        }
        fleteUSD        = Math.ceil(cEnv);
        fletePorCajaUSD = cajas > 0 ? fleteUSD / cajas : fleteUSD;
    }

    return { volumenM3, volumenPorCajaM3: volPorCaja, pesoKg: pesoTotal, fleteUSD, fletePorCajaUSD, tipoCobro, tarifaMinAplicada };
}

function updateCustomRate(v) {
    importTarifaBase = parseFloat(v) || 0;
    setEmpresa('custom');
}

function setEmpresa(v) {
    if (v === 'custom') {
        importTarifaBase = parseFloat(document.getElementById('custom-rate').value) || 0;
        importEmpresaNombre = 'Personalizado';
    } else {
        importTarifaBase = v;
        const names = { 770: 'GCCARGO', 865: 'Orinoco', 1030: 'import2ven' };
        importEmpresaNombre = names[v] || 'Personalizado';
    }

    // Reset all buttons
    [770, 865, 1030].forEach(id => {
        const b = document.getElementById('btn-emp-' + id);
        if (b) {
            b.className = 'empresa-btn c-empresa-btn px-2 py-3 bg-slate-900/40 border border-slate-700/50 rounded-xl hover:bg-slate-800';
            const t = b.querySelector('span:first-child'), p = b.querySelector('span:last-child');
            if (t) t.className = 'block text-xs font-bold text-slate-300 uppercase tracking-wide';
            if (p) p.className = 'block text-sm text-emerald-400 font-bold mt-0.5';
        }
    });
    const customBtn = document.getElementById('btn-emp-custom');
    if (customBtn) {
        customBtn.className = 'empresa-btn c-empresa-btn c-empresa-btn--custom px-2 py-3 bg-slate-900/40 border border-slate-700/50 rounded-xl hover:bg-slate-800 flex flex-col items-center justify-center';
    }
    const crInput = document.getElementById('custom-rate');
    const crPfx   = document.getElementById('custom-rate-prefix');
    if (crInput) crInput.className = 'w-16 bg-transparent border-b border-slate-600 text-center text-emerald-400 font-bold text-sm focus:outline-none focus:border-emerald-400';
    if (crPfx)  crPfx.className = 'text-emerald-400 font-bold text-sm';

    // Activate selected
    const activeId = v === 'custom' ? 'btn-emp-custom' : 'btn-emp-' + v;
    const ab = document.getElementById(activeId);
    if (ab) {
        ab.className = 'empresa-btn c-empresa-btn px-2 py-3 bg-indigo-600 border border-indigo-400 rounded-xl shadow-[0_0_15px_rgba(79,70,229,0.3)]' +
            (v === 'custom' ? ' c-empresa-btn--custom flex flex-col items-center justify-center' : '');
        if (v !== 'custom') {
            const t = ab.querySelector('span:first-child'), p = ab.querySelector('span:last-child');
            if (t) t.className = 'block text-xs font-bold text-white uppercase tracking-wide';
            if (p) p.className = 'block text-sm text-indigo-100 font-bold mt-0.5';
        } else {
            if (crInput) crInput.className = 'w-16 bg-transparent border-b border-indigo-200 text-center text-white font-bold text-sm focus:outline-none focus:border-white';
            if (crPfx)  crPfx.className = 'text-indigo-200 font-bold text-sm';
        }
    }
    calcImport();
}

function onEditarComisionesImport() {
    const pv = parseFloat(document.getElementById('imp-fee-plat-input').value);
    const bv = parseFloat(document.getElementById('imp-fee-banco-input').value);
    if (Number.isFinite(pv) && pv >= 0) { feePlataforma = pv / 100; document.getElementById('imp-fee-plat-pct').innerText = pv.toFixed(2); }
    if (Number.isFinite(bv) && bv >= 0) { feeBanco = bv / 100; document.getElementById('imp-fee-banco-pct').innerText = bv.toFixed(2); }
    calcImport();
}

// ═══════════════════════════════════════════════
// IMPORT — modo guiado / rápido (mismo resultado)
// ═══════════════════════════════════════════════
let importInputMode = 'guided';

function gv(id) {
    const el = document.getElementById(id);
    const raw = (el?.value ?? '').toString().trim();
    if (!raw) return '';
    return String(parseLocaleAmount(raw));
}

/** Construye la cadena corta canónica desde los campos del modo guiado. */
function buildRawFromGuided() {
    const l = gv('g-largo'), w = gv('g-ancho'), h = gv('g-alto');
    const peso = gv('g-peso'), unid = gv('g-unid'), precio = gv('g-precio');
    const envio = gv('g-envio'), cajas = gv('g-cajas');
    if (!l || !w || !h || !peso || !unid || !precio) return '';
    let raw = `${l}x${w}x${h} ${peso} ${unid} ${precio}`;
    const envioN = parseFloat(envio) || 0;
    const cajasN = parseInt(cajas, 10) || 1;
    if (envioN > 0 || cajasN > 1) raw += ` ${envioN}`;
    if (cajasN > 1) raw += ` ${cajasN}`;
    return raw;
}

/** Rellena los campos del modo guiado desde una cadena corta. */
function fillGuidedFromRaw(raw) {
    const clean = (raw || '').replace(/[/\\*]/g, 'x').toLowerCase().trim();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v != null && v !== '' && !isNaN(parseFloat(v))) ? v : ''; };
    if (!clean) { ['g-largo','g-ancho','g-alto','g-peso','g-unid','g-precio','g-envio','g-cajas'].forEach(id => set(id, '')); return; }
    const p = clean.split(/\s+/);
    const dims = (p[0] || '').split('x');
    if (dims.length === 3) { set('g-largo', dims[0]); set('g-ancho', dims[1]); set('g-alto', dims[2]); }
    set('g-peso', p[1]); set('g-unid', p[2]); set('g-precio', p[3]);
    set('g-envio', p[4]); set('g-cajas', p[5]);
}

function onGuidedImportInput() {
    const dataEl = document.getElementById('imp-data');
    if (dataEl) dataEl.value = buildRawFromGuided();
    calcImport();
}

function onQuickImportInput() { calcImport(); }

function setImportInputMode(mode) {
    importInputMode = mode;
    const guided = document.getElementById('imp-guided');
    const quick  = document.getElementById('imp-quick');
    const bg = document.getElementById('btn-imp-mode-guided');
    const bq = document.getElementById('btn-imp-mode-quick');
    const dataEl = document.getElementById('imp-data');
    if (mode === 'guided') {
        if (dataEl) fillGuidedFromRaw(dataEl.value);
        guided?.classList.remove('hidden'); quick?.classList.add('hidden');
        bg?.classList.add('is-active'); bq?.classList.remove('is-active');
    } else {
        const raw = buildRawFromGuided();
        if (dataEl && raw) dataEl.value = raw;
        quick?.classList.remove('hidden'); guided?.classList.add('hidden');
        bq?.classList.add('is-active'); bg?.classList.remove('is-active');
    }
    calcImport();
}

function calcImport() {
    const val = document.getElementById('imp-data').value.trim();
    if (!val) {
        document.getElementById('imp-results').style.opacity = '0.5';
        gCostoUnitario = gCostoCaja = 0;
        setImpUnitarioDisplay(0);
        calcGanancia(); return;
    }
    document.getElementById('imp-results').style.opacity = '1';

    const clean = val.replace(/[/\\*]/g, 'x').toLowerCase();
    const p = clean.split(/\s+/);
    if (p.length < 4) {
        document.getElementById('imp-results').style.opacity = '0.5';
        gCostoUnitario = gCostoCaja = 0;
        setImpUnitarioDisplay(0);
        calcGanancia();
        return;
    }

    try {
        const dims = p[0].split('x');
        if (dims.length !== 3) {
            document.getElementById('imp-results').style.opacity = '0.5';
            gCostoUnitario = gCostoCaja = 0;
            setImpUnitarioDisplay(0);
            calcGanancia();
            return;
        }
        const l = parseLocaleAmount(dims[0]), w = parseLocaleAmount(dims[1]), h = parseLocaleAmount(dims[2]);
        const pbc = parseLocaleAmount(p[1]);
        const ubc = parseInt(p[2], 10);
        const pu  = parseLocaleAmount(p[3]) / tasaSegura;
        const ecbc = p.length >= 5 ? parseLocaleAmount(p[4]) : 0;
        const nc   = p.length >= 6 ? parseInt(p[5], 10) : 1;

        if ([l,w,h,pbc,ubc,pu].some(n => isNaN(n))) {
            document.getElementById('imp-results').style.opacity = '0.5';
            gCostoUnitario = gCostoCaja = 0;
            setImpUnitarioDisplay(0);
            calcGanancia();
            return;
        }

        const envio = computeImportShipping(l, w, h, nc, pbc, importTarifaBase);
        const vTot = envio.volumenM3;
        const pTot = envio.pesoKg;
        const cEnv = envio.fleteUSD;
        const tCob = envio.tipoCobro;

        const tU  = ubc * nc;
        const tM  = tU * pu;
        const tEC = ecbc * nc;
        const bC  = tM + tEC;
        const fP  = bC * feePlataforma;
        const fB  = bC * feeBanco;
        const sT  = tM + tEC + fP + fB;
        const iT  = tM + tEC + fP + fB + cEnv;

        gCostoUnitario  = iT / tU;
        gCostoCaja      = iT / nc;
        gUnidadesPorCaja = ubc;

        const volPorCajaTxt = nc > 1 ? ` · ${n3(envio.volumenPorCajaM3)}/caja` : '';
        document.getElementById('imp-vol').innerText   = vTot.toFixed(3) + ' m³' + volPorCajaTxt;
        document.getElementById('imp-peso').innerText  = pTot.toFixed(2) + ' kg';
        document.getElementById('imp-tipo').innerText  = tCob;
        document.getElementById('imp-mercancia').innerText = usdFmt.format(tM);

        // Nota informativa de tarifa mínima Orinoco
        const noteEl = document.getElementById('imp-tarifa-min-note');
        if (noteEl) {
            if (envio.tarifaMinAplicada) {
                noteEl.style.display = 'flex';
                noteEl.querySelector('span').innerText = `Tarifa mínima aplicada: ${usdFmt.format(ORINOCO_MIN_USD)} por caja (volumen < 0.035 m³)`;
            } else {
                noteEl.style.display = 'none';
            }
        }

        const rowCh = document.getElementById('row-envio-china');
        if (tEC > 0) { rowCh.style.display = 'flex'; document.getElementById('imp-envio-china').innerText = '+' + usdFmt.format(tEC); }
        else rowCh.style.display = 'none';

        document.getElementById('imp-fee-plat').innerText  = '+' + usdFmt.format(fP);
        document.getElementById('imp-fee-banco').innerText = '+' + usdFmt.format(fB);
        document.getElementById('imp-subtotal').innerText  = usdFmt.format(sT);
        document.getElementById('imp-flete').innerText     = '+' + usdFmt.format(cEnv) + (nc > 1 ? ` (${usdFmt.format(envio.fletePorCajaUSD)} × ${nc})` : '');
        document.getElementById('imp-total').innerText     = usdFmt.format(iT);
        setImpUnitarioDisplay(gCostoUnitario);
        document.getElementById('imp-caja').innerText      = usdFmt.format(gCostoCaja);

        lastImportQuote = {
            version: 1, entradaRaw: val,
            empresaNombre: importEmpresaNombre, empresaTarifaUSD: importTarifaBase, empresaEnvioUSD: importTarifaBase,
            cajas: nc, unidadesPorCaja: ubc, unidadesTotales: tU,
            dimensionesCm: { l, w, h },
            pesoPorCajaKg: pbc, precioMercanciaPorUnidadUSD: pu, envioChinaPorCajaUSD: ecbc,
            volumenM3: vTot, volumenPorCajaM3: envio.volumenPorCajaM3, pesoKg: pTot, tipoCobro: tCob,
            costoMercanciaUSD: tM, envioChinaUSD: tEC, plataformaUSD: fP, comisionBancoUSD: fB,
            subtotalUSD: sT, envioInternacionalUSD: cEnv, fletePorCajaUSD: envio.fletePorCajaUSD,
            tarifaMinAplicada: envio.tarifaMinAplicada, inversionTotalUSD: iT,
            costoUnitarioUSD: gCostoUnitario, costoPorCajaUSD: gCostoCaja,
            feePlataforma, feeBanco
        };
        calcGanancia();
    } catch (e) { console.error('calcImport error:', e); }
}

// ═══════════════════════════════════════════════
// GANANCIA SIMULATOR
// ═══════════════════════════════════════════════
function setSimSource(s) {
    simSource = s;
    const on  = 'c-sim-tab py-1.5 rounded-md text-[9px] font-bold transition-smooth shadow';
    const off = 'c-sim-tab py-1.5 rounded-md text-[9px] font-bold transition-smooth text-slate-400 hover:text-white';
    const bCalc = document.getElementById('btn-src-calc'), bMan = document.getElementById('btn-src-manual');
    const mi   = document.getElementById('sim-manual-input-container');
    if (s === 'calc') {
        bCalc.className = on + ' bg-indigo-600 text-white'; bMan.className = off;
        mi.style.display = 'none';
    } else {
        bMan.className = on + ' bg-indigo-600 text-white'; bCalc.className = off;
        mi.style.display = 'block';
        document.getElementById('sim-costo-manual').focus();
    }
    calcGanancia();
}

function setSimType(t) {
    simType = t;
    const on  = 'c-sim-tab py-1.5 rounded-md text-[9px] font-bold transition-smooth bg-emerald-600 text-white shadow';
    const off = 'c-sim-tab py-1.5 rounded-md text-[9px] font-bold transition-smooth text-slate-400 hover:text-white';
    document.getElementById('btn-sim-unidad').className = t === 'unidad' ? on : off;
    document.getElementById('btn-sim-caja').className   = t === 'caja'   ? on : off;
    calcGanancia();
}

function setSimMode(m) {
    simMode = m;
    const on  = 'c-sim-tab py-1.5 rounded-md text-[9px] font-bold transition-smooth bg-indigo-600 text-white shadow';
    const off = 'c-sim-tab py-1.5 rounded-md text-[9px] font-bold transition-smooth text-slate-400 hover:text-white';
    document.getElementById('btn-mode-precio').className = m === 'precio' ? on : off;
    const bsBtn = document.getElementById('btn-mode-bs');
    if (bsBtn) bsBtn.className = m === 'bs' ? on : off;
    document.getElementById('btn-mode-pct').className    = m === 'pct'    ? on : off;
    const icon = document.getElementById('sim-input-icon');
    const ip   = document.getElementById('sim-input');
    const l1   = document.getElementById('lbl-res-1');
    const l2   = document.getElementById('lbl-res-2');
    if (m === 'precio') {
        icon.innerText = '$'; ip.placeholder = 'Precio venta (USD)';
        l1.innerText = 'Ganancia Neta'; l2.innerText = 'Rentabilidad (ROI)';
    } else if (m === 'bs') {
        icon.innerText = 'Bs'; ip.placeholder = 'Precio venta (Bs.)';
        l1.innerText = 'Ganancia Neta'; l2.innerText = 'Rentabilidad (ROI)';
    } else {
        icon.innerText = '%'; ip.placeholder = 'Margen deseado (%)';
        l1.innerText = 'Precio Sugerido'; l2.innerText = 'Ganancia Estimada';
    }
    calcGanancia();
}

/** Total de ítems para proyectar ganancia total en el sparkline. */
function simTotalCount() {
    if (simSource !== 'calc' || !lastImportQuote) return 1;
    return simType === 'unidad'
        ? (Number(lastImportQuote.unidadesTotales) || 1)
        : (Number(lastImportQuote.cajas) || 1);
}

/** Sparkline SVG: ganancia total proyectada vs. precio de venta (cruza $0 en el equilibrio). */
function drawSimSparkline(cb, totalCount, currentSale) {
    const wrap = document.getElementById('sim-spark-wrap');
    const host = document.getElementById('sim-spark');
    if (!wrap || !host) return;
    if (!(cb > 0)) { wrap.style.display = 'none'; host.innerHTML = ''; return; }
    wrap.style.display = 'block';

    const W = 300, H = 66, pad = 5, n = 24;
    const pMin = cb * 0.5, pMax = cb * 2;
    const count = totalCount > 0 ? totalCount : 1;
    const pts = [];
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i <= n; i++) {
        const price = pMin + (pMax - pMin) * (i / n);
        const profit = (price - cb) * count;
        pts.push(profit);
        if (profit < yMin) yMin = profit;
        if (profit > yMax) yMax = profit;
    }
    if (yMax === yMin) yMax = yMin + 1;
    const x = (i) => pad + (W - 2 * pad) * (i / n);
    const y = (v) => H - pad - (H - 2 * pad) * ((v - yMin) / (yMax - yMin));
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    const zeroY = y(0).toFixed(1);

    let marker = '';
    if (currentSale > 0 && currentSale >= pMin && currentSale <= pMax) {
        const cx = pad + (W - 2 * pad) * ((currentSale - pMin) / (pMax - pMin));
        const cprofit = (currentSale - cb) * count;
        marker = `<circle cx="${cx.toFixed(1)}" cy="${y(cprofit).toFixed(1)}" r="3.5" fill="#E8541A"/>`;
    }
    host.innerHTML =
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
        `<line x1="${pad}" y1="${zeroY}" x2="${W - pad}" y2="${zeroY}" stroke="rgba(255,255,255,0.20)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` +
        `<path d="${path}" fill="none" stroke="#0ECB81" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
        marker +
        `</svg>`;
}

/** Refresca el panel de tasas de referencia y el costo base mostrado en el simulador. */
function updateSimReferenceUI() {
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
    const binBuy  = Number(d.binance) || 0;          // Bs por USDT (Binance compra)
    const binSell = Number(d.binance_compra) || 0;   // Bs por USDT (Binance venta)
    const bcv     = Number(d.bcv) || 0;
    set('sim-rate-bin-buy',  binBuy  > 0 ? moneyFmt.format(binBuy)  : '--');
    set('sim-rate-bin-sell', binSell > 0 ? moneyFmt.format(binSell) : '--');
    set('sim-rate-bcv',      bcv     > 0 ? moneyFmt.format(bcv)     : '--');
    set('sim-rate-cny',      moneyFmt.format(tasaSegura));

    let cb = 0;
    if (simSource === 'manual') cb = parseLocaleAmount(document.getElementById('sim-costo-manual')?.value);
    else cb = simType === 'unidad' ? gCostoUnitario : gCostoCaja;
    const binr = binSell || binBuy;
    set('sim-base-type', simType === 'unidad' ? 'por unidad' : 'por caja');
    set('sim-base-usd', usdFmt.format(cb));
    set('sim-base-bs', binr > 0 ? 'Bs ' + moneyFmt.format(cb * binr) : 'Bs --');
}

function clearActiveMargenChip() {
    document.querySelectorAll('.c-sim-chip.is-active').forEach(el => el.classList.remove('is-active'));
}

function setActiveMargenChip(pct) {
    clearActiveMargenChip();
    const chip = document.querySelector(`.c-sim-chip[data-margin="${pct}"]`);
    if (chip) chip.classList.add('is-active');
}

/** Entrada manual de precio: limpia el resaltado de margen rápido y recalcula. */
function onSimInputManual() {
    clearActiveMargenChip();
    calcGanancia();
}

function calcGanancia() {
    updateSimReferenceUI();
    const val = parseLocaleAmount(document.getElementById('sim-input').value);
    const r1  = document.getElementById('sim-res-1');
    const r1c = document.getElementById('sim-res-1-cross');
    const r2  = document.getElementById('sim-res-2');
    const rowU = document.getElementById('row-sim-unitario');
    const precioUsd = document.getElementById('sim-precio-usd');
    const precioBcv = document.getElementById('sim-precio-bcv');
    const beEl   = document.getElementById('sim-breakeven');
    const beBcv  = document.getElementById('sim-breakeven-bcv');
    const rowRec = document.getElementById('row-sim-recuperar');
    const recEl  = document.getElementById('sim-recuperar');
    const margenEl = document.getElementById('sim-margen');
    const rowTotal = document.getElementById('row-sim-total');
    const totalEl  = document.getElementById('sim-total');
    const totalBcv = document.getElementById('sim-total-bcv');
    const totalBasis = document.getElementById('sim-total-basis');

    let cb = 0;
    if (simSource === 'manual') cb = parseLocaleAmount(document.getElementById('sim-costo-manual').value);
    else cb = simType === 'unidad' ? gCostoUnitario : gCostoCaja;

    const br   = d.bcv || 0;
    const binr = d.binance_compra || d.binance || 0;
    const tbd  = (u) => (br > 0 && binr > 0) ? (u * binr) / br : 0;
    // Cruz informativa: bolívares reales (a tasa P2P) + equivalente en dólar BCV.
    const crossOf = (u) => {
        const bs = binr > 0 ? 'Bs ' + moneyFmt.format(u * binr) : 'Bs --';
        return (br > 0 && binr > 0) ? `${bs} · ${usdFmt.format(tbd(u))} BCV` : bs;
    };
    const isMargin = (simMode === 'pct');

    // Punto de equilibrio = costo base (precio donde la ganancia es $0)
    if (beEl)  beEl.innerText  = usdFmt.format(cb);
    if (beBcv) beBcv.innerText = cb > 0 ? crossOf(cb) : 'Bs 0,00 · $0.00 BCV';

    const resetAll = () => {
        r1.innerText = '$0.00'; r1.className = 'c-sim-result-row__val text-slate-400 font-bold text-sm block';
        r1c.innerText = 'Bs 0,00 · $0.00 BCV';
        r2.innerText = isMargin ? '$0.00' : '0.00%';
        r2.className = 'c-sim-result-row__val text-slate-400 font-bold text-sm block';
        if (precioUsd) precioUsd.innerText = '$0.00';
        if (precioBcv) precioBcv.innerText = 'Bs 0,00 · $0.00 BCV';
        if (rowU) rowU.style.display = 'none';
        if (rowRec) rowRec.style.display = 'none';
        if (margenEl) { margenEl.innerText = '0.00%'; margenEl.className = 'c-sim-result-row__val text-slate-400 font-bold text-sm'; }
        if (rowTotal) rowTotal.style.display = 'none';
        lastSimPlan = null;
        drawSimSparkline(cb, simTotalCount(), 0);
    };

    if (!val || !cb) { resetAll(); return; }
    if (simMode === 'bs' && binr <= 0) { resetAll(); return; }

    // Precio de venta en USD según el modo
    let saleUSD, gan, roi;
    if (simMode === 'precio')      { saleUSD = val; }
    else if (simMode === 'bs')     { saleUSD = val / binr; }
    else                            { saleUSD = cb * (1 + val / 100); }
    gan = saleUSD - cb;
    roi = (gan / cb) * 100;

    if (!isMargin) {
        r1.innerText  = (gan >= 0 ? '+' : '') + usdFmt.format(gan);
        r1.className  = `c-sim-result-row__val font-bold text-sm ${gan >= 0 ? 'text-emerald-400' : 'text-rose-400'} block`;
        r1c.innerText = crossOf(gan);
        r2.innerText  = roi.toFixed(2) + '%';
        r2.className  = `c-sim-result-row__val font-bold text-sm ${roi >= 0 ? 'text-emerald-400' : 'text-rose-400'} block`;
    } else {
        r1.innerText  = usdFmt.format(saleUSD);
        r1.className  = 'c-sim-result-row__val font-bold text-sm text-indigo-400 block';
        r1c.innerText = crossOf(saleUSD);
        r2.innerText  = usdFmt.format(gan);
        r2.className  = 'c-sim-result-row__val font-bold text-sm text-emerald-400 block';
    }

    // Precio de venta (USD + bolívares)
    if (precioUsd) precioUsd.innerText = usdFmt.format(saleUSD);
    if (precioBcv) precioBcv.innerText = crossOf(saleUSD);

    // Equivalente unitario (source calc + por caja)
    if (simSource === 'calc' && simType === 'caja' && gUnidadesPorCaja > 0) {
        rowU.style.display = 'flex';
        const eu = saleUSD / gUnidadesPorCaja;
        document.getElementById('sim-unit-val').innerText   = usdFmt.format(eu);
        document.getElementById('sim-unit-cross').innerText = crossOf(eu);
    } else if (rowU) { rowU.style.display = 'none'; }

    // Margen sobre el precio de venta (distinto del ROI que es sobre el costo)
    const margenVenta = saleUSD > 0 ? (gan / saleUSD) * 100 : 0;
    if (margenEl) {
        margenEl.innerText = margenVenta.toFixed(2) + '%';
        margenEl.className = `c-sim-result-row__val font-bold text-sm ${margenVenta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }

    // Ganancia total proyectada (precio × cantidad de la fuente)
    const count = simTotalCount();
    const gananciaTotal = gan * count;
    if (rowTotal && totalEl) {
        if (count > 1) {
            rowTotal.style.display = 'flex';
            totalEl.innerText = (gananciaTotal >= 0 ? '+' : '') + usdFmt.format(gananciaTotal);
            totalEl.className = `c-sim-result-row__val font-bold text-sm ${gananciaTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'} block`;
            if (totalBcv) totalBcv.innerText = crossOf(gananciaTotal);
            if (totalBasis) totalBasis.innerText = '× ' + count.toLocaleString('es-VE') + (simType === 'unidad' ? ' un.' : ' cajas');
        } else {
            rowTotal.style.display = 'none';
        }
    }

    // Unidades a vender para recuperar la inversión
    const inv = Number(lastImportQuote?.inversionTotalUSD);
    let gananciaPorUnidad = 0;
    if (simType === 'unidad') gananciaPorUnidad = saleUSD - gCostoUnitario;
    else if (gUnidadesPorCaja > 0) gananciaPorUnidad = (saleUSD - gCostoCaja) / gUnidadesPorCaja;
    if (rowRec) {
        if (simSource === 'calc' && Number.isFinite(inv) && inv > 0 && gananciaPorUnidad > 0) {
            const u = Math.ceil(inv / gananciaPorUnidad);
            rowRec.style.display = 'flex';
            recEl.innerText = u.toLocaleString('es-VE') + ' un.';
        } else {
            rowRec.style.display = 'none';
        }
    }

    // Guarda el plan de venta actual para poder persistirlo junto a la cotización
    lastSimPlan = {
        modo: simMode, tipo: simType, fuente: simSource,
        ventaUnitarioUSD: simType === 'unidad' ? saleUSD : (gUnidadesPorCaja > 0 ? saleUSD / gUnidadesPorCaja : saleUSD),
        ventaPorCajaUSD:  simType === 'caja'   ? saleUSD : (gUnidadesPorCaja > 0 ? saleUSD * gUnidadesPorCaja : saleUSD),
        gananciaUnitariaUSD: gananciaPorUnidad,
        gananciaTotalUSD: gananciaTotal,
        roiPct: roi,
        margenVentaPct: margenVenta,
    };

    drawSimSparkline(cb, simTotalCount(), saleUSD);
}

/** Aplica un margen sobre el costo base: precio = costo × (1 + margen/100). */
function aplicarMargenRapido(margenPct) {
    let cb = 0;
    if (simSource === 'manual') cb = parseLocaleAmount(document.getElementById('sim-costo-manual').value);
    else cb = simType === 'unidad' ? gCostoUnitario : gCostoCaja;
    if (!(cb > 0)) { showToast('Primero calcula o ingresa un costo base.', 'warning'); return; }
    if (simMode !== 'precio') setSimMode('precio');
    const precio = cb * (1 + margenPct / 100);
    const input = document.getElementById('sim-input');
    if (input) input.value = precio.toFixed(2);
    setActiveMargenChip(margenPct);
    calcGanancia();
}

// ═══════════════════════════════════════════════
// IMPORT QUOTES
// ═══════════════════════════════════════════════
function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
const usd = (n) => (typeof n === 'number' && Number.isFinite(n)) ? usdFmt.format(n) : '$0.00';
const n2  = (n) => (typeof n === 'number' && Number.isFinite(n)) ? n.toFixed(2) : '0.00';
const n3  = (n) => (typeof n === 'number' && Number.isFinite(n)) ? n.toFixed(3) : '0.000';

function empresaNombrePorTarifaUSD(tarifa) {
    const t = Number(tarifa);
    if (t === 770)  return 'GCCARGO';
    if (t === 865)  return 'Orinoco';
    if (t === 1030) return 'import2ven';
    return 'Personalizado';
}

function extractNombreBase(fullName) {
    const s = (fullName || '').toString().trim();
    const parts = s.split(' - ');
    return parts.length >= 2 ? parts.slice(0, parts.length - 1).join(' - ') : s;
}

function normalizeProductoLink(raw) {
    const s = (raw ?? '').toString().trim();
    if (!s) return null;
    let url = s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
        if (!/^https?:\/\//i.test(url)) return null;
    } else {
        url = `https://${url}`;
    }
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return u.href;
    } catch (_) {
        return null;
    }
}

function applyProductoLinkToQuote(quote, link) {
    const q = { ...quote };
    if (link) q.productoLink = link;
    else delete q.productoLink;
    return q;
}

const PLAN_FIELDS = ['ventaUnitarioUSD', 'ventaPorCajaUSD', 'gananciaUnitariaUSD', 'gananciaTotalUSD', 'roiVentaPct', 'margenVentaPct'];

/** Calcula la proyección de venta de forma determinista desde los costos de la cotización. */
function buildSalePlanForQuote(quote, salePriceUnitUSD) {
    const venta = Number(salePriceUnitUSD);
    if (!Number.isFinite(venta) || venta <= 0) return null;
    const costoUnit = Number(quote?.costoUnitarioUSD) || 0;
    const unidadesTotales = Number(quote?.unidadesTotales) || 1;
    const unidadesPorCaja = Number(quote?.unidadesPorCaja) || 0;
    const gananciaUnit = venta - costoUnit;
    return {
        ventaUnitarioUSD: venta,
        ventaPorCajaUSD: unidadesPorCaja > 0 ? venta * unidadesPorCaja : venta,
        gananciaUnitariaUSD: gananciaUnit,
        gananciaTotalUSD: gananciaUnit * unidadesTotales,
        roiVentaPct: costoUnit > 0 ? (gananciaUnit / costoUnit) * 100 : 0,
        margenVentaPct: venta > 0 ? (gananciaUnit / venta) * 100 : 0,
    };
}

/** Adjunta (o elimina) los campos del plan de venta en la cotización. */
function applySalePlanToQuote(quote, plan) {
    const q = { ...quote };
    PLAN_FIELDS.forEach(k => delete q[k]);
    if (plan) PLAN_FIELDS.forEach(k => { if (Number.isFinite(Number(plan[k]))) q[k] = Number(plan[k]); });
    return q;
}

/** Recalcula el plan sobre nuevos costos preservando el precio de venta por unidad. */
function reprojectSalePlan(quote) {
    const venta = Number(quote?.ventaUnitarioUSD);
    if (!Number.isFinite(venta) || venta <= 0) return quote;
    return applySalePlanToQuote(quote, buildSalePlanForQuote(quote, venta));
}

function readProductoLinkInput(inputId, { required = false } = {}) {
    const el = document.getElementById(inputId);
    const raw = (el?.value ?? '').toString().trim();
    if (!raw) return required ? false : null;
    const link = normalizeProductoLink(raw);
    if (!link) {
        showToast('El link del producto no es válido. Usa una URL como https://ejemplo.com/producto', 'error');
        return false;
    }
    return link;
}

function productoLinkDetailRowHtml(productoLink) {
    const safe = normalizeProductoLink(productoLink);
    if (!safe) return '';
    const href = escapeHtml(safe);
    const label = escapeHtml(safe.replace(/^https?:\/\//i, ''));
    return `<div class="c-quote-detail__row c-quote-detail__row--link"><span>Producto</span><strong><a href="${href}" target="_blank" rel="noopener noreferrer" class="c-producto-link">${label}</a></strong></div>`;
}

function renderProductoLinkDetalle(productoLink) {
    const row = document.getElementById('import-row-producto-link');
    const anchor = document.getElementById('import-q-producto-link');
    if (!row || !anchor) return;
    const safe = normalizeProductoLink(productoLink);
    if (!safe) {
        row.classList.add('hidden');
        anchor.removeAttribute('href');
        anchor.textContent = '-';
        return;
    }
    row.classList.remove('hidden');
    anchor.href = safe;
    anchor.textContent = safe.replace(/^https?:\/\//i, '');
}

async function cargarCotizacionesImport() {
    const listEl  = document.getElementById('import-quotes-list');
    const countEl = document.getElementById('import-quotes-count');
    const selEl   = document.getElementById('import-quotes-company-filter');
    if (!listEl) return;
    if (!currentUser) {
        importQuotesAll = [];
        if (countEl) countEl.innerText = '0';
        if (selEl) selEl.innerHTML = '<option value="ALL">Todas</option>';
        listEl.innerHTML = '<p class="c-import-quote-msg"><a href="/login">Inicia sesión</a> para ver y guardar tus cotizaciones.</p>';
        return;
    }
    try {
        const r = await authFetch('/api/import-quotes');
        if (r.status === 401) return;
        const j = await r.json();
        importQuotesAll = (j && j.quotes) ? j.quotes : [];

        if (selEl) {
            const seen = new Set();
            const empresas = [];
            importQuotesAll.forEach(q => {
                const emp = q.empresaNombre || 'Sin empresa';
                if (!seen.has(emp)) { seen.add(emp); empresas.push(emp); }
            });
            selEl.innerHTML = '<option value="ALL">Todas</option>' +
                empresas.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
        }
        if (countEl) countEl.innerText = importQuotesAll.length;
        renderImportQuotesList();
    } catch (e) {
        console.error(e);
        if (listEl) listEl.innerHTML = '<p class="c-import-quote-msg c-import-quote-msg--error">Error cargando cotizaciones.</p>';
    }
}

function computeImportQuoteDetailLabels(q) {
    if (!q) return null;
    const dims = q.dimensionesCm || {};
    const l = Number(dims.l), w = Number(dims.w), h = Number(dims.h);
    const dimsTxt = [l, w, h].every(Number.isFinite) ? `${Math.round(l)}×${Math.round(w)}×${Math.round(h)} cm` : '-';
    const unitsTxt = Number.isFinite(Number(q.unidadesTotales))
        ? `${Math.round(q.unidadesTotales)} un.` + (q.unidadesPorCaja ? ` (${Math.round(q.unidadesPorCaja)}/caja)` : '')
        : '-';
    const showEnvioChina = typeof q.envioChinaUSD === 'number' && q.envioChinaUSD > 0;
    const platPct  = Number.isFinite(Number(q.feePlataforma)) ? (Number(q.feePlataforma) * 100) : (feePlataforma * 100);
    const bancoPct = Number.isFinite(Number(q.feeBanco))      ? (Number(q.feeBanco) * 100)      : (feeBanco * 100);
    const subtotalUSD = typeof q.subtotalUSD === 'number'
        ? q.subtotalUSD
        : (Number(q.costoMercanciaUSD) || 0) + (Number(q.envioChinaUSD) || 0)
            + (Number(q.plataformaUSD) || 0) + (Number(q.comisionBancoUSD) || 0);

    // Precio inicial de compra (mercancía por unidad, sin costos de envío ni comisiones)
    const precioInicialUSD = Number(q.precioMercanciaPorUnidadUSD) || 0;
    const precioInicialCNY = precioInicialUSD > 0 ? precioInicialUSD * tasaSegura : 0;
    const br   = d.bcv || 0;
    const binr = d.binance_compra || d.binance || 0;
    const precioInicialBCVusd = (precioInicialUSD > 0 && br > 0 && binr > 0)
        ? (precioInicialUSD * binr) / br
        : null;

    // Plan de venta guardado (proyección de ganancia)
    const tbd = (u) => (br > 0 && binr > 0) ? (u * binr) / br : 0;
    const ventaUnitUSD   = Number(q.ventaUnitarioUSD) || 0;
    const costoUnitNum   = Number(q.costoUnitarioUSD) || 0;
    const unidadesTot    = Number(q.unidadesTotales) || 1;
    const showPlan       = ventaUnitUSD > 0;
    const ganUnitNum     = Number.isFinite(Number(q.gananciaUnitariaUSD)) ? Number(q.gananciaUnitariaUSD) : (ventaUnitUSD - costoUnitNum);
    const ganTotalNum    = Number.isFinite(Number(q.gananciaTotalUSD)) ? Number(q.gananciaTotalUSD) : (ganUnitNum * unidadesTot);
    const roiVentaNum    = Number.isFinite(Number(q.roiVentaPct)) ? Number(q.roiVentaPct) : (costoUnitNum > 0 ? (ganUnitNum / costoUnitNum) * 100 : 0);
    const margenVentaNum = Number.isFinite(Number(q.margenVentaPct)) ? Number(q.margenVentaPct) : (ventaUnitUSD > 0 ? (ganUnitNum / ventaUnitUSD) * 100 : 0);

    return {
        showPlan,
        ganTotalPositive: ganTotalNum >= 0,
        ventaUnitUSD: usdFmt.format(ventaUnitUSD),
        ventaUnitBCV: (ventaUnitUSD > 0 && br > 0 && binr > 0) ? usdFmt.format(tbd(ventaUnitUSD)) + ' (BCV)' : '-- (BCV)',
        ganUnitUSD: (ganUnitNum >= 0 ? '+' : '') + usdFmt.format(ganUnitNum),
        ganTotalUSD: (ganTotalNum >= 0 ? '+' : '') + usdFmt.format(ganTotalNum),
        ganTotalSub: 'ROI ' + roiVentaNum.toFixed(2) + '% · ' + Math.round(unidadesTot).toLocaleString('es-VE') + ' un.',
        margenTxt: margenVentaNum.toFixed(2) + '% margen',
        dimsTxt,
        unitsTxt,
        costoUnidad: usd(q.costoUnitarioUSD),
        vol: `${n3(q.volumenM3)} m³${q.cajas > 1 ? ` (${q.cajas} c.)` : ''}`,
        peso: `${n2(q.pesoKg)} kg`,
        tipo: q.tipoCobro || '-',
        merc: usd(q.costoMercanciaUSD),
        showEnvioChina,
        envioChina: '+' + usd(q.envioChinaUSD),
        platPct: platPct.toFixed(2),
        bancoPct: bancoPct.toFixed(2),
        plat: '+' + usd(q.plataformaUSD),
        banco: '+' + usd(q.comisionBancoUSD),
        subtotal: usd(subtotalUSD),
        flete: '+' + usd(q.envioInternacionalUSD),
        total: usd(q.inversionTotalUSD),
        unitario: formatCostoUnitarioCurrencies(q.costoUnitarioUSD),
        caja: usd(q.costoPorCajaUSD),
        // Precio inicial de compra por unidad
        showPrecioInicial: precioInicialUSD > 0,
        precioInicialUSD: usdFmt.format(precioInicialUSD),
        precioInicialCNY: precioInicialCNY > 0 ? '¥' + moneyFmt.format(precioInicialCNY) : '¥0.00',
        precioInicialBCV: precioInicialBCVusd != null
            ? usdFmt.format(precioInicialBCVusd) + ' (BCV)'
            : '-- (BCV)',
    };
}

function ensureImportQuoteDetailPanelAnchor() {
    const panel = document.getElementById('import-quotes-detail');
    if (!panel || importQuoteDetailPanelAnchor) return;
    importQuoteDetailPanelAnchor = document.createComment('import-quotes-detail-anchor');
    panel.parentNode.insertBefore(importQuoteDetailPanelAnchor, panel);
}

function restoreImportQuoteDetailPanelPosition() {
    const panel = document.getElementById('import-quotes-detail');
    if (!panel || !importQuoteDetailPanelAnchor?.parentNode) return;
    importQuoteDetailPanelAnchor.parentNode.insertBefore(panel, importQuoteDetailPanelAnchor.nextSibling);
}

function placeImportQuoteDetailPanelNearQuote(id) {
    ensureImportQuoteDetailPanelAnchor();
    const sid = String(id || '');
    if (!sid) return;
    const item = document.querySelector(`.c-quote-card[data-quote-id="${CSS.escape(sid)}"]`);
    const panel = document.getElementById('import-quotes-detail');
    if (!item || !panel) return;
    item.insertAdjacentElement('afterend', panel);
}

function scrollImportQuoteDetailPanelIntoView() {
    const panel = document.getElementById('import-quotes-detail');
    if (!panel || panel.classList.contains('hidden')) return;
    requestAnimationFrame(() => {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
}

async function abrirPanelEdicionCotizacionImport(id) {
    const sid = String(id || '');
    if (!sid) return;
    await verCotizacionImport(sid);
    placeImportQuoteDetailPanelNearQuote(sid);
    editarCotizacionImport();
    scrollImportQuoteDetailPanelIntoView();
}

function renderImportQuotesList() {
    const listEl  = document.getElementById('import-quotes-list');
    const countEl = document.getElementById('import-quotes-count');
    const selEl   = document.getElementById('import-quotes-company-filter');
    if (!listEl) return;

    const sortEl   = document.getElementById('import-quotes-sort');
    const searchEl = document.getElementById('import-quotes-search');
    const filter = selEl ? selEl.value : 'ALL';
    const sortBy = sortEl ? sortEl.value : 'recent';
    const search = (searchEl?.value || '').trim().toLowerCase();

    let quotes = importQuotesAll.slice();
    if (filter && filter !== 'ALL') quotes = quotes.filter(q => (q.empresaNombre || 'Sin empresa') === filter);
    if (search) quotes = quotes.filter(q => (q.name || '').toLowerCase().includes(search));

    quotes.sort((a, b) => {
        if (sortBy === 'inversion') return (Number(b.inversionTotalUSD) || 0) - (Number(a.inversionTotalUSD) || 0);
        if (sortBy === 'empresa')   return (a.empresaNombre || '').localeCompare(b.empresaNombre || '');
        if (sortBy === 'nombre')    return (a.name || '').localeCompare(b.name || '');
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); // recent
    });

    if (countEl) countEl.innerText = quotes.length;
    if (!quotes.length) {
        listEl.innerHTML = search
            ? `<p class="c-import-quote-msg">Sin resultados para “${escapeHtml(search)}”.</p>`
            : '<p class="c-import-quote-msg">Sin cotizaciones.</p>';
        return;
    }

    listEl.innerHTML = quotes.map(buildImportQuoteCardHTML).join('');
    updateAuthUI();
}

/**
 * Tarjeta informativa de cotización (sin clic para expandir).
 * Orden: precio/costo unitario (arriba) → KPIs → desglose → totales →
 * link del producto → proyección de venta → acciones.
 */
function buildImportQuoteCardHTML(item) {
    const q = (item && item.quote) ? item.quote : {};
    const idAttr = escapeHtml(item?.id ?? '');
    const idJson = JSON.stringify(String(item?.id ?? ''));
    const name = escapeHtml(item?.name || 'Sin nombre');
    const emp  = escapeHtml(item?.empresaNombre || q.empresaNombre || 'Sin empresa');
    const fecha = item?.createdAt
        ? escapeHtml(new Date(item.createdAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: '2-digit' }))
        : '';

    const lbl = computeImportQuoteDetailLabels(q);
    if (!lbl) {
        return `<div class="c-quote-card" data-quote-id="${idAttr}">
          <div class="c-quote-card__head"><div class="c-quote-card__titlewrap"><h4 class="c-quote-card__name">${name}</h4></div></div>
          <p class="c-import-quote-msg">Sin datos para esta cotización.</p>
          <div class="c-quote-card__actions">
            <button type="button" class="c-quote-card__btn c-quote-card__btn--del c-auth-only" onclick='eliminarCotizacionImport(${idJson})'><i class="fas fa-trash"></i> Eliminar</button>
          </div>
        </div>`;
    }

    const profitBadge = lbl.showPlan
        ? `<span class="c-quote-card__profit ${lbl.ganTotalPositive ? 'c-quote-card__profit--up' : 'c-quote-card__profit--down'}"><i class="fas fa-arrow-trend-up" aria-hidden="true"></i> ${lbl.ganTotalUSD}</span>`
        : '';

    const precioCompraAside = lbl.showPrecioInicial
        ? `<div class="c-quote-hero__aside">
             <span class="c-quote-hero__aside-label">Precio compra / un.</span>
             <span class="c-quote-hero__aside-val">${lbl.precioInicialUSD}</span>
             <span class="c-quote-hero__aside-sub">${lbl.precioInicialBCV} · ${lbl.precioInicialCNY}</span>
           </div>`
        : '';

    const envioRow = lbl.showEnvioChina
        ? `<div class="c-quote-line"><span class="c-quote-line__label">Envío China</span><span class="c-quote-line__val c-quote-line__val--amber">${lbl.envioChina}</span></div>`
        : '';

    let linkRow = '';
    const safeLink = normalizeProductoLink(q.productoLink);
    if (safeLink) {
        const href = escapeHtml(safeLink);
        const label = escapeHtml(safeLink.replace(/^https?:\/\//i, ''));
        linkRow = `<a class="c-quote-card__link" href="${href}" target="_blank" rel="noopener noreferrer"><i class="fas fa-link" aria-hidden="true"></i><span>${label}</span></a>`;
    }

    const planBlock = lbl.showPlan
        ? `<div class="c-quote-plan">
             <div class="c-quote-plan__head"><i class="fas fa-arrow-trend-up" aria-hidden="true"></i><span>Proyección de venta</span></div>
             <div class="c-quote-plan__grid">
               <div class="c-quote-plan__cell">
                 <span class="c-quote-plan__label">Precio venta/un.</span>
                 <strong class="c-quote-plan__val">${lbl.ventaUnitUSD}</strong>
                 <span class="c-quote-plan__sub">${lbl.ventaUnitBCV}</span>
               </div>
               <div class="c-quote-plan__cell">
                 <span class="c-quote-plan__label">Ganancia/un.</span>
                 <strong class="c-quote-plan__val ${lbl.ganTotalPositive ? 'c-quote-plan__val--green' : 'c-quote-plan__val--red'}">${lbl.ganUnitUSD}</strong>
                 <span class="c-quote-plan__sub">${lbl.margenTxt}</span>
               </div>
               <div class="c-quote-plan__cell c-quote-plan__cell--wide">
                 <span class="c-quote-plan__label">Ganancia total proyectada</span>
                 <strong class="c-quote-plan__val ${lbl.ganTotalPositive ? 'c-quote-plan__val--green' : 'c-quote-plan__val--red'}">${lbl.ganTotalUSD}</strong>
                 <span class="c-quote-plan__sub">${escapeHtml(lbl.ganTotalSub)}</span>
               </div>
             </div>
           </div>`
        : '';

    return `
    <div class="c-quote-card" data-quote-id="${idAttr}">
      <div class="c-quote-card__head">
        <div class="c-quote-card__titlewrap">
          <h4 class="c-quote-card__name">${name}</h4>
          <div class="c-quote-card__tags">
            <span class="c-quote-card__badge">${emp}</span>
            ${fecha ? `<span class="c-quote-card__date"><i class="fas fa-clock" aria-hidden="true"></i> ${fecha}</span>` : ''}
          </div>
        </div>
        ${profitBadge}
      </div>

      <div class="c-quote-hero">
        <div class="c-quote-hero__main">
          <span class="c-quote-hero__label">Costo final por unidad</span>
          <span class="c-quote-hero__usd">${lbl.unitario.usd}</span>
          <span class="c-quote-hero__cross">${lbl.unitario.bcv} · ${lbl.unitario.cny}</span>
        </div>
        ${precioCompraAside}
      </div>

      <div class="c-quote-kpis">
        <div class="c-quote-kpi"><span class="c-quote-kpi__label">Dimensiones</span><span class="c-quote-kpi__val">${lbl.dimsTxt}</span></div>
        <div class="c-quote-kpi"><span class="c-quote-kpi__label">Unidades</span><span class="c-quote-kpi__val">${lbl.unitsTxt}</span></div>
        <div class="c-quote-kpi"><span class="c-quote-kpi__label">Volumen</span><span class="c-quote-kpi__val">${lbl.vol}</span></div>
        <div class="c-quote-kpi"><span class="c-quote-kpi__label">Peso</span><span class="c-quote-kpi__val">${lbl.peso}</span></div>
        <div class="c-quote-kpi"><span class="c-quote-kpi__label">Costo por caja</span><span class="c-quote-kpi__val">${lbl.caja}</span></div>
        <div class="c-quote-kpi"><span class="c-quote-kpi__label">Tipo cobro</span><span class="c-quote-kpi__val">${escapeHtml(lbl.tipo)}</span></div>
      </div>

      <div class="c-quote-card__section">
        <div class="c-quote-card__section-title"><i class="fas fa-receipt" aria-hidden="true"></i> Desglose de la cotización</div>
        <div class="c-quote-line"><span class="c-quote-line__label">Mercancía</span><span class="c-quote-line__val">${lbl.merc}</span></div>
        ${envioRow}
        <div class="c-quote-line c-quote-line--sub"><span class="c-quote-line__label">Plataforma (${lbl.platPct}%)</span><span class="c-quote-line__val c-quote-line__val--red">${lbl.plat}</span></div>
        <div class="c-quote-line c-quote-line--sub"><span class="c-quote-line__label">Banco (${lbl.bancoPct}%)</span><span class="c-quote-line__val c-quote-line__val--red">${lbl.banco}</span></div>
        <div class="c-quote-line c-quote-line--subtotal"><span class="c-quote-line__label">Subtotal</span><span class="c-quote-line__val">${lbl.subtotal}</span></div>
        <div class="c-quote-line"><span class="c-quote-line__label">Envío internacional</span><span class="c-quote-line__val c-quote-line__val--purple">${lbl.flete}</span></div>
      </div>

      <div class="c-quote-totals">
        <span class="c-quote-totals__label">Inversión total</span>
        <span class="c-quote-totals__val">${lbl.total}</span>
      </div>

      ${linkRow}
      ${planBlock}

      <div class="c-quote-card__actions">
        <button type="button" class="c-quote-card__btn c-quote-card__btn--edit c-auth-only" onclick='abrirPanelEdicionCotizacionImport(${idJson})'><i class="fas fa-pen"></i> Editar</button>
        <button type="button" class="c-quote-card__btn c-quote-card__btn--img" onclick='exportQuoteImage(${idJson})'><i class="fas fa-image"></i> Imagen</button>
        <button type="button" class="c-quote-card__btn c-quote-card__btn--del c-auth-only" onclick='eliminarCotizacionImport(${idJson})'><i class="fas fa-trash"></i> Eliminar</button>
      </div>
    </div>`;
}

async function guardarCotizacionImport() {
    if (!currentUser) { redirectToLogin(); return; }
    const nameEl   = document.getElementById('import-quote-name');
    const linkEl   = document.getElementById('import-quote-product-link');
    const nameBase = (nameEl?.value || '').trim();
    if (!nameBase) { showToast('Ingresa un nombre para la cotización.', 'warning'); nameEl?.focus(); return; }
    if (!lastImportQuote) { showToast('Primero calcula una cotización válida.', 'warning'); return; }
    const productoLink = readProductoLinkInput('import-quote-product-link');
    if (productoLink === false) return;
    try {
        const empresa  = lastImportQuote.empresaNombre || empresaNombrePorTarifaUSD(lastImportQuote.empresaTarifaUSD);
        const fullName = nameBase.toLowerCase().includes(empresa.toLowerCase()) ? nameBase : `${nameBase} - ${empresa}`;
        let quoteToSave = applyProductoLinkToQuote(lastImportQuote, productoLink);
        // Plan de venta: usa el precio indicado o, si está vacío, el del simulador.
        const salePriceEl = document.getElementById('import-quote-sale-price');
        let salePriceUnit = parseLocaleAmount(salePriceEl?.value);
        if (!(salePriceUnit > 0) && lastSimPlan && Number(lastSimPlan.ventaUnitarioUSD) > 0) {
            salePriceUnit = Number(lastSimPlan.ventaUnitarioUSD);
        }
        quoteToSave = applySalePlanToQuote(quoteToSave, buildSalePlanForQuote(quoteToSave, salePriceUnit));
        const r = await authFetch('/api/import-quotes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: fullName, quote: quoteToSave })
        });
        if (r.status === 401) return;
        const j = await r.json();
        if (!r.ok || !j.success) { showToast(j?.message || 'Error al guardar.', 'error'); return; }
        if (nameEl) nameEl.value = '';
        if (linkEl) linkEl.value = '';
        if (salePriceEl) salePriceEl.value = '';
        if (j.id) importQuotesExpandedIds.add(String(j.id));
        await cargarCotizacionesImport();
        showToast('Cotización guardada', 'success');
    } catch (e) { console.error(e); showToast('Error guardando cotización.', 'error'); }
}

async function verCotizacionImport(id) {
    const el = document.getElementById('import-quotes-detail');
    if (!el) return;
    try {
        const r = await authFetch(`/api/import-quotes/${encodeURIComponent(id)}`);
        const j = await r.json();
        const record = j?.quote;
        if (!record) { showToast('Cotización no encontrada.', 'error'); return; }
        const q = record.quote || {};

        importCurrentQuote   = q;
        importCurrentQuoteId = String(id);
        importCurrentQuoteName = record.name || '';

        importQuoteDetailCache.set(String(id), record);

        document.getElementById('import-quote-detail-title').innerText = record.name || '-';
        document.getElementById('import-quote-detail-date').innerText  = record.createdAt ? new Date(record.createdAt).toLocaleString('es-VE') : '-';

        renderDetalleCotizacionImport(q, record.name);

        const editControls = document.getElementById('import-quote-edit-controls');
        if (editControls) editControls.classList.add('hidden');
        document.getElementById('import-btn-edit')?.classList.remove('hidden');
        document.getElementById('import-btn-delete')?.classList.remove('hidden');
        el.classList.remove('hidden');
    } catch (e) { console.error(e); showToast('Error cargando cotización.', 'error'); }
}

function renderDetalleCotizacionImport(q, title) {
    if (!q) return;
    if (title !== undefined && document.getElementById('import-quote-detail-title')) {
        document.getElementById('import-quote-detail-title').innerText = title || '-';
    }
    const lbl = computeImportQuoteDetailLabels(q);
    if (!lbl) return;

    document.getElementById('import-q-dims').innerText         = lbl.dimsTxt;
    document.getElementById('import-q-unidades').innerText     = lbl.unitsTxt;
    document.getElementById('import-q-costo-unidad').innerText = lbl.costoUnidad;
    renderProductoLinkDetalle(q.productoLink);
    document.getElementById('import-q-vol').innerText  = lbl.vol;
    document.getElementById('import-q-peso').innerText = lbl.peso;
    document.getElementById('import-q-tipo').innerText = lbl.tipo;
    document.getElementById('import-q-merc').innerText = lbl.merc;

    const rowCh = document.getElementById('import-row-envio-china');
    if (lbl.showEnvioChina) {
        rowCh.style.display = 'flex';
        document.getElementById('import-q-envio-china').innerText = lbl.envioChina;
    } else { rowCh.style.display = 'none'; }

    document.getElementById('import-q-plat-pct').innerText  = lbl.platPct;
    document.getElementById('import-q-banco-pct').innerText = lbl.bancoPct;
    document.getElementById('import-q-plat').innerText   = lbl.plat;
    document.getElementById('import-q-banco').innerText  = lbl.banco;
    document.getElementById('import-q-subtotal').innerText = lbl.subtotal;
    document.getElementById('import-q-flete').innerText  = lbl.flete;
    document.getElementById('import-q-total').innerText  = lbl.total;
    document.getElementById('import-q-unitario').innerText = lbl.unitario.usd;
    const qUnitBcv = document.getElementById('import-q-unitario-bcv');
    const qUnitCny = document.getElementById('import-q-unitario-cny');
    if (qUnitBcv) qUnitBcv.innerText = lbl.unitario.bcv;
    if (qUnitCny) qUnitCny.innerText = lbl.unitario.cny;
    document.getElementById('import-q-caja').innerText     = lbl.caja;

    // Precio inicial de compra por unidad
    const rowPrecioInicial = document.getElementById('import-row-precio-inicial');
    const elPrecioInicialUSD = document.getElementById('import-q-precio-inicial-usd');
    const elPrecioInicialBCV = document.getElementById('import-q-precio-inicial-bcv');
    const elPrecioInicialCNY = document.getElementById('import-q-precio-inicial-cny');
    if (rowPrecioInicial) rowPrecioInicial.style.display = lbl.showPrecioInicial ? '' : 'none';
    if (elPrecioInicialUSD) elPrecioInicialUSD.innerText = lbl.precioInicialUSD || '$0.00';
    if (elPrecioInicialBCV) elPrecioInicialBCV.innerText = lbl.precioInicialBCV || '-- (BCV)';
    if (elPrecioInicialCNY) elPrecioInicialCNY.innerText = lbl.precioInicialCNY || '¥0.00';

    // Proyección de venta (plan guardado)
    const rowPlan = document.getElementById('import-row-plan');
    if (rowPlan) {
        rowPlan.style.display = lbl.showPlan ? '' : 'none';
        if (lbl.showPlan) {
            const set = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
            set('import-q-venta-unit', lbl.ventaUnitUSD);
            set('import-q-venta-unit-bcv', lbl.ventaUnitBCV);
            set('import-q-gan-unit', lbl.ganUnitUSD);
            set('import-q-margen', lbl.margenTxt);
            set('import-q-gan-total', lbl.ganTotalUSD);
            set('import-q-gan-total-sub', lbl.ganTotalSub);
            const ganUnitEl = document.getElementById('import-q-gan-unit');
            const ganTotEl  = document.getElementById('import-q-gan-total');
            const cls = lbl.ganTotalPositive ? 'c-quote-plan__val c-quote-plan__val--green' : 'c-quote-plan__val c-quote-plan__val--red';
            if (ganUnitEl) ganUnitEl.className = cls;
            if (ganTotEl)  ganTotEl.className = cls;
        }
    }
}

function cerrarDetalleCotizacionImport() {
    document.getElementById('import-quotes-detail')?.classList.add('hidden');
    document.getElementById('import-quote-edit-controls')?.classList.add('hidden');
    document.getElementById('import-btn-edit')?.classList.remove('hidden');
    document.getElementById('import-btn-delete')?.classList.remove('hidden');
    restoreImportQuoteDetailPanelPosition();
    importCurrentQuoteId = null; importCurrentQuoteName = null; importCurrentQuote = null;
}

// ═══════════════════════════════════════════════
// reconstruirEntradaRawDesdeQuote — FIX #5
// Bug original: usaba variable `precio` no definida, debería ser `precioCNY`
// ═══════════════════════════════════════════════
function reconstruirEntradaRawDesdeQuote(q) {
    if (!q) return '';
    if (q.entradaRaw) return q.entradaRaw;

    const dims  = q.dimensionesCm || {};
    const l     = Number(dims.l), w = Number(dims.w), h = Number(dims.h);
    const peso  = Number(q.pesoPorCajaKg);
    const unidades = Number(q.unidadesPorCaja);
    const precioUSD = Number(q.precioMercanciaPorUnidadUSD || 0);
    const precioCNY = precioUSD * tasaSegura;  // ← FIX #5: was `precio` (undefined)
    const cajas = Number(q.cajas || 1);
    const envioChinaPorCaja = Number.isFinite(Number(q.envioChinaPorCajaUSD))
        ? Number(q.envioChinaPorCajaUSD)
        : (Number.isFinite(Number(q.envioChinaUSD)) && cajas > 0)
            ? Number(q.envioChinaUSD) / cajas : 0;

    // Validate all required values  ← FIX #5: was checking `precio` instead of `precioCNY`
    if (![l, w, h, peso, unidades, precioCNY].every(n => Number.isFinite(n) && !isNaN(n))) return '';

    const toStr = (x) => {
        if (!Number.isFinite(x)) return '0';
        return Number.isInteger(x) ? String(x) : x.toFixed(2).replace('.', ',');
    };

    let result = `${Math.round(l)}x${Math.round(w)}x${Math.round(h)} ${toStr(peso)} ${Math.round(unidades)} ${toStr(precioCNY)}`;
    if (envioChinaPorCaja > 0 || cajas > 1) result += ` ${toStr(envioChinaPorCaja)}`;
    if (cajas > 1) result += ` ${Math.round(cajas)}`;
    return result;
}

function computeImportQuoteFromRaw(entradaRaw, tarifaBaseUSD, empresaNombre) {
    if (!entradaRaw) return null;
    const clean = entradaRaw.replace(/[/\\*]/g, 'x').toLowerCase();
    const p = clean.split(/\s+/);
    if (p.length < 4) return null;
    const dims = p[0].split('x');
    if (dims.length !== 3) return null;
    const l = parseLocaleAmount(dims[0]), w = parseLocaleAmount(dims[1]), h = parseLocaleAmount(dims[2]);
    const pbc  = parseLocaleAmount(p[1]), ubc = parseInt(p[2], 10);
    const pu   = parseLocaleAmount(p[3]) / tasaSegura;
    const ecbc = p.length >= 5 ? parseLocaleAmount(p[4]) : 0;
    const nc   = p.length >= 6 ? parseInt(p[5], 10) : 1;
    if ([l,w,h,pbc,ubc,pu].some(n => isNaN(n))) return null;

    const tarBase = Number(tarifaBaseUSD) || 0;
    const envio = computeImportShipping(l, w, h, nc, pbc, tarBase);
    const vTot = envio.volumenM3;
    const pTot = envio.pesoKg;
    const cEnv = envio.fleteUSD;
    const tCob = envio.tipoCobro;

    const tU = ubc * nc, tM = tU * pu, tEC = ecbc * nc, bC = tM + tEC;
    const fP = bC * feePlataforma, fB = bC * feeBanco;
    const sT = tM + tEC + fP + fB;
    const iT = tM + tEC + fP + fB + cEnv;

    return {
        version: 1, entradaRaw, empresaNombre, empresaTarifaUSD: tarifaBaseUSD, empresaEnvioUSD: tarifaBaseUSD,
        cajas: nc, unidadesPorCaja: ubc, unidadesTotales: tU,
        dimensionesCm: { l, w, h }, pesoPorCajaKg: pbc, precioMercanciaPorUnidadUSD: pu, envioChinaPorCajaUSD: ecbc,
        volumenM3: vTot, volumenPorCajaM3: envio.volumenPorCajaM3, pesoKg: pTot, tipoCobro: tCob,
        costoMercanciaUSD: tM, envioChinaUSD: tEC, plataformaUSD: fP, comisionBancoUSD: fB,
        subtotalUSD: sT, envioInternacionalUSD: cEnv, fletePorCajaUSD: envio.fletePorCajaUSD,
        tarifaMinAplicada: envio.tarifaMinAplicada, inversionTotalUSD: iT,
        costoUnitarioUSD: iT / tU, costoPorCajaUSD: iT / nc,
        feePlataforma, feeBanco
    };
}

function editarCotizacionImport() {
    if (!importCurrentQuoteId || !importCurrentQuote) { showToast('Selecciona una cotización primero.', 'warning'); return; }

    const editControls = document.getElementById('import-quote-edit-controls');
    if (editControls) editControls.classList.remove('hidden');

    importEditBaseName = extractNombreBase(importCurrentQuoteName || '');
    const nameInput = document.getElementById('import-quote-edit-name');
    if (nameInput) nameInput.value = importEditBaseName;
    const linkInput = document.getElementById('import-quote-edit-product-link');
    if (linkInput) linkInput.value = importCurrentQuote.productoLink || '';
    const salePriceInput = document.getElementById('import-quote-edit-sale-price');
    if (salePriceInput) {
        const v = Number(importCurrentQuote.ventaUnitarioUSD);
        salePriceInput.value = Number.isFinite(v) && v > 0 ? String(v) : '';
    }

    const entrada = reconstruirEntradaRawDesdeQuote(importCurrentQuote);
    const entradaEl = document.getElementById('import-quote-edit-entrada');
    if (entradaEl) entradaEl.innerText = entrada || '-';

    const tarifaCurrent = Number(importCurrentQuote.empresaTarifaUSD ?? importCurrentQuote.empresaEnvioUSD);
    const compSel = document.getElementById('import-quote-edit-company');
    const custWrap = document.getElementById('import-quote-edit-custom-wrap');
    const custRate = document.getElementById('import-quote-edit-custom-rate');
    let selVal = 'custom';
    if ([770, 865, 1030].includes(tarifaCurrent)) selVal = String(Math.trunc(tarifaCurrent));
    if (compSel) compSel.value = selVal;
    if (custWrap) custWrap.classList.toggle('hidden', selVal !== 'custom');
    if (custRate && Number.isFinite(tarifaCurrent) && tarifaCurrent > 0) custRate.value = String(tarifaCurrent);

    // Inicializar importEditedQuote con la quote actual como fallback seguro,
    // de modo que si onEmpresaEdicionChange no puede recalcular (entradaRaw ausente),
    // actualizarCotizacionImport pueda guardar la quote original sin datos perdidos.
    importEditedQuote = { ...importCurrentQuote };
    importEditedCompanyTarifaUSD = tarifaCurrent;
    importEditedFullName = importCurrentQuoteName || '';

    onEmpresaEdicionChange();
    document.getElementById('import-btn-edit')?.classList.add('hidden');
    document.getElementById('import-btn-delete')?.classList.add('hidden');
    scrollImportQuoteDetailPanelIntoView();
}

function onEmpresaEdicionChange() {
    if (!importCurrentQuote) return;
    const compSel  = document.getElementById('import-quote-edit-company');
    const custWrap = document.getElementById('import-quote-edit-custom-wrap');
    const custRate = document.getElementById('import-quote-edit-custom-rate');
    const selected = compSel?.value || 'custom';
    let tarifaBaseUSD = 0, empresaNombre = 'Personalizado';
    if (selected === 'custom') {
        if (custWrap) custWrap.classList.remove('hidden');
        const v = parseFloat(custRate?.value || '0');
        tarifaBaseUSD = Number.isFinite(v) ? v : 0;
    } else {
        if (custWrap) custWrap.classList.add('hidden');
        tarifaBaseUSD = parseFloat(selected);
        empresaNombre = empresaNombrePorTarifaUSD(tarifaBaseUSD);
    }
    importEditedCompanyTarifaUSD = tarifaBaseUSD;
    importEditedFullName = importEditBaseName ? `${importEditBaseName} - ${empresaNombre}` : `Cotización - ${empresaNombre}`;

    const productoLink = resolveProductoLinkForEdit(importCurrentQuote);
    const salePrice = resolveEditSalePrice(importCurrentQuote);

    const entrada = reconstruirEntradaRawDesdeQuote(importCurrentQuote);
    if (entrada) {
        const recalculated = computeImportQuoteFromRaw(entrada, tarifaBaseUSD, empresaNombre);
        if (recalculated) {
            let edited = applyProductoLinkToQuote(recalculated, productoLink);
            edited = applySalePlanToQuote(edited, buildSalePlanForQuote(edited, salePrice));
            importEditedQuote = edited;
            renderDetalleCotizacionImport(importEditedQuote, importEditedFullName);
            return;
        }
    }
    // Si no se puede recalcular (entradaRaw ausente o datos incompletos),
    // usar la quote original con la empresa actualizada para que el guardado no falle.
    let edited = applyProductoLinkToQuote({
        ...importCurrentQuote,
        empresaNombre,
        empresaTarifaUSD: tarifaBaseUSD,
        empresaEnvioUSD: tarifaBaseUSD,
    }, productoLink);
    edited = applySalePlanToQuote(edited, buildSalePlanForQuote(edited, salePrice));
    importEditedQuote = edited;
    renderDetalleCotizacionImport(importEditedQuote, importEditedFullName);
}

/** Precio de venta para la edición: input si tiene valor, si no el ya guardado. */
function resolveEditSalePrice(fallbackQuote) {
    const el = document.getElementById('import-quote-edit-sale-price');
    const v = parseLocaleAmount(el?.value);
    if (Number.isFinite(v) && v > 0) return v;
    const prev = Number(fallbackQuote?.ventaUnitarioUSD);
    return Number.isFinite(prev) && prev > 0 ? prev : 0;
}

function resolveProductoLinkForEdit(fallbackQuote) {
    const el = document.getElementById('import-quote-edit-product-link');
    const raw = (el?.value ?? '').toString().trim();
    if (!raw) return null;
    const link = normalizeProductoLink(raw);
    return link || fallbackQuote?.productoLink || null;
}

function cancelarEdicionCotizacionImport() {
    document.getElementById('import-quote-edit-controls')?.classList.add('hidden');
    document.getElementById('import-btn-edit')?.classList.remove('hidden');
    document.getElementById('import-btn-delete')?.classList.remove('hidden');
    const id = importCurrentQuoteId;
    cerrarDetalleCotizacionImport();
    if (id) {
        importQuoteDetailCache.delete(String(id));
        renderImportQuotesList();
    }
}

async function actualizarCotizacionImport() {
    if (!importCurrentQuoteId) return;
    const nameInput = document.getElementById('import-quote-edit-name');
    const newBase = (nameInput?.value || '').trim();
    if (!newBase) { showToast('Ingresa el nombre base.', 'warning'); nameInput?.focus(); return; }
    if (!importEditedQuote) { showToast('Selecciona una empresa primero.', 'warning'); return; }
    const productoLink = readProductoLinkInput('import-quote-edit-product-link');
    if (productoLink === false) return;
    importEditBaseName = newBase;
    const fullName = `${newBase} - ${importEditedQuote.empresaNombre}`;
    importEditedFullName = fullName;
    const quoteToSave = applyProductoLinkToQuote(importEditedQuote, productoLink);
    try {
        const r = await authFetch(`/api/import-quotes/${encodeURIComponent(importCurrentQuoteId)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: fullName, quote: quoteToSave })
        });
        if (r.status === 401) return;
        const j = await r.json();
        if (!r.ok || !j.success) { showToast(j?.message || 'Error al actualizar.', 'error'); return; }
        importCurrentQuoteName = fullName;
        const updatedId = importCurrentQuoteId;
        importQuoteDetailCache.delete(String(updatedId));
        document.getElementById('import-quote-edit-controls')?.classList.add('hidden');
        document.getElementById('import-btn-edit')?.classList.remove('hidden');
        document.getElementById('import-btn-delete')?.classList.remove('hidden');
        cerrarDetalleCotizacionImport();
        await cargarCotizacionesImport();
        showToast('Cotización actualizada', 'success');
    } catch (e) { console.error(e); showToast('Error actualizando cotización.', 'error'); }
}

async function eliminarCotizacionImport(quoteId) {
    const id = quoteId != null && quoteId !== '' ? String(quoteId) : importCurrentQuoteId;
    if (!id) return;
    const ok = await showConfirm('¿Eliminar esta cotización? Esta acción no se puede deshacer.', {
        title: 'Eliminar cotización', confirmText: 'Eliminar', cancelText: 'Cancelar', danger: true,
    });
    if (!ok) return;
    try {
        const r = await authFetch(`/api/import-quotes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (r.status === 401) return;
        const j = await r.json();
        if (!r.ok || !j.success) { showToast(j?.message || 'Error al eliminar.', 'error'); return; }
        importQuotesExpandedIds.delete(id);
        importQuoteDetailCache.delete(id);
        cerrarDetalleCotizacionImport();
        await cargarCotizacionesImport();
        showToast('Cotización eliminada', 'success');
    } catch (e) { console.error(e); showToast('Error eliminando cotización.', 'error'); }
}

// ═══════════════════════════════════════════════
// COMPARTIR / EXPORTAR A IMAGEN (Canvas nativo)
// ═══════════════════════════════════════════════
function makeCanvas(wCss, hCss) {
    const scale = Math.max(Math.min(window.devicePixelRatio || 1, 2), 2); // mínimo 2x
    const c = document.createElement('canvas');
    c.width = Math.round(wCss * scale);
    c.height = Math.round(hCss * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.textBaseline = 'alphabetic';
    return { c, ctx };
}

async function ensureFonts() {
    try { if (document.fonts?.ready) await document.fonts.ready; } catch (_) { /* ignore */ }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawHr(ctx, x1, y, x2) {
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
}

function truncateCanvasText(ctx, text, maxW) {
    let t = String(text ?? '');
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
}

function paintCanvasBase(ctx, W, H) {
    ctx.fillStyle = '#0B0E11'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, 130);
    g.addColorStop(0, 'rgba(232,84,26,0.18)');
    g.addColorStop(1, 'rgba(232,84,26,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 130);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
}

function paintBrand(ctx, x, baseline) {
    ctx.fillStyle = '#E8541A';
    ctx.font = '900 34px "Playfair Display", Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText('DAYZO', x, baseline);
}

function paintMiniCard(ctx, x, y, w, label, value) {
    const h = 64;
    ctx.fillStyle = 'rgba(24,28,33,0.92)';
    roundRect(ctx, x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 10); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#848E9C';
    ctx.font = '600 11px "DM Sans", system-ui, sans-serif';
    ctx.fillText(String(label).toUpperCase(), x + 14, y + 24);
    ctx.fillStyle = '#EAECEF';
    ctx.font = '500 20px "DM Mono", monospace';
    ctx.fillText(String(value), x + 14, y + 50);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Imagen descargada', 'success');
}

function downloadOrShareCanvas(canvas, filename, shareTitle) {
    canvas.toBlob((blob) => {
        if (!blob) { showToast('No se pudo generar la imagen', 'error'); return; }
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: shareTitle })
                .catch((err) => { if (err && err.name !== 'AbortError') downloadBlob(blob, filename); });
        } else {
            downloadBlob(blob, filename);
        }
    }, 'image/png');
}

function buildQuoteCanvas(record) {
    const q = record.quote || {};
    const lbl = computeImportQuoteDetailLabels(q) || {};
    const W = 640, padX = 36;
    const rows = [];
    rows.push(['Empresa', q.empresaNombre || empresaNombrePorTarifaUSD(q.empresaTarifaUSD)]);
    rows.push(['Dimensiones', lbl.dimsTxt]);
    rows.push(['Unidades', lbl.unitsTxt]);
    rows.push(['Volumen', lbl.vol]);
    rows.push(['Tipo de cobro', lbl.tipo]);
    rows.push(['Mercancía', lbl.merc]);
    if (lbl.showEnvioChina) rows.push(['Envío China', lbl.envioChina]);
    const comis = (Number(q.plataformaUSD) || 0) + (Number(q.comisionBancoUSD) || 0);
    rows.push(['Comisiones', '+' + usd(comis)]);
    rows.push(['Envío internacional', lbl.flete]);

    const headerH = 116, titleH = 54, rowH = 38, totalH = 96, footerH = 110;
    const H = headerH + titleH + rows.length * rowH + totalH + footerH;
    const { c, ctx } = makeCanvas(W, H);
    paintCanvasBase(ctx, W, H);

    paintBrand(ctx, padX, 60);
    ctx.fillStyle = '#848E9C';
    ctx.font = '500 12px "DM Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('RESUMEN DE IMPORTACIÓN', padX, 86);
    const dateTxt = record.createdAt ? new Date(record.createdAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
    ctx.textAlign = 'right';
    ctx.fillText(dateTxt.toUpperCase(), W - padX, 86);

    let y = headerH;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#EAECEF';
    ctx.font = '700 22px "DM Sans", system-ui, sans-serif';
    ctx.fillText(truncateCanvasText(ctx, record.name || 'Cotización', W - padX * 2), padX, y + 24);
    y += titleH;
    drawHr(ctx, padX, y, W - padX);

    rows.forEach(([k, v]) => {
        ctx.fillStyle = '#848E9C';
        ctx.font = '400 15px "DM Sans", system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(k, padX, y + 26);
        ctx.fillStyle = '#EAECEF';
        ctx.font = '500 15px "DM Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(truncateCanvasText(ctx, String(v ?? '-'), W - padX * 2 - 160), W - padX, y + 26);
        y += rowH;
    });

    drawHr(ctx, padX, y + 8, W - padX);
    y += 8;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#EAECEF';
    ctx.font = '700 18px "DM Sans", system-ui, sans-serif';
    ctx.fillText('Inversión total', padX, y + 46);
    ctx.fillStyle = '#E8541A';
    ctx.font = '700 30px "DM Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(lbl.total || usd(q.inversionTotalUSD), W - padX, y + 48);
    y += totalH;

    const colW = (W - padX * 2 - 16) / 2;
    paintMiniCard(ctx, padX, y, colW, 'Costo por unidad', (lbl.unitario && lbl.unitario.usd) || usd(q.costoUnitarioUSD));
    paintMiniCard(ctx, padX + colW + 16, y, colW, 'Costo por caja', lbl.caja || usd(q.costoPorCajaUSD));

    ctx.textAlign = 'left';
    ctx.fillStyle = '#5A626E';
    ctx.font = '400 12px "DM Mono", monospace';
    ctx.fillText('dayzo · costos de importación', padX, H - 24);
    return c;
}

function buildRatesCanvas() {
    const W = 640, H = 472, padX = 40;
    const { c, ctx } = makeCanvas(W, H);
    paintCanvasBase(ctx, W, H);

    paintBrand(ctx, padX, 70);
    const now = new Date().toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' });
    ctx.fillStyle = '#848E9C'; ctx.font = '500 12px "DM Mono", monospace';
    ctx.textAlign = 'left';  ctx.fillText('TASAS EN TIEMPO REAL · VENEZUELA', padX, 98);
    ctx.textAlign = 'right'; ctx.fillText(now.toUpperCase(), W - padX, 70);

    drawHr(ctx, padX, 122, W - padX);

    const big = [
        ['Binance P2P · Comprar', moneyFmt.format(d.binance || 0) + ' Bs', '#0ECB81'],
        ['Binance P2P · Vender',  moneyFmt.format(d.binance_compra || 0) + ' Bs', '#F6465D'],
        ['BCV Oficial',           moneyFmt.format(d.bcv || 0) + ' Bs', '#3B82F6'],
    ];
    let y = 150;
    big.forEach(([label, value, color]) => {
        ctx.textAlign = 'left';
        ctx.fillStyle = '#848E9C'; ctx.font = '600 13px "DM Sans", system-ui, sans-serif';
        ctx.fillText(label.toUpperCase(), padX, y + 20);
        ctx.textAlign = 'right';
        ctx.fillStyle = color; ctx.font = '500 30px "DM Mono", monospace';
        ctx.fillText(value, W - padX, y + 24);
        y += 74;
    });

    drawHr(ctx, padX, y + 4, W - padX);
    y += 4;
    const brecha = (d.bcv > 0) ? ((d.binance - d.bcv) / d.bcv) * 100 : 0;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#EAECEF'; ctx.font = '700 18px "DM Sans", system-ui, sans-serif';
    ctx.fillText('Brecha P2P vs BCV', padX, y + 50);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#A78BFA'; ctx.font = '700 30px "DM Mono", monospace';
    ctx.fillText(moneyFmt.format(brecha) + '%', W - padX, y + 54);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#5A626E'; ctx.font = '400 12px "DM Mono", monospace';
    ctx.fillText('dayzo · calculadora de tasas', padX, H - 26);
    return c;
}

async function exportQuoteImage(id) {
    const sid = String(id || '');
    let record = importQuoteDetailCache.get(sid);
    if (!record) {
        try {
            const r = await authFetch(`/api/import-quotes/${encodeURIComponent(sid)}`);
            const j = await r.json();
            record = j?.quote;
            if (record) importQuoteDetailCache.set(sid, record);
        } catch (_) { /* ignore */ }
    }
    if (!record) { showToast('No se pudo cargar la cotización', 'error'); return; }
    await ensureFonts();
    const safe = (record.name || 'cotizacion').replace(/[^\w-]+/g, '_').slice(0, 40) || 'cotizacion';
    downloadOrShareCanvas(buildQuoteCanvas(record), `DAYZO_${safe}.png`, 'Cotización DAYZO');
}

async function shareRatesImage() {
    if (!(d.binance > 0) && !(d.bcv > 0)) { showToast('Aún no hay tasas para compartir.', 'warning'); return; }
    await ensureFonts();
    downloadOrShareCanvas(buildRatesCanvas(), 'DAYZO_tasas.png', 'Tasas DAYZO');
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
(async function init() {
    resetHorizontalScroll();
    window.addEventListener('resize', resetHorizontalScroll, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(resetHorizontalScroll, 150), { passive: true });

    await checkAuth();
    try { await refresh(); } catch (e) { console.error('Init refresh:', e); }
    try { await loadStats(); } catch (e) { console.error('Init stats:', e); }
    try { await cargarCotizacionesImport(); } catch (e) { console.error('Init quotes:', e); }
    resetHorizontalScroll();
    connectWS();
    // Refresca la variación de 24h periódicamente (ligero, una sola consulta)
    setInterval(loadStats, 60000);
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && chartInstance) {
            requestAnimationFrame(() => chartInstance.resize());
        }
    });
})();
