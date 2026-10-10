// 入力の検査。外から届くデータ(ファイル・AI・受信箱)は、必ずここを通してから入れる。
// 形が合わない部分だけを捨て、ほかは残す。試作(eng-analyzer)の検査を、英文の表に合わせて移したもの。
const Clean = (() => {
  const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const norm = s => String(s ?? "").replace(/\s+/g, " ").trim();

  const POS = { n: "名詞", pron: "代名詞", v: "動詞", aux: "助動詞", adj: "形容詞", adv: "副詞", prep: "前置詞", conj: "接続詞・関係詞", det: "冠詞・限定詞", other: "その他" };
  const STATUS = { new: "未学習", learning: "学習中", mastered: "覚えた" };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // 発音記号: 記号として使える文字だけ。/ / や [ ] は外して中身だけ持つ
  function ipa(s) {
    if (typeof s !== "string") return "";
    const t = s.trim().replace(/^[\/\[]+|[\/\]]+$/g, "").trim();
    return t.length > 0 && t.length <= 80 && /^[A-Za-zÀ-Ͽᴀ-ᶿ‿.\s()\-]+$/.test(t) ? t : "";
  }

  // 品詞の色分け: 語を半角スペースでつなぐと原文と一致するときだけ採用
  function words(ws, text) {
    if (!Array.isArray(ws) || ws.length < 1 || ws.length > 200) return null;
    const out = [];
    for (const x of ws) {
      if (!x || typeof x.w !== "string" || !x.w || !has(POS, x.p)) return null;
      out.push({ w: x.w, p: x.p });
    }
    return norm(out.map(x => x.w).join(" ")) === norm(text) ? out : null;
  }

  // 区切りの形: 区切りをつなぐと原文と一致するときだけ採用
  function phrases(ps, text) {
    if (!Array.isArray(ps) || ps.length < 2 || ps.length > 12) return null;
    const out = [];
    for (const x of ps) {
      const t = clip(x && x.t, 300), f = clip(x && x.f, 40);
      if (!t || !f) return null;
      out.push({ t, f });
    }
    return norm(out.map(x => x.t).join(" ")) === norm(text) ? out : null;
  }

  // スラッシュリーディング(意味句): [{en, ja}]。英語をつなぐと原文と一致するときだけ
  function slash(sl, text) {
    if (!Array.isArray(sl) || sl.length < 2 || sl.length > 12) return null;
    const out = [];
    for (const x of sl) {
      const en = clip(x && x.en, 300), ja = clip(x && x.ja, 200);
      if (!en) return null;
      out.push({ en, ja });
    }
    return norm(out.map(x => x.en).join(" ")) === norm(text) ? out : null;
  }

  function vocab(v) {
    if (!Array.isArray(v)) return [];
    return v.slice(0, 40).filter(x => x && typeof x.word === "string" && x.word.trim()).map(x => ({
      word: clip(x.word, 100), pos: clip(x.pos, 40), meaning: clip(x.meaning, 300), note: clip(x.note, 500),
      ipa: ipa(x.ipa), level: Math.min(3, Math.max(0, +x.level || 0)), toeic: clip(x.toeic, 500)
    }));
  }

  function grammar(g) {
    if (!Array.isArray(g)) return [];
    return g.slice(0, 12).filter(x => x && x.point).map(x => ({ point: clip(x.point, 100), explanation: clip(x.explanation, 800) }));
  }

  function toeic(t) {
    if (!t || typeof t !== "object" || Array.isArray(t)) return null;
    return {
      scene: clip(t.scene, 60), part: clip(t.part, 40),
      points: (Array.isArray(t.points) ? t.points : []).slice(0, 8).map(p => ({ type: clip(p && p.type, 40), detail: clip(p && p.detail, 400) })),
      paraphrase: (Array.isArray(t.paraphrase) ? t.paraphrase : []).slice(0, 8).map(s => clip(s, 120)).filter(Boolean)
    };
  }

  // 4択: 空所(______)があり、選択肢が重ならない4つで、正解の番号が範囲内のとき
  function quiz(q) {
    if (!q || typeof q !== "object" || Array.isArray(q)) return null;
    const choices = Array.isArray(q.choices) ? q.choices.map(c => clip(c, 120)) : [];
    if (choices.length !== 4 || choices.some(c => !c) || new Set(choices).size !== 4) return null;
    const ans = Number.isInteger(q.answer) ? q.answer : parseInt(q.answer, 10);
    if (!(ans >= 0 && ans < 4)) return null;
    const question = clip(q.question, 500);
    if (question.length < 5 || !question.includes("______")) return null;
    return { question, choices, answer: ans, type: clip(q.type, 40) || "その他", explanation: clip(q.explanation, 1200) };
  }

  function level(v) { const n = +v; return [600, 730, 860].includes(n) ? n : null; }
  function date(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // 英文1件。text が無い・空なら null。外から来た値は、ここで作り直す(状態・復習回数なども検査する)
  function sentence(o, { keepState = false } = {}) {
    if (!o || typeof o.text !== "string") return null;
    const text = clip(o.text, 500);
    if (!text) return null;
    const a = o.analysis && typeof o.analysis === "object" ? o.analysis : o;
    const groups = [...new Set((Array.isArray(o.groups) ? o.groups : []).map(g => clip(g, 40)).filter(Boolean))].slice(0, 20);
    const s = {
      id: uid(), type: "sentence", text,
      ja: clip(a.translation ?? a.ja, 500), level: level(o.level), groups,
      status: "new", review_count: 0, last_reviewed: null, verified: !(a.translation || a.ja), added: Date.now(),
      words: words(a.words, text), phrases: phrases(a.phrases, text), slash: slash(a.slash, text),
      vocab: vocab(a.vocab), grammar: grammar(a.grammar), toeic: toeic(a.toeic), quiz: quiz(o.quiz)
    };
    if (keepState) {
      if (has(STATUS, o.status)) s.status = o.status;
      s.review_count = Math.max(0, Math.floor(+o.review_count || 0));
      s.last_reviewed = date(o.last_reviewed);
      if (typeof o.verified === "boolean") s.verified = o.verified;
    }
    return s;
  }

  // すでにある英文に、足りないものだけを足す。足したら true(解析・状態・記録は上書きしない)
  function fill(ex, add) {
    let c = false;
    const set = (k, v) => { if (v && (ex[k] == null || (Array.isArray(ex[k]) && !ex[k].length))) { ex[k] = v; c = true } };
    set("ja", add.ja); set("words", add.words); set("phrases", add.phrases); set("slash", add.slash);
    set("grammar", add.grammar); set("toeic", add.toeic); set("quiz", add.quiz); set("level", add.level);
    set("vocab", add.vocab && add.vocab.length ? add.vocab : null);
    if (ex.vocab && add.vocab) { // 発音記号が無い単語にだけ足す
      const m = new Map(add.vocab.map(v => [v.word.toLowerCase(), v.ipa]));
      for (const v of ex.vocab) if (!v.ipa && m.get(v.word.toLowerCase())) { v.ipa = m.get(v.word.toLowerCase()); c = true }
    }
    const g = [...new Set([...(ex.groups || []), ...(add.groups || [])])];
    if (g.length !== (ex.groups || []).length) { ex.groups = g; c = true }
    return c;
  }

  // 単語1件。word(または text)が無い・空なら null。
  // freq = TOEIC頻出度 1〜3、level = 難易度 600/730/860。試作の単語は、level に頻出度を入れていたので、freq が無いときは level(1〜3)を頻出度とみなす
  function word(o, { keepState = false } = {}) {
    if (!o || typeof (o.word ?? o.text) !== "string") return null;
    const text = clip(o.word ?? o.text, 100);
    if (!text) return null;
    const hasFreq = o.freq != null, lv = +o.level;
    const freq = Math.min(3, Math.max(0, Math.floor(hasFreq ? +o.freq || 0 : (lv >= 1 && lv <= 3 ? lv : 0))));
    const w = {
      id: uid(), type: "word", text, ipa: ipa(o.ipa), ja: clip(o.meaning ?? o.ja, 300), pos: clip(o.pos, 40),
      freq, level: level(o.level), note: clip(o.note, 500), toeic: clip(o.toeic, 500), ex: clip(o.ex, 500),
      groups: [...new Set((Array.isArray(o.groups) ? o.groups : []).map(g => clip(g, 40)).filter(Boolean))].slice(0, 20),
      status: "new", review_count: 0, last_reviewed: null, added: Date.now()
    };
    if (keepState) {
      if (has(STATUS, o.status)) w.status = o.status;
      w.review_count = Math.max(0, Math.floor(+o.review_count || 0));
      w.last_reviewed = date(o.last_reviewed);
    }
    return w;
  }

  // 英文の単語欄(vocab)から、単語の一覧を作る。難易度・グループ・例文は、その英文のものを引き継ぐ
  function wordsOf(s) {
    return (s.vocab || []).map(v => ({ word: v.word, pos: v.pos, meaning: v.meaning, note: v.note, ipa: v.ipa, freq: v.level, toeic: v.toeic, level: s.level, groups: s.groups, ex: s.text }));
  }

  // すでにある単語に、足りないものだけを足す。足したら true(状態・復習回数は上書きしない)
  function fillWord(ex, add) {
    let c = false;
    for (const k of ["ipa", "ja", "pos", "note", "toeic", "ex"]) if (!ex[k] && add[k]) { ex[k] = add[k]; c = true }
    for (const k of ["freq", "level"]) if (!ex[k] && add[k]) { ex[k] = add[k]; c = true }
    const g = [...new Set([...(ex.groups || []), ...(add.groups || [])])];
    if (g.length !== (ex.groups || []).length) { ex.groups = g; c = true }
    return c;
  }

  return { word, wordsOf, fillWord, clip, norm, POS, STATUS, ipa, words, phrases, slash, vocab, grammar, toeic, quiz, level, date, uid, sentence, fill };
})();
