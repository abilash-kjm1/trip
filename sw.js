/* Settle - offline service worker */
const VERSION = 'settle-20260916001354';
const SHELL   = `${VERSION}-shell`;
const FONTS   = `${VERSION}-fonts`;
// The Firebase code: versioned files that never change, so they are kept
// across releases and let Settle start with no signal.
const LIBS    = 'settle-libs-v1';
const SDK = [
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js'
];

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
    // From the network, not the browser's own cache, or a new release could
    // install with last release's files.
    await Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    const libs = await caches.open(LIBS);
    await Promise.all(SDK.map(async (u) => {
      if (!(await libs.match(u, { ignoreVary: true }))) await libs.add(new Request(u, { mode: 'cors' })).catch(() => {});
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION) && k !== LIBS).map((k) => caches.delete(k)));
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

  // The Firebase code itself: kept once fetched, since its address names its
  // version and it never changes. Sign-in and the database still go live.
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith((async () => {
      const c = await caches.open(LIBS);
      const hit = await c.match(req.url, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) c.put(req.url, res.clone());
      return res;
    })());
    return;
  }

  // The QR code maker for UPI, pinned to one version: kept once fetched, the
  // same as the Firebase code, so a payment QR still draws with no signal.
  if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.startsWith('/ajax/libs/qrcode-generator/1.4.4/')) {
    e.respondWith((async () => {
      const c = await caches.open(LIBS);
      const hit = await c.match(req.url, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) c.put(req.url, res.clone());
      return res;
    })());
    return;
  }

  // Firebase sign-in and the database must always hit the network, never the cache
  if (/(^|\.)(firebaseio|firebasedatabase|googleapis|firebaseapp)\.com$/.test(url.hostname)
      || url.hostname === 'www.gstatic.com') return;

  if (url.origin !== self.location.origin) return;

  // Which release is live. Never from a cache, or nobody would ever hear
  // that there is a new one.
  if (url.pathname.endsWith('/version.json')) return;

  // The page itself: network first, falling back to the cache when there is
  // no signal. It used to be served stale and refreshed behind your back,
  // which meant a release only arrived on the SECOND open - so somebody would
  // open the app, get a build from before a feature existed, and quite
  // reasonably report that the feature did not work.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      try {
        // Checked with the server every time (a quick "not modified" when
        // nothing changed), so a reload after a release gets the release.
        let res = await fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }));
        // A page may not be answered with a redirect it followed itself; let
        // the browser make that request the ordinary way instead.
        if (res && res.redirected) res = await fetch(req);
        if (res && res.ok) c.put(req, res.clone());
        return res;
      } catch (_) {
        return (await c.match(req, { ignoreSearch: true })) ||
               (await c.match('./index.html')) ||
               Response.error();
      }
    })());
    return;
  }

  // Everything else: stale-while-revalidate, so it opens instantly and
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

// A notification from the Settle server. Every push shows something - iPhone
// and Chrome both require it - and a newer one about the same payment
// replaces the older rather than stacking up.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = String(d.title || 'Settle').slice(0, 90);
  const opts = {
    body: String(d.body || 'Something changed in one of your groups.').slice(0, 220),
    icon: './icon-192.png',
    data: { url: typeof d.url === 'string' ? d.url : './' },
    requireInteraction: !!d.sticky
  };
  if (d.tag) { opts.tag = String(d.tag).slice(0, 120); opts.renotify = true; }
  e.waitUntil(self.registration.showNotification(title, opts));
});

// Tapping it opens Settle at the group it is about - bringing an open copy to
// the front if there is one, where the question is already waiting.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let target;
  try { target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope); }
  catch (_) { target = new URL('./', self.registration.scope); }
  if (target.origin !== self.location.origin) target = new URL('./', self.registration.scope);
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = open.find((c) => c.url.startsWith(self.registration.scope));
    if (mine) {
      await mine.focus();
      mine.postMessage({ type: 'settle-open', url: target.href });
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});
