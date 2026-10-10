# eng-study(仮の名前)

TOEIC 対策の英語学習アプリ。英文・意味句・イントネーション・ユニット・単語を、表のように選んで学びます。

試作: [英文構造アナライザー](https://github.com/minnanosaiban/eng-analyzer)(このアプリの元になった、動く試作)

## 状態

作り始めです。まず、**英文だけ**で、登録 → 学習対象選択 → 英文学習を通しました。設計は [docs/design.md](docs/design.md) にあります。

- 登録: サンプル 90 文(API 不要)/ 貼り付け / .csv・.txt・.json
- 学習対象選択: 表で、チェック・ランダム・グループ・絞り込み
- 英文学習: 全文・スラッシュ・区切りの形・品詞の色、IPA・和訳・文法・単語・TOEIC・4択、読み上げ(1回・区切りごと)、ショートカット
- 保存: IndexedDB

まだ無いもの: 意味句・IU・単語の単位、Gemini API・コピペモード・受信箱、クラウド同期、シャドーイング・聞き取り、記録と復習の集計。

試すには、`public/` を、静的サーバーで開きます(例: `python -m http.server -d public`)。

## フォルダ

```
docs/         設計メモ
public/       アプリ本体(index.html、style.css、js/、samples/)
src/          同期 API(Worker)(まだ空)
migrations/   D1 のテーブル定義(まだ空)
tools/        受信箱などの道具(まだ空)
```

## ライセンス

[MIT License](LICENSE)
