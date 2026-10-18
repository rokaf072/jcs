// GitHub가 신문과 함께 15분마다 실행: SBS(목동) 날씨를 기상청·에어코리아에서 받아 weather.json 으로 저장
// 키는 GitHub 비밀 설정(KMA_KEY)에만 있음 → 폰·PC에는 키가 나가지 않음
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const KEY = process.env.KMA_KEY || '';
const NX = 58, NY = 126;          // 기상청 격자: 서울 양천구 목동 (SBS 목동 사옥)
const STATION = '양천구';          // 에어코리아 측정소
const AREA = /서울/;               // 기상특보에서 찾을 지역

if (!KEY) { console.log('KMA_KEY 없음 → 날씨 건너뜀'); process.exit(0); }
const enc = encodeURIComponent(KEY.includes('%') ? decodeURIComponent(KEY) : KEY);   // '인코딩'·'디코딩' 키 어느 쪽을 넣어도 됨

// 한국 시간
const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const hhmm = (d) => d.toISOString().slice(11, 16).replace(':', '');

let LASTERR = '';   // 기상청이 안 될 때 원인 (weather.json 의 err 로 남김)
async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const t = await r.text();
      if (t.trim().startsWith('{')) return JSON.parse(t);
      console.log('응답이 JSON이 아님:', t.slice(0, 200));
      LASTERR = (r.status + ' ' + t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).slice(0, 160);
    } catch (e) { console.log('실패', i + 1, e.message); LASTERR = 'fetch ' + e.message; }
    await new Promise((x) => setTimeout(x, 2000));
  }
  return null;
}
const items = (j) => (((j || {}).response || {}).body || {}).items?.item || [];

const now = kst();
const out = { at: Date.now(), place: '목동', ok: {} };

// 1) 지금 날씨 (초단기실황: 매시 정각 자료가 40분쯤 나옴)
{
  const t = new Date(now.getTime() - 40 * 60e3); t.setUTCMinutes(0);
  const j = await getJSON(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey=${enc}&pageNo=1&numOfRows=100&dataType=JSON&base_date=${ymd(t)}&base_time=${hhmm(t)}&nx=${NX}&ny=${NY}`);
  const v = {}; for (const it of items(j)) v[it.category] = it.obsrValue;
  if (v.T1H != null) {
    out.now = { t: +v.T1H, reh: +v.REH, pty: +v.PTY, rn1: v.RN1, wsd: +v.WSD, time: hhmm(t) };
    out.ok.now = true;
  }
}

// 2) 오늘·내일 예보 (단기예보: 02시 발표분에 오늘 최저·최고가 들어 있음)
{
  let base = new Date(now); let bt = '0200';
  if (+hhmm(now) < 215) { base = new Date(now.getTime() - 86400e3); bt = '2300'; }
  const j = await getJSON(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${enc}&pageNo=1&numOfRows=1500&dataType=JSON&base_date=${ymd(base)}&base_time=${bt}&nx=${NX}&ny=${NY}`);
  const days = {};
  for (const it of items(j)) {
    const d = (days[it.fcstDate] ||= { hours: {} });
    const h = (d.hours[it.fcstTime] ||= {});
    h[it.category] = it.fcstValue;
    if (it.category === 'TMN') d.min = +it.fcstValue;
    if (it.category === 'TMX') d.max = +it.fcstValue;
  }
  const today = ymd(now), tmr = ymd(new Date(now.getTime() + 86400e3));
  const pick = (key, fromHH) => {
    const d = days[key]; if (!d) return null;
    const hs = Object.entries(d.hours).filter(([hh]) => !fromHH || hh >= fromHH);
    if (!hs.length) return null;
    const tmps = hs.map(([, v]) => +v.TMP).filter((x) => !isNaN(x));
    const pops = hs.map(([, v]) => +v.POP).filter((x) => !isNaN(x));
    // 대표 하늘: 비·눈이 있으면 그것, 없으면 가장 많이 나온 하늘 상태
    const ptys = hs.map(([, v]) => +v.PTY).filter((x) => x > 0);
    const skys = hs.map(([, v]) => +v.SKY).filter((x) => x > 0);
    const mode = (a) => a.sort((x, y) => a.filter((z) => z === y).length - a.filter((z) => z === x).length)[0];
    const rainAt = hs.find(([, v]) => +v.PTY > 0);
    return {
      min: d.min ?? (tmps.length ? Math.min(...tmps) : null), max: d.max ?? (tmps.length ? Math.max(...tmps) : null),
      pop: pops.length ? Math.max(...pops) : null, sky: skys.length ? mode(skys) : null, pty: ptys.length ? mode(ptys) : 0,
      rainFrom: rainAt ? rainAt[0] : null,
    };
  };
  const nowHH = hhmm(now).slice(0, 2) + '00';
  out.today = pick(today, nowHH) || pick(today);
  if (out.today && days[today]) { out.today.min = days[today].min ?? out.today.min; out.today.max = days[today].max ?? out.today.max; }
  out.tomorrow = pick(tmr);
  // 내일 아침 출근길(06~09시)
  if (days[tmr]) {
    const m = Object.entries(days[tmr].hours).filter(([hh]) => hh >= '0600' && hh <= '0900');
    if (m.length) out.tomorrowMorning = { t: Math.min(...m.map(([, v]) => +v.TMP)), pop: Math.max(...m.map(([, v]) => +v.POP)), pty: Math.max(...m.map(([, v]) => +v.PTY)), sky: +m[0][1].SKY };
  }
  if (out.today || out.tomorrow) out.ok.fcst = true;
}

// 3) 미세먼지 (에어코리아 · 양천구 측정소)
{
  const j = await getJSON(`https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty?serviceKey=${enc}&returnType=json&numOfRows=1&pageNo=1&stationName=${encodeURIComponent(STATION)}&dataTerm=DAILY&ver=1.0`);
  const it = items(j)[0];
  if (it) { out.air = { pm10: +it.pm10Value || null, pm25: +it.pm25Value || null, g10: +it.pm10Grade || null, g25: +it.pm25Grade || null, time: it.dataTime }; out.ok.air = true; }
}

// 4) 기상특보 (서울에 걸린 것만)
{
  const j = await getJSON(`https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnStatus?serviceKey=${enc}&pageNo=1&numOfRows=10&dataType=JSON`);
  const it = items(j)[0];
  const warns = [];
  if (it && it.t6) {
    for (const line of String(it.t6).split(/\r?\n|o\s/)) {
      const m = line.match(/([가-힣]+(?:주의보|경보))\s*:\s*(.+)/);
      if (m && AREA.test(m[2])) warns.push(m[1]);
    }
    out.ok.warn = true;
  }
  out.warns = [...new Set(warns)];
}

// 기상청이 잠깐 응답을 안 하면(가끔 있음) 빈 날씨가 저장돼 전광판이 사라짐 → 3시간 안의 직전 값을 그대로 이어 씀
{
  let prev = {};
  try { if (existsSync('weather.json')) prev = JSON.parse(readFileSync('weather.json', 'utf8')); } catch (e) {}
  const got = prev.got || {};
  out.got = {};
  for (const k of ['now', 'today', 'tomorrow', 'tomorrowMorning', 'air']) {
    if (out[k] != null) out.got[k] = out.at;
    else if (prev[k] != null && Date.now() - (got[k] || prev.at || 0) < 3 * 3600e3) { out[k] = prev[k]; out.got[k] = got[k] || prev.at; }
  }
  if (!out.ok.warn && prev.warns) out.warns = prev.warns;
}
if (LASTERR && !(out.ok.now && out.ok.fcst)) out.err = LASTERR;
writeFileSync('weather.json', JSON.stringify(out));
console.log('날씨 저장', JSON.stringify(out.ok), out.now ? out.now.t + '°' : '');
