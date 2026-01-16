const CACHE_NAME = 'feynman-drawer-v10';

const urlsToCache = [
  './',
  './index.html',
  './index-en.html',
  './style.css',
  './app.js',
  './manifest.json',

  'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',

  'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.map(n => (n !== CACHE_NAME ? caches.delete(n) : null))
    ))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(resp => {
      if (resp) return resp;
      return fetch(event.request).then(networkResp => {
        if (!networkResp || networkResp.status !== 200 || event.request.method !== 'GET') {
          return networkResp;
        }
        const copy = networkResp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return networkResp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
