// 앱 파일(화면·얼굴 인식 데이터)만 휴대폰에 저장해서 빠르게 열기. 출연자 정보는 항상 새로 받음.
const CACHE = 'jcs-guest-v8';
const FILES = ['./', 'index.html', 'mobile.js', 'parser.js', 'manifest.webmanifest', 'lib/face-api.js',
  'icons/icon192.png', 'icons/icon512.png',
  'lib/model/tiny_face_detector_model-weights_manifest.json', 'lib/model/tiny_face_detector_model.bin',
  'lib/model/face_landmark_68_tiny_model-weights_manifest.json', 'lib/model/face_landmark_68_tiny_model.bin',
  'lib/model/face_recognition_model-weights_manifest.json', 'lib/model/face_recognition_model.bin'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;               // SBS·다음은 항상 인터넷에서
  if (/\.(js|html)$|\/$/.test(u.pathname)) {               // 화면 코드: 새 버전 우선, 안 되면 저장본
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
