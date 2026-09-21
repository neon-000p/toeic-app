# 教材データ スキーマ v1

アプリが読むのは **JSON だけ**。JS コードは生成しない。
壊れた JSON はそのパックが読めないだけで済み、アプリ本体は動き続ける。

```
data/
  news/
    index.json              目次（新しい順・最大30件）
    history.json            ジャンル／文法トピックの重複判定用の履歴（消さない）
    2026-09-12-0530.json    1本分の教材（id と同名）
  part3/
    index.json
    p3-001.json
  part4/
    index.json
    history.json
    2026-09-17-0901-1.json
  part5/
    index.json
    history.json
    2026-09-18-1258-1.json
  part6/
    index.json
    history.json
    2026-09-18-1637-1.json
  part7/
    index.json
    history.json
    2026-09-21-0957-1.json
```

`index.json` と個別ファイルは別々のルーティンが更新する（時事英語 / Part 3〜7 は独立運用）。
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
      "id": "2026-09-12-0530",
      "date": "2026-09-12",
      "time": "05:30",
      "genre": "物流",
      "title": "港湾の遅延、荷主に在庫戦略の見直しを迫る",
      "file": "2026-09-12-0530.json"
    }
  ]
}
```

- `items` は **`id` の降順**（＝新しい順）。ルーティンは1日2回（JST 5:30 と 16:30）走るため、`id` に時刻まで含めて同日の2本を区別する。
- `file` は `data/news/` からの相対パス。
- 31件目以降は配列から削除する（ファイル自体は消さない。URL 直打ちで読める）。
- `genre` は10種で統一（テクノロジー／地政学／金融／企業決算／雇用・人事／物流／小売・消費／エネルギー／医療／宇宙）。
  将来ジャンル重複判定を Notion からこの index に移す場合、ここを読めば済むようにしてある。

---

## data/news/history.json

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-09-12T12:00:00+09:00",
  "items": [
    { "date": "2026-09-12", "seq": 2, "genre": "物流", "grammar": "関係代名詞 which の非制限用法" }
  ]
}
```

スキルがジャンルの重複（直近3件・直近5件・直近8件のルール）と文法トピックの重複を判定するためだけに読む。アプリはこのファイルを見ない。

**index.json と分けている理由**: index.json は「アプリが開ける教材」の目次なので、実体ファイルの無い項目を混ぜられないし、30件で切り捨てる。一方こちらは判定材料なので、実体が無くても構わないし、消さずに貯め続けたい。役割が違うので別ファイルにしてある。

もともとこの判定は Notion の見出しページを読んでいたが、Notion への依存を切るためリポジトリへ移した（2026-09-12 に過去30件を移設）。

---

## data/news/&lt;id&gt;.json

```json
{
  "schemaVersion": 1,
  "type": "news",
  "id": "2026-09-12-0530",
  "date": "2026-09-12",
  "time": "05:30",
  "createdAt": "2026-09-12T05:30:00+09:00",
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
      "choices": [ { "key": "A", "text": "Two days", "ja": "2日" } ],
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

---

**`audio` は先に作っておいた本文の読み上げ音声**

```json
"audio": {
  "lines": ["audio/2026-09-13-0540/00.mp3", "audio/2026-09-13-0540/01.mp3"],
  "voice": "Leda",
  "bytes": 348120
}
```

**ルーティンはこれを書かない。** GitHub Actions が教材を main で見つけたあとに作り、`audio` を足して自分でコミットする。

`lines` は **`summary.paragraphs` を段落またぎでつないだ順**で、アプリの `data-i` と同じ添字。ここがずれると、タップした文と鳴る音声が食い違う。まるごと1本のファイルは作らない（順に鳴らせば同じで、頭出しも要らないため）。

アプリは `audio.lines[i]` があればそれを鳴らし、無ければ端末の読み上げに落ちる。音声待ちの教材でも学習は止まらない。

## 保存期間

音声を持つと容量が増えるので、置いておく量に上限を決めている（`tools/prune.js`、毎朝の Actions で実行）。

| | 残す量 |
|---|---|
| 時事英語 `data/news/` | 直近1年ぶん |
| 各パート `data/part3/` など | 新しいほうから100本 |

消すのは教材の JSON・音声・`index.json` の項目。**`history.json` は消さない**（ジャンルや場面の重複判定に使うため、削ると同じ題材が続けて出るようになる）。

## data/part3/&lt;id&gt;.json

Part 3（会話問題）。**1ファイル＝1セット＝1回分**。会話1本と設問3問で、本番の1セットと同じ単位。通勤の片道で1回、という想定。

```json
{
  "schemaVersion": 1,
  "type": "part3",
  "id": "2026-09-13-0530",
  "date": "2026-09-13",
  "time": "05:30",
  "scene": "オフィス｜出張の宿泊手配",
  "speakers": [
    { "tag": "M", "role": "男性", "accent": "en-US" },
    { "tag": "W", "role": "女性", "accent": "en-GB" }
  ],
  "lines": [
    { "tag": "M", "en": "...", "ja": "..." }
  ],
  "questions": [
    {
      "id": "q1",
      "type": "gist",
      "prompt": "What are the speakers mainly discussing?",
      "choices": [ { "key": "A", "text": "...", "ja": "選択肢の訳" } ],
      "answer": "B",
      "evidence": [0, 1],
      "explanation": "日本語解説",
      "tip": "Part 3 の聞き方。Point ステップに出る"
    }
  ],
  "audio": { "file": "audio/2026-09-13-0530.mp3", "sec": 42.3, "lines": ["audio/2026-09-13-0530/00.mp3"] },
  "glossary": { "commute": { "lemma": "commute", "pos": "n", "ja": "通勤", "note": "" } },
  "point": { "flow": "会話の展開を1行で", "items": [ { "title": "見出し", "body": "本文" } ] }
}
```

### 設計上の要点

**`speakers[].tag` と `lines[].tag` で話者を結ぶ**
`M` / `W` / `M2` / `W2` の4種。アプリは tag ごとに別の声を割り当てる。`accent`（`en-US` / `en-GB` / `en-AU` / `en-CA`）を手がかりに声を選び、名前から性別が分からない端末では声の高さで作り分ける。TOEIC が4か国の発音を混ぜるので、データ側でもそこに寄せる。

**`scene` は解き終わるまで出さない**
何の話かを先に知ると先読みの練習にならない。アプリは解説ステップ以降でだけ表示する。

**`evidence` は行番号の配列**
`lines` の添字（0始まり）。解説では該当行をそのまま引用し、対訳では左に線が入る。1問が複数行にまたがるので配列。

**`type` は6種**
`gist`（概要）／`detail`（詳細）／`intent`（意図）／`next`（次の行動）／`infer`（推測）／`graphic`（図表）。画面に型を出すので必ず入れる。

**`choices[].ja` は選択肢の訳**
解説ステップで英文の下に小さく出す。20字以内を目安に、意訳しすぎず意味が分かる程度に。誤答がなぜ誤りかを読むとき、英語のまま並べられるより速く判断できる。時事英語の設問にも同じ項目を持たせる。

**`point` は Point ステップの中身（セット全体の総括）**

```json
"point": {
  "flow": "問題の発生 → 原因の切り分け → 代替案 → 制約による却下 → 保留と分担",
  "items": [
    { "title": "短い見出し", "body": "次のセットで再現できる手順として書く" }
  ]
}
```

`flow` はこの会話の展開を矢印でつないだ1行。同じ型に次に出会ったとき、設問の順番まで予測できるようにするためのもの。

`items` は2〜3項目。**設問ごとの注意ではなく、セット全体を貫く聞き方**を書く。「2案が出たら聞くべき3点が決まる」「3人会話には突き合わせの設問が入る」のように、会話の内容から離れても使える形にする。設問1問だけに閉じた話は `questions[].tip` 側に書き、ここには入れない。

**`questions[].tip` は設問ごとの聞き方**
解説ステップで、その設問の解説の下に出る。1問の中で閉じた話（この選択肢の引っかけ方、この根拠の探し方）はこちらに書く。

**`glossary`**
その会話に出てくる語だけ。語彙ステップの一覧と、対訳での語タップに使う。キーは本文の表層形を小文字化したもの。

**`audio` は先に作っておいた会話音声**

```json
"audio": {
  "file": "audio/2026-09-13-0530.mp3",
  "sec": 42.3,
  "bytes": 254011,
  "model": "gemini-3.1-flash-tts-preview",
  "madeAt": "2026-09-13T05:40:11.000Z"
}
```

**ルーティンはこれを書かない。** GitHub Actions（`.github/workflows/part3-audio.yml`）が、セットが main に入ったあとで音声を作り、この `audio` を足して自分でコミットする。ルーティンが書いた JSON に `audio` が無いのは正常。

`lines` は対訳で1文だけ鳴らすための音声で、行と同じ順に並ぶ（`audio/<id>/00.mp3` から）。会話本体は流れを保つため2人ずつのかたまりで作り、行ごとの音声は別に作る。**同じ声を使うので、対訳に移った瞬間に声が変わらない。**

アプリは `audio.file` があればそれを鳴らし、無ければ端末の読み上げに落ちる。対訳も同じで、`audio.lines[i]` があればそれを、無ければ読み上げを使う。ファイルが 404 でも読み上げに戻るので、音声待ちのセットでも学習は止まらない。パスは `data/part3/` からの相対。

音声があるときは「誰が話しているか」の印を追えないので、画面には残り秒のバーを出す。設問の読み上げ（"Question 1. …"）は端末の読み上げのまま。間の秒数を ⚙ で変えられるようにしておきたいため。

`sec` は再生前に残り秒を出すために使う。`bytes` と `madeAt` は容量と作り直しの判断用。

音声の作り方（MP3・モノラル 24kHz・48kbps）は `tools/make-audio.js` にある。1回の呼び出しで指定できる声は2人までなので、3人の会話は「同時に出てくる話者が2人まで」のかたまりに切って作り、つないでいる。

### data/part3/index.json

```json
{
  "schemaVersion": 1,
  "type": "part3",
  "updatedAt": "2026-09-13T05:32:00+09:00",
  "items": [
    { "id": "2026-09-13-0530", "date": "2026-09-13", "time": "05:30", "speakers": 2, "file": "2026-09-13-0530.json" }
  ]
}
```

`scene` は index に入れない。一覧で場面が見えると先読みの意味が薄れるため。

時事英語と**別ディレクトリ・別ルーティン**で運用する。片方が失敗しても、もう片方に影響しない。

---

## data/part4/&lt;id&gt;.json

Part 4（説明文問題）。**1ファイル＝1セット＝1回分**。1人が話すトーク1本と設問3問で、本番の1セットと同じ単位。

Part 3 との違いは3つ。**話し手が1人**なので `speakers`（配列）ではなく `speaker`（1人）を持つ。**`lines` に `tag` が無い**（文の並びがそのまま読み上げ順）。そして本番でトークの前に読まれる**前置き（`intro`）**を持つ。

```json
{
  "schemaVersion": 1,
  "type": "part4",
  "id": "2026-09-17-0901-1",
  "date": "2026-09-17",
  "time": "09:01",
  "scene": "留守番電話｜納品の遅れと代替案",
  "talkType": "voicemail",
  "intro": "Questions 1 through 3 refer to the following telephone message.",
  "speaker": { "tag": "M", "role": "男性", "accent": "en-US" },
  "lines": [
    { "en": "...", "ja": "..." }
  ],
  "questions": [
    {
      "id": "q1",
      "type": "gist",
      "prompt": "Why is the speaker calling?",
      "choices": [ { "key": "A", "text": "...", "ja": "選択肢の訳" } ],
      "answer": "B",
      "evidence": [0, 1],
      "explanation": "日本語解説",
      "tip": "Part 4 の聞き方。解説ステップに出る"
    }
  ],
  "audio": { "file": "audio/2026-09-17-0901-1.mp3", "sec": 48.2, "lines": ["audio/2026-09-17-0901-1/00.mp3"] },
  "glossary": { "held up": { "lemma": "hold up", "pos": "熟", "ja": "遅れる、滞る", "note": "delay の言い換え" } },
  "point": { "flow": "トークの展開を1行で", "items": [ { "title": "見出し", "body": "本文" } ] }
}
```

### 設計上の要点

**`talkType` は9種、`intro` はその決まり文句**
`announcement` / `voicemail` / `speech` / `broadcast` / `ad` / `tour` / `instructions` / `meeting` / `talk`。
`intro` は `Questions 1 through 3 refer to the following <言い回し>.` の形で、種類ごとに言い回しが決まっている（`voicemail` なら `telephone message`）。食い違うと `tools/check-part4.js` が止める。

**`intro` は伏せない**
`scene`（場面）は解き終わるまで出さないが、`intro` は設問ステップに最初から出す。本番でもトークの前に必ず読み上げられるものであり、「何を聞くか」だけが先に分かるのは本番と同じ条件だから。音声も前置き → 0.8秒の間 → トーク本体の順に入っている。

**`speaker` は1人**
`{ tag, role, accent }`。`tag` は `M` か `W`。`accent`（`en-US` / `en-GB` / `en-AU` / `en-CA`）を手がかりに端末の声を選ぶ。**`speakers`（複数形）を書いてはならない**（Part 3 のデータを流用した取り違えを機械の確認で弾くため）。

**`lines` は文単位。`tag` を持たない**
アプリは対訳で左に**文番号**を出す。解説で引用された文を、対訳の中から探せるようにするためのもの。

**`evidence` は文番号の配列**
`lines` の添字（0始まり）。`intent`（意図）の設問では、引用した文とその直前の文を入れる。意図は直前の文脈で決まるため。

**`questions[].type` は6種**
`gist`（概要）／`who`（話し手・聞き手）／`detail`（詳細）／`intent`（意図）／`next`（次の行動）／`infer`（推測）。
**1問目は `gist` か `who`。** 本番の Part 4 は「何の話か・誰の話か」から始まる。

**`audio` は先に作っておいたトーク音声**

```json
"audio": {
  "file": "audio/2026-09-17-0901-1.mp3",
  "sec": 48.2,
  "bytes": 291044,
  "lines": ["audio/2026-09-17-0901-1/00.mp3"],
  "voice": "Puck",
  "narrator": "Charon",
  "model": "gemini-3.1-flash-tts-preview",
  "madeAt": "2026-09-17T09:40:11.000Z"
}
```

**ルーティンはこれを書かない。** GitHub Actions（`.github/workflows/part3-audio.yml`）が、セットが main に入ったあとで `tools/make-part4-audio.js` を走らせて作り、この `audio` を足して自分でコミットする。

話し手が1人なので、トーク本体は**1回の呼び出しで全文**を作れる（Part 3 は2人ずつのかたまりに切る必要がある）。前置きだけは別の声（ナレーター）で作り、0.8秒の無音を挟んで頭に繋ぐ。`lines` は対訳で1文だけ鳴らすための音声で、文と同じ順に並ぶ（`audio/<id>/00.mp3` から）。**トーク本体と同じ声を使うので、対訳に移った瞬間に声が変わらない。**

アプリは `audio.file` があればそれを鳴らし、無ければ端末の読み上げに落ちる（そのときは前置きも読み上げてからトークに入る）。ファイルが 404 でも読み上げに戻るので、音声待ちのセットでも学習は止まらない。パスは `data/part4/` からの相対。

### data/part4/index.json

```json
{
  "schemaVersion": 1,
  "type": "part4",
  "updatedAt": "2026-09-17T09:01:00+09:00",
  "items": [
    { "id": "2026-09-17-0901-1", "no": 1, "date": "2026-09-17", "time": "09:01",
      "talkType": "voicemail", "kind": "留守番電話", "questions": 3, "file": "2026-09-17-0901-1.json" }
  ]
}
```

`kind` は一覧に出す種類の日本語。`scene` は index に入れない（一覧で場面が見えると先読みの意味が薄れる）。種類は本番でも前置きで告げられるので、一覧に出してよい。

### data/part4/history.json

```json
{ "id": "2026-09-17-0901-1", "date": "2026-09-17", "scene": "留守番電話｜納品の遅れと代替案",
  "genre": "留守番電話", "talkType": "voicemail", "types": ["gist", "detail", "next"], "flow": "問題と代替案" }
```

スキルが場面・種類の重複を判定するためだけに読む。アプリはこのファイルを見ない。**消さずに貯め続ける。**

---

## data/part5/&lt;id&gt;.json

Part 5（短文穴埋め）。**1ファイル＝1セット＝10問**。音声が無く、1問が1文で完結するので、Part 3・Part 4 とは単位が違う。10問で約3分20秒（本番の目安は1問20秒）。

```json
{
  "schemaVersion": 1,
  "type": "part5",
  "id": "2026-09-18-1258-1",
  "date": "2026-09-18",
  "time": "12:58",
  "sample": false,
  "focus": "文法7・語彙3",
  "questions": [
    {
      "id": "q1",
      "type": "form",
      "prompt": "All visitors must ------- their badges at the front desk before entering the laboratory.",
      "choices": [
        { "key": "A", "text": "collect", "ja": "受け取る" },
        { "key": "B", "text": "collection", "ja": "（名）回収" },
        { "key": "C", "text": "collective", "ja": "（形）集団の" },
        { "key": "D", "text": "collectively", "ja": "（副）まとめて" }
      ],
      "answer": "A",
      "ja": "来訪者は全員、研究所に入る前に受付でバッジを受け取らなければならない。",
      "explanation": "日本語解説",
      "tip": "この型の見分け方"
    }
  ],
  "glossary": { "in advance": { "lemma": "in advance", "pos": "熟", "ja": "前もって", "note": "" } },
  "point": { "lead": "解き方を1行で", "items": [ { "title": "見出し", "body": "本文" } ] }
}
```

### 設計上の要点

**空所は `-------`（ハイフン7つ）**
アプリは `-{4,}` の並びを見つけて下線に差し替える。解説ステップでは、同じ場所に正解の語を緑で埋めた文を出す。**1文に1か所だけ**。

**`type` は8種**
`form`（品詞）／`verb`（動詞の形）／`verbal`（準動詞）／`prep`（前置詞）／`conj`（接続詞）／`pron`（代名詞・関係詞）／`comp`（比較・数量）／`vocab`（語彙）。
1セットは**文法6〜7問・語彙3〜4問**、`form` は2問。**Part 5 は選択肢を見た瞬間に型が決まる**のが要なので、型は解説ステップにだけ出す。

**`ja` は設問ごとの全文訳**
空所を正解で埋めた状態の訳。Part 3・Part 4 の `lines[].ja` にあたる。

**`focus` は「文法N・語彙M」**
`index.json` の `kind` と同じ文字列にする。一覧の見出しになり、`tools/check-part5.js` が実際の配分と突き合わせる。

**`audio` は持たない**
Part 5 の読み上げは、端末（Chrome / Edge）の読み上げに任せる。1文が短く、答え合わせのあとに正しい形を確かめるためのものなので、あらかじめ作っておく必要がない。声と速さは ⚙ で選べる。

アプリは解説ステップで、各問の ▶ で1文だけ、見出しの ▶ で10問を続けて鳴らす。読み上げるのは**空所を正解で埋めた文**（ハイフンの並びをそのまま渡すと読み上げが崩れるため）。

**時間**
アプリはフッターに経過と目安（1問20秒 × 問数）を出し、超えると赤くする。**止めはしない。** 所要時間は学習記録に残り、解説ステップに「所要 3:12 ／ 1問 19 秒」と出る。⚙ で1問あたりの目安を10〜40秒に変えられる。

### data/part5/index.json

```json
{ "id": "2026-09-18-1258-1", "no": 1, "date": "2026-09-18", "time": "12:58",
  "kind": "文法7・語彙3", "questions": 10, "file": "2026-09-18-1258-1.json" }
```

### data/part5/history.json

```json
{ "id": "2026-09-18-1258-1", "date": "2026-09-18", "focus": "文法7・語彙3",
  "types": ["form", "verb", "vocab", "prep", "form", "conj", "vocab", "verbal", "pron", "vocab"],
  "topics": ["助動詞のあとの動詞", "受動態と未来", "期限の by"] }
```

`topics` はその回で問うた文法トピック。スキルが次回以降の重複を避けるために読む。アプリはこのファイルを見ない。**消さずに貯め続ける。**

---

## data/part6/&lt;id&gt;.json

Part 6（長文穴埋め）。**1ファイル＝1セット＝文書1本＋空所4つ**。本番の1セットと同じ単位で、4問のうち1問は**一文挿入**。1セット2〜3分。

```json
{
  "schemaVersion": 1,
  "type": "part6",
  "id": "2026-09-18-1637-1",
  "date": "2026-09-18",
  "time": "16:37",
  "sample": false,
  "docType": "email",
  "scene": "社内メール｜在庫システムの切り替え",
  "intro": "Questions 1-4 refer to the following e-mail.",
  "header": [
    { "label": "To", "text": "All Warehouse Staff" },
    { "label": "Subject", "text": "New inventory system" }
  ],
  "paragraphs": [
    {
      "sentences": [
        { "en": "Starting on 1 October, the warehouse ------- to a new system.", "ja": "10月1日より、倉庫は新しいシステムに切り替えます。", "q": 1 },
        { "en": "The current system will be shut down at the end of September.", "ja": "現在のシステムは9月末で停止します。" }
      ]
    }
  ],
  "questions": [
    {
      "id": "q1",
      "type": "verb",
      "choices": [ { "key": "A", "text": "switched", "ja": "切り替えた" } ],
      "answer": "B",
      "explanation": "日本語解説",
      "tip": "この型の見分け方"
    }
  ],
  "glossary": { "shut down": { "lemma": "shut down", "pos": "熟", "ja": "停止する", "note": "" } },
  "point": { "lead": "読み方を1行で", "items": [ { "title": "見出し", "body": "本文" } ] }
}
```

### 設計上の要点

**`questions` に `prompt` は無い**
設問文にあたるのは**本文の空所そのもの**。`paragraphs[].sentences[].q` が「この文の空所は何番の設問か」を指し、アプリは空所を `(1)` のような番号付きの下線にして、その下に4問の選択肢を並べる。本番の紙面と同じ形。

**一文挿入は `en` が空所だけの文**
`{ "en": "-------", "ja": "", "q": 2 }` のように、1文まるごとが空所になる。アプリはここを幅いっぱいの下線にする。選択肢は4つとも完全な文（8〜18語）で、`ja` はその文の訳。

**`docType` は7種、`intro` はその決まり文句**
`email` / `memo` / `notice` / `article` / `advertisement` / `letter` / `instructions`。
`intro` は `Questions 1-4 refer to the following <言い回し>.` の形。食い違うと `tools/check-part6.js` が止める。

**`scene` は伏せない**
Part 3・Part 4 は場面を伏せるが、Part 6 は読む問題で文書を最初から全部見せるので、伏せる意味がない。アプリは最初から表示する。

**`type` は9種**
`sentence`（一文挿入）／`form`／`verb`／`verbal`／`prep`／`conj`（接続詞・接続副詞）／`pron`（代名詞・指示語）／`comp`／`vocab`。
**1セットに `sentence` がちょうど1問**、残り3問は文法1〜2・語彙1〜2。**4問のうち2問以上は、空所のある文だけでは決まらない**ようにする（ここが Part 5 との違い）。

**`audio` は持たない**
読む問題なので音声ファイルは作らない。対訳ステップでは端末（Chrome / Edge）の読み上げで鳴らす。読み上げるのは**空所を正解で埋めた文**。

### data/part6/index.json

```json
{ "id": "2026-09-18-1637-1", "no": 1, "date": "2026-09-18", "time": "16:37",
  "docType": "email", "kind": "メール", "questions": 4, "file": "2026-09-18-1637-1.json" }
```

### data/part6/history.json

```json
{ "id": "2026-09-18-1637-1", "date": "2026-09-18", "scene": "社内メール｜在庫システムの切り替え",
  "docType": "email", "types": ["verb", "sentence", "vocab", "conj"] }
```

スキルが場面と種類の重複を判定するために読む。アプリはこのファイルを見ない。**消さずに貯め続ける。**

---

## data/part7/&lt;id&gt;.json

Part 7（読解）。**1ファイル＝1セット**。本番と同じ単位で、単一文書（文書1本＋2〜4問）か複数文書（文書2本＋5問）。

```json
{
  "schemaVersion": 1,
  "type": "part7",
  "id": "2026-09-21-0957-4",
  "date": "2026-09-21",
  "time": "09:57",
  "sample": false,
  "format": "double",
  "scene": "職員向け講座｜会員価格と日程の確認",
  "intro": "Questions 1-5 refer to the following e-mail and schedule.",
  "docs": [
    {
      "docType": "email",
      "label": "メール",
      "header": [ { "label": "To", "text": "Staff Association Members" } ],
      "paragraphs": [
        { "sentences": [ { "en": "...", "ja": "...", "pos": 1 } ] }
      ]
    }
  ],
  "questions": [
    {
      "id": "q4",
      "type": "detail",
      "prompt": "How much will a member pay for the class on 8 October?",
      "choices": [ { "key": "A", "text": "Twenty dollars", "ja": "20ドル" } ],
      "answer": "C",
      "evidence": [ { "d": 1, "p": 0, "s": 2 }, { "d": 0, "p": 0, "s": 1 } ],
      "cross": true,
      "explanation": "日本語解説",
      "tip": "この型の解き方"
    }
  ],
  "glossary": { "reduced rate": { "lemma": "reduced rate", "pos": "名", "ja": "割引価格", "note": "" } },
  "point": { "lead": "読み方を1行で", "items": [ { "title": "見出し", "body": "本文" } ] }
}
```

### 設計上の要点

**`format` は `single` か `double`**
`single` は文書1本・設問2〜4問、`double` は文書2本・設問5問。`double` には**両方の文書を見ないと解けない設問**（`cross: true`）を1問以上入れる。アプリは解説でその設問に「2つの文書」の印を出す。

**`docs[]` は文書の配列**
`docType` は10種（`email` / `memo` / `notice` / `article` / `advertisement` / `letter` / `instructions` / `form` / `schedule` / `chat`）。複数文書のときは `label`（「メール」「日程表」）が画面の見出しになる。`intro` は設問数と文書の並びに合わせる（`Questions 1-5 refer to the following e-mail and schedule.`）。

**`evidence` は文書・段落・文の三つ組**
`{ "d": 1, "p": 0, "s": 2 }` は「2つ目の文書の1段落目・3文目」。すべて0始まり。解説ではこの文をそのまま引用し、どの文書のどこかも添える。`cross: true` の設問は `d` の違う項目を2つ以上持つ。

**`type` は7種**
`gist`（目的・主題）／`detail`（詳細）／`notTrue`（NOT）／`infer`（推測）／`synonym`（同義語）／`insert`（文の位置）／`intent`（意図）。
`insert` は `single` のセットにだけ、最大1問。入れる文を `insert` に持ち、**本文の文に `pos`（1〜4）**を置く。アプリは `pos` を `[1]` のような印にして本文に差し込む。
`intent` は `chat` の文書があるときだけ使う。

**`audio` は持たない**
読む問題なので音声ファイルは作らない。対訳ステップでは端末（Chrome / Edge）の読み上げで鳴らす。

### data/part7/index.json

```json
{ "id": "2026-09-21-0957-4", "no": 4, "date": "2026-09-21", "time": "09:57",
  "format": "double", "kind": "メール＋日程表", "questions": 5, "file": "2026-09-21-0957-4.json" }
```

`kind` は文書の種類の日本語を `＋` でつないだもの。一覧の見出しになる。

### data/part7/history.json

```json
{ "id": "2026-09-21-0957-4", "date": "2026-09-21", "scene": "職員向け講座｜会員価格と日程の確認",
  "format": "double", "docTypes": ["email", "schedule"], "types": ["gist", "detail", "infer", "detail", "notTrue"] }
```

スキルが場面と文書の組み合わせの重複を判定するために読む。アプリはこのファイルを見ない。**消さずに貯め続ける。**
