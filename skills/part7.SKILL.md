---
name: part7-toeic-trainer
description: TOEIC Part 7（読解）の練習セットを1回5セット生成し、学習アプリ用の JSON として GitHub に書き出すスキル。「Part 7 の教材を作成」「読解問題を作って」「長文読解を作成」など、Part 7 起点の教材生成依頼があれば必ずこのスキルを使用すること。会話問題は part3、説明文は part4、短文穴埋めは part5、長文穴埋めは part6 の各スキルを使う（本スキルは data/part7/ 以外に触れない）。1セットは本番と同じ単位で、単一文書（文書1本＋2〜4問）か複数文書（文書2本＋5問、うち1問以上は両方を見ないと解けない設問）にし、data/part7/history.json で直近との重複を避ける。
---

# part7-toeic-trainer

TOEIC Part 7（読解）の練習セットを作る。**1回の実行で5セット**。

本番の Part 7 は、1つの文書に2〜4問が付く**単一文書**と、2〜3の文書に5問が付く**複数文書**でできている。この単位をそのまま1セットにする。

出力先は学習アプリのリポジトリ `data/part7/`。アプリ（GitHub Pages 上の `part7.html`）はこの JSON だけを読む。

**本番の形式をそのまま再現することが唯一の目的**である。本番で起きないことは、ここでも起こしてはならない。

**このパートの要は2つ。** 設問が本文のどこを指しているかを素早く見つけること（設問の順番は本文の流れとほぼ一致する）。そして複数文書では、**片方だけでは答えが出ない設問**を解くこと。作る側もここを外してはならない。

---

## ステップ0：日付・時刻の確定（必ず最初に実行）

日付・時刻の基準は必ず **JST（日本標準時, UTC+9）** とする。

```bash
node -e "console.log(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',dateStyle:'short',timeStyle:'short'}).format(new Date()))"
```

`id` はこの実時刻から `YYYY-MM-DD-HHMM-N` として作る。`N` は1〜5。実行環境が返すキャッシュ時刻を使ってはならない。

---

## ステップ1：形式と文書の種類

### 形式（`format`）

| format | 中身 | 設問数 |
|---|---|---|
| `single` | 文書1本 | 2〜4問 |
| `double` | 文書2本 | 5問（**うち1問以上は両方を見ないと解けない**） |

**この回の5セットは、`single` 3本・`double` 2本**にする。本番は単一文書のほうが多い。

### 文書の種類（`docs[].docType`）

`email` / `memo` / `notice` / `article` / `advertisement` / `letter` / `instructions` / `form` / `schedule` / `chat`

- `form`（申込書・注文書）と `schedule`（日程表・料金表）は、複数文書の2つ目に置くと本番らしくなる。
- `chat`（テキストチャット）は単一文書で使い、`intent`（意図を問う設問）を入れる。
- **`double` の2本は必ず別の種類**にする（メール＋日程表、広告＋メール、記事＋手紙など）。

### `intro`

本番と同じ前置きを持たせる。**設問数と文書の並びに合わせる。**

```
Questions 1-3 refer to the following article.
Questions 1-5 refer to the following e-mail and schedule.
```

2つ目以降は `and` でつなぐ。言い回しは Part 6 と同じ表（e-mail / memo / notice / article / advertisement / letter / instructions / form / schedule / text-message chain）。

### 選定ルール

1. `data/part7/history.json` を読み、直近10件の `scene` と `docType` を確認する。
2. **直近10件に出た場面は選ばない。**
3. この回の5本は、場面も文書の組み合わせもすべて別にする。
4. `scene` は「大分類｜具体的な状況」の形で書く。Part 7 は読む問題なので**アプリでは最初から表示する**。

---

## ステップ2：文書を書く

### 分量

| format | 語数 |
|---|---|
| `single` | **110〜200語** |
| `double` | 2本の合計で **180〜280語**（1本あたり80〜150語） |

- 段落は1〜5、1段落は1〜6文。`schedule` や `form` のように箇条書きに近い文書は、1文を1項目として並べてよい。
- 1文は8〜35語。
- `ja` は1文ずつ、その文だけの自然な日本語訳にする。

### 書き方の制約

- 現実のビジネス文書として成り立つ具体性を持たせる（日付・金額・部署名・番号）。固有名詞は架空にする。
- **設問の根拠になる情報を、文書の前・中・後ろに散らす。** 1か所に固めると、設問の順番と本文の流れが一致しなくなる。
- **複数文書では、2つの文書に「つながる情報」を必ず1組入れる。** 例：メールに「会員は10パーセント引き」とあり、日程表に会員価格が載っていない。両方を見て初めて金額が出る、という形。
- 句動詞・熟語を3つ以上入れる。
- `insert`（文位置挿入）を入れるセットでは、文に `pos`（1〜4）を持たせる。**その文の直後に `[1]` のような印が入る**という意味で、1〜4を1つずつ、文書全体に散らして置く。

---

## ステップ3：設問を作る

### 型（`type`）

| type | 何を問うか | 設問文の例 |
|---|---|---|
| `gist` | 目的・主題 | What is the purpose of the e-mail? / What is being advertised? |
| `detail` | 具体的な事実 | According to the notice, when will the office close? |
| `notTrue` | 書かれていないもの | What is NOT mentioned as a benefit of membership? |
| `infer` | 示唆・推測 | What is suggested about the new branch? |
| `synonym` | 語の言い換え | The word "cover" in paragraph 2, line 3, is closest in meaning to |
| `insert` | 文の位置 | In which of the positions marked [1], [2], [3], and [4] does the following sentence best belong? |
| `intent` | 書き手の意図（チャット） | At 10:42, what does Ms. Yun most likely mean when she writes, "..."? |

### 配分

| 項目 | 決まり |
|---|---|
| 並び | **設問の順番は本文の流れと合わせる。** 根拠の位置が前から後ろへ進むようにする（`gist` と `notTrue` は例外として先頭や末尾に置いてよい） |
| 型 | 同じ型は**最大2問**。`gist` は0〜1問 |
| `insert` | **`single` のセットにだけ、最大1問。** 入れるなら文書に `pos` 1〜4をすべて置く |
| `intent` | `chat` の文書があるときだけ使う |
| `double` の cross | **1問以上**を `cross: true` にし、`evidence` に**別々の文書**を指す項目を2つ以上入れる |
| 正解の位置 | 同じ文字が3問以上にならないようにする |

### 根拠（`evidence`）

- `{ "d": 文書の番号, "p": 段落の番号, "s": 文の番号 }` を配列で持つ（すべて0始まり）。
- **根拠が本文にない設問は作らない。** `notTrue` は「3つが書かれている」ことを示すので、3つぶんの根拠を入れる。
- `cross: true` の設問は、`d` の違う項目を2つ以上入れる。

### 選択肢

- 4択。`key` は `A` `B` `C` `D`。長さを揃える。
- **誤答は本文の語を使って作る。** 本文に出てこない話を選択肢にすると消去法で解けてしまう。
- 正解は**本文の言い換え**にする。本文の語をそのまま並べた選択肢が正解になる形は、本番では少ない。
- `ja` に短い訳を入れる。`insert` の選択肢は `[1]` `[2]` `[3]` `[4]` とし、`ja` は「1の位置」のように書く。

### 解説・tip

- `explanation` は2〜4文。**本文のどこを見れば決まるか**（第2段落の日付、2通目の表の下から2行目）を必ず書き、紛らわしい誤答1つに触れる。
- `tip` は1〜2文。**その型の解き方**を書く。「NOT 問題は3つを本文で消してから残りを選ぶ」のように、次のセットで再現できる形にする。

---

## ステップ4：語注と Point

- `glossary` は**8〜12語**、キーは本文の表層形を小文字化したもの。**半分以上は2語以上のまとまり**。高校初級までの単語を基本の意味のまま入れない。
- `point` は `lead`（1行）と `items` 2〜3項目。**セット全体を貫く読み方**を書く。
  「設問を1つ読んでから本文に戻る」「複数文書は、2つ目を読む前に1つ目で分かったことを1行でまとめる」のように、内容から離れても使える形にする。

---

## ステップ5：JSON の出力

### 5-1. 出力先

リポジトリがあれば `data/part7/<id>.json` を**5本**書き出し、`index.json` と `history.json` を更新してコミット＆プッシュ。無ければ JSON を `json` のコードブロックで出力し、失敗した旨を報告する。

**作業は必ず `main` ブランチ。** プルリクエストは作らない。5本を1つのコミットにまとめ、メッセージは `Part 7 追加: <日付> の5セット`。**他のパートのディレクトリには触れない。**

### 5-2. スキーマ（v1）

```json
{
  "schemaVersion": 1,
  "type": "part7",
  "id": "2026-09-21-0957-1",
  "date": "2026-09-21",
  "time": "09:57",
  "createdAt": "2026-09-21T09:57:00+09:00",
  "sample": false,
  "format": "single",
  "scene": "記事｜市場の改装と出店者の募集",
  "intro": "Questions 1-3 refer to the following article.",
  "docs": [
    {
      "docType": "article",
      "label": "記事",
      "header": [ { "label": "", "text": "Harbour Market to Reopen in March" } ],
      "paragraphs": [
        {
          "sentences": [
            { "en": "The Harbour Market will reopen on 3 March after a six-month renovation.", "ja": "ハーバー・マーケットは6か月の改装を経て3月3日に再開する。" },
            { "en": "The roof has been replaced and twelve new stalls have been added.", "ja": "屋根が葺き替えられ、12の新しい売り場が加わった。", "pos": 1 }
          ]
        }
      ]
    }
  ],
  "questions": [
    {
      "id": "q1",
      "type": "gist",
      "prompt": "What is the purpose of the article?",
      "choices": [
        { "key": "A", "text": "To announce the reopening of a market", "ja": "市場の再開を知らせること" },
        { "key": "B", "text": "...", "ja": "..." },
        { "key": "C", "text": "...", "ja": "..." },
        { "key": "D", "text": "...", "ja": "..." }
      ],
      "answer": "A",
      "evidence": [ { "d": 0, "p": 0, "s": 0 } ],
      "cross": false,
      "explanation": "日本語の解説",
      "tip": "この型の解き方"
    }
  ],
  "glossary": { "stall": { "lemma": "stall", "pos": "名", "ja": "売り場、屋台", "note": "" } },
  "point": { "lead": "...", "items": [ { "title": "...", "body": "..." } ] }
}
```

`insert` の設問だけ、入れる文を `insert` に持たせる。

```json
{ "id": "q3", "type": "insert", "prompt": "In which of the positions marked [1], [2], [3], and [4] does the following sentence best belong?",
  "insert": "Vendors who sold at the old market will be given first choice.",
  "choices": [ { "key": "A", "text": "[1]", "ja": "1の位置" } ],
  "answer": "C", "evidence": [ { "d": 0, "p": 1, "s": 1 } ] }
```

**`audio` は書かない。** Part 7 は読む問題なので音声ファイルは持たない。アプリの対訳ステップでは端末（Chrome / Edge）の読み上げで鳴らす。

### 5-3. index.json の更新

```json
{ "id": "2026-09-21-0957-1", "no": 6, "date": "2026-09-21", "time": "09:57",
  "format": "single", "kind": "記事", "questions": 3, "file": "2026-09-21-0957-1.json" }
```

`kind` は文書の種類の日本語。`double` なら「メール＋日程表」のように `＋` でつなぐ。`no` は既存の最大値 + 1 から。`updatedAt` を更新し、**古い項目は削除しない。**

### 5-4. history.json への追記

```json
{ "id": "2026-09-21-0957-1", "date": "2026-09-21", "scene": "記事｜市場の改装と出店者の募集",
  "format": "single", "docTypes": ["article"], "types": ["gist", "detail", "insert"] }
```

**古い項目は削除しない。** 初回だけファイル全体はこの形にする。

```json
{ "schemaVersion": 1, "type": "part7-history", "updatedAt": "2026-09-21T09:59:00+09:00", "items": [] }
```

### 5-5. 出力前の自己検証

```bash
node tools/check-part7.js --all
```

- `format` が `single` なら文書1本・設問2〜4問、`double` なら文書2本・設問5問
- `double` は `cross: true` の設問が1問以上あり、その `evidence` が別々の文書を指している
- `docs[].docType` が10種のいずれか、`intro` が設問数と文書の並びに合っている
- 語数が範囲内（`single` 110〜200語 / `double` 合計 180〜280語）
- すべての文に `ja` がある
- 設問の `prompt`・4択・`ja`・`answer`・`evidence`・`explanation`・`tip` がそろっている
- `evidence` が実在する文書・段落・文を指している
- 同じ型が3問以上無い。`gist` が2問以上無い
- `insert` は `single` のセットにだけ、最大1問。あれば文書に `pos` 1〜4がすべてあり、選択肢が `[1]`〜`[4]`
- `intent` は `chat` の文書があるときだけ
- 正解に同じ文字が3問以上無い
- `glossary` が8〜12語で全キーが本文に実在し、半分以上が2語以上のまとまり
- `point.lead` があり、`point.items` が2〜3項目
- `audio` を書いていない
- `index.json` と `history.json` の先頭に今回の項目を追記した

5本まとめて：`single` 3本・`double` 2本、`id` が `-1`〜`-5` の連番、場面がすべて違う。

---

## 出力前チェックリスト

1. JST の実時刻を取得したか
2. `history.json` を読み、直近10件と違う場面を選んだか
3. `single` 3本・`double` 2本になっているか
4. `double` に、両方の文書を見ないと解けない設問が入っているか
5. 設問の順番が本文の流れと合っているか
6. 誤答が本文の語で作られているか
7. `node tools/check-part7.js --all` を通したか
8. `main` ブランチで作業し、push 後に clean を確認したか

---

## 注意事項

- **1回5セット。** 週1回の実行で1週間ぶんを作る。
- **音声のことは何もしない。** Part 7 は音声ファイルを持たず、端末の読み上げで鳴らす。
- 実在の企業名・製品名・人名を使わない。架空のものにする。
- 政治的・宗教的な主張、健康や金銭の助言になる内容は扱わない。
