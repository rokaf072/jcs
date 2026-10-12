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
