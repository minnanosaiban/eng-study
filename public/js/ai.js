// AI(Gemini)での解析。Gemini API を直接呼ぶ方法と、コピペモード(プロンプトを自分で Gemini に貼る)の2つ。
// AI の返事は、そのままでは使わない。clean.js の検査(原文と一致するか など)を通ったものだけを入れる。
const AI = (() => {
  const $ = s => document.querySelector(s);
  const DEFAULT = { mode: "copy", apiKey: "", model: "gemini-2.5-flash" };
  let cfg = { ...DEFAULT };

  const CATS = Clean.CATS.filter(c => c !== "聞き取り"); // 4択の「問われる論点」(聞き取りは、聞き取り練習の間違いにだけ使う)

  // ---------- プロンプト ----------
  const POS_RULE = `w は英文を半角スペースで区切った1語(句読点は語に付けたまま)。w を半角スペースでつなぐと、原文と完全に一致すること。
p は品詞コードで、その文の中での働きで決める: n=名詞(固有名詞・動名詞の名詞用法を含む) / pron=代名詞(I, it, they, this など) / v=動詞(be動詞・分詞が動詞として働く場合を含む) / aux=助動詞(will, must, can, have/has/had と be の助動詞用法, do/does) / adj=形容詞(名詞を修飾する過去分詞・現在分詞を含む) / adv=副詞 / prep=前置詞 / conj=接続詞・関係詞(and, because, which, who, that(節を導く) など) / det=冠詞・限定詞(a, the, this/that+名詞, some, its, their, any など) / other=不定詞の to・数詞・記号・その他`;

  const PHRASE_RULE = `phrases は、英文を、文法上のまとまり(主語+動詞の核、to不定詞句、前置詞句、副詞節、関係詞節など)ごとに、前から順に区切ったもの(2〜8個)。t は原文の語句で、t を半角スペースでつなぐと、原文と完全に一致すること。f は、そのまとまりの文法上の形で、短い日本語(24字以内)。
f の例: 主語+動詞 / 主語+動詞+目的語 / 主語+動詞+補語 / to+不定詞句 / 動名詞句 / 分詞句 / 前置詞句 / 副詞(句) / 接続詞+節(副詞節) / 関係詞節 / 名詞節(that節) / 同格 / 比較句 / 挿入句 / 動詞+目的語(命令文)
例: "Candidates are advised to bring copies of their certificates to the interview." → [{"t":"Candidates are advised","f":"主語+動詞"},{"t":"to bring copies of their certificates","f":"to+不定詞句"},{"t":"to the interview","f":"前置詞句"}]`;

  const SLASH_RULE = `slash は、意味のまとまり(意味句)ごとに前から順に区切ったもの(2〜12個)。en は原文の語句、ja はその直訳(短く)。en を半角スペースでつなぐと、原文と完全に一致すること。`;

  const IU_RULE = `iu は、イントネーション・ユニット(一続きで読まれる、音の区切り。息継ぎ・抑揚のひとまとまり)ごとに、前から順に区切ったもの。t は原文の語句で、t を半角スペースでつなぐと、原文と完全に一致すること。
区切り方: 1つは、だいたい3〜8語(10語を超えない)。カンマの後ろで区切る。文頭の副詞(句)・副詞節は、カンマで区切って1つ。主語が長い(4語以上)ときは主語のあとで区切り、短いときは動詞とつなげる。長い文では、前置詞句・to不定詞・分詞・関係詞節・接続詞の前が区切りの候補。冠詞と名詞、前置詞とその目的語、助動詞と動詞のあいだでは区切らない。短い文(7語以下)は1つのままでよい。IU は1〜6個。
例: "Candidates are advised to bring copies of their certificates to the interview." → [{"t":"Candidates are advised"},{"t":"to bring copies of their certificates"},{"t":"to the interview."}]`;

  const SHAPE = `{
 "translation":"自然な日本語訳",
 "slash":[{"en":"意味のまとまりごとに区切った英語","ja":"その直訳(短く)"}],
 "words":[{"w":"英文を半角スペースで区切った1語","p":"品詞コード"}],
 "phrases":[{"t":"文法上のまとまりの英語","f":"そのまとまりの形"}],
 "iu":[{"t":"イントネーション・ユニットの英語"}],
 "vocab":[{"word":"単語・熟語(原形)","pos":"品詞","meaning":"この文脈での意味","ipa":"発音記号(IPA・アメリカ英語。/ / は付けない。熟語は語ごとにスペースで区切る)","note":"補足(任意)","level":"TOEIC頻出度 1〜3 の数字(3が最頻出)","toeic":"TOEICでの典型的な使われ方・よく組む語。なければ空文字"}],
 "pattern":{"type":"第3文型(SVO) のように","explanation":"主節について、なぜその文型か"},
 "clauses":[{"text":"節の英文","kind":"主節 / 名詞節 / 関係詞節 / 副詞節 など","role":"文中での働き"}],
 "elements":[{"text":"英語の語句","role":"S|V|O|C|M のいずれか","note":"補足(任意、空文字可)"}],
 "tense":{"name":"時制・態(例: 現在形・能動態)","explanation":"解説"},
 "grammar":[{"point":"文法事項","explanation":"解説"}],
 "toeic":{"scene":"ビジネス場面(人事・会議・出張・契約・広告・顧客対応・社内通知・施設/設備 など1つ)","part":"出題されやすいパート(例: Part 5 / Part 6 / Part 7)","points":[{"type":"品詞 / 時制 / 前置詞 / 接続詞・副詞 / 関係詞 / 代名詞 / 語彙 / 語法 のいずれか","detail":"この文で問われうる論点"}],"paraphrase":["TOEICで使われそうな言い換え表現"]},
 "difficulty":600 / 730 / 860 のいずれかの数字1つ(TOEICのスコア帯の目安。600=基本的な語彙と単文中心 / 730=関係詞・分詞などで修飾が長い、ビジネス語彙を含む / 860=複数の節が入れ子になる、抽象度の高い語彙),
 "quiz":{"question":"TOEIC Part 5 形式の4択穴埋め。原文の語句1つ(または短い句)を ______ にした英文","choices":["A","B","C","D"],"answer":0〜3の正解インデックス,"type":"問われる論点。次のいずれか1つ: ${CATS.join(" / ")}","explanation":"正解と各誤答が不適切な理由(日本語)"}
}`;
  const RULES = `【${"slash"}の規則】${SLASH_RULE}
【品詞コードの規則(words)】${POS_RULE}
【区切りの形の規則(phrases)】${PHRASE_RULE}
【イントネーション・ユニットの規則(iu)】${IU_RULE}
文構造(elements)は、主節の要素を文の順に並べる(Mは修飾語句)。
単語・熟語(vocab)は、この文で学ぶ価値のあるものを3〜6個。解説は日本語。`;

  const one = s => `あなたは日本の英語教師です。次の英文を分析し、JSONのみで答えてください。
英文: ${s}

JSON形式:
${SHAPE}
${RULES}`;
  const batch = list => `あなたは日本の英語教師です。次の${list.length}個の英文それぞれを、下の「1文あたりの指示」どおりに分析し、結果を JSON 配列 [{"n":1, ...}, {"n":2, ...}] で答えてください(n は英文の番号。各要素は、指示の JSON 形式に n を加えたもの)。
英文:
${list.map((s, i) => `${i + 1}. ${s}`).join("\n")}

--- 1文あたりの指示 ---
JSON形式:
${SHAPE}
${RULES}`;

  // ---------- 返事の読み取り ----------
  function parseLoose(t) {
    t = String(t || "").trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) t = fence[1].trim();
    try { return JSON.parse(t) } catch {}
    const s = t.search(/[\[{]/); if (s < 0) throw new Error("JSON が見つかりません");
    const close = t[s] === "[" ? "]" : "}", e = t.lastIndexOf(close);
    return JSON.parse(t.slice(s, e + 1));
  }

  // ---------- Gemini API ----------
  async function gemini(prompt, temp = 0.2) {
    if (!cfg.apiKey) throw new Error("Gemini API キーが入っていません。下の設定に入力するか、「コピペモード」に切り替えてください。");
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: temp } })
    });
    let j = {}; try { j = await r.json() } catch {}
    if (!r.ok) throw new Error((j.error && j.error.message) || ("HTTP " + r.status));
    const t = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || "").join("");
    return parseLoose(t);
  }

  // ---------- コピペモード ----------
  async function copyText(text, ta) {
    try { await navigator.clipboard.writeText(text) } catch { ta.select(); document.execCommand("copy") }
  }
  // プロンプトを見せ、利用者が Gemini に貼って得た返事を、貼り付けてもらう。title は「何通目か」などの表示
  function copyPaste(prompt, title) {
    const full = prompt + "\n\n【出力形式】JSON だけを ```json のコードブロック1つで出力してください。前後の説明は不要です。";
    return new Promise((resolve, reject) => {
      const d = $("#cpDlg"); $("#cpTitle").textContent = title || "コピペモード"; $("#cpPrompt").value = full; $("#cpIn").value = ""; $("#cpErr").textContent = "";
      let settled = false; const fin = (ok, v) => { if (settled) return; settled = true; d.close(); ok ? resolve(v) : reject(v) };
      $("#cpCopy").onclick = () => copyText(full, $("#cpPrompt")).then(() => { $("#cpErr").textContent = "コピーしました。Gemini に貼り付けて送り、返事を下に貼ってください。" });
      $("#cpOk").onclick = () => { try { fin(true, parseLoose($("#cpIn").value)) } catch (e) { $("#cpErr").textContent = "返事を読み取れませんでした: " + e.message + "\n返事の全体をコピーして貼り付けてください。" } };
      $("#cpCancel").onclick = () => fin(false, new Error("キャンセルしました"));
      d.oncancel = () => fin(false, new Error("キャンセルしました"));
      d.showModal();
    });
  }

  // ---------- 設定 ----------
  return {
    CATS, prompt: { one, batch }, parseLoose, gemini, copyPaste,
    get cfg() { return cfg },
    async load() { try { const c = await Store.getMeta("ai", null); if (c && typeof c === "object") cfg = { ...DEFAULT, ...c } } catch {} return cfg },
    async save(c) {
      cfg = { mode: c.mode === "api" ? "api" : "copy", apiKey: String(c.apiKey || "").trim(), model: String(c.model || "").trim() || DEFAULT.model };
      await Store.setMeta("ai", cfg); // API キーは、この端末の中だけ(同期・バックアップには入れない)
    }
  };
})();
