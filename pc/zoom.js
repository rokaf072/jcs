// ───────── 출연자 사진 크게 보기 ─────────
// 사진을 한 번 누르면 크게, 다시 누르면 원래대로.
// 휴대폰: 사진을 꾹 누르고 있는 동안에도 크게 보이고, 손을 떼면 닫힘.
(() => {
  const HOLD_MS = 350;
  let ov = null, mode = '', timer = 0, sx = 0, sy = 0, swallowClick = false;

  const photoOf = (t) => t && t.closest && t.closest('#main .guest .photo');
  const hasPic = (ph) => ph && ph.querySelector('img, .cropimg');

  function open(ph, how) {
    close();
    const src = ph.querySelector('img, .cropimg');
    if (!src) return;
    const card = ph.closest('.guest');
    const name = card && card.querySelector('.gname') ? card.querySelector('.gname').textContent : '';
    const role = card && card.querySelector('.grole') ? card.querySelector('.grole').textContent : '';
    ov = document.createElement('div'); ov.className = 'zoomov';
    const fig = document.createElement('figure'); fig.className = 'zoomfig';
    // 모든 사람을 같은 크기로: 카드 사진과 같은 비율(세로형)의 큰 액자에, 카드에서 보이던 얼굴 부분 그대로 꽉 채움
    const r = ph.getBoundingClientRect(), ar = r.width && r.height ? r.width / r.height : 0.8;
    const H = Math.round(Math.min(window.innerHeight * 0.76, (window.innerWidth * 0.92) / ar, 820)), W = Math.round(H * ar);
    if (src.tagName === 'IMG') {
      const im = document.createElement('img'); im.referrerPolicy = 'no-referrer'; im.alt = name; im.src = src.currentSrc || src.src;
      im.className = 'zoomimg'; im.style.width = W + 'px'; im.style.height = H + 'px'; im.style.objectFit = 'cover';
      im.style.objectPosition = getComputedStyle(src).objectPosition || '50% 25%';
      fig.append(im);
    } else {   // 영상 장면에서 얼굴만 잘라 둔 사진: 같은 부분을 크게
      const d = src.cloneNode(true); d.className = 'cropimg zoomcrop'; d.style.width = W + 'px'; d.style.height = H + 'px';
      fig.append(d);
    }
    const cap = document.createElement('figcaption'); cap.className = 'zoomcap';
    const b = document.createElement('b'); b.textContent = name; const s = document.createElement('span'); s.textContent = role;
    cap.append(b, s); fig.append(cap);
    ov.append(fig); document.body.append(ov);
    mode = how;
    requestAnimationFrame(() => ov && ov.classList.add('on'));
  }
  function close() { if (ov) { ov.remove(); ov = null; } mode = ''; }

  // 누르기(탭·클릭): 열기 / 다시 누르면 닫기
  document.addEventListener('click', (e) => {
    if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); return; }
    if (ov) { e.preventDefault(); e.stopPropagation(); close(); return; }
    const ph = photoOf(e.target);
    if (ph && hasPic(ph)) { e.preventDefault(); e.stopPropagation(); open(ph, 'tap'); }
  }, true);

  // 꾹 누르기(휴대폰): 누르고 있는 동안만 크게
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || ov) return;
    const ph = photoOf(e.target); if (!ph || !hasPic(ph)) return;
    sx = e.clientX; sy = e.clientY; clearTimeout(timer);
    timer = setTimeout(() => { open(ph, 'hold'); if (navigator.vibrate) navigator.vibrate(10); }, HOLD_MS);
  }, true);
  document.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 12) { clearTimeout(timer); timer = 0; } }, true);   // 화면을 내리는 중이면 취소
  const release = () => { clearTimeout(timer); timer = 0; if (mode === 'hold') { close(); swallowClick = true; setTimeout(() => { swallowClick = false; }, 400); } };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  // 꾹 누를 때 뜨는 '이미지 저장' 메뉴 막기
  document.addEventListener('contextmenu', (e) => { if (photoOf(e.target) || (ov && ov.contains(e.target))) e.preventDefault(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('popstate', close);
})();
