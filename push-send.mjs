// 관리자가 알림판(notice.json)에 새 알림을 올리면 GitHub가 실행: 등록된 모든 직원 폰에 진짜 푸시 알림을 보냄
// 받는 폰 목록은 구글 앱스 스크립트(구글 시트)에 있음. 열쇠(VAPID_PRIVATE·SUBS_KEY·SUBS_URL)는 GitHub 비밀 설정에만 있음
import webpush from 'web-push';
import { readFileSync } from 'node:fs';

const PUBLIC = 'BGNqMzG7xXuKDECls8HgAa_0Td_nE79dgzVk5BGUMqw4hwg3WRgJBnPTsoqTALr8qiL7q9_f0JOwqlOKNdf3yds';
const { VAPID_PRIVATE, SUBS_KEY, SUBS_URL } = process.env;
if (!VAPID_PRIVATE || !SUBS_KEY || !SUBS_URL) { console.log('비밀 설정이 아직 없음 → 푸시 건너뜀'); process.exit(0); }

const n = JSON.parse(readFileSync('notice.json', 'utf8'));
if (!n.id || !n.body) { console.log('올라온 알림 없음 (내린 상태)'); process.exit(0); }
if (n.until && Date.now() > n.until) { console.log('기간 지난 알림'); process.exit(0); }

webpush.setVapidDetails('https://rokaf072.github.io/jcs/', PUBLIC, VAPID_PRIVATE);
const r = await fetch(SUBS_URL + (SUBS_URL.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(SUBS_KEY), { redirect: 'follow' });
const j = await r.json().catch(() => ({}));
let subs = (j && j.subs) || [];
if (n.test) { subs = subs.filter((s) => s.endpoint === n.to); console.log('관리자 시험 알림 → 관리자 폰에만'); }
console.log('받는 폰', subs.length);

const urgent = n.level === 'urgent';
const payload = JSON.stringify({ id: n.id, title: (urgent ? '🚨 ' : '📢 ') + (n.title || '알림'), body: n.body.slice(0, 300), level: n.level || 'normal' });
let ok = 0; const gone = [];
for (let i = 0; i < subs.length; i += 20) {
  await Promise.all(subs.slice(i, i + 20).map(async (s) => {
    try { await webpush.sendNotification(s, payload, { TTL: 24 * 3600, urgency: urgent ? 'high' : 'normal', topic: 'jcs-notice' }); ok++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.endpoint); else console.log('실패', e.statusCode || e.message); }
  }));
}
console.log('보냄', ok, '/ 없어진 폰', gone.length);
if (gone.length) await fetch(SUBS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ op: 'remove', key: SUBS_KEY, endpoints: gone }), redirect: 'follow' }).catch(() => {});
