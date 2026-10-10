-- 同期用の保管庫(1つ = 1人分)。秘密鍵は SHA-256 のハッシュだけを保存する
CREATE TABLE vaults (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  salt TEXT NOT NULL,      -- 暗号鍵導出用のソルト(公開してよい値)
  check_iv TEXT NOT NULL,  -- パスフレーズ確認用の暗号文
  check_data TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- 英文・単語・意味句とIU。中身(data)は端末側で AES-GCM 暗号化済み
CREATE TABLE records (
  vault TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  iv TEXT,
  data TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  PRIMARY KEY (vault, kind, id)
);
CREATE INDEX records_seq ON records (vault, seq);
