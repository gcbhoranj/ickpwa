const CACHE_NAME = 'hpuick-shell-v1';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/app.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL_FILES); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url);
  // Never intercept calls to the Apps Script backend — those must always be live.
  if (url.hostname.indexOf('script.google') !== -1 || url.hostname.indexOf('googleusercontent') !== -1) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(function (cached) { return cached || fetch(event.request); })
  );
});
