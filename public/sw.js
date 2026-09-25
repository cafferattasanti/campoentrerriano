// Service worker: permite ver la última información descargada aunque no haya señal.
// Los datos siempre muestran su fecha de actualización, así que nunca se presentan como actuales si son viejos.
const VERSION = 'campo-er-v6';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/parte.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/admin') || url.pathname === '/admin') return;
  if (url.pathname.startsWith('/api/')) {
    // Red primero; si no hay conexión, la última respuesta guardada.
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then((m) => m || new Response(JSON.stringify({ error: 'Sin conexión y sin datos guardados todavía.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  // Archivos de la página: lo guardado primero y se actualiza en segundo plano.
  e.respondWith(caches.match(e.request).then((m) => {
    const net = fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return r; }).catch(() => m);
    return m || net;
  }));
});
