/* DAYZO Service Worker — offline básico
 * - Precachea el shell de la app (HTML/CSS/JS) → disponible offline.
 * - Network-first para el shell: siempre fresco si hay red, cache como respaldo.
 * - Network-first para tasas con respaldo a la última respuesta en cache (datos stale).
 * - El resto de /api/ pasa siempre a red (datos sensibles: auth, cotizaciones).
 */
const CACHE = 'dayzo-v4';
const SHELL = [
  '/calculadoraa',
  '/styles.css',
  '/tailwind.css',
  '/app.js',
  '/js/sale-calculations.js',
  '/css/auth.css',
  '/js/auth.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req, { fallbackToCache = true } = {}) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    if (fallbackToCache) {
      const cached = await cache.match(req);
      if (cached) return cached;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDNs/fuentes: directo a red

  // Tasas: network-first con respaldo a la última respuesta cacheada (stale).
  if (url.pathname === '/api/tasas-venezuela') {
    event.respondWith(networkFirst(req, { fallbackToCache: true }));
    return;
  }

  // Resto de la API: siempre red (sin cache stale de auth/cotizaciones/stats).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // Shell y estáticos: network-first (fresco si hay red, cache si no).
  event.respondWith(networkFirst(req, { fallbackToCache: true }));
});
