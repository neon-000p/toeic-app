#!/usr/bin/env node
/* Part 5 のセットが skills/part5.SKILL.md の決まりを満たしているか確かめる。
   ルーティンは書き出したあと、push の前にこれを通す。

   使い方:
     node tools/check-part5.js data/part5/2026-09-18-1258-1.json
     node tools/check-part5.js --all

   壊れた JSON や決まり違反を置くと、そのセットがアプリで開けない、
   あるいは本番と違う形の練習になってしまうため、機械で止める。 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'part5');
const KEYS = ['A', 'B', 'C', 'D'];

/* 文法の型と語彙の型。配分（文法6〜7・語彙3〜4）を数えるために分けてある */
const GRAMMAR = ['form', 'verb', 'verbal', 'prep', 'conj', 'pron', 'comp'];
const TYPES = GRAMMAR.concat(['vocab']);

const BLANK = /-{4,}/g;

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
  if (set.type !== 'part5') say('type が part5 でない');
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}(-[1-9])?$/.test(set.id || '') && !/^p5-sample/.test(set.id || '')) {
    say('id が YYYY-MM-DD-HHMM[-N] の形でない: ' + set.id);
  }
  /* Part 5 に音声は無い。1文ずつ作ると週50本になり、他のパートと無料枠を奪い合う */
  if (set.audio !== undefined) say('audio がある（Part 5 に音声は作らない）');

  /* ---- 設問 ---- */
  const qs = set.questions || [];
  if (qs.length !== 10) say(`questions が10問でない: ${qs.length}問`);

  const used = [];
  const hits = {};
  let short = 0, long = 0;

  qs.forEach((q, i) => {
    const at = `questions[${i}]`;
    if (q.id !== 'q' + (i + 1)) say(`${at} の id が q${i + 1} でない: ${q.id}`);

    if (!TYPES.includes(q.type)) say(`${at} の type が8種以外: ${q.type}`);
    used.push(q.type);
    hits[q.type] = (hits[q.type] || 0) + 1;

    const p = String(q.prompt || '');
    if (!p) say(`${at} に prompt が無い`);
    const blanks = p.match(BLANK) || [];
    if (blanks.length !== 1) say(`${at} の空所が1か所でない: ${blanks.length}か所`);
    const w = words(p);
    if (w < 12) { short++; say(`${at} が12語未満: ${w}語`); }
    if (w > 28) { long++; say(`${at} が28語を超える: ${w}語`); }

    const ch = q.choices || [];
    if (ch.length !== 4) say(`${at} が4択でない: ${ch.length}`);
    const gotKeys = ch.map((c) => c.key);
    KEYS.forEach((k) => { if (!gotKeys.includes(k)) say(`${at} に選択肢 ${k} が無い`); });
    ch.forEach((c) => {
      if (!c.text) say(`${at} の ${c.key} に text が無い`);
      if (!c.ja) say(`${at} の ${c.key} に ja が無い`);
    });
    if (!gotKeys.includes(q.answer)) say(`${at} の answer が選択肢に無い: ${q.answer}`);

    /* 選択肢の重複は、作っている途中の取りこぼしで起きやすい */
    const texts = ch.map((c) => String(c.text || '').toLowerCase());
    if (new Set(texts).size !== texts.length) say(`${at} の選択肢に同じものがある`);

    if (!q.ja) say(`${at} に ja（全文訳）が無い`);
    if (!q.explanation) say(`${at} に explanation が無い`);
    if (!q.tip) say(`${at} に tip が無い`);
  });

  /* ---- 型の配分 ---- */
  const nVocab = hits.vocab || 0;
  const nGrammar = qs.length - nVocab;
  if (qs.length === 10) {
    if (nVocab < 3 || nVocab > 4) say(`語彙問題が3〜4問でない: ${nVocab}問`);
    if (nGrammar < 6 || nGrammar > 7) say(`文法問題が6〜7問でない: ${nGrammar}問`);
  }
  if ((hits.form || 0) !== 2) say(`form（品詞）が2問でない: ${hits.form || 0}問`);
  Object.keys(hits).forEach((t) => {
    if (hits[t] >= 4 && t !== 'vocab') say(`${t} が4問以上ある: ${hits[t]}問`);
  });
  const gKinds = GRAMMAR.filter((t) => hits[t]);
  if (gKinds.length < 3) say(`文法の型が3種未満: ${gKinds.join(',') || 'なし'}`);

  /* 同じ型が3問続くと、選択肢を見て型を決める練習にならない */
  for (let i = 2; i < used.length; i++) {
    if (used[i] === used[i - 1] && used[i] === used[i - 2]) {
      warn.push(`同じ型が3問続いている（Q${i - 1}〜Q${i + 1}: ${used[i]}）`);
      break;
    }
  }

  /* ---- 正解の位置 ---- */
  const tally = { A: 0, B: 0, C: 0, D: 0 };
  qs.forEach((q) => { if (tally[q.answer] !== undefined) tally[q.answer]++; });
  KEYS.forEach((k) => {
    if (tally[k] < 2) say(`正解 ${k} が2問未満: ${tally[k]}問`);
  });

  /* ---- focus ---- */
  const m = /^文法(\d+)・語彙(\d+)$/.exec(set.focus || '');
  if (!m) say('focus が「文法N・語彙M」の形でない: ' + (set.focus || '(無し)'));
  else if (qs.length === 10 && (+m[1] !== nGrammar || +m[2] !== nVocab)) {
    say(`focus と実際の配分が違う（focus ${set.focus} / 実際 文法${nGrammar}・語彙${nVocab}）`);
  }

  /* ---- 語注 ---- */
  const text = qs.map((q) => String(q.prompt || '').replace(BLANK, ' ')).join(' ').toLowerCase();
  const gl = set.glossary || {};
  const gkeys = Object.keys(gl);
  const gPhrases = gkeys.filter((k) => /\s/.test(k) || /\s/.test((gl[k] || {}).lemma || ''));
  if (gkeys.length < 8 || gkeys.length > 12) say(`glossary が8〜12語の外: ${gkeys.length}語`);
  if (gPhrases.length * 2 < gkeys.length) {
    say(`glossary の2語以上のまとまりが半分未満: ${gPhrases.length}/${gkeys.length}語`);
  }
  gkeys.forEach((k) => {
    if (k !== k.toLowerCase()) say(`glossary のキーが小文字でない: ${k}`);
    if (text.indexOf(k.toLowerCase()) < 0) say(`glossary のキーが本文に無い: ${k}`);
    const v = gl[k] || {};
    if (!v.lemma) say(`glossary[${k}] に lemma が無い`);
    if (!v.pos) say(`glossary[${k}] に pos が無い`);
    if (!v.ja) say(`glossary[${k}] に ja が無い`);
    if (v.note === undefined) say(`glossary[${k}] に note が無い（不要なら空文字）`);
  });

  /* ---- Point ---- */
  const pt = set.point || {};
  if (!pt.lead) say('point.lead が無い');
  const items = pt.items || [];
  if (items.length < 2 || items.length > 3) say(`point.items が2〜3項目でない: ${items.length}`);
  items.forEach((it, i) => {
    if (!it.title) say(`point.items[${i}] に title が無い`);
    if (!it.body) say(`point.items[${i}] に body が無い`);
    else if (it.body.length < 40) warn.push(`point.items[${i}] の body が短い（${it.body.length}字）`);
  });

  const info = `${qs.length}問 / 文法${nGrammar}・語彙${nVocab} / 型 ${gKinds.join(',')} / ` +
    `正解 A${tally.A} B${tally.B} C${tally.C} D${tally.D} / 語注${gkeys.length}語（熟語${gPhrases.length}）`;
  return { bad, warn, info };
}

/* ---------------- 入口 ---------------- */

const args = process.argv.slice(2);
let files = args.filter((a) => !a.startsWith('--'));
if (args.includes('--all') || !files.length) {
  if (!fs.existsSync(DIR)) { console.log('data/part5/ がありません'); process.exit(0); }
  files = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'history.json')
    .map((f) => path.join(DIR, f));
}

let ng = 0;
files.forEach((f) => {
  const name = path.basename(f);
  const r = check(path.resolve(ROOT, f));
  console.log(`\n${name}${r.info ? '  ' + r.info : ''}`);
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
