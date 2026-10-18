// ───────── 방송 패널: 큰 화면은 양옆(진행표 · 신문), 노트북은 한 줄 상태 바 ─────────
// 인쇄에는 안 나옴. 방송 시간(평일 07:05~09:00)에는 ON AIR 램프가 켜짐
(() => {
  const DAYS = '일월화수목금토';
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const mk = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const toMin = (s) => { const m = (s || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const span = (p, i, n) => {
    const ms = (p.time || '').match(/(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/);
    if (ms) return [toMin(ms[1]), toMin(ms[2])];
    return PROG.multi ? [ON, OFF] : i === 0 ? [425, 480] : [480, 540];   // 시간 표시가 없으면 정치쇼 1부 07:05~08:00, 나머지 08:00~09:00
  };
  const ON = PROG.on, OFF = PROG.off;   // programs.js (정치쇼 07:05~09:00 / 뉴스직격 17:00~18:00)
  const human = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}시간 ${m}분` : `${m}분`; };
  function nextShow(now) {   // 다음 방송 시작 시각
    const d = new Date(now); d.setHours(Math.floor(ON / 60), ON % 60, 0, 0);
    if (now >= d) d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d;
  }

  // 화면 요소 만들기
  const header = document.querySelector('header');
  const bar = mk('div', 'airbar'); header && header.append(bar);
  const L = mk('aside', 'rail rail-l'), R = mk('aside', 'rail rail-r');
  // 무대 만들기: [왼쪽 패널][가운데(출연자+신문)][오른쪽 패널]
  const mainEl = document.getElementById('main'), newsEl = document.getElementById('news');
  const stage = mk('div', 'stage'), center = mk('div', 'center');
  mainEl.parentNode.insertBefore(stage, mainEl);
  center.append(mainEl); if (newsEl) center.append(newsEl);
  stage.append(L, center, R);

  function state() {
    const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
    const wk = now.getDay() > 0 && now.getDay() < 6;
    const today = ymd(now);
    const post = (typeof current !== 'undefined' && current) || null;
    const isToday = post && post.date === today;
    const live = wk && m >= ON && m < OFF;
    const parts = post ? post.parts.map((p, i) => { const [s, e] = span(p, i, post.parts.length); return { p, i, s, e, on: isToday && live && m >= s && m < e, done: isToday && m >= e }; }) : [];
    return { now, m, wk, live, isToday, post, parts };
  }

  function lamp(live, big) {
    const w = mk('div', 'onair' + (live ? ' live' : '') + (big ? ' big' : ''));
    w.append(mk('span', 'dot'), mk('b', null, live ? 'ON AIR' : 'OFF AIR'));
    if (big) { const eq = mk('span', 'eq'); for (let i = 0; i < 5; i++) eq.append(mk('i')); w.append(eq); }
    return w;
  }

  function statusText(st) {
    if (st.live) {
      const cur = st.parts.find((x) => x.on);
      const left = OFF - st.m;
      if (!st.isToday) return `지금 방송 중 · 종료까지 ${human(left)}`;
      const corner = cur && cur.p.corners.map((c) => c.name).filter(Boolean).join(' · ');
      return `${cur ? cur.p.label + ' 진행 중' : '방송 중'}${corner ? ' [' + corner + ']' : ''} · ${cur ? (cur.e - st.m) + '분 남음' : '종료까지 ' + human(left)}`;
    }
    const n = nextShow(st.now), diff = Math.round((n - st.now) / 60000);
    const tmr = new Date(st.now); tmr.setDate(tmr.getDate() + 1);
    const when = ymd(n) === ymd(st.now) ? '오늘' : ymd(n) === ymd(tmr) ? '내일' : `${n.getMonth() + 1}/${n.getDate()}`;
    return `다음 방송 ${when}(${DAYS[n.getDay()]}) ${hhmmStr(ON)} · ${human(diff)} 남음`;
  }

  function drawBar(st) {
    bar.textContent = '';
    bar.classList.toggle('live', st.live);
    bar.append(lamp(st.live, false), mk('span', 'atext', statusText(st)));
  }

  function drawLeft(st) {
    L.textContent = '';
    const card = mk('div', 'rpcard air');
    card.append(lamp(st.live, true), mk('div', 'rsub', `SBS 러브FM · 평일 ${hhmmStr(ON)} ~ ${hhmmStr(OFF)}`), mk('div', 'rstat', statusText(st)));
    if (st.live) {
      const pct = Math.max(0, Math.min(100, ((st.m - ON) / (OFF - ON)) * 100));
      const pg = mk('div', 'rprog'); const fill = mk('i'); fill.style.width = pct + '%'; pg.append(fill); card.append(pg);
    }
    L.append(card);
    const tl = mk('div', 'rpcard');
    tl.append(mk('div', 'rhead', st.post ? `${st.isToday ? '오늘' : st.post.date.slice(5).replace('-', '/')} 진행표` : '진행표'));
    if (!st.post || !st.post.parts.length) tl.append(mk('div', 'rnone', '출연자 글이 올라오면 여기에 진행 순서가 나와요.'));
    const list = mk('ol', 'tline');
    for (const x of st.parts) {
      const li = mk('li', (x.on ? 'on' : '') + (x.done && !x.on ? ' done' : ''));
      const t = mk('div', 'tt'); t.append(mk('b', null, x.p.label), mk('span', null, x.p.time || ''));
      li.append(t);
      for (const c of x.p.corners) {
        const row = mk('div', 'tc');
        if (c.name) row.append(mk('div', 'tcn', c.name));
        row.append(mk('div', 'tcg', c.guests.map((g) => g.name).join(', ') || '—'));
        li.append(row);
      }
      li.onclick = () => { const sec = document.querySelectorAll('#main .part')[x.i]; if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      list.append(li);
    }
    tl.append(list);
    L.append(tl);
    // 진행 중인 부에 불 들어오게
    document.querySelectorAll('#main .part').forEach((sec, i) => sec.classList.toggle('onair-part', !!(st.parts[i] && st.parts[i].on)));
  }

  function drawRight() {
    R.textContent = '';
    const N = window.jcsNews;
    const card = mk('div', 'rpcard');
    card.append(mk('div', 'rhead', '📰 오늘의 신문'));
    if (!N || !N.items.length) { card.append(mk('div', 'rnone', '신문 기사를 불러오는 중이에요…')); R.append(card); return; }
    const recent = [...N.items].sort((a, b) => (b.t || 0) - (a.t || 0));
    const sbs = recent.filter(N.isSbs).slice(0, 4);
    const pol = recent.filter((i) => N.isPol(i) && !N.isSbs(i)).slice(0, 7);
    const sec = (label, list, cls) => {
      if (!list.length) return;
      card.append(mk('div', 'rlabel ' + cls, label));
      const ul = mk('ul', 'rnews');
      for (const i of list) {
        const li = mk('li', i.sum && i.sum.length ? 'has' : '');
        li.append(mk('span', 'rp', i.paper), mk('span', 'rt', N.title(i.title)));
        li.onclick = () => N.open(i);
        ul.append(li);
      }
      card.append(ul);
    };
    sec('SBS 소식', sbs, 'sbs');
    sec('정치 헤드라인', pol, 'pol');
    const more = mk('button', 'rmore', '신문 요약 전체 보기 ↓');
    more.onclick = () => { const n = document.getElementById('news'); if (n) n.scrollIntoView({ behavior: 'smooth' }); };
    card.append(more);
    R.append(card);
  }

  function update() {
    const st = state();
    drawBar(st); drawLeft(st);
    const h = header ? header.getBoundingClientRect().height : 120;
    document.documentElement.style.setProperty('--hh', Math.round(h) + 'px');
  }
  document.addEventListener('jcsrender', update);
  document.addEventListener('jcsnews', drawRight);
  window.addEventListener('resize', update);
  setInterval(update, 30000);
  update(); drawRight();
})();
