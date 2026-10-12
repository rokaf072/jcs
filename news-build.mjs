// GitHub가 정해진 시간마다 실행: 조선·중앙·한국경제·미디어오늘 기사 목록을 받아 news.json으로 저장
// (폰 앱은 브라우저 보안 때문에 신문사 사이트를 직접 못 읽어서, GitHub가 대신 읽어 둠)
import { writeFileSync } from 'node:fs';

const GN = (q) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=ko&gl=KR&ceid=KR:ko';
const PAPERS = [
  { name: '조선일보', site: 'chosun.com', feeds: ['https://www.chosun.com/arc/outboundfeeds/rss/category/politics/?outputType=xml', 'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml'] },
  { name: '중앙일보', site: 'joongang.co.kr', feeds: [] },
  { name: '한국경제', site: 'hankyung.com', feeds: ['https://www.hankyung.com/feed/politics', 'https://www.hankyung.com/feed/all-news'] },
  { name: '미디어오늘', site: 'mediatoday.co.kr', feeds: ['https://www.mediatoday.co.kr/rss/allArticle.xml'] },
];
const MAX_AGE = 36 * 3600000;
const ent = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const strip = (h) => ent(ent(h || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? m[1] : ''; };
function parseRSS(xml, paper, src) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map(([it]) => {
    let title = strip(tag(it, 'title')), desc = strip(tag(it, 'description'));
    if (src === 'gn') { title = title.replace(/\s+-\s+[^-]+$/, ''); desc = ''; }
    if (desc.startsWith(title.slice(0, 20))) desc = '';
    const t = Date.parse(strip(tag(it, 'pubDate'))) || 0;
    return { paper, title, link: strip(tag(it, 'link')), desc: desc.slice(0, 140), t };
  }).filter((x) => x.title && x.link && (!x.t || Date.now() - x.t < MAX_AGE));
}
async function getText(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.text() : '';
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
    const key = i.title.replace(/\s|[^\w가-힣]/g, '').slice(0, 30);
    if (seen.has(key)) continue; seen.add(key); out.push(i);
  }
  return out.sort((a, b) => b.t - a.t);
}
const lists = await Promise.all(PAPERS.map((p) => loadPaper(p).catch(() => [])));
const items = lists.flat();
const counts = Object.fromEntries(PAPERS.map((p, k) => [p.name, lists[k].length]));
console.log('기사 수', counts);
if (!items.length) { console.log('기사를 하나도 못 받아서 이전 파일을 그대로 둠'); process.exit(0); }
writeFileSync('news.json', JSON.stringify({ at: Date.now(), items }));
