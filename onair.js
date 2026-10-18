// 폰: 위쪽 메뉴 바로 아래 한 줄 ON AIR 상태 바 (시계 안 봐도 지금 몇 부인지)
(() => {
  const DAYS = '일월화수목금토', ON = PROG.on, OFF = PROG.off;   // programs.js
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toMin = (s) => { const m = (s || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const span = (p, i) => { const m = (p.time || '').match(/(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/); return m ? [toMin(m[1]), toMin(m[2])] : PROG.multi ? [ON, OFF] : (i === 0 ? [425, 480] : [480, 540]); };
  const human = (n) => { const h = Math.floor(n / 60), m = n % 60; return h ? `${h}시간 ${m}분` : `${m}분`; };
  const header = document.querySelector('header');
  const bar = document.createElement('div'); bar.className = 'airbar';
  if (header) header.append(bar);
  function update() {
    const now = new Date(), m = now.getHours() * 60 + now.getMinutes(), wd = now.getDay();
    const live = wd > 0 && wd < 6 && m >= ON && m < OFF;
    const post = (typeof current !== 'undefined' && current) || null;
    const isToday = post && post.date === ymd(now);
    let text;
    let curIdx = -1;
    if (live) {
      if (isToday) post.parts.forEach((p, i) => { const [s, e] = span(p, i); if (m >= s && m < e) curIdx = i; });
      const cur = curIdx >= 0 ? post.parts[curIdx] : null;
      if (cur) {
        const [, e] = span(cur, curIdx);
        const corner = cur.corners.map((c) => c.name).filter(Boolean).join('·');
        text = `${cur.label} 진행 중${corner ? ' [' + corner + ']' : ''} · ${e - m}분 남음`;
      } else text = `방송 중 · 종료까지 ${human(OFF - m)}`;
    } else {
      const n = new Date(now); n.setHours(Math.floor(ON / 60), ON % 60, 0, 0);
      if (now >= n) n.setDate(n.getDate() + 1);
      while (n.getDay() === 0 || n.getDay() === 6) n.setDate(n.getDate() + 1);
      const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
      const when = ymd(n) === ymd(now) ? '오늘' : ymd(n) === ymd(tmr) ? '내일' : `${n.getMonth() + 1}/${n.getDate()}`;
      text = `다음 방송 ${when}(${DAYS[n.getDay()]}) ${hhmmStr(ON)} · ${human(Math.round((n - now) / 60000))} 남음`;
    }
    bar.className = 'airbar' + (live ? ' live' : '');
    bar.innerHTML = '';
    const lamp = document.createElement('span'); lamp.className = 'onair' + (live ? ' live' : '');
    lamp.innerHTML = '<span class="dot"></span><b>' + (live ? 'ON AIR' : 'OFF AIR') + '</b>';
    const t = document.createElement('span'); t.className = 'atext'; t.textContent = text;
    bar.append(lamp, t);
    // 진행 중인 부 강조 + 누르면 그 부분으로 이동
    const secs = document.querySelectorAll('#main .part');
    secs.forEach((sec, i) => sec.classList.toggle('onair-part', i === curIdx));
    bar.onclick = curIdx >= 0 && secs[curIdx] ? () => secs[curIdx].scrollIntoView({ behavior: 'smooth', block: 'start' }) : null;
  }
  document.addEventListener('jcsrender', update);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  setInterval(update, 30000);
  update();
})();
