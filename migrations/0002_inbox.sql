-- 受信箱: 外部(Claude Code など)が、書き込み専用の合言葉で英文を預けられるようにする。
-- 公開鍵で暗号化された状態で届くので、サーバーは中身を読めない。復号できるのは、パスフレーズを知る端末だけ。
ALTER TABLE vaults ADD COLUMN inbox_pub TEXT;       -- RSA-OAEP の公開鍵(SPKI を base64)。公開してよい値
ALTER TABLE vaults ADD COLUMN inbox_priv_iv TEXT;   -- 秘密鍵(PKCS8)を保管庫の鍵で暗号化したもの
ALTER TABLE vaults ADD COLUMN inbox_priv_data TEXT;
ALTER TABLE vaults ADD COLUMN inbox_hash TEXT;      -- 書き込み専用の合言葉の SHA-256。NULL なら受信箱は閉じている

CREATE TABLE inbox (
  vault TEXT NOT NULL,
  id TEXT NOT NULL,
  wrapped TEXT NOT NULL,   -- 1通ごとの AES 鍵を、公開鍵で包んだもの
  iv TEXT NOT NULL,
  data TEXT NOT NULL,      -- AES-GCM で暗号化した本文
  created_at INTEGER NOT NULL,
  PRIMARY KEY (vault, id)
);
CREATE INDEX inbox_vault ON inbox (vault, created_at);
