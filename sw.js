/* PulseGrid — sw.js
 *
 * Cache-first service worker: the whole app is static and versioned by the
 * CACHE name, so every asset is served instantly and works fully offline.
 * Bump CACHE when shipping a new release.
 */

'use strict';

const CACHE = 'pulsegrid-v14';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/audio-engine.js',
  './js/presets.js',
  './js/sequencer.js',
  './js/visualizer.js',
  './js/render.js',
  './js/midi.js',
  './js/generator.js',
  './js/ui.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
