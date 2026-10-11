// 音声練習の、画面に依らない部分(シャドーイングの間)。
const Practice = (() => {
  // シャドーイングの間(ミリ秒): 読み上げにかかった時間 × 倍率 + 少し。読み上げが測れない(短すぎる)ときは、語数から見積もる
  function gap(spokenMs, text, mult, rate) {
    const words = String(text).split(/\s+/).filter(Boolean).length;
    const est = (words * 400) / (rate || 1);
    const base = spokenMs > 300 ? spokenMs : est;
    return Math.max(1200, Math.round(base * mult + 400));
  }

  return { gap };
})();
