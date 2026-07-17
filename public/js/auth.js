(function initAuthModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.DayzoAuth = api;
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.init, { once: true });
      else api.init();
    }
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAuthModule() {
  'use strict';

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const USER_RE = /^[a-zA-Z0-9._-]+$/;

  function apiErrorMessage(data, fallback) {
    if (typeof data?.error === 'string') return data.error;
    return data?.error?.message || data?.message || fallback;
  }

  function safeNextPath(raw, origin) {
    const fallback = '/calculadoraa';
    if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
      return fallback;
    }
    try {
      const baseOrigin = origin || 'http://localhost';
      const target = new URL(raw, baseOrigin);
      if (target.origin !== new URL(baseOrigin).origin) return fallback;
      return `${target.pathname}${target.search}${target.hash}`;
    } catch (_) {
      return fallback;
    }
  }

  function validatePassword(password) {
    const value = String(password || '');
    if (value.length < 8) return { valid: false, message: 'Usa al menos 8 caracteres.', score: 1 };
    if (!/[a-zA-Z]/.test(value)) return { valid: false, message: 'Incluye al menos una letra.', score: 1 };
    if (!/[0-9]/.test(value)) return { valid: false, message: 'Incluye al menos un número.', score: 1 };
    let score = 2;
    if (value.length >= 12) score += 1;
    if (/[A-Z]/.test(value) && /[^a-zA-Z0-9]/.test(value)) score += 1;
    return { valid: true, message: score >= 4 ? 'Contraseña fuerte.' : 'Contraseña aceptable.', score };
  }

  function init() {
    const $ = (id) => document.getElementById(id);
    const numberFormat = new Intl.NumberFormat('es-VE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    function switchTab(tab, { focus = true } = {}) {
      for (const name of ['login', 'register']) {
        const selected = name === tab;
        const button = $(`tab-${name}`);
        const panel = $(`form-${name}`);
        button?.classList.toggle('is-active', selected);
        button?.setAttribute('aria-selected', String(selected));
        if (panel) {
          panel.classList.toggle('is-visible', selected);
          panel.hidden = !selected;
        }
      }
      if (focus) {
        const target = tab === 'login' ? $('f-user') : $('r-name');
        requestAnimationFrame(() => target?.focus());
      }
    }

    $('tab-login')?.addEventListener('click', () => switchTab('login'));
    $('tab-register')?.addEventListener('click', () => switchTab('register'));
    document.querySelector('.auth-tabs')?.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const next = $('tab-login')?.getAttribute('aria-selected') === 'true' ? 'register' : 'login';
      switchTab(next);
      $(`tab-${next}`)?.focus();
    });

    function clearFieldError(inputId) {
      const input = $(inputId);
      const error = $(`${inputId}-err`);
      input?.removeAttribute('aria-invalid');
      if (error) error.textContent = '';
    }

    function fieldError(inputId, message) {
      const input = $(inputId);
      const error = $(`${inputId}-err`);
      input?.setAttribute('aria-invalid', 'true');
      if (error) error.textContent = message;
      input?.focus();
    }

    document.querySelectorAll('.auth-field input').forEach((input) => {
      input.addEventListener('input', () => clearFieldError(input.id));
    });

    function clearMessages(ids) {
      ids.forEach((id) => {
        const element = $(id);
        element?.classList.remove('is-visible');
        if (element) element.querySelector('span').textContent = '';
      });
    }

    function showMessage(boxId, textId, message, { focus = false } = {}) {
      const box = $(boxId);
      const text = $(textId);
      if (text) text.textContent = message;
      box?.classList.add('is-visible');
      if (focus) box?.focus();
    }

    function setLoading({ buttonId, spinnerId, textId, loading, loadingText, idleText }) {
      const button = $(buttonId);
      if (button) {
        button.disabled = loading;
        button.setAttribute('aria-busy', String(loading));
      }
      const spinner = $(spinnerId);
      if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
      const text = $(textId);
      if (text) text.textContent = loading ? loadingText : idleText;
    }

    document.querySelectorAll('[data-password-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = $(button.dataset.passwordToggle);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.textContent = show ? 'Ocultar' : 'Ver';
        button.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
      });
    });

    $('r-pass')?.addEventListener('input', (event) => {
      const result = validatePassword(event.target.value);
      const meter = $('pw-strength');
      const label = $('pw-label');
      if (!event.target.value) {
        if (meter) meter.hidden = true;
        if (label) label.textContent = 'Incluye letras y números.';
        return;
      }
      if (meter) {
        meter.hidden = false;
        meter.dataset.score = String(result.score);
      }
      if (label) label.textContent = result.message;
    });

    $('login-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessages(['login-msg-error', 'login-msg-warning']);
      const username = $('f-user')?.value.trim() || '';
      const password = $('f-pass')?.value || '';
      if (!username) return fieldError('f-user', 'Ingresa tu usuario o correo.');
      if (!password) return fieldError('f-pass', 'Ingresa tu contraseña.');

      setLoading({
        buttonId: 'btn-login', spinnerId: 'login-spinner', textId: 'login-btn-text',
        loading: true, loadingText: 'Verificando…', idleText: 'Entrar a DAYZO',
      });
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success) {
          $('btn-login')?.classList.add('is-success');
          $('login-btn-text').textContent = 'Acceso concedido';
          window.setTimeout(() => {
            const rawNext = new URLSearchParams(window.location.search).get('next') || '';
            window.location.replace(safeNextPath(rawNext, window.location.origin));
          }, 250);
          return;
        }
        const message = apiErrorMessage(data, 'Usuario o contraseña incorrectos.');
        if (response.status === 429) {
          showMessage('login-msg-warning', 'login-warn-txt', message, { focus: true });
        } else {
          showMessage('login-msg-error', 'login-err-txt', message, { focus: true });
        }
        if ($('f-pass')) $('f-pass').value = '';
      } catch (_) {
        showMessage('login-msg-error', 'login-err-txt', 'Sin conexión con DAYZO. Revisa tu red.', { focus: true });
      } finally {
        if (!$('btn-login')?.classList.contains('is-success')) {
          setLoading({
            buttonId: 'btn-login', spinnerId: 'login-spinner', textId: 'login-btn-text',
            loading: false, loadingText: '', idleText: 'Entrar a DAYZO',
          });
        }
      }
    });

    $('register-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessages(['reg-msg-error', 'reg-msg-success']);
      const fullName = $('r-name')?.value.trim() || '';
      const username = $('r-user')?.value.trim() || '';
      const email = $('r-email')?.value.trim().toLowerCase() || '';
      const password = $('r-pass')?.value || '';
      const confirmation = $('r-pass2')?.value || '';
      if (fullName.length < 2) return fieldError('r-name', 'Ingresa tu nombre completo.');
      if (username.length < 3 || !USER_RE.test(username) || EMAIL_RE.test(username)) {
        return fieldError('r-user', 'Usa 3–32 letras, números, puntos, guiones o guion bajo.');
      }
      if (!EMAIL_RE.test(email)) return fieldError('r-email', 'Ingresa un correo válido.');
      const passwordResult = validatePassword(password);
      if (!passwordResult.valid) return fieldError('r-pass', passwordResult.message);
      if (password !== confirmation) return fieldError('r-pass2', 'Las contraseñas no coinciden.');

      setLoading({
        buttonId: 'btn-reg', spinnerId: 'reg-spinner', textId: 'reg-btn-text',
        loading: true, loadingText: 'Creando cuenta…', idleText: 'Crear cuenta DAYZO',
      });
      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName, username, email, password }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success) {
          showMessage('reg-msg-success', 'reg-ok-txt', data.message || 'Cuenta creada. Ya puedes ingresar.', { focus: true });
          $('register-form')?.reset();
          if ($('pw-strength')) $('pw-strength').hidden = true;
          window.setTimeout(() => switchTab('login'), 800);
          return;
        }
        showMessage(
          'reg-msg-error',
          'reg-err-txt',
          apiErrorMessage(data, 'No se pudo crear la cuenta.'),
          { focus: true }
        );
      } catch (_) {
        showMessage('reg-msg-error', 'reg-err-txt', 'Sin conexión con DAYZO. Revisa tu red.', { focus: true });
      } finally {
        setLoading({
          buttonId: 'btn-reg', spinnerId: 'reg-spinner', textId: 'reg-btn-text',
          loading: false, loadingText: '', idleText: 'Crear cuenta DAYZO',
        });
      }
    });

    async function loadRateSummary() {
      try {
        const response = await fetch('/api/tasas-venezuela?limit=1');
        if (!response.ok) return;
        const data = await response.json();
        const rates = data.tasas || {};
        const summary = [
          rates.binance > 0 ? `P2P ${numberFormat.format(rates.binance)}` : null,
          rates.bcv > 0 ? `BCV ${numberFormat.format(rates.bcv)}` : null,
          Number.isFinite(data.diff_pct) ? `Brecha ${numberFormat.format(data.diff_pct)}%` : null,
        ].filter(Boolean).join(' · ');
        if ($('login-rates-summary')) $('login-rates-summary').textContent = summary || 'Tasas no disponibles';
      } catch (_) {
        if ($('login-rates-summary')) $('login-rates-summary').textContent = 'Sin conexión con tasas';
      }
    }

    switchTab(window.location.pathname === '/register' ? 'register' : 'login', { focus: false });
    window.setTimeout(() => (window.location.pathname === '/register' ? $('r-name') : $('f-user'))?.focus(), 80);
    loadRateSummary();
    window.setInterval(loadRateSummary, 60_000);
  }

  return {
    apiErrorMessage,
    init,
    safeNextPath,
    validatePassword,
  };
}));
