// 記録と復習の集計。画面に依らない部分(弱点の集計、復習の記録、復習の順番)。
const Stats = (() => {
  const pad = n => String(n).padStart(2, "0");
  const ymd = (d = new Date()) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const addDays = (n, from = new Date()) => { const d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d.setDate(d.getDate() + n); return d };

  // 間違いの分類ごとの集計。days = 直近何日か(null なら全期間)。多い順
  function weak(rows, days) {
    const since = days ? ymd(addDays(-(days - 1))) : null, by = new Map();
    for (const r of rows) for (const m of r.mistakes || []) {
      if (since && (m.date || "") < since) continue;
      const e = by.get(m.cat) || { cat: m.cat, n: 0, ids: new Set() };
      e.n++; e.ids.add(r.id); by.set(m.cat, e);
    }
    return [...by.values()].map(e => ({ cat: e.cat, n: e.n, ids: [...e.ids] })).sort((a, b) => b.n - a.n || a.cat.localeCompare(b.cat));
  }

  // 期間内に、間違いのある英文(新しく間違えた順ではなく、間違いの回数が多い順)
  function mistaken(rows, days) {
    const since = days ? ymd(addDays(-(days - 1))) : null;
    return rows.map(r => ({ r, n: (r.mistakes || []).filter(m => !since || (m.date || "") >= since).length })).filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n).map(x => x.r);
  }

  // 復習の記録(日ごと)。log = { "2026-10-10": {sentence, word, chunk} }。直近 n 日分、古い順
  function lastDays(log, n, from = new Date()) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = ymd(addDays(-i, from)), e = (log && log[d]) || {};
      const s = e.sentence || 0, w = e.word || 0, c = e.chunk || 0;
      out.push({ date: d, sentence: s, word: w, chunk: c, total: s + w + c });
    }
    return out;
  }

  // 何日続けて復習したか。今日まだ復習していなくても、昨日まで続いていれば、続いているものとする
  function streak(log, from = new Date()) {
    const has = d => { const e = log && log[ymd(d)]; return !!e && (e.sentence || 0) + (e.word || 0) + (e.chunk || 0) > 0 };
    let i = has(from) ? 0 : 1, n = 0;
    while (has(addDays(-i, from))) { n++; i++ }
    return n;
  }

  // 復習の順番: 覚えた以外を、復習回数の少ない順、最後に復習した日の古い順(一度も復習していないものが先)。先頭から n 件
  function reviewOrder(list, n) {
    return list.filter(r => r.status !== "mastered").map((r, i) => ({ r, i }))
      .sort((a, b) => (a.r.review_count || 0) - (b.r.review_count || 0) || (a.r.last_reviewed || "").localeCompare(b.r.last_reviewed || "") || a.i - b.i)
      .slice(0, n).map(x => x.r);
  }

  // 日ごとの記録を、古いものから捨てる(400日分だけ残す)
  function prune(log) {
    const keys = Object.keys(log).sort(), drop = keys.length - 400;
    for (let i = 0; i < drop; i++) delete log[keys[i]];
    return log;
  }

  return { ymd, addDays, weak, mistaken, lastDays, streak, reviewOrder, prune };
})();
