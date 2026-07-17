(function initUrlUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DayzoUrlUtils = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createUrlUtils() {
  'use strict';

  function normalizeHttpUrl(raw, maxLength = 2048) {
    const input = raw == null ? '' : String(raw).trim();
    if (!input) return null;
    if (/[\u0000-\u001f\u007f{}]/.test(input)) return null;
    let candidate = input;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      if (!/^https?:\/\//i.test(candidate)) return null;
    } else {
      candidate = `https://${candidate}`;
    }
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      if (!parsed.hostname || parsed.username || parsed.password) return null;
      return parsed.href.length <= maxLength ? parsed.href : null;
    } catch (_) {
      return null;
    }
  }

  return { normalizeHttpUrl };
}));
