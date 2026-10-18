// 화면 색(다크/밝은)을 그리기 전에 먼저 적용 — 마지막으로 고른 모드를 기억
(function () {
  var t = 'dark';
  try { t = localStorage.getItem('jcsTheme') || 'dark'; } catch (e) {}
  document.documentElement.dataset.theme = t;
})();
