const LIST_URL = PROG.listUrl;   // programs.js: 지금 고른 프로그램(정치쇼/뉴스직격)
// 화면에 없는 버튼이 있어도(예: 예전 index.html) 멈추지 않도록 빈 요소로 대신함
const $ = (s) => document.querySelector(s) || document.createElement('div');
const store = {
  get: async (k) => { k = progKey(k); return (await chrome.storage.local.get(k))[k]; },
  set: (k, v) => chrome.storage.local.set({ [progKey(k)]: v }),
};
// 관리자 PC(GitHub 키가 저장된 PC)만 사진을 바꿀 수 있음. 키가 없는 PC(회사 PC 등)는 보기 전용
let OWNER = true;
let posts = [];      // [{ date:'2026-10-07', title, href }]
let current = null;  // 현재 보고 있는 게시물

// ───────── 날짜 도우미 ─────────
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dateFromTitle = (t) => { const m = (t || '').match(/^(\d{2})(\d{2})(\d{2})/); return m ? `20${m[1]}-${m[2]}-${m[3]}` : ''; };
const prettyDate = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };

function status(msg, err = false) { const el = $('#status'); el.textContent = msg; el.className = err ? 'err' : ''; }

// ───────── 백그라운드 탭에서 SBS 페이지 읽기 ─────────
function loadInTab(tabId, url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(l); reject(new Error('SBS 페이지 로딩 시간 초과')); }, 30000);
    function l(id, info) {
      if (id === tabId && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(l); chrome.tabs.get(tabId).then((t) => t && t.url && forgetUrl(t.url)).catch(() => {}); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(l);
    forgetUrl(url);
    chrome.tabs.update(tabId, { url });
  });
}
async function inTab(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r && r.result;
}
// 숨은 탭은 최대 3개까지 동시에
let tabsBusy = 0; const tabWait = [];
async function withHiddenTab(fn) {
  if (tabsBusy >= 3) await new Promise((r) => tabWait.push(r));
  tabsBusy++;
  clearTimeout(workIdleTimer);
  try { return await hiddenTabRun(fn); } finally { tabsBusy--; const n = tabWait.shift(); if (n) n(); workIdle(); }
}
// 바탕화면 바로가기(별도 창)로 열었을 때도 탭은 일반 크롬 창에 열리도록
async function normalWindowId() {
  const wins = (await chrome.windows.getAll({ windowTypes: ['normal'] })).filter((w) => w.id !== workWin);
  if (wins.length) return (wins.find((w) => w.focused) || wins.find((w) => w.state !== 'minimized') || wins[0]).id;
  const w = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
  return w.id;
}
// ── 검색 흔적 남기지 않기 ──
// 1) 크롬 방문 기록: 이 프로그램이 연 검색 주소는 바로 지움
// 2) 구글 검색창 '최근 검색' 목록(구글 계정 기록): 시크릿 창에서 검색하면 아예 안 남음
const SEARCH_HOST = /(^|\.)(google\.[a-z.]+|search\.naver\.com|search\.daum\.net|youtube\.com)$/;
const traceKeys = new Set();
const traceKey = (u) => { try { const x = new URL(u); if (!SEARCH_HOST.test(x.hostname)) return ''; const q = x.searchParams.get('q') || x.searchParams.get('query') || x.searchParams.get('search_query') || ''; return q ? q.replace(/\s+/g, ' ').trim() : ''; } catch (e) { return ''; } };
function forgetUrl(u) { const k = traceKey(u); if (k) traceKeys.add(k); if (chrome.history) chrome.history.deleteUrl({ url: u }).catch(() => {}); }
if (chrome.history) chrome.history.onVisited.addListener((h) => { const k = traceKey(h.url); if (k && traceKeys.has(k)) chrome.history.deleteUrl({ url: h.url }).catch(() => {}); });
const isSearchUrl = (u) => !!traceKey(u) && !/youtube\.com\/watch/.test(u);
const incogOK = () => new Promise((r) => { try { chrome.extension.isAllowedIncognitoAccess((v) => r(!!v)); } catch (e) { r(false); } });
let searchWin = null;   // 사진 찾기용 시크릿 창 (한 창에 탭으로 계속 열림)
async function openIncogSearch(url) {
  forgetUrl(url);
  try {
    if (searchWin) { try { await chrome.windows.get(searchWin); } catch (e) { searchWin = null; } }
    if (searchWin) {
      const t = await chrome.tabs.create({ windowId: searchWin, url, active: true });
      await chrome.windows.update(searchWin, { focused: true });
      return t;
    }
    const w = await chrome.windows.create({ url, incognito: true, state: 'maximized', focused: true, populate: true });
    searchWin = w.id;
    return w.tabs && w.tabs[0];
  } catch (e) {}
  return openTabPlain(url);   // 시크릿 창을 못 열면 일반 탭 (방문 기록은 지움)
}
async function openTabPlain(url) {
  const windowId = await normalWindowId();
  const tab = await chrome.tabs.create({ windowId, url, active: true });
  // 창 크기는 건드리지 않음 (최대화된 창이 작아지던 문제). 최소화돼 있을 때만 다시 크게
  try { const w = await chrome.windows.get(windowId); await chrome.windows.update(windowId, w.state === 'minimized' ? { focused: true, state: 'maximized' } : { focused: true }); } catch (e) {}
  return tab;
}
async function openTab(url) { if (isSearchUrl(url)) return openIncogSearch(url); return openTabPlain(url); }
// ── 구글·네이버에서 찾은 사진을 클릭 한 번으로 등록 ──
// 사진 고르기 창의 [구글/네이버에서 직접 찾기]로 연 탭에 '이 사진으로' 버튼을 붙임
const pickTabs = new Map();   // 탭 번호 → { pick, name }
async function openPickSearch(url, g, pick) {
  const tab = await openTab(url);
  if (!tab) return;
  pickTabs.set(tab.id, { pick, name: g.name });
  injectPickHelper(tab.id, g.name);
}
function injectPickHelper(tabId, name) {
  chrome.scripting.executeScript({ target: { tabId }, func: pagePickHelper, args: [name] }).catch(() => {});
}
chrome.tabs.onUpdated && chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete' && pickTabs.has(id)) injectPickHelper(id, pickTabs.get(id).name); });
chrome.tabs.onRemoved && chrome.tabs.onRemoved.addListener((id) => pickTabs.delete(id));
chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'jcsPick' || !sender.tab || !pickTabs.has(sender.tab.id)) return;
  const { pick } = pickTabs.get(sender.tab.id);
  pickTabs.delete(sender.tab.id);
  setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 700);
  chrome.tabs.getCurrent().then((me) => { if (me) { chrome.tabs.update(me.id, { active: true }); chrome.windows.update(me.windowId, { focused: true }); } }).catch(() => {});
  // 원본 사진이 막혀 안 뜨면(퍼가기 금지 사이트) 검색 화면의 사진으로 대신
  const loads = (u) => new Promise((r) => { if (!u) return r(false); const im = new Image(); im.referrerPolicy = 'no-referrer'; const t = setTimeout(() => r(false), 6000); im.onload = () => { clearTimeout(t); r(im.naturalWidth >= 60); }; im.onerror = () => { clearTimeout(t); r(false); }; im.src = u; });
  (async () => { status('사진 등록 중…'); pick((await loads(msg.url)) ? msg.url : (msg.thumb || msg.url)); })();
});
// 아래 함수는 구글/네이버 검색 화면 안에서 실행됨 (독립적으로 작성)
function pagePickHelper(name) {
  if (window.__jcsPick) return; window.__jcsPick = true;
  const bar = document.createElement('div');
  bar.textContent = `📌 ${name} — 사진에 마우스를 올리고 [이 사진으로]를 누르면 바로 등록돼요`;
  bar.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483647;background:#0f766e;color:#fff;font:700 15px/1.4 "Malgun Gothic",sans-serif;padding:9px 18px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.35);pointer-events:none';
  document.documentElement.append(bar);
  const btn = document.createElement('button');
  btn.textContent = '✔ 이 사진으로';
  btn.style.cssText = 'position:fixed;z-index:2147483647;display:none;background:#14b8a6;color:#fff;border:2px solid #fff;font:800 14px "Malgun Gothic",sans-serif;padding:7px 12px;border-radius:10px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4)';
  document.documentElement.append(btn);
  let cur = null, busy = false;
  const okImg = (im) => { const r = im.getBoundingClientRect(); return r.width >= 70 && r.height >= 70; };
  document.addEventListener('mouseover', (e) => {
    if (busy) return;
    if (e.target === btn) return;
    let im = e.target.closest && e.target.closest('img');
    if (!im) im = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.tagName === 'IMG');   // 사진 위에 투명한 덮개가 있어도 찾기
    if (!im || !okImg(im)) return;
    cur = im;
    const r = im.getBoundingClientRect();
    btn.style.left = Math.max(4, r.left + 6) + 'px'; btn.style.top = Math.max(4, r.top + 6) + 'px'; btn.style.display = 'block';
  }, true);
  window.addEventListener('scroll', () => { if (!busy) btn.style.display = 'none'; }, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isFull = (u) => /^https?:/.test(u || '') && !/gstatic\.com|google\.com\/(images|logos)|googleusercontent\.com\/.*=s\d{1,2}-/.test(u);
  function naverOrig(u) { try { const x = new URL(u); const s = x.searchParams.get('src'); if (/pstatic\.net$/.test(x.hostname) && s) return decodeURIComponent(s); } catch (e) {} return u; }
  async function resolve(im) {
    let u = im.currentSrc || im.src || '';
    if (location.hostname.includes('naver')) return naverOrig(u);
    if (isFull(u)) return u;
    // 구글: 썸네일을 눌러 오른쪽에 큰 사진을 띄운 뒤 원본 주소를 가져옴
    const before = new Set([...document.images].map((x) => x.currentSrc || x.src));
    im.click();
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      const big = [...document.images].filter((x) => { const s = x.currentSrc || x.src; const r = x.getBoundingClientRect(); return isFull(s) && !before.has(s) && r.width >= 150; });
      if (big.length) return big[0].currentSrc || big[0].src;
    }
    return u;   // 원본을 못 찾으면 썸네일이라도
  }
  btn.addEventListener('mousedown', (e) => e.stopPropagation(), true);
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!cur || busy) return;
    busy = true; btn.textContent = '등록 중…';
    const url = await resolve(cur);
    btn.textContent = '✔ 등록했어요';
    bar.textContent = '등록했어요! 출연자 화면으로 돌아갑니다';
    chrome.runtime.sendMessage({ type: 'jcsPick', url, thumb: cur.currentSrc || cur.src || '' });
  }, true);
}
// 지난 흔적 정리: 출연자 이름으로 검색한 기록(구글·네이버·다음 이미지, 유튜브 검색)을 크롬 방문 기록에서 지움
async function cleanOldTraces() {
  if (!chrome.history) return 0;
  try {
    const names = new Set();
    const idx = (await store.get('gindex')) || {};
    for (const v of Object.values(idx)) for (const g of v.g || []) if (g[0] && g[0].length >= 2) names.add(g[0]);
    const all = await chrome.storage.local.get(null);
    for (const k of Object.keys(all)) { const m = k.match(/^(?:manual|photo7|lock|none):([^|]+)/); if (m && m[1].length >= 2) names.add(m[1]); }
    names.add('김태현'); names.add('최선호');
    const hs = await chrome.history.search({ text: '', startTime: Date.now() - 400 * 864e5, maxResults: 100000 });
    let n = 0;
    for (const h of hs) {
      const q = traceKey(h.url); if (!q) continue;
      if ([...names].some((nm) => q.includes(nm))) { chrome.history.deleteUrl({ url: h.url }).catch(() => {}); n++; }
    }
    return n;
  } catch (e) { return 0; }
}
// 숨은 작업은 따로 만든 '최소화된 작업용 창'에서 → 보고 있는 창에 탭이 생겼다 사라지지 않음
//   '시크릿 모드에서 허용'이 켜져 있으면 작업용 창도 시크릿 → 구글 계정 검색 기록에 안 남음
let workWin = null;
let workWinP = null;   // 동시에 여러 작업이 와도 창은 하나만
function workWindowId() { if (!workWinP) workWinP = makeWorkWindow().finally(() => { workWinP = null; }); return workWinP; }
async function makeWorkWindow() {
  if (workWin) { try { const w = await chrome.windows.get(workWin); if (w) return workWin; } catch (e) {} }
  const incognito = await incogOK();
  const w = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized', type: 'normal', incognito });
  workWin = w.id;
  chrome.windows.update(w.id, { state: 'minimized', focused: false }).catch(() => {});   // 혹시 펼쳐져 열리면 다시 내림
  return workWin;
}
// 작업이 끝나고 10초 동안 할 일이 없으면 작업용 창을 닫음 (창이 계속 남아 있지 않게)
let workIdleTimer = null;
function workIdle() {
  clearTimeout(workIdleTimer);
  workIdleTimer = setTimeout(() => { if (tabsBusy === 0 && workWin) { const id = workWin; workWin = null; chrome.windows.remove(id).catch(() => {}); } }, 10000);
}
// 예전에 남은 빈 작업용 창(about:blank만 있는 창) 정리
(async () => { try { for (const w of await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })) { if (w.id !== workWin && w.tabs && w.tabs.length && w.tabs.every((t) => (t.url || t.pendingUrl || 'about:blank') === 'about:blank')) chrome.windows.remove(w.id).catch(() => {}); } } catch (e) {} })();
window.addEventListener('pagehide', () => { if (workWin) chrome.windows.remove(workWin).catch(() => {}); });   // 앱을 닫으면 작업용 창도 닫음
async function hiddenTabRun(fn) {
  while (document.querySelector('.overlay.review-ov')) await new Promise((r) => setTimeout(r, 2000));   // 사진 검토 중엔 숨은 창을 열지 않음
  let windowId;
  try { windowId = await workWindowId(); } catch (e) { windowId = await normalWindowId(); }
  const tab = await chrome.tabs.create({ windowId, url: 'about:blank', active: false });
  try { return await fn(tab.id); } finally { chrome.tabs.remove(tab.id).catch(() => {}); }
}

// 아래 두 함수는 SBS 페이지 안에서 실행됨 (독립적으로 작성)
async function pageScrapeList() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50; i++) {
    const seen = new Set(), out = [];
    for (const a of document.querySelectorAll('a')) {
      const t = (a.innerText || '').trim().replace(/\s+/g, ' ');
      if (!/^\d{6}\s*\(/.test(t) || seen.has(t)) continue;
      seen.add(t);
      out.push({ title: t, href: a.href && a.href.includes('board_no') ? a.href : '' });
    }
    if (out.length) return out;
    await sleep(300);
  }
  return [];
}
async function pageScrapeView() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let best = null;
  for (let i = 0; i < 50 && !best; i++) {
    let score = -1;
    for (const e of document.querySelectorAll('div,section,article,td')) {
      const t = e.innerText || '';
      if (!/\n\s*[-–]\s*\S/.test(t) || !/(◈|\d\s*부\s*\(|\[)/.test(t)) continue;
      const dash = (t.match(/\n\s*[-–]\s*\S/g) || []).length;
      const s = dash * 100000 - t.length;          // 출연자 줄 최다 + 가장 작은 요소
      if (s > score) { score = s; best = e; }
    }
    if (!best) await sleep(300);
  }
  const body = best ? best.innerText : document.body.innerText;
  const dt = document.title.split(' : ');
  const title = dt.length >= 4 ? dt.slice(2, -1).join(' : ') : '';
  const reg = (document.body.innerText.match(/등록일\s*([\d.]+\s*[\d:]*)/) || [])[1] || '';
  return { body, title, registered: reg, url: location.href };
}
async function pageClickTitle(title) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    for (const a of document.querySelectorAll('a')) {
      if ((a.innerText || '').trim().replace(/\s+/g, ' ') === title) { a.click(); return true; }
    }
    await sleep(300);
  }
  return false;
}

// ───────── API 방식 (빠름) ─────────
const API = 'https://api.board.sbs.co.kr/bbs/V2.0/basic/board';
let BOARD = PROG.board;   // 뉴스직격은 처음에 찾아서 기억
const viewUrl = (no) => `${LIST_URL}/?cmd=view&board_no=${no}`;

async function getJsonp(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('API 응답 ' + res.status);
  const t = await res.text();
  return JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')')));
}
function htmlToText(html) {
  const s = (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n');
  return new DOMParser().parseFromString(`<body>${s}</body>`, 'text/html').body.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
async function apiList() {
  BOARD = await progBoard(getJsonp);
  const j = await getJsonp(`${API}/lists?board_code=${BOARD}&offset=0&limit=${PROG.limit}&action_type=callback&callback=boardListCallback_${BOARD}`);
  return progPosts(j.list || [], (x) => ({ no: x.NO, title: x.TITLE, href: viewUrl(x.NO), updated: x.UPDATE_DATE || x.REG_DATE || '', date: dateFromTitle(x.TITLE) || (x.REG_DATE || '').slice(0, 10) }));
}
async function apiPost(p) {
  const j = await getJsonp(`${API}/detail/${p.no}?action_type=callback&board_code=${BOARD}&callback=boardViewCallback_${BOARD}`);
  const d = j.Response_Data_For_Detail;
  if (!d || !d.CONTENT) throw new Error('본문 없음');
  return { body: htmlToText(d.CONTENT), title: htmlToText(d.TITLE), registered: (d.REG_DATE || '').slice(0, 16).replace(/-/g, '.'), url: viewUrl(d.NO) };
}

async function fetchList() {
  status('SBS 게시판 목록 확인 중…');
  try {
    posts = await apiList();
    if (posts.length) { await store.set('posts_v2', posts); fillSelect(); return; }
  } catch (e) {
    console.warn('목록 API 실패 → 화면 읽기 방식', e);
    if (PROG.multi) {   // 뉴스직격: 게시판 번호를 못 찾았으면 SBS 페이지를 숨은 탭으로 열어 번호를 알아냄
      progForgetBoard();
      const b = await withHiddenTab(async (tabId) => {
        await loadInTab(tabId, LIST_URL);
        for (let i = 0; i < 8; i++) {
          const r = await inTab(tabId, () => { for (const x of performance.getEntriesByType('resource')) { const m = x.name.match(/board_code=([A-Za-z0-9_]+)/); if (m) return m[1]; } return ''; });
          if (r) return r; await new Promise((ok) => setTimeout(ok, 1000));
        }
        return '';
      }).catch(() => '');
      if (!b) throw e;
      progSetBoard(b);
      posts = await apiList();
      await store.set('posts_v2', posts); fillSelect(); return;
    }
  }
  const items = await withHiddenTab(async (tabId) => { await loadInTab(tabId, LIST_URL); return inTab(tabId, pageScrapeList); });
  if (!items || !items.length) throw new Error('게시판 목록을 찾지 못했습니다. SBS 페이지 구조가 바뀌었을 수 있어요.');
  posts = items.map((p) => ({ ...p, date: dateFromTitle(p.title) })).filter((p) => p.date);
  await store.set('posts_v2', posts);
  fillSelect();
}

async function fetchPost(p) {
  status(`${prettyDate(p.date)} 방송내용 읽는 중…`);
  if (p.nos) {   // 뉴스직격: 그날 올라온 글(코너별)을 모두 읽어 합침
    const ds = await Promise.all(p.nos.map((no) => apiPost({ no })));
    const result = { date: p.date, updated: p.updated || '', title: ds.map((d) => d.title).join(' / '), registered: ds[ds.length - 1].registered, url: ds[0].url, body: ds.map((d) => d.body).join('\n\n──────────\n\n'), ...mergeJYJ(ds), pv: PARSER_V, fetchedAt: Date.now() };
    await store.set('post:' + p.date, result);
    return result;
  }
  let data = null;
  if (p.no) { try { data = await apiPost(p); } catch (e) { console.warn('본문 API 실패 → 화면 읽기 방식', e); } }
  if (!data) data = await withHiddenTab(async (tabId) => {
    if (p.href) {
      await loadInTab(tabId, p.href);
    } else {
      await loadInTab(tabId, LIST_URL);
      const ok = await inTab(tabId, pageClickTitle, [p.title]);
      if (!ok) throw new Error('게시물 링크를 찾지 못했습니다.');
      await new Promise((r) => setTimeout(r, 2500));
    }
    return inTab(tabId, pageScrapeView);
  });
  const title = data.title || p.title;
  const parsed = parseBody(data.body, title);
  const result = { date: p.date, updated: p.updated || '', title, registered: data.registered, url: data.url || p.href, body: data.body, ...parsed, pv: PARSER_V, fetchedAt: Date.now() };
  await store.set('post:' + p.date, result);
  return result;
}

// ───────── 사진: 1순위 네이버 뉴스 최신 기사 사진 (기사 제목에 이름이 있는 것만) ─────────
const GENERIC = /^(기자|평론가|시사평론가|정치평론가|의원|위원|위원장|공동위원장|대표|교수|변호사|전|현|前|現|소장|실장|국장|부장|센터장|박사|회장|이사|원장|장관|대변인|최고위원)$/;
function photoTokens(g) {
  const roleWords = g.role.split(/\s+/).filter((w) => w.length >= 2);
  const specific = roleWords.filter((w) => !GENERIC.test(w));
  const topic = `${g.topic || ''}`.match(/[A-Za-z][A-Za-z0-9-]{1,}|[가-힣]{3,}/g) || [];
  return [...new Set([...specific, ...topic.filter((w) => !/^(그리고|어떻게|무엇|논란|이유|진짜|계속)$/.test(w)), ...roleWords])];
}
function newsImgFromThumb(u) {
  try {
    u = u.replace(/&amp;/g, '&');
    const m = u.match(/[?&]src=([^&]+)/);
    if (m) { const src = decodeURIComponent(m[1]); if (/^https?:\/\//.test(src)) return src.replace(/^http:/, 'https:'); }
  } catch (e) {}
  return u;
}
// 기사 사진 + 그 기사 제목/요약 묶기 (페이지 구조 이름에 의존하지 않음)
function pairsFromRoot(root) {
  const out = [];
  for (const im of root.querySelectorAll('img')) {
    const src = [im.getAttribute('src'), im.getAttribute('data-lazysrc'), im.getAttribute('data-src'), im.currentSrc].find((x) => x && /imgnews/.test(x));
    if (!src) continue;
    let node = im, text = '';
    for (let i = 0; i < 8 && node.parentElement; i++) {
      const up = node.parentElement;
      if ([...up.querySelectorAll('img')].filter((x) => /imgnews/.test(x.outerHTML)).length > 1) break;   // 다른 기사까지 넘어가지 않기
      node = up;
      text = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      if (text.length > 40) break;
    }
    out.push({ src, text });
  }
  return out;
}
async function pageNewsPairs() {   // 숨은 탭 안에서 실행
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 20; i++) {
    const out = [];
    for (const im of document.querySelectorAll('img')) {
      const src = [im.currentSrc, im.getAttribute('src'), im.getAttribute('data-lazysrc')].find((x) => x && /imgnews/.test(x));
      if (!src) continue;
      let node = im, text = '';
      for (let k = 0; k < 8 && node.parentElement; k++) {
        const up = node.parentElement;
        if ([...up.querySelectorAll('img')].filter((x) => /imgnews/.test(x.outerHTML)).length > 1) break;
        node = up;
        text = (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400);
        if (text.length > 40) break;
      }
      out.push({ src, text });
    }
    if (out.length) return out;
    await sleep(300);
  }
  return [];
}
const newsCache = new Map();
async function newsCandidates(g) {
  const q = `${g.name} ${g.role}`.trim();
  if (newsCache.has(q)) return newsCache.get(q);
  const job = (async () => {
    const url = 'https://search.naver.com/search.naver?where=news&sort=1&query=' + encodeURIComponent(q);
    let pairs = [];
    try {
      const html = await (await fetch(url, { cache: 'no-store' })).text();
      pairs = pairsFromRoot(new DOMParser().parseFromString(html, 'text/html'));
    } catch (e) {}
    if (!pairs.length) {
      try { pairs = await withHiddenTab(async (id) => { await loadInTab(id, url); return inTab(id, pageNewsPairs); }) || []; } catch (e) {}
    }
    const tokens = photoTokens(g), seen = new Set(), list = [];
    for (const p of pairs) {
      const img = newsImgFromThumb(p.src), k = img.split('?')[0];
      if (seen.has(k)) continue; seen.add(k);
      const hasName = p.text.includes(g.name);
      const score = (hasName ? 10 : 0) + tokens.filter((t) => p.text.includes(t)).length;
      list.push({ url: img, text: p.text, hasName, score });
    }
    // 이름이 기사에 있는 것 우선, 같으면 소속·주제 단어 많이 겹친 것, 같으면 최신순 유지
    list.sort((a, b) => b.score - a.score);
    return list;
  })();
  newsCache.set(q, job);
  return job;
}

// 2순위(뉴스에서 못 찾을 때만): 네이버 인물정보 사진, 소속·주제 단어가 맞을 때만
async function naverProfilePhoto(g) {
  const tokens = photoTokens(g).filter((t) => !GENERIC.test(t));
  if (!tokens.length) return '';
  for (const q of [...new Set([`${g.name} ${g.role}`.trim(), g.name])]) {
    const html = await (await fetch('https://search.naver.com/search.naver?where=nexearch&query=' + encodeURIComponent(q))).text();
    const re = /https:\/\/search\.pstatic\.net\/common\/?\?[^"'\s<>\\]*?sstatic\.naver\.net%2Fpeople[^"'\s<>\\]*/g;
    for (const m of html.matchAll(re)) {
      const near = html.slice(Math.max(0, m.index - 1500), m.index + 4000).replace(/<[^>]+>/g, ' ');
      if (near.includes(g.name) && tokens.some((t) => near.includes(t))) return m[0].replace(/&amp;/g, '&');
    }
  }
  return '';
}
// ───────── 얼굴 인식: 여러 출처 사진을 서로 대조해서 "같은 얼굴이 반복되는 사람"을 본인으로 판단 ─────────
let faceReady = null;
function loadFace() {
  if (!faceReady) faceReady = (async () => {
    if (typeof faceapi === 'undefined') await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'lib/face-api.js'; s.onload = ok; s.onerror = no; document.head.append(s); });   // 얼굴 인식 도구(1.3MB)는 필요할 때만 불러옴 → 처음 실행이 빨라짐
    try { await faceapi.tf.setBackend('webgl'); } catch (e) { await faceapi.tf.setBackend('cpu'); }
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('lib/model'),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri('lib/model'),
      faceapi.nets.faceLandmark68Net.loadFromUri('lib/model'),      // 정밀 얼굴 윤곽 (고개 숙임·눈 감음 판단용)
      faceapi.nets.faceRecognitionNet.loadFromUri('lib/model'),
    ]);
    return true;
  })().catch((e) => { console.warn('얼굴 인식 준비 실패', e); return false; });
  return faceReady;
}
// 사진 한 장 분석 → null(확인 불가) | { faces:[{ cx, cy, ratio, desc }] }
const faceMemo = new Map();
function analyze(url) {
  if (!faceMemo.has(url)) faceMemo.set(url, (async () => {
    try {
      if (!(await loadFace())) return null;
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const res = await faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks(true).withFaceDescriptors();
      const faces = res
        .map((r) => { const b = r.detection.box; return { cx: (b.x + b.width / 2) / c.width, cy: (b.y + b.height / 2) / c.height, ratio: (b.width * b.height) / (c.width * c.height), px: b.width, desc: Array.from(r.descriptor) }; })
        .filter((f) => f.px >= 28)
        .sort((a, b) => b.ratio - a.ratio);
      return { faces };
    } catch (e) { return null; }
  })());
  return faceMemo.get(url);
}
const SAME = 0.5;   // 얼굴 거리 기준 (작을수록 엄격)
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };
const isPortrait = (a) => a && a.faces.length >= 1 && a.faces.length <= 3 && a.faces[0].ratio >= 0.012;

async function daumImages(g, sort, size) {
  if (typeof KAKAO_REST_KEY === 'undefined' || !KAKAO_REST_KEY) return [];
  const q = `${g.name} ${g.role}`.trim();
  const res = await fetch(`https://dapi.kakao.com/v2/search/image?sort=${sort}&size=${size}&query=` + encodeURIComponent(q),
    { headers: { Authorization: 'KakaoAK ' + KAKAO_REST_KEY }, cache: 'no-store' });
  if (!res.ok) throw new Error('다음 검색 오류 ' + res.status);
  const docs = (await res.json()).documents || [];
  return docs.map((d) => ({ url: d.image_url, thumb: d.thumbnail_url, date: (d.datetime || '').slice(0, 10), site: d.display_sitename || '', collection: d.collection }));
}

// 구글 이미지 검색 (키 없음: 숨은 탭에서 결과 화면의 사진을 읽음)
async function pageGoogleImgs() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let out = [];
  for (let i = 0; i < 25; i++) {
    out = [...document.querySelectorAll('img')]
      .filter((im) => { const s = im.currentSrc || im.src || ''; return (/^data:image\/(jpeg|webp)/.test(s) || /encrypted-tbn\d?\.gstatic\.com/.test(s)) && im.naturalWidth >= 80 && im.naturalHeight >= 80; })
      .map((im) => im.currentSrc || im.src);
    if (out.length >= 10) break;
    await sleep(300);
  }
  return [...new Set(out)].slice(0, 15);
}
const googleMemo = new Map();
function googleImages(g) {
  const q = `${g.name} ${g.role}`.trim();
  if (!googleMemo.has(q)) googleMemo.set(q, (async () => {
    const url = 'https://www.google.com/search?udm=2&hl=ko&q=' + encodeURIComponent(q);
    try { return (await withHiddenTab(async (id) => { await loadInTab(id, url); return inTab(id, pageGoogleImgs); })) || []; }
    catch (e) { return []; }
  })());
  return googleMemo.get(q);
}

// 본인 얼굴 찾기: 네이버 뉴스 + 다음 이미지 + 구글 이미지 + 인물정보 사진에서 얼굴을 모아, 서로 다른 사진에 반복해서 나오는 얼굴을 고름
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);
// 인터넷 사진 후보 모으기 (뉴스·다음·네이버 인물정보·구글)
async function webSources(g) {
  // 1) 네 곳 검색을 동시에 (느린 곳은 최대 8초까지만 기다림)
  const [news, daum, prof, goog] = await Promise.all([
    withTimeout(newsCandidates(g).then((l) => l.filter((x) => x.hasName).slice(0, 6)), 8000, []).catch(() => []),
    withTimeout(daumImages(g, 'accuracy', 8), 8000, []).catch(() => []),
    withTimeout(naverProfilePhoto(g), 8000, '').catch(() => ''),
    withTimeout(googleImages(g).then((l) => l.slice(0, 8)), 8000, []).catch(() => []),
  ]);
  // 2) 출처를 번갈아 섞어서 분석 순서 정하기 (한 곳에 치우치지 않게)
  const sources = [];
  if (prof) sources.push({ url: prof, kind: 'profile', w: 2, order: 200 });
  for (let i = 0; i < 8; i++) {
    if (goog[i]) sources.push({ url: goog[i], kind: 'google', w: 1, order: 300 + i });
    if (daum[i]) sources.push({ url: daum[i].thumb, show: daum[i].url, kind: 'daum', w: 1, order: 100 + i });
    if (news[i]) sources.push({ url: news[i].url, kind: 'news', w: 0.75, order: i });   // 뉴스 사진은 기사 속 다른 인물일 수 있어 조금 낮게
  }
  return sources;
}
async function identify(g) {
  const sources = await webSources(g);
  // 3) 4장씩 동시에 분석, 같은 얼굴이 충분히 확인되면 바로 멈춤
  const faces = [];
  let bestFace = null, bestSupport = 0;
  const score = () => {
    bestFace = null; bestSupport = 0;
    for (const f of faces) {
      const seen = new Map([[f.img, f.src.w]]);
      for (const h of faces) if (h.img !== f.img && dist(f.desc, h.desc) < SAME) seen.set(h.img, Math.max(seen.get(h.img) || 0, h.src.w));
      const sup = [...seen.values()].reduce((x, y) => x + y, 0);
      if (sup > bestSupport) { bestSupport = sup; bestFace = f; }
    }
  };
  for (let i = 0; i < sources.length; i += 4) {
    const batch = sources.slice(i, i + 4);
    const res = await Promise.all(batch.map((s) => analyze(s.url)));
    res.forEach((a, k) => { if (isPortrait(a)) for (const f of a.faces) faces.push({ ...f, img: i + k, src: batch[k], alone: a.faces.length === 1 }); });
    score();
    if (bestSupport >= 4) break;   // 서로 다른 사진 4장(또는 인물정보+2장)에서 같은 얼굴 → 충분
  }
  if (!bestFace || bestSupport < 2.75) return { url: '', confident: false };   // 근거 부족 → 사진 비워두고 확인 요청
  const members = faces.filter((h) => dist(bestFace.desc, h.desc) < SAME);
  members.sort((a, b) =>
    (b.alone - a.alone) || ((a.src.kind === 'news' ? 0 : 1) - (b.src.kind === 'news' ? 0 : 1)) || (a.src.order - b.src.order) || (b.ratio - a.ratio));
  const m = members[0];
  return { url: m.src.show || m.src.url, alt: m.src.url, cx: m.cx, cy: m.cy, desc: bestFace.desc, confident: true, support: bestSupport };
}

// 출연자 사진은 3명씩 동시에 찾기
let photoBusy = 0; const photoWait = [];
let photoGen = 0;   // 화면을 새로 그릴 때마다 증가 → 이전 화면의 대기 중 검색은 건너뜀
async function limited(fn) {
  if (photoBusy >= 3) await new Promise((r) => photoWait.push(r));
  photoBusy++;
  try { return await fn(); } finally { photoBusy--; const n = photoWait.shift(); if (n) n(); }
}
// 같은 사람이 직함을 조금 다르게 적어도(정치쇼↔뉴스직격, '전 의원'↔'前 의원' 등) 예전에 찾은 사진을 그대로 씀
let photoNameMemo = null, photoNameAt = 0;
async function autoByName(name) {
  if (!photoNameMemo || Date.now() - photoNameAt > 60000) {
    photoNameAt = Date.now();
    photoNameMemo = chrome.storage.local.get(null).then((all) => {
      const m = new Map();
      for (const [k, v] of Object.entries(all)) {
        if (!k.startsWith('photo7:') || !v || !v.url || v.temp) continue;
        const n = k.slice(7).split('|')[0], b = m.get(n);
        if (!b || (v.ver === 2) > (b.ver === 2) || ((v.ver === 2) === (b.ver === 2) && (v.at || 0) > (b.at || 0))) m.set(n, v);
      }
      return m;
    }).catch(() => new Map());
  }
  return (await photoNameMemo).get(name) || null;
}
// onUpdate: 예전 사진을 먼저 보여주고, 새로 찾은 사진이 있으면 나중에 바꿔줌
async function getPhoto(g, onUpdate, opts = {}) {
  const key = `${g.name}|${g.role}`;
  if (await store.get('none:' + g.name)) return { url: '' };   // 사용자가 사진을 지운 사람 → 자동으로 다시 채우지 않음
  const manual = await store.get('manual:' + key) || await store.get('manual:' + g.name);
  if (manual) {
    if (!opts.keep && OWNER) limited(() => suggestBetter(g)).then(reviewCount).catch(() => {});   // 잠금 안 했으면 더 나은 사진 있는지 뒤에서 확인
    return { url: manual, ...(await store.get('manualpos:' + g.name) || {}), confirmed: true, locked: !!(await store.get('lock:' + g.name)) };
  }
  let cached = await store.get('photo7:' + key);
  if (!cached || !cached.url) {   // 이 직함으로는 처음 → 같은 이름으로 찾아 둔 사진이 있으면 그대로
    const alt = await autoByName(g.name);
    if (alt) { cached = { ...alt }; await store.set('photo7:' + key, cached); }
  }
  if (!OWNER) return cached && cached.url ? cached : { url: '' };   // 보기 전용: 관리자가 고른 사진만 보여주고, 직접 찾지 않음
  // 새 방식(유튜브 클립 확인, ver 2)으로 찾은 사진만 2주 유지. 예전 방식 사진·임시 사진은 먼저 보여주고 뒤에서 새로 찾아 교체
  const life = !cached ? 0 : !cached.url ? 6 * 3600000 : cached.ver === 2 ? (cached.temp ? 3600000 : 14 * 86400000) : cached.checked ? 3 * 86400000 : 0;
  const fresh = cached && Date.now() - cached.at < life;
  if (fresh) return cached;
  const myGen = opts.keep ? null : photoGen;   // keep: 화면이 바뀌어도 취소하지 않음 (미리 준비용)
  const job = limited(async () => {
    if (myGen !== null && myGen !== photoGen) return cached || { url: '' };   // 화면이 바뀌어서 필요 없어진 검색
    let rec = { url: '' }, isNew = false;
    try {
      const y = await identifyYT(g);                       // 1순위: 정치쇼 유튜브 클립
      if (y && y.url && !y.temp) rec = y;
      else {
        const w = await identify(g).catch(() => ({ url: '' }));   // 2순위: 인터넷 사진 대조
        rec = (w && w.url) ? w : (y && y.url ? y : { url: '' });
      }
      if (rec.cands) delete rec.cands; if (rec.vids) delete rec.vids;
      if (rec.url && rec.desc && hostDist(rec.desc, await hostBank()) < 0.48) rec = { url: '' };   // 진행자 얼굴이면 버림
      isNew = !!rec.url;
    } catch (e) {}
    if (!rec.url && cached && cached.url) rec = { ...cached };   // 새로 못 찾으면 예전 사진 유지
    if (myGen !== null && myGen !== photoGen) return rec;
    rec.at = Date.now();
    if (isNew) rec.ver = 2;            // 새 방식으로 찾은 사진
    rec.checked = Date.now();           // 새 방식으로 확인해 봄 (못 찾았으면 예전 사진 유지, 3일 뒤 다시)
    await store.set('photo7:' + key, rec);
    if (rec.url) schedulePush(opts.keep ? 60000 : 3000);
    return rec;
  });
  if (cached && cached.url) { job.then((r) => onUpdate && r.url !== cached.url && onUpdate(r)); return cached; }
  return job;
}
function setPhoto(box, p, name) {
  const info = typeof p === 'string' ? { url: p } : (p || {});
  box.textContent = '';
  box.classList.toggle('unsure', !info.url);
  if (info.url && info.crop) {
    // 장면 사진에서 얼굴 부분만 보여주기
    const c = info.crop, d = document.createElement('div');
    d.className = 'cropimg';
    d.style.backgroundImage = `url("${info.url}")`;
    d.style.backgroundSize = `${100 / c.w}% ${100 / c.h}%`;
    d.style.backgroundPosition = `${c.w < 1 ? (c.x / (1 - c.w)) * 100 : 0}% ${c.h < 1 ? (c.y / (1 - c.h)) * 100 : 0}%`;
    box.appendChild(d);
    const probe = new Image(); probe.onerror = () => { box.textContent = name.slice(-2); }; probe.src = info.url;
  } else if (info.url) {
    const img = document.createElement('img');
    img.referrerPolicy = 'no-referrer';
    img.alt = name;
    img.src = info.url;
    if (info.cy != null) img.style.objectPosition = `${Math.round((info.cx ?? 0.5) * 100)}% ${Math.round(Math.min(info.cy, 0.6) * 100)}%`;
    img.onerror = () => { if (info.alt && img.src !== info.alt) img.src = info.alt; else box.textContent = name.slice(-2); };
    box.appendChild(img);
  } else {
    box.append(el('div', 'ini', name.slice(-2)), el('div', 'need', '사진 확인 필요'));
  }
  if (info.url && info.temp) box.append(el('span', 'tempbadge', '임시'));
  if (info.url && info.locked) box.append(el('span', 'lockbadge', '🔒'));
  box.dispatchEvent(new Event('photoset'));
}

// ───────── 사진 고르기 창 ─────────
async function daumPhotos(g, max = 6) {
  const docs = await daumImages(g, 'recency', 30);
  docs.sort((a, b) => (b.collection === 'news') - (a.collection === 'news'));
  return docs.slice(0, max);
}
// 직접 찾은 사진 등록: 이미지 주소 붙여넣기 / 이미지 복사 후 Ctrl+V / 파일 선택
async function blobToSmallDataUrl(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}
function manualBar(g, pick) {
  const bar = el('div', 'mbar');
  const q = encodeURIComponent(`${g.name} ${g.role}`.trim());
  const gBtn = el('button', null, '구글에서 직접 찾기'); gBtn.onclick = () => openPickSearch('https://www.google.com/search?udm=2&q=' + q, g, pick);
  const nBtn = el('button', null, '네이버에서 직접 찾기'); nBtn.onclick = () => openPickSearch('https://search.naver.com/search.naver?where=image&query=' + q, g, pick);
  const inp = document.createElement('input'); inp.placeholder = '이미지 주소 붙여넣기, 또는 사진을 복사한 뒤 여기서 Ctrl+V';
  const ok = el('button', 'primary', '등록');
  ok.onclick = () => { const u = inp.value.trim(); if (/^(https?:|data:image)/.test(u)) pick(u); else inp.focus(); };
  inp.onkeydown = (e) => { if (e.key === 'Enter') ok.onclick(); };
  inp.onpaste = async (e) => {
    const item = [...(e.clipboardData && e.clipboardData.items || [])].find((x) => x.type.startsWith('image/'));
    if (item) { e.preventDefault(); inp.value = '사진 등록 중…'; pick(await blobToSmallDataUrl(item.getAsFile())); }
  };
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
  file.onchange = async () => { if (file.files[0]) pick(await blobToSmallDataUrl(file.files[0])); };
  const fBtn = el('button', null, '내 PC 사진 선택'); fBtn.onclick = () => file.click();
  const row1 = el('div', 'mrow'); row1.append(gBtn, nBtn, fBtn, file);
  const row2 = el('div', 'mrow'); row2.append(inp, ok);
  bar.append(el('div', 'mtitle', '원하는 사진이 없으면 직접 등록'), row1, row2,
    el('div', 'mhelp', '구글·네이버 창에서 사진에 마우스를 올리면 [✔ 이 사진으로] 버튼이 떠요. 누르면 바로 등록돼요. 또는 사진에서 우클릭 → "이미지 주소 복사" 후 붙여넣거나, "이미지 복사" 후 위 칸에서 Ctrl+V 하세요.'));
  return bar;
}
function openPicker(g, ph) {
  if (!OWNER) return;   // 보기 전용
  const ov = el('div', 'overlay');
  const box = el('div', 'picker');
  box.append(el('div', 'ptitle', `${g.name} 사진 고르기`), el('div', 'psub', `검색어 "${g.name} ${g.role}" · 클릭하면 이 사진으로 고정돼요`));
  const grid = el('div', 'pgrid');
  const close = el('button', 'pclose', '닫기'); close.onclick = () => ov.remove();
  box.append(grid, close); ov.append(box);
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  document.body.append(ov);
  const identDesc = store.get('photo7:' + `${g.name}|${g.role}`).then((r) => (r && r.desc) || null);
  const pick = async (u) => {
    ov.remove();
    await store.set('manual:' + g.name, u);
    await store.set('mt:' + g.name, Date.now()); await chrome.storage.local.remove('mauto:' + g.name);
    await chrome.storage.local.remove('none:' + g.name);
    const a = await analyze(u);
    const pos = a && a.faces.length ? { cx: a.faces[0].cx, cy: a.faces[0].cy } : {};
    await store.set('manualpos:' + g.name, pos);
    if (a && a.faces.length === 1) await store.set('fd:' + g.name, a.faces[0].desc);   // 얼굴 장부
    setPhoto(ph, { url: u, ...pos }, g.name);
    schedulePush();
  };
  const section = (title) => {
    const head = el('div', 'psec', title); const wait = el('div', 'pmsg', '찾는 중…'); const end = el('div', 'pend');
    grid.append(head, wait, end); return { wait, end };
  };
  const addItem = (sec, it) => {
    const wrap = el('div', 'pitem');
    const im = document.createElement('img');
    im.referrerPolicy = 'no-referrer'; im.src = it.url; im.title = (it.text || it.site || '') + '\n\n클릭하면 이 사진으로 고정';
    im.onerror = () => { if (it.thumb && im.src !== it.thumb) { im.src = it.thumb; it.url = it.thumb; } else wrap.remove(); };
    im.onclick = () => pick(it.url);
    wrap.append(im);
    if (it.date) wrap.append(el('span', 'pdate', it.date));
    if (it.text) wrap.append(el('div', 'pcap', it.text.slice(0, 60)));
    sec.end.before(wrap);
    analyze(it.thumb && !/pstatic/.test(it.url) ? it.thumb : it.url).then(async (a) => {
      if (a && !isPortrait(a)) { wrap.classList.add('noface'); wrap.append(el('span', 'pbadge', '얼굴 없음')); return; }
      const ident = await identDesc;
      if (a && ident && a.faces.some((f) => dist(f.desc, ident) < SAME)) wrap.append(el('span', 'pbadge same', '같은 얼굴'));
    });
  };
  box.insertBefore(manualBar(g, pick), grid);
  const n = section('뉴스 기사 사진 (최신순 · 기사에 이름이 나온 것 먼저)');
  const d = section('다음 최신 이미지');
  const gg = section('구글 이미지');
  googleImages(g).then((list) => {
    if (!list.length) { gg.wait.textContent = '결과가 없어요.'; return; }
    gg.wait.remove(); for (const u of list.slice(0, 9)) addItem(gg, { url: u });
  });
  newsCandidates({ ...g }).then((list) => {
    if (!list.length) { n.wait.textContent = '결과가 없어요.'; return; }
    n.wait.remove(); for (const it of list.slice(0, 9)) addItem(n, it);
  });
  daumPhotos(g).then((list) => {
    if (!list.length) { d.wait.textContent = '결과가 없어요.'; return; }
    d.wait.remove(); for (const it of list) addItem(d, it);
  }).catch((e) => { d.wait.textContent = e.message + ' — 키를 확인해 주세요.'; });
}

// ───────── 화면 그리기 ─────────
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function render(post) {
  photoGen++;
  current = post;
  $('#dateLabel').textContent = prettyDate(post.date);
  const main = $('#main'); main.textContent = '';

  // 한눈 요약
  const sum = el('div', 'summary');
  const all = post.parts.flatMap((p) => p.corners.flatMap((c) => c.guests.map((g) => ({ ...g, part: p.label }))));
  sum.innerHTML = '';
  sum.append(el('b', null, `총 ${all.length}명 출연 `));
  for (const p of post.parts) {
    const names = p.corners.flatMap((c) => c.guests.map((g) => g.name));
    const line = el('div');
    line.append(el('b', null, `${p.label}${p.time ? ' (' + p.time + ')' : ''} : `), document.createTextNode(names.join(', ') || '—'));
    sum.append(line);
  }
  main.append(sum);

  if (!post.parts.length) {
    main.append(el('p', null, '출연자 줄(- 이름 직함)을 찾지 못했어요. 아래 원문을 확인하세요.'));
  }

  for (const p of post.parts) {
    const sec = el('section', 'part');
    const h = el('h2', null, p.label);
    if (p.time) h.append(el('span', 'time', p.time));
    sec.append(h);
    for (const c of p.corners) {
      const box = el('div', 'corner');
      if (c.name) box.append(el('div', 'cname', `[${c.name}]`));
      if (c.topic) box.append(el('div', 'topic', c.topic));
      const grid = el('div', 'guests');
      for (const g of c.guests) {
        const card = el('div', 'guest');
        const ph = el('div', 'photo', g.name.slice(-2));
        const info = el('div');
        info.append(el('div', 'gname', g.name), el('div', 'grole', g.role));
        const tools = el('div', 'gtools');
        const a = el('a', null, '검색'); a.href = 'https://search.naver.com/search.naver?query=' + encodeURIComponent(`${g.name} ${g.role}`); a.target = '_blank';
        const b = el('button', null, '주소 입력');
        b.onclick = async () => {
          const u = prompt(`${g.name} 사진 주소(이미지 URL)를 붙여넣으세요.\n비우고 확인하면 자동 검색으로 되돌립니다.`, '');
          if (u === null) return;
          const k = 'manual:' + g.name;
          if (u.trim()) { await store.set(k, u.trim()); await store.set('mt:' + g.name, Date.now()); await chrome.storage.local.remove('mauto:' + g.name); await chrome.storage.local.remove(['manualpos:' + g.name, 'none:' + g.name]); setPhoto(ph, u.trim(), g.name); schedulePush(); }
          else { await chrome.storage.local.remove(['mt:' + g.name, 'manualpos:' + g.name, k, `manual:${g.name}|${g.role}`, `photo7:${g.name}|${g.role}`]); setPhoto(ph, await getPhoto({ ...g, topic: c.topic }), g.name); }
        };
        const c = el('button', 'latest', '최신 사진');
        c.onclick = () => openPicker(g, ph);
        ph.title = '누르면 크게 보기';   // 사진 고르기는 [최신 사진] 버튼으로
        const del = el('button', 'del', '사진 지우기');
        del.onclick = async () => {
          if (!confirm(`${g.name} 사진을 지울까요?\n지운 뒤에는 자동으로 다시 채우지 않고, [최신 사진]에서 새로 고를 때까지 비워둬요.`)) return;
          await chrome.storage.local.remove(['manual:' + g.name, 'manualpos:' + g.name, 'mt:' + g.name, `manual:${g.name}|${g.role}`]);
          await store.set('none:' + g.name, Date.now());
          setPhoto(ph, {}, g.name);
          schedulePush();
        };
        // 🔒 잠금: 내가 넣은 사진을 자동 개선(유튜브 검색)에서 빼기
        const lock = el('button', null, '');
        const paintLock = async () => {
          const st = await chrome.storage.local.get(['manual:' + g.name, 'lock:' + g.name]);
          lock.style.display = st['manual:' + g.name] ? '' : 'none';
          lock.textContent = st['lock:' + g.name] ? '🔒 잠김' : '🔓 잠금';
          lock.title = st['lock:' + g.name] ? '잠김: 이 사진은 자동으로 더 나은 사진을 찾지 않아요. 누르면 해제' : '누르면 이 사진을 고정해서 자동 개선에서 빼요';
          lock.classList.toggle('latest', !!st['lock:' + g.name]);
        };
        lock.onclick = async () => {
          const on = !(await store.get('lock:' + g.name));
          if (on) { await store.set('lock:' + g.name, Date.now()); await chrome.storage.local.remove('sug:' + g.name); }
          else await chrome.storage.local.remove('lock:' + g.name);
          await store.set('mt:' + g.name, Date.now());   // 다른 PC·폰에도 잠금 상태 전달
          schedulePush(); paintLock(); reviewCount();
          status(on ? `${g.name} 사진을 잠갔어요. 자동으로 바꾸거나 제안하지 않아요.` : `${g.name} 잠금을 풀었어요. 더 나은 사진이 보이면 [사진 검토]에 제안해요.`);
        };
        paintLock(); ph.addEventListener('photoset', paintLock);
        if (OWNER) tools.append(c, lock, b, del, a); else { tools.append(a); }   // 보기 전용: [검색]만
        info.append(tools);
        card.append(ph, info); grid.append(card);
        ph.classList.add('loading'); ph.textContent = ''; ph.append(el('div', 'ini', g.name.slice(-2)), el('div', 'need', '사진 찾는 중…'));
        getPhoto({ ...g, topic: c.topic }, (r) => setPhoto(ph, r, g.name)).then((u) => { ph.classList.remove('loading'); setPhoto(ph, u, g.name); });
      }
      box.append(grid); sec.append(box);
    }
    main.append(sec);
  }

  const raw = el('details', 'raw');
  raw.append(el('summary', null, '작가 원문 보기'), el('pre', null, `${post.title}\n\n${post.body}`));
  main.append(raw);

  status(`작가 등록 ${post.registered || '-'} · 불러온 시각 ${new Date(post.fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`);
  // 코너 주제·요약 속 용어와 한자(李·尹·與野 등)에 밑줄 → 누르면 설명
  main.querySelectorAll('.topic, .cname, .summary').forEach((e) => { if (window.jcsMarkTerms) window.jcsMarkTerms(e); if (window.jcsMarkHanja) window.jcsMarkHanja(e); });
  document.dispatchEvent(new CustomEvent('jcsrender'));   // 양옆 방송 패널 갱신
}

// ───────── 날짜 선택 / 아직 안 올라온 경우 ─────────
const CHECK_MIN = 3;           // 대기 중 자동 확인 간격(분)
let waitTimer = null;

function fillSelect(selected) {
  const sel = $('#dateSel'); sel.textContent = '';
  const today = todayStr();
  if (!posts.some((p) => p.date === today)) {
    const o = el('option', null, prettyDate(today) + ' · 오늘 (아직 안 올라옴)');
    o.value = today; sel.append(o);
  }
  for (const p of posts) {
    const o = el('option', null, prettyDate(p.date) + (p.date === today ? ' · 오늘' : ''));
    o.value = p.date; sel.append(o);
  }
  sel.value = selected || today;
}

function waitingMessage(date) {
  const now = new Date();
  const dow = new Date(date + 'T00:00:00').getDay();
  if (dow === 0 || dow === 6) return { head: '오늘은 주말이에요', text: `${PROG.nameIs} 월~금 방송이라 오늘은 출연자 글이 없어요.`, auto: false };
  const hm = now.getHours() * 60 + now.getMinutes();
  if (hm < PROG.usual) return { head: '아직 작가님이 오늘 출연자를 올리지 않았어요', text: '이 창을 열어두면 자동으로 확인해서, 올라오는 즉시 보여드릴게요.', auto: true };
  if (hm < PROG.on) return { head: '아직 작가님이 오늘 출연자를 올리지 않았어요', text: `평소보다 조금 늦어지고 있어요. 방송 시작(${hhmmStr(PROG.on)}) 전까지 자동으로 계속 확인할게요.`, auto: true };
  if (hm < PROG.off) return { head: '방송이 시작됐는데 아직 출연자 글이 없어요', text: '작가가 많이 늦어지고 있어요. 자동 확인은 계속하고 있고, 급하면 [원문 보기]로 게시판을 직접 확인해 보세요.', auto: true };
  return { head: '오늘 출연자 글이 올라오지 않았어요', text: `방송 시간(${PROG_TIME})은 지났어요. 결방이나 특집 편성일 수 있어요.`, auto: true };
}

function renderWaiting(date, extraNote) {
  current = null;
  setTimeout(() => document.dispatchEvent(new CustomEvent('jcsrender')), 0);
  $('#dateLabel').textContent = prettyDate(date);
  const msg = waitingMessage(date);
  const main = $('#main'); main.textContent = '';
  const box = el('div', 'waiting');
  box.append(el('div', 'whead', msg.head), el('div', 'wtext', extraNote || msg.text));
  const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  box.append(el('div', 'wtime', msg.auto ? `마지막 확인 ${t} · ${(() => { const n = new Date(), hm = n.getHours() * 60 + n.getMinutes(); return hm >= PROG.fastFrom && hm < PROG.on ? '30초' : CHECK_MIN + '분'; })()}마다 자동 확인 중` : `마지막 확인 ${t}`));
  main.append(box);
  status('');
  clearTimeout(waitTimer);
  if (msg.auto && date === todayStr()) { const n = new Date(), hm = n.getHours() * 60 + n.getMinutes(); waitTimer = setTimeout(() => init(true), hm >= PROG.fastFrom && hm < PROG.on ? 30000 : CHECK_MIN * 60000); }
}

async function show(date, force = false, skipKey = '') {
  clearTimeout(waitTimer);
  try {
    const p = posts.find((x) => x.date === date);
    if (!p) {
      if (date === todayStr()) return renderWaiting(date);
      throw new Error('해당 날짜 글이 목록에 없습니다.');
    }
    let post = await store.get('post:' + date);
    // 작가가 글을 고쳤으면(수정시각 변경) 다시 받기
    if (force || !post || post.pv !== PARSER_V || (p.updated && post.updated !== p.updated)) post = await fetchPost(p);
    fillSelect(date);
    if (!post.parts.length && date === todayStr()) {
      return renderWaiting(date, '오늘 글은 올라왔는데 출연자 명단이 아직 비어 있어요. 작가가 작성 중일 수 있어요. 자동으로 다시 확인할게요.');
    }
    if (skipKey && skipKey === date + '|' + (post.updated || '')) return true;   // 이미 저장본으로 그려 둔 것과 같음 → 다시 그리지 않음
    render(post);
  } catch (e) { status(e.message, true); }
}


// ───────── 보고 있던 화면 기억 (새로고침·F5·당겨서 새로고침 후에도 같은 날짜·같은 위치) ─────────
function saveView() {
  try {
    const date = $('#dateSel').value; if (!date) return;
    const p = posts.find((x) => x.date === date);
    sessionStorage.setItem('jcsView', JSON.stringify({ date, y: window.scrollY, post: p || null }));
  } catch (e) {}
}
function loadView() { try { return JSON.parse(sessionStorage.getItem('jcsView') || 'null'); } catch (e) { return null; } }
let viewTimer = null;
window.addEventListener('scroll', () => { clearTimeout(viewTimer); viewTimer = setTimeout(saveView, 200); }, { passive: true });
function restoreScroll(y) {
  if (!y) return;
  window.scrollTo(0, y);
  setTimeout(() => window.scrollTo(0, y), 400);    // 사진이 들어오며 높이가 바뀌어도 한 번 더 맞춤
  setTimeout(() => window.scrollTo(0, y), 1200);
}
async function init(force = false) {
  if (window.jcsIsMember && !window.jcsIsMember()) return;   // 가입 전에는 아무것도 안 함
  OWNER = !window.JCS_WEB && !!(await getGhToken().catch(() => ''));   // 웹으로 열면 항상 보기 전용
  document.documentElement.classList.toggle('viewer', !OWNER);
  if (!OWNER) { $('#sync').textContent = '🔑 관리자 로그인'; $('#sync').title = '관리자만 사진을 바꿀 수 있어요'; }
  try {
    // 새로고침: 보고 있던 날짜를 그대로 유지 (처음 열 때만 오늘)
    // [새로고침] 버튼이면 지금 화면, 브라우저 새로고침(F5·당겨서)이면 직전에 보던 화면을 유지
    const saved = loadView();
    const keep = force ? $('#dateSel').value : (saved && saved.date) || '';
    const keepY = force ? window.scrollY : (saved && saved.y) || 0;
    const keepPost = keep && (posts.find((p) => p.date === keep) || (saved && saved.date === keep && saved.post));
    const cached = await store.get('posts_v2');
    if (cached && !force) { posts = cached; fillSelect(); }
    // 빠른 시작: 저장해 둔 내용을 먼저 바로 보여주고, 인터넷 확인은 그 뒤에
    let quick = '';
    if (!force) {
      const tgt = keep || todayStr(), qp = await store.get('post:' + tgt);
      if (qp && qp.pv === PARSER_V && qp.parts && qp.parts.length) { fillSelect(tgt); render(qp); restoreScroll(keepY); quick = tgt + '|' + (qp.updated || ''); }
    }
    // API가 빨라서 열 때마다 목록은 새로 확인 (실패하면 저장된 목록 사용)
    const [, pulled] = await Promise.all([
      fetchList().catch((e) => { if (!posts.length) throw e; }),
      withTimeout(syncPull(true), 4000, false),   // 폰·다른 PC에서 바꾼 사진 받아오기
    ]);
    if (keepPost && !posts.some((p) => p.date === keep)) { posts.push(keepPost); posts.sort((a, b) => b.date.localeCompare(a.date)); }
    const target = keep || todayStr();
    fillSelect(target);
    const same = await show(target, force, pulled ? '' : quick);   // [새로고침]이면 그 날짜 내용도 새로 받아옴
    if (!same && !quick) restoreScroll(keepY);
    saveView();
  } catch (e) { status(e.message, true); }
}

$('#dateSel').onchange = async (e) => { await show(e.target.value); window.scrollTo(0, 0); saveView(); };
$('#refresh').onclick = () => init(true);
$('#today').onclick = async () => { fillSelect(todayStr()); await show(todayStr()); window.scrollTo(0, 0); saveView(); };
$('#openPost').onclick = () => { if (current && current.url) openTab(current.url); else openTab(LIST_URL); };
$('#print').onclick = () => window.print();
// 인쇄: 내용이 많아도 A4 한 장에 다 들어가도록 전체를 줄임 (버튼·Ctrl+P 모두)
const PRINT_H = 1030;   // A4 세로 297mm - 위아래 여백 20mm ≈ 1047px, 약간 여유
function fitPrint() {
  const h = document.documentElement;
  h.classList.add('printing'); document.body.style.zoom = '';
  const H = document.body.getBoundingClientRect().height;
  document.body.style.zoom = H > PRINT_H ? String(Math.floor((PRINT_H / H) * 1000) / 1000) : '';
}
window.addEventListener('beforeprint', fitPrint);
window.addEventListener('afterprint', () => { document.documentElement.classList.remove('printing'); document.body.style.zoom = ''; });

// ───────── 사진 백업 / 복원 (PC ↔ 휴대폰 공용 파일) ─────────
// 파일 형식: { app:'jcs-photos', version:1, photos:{ 이름:{url,cx,cy} }, none:[지운 사람] }

// ───────── 사진 합치기 규칙 (백업·연동 공통) ─────────
// 형식: { photos:{ 이름:{url,cx,cy,t} }, none:{ 이름:t } }  t = 직접 고른/지운 시각 (자동으로 찾은 사진은 0)
function normPhotos(d) {
  const photos = {}, none = {};
  for (const [n, p] of Object.entries((d && d.photos) || {})) if (p && p.url) photos[n] = { url: p.url, cx: p.cx, cy: p.cy, crop: p.crop, t: typeof p.t === 'number' ? p.t : 1, ...(p.auto ? { auto: 1 } : {}), ...(p.lock ? { lock: 1 } : {}) };
  const nn = (d && d.none) || {};
  if (Array.isArray(nn)) nn.forEach((n) => { none[n] = 1; }); else for (const [n, t] of Object.entries(nn)) none[n] = typeof t === 'number' ? t : 1;
  const chk = {};   // 사람별 '새 방식으로 확인한 시각' — 다른 PC가 같은 사람을 또 찾지 않게
  for (const [n, t] of Object.entries((d && d.chk) || {})) if (typeof t === 'number') chk[n] = t;
  return { photos, none, chk };
}
// src에서 target보다 새로운 것만 골라냄 (force면 전부)
// srcWinsTie: 같은 시각(옛 기록끼리 등)이면 src 쪽을 따름 → 받아올 때는 GitHub(공용) 사진으로 맞춰짐
function diffPhotos(target, src, force, srcWinsTie = false) {
  const out = [];
  const cur = (n) => Math.max(target.photos[n] ? target.photos[n].t : -1, n in target.none ? target.none[n] : -1);
  for (const [n, p] of Object.entries(src.photos)) {
    const c = cur(n), tp = target.photos[n];
    // 같은 사진이어도 '검토 대기 → 확인됨'이나 잠금이 바뀌었으면 전달해야 함
    if (tp && tp.url === p.url && !!tp.lock === !!p.lock && !!tp.auto === !!p.auto && !(n in target.none)) continue;
    if (!force && p.auto && tp && !tp.auto) continue;   // 자동으로 찾은 사진은 사람이 확인한 사진을 덮지 않음
    if (force || c < 0 || p.t > c || (srcWinsTie && p.t === c)) out.push({ kind: 'photo', name: n, p });
  }
  for (const [n, t] of Object.entries(src.none)) {
    if (n in target.none && !target.photos[n]) continue;
    if (force || t > cur(n) || (srcWinsTie && t === cur(n))) out.push({ kind: 'none', name: n, t });
  }
  return out;
}
function applyDiff(state, diff) {
  for (const d of diff) {
    if (d.kind === 'photo') { state.photos[d.name] = d.p; delete state.none[d.name]; }
    else { state.none[d.name] = d.t; delete state.photos[d.name]; }
  }
  return state;
}
async function exportPhotos() {
  const all = await chrome.storage.local.get(null);
  const photos = {}, none = {};
  for (const [k, v] of Object.entries(all)) {   // 자동으로 찾은 사진 (t=0)
    if (k.startsWith('photo7:') && v && v.url) photos[k.slice(7).split('|')[0]] = { url: v.url, cx: v.cx, cy: v.cy, crop: v.crop, t: v.at || 0, auto: 1 };
  }
  for (const [k, v] of Object.entries(all)) {
    // mauto: 다른 PC가 자동으로 찾아 넘겨준, 아직 사람이 확인 안 한 사진
    if (k.startsWith('manual:') && !k.includes('|') && v) { const n = k.slice(7); photos[n] = { url: v, ...(all['manualpos:' + n] || {}), t: all['mt:' + n] || 1, ...(all['mauto:' + n] ? { auto: 1 } : {}), ...(all['lock:' + n] ? { lock: 1 } : {}) }; }
    if (k.startsWith('none:') && v) none[k.slice(5)] = v === true ? 1 : v;
  }
  for (const n of Object.keys(none)) delete photos[n];
  const chk = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith('chk:') && typeof v === 'number') chk[k.slice(4)] = v;
  return { app: 'jcs-photos', version: 3, savedAt: new Date().toISOString(), photos, none, chk };
}
// 합치기: force=true(백업 복원)면 파일 내용으로 덮어쓰고, 아니면 더 최신 것만 반영
async function importPhotos(data, force = true) {
  if (!data || data.app !== 'jcs-photos') throw new Error('정치쇼 사진 백업 파일이 아니에요.');
  const diff = diffPhotos(normPhotos(await exportPhotos()), normPhotos(data), force, !force);
  // 백업 복원은 '지금 직접 고른 것'으로 취급 → 다른 기기 사진보다 최신이 되어 연동에서 이김
  if (force) { const now = Date.now(); for (const d of diff) { if (d.kind === 'photo') d.p = { ...d.p, t: now }; else d.t = now; } }
  const set = {}, del = [];
  for (const d of diff) {
    if (d.kind === 'photo') {
      set['manual:' + d.name] = d.p.url; set['manualpos:' + d.name] = d.p.crop ? { crop: d.p.crop } : d.p.cy != null ? { cx: d.p.cx, cy: d.p.cy } : {}; set['mt:' + d.name] = d.p.t;
      del.push('none:' + d.name);
      if (d.p.auto) set['mauto:' + d.name] = 1; else del.push('mauto:' + d.name);   // 확인 안 된 사진은 이 PC에서도 '검토 대기'로
      if (d.p.lock) set['lock:' + d.name] = d.p.t || 1; else del.push('lock:' + d.name);
    } else { set['none:' + d.name] = d.t; del.push('manual:' + d.name, 'manualpos:' + d.name, 'mt:' + d.name, 'mauto:' + d.name); }
  }
  // 확인 기록은 더 최근 것으로 합치기
  const local = await chrome.storage.local.get(null);
  for (const [n, t] of Object.entries(normPhotos(data).chk)) if (!(local['chk:' + n] >= t)) set['chk:' + n] = t;
  if (del.length) await chrome.storage.local.remove(del);
  if (Object.keys(set).length) await chrome.storage.local.set(set);
  return diff.length;
}
$('#backup').onclick = async () => {
  const data = await exportPhotos();
  const n = Object.keys(data.photos).length;
  if (!n) { alert('저장할 사진이 아직 없어요.'); return; }
  const d = new Date(), name = `정치쇼사진백업_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = name; a.click();
  status(`사진 ${n}명분을 "${name}" 파일로 저장했어요. (다운로드 폴더)`);
};

const syncGet = (k) => store.get(k);
const syncSet = (k, v) => store.set(k, v);
async function getGhToken() { return (await store.get('ghToken')) || (typeof GITHUB_TOKEN !== 'undefined' ? GITHUB_TOKEN : ''); }

// ───────── PC ↔ 휴대폰 사진 자동 연동 (GitHub jcs 저장소의 photos.json) ─────────
const SYNC_URL = 'https://api.github.com/repos/rokaf072/jcs/contents/photos.json';
function utf8b64(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function fetchRemote(tok) {
  const res = await fetch(SYNC_URL, { cache: 'no-store', headers: { Accept: 'application/vnd.github.raw+json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) } })
    .catch(() => { throw new Error('GitHub에 접속하지 못했어요. 인터넷 연결을 확인해 주세요.'); });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('연동 사진을 읽지 못했어요 (' + res.status + ')');
  return res.json();
}
// 받아오기: 다른 기기에서 더 나중에 고르거나 지운 것만 반영 (이름별로 합침)
async function syncPull(silent) {
  try {
    const remote = await fetchRemote(await getGhToken());
    if (!remote) { if (!silent) status('아직 연동된 사진이 없어요. PC에서 [폰 연동]을 먼저 눌러 주세요.'); return 0; }
    const n = await importPhotos(remote, false);
    if (!silent) status(n ? `연동된 사진 ${n}건을 받아왔어요.` : '이미 최신이에요. 새로 받을 사진이 없어요.');
    return n;
  } catch (e) { if (!silent) status(e.message, true); return 0; }
}
// 올리기: GitHub에 있는 것과 내 것을 이름별로 합쳐서 저장 (다른 기기 사진을 지우지 않음)
// 올리기는 한 번에 하나씩만 (자동 올리기와 [폰 연동] 버튼이 동시에 올려서 겹치지 않게)
let pushChain = Promise.resolve();
function syncPush() { const p = pushChain.then(syncPushOnce); pushChain = p.catch(() => {}); return p; }
async function syncPushOnce() {
  const tok = await getGhToken();
  if (!tok) return 0;
  const h = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' };
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));   // 겹치면 조금씩 더 기다렸다가 다시
    const cur = await fetch(SYNC_URL + '?ref=main&t=' + Date.now(), { cache: 'no-store', headers: h }).catch(() => { throw new Error('GitHub에 접속하지 못했어요. 인터넷 연결을 확인해 주세요.'); });
    if (cur.status === 401 || cur.status === 403) throw new Error('GitHub 키가 맞지 않아요. 키를 다시 입력해 주세요.');
    let sha, remote = { photos: {}, none: {} };
    if (cur.ok) { const j = await cur.json(); sha = j.sha; try { remote = normPhotos(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))))); } catch (e) { const r = await fetchRemote(tok); if (r) remote = normPhotos(r); } }
    const mine = normPhotos(await exportPhotos());
    const diff = diffPhotos(remote, mine, false);
    const chkNew = Object.entries(mine.chk).filter(([n, t]) => !(remote.chk[n] >= t));
    if (sha && !diff.length && !chkNew.length) return Object.keys(remote.photos).length;   // 바뀐 것 없음
    const merged = applyDiff(remote, diff);
    for (const [n, t] of chkNew) merged.chk[n] = t;
    const body = { app: 'jcs-photos', version: 3, savedAt: new Date().toISOString(), photos: merged.photos, none: merged.none, chk: merged.chk };
    const res = await fetch(SYNC_URL, { method: 'PUT', headers: h,
      body: JSON.stringify({ message: '사진 연동 ' + body.savedAt, content: utf8b64(JSON.stringify(body)), ...(sha ? { sha } : {}) }) });
    if (res.ok) return Object.keys(merged.photos).length;
    if (res.status === 409 || res.status === 422) continue;   // 그 사이 다른 기기가 올림 → 다시 합쳐서 시도
    throw new Error(res.status === 401 || res.status === 403 || res.status === 404 ? 'GitHub 키가 맞지 않아요. 키를 다시 입력해 주세요.' : '연동 업로드 실패 (' + res.status + ')');
  }
  throw new Error('연동 업로드가 겹쳤어요. 잠시 뒤 다시 해 주세요.');
}
// ───────── 실시간 자동 연동: 다른 기기에서 사진이 바뀌면 열어둔 화면에 알아서 반영 ─────────
let liveEtag = null, liveBusy = false;
async function liveTick() {
  if (liveBusy || document.hidden || document.querySelector('.overlay')) return;   // 사진 고르는 중엔 건드리지 않음
  liveBusy = true;
  try {
    const tok = await getGhToken();
    const res = await fetch(SYNC_URL, { cache: 'no-store', headers: { Accept: 'application/vnd.github.raw+json',
      ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(liveEtag ? { 'If-None-Match': liveEtag } : {}) } });
    if (res.status === 304 || !res.ok) return;   // 바뀐 것 없음
    liveEtag = res.headers.get('ETag');
    const n = await importPhotos(await res.json(), false);
    if (n && current) {
      const y = window.scrollY;
      render(current);
      window.scrollTo(0, y);
      status(`다른 기기에서 바뀐 사진 ${n}건을 자동으로 반영했어요.`);
    }
  } catch (e) { /* 인터넷이 잠깐 끊겨도 다음에 다시 확인 */ }
  finally { liveBusy = false; }
}
async function startLiveSync() {
  const every = (await getGhToken()) ? 30000 : 90000;   // 키가 있으면 30초, 없으면 1분 30초마다 확인
  setInterval(liveTick, every);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) liveTick(); });   // 앱·창으로 돌아오면 바로 확인
  window.addEventListener('focus', liveTick);
}

let pushTimer = null;
// 자동 올리기: 직접 고른 사진은 3초 뒤, 장부 채우기에서 찾은 사진은 1분씩 모아서 한 번에 (GitHub에 너무 자주 올리면 겹침)
let pushDue = 0;
function schedulePush(delay = 3000) {
  const due = Date.now() + delay;
  if (pushTimer && pushDue && pushDue <= due) return;   // 이미 더 빨리 올리기로 되어 있음
  clearTimeout(pushTimer); pushDue = due;
  pushTimer = setTimeout(async () => {
    pushTimer = null; pushDue = 0;
    if (!(await getGhToken())) return;
    syncPush().then((n) => { if (n) status(`사진을 다른 기기와 연동했어요.`); })
      .catch((e) => { if (/키가 맞지/.test(e.message)) status(e.message, true); else schedulePush(60000); });   // 겹침·접속 문제는 조용히 1분 뒤 다시
  }, delay);
}
// ───────── 지난 출연자 사진 모두 준비 ─────────
let prefetching = false;
$('#prefetch').onclick = async () => {
  if (prefetching) return;
  const ans = prompt('최근 몇 회 방송의 출연자 사진을 미리 찾아둘까요?\n(숫자 입력: 16 / 50 / 100 / 300)\n\n· 이미 사진이 있는 사람은 건너뛰어요.\n· 처음엔 사람 수에 따라 몇 분~수십 분 걸려요. 그동안 다른 날짜를 봐도 괜찮아요.', '50');
  if (ans === null) return;
  const count = Math.max(1, Math.min(INDEX_MAX, parseInt(ans, 10) || 50));
  prefetching = true;
  const btn = $('#prefetch'); btn.disabled = true;
  try {
    // 1) 출연자 검색용으로 모아둔 지난 방송 명단 사용 (없으면 지금 모음)
    btn.textContent = '지난 방송 명단 확인 중…';
    const idx = await ensureIndex(() => { if (indexProgress) btn.textContent = indexProgress.replace('지난 방송 ', ''); });
    const recent = Object.values(idx).sort((a, b) => b.d.localeCompare(a.d)).slice(0, count);
    const guests = new Map();
    for (const p of recent) for (const [name, role, corner] of p.g) if (name && !guests.has(name)) guests.set(name, { name, role, topic: corner });
    // 2) 사진이 아직 없는 사람만 찾기 (직접 고른·지운·이미 찾은 사람은 건너뜀)
    const all = await chrome.storage.local.get(null);
    // 예전 방식으로 찾은 사진도 새 방식으로 다시 확인
    const haveV2 = new Set(Object.entries(all).filter(([k, v]) => k.startsWith('photo7:') && v && v.url && v.ver === 2 && !v.temp).map(([k]) => k.slice(7).split('|')[0]));   // 직함만 다른 같은 사람은 다시 찾지 않음
    const todo = [...guests.values()].filter((g) => !all['manual:' + g.name] && !all['none:' + g.name] && !all['notguest:' + g.name] && !haveV2.has(g.name));
    let done = 0, found = 0;
    const total = todo.length;
    btn.textContent = `사진 찾는 중 0/${total}`;
    await Promise.all(todo.map((g) => getPhoto(g, null, { keep: true }).then((r) => {
      done++; if (r && r.url) found++;
      btn.textContent = `사진 찾는 중 ${done}/${total}`;
    })));
    status(`최근 ${recent.length}회 방송 · 출연자 ${guests.size}명 확인 완료 · 새로 사진 찾음 ${found}명` + (total - found ? ` · 못 찾은 ${total - found}명은 '사진 확인 필요'로 표시돼요` : '') + '. 찾은 사진을 한 명씩 확인해 주세요.');
    schedulePush();
    if (current) render(current);
    if (found) setTimeout(openReview, 300);   // 찾은 사진은 바로 검토 화면으로
  } catch (e) { status(e.message, true); }
  finally { prefetching = false; btn.disabled = false; btn.textContent = '지난 출연자 사진 준비'; }
};

// ───────── 사진 검토: 자동으로 찾은 사진을 사람이 한 번 확인 ─────────
async function unconfirmedAutos() {
  const all = await chrome.storage.local.get(null);
  const out = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('photo7:') || !v || !v.url) continue;
    const [name, role] = k.slice(7).split('|');
    if (all['manual:' + name] || all['none:' + name]) continue;   // 직접 고른·지운 사람은 이미 확인된 것
    out.push({ key: k, name, role, url: v.url, cx: v.cx, cy: v.cy, crop: v.crop, desc: v.desc, temp: v.temp, at: v.at || 0 });
  }
  // 내가 넣은 사진(잠금 안 함)보다 나은 사진 제안
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('sug:') || !v || !v.url) continue;
    const name = k.slice(4);
    if (!all['manual:' + name] || all['lock:' + name] || all['none:' + name]) continue;
    out.push({ kind: 'sug', key: k, name, role: '', url: v.url, crop: v.crop, desc: v.desc, q: v.q, curQ: v.curQ, cur: { url: all['manual:' + name], ...(all['manualpos:' + name] || {}) }, at: v.at || 0 });
  }
  // 다른 PC에서 넘어온 확인 안 된 사진
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('mauto:') || !v) continue;
    const name = k.slice(6);
    if (!all['manual:' + name] || all['none:' + name] || out.some((o) => o.name === name)) continue;
    const pos = all['manualpos:' + name] || {};
    out.push({ key: 'mauto:' + name, name, role: '', url: all['manual:' + name], cx: pos.cx, cy: pos.cy, crop: pos.crop, at: all['mt:' + name] || 0 });
  }
  // 직책·최근 출연일 채우기 (다른 PC에서 넘어온 사진·제안은 직책 정보가 없어서 지난 방송 명단에서 찾음)
  const idx = await loadIndex(), last = {};
  for (const p of Object.values(idx)) for (const [name, role] of p.g) if (!last[name] || p.d > last[name].d) last[name] = { d: p.d, role };
  for (const o of out) {
    const l = last[o.name];
    if (l) { if (!o.role) o.role = l.role; o.last = l.d; }
  }
  return out.sort((a, b) => b.at - a.at);
}
async function openReview() {
  const list = await unconfirmedAutos();
  if (!list.length) { alert('검토할 사진이 없어요. 자동으로 찾은 사진을 모두 확인했어요.'); return; }
  const ov = el('div', 'overlay review-ov'), box = el('div', 'picker review');
  const close = el('button', 'sclose', '닫기');
  const head = el('div', 'stop'); head.append(el('div', 'ptitle', `자동으로 찾은 사진 검토 (${list.length}명)`), close);
  const allOk = el('button', 'primary', '남은 사진 모두 맞음');
  const help = el('div', 'psub', '본인이 맞으면 [맞음], 다른 사람이면 [틀림]. 틀림은 사진을 비워두고, 나중에 [최신 사진]으로 직접 고르면 돼요. 결과는 폰에도 연동돼요.');
  const grid = el('div', 'rgrid');
  box.append(head, help, allOk, grid); ov.append(box); document.body.append(ov);
  let changed = false;
  const decide = async (it, card, ok) => {
    if (card.dataset.done) return;
    card.dataset.done = '1'; changed = true;
    if (it.kind === 'sug') {
      if (ok) {   // 새 사진으로 바꾸기
        await store.set('manual:' + it.name, it.url);
        await store.set('manualpos:' + it.name, { crop: it.crop });
        if (it.desc) await store.set('fd:' + it.name, it.desc);
      } else await store.set('lock:' + it.name, Date.now());   // 지금 사진 유지 → 잠금
      await store.set('mt:' + it.name, Date.now());
      await chrome.storage.local.remove('sug:' + it.name);
      card.classList.add('ok');
      card.querySelector('.rbtns').textContent = ok ? '✔ 새 사진으로 바꿈' : '🔒 지금 사진 유지 (잠금)';
      return;
    }
    if (ok) {
      await store.set('manual:' + it.name, it.url);
      await store.set('manualpos:' + it.name, it.crop ? { crop: it.crop } : it.cy != null ? { cx: it.cx, cy: it.cy } : {});
      await store.set('mt:' + it.name, Date.now()); await chrome.storage.local.remove('mauto:' + it.name);
      if (it.desc) await store.set('fd:' + it.name, it.desc);   // 얼굴 장부에 확인된 얼굴로
    } else {
      await chrome.storage.local.remove([it.key, 'manual:' + it.name, 'manualpos:' + it.name, 'mt:' + it.name, 'mauto:' + it.name]);
      await store.set('none:' + it.name, Date.now());
    }
    card.classList.add(ok ? 'ok' : 'no');
    card.querySelector('.rbtns').textContent = ok ? '✔ 확인됨' : '✖ 지움 · 나중에 직접 고르기';
  };
  for (const it of list) {
    if (it.kind === 'sug') {
      const card = el('div', 'rcard sug');
      const pair = el('div', 'rpair');
      const a1 = el('div'), p1 = el('div', 'rphoto'); setPhoto(p1, it.cur, it.name); a1.append(p1, el('div', 'rsmall', `지금 사진${it.curQ ? ' · ' + it.curQ + '점' : ''}`));
      const a2 = el('div'), p2 = el('div', 'rphoto'); setPhoto(p2, it, it.name); a2.append(p2, el('div', 'rsmall', `새 사진 · ${it.q}점`));
      pair.append(a1, a2);
      const btns = el('div', 'rbtns');
      const yes = el('button', 'rsug', '새 사진으로'), keep = el('button', 'rno', '지금 사진 유지');
      yes.onclick = () => decide(it, card, true); keep.onclick = () => decide(it, card, false);
      btns.append(yes, keep);
      card.append(el('div', 'rname', it.name), el('div', 'rrole', (it.role ? it.role + ' · ' : '') + '더 나은 사진 제안'), pair, btns);
      grid.append(card); continue;
    }
    const card = el('div', 'rcard');
    const ph = el('div', 'rphoto'); setPhoto(ph, it, it.name);
    const btns = el('div', 'rbtns');
    const ok = el('button', 'rok', '맞음'), no = el('button', 'rno', '틀림');
    ok.onclick = () => decide(it, card, true); no.onclick = () => decide(it, card, false);
    btns.append(ok, no);
    const q = encodeURIComponent(`${it.name} ${it.role}`);
    const look = el('a', 'rlook', '검색해서 확인'); look.href = '#'; look.onclick = (e) => { e.preventDefault(); openTab('https://search.naver.com/search.naver?where=image&query=' + q); };
    const lastTxt = it.last ? `최근 출연 ${+it.last.slice(5, 7)}/${+it.last.slice(8, 10)}` : '';
    card.append(ph, el('div', 'rname', it.name), el('div', 'rrole', it.role || '직책 정보 없음'), el('div', 'rsmall', lastTxt), look, btns);
    grid.append(card);
  }
  allOk.onclick = async () => {
    if (!confirm('아직 고르지 않은 사진을 모두 [맞음]으로 처리할까요?')) return;
    for (const card of grid.children) if (!card.dataset.done) card.querySelector('.rok').click();
  };
  close.onclick = () => { ov.remove(); if (changed) { schedulePush(); if (current) render(current); status('검토 결과를 저장했어요. 폰에도 연동돼요.'); } };
}
$('#review').onclick = () => { if (OWNER) openReview(); };
$('#sync').onclick = async () => {
  if (!OWNER) {   // 보기 전용 PC → 관리자 로그인 (진짜 GitHub 키인지 확인)
    const t = prompt('관리자 키(GitHub 키)를 붙여넣으세요.'); if (!t || !t.trim()) return;
    const tok = t.replace(/\s+/g, '');
    const r = await fetch('https://api.github.com/repos/rokaf072/jcs', { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' } }).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => ({})) : {};
    if (!(j.permissions && j.permissions.push)) { alert('관리자 키가 아니에요.'); return; }
    await store.set('ghToken', tok); alert('관리자로 전환됐어요.'); location.reload(); return;
  }
  if (!(await getGhToken())) {
    const t = prompt('폰 연동용 GitHub 키를 붙여넣으세요.\n(한 번만 입력하면 이 PC에 저장돼요)');
    if (!t || !t.trim()) return;
    await store.set('ghToken', t.replace(/\s+/g, ''));
  }
  status('폰과 연동 중…');
  try { await syncPull(true); const n = await syncPush(); if (current) render(current); status(`연동 완료 · 공유 사진 ${n}명. 폰 앱에서 [PC 사진 지금 받아오기]나 앱을 다시 열면 반영돼요.`); }
  catch (e) { if (/키가 맞지/.test(e.message)) await chrome.storage.local.remove('ghToken'); status(e.message, true); }
};
$('#restore').onclick = () => {
  const f = document.createElement('input'); f.type = 'file'; f.accept = '.json,application/json';
  f.onchange = async () => {
    try {
      const n = await importPhotos(JSON.parse(await f.files[0].text()), true);
      schedulePush();
      if (current) render(current);
      status(`사진 ${n}건을 되살렸어요.`);
    } catch (e) { status(e.message, true); }
  };
  f.click();
};

// 바탕화면 바로가기(별도 창)로 열리면 크게(최대화)
// 바탕화면 아이콘으로 열면(따로 뜬 창) → 평소 쓰는 크롬 창의 '탭'으로 옮겨서 열기 (유튜브·네이버 탭 옆에)
//   이미 출연자 탭이 열려 있으면 새로 만들지 않고 그 탭으로 이동
(async () => {
  try {
    const me = await chrome.tabs.getCurrent();
    const w = await chrome.windows.getCurrent();
    const url = chrome.runtime.getURL('app.html');
    const others = (await chrome.tabs.query({ url })).filter((t) => me && t.id !== me.id);
    // 사용 중인 크롬 창(최소화돼 있어도 포함). 작업용 빈 창(about:blank만 있는 창)은 제외
    const isBlank = (u) => !u || u === 'about:blank';
    const normalWins = (await chrome.windows.getAll({ windowTypes: ['normal'], populate: true }))
      .filter((x) => x.id !== w.id && (x.tabs || []).some((t) => !isBlank(t.url || t.pendingUrl)));
    if (others.length) {   // 이미 열려 있음 → 그 탭으로
      const t = others[0];
      await chrome.tabs.update(t.id, { active: true });
      const tw = await chrome.windows.get(t.windowId);
      await chrome.windows.update(t.windowId, tw.state === 'minimized' ? { focused: true, state: 'maximized' } : { focused: true });
      if (w.type !== 'normal') chrome.windows.remove(w.id); else chrome.tabs.remove(me.id);
      return;
    }
    if (w.type !== 'normal') {
      if (normalWins.length) {
        const nw = normalWins.find((x) => x.focused) || normalWins.find((x) => x.state !== 'minimized') || normalWins.sort((a, b) => b.tabs.length - a.tabs.length)[0];
        await chrome.tabs.create({ windowId: nw.id, url, active: true });
        await chrome.windows.update(nw.id, nw.state === 'minimized' ? { focused: true, state: 'maximized' } : { focused: true });
      } else {
        await chrome.windows.create({ url, type: 'normal', state: 'maximized' });
      }
      chrome.windows.remove(w.id);
    }
  } catch (e) {}
})();

// ───────── 출연자 검색: 이름·소속을 치면 언제 출연했는지 ─────────
// 지난 방송 명단을 모아 둔 색인 { 글번호: { d:날짜, t:제목, u:수정시각, g:[[이름, 소속, 코너, 부]] } }
const INDEX_MAX = 300;   // 최근 300회(약 1년 2개월)
let gIndex = null, indexing = null, indexProgress = '';
async function loadIndex() { if (!gIndex) gIndex = (await store.get('gindex')) || {}; return gIndex; }
function compactGuests(parsed) {
  const g = [];
  for (const pt of parsed.parts || []) for (const c of pt.corners) for (const x of c.guests) if (x.name) g.push([x.name, x.role, c.name || '', pt.label || '']);
  return g;
}
function ensureIndex(onProgress) {
  if (indexing) return indexing;
  indexing = (async () => {
    const idx = await loadIndex();
    // 1) 게시판 글 목록 (16개씩 넘겨가며)
    const list = [];
    for (let off = 0; off < INDEX_MAX; off += 16) {
      indexProgress = `지난 방송 목록 확인 중 ${list.length}개…`; onProgress && onProgress();
      let j; try { BOARD = await progBoard(getJsonp); j = await getJsonp(`${API}/lists?board_code=${BOARD}&offset=${off}&limit=16&action_type=callback&callback=boardListCallback_${BOARD}`); } catch (e) { break; }
      const items = (j.list || []).filter((x) => x.DELETED !== 'Y');
      list.push(...items);
      if (items.length < 16) break;
    }
    // 2) 아직 색인에 없거나 고쳐진 글만 본문 읽기 (4개씩 동시에)
    const todo = list.filter((x) => !idx[x.NO] || idx[x.NO].u !== (x.UPDATE_DATE || x.REG_DATE) || idx[x.NO].v !== PARSER_V);
    let done = 0;
    const work = async (x) => {
      try {
        const j = await getJsonp(`${API}/detail/${x.NO}?action_type=callback&board_code=${BOARD}&callback=boardViewCallback_${BOARD}`);
        const d = j.Response_Data_For_Detail;
        if (d) {
          const title = htmlToText(d.TITLE || x.TITLE);
          idx[x.NO] = { d: dateFromTitle(title) || (x.REG_DATE || '').slice(0, 10), t: title, u: x.UPDATE_DATE || x.REG_DATE, v: PARSER_V, g: compactGuests(progParse(htmlToText(d.CONTENT || ''), title)) };
        }
      } catch (e) {}
      done++;
      indexProgress = `지난 방송 명단 모으는 중 ${done}/${todo.length}…`;
      if (done % 10 === 0) { await store.set('gindex', idx); onProgress && onProgress(); }
    };
    for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(work));
    await store.set('gindex', idx);
    indexProgress = '';
    onProgress && onProgress();
    return idx;
  })().finally(() => { indexing = null; });
  return indexing;
}
function searchIndex(idx, q) {
  q = q.replace(/\s+/g, '');
  const people = new Map();
  for (const [no, p] of Object.entries(idx)) {
    for (const [name, role, corner, part] of p.g) {
      if (!name.includes(q) && !role.replace(/\s+/g, '').includes(q)) continue;
      if (!people.has(name)) people.set(name, { name, roles: new Map(), hits: [] });
      const it = people.get(name);
      it.roles.set(role, (it.roles.get(role) || '') > p.d ? it.roles.get(role) : p.d);
      if (!it.hits.some((h) => h.no === no)) it.hits.push({ no, date: p.d, title: p.t, u: p.u, role, corner, part });
    }
  }
  const out = [...people.values()];
  for (const it of out) {
    it.hits.sort((a, b) => b.date.localeCompare(a.date));
    it.role = [...it.roles.entries()].sort((a, b) => b[1].localeCompare(a[1]))[0][0];   // 가장 최근 소속
  }
  // 이름이 정확히 같은 사람 → 이름이 들어간 사람 → 소속만 맞는 사람, 그 안에서 최근 출연 순
  const rank = (it) => (it.name === q ? 0 : it.name.includes(q) ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.hits[0].date.localeCompare(a.hits[0].date));
}
const fullDate = (s) => { const [y, m, d] = s.split('-'); return `${y}.${m}.${d} (${'일월화수목금토'[new Date(s + 'T00:00:00').getDay()]})`; };
async function goToPost(h) {
  if (!posts.some((p) => p.date === h.date)) {
    posts.push({ no: Number(h.no), title: h.title, href: viewUrl(h.no), updated: h.u, date: h.date });
    posts.sort((a, b) => b.date.localeCompare(a.date));
  }
  fillSelect(h.date);
  await show(h.date);
  window.scrollTo(0, 0);
  saveView();
}
async function openSearch() {
  const ov = el('div', 'overlay sov'), box = el('div', 'picker search');
  const close = el('button', 'sclose', '닫기'); close.onclick = () => ov.remove();
  const inp = document.createElement('input'); inp.type = 'search'; inp.className = 'sinput'; inp.placeholder = '이름 또는 소속 (예: 김도형, 한국일보)';
  const prog = el('div', 'sprog'), res = el('div', 'sres');
  const top = el('div', 'stop'); top.append(el('div', 'ptitle', '출연자 검색'), close);
  box.append(top, inp, prog, res); ov.append(box);
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  document.body.append(ov);
  setTimeout(() => inp.focus(), 50);
  let last = '';
  const draw = async (forceDraw) => {
    const q = inp.value.trim();
    prog.textContent = indexProgress;
    if (!forceDraw && q === last) return;
    last = q; res.textContent = '';
    const idx = await loadIndex();
    const n = Object.keys(idx).length;
    if (!q) { res.append(el('div', 'pmsg', n ? `지난 방송 ${n}회분에서 찾아요. 이름이나 소속을 입력하세요.` : '지난 방송 명단을 모으는 중이에요…')); return; }
    const found = searchIndex(idx, q);
    if (!found.length) { res.append(el('div', 'pmsg', `"${q}" 출연 기록이 없어요.` + (indexProgress ? ' (아직 모으는 중이라 조금 뒤 다시 나올 수 있어요)' : ''))); return; }
    for (const it of found.slice(0, 30)) {
      const card = el('div', 'scard');
      const ph = el('div', 'sphoto', it.name.slice(-2));
      knownPhoto(it.name, it.role).then((r) => drawThumb(ph, r, it.name));
      const info = el('div', 'sinfo');
      info.append(el('div', 'sname', it.name), el('div', 'srole', it.role), el('div', 'scount', `출연 ${it.hits.length}회 · 최근 ${fullDate(it.hits[0].date)}`));
      const list = el('div', 'shits');
      it.hits.slice(0, 50).forEach((h) => {
        const a = el('button', 'shit');
        a.append(el('b', null, fullDate(h.date)), document.createTextNode(` ${h.part}${h.corner ? ' [' + h.corner + ']' : ''}` + (h.role !== it.role ? ` · ${h.role}` : '')));
        a.onclick = () => { ov.remove(); goToPost(h); };
        list.append(a);
      });
      const head = el('div', 'shead'); head.append(ph, info);
      card.append(head, list); res.append(card);
    }
  };
  let typing = null;
  inp.oninput = () => { clearTimeout(typing); typing = setTimeout(() => { draw(); res.scrollTop = 0; }, 350); };
  draw(true);
  ensureIndex(() => { if (document.body.contains(ov)) draw(true); });
}

// 검색 목록 작은 사진: 출연자 카드와 똑같이 얼굴 부분만 보이게 (영상 장면 사진은 잘라 둔 위치 사용)
function drawThumb(ph, rec, name) {
  if (!rec || !rec.url) return;
  ph.textContent = '';
  if (rec.crop) {
    const c = rec.crop, d = document.createElement('div'); d.className = 'cropimg';
    d.style.backgroundImage = `url("${rec.url}")`; d.style.backgroundSize = `${100 / c.w}% ${100 / c.h}%`;
    d.style.backgroundPosition = `${c.w < 1 ? (c.x / (1 - c.w)) * 100 : 0}% ${c.h < 1 ? (c.y / (1 - c.h)) * 100 : 0}%`;
    ph.append(d); return;
  }
  const im = document.createElement('img'); im.referrerPolicy = 'no-referrer'; im.src = rec.url;
  if (rec.cy != null) im.style.objectPosition = `${Math.round((rec.cx ?? 0.5) * 100)}% ${Math.round(Math.min(rec.cy, 0.6) * 100)}%`;
  im.onerror = () => { ph.textContent = name.slice(-2); }; ph.append(im);
}
async function knownPhoto(name, role) {   // 저장된 사진만 (검색 목록에서 새로 찾지는 않음) → { url, crop, cx, cy }
  const all = await chrome.storage.local.get(['manual:' + name, 'manualpos:' + name, `photo7:${name}|${role}`]);
  if (all['manual:' + name]) return { url: all['manual:' + name], ...(all['manualpos:' + name] || {}) };
  const a = all[`photo7:${name}|${role}`]; return a && a.url ? a : await autoByName(name);
}
$('#search').onclick = openSearch;
setTimeout(() => ensureIndex(), 8000);   // 뒤에서 미리 명단 모아두기

// ───────── 유튜브 클립 방식: 정치쇼 자기 영상에서 출연자 얼굴 찾기 ─────────
// 1) "김태현의 정치쇼 이름"으로 유튜브 검색 → 제목에 이름이 든 클립만
// 2) 클립마다 유튜브가 만들어 둔 장면 사진(maxres 1~3 등)을 모음
// 3) 진행자(김태현) 얼굴과 이미 확인된 다른 출연자 얼굴은 제외
// 4) 여러 클립에 반복해서 나오는 얼굴 = 그 출연자
// 5) 그 얼굴이 나온 장면 중 정면·크게·선명한 장면을 골라 얼굴 위주로 잘라 보여줌

const SMILE_W = 0.95, SMILE_L = 0.10;
// 사진 한 장을 자세히 분석 (얼굴 위치·특징값·정면 점수·선명도)
const deepMemo = new Map();
function analyzeDeep(url) {
  if (!deepMemo.has(url)) deepMemo.set(url, (async () => {
    try {
      if (!(await loadFace())) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob());
      if (bmp.width < (/ytimg/.test(url) ? 200 : 100)) return null;   // 없는 장면이면 유튜브가 작은 기본 그림을 줌
      const k = Math.min(2, 960 / bmp.width);   // 작은 장면 사진은 키워서 작은 얼굴도 잡음
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const det = await faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.45 }))
        .withFaceLandmarks(false).withFaceDescriptors();
      const faces = det.map((r) => {
        const b = r.detection.box, P = r.landmarks.positions;
        const avg = (i, j) => { let x = 0, y = 0; for (let n = i; n <= j; n++) { x += P[n].x; y += P[n].y; } return { x: x / (j - i + 1), y: y / (j - i + 1) }; };
        const eL = avg(36, 41), eR = avg(42, 47), nose = P[30], mouth = avg(48, 67);
        const eyeD = Math.hypot(eR.x - eL.x, eR.y - eL.y) || 1;
        const mid = { x: (eL.x + eR.x) / 2, y: (eL.y + eR.y) / 2 };
        const yaw = (nose.x - mid.x) / eyeD;                                  // 고개 돌림 (0이 정면)
        const roll = Math.atan2(eR.y - eL.y, eR.x - eL.x);                     // 고개 기울임
        const pitch = Math.log(Math.max(0.1, (nose.y - mid.y) / Math.max(1, mouth.y - nose.y)) / 2.1);  // 숙임(+)·젖힘(-), 정면이 0
        const ear = (p) => (Math.hypot(P[p + 1].x - P[p + 5].x, P[p + 1].y - P[p + 5].y) + Math.hypot(P[p + 2].x - P[p + 4].x, P[p + 2].y - P[p + 4].y)) / (2 * (Math.hypot(P[p].x - P[p + 3].x, P[p].y - P[p + 3].y) || 1));
        const eyes = (ear(36) + ear(42)) / 2;                                   // 눈 뜬 정도
        // 웃는 정도: 입꼬리가 입술 가운데보다 올라가고 입이 옆으로 벌어질수록 큼 (말하는 입은 괜찮음)
        const mw = Math.hypot(P[54].x - P[48].x, P[54].y - P[48].y) / eyeD;
        const lift = ((P[51].y + P[57].y) / 2 - (P[48].y + P[54].y) / 2) / eyeD;
        const clamp = (v) => Math.max(0, Math.min(1, v));
        const brow = avg(17, 26);
        const browEye = (mid.y - brow.y) / eyeD;                                // 눈썹~눈 거리 (눈을 내리깔면 커짐)
        const eyeRel = (mid.y - b.y) / b.height;                                // 얼굴 칸 안에서 눈 높이 (고개 숙이면 아래로)
        const noseLen = (nose.y - mid.y) / eyeD;
        const smile = 0.5 * clamp((mw - SMILE_W) / 0.15) + 0.5 * clamp((lift - SMILE_L) / 0.06);
        // 고개 숙임·원고 보기: 눈을 내리깔아 눈이 가늘어지고, 코~입이 짧아 보임
        //   (실측: 정면 눈 0.33~0.35·기울기 -0.5~-0.7 / 숙인 사진 눈 0.26~0.28·기울기 -0.25~+0.2)
        const down = 0.5 * clamp((0.31 - eyes) / 0.06) + 0.5 * clamp((pitch + 0.4) / 0.3);
        const sharp = sharpness(ctx, b);
        const wPx = b.width / k;                                               // 원본 기준 얼굴 크기
        const box = { x: b.x / c.width, y: b.y / c.height, w: b.width / c.width, h: b.height / c.height };
        const clutter = clutterIn(ctx, portraitCrop(box, c.width, c.height), c.width, c.height);  // 썸네일 큰 글자·띠 비율
        const q = 0.25 * Math.min(1, wPx / 120)                       // 얼굴 크기
          + 0.20 * (1 - Math.min(1, Math.abs(yaw) / 0.5))                // 정면 (좌우)
          + 0.15 * (1 - Math.min(1, Math.abs(roll) / 0.3))               // 기울지 않음
          + 0.25 * (1 - down)                                            // 정면을 보고 눈을 뜸
          - 0.25 * down                                                  // 고개 숙인 사진은 크게 감점
          + 0.15 * Math.min(1, sharp / 150)                              // 선명함
          - 0.8 * clutter                                                // 사진 안에 자막이 차지하는 비율만큼 감점
          - 0.5 * smile;                                                 // 활짝 웃는 얼굴은 실물과 달라 보여 크게 감점 (자막 썸네일보다 뒤)
        return { desc: Array.from(r.descriptor), box, wPx, yaw, pitch, roll, eyes, sharp, clutter, smile, down, mw, lift, browEye, eyeRel, noseLen, q };
      }).filter((f) => f.wPx >= 50);
      return { faces, W: bmp.width, H: bmp.height };
    } catch (e) { return null; }
  })());
  return deepMemo.get(url);
}
// 잘라낼 영역 안에 섞인 원색 자막·띠(빨강·노랑 등) 비율 0~1
function clutterIn(ctx, cr, W, H) {
  try {
    const S = 96, t = document.createElement('canvas'); t.width = S; t.height = S;
    const tc = t.getContext('2d', { willReadFrequently: true });
    tc.drawImage(ctx.canvas, cr.x * W, cr.y * H, cr.w * W, cr.h * H, 0, 0, S, S);
    const d = tc.getImageData(0, 0, S, S).data; let rows = 0;
    for (let y = 0; y < S; y++) {
      let sat = 0, jumps = 0, prev = -1;
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4, mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (mx - mn > 100) sat++;                                  // 노랑·빨강 등 원색 글자
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (prev >= 0 && Math.abs(l - prev) > 90) jumps++;          // 흰 글자·검은 테두리처럼 밝기가 확 바뀌는 곳
        prev = l;
      }
      if (sat > S * 0.15 || jumps >= 14) rows++;                   // 글자가 깔린 줄
    }
    return rows / S;                                               // 글자 줄이 차지하는 높이 비율
  } catch (e) { return 0; }
}
// 얼굴 부분의 선명도 (흐리면 낮음)
function sharpness(ctx, b) {
  try {
    const S = 64, t = document.createElement('canvas'); t.width = S; t.height = S;
    const tc = t.getContext('2d', { willReadFrequently: true });
    tc.drawImage(ctx.canvas, b.x, b.y, b.width, b.height, 0, 0, S, S);
    const d = tc.getImageData(0, 0, S, S).data, g = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    let sum = 0, sum2 = 0, n = 0;
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const i = y * S + x, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - S] - g[i + S];
      sum += l; sum2 += l * l; n++;
    }
    return sum2 / n - (sum / n) ** 2;
  } catch (e) { return 0; }
}
// 얼굴 위주 증명사진 영역 (머리~어깨, 화면 칸과 같은 4:5 비율) — 원본 기준 0~1
function portraitCrop(box, W, H) {
  const fw = box.w * W, fh = box.h * H, cx = (box.x + box.w / 2) * W;
  let cw = fw * 1.9, ch = cw * 5 / 4;          // 얼굴이 크게 보이도록 (머리~목·어깨 조금)
  if (ch > H) { ch = H; cw = ch * 4 / 5; }
  if (cw > W) { cw = W; ch = cw * 5 / 4; }
  let x = cx - cw / 2, y = box.y * H - fh * 0.55;
  x = Math.max(0, Math.min(W - cw, x)); y = Math.max(0, Math.min(H - ch, y));
  return { x: x / W, y: y / H, w: cw / W, h: ch / H };
}

// 유튜브 검색 결과 읽기 (숨은 탭 안에서 실행)
async function pageYTResults() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30; i++) {
    const items = [...document.querySelectorAll('ytd-video-renderer')].map((v) => {
      const a = v.querySelector('a#video-title'); const href = a ? a.getAttribute('href') || '' : '';
      const m = href.match(/[?&]v=([\w-]{11})/) || href.match(/shorts\/([\w-]{11})/);
      const ch = v.querySelector('ytd-channel-name a, #channel-name a');
      return m ? { id: m[1], title: (a.getAttribute('title') || a.textContent || '').trim(), channel: ch ? ch.textContent.trim() : '' } : null;
    }).filter(Boolean);
    if (items.length >= 3 || (items.length && i > 10)) return items.slice(0, 20);
    await sleep(300);
  }
  return [];
}
const ytMemo = new Map();
// 유튜브 검색: 탭을 열지 않고 결과 페이지 내용만 받아서 읽음 (빠르고 화면에 아무것도 안 뜸)
function ytParse(html) {
  const out = [], seen = new Set();
  const add = (id, title, channel) => { if (id && !seen.has(id) && out.length < 20) { seen.add(id); out.push({ id, title: title || '', channel: channel || '' }); } };
  // 1) 페이지 속 검색 결과 데이터(JSON) 읽기
  const m = html.match(/(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*/);
  if (m) {
    let k = m.index + m[0].length, depth = 0, inStr = false, esc = false, end = -1;
    for (let n = k; n < html.length; n++) {
      const c = html[n];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { end = n + 1; break; } }
    }
    try {
      const data = JSON.parse(html.slice(k, end));
      const txt = (t) => (t && (t.simpleText || (t.runs || []).map((r) => r.text).join(''))) || '';
      const walk = (o) => {
        if (!o || typeof o !== 'object' || out.length >= 20) return;
        if (o.videoRenderer && o.videoRenderer.videoId) { const v = o.videoRenderer; add(v.videoId, txt(v.title), txt(v.ownerText || v.longBylineText)); return; }
        for (const key in o) walk(o[key]);
      };
      walk(data);
    } catch (e) {}
  }
  // 2) 형식이 바뀌었을 때 대비: 글자 패턴으로 직접 찾기
  if (!out.length) {
    const re = /"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,2000}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g;
    let r; while ((r = re.exec(html)) && out.length < 20) { let t = r[2]; try { t = JSON.parse('"' + t + '"'); } catch (e) {} add(r[1], t, ''); }
  }
  return out;
}
// 유튜브 검색: 탭이나 창을 열지 않고 결과 페이지 내용만 받아서 읽음
async function ytSearchFetch(url) {
  for (const credentials of ['omit', 'include']) {
    try {
      const res = await fetch(url, { credentials, headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' } });
      if (!res.ok) continue;
      const r = ytParse(await res.text());
      if (r.length) return r;
    } catch (e) {}
  }
  return [];
}
function ytSearch(q) {
  if (!ytMemo.has(q)) ytMemo.set(q, (async () => {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
    const r = await ytSearchFetch(url);
    if (!r.length) ytMemo.delete(q);   // 못 읽었으면 다음에 다시 시도 (창을 띄우지 않음)
    return r;
  })());
  return ytMemo.get(q);
}
// 클립 한 개의 사진들: 영상 중간중간 실제 스튜디오 장면 3장만 씀
//   대표 썸네일은 그날 '이야기 주제' 정치인 얼굴을 합성해 넣는 경우가 많아서(예: 송영훈 클립에 한동훈) 쓰지 않음
//   실제 장면은 고화질이 없으면 보통 화질로
const ytShots = (id) => {
  const u = (n) => `https://i.ytimg.com/vi/${id}/${n}.jpg`;
  return [[u('maxres1'), u('sd1'), u('hq1')], [u('maxres2'), u('sd2'), u('hq2')], [u('maxres3'), u('sd3'), u('hq3')]];
};
async function firstShot(alts) { for (const u of alts) { const a = await analyzeDeep(u); if (a) return { u, a }; } return null; }
const isShowClip = (v) => PROG.clip.test(v.title) || /SBS|시교라|시사교양/.test(v.channel);

// 진행자 김태현 얼굴 배우기 → '진행자 얼굴 묶음'(여러 장)으로 저장
//   예전 버전은 대표 썸네일(주제 정치인 합성)에서 배워 엉뚱한 얼굴을 진행자로 알 수 있었음 → 실제 장면에서 새로 배움
//   한 장이 아니라 여러 장면의 얼굴을 모두 기억 → 고개 돌림·조명이 달라도 진행자를 놓치지 않음
let hostMemo = null;
function hostBank() {
  if (!hostMemo) hostMemo = (async () => {
    const saved = await store.get('hostBank2');
    if (Array.isArray(saved) && saved.length >= 3) return saved;
    const lists = await Promise.all([ytSearch(PROG.name), ytSearch(PROG.name + ' 인터뷰'), ytSearch(PROG.name + ' 토론')]);
    const seen = new Set(), vids = [];
    for (const v of lists.flat()) if (isShowClip(v) && !seen.has(v.id)) { seen.add(v.id); vids.push(v); }
    const faces = [];
    await Promise.all(vids.slice(0, 14).map(async (v) => {
      for (const alts of ytShots(v.id)) { const r = await firstShot(alts); if (r) r.a.faces.forEach((f) => faces.push({ desc: f.desc, vid: v.id })); }
    }));
    let best = null, sup = 0;
    for (const f of faces) {
      const n = new Set(faces.filter((h) => dist(f.desc, h.desc) < 0.44).map((h) => h.vid)).size;
      if (n > sup) { sup = n; best = f; }
    }
    if (!best || sup < 4) { hostMemo = null; return null; }   // 서로 다른 클립 4개 이상에 나온 얼굴만 진행자로 (확실할 때만)
    const bank = faces.filter((h) => dist(best.desc, h.desc) < 0.44).map((h) => h.desc).slice(0, 40);
    await store.set('hostBank2', bank);
    await chrome.storage.local.remove('hostDesc');
    return bank;
  })();
  return hostMemo;
}
const hostDist = (desc, bank) => (bank && bank.length ? Math.min(...bank.map((h) => dist(desc, h))) : 9);
async function hostDesc() { const b = await hostBank(); return b && b[0]; }   // 시험 창 표시용
// 이미 맞다고 확인한 사진(직접 고른 사진)이 있으면 그 얼굴을 기준으로 삼음 → 장부에 넣어둠
async function anchorDesc(name) {
  const fd = await store.get('fd:' + name);
  if (Array.isArray(fd)) return fd;
  if (await store.get('mauto:' + name)) return null;   // 확인 안 된 사진은 기준으로 쓰지 않음
  const url = await store.get('manual:' + name);
  if (!url) return null;
  const a = await analyzeDeep(url);
  if (!a || !a.faces.length) return null;
  const pos = (await store.get('manualpos:' + name)) || {};
  const cr = pos.crop;
  const inCrop = (f) => !cr || (f.box.x + f.box.w / 2 > cr.x && f.box.x + f.box.w / 2 < cr.x + cr.w && f.box.y + f.box.h / 2 > cr.y && f.box.y + f.box.h / 2 < cr.y + cr.h);
  const pick = a.faces.filter(inCrop).sort((x, y) => y.wPx - x.wPx)[0];
  if (!pick) return null;
  await store.set('fd:' + name, pick.desc);
  return pick.desc;
}
// 확인된 다른 출연자 얼굴 목록 (얼굴 장부)
async function knownFaceBook() {
  const all = await chrome.storage.local.get(null);
  const book = [];
  for (const [k, v] of Object.entries(all)) if (k.startsWith('fd:') && Array.isArray(v)) book.push({ name: k.slice(3), desc: v });
  return book;
}

// 출연자 한 명 찾기 → { url, crop, desc, q, support, temp, cands:[…] } 또는 null
// 유튜브 장면은 비슷한 인상(안경 쓴 중년 남성 등)이 많아 더 엄격하게 같은 사람 판단
const YSAME = 0.44;
async function identifyYT(g, opts = {}) {
  const t0 = Date.now();
  // 검색어 두 가지로 동시에 찾아 클립을 더 많이 모음
  const lists = await Promise.all([ytSearch(`${PROG.name} ${g.name}`), ytSearch(`${PROG.short} ${g.name} ${(g.role || '').split(' ')[0]}`.trim())]);
  const seenV = new Set(), vids = [];
  for (const v of lists.flat()) if (v.title.includes(g.name) && !seenV.has(v.id)) { seenV.add(v.id); vids.push(v); }
  vids.sort((a, b) => isShowClip(b) - isShowClip(a)); vids.splice(8);
  if (!vids.length) return opts.debug ? { url: '', why: '제목에 이름이 든 정치쇼 클립을 못 찾았어요.', ms: Date.now() - t0, vids } : null;
  const [bank, anchor] = await Promise.all([hostBank(), anchorDesc(g.name)]);
  const book = await knownFaceBook();
  const mine = anchor ? { name: g.name, desc: anchor } : null;
  const others = book.filter((b) => b.name !== g.name);
  // 장면 사진들을 동시에 분석
  // 확인된 얼굴이 있으면 대표 썸네일도 봄 (주제 정치인 얼굴은 확인된 얼굴과 안 맞아서 걸러짐)
  const thumbs = (id) => [[`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hq720.jpg`]];
  const shots = vids.flatMap((v) => [...ytShots(v.id), ...(mine ? thumbs(v.id) : [])].map((alts) => ({ alts, vid: v.id })));
  const results = await Promise.all(shots.map((s) => firstShot(s.alts)));
  const faces = [];
  results.forEach((r, i) => { if (r) r.a.faces.forEach((f) => faces.push({ ...f, url: r.u, vid: shots[i].vid, W: r.a.W, H: r.a.H })); });
  // 진행자·다른 출연자 얼굴 빼기 (확인된 얼굴이 있으면 그쪽에 더 가까운 얼굴은 남김)
  const nearMine = (f) => mine ? dist(f.desc, mine.desc) : 9;
  faces.forEach((f) => { f.hd = hostDist(f.desc, bank); });
  // 진행자: 진행자 얼굴 묶음과 0.48 미만이면 제외 (확인된 출연자 얼굴에 더 가까우면 남김)
  const pool = faces.filter((f) => !(f.hd < 0.48 && f.hd < nearMine(f)) && !others.some((o) => dist(f.desc, o.desc) < 0.4 && dist(f.desc, o.desc) < nearMine(f)));
  // 진행자 얼굴 묶음 보강: 아주 확실한 진행자 장면은 묶음에 추가 (점점 정확해짐)
  if (bank && bank.length < 60) { const add = faces.filter((f) => f.hd < 0.36).map((f) => f.desc).slice(0, 3); if (add.length) { bank.push(...add); store.set('hostBank2', bank); } }
  // 같은 얼굴끼리 묶기
  let cluster = [];
  if (mine) {                                                                       // 확인된 얼굴이 있으면 그 얼굴만 (다른 얼굴로 대신하지 않음)
    // 확인된 얼굴과 차이 0.42 미만 + 다른 확인된 사람보다 확인된 얼굴에 더 가까워야 함
    //   (실측: 같은 사람 0.22~0.37, 닮은 다른 사람 0.48)
    let near = pool.filter((f) => { const d = dist(f.desc, mine.desc); return d < 0.42 && !others.some((o) => dist(f.desc, o.desc) < d); });
    // 추가 확인: 찾은 장면들끼리도 서로 닮아야 함 (확실한 장면들과의 차이 중간값 0.42 미만)
    const core = near.filter((f) => dist(f.desc, mine.desc) < 0.36);
    if (core.length >= 2) near = near.filter((f) => { const ds = core.filter((c) => c !== f).map((c) => dist(f.desc, c.desc)).sort((x, y) => x - y); return !ds.length || ds[Math.floor(ds.length / 2)] < 0.42; });
    cluster = near;
    if (!cluster.length) {
      const near = pool.map((f) => dist(f.desc, mine.desc)).sort((a, b) => a - b)[0];
      return opts.debug ? { url: '', why: `확인된 얼굴과 같은 사람이 클립 장면에 없어요(장면 속 얼굴 ${pool.length}개, 가장 비슷한 차이 ${near ? near.toFixed(2) : '-'}). 지금 사진을 그대로 둬요.`, ms: Date.now() - t0, vids, faces: faces.length } : null;
    }
  } else {
    let bestSup = 0;
    for (const f of pool) {
      const same = pool.filter((h) => dist(f.desc, h.desc) < YSAME);
      const sup = new Set(same.map((h) => h.vid)).size + same.length / 100;      // 여러 클립 > 같은 클립 여러 장면
      if (sup > bestSup) { bestSup = sup; cluster = same; }
    }
  }
  const support = new Set(cluster.map((f) => f.vid)).size;
  // 처음 보는 얼굴은 클립 2개 이상에서 같은 얼굴이어야 함
  if (!mine && support < 2 && cluster.length && vids.length >= 2) return opts.debug ? { url: '', why: '클립마다 다른 얼굴이 나와 누군지 확정하지 못했어요.', ms: Date.now() - t0, vids, faces: faces.length } : null;
  // 한 클립뿐이고 진행자 외 얼굴이 여럿이면 누군지 확정 불가 → 비워둠
  const countPeople = (arr) => { const reps = []; for (const f of arr) if (!reps.some((r) => dist(r.desc, f.desc) < YSAME)) reps.push(f); return reps.length; };
  const ambiguous = support < 2 && !mine && cluster.length > 0 && countPeople(pool.filter((f) => f.vid === cluster[0].vid)) > 1;
  if (!cluster.length || ambiguous) return opts.debug ? { url: '', why: ambiguous ? '한 클립에 여러 사람이 있어 누군지 확정하지 못했어요.' : '진행자 외 얼굴을 찾지 못했어요.', ms: Date.now() - t0, vids, faces: faces.length } : null;
  // 대표 썸네일은 합성·자막이 많아 실제 장면보다 조금 뒤로
  cluster = cluster.map((f) => (/maxresdefault|hq720/.test(f.url) ? { ...f, q: f.q - 0.08 } : f));
  cluster.sort((a, b) => b.q - a.q);
  // 가장 좋은 장면도 고개 숙임·흐림 등으로 점수가 낮으면 → 같은 얼굴의 인터넷 사진에서 더 나은 것 찾기
  if (cluster[0].q < 0.6 || cluster[0].down > 0.5) {
    const refs = [...(mine ? [mine.desc] : []), ...cluster.map((f) => f.desc)];
    const web = await refineWeb(g, refs).catch(() => []);
    cluster = [...cluster, ...web].sort((a, b) => b.q - a.q);
  }
  // 거의 같은 장면(같은 클립·같은 얼굴 위치)은 한 장만
  const uniq = [];
  for (const f of cluster) if (!uniq.some((u) => (f.web ? u.url === f.url : u.vid === f.vid) && Math.abs(u.box.x - f.box.x) < 0.03 && Math.abs(u.box.y - f.box.y) < 0.03 && dist(u.desc, f.desc) < 0.2)) uniq.push(f);
  const cands = uniq.slice(0, 3).map((f) => ({ url: f.url, crop: portraitCrop(f.box, f.W, f.H), q: Math.round(Math.max(0, f.q) * 100), kind: (f.web ? '인터넷 사진' : /maxresdefault|hq720/.test(f.url) ? '썸네일' : '영상 장면') + (f.down > 0.5 ? ' · 고개 숙임' : '') + (f.smile > 0.5 ? ' · 웃는 얼굴' : '') }));
  const mean = cluster[0].desc.map((_, i) => cluster.reduce((s, f) => s + f.desc[i], 0) / cluster.length);
  return { ...cands[0], desc: mean, support, temp: support < 2 && !mine, src: 'yt', cands, ms: Date.now() - t0, vids };
}

// 유튜브 장면이 모두 고개 숙인 사진 등이면: 유튜브로 확인한 얼굴과 같은 사람의 인터넷 사진에서 더 나은 것 찾기
//   refs: 유튜브에서 확인된 장면 얼굴들 — 평균 하나가 아니라 각 장면과 하나하나 비교 (평균은 닮은 다른 사람도 통과시킴)
//   (실측: 정다은 본인 0.30~0.40, 닮은 다른 기자 0.42~0.50)
async function refineWeb(g, refs) {
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
  const hostBankNow = await hostBank();
  const sources = (await webSources(g)).slice(0, 16);
  const out = [];
  for (let i = 0; i < sources.length; i += 4) {
    const batch = sources.slice(i, i + 4);
    const res = await Promise.all(batch.map((s) => analyzeDeep(s.url)));
    res.forEach((a, k) => {
      if (!a) return;
      for (const f of a.faces) if (med(refs.map((r) => dist(f.desc, r))) < 0.38 && hostDist(f.desc, hostBankNow) >= 0.48) out.push({ ...f, url: batch[k].url, W: a.W, H: a.H, web: true });
    });
    if (out.some((f) => f.q >= 0.75)) break;   // 충분히 좋은 사진을 찾으면 멈춤
  }
  return out;
}

// ───────── 한 명 시험해 보기 ─────────
async function openYTTest() {
  const name = (prompt('유튜브 클립 방식으로 사진을 찾아볼 출연자 이름을 입력하세요. (예: 박순봉)') || '').trim();
  if (!name) return;
  let role = '';
  const idx = await loadIndex();
  for (const p of Object.values(idx)) for (const x of p.g) if (x[0] === name) role = x[1];
  const ov = el('div', 'overlay'), box = el('div', 'picker review');
  const close = el('button', 'sclose', '닫기'); close.onclick = () => ov.remove();
  const head = el('div', 'stop'); head.append(el('div', 'ptitle', `${name} — 유튜브 클립에서 찾는 중…`), close);
  const info = el('div', 'psub', '정치쇼 클립 검색 → 장면 분석 → 진행자 얼굴 제외 → 정면·크기·선명도 점수');
  const grid = el('div', 'rgrid');
  box.append(head, info, grid); ov.append(box); document.body.append(ov);
  const host = await hostDesc();
  const r = await identifyYT({ name, role }, { debug: true });
  head.firstChild.textContent = `${name} — ${((r && r.ms) || 0) / 1000}초`;
  const anc = await store.get('fd:' + name);
  const lines = [`진행자 얼굴: ${host ? '학습됨' : '아직 못 배움'}`, `기준 얼굴: ${anc ? '확인된 사진과 같은 사람만 찾음' : '없음(처음 보는 얼굴)'}`, `찾은 클립: ${(r && r.vids || []).length}개${r && r.vids ? ' (' + r.vids.map((v) => v.title.slice(0, 18)).join(' / ') + ')' : ''}`];
  if (r && r.url) lines.push(`같은 얼굴이 나온 클립 수: ${r.support}개 ${r.temp ? '(1개뿐이라 임시)' : '(확정)'}`);
  else lines.push('결과: ' + ((r && r.why) || '못 찾음'));
  info.textContent = lines.join(' · ');
  for (const c of (r && r.cands) || []) {
    const card = el('div', 'rcard'), ph = el('div', 'rphoto'); setPhoto(ph, c, name);
    const use = el('button', 'rok', '이 사진으로 고정');
    use.onclick = async () => {
      await store.set('manual:' + name, c.url);
      await store.set('manualpos:' + name, { crop: c.crop });
      await store.set('mt:' + name, Date.now()); await chrome.storage.local.remove('mauto:' + name);
      if (r.desc) await store.set('fd:' + name, r.desc);
      await chrome.storage.local.remove('none:' + name);
      schedulePush(); card.classList.add('ok'); use.textContent = '✔ 고정됨';
      if (current) render(current);
    };
    const btns = el('div', 'rbtns'); btns.append(use);
    card.append(ph, el('div', 'rname', `점수 ${c.q} · ${c.kind || ''}`), btns); grid.append(card);
  }
}
$('#yttest').onclick = openYTTest;

// 내가 넣은 사진(잠금 안 한 것)보다 확실히 나은 유튜브 사진이 있으면 [사진 검토]에 제안 (자동으로 바꾸진 않음)
async function suggestBetter(g) {
  if (!OWNER) return;
  if (document.querySelector('.overlay')) return;   // 검토·검색 중에는 뒤에서 아무것도 안 함
  const n = g.name;
  const all = await chrome.storage.local.get(['manual:' + n, 'lock:' + n, 'none:' + n, 'mauto:' + n, 'sugchk:' + n, 'manualpos:' + n, 'sug:' + n]);
  if (!all['manual:' + n] || all['lock:' + n] || all['none:' + n] || all['mauto:' + n] || all['sug:' + n]) return;
  if (all['sugchk:' + n] && Date.now() - all['sugchk:' + n] < 14 * 86400000) return;   // 2주에 한 번만 확인
  await store.set('sugchk:' + n, Date.now());
  let curQ = 0;
  const cur = await analyzeDeep(all['manual:' + n]);
  if (cur && cur.faces.length) {
    const cr = (all['manualpos:' + n] || {}).crop;
    const inCrop = (f) => !cr || (f.box.x + f.box.w / 2 > cr.x && f.box.x + f.box.w / 2 < cr.x + cr.w && f.box.y + f.box.h / 2 > cr.y && f.box.y + f.box.h / 2 < cr.y + cr.h);
    const f = cur.faces.filter(inCrop).sort((a, b) => b.wPx - a.wPx)[0];
    if (f) curQ = Math.max(0, f.q);
  }
  const y = await identifyYT(g);   // 지금 사진 얼굴을 기준으로 같은 사람만 찾음
  if (!y || !y.url || y.url === all['manual:' + n]) return;
  if (y.q / 100 >= curQ + 0.08) await store.set('sug:' + n, { url: y.url, crop: y.crop, q: y.q, curQ: Math.round(curQ * 100), desc: y.desc, at: Date.now() });
}

// ───────── 얼굴 장부 자동 채우기: 앱이 켜져 있는 동안 뒤에서 한 명씩 ─────────
//   자주 나온 사람 → 최근에 나온 사람 순서. 이미 확인된 사람은 건너뛰고, 꺼졌다 켜지면 이어서 함.
//   평일 아침 6시~9시(방송 시간대)에는 쉼 → 그날 출연자 찾기가 먼저.
let bgRunning = false;
async function reviewCount() {
  if (!OWNER) { $('#toolsBadge').hidden = true; return; }
  const n = (await unconfirmedAutos()).length;
  $('#review').textContent = n ? `📷 사진 검토 (${n}명 대기)` : '📷 사진 검토';
  $('#review').classList.toggle('has', !!n);
  const b = $('#toolsBadge'); b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
}
// ───────── 다크 모드 (기본) / 밝은 모드 ─────────
const paintTheme = () => { const d = document.documentElement.dataset.theme === 'dark'; $('#themeBtn').textContent = d ? '☀' : '🌙'; $('#themeBtn').title = d ? '밝은 화면으로' : '어두운 화면으로'; };
$('#themeBtn').onclick = () => { const h = document.documentElement; h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('jcsTheme', h.dataset.theme); } catch (e) {} paintTheme(); };
paintTheme();
// ───────── 사진 없는 출연자: 자동으로 못 찾았거나 [틀림]으로 지운 사람을 모아 직접 채우기 ─────────
async function missingList() {
  const idx = await loadIndex();
  const all = await chrome.storage.local.get(null);
  const people = new Map();
  for (const p of Object.values(idx)) for (const [name, role, corner] of p.g) {
    if (!name) continue;
    const o = people.get(name) || { name, role, topic: corner, n: 0, last: '' };
    o.n++; if (p.d > o.last) { o.last = p.d; o.role = role; }
    people.set(name, o);
  }
  const has = (o) => all['manual:' + o.name] || all[`manual:${o.name}|${o.role}`] || Object.keys(all).some((k) => k.startsWith('photo7:' + o.name + '|') && all[k] && all[k].url);
  return [...people.values()].filter((o) => !all['notguest:' + o.name] && (all['none:' + o.name] || !has(o)))
    .map((o) => ({ ...o, deleted: !!all['none:' + o.name] }))
    .sort((a, b) => (b.n - a.n) || b.last.localeCompare(a.last));
}
async function missingCount() {
  const n = (await missingList()).length;
  $('#missing').textContent = n ? `🖼 사진 없는 출연자 (${n}명)` : '🖼 사진 없는 출연자';
}
async function openMissing() {
  const list = await missingList();
  if (!list.length) { alert('사진이 비어 있는 출연자가 없어요. 모두 채워져 있어요!'); return; }
  const ov = el('div', 'overlay'), box = el('div', 'picker review');
  const close = el('button', 'sclose', '닫기');
  const head = el('div', 'stop'); head.append(el('div', 'ptitle', `사진 없는 출연자 (${list.length}명)`), close);
  const help = el('div', 'psub', '자주 나온 사람부터 보여줘요. [사진 고르기]를 누르면 최신 사진 후보가 뜨고, 고르면 바로 채워져요(직접 고른 사진이라 확인된 사진이 돼요). [틀림]으로 지웠던 사람도 여기 나와요.');
  const grid = el('div', 'rgrid');
  box.append(head, help, grid); ov.append(box); document.body.append(ov);
  let changed = false;
  for (const g of list) {
    const card = el('div', 'rcard');
    const ph = el('div', 'rphoto'); setPhoto(ph, {}, g.name);
    const btns = el('div', 'rbtns');
    const pickB = el('button', 'rok', '사진 고르기');
    pickB.onclick = () => {
      openPicker(g, ph);
      // 고르고 나면 카드에 표시
      const t = setInterval(async () => {
        if (await store.get('manual:' + g.name)) { clearInterval(t); changed = true; card.classList.add('ok'); btns.textContent = '✔ 채움'; }
        if (!document.body.contains(ov)) clearInterval(t);
      }, 800);
    };
    const notB = el('button', 'rno', '출연자 아님');   // 코너 제목·설문 문구 등이 사람 이름처럼 잡힌 경우 → 목록에서 영구히 빼기
    notB.title = '사람이 아니거나 사진이 필요 없으면 눌러서 이 목록에서 빼요';
    notB.onclick = async () => { await store.set('notguest:' + g.name, Date.now()); card.remove(); missingCount(); };
    btns.append(pickB, notB);
    const q = encodeURIComponent(`${g.name} ${g.role}`);
    const look = el('a', 'rlook', '검색해서 확인'); look.href = '#'; look.onclick = (e) => { e.preventDefault(); openTab('https://search.naver.com/search.naver?where=image&query=' + q); };
    const meta = `출연 ${g.n}회 · 최근 ${+g.last.slice(5, 7)}/${+g.last.slice(8, 10)}` + (g.deleted ? ' · 틀림으로 지움' : '');
    card.append(ph, el('div', 'rname', g.name), el('div', 'rrole', g.role || ''), el('div', 'rsmall', meta), look, btns);
    grid.append(card);
  }
  close.onclick = () => { ov.remove(); if (changed) { schedulePush(); if (current) render(current); } missingCount(); };
}
$('#missing').onclick = () => { if (OWNER) openMissing(); };
$('#traces').onclick = async () => { $('#tools').open = false; status('검색 흔적 지우는 중…'); const n = await cleanOldTraces(); status(n ? `검색 흔적 ${n}건을 크롬 방문 기록에서 지웠어요.` : '지울 검색 흔적이 없어요.'); };
(async () => {
  const ok = await incogOK();
  $('#incog').textContent = ok ? '🕶 시크릿 검색 사용 중 ✓' : '🕶 시크릿 검색 켜기';
  $('#incog').onclick = () => {
    $('#tools').open = false;
    if (ok) { alert('이미 켜져 있어요.\n사진 찾기용 구글·네이버 검색은 시크릿 창에서 열려서 검색 기록에 남지 않아요.'); return; }
    alert('크롬 설정 화면이 열려요.\n\n아래쪽 [시크릿 모드에서 허용] 스위치를 켜 주세요.\n(켜면 출연자 탭이 닫힐 수 있어요. 그러면 바탕화면 아이콘으로 다시 열어 주세요)');
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
  };
  setTimeout(cleanOldTraces, 8000);   // 켤 때마다 조용히 지난 흔적 정리
})();
$('#tools').addEventListener('toggle', () => { if ($('#tools').open) missingCount(); });
// ───────── 달력: 날짜(📅)를 누르면 달력에서 방송일을 골라 이동 ─────────
async function openCalendar(anchor) {
  document.querySelectorAll('.cal').forEach((c) => c.remove());
  const idx = await loadIndex();
  const avail = new Map();   // 날짜 → 이동 방법
  for (const [no, v] of Object.entries(idx)) if (v.d) avail.set(v.d, { no, title: v.t, u: v.u, date: v.d });
  for (const p of posts) avail.set(p.date, { inList: true, date: p.date });
  const sel = $('#dateSel').value || todayStr();
  let y = +sel.slice(0, 4), m = +sel.slice(5, 7) - 1;
  const cal = el('div', 'cal');
  const draw = () => {
    cal.textContent = '';
    const head = el('div', 'calhead');
    const prev = el('button', null, '◀'), next = el('button', null, '▶');
    prev.onclick = (e) => { e.stopPropagation(); if (--m < 0) { m = 11; y--; } draw(); };
    next.onclick = (e) => { e.stopPropagation(); if (++m > 11) { m = 0; y++; } draw(); };
    head.append(prev, el('b', null, `${y}년 ${m + 1}월`), next);
    const grid = el('div', 'calgrid');
    '일월화수목금토'.split('').forEach((d) => grid.append(el('div', 'dow', d)));
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    for (let k = 0; k < first; k++) grid.append(el('div'));
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
      const b = el('button', 'd', String(d));
      const info = avail.get(ds);
      if (info) b.classList.add('has');
      if (ds === todayStr()) b.classList.add('today');
      if (ds === sel) b.classList.add('sel');
      if (info || ds === todayStr()) b.onclick = async (e) => {
        e.stopPropagation(); cal.remove();
        if (info && !info.inList) await goToPost(info);
        else { const s2 = $('#dateSel'); s2.value = ds; s2.dispatchEvent(new Event('change')); }
      };
      grid.append(b);
    }
    cal.append(head, grid, el('div', 'calnote', '초록색 날짜에 방송 출연자 글이 있어요. 노란 테두리는 오늘.'));
  };
  draw();
  document.body.append(cal);
  const r = anchor.getBoundingClientRect();
  cal.style.top = (r.bottom + 8) + 'px';
  cal.style.left = Math.max(10, Math.min(window.innerWidth - 340, r.left)) + 'px';
  setTimeout(() => {
    const off = (e) => { if (!cal.contains(e.target)) { cal.remove(); document.removeEventListener('click', off, true); } };
    document.addEventListener('click', off, true);
  }, 0);
}
$('#dateLabel').onclick = (e) => openCalendar(e.currentTarget);
$('#calBtn').onclick = (e) => openCalendar(e.currentTarget);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.cal').forEach((c) => c.remove()); });
// ◀ ▶ 로 이전·다음 방송 (목록은 최신순)
$('#prevDay').onclick = () => { const s = $('#dateSel'); if (s.selectedIndex < s.options.length - 1) { s.selectedIndex++; s.dispatchEvent(new Event('change')); } };
$('#nextDay').onclick = () => { const s = $('#dateSel'); if (s.selectedIndex > 0) { s.selectedIndex--; s.dispatchEvent(new Event('change')); } };
// 탭: 출연자 / 신문 요약 (스크롤 위치에 따라 자동으로 불 들어옴)
$('#tabGuests').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
const markTab = () => { const n = document.getElementById('news'); const onNews = n && n.getBoundingClientRect().top < window.innerHeight * 0.35; $('#tabGuests').classList.toggle('on', !onNews); $('#newsBtn').classList.toggle('on', !!onNews); };
window.addEventListener('scroll', markTab, { passive: true });
// 관리 메뉴: 항목을 누르거나 바깥을 누르면 닫힘
document.addEventListener('click', (e) => { const t = $('#tools'); if (t.open && (!t.contains(e.target) || e.target.closest('.menu button'))) setTimeout(() => { t.open = false; }, 0); });
// 진행자 얼굴이 잘못 들어간 자동 사진 고치기 (진행자 얼굴을 새로 배운 뒤 한 번)
//   사람이 [맞음]으로 확인한 사진·직접 고른 사진은 건드리지 않음
async function faceOfPhoto(url, pos) {
  const a = await analyzeDeep(url);
  if (!a || !a.faces.length) return null;
  const cr = pos && pos.crop;
  const inCrop = (f) => !cr || (f.box.x + f.box.w / 2 > cr.x && f.box.x + f.box.w / 2 < cr.x + cr.w && f.box.y + f.box.h / 2 > cr.y && f.box.y + f.box.h / 2 < cr.y + cr.h);
  return a.faces.filter(inCrop).sort((x, y) => y.wPx - x.wPx)[0] || null;
}
async function purgeHost(lastRole) {
  const bank = await hostBank();
  if (!bank) return;
  if ((await store.get('hostPurged')) === 2) return;
  const all = await chrome.storage.local.get(null);
  const sus = [];
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('photo7:') && v && v.url) {
      const [name, role] = k.slice(7).split('|');
      if (all['manual:' + name] || all['none:' + name]) continue;
      sus.push({ kind: 'p7', key: k, name, role, url: v.url, pos: v, desc: v.desc });
    } else if (k.startsWith('mauto:') && v) {
      const name = k.slice(6);
      if (!all['manual:' + name] || all['none:' + name] || all['lock:' + name]) continue;
      sus.push({ kind: 'ma', name, role: lastRole[name] || '', url: all['manual:' + name], pos: all['manualpos:' + name] || {} });
    }
  }
  let i = 0, fixed = 0;
  for (const it of sus) {
    i++;
    bgProg(`진행자 얼굴 섞인 사진 점검 ${i}/${sus.length}`, '예전에 진행자 얼굴을 잘못 배워서 진행자 사진이 들어간 경우를 찾아 고치는 중이에요.');
    while (document.querySelector('.overlay')) await new Promise((r) => setTimeout(r, 3000));
    let d = it.desc;
    if (!d) { const f = await faceOfPhoto(it.url, it.pos).catch(() => null); d = f && f.desc; }
    if (!d || hostDist(d, bank) >= 0.45) continue;   // 진행자 아님
    fixed++;
    const y = await identifyYT({ name: it.name, role: it.role }).catch(() => null);
    const ok = y && y.url && !(y.desc && hostDist(y.desc, bank) < 0.45);
    const now = Date.now();
    if (it.kind === 'p7') {
      if (ok) await store.set(it.key, { ...y, cands: undefined, vids: undefined, at: now, checked: now, ver: 2 });
      else { await chrome.storage.local.remove(it.key); await store.set('none:' + it.name, now); }
    } else {
      if (ok) { await store.set('manual:' + it.name, y.url); await store.set('manualpos:' + it.name, { crop: y.crop }); await store.set('mt:' + it.name, now); await store.set('mauto:' + it.name, 1); }
      else { await chrome.storage.local.remove(['manual:' + it.name, 'manualpos:' + it.name, 'mauto:' + it.name]); await store.set('none:' + it.name, now); }
    }
    await store.set('chk:' + it.name, now);
  }
  await store.set('hostPurged', 2);
  if (fixed) { schedulePush(3000); reviewCount(); if (current) render(current); status(`진행자 얼굴이 잘못 들어간 사진 ${fixed}장을 고쳤어요. (새로 찾았거나, 못 찾으면 '사진 확인 필요'로 비움)`); }
}
const bgProg = (t, title) => { const e = $('#bgprog'); e.textContent = t; if (title) e.title = title; };
const SUG_GAP = 14 * 86400000;
async function bgFill() {
  if (!OWNER) return;   // 보기 전용 PC에서는 뒤에서 사진을 찾지 않음
  if (bgRunning) return; bgRunning = true;
  try {
    bgProg('얼굴 장부: 지난 방송 명단 확인 중…');
    const idx = await ensureIndex().catch(() => loadIndex());   // 새 PC면 명단부터 모음
    const people = new Map();
    for (const p of Object.values(idx)) for (const [name, role, corner] of p.g) {
      if (!name) continue;
      const o = people.get(name) || { name, role, topic: corner, n: 0, last: '' };
      o.n++; if (p.d > o.last) { o.last = p.d; o.role = role; }
      people.set(name, o);
    }
    bgProg('얼굴 장부: 진행자 얼굴 배우는 중…');
    await purgeHost(Object.fromEntries([...people.values()].map((o) => [o.name, o.role]))).catch(() => {});
    // 할 일 목록 먼저 정리 (이미 끝난 사람은 빼서 남은 인원·시간을 정확히)
    const all = await chrome.storage.local.get(null);
    const need = (g) => {
      if (all['none:' + g.name] || all['lock:' + g.name] || all['mauto:' + g.name]) return false;   // 지운·잠근·검토 대기 사람은 건드리지 않음
      if (all['chk:' + g.name] && Date.now() - all['chk:' + g.name] < SUG_GAP) return false;        // 이 PC나 다른 PC가 최근 2주 안에 확인함
      if (all['manual:' + g.name]) return !(all['sugchk:' + g.name] && Date.now() - all['sugchk:' + g.name] < SUG_GAP);   // 내가 넣은 사진 → 더 나은 사진 제안만
      return (all[`photo7:${g.name}|${g.role}`] || {}).ver !== 2;
    };
    const todo = [...people.values()].filter(need).sort((a, b) => (b.n - a.n) || b.last.localeCompare(a.last));
    const total = todo.length, t0 = Date.now();
    if (!total) { bgProg('얼굴 장부 ✔ 완료', `지난 출연자 ${people.size}명 확인 완료`); return; }
    let done = 0, next = 0, stopped = false;
    const showProg = () => {
      const left = done ? Math.round(((Date.now() - t0) / done) * (total - done) / 60000) : Math.round((total - done) * 8 / 60);
      bgProg(`얼굴 장부 채우는 중 ${done}/${total} · ${left >= 60 ? '약 ' + Math.floor(left / 60) + '시간 ' + (left % 60) + '분' : left >= 1 ? '약 ' + left + '분' : '1분 안에'} 남음`,
        '지난 출연자 사진을 찾는 중이에요. 창을 닫아도 찾은 결과는 남고, 다시 열면 이어서 해요.');
    };
    // 두 명씩 동시에 처리 (한 명이 유튜브 검색을 기다리는 동안 다른 한 명은 얼굴 분석)
    const worker = async () => {
      while (!stopped && next < total) {
        const now = new Date(), hm = now.getHours() * 60 + now.getMinutes(), wd = now.getDay();
        if (wd >= 1 && wd <= 5 && hm >= PROG.fastFrom && hm < PROG.off) { stopped = true; bgProg(`얼굴 장부 ${done}/${total} · 방송 시간이라 쉬는 중`, `평일 방송 시간엔 그날 출연자 찾기를 먼저 해요. ${hhmmStr(PROG.off)} 이후 이어서 해요.`); return; }
        while (prefetching || document.querySelector('.overlay')) { bgProg(`얼굴 장부 ${done}/${total} · 검토 창 닫으면 이어서`, '검토·검색 창이 열려 있는 동안은 쉬어요.'); await new Promise((r) => setTimeout(r, 3000)); }
        const g = todo[next++];
        showProg();
        if (all['manual:' + g.name]) await suggestBetter(g).catch(() => {});
        else await getPhoto(g, null, { keep: true }).catch(() => {});
        done++;
        await store.set('chk:' + g.name, Date.now());   // 확인 기록 (사진 연동 때 다른 PC로도 전달)
        reviewCount(); showProg();
        if (!document.hidden) await new Promise((r) => setTimeout(r, 1000));   // 보고 있을 땐 화면이 버벅이지 않게 살짝 쉼
      }
    };
    await Promise.all([worker(), worker()]);
    if (stopped) return;
    bgProg('얼굴 장부 ✔ 완료', `지난 출연자 ${people.size}명 확인 완료. 2주 뒤 다시 확인해요.`);
  } catch (e) {} finally { bgRunning = false; }
}
setTimeout(() => { reviewCount(); bgFill(); }, 60000);
setTimeout(() => { if (!bgRunning) bgProg('얼굴 장부: 1분 뒤 시작', '앱을 켜두면 지난 출연자 사진을 뒤에서 한 명씩 찾아요.'); reviewCount(); }, 1500);                    // 켜고 1분 뒤 시작
setInterval(() => bgFill(), 30 * 60000);                                 // 멈췄으면 30분마다 다시 이어서

// 폴더에 새 버전이 들어오면(새 버전 적용하기.bat) 확장 프로그램을 알아서 다시 시작 → ↻ 안 눌러도 됨
if (!window.JCS_WEB) setInterval(async () => {
  try {
    const v = (await (await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' })).json()).version;
    if (!v || v === chrome.runtime.getManifest().version) return;
    status(`새 버전 ${v}을(를) 찾았어요. 잠시 뒤 자동으로 다시 열려요…`);
    await new Promise((r) => setTimeout(r, 4000));   // 파일 복사가 끝날 때까지 기다림
    const w = await chrome.windows.getCurrent().catch(() => ({}));
    await chrome.storage.local.set({ reopenApp: { type: w.type || 'normal' } });
    chrome.runtime.reload();
  } catch (e) {}
}, 10000);

jcsGate({ isOwner: async () => !!(await getGhToken()), hadData: async () => !!(await store.get('posts_v2')) }).then(() => init());
// 숨은 관리자 로그인 (직원 화면에는 메뉴가 안 보임): 제목을 빠르게 5번 클릭하거나 Ctrl+Shift+L
{ let n = 0, t = 0;
  const h = document.querySelector('header h1');
  if (h) h.addEventListener('click', () => { if (OWNER) return; const now = Date.now(); n = now - t < 600 ? n + 1 : 1; t = now; if (n >= 5) { n = 0; $('#sync').click(); } });
  document.addEventListener('keydown', (e) => { if (!OWNER && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); $('#sync').click(); } });
}
// 관리자: 가입 기간·코드 바꾸기
$('#access').onclick = async () => {
  $('#tools').open = false;
  const tok = await getGhToken(); if (!tok) return;
  try { const r = await jcsEditAccess(tok); if (r) { alert(`저장했어요.\n가입 기간: ${r.from} ~ ${r.until}\n(새 기기에 적용되기까지 1~10분 걸려요)`); } }
  catch (e) { alert(e.message); }
};
startLiveSync();
setTimeout(() => { if (OWNER) loadFace(); }, 3000);   // 얼굴 인식은 관리자 PC에서만, 화면이 다 뜬 뒤에 미리 준비
