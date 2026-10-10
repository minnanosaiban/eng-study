// 画面の動き。登録 → 学習対象選択 → 学習。学習の単位は、英文と単語(意味句・IU は、あとで足す)
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);

  let rows = [];                                   // 英文の表
  let words = [];                                  // 単語の表
  let chunks = [];                                 // 意味句・IU の表(type で区別)
  let sel = { sentence: new Set(), meaning: new Set(), iu: new Set(), word: new Set() }; // 単位ごとの選択中の id
  let unit = "sentence";                           // 学習対象選択で見ている単位
  let study = { unit: "sentence", ids: [], i: 0 }; // 学習セット
  let prefs = { disp: "full", aux: { ipa: false, ja: true, grammar: false, vocab: false, toeic: false, quiz: false }, waux: { ipa: true, ex: true, toeic: false, tr: false }, rate: 1 };
  let tab = "reg", wReveal = false;
  const UN = { sentence: { kind: "sentences", name: "英文" }, meaning: { kind: "chunks", name: "意味句" }, iu: { kind: "chunks", name: "IU" }, word: { kind: "words", name: "単語" } };
  const tbl = u => (u === "word" ? words : u === "sentence" ? rows : chunks.filter(c => c.type === u));
  const isCard = u => u !== "sentence"; // 単語・意味句・IU は、1枚のカードで学ぶ
  const rowOf = text => rows.find(r => r.text.toLowerCase() === String(text).toLowerCase()); // 例文・親の英文から、英文の行を探す

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800) }
  const savePrefs = () => Store.setMeta("prefs", prefs).catch(() => {});
  const saveStudy = () => Store.setMeta("study", study).catch(() => {});

  // ---------- 取り込み ----------
  // 同じ英文があれば、足りないものだけ足す。なければ追加
  async function importSentences(list, { keepState = false } = {}) {
    const have = new Map(rows.map(r => [r.text.toLowerCase(), r]));
    let n = 0, u = 0; const touched = [];
    for (const o of list) {
      const s = Clean.sentence(o, { keepState });
      if (!s) continue;
      const ex = have.get(s.text.toLowerCase());
      if (ex) { if (Clean.fill(ex, s)) { u++; touched.push(ex) } continue }
      rows.push(s); have.set(s.text.toLowerCase(), s); n++; touched.push(s);
    }
    if (touched.length) await Store.put(touched, "sentences");
    return { n, u };
  }
  async function importWords(list, { keepState = false } = {}) {
    const have = new Map(words.map(w => [w.text.toLowerCase(), w]));
    let n = 0, u = 0; const touched = [];
    for (const o of list) {
      const w = Clean.word(o, { keepState });
      if (!w) continue;
      const ex = have.get(w.text.toLowerCase());
      if (ex) { if (Clean.fillWord(ex, w)) { u++; touched.push(ex) } continue }
      words.push(w); have.set(w.text.toLowerCase(), w); n++; touched.push(w);
    }
    if (touched.length) await Store.put(touched, "words");
    return { n, u };
  }

  async function importChunks(list, { keepState = false } = {}) {
    const have = new Map(chunks.map(c => [Clean.chunkKey(c), c]));
    let n = 0, u = 0; const touched = [];
    for (const o of list) {
      const c = Clean.chunk(o, { keepState });
      if (!c) continue;
      const k = Clean.chunkKey(c), ex = have.get(k);
      if (ex) { if (Clean.fillChunk(ex, c)) { u++; touched.push(ex) } continue }
      chunks.push(c); have.set(k, c); n++; touched.push(c);
    }
    if (touched.length) await Store.put(touched, "chunks");
    return { n, u };
  }

  // ファイルの中身 → { sentences, words, chunks }(groups は名前にそろえる)
  // バックアップ・解析済み JSON・受信箱の中身 → { sentences, words, chunks }。試作の形 {groups, items, words}(gids)も読む
  function normPayload(d) {
    if (!d || typeof d !== "object") throw new Error("JSON の形が違います");
    const gname = Object.create(null);
    for (const g of Array.isArray(d.groups) ? d.groups : []) if (g && typeof g.name === "string") gname[g.id] = g.name;
    const fix = i => ({ ...i, groups: Array.isArray(i.groups) ? i.groups : (Array.isArray(i.gids) ? i.gids.map(g => gname[g]).filter(Boolean) : []) });
    const items = Array.isArray(d) ? d : Array.isArray(d.sentences) ? d.sentences : Array.isArray(d.items) ? d.items : [];
    return { sentences: items.map(fix), words: (Array.isArray(d.words) ? d.words : []).map(fix), chunks: (Array.isArray(d.chunks) ? d.chunks : []).map(fix) };
  }
  function parseFile(name, text) {
    if (/\.json$/i.test(name)) return normPayload(JSON.parse(text));
    if (/\.csv$/i.test(name)) {
      return {
        sentences: text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
          const m = l.match(/^"((?:[^"]|"")*)"\s*,?\s*(.*)$/) || l.match(/^([^,]*),?\s*(.*)$/);
          const t = (m[1] || "").replace(/""/g, '"').trim(), g = (m[2] || "").replace(/^"|"$/g, "");
          return { text: t, groups: g.split(/[、,]/).map(x => x.trim()).filter(Boolean) };
        }).filter(o => o.text && !/^(英文|text|sentence)$/i.test(o.text)), words: []
      };
    }
    return { sentences: text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(t => ({ text: t })), words: [] };
  }

  // 同期・受信箱から届いた中身を取り込む。外から来るので、状態(学習中・復習回数など)は取り込まない(検査は Clean が行う)
  async function importPayload(d) {
    const p = normPayload(d), a = await importSentences(p.sentences), b = await importWords(p.words), c = await importChunks(p.chunks);
    return { n: a.n, m: b.n, c: c.n, u: a.u + b.u + c.u };
  }

  async function addFrom(data, label, opts) {
    const a = await importSentences(data.sentences || [], opts), b = await importWords(data.words || [], opts), c = await importChunks(data.chunks || [], opts);
    renderAll();
    const msg = [];
    if (a.n || a.u) msg.push(`英文 ${a.n} 文を追加${a.u ? `、${a.u} 文に足りない項目を追加` : ""}`);
    if (b.n || b.u) msg.push(`単語 ${b.n} 語を追加${b.u ? `、${b.u} 語に足りない項目を追加` : ""}`);
    if (c.n || c.u) msg.push(`意味句・IU ${c.n} 個を追加${c.u ? `、${c.u} 個に足りない項目を追加` : ""}`);
    toast(`${label}: ${msg.join(" / ") || "追加するものはありませんでした"}`);
  }

  // ---------- タブ ----------
  function setTab(t) {
    tab = t;
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    document.querySelectorAll(".tab").forEach(s => { s.hidden = s.id !== "tab-" + t });
    if (t === "pick") renderPick();
    if (t === "study") renderStudy();
    if (t === "sync") Sync.render();
    window.scrollTo(0, 0);
  }
  $("#tabs").onclick = e => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab) };

  // ---------- 登録 ----------
  function renderReg() {
    const a = rows.filter(r => r.ja).length, ipa = words.filter(w => w.ipa).length;
    $("#regInfo").textContent = (rows.length || words.length)
      ? `英文 ${rows.length} 文(うち、和訳などの解析つき ${a} 文) ・ 単語 ${words.length} 語(うち、発音記号つき ${ipa} 語) ・ 意味句 ${tbl("meaning").length} 個 ・ IU ${tbl("iu").length} 個`
      : "まだ英文も単語もありません。";
  }
  $("#btnSamples").onclick = async e => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const all = { sentences: [], words: [], chunks: [] };
      for (const f of ["toeic-sentences-analyzed.json", "toeic-sentences-2-analyzed.json"]) {
        const r = await fetch("samples/" + f); if (!r.ok) throw new Error(f + " を読めません");
        const d = parseFile(f, await r.text()); all.sentences.push(...d.sentences); all.words.push(...d.words);
      }
      await addFrom(all, "サンプル");
    } catch (err) { toast("読み込みに失敗しました: " + err.message) } finally { b.disabled = false }
  };
  $("#btnPaste").onclick = async () => {
    const g = $("#pasteGroup").value.trim(), lines = $("#paste").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return toast("英文を入力してください");
    await addFrom({ sentences: lines.map(text => ({ text, groups: g ? [g] : [] })) }, "貼り付け");
    $("#paste").value = "";
  };
  $("#btnPasteW").onclick = async () => {
    const g = $("#pasteWGroup").value.trim(), lines = $("#pasteW").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return toast("単語を入力してください");
    const list = lines.map(l => { const m = l.match(/^([^,\t、]+)[,\t、]?\s*(.*)$/); return { word: m[1].trim(), meaning: m[2], groups: g ? [g] : [] } });
    await addFrom({ words: list }, "貼り付け");
    $("#pasteW").value = "";
  };
  $("#btnWordsFrom").onclick = async () => {
    if (!rows.length) return toast("先に、英文を登録してください");
    await addFrom({ words: rows.flatMap(Clean.wordsOf), chunks: rows.flatMap(Clean.chunksOf) }, "英文から取り出し");
  };
  $("#file").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await addFrom(parseFile(f.name, await f.text()), f.name, { keepState: /\.json$/i.test(f.name) }) }
    catch (err) { toast("読み込めませんでした: " + err.message) }
    e.target.value = "";
  };
  $("#btnExport").onclick = () => {
    const blob = new Blob([JSON.stringify({ sentences: rows, words, chunks }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `eng-study-backup-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $("#btnClear").onclick = async () => {
    if (!(rows.length || words.length || chunks.length) || !confirm(`英文 ${rows.length} 文・単語 ${words.length} 語・意味句とIU ${chunks.length} 個を、すべて削除します。よろしいですか?`)) return;
    await Store.del(rows.map(r => r.id), "sentences"); await Store.del(words.map(w => w.id), "words"); await Store.del(chunks.map(c => c.id), "chunks");
    rows = []; words = []; chunks = []; sel = { sentence: new Set(), meaning: new Set(), iu: new Set(), word: new Set() }; study = { unit: "sentence", ids: [], i: 0 }; await saveStudy();
    renderAll(); toast("削除しました");
  };

  // ---------- 学習対象選択 ----------
  const allGroups = () => [...new Set([...rows, ...words, ...chunks].flatMap(r => r.groups || []))].sort();
  function filtered() {
    const q = $("#fq").value.trim().toLowerCase(), g = $("#fgroup").value, st = $("#fstatus").value, lv = $("#flevel").value, ln = $("#flen").value, ps = $("#fpos").value;
    const wc = r => r.text.split(" ").length, where = r => (r.n === 1 || r.idx === 0 ? "first" : r.idx === r.n - 1 ? "last" : "mid");
    return tbl(unit).filter(r =>
      (!isCard(unit) || unit === "word" || ((!ln || (ln === "s" ? wc(r) <= 2 : ln === "m" ? wc(r) >= 3 && wc(r) <= 5 : wc(r) >= 6)) && (!ps || where(r) === ps))) &&
      (!q || r.text.toLowerCase().includes(q) || (r.ja || "").includes(q)) &&
      (!g || (r.groups || []).includes(g)) &&
      (!st || (st === "not-mastered" ? r.status !== "mastered" : r.status === st)) &&
      (!lv || String(r.level) === lv));
  }
  function renderGroupSelect() {
    const cur = $("#fgroup").value;
    $("#fgroup").innerHTML = `<option value="">グループ: すべて</option>` + allGroups().map(g => `<option>${esc(g)}</option>`).join("");
    $("#fgroup").value = allGroups().includes(cur) ? cur : "";
  }
  function pickRow(r) {
    const chunk = unit === "meaning" || unit === "iu";
    const tags = `${r.level ? `<span class="tag">${r.level}</span>` : ""}<span class="tag">${esc(Clean.STATUS[r.status])}</span>${chunk ? `<span class="tag">${r.idx + 1}/${r.n}番目・${r.text.split(" ").length}語</span>` : ""}${(r.groups || []).map(g => `<span class="tag">${esc(g)}</span>`).join("")}`;
    const body = chunk
      ? `${esc(r.text)} ${r.ipa ? `<span class="ipa">/${esc(r.ipa)}/</span>` : ""}<span class="m"><br>${esc(r.ja)}</span>`
      : unit === "word"
      ? `<b>${esc(r.text)}</b> ${r.ipa ? `<span class="ipa">/${esc(r.ipa)}/</span>` : ""} <span class="m">${esc(r.pos)} ${"★".repeat(r.freq || 0)}</span><span class="m"><br>${esc(r.ja)}</span>`
      : `${esc(r.text)}<span class="m"><br>${esc(r.ja)}</span>`;
    return `<label class="row-i"><input type="checkbox" data-id="${r.id}" ${sel[unit].has(r.id) ? "checked" : ""}><span class="t">${body}<span class="m"><br>${tags}</span></span></label>`;
  }
  function renderPick() {
    document.querySelectorAll("#segUnit button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.u === unit)));
    document.querySelectorAll(".chunk-only").forEach(e => { e.hidden = !(unit === "meaning" || unit === "iu") });
    renderGroupSelect();
    const list = filtered(), n = tbl(unit).length;
    $("#pickList").innerHTML = list.length ? list.map(pickRow).join("")
      : `<p class="sub">${n ? "条件に合うものがありません。" : `${UN[unit].name}がありません。「登録」で入れてください。`}</p>`;
    pickInfo(list.length);
  }
  function pickInfo(shown) {
    $("#pickInfo").textContent = `表示 ${shown ?? filtered().length} 件 / 全 ${tbl(unit).length} 件 ・ 選択中 ${sel[unit].size} 件`;
    $("#btnStart").disabled = sel[unit].size === 0;
  }
  $("#segUnit").onclick = e => { const b = e.target.closest("button[data-u]"); if (b) { unit = b.dataset.u; renderPick() } };
  $("#pickList").onchange = e => { const c = e.target.closest("input[data-id]"); if (!c) return; c.checked ? sel[unit].add(c.dataset.id) : sel[unit].delete(c.dataset.id); pickInfo() };
  ["#fq", "#fgroup", "#fstatus", "#flevel", "#flen", "#fpos"].forEach(s => $(s).addEventListener("input", renderPick));
  $("#btnAll").onclick = () => { filtered().forEach(r => sel[unit].add(r.id)); renderPick() };
  $("#btnNone").onclick = () => { sel[unit].clear(); renderPick() };
  $("#btnRand").onclick = () => {
    const n = Math.max(1, Math.min(200, +$("#randN").value || 10)), pool = filtered().map(r => r.id);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
    sel[unit] = new Set(pool.slice(0, n)); renderPick(); toast(`${sel[unit].size} 件を選びました`);
  };
  $("#btnStart").onclick = async () => {
    // 表の並び順のまま、選んだものを学習セットにする
    study = { unit, ids: tbl(unit).filter(r => sel[unit].has(r.id)).map(r => r.id), i: 0 };
    wReveal = false; await saveStudy(); setTab("study");
  };

  // ---------- 学習(共通) ----------
  const cur = () => tbl(study.unit).find(r => r.id === study.ids[study.i]);
  function renderStudy() {
    const r = cur(), isW = isCard(study.unit);
    $("#studyEmpty").hidden = !!r; $("#studyBox").hidden = !r || isW; $("#wordBox").hidden = !r || !isW;
    if (!r) return;
    if (isW) renderCard(r); else renderSentence(r);
  }
  function go(d) { const n = study.i + d; if (n < 0 || n >= study.ids.length) return; stopAudio(); study.i = n; wReveal = false; saveStudy(); renderStudy() }
  $("#btnPrev").onclick = $("#wPrev").onclick = () => go(-1);
  $("#btnNext").onclick = $("#wNext").onclick = () => go(1);
  function setRate(v) { prefs.rate = +v; $("#rate").value = $("#wrate").value = String(prefs.rate); savePrefs() }
  $("#rate").onchange = e => setRate(e.target.value); $("#wrate").onchange = e => setRate(e.target.value);

  // ---------- 英文学習 ----------
  const LEG = [["n", "名詞"], ["pron", "代名詞"], ["v", "動詞"], ["aux", "助動詞"], ["adj", "形容詞"], ["adv", "副詞"], ["prep", "前置詞"], ["conj", "接続詞・関係詞"], ["det", "冠詞・限定詞"]];
  const NUM = "⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿";
  function phClass(f) {
    if (/節/.test(f)) return "c";
    if (/不定詞|動名詞|分詞/.test(f)) return "v";
    if (/前置詞/.test(f)) return "p";
    if (/主語|動詞|目的語|補語/.test(f)) return "s";
    return "o";
  }
  // 音声で読み上げる区切り。区切りの形があればそれ、なければスラッシュリーディング、なければ文全体
  const chunksOf = r => (r.phrases ? r.phrases.map(p => p.t) : r.slash ? r.slash.map(p => p.en) : [r.text]);

  function renderSentence(r) {
    $("#pos").textContent = `${study.i + 1} / ${study.ids.length}`;
    $("#btnPrev").disabled = study.i === 0; $("#btnNext").disabled = study.i >= study.ids.length - 1;
    document.querySelectorAll("#segDisp button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.d === prefs.disp)));
    document.querySelectorAll("#segAux button").forEach(b => b.setAttribute("aria-pressed", String(!!prefs.aux[b.dataset.x])));
    $("#rate").value = $("#wrate").value = String(prefs.rate);
    $("#stSel").value = r.status;
    $("#stInfo").textContent = r.review_count ? `復習 ${r.review_count} 回 ・ 最終 ${r.last_reviewed || "-"}` : "";
    renderDisp(r); renderAux(r);
  }

  function renderDisp(r, now = -1) {
    const d = prefs.disp; let h = "", legend = "";
    const hl = i => (i === now ? " now" : "");
    if (d === "slash" && r.slash) h = r.slash.map((s, i) => `<span class="sl"><span class="seg-i${hl(i)}" data-c="${i}">${esc(s.en)}</span>${prefs.aux.ja ? `<span class="ja">${esc(s.ja)}</span>` : ""}</span>`).join("");
    else if (d === "phrases" && r.phrases) h = r.phrases.map((p, i) => `<span class="ph"><span class="no">${NUM[i] || i + 1}</span><span class="seg-i cl-${phClass(p.f)}${hl(i)}" data-c="${i}">${esc(p.t)}</span> <span class="lab">${esc(p.f)}</span></span>`).join("");
    else if (d === "pos" && r.words) {
      h = r.words.map(w => `<span class="w w-${w.p}">${esc(w.w)}</span>`).join("");
      legend = LEG.map(([k, n]) => `<span><i style="background:var(--pc-${k})"></i>${n}</span>`).join("");
    } else {
      h = `<span class="seg-i" data-c="0">${esc(r.text)}</span>`;
      if (d !== "full") h += `<div class="sub">この英文には、この表示のデータがありません。</div>`;
    }
    $("#disp").innerHTML = h; $("#legend").innerHTML = legend;
  }

  function renderAux(r) {
    const a = prefs.aux; let h = "";
    if (a.ja) h += `<div class="blk"><h3>和訳</h3>${r.ja ? esc(r.ja) : '<span class="sub">なし</span>'}</div>`;
    if (a.ipa) {
      const v = (r.vocab || []).filter(x => x.ipa);
      h += `<div class="blk"><h3>発音記号(単語・熟語)</h3>${v.length ? v.map(x => `<div><b>${esc(x.word)}</b> <span class="ipa">/${esc(x.ipa)}/</span></div>`).join("") : '<span class="sub">なし</span>'}</div>`;
    }
    if (a.grammar) h += `<div class="blk"><h3>文法</h3>${(r.grammar || []).length ? r.grammar.map(g => `<div><b>・${esc(g.point)}</b><div class="sub">${esc(g.explanation)}</div></div>`).join("") : '<span class="sub">なし</span>'}</div>`;
    if (a.vocab) h += `<div class="blk"><div class="row" style="margin:0"><h3 class="grow">単語・熟語</h3>${(r.vocab || []).length ? '<button id="vAddAll" class="sm">全て単語へ</button>' : ""}</div>${(r.vocab || []).length ? `<table class="v">${r.vocab.map((x, i) => `<tr><td><b>${esc(x.word)}</b>${a.ipa && x.ipa ? `<div class="ipa">/${esc(x.ipa)}/</div>` : ""}<div class="sub">${"★".repeat(x.level || 0)}</div></td><td class="sub">${esc(x.pos)}</td><td>${esc(x.meaning)}<div class="sub">${esc(x.note)}</div>${x.toeic ? `<div class="sub">TOEIC: ${esc(x.toeic)}</div>` : ""}</td><td><button class="sm" data-wadd="${i}">${words.some(w => w.text.toLowerCase() === x.word.toLowerCase()) ? "登録済" : "＋単語"}</button></td></tr>`).join("")}</table>` : '<span class="sub">なし</span>'}</div>`;
    if (a.toeic) {
      const t = r.toeic;
      h += `<div class="blk"><h3>TOEIC の観点</h3>${t ? `<span class="tag">${esc(t.part)}</span><span class="tag">${esc(t.scene)}</span>${t.points.map(p => `<div><b>・${esc(p.type)}</b> <span class="sub">${esc(p.detail)}</span></div>`).join("")}${t.paraphrase.length ? `<div class="sub">言い換え: ${t.paraphrase.map(esc).join(" / ")}</div>` : ""}` : '<span class="sub">なし</span>'}</div>`;
    }
    if (a.quiz) {
      const q = r.quiz;
      h += `<div class="blk"><h3>4択問題</h3>${q ? `<div>${esc(q.question)}</div>${q.choices.map((c, i) => `<button class="choice" data-q="${i}">${"ABCD"[i]}. ${esc(c)}</button>`).join("")}<div id="qres" class="sub"></div>` : '<span class="sub">なし</span>'}</div>`;
    }
    $("#aux").innerHTML = h;
  }

  $("#aux").onclick = async e => {
    const r = cur();
    const add = e.target.closest("button[data-wadd],#vAddAll");
    if (add && r) { // 単語・熟語から、単語の表へ
      const all = Clean.wordsOf(r), list = add.id === "vAddAll" ? all : [all[+add.dataset.wadd]];
      const res = await importWords(list); renderAll(); toast(`単語 ${res.n} 語を追加しました${res.u ? `(${res.u} 語は、足りない項目を追加)` : ""}`); return;
    }
    const b = e.target.closest("button[data-q]");
    if (!b || !r || !r.quiz || b.parentElement.dataset.done) return;
    const i = +b.dataset.q, ok = i === r.quiz.answer;
    b.parentElement.dataset.done = "1";
    b.parentElement.querySelectorAll("button[data-q]").forEach(x => { if (+x.dataset.q === r.quiz.answer) x.classList.add("ok"); else if (x === b) x.classList.add("ng") });
    $("#qres").textContent = (ok ? "正解。" : "不正解。") + r.quiz.explanation;
    r.review_count++; r.last_reviewed = today(); await Store.put(r, "sentences"); // 4択に答えると、復習1回
    $("#stInfo").textContent = `復習 ${r.review_count} 回 ・ 最終 ${r.last_reviewed}`;
  };

  $("#segDisp").onclick = e => { const b = e.target.closest("button[data-d]"); if (b) setDisp(b.dataset.d) };
  $("#segAux").onclick = e => { const b = e.target.closest("button[data-x]"); if (b) toggleAux(b.dataset.x) };
  function setDisp(d) { prefs.disp = d; savePrefs(); renderStudy() }
  function toggleAux(x) { prefs.aux[x] = !prefs.aux[x]; savePrefs(); renderStudy() }
  $("#stSel").onchange = async e => { const r = cur(); if (r) { r.status = e.target.value; await Store.put(r, "sentences") } };

  // ---------- 単語・意味句・IU の学習(1枚のカード) ----------
  // 単位ごとの、ボタンの並び。aux = 補助(入り切り)、audio = 読み上げ
  const CARD = {
    word: { aux: [["ipa", "IPA", "I"], ["meaning", "意味", "M"], ["ex", "例文", "X"], ["toeic", "TOEIC", "T"]], audio: [["word", "▶ 発音を聞く", "スペース"], ["ex", "▶ 例文を聞く", "E"]], keys: "← → 前後 / スペース 発音を聞く / E 例文を聞く / S 止める / I M X T 補助" },
    meaning: { aux: [["ipa", "IPA", "I"], ["meaning", "和訳", "M"], ["ex", "文の中で見る", "X"], ["tr", "文の和訳", "J"]], audio: [["word", "▶ この意味句を聞く", "スペース"], ["ex", "▶ 文を聞く", "E"]], keys: "← → 前後 / スペース この意味句を聞く / E 文を聞く / S 止める / I M X J 補助" },
    iu: { aux: [["ipa", "IPA", "I"], ["ex", "文の中で見る", "X"], ["tr", "文の和訳", "J"]], audio: [["word", "▶ この IU を聞く", "スペース"], ["ex", "▶ 文を聞く", "E"]], keys: "← → 前後 / スペース この IU を聞く / E 文を聞く / S 止める / I X J 補助" }
  };
  const btnHtml = (list, attr) => list.map(([k, t, key]) => `<button ${attr}="${k}" title="${key}">${t}</button>`).join("");
  const unitOfCard = r => (r.type === "meaning" || r.type === "iu" ? r.type : "word");
  // 文の中で、この区切りを目立たせる(文の中に見つからなければ、そのまま出す)
  function inContext(r) {
    const full = r.ex, i = full.toLowerCase().indexOf(r.text.toLowerCase());
    if (i < 0) return esc(full);
    return esc(full.slice(0, i)) + `<span class="hl">${esc(full.slice(i, i + r.text.length))}</span>` + esc(full.slice(i + r.text.length));
  }

  function renderCard(w) {
    const u = unitOfCard(w), cfg = CARD[u], chunk = u !== "word", a = prefs.waux;
    $("#segWAudio").innerHTML = btnHtml(cfg.audio, "data-a") + '<button id="wStop" title="S">■</button>';
    $("#segWAux").innerHTML = btnHtml(cfg.aux, "data-x");
    $("#wKeys").textContent = "ショートカット: " + cfg.keys;
    $("#wPos").textContent = `${study.i + 1} / ${study.ids.length}`;
    $("#wPrev").disabled = study.i === 0; $("#wNext").disabled = study.i >= study.ids.length - 1;
    document.querySelectorAll("#segWAux button").forEach(b => {
      const x = b.dataset.x; b.setAttribute("aria-pressed", String(x === "meaning" ? wReveal : !!a[x]));
    });
    $("#wrate").value = String(prefs.rate);
    $("#wStSel").value = w.status;
    $("#wDone").hidden = u !== "iu";
    $("#wStInfo").textContent = w.review_count ? `復習 ${w.review_count} 回 ・ 最終 ${w.last_reviewed || "-"}` : "";
    const tags = (w.groups || []).map(g => `<span class="tag">${esc(g)}</span>`).join("");
    const lv = w.level ? `<span class="tag">${w.level}</span>` : "";
    const ipa = a.ipa && w.ipa ? `<div class="ipa">/${esc(w.ipa)}/</div>` : "";
    let h = "";
    if (chunk) {
      $("#wDisp").innerHTML = `<div class="word" style="font-size:24px">${esc(w.text)}</div>${ipa}<div class="sub meta"><span class="tag">${Clean.CTYPE[u]}</span><span class="tag">${w.idx + 1}/${w.n}番目</span><span class="tag">${w.text.split(" ").length}語</span>${lv}${tags}</div>`;
      if (u === "meaning") h += `<div class="blk">${wReveal ? `<h3>和訳</h3>${esc(w.ja) || '<span class="sub">なし</span>'}` : `<button class="hide-btn" id="wShow">和訳を見る(M)</button>`}</div>`;
      if (a.ex) h += `<div class="blk"><h3>文の中で</h3>${inContext(w)}</div>`;
      if (a.tr) { const p = rowOf(w.ex); h += `<div class="blk"><h3>文の和訳</h3>${p && p.ja ? esc(p.ja) : '<span class="sub">なし</span>'}</div>` }
    } else {
      $("#wDisp").innerHTML = `<div class="word">${esc(w.text)}</div>${ipa}<div class="sub meta">${esc(w.pos)} ${"★".repeat(w.freq || 0)} ${lv}${tags}</div>`;
      h += `<div class="blk">${wReveal ? `<h3>意味</h3>${esc(w.ja) || '<span class="sub">なし</span>'}${w.note ? `<div class="sub">${esc(w.note)}</div>` : ""}` : `<button class="hide-btn" id="wShow">意味を見る(M)</button>`}</div>`;
      if (a.ex) h += `<div class="blk"><h3>例文</h3>${w.ex ? esc(w.ex) : '<span class="sub">なし</span>'}</div>`;
      if (a.toeic) h += `<div class="blk"><h3>TOEIC での使われ方</h3>${w.toeic ? esc(w.toeic) : '<span class="sub">なし</span>'}</div>`;
    }
    $("#wAux").innerHTML = h;
  }
  const cardKind = () => UN[study.unit].kind;
  async function revealMeaning(on) {
    const w = cur(); if (!w || w.type === "iu") return;
    if (on && !wReveal) { w.review_count++; w.last_reviewed = today(); await Store.put(w, cardKind()) } // 隠した意味を見る = 復習1回
    wReveal = on; renderCard(w);
  }
  $("#wAux").onclick = e => { if (e.target.closest("#wShow")) revealMeaning(true) };
  $("#segWAux").onclick = e => {
    const b = e.target.closest("button[data-x]"); if (!b) return;
    if (b.dataset.x === "meaning") return revealMeaning(!wReveal);
    prefs.waux[b.dataset.x] = !prefs.waux[b.dataset.x]; savePrefs(); renderStudy();
  };
  $("#wStSel").onchange = async e => { const w = cur(); if (w) { w.status = e.target.value; await Store.put(w, cardKind()) } };
  $("#wDone").onclick = async () => { const w = cur(); if (!w) return; w.review_count++; w.last_reviewed = today(); await Store.put(w, cardKind()); renderCard(w) }; // IU は、声に出して練習したら、復習1回

  // ---------- 音声(端末の読み上げ) ----------
  let playing = 0; // 世代番号。止める・次へ行くと増やして、前の読み上げを無効にする
  function stopAudio() { playing++; try { speechSynthesis.cancel() } catch {} const r = cur(); if (r && tab === "study" && study.unit === "sentence") renderDisp(r) }
  function say(text) {
    return new Promise(res => {
      if (!("speechSynthesis" in window)) return res();
      const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = prefs.rate;
      const v = speechSynthesis.getVoices().find(x => /^en[-_]US/i.test(x.lang)) || speechSynthesis.getVoices().find(x => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.onend = u.onerror = () => res();
      speechSynthesis.speak(u);
    });
  }
  async function play(mode) {
    const r = cur(); if (!r) return;
    if (!("speechSynthesis" in window)) return toast("この端末では、読み上げが使えません");
    stopAudio(); const me = playing;
    if (mode === "word") return say(r.text);
    if (mode === "ex") { if (r.ex) await say(r.ex); else toast("例文がありません"); return }
    if (mode === "once") { await say(r.text); return }
    const ch = chunksOf(r);
    if (prefs.disp === "full" || prefs.disp === "pos") { prefs.disp = r.phrases ? "phrases" : r.slash ? "slash" : "full"; renderStudy() }
    for (let i = 0; i < ch.length; i++) {
      if (me !== playing) return;
      renderDisp(r, i); await say(ch[i]);
    }
    if (me === playing) renderDisp(r);
  }
  $("#segAudio").onclick = e => { const b = e.target.closest("button[data-a]"); if (b) play(b.dataset.a) };
  $("#segWAudio").onclick = e => { if (e.target.closest("#wStop")) return stopAudio(); const b = e.target.closest("button[data-a]"); if (b) play(b.dataset.a) };
  $("#btnStop").onclick = stopAudio;

  // ---------- ショートカット ----------
  document.addEventListener("keydown", e => {
    if (tab !== "study" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || (e.target.closest("button") && e.key === " ")) return;
    const k = e.key.toLowerCase();
    if (k === "arrowleft") return go(-1);
    if (k === "arrowright") return go(1);
    if (k === "s") return stopAudio();
    if (isCard(study.unit)) {
      const ax = { i: "ipa", x: "ex", t: "toeic", j: "tr" }, has = n => CARD[study.unit].aux.some(x => x[0] === n);
      if (k === " ") { e.preventDefault(); play("word") } else if (k === "e") play("ex");
      else if (k === "m") revealMeaning(!wReveal);
      else if (ax[k] && has(ax[k])) { prefs.waux[ax[k]] = !prefs.waux[ax[k]]; savePrefs(); renderStudy() }
      return;
    }
    const map = { "1": "full", "2": "slash", "3": "phrases", "4": "pos" }, ax = { i: "ipa", j: "ja", g: "grammar", v: "vocab", t: "toeic", q: "quiz" };
    if (k === " ") { e.preventDefault(); play("once") } else if (k === "c") play("chunks");
    else if (map[k]) setDisp(map[k]); else if (ax[k]) toggleAux(ax[k]);
  });

  // ---------- AI で解析(Gemini API / コピペモード) ----------
  // 足りない解析がある英文
  const needsAI = r => !r.ja || !r.slash || !r.phrases || !r.words || !r.iu || !(r.vocab && r.vocab.length) || !r.quiz;
  let aiBusy = false, aiStop = false;

  function renderAI() {
    const n = rows.filter(needsAI).length, c = AI.cfg;
    $("#aiInfo").textContent = n ? `解析が足りない英文: ${n} 文(方法: ${c.mode === "api" ? "Gemini API" : "コピペモード"})` : (rows.length ? "すべての英文に、解析があります。" : "英文を登録すると、ここから解析できます。");
    $("#btnAI").disabled = aiBusy || !n; $("#btnAIStop").hidden = !(aiBusy && c.mode === "api");
    document.querySelectorAll("[name=aiMode]").forEach(r => { r.checked = r.value === c.mode });
    if (document.activeElement !== $("#apiKey")) $("#apiKey").value = c.apiKey;
    if (document.activeElement !== $("#aiModel")) $("#aiModel").value = c.model;
  }
  $("#aiSave").onclick = async () => {
    await AI.save({ mode: document.querySelector("[name=aiMode]:checked").value, apiKey: $("#apiKey").value, model: $("#aiModel").value });
    renderAI(); toast("設定を保存しました");
  };

  // AI の1文分の結果を、英文に足す。検査を通ったものだけ(解析・状態・記録は上書きしない)。足したら true
  async function applyAI(row, res) {
    if (!res || typeof res !== "object" || Array.isArray(res)) return false;
    const add = Clean.sentence({ text: row.text, level: res.difficulty, quiz: res.quiz, analysis: res });
    if (!add) return false;
    const had = !!row.ja, c = Clean.fill(row, add);
    if (c) {
      if (!had && row.ja) row.verified = false; // AI の解析は「未確認」
      await Store.put(row, "sentences");
      await importWords(Clean.wordsOf(row)); await importChunks(Clean.chunksOf(row)); // 単語・意味句・IU の表にも入れる
    }
    return c;
  }

  async function runAI() {
    const targets = rows.filter(needsAI);
    if (!targets.length || aiBusy) return;
    const mode = AI.cfg.mode;
    if (mode === "api" && !AI.cfg.apiKey) { $("#aiSet").open = true; return toast("Gemini API キーを入力するか、コピペモードに切り替えてください") }
    aiBusy = true; aiStop = false; let done = 0, skipped = 0, err = "";
    renderAI();
    try {
      if (mode === "api") {
        for (let i = 0; i < targets.length && !aiStop; i++) {
          $("#aiProg").textContent = `解析中 ${i + 1} / ${targets.length}`;
          const res = await AI.gemini(AI.prompt.one(targets[i].text));
          if (await applyAI(targets[i], res)) done++; else skipped++;
        }
      } else {
        const N = 5, total = Math.ceil(targets.length / N);
        for (let k = 0; k < total; k++) {
          const part = targets.slice(k * N, k * N + N);
          $("#aiProg").textContent = `${k + 1} / ${total} 通目`;
          const res = await AI.copyPaste(AI.prompt.batch(part.map(r => r.text)), `コピペモード ${k + 1} / ${total} 通目(${part.length} 文)`);
          const arr = Array.isArray(res) ? res : [res];
          for (let j = 0; j < arr.length; j++) {
            const idx = Number.isInteger(arr[j] && arr[j].n) ? arr[j].n - 1 : j; // n(番号)があれば、それで英文を決める
            if (part[idx] && await applyAI(part[idx], arr[j])) done++; else skipped++;
          }
        }
      }
    } catch (e) { err = e.message }
    aiBusy = false; $("#aiProg").textContent = ""; renderAll();
    toast(`解析: ${done} 文に追加${skipped ? `、${skipped} 文は、検査を通らず見送り` : ""}${aiStop ? "(止めました)" : ""}${err ? "。中断: " + err : ""}`);
  }
  $("#btnAI").onclick = runAI;
  $("#btnAIStop").onclick = () => { aiStop = true };

  function renderAll() { renderReg(); renderAI(); if (tab === "pick") renderPick(); if (tab === "study") renderStudy() }

  // ---------- 起動 ----------
  (async () => {
    try {
      await AI.load();
      rows = await Store.all("sentences"); words = await Store.all("words"); chunks = await Store.all("chunks");
      const p = await Store.getMeta("prefs", null);
      if (p && typeof p === "object") prefs = { ...prefs, ...p, aux: { ...prefs.aux, ...(p.aux || {}) }, waux: { ...prefs.waux, ...(p.waux || {}) } };
      const s = await Store.getMeta("study", null);
      if (s && Array.isArray(s.ids)) {
        const u = UN[s.unit] ? s.unit : "sentence", ok = new Set(tbl(u).map(r => r.id));
        study = { unit: u, ids: s.ids.filter(id => ok.has(id)), i: Math.max(0, +s.i || 0) }; if (study.i >= study.ids.length) study.i = 0;
      }
    } catch (e) { toast("保存先(IndexedDB)を開けませんでした: " + e.message) }
    renderAll();
    // クラウド同期(あれば、起動時に1回同期する)
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    await Sync.init({
      table: k => (k === "word" ? words : k === "chunk" ? chunks : rows),
      sortAll: () => { rows.sort(byId); words.sort(byId); chunks.sort(byId) }, // id は作った順に並ぶ
      refresh: () => { study.ids = study.ids.filter(id => tbl(study.unit).some(r => r.id === id)); if (study.i >= study.ids.length) study.i = 0; renderAll() },
      importPayload, toast
    });
    if (Sync.wantsJoin) setTab("sync");
  })();
})();
