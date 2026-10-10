// 작가가 올린 본문 → 구조화된 출연자 목록
// 결과: { parts: [{ label, time, corners: [{ name, topic, guests: [{ name, role, raw }] }] }] }

const ROLE_WORDS = /(기자|평론가|의원|위원|논설위원|교수|변호사|대표|위원장|장관|차관|대변인|최고위원|원내대표|사무총장|소장|연구위원|센터장|국장|부장|앵커|PD|작가|전\s?의원|후보|시장|지사|청장|비서관|수석|실장|정책위의장|당협위원장|회장|박사|이사|원장|총장|특보|부대변인|부대표)$/;

// 언론사·기관 이름 (사람 이름으로 잘못 읽지 않도록)
const ORG_WORDS = /(일보|신문|뉴스|저널|경제|방송|일간|통신|미디어|리서치|연구소|연구원|재단|협회|대학교|위원회)$|^(한겨레|프레시안|데일리안|머니투데이|오마이뉴스|시사인|뉴스핌|뉴시스|노컷뉴스|국회|청와대|대통령실)$/;
const isPersonTok = (t) => /^[가-힣]{2,4}$/.test(t) && !ORG_WORDS.test(t) && !ROLE_WORDS.test(t);

function nameCandidates(title, body) {
  const set = new Set();
  // 제목 괄호 안 이름: (김도형 김수민)
  for (const m of (title || '').matchAll(/\(([^)]*)\)/g)) {
    for (const tok of m[1].split(/[\s,·/]+/)) if (isPersonTok(tok)) set.add(tok);
  }
  // 해시태그: #김도형
  for (const m of (body || '').matchAll(/#([가-힣]{2,4})(?=[\s#]|$)/g)) if (isPersonTok(m[1])) set.add(m[1]);
  return set;
}

function splitGuest(raw, cands) {
  const text = raw.replace(/^[-–—·•▶▷*]\s*/, '').replace(/\s+/g, ' ').trim();
  let name = '';
  // 1순위: 제목/해시태그에 있는 이름
  for (const c of cands) {
    const re = new RegExp(`(^|[\\s(])${c}($|[\\s)])`);
    if (re.test(text) && c.length > name.length) name = c;
  }
  // 2순위: 직함 바로 앞 단어 → 아니면 언론사·직함이 아닌 첫 단어
  //   "한국일보 김도형 기자" / "김도형 한국일보 기자"(작가가 순서를 바꿔 쓴 경우) / "김도형 기자" 모두 김도형
  if (!name) {
    const toks = text.split(' ');
    const people = toks.filter(isPersonTok);
    const beforeRole = toks.length >= 2 && ROLE_WORDS.test(toks[toks.length - 1]) ? toks[toks.length - 2] : '';
    name = (beforeRole && isPersonTok(beforeRole)) ? beforeRole : (people[0] || toks.find((t) => /^[가-힣]{2,4}$/.test(t)) || toks[0]);
  }
  const role = text.replace(name, ' ').replace(/\s+/g, ' ').replace(/^\s*[,·]\s*|\s*[,·]\s*$/g, '').trim();
  return { name, role, raw: text };
}

function parseBody(body, title) {
  const cands = nameCandidates(title, body);
  const lines = body.replace(/ /g, ' ').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const parts = [];
  let part = null, corner = null;

  const newPart = (label) => {
    const time = (label.match(/(\d{1,2}:\d{2})\s*[~∼-]\s*(\d{1,2}:\d{2})/) || []).slice(1, 3).join(' ~ ');
    part = { label: label.replace(/^[◈◆◇■□▶●○※]\s*/, '').replace(/\(.*\)/, '').trim(), time, corners: [] };
    parts.push(part); corner = null;
  };
  const ensurePart = () => { if (!part) newPart('방송'); };
  const newCorner = (name) => { ensurePart(); corner = { name, topic: '', guests: [] }; part.corners.push(corner); };

  for (const line of lines) {
    if (line.startsWith('#')) continue;                                    // 해시태그 줄
    if (/^[◈◆◇■□▶●○※]?\s*\d+(\s*[-~]\s*\d+)?\s*부/.test(line) && line.length < 40) { newPart(line); continue; }
    const cm = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (cm) { newCorner(cm[1].trim()); if (cm[2]) corner.topic = cm[2]; continue; }
    if (/^[-–—·•]\s*\S/.test(line)) {
      if (!corner) newCorner('');
      corner.guests.push(splitGuest(line, cands));
      continue;
    }
    if (corner && corner.guests.length === 0) corner.topic = (corner.topic ? corner.topic + ' ' : '') + line;
  }
  // 출연자 없는 빈 코너/부 정리
  for (const p of parts) p.corners = p.corners.filter(c => c.guests.length || c.topic);
  return { parts: parts.filter(p => p.corners.length) };
}

if (typeof module !== 'undefined') module.exports = { parseBody };
