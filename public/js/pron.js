// 発音記号(IPA)を、発音辞書(CMU Pronouncing Dictionary、アメリカ英語)から作る。
// 辞書(public/dict/cmudict-ipa.txt、約2.7MB。通信では約0.8MB)は、必要になったときに1回だけ読み込む。
// 語ごとの発音をつないだもので、文全体での弱い発音や音のつながりは出ない。辞書に無い語が1つでもあると、その区切りには付けない。
const Pron = (() => {
  let dict = null, loading = null;

  async function load() {
    if (dict) return true;
    try {
      loading ||= fetch("dict/cmudict-ipa.txt").then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text() });
      const text = await loading, m = new Map();
      for (const line of text.split("\n")) { const i = line.indexOf("|"); if (i > 0) m.set(line.slice(0, i), line.slice(i + 1)) }
      dict = m; return true;
    } catch { loading = null; return false } // 通信できない(オフラインなど)ときは、何もしない
  }

  // 文中で、強く読まれない語(機能語)の、弱い発音
  const WEAK = { of: "əv", to: "tə", the: "ðə", a: "ə", an: "ən", for: "fɚ", at: "ət", and: "ənd", or: "ɚ", in: "ɪn", on: "ɑn", by: "baɪ", with: "wɪð", from: "fɹəm", as: "əz", than: "ðən" };
  const one = t => (dict && dict.get(t.toLowerCase())) || null;
  const weakOr = t => (WEAK[t.toLowerCase()] && t !== t.toUpperCase() ? WEAK[t.toLowerCase()] : one(t));

  // 1語。's は、前の語の音に z を付ける。ハイフンでつないだ語は、前後に分けて、つなぐ
  function tok(t, multi) {
    let ip = multi ? weakOr(t) : one(t);
    if (!ip && /'s$/i.test(t)) { const b = one(t.slice(0, -2)); if (b) ip = b + "z" }
    if (!ip && t.includes("-")) { const ps = t.split("-").map(one); if (ps.every(Boolean)) ip = ps.join("") }
    return ip;
  }

  // 区切り(英文の一部)の発音記号。1語でも辞書に無ければ ""
  function chunk(text) {
    const toks = String(text).split(/\s+/).map(t => t.replace(/^[("'“‘$]+|[.,;:?!)"”’]+$/g, "")).filter(Boolean);
    if (!toks.length) return "";
    const parts = [];
    for (const t of toks) { const ip = tok(t, toks.length > 1); if (!ip) return ""; parts.push(ip) }
    return parts.join(" ");
  }

  // 単語・熟語の発音記号。( ) や ~ や A/B などの、語でない部分は飛ばす(例: "be entitled to"、"so ~ that ...")
  function vocab(word) {
    const toks = String(word).replace(/[(),.…\/]/g, " ").split(/\s+/).filter(Boolean);
    const parts = [];
    for (const t of toks) {
      if (!/^[A-Za-z'\-]+$/.test(t)) continue;
      const ip = tok(t, parts.length > 0 || toks.length > 1); if (!ip) return "";
      parts.push(ip);
    }
    return parts.join(" ");
  }

  // 英文1件の、意味句(slash)・IU(iu)・単語(vocab)に、発音記号を足す。足したら true。
  // override: vocab の発音記号が、すでにあっても(AI が付けたもの)、辞書で作れるなら、辞書のものに置き換える
  function fillSentence(r, { override = false } = {}) {
    let c = false;
    for (const x of r.slash || []) if (!x.ipa) { const p = chunk(x.en); if (p) { x.ipa = p; c = true } }
    for (const x of r.iu || []) if (!x.ipa) { const p = chunk(x.t); if (p) { x.ipa = p; c = true } }
    for (const v of r.vocab || []) {
      if (v.ipa && !override) continue;
      const p = vocab(v.word); if (p && p !== v.ipa) { v.ipa = p; c = true }
    }
    return c;
  }

  return { load, chunk, vocab, fillSentence, get ready() { return !!dict } };
})();
