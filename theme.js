// 화면 색(다크/밝은): 그리기 전에 먼저 적용 + 마지막으로 고른 모드를 기억
(function () {
  var t = 'dark';
  try { t = localStorage.getItem('jcsTheme') || 'dark'; } catch (e) {}
  var h = document.documentElement;
  // 상단 상태바 색 = 화면 맨 위 색 (프로그램·밝은/어두운 모드에 맞춰서)
  window.jcsBarColor = function (v) {
    var jyj = false; try { jyj = localStorage.getItem('jcsProg') === 'jyj'; } catch (e) {}
    v = v || h.dataset.theme || 'dark';
    var c = v === 'dark' ? (jyj ? '#0a1222' : '#111419') : (jyj ? '#1f56b8' : '#3a9a8a');
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = c;
    return c;
  };
  function apply(v) {
    h.dataset.theme = v;
    window.jcsBarColor(v);
    var b = document.getElementById('themeBtn'); if (b) b.textContent = v === 'dark' ? '☀' : '🌙';
  }
  apply(t);
  document.addEventListener('DOMContentLoaded', function () {
    apply(h.dataset.theme);
    var b = document.getElementById('themeBtn');
    if (b) b.onclick = function () { var v = h.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('jcsTheme', v); } catch (e) {} apply(v); };
  });
})();
// 폰에서는 항상 세로 (앱 설정 manifest의 orientation:portrait + 혹시 몰라 한 번 더 잠금)
(function () {
  function lock() { var so = screen.orientation; if (so && so.lock) so.lock('portrait').catch(function () {}); }
  document.addEventListener('DOMContentLoaded', lock);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) lock(); });
})();
