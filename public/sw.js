// Guarda la página en el móvil para que abra al instante aunque Render esté dormido.
// Solo se ocupa de la página: la API siempre va a la red (los cambios pendientes los gestiona la propia página).
const CACHE = 'sueno-v1';
const MARK = 'id="view-sheet"';   // así sabemos que es nuestra página y no la de espera de Render

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(refresh()); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

async function refresh() {
  try {
    const r = await fetch('/', { cache: 'no-store' });
    const t = await r.clone().text();
    if (r.ok && t.includes(MARK)) { const c = await caches.open(CACHE); await c.put('/', new Response(t, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })); }
    return t.includes(MARK) ? t : null;
  } catch { return null; }
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin || req.mode !== 'navigate' || (u.pathname !== '/' && u.pathname !== '/index.html')) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE); const hit = await c.match('/');
    if (hit) { e.waitUntil(refresh()); return hit; }          // al instante desde el móvil; se actualiza por detrás
    const t = await refresh();
    return t ? new Response(t, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : fetch(req);
  })());
});
