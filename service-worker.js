// Bump CACHE_NAME whenever any cached frontend file changes — the service worker only
// re-installs (and re-fetches SHELL_FILES) when this file's own bytes change, so a stale
// version number here means returning users keep getting the old app shell forever. See
// README.md "Known Gotchas". Bumped to v6 for Phase 3.5 (added js/settings.js, js/rooms.js,
// js/accommodation.js — Admin Settings, Admin Rooms, and the Accommodation Dashboard).
// Bumped to v33 for pre-registration (new js/preregistration.js, registration.js/settings.js changes).
// Bumped to v34 for TMS rebrand (new app icons, manifest name/short_name, page title).
// Bumped to v35 for the mobile-overflow layout fix (app.css + table wrappers across several
// screens) — otherwise installed PWAs would keep serving the broken cached CSS/JS forever.
// Bumped to v36 for Master Reset (new Danger Zone section in js/settings.js).
// Bumped to v37 for Edit Room (js/rooms.js).
// Bumped to v38 for Excel/PDF export on Reports, Audit Log, and Teams (new js/export.js and
// js/vendor/xlsx.full.min.js, plus app.css print styles and reports.js/registration.js changes).
// Bumped to v39 for physical meal coupons (link label change in js/packages.js).
// Bumped to v40 for lazy-loading js/vendor/xlsx.full.min.js (no longer a startup SHELL_FILE;
// fetched and cached on first Excel export instead — see the fetch handler below).
// Bumped to v41 for pre-registration's Date of Arrival + WhatsApp-joined columns
// (js/preregistration.js).
// Bumped to v42 for pre-registration's Accommodation Required column (js/preregistration.js).
const CACHE_NAME = 'hpuick-shell-v42';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/export.js',
  './js/api-client.js', './js/auth.js', './js/users.js',
  './js/registration.js', './js/preregistration.js', './js/packages.js', './js/matchfee.js', './js/settings.js', './js/rooms.js', './js/accommodation.js',
  './js/mess.js', './js/departure.js', './js/reports.js', './js/app.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'
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
  // The large XLSX library is lazy-loaded. Cache it after first use so subsequent
  // exports remain fast/offline without paying the 0.9 MB startup cost on every launch.
  if (url.pathname.indexOf('/js/vendor/xlsx.full.min.js') !== -1) {
    event.respondWith(
      caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        return fetch(event.request).then(function (response) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cached) { return cached || fetch(event.request); })
  );
});
