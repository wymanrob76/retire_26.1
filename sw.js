// sw.js — AuraRetire service worker
// BUMP THIS VERSION on every deploy to force cache refresh
const CACHE_VERSION = 'v1.0.2';
const CACHE_NAME = `aura-retire-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  '/Retire_26.1/',
  '/Retire_26.1/index.html',
  '/Retire_26.1/app.js',
  '/Retire_26.1/assumptions.js',
  '/Retire_26.1/projection.js',
  '/Retire_26.1/montecarlo.js',
  '/Retire_26.1/firebase-config.js',
  '/Retire_26.1/simulator.js',
  '/Retire_26.1/worker.js',
  '/Retire_26.1/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});