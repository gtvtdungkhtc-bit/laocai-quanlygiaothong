const CACHE = 'htgtnt-v1';
const SHELL = [
  '/index.html', '/style.css', '/app.js', '/config.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Không cache Firebase / Google APIs — luôn online
  const url = e.request.url;
  if (url.includes('firestore') || url.includes('googleapis') ||
      url.includes('gstatic') || url.includes('maps')) return;

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
