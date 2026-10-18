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
  // PC 새 머리글: 전광판을 타이틀 줄 오른쪽에, 아래 [오늘의 출연자]의 '출' 글자부터 [오늘] 단추 끝까지 같은 길이로
  function placeLED() {
    const header = document.querySelector('header.titled'), tab = document.getElementById('tabGuests'), nav = document.querySelector('header .datenav'), row = document.querySelector('header .hrow1');
    if (!box || !header || !tab || !nav || !row) { if (box) box.classList.remove('ledfloat'); return; }
    const hr = header.getBoundingClientRect(), rr = row.getBoundingClientRect();
    let x0 = tab.getBoundingClientRect().left;
    try {   // '출' 글자의 왼쪽 끝 위치
      const walk = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT); let n;
      while ((n = walk.nextNode())) { const i = n.textContent.indexOf('출'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); x0 = r.getBoundingClientRect().left; break; } }
    } catch (e) {}
    const h1 = header.querySelector('h1'), titleEnd = h1 ? h1.getBoundingClientRect().right + 24 : 0;
    const date = header.querySelector('.hrow1 .date'), dateEnd = date ? date.getBoundingClientRect().right + 16 : 0;
    const left = Math.max(x0, titleEnd, dateEnd), right = nav.getBoundingClientRect().right;
    if (right - left < 260) { box.classList.remove('ledfloat'); box.style.cssText = ''; return; }   // 화면이 좁으면 원래 자리
    box.classList.add('ledfloat');
    box.style.left = Math.round(left - hr.left) + 'px';
    box.style.width = Math.round(right - left) + 'px';
    box.style.top = Math.round(rr.top - hr.top + (rr.height - box.offsetHeight) / 2) + 'px';
  }
  let placeQueued = false;
  const queuePlace = () => { if (placeQueued) return; placeQueued = true; requestAnimationFrame(() => { placeQueued = false; placeLED(); }); };
  window.addEventListener('resize', queuePlace);
  window.addEventListener('scroll', queuePlace, { passive: true });
  if (window.ResizeObserver) { const ro = new ResizeObserver(queuePlace); const watch = () => { const h = document.querySelector('header'); if (h) ro.observe(h); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch(); }
  document.addEventListener('jcsrender', queuePlace);
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
    queuePlace();
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
  // maxAgeMin: 이 시간 안에 확인한 위치면 그대로 씀 (앱 열 때·새로고침 1분, 화면 돌아올 때 10분, 켜 둔 동안은 다시 확인 안 함)
  // PC처럼 GPS가 없어 위치가 부정확(3km 넘게 오차)하면 쓰지 않음 → 직접 정한 동네 또는 목동
  function position(maxAgeMin = 1e9) {
    const fixed = ls.get('jcsWxPlace');
    if (fixed) return Promise.resolve(fixed);
    const c = ls.get('jcsGeo');
    if (c && Date.now() - c.at < maxAgeMin * 60e3) return Promise.resolve(c.bad ? null : c);
    if (!navigator.geolocation) return Promise.resolve(c && !c.bad ? c : null);
    return new Promise((ok) => {
      navigator.geolocation.getCurrentPosition(async (p) => {
        const g = { lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), acc: Math.round(p.coords.accuracy || 0), at: Date.now() };
        if (g.acc > 3000) { g.bad = true; ls.set('jcsGeo', g); ok(null); return; }   // 인터넷 주소로 짐작한 위치(엉뚱한 동네가 나옴)
        g.place = c && c.place && !c.bad && km([c.lat, c.lon], [g.lat, g.lon]) < 1 ? c.place : await placeName(g.lat, g.lon);
        ls.set('jcsGeo', g); ok(g);
      }, () => ok(c && !c.bad ? c : null), { timeout: 10000, maximumAge: Math.min(maxAgeMin, 10) * 60e3, enableHighAccuracy: false });
    });
  }
  // 동네 이름 → 좌표 (PC에서 직접 정할 때)
  async function geocode(q) {
    const key = typeof KAKAO_REST_KEY !== 'undefined' ? KAKAO_REST_KEY : '';
    if (key) {
      try {
        const r = await fetch('https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(q), { headers: { Authorization: 'KakaoAK ' + key } });
        const d = ((await r.json()).documents || [])[0];
        if (d) return { lat: +(+d.y).toFixed(4), lon: +(+d.x).toFixed(4), place: q.split(/\s+/).pop() };
        const r2 = await fetch('https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent(q), { headers: { Authorization: 'KakaoAK ' + key } });
        const d2 = ((await r2.json()).documents || [])[0];
        if (d2) return { lat: +(+d2.y).toFixed(4), lon: +(+d2.x).toFixed(4), place: q.split(/\s+/).pop() };
      } catch (e) {}
    }
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.split(/\s+/).pop())}&count=1&language=ko&countryCode=KR`);
      const d = ((await r.json()).results || [])[0];
      if (d) return { lat: +d.latitude.toFixed(4), lon: +d.longitude.toFixed(4), place: q.split(/\s+/).pop() };
    } catch (e) {}
    return null;
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
      const good = w && (w.now || w.today) && Date.now() - w.at < 6 * 3600e3;   // 6시간 넘은 자료는 안 보여줌
      if (good) { ls.set('jcsWxLast', w); return w; }
      const last = ls.get('jcsWxLast');   // 기상청이 잠깐 비었으면 직전에 받은 날씨를 그대로 (3시간까지)
      return last && Date.now() - last.at < 3 * 3600e3 ? last : null;
    } catch (e) { return null; }
  }
  async function load(maxAgeMin = 1e9) {
    let base = await mokdong();
    if (!base) {   // 기상청 자료가 비었으면(기상청 장애 등) 목동 날씨를 Open-Meteo에서 바로
      const m = await here({ lat: MOK[0], lon: MOK[1], place: '목동' }, null).catch(() => null);
      if (m) base = { ...m, here: false, alt: true };
    }
    let w = base;
    if (mode() === 'here' && window.jcsIsMember && !window.jcsIsMember()) { if (base) render(base); setTimeout(() => load(1), 15000); return; }   // 가입 전엔 위치를 묻지 않음
    if (mode() === 'here') {
      // 위치 허용 창에 아직 답을 안 했거나 위치 확인이 늦으면 → 먼저 목동 날씨를 보여주고, 위치가 오면 바꿈
      const posP = position(maxAgeMin).catch(() => null);
      let g = await Promise.race([posP, new Promise((ok) => setTimeout(() => ok('wait'), 3000))]);
      if (g === 'wait') { if (base) { render(base); titleFor(base); } g = await posP; }
      if (g && km([g.lat, g.lon], MOK) > 3) w = (await here(g, base).catch(() => null)) || base;
    }
    if (!w) return;
    render(w); titleFor(w);
  }
  function titleFor(w) {
    const bad = (ls.get('jcsGeo') || {}).bad && !ls.get('jcsWxPlace');
    if (box) box.title = w.here ? `${w.place} 날씨 (Open-Meteo) · 누르면 ${ls.get('jcsWxPlace') ? '동네 바꾸기' : '목동(SBS) 날씨로'}`
      : bad ? '목동(SBS) 날씨 · 이 기기는 위치를 정확히 몰라요. 누르면 동네를 직접 정할 수 있어요'
      : w.alt ? '목동(SBS) 날씨 · 기상청이 잠시 응답이 없어 Open-Meteo로 대신 보여줘요'
      : `목동(SBS) 날씨 · 기상청·에어코리아${mode() === 'here' ? ' (지금 목동 근처예요)' : ' · 누르면 현위치 날씨로'}`;
  }
  document.addEventListener('click', async (e) => {
    if (!box || !box.contains(e.target)) return;
    const bad = (ls.get('jcsGeo') || {}).bad, fixed = ls.get('jcsWxPlace');
    if (bad || fixed) {   // GPS 없는 PC: 동네를 직접 정함
      const q = prompt('이 기기는 위치를 정확히 알 수 없어요.\n날씨를 볼 동네를 적어 주세요. (예: 김포 고촌읍)\n비우고 확인하면 목동(SBS) 날씨로 돌아가요.', fixed ? fixed.place : '');
      if (q === null) return;
      if (!q.trim()) { localStorage.removeItem('jcsWxPlace'); ls.set('jcsWxMode', 'here'); }
      else {
        const g = await geocode(q.trim());
        if (!g) { alert('그 동네를 찾지 못했어요. "김포 고촌읍"처럼 시·읍·동 이름으로 적어 주세요.'); return; }
        ls.set('jcsWxPlace', { ...g, at: Date.now() }); ls.set('jcsWxMode', 'here');
      }
    } else ls.set('jcsWxMode', mode() === 'here' ? 'mok' : 'here');
    lastKey = ''; load(1);
  });
  // 새로고침(당겨서·F5·[새로고침] 단추)·앱을 새로 열 때는 위치를 새로 확인
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#refresh')) load(1); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => load(1)); else load(1);
  setInterval(() => load(1e9), 10 * 60e3);   // 켜 둔 동안은 위치는 다시 묻지 않고 날씨만 새로 받음
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(10); });
})();
