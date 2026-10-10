#!/usr/bin/env node
// 発音辞書(CMU Pronouncing Dictionary、アメリカ英語)から、アプリが読む public/dict/cmudict-ipa.txt を作る。
// 辞書の音は ARPAbet(AH0 などの記号)で書かれているので、IPA に直し、強勢の印(ˈ ˌ)を、音節の頭に置く。
// 1行 = 「単語|IPA」。アプリ(public/js/pron.js)が、必要になったときに読み込む。
//
//   npm i --no-save cmu-pronouncing-dictionary
//   node tools/build-pron.mjs
//
// 辞書は、Carnegie Mellon University が作ったもの(npm の cmu-pronouncing-dictionary 経由)。public/dict/NOTICE.txt を参照。

import { dictionary } from "cmu-pronouncing-dictionary";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../public/dict/cmudict-ipa.txt");

const M = { AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ", B: "b", CH: "tʃ", D: "d", DH: "ð", EH: "ɛ", ER: "ɝ", EY: "eɪ", F: "f", G: "ɡ", HH: "h", IH: "ɪ", IY: "i", JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", OW: "oʊ", OY: "ɔɪ", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", UH: "ʊ", UW: "u", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ" };
// 音節の頭になれる子音の並び(強勢の印を、どこに置くかを決める)
const OK2 = new Set(["pl", "pɹ", "bl", "bɹ", "tɹ", "dɹ", "kl", "kɹ", "ɡl", "ɡɹ", "fl", "fɹ", "θɹ", "ʃɹ", "sp", "st", "sk", "sm", "sn", "sl", "sw", "tw", "kw", "dw", "θw", "hj", "pj", "bj", "tj", "dj", "kj", "ɡj", "fj", "vj", "mj", "nj", "sj", "lj"]);
const OK3 = new Set(["spl", "spɹ", "stɹ", "skɹ", "skw", "stj", "spj", "skj"]);

function toIpa(arpa) {
  const ph = arpa.split(" ").map((t) => {
    const m = t.match(/^([A-Z]+)([0-9])?$/);
    if (!m || !M[m[1]]) throw new Error("知らない記号: " + t);
    const b = m[1], st = m[2], v = /[AEIOU]/.test(b);
    let x = M[b];
    if (b === "AH") x = st === "0" ? "ə" : "ʌ";
    if (b === "ER") x = st === "0" ? "ɚ" : "ɝ";
    return { x, v, st: v ? st : null };
  });
  const marks = {};
  ph.forEach((q, i) => {
    if (!q.v || (q.st !== "1" && q.st !== "2")) return;
    let j = i; while (j > 0 && !ph[j - 1].v) j--;            // 母音の前の、子音のかたまり
    let k = i;
    while (k > j) {
      const n = i - k + 1; if (n > 3) break;
      const cl = ph.slice(k - 1, i).map((z) => z.x).join("");
      if (n === 1 && ph[k - 1].x !== "ŋ") { k--; continue; }
      if (n === 2 && OK2.has(cl)) { k--; continue; }
      if (n === 3 && OK3.has(cl)) { k--; continue; }
      break;
    }
    marks[k] = q.st === "1" ? "ˈ" : "ˌ";
  });
  return ph.map((q, i) => (marks[i] || "") + q.x).join("");
}

// 載せたくない語(任意)。tools/pron-exclude.txt(Git の管理外)に、1行に1語で書く。例: 公開しない設定のチェックに、固有名詞が引っかかるときなど
const exFile = resolve(here, "pron-exclude.txt");
const skip = new Set(existsSync(exFile) ? readFileSync(exFile, "utf8").split(String.fromCharCode(10)).map((x) => x.trim().toLowerCase()).filter(Boolean) : []);
const lines = [];
for (const [w, a] of Object.entries(dictionary)) {
  if (skip.has(w)) continue;
  if (!/^[a-z][a-z'-]*$/.test(w)) continue; // 英字・アポストロフィ・ハイフンだけの語(数字・記号・変則の綴りは使わない)
  lines.push(w + "|" + toIpa(a.split(" #")[0].trim())); // 値の終わりに、注釈(# …)が付く語がある
}
lines.sort();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${lines.length} 語 → ${out}`);
