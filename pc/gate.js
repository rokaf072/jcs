// ───────── 가입 코드 (처음 쓰는 기기만) ─────────
// · 관리자 기기(GitHub 키 있음)와 이미 쓰던 기기는 그냥 통과
// · 새 기기는 가입 기간 안에 공통 코드를 넣어야 사용 가능. 한 번 가입하면 기간이 끝나도 계속 사용
// · 가입 기간·코드는 GitHub의 access.json 에 있음 (코드는 그대로 두지 않고 암호화한 값만 저장)
(() => {
  const MEMBER = 'jcsMember';
  const PAGES = 'https://rokaf072.github.io/jcs/access.json';
  const API = 'https://api.github.com/repos/rokaf072/jcs/contents/access.json';
  const isExt = !!(window.chrome && chrome.runtime && chrome.runtime.id);
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const md = (s) => (s ? s.slice(5).replace('-', '/') : '');
  const member = () => { try { return !!localStorage.getItem(MEMBER); } catch (e) { return false; } };
  const setMember = (how) => { try { localStorage.setItem(MEMBER, JSON.stringify({ at: Date.now(), how })); } catch (e) {} };
  async function hash(code) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('jcs:' + String(code).trim()));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function readAccess() {
    try { const r = await fetch((isExt ? PAGES : 'access.json') + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) {}
    return null;
  }

  // 화면 막고 코드 받기
  function showGate(acc) {
    return new Promise((resolve) => {
      const ov = document.createElement('div'); ov.className = 'gateov';
      const box = document.createElement('div'); box.className = 'gatebox';
      const open = acc && acc.hash && acc.from && acc.until && today() >= acc.from && today() <= acc.until;
      box.innerHTML = `<div class="gatelogo">📻</div><h2>${typeof PROG !== 'undefined' ? PROG.name : '김태현의 정치쇼'} 출연자</h2>`;
      const msg = document.createElement('p'); msg.className = 'gatemsg';
      if (!acc) msg.textContent = '인터넷에 연결한 뒤 다시 열어 주세요.';
      else if (!open) msg.innerHTML = '지금은 <b>가입 기간이 아니에요.</b><br>관리자에게 문의해 주세요.';
      else msg.innerHTML = `처음 한 번만 <b>가입 코드</b>를 넣어 주세요.<br><span class="gatesub">가입 기간 ${md(acc.from)} ~ ${md(acc.until)}</span>`;
      box.append(msg);
      if (open) {
        const inp = document.createElement('input'); inp.className = 'gateinp'; inp.inputMode = 'numeric'; inp.autocomplete = 'off'; inp.placeholder = '가입 코드';
        const btn = document.createElement('button'); btn.className = 'gatebtn'; btn.textContent = '가입하기';
        const err = document.createElement('div'); err.className = 'gateerr';
        const go = async () => {
          if (!inp.value.trim()) { inp.focus(); return; }
          if ((await hash(inp.value)) === acc.hash) { setMember('code'); ov.remove(); resolve(); return; }
          err.textContent = '코드가 맞지 않아요. 다시 확인해 주세요.'; box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); inp.select();
        };
        btn.onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) go(); };
        box.append(inp, btn, err);
        setTimeout(() => inp.focus(), 100);
      } else {
        const again = document.createElement('button'); again.className = 'gatebtn'; again.textContent = '다시 확인';
        again.onclick = async () => { ov.remove(); resolve(await gate(window.__jcsGateOpts)); };
        box.append(again);
      }
      ov.append(box); document.body.append(ov);
      document.documentElement.classList.add('gated');
    }).then(() => document.documentElement.classList.remove('gated'));
  }

  // opts: { isOwner: async()=>bool, hadData: async()=>bool }
  async function gate(opts) {
    window.__jcsGateOpts = opts;
    if (member()) return;
    if (await opts.isOwner().catch(() => false)) { setMember('admin'); return; }
    if (await opts.hadData().catch(() => false)) { setMember('before'); return; }   // 이번 기능 전부터 쓰던 기기
    return showGate(await readAccess());
  }
  window.jcsGate = gate;
  window.jcsIsMember = member;

  // 관리자: 가입 기간·코드 바꾸기
  window.jcsEditAccess = async (tok) => {
    const h = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' };
    const cur = await fetch(API + '?ref=main&t=' + Date.now(), { cache: 'no-store', headers: h }).catch(() => null);
    let sha, acc = {};
    if (cur && cur.ok) { const j = await cur.json(); sha = j.sha; try { acc = JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\s/g, ''))))); } catch (e) {} }
    else if (cur && (cur.status === 401 || cur.status === 403)) throw new Error('GitHub 키가 맞지 않아요.');
    const now = acc.from && acc.until ? `지금: ${acc.from} ~ ${acc.until}${today() >= acc.from && today() <= acc.until ? ' (가입 가능)' : ' (닫힘)'}` : '지금: 설정 없음';
    const code = prompt(`가입 코드를 정하세요. (비우면 지금 코드 그대로)\n${now}`, ''); if (code === null) return null;
    const from = prompt('가입 시작 날짜 (예: 2026-10-20)', acc.from && acc.from >= today() ? acc.from : today()); if (from === null) return null;
    const until = prompt('가입 마감 날짜 (이 날까지 가입 가능)', acc.until && acc.until >= from ? acc.until : from); if (until === null) return null;
    const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!ok(from) || !ok(until) || until < from) throw new Error('날짜 형식이 맞지 않아요. 2026-10-20 처럼 넣어 주세요.');
    if (!code.trim() && !acc.hash) throw new Error('처음에는 코드를 꼭 정해야 해요.');
    const next = { hash: code.trim() ? await hash(code) : acc.hash, from, until, updated: new Date().toISOString() };
    const body = { message: '가입 기간·코드 변경', content: btoa(unescape(encodeURIComponent(JSON.stringify(next, null, 1)))), ...(sha ? { sha } : {}) };
    const r = await fetch(API, { method: 'PUT', headers: h, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('저장하지 못했어요 (HTTP ' + r.status + ')');
    return next;
  };
  // 관리자 기기를 다른 사람이 쓰지 않게: 키를 지워도 가입 상태는 유지됨 (따로 지울 일 없음)
})();
