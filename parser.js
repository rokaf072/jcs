// 작가가 올린 본문 → 구조화된 출연자 목록
// 결과: { parts: [{ label, time, corners: [{ name, topic, guests: [{ name, role, raw }] }] }] }

const ROLE_WORDS = /(기자|평론가|의원|위원|논설위원|교수|변호사|대표|위원장|장관|차관|대변인|최고위원|원내대표|사무총장|소장|연구위원|센터장|국장|부장|앵커|PD|작가|전\s?의원|후보|시장|지사|청장|비서관|수석|실장|정책위의장|당협위원장|회장|박사|이사|원장|총장|특보|부대변인|부대표)$/;

function nameCandidates(title, body) {
  const set = new Set();
  // 제목 괄호 안 이름: (김도형 김수민)
  for (const m of (title || '').matchAll(/\(([^)]*)\)/g)) {
    for (const tok of m[1].split(/[\s,·/]+/)) if (/^[가-힣]{2,4}$/.test(tok)) set.add(tok);
  }
  // 해시태그: #김도형
  for (const m of (body || '').matchAll(/#([가-힣]{2,4})(?=[\s#]|$)/g)) set.add(m[1]);
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
  // 2순위: 직함 바로 앞 단어 or 첫 단어
  if (!name) {
    const toks = text.split(' ');
    const hangul = toks.filter(t => /^[가-힣]{2,4}$/.test(t));
    if (toks.length >= 2 && ROLE_WORDS.test(toks[toks.length - 1]) && /^[가-힣]{2,4}$/.test(toks[toks.length - 2])) {
      // "한국일보 김도형 기자" 처럼 기관 다음 이름일 수 있음 → 기관이 앞에 있으면 끝에서 두 번째가 이름
      name = toks.length >= 3 ? toks[toks.length - 2] : toks[0];
      if (toks.length === 2) name = toks[0];
    } else {
      name = hangul[0] || toks[0];
    }
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
