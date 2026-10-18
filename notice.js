// ───────── 알림판: 관리자가 올린 중요 알림을 모든 직원 폰에 크게 띄움 ─────────
// · 관리자 폰(GitHub 키 있음): ⚙ 설정 → [📢 알림 보내기]로 작성 → GitHub의 notice.json 에 저장
// · 직원 폰: 앱을 열 때, 다시 볼 때, 켜 둔 동안 2분마다 notice.json 확인 → 새 알림이면 뒤를 흐리게 하고 화면 가운데 크게
// · [확인했어요]를 누르면 그 알림은 다시 안 뜸 (관리자가 새 알림을 올리면 다시 뜸)
(() => {
  const API = 'https://api.github.com/repos/rokaf072/jcs/contents/notice.json';
  const SEEN = 'jcsNoticeSeen';
  const pad = (n) => String(n).padStart(2, '0');
  const when = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const seen = () => { try { return localStorage.getItem(SEEN) || ''; } catch (e) { return ''; } };
  const owner = () => { try { return !!JSON.parse(localStorage.getItem('gb:ghToken') || 'null'); } catch (e) { return false; } };
  const token = () => { try { return JSON.parse(localStorage.getItem('gb:ghToken') || 'null') || ''; } catch (e) { return ''; } };
  let current = null, shown = false;

  async function fetchNotice() {
    try {
      const r = await fetch('notice.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      const n = await r.json();
      if (!n || !n.id || !n.body) return null;
      if (n.until && Date.now() > n.until) return null;   // 기간 지난 알림
      if (n.test && !owner()) return null;   // 관리자 시험 알림은 직원 폰에 안 띄움
      return n;
    } catch (e) { return null; }
  }

  // 알림 소리: '딩-동-댕' 맑은 실로폰 소리 (긴급은 두 번). 파일 없이 폰에서 바로 만들어 냄
  let actx = null;
  function chime(urgent) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const play = () => {
        const t0 = actx.currentTime + 0.05, notes = [659.25, 830.61, 987.77, 1318.5];   // 미-솔#-시-(높은)미
        const rounds = urgent ? 2 : 1;
        for (let r = 0; r < rounds; r++) notes.forEach((f, i) => {
          const t = t0 + r * 1.1 + i * 0.16;
          for (const [mult, vol] of [[1, 0.32], [2, 0.08], [3, 0.04]]) {   // 기본음 + 배음 → 맑은 종소리
            const o = actx.createOscillator(), g = actx.createGain();
            o.type = 'sine'; o.frequency.value = f * mult;
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
            o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.95);
          }
        });
      };
      if (actx.state === 'running') return play();
      const once = () => { document.removeEventListener('pointerdown', once, true); actx.resume().then(play).catch(() => {}); };
      actx.resume().then(() => { if (actx.state === 'running') play(); else document.addEventListener('pointerdown', once, true); })   // 폰이 소리를 막아 두면 → 화면을 처음 누를 때 울림
        .catch(() => document.addEventListener('pointerdown', once, true));
    } catch (e) {}
  }

  // 화면 가운데 큰 알림 (뒤는 흐리게)
  function show(n, again = false) {
    if (shown) return;
    shown = true;
    const ov = document.createElement('div'); ov.className = 'ntov' + (n.level === 'urgent' ? ' urgent' : '');
    const card = document.createElement('div'); card.className = 'ntcard';
    const top = document.createElement('div'); top.className = 'nttop';
    top.innerHTML = `<span class="nticon">${n.level === 'urgent' ? '🚨' : '📢'}</span><span class="ntkind">${n.level === 'urgent' ? '긴급 알림' : '알림'}</span>`;
    const h = document.createElement('h2'); h.className = 'nttitle'; h.textContent = n.title || '알림';
    const body = document.createElement('div'); body.className = 'ntbody'; body.textContent = n.body;
    const meta = document.createElement('div'); meta.className = 'ntmeta'; meta.textContent = `${when(n.at)} · ${n.from || '관리자'}` + (n.until ? ` · ${when(n.until)}까지` : '');
    const ok = document.createElement('button'); ok.className = 'ntok'; ok.textContent = '확인했어요';
    ok.onclick = () => { try { localStorage.setItem(SEEN, n.id); } catch (e) {} ov.classList.remove('on'); setTimeout(() => { ov.remove(); shown = false; }, 200); };
    card.append(top, h, body, meta, ok); ov.append(card); document.body.append(ov);
    requestAnimationFrame(() => ov.classList.add('on'));
    if (!again && navigator.vibrate) navigator.vibrate(n.level === 'urgent' ? [300, 120, 300, 120, 300] : [200]);
    if (!again) chime(n.level === 'urgent');
  }

  async function check() {
    if (document.hidden) return;
    if (window.jcsIsMember && !window.jcsIsMember()) return;   // 가입 전에는 안 띄움
    const n = await fetchNotice();
    current = n;
    if (n && n.id !== seen()) show(n);
  }

  // ── 관리자: 알림 쓰기 ──
  async function publish(next) {
    const tok = token();
    const h = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' };
    const cur = await fetch(API + '?ref=main&t=' + Date.now(), { cache: 'no-store', headers: h }).catch(() => null);
    let sha;
    if (cur && cur.ok) sha = (await cur.json()).sha;
    else if (cur && (cur.status === 401 || cur.status === 403)) throw new Error('GitHub 키가 맞지 않아요.');
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(next, null, 1))));
    const r = await fetch(API, { method: 'PUT', headers: h, body: JSON.stringify({ message: next.id ? '알림 올리기' : '알림 내리기', content, ...(sha ? { sha } : {}) }) });
    if (!r.ok) throw new Error('저장하지 못했어요 (HTTP ' + r.status + ')');
  }
  function compose() {
    const ov = document.createElement('div'); ov.className = 'overlay';
    const box = document.createElement('div'); box.className = 'picker ntform';
    box.innerHTML = `<div class="ptitle">📢 알림 보내기</div>
      <div class="ntsub">모든 직원 폰에 화면 가운데 크게 떠요. (앱을 열거나 켜 둔 폰은 2분 안에)</div>
      <label>제목<input id="ntT" maxlength="40" placeholder="예: 내일 07시 비상소집"></label>
      <label>내용<textarea id="ntB" rows="5" maxlength="600" placeholder="직원들에게 알릴 내용을 적어 주세요."></textarea></label>
      <div class="ntrow"><span>중요도</span><label class="ntchip"><input type="radio" name="ntL" value="normal" checked> 📢 일반</label><label class="ntchip"><input type="radio" name="ntL" value="urgent"> 🚨 긴급</label></div>
      <div class="ntrow"><span>보여줄 기간</span><select id="ntU"><option value="1">오늘 하루</option><option value="3">3일</option><option value="7">일주일</option><option value="0">내릴 때까지</option></select></div>
      <div class="ntbtns"><button id="ntCancel" class="pclose">닫기</button><button id="ntOff" class="ntoff">지금 알림 내리기</button><button id="ntSend" class="ntsend">보내기</button></div>
      <button id="ntTest" class="nttest">🧪 내 폰에만 시험 보내기</button>
      <div class="ntstat" id="ntStat"></div>`;
    ov.append(box); document.body.append(ov);
    const $ = (s) => box.querySelector(s), stat = (m) => { $('#ntStat').textContent = m; };
    if (current) stat(`지금 떠 있는 알림: "${current.title || current.body.slice(0, 20)}" (${when(current.at)})`);
    $('#ntCancel').onclick = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    $('#ntSend').onclick = async () => {
      const body = $('#ntB').value.trim(); if (!body) { $('#ntB').focus(); return; }
      const days = +$('#ntU').value, now = Date.now();
      const end = new Date(); end.setHours(23, 59, 59, 0); end.setDate(end.getDate() + Math.max(0, days - 1));
      const next = { id: 'n' + now, title: $('#ntT').value.trim(), body, level: box.querySelector('input[name="ntL"]:checked').value, at: now, from: '관리자', until: days ? end.getTime() : 0 };
      if (!confirm('모든 직원 폰에 이 알림을 띄울까요?')) return;
      stat('보내는 중…');
      try { await publish(next); stat('✔ 보냈어요. 1~2분 안에 직원 폰에 떠요.'); current = next; setTimeout(() => ov.remove(), 1500); }
      catch (e) { stat('❌ ' + e.message); }
    };
    $('#ntTest').onclick = async () => {   // 직원 폰에는 안 가고 이 폰으로만 진짜 푸시가 오는지 시험
      let sub = null;
      try { sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch (e) {}
      if (!sub) { alert('먼저 이 폰에서 ⚙ 설정 → [🔔 알림 받기]를 켜 주세요.'); return; }
      const now = Date.now();
      const next = { id: 't' + now, test: true, to: sub.endpoint, title: $('#ntT').value.trim() || '시험 알림', body: $('#ntB').value.trim() || '알림이 잘 오는지 시험이에요.', level: box.querySelector('input[name="ntL"]:checked').value, at: now, from: '관리자', until: now + 3600e3 };
      stat('시험 알림 보내는 중…');
      try { await publish(next); stat('✔ 보냈어요. 지금 앱을 완전히 닫고 1~2분 기다려 보세요. 잠금화면에 오면 성공이에요. (직원 폰에는 안 가요)'); current = null; try { localStorage.setItem(SEEN, next.id); } catch (e) {} }
      catch (e) { stat('❌ ' + e.message); }
    };
    $('#ntOff').onclick = async () => {
      if (!confirm('지금 떠 있는 알림을 내릴까요? (아직 못 본 직원 폰에도 더 이상 안 떠요)')) return;
      stat('내리는 중…');
      try { await publish({ id: null, at: Date.now() }); stat('✔ 알림을 내렸어요.'); current = null; setTimeout(() => ov.remove(), 1200); }
      catch (e) { stat('❌ ' + e.message); }
    };
  }

  // ── 진짜 푸시 알림 (앱이 꺼져 있어도 잠금화면에) ──
  // 받는 폰 주소는 구글 앱스 스크립트(push.json 의 url)에 등록, 보내기는 GitHub가 함
  const VAPID = 'BGNqMzG7xXuKDECls8HgAa_0Td_nE79dgzVk5BGUMqw4hwg3WRgJBnPTsoqTALr8qiL7q9_f0JOwqlOKNdf3yds';
  let cfgP = null;
  const cfg = () => (cfgP || (cfgP = fetch('push.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})))); 
  const ua = navigator.userAgent, isIOS = /iPhone|iPad|iPod/i.test(ua);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64 = (b) => { const s = atob((b + '='.repeat((4 - (b.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...s].map((c) => c.charCodeAt(0))); };
  async function postSub(op, sub) {
    const c = await cfg(); if (!c.url) return;
    await fetch(c.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ op, sub: sub.toJSON(), ua: ua.slice(0, 120) }) });
  }
  async function pushState() {   // 'on' | 'off' | 'denied' | 'ios-home' | 'no' | 'wait'
    if (isIOS && !standalone()) return 'ios-home';
    if (!pushOK()) return 'no';
    const c = await cfg();
    if (!c.url || (c.open === false && !owner())) return 'wait';   // 관리자 시험 중에는 직원 폰에 안 보임
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission !== 'granted') return 'off';
    try { const reg = await navigator.serviceWorker.ready; return (await reg.pushManager.getSubscription()) ? 'on' : 'off'; } catch (e) { return 'off'; }
  }
  async function subscribe() {
    const st = await pushState();
    if (st === 'ios-home') { iosGuide(); return false; }
    if (st === 'no') { alert('이 브라우저는 알림을 받을 수 없어요. 크롬(안드로이드)이나 홈 화면에 설치한 앱(아이폰)으로 열어 주세요.'); return false; }
    if (st === 'wait') { alert('알림 서버를 준비 중이에요. 잠시 후 다시 눌러 주세요.'); return false; }
    if (st === 'denied') { alert('알림이 꺼져 있어요.\n폰 설정 → 앱(또는 크롬) → 알림에서 이 앱의 알림을 켜 주세요.'); return false; }
    if ((await Notification.requestPermission()) !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID) });
    await postSub('add', sub);
    try { localStorage.setItem('jcsPushAt', String(Date.now())); } catch (e) {}
    return true;
  }
  function iosGuide() {
    alert('아이폰은 앱을 홈 화면에 추가해야 알림을 받을 수 있어요.\n\n1) 사파리 아래 [공유 □↑] 버튼\n2) [홈 화면에 추가]\n3) 홈 화면의 정치쇼 아이콘으로 열고 [🔔 알림 받기]를 눌러 주세요.\n(가입 코드는 다시 안 물어봐요)');
  }
  // 처음 열 때 한 번 권유 카드 (나중에 → 3일 뒤 다시)
  async function askOnce() {
    if (window.jcsIsMember && !window.jcsIsMember()) return;
    let snooze = 0; try { snooze = +localStorage.getItem('jcsPushAsk') || 0; } catch (e) {}
    if (Date.now() < snooze || document.querySelector('.pushask')) return;
    const st = await pushState();
    if (st === 'on') {   // 이미 받는 중: 일주일에 한 번 주소를 다시 알려 둠 (목록이 지워졌을 때 대비)
      let at = 0; try { at = +localStorage.getItem('jcsPushAt') || 0; } catch (e) {}
      if (Date.now() - at > 7 * 864e5) { try { const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (sub) { await postSub('add', sub); localStorage.setItem('jcsPushAt', String(Date.now())); } } catch (e) {} }
      return;
    }
    if (st !== 'off' && st !== 'ios-home') return;
    if ((await cfg()).open === false && !owner()) return;
    const card = document.createElement('div'); card.className = 'pushask';
    card.innerHTML = `<div class="pa-ico">🔔</div><div class="pa-txt"><b>중요 알림을 폰으로 받으세요</b><span>${st === 'ios-home' ? '아이폰은 홈 화면에 추가하면 받을 수 있어요' : '앱이 꺼져 있어도 관리자 알림이 잠금화면에 떠요'}</span></div>`;
    const yes = document.createElement('button'); yes.className = 'pa-yes'; yes.textContent = st === 'ios-home' ? '방법 보기' : '알림 받기';
    const no = document.createElement('button'); no.className = 'pa-no'; no.textContent = '나중에';
    const close = () => card.remove();
    yes.onclick = async () => { close(); try { if (await subscribe()) alert('✔ 이제 중요 알림이 이 폰으로 와요.'); } catch (e) { alert('알림을 켜지 못했어요: ' + e.message); } };
    no.onclick = () => { try { localStorage.setItem('jcsPushAsk', String(Date.now() + 3 * 864e5)); } catch (e) {} close(); };
    card.append(yes, no); document.body.append(card);
  }
  // 알림을 눌러 앱이 열리면 → 큰 알림 화면
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'jcsNotice') { shown = false; check(); } });
  setTimeout(askOnce, 5000);

  window.jcsNotice = { compose, owner, again: () => (current ? (shown = false, show(current, true), true) : false), check, subscribe, pushState, iosGuide };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(check, 1500)); else setTimeout(check, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(check, 2 * 60000);
})();
