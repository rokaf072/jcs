// GitHub가 정해진 시간마다 실행: 조선·중앙·한국경제·미디어오늘 기사 목록 + 기사 요약·사진을 news.json으로 저장
// 폰·PC 앱은 이 파일만 읽음 → 광고 없이 앱 안에서 요약을 봄
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const GN = (q) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=ko&gl=KR&ceid=KR:ko';
const PAPERS = [
  { name: '조선일보', site: 'chosun.com', feeds: ['https://www.chosun.com/arc/outboundfeeds/rss/category/politics/?outputType=xml', 'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml'] },
  { name: '중앙일보', site: 'joongang.co.kr', feeds: [] },
  { name: '한국경제', site: 'hankyung.com', feeds: ['https://www.hankyung.com/feed/politics', 'https://www.hankyung.com/feed/all-news'] },
  { name: '미디어오늘', site: 'mediatoday.co.kr', feeds: ['https://www.mediatoday.co.kr/rss/allArticle.xml'] },
];
const RE_SBS = /SBS|에스비에스|김태현의 정치쇼/i;
const RE_BROAD = /방통위|방송통신|방심위|방미통위|방송사|지상파|종편|공영방송|수신료|보도국|보도본부|언론|기자협회|언론노조|방송법|재허가|재승인|이사회|사장 선임|앵커|시사 ?프로|편파|미디어|KBS|MBC|JTBC|YTN|TV조선|채널A|MBN|연합뉴스TV/;
const RE_POL = /국회|대통령|대통령실|청와대|여당|야당|민주당|국민의힘|조국혁신당|개혁신당|정부|장관|의원|총리|선거|정치|국감|국정감사|특검|탄핵|당대표|원내/;
const MAX_AGE = 36 * 3600000;
const SUFFIX = /\s+-\s+(조선비즈|조선일보|스포츠조선|중앙일보|중앙SUNDAY|한국경제|한경닷컴|한경|미디어오늘)\s*$/;

const ent = (s) => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&hellip;/g, '…').replace(/&lsquo;|&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const strip = (h) => ent(ent(h || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? m[1] : ''; };
const keyOf = (t) => t.replace(SUFFIX, '').replace(/\s|[^\w가-힣]/g, '').slice(0, 30);

function parseRSS(xml, paper, src) {
  return [...(xml || '').matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map(([it]) => {
    let title = strip(tag(it, 'title')), desc = strip(tag(it, 'description'));
    if (src === 'gn') { title = title.replace(/\s+-\s+[^-]+$/, ''); desc = ''; }
    title = title.replace(SUFFIX, '');
    if (desc.startsWith(title.slice(0, 20))) desc = '';
    const t = Date.parse(strip(tag(it, 'pubDate'))) || 0;
    return { paper, title, link: strip(tag(it, 'link')), desc: desc.slice(0, 140), t };
  }).filter((x) => x.title && x.link && (!x.t || Date.now() - x.t < MAX_AGE));
}
async function getText(url, opt = {}) {
  try {
    const r = await fetch(url, { ...opt, headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', ...(opt.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!r.ok) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    let txt = buf.toString('utf8');
    if (/euc-kr|ks_c_5601/.test(ct) || /charset=["']?(euc-kr|ks_c_5601)/i.test(txt.slice(0, 2000))) txt = new TextDecoder('euc-kr').decode(buf);
    return txt;
  } catch (e) { return ''; }
}
async function loadPaper(p) {
  const jobs = p.feeds.map((u) => getText(u).then((x) => parseRSS(x, p.name, 'rss')));
  jobs.push(getText(GN(`site:${p.site} SBS when:3d`)).then((x) => parseRSS(x, p.name, 'gn').map((i) => ({ ...i, sbsQ: true }))));
  jobs.push(getText(GN(`site:${p.site} 방송 when:1d`)).then((x) => parseRSS(x, p.name, 'gn')));
  if (!p.feeds.length || p.name === '중앙일보') jobs.push(getText(GN(`site:${p.site} 정치 when:1d`)).then((x) => parseRSS(x, p.name, 'gn')));
  const all = (await Promise.all(jobs)).flat();
  const seen = new Set(), out = [];
  for (const i of all.sort((a, b) => (b.desc ? 1 : 0) - (a.desc ? 1 : 0))) {
    const k = keyOf(i.title); if (seen.has(k)) continue; seen.add(k); out.push(i);
  }
  return out.sort((a, b) => b.t - a.t);
}

// ── 구글 뉴스 주소 → 실제 신문사 기사 주소 ──
async function gnResolve(link) {
  const m = link.match(/news\.google\.com\/(?:rss\/)?articles\/([^?/]+)/);
  if (!m) return link;
  const id = m[1];
  for (const page of [`https://news.google.com/articles/${id}`, `https://news.google.com/rss/articles/${id}`]) {
    const html = await getText(page);
    const sg = html.match(/data-n-a-sg="([^"]+)"/), ts = html.match(/data-n-a-ts="([^"]+)"/);
    if (!sg || !ts) continue;
    const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts[1]},"${sg[1]}"]`;
    const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
    const t = await getText('https://news.google.com/_/DotsSplashUi/data/batchexecute', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });
    try { const arr = JSON.parse(t.split('\n\n')[1]); const res = JSON.parse(arr[0][2]); if (res && /^https?:/.test(res[1])) return res[1]; } catch (e) {}
  }
  return '';
}

// ── 기사 본문·사진 뽑기 ──
const meta = (h, p) => { const m = h.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)["']`, 'i')) || h.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${p}["']`, 'i')); return m ? ent(m[1]) : ''; };
const JUNK = /무단 ?전재|재배포 ?금지|저작권자|Copyright|ⓒ|©|구독|기자\s*[\w.-]+@|@[\w-]+\.(co|com|kr)|▶|☞|좋아요|공유하기|글자 ?크기|글씨 ?크기|프린트|이 기사를|많이 본 뉴스|관련기사|관련 기사|광고|입력\s?20\d\d|업데이트\s?20\d\d|수정\s?20\d\d|검색 먼저 보기|기사 저장|뉴스레터|기사제보|제보하기|AI 요약|음성으로 듣기/;
// 시작 태그 위치부터 짝이 맞는 닫는 태그까지 잘라냄 (안쪽 div가 여러 겹이어도 정확히)
function sliceEl(html, i) {
  const name = (html.slice(i + 1).match(/^(\w+)/) || [])[1];
  if (!name) return '';
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi'); re.lastIndex = i;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[1]) { depth--; if (depth <= 0) return html.slice(i, m.index); }
    else if (!m[0].endsWith('/>')) depth++;
  }
  return html.slice(i, i + 60000);
}
function textOf(box) {
  const cleaned = box
    .replace(/<(script|style|figure|figcaption|table|aside|button|noscript|iframe|svg|ul|ol)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<div[^>]+(?:class|id)=["'][^"']*(?:ad|banner|related|recommend|photo|caption|byline|reporter|copyright|tag|share|sns|link|box_|promotion)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h\d>/gi, '\n');
  return strip(cleaned.replace(/\n/g, ' ¶ ')).split(/\s*¶\s*/).map((x) => x.trim()).filter((x) => x.length > 20);
}
// 신문사별 본문 칸 (앞에 있을수록 우선)
const BODY_IDS = [/id=["']article-view-content-div["']/i, /id=["']articletxt["']/i, /id=["']article_body["']/i, /class=["'][^"']*\barticle-body\b[^"']*["']/i, /class=["'][^"']*\barticle_body\b[^"']*["']/i, /itemprop=["']articleBody["']/i, /class=["'][^"']*\b(news_body|article-text|story-news|article_txt)\b[^"']*["']/i];
function paragraphs(html) {
  // 1) 기사 구조 데이터(JSON-LD)의 articleBody
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (o) => { if (!o || typeof o !== 'object') return ''; if (typeof o.articleBody === 'string' && o.articleBody.length > 200) return o.articleBody; for (const k in o) { const r = walk(o[k]); if (r) return r; } return ''; };
      const b = walk(JSON.parse(m[1].trim()));
      if (b) return b.split(/\n+|(?<=다\.)\s+/).map((x) => strip(x)).filter((x) => x.length > 20);
    } catch (e) {}
  }
  // 2) 조선일보·조선비즈(Arc): 본문이 페이지 속 데이터에 "type":"text" 조각으로 들어 있음 (순서 무관하게 찾기)
  const arc = [];
  for (const m of html.matchAll(/"content":"((?:[^"\\]|\\.){20,})"/g)) {
    const win = html.slice(Math.max(0, m.index - 400), m.index + m[0].length + 400);
    if (!/"type":"text"/.test(win)) continue;
    try { const t = strip(JSON.parse('"' + m[1] + '"')); if (t.length > 20 && !arc.includes(t)) arc.push(t); } catch (e) {}
  }
  if (arc.length >= 2) return arc;
  // 3) 신문사별 본문 칸만 정확히 잘라서 읽기
  for (const re of BODY_IDS) {
    const m = html.match(new RegExp('<(div|article|section)\\b[^>]*' + re.source + '[^>]*>', 'i'));
    if (!m) continue;
    const ps = textOf(sliceEl(html, m.index));
    if (ps.join('').length > 80) return ps;
  }
  return [];
}
function summarize(title, paras) {
  const clean = paras.map((x) => x.replace(/^\[[^\]]{1,30}\]\s*/, '').replace(/^\([^)]{1,20}=[^)]{0,20}\)\s*/, '').replace(/^[가-힣]{2,4}\s?기자\s?=\s?/, '').trim())
    .filter((x) => x && !JUNK.test(x) && !/^(사진|자료|그래픽|영상)\s*[=:]/.test(x));
  // 사진 설명이 본문 맨 앞에 붙어 오는 경우("~하고 있다. 뉴스1 본문…") 사진 설명 문장과 출처 표시를 뗌
  const CREDIT = '(?:뉴스1|연합뉴스|뉴시스|중앙포토|사진공동취재단|AFP|AP|EPA|로이터|AFP=연합뉴스|대통령실 제공|국회사진기자단)';
  const joined = clean.join(' ')
    .replace(new RegExp('^[^.]{10,220}?(?:있다|모습이다|모습|중이다)\\.\\s*' + CREDIT + '(?:\\s*연합뉴스)?\\s+'), '')
    .replace(new RegExp('\\s' + CREDIT + '\\s+(?=[가-힣])', 'g'), ' ');
  const sents = joined.split(/(?<=다\.|요\.|\.\s|\?|!)\s+/).map((s) => s.trim()).filter((s) => s.length > 15 && s.length < 260);
  if (!sents.length) return [];
  // 앞부분(기사의 핵심이 모여 있는 곳) 10문장은 순서대로 그대로 + 뒷부분에서 제목과 관련 깊은 문장·인용 최대 6개
  //  → 흐름이 끊기지 않고, 처음 보는 사람도 무슨 일인지·누가 뭐라고 했는지까지 이해되게 (최대 약 2,000자)
  const words = new Set((title.match(/[가-힣A-Za-z0-9]{2,}/g) || []));
  const score = (s) => [...words].filter((w) => s.includes(w)).length + (/["“”‘’']/.test(s) ? 1 : 0);
  const head = sents.slice(0, 10).map((s, i) => ({ s, i }));
  const tail = sents.slice(10).map((s, i) => ({ s, i: i + 10, v: score(s) })).filter((x) => x.v >= 1).sort((a, b) => b.v - a.v).slice(0, 6);
  const picked = [...head, ...tail].sort((a, b) => a.i - b.i);
  const out = []; let len = 0;
  for (const p of picked) { if (len + p.s.length > 2000) break; out.push(p.s); len += p.s.length; }
  return out;
}
async function fetchSummary(item) {
  const url = /news\.google\.com/.test(item.link) ? await gnResolve(item.link) : item.link;
  if (!url) return { err: 'gn' };
  if (/\/newsletter\/|\/opinion\/(?:column)?list|\/photo\//.test(url)) return { url, err: 'skip' };
  const html = await getText(url);
  if (!html) return { url, err: 'fetch' };
  let img = meta(html, 'og:image') || meta(html, 'twitter:image');
  if (img && img.startsWith('//')) img = 'https:' + img;
  if (/logo|default|noimage|og_image\.(png|jpg)$/i.test(img)) img = '';
  const sum = summarize(item.title, paragraphs(html));
  const desc = meta(html, 'og:description') || meta(html, 'description');
  return { url, img, sum: sum.length ? sum : (desc ? [strip(desc)] : []), sv: 4, err: sum.length ? '' : 'body', sample: sum.length ? '' : strip(html.slice(0, 300)) };
}

// ── 실행 ──
const lists = await Promise.all(PAPERS.map((p) => loadPaper(p).catch(() => [])));
const items = lists.flat();
if (!items.length) { console.log('기사를 하나도 못 받아서 이전 파일을 그대로 둠'); process.exit(0); }

// 앱에 실제로 보일 기사만 요약 (SBS 전부 + 신문사별 정치·방송 앞쪽)
const wanted = [];
for (const p of PAPERS) {
  const mine = items.filter((i) => i.paper === p.name);
  wanted.push(...mine.filter((i) => i.sbsQ || RE_SBS.test(i.title + i.desc)));
  wanted.push(...mine.filter((i) => RE_BROAD.test(i.title + i.desc)).slice(0, 10));
  wanted.push(...mine.filter((i) => RE_POL.test(i.title + i.desc)).slice(0, 10));
  if (p.name === '미디어오늘') wanted.push(...mine.slice(0, 12));
}
const want = [...new Set(wanted)];

// 이전에 요약해 둔 건 다시 안 받음
let prev = {};
try { if (existsSync('news.json')) for (const i of JSON.parse(readFileSync('news.json', 'utf8')).items || []) if (i.sum && i.sum.length && i.sv === 4) prev[keyOf(i.title)] = { url: i.url, img: i.img, sum: i.sum, sv: 4 }; } catch (e) {}   // 요약 방식이 바뀌면(sv) 다시 만듦
const todo = want.filter((i) => !prev[keyOf(i.title)]).slice(0, 90);
const diag = { want: want.length, reused: want.length - todo.length, tried: todo.length, ok: 0, err: {} };
let k = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (k < todo.length) {
    const it = todo[k++];
    const r = await fetchSummary(it).catch(() => ({ err: 'x' }));
    if (r.sum && r.sum.length) { prev[keyOf(it.title)] = { url: r.url, img: r.img, sum: r.sum, sv: 4 }; if (r.err !== 'body') diag.ok++; }
    if (r.err) { const e = it.paper + ':' + r.err; diag.err[e] = (diag.err[e] || 0) + 1; if (r.err === 'body' && (diag.samples || (diag.samples = [])).length < 6) diag.samples.push(r.url); }
  }
}));
for (const i of items) { const s = prev[keyOf(i.title)]; if (s) Object.assign(i, s); }
diag.withSum = items.filter((i) => i.sum).length;
console.log('기사 수', Object.fromEntries(PAPERS.map((p, n) => [p.name, lists[n].length])), '요약', diag);
writeFileSync('news.json', JSON.stringify({ at: Date.now(), diag, items }));
