// 얼굴 인식이 사진 픽셀을 자주 읽으므로, 그림판(canvas)을 '자주 읽기' 모드로 만들어 둠 (속도↑, 크롬 경고 제거)
(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, opts) {
    if (type === '2d') opts = Object.assign({ willReadFrequently: true }, opts || {});
    return orig.call(this, type, opts);
  };
})();
