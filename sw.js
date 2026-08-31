/* The Saint Lawrence Run - offline service worker */
const VERSION = 'slr-v8';
const SHELL   = `${VERSION}-shell`;
const FONTS   = `${VERSION}-fonts`;

const PRECACHE = [
  './',
  './index.html',
  './expenses.html',
  './firebase-config.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // addAll is atomic - one failure kills the install, so add individually
    await Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts (css + woff2): cache-first, opaque responses are fine
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith((async () => {
      const c = await caches.open(FONTS);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
        return res;
      } catch (_) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // Firebase and its SDK must always hit the network, never the cache
  if (/(^|\.)(firebaseio|firebasedatabase|googleapis|firebaseapp)\.com$/.test(url.hostname)
      || url.hostname === 'www.gstatic.com') return;

  if (url.origin !== self.location.origin) return;

  // Page + assets: stale-while-revalidate, so it opens instantly and
  // quietly refreshes in the background when there is signal.
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => {
      if (res && res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    if (req.mode === 'navigate') {
      const fallback = await c.match('./index.html');
      if (fallback) return fallback;
    }
    return Response.error();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
