/* Ancestree — offline support.

   Network first, cache second. The usual advice for a service worker is the
   other way round, because cache-first is faster. It is also how sites end up
   serving someone a months-old build with no way to escape it, and this app has
   no versioned filenames to protect against that.

   So: online, you always get the current files. Offline, you get the last ones
   that loaded. The app is a few tens of kilobytes, so the speed difference is
   not worth the class of bug cache-first invites.

   Nothing here talks to anything but this app's own origin. */

const VERSION = 'ancestree-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './js/state.js',
  './js/library.js',
  './js/photo.js',
  './js/layout.js',
  './js/tree.js',
  './js/book.js',
  './js/exchange.js',
  './js/main.js',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches
      .open(VERSION)
      // One missing file must not sink the whole install.
      .then(function (cache) {
        return Promise.all(
          SHELL.map(function (url) {
            return cache.add(url).catch(function () {});
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== VERSION;
            })
            .map(function (k) {
              return caches.delete(k);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Only ever this app's own files.
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(function (c) {
            c.put(req, copy);
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          // A deep link while offline still lands on the app.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      })
  );
});
