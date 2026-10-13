// 화면 색(다크/밝은): 그리기 전에 먼저 적용 + 마지막으로 고른 모드를 기억
(function () {
  var t = 'dark';
  try { t = localStorage.getItem('jcsTheme') || 'dark'; } catch (e) {}
  var h = document.documentElement;
  function apply(v) {
    h.dataset.theme = v;
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = v === 'dark' ? '#111419' : '#3a9a8a';
    var b = document.getElementById('themeBtn'); if (b) b.textContent = v === 'dark' ? '☀' : '🌙';
  }
  apply(t);
  document.addEventListener('DOMContentLoaded', function () {
    apply(h.dataset.theme);
    var b = document.getElementById('themeBtn');
    if (b) b.onclick = function () { var v = h.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('jcsTheme', v); } catch (e) {} apply(v); };
  });
})();
// 누워서 볼 때 가로로 돌아가지 않게: 세로 고정 (🔒 버튼으로 켜고 끔, 기본 켜짐)
(function () {
  var KEY = 'jcsRotLock';
  var on = true; try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) {}
  function apply() {
    var so = screen.orientation;
    if (!so || !so.lock) return;
    if (on) so.lock('portrait').catch(function () {}); else try { so.unlock(); } catch (e) {}
    var b = document.getElementById('rotBtn');
    if (b) { b.textContent = on ? '🔒' : '🔄'; b.classList.toggle('off', !on); b.title = on ? '세로 고정 중 (누르면 자동 회전)' : '자동 회전 중 (누르면 세로 고정)'; }
  }
  function toast(t) { var d = document.createElement('div'); d.className = 'rtoast'; d.textContent = t; document.body.append(d); setTimeout(function () { d.remove(); }, 1800); }
  document.addEventListener('DOMContentLoaded', function () {
    apply();
    var b = document.getElementById('rotBtn');
    if (b) b.onclick = function () { on = !on; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {} apply(); toast(on ? '세로로 고정했어요' : '자동 회전으로 바꿨어요'); };
  });
  // 앱으로 돌아올 때마다 다시 적용 (안드로이드가 풀어버리는 경우 대비)
  document.addEventListener('visibilitychange', function () { if (!document.hidden) apply(); });
})();
