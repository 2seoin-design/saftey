const CACHE_NAME = 'saftey-cache-v1';
const APP_SHELL = [
  '/saftey/frontend/index.html',
  '/saftey/frontend/login.html',
  '/saftey/img/saftey_appicon.png',
  '/saftey/img/safety_logo_image.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// 같은 출처의 정적 페이지/이미지만 네트워크 우선 + 캐시 폴백으로 처리.
// /api/ (서버리스 함수)와 외부 출처(Supabase, TMAP 등)는 항상 네트워크로 직접 보냄 - 실시간 데이터가 중요하므로 캐시하지 않음.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/saftey/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/saftey/frontend/index.html'))
      )
  );
});
