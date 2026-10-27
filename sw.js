/* Plume service worker (added 2026-10-17)
   ═══════════════════════════════════════════════════════════════════
   Keeps a saved copy of the app's own files so Plume opens and works
   without internet, and makes it installable as an app.

   NETWORK FIRST, ON PURPOSE. When online, every app file is fetched fresh
   from the site and the saved copy is refreshed with it; the saved copy is
   used only when the network fails or is too slow (FRESH_TIMEOUT). So a
   merged change shows up on the next load, exactly as before the app was
   installable, and a mistake here cannot pin an old version for long.
   (Cache-first would open a fraction faster and make every update one step
   late; Heide changes Plume often, so freshness wins.)

   THIS FILE NEVER TOUCHES HER DATA. Her library lives in localStorage,
   which a service worker cannot see. Clearing these caches (Settings ->
   Storage -> "Clear the saved app copy") only removes copies of app files.

   APP_FILES must list every file the app loads. test-pwa.js fails if a page
   references a local file that is missing here, or if an entry here does
   not exist. Adding a new script to the app means adding it here too.

   CACHE only needs a new name if the caching scheme itself changes; normal
   updates refresh the saved files in place. Fonts come from Google Fonts
   and are kept in their own cache, cache-first, since they never change.
   ═══════════════════════════════════════════════════════════════════ */
var CACHE = 'plume-app-v1';
var FONT_CACHE = 'plume-fonts-v1';
var FRESH_TIMEOUT = 4000;   // ms to wait for the network before using the saved copy

var APP_FILES = [
  './',
  'index.html',
  'plume-ingredients.html',
  'plume-formulations.html',
  'plume-packaging.html',
  'plume-batchlog.html',
  'plume-costing.html',
  'plume-analytics.html',
  'plume-core.js',
  'plume-cheatsheet.js',
  'plume-sapdata.js',
  'plume-starter.js',
  'plume-logo.svg',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/favicon-32.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' skips the browser's own HTTP cache, so the saved copy
      // starts from what is on the site now.
      .then(function (c) {
        return c.addAll(APP_FILES.map(function (u) { return new Request(u, { cache: 'reload' }); }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('plume-') === 0 && k !== CACHE && k !== FONT_CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isFont(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

// Network first, saved copy as the fallback.
function fresh(req) {
  return caches.open(CACHE).then(function (cache) {
    var network = fetch(req).then(function (res) {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    var saved = function () {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        // A page she has never opened while online: fall back to the start page.
        if (req.mode === 'navigate') return cache.match('index.html');
        return undefined;
      });
    };
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        saved().then(function (hit) { if (hit && !done) { done = true; resolve(hit); } });
      }, FRESH_TIMEOUT);
      network.then(function (res) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(res);
      }, function () {
        clearTimeout(timer);
        saved().then(function (hit) {
          if (done) return;
          done = true;
          if (hit) resolve(hit); else reject(new Error('offline and not saved'));
        });
      });
    });
  });
}

// Fonts: saved copy first; fetched once and kept.
function font(req) {
  return caches.open(FONT_CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (isFont(url)) { e.respondWith(font(req)); return; }
  // Only the app's own files; anything else goes straight to the network.
  if (url.origin !== self.location.origin) return;
  var scope = self.registration.scope;
  if (req.url.indexOf(scope) !== 0) return;
  e.respondWith(fresh(req));
});
