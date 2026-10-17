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
    if (src.tagName === 'IMG') {
      const im = document.createElement('img'); im.referrerPolicy = 'no-referrer'; im.alt = name; im.src = src.currentSrc || src.src;
      im.className = 'zoomimg'; fig.append(im);
    } else {   // 영상 장면에서 얼굴만 잘라 둔 사진: 같은 부분을 크게
      const r = ph.getBoundingClientRect(), k = Math.min((window.innerWidth * 0.9) / r.width, (window.innerHeight * 0.72) / r.height);
      const d = src.cloneNode(true); d.className = 'cropimg zoomcrop'; d.style.width = Math.round(r.width * k) + 'px'; d.style.height = Math.round(r.height * k) + 'px';
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
