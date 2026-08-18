// Bump CACHE_NAME whenever any cached frontend file changes — the service worker only
// re-installs (and re-fetches SHELL_FILES) when this file's own bytes change, so a stale
// version number here means returning users keep getting the old app shell forever. See
// README.md "Known Gotchas". Bumped to v5 for Phase 3 (added js/registration.js, css/app.css
// wizard styles — Tasks 8-10's dashboard, wizard, and teams list/detail).
const CACHE_NAME = 'hpuick-shell-v5';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/users.js',
  './js/registration.js', './js/app.js', './manifest.json', './icons/icon-192.png',
  './icons/icon-512.png'
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
