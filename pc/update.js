// ───────── 업데이트 (휴대폰 앱처럼 [⚙ 관리 → 최신 버전 확인 → ⬆ 업데이트]) ─────────
// · 앱을 켤 때 딱 한 번만 새 버전이 있는지 확인 (계속 돌아가는 작업 없음) → 있으면 [관리]에 빨간 점
// · [⬆ 업데이트]를 누르면 이 PC의 '업데이트 도우미'(업데이트 기능 켜기.bat로 한 번 등록)가 새 파일을 받아 넣고 앱이 다시 열림
(() => {
  if (window.JCS_WEB) return;   // 웹으로 열면 항상 최신이라 필요 없음
  const BASE = 'https://rokaf072.github.io/jcs/pc/';
  const HOST = 'com.jcs.guest_update';
  const cur = chrome.runtime.getManifest().version;
  const $ = (s) => document.querySelector(s);
  const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  let latest = '';

  const box = $('#updBox'), info = $('#updInfo'), chk = $('#updCheck'), go = $('#updGo'), dot = $('#updDot');
  if (!box) return;
  const paint = (msg, cls = '') => {
    info.innerHTML = `지금 버전 <b>${cur}</b>` + (latest && newer(latest, cur) ? ` → <b class="updnew">새 버전 ${latest}</b>` : '') + (msg ? `<div class="updmsg ${cls}">${msg}</div>` : '');
    const has = latest && newer(latest, cur);
    go.hidden = !has; dot.hidden = !has;
    box.classList.toggle('hasnew', !!has);
  };
  async function check() {
    const r = await fetch(BASE + 'manifest.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('확인 실패 (' + r.status + ')');
    latest = (await r.json()).version || '';
    return latest;
  }
  chk.onclick = async () => {
    chk.disabled = true; paint('확인 중…');
    try { await check(); paint(newer(latest, cur) ? '새 버전이 나왔어요. [⬆ 업데이트]를 눌러 주세요.' : '✔ 최신 버전이에요.', newer(latest, cur) ? 'warn' : 'ok'); }
    catch (e) { paint('인터넷 연결을 확인한 뒤 다시 눌러 주세요.', 'err'); }
    chk.disabled = false;
  };
  go.onclick = () => {
    go.disabled = true; chk.disabled = true; go.textContent = '⏳ 업데이트 중…';
    paint('새 파일을 받는 중이에요. 잠시만 기다려 주세요… (보통 10초 안쪽)');
    let done = false;
    const fail = (msg) => { done = true; go.disabled = false; chk.disabled = false; go.textContent = '⬆ 업데이트'; paint(msg, 'err'); };
    try {
      chrome.runtime.sendNativeMessage(HOST, { cmd: 'update' }, async (res) => {
        if (done) return;
        const le = chrome.runtime.lastError;
        if (le) {
          if (/not found|찾을 수 없/i.test(le.message || '')) return fail('이 PC는 업데이트 기능이 아직 꺼져 있어요.<br>프로그램 폴더의 <b>[업데이트 기능 켜기]</b>를 한 번 더블클릭한 뒤, 크롬을 껐다 켜고 다시 눌러 주세요.');
          return fail('업데이트 도우미를 실행하지 못했어요: ' + le.message);
        }
        if (!res || !res.ok) return fail('업데이트하지 못했어요: ' + ((res && res.error) || '알 수 없는 오류'));
        done = true;
        paint(`✔ ${res.version}(으)로 업데이트했어요. 앱을 다시 여는 중…`, 'ok');
        const w = await chrome.windows.getCurrent().catch(() => ({}));
        await chrome.storage.local.set({ reopenApp: { type: w.type || 'normal' } });
        setTimeout(() => chrome.runtime.reload(), 800);
      });
    } catch (e) { fail('업데이트 기능을 쓸 수 없어요: ' + e.message); }
    setTimeout(() => { if (!done) fail('시간이 너무 오래 걸려요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.'); }, 5 * 60e3);
  };
  // 메뉴 안 단추를 눌러도 메뉴가 닫히지 않게
  box.addEventListener('click', (e) => e.stopPropagation());
  paint();
  // 켤 때 한 번만 조용히 확인
  setTimeout(() => check().then(() => paint(newer(latest, cur) ? '새 버전이 나왔어요. [⬆ 업데이트]를 눌러 주세요.' : '', 'warn')).catch(() => {}), 4000);
})();
