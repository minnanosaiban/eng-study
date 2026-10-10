// クラウド同期(Cloudflare D1)と受信箱。
// 英文・単語・意味句・IU を、端末側で AES-GCM 暗号化してから送る。鍵はパスフレーズから PBKDF2 で作る。
// サーバー側は暗号文しか持たないので、中身は Cloudflare からも読めない。
// 変更検知: 最後に同期した時点の各行のハッシュと比べ、違うものだけ送る。
// 暗号鍵は、取り出せない形(extractable: false)で、この端末の IndexedDB に置く。
const Sync = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CHECK = "eng-study-check";
  const te = new TextEncoder(), td = new TextDecoder();

  // 行の種類 → 保存先の表、同じものかを見分けるキー、足りないものを足す関数
  const KIND = {
    sentence: { store: "sentences", nat: x => x.text.toLowerCase(), fill: (a, b) => Clean.fill(a, b) },
    word: { store: "words", nat: x => x.text.toLowerCase(), fill: (a, b) => Clean.fillWord(a, b) },
    chunk: { store: "chunks", nat: x => Clean.chunkKey(x), fill: (a, b) => Clean.fillChunk(a, b) }
  };
  let st = null;                 // { token, key(CryptoKey), since, hashes, last }
  let hooks = null;              // app.js から渡される: table(kind) / refresh() / importPayload(obj) / toast(msg)
  let syncing = false, again = false, timer = null, applying = false;
  let form = null, newToken = null, joinToken = "", inboxBundle = null;

  const toB64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) };
  const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromB64(salt), iterations: 600000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(obj, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)));
    return { iv: toB64(iv), data: toB64(new Uint8Array(ct)) };
  }
  const decrypt = async (iv, data, key) => JSON.parse(td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(data))));
  async function api(path, opt = {}, token = st && st.token) {
    let r;
    try { r = await fetch("/api/" + path, { ...opt, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) } }) }
    catch { throw new Error("通信できませんでした(オフラインの可能性)") }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }
  function hash(s) {
    let a = 0xdeadbeef, b = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677) }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909); b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
  }
  const hashOf = o => hash(JSON.stringify(o));
  const rk = (k, id) => k + ":" + id;
  const saveState = () => Store.setMeta("sync", st).catch(e => hooks && hooks.toast("同期情報を保存できませんでした: " + e.message));

  // ---------- 受け取り ----------
  // 手元の変更を優先する(次の送信で上書きされる)。まだ同期していない同じ英文・単語・区切りが手元にあれば、1つにまとめる
  async function applyRemote(rec) {
    const kd = KIND[rec.kind]; if (!kd) return false;
    const arr = hooks.table(rec.kind), kk = rk(rec.kind, rec.id), idx = arr.findIndex(o => o.id === rec.id);
    const dirty = idx >= 0 && st.hashes[kk] !== hashOf(arr[idx]);
    if (rec.deleted) {
      if (idx >= 0 && !dirty) { arr.splice(idx, 1); await Store.del([rec.id], kd.store) }
      delete st.hashes[kk]; return true;
    }
    if (idx < 0 && st.hashes[kk]) return false; // 前回までに同期した行が、手元に無い = この端末で消した。次の送信で「消した」と伝えるので、戻さない
    const o = await decrypt(rec.iv, rec.data, st.key);
    if (!o || typeof o !== "object" || typeof o.text !== "string") return false;
    o.id = rec.id;
    if (dirty) return false;
    const h = hashOf(o);
    if (idx >= 0 && hashOf(arr[idx]) === h) { st.hashes[kk] = h; return false } // 自分が送ったものが戻ってきただけ
    if (idx >= 0) arr[idx] = o;
    else {
      const di = arr.findIndex(x => !st.hashes[rk(rec.kind, x.id)] && kd.nat(x) === kd.nat(o));
      if (di >= 0) { const loc = arr[di]; arr.splice(di, 1); await Store.del([loc.id], kd.store); kd.fill(o, loc) }
      arr.push(o);
    }
    await Store.put(o, kd.store); st.hashes[kk] = h; return true;
  }

  // 受信箱から受け取る: 1通ずつ、公開鍵で包まれた AES 鍵を秘密鍵で開き、本文を復号して取り込む
  async function pullInbox() {
    const total = { n: 0, m: 0, c: 0, u: 0, bad: 0, msgs: 0 };
    for (let round = 0; round < 40; round++) {
      const r = await api("inbox");
      if (!r.items || !r.items.length) break;
      const kp = await decrypt(r.keys.priv_iv, r.keys.priv_data, st.key);
      const priv = await crypto.subtle.importKey("pkcs8", fromB64(kp.pkcs8), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
      const done = [];
      for (const it of r.items) {
        try {
          const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, fromB64(it.wrapped));
          const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
          const { n, m, c, u } = await hooks.importPayload(await decrypt(it.iv, it.data, aes));
          total.n += n; total.m += m; total.c += c; total.u += u;
        } catch { total.bad++ } // 復号できない・形が違う通は、取り込まずに捨てる
        done.push(it.id); total.msgs++;
      }
      // 取り込みは、先に保存(IndexedDB)してから、受信箱から消す。途中で止まっても、次回の重複除外で二重にならない
      await api("inbox", { method: "DELETE", body: JSON.stringify({ ids: done }) });
      if (!r.more) break;
    }
    return total;
  }

  // ---------- 同期 ----------
  function setStatus(text, err) { const b = $("#syncStatus"); b.hidden = !st; b.textContent = text; b.style.color = err ? "var(--danger)" : "" }
  function schedule() { if (!st) return; clearTimeout(timer); setStatus("☁ 未同期の変更あり"); timer = setTimeout(() => syncNow(), 3000) }

  async function syncNow(manual) {
    if (!st) return;
    if (syncing) { again = true; return }
    syncing = true; clearTimeout(timer); setStatus("☁ 同期中…");
    try {
      let got = 0, sent = 0;
      applying = true;
      for (;;) { // 1) 受信
        const r = await api("records?since=" + st.since);
        for (const rec of r.records) { if (await applyRemote(rec)) got++; st.since = Math.max(st.since, rec.seq) }
        if (!r.more) break;
      }
      let inb = { n: 0, m: 0, c: 0, u: 0, bad: 0, msgs: 0 };
      try { inb = await pullInbox() } catch (e) { if (manual) hooks.toast("受信箱を確認できませんでした: " + e.message) }
      applying = false;
      if (got || inb.n || inb.m || inb.c || inb.u) { hooks.sortAll(); hooks.refresh() }
      if (inb.msgs) { st.inboxLog = { at: Date.now(), msgs: inb.msgs, n: inb.n, m: inb.m, c: inb.c, u: inb.u, bad: inb.bad }; await saveState() } // 前回の受け取り(同期タブに出す)
      if (inb.msgs && !(inb.n || inb.m || inb.c || inb.u || inb.bad)) hooks.toast(`受信箱から ${inb.msgs} 通を受け取りました。新しいものは、ありませんでした(すでに登録済みで、足りない項目もなし)`);
      else if (inb.n || inb.m || inb.c || inb.u || inb.bad)
        hooks.toast(`受信箱から 英文 ${inb.n} / 単語 ${inb.m} / 意味句・IU ${inb.c} を受け取りました${inb.u ? `(${inb.u} 件に、足りない項目を追加)` : ""}${inb.bad ? `(読めなかった ${inb.bad} 通は捨てました)` : ""}`);
      const present = new Set(), out = []; // 2) 送信(前回の同期から変わったものだけ)
      for (const k of Object.keys(KIND)) for (const o of hooks.table(k)) {
        const kk = rk(k, o.id), h = hashOf(o); present.add(kk);
        if (st.hashes[kk] !== h) out.push({ kk, h, rec: { kind: k, id: o.id, ...await encrypt(o, st.key) } });
      }
      for (const kk of Object.keys(st.hashes)) if (!present.has(kk)) { const i = kk.indexOf(":"); out.push({ kk, h: null, rec: { kind: kk.slice(0, i), id: kk.slice(i + 1), deleted: true } }) }
      for (let i = 0; i < out.length; i += 50) {
        const part = out.slice(i, i + 50);
        await api("records", { method: "POST", body: JSON.stringify({ records: part.map(p => p.rec) }) });
        for (const p of part) p.h ? (st.hashes[p.kk] = p.h) : delete st.hashes[p.kk];
        sent += part.length; await saveState();
      }
      st.last = Date.now(); await saveState();
      setStatus("☁ 同期済み " + new Date(st.last).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }));
      if (manual) hooks.toast(`同期しました(受信 ${got} 件・送信 ${sent} 件${inb.msgs ? `・受信箱 ${inb.msgs} 通: 英文 ${inb.n} / 単語 ${inb.m} / 意味句・IU ${inb.c} を追加` : ""})`);
    } catch (e) { setStatus("☁ 同期エラー", true); if (manual) hooks.toast("同期できませんでした: " + e.message) }
    finally { applying = false; syncing = false; if (again) { again = false; schedule() } }
  }

  // ---------- 保管庫の作成・接続 ----------
  // 受信箱の鍵: 公開鍵(RSA-OAEP)と、保管庫の鍵で暗号化した秘密鍵。秘密鍵の中身はサーバーに渡らない
  async function makeInboxKeys(key) {
    const kp = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
    const pub = toB64(new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey)));
    const enc = await encrypt({ pkcs8: toB64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey))) }, key);
    return { inbox_pub: pub, inbox_priv_iv: enc.iv, inbox_priv_data: enc.data };
  }
  async function create(pass, setup) {
    const salt = toB64(crypto.getRandomValues(new Uint8Array(16))), key = await deriveKey(pass, salt), chk = await encrypt(CHECK, key);
    const ib = await makeInboxKeys(key);
    const { token } = await api("vault", { method: "POST", body: JSON.stringify({ salt, check_iv: chk.iv, check_data: chk.data, setup, ...ib }) }, null);
    st = { token, key, since: 0, hashes: {}, last: 0 }; await saveState(); newToken = token;
    await syncNow(true);
  }
  async function join(token, pass) {
    const v = await api("vault", {}, token), key = await deriveKey(pass, v.salt);
    let ok = false; try { ok = (await decrypt(v.check_iv, v.check_data, key)) === CHECK } catch {}
    if (!ok) throw new Error("パスフレーズが違います。");
    st = { token, key, since: 0, hashes: {}, last: 0 }; await saveState();
    history.replaceState(null, "", location.pathname + location.search);
    await syncNow(true);
  }

  // ---------- 画面 ----------
  async function copyText(text, ta) { try { await navigator.clipboard.writeText(text) } catch { ta.select(); document.execCommand("copy") } }

  async function renderInbox() {
    const box = $("#inboxBox"); if (!box) return;
    const title = '<h3>受信箱(Claude などから英文を受け取る)</h3>';
    box.innerHTML = title + '<p class="sub">確認中…</p>';
    let v; try { v = await api("vault") } catch (e) { box.innerHTML = title + `<p class="err">${esc(e.message)}</p>`; return }
    const inb = v.inbox || {};
    if (!inb.enabled) {
      box.innerHTML = title + `<p class="sub">書き込み専用の合言葉で、外から英文を預けられるようにします。預けられた英文は暗号化されていて、中身を読めるのはこの端末だけです。</p>
        <div class="row"><button id="ibOn">受信箱を有効にする</button></div><p class="err" id="ibErr"></p>`;
      $("#ibOn").onclick = async e => {
        e.target.disabled = true;
        try { await api("inbox/setup", { method: "PUT", body: JSON.stringify(await makeInboxKeys(st.key)) }); renderInbox() }
        catch (x) { $("#ibErr").textContent = x.message; e.target.disabled = false }
      }; return;
    }
    box.innerHTML = title + `<p class="sub">受信箱は有効です(合言葉: ${inb.token_set ? "発行済み" : "未発行"})。届いた英文は、この端末が同期するときに受け取って登録します。</p>
      ${inboxBundle ? `<div class="card"><b>受信用の設定(いま1回だけ表示します)</b>
        <textarea readonly id="ibOut" rows="6" style="margin-top:6px;font-family:monospace;font-size:12px">${esc(inboxBundle)}</textarea>
        <div class="row"><button class="pri" id="ibCopy">コピー</button></div>
        <p class="sub">このテキストを、Claude Code を使うフォルダの <code>tools/inbox.json</code> に保存してください(Git には入りません)。合言葉は、英文を預けることしかできません。中身を読むことはできません。</p></div>` : ""}
      <div class="row"><button class="${inb.token_set ? "" : "pri"}" id="ibNew">${inb.token_set ? "合言葉を再発行する" : "受信用の設定を発行する"}</button>
        ${inb.token_set ? '<button id="ibOff">合言葉を無効にする</button>' : ""}</div><p class="err" id="ibErr"></p>`;
    $("#ibNew").onclick = async e => {
      if (inb.token_set && !confirm("合言葉を再発行すると、いまの合言葉は使えなくなります。よろしいですか?")) return;
      e.target.disabled = true;
      try { const t = await api("inbox/token", { method: "POST" }); inboxBundle = JSON.stringify({ url: location.origin, token: t.token, pub: t.pub }, null, 2); renderInbox() }
      catch (x) { $("#ibErr").textContent = x.message; e.target.disabled = false }
    };
    const off = $("#ibOff");
    if (off) off.onclick = async () => {
      if (!confirm("合言葉を無効にします。外から英文を預けられなくなります。よろしいですか?")) return;
      try { await api("inbox/token", { method: "DELETE" }); inboxBundle = null; renderInbox() } catch (x) { $("#ibErr").textContent = x.message }
    };
    const cp = $("#ibCopy");
    if (cp) cp.onclick = () => copyText(inboxBundle, $("#ibOut")).then(() => hooks.toast("コピーしました。tools/inbox.json に保存してください。"));
  }

  function render() {
    const box = $("#syncBox"); if (!box) return;
    if (st) {
      box.innerHTML = `<p class="sub">この端末は同期しています(最終同期: ${st.last ? new Date(st.last).toLocaleString("ja-JP") : "まだ"})。データは暗号化して Cloudflare に保存されます。</p>
        ${st.inboxLog ? `<p class="sub">受信箱から最後に受け取ったとき: ${new Date(st.inboxLog.at).toLocaleString("ja-JP")} ・ ${st.inboxLog.msgs} 通(英文 ${st.inboxLog.n} / 単語 ${st.inboxLog.m} / 意味句・IU ${st.inboxLog.c} を追加、${st.inboxLog.u} 件に足りない項目を追加${st.inboxLog.bad ? `、読めなかった ${st.inboxLog.bad} 通` : ""})</p>` : ""}
        ${newToken ? `<div class="card"><b>同期キー(別の端末で接続するときに必要)</b>
          <input type="text" readonly id="tokOut" value="${esc(newToken)}" style="margin-top:6px;width:100%;font-family:monospace;font-size:12px">
          <p class="sub">パスワード管理アプリなど安全な場所に保管してください。パスフレーズとは別に必要です。</p></div>` : ""}
        <div id="qrBox" hidden style="margin-top:8px;text-align:center"></div>
        <div class="row wrap"><button class="pri" id="sNow">今すぐ同期</button><button id="sQr">スマホで接続(QRコード)</button><button id="sKey">同期キーをコピー</button><button id="sOff" class="danger">この端末の同期を解除</button></div>
        <div id="inboxBox" class="sect"></div>`;
      $("#sNow").onclick = () => syncNow(true).then(render);
      renderInbox();
      $("#sQr").onclick = () => { // 同期キーを URL の # 以降に入れた QR コード(# 以降はサーバーに送られない)
        const qb = $("#qrBox"); if (!qb.hidden) { qb.hidden = true; qb.innerHTML = ""; return }
        const q = qrcode(0, "M"); q.addData(location.origin + location.pathname + "#sync=" + encodeURIComponent(st.token)); q.make();
        qb.innerHTML = `<div style="display:inline-block;background:#fff;padding:8px;border-radius:10px;width:220px">${q.createSvgTag({ cellSize: 4, margin: 8, scalable: true })}</div>
          <p class="sub">スマホのカメラで読み取ると、同期キーが入力された状態でアプリが開きます。あとはパスフレーズを入れるだけです。人に見られない場所で表示してください。</p>`;
        qb.hidden = false;
      };
      $("#sKey").onclick = () => copyText(st.token, $("#tokOut") || $("#sKey")).then(() => hooks.toast("同期キーをコピーしました。安全な場所に保管してください。"));
      $("#sOff").onclick = async () => {
        if (!confirm("この端末の同期を解除しますか?\n(この端末のデータとクラウドのデータは消えません)")) return;
        st = null; newToken = null; inboxBundle = null; await Store.setMeta("sync", null); setStatus(""); render();
      };
      return;
    }
    box.innerHTML = `<p class="sub">英文・単語・意味句・IU を、この端末で暗号化してから Cloudflare に保存し、PC とスマホで共有できます。パスフレーズは送信されないので、Cloudflare 側からも中身は読めません。<b>パスフレーズを忘れると復元できません。</b></p>
      <div class="row"><button class="${form === "new" ? "pri" : ""}" id="sNew">新しく同期を始める</button><button class="${form === "join" ? "pri" : ""}" id="sJoin">同期キーで接続(2台目以降)</button></div>
      ${form === "new" ? `<div class="aiset"><input type="text" id="sSetup" placeholder="セットアップコード(初回のみ)" autocomplete="off" style="font-family:monospace"><input type="password" id="sP1" placeholder="パスフレーズ(12文字以上)" autocomplete="new-password"><input type="password" id="sP2" placeholder="パスフレーズ(確認)" autocomplete="new-password">
        <button class="pri" id="sGo">作成して同期</button></div>` : ""}
      ${form === "join" ? `<div class="aiset"><input type="text" id="sTok" placeholder="同期キー" autocomplete="off" style="font-family:monospace" value="${esc(joinToken)}"><input type="password" id="sP1" placeholder="パスフレーズ" autocomplete="current-password">
        <button class="pri" id="sGo">接続して同期</button></div>` : ""}
      <p class="err" id="sErr"></p>`;
    $("#sNew").onclick = () => { form = "new"; render() };
    $("#sJoin").onclick = () => { form = "join"; render() };
    const go = $("#sGo");
    if (go) go.onclick = async e => {
      const p = $("#sP1").value, err = $("#sErr"); err.textContent = "";
      if (form === "new") { if (p.length < 12) return err.textContent = "パスフレーズは12文字以上にしてください。"; if (p !== $("#sP2").value) return err.textContent = "確認用と一致しません。" }
      const b = e.target; b.disabled = true; b.textContent = "処理中…(数秒かかります)";
      try {
        if (form === "new") await create(p, $("#sSetup").value.trim()); else await join($("#sTok").value.trim(), p);
        form = null; render();
      } catch (x) { err.textContent = x.message; b.disabled = false; b.textContent = form === "new" ? "作成して同期" : "接続して同期" }
    };
  }

  // ---------- 起動 ----------
  return {
    render, syncNow,
    get active() { return !!st },
    get wantsJoin() { return joinToken !== "" },
    async init(h) {
      hooks = h;
      Store.onChange = () => { if (!applying) schedule() };
      try { const s = await Store.getMeta("sync", null); if (s && s.token && s.key) st = s } catch {}
      const m = location.hash.match(/^#sync=([\w.\-%]+)$/); // QR コードで開いたとき: 同期キーを入れた状態にする
      if (m && !st) { joinToken = decodeURIComponent(m[1]); form = "join" }
      setStatus(st ? (st.last ? "☁ 同期済み" : "☁ 未同期") : "");
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && st) syncNow() });
      if (st) syncNow();
    }
  };
})();
