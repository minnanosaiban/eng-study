// 音声練習の、画面に依らない部分(聞き取りの答え合わせ、シャドーイングの間)。
const Practice = (() => {
  // 語を比べる形にそろえる: 小文字、前後の記号を外す、’ は ' に
  const norm = t => String(t).toLowerCase().replace(/[‘’]/g, "'").replace(/^[^a-z0-9$]+|[^a-z0-9%]+$/g, "");
  const toks = s => String(s || "").split(/\s+/).filter(Boolean).map(t => ({ t, n: norm(t) })).filter(x => x.n);

  // 原文(ref)と、聞き取って書いた文(ans)を、語ごとに比べる。
  // 返すもの: ops = [{k:"ok"|"miss"|"ext"|"sub", t:原文の語, a:書いた語}], ok = 合った語数, total = 原文の語数
  function diff(ref, ans) {
    const R = toks(ref), A = toks(ans), n = R.length, m = A.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      L[i][j] = R[i].n === A[j].n ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const ops = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (R[i].n === A[j].n) { ops.push({ k: "ok", t: R[i].t, a: A[j].t }); i++; j++ }
      else if (L[i + 1][j] >= L[i][j + 1]) ops.push({ k: "miss", t: R[i++].t });
      else ops.push({ k: "ext", a: A[j++].t });
    }
    while (i < n) ops.push({ k: "miss", t: R[i++].t });
    while (j < m) ops.push({ k: "ext", a: A[j++].t });
    // 抜けと余りが並んだら、「書き間違い」にまとめる
    const out = [];
    for (let x = 0; x < ops.length; x++) {
      const o = ops[x], nx = ops[x + 1];
      if (o.k === "miss" && nx && nx.k === "ext") { out.push({ k: "sub", t: o.t, a: nx.a }); x++ }
      else if (o.k === "ext" && nx && nx.k === "miss") { out.push({ k: "sub", t: nx.t, a: o.a }); x++ }
      else out.push(o);
    }
    return { ops: out, ok: out.filter(o => o.k === "ok").length, total: n };
  }

  // シャドーイングの間(ミリ秒): 読み上げにかかった時間 × 倍率 + 少し。読み上げが測れない(短すぎる)ときは、語数から見積もる
  function gap(spokenMs, text, mult, rate) {
    const words = String(text).split(/\s+/).filter(Boolean).length;
    const est = (words * 400) / (rate || 1);
    const base = spokenMs > 300 ? spokenMs : est;
    return Math.max(1200, Math.round(base * mult + 400));
  }

  return { diff, gap, toks };
})();
