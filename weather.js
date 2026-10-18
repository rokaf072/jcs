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
      const s = w.now.pty > 0 ? PTY[w.now.pty] : SKY[w.now.sky] || (w.today && SKY[w.today.sky]) || '';
      add(`${ICON[s] || '●'} ${w.here ? '📍' : ''}${w.place || '목동'} 지금 `); add(`${w.now.t.toFixed(1)}°`, 't'); if (s) add(` ${s}`);
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
    track = document.createElement('div'); track.className = 'ledtrack'; box.style.cursor = 'pointer';
    box.append(track);
    // PC: 날짜 옆 / 폰: 상단 상태 바 아래 한 줄
    const date = document.querySelector('header .date');
    const spacer = document.querySelector('header .hrow1 .spacer');
    if (spacer) { spacer.append(box); spacer.classList.add('ledspot'); box.classList.add('pc'); }   // 날짜와 오른쪽 버튼 사이 빈 곳 가운데
    else if (date) { date.insertAdjacentElement('afterend', box); box.classList.add('pc'); }
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
  // ── 지금 있는 곳 날씨 (위치 허용 시) ──
  // 목동 근처(3km)면 기상청 자료(weather.json) 그대로, 다른 곳이면 그 동네 날씨를 Open-Meteo(키 없음)에서 바로 받음
  // 전광판을 누르면 '현위치 ↔ 목동' 바꾸기 (이 기기에 기억)
  const MOK = [37.5268, 126.8745];
  const ls = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const km = (a, b) => { const r = Math.PI / 180, x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r), y = (b[0] - a[0]) * r; return Math.hypot(x, y) * 6371; };
  const mode = () => ls.get('jcsWxMode') || 'here';
  function position() {
    const c = ls.get('jcsGeo');
    if (c && Date.now() - c.at < 30 * 60e3) return Promise.resolve(c);
    if (!navigator.geolocation) return Promise.resolve(c);
    return new Promise((ok) => {
      navigator.geolocation.getCurrentPosition(async (p) => {
        const g = { lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), at: Date.now() };
        g.place = c && c.place && km([c.lat, c.lon], [g.lat, g.lon]) < 1 ? c.place : await placeName(g.lat, g.lon);
        ls.set('jcsGeo', g); ok(g);
      }, () => ok(c), { timeout: 10000, maximumAge: 20 * 60e3, enableHighAccuracy: false });
    });
  }
  async function placeName(lat, lon) {
    try {
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ko`);
      const j = await r.json();
      const adm = ((j.localityInfo || {}).administrative || []).map((x) => x.name).filter((n) => /[가-힣]/.test(n || ''));
      const dong = adm.reverse().find((n) => /(동|읍|면|리)$/.test(n)) || '';
      const city = (j.city || '').replace(/(특별시|광역시|특별자치시)$/, '');
      return (dong && !/리$/.test(dong) ? dong : '') || j.locality && /[가-힣]/.test(j.locality) && j.locality || city || '현위치';
    } catch (e) { return '현위치'; }
  }
  // 세계 날씨 코드 → 기상청식 하늘·강수
  const wmo = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86 ? { pty: 3 } : c >= 95 || (c >= 80 && c <= 82) ? { pty: 4 } : (c >= 51 && c <= 67) ? { pty: 1 } : { sky: c <= 1 ? 1 : c === 2 ? 3 : 4, pty: 0 };
  const g10 = (v) => (v == null ? null : v <= 30 ? 1 : v <= 80 ? 2 : v <= 150 ? 3 : 4), g25 = (v) => (v == null ? null : v <= 15 ? 1 : v <= 35 ? 2 : v <= 75 ? 3 : 4);
  async function here(g, base) {
    const ck = ls.get('jcsWxHere');
    if (ck && ck.key === `${g.lat},${g.lon}` && Date.now() - ck.w.at < 10 * 60e3) return ck.w;
    const q = `latitude=${g.lat}&longitude=${g.lon}&timezone=Asia%2FSeoul`;
    const [f, a] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code&hourly=temperature_2m,precipitation_probability,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=2`).then((r) => r.json()),
      fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=pm10,pm2_5`).then((r) => r.json()).catch(() => null),
    ]);
    if (!f || !f.current) return null;
    const cur = f.current, cw = wmo(cur.weather_code);
    const w = { at: Date.now(), place: g.place || '현위치', here: true, warns: [] };
    w.now = { t: cur.temperature_2m, reh: Math.round(cur.relative_humidity_2m), pty: cw.pty, rn1: cur.precipitation > 0 ? cur.precipitation + 'mm' : '강수없음' };
    const H = f.hourly || {}, times = H.time || [];
    const nowH = (cur.time || '').slice(0, 13);
    const day = (d, fromNow) => {
      const idx = times.map((t, i) => [t, i]).filter(([t]) => t.startsWith(d) && (!fromNow || t.slice(0, 13) >= nowH)).map(([, i]) => i);
      if (!idx.length) return null;
      const codes = idx.map((i) => wmo(H.weather_code[i])), pops = idx.map((i) => H.precipitation_probability[i]).filter((x) => x != null);
      const rain = idx.find((i) => wmo(H.weather_code[i]).pty > 0);
      const skys = codes.map((c) => c.sky).filter(Boolean);
      const mode_ = (arr) => arr.sort((x, y) => arr.filter((z) => z === y).length - arr.filter((z) => z === x).length)[0];
      const di = (f.daily.time || []).indexOf(d);
      return { min: di >= 0 ? f.daily.temperature_2m_min[di] : null, max: di >= 0 ? f.daily.temperature_2m_max[di] : null, pop: pops.length ? Math.max(...pops) : null,
        sky: skys.length ? mode_(skys) : null, pty: rain != null ? wmo(H.weather_code[rain]).pty : 0, rainFrom: rain != null ? times[rain].slice(11, 13) + '00' : null };
    };
    const d0 = (f.daily.time || [])[0], d1 = (f.daily.time || [])[1];
    if (!cw.pty) w.now.sky = cw.sky;
    w.today = day(d0, true) || day(d0); w.tomorrow = d1 ? day(d1) : null;
    if (w.today && !w.now.pty && cw.sky) w.today.sky = cw.sky;   // '지금' 하늘은 지금 상태로
    if (d1) {
      const m = times.map((t, i) => [t, i]).filter(([t]) => t.startsWith(d1) && t.slice(11, 13) >= '06' && t.slice(11, 13) <= '09').map(([, i]) => i);
      if (m.length) { const c = wmo(H.weather_code[m[0]]); w.tomorrowMorning = { t: Math.min(...m.map((i) => H.temperature_2m[i])), pop: Math.max(...m.map((i) => H.precipitation_probability[i] || 0)), pty: Math.max(...m.map((i) => wmo(H.weather_code[i]).pty)), sky: c.sky || 4 }; }
    }
    if (a && a.current) w.air = { g10: g10(a.current.pm10), g25: g25(a.current.pm2_5) };
    if (base && /서울|강서|양천|영등포|구로|마포|은평/.test(g.place || '')) w.warns = base.warns || [];   // 서울이면 기상청 특보도
    ls.set('jcsWxHere', { key: `${g.lat},${g.lon}`, w });
    return w;
  }
  async function mokdong() {
    try {
      const r = await fetch(URL_ + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      const w = await r.json();
      return Date.now() - w.at > 6 * 3600e3 ? null : w;   // 6시간 넘은 자료는 안 보여줌
    } catch (e) { return null; }
  }
  async function load() {
    const base = await mokdong();
    let w = base;
    if (mode() === 'here' && window.jcsIsMember && !window.jcsIsMember()) { if (base) render(base); setTimeout(load, 15000); return; }   // 가입 전엔 위치를 묻지 않음
    if (mode() === 'here') {
      const g = await position().catch(() => null);
      if (g && km([g.lat, g.lon], MOK) > 3) w = (await here(g, base).catch(() => null)) || base;
    }
    if (w) { render(w); if (box) box.title = (w.here ? `${w.place} 날씨 (Open-Meteo) · 누르면 목동(SBS) 날씨로` : `목동(SBS) 날씨 · 기상청·에어코리아${mode() === 'here' ? ' (지금 목동 근처예요)' : ' · 누르면 현위치 날씨로'}`); }
  }
  document.addEventListener('click', (e) => {
    if (!box || !box.contains(e.target)) return;
    ls.set('jcsWxMode', mode() === 'here' ? 'mok' : 'here'); lastKey = ''; load();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
  setInterval(load, 10 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
})();
