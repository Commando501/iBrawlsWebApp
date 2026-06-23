const CACHE_VERSION = 'ibrawls-pwa-v2';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('ibrawls-pwa-') && !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

const isNavigationRequest = (request) => request.mode === 'navigate';
const STANDALONE_DOCUMENT_PATHS = new Set([
  '/mapmaker.html',
  '/animation-editor.html',
  '/armor-model-editor.html',
  '/v3-performance-smoke.html',
  '/v3-readiness-dashboard.html',
  '/v3-animation-atlas-smoke.html',
  '/v3-clean-animation-editor.html',
  '/v3-mesh2motion-rig-calibrator.html',
  '/v3-mesh2motion-tpose-bind-editor.html',
]);
const isStandaloneDocumentRequest = (request, url) =>
  isNavigationRequest(request) &&
  url.origin === self.location.origin &&
  STANDALONE_DOCUMENT_PATHS.has(url.pathname);
const isStaticAsset = (request) => {
  const destination = request.destination;
  return ['script', 'style', 'image', 'font', 'manifest'].includes(destination);
};

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (isNavigationRequest(request)) {
      return caches.match('/index.html');
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isStandaloneDocumentRequest(request, url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/src/') || url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules/'))
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(request) || url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
