// ───────── 웹으로 열 때(설치 없이 주소로 여는 PC 버전) ─────────
// 크롬 확장 프로그램으로 열면 아무것도 안 함.
// 웹 주소(https://rokaf072.github.io/jcs/pc/app.html)로 열면: 확장 프로그램 기능 대신 브라우저 저장소를 쓰는 보기 전용 화면
//   → 휴대폰 앱처럼 열 때마다 GitHub의 최신 파일로 열림 (설치·업데이트 필요 없음)
(() => {
  if (window.chrome && chrome.runtime && chrome.runtime.id) return;   // 확장 프로그램
  window.JCS_WEB = true;
  document.documentElement.classList.add('web', 'viewer');
  const P = 'cs:';
  const read = (k) => { try { const v = localStorage.getItem(P + k); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } };
  const local = {
    async get(k) {
      const o = {};
      if (k == null) { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && key.startsWith(P)) { const v = read(key.slice(P.length)); if (v !== undefined) o[key.slice(P.length)] = v; } } return o; }
      const ks = Array.isArray(k) ? k : typeof k === 'object' ? Object.keys(k) : [k];
      for (const x of ks) { const v = read(x); if (v !== undefined) o[x] = v; else if (typeof k === 'object' && !Array.isArray(k)) o[x] = k[x]; }
      return o;
    },
    async set(o) { for (const [k, v] of Object.entries(o || {})) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} } },
    async remove(k) { for (const x of (Array.isArray(k) ? k : [k])) { try { localStorage.removeItem(P + x); } catch (e) {} } },
  };
  const ev = { addListener() {}, removeListener() {} };
  const open = async (o) => { if (o && o.url) window.open(o.url, '_blank'); return { id: 0, tabs: [{ id: 0 }] }; };
  const nop = async () => {};
  window.chrome = Object.assign(window.chrome || {}, {
    storage: { local },
    runtime: { getURL: (x) => x, getManifest: () => ({ version: 'web' }), onMessage: ev, sendMessage() {}, reload: () => location.reload() },
    tabs: { create: open, update: nop, remove: nop, get: async () => ({}), query: async () => [], getCurrent: async () => null, onUpdated: ev, onRemoved: ev },
    windows: { create: open, update: nop, remove: nop, get: async () => ({}), getAll: async () => [], getCurrent: async () => ({ type: 'normal' }) },
    scripting: { executeScript: async () => [{}] },
    extension: { isAllowedIncognitoAccess: (cb) => cb && cb(false) },
  });
  // 신문·날씨·가입 정보는 한 단계 위(jcs/)에 있음
  const of = window.fetch.bind(window);
  window.fetch = (u, o) => (typeof u === 'string' && /^(news|weather|access)\.json/.test(u) ? of('../' + u, o) : of(u, o));
})();
