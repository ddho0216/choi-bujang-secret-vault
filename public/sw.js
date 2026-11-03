// 서비스 워커: 오프라인 안내 페이지 하나만 보관한다. /api 요청과 로그인·자료는 가로채지도 저장하지도 않는다.
const OFFLINE_CACHE = 'offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(names => Promise.all(names.filter(name => name !== OFFLINE_CACHE).map(name => caches.delete(name))))
    .then(() => self.clients.claim()));
});

// 화면 이동(navigate) 요청이 네트워크에서 실패할 때만 안내 페이지를 보여 준다.
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.mode !== 'navigate') return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
});
