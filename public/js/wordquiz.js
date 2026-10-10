// 単語の4択問題。AI を使わず、単語の表から、機械的に作る(誤答は、ほかの単語から選ぶ)。
const WordQuiz = (() => {
  const KINDS = { en2ja: "英語 → 意味", ja2en: "意味 → 英語", cloze: "空所に入る語" };
  const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function shuffle(a, rnd) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

  // 例文の中で、その単語がそのまま出てくる所(大文字・小文字は区別しない)。無ければ null
  function blank(w) {
    if (!w.ex || w.text.includes(" ") && w.text.split(" ").length > 3) return null;
    const m = new RegExp("(^|[^A-Za-z])(" + esc(w.text) + ")(?![A-Za-z])", "i").exec(w.ex);
    if (!m) return null;
    const i = m.index + m[1].length;
    return w.ex.slice(0, i) + "______" + w.ex.slice(i + m[2].length);
  }

  // 作れる形の一覧
  function kinds(w) { return ["en2ja", "ja2en", ...(blank(w) ? ["cloze"] : [])].filter(k => (k === "ja2en" || k === "en2ja") ? !!w.ja : true) }

  // 誤答を3つ選ぶ。品詞が同じものを先に。正解と同じ文字列は除く。足りなければ null
  function distractors(w, pool, field, rnd) {
    const right = String(w[field]).toLowerCase(), seen = new Set([right]), same = [], other = [];
    for (const x of shuffle(pool, rnd)) {
      const v = String(x[field] || ""); if (!v || x.id === w.id || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase()); (x.pos && x.pos === w.pos ? same : other).push(v);
    }
    const out = [...same, ...other].slice(0, 3);
    return out.length === 3 ? out : null;
  }

  // 問題を1つ作る。kind を省くと、作れる形から選ぶ。作れなければ null
  function make(w, pool, kind, rnd = Math.random) {
    const ok = kinds(w); if (!ok.length) return null;
    const k = kind && ok.includes(kind) ? kind : ok[Math.floor(rnd() * ok.length)];
    const field = k === "en2ja" ? "ja" : "text", right = String(w[field]);
    const d = distractors(w, pool, field, rnd); if (!d) return null;
    const choices = shuffle([right, ...d], rnd);
    const prompt = k === "en2ja" ? w.text : k === "ja2en" ? w.ja : blank(w);
    return { kind: k, prompt, choices, answer: choices.indexOf(right), hint: k === "cloze" ? w.ja : "", ipa: k === "en2ja" ? w.ipa || "" : "" };
  }

  return { KINDS, kinds, make, blank };
})();
