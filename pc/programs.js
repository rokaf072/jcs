// ───────── 프로그램 고르기: 김태현의 정치쇼 / 최선호의 뉴스직격 ─────────
// 화면 위 [정치쇼 | 뉴스직격] 단추로 바꿈. 고른 것은 이 기기에 기억.
// 사진(직접 등록한 사진 포함)은 두 프로그램이 같이 씀 → 같은 사람이 나오면 바로 보임
const JCS_PROGS = {
  jcs: {
    id: 'jcs', key: '', name: '김태현의 정치쇼', nameIs: '김태현의 정치쇼는', short: '정치쇼', host: '김태현',
    listUrl: 'https://programs.sbs.co.kr/radio/lchshow/board/65364', board: 'lchshow_02',
    on: 7 * 60 + 5, off: 9 * 60, usual: 6 * 60 + 20, fastFrom: 6 * 60,   // 방송 07:05~09:00, 글은 보통 6:20 전
    multi: false, limit: 16, clip: /정치쇼/,
  },
  jyj: {
    id: 'jyj', key: 'jyj:', name: '최선호의 뉴스직격', nameIs: '최선호의 뉴스직격은', short: '뉴스직격', host: '최선호',
    listUrl: 'https://programs.sbs.co.kr/radio/lovefmjyj/board/86084', board: '',
    boardCands: [...Array.from({ length: 20 }, (_, i) => 'lovefmjyj_' + String(i + 1).padStart(2, '0')), 'lovefmjyj'],
    on: 17 * 60, off: 18 * 60, usual: 16 * 60 + 30, fastFrom: 16 * 60,   // 방송 17:00~18:00
    multi: true, limit: 40, clip: /뉴스직격/,   // 코너마다 글이 따로 올라옴 → 날짜별로 묶음
  },
};
const PROG = (() => {
  let id = '';
  try {
    const q = new URLSearchParams(location.search).get('p');
    if (q && JCS_PROGS[q]) localStorage.setItem('jcsProg', q);
    id = localStorage.getItem('jcsProg') || '';
  } catch (e) {}
  return JCS_PROGS[id] || JCS_PROGS.jcs;
})();
// 프로그램별로 따로 저장하는 것: 글 목록·글 내용·검색 색인 (정치쇼는 예전 이름 그대로)
const progKey = (k) => (PROG.key && /^(posts|post:|gindex|hostBank)/.test(k) ? PROG.key + k : k);
const hhmmStr = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const PROG_TIME = `${hhmmStr(PROG.on)}~${hhmmStr(PROG.off)}`;

// 게시판 번호(board_code)를 모를 때: 후보를 한꺼번에 물어보고 '날짜로 시작하는 글'이 있는 곳을 고름
async function progBoard(getJsonp) {
  if (PROG.board) return PROG.board;
  const ck = 'jcsBoard:' + PROG.id;
  try { const c = localStorage.getItem(ck); if (c) return (PROG.board = c); } catch (e) {}
  if (window.__progBoardFound) return (PROG.board = window.__progBoardFound);
  const t = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
  const res = await Promise.all(PROG.boardCands.map(async (b) => {
    try {
      const j = await t(getJsonp(`https://api.board.sbs.co.kr/bbs/V2.0/basic/board/lists?board_code=${b}&offset=0&limit=10&action_type=callback&callback=boardListCallback_${b}`), 9000);
      const list = (j && j.list) || [];
      const dated = list.filter((x) => /^\d{6}/.test((x.TITLE || '').trim())).length;
      const guesty = list.filter((x) => /기자|의원|평론가|교수|위원|대표|변호사|\[/.test(x.TITLE || '')).length;
      return { b, score: dated * 2 + guesty, n: list.length };
    } catch (e) { return { b, score: 0, n: 0 }; }
  }));
  res.sort((a, b) => b.score - a.score);
  if (!res[0] || res[0].score <= 0) throw new Error(`${PROG.short} 게시판을 찾지 못했어요. 잠시 뒤 다시 시도해 주세요.`);
  try { localStorage.setItem(ck, res[0].b); } catch (e) {}
  return (PROG.board = res[0].b);
}
function progSetBoard(b) { if (!b) return; PROG.board = b; try { localStorage.setItem('jcsBoard:' + PROG.id, b); } catch (e) {} }
function progForgetBoard() { try { localStorage.removeItem('jcsBoard:' + PROG.id); } catch (e) {} if (PROG.boardCands) PROG.board = ''; }

// 게시판 글 목록 → 날짜별 글 (뉴스직격은 하루치 여러 글을 하나로 묶음)
function progPosts(items, toPost) {
  const one = items.filter((x) => x.DELETED !== 'Y').map(toPost).filter((p) => p.date);
  if (!PROG.multi) return one;
  const by = new Map();
  for (const p of one) { if (!by.has(p.date)) by.set(p.date, []); by.get(p.date).push(p); }
  const out = [];
  for (const [date, ps] of by) {
    ps.sort((a, b) => a.no - b.no);   // 먼저 올린 글(보통 앞 코너)부터
    out.push({ date, no: ps[0].no, nos: ps.map((p) => p.no), title: ps.map((p) => p.title).join(' / '), href: ps[0].href, updated: ps.map((p) => p.updated).sort().pop() + '#' + ps.length });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// 뉴스직격 글 하나: 제목 "261016(금) [김기자 관찰시점] 김병채 문화일보 기자, 김종일 시사저널 기자"
//   본문 "◈ (17:00 ~ 18:00)" "[코너]" "■ 출연 : 이름 소속 직함, …" "#해시태그"
function parseJYJ(body, title) {
  body = (body || '').replace(/ /g, ' ');
  const cands = nameCandidates(title, body);
  const lines = body.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const tm = body.match(/(\d{1,2}:\d{2})\s*[~∼-]\s*(\d{1,2}:\d{2})/);
  const time = tm ? `${tm[1]} ~ ${tm[2]}` : '';
  const tc = (title || '').match(/\[([^\]]+)\]\s*(.*)$/);
  let corner = tc ? tc[1].trim() : '';
  if (!corner) for (const l of lines) { const m = l.match(/^\[([^\]]+)\]/); if (m) { corner = m[1].trim(); break; } }
  // 출연자: '■ 출연 :' 줄 (여러 줄일 수도) → 없으면 제목의 ']' 뒤
  let raw = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[■□◆◇●○▶-]?\s*출\s*연\s*(?:자)?\s*[:：]\s*(.*)$/);
    if (m) {
      raw = m[1];
      for (let k = i + 1; k < lines.length && !/^[■□◆◇●○#\[◈]/.test(lines[k]) && !/[:：]/.test(lines[k]) && lines[k].length < 60; k++) raw += ', ' + lines[k];
      break;
    }
  }
  if (!raw && tc) raw = tc[2];
  if (!raw && !tc) { const m = (title || '').replace(/^\d{6}\s*(\([^)]*\))?\s*/, ''); raw = m; }
  const guests = raw.split(/\s*[,，、/]\s*|\s+및\s+/).map((s) => s.trim()).filter((s) => s && /[가-힣]{2}/.test(s) && !/[?？]/.test(s))
    .map((s) => splitGuest(s, cands)).filter((g) => g.name && g.name !== PROG.host);
  // 주제: 메타 줄이 아닌 첫 문장 (있으면)
  let topic = '';
  for (const l of lines) {
    if (/^#|^\[|^[■□◈◆◇]|^\d{4}년|^SBS\s|뉴스직격|^\(?\d{1,2}:\d{2}/.test(l)) continue;
    if (l.length >= 6 && l.length <= 120) { topic = l; break; }
  }
  if (!guests.length && !corner) return { parts: [] };
  return { parts: [{ label: '방송', time, corners: [{ name: corner, topic, guests }] }] };
}
// 하루치 여러 글을 합침: 같은 시간대끼리 한 부로
function mergeJYJ(details) {
  const corners = [];
  for (const d of details) for (const pt of parseJYJ(d.body, d.title).parts) for (const c of pt.corners) corners.push({ time: pt.time, c });
  const parts = [];
  for (const { time, c } of corners) {
    let p = parts.find((x) => x.time === time);
    if (!p) { p = { label: '', time, corners: [] }; parts.push(p); }
    p.corners.push(c);
  }
  const toM = (s) => { const m = (s || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 9999; };
  parts.sort((a, b) => toM(a.time) - toM(b.time));
  parts.forEach((p, i) => { p.label = parts.length > 1 ? `${i + 1}부` : '방송'; });
  return { parts };
}
// 검색 색인용: 글 하나 해석
const progParse = (body, title) => (PROG.multi ? parseJYJ(body, title) : parseBody(body, title));

// 머리글·창 제목·[정치쇼 | 뉴스직격] 단추
function progHeader() {
  try { document.title = PROG.name + ' 출연자'; } catch (e) {}
  const h1 = document.querySelector('header h1');
  if (h1) h1.textContent = PROG.name + ' 출연자';
  if (document.querySelector('.progsw')) return;
  const sw = document.createElement('div'); sw.className = 'progsw'; sw.setAttribute('role', 'tablist');
  for (const p of Object.values(JCS_PROGS)) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = p.short; b.title = `${p.name} (${hhmmStr(p.on)}~${hhmmStr(p.off)})`;
    if (p.id === PROG.id) b.className = 'on';
    b.onclick = () => {
      if (p.id === PROG.id) return;
      try { localStorage.setItem('jcsProg', p.id); sessionStorage.removeItem('jcsView'); } catch (e) {}
      const u = new URL(location.href); u.searchParams.delete('p'); location.replace(u.toString());
    };
    sw.append(b);
  }
  if (h1) h1.insertAdjacentElement('afterend', sw);
  else { const hd = document.querySelector('header'); if (hd) hd.prepend(sw); }
  document.documentElement.dataset.prog = PROG.id;
}
// 뉴스직격: 상징색 파랑으로 화면 색 바꾸기 + 뉴스직격 로고
const JYJ_COLORS = [
  [/#3a9a8a/gi, '#3b7be0'], [/#2a7466/gi, '#1f56b8'], [/#4fd1b5/gi, '#5b9cff'], [/#6ee7cc/gi, '#8cbcff'], [/#14b8a6/gi, '#2f7bf6'],
  [/#9fe3d4/gi, '#a9c8ff'], [/#0b1f1b/gi, '#0a1730'], [/79,\s*209,\s*181/g, '91,156,255'], [/42,\s*116,\s*102/g, '31,86,184'],
  [/#dcefea/gi, '#dce7fb'], [/#eef7f4/gi, '#eef3fd'], [/#e8eeec/gi, '#e8edf7'], [/#e6eeec/gi, '#e4eaf6'], [/#eef2f1/gi, '#edf1f8'],
  [/#f6f8f7/gi, '#f6f8fc'], [/#f2f6f5/gi, '#f1f4fb'], [/#d3dedb/gi, '#d2dbec'], [/#d9e3e0/gi, '#d6deee'], [/#1b2a27/gi, '#18243a'],
  [/#5b6b67/gi, '#5a6880'], [/#3fb39e/gi, '#4c8ef0'], [/#67e8f9/gi, '#93c5fd'], [/#2dd4bf/gi, '#60a5fa'], [/#5eead4/gi, '#93c5fd'], [/#0d9488/gi, '#1d4ed8'], [/#0f766e/gi, '#1e40af'], [/#fafbfb/gi, '#f9fbfe'],
  [/#111419/gi, '#0a1222'], [/#1a1e25/gi, '#111b2e'], [/#232934/gi, '#1a2640'], [/#2a313c/gi, '#24324e'], [/\b17,\s*20,\s*25\b/g, '10,18,34'],
];
function progTheme() {
  if (PROG.id !== 'jyj') return;
  for (const st of document.querySelectorAll('style')) { let t = st.textContent; for (const [a, b] of JYJ_COLORS) t = t.replace(a, b); st.textContent = t; }
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = '#1f56b8';
  const fav = document.querySelector('link[rel="icon"]'); if (fav) fav.href = 'icons/jyj48.png';
  const logo = document.querySelector('header .hlogo'); if (logo) { logo.src = 'icons/jyj48.png'; logo.style.borderRadius = '50%'; }
}
// 휴대폰: 제목 대신 단추가 있으니 왼쪽에 프로그램 로고
function progPhoneLogo() {
  const sw = document.querySelector('.row1 .progsw');
  if (!sw || document.querySelector('.proglogo')) return;
  const im = document.createElement('img'); im.className = 'proglogo'; im.alt = '';
  im.src = PROG.id === 'jyj' ? 'icons/jyj48.png' : 'icons/icon192.png';
  sw.insertAdjacentElement('beforebegin', im);
}
progTheme();
const progInit = () => { progHeader(); progPhoneLogo(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', progInit); else progInit();
