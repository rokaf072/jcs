// ───────── 신문 요약: 조선·중앙·한국경제·미디어오늘 — 정치 / 방송·언론 / SBS 관련(무조건) ─────────
// 인쇄에는 안 나옴. 받아둔 결과를 바로 보여주고 뒤에서 새로 받아 바꿈 (기다림 최소화)
(() => {
  const GN = (q) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=ko&gl=KR&ceid=KR:ko';
  const PAPERS = [
    { name: '조선일보', site: 'chosun.com', feeds: ['https://www.chosun.com/arc/outboundfeeds/rss/category/politics/?outputType=xml', 'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml'] },
    { name: '중앙일보', site: 'joongang.co.kr', feeds: [] },
    { name: '한국경제', site: 'hankyung.com', feeds: ['https://www.hankyung.com/feed/politics', 'https://www.hankyung.com/feed/all-news'] },
    { name: '미디어오늘', site: 'mediatoday.co.kr', feeds: ['https://www.mediatoday.co.kr/rss/allArticle.xml'] },
  ];
  const RE_SBS = /SBS|에스비에스|김태현의 정치쇼/i;
  // 방송국·언론 업계 기사 (예능·드라마 소식은 빼고)
  const RE_BROAD = /방통위|방송통신|방심위|방미통위|방송사|지상파|종편|공영방송|수신료|보도국|보도본부|보도국장|언론|기자협회|언론노조|방송법|재허가|재승인|이사회|사장 선임|앵커|시사 ?프로|편파|미디어|KBS|MBC|JTBC|YTN|TV조선|채널A|MBN|연합뉴스TV/;
  const RE_ENT = /런닝맨|미우새|미운 ?우리|드라마|예능|시청률|아이돌|결혼|열애|임신|컴백|앨범|뮤직|♥|배우|가수|걸그룹|보이그룹|팬미팅|OST|닥터X|\[사진\]|Oh!쎈|SC이슈|美친|시구|감독|야구|축구|골프/;
  const isEnt = (i) => RE_ENT.test(i.title) || /^\[(스포츠조선|OSEN|스타뉴스|엑스포츠)/.test(i.desc || '');
  const RE_POL = /국회|대통령|대통령실|청와대|여당|야당|민주당|국민의힘|조국혁신당|개혁신당|정부|장관|의원|총리|선거|정치|국감|국정감사|특검|탄핵|당대표|원내/;
  const MAX_AGE = 36 * 3600000;

  const strip = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };
  function parseRSS(xml, paper, src) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return [...doc.querySelectorAll('item')].map((it) => {
      const g = (t) => (it.querySelector(t) || {}).textContent || '';
      let title = strip(g('title')), desc = strip(g('description'));
      if (src === 'gn') { title = title.replace(/\s+-\s+[^-]+$/, ''); desc = ''; }   // 구글뉴스: "제목 - 신문사"
      if (desc.startsWith(title.slice(0, 20))) desc = '';
      const t = Date.parse(g('pubDate')) || 0;
      return { paper, title, link: g('link').trim(), desc: desc.slice(0, 140), t };
    }).filter((x) => x.title && x.link && (!x.t || Date.now() - x.t < MAX_AGE));
  }
  async function getText(url, ms = 6000) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store', credentials: 'omit' }); return r.ok ? await r.text() : ''; }
    catch (e) { return ''; } finally { clearTimeout(tm); }
  }
  async function loadPaper(p) {
    const jobs = p.feeds.map((u) => getText(u).then((x) => (x ? parseRSS(x, p.name, 'rss') : [])));
    // 신문사 RSS가 막히거나 없을 때 대비 + SBS 기사는 무조건 찾기: 구글 뉴스에서 그 신문사 기사만
    jobs.push(getText(GN(`site:${p.site} SBS when:3d`)).then((x) => (x ? parseRSS(x, p.name, 'gn') : [])).then((l) => l.map((i) => ({ ...i, sbsQ: true }))));
    jobs.push(getText(GN(`site:${p.site} 방송 when:1d`)).then((x) => (x ? parseRSS(x, p.name, 'gn') : [])));
    if (!p.feeds.length || p.name === '중앙일보') jobs.push(getText(GN(`site:${p.site} 정치 when:1d`)).then((x) => (x ? parseRSS(x, p.name, 'gn') : [])));
    const all = (await Promise.all(jobs)).flat();
    const seen = new Set(), out = [];
    for (const i of all.sort((a, b) => (b.desc ? 1 : 0) - (a.desc ? 1 : 0))) {   // 리드문 있는 쪽을 남김
      const key = i.title.replace(/\s|[^\w가-힣]/g, '').slice(0, 30);
      if (seen.has(key)) continue; seen.add(key); out.push(i);
    }
    return out.sort((a, b) => b.t - a.t);
  }
  // PC(확장 프로그램)는 신문사에서 직접 받고, 폰은 GitHub가 15분~1시간마다 대신 받아둔 news.json을 읽음
  const IS_EXT = !!(window.chrome && chrome.runtime && chrome.runtime.id && chrome.storage);
  const PAGES_NEWS = 'https://rokaf072.github.io/jcs/news.json';
  async function loadShared() {
    try { const r = await fetch((IS_EXT ? PAGES_NEWS : 'news.json') + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) {}
    return null;
  }
  // GitHub가 받아둔 것(요약·사진 포함)을 먼저 쓰고, PC는 그게 오래됐을 때만 신문사에서 직접 받음
  async function loadAll() {
    const shared = await loadShared();
    if (!IS_EXT) return shared || { at: 0, items: [] };
    if (shared && Date.now() - shared.at < 45 * 60000) return shared;
    const lists = await Promise.all(PAPERS.map((p) => loadPaper(p).catch(() => [])));
    const items = lists.flat();
    if (!items.length) return shared || { at: 0, items: [] };
    if (shared) { const m = new Map(shared.items.filter((i) => i.sum).map((i) => [keyOf(i.title), i])); for (const i of items) { const x = m.get(keyOf(i.title)); if (x) Object.assign(i, { sum: x.sum, img: x.img, url: x.url }); } }
    return { at: Date.now(), items };
  }
  const keyOf = (t) => t.replace(/\s+-\s+(조선비즈|조선일보|스포츠조선|중앙일보|중앙SUNDAY|한국경제|한경닷컴|한경|미디어오늘)\s*$/, '').replace(/\s|[^\w가-힣]/g, '').slice(0, 30);
  const cacheGet = async () => { try { return IS_EXT ? (await chrome.storage.local.get('newsCache')).newsCache : JSON.parse(localStorage.getItem('jcs:newsCache') || 'null'); } catch (e) { return null; } };
  const cacheSet = async (d) => { try { if (IS_EXT) await chrome.storage.local.set({ newsCache: d }); else localStorage.setItem('jcs:newsCache', JSON.stringify(d)); } catch (e) {} };

  const cleanTitle = (t) => t.replace(/\s+-\s+(조선비즈|조선일보|스포츠조선|중앙일보|중앙SUNDAY|한국경제|한경닷컴|한경|미디어오늘)\s*$/, '');
  const uniq = (list) => { const seen = new Set(); return list.filter((i) => { const k = cleanTitle(i.title).replace(/\s|[^\w가-힣]/g, '').slice(0, 30); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const hm = (t) => (t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  function item(i, showPaper) {
    const li = el('li', 'nitem');
    const a = el('a', 'ntitle', cleanTitle(i.title)); a.href = i.url || i.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.onclick = (e) => { e.preventDefault(); openArticle(i); };   // 누르면 앱 안에서 요약 보기 (광고 없이)
    if (i.sum && i.sum.length) li.classList.add('hassum');
    if (showPaper) li.append(el('span', 'npaper', i.paper));
    li.append(a);
    if (i.desc) li.append(el('div', 'ndesc', i.desc));
    li.append(el('div', 'ntime', hm(i.t)));
    return li;
  }
  let lastData = null;
  const viewMode = () => { try { return localStorage.getItem('jcsNewsView') === 'sbs' ? 'sbs' : 'all'; } catch (e) { return 'all'; } };
  function draw(data, loading) {
    const box = document.getElementById('news');
    if (!box) return;
    box.textContent = '';
    const head = el('div', 'nhead');
    head.append(el('h2', null, '📰 신문 요약'), el('span', 'nsub', loading ? '새 기사 받는 중…' : (data ? `불러온 시각 ${hm(data.at)}` : '')));
    // 보기 선택: 전체 / SBS만 (마지막 선택 기억)
    const seg = el('div', 'nseg');
    for (const [v, label] of [['all', '전체'], ['sbs', 'SBS만']]) {
      const b = el('button', 'nsegb' + (v === 'sbs' ? ' sbs' : '') + (viewMode() === v ? ' on' : ''), label);
      b.onclick = () => { try { localStorage.setItem('jcsNewsView', v); } catch (e) {} draw(lastData, false); };
      seg.append(b);
    }
    head.append(seg);
    const btn = el('button', 'nrefresh', '새로 받기'); btn.onclick = () => refresh(true); head.append(btn);
    box.append(head);
    lastData = data;
    if (!data || !data.items.length) { box.append(el('p', 'nempty', loading ? '기사를 불러오는 중이에요…' : '기사를 불러오지 못했어요. 인터넷 연결을 확인하고 [새로 받기]를 눌러주세요.')); return; }
    const items = uniq(data.items);
    // 1) SBS 관련 — 무조건 맨 위
    // 순서: 신문사별(정치 → 방송·언론, SBS 기사는 빨간 표시) → 맨 아래 SBS 예능·드라마·연예
    const isSbs = (i) => i.sbsQ || RE_SBS.test(i.title + ' ' + i.desc);
    const isNewsy = (i) => !isEnt(i) && (RE_BROAD.test(i.title + ' ' + i.desc) || RE_POL.test(i.title + ' ' + i.desc) || /SBS.{0,12}(노조|사장|임원|이사회|보도|광고|매출|실적|채용|공채|재허가|재승인|소송|징계|파업)/.test(i.title));
    if (viewMode() === 'sbs') {   // SBS 기사만: 뉴스·방송 / 예능·드라마·연예, 최신순
      const sbs = items.filter(isSbs).sort((a, b) => (b.t || 0) - (a.t || 0));
      const wrap = el('div', 'nsbsonly');
      for (const [label, list, cls] of [['SBS 뉴스·방송', sbs.filter(isNewsy), ''], ['SBS 예능·드라마·연예', sbs.filter((i) => !isNewsy(i)), ' ent']]) {
        const sec = el('section', 'nsbscol' + cls);
        sec.append(el('h3', null, `${label} (${list.length})`));
        if (list.length) { const ul = el('ul'); list.slice(0, 60).forEach((i) => ul.append(item(i, true))); sec.append(ul); }
        else sec.append(el('p', 'nempty', '기사 없음'));
        wrap.append(sec);
      }
      box.append(wrap);
      return;
    }
    const grid = el('div', 'ngrid');
    for (const p of PAPERS) {
      const ok = items.filter((i) => i.paper === p.name && isNewsy(i));
      const pol = ok.filter((i) => RE_POL.test(i.title + ' ' + i.desc) && !RE_BROAD.test(i.title + ' ' + i.desc));
      const broad = ok.filter((i) => !pol.includes(i));
      const col = el('section', 'ncol');
      col.append(el('h3', null, p.name));
      for (const [label, list] of [['정치', pol], ['방송·언론', broad.sort((a, b) => isSbs(b) - isSbs(a))]]) {
        col.append(el('h4', null, `${label} (${list.length})`));
        if (list.length) { const ul = el('ul'); list.slice(0, 8).forEach((i) => { const li = item(i, false); if (isSbs(i)) li.classList.add('nsbsitem'); ul.append(li); }); col.append(ul); }
        else col.append(el('p', 'nempty', '기사 없음'));
      }
      grid.append(col);
    }
    box.append(grid);
    const ent = items.filter((i) => isSbs(i) && !isNewsy(i));
    const sec = el('section', 'nsbs');
    sec.append(el('h3', null, `SBS 예능·드라마·연예 (${ent.length})`));
    if (ent.length) { const ul = el('ul'); ent.slice(0, 40).forEach((i) => ul.append(item(i, true))); sec.append(ul); }
    else sec.append(el('p', 'nempty', '기사 없음'));
    box.append(sec);
  }
  // ── 기사 요약 보기 창 ──
  function openArticle(i) {
    const ov = el('div', 'nov'); const box = el('div', 'nbox');
    const close = el('button', 'nclose', '닫기'); close.onclick = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    const top = el('div', 'ntop'); top.append(el('span', 'npaper', i.paper), el('span', 'ntime', hm(i.t)), close);
    box.append(top, el('h3', 'nh', cleanTitle(i.title)));
    if (i.img) { const im = document.createElement('img'); im.className = 'nimg'; im.referrerPolicy = 'no-referrer'; im.src = i.img; im.onerror = () => im.remove(); box.append(im); }
    if (i.sum && i.sum.length) {
      // 2~3문장씩 묶어 문단으로 (읽기 편하게)
      const wrap = el('div', 'nsum');
      for (let k = 0; k < i.sum.length; k += 2) wrap.append(el('p', null, i.sum.slice(k, k + 2).join(' ')));
      if (window.jcsMarkTerms) window.jcsMarkTerms(wrap);   // 어려운 용어에 밑줄 → 누르면 설명
      box.append(el('div', 'nlabel', '요약'), wrap, el('div', 'nhint', '밑줄 친 용어를 누르면 설명이 나와요. 다른 단어는 길게 눌러(PC는 마우스로 끌어) 고르면 찾아봐요.'));
    } else {
      if (i.desc) { const d = el('div', 'nsum'); d.append(el('p', null, i.desc)); if (window.jcsMarkTerms) window.jcsMarkTerms(d); box.append(d); }
      box.append(el('p', 'nempty', '이 기사는 아직 요약을 만들지 못했어요. 15분 안에 다시 시도해요.'));
    }
    const src = el('a', 'nsrc', '원문 기사 보기 (신문사 사이트, 광고 있음)'); src.href = i.url || i.link; src.target = '_blank'; src.rel = 'noopener noreferrer';
    box.append(src); ov.append(box); document.body.append(ov);
  }
  let busy = false;
  async function refresh(force) {
    if (busy) return; busy = true;
    try {
      const cached = await cacheGet();
      draw(cached, true);
      if (!force && cached && Date.now() - cached.at < 10 * 60000) { draw(cached, false); return; }   // 10분 안에 받은 건 그대로
      const data = await loadAll();
      if (data.items.length) await cacheSet(data);
      draw(data.items.length ? data : cached, false);
    } finally { busy = false; }
  }
  window.newsRefresh = refresh;
  refresh(false);
  setInterval(() => refresh(false), 15 * 60000);   // 켜두면 15분마다 갱신
  const go = document.getElementById('newsBtn');
  if (go) go.onclick = () => document.getElementById('news').scrollIntoView({ behavior: 'smooth' });
})();
