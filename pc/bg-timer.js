// 창이 가려져 있거나(다른 탭에서 유튜브를 보는 중 등) 최소화돼 있으면
// 크롬이 이 화면의 짧은 타이머를 '1분에 한 번'까지 늦춰서 얼굴 분석이 몇십 배 느려짐.
// → 가려진 동안에는 짧은 타이머(얼굴 분석 라이브러리가 쓰는 것)를 늦추지 않는 방식으로 대신 실행.
(() => {
  const origSet = window.setTimeout.bind(window), origClear = window.clearTimeout.bind(window);
  const ch = new MessageChannel(), jobs = new Map();
  let seq = 1e9;
  ch.port1.onmessage = (e) => { const f = jobs.get(e.data); if (f) { jobs.delete(e.data); f(); } };
  window.setTimeout = function (fn, ms, ...args) {
    if (document.hidden && (!ms || ms <= 20) && typeof fn === 'function') {
      const id = ++seq; jobs.set(id, () => fn(...args)); ch.port2.postMessage(id); return id;
    }
    return origSet(fn, ms, ...args);
  };
  window.clearTimeout = function (id) { if (jobs.has(id)) jobs.delete(id); else origClear(id); };
})();
