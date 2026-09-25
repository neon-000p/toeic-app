#!/usr/bin/env node
/* Part 4 のセットが skills/part4.SKILL.md の決まりを満たしているか確かめる。
   ルーティンは書き出したあと、push の前にこれを通す。

   使い方:
     node tools/check-part4.js data/part4/2026-09-17-0901-1.json
     node tools/check-part4.js --all

   壊れた JSON や決まり違反を置くと、そのセットがアプリで開けない、
   あるいは本番と違う形の練習になってしまうため、機械で止める。 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'part4');
const TYPES = ['gist', 'who', 'detail', 'intent', 'next', 'infer'];
const KEYS = ['A', 'B', 'C', 'D'];

/* トークの種類と、前置き（intro）で使う言い回し。
   本番のナレーションは種類ごとに決まった形なので、ここから外れたら止める。 */
const TALKS = {
  announcement: 'announcement',
  voicemail: 'telephone message',
  speech: 'speech',
  broadcast: 'broadcast',
  ad: 'advertisement',
  tour: 'tour information',
  instructions: 'instructions',
  meeting: 'excerpt from a meeting',
  talk: 'talk'
};

function words(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

function check(file) {
  const bad = [];
  const warn = [];
  const say = (m) => bad.push(m);

  let set;
  try { set = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { bad: ['JSON として読めない: ' + e.message], warn: [] }; }

  /* ---- 器 ---- */
  if (set.schemaVersion !== 1) say('schemaVersion が 1 でない');
  if (set.type !== 'part4') say('type が part4 でない');
  /* 5本まとめて作るので、末尾に -1 〜 -9 の連番が付く */
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}(-[1-9])?$/.test(set.id || '') && !/^p4-sample/.test(set.id || '')) {
    say('id が YYYY-MM-DD-HHMM[-N] の形でない: ' + set.id);
  }
  /* audio は Actions が付ける。実物が無いのに書いてあるときだけ止める
     （手で書いた、あるいはファイルを消した状態）。 */
  if (set.audio !== undefined) {
    const ap = set.audio.file ? path.join(DIR, set.audio.file) : '';
    if (!ap || !fs.existsSync(ap)) say('audio が書いてあるのに音声ファイルが無い（audio は Actions に任せる）');
  }
  if (!set.scene || !/｜/.test(set.scene)) say('scene が「大分類｜具体的な状況」の形でない');

  /* ---- トークの種類と前置き ---- */
  const kind = set.talkType || '';
  if (!TALKS[kind]) say(`talkType が9種以外: ${kind || '(無し)'}`);
  const intro = set.intro || '';
  if (!intro) say('intro が無い');
  else {
    const want = `Questions 1 through 3 refer to the following ${TALKS[kind] || ''}.`;
    if (!/^Questions 1 through 3 refer to the following .+\.$/.test(intro)) {
      say('intro が「Questions 1 through 3 refer to the following ….」の形でない');
    } else if (TALKS[kind] && intro !== want) {
      say(`intro と talkType が食い違う（${kind} なら「${want}」）`);
    }
  }

  /* ---- 話し手（1人） ---- */
  const sp = set.speaker;
  if (set.speakers !== undefined) say('speakers がある（Part 4 は話し手1人。speaker に書く）');
  if (!sp || typeof sp !== 'object') say('speaker が無い');
  else {
    if (!['M', 'W'].includes(sp.tag)) say(`speaker.tag が M/W でない: ${sp.tag}`);
    if (!/^en-(US|GB|AU|CA)$/.test(sp.accent || '')) say(`speaker.accent が4か国のいずれかでない: ${sp.accent}`);
    if (!sp.role) say('speaker.role が無い');
  }

  /* ---- トーク本文 ---- */
  const lines = set.lines || [];
  if (lines.length < 7 || lines.length > 11) say(`文の数が 7〜11 の外: ${lines.length}文`);

  let total = 0;
  let tiny = 0;
  lines.forEach((l, i) => {
    if (!l.en) say(`lines[${i}] に en が無い`);
    if (!l.ja) say(`lines[${i}] に ja が無い`);
    if (l.tag !== undefined) warn.push(`lines[${i}] に tag がある（話し手は1人なので要らない）`);
    const w = words(l.en || '');
    total += w;
    /* 最後の文は Thank you. のような締めで短くなるのが自然なので数えない */
    if (w < 8 && i < lines.length - 1) tiny++;
    if (w > 30) warn.push(`lines[${i}] が30語を超える（${w}語）`);
  });
  if (total < 110 || total > 160) say(`総語数が 110〜160 の外: ${total}語`);
  if (tiny > 1) say(`8語未満の文が ${tiny} 文ある（最後の文を除いて最大1文）`);

  const text = lines.map((l) => l.en || '').join(' ').toLowerCase();

  /* ---- 設問 ---- */
  const qs = set.questions || [];
  if (qs.length !== 3) say(`questions が3問でない: ${qs.length}問`);

  const usedTypes = [];
  let multiEvidence = 0;
  let singleEvidence = 0;

  qs.forEach((q, i) => {
    const at = `questions[${i}]`;
    if (!q.prompt) say(`${at} に prompt が無い`);
    if (q.type === 'graphic') say(`${at} で graphic を使っている（アプリが図表を出せない）`);
    else if (!TYPES.includes(q.type)) say(`${at} の type が6種以外: ${q.type}`);
    if (usedTypes.includes(q.type)) say(`${at} の type が重複している: ${q.type}`);
    usedTypes.push(q.type);

    const ch = q.choices || [];
    if (ch.length !== 4) say(`${at} が4択でない: ${ch.length}`);
    const gotKeys = ch.map((c) => c.key);
    KEYS.forEach((k) => { if (!gotKeys.includes(k)) say(`${at} に選択肢 ${k} が無い`); });
    ch.forEach((c) => {
      if (!c.text) say(`${at} の ${c.key} に text が無い`);
      if (!c.ja) say(`${at} の ${c.key} に ja が無い`);
    });
    if (!gotKeys.includes(q.answer)) say(`${at} の answer が選択肢に無い: ${q.answer}`);

    const lens = ch.map((c) => words(c.text || ''));
    if (Math.max(...lens) - Math.min(...lens) > 4) {
      warn.push(`${at} の選択肢の長さの差が大きい（${lens.join('/')}語）`);
    }

    const ev = q.evidence || [];
    if (!ev.length) say(`${at} に evidence が無い`);
    ev.forEach((n) => {
      if (!Number.isInteger(n) || n < 0 || n >= lines.length) say(`${at} の evidence が範囲外: ${n}`);
    });
    if (ev.length >= 2) multiEvidence++; else singleEvidence++;

    if (!q.explanation) say(`${at} に explanation が無い`);
    if (!q.tip) say(`${at} に tip が無い`);
  });

  /* 1問目は「何の話か・誰の話か」。本番の Part 4 はほぼこの形で始まる */
  if (qs.length === 3) {
    if (!['gist', 'who'].includes(qs[0].type)) {
      say(`1問目の type が gist / who でない: ${qs[0].type}`);
    }
    const head0 = Math.min.apply(null, (qs[0].evidence || [0]));
    if (head0 > 2) warn.push('1問目の根拠が冒頭3文より後ろにある');
    if (!['next', 'infer', 'detail'].includes(qs[2].type)) {
      warn.push(`3問目が next / infer / detail でない（本番は終盤を問う形が多い）: ${qs[2].type}`);
    }
  }

  /* 設問の並びがトークの流れと一致しているか（根拠の先頭文が単調に増えるか） */
  const heads = qs.map((q) => Math.min.apply(null, (q.evidence || [0])));
  for (let i = 1; i < heads.length; i++) {
    if (heads[i] < heads[i - 1]) {
      say(`設問の並びがトークの流れと逆（Q${i} の根拠が Q${i + 1} より後ろ）`);
      break;
    }
  }
  if (qs.length === 3 && (!multiEvidence || !singleEvidence)) {
    warn.push('根拠1文の設問と2文以上の設問が混ざっていない');
  }

  /* ---- 語注 ---- */
  const gl = set.glossary || {};
  const EXAMPLE_RULE_FROM = '2026-09-26';
  const exampleRequired = ((/^(\d{4}-\d{2}-\d{2})/.exec(set.id || '') || [])[1] || '') >= EXAMPLE_RULE_FROM;
  const gkeys = Object.keys(gl);
  /* 熟語・句動詞・コロケーション。キーか原形に空白が入っているもの */
  const gPhrases = gkeys.filter((k) => /\s/.test(k) || /\s/.test((gl[k] || {}).lemma || ''));
  if (gkeys.length < 8 || gkeys.length > 12) say(`glossary が8〜12語の外: ${gkeys.length}語`);
  if (gPhrases.length * 2 < gkeys.length) {
    say(`glossary の2語以上のまとまりが半分未満: ${gPhrases.length}/${gkeys.length}語` +
        '（句動詞・熟語・コロケーション・言い換えを増やす）');
  }
  gkeys.forEach((k) => {
    if (k !== k.toLowerCase()) say(`glossary のキーが小文字でない: ${k}`);
    if (text.indexOf(k.toLowerCase()) < 0) say(`glossary のキーが本文に無い: ${k}`);
    const v = gl[k] || {};
    if (!v.lemma) say(`glossary[${k}] に lemma が無い`);
    if (!v.pos) say(`glossary[${k}] に pos が無い`);
    if (!v.ja) say(`glossary[${k}] に ja が無い`);
    if (v.note === undefined) say(`glossary[${k}] に note が無い（不要なら空文字）`);
    /* 例文は 2026-09-26 から。時事の語彙と同じく、本文とは別に作った短い例文と和訳。
       それより前のセットは本文の文をアプリが例文に回すので、ここでは見ない。 */
    if (exampleRequired) {
      const ex = v.example || {};
      if (!ex.en) say(`glossary[${k}] に example.en（例文）が無い`);
      if (!ex.ja) say(`glossary[${k}] に example.ja（例文の訳）が無い`);
      if (ex.en && text.indexOf(String(ex.en).trim().toLowerCase().replace(/[.!?]+$/, '')) >= 0) {
        say(`glossary[${k}] の例文が本文の文そのまま（本文とは別の例文にする）`);
      }
    }
  });

  /* ---- Point ---- */
  const pt = set.point || {};
  if (!pt.flow) say('point.flow が無い');
  else if (!/→/.test(pt.flow)) say('point.flow が矢印でつないだ形でない');
  const items = pt.items || [];
  if (items.length < 2 || items.length > 3) say(`point.items が2〜3項目でない: ${items.length}`);
  items.forEach((it, i) => {
    if (!it.title) say(`point.items[${i}] に title が無い`);
    if (!it.body) say(`point.items[${i}] に body が無い`);
    else if (it.body.length < 40) warn.push(`point.items[${i}] の body が短い（${it.body.length}字）`);
  });

  return { bad, warn, info: `${lines.length}文 / ${total}語 / ${kind} / 型 ${usedTypes.join(',')} / ` +
    `語注${gkeys.length}語（熟語${gPhrases.length}）` };
}

/* ---------------- 入口 ---------------- */

const args = process.argv.slice(2);
let files = args.filter((a) => !a.startsWith('--'));
if (args.includes('--all') || !files.length) {
  if (!fs.existsSync(DIR)) { console.log('data/part4/ がありません'); process.exit(0); }
  files = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'history.json')
    .map((f) => path.join(DIR, f));
}

let ng = 0;
files.forEach((f) => {
  const name = path.basename(f);
  const r = check(path.resolve(ROOT, f));
  if (r.info) console.log(`\n${name}  ${r.info}`);
  else console.log(`\n${name}`);
  r.warn.forEach((m) => console.log(`  ・気になる点: ${m}`));
  if (r.bad.length) {
    ng++;
    r.bad.forEach((m) => console.log(`  ✗ ${m}`));
  } else {
    console.log('  ✓ 決まりを満たしています');
  }
});

console.log(ng ? `\n${ng} 件に直すところがあります` : '\nすべて問題ありません');
process.exit(ng ? 1 : 0);
