// 정치쇼 출연자 — 휴대폰(웹앱) 버전
// 출연자 명단: SBS 게시판 API 직접 호출 (SBS가 외부 호출을 허용함)
// 사진: 다음(카카오) 이미지 검색 + 얼굴 대조. 네이버·구글은 휴대폰 브라우저에서 직접 읽을 수 없어 제외.

const LIST_URL = 'https://programs.sbs.co.kr/radio/lchshow/board/65364';
const API = 'https://api.board.sbs.co.kr/bbs/V2.0/basic/board';
const BOARD = 'lchshow_02';
const viewUrl = (no) => `${LIST_URL}/?cmd=view&board_no=${no}`;
const $ = (s) => document.querySelector(s);
const store = {
  get(k) { try { const v = localStorage.getItem('gb:' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('gb:' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('gb:' + k); } catch (e) {} },
};
const kakaoKey = () => store.get('kakaoKey') || '';

const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dateFromTitle = (t) => { const m = (t || '').match(/^(\d{2})(\d{2})(\d{2})/); return m ? `20${m[1]}-${m[2]}-${m[3]}` : ''; };
const prettyDate = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };
function status(msg, err = false) { const e = $('#status'); e.textContent = msg; e.className = err ? 'err' : ''; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

let posts = [], current = null, waitTimer = null;

// ───────── SBS API ─────────
async function getJsonp(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('SBS 응답 ' + res.status);
  const t = await res.text();
  return JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')')));
}
function htmlToText(html) {
  const s = (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n');
  return new DOMParser().parseFromString(`<body>${s}</body>`, 'text/html').body.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
async function fetchList() {
  status('SBS 게시판 확인 중…');
  const j = await getJsonp(`${API}/lists?board_code=${BOARD}&offset=0&limit=16&action_type=callback&callback=boardListCallback_${BOARD}`);
  posts = (j.list || []).filter((x) => x.DELETED !== 'Y')
    .map((x) => ({ no: x.NO, title: x.TITLE, updated: x.UPDATE_DATE || x.REG_DATE || '', date: dateFromTitle(x.TITLE) || (x.REG_DATE || '').slice(0, 10) }))
    .filter((p) => p.date);
  store.set('posts', posts);
}
async function fetchPost(p) {
  status(`${prettyDate(p.date)} 방송내용 읽는 중…`);
  const j = await getJsonp(`${API}/detail/${p.no}?action_type=callback&board_code=${BOARD}&callback=boardViewCallback_${BOARD}`);
  const d = j.Response_Data_For_Detail;
  if (!d) throw new Error('본문을 읽지 못했어요.');
  const body = htmlToText(d.CONTENT), title = htmlToText(d.TITLE);
  const post = { date: p.date, updated: p.updated, title, body, registered: (d.REG_DATE || '').slice(0, 16).replace(/-/g, '.'), url: viewUrl(d.NO), ...parseBody(body, title), fetchedAt: Date.now() };
  store.set('post:' + p.date, post);
  return post;
}

// ───────── 얼굴 인식 ─────────
let faceReady = null;
function loadFace() {
  if (!faceReady) faceReady = (async () => {
    try { await faceapi.tf.setBackend('webgl'); } catch (e) { await faceapi.tf.setBackend('cpu'); }
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('lib/model'),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri('lib/model'),
      faceapi.nets.faceRecognitionNet.loadFromUri('lib/model'),
    ]);
    return true;
  })().catch(() => false);
  return faceReady;
}
const faceMemo = new Map();
function loadImgCors(url) {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = url; });
}
function analyze(url) {   // null = 확인 불가(사진 서버가 분석을 막음)
  if (!faceMemo.has(url)) faceMemo.set(url, (async () => {
    try {
      if (!(await loadFace())) return null;
      const im = await loadImgCors(url);
      const k = Math.min(1, 640 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      c.getContext('2d').getImageData(0, 0, 1, 1);   // 분석 가능한지 확인 (막히면 여기서 오류)
      const res = await faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks(true).withFaceDescriptors();
      const faces = res.map((r) => { const b = r.detection.box; return { cx: (b.x + b.width / 2) / c.width, cy: (b.y + b.height / 2) / c.height, ratio: (b.width * b.height) / (c.width * c.height), px: b.width, desc: Array.from(r.descriptor) }; })
        .filter((f) => f.px >= 28).sort((a, b) => b.ratio - a.ratio);
      return { faces };
    } catch (e) { return null; }
  })());
  return faceMemo.get(url);
}
const SAME = 0.5;
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };
const isPortrait = (a) => a && a.faces.length >= 1 && a.faces.length <= 3 && a.faces[0].ratio >= 0.012;

async function daumImages(g, sort, size) {
  if (!kakaoKey()) return [];
  const res = await fetch(`https://dapi.kakao.com/v2/search/image?sort=${sort}&size=${size}&query=` + encodeURIComponent(`${g.name} ${g.role}`.trim()),
    { headers: { Authorization: 'KakaoAK ' + kakaoKey() } });
  if (!res.ok) throw new Error('다음 검색 오류 ' + res.status);
  return ((await res.json()).documents || []).map((d) => ({ url: d.image_url, thumb: d.thumbnail_url, date: (d.datetime || '').slice(0, 10), collection: d.collection }));
}
async function identify(g) {
  const sources = [];
  const [acc, rec] = await Promise.all([daumImages(g, 'accuracy', 15).catch(() => []), daumImages(g, 'recency', 20).catch(() => [])]);
  try { (acc).forEach((x, i) => sources.push({ show: x.url, scan: x.thumb, alt: x.thumb, order: i })); } catch (e) {}
  try { (rec).filter((x) => x.collection === 'news').slice(0, 8).forEach((x, i) => sources.push({ show: x.url, scan: x.thumb, alt: x.thumb, order: -100 + i, news: true })); } catch (e) {}
  const faces = [];
  let best = null, support = 0;
  for (let i = 0; i < sources.length; i += 4) {          // 4장씩 동시에, 충분히 확인되면 멈춤
    const batch = sources.slice(i, i + 4);
    const res = await Promise.all(batch.map((x) => analyze(x.scan)));
    res.forEach((a, k) => { if (isPortrait(a)) for (const f of a.faces) faces.push({ ...f, img: i + k, src: batch[k], alone: a.faces.length === 1 }); });
    best = null; support = 0;
    for (const f of faces) {
      const seen = new Set([f.img]);
      for (const h of faces) if (h.img !== f.img && dist(f.desc, h.desc) < SAME) seen.add(h.img);
      if (seen.size > support) { support = seen.size; best = f; }
    }
    if (support >= 4) break;
  }
  if (!best || support < 3) return { url: '' };
  const m = faces.filter((h) => dist(best.desc, h.desc) < SAME)
    .sort((a, b) => (b.alone - a.alone) || (a.src.order - b.src.order) || (b.ratio - a.ratio))[0];
  return { url: m.src.show, alt: m.src.alt, cx: m.cx, cy: m.cy, desc: best.desc };
}
let photoBusy = 0; const photoWait = [];
async function limited(fn) {
  if (photoBusy >= 3) await new Promise((r) => photoWait.push(r));
  photoBusy++;
  try { return await fn(); } finally { photoBusy--; const n = photoWait.shift(); if (n) n(); }
}
async function getPhoto(g, onUpdate) {
  const manual = store.get('manual:' + g.name);
  if (manual) return manual;
  const key = 'auto:' + g.name + '|' + g.role;
  const cached = store.get(key);
  if (cached && Date.now() - cached.at < (cached.url ? 14 * 86400000 : 6 * 3600000)) return cached;   // 찾은 사진은 2주 유지
  if (!kakaoKey()) return cached || { url: '' };
  const job = limited(async () => {
    let rec = { url: '' };
    try { rec = await identify(g); } catch (e) {}
    if (!rec.url && cached && cached.url) rec = { ...cached };
    rec.at = Date.now();
    store.set(key, rec);
    return rec;
  });
  if (cached && cached.url) { job.then((r) => onUpdate && r.url !== cached.url && onUpdate(r)); return cached; }
  return job;
}
function setPhoto(box, info, name) {
  info = info || {};
  box.textContent = '';
  box.classList.toggle('unsure', !info.url);
  if (info.url) {
    const img = document.createElement('img');
    img.referrerPolicy = 'no-referrer'; img.alt = name; img.src = info.url;
    if (info.cy != null) img.style.objectPosition = `${Math.round((info.cx ?? 0.5) * 100)}% ${Math.round(Math.min(info.cy, 0.6) * 100)}%`;
    img.onerror = () => { if (info.alt && img.src !== info.alt) img.src = info.alt; else setPhoto(box, {}, name); };
    box.append(img);
  } else {
    box.append(el('div', null, name.slice(-2)), el('div', 'need', kakaoKey() ? '탭해서 사진 확인' : '⚙에서 키 입력'));
  }
}
function openPicker(g, ph) {
  if (!kakaoKey()) { askKey(); return; }
  const ov = el('div', 'overlay'), box = el('div', 'picker');
  box.append(el('div', 'ptitle', `${g.name} 사진 고르기`), el('div', 'psub', `다음 이미지 · "${g.name} ${g.role}" · 탭하면 고정`));
  const grid = el('div', 'pgrid'), close = el('button', 'pclose', '닫기');
  close.onclick = () => ov.remove(); ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  box.append(grid, close); ov.append(box); document.body.append(ov);
  const ident = (store.get('auto:' + g.name + '|' + g.role) || {}).desc;
  const pickUrl = async (url, scan) => {
    ov.remove();
    const a = await analyze(scan || url);
    const rec = { url, alt: scan, ...(a && a.faces.length ? { cx: a.faces[0].cx, cy: a.faces[0].cy } : {}) };
    store.set('manual:' + g.name, rec); setPhoto(ph, rec, g.name);
  };
  // 직접 등록: 구글/네이버에서 찾기, 이미지 주소 붙여넣기, 갤러리 사진 선택
  const q = encodeURIComponent(`${g.name} ${g.role}`.trim());
  const bar = el('div', 'mbar');
  const r1 = el('div', 'mrow');
  const ga = el('a', null, '구글에서 찾기'); ga.href = 'https://www.google.com/search?udm=2&q=' + q; ga.target = '_blank';
  const na = el('a', null, '네이버에서 찾기'); na.href = 'https://m.search.naver.com/search.naver?where=m_image&query=' + q; na.target = '_blank';
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    const bmp = await createImageBitmap(f); const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    pickUrl(c.toDataURL('image/jpeg', 0.85));
  };
  const fb = el('button', null, '갤러리 사진'); fb.onclick = () => file.click();
  r1.append(ga, na, fb, file);
  const r2 = el('div', 'mrow'); const inp = document.createElement('input'); inp.placeholder = '이미지 주소 붙여넣기';
  const okb = el('button', 'primary', '등록'); okb.onclick = () => { const u = inp.value.trim(); if (/^https?:/.test(u)) pickUrl(u); else inp.focus(); };
  r2.append(inp, okb);
  bar.append(el('div', 'mtitle', '원하는 사진이 없으면 직접 등록'), r1, r2, el('div', 'mhelp', '찾은 사진을 길게 눌러 "이미지 주소 복사" 후 붙여넣거나, 사진을 저장해서 [갤러리 사진]으로 고르세요.'));
  box.insertBefore(bar, grid);
  const section = (t) => { const w = el('div', 'pmsg', '찾는 중…'), end = el('div', 'pend'); grid.append(el('div', 'psec', t), w, end); return { w, end }; };
  const add = (sec, it) => {
    const wrap = el('div', 'pitem'), im = document.createElement('img');
    im.referrerPolicy = 'no-referrer'; im.src = it.thumb || it.url;
    im.onerror = () => wrap.remove();
    im.onclick = () => pickUrl(it.url, it.thumb);
    wrap.append(im);
    if (it.date) wrap.append(el('span', 'pdate', it.date));
    sec.end.before(wrap);
    analyze(it.thumb).then((a) => {
      if (a && !isPortrait(a)) { wrap.classList.add('noface'); wrap.append(el('span', 'pbadge', '얼굴 없음')); }
      else if (a && ident && a.faces.some((f) => dist(f.desc, ident) < SAME)) wrap.append(el('span', 'pbadge same', '같은 얼굴'));
    });
  };
  const r = section('최신 이미지'), c = section('정확도순 이미지');
  daumImages(g, 'recency', 30).then((l) => { l.sort((a, b) => (b.collection === 'news') - (a.collection === 'news')); r.w.remove(); l.slice(0, 9).forEach((x) => add(r, x)); }).catch((e) => { r.w.textContent = e.message; });
  daumImages(g, 'accuracy', 9).then((l) => { c.w.remove(); l.forEach((x) => add(c, x)); }).catch((e) => { c.w.textContent = e.message; });
}
function askKey() {
  const v = prompt('사진 검색용 카카오(다음) REST API 키를 입력하세요.\n이 휴대폰에만 저장돼요. (비우면 사진 없이 사용)', kakaoKey());
  if (v === null) return;
  store.set('kakaoKey', v.trim());
  if (current) render(current);
}

// ───────── 화면 ─────────
function render(post) {
  current = post;
  const main = $('#main'); main.textContent = '';
  const sum = el('div', 'summary');
  const total = post.parts.reduce((n, p) => n + p.corners.reduce((m, c) => m + c.guests.length, 0), 0);
  sum.append(el('b', null, `${prettyDate(post.date)} · 총 ${total}명 출연`));
  for (const p of post.parts) {
    const line = el('div');
    line.append(el('b', null, `${p.label}${p.time ? ' (' + p.time + ')' : ''} : `), document.createTextNode(p.corners.flatMap((c) => c.guests.map((g) => g.name)).join(', ') || '—'));
    sum.append(line);
  }
  main.append(sum);
  for (const p of post.parts) {
    const sec = el('section', 'part'), h = el('h2', null, p.label);
    if (p.time) h.append(el('span', 'time', p.time));
    sec.append(h);
    for (const c of p.corners) {
      const box = el('div', 'corner');
      if (c.name) box.append(el('div', 'cname', `[${c.name}]`));
      if (c.topic) box.append(el('div', 'topic', c.topic));
      const grid = el('div', 'guests');
      for (const g of c.guests) {
        const card = el('div', 'guest'), ph = el('div', 'photo');
        ph.append(el('div', null, g.name.slice(-2)), el('div', 'need', '사진 찾는 중…'));
        const info = el('div');
        info.append(el('div', 'gname', g.name), el('div', 'grole', g.role));
        const tools = el('div', 'gtools'), b = el('button', 'latest', '사진 고르기');
        b.onclick = () => openPicker(g, ph); ph.onclick = () => openPicker(g, ph);
        const a = el('a', null, '검색'); a.href = 'https://m.search.naver.com/search.naver?query=' + encodeURIComponent(`${g.name} ${g.role}`); a.target = '_blank';
        tools.append(b, a); info.append(tools);
        card.append(ph, info); grid.append(card);
        getPhoto({ ...g, topic: c.topic }, (r) => setPhoto(ph, r, g.name)).then((r) => setPhoto(ph, r, g.name));
      }
      box.append(grid); sec.append(box);
    }
    main.append(sec);
  }
  const raw = el('details', 'raw');
  raw.append(el('summary', null, '작가 원문 보기'), el('pre', null, `${post.title}\n\n${post.body}`));
  main.append(raw);
  status(`작가 등록 ${post.registered || '-'}`);
}
function fillSelect(selected) {
  const sel = $('#dateSel'); sel.textContent = '';
  const today = todayStr();
  if (!posts.some((p) => p.date === today)) { const o = el('option', null, prettyDate(today) + ' · 오늘 (아직 안 올라옴)'); o.value = today; sel.append(o); }
  for (const p of posts) { const o = el('option', null, prettyDate(p.date) + (p.date === today ? ' · 오늘' : '')); o.value = p.date; sel.append(o); }
  sel.value = selected || today;
}
function waitingMessage(date) {
  const dow = new Date(date + 'T00:00:00').getDay();
  if (dow === 0 || dow === 6) return { head: '오늘은 주말이에요', text: '김태현의 정치쇼는 월~금 방송이라 오늘은 출연자 글이 없어요.', auto: false };
  const n = new Date(), hm = n.getHours() * 60 + n.getMinutes();
  if (hm < 6 * 60 + 20) return { head: '아직 작가가 오늘 출연자를 올리지 않았어요', text: '이 화면을 열어두면 자동으로 확인해서, 올라오는 즉시 보여드릴게요.', auto: true };
  if (hm < 7 * 60 + 5) return { head: '아직 작가가 오늘 출연자를 올리지 않았어요', text: '평소보다 조금 늦어지고 있어요. 방송 시작(07:05) 전까지 자동으로 계속 확인할게요.', auto: true };
  if (hm < 9 * 60) return { head: '방송이 시작됐는데 아직 출연자 글이 없어요', text: '작가가 많이 늦어지고 있어요. 자동 확인은 계속하고 있고, 급하면 [원문]으로 게시판을 직접 확인해 보세요.', auto: true };
  return { head: '오늘 출연자 글이 올라오지 않았어요', text: '방송 시간(07:05~09:00)은 지났어요. 결방이나 특집 편성일 수 있어요.', auto: true };
}
function renderWaiting(date, note) {
  current = null;
  const m = waitingMessage(date), main = $('#main'); main.textContent = '';
  const box = el('div', 'waiting');
  const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  box.append(el('div', 'whead', m.head), el('div', 'wtext', note || m.text), el('div', 'wtime', m.auto ? `마지막 확인 ${t} · 3분마다 자동 확인 중` : `마지막 확인 ${t}`));
  main.append(box); status('');
  clearTimeout(waitTimer);
  if (m.auto && date === todayStr()) waitTimer = setTimeout(() => init(true), 3 * 60000);
}
async function show(date, force = false) {
  clearTimeout(waitTimer);
  try {
    const p = posts.find((x) => x.date === date);
    if (!p) { if (date === todayStr()) return renderWaiting(date); throw new Error('해당 날짜 글이 없어요.'); }
    let post = store.get('post:' + date);
    if (force || !post || (p.updated && post.updated !== p.updated)) post = await fetchPost(p);
    fillSelect(date);
    if (!post.parts.length && date === todayStr()) return renderWaiting(date, '오늘 글은 올라왔는데 출연자 명단이 아직 비어 있어요. 작가가 작성 중일 수 있어요. 자동으로 다시 확인할게요.');
    render(post);
  } catch (e) { status(e.message, true); }
}
async function init(force = false) {
  try {
    posts = store.get('posts') || [];
    try { await fetchList(); } catch (e) { if (!posts.length) throw e; status('인터넷 연결을 확인하세요. 저장된 내용을 보여드려요.', true); }
    fillSelect();
    const sel = $('#dateSel').value;
    await show(force && sel ? sel : todayStr(), false);
  } catch (e) { status(e.message, true); }
}
$('#dateSel').onchange = (e) => show(e.target.value);
$('#refresh').onclick = () => init(true);
$('#openPost').onclick = () => window.open(current && current.url ? current.url : LIST_URL, '_blank');
$('#settings').onclick = askKey;
document.addEventListener('visibilitychange', () => { if (!document.hidden) init(false); });   // 앱으로 돌아오면 다시 확인
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
init();
setTimeout(() => loadFace(), 0);
