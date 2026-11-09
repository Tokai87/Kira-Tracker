// Offline support: app files and the libraries it loads are cached after the first visit.
var CACHE = 'kira-app-v8';
var CORE = ['./', './index.html', './shim.js', './firebase-config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './maskable-512.png'];
var HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com', 'cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var ok = url.origin === location.origin || (HOSTS.indexOf(url.hostname) !== -1 && /\.(js|css|woff2?|traineddata|gz|wasm)/.test(url.pathname + '.') || url.hostname.indexOf('fonts.g') === 0);
  if (!ok) return;
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
