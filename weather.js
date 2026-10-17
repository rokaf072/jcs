// ───────── 날씨 전광판: 날짜 옆에서 오른쪽 → 왼쪽으로 흐르는 LED 글씨 ─────────
// 자료: 기상청 동네예보·초단기실황 + 에어코리아 미세먼지 + 기상특보 (GitHub가 15분마다 weather.json 으로 받아 둠)
(() => {
  const IS_EXT = !!(window.chrome && chrome.runtime && chrome.runtime.id);
  const URL_ = IS_EXT ? 'https://rokaf072.github.io/jcs/weather.json' : 'weather.json';
  const SKY = { 1: '맑음', 3: '구름많음', 4: '흐림' };
  const PTY = { 1: '비', 2: '비/눈', 3: '눈', 4: '소나기', 5: '빗방울', 6: '빗방울·눈날림', 7: '눈날림' };
  const ICON = { 맑음: '☀', 구름많음: '⛅', 흐림: '☁', 비: '☂', '비/눈': '☂', 눈: '❄', 소나기: '☂', 빗방울: '☂', '빗방울·눈날림': '❄', 눈날림: '❄' };
  const GRADE = { 1: ['좋음', 'g'], 2: ['보통', 'y'], 3: ['나쁨', 'o'], 4: ['매우나쁨', 'r'] };
  const sky = (s, p) => (p > 0 ? PTY[p] || '비' : SKY[s] || '');
  const hhmm = (s) => (s ? `${+s.slice(0, 2)}시` : '');

  function segments(w) {
    const out = [];   // [글자, 색] 조각
    const add = (t, c = '') => out.push([t, c]);
    const dot = () => add('  ◆  ', 'dim');
    if (w.now) {
      const s = w.now.pty > 0 ? PTY[w.now.pty] : (w.today && SKY[w.today.sky]) || '';
      add(`${ICON[s] || '●'} ${w.place || '목동'} 지금 `); add(`${w.now.t.toFixed(1)}°`, 't'); if (s) add(` ${s}`);
      if (!isNaN(w.now.reh)) add(`  습도 ${w.now.reh}%`);
      if (w.now.pty > 0 && w.now.rn1 && w.now.rn1 !== '강수없음') add(`  시간당 ${w.now.rn1}`, 'c');
    }
    if (w.today) {
      dot(); add('오늘 ');
      if (w.today.min != null && w.today.max != null) { add(`${Math.round(w.today.min)}°`, 'c'); add(' / '); add(`${Math.round(w.today.max)}°`, 't'); }
      if (w.today.pop != null) { add('  강수확률 '); add(`${w.today.pop}%`, w.today.pop >= 60 ? 'c' : ''); }
      if (w.today.rainFrom) add(`  (${hhmm(w.today.rainFrom)}부터 ${PTY[w.today.pty] || '비'})`, 'c');
    }
    if (w.air) {
      dot();
      const a = GRADE[w.air.g10], b = GRADE[w.air.g25];
      if (a) { add('미세먼지 '); add(a[0], a[1]); }
      if (b) { add('  초미세먼지 '); add(b[0], b[1]); }
    }
    if (w.tomorrowMorning) {
      const m = w.tomorrowMorning, s = sky(m.sky, m.pty);
      dot(); add('내일 출근길 '); add(`${Math.round(m.t)}°`, 'c'); add(` ${ICON[s] || ''}${s}`);
      if (m.pop >= 30) add(`  강수 ${m.pop}%`, 'c');
    }
    if (w.tomorrow) {
      const s = sky(w.tomorrow.sky, w.tomorrow.pty);
      dot(); add('내일 '); if (w.tomorrow.min != null) { add(`${Math.round(w.tomorrow.min)}°`, 'c'); add(' / '); add(`${Math.round(w.tomorrow.max)}°`, 't'); }
      if (s) add(` ${ICON[s] || ''}${s}`);
      if (w.tomorrow.rainFrom) add(`  (${hhmm(w.tomorrow.rainFrom)}부터 ${PTY[w.tomorrow.pty] || '비'} ${w.tomorrow.pop}%)`, 'c');
    }
    for (const x of w.warns || []) { dot(); add(`⚠ ${x}`, 'r'); }
    return out;
  }

  let box = null, track = null, lastKey = '';
  function mount() {
    if (box) return box;
    box = document.createElement('div'); box.className = 'ledbox'; box.title = '기상청 동네예보 · 에어코리아 (목동)';
    track = document.createElement('div'); track.className = 'ledtrack';
    box.append(track);
    // PC: 날짜 옆 / 폰: 상단 상태 바 아래 한 줄
    const date = document.querySelector('header .date');
    if (date) { date.insertAdjacentElement('afterend', box); box.classList.add('pc'); }
    else { const head = document.querySelector('header'); if (head) head.append(box); else document.body.prepend(box); box.classList.add('mobile'); }
    return box;
  }
  function render(w) {
    const segs = segments(w);
    if (!segs.length) return;
    const key = JSON.stringify(segs);
    if (key === lastKey) return; lastKey = key;
    mount();
    track.textContent = '';
    const line = document.createElement('span'); line.className = 'ledline';
    for (const [t, c] of segs) { const s = document.createElement('span'); if (c) s.className = 'led-' + c; s.textContent = t; line.append(s); }
    // 끊김 없이 이어서 흐르도록 같은 줄을 두 번
    const gap = document.createElement('span'); gap.className = 'ledgap'; gap.textContent = '      ';
    line.append(gap);
    track.append(line, line.cloneNode(true));
    requestAnimationFrame(() => {
      const w1 = line.getBoundingClientRect().width;
      const sec = Math.max(14, w1 / 55);   // 1초에 약 55px — 전광판처럼 천천히
      track.style.setProperty('--led-w', w1 + 'px'); track.style.animationDuration = sec + 's';
    });
  }
  async function load() {
    try {
      const r = await fetch(URL_ + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const w = await r.json();
      if (Date.now() - w.at > 6 * 3600e3) return;   // 6시간 넘은 자료는 안 보여줌
      render(w);
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
  setInterval(load, 10 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
})();
