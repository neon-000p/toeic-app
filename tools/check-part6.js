#!/usr/bin/env node
/* Part 6 のセットが skills/part6.SKILL.md の決まりを満たしているか確かめる。
   ルーティンは書き出したあと、push の前にこれを通す。

   使い方:
     node tools/check-part6.js data/part6/2026-09-18-1637-1.json
     node tools/check-part6.js --all */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'part6');
const KEYS = ['A', 'B', 'C', 'D'];

/* 文書の種類と、前置き（intro）で使う言い回し */
const DOCS = {
  email: 'e-mail',
  memo: 'memo',
  notice: 'notice',
  article: 'article',
  advertisement: 'advertisement',
  letter: 'letter',
  instructions: 'instructions'
};

const TYPES = ['sentence', 'form', 'verb', 'verbal', 'prep', 'conj', 'pron', 'comp', 'vocab'];
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
  if (set.type !== 'part6') say('type が part6 でない');
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}(-[1-9])?$/.test(set.id || '') && !/^p6-sample/.test(set.id || '')) {
    say('id が YYYY-MM-DD-HHMM[-N] の形でない: ' + set.id);
  }
  /* Part 6 は読む問題。音声ファイルは持たず、端末の読み上げで鳴らす */
  if (set.audio !== undefined) say('audio がある（Part 6 は端末の読み上げで鳴らす）');
  if (!set.scene || !/｜/.test(set.scene)) say('scene が「大分類｜具体的な状況」の形でない');

  /* ---- 種類と前置き ---- */
  const kind = set.docType || '';
  if (!DOCS[kind]) say(`docType が7種以外: ${kind || '(無し)'}`);
  const intro = set.intro || '';
  if (!intro) say('intro が無い');
  else {
    const want = `Questions 1-4 refer to the following ${DOCS[kind] || ''}.`;
    if (!/^Questions 1-4 refer to the following .+\.$/.test(intro)) {
      say('intro が「Questions 1-4 refer to the following ….」の形でない');
    } else if (DOCS[kind] && intro !== want) {
      say(`intro と docType が食い違う（${kind} なら「${want}」）`);
    }
  }

  /* ---- 文書の頭 ---- */
  const head = set.header || [];
  if (!Array.isArray(head) || !head.length) say('header が無い');
  else head.forEach((h, i) => {
    if (!h.text) say(`header[${i}] に text が無い`);
  });

  /* ---- 本文 ---- */
  const paras = set.paragraphs || [];
  if (paras.length < 2 || paras.length > 4) say(`段落が2〜4でない: ${paras.length}段落`);

  let total = 0;
  let blanks = 0;
  const qOf = {};
  let insertSentences = 0;

  paras.forEach((p, pi) => {
    const ss = p.sentences || [];
    if (ss.length < 2 || ss.length > 5) say(`paragraphs[${pi}] の文が2〜5でない: ${ss.length}文`);
    ss.forEach((s, si) => {
      const at = `paragraphs[${pi}].sentences[${si}]`;
      const en = String(s.en || '');
      if (!en) say(`${at} に en が無い`);
      const hit = en.match(BLANK) || [];
      if (hit.length > 1) say(`${at} に空所が2か所以上ある`);
      if (hit.length) {
        blanks++;
        if (!Number.isInteger(s.q) || s.q < 1 || s.q > 4) say(`${at} の q が 1〜4 でない: ${s.q}`);
        else if (qOf[s.q]) say(`${at} の q が重複している: ${s.q}`);
        else qOf[s.q] = at;
        /* 一文挿入の空所は、その文が空所だけでできている */
        if (/^-{4,}$/.test(en.trim())) insertSentences++;
        else if (!s.ja) say(`${at} に ja が無い（空所は正解を入れた状態で訳す）`);
      } else {
        if (s.q !== undefined) say(`${at} に空所が無いのに q がある`);
        if (!s.ja) say(`${at} に ja が無い`);
      }
      const w = words(en);
      total += w;
      if (w > 30) warn.push(`${at} が30語を超える（${w}語）`);
      if (w < 8 && !/^-{4,}$/.test(en.trim())) warn.push(`${at} が8語未満（${w}語）`);
    });
  });

  if (blanks !== 4) say(`本文の空所が4か所でない: ${blanks}か所`);
  if (total < 90 || total > 160) say(`本文の総語数が 90〜160 の外: ${total}語`);
  if (paras.length >= 2) {
    const per = paras.map((p) => (p.sentences || []).filter((s) => BLANK.test(String(s.en || '')) || (String(s.en || '').match(/-{4,}/) || []).length).length);
    if (per.some((n) => n >= 4)) say('空所が1つの段落に4つとも入っている（文書全体に散らす）');
  }

  const text = paras.map((p) => (p.sentences || []).map((s) => String(s.en || '').replace(BLANK, ' ')).join(' ')).join(' ').toLowerCase();

  /* ---- 設問 ---- */
  const qs = set.questions || [];
  if (qs.length !== 4) say(`questions が4問でない: ${qs.length}問`);

  const used = [];
  let nInsert = 0;

  qs.forEach((q, i) => {
    const at = `questions[${i}]`;
    if (q.id !== 'q' + (i + 1)) say(`${at} の id が q${i + 1} でない: ${q.id}`);
    if (!TYPES.includes(q.type)) say(`${at} の type が9種以外: ${q.type}`);
    if (used.includes(q.type)) say(`${at} の type が重複している: ${q.type}`);
    used.push(q.type);
    if (q.type === 'sentence') nInsert++;

    const ch = q.choices || [];
    if (ch.length !== 4) say(`${at} が4択でない: ${ch.length}`);
    const gotKeys = ch.map((c) => c.key);
    KEYS.forEach((k) => { if (!gotKeys.includes(k)) say(`${at} に選択肢 ${k} が無い`); });
    ch.forEach((c) => {
      if (!c.text) say(`${at} の ${c.key} に text が無い`);
      if (!c.ja) say(`${at} の ${c.key} に ja が無い`);
      if (q.type === 'sentence') {
        const w = words(c.text || '');
        if (w < 8 || w > 18) say(`${at} の ${c.key} が8〜18語でない（一文挿入）: ${w}語`);
        if (!/[.!?]$/.test(String(c.text || '').trim())) say(`${at} の ${c.key} が文で終わっていない（一文挿入）`);
      }
    });
    if (!gotKeys.includes(q.answer)) say(`${at} の answer が選択肢に無い: ${q.answer}`);

    const texts = ch.map((c) => String(c.text || '').toLowerCase());
    if (new Set(texts).size !== texts.length) say(`${at} の選択肢に同じものがある`);

    if (!q.explanation) say(`${at} に explanation が無い`);
    if (!q.tip) say(`${at} に tip が無い`);
  });

  if (qs.length === 4 && nInsert !== 1) say(`一文挿入（sentence）がちょうど1問でない: ${nInsert}問`);
  /* 一文挿入を除く3問は、文法1〜2問・語彙1〜2問。どちらかに寄せない */
  const nVocab = used.filter((t) => t === 'vocab').length;
  if (qs.length === 4 && nInsert === 1 && (nVocab < 1 || nVocab > 2)) {
    say(`語彙問題が1〜2問でない（一文挿入を除く3問の内訳）: ${nVocab}問`);
  }
  if (insertSentences !== nInsert) {
    say(`一文挿入の空所の置き方が違う（en が「-------」だけの文が ${insertSentences} 個、sentence の設問が ${nInsert} 問）`);
  }

  /* ---- 正解の位置 ---- */
  const tally = { A: 0, B: 0, C: 0, D: 0 };
  qs.forEach((q) => { if (tally[q.answer] !== undefined) tally[q.answer]++; });
  KEYS.forEach((k) => { if (tally[k] >= 3) say(`正解が ${k} に偏っている: ${tally[k]}問`); });

  /* ---- 語注 ---- */
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

  const info = `${paras.length}段落 / ${total}語 / ${kind} / 型 ${used.join(',')} / ` +
    `正解 A${tally.A} B${tally.B} C${tally.C} D${tally.D} / 語注${gkeys.length}語（熟語${gPhrases.length}）`;
  return { bad, warn, info };
}

/* ---------------- 入口 ---------------- */

const args = process.argv.slice(2);
let files = args.filter((a) => !a.startsWith('--'));
if (args.includes('--all') || !files.length) {
  if (!fs.existsSync(DIR)) { console.log('data/part6/ がありません'); process.exit(0); }
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
