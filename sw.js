// 앱 파일(화면·얼굴 인식 데이터)만 휴대폰에 저장해서 빠르게 열기. 출연자 정보는 항상 새로 받음.
const CACHE = 'jcs-guest-v98';
const FILES = ['./', 'index.html', 'canvas-fix.js', 'mobile.js', 'gate.js', 'theme.js', 'install.js', 'news.js', 'zoom.js', 'onair.js', 'weather.js', 'notice.js', 'fonts/Galmuri11-Bold.woff2', 'glossary.js', 'hanja.js', 'parser.js', 'programs.js', 'manifest.webmanifest', 'lib/face-api.js', 'fonts/NanumSquareRoundR.woff2', 'fonts/NanumSquareRoundB.woff2',
  'icons/icon192.png', 'icons/icon512.png', 'icons/jyj48.png', 'icons/jyj128.png', 'icons/jyj192.png', 'icons/jcs48.png', 'icons/jcs192.png',
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
  // 구글·네이버에서 사진을 길게 눌러 [이미지 공유] → 정치쇼 앱으로 보낸 경우: 사진을 잠깐 보관하고 앱을 엶
  if (e.request.method === 'POST' && u.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const f = await e.request.formData();
        const c = await caches.open('jcs-share');
        const img = f.get('image');
        if (img && img.size) await c.put('shared-image', new Response(img, { headers: { 'Content-Type': img.type || 'image/jpeg' } }));
        const txt = [f.get('url'), f.get('text'), f.get('title')].filter(Boolean).join(' ');
        if (txt) await c.put('shared-text', new Response(txt));
      } catch (err) {}
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (u.origin !== location.origin) return;               // SBS·다음은 항상 인터넷에서
  if (/\.(js|html)$|\/$/.test(u.pathname)) {               // 화면 코드: 새 버전 우선, 안 되면 저장본
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});

// 진짜 푸시 알림: 앱이 꺼져 있어도 잠금화면에 표시 → 누르면 앱을 열고 큰 알림 화면
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: '📢 알림', body: e.data ? e.data.text() : '' }; }
  const urgent = d.level === 'urgent';
  e.waitUntil(self.registration.showNotification(d.title || '📢 알림', {
    body: d.body || '', icon: 'icons/jcs192.png', badge: 'icons/jcs48.png', tag: 'jcs-notice', renotify: true,
    requireInteraction: urgent, vibrate: urgent ? [300, 120, 300, 120, 300] : [200], data: { id: d.id || '' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const id = (e.notification.data && e.notification.data.id) || '1';
    for (const c of all) { if ('focus' in c) { c.postMessage({ type: 'jcsNotice', id }); return c.focus(); } }
    return self.clients.openWindow(new URL('./?notice=' + encodeURIComponent(id), self.registration.scope).href);
  })());
});
