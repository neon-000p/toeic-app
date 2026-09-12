# 教材データ スキーマ v1

アプリが読むのは **JSON だけ**。JS コードは生成しない。
壊れた JSON はそのパックが読めないだけで済み、アプリ本体は動き続ける。

```
data/
  news/
    index.json          目次（新しい順・最大30件）
    2026-09-12.json     1日分の教材
  part3/
    index.json
    p3-001.json
```

`index.json` と個別ファイルは別々のルーティンが更新する（時事英語 / Part 3 は独立運用）。
ディレクトリが分かれているので、片方のルーティンが失敗してももう片方に影響しない。

---

## data/news/index.json

```json
{
  "schemaVersion": 1,
  "type": "news",
  "updatedAt": "2026-09-12T07:12:00+09:00",
  "items": [
    {
      "id": "2026-09-12",
      "date": "2026-09-12",
      "genre": "物流",
      "title": "港湾の遅延、荷主に在庫戦略の見直しを迫る",
      "file": "2026-09-12.json"
    }
  ]
}
```

- `items` は **新しい順**。先頭がその日の教材。
- `file` は `data/news/` からの相対パス。
- 31件目以降は配列から削除する（ファイル自体は消さない。URL 直打ちで読める）。
- `genre` は10種で統一（テクノロジー／地政学／金融／企業決算／雇用・人事／物流／小売・消費／エネルギー／医療／宇宙）。
  将来ジャンル重複判定を Notion からこの index に移す場合、ここを読めば済むようにしてある。

---

## data/news/YYYY-MM-DD.json

```json
{
  "schemaVersion": 1,
  "type": "news",
  "id": "2026-09-12",
  "date": "2026-09-12",
  "createdAt": "2026-09-12T07:10:00+09:00",
  "genre": "物流",
  "genreEn": "Logistics",
  "sample": false,

  "title": { "en": "Port Delays Push Shippers to Rethink Inventory",
             "ja": "港湾の遅延、荷主に在庫戦略の見直しを迫る" },

  "summary": {
    "paragraphs": [
      { "role": "what",  "sentences": [ { "en": "...", "ja": "..." } ] },
      { "role": "why",   "sentences": [ { "en": "...", "ja": "..." } ] }
    ]
  },

  "questions": [
    {
      "id": "q1",
      "type": "detail",
      "prompt": "How long do ships now wait on average?",
      "choices": [ { "key": "A", "text": "Two days" } ],
      "answer": "C",
      "explanation": "日本語解説。正解の根拠と誤答がなぜ誤りかを書く。",
      "evidence": { "p": 0, "s": 0 },
      "tip": "TOEIC Part 7 の解法ポイント（1〜2文）"
    }
  ],

  "vocabulary": [
    {
      "no": 1,
      "term": "freight",
      "pos": "名",
      "ja": "貨物、運送",
      "gloss": "（＝まとめて運ばれる荷物のこと）",
      "example": { "en": "The freight will arrive on Friday.", "ja": "その貨物は金曜に到着する。" }
    }
  ],

  "glossary": {
    "inventories": { "lemma": "inventory", "pos": "n", "ja": "在庫", "note": "" }
  },

  "grammar": {
    "topic": "関係代名詞 which の非制限用法（前の文全体を受ける）",
    "quote": "The delays are forcing retailers to hold larger inventories, which raises warehouse costs.",
    "quoteJa": "この遅延により小売各社はより多くの在庫を抱えざるを得ず、それが倉庫費用を押し上げている。",
    "blocks": [ { "heading": "構文", "body": "..." } ]
  },

  "background": [ { "heading": "📌 業界の構図", "body": "..." } ],

  "sources": [
    { "title": "記事タイトル", "publisher": "媒体名", "url": "https://...", "date": "2026-09-11" }
  ]
}
```

### 設計上の要点

**`summary` は段落 → 文の二段構造**
Markdown 版は段落まるごとの訳だが、JSON は **文単位で英日を対応**させる。これで対訳トグル、文ごとの読み上げ、根拠文ハイライトの3つが同じデータで成立する。文境界を無理に揃えて訳が不自然になる場合は、意味のまとまりを優先してよい（1文の `ja` に次文の内容が混ざるのは避ける）。

**`evidence` は段落番号＋文番号**
`{"p":1,"s":2}` は「2段落目の3文目」。解答画面で該当文をマスタード地でハイライトする。根拠が本文にない設問は作らない。

**`glossary` のキーは本文の表層形（小文字化）**
`inventories` のように活用・複数形のまま入れる。原形に戻す処理をアプリ側に持たせると誤爆するため、生成時に本文を見て素直に並べるほうが確実。原形は `lemma` に持つ。
収録範囲は **Summary に実際に出てくる語のうち、TOEIC 600点前後の学習者が意味を確認したくなるもの 20〜30語**。ここが厚いほど、本文を読みながら辞書を引きに行く必要がなくなる。

**`vocabulary` と `glossary` は役割が違う**
`vocabulary` は「覚える8語」（例文・品詞つき、語彙帳の対象）。`glossary` は「詰まらないための語注」（タップで出るだけ）。8語は両方に入ってよい。

**`type` と `schemaVersion`**
将来 Part 4〜7 を足すとき、`type` で描画を分岐する。スキーマを壊す変更をしたときだけ `schemaVersion` を上げ、アプリは古い版も読めるようにする。

**`sample`**
`true` のときアプリが「サンプル」バッジを出す。実ニュース由来の教材では必ず `false`。

**`sources`**
出典を残す。著作権上、本文は要約・書き下ろしであり原文の転載ではないという前提を保つためにも、元記事へのリンクは持っておく。
