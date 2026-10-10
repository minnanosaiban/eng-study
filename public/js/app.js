// 画面の動き。登録 → 学習対象選択 → 英文学習(英文だけ。意味句・IU・単語の単位は、あとで足す)
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);

  let rows = [];                 // 英文の表(全部)
  let sel = new Set();           // 選択中の id
  let study = { ids: [], i: 0 }; // 学習セット
  let prefs = { disp: "full", aux: { ipa: false, ja: true, grammar: false, vocab: false, toeic: false, quiz: false }, rate: 1 };
  let tab = "reg";

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600) }
  const savePrefs = () => Store.setMeta("prefs", prefs).catch(() => {});

  // ---------- 取り込み ----------
  // 同じ英文があれば、足りないものだけ足す。なければ追加。{n:追加, u:足した}
  async function importList(list, { keepState = false } = {}) {
    const have = new Map(rows.map(r => [r.text.toLowerCase(), r]));
    let n = 0, u = 0; const touched = [];
    for (const o of list) {
      const s = Clean.sentence(o, { keepState });
      if (!s) continue;
      const ex = have.get(s.text.toLowerCase());
      if (ex) { if (Clean.fill(ex, s)) { u++; touched.push(ex) } continue }
      rows.push(s); have.set(s.text.toLowerCase(), s); n++; touched.push(s);
    }
    if (touched.length) await Store.put(touched);
    return { n, u };
  }

  // ファイルの中身 → 英文の一覧(groups は名前にそろえる)
  function parseFile(name, text) {
    if (/\.json$/i.test(name)) {
      const d = JSON.parse(text);
      const gname = Object.create(null);
      for (const g of Array.isArray(d.groups) ? d.groups : []) if (g && typeof g.name === "string") gname[g.id] = g.name;
      const items = Array.isArray(d) ? d : Array.isArray(d.sentences) ? d.sentences : Array.isArray(d.items) ? d.items : [];
      return items.map(i => ({ ...i, groups: Array.isArray(i.groups) ? i.groups : (Array.isArray(i.gids) ? i.gids.map(g => gname[g]).filter(Boolean) : []) }));
    }
    if (/\.csv$/i.test(name)) {
      return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^"((?:[^"]|"")*)"\s*,?\s*(.*)$/) || l.match(/^([^,]*),?\s*(.*)$/);
        const t = (m[1] || "").replace(/""/g, '"').trim(), g = (m[2] || "").replace(/^"|"$/g, "");
        return { text: t, groups: g.split(/[、,]/).map(x => x.trim()).filter(Boolean) };
      }).filter(o => o.text && !/^(英文|text|sentence)$/i.test(o.text));
    }
    return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(t => ({ text: t }));
  }

  async function addFromText(list, label, opts) {
    const r = await importList(list, opts);
    renderAll();
    toast(`${label}: ${r.n} 文を追加${r.u ? `、${r.u} 文に足りない項目を追加` : ""}`);
  }

  // ---------- タブ ----------
  function setTab(t) {
    tab = t;
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    document.querySelectorAll(".tab").forEach(s => { s.hidden = s.id !== "tab-" + t });
    if (t === "pick") renderPick();
    if (t === "study") renderStudy();
    window.scrollTo(0, 0);
  }
  $("#tabs").onclick = e => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab) };

  // ---------- 登録 ----------
  function renderReg() {
    const lv = rows.filter(r => r.ja).length;
    $("#regInfo").textContent = rows.length ? `英文 ${rows.length} 文(うち、和訳などの解析つき ${lv} 文)` : "まだ英文がありません。";
  }
  $("#btnSamples").onclick = async e => {
    const b = e.currentTarget; b.disabled = true;
    try {
      let list = [];
      for (const f of ["toeic-sentences-analyzed.json", "toeic-sentences-2-analyzed.json"]) {
        const r = await fetch("samples/" + f); if (!r.ok) throw new Error(f + " を読めません");
        list = list.concat(parseFile(f, await r.text()));
      }
      await addFromText(list, "サンプル");
    } catch (err) { toast("読み込みに失敗しました: " + err.message) } finally { b.disabled = false }
  };
  $("#btnPaste").onclick = async () => {
    const g = $("#pasteGroup").value.trim(), lines = $("#paste").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return toast("英文を入力してください");
    await addFromText(lines.map(text => ({ text, groups: g ? [g] : [] })), "貼り付け");
    $("#paste").value = "";
  };
  $("#file").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await addFromText(parseFile(f.name, await f.text()), f.name, { keepState: /\.json$/i.test(f.name) }) }
    catch (err) { toast("読み込めませんでした: " + err.message) }
    e.target.value = "";
  };
  $("#btnExport").onclick = () => {
    const blob = new Blob([JSON.stringify({ sentences: rows }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `eng-study-backup-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $("#btnClear").onclick = async () => {
    if (!rows.length || !confirm(`英文 ${rows.length} 文をすべて削除します。よろしいですか?`)) return;
    await Store.del(rows.map(r => r.id)); rows = []; sel.clear(); study = { ids: [], i: 0 }; await Store.setMeta("study", study);
    renderAll(); toast("削除しました");
  };

  // ---------- 学習対象選択 ----------
  const allGroups = () => [...new Set(rows.flatMap(r => r.groups || []))].sort();
  function filtered() {
    const q = $("#fq").value.trim().toLowerCase(), g = $("#fgroup").value, st = $("#fstatus").value, lv = $("#flevel").value;
    return rows.filter(r =>
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
  function renderPick() {
    renderGroupSelect();
    const list = filtered();
    $("#pickList").innerHTML = list.length ? list.map(r => `<label class="row-i"><input type="checkbox" data-id="${r.id}" ${sel.has(r.id) ? "checked" : ""}>
      <span class="t">${esc(r.text)}<span class="m"><br>${esc(r.ja)}</span>
      <span class="m"><br>${r.level ? `<span class="tag">${r.level}</span>` : ""}<span class="tag">${esc(Clean.STATUS[r.status])}</span>${(r.groups || []).map(g => `<span class="tag">${esc(g)}</span>`).join("")}</span></span></label>`).join("")
      : `<p class="sub">${rows.length ? "条件に合う英文がありません。" : "英文がありません。「登録」で入れてください。"}</p>`;
    pickInfo(list.length);
  }
  function pickInfo(shown) {
    $("#pickInfo").textContent = `表示 ${shown ?? filtered().length} 文 / 全 ${rows.length} 文 ・ 選択中 ${sel.size} 文`;
    $("#btnStart").disabled = sel.size === 0;
  }
  $("#pickList").onchange = e => { const c = e.target.closest("input[data-id]"); if (!c) return; c.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); pickInfo() };
  ["#fq", "#fgroup", "#fstatus", "#flevel"].forEach(s => $(s).addEventListener("input", renderPick));
  $("#btnAll").onclick = () => { filtered().forEach(r => sel.add(r.id)); renderPick() };
  $("#btnNone").onclick = () => { sel.clear(); renderPick() };
  $("#btnRand").onclick = () => {
    const n = Math.max(1, Math.min(200, +$("#randN").value || 10)), pool = filtered().map(r => r.id);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
    sel = new Set(pool.slice(0, n)); renderPick(); toast(`${sel.size} 文を選びました`);
  };
  $("#btnStart").onclick = async () => {
    // 表の並び順のまま、選んだ英文を学習セットにする
    study = { ids: rows.filter(r => sel.has(r.id)).map(r => r.id), i: 0 };
    await Store.setMeta("study", study); setTab("study");
  };

  // ---------- 英文学習 ----------
  const cur = () => rows.find(r => r.id === study.ids[study.i]);
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
  function chunksOf(r) { return r.phrases ? r.phrases.map(p => p.t) : r.slash ? r.slash.map(p => p.en) : [r.text] }

  function renderStudy() {
    const r = cur();
    $("#studyEmpty").hidden = !!r; $("#studyBox").hidden = !r;
    if (!r) return;
    $("#pos").textContent = `${study.i + 1} / ${study.ids.length}`;
    $("#btnPrev").disabled = study.i === 0; $("#btnNext").disabled = study.i >= study.ids.length - 1;
    document.querySelectorAll("#segDisp button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.d === prefs.disp)));
    document.querySelectorAll("#segAux button").forEach(b => b.setAttribute("aria-pressed", String(!!prefs.aux[b.dataset.x])));
    $("#rate").value = String(prefs.rate);
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
    if (a.ja && prefs.disp !== "slash") h += `<div class="blk"><h3>和訳</h3>${r.ja ? esc(r.ja) : '<span class="sub">なし</span>'}</div>`;
    if (a.ja && prefs.disp === "slash" && r.ja) h += `<div class="blk"><h3>和訳</h3>${esc(r.ja)}</div>`;
    if (a.ipa) {
      const v = (r.vocab || []).filter(x => x.ipa);
      h += `<div class="blk"><h3>発音記号(単語・熟語)</h3>${v.length ? v.map(x => `<div><b>${esc(x.word)}</b> <span class="ipa">/${esc(x.ipa)}/</span></div>`).join("") : '<span class="sub">なし</span>'}</div>`;
    }
    if (a.grammar) h += `<div class="blk"><h3>文法</h3>${(r.grammar || []).length ? r.grammar.map(g => `<div><b>・${esc(g.point)}</b><div class="sub">${esc(g.explanation)}</div></div>`).join("") : '<span class="sub">なし</span>'}</div>`;
    if (a.vocab) h += `<div class="blk"><h3>単語・熟語</h3>${(r.vocab || []).length ? `<table class="v">${r.vocab.map(x => `<tr><td><b>${esc(x.word)}</b>${a.ipa && x.ipa ? `<div class="ipa">/${esc(x.ipa)}/</div>` : ""}<div class="sub">${"★".repeat(x.level || 0)}</div></td><td class="sub">${esc(x.pos)}</td><td>${esc(x.meaning)}<div class="sub">${esc(x.note)}</div>${x.toeic ? `<div class="sub">TOEIC: ${esc(x.toeic)}</div>` : ""}</td></tr>`).join("")}</table>` : '<span class="sub">なし</span>'}</div>`;
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
    const b = e.target.closest("button[data-q]"), r = cur();
    if (!b || !r || !r.quiz || b.parentElement.dataset.done) return;
    const i = +b.dataset.q, ok = i === r.quiz.answer;
    b.parentElement.dataset.done = "1";
    b.parentElement.querySelectorAll("button[data-q]").forEach(x => { if (+x.dataset.q === r.quiz.answer) x.classList.add("ok"); else if (x === b) x.classList.add("ng") });
    $("#qres").textContent = (ok ? "正解。" : "不正解。") + r.quiz.explanation;
    r.review_count++; r.last_reviewed = today(); await Store.put(r); // 4択に答えると、復習1回
    $("#stInfo").textContent = `復習 ${r.review_count} 回 ・ 最終 ${r.last_reviewed}`;
  };

  function go(d) { const n = study.i + d; if (n < 0 || n >= study.ids.length) return; stopAudio(); study.i = n; Store.setMeta("study", study); renderStudy() }
  $("#btnPrev").onclick = () => go(-1); $("#btnNext").onclick = () => go(1);
  $("#segDisp").onclick = e => { const b = e.target.closest("button[data-d]"); if (b) setDisp(b.dataset.d) };
  $("#segAux").onclick = e => { const b = e.target.closest("button[data-x]"); if (b) toggleAux(b.dataset.x) };
  function setDisp(d) { prefs.disp = d; savePrefs(); renderStudy() }
  function toggleAux(x) { prefs.aux[x] = !prefs.aux[x]; savePrefs(); renderStudy() }
  $("#stSel").onchange = async e => { const r = cur(); if (r) { r.status = e.target.value; await Store.put(r) } };
  $("#rate").onchange = e => { prefs.rate = +e.target.value; savePrefs() };

  // ---------- 音声(端末の読み上げ) ----------
  let playing = 0; // 世代番号。止める・次へ行くと増やして、前の読み上げを無効にする
  function stopAudio() { playing++; try { speechSynthesis.cancel() } catch {} const r = cur(); if (r && tab === "study") renderDisp(r) }
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
  $("#btnStop").onclick = stopAudio;

  // ---------- ショートカット ----------
  document.addEventListener("keydown", e => {
    if (tab !== "study" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.closest("button") && e.key === " ") return;
    const k = e.key.toLowerCase(), map = { "1": "full", "2": "slash", "3": "phrases", "4": "pos" }, ax = { i: "ipa", j: "ja", g: "grammar", v: "vocab", t: "toeic", q: "quiz" };
    if (k === "arrowleft") go(-1); else if (k === "arrowright") go(1);
    else if (k === " ") { e.preventDefault(); play("once") } else if (k === "c") play("chunks"); else if (k === "s") stopAudio();
    else if (map[k]) setDisp(map[k]); else if (ax[k]) toggleAux(ax[k]); else return;
  });

  function renderAll() { renderReg(); if (tab === "pick") renderPick(); if (tab === "study") renderStudy() }

  // ---------- 起動 ----------
  (async () => {
    try {
      rows = await Store.all();
      const p = await Store.getMeta("prefs", null);
      if (p && typeof p === "object") prefs = { ...prefs, ...p, aux: { ...prefs.aux, ...(p.aux || {}) } };
      const s = await Store.getMeta("study", null);
      if (s && Array.isArray(s.ids)) { const ok = new Set(rows.map(r => r.id)); study = { ids: s.ids.filter(id => ok.has(id)), i: Math.max(0, +s.i || 0) }; if (study.i >= study.ids.length) study.i = 0 }
    } catch (e) { toast("保存先(IndexedDB)を開けませんでした: " + e.message) }
    renderAll();
  })();
})();
