// ───────── 원클릭 설치 ─────────
// 1) 카톡 안에서 링크를 열면 → 자동으로 크롬(아이폰은 사파리)으로 다시 열기
// 2) 브라우저로 열었는데 아직 설치 안 했으면 → 큰 [📲 앱 설치] 버튼 하나로 설치 (안드로이드)
//    아이폰은 설치 버튼을 만들 수 없어서 '공유 → 홈 화면에 추가' 그림 안내
(() => {
  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua), isIOS = /iPhone|iPad|iPod/i.test(ua);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone || (!isAndroid && !isIOS)) return;   // 이미 앱으로 실행 중이거나 PC면 아무것도 안 함

  // 카톡·네이버·인스타 등 앱 안의 브라우저 → 진짜 브라우저로
  if (/KAKAOTALK/i.test(ua)) { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href); return; }
  const inApp = /NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp/i.test(ua);
  if (inApp && isAndroid) { location.href = 'intent://' + location.href.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end'; return; }

  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; paint(); });
  window.addEventListener('appinstalled', () => { done(); });
  try { if (sessionStorage.getItem('jcsInstallSkip')) return; } catch (e) {}

  let sheet = null, btn = null, note = null;
  function build() {
    sheet = document.createElement('div'); sheet.className = 'instov';
    const box = document.createElement('div'); box.className = 'instbox';
    const icon = document.createElement('img'); icon.src = 'icons/icon192.png'; icon.className = 'insticon'; icon.alt = '';
    const h = document.createElement('h2'); h.textContent = '김태현의 정치쇼 출연자';
    const p = document.createElement('p'); p.className = 'instsub'; p.textContent = '매일 출연자 사진·명단과 신문 요약을 한눈에';
    btn = document.createElement('button'); btn.className = 'instbtn'; btn.textContent = '📲 앱 설치';
    note = document.createElement('div'); note.className = 'instnote';
    const skip = document.createElement('button'); skip.className = 'instskip'; skip.textContent = '설치 없이 그냥 볼게요';
    skip.onclick = () => { try { sessionStorage.setItem('jcsInstallSkip', '1'); } catch (e) {} done(); };
    btn.onclick = async () => {
      if (deferred) {
        deferred.prompt();
        const r = await deferred.userChoice.catch(() => ({}));
        deferred = null;
        if (r.outcome === 'accepted') { btn.textContent = '✅ 설치하는 중…'; note.innerHTML = '잠시 뒤 홈 화면에 <b>정치쇼</b> 아이콘이 생겨요.<br>그 아이콘으로 열어 주세요.'; btn.disabled = true; }
        else paint();
        return;
      }
      guide();
    };
    box.append(icon, h, p, btn, note, skip); sheet.append(box); document.body.append(sheet);
    paint();
  }
  function guide() {   // 설치 버튼이 안 되는 경우 (아이폰, 이미 설치됨, 삼성 인터넷 일부 등)
    if (isIOS) note.innerHTML = '아이폰은 이렇게 설치해요<br><b>① 아래쪽 공유 버튼 <span class="instkey">□↑</span></b><br><b>② "홈 화면에 추가"</b> → <b>추가</b>';
    else note.innerHTML = '설치 창이 안 뜨면<br>오른쪽 위 <b>⋮</b> → <b>"앱 설치"</b>를 눌러 주세요.<br><span class="instsmall">이미 설치했다면 홈 화면의 <b>정치쇼</b> 아이콘으로 열어 주세요.</span>';
  }
  function paint() {
    if (!btn) return;
    if (isIOS) { btn.style.display = 'none'; guide(); return; }
    btn.style.display = ''; btn.disabled = false; btn.textContent = '📲 앱 설치';
    note.innerHTML = deferred ? '버튼 한 번이면 설치돼요.' : '';
  }
  function done() { if (sheet) { sheet.remove(); sheet = null; } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  setTimeout(() => { if (!deferred && sheet && !isIOS) guide(); }, 3500);   // 3.5초 안에 설치 신호가 안 오면 안내 표시
})();
