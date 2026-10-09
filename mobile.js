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
let photoGen = 0;
async function limited(fn) {
  if (photoBusy >= 3) await new Promise((r) => photoWait.push(r));
  photoBusy++;
  try { return await fn(); } finally { photoBusy--; const n = photoWait.shift(); if (n) n(); }
}
async function getPhoto(g, onUpdate) {
  if (store.get('none:' + g.name)) return { url: '' };   // 사용자가 지운 사진은 자동으로 다시 채우지 않음
  const manual = store.get('manual:' + g.name);
  if (manual) return manual;
  const key = 'auto:' + g.name + '|' + g.role;
  const cached = store.get(key);
  if (cached && Date.now() - cached.at < (cached.url ? 14 * 86400000 : 6 * 3600000)) return cached;   // 찾은 사진은 2주 유지
  if (!kakaoKey()) return cached || { url: '' };
  const myGen = photoGen;
  const job = limited(async () => {
    if (myGen !== photoGen) return cached || { url: '' };
    let rec = { url: '' };
    try { rec = await identify(g); } catch (e) {}
    if (!rec.url && cached && cached.url) rec = { ...cached };
    if (myGen !== photoGen) return rec;
    rec.at = Date.now();
    store.set(key, rec);
    if (rec.url) schedulePush();   // 폰에서 찾은 사진도 PC로
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
    const rec = { url, alt: scan, t: Date.now(), ...(a && a.faces.length ? { cx: a.faces[0].cx, cy: a.faces[0].cy } : {}) };
    store.set('manual:' + g.name, rec); store.del('none:' + g.name); setPhoto(ph, rec, g.name);
    schedulePush();
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
  photoGen++;
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
        const del = el('button', 'del', '사진 지우기');
        del.onclick = () => {
          if (!confirm(`${g.name} 사진을 지울까요?\n[사진 고르기]로 새로 고를 때까지 비워둬요.`)) return;
          store.del('manual:' + g.name); store.set('none:' + g.name, Date.now()); setPhoto(ph, {}, g.name);
          schedulePush();
        };
        tools.append(b, del, a); info.append(tools);
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
    await Promise.all([
      fetchList().catch((e) => { if (!posts.length) throw e; status('인터넷 연결을 확인하세요. 저장된 내용을 보여드려요.', true); }),
      Promise.race([syncPull(true), new Promise((r) => setTimeout(r, 4000))]),   // PC에서 고른 사진 받아오기
    ]);
    fillSelect();
    await show(todayStr(), false);   // 처음 열 때·새로고침 → 오늘
  } catch (e) { status(e.message, true); }
}
$('#dateSel').onchange = (e) => show(e.target.value);
$('#refresh').onclick = () => init(true);
$('#openPost').onclick = () => window.open(current && current.url ? current.url : LIST_URL, '_blank');
// ───────── 설정: 카카오 키 / 사진 백업 / 사진 복원 ─────────

// ───────── 사진 합치기 규칙 (백업·연동 공통) ─────────
// 형식: { photos:{ 이름:{url,cx,cy,t} }, none:{ 이름:t } }  t = 직접 고른/지운 시각 (자동으로 찾은 사진은 0)
function normPhotos(d) {
  const photos = {}, none = {};
  for (const [n, p] of Object.entries((d && d.photos) || {})) if (p && p.url) photos[n] = { url: p.url, cx: p.cx, cy: p.cy, t: typeof p.t === 'number' ? p.t : 1 };
  const nn = (d && d.none) || {};
  if (Array.isArray(nn)) nn.forEach((n) => { none[n] = 1; }); else for (const [n, t] of Object.entries(nn)) none[n] = typeof t === 'number' ? t : 1;
  return { photos, none };
}
// src에서 target보다 새로운 것만 골라냄 (force면 전부)
function diffPhotos(target, src, force) {
  const out = [];
  const cur = (n) => Math.max(target.photos[n] ? target.photos[n].t : -1, n in target.none ? target.none[n] : -1);
  for (const [n, p] of Object.entries(src.photos)) {
    const c = cur(n), tp = target.photos[n];
    if (tp && tp.url === p.url && !(n in target.none)) continue;
    if (force || c < 0 || p.t > c) out.push({ kind: 'photo', name: n, p });
  }
  for (const [n, t] of Object.entries(src.none)) {
    if (n in target.none && !target.photos[n]) continue;
    if (force || t > cur(n)) out.push({ kind: 'none', name: n, t });
  }
  return out;
}
function applyDiff(state, diff) {
  for (const d of diff) {
    if (d.kind === 'photo') { state.photos[d.name] = d.p; delete state.none[d.name]; }
    else { state.none[d.name] = d.t; delete state.photos[d.name]; }
  }
  return state;
}
function exportPhotos() {
  const photos = {}, none = {}, manual = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('gb:auto:')) { const r = store.get(k.slice(3)); if (r && r.url) photos[k.slice(8).split('|')[0]] = { url: r.url, cx: r.cx, cy: r.cy, t: 0 }; }
    if (k.startsWith('gb:manual:')) { const r = store.get(k.slice(3)); if (r && r.url) manual[k.slice(10)] = { url: r.url, cx: r.cx, cy: r.cy, t: r.t || 1 }; }
    if (k.startsWith('gb:none:')) { const v = store.get(k.slice(3)); none[k.slice(8)] = v === true ? 1 : v; }
  }
  Object.assign(photos, manual);
  for (const n of Object.keys(none)) delete photos[n];
  return { app: 'jcs-photos', version: 3, savedAt: new Date().toISOString(), photos, none };
}
function importPhotos(data, force = true) {
  if (!data || data.app !== 'jcs-photos') throw new Error('정치쇼 사진 백업 파일이 아니에요.');
  const diff = diffPhotos(normPhotos(exportPhotos()), normPhotos(data), force);
  for (const d of diff) {
    if (d.kind === 'photo') { store.set('manual:' + d.name, d.p); store.del('none:' + d.name); }
    else { store.set('none:' + d.name, d.t); store.del('manual:' + d.name); }
  }
  return diff.length;
}

const syncGet = async (k) => store.get(k);
const syncSet = async (k, v) => store.set(k, v);
async function getGhToken() { return store.get('ghToken') || ''; }

// ───────── PC ↔ 휴대폰 사진 자동 연동 (GitHub jcs 저장소의 photos.json) ─────────
const SYNC_URL = 'https://api.github.com/repos/rokaf072/jcs/contents/photos.json';
function utf8b64(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function fetchRemote(tok) {
  const res = await fetch(SYNC_URL, { cache: 'no-store', headers: { Accept: 'application/vnd.github.raw+json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) } })
    .catch(() => { throw new Error('GitHub에 접속하지 못했어요. 인터넷 연결을 확인해 주세요.'); });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('연동 사진을 읽지 못했어요 (' + res.status + ')');
  return res.json();
}
// 받아오기: 다른 기기에서 더 나중에 고르거나 지운 것만 반영 (이름별로 합침)
async function syncPull(silent) {
  try {
    const remote = await fetchRemote(await getGhToken());
    if (!remote) { if (!silent) status('아직 연동된 사진이 없어요. PC에서 [폰 연동]을 먼저 눌러 주세요.'); return 0; }
    const n = await importPhotos(remote, false);
    if (!silent) status(n ? `연동된 사진 ${n}건을 받아왔어요.` : '이미 최신이에요. 새로 받을 사진이 없어요.');
    return n;
  } catch (e) { if (!silent) status(e.message, true); return 0; }
}
// 올리기: GitHub에 있는 것과 내 것을 이름별로 합쳐서 저장 (다른 기기 사진을 지우지 않음)
async function syncPush() {
  const tok = await getGhToken();
  if (!tok) return 0;
  const h = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await fetch(SYNC_URL, { cache: 'no-store', headers: h }).catch(() => { throw new Error('GitHub에 접속하지 못했어요. 인터넷 연결을 확인해 주세요.'); });
    if (cur.status === 401 || cur.status === 403) throw new Error('GitHub 키가 맞지 않아요. 키를 다시 입력해 주세요.');
    let sha, remote = { photos: {}, none: {} };
    if (cur.ok) { const j = await cur.json(); sha = j.sha; try { remote = normPhotos(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))))); } catch (e) { const r = await fetchRemote(tok); if (r) remote = normPhotos(r); } }
    const mine = normPhotos(await exportPhotos());
    const diff = diffPhotos(remote, mine, false);
    if (sha && !diff.length) return Object.keys(remote.photos).length;   // 바뀐 것 없음
    const merged = applyDiff(remote, diff);
    const body = { app: 'jcs-photos', version: 3, savedAt: new Date().toISOString(), photos: merged.photos, none: merged.none };
    const res = await fetch(SYNC_URL, { method: 'PUT', headers: h,
      body: JSON.stringify({ message: '사진 연동 ' + body.savedAt, content: utf8b64(JSON.stringify(body)), ...(sha ? { sha } : {}) }) });
    if (res.ok) return Object.keys(merged.photos).length;
    if (res.status === 409 || res.status === 422) continue;   // 그 사이 다른 기기가 올림 → 다시 합쳐서 시도
    throw new Error(res.status === 401 || res.status === 403 || res.status === 404 ? 'GitHub 키가 맞지 않아요. 키를 다시 입력해 주세요.' : '연동 업로드 실패 (' + res.status + ')');
  }
  throw new Error('연동 업로드가 겹쳤어요. 잠시 뒤 다시 해 주세요.');
}
// ───────── 실시간 자동 연동: 다른 기기에서 사진이 바뀌면 열어둔 화면에 알아서 반영 ─────────
let liveEtag = null, liveBusy = false;
async function liveTick() {
  if (liveBusy || document.hidden || document.querySelector('.overlay')) return;   // 사진 고르는 중엔 건드리지 않음
  liveBusy = true;
  try {
    const tok = await getGhToken();
    const res = await fetch(SYNC_URL, { cache: 'no-store', headers: { Accept: 'application/vnd.github.raw+json',
      ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(liveEtag ? { 'If-None-Match': liveEtag } : {}) } });
    if (res.status === 304 || !res.ok) return;   // 바뀐 것 없음
    liveEtag = res.headers.get('ETag');
    const n = await importPhotos(await res.json(), false);
    if (n && current) {
      const y = window.scrollY;
      render(current);
      window.scrollTo(0, y);
      status(`다른 기기에서 바뀐 사진 ${n}건을 자동으로 반영했어요.`);
    }
  } catch (e) { /* 인터넷이 잠깐 끊겨도 다음에 다시 확인 */ }
  finally { liveBusy = false; }
}
async function startLiveSync() {
  const every = (await getGhToken()) ? 30000 : 90000;   // 키가 있으면 30초, 없으면 1분 30초마다 확인
  setInterval(liveTick, every);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) liveTick(); });   // 앱·창으로 돌아오면 바로 확인
  window.addEventListener('focus', liveTick);
}

let pushTimer = null;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    if (!(await getGhToken())) return;
    syncPush().then((n) => { if (n) status(`사진을 다른 기기와 연동했어요.`); }).catch((e) => status(e.message, true));
  }, 3000);
}
function openSettings() {
  const ov = el('div', 'overlay'), box = el('div', 'picker');
  box.append(el('div', 'ptitle', '설정'));
  const row = (label, desc, fn) => { const b = el('button', 'srow'); b.append(el('b', null, label), el('span', null, desc)); b.onclick = () => { ov.remove(); fn(); }; box.append(b); };
  row('카카오 키 입력', kakaoKey() ? '입력됨 · 바꾸려면 누르세요' : '사진 검색에 필요해요', askKey);
  row('PC 사진 지금 받아오기', 'PC에서 고른 사진을 바로 가져와요 (앱을 열 때도 자동)', async () => {
    status('PC 사진 확인 중…');
    const got = await syncPull(true);
    if (got && current) render(current);
    alert(got ? `PC에서 고른 사진 ${got}건을 받아왔어요.` : '이미 최신이에요. 새로 받을 사진이 없어요.\n(PC에서 [폰 연동]을 먼저 눌렀는지 확인해 주세요)');
  });
  row('폰에서 고른 사진도 PC로 보내기', store.get('ghToken') ? '켜짐 · GitHub 키 입력됨' : 'GitHub 키를 입력하면 폰에서 고른 사진도 PC에 연동돼요', () => {
    const t = prompt('GitHub 키를 붙여넣으세요. (비우면 끄기)', store.get('ghToken') || ''); if (t === null) return;
    const tok = t.replace(/\s+/g, '');
    if (!tok) { store.del('ghToken'); alert('폰 → PC 보내기를 껐어요.'); return; }
    if (!/^(github_pat_|ghp_)/.test(tok)) { alert('키 모양이 달라요. github_pat_ 으로 시작하는 키를 전부 붙여넣어 주세요.'); return; }
    store.set('ghToken', tok);
    status('GitHub 연결 확인 중…');
    syncPush().then((n) => { status(''); alert(`연결됐어요! 지금 폰에 있는 사진 ${n}명분을 PC로 보냈어요.\n앞으로 폰에서 고른 사진은 자동으로 PC에 연동돼요.`); })
      .catch((e) => { status(e.message, true); alert('연결 실패: ' + e.message); if (/키가 맞지/.test(e.message)) store.del('ghToken'); });
  });
  row('사진 백업', '지금 보이는 사진을 파일로 저장 (다운로드 폴더)', () => {
    const data = exportPhotos(), n = Object.keys(data.photos).length;
    if (!n) { alert('저장할 사진이 아직 없어요.'); return; }
    const d = new Date(), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `정치쇼사진백업_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`; a.click();
    status(`사진 ${n}명분을 백업 파일로 저장했어요. (다운로드 폴더)`);
  });
  row('사진 복원', '백업 파일에서 사진 되살리기 (PC 백업 파일도 가능)', () => {
    const f = document.createElement('input'); f.type = 'file'; f.accept = '.json,application/json';
    f.onchange = async () => {
      try { const n = importPhotos(JSON.parse(await f.files[0].text()), true); schedulePush(); if (current) render(current); status(`사진 ${n}건을 되살렸어요.`); }
      catch (e) { status(e.message, true); }
    };
    f.click();
  });
  const close = el('button', 'pclose', '닫기'); close.onclick = () => ov.remove();
  box.append(close); ov.append(box); ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  document.body.append(ov);
}
$('#settings').onclick = openSettings;
// 휴대폰이 저장 공간이 부족할 때 사진을 함부로 지우지 않도록 요청
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
// 앱으로 돌아왔을 때: 오늘을 보고 있을 때만 다시 확인 (지난 날짜를 직접 골라 보고 있으면 그대로 둠)
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#dateSel').value === todayStr()) init(false); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
init();
startLiveSync();
setTimeout(() => loadFace(), 0);
