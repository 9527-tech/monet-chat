/* Monet Chat service worker — app shell caching, never caches signalling or media streams. */

const VERSION = 'monet-chat-v1.3.0';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const PRECACHE = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './src/util.js',
  './src/db.js',
  './src/crypto.js',
  './src/signaling.js',
  './src/peer.js',
  './src/calls.js',
  './src/theme.js',
  './src/ui.js',
  './src/render.js',
  './vendor/material.js',
  './assets/material-symbols-rounded-subset.woff2',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './assets/favicon-32.png',
  './assets/favicon-16.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Signalling, SSE and anything cross-origin must always hit the network.
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (request.headers.get('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || new Response('离线', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(RUNTIME);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return new Response('资源不可用', { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
