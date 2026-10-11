/* Cache only the shell. Route answers and reports always come from the network. */
const CACHE = 'paanipath-shell-v9-route-hotspots';
const SHELL = ['/', '/app.js', '/app.css', '/favicon.svg', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(fetch('/asset-manifest.json').then(response => response.json())
    .then(assets => caches.open(CACHE).then(cache => cache.addAll([...SHELL, ...assets])))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(async () =>
    (await caches.match(event.request)) ?? new Response('Offline asset unavailable', { status: 503 })));
});
