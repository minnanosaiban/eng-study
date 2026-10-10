// 英語学習: クラウド同期 API・受信箱
// - 静的ファイルは assets から配信し、/api/* だけこの Worker が処理する
// - データは端末側で暗号化済み。サーバーは暗号文を保存・返却するだけで中身は読めない
// - 認証は同期キー "保管庫ID.秘密" を Authorization: Bearer で送る。秘密は SHA-256 で照合

const MAX_BODY = 8 * 1024 * 1024;
const PAGE = 300;
const KINDS = new Set(["sentence", "word", "chunk"]);
// 受信箱の上限(書き込み専用の合言葉が漏れても、荒らされにくくする)
const INBOX_MAX_BODY = 1_500_000;     // 1通の大きさ
const INBOX_MAX_MESSAGES = 200;       // たまる通数
const INBOX_MAX_BYTES = 20_000_000;   // たまる合計の大きさ
const INBOX_PAGE = 5;                 // 1回に返す通数

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const fail = (status, message) => json({ error: message }, status);

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameHex(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y);
}

async function readJson(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY) throw new Error("too large");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error("too large");
  return JSON.parse(text);
}

async function auth(request, env) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer ([\w-]{8,64})\.([\w-]{20,128})$/);
  if (!m) return null;
  const v = await env.DB.prepare("SELECT * FROM vaults WHERE id = ?").bind(m[1]).first();
  if (!v || !sameHex(await sha256hex(m[2]), v.key_hash)) return null;
  return v;
}

const isStr = (s, max) => typeof s === "string" && s.length > 0 && s.length <= max;

async function createVault(request, env) {
  const body = await readJson(request);
  if (!isStr(body.salt, 64) || !isStr(body.check_iv, 64) || !isStr(body.check_data, 512)) return fail(400, "bad request");
  // 公開 URL なので、持ち主以外が先に作成できないようセットアップコードを要求する
  if (env.SETUP_CODE && !(typeof body.setup === "string" && sameHex(await sha256hex(body.setup), await sha256hex(env.SETUP_CODE))))
    return fail(403, "セットアップコードが正しくありません。");
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM vaults").first();
  if (n >= Number(env.MAX_VAULTS || 1)) return fail(403, "このサーバーでは新しい同期を作成できません(作成済みです)。");
  const ib = inboxKeys(body);
  if (ib === false) return fail(400, "bad inbox keys");
  const id = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO vaults (id, key_hash, salt, check_iv, check_data, seq, created_at, inbox_pub, inbox_priv_iv, inbox_priv_data) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)")
    .bind(id, await sha256hex(secret), body.salt, body.check_iv, body.check_data, Date.now(), ib?.pub ?? null, ib?.iv ?? null, ib?.data ?? null).run();
  return json({ token: `${id}.${secret}` }, 201);
}

// 受信箱の鍵(公開鍵と、暗号化した秘密鍵)の検査。無ければ null、不正なら false
function inboxKeys(body) {
  if (body.inbox_pub === undefined && body.inbox_priv_data === undefined) return null;
  if (!isStr(body.inbox_pub, 1000) || !isStr(body.inbox_priv_iv, 64) || !isStr(body.inbox_priv_data, 8000)) return false;
  return { pub: body.inbox_pub, iv: body.inbox_priv_iv, data: body.inbox_priv_data };
}

// 書き込み専用の合言葉("保管庫ID.秘密")で本人確認する。同期キーとは別物で、読み出しはできない
async function authInbox(request, env) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer ([\w-]{8,64})\.([\w-]{20,128})$/);
  if (!m) return null;
  const v = await env.DB.prepare("SELECT id, inbox_hash FROM vaults WHERE id = ?").bind(m[1]).first();
  if (!v || !v.inbox_hash || !sameHex(await sha256hex(m[2]), v.inbox_hash)) return null;
  return v;
}

async function inboxPost(request, env, v) {
  if (Number(request.headers.get("content-length") || 0) > INBOX_MAX_BODY) return fail(413, "1通が大きすぎます。");
  const body = await readJson(request);
  if (!isStr(body.wrapped, 1024) || !isStr(body.iv, 64) || !isStr(body.data, 1_100_000)) return fail(400, "bad request");
  const { n, b } = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(length(data)), 0) AS b FROM inbox WHERE vault = ?").bind(v.id).first();
  if (n >= INBOX_MAX_MESSAGES || b + body.data.length > INBOX_MAX_BYTES)
    return fail(429, "受信箱がいっぱいです。アプリを開いて同期し、受け取ってからもう一度送ってください。");
  const id = b64url(crypto.getRandomValues(new Uint8Array(12)));
  await env.DB.prepare("INSERT INTO inbox (vault, id, wrapped, iv, data, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(v.id, id, body.wrapped, body.iv, body.data, Date.now()).run();
  return json({ id }, 201);
}

async function inboxList(env, v) {
  if (!v.inbox_pub) return json({ items: [], more: false });
  const { results } = await env.DB.prepare("SELECT id, wrapped, iv, data FROM inbox WHERE vault = ? ORDER BY created_at, id LIMIT ?")
    .bind(v.id, INBOX_PAGE + 1).all();
  const items = results.slice(0, INBOX_PAGE);
  return json({ items, more: results.length > INBOX_PAGE, keys: items.length ? { priv_iv: v.inbox_priv_iv, priv_data: v.inbox_priv_data } : null });
}

async function inboxDelete(request, env, v) {
  const body = await readJson(request);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => isStr(x, 64)).slice(0, 50) : [];
  if (!ids.length) return fail(400, "ids required");
  const stmt = env.DB.prepare("DELETE FROM inbox WHERE vault = ? AND id = ?");
  await env.DB.batch(ids.map((id) => stmt.bind(v.id, id)));
  return json({ deleted: ids.length });
}

async function inboxSetup(request, env, v) {
  if (v.inbox_pub) return fail(409, "受信箱はすでに有効です。");
  const ib = inboxKeys(await readJson(request));
  if (!ib) return fail(400, "bad inbox keys");
  await env.DB.prepare("UPDATE vaults SET inbox_pub = ?, inbox_priv_iv = ?, inbox_priv_data = ? WHERE id = ? AND inbox_pub IS NULL")
    .bind(ib.pub, ib.iv, ib.data, v.id).run();
  return json({ ok: true });
}

async function inboxToken(env, v) {
  if (!v.inbox_pub) return fail(409, "先に受信箱を有効にしてください。");
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("UPDATE vaults SET inbox_hash = ? WHERE id = ?").bind(await sha256hex(secret), v.id).run();
  return json({ token: `${v.id}.${secret}`, pub: v.inbox_pub }, 201);
}

async function pull(url, env, v) {
  const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
  const { results } = await env.DB.prepare(
    "SELECT kind, id, iv, data, deleted, seq FROM records WHERE vault = ? AND seq > ? ORDER BY seq LIMIT ?"
  ).bind(v.id, since, PAGE + 1).all();
  // 1回の送信(push)で送られた行は、同じ seq を持つ。ページの区切りが、その途中に来ると、続きの行を、次の取得(seq > since)で飛ばしてしまう。
  // そこで、区切りの先頭の行と同じ seq の行は、このページに入れず、次のページに回す(1回の送信は 200 行までで、ページ(300行)より小さい)
  if (results.length <= PAGE) return json({ records: results, more: false });
  const cut = results[PAGE].seq;
  return json({ records: results.filter((r) => r.seq < cut), more: true });
}

async function push(request, env, v) {
  const body = await readJson(request);
  const recs = Array.isArray(body.records) ? body.records : [];
  if (!recs.length || recs.length > 200) return fail(400, "records must be 1..200");
  for (const r of recs) {
    if (!KINDS.has(r.kind) || !isStr(r.id, 64)) return fail(400, "bad record");
    if (!r.deleted && (!isStr(r.iv, 64) || !isStr(r.data, 2_000_000))) return fail(400, "bad record data");
  }
  // 保管庫の通し番号を進め、この送信分すべてに同じ番号を付ける
  const { seq } = await env.DB.prepare("UPDATE vaults SET seq = seq + 1 WHERE id = ? RETURNING seq").bind(v.id).first();
  const stmt = env.DB.prepare(
    `INSERT INTO records (vault, kind, id, iv, data, deleted, seq) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (vault, kind, id) DO UPDATE SET iv = excluded.iv, data = excluded.data, deleted = excluded.deleted, seq = excluded.seq`
  );
  await env.DB.batch(recs.map((r) => stmt.bind(v.id, r.kind, r.id, r.deleted ? null : r.iv, r.deleted ? null : r.data, r.deleted ? 1 : 0, seq)));
  return json({ seq });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(request) : fail(404, "not found");
    try {
      if (url.pathname === "/api/vault" && request.method === "POST") return await createVault(request, env);
      // 受信箱への書き込みだけは、書き込み専用の合言葉で受け付ける(同期キーでは通らない)
      if (url.pathname === "/api/inbox" && request.method === "POST") {
        const iv = await authInbox(request, env);
        if (!iv) return fail(401, "受信箱の合言葉が正しくありません。");
        return await inboxPost(request, env, iv);
      }
      const v = await auth(request, env);
      if (!v) return fail(401, "同期キーが正しくありません。");
      if (url.pathname === "/api/vault" && request.method === "GET")
        return json({ salt: v.salt, check_iv: v.check_iv, check_data: v.check_data, seq: v.seq,
          inbox: { enabled: !!v.inbox_pub, token_set: !!v.inbox_hash, pub: v.inbox_pub || null } });
      if (url.pathname === "/api/inbox" && request.method === "GET") return await inboxList(env, v);
      if (url.pathname === "/api/inbox" && request.method === "DELETE") return await inboxDelete(request, env, v);
      if (url.pathname === "/api/inbox/setup" && request.method === "PUT") return await inboxSetup(request, env, v);
      if (url.pathname === "/api/inbox/token" && request.method === "POST") return await inboxToken(env, v);
      if (url.pathname === "/api/inbox/token" && request.method === "DELETE") {
        await env.DB.prepare("UPDATE vaults SET inbox_hash = NULL WHERE id = ?").bind(v.id).run();
        return json({ ok: true });
      }
      if (url.pathname === "/api/records" && request.method === "GET") return await pull(url, env, v);
      if (url.pathname === "/api/records" && request.method === "POST") return await push(request, env, v);
      return fail(404, "not found");
    } catch (e) {
      return fail(e.message === "too large" ? 413 : 400, "リクエストを処理できませんでした。");
    }
  },
};
