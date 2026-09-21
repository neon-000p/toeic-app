#!/usr/bin/env node
/* Part 7 のセットが skills/part7.SKILL.md の決まりを満たしているか確かめる。
   ルーティンは書き出したあと、push の前にこれを通す。

   使い方:
     node tools/check-part7.js data/part7/2026-09-21-0957-1.json
     node tools/check-part7.js --all */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'part7');
const KEYS = ['A', 'B', 'C', 'D'];

/* 文書の種類と、前置き（intro）で使う言い回し */
const DOCS = {
  email: 'e-mail',
  memo: 'memo',
  notice: 'notice',
  article: 'article',
  advertisement: 'advertisement',
  letter: 'letter',
  instructions: 'instructions',
  form: 'form',
  schedule: 'schedule',
  chat: 'text-message chain'
};

const TYPES = ['gist', 'detail', 'notTrue', 'infer', 'synonym', 'insert', 'intent'];

function words(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

/* 「e-mail and schedule」「article」のように並べる */
function introOf(set) {
  const names = (set.docs || []).map((d) => DOCS[d.docType] || '');
  const n = (set.questions || []).length;
  let tail;
  if (names.length === 1) tail = names[0];
  else tail = names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  return `Questions 1-${n} refer to the following ${tail}.`;
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
  if (set.type !== 'part7') say('type が part7 でない');
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}(-[1-9])?$/.test(set.id || '') && !/^p7-sample/.test(set.id || '')) {
    say('id が YYYY-MM-DD-HHMM[-N] の形でない: ' + set.id);
  }
  /* Part 7 は読む問題。音声ファイルは持たず、端末の読み上げで鳴らす */
  if (set.audio !== undefined) say('audio がある（Part 7 は端末の読み上げで鳴らす）');
  if (!set.scene || !/｜/.test(set.scene)) say('scene が「大分類｜具体的な状況」の形でない');

  /* ---- 形式 ---- */
  const fmt = set.format || '';
  const docs = set.docs || [];
  const qs = set.questions || [];

  if (fmt === 'single') {
    if (docs.length !== 1) say(`single なのに文書が1本でない: ${docs.length}本`);
    if (qs.length < 2 || qs.length > 4) say(`single の設問が2〜4問でない: ${qs.length}問`);
  } else if (fmt === 'double') {
    if (docs.length !== 2) say(`double なのに文書が2本でない: ${docs.length}本`);
    if (qs.length !== 5) say(`double の設問が5問でない: ${qs.length}問`);
    const kinds = docs.map((d) => d.docType);
    if (new Set(kinds).size !== kinds.length) say('double の2本が同じ種類になっている');
  } else {
    say(`format が single / double でない: ${fmt || '(無し)'}`);
  }

  /* ---- 文書 ---- */
  let total = 0;
  const posSeen = {};
  const docText = [];

  docs.forEach((d, di) => {
    if (!DOCS[d.docType]) say(`docs[${di}].docType が10種以外: ${d.docType}`);
    if (!Array.isArray(d.header) || !d.header.length) say(`docs[${di}] に header が無い`);
    else d.header.forEach((h, i) => { if (!h.text) say(`docs[${di}].header[${i}] に text が無い`); });
    if (docs.length > 1 && !d.label) say(`docs[${di}] に label が無い（複数文書では見出しに出す）`);

    const ps = d.paragraphs || [];
    if (ps.length < 1 || ps.length > 5) say(`docs[${di}] の段落が1〜5でない: ${ps.length}段落`);
    let t = '';
    ps.forEach((p, pi) => {
      const ss = p.sentences || [];
      if (ss.length < 1 || ss.length > 6) say(`docs[${di}].paragraphs[${pi}] の文が1〜6でない: ${ss.length}文`);
      ss.forEach((s, si) => {
        const at = `docs[${di}].paragraphs[${pi}].sentences[${si}]`;
        if (!s.en) say(`${at} に en が無い`);
        if (!s.ja) say(`${at} に ja が無い`);
        if (s.pos !== undefined) {
          if (!Number.isInteger(s.pos) || s.pos < 1 || s.pos > 4) say(`${at} の pos が 1〜4 でない: ${s.pos}`);
          else if (posSeen[s.pos]) say(`${at} の pos が重複している: ${s.pos}`);
          else posSeen[s.pos] = at;
        }
        const w = words(s.en || '');
        total += w;
        if (w > 35) warn.push(`${at} が35語を超える（${w}語）`);
        t += ' ' + String(s.en || '');
      });
    });
    docText.push(t.toLowerCase());
  });

  if (fmt === 'single' && (total < 110 || total > 200)) say(`本文の語数が 110〜200 の外: ${total}語`);
  if (fmt === 'double' && (total < 180 || total > 280)) say(`本文の語数が 180〜280 の外: ${total}語`);

  /* ---- 前置き ---- */
  if (!set.intro) say('intro が無い');
  else if (docs.length && qs.length) {
    const want = introOf(set);
    if (set.intro !== want) say(`intro が設問数・文書の並びと合わない（正しくは「${want}」）`);
  }

  /* ---- 設問 ---- */
  const used = [];
  let nCross = 0;

  qs.forEach((q, i) => {
    const at = `questions[${i}]`;
    if (q.id !== 'q' + (i + 1)) say(`${at} の id が q${i + 1} でない: ${q.id}`);
    if (!TYPES.includes(q.type)) say(`${at} の type が7種以外: ${q.type}`);
    used.push(q.type);
    if (!q.prompt) say(`${at} に prompt が無い`);

    const ch = q.choices || [];
    if (ch.length !== 4) say(`${at} が4択でない: ${ch.length}`);
    const gotKeys = ch.map((c) => c.key);
    KEYS.forEach((k) => { if (!gotKeys.includes(k)) say(`${at} に選択肢 ${k} が無い`); });
    ch.forEach((c) => {
      if (!c.text) say(`${at} の ${c.key} に text が無い`);
      if (!c.ja) say(`${at} の ${c.key} に ja が無い`);
    });
    if (!gotKeys.includes(q.answer)) say(`${at} の answer が選択肢に無い: ${q.answer}`);
    const texts = ch.map((c) => String(c.text || '').toLowerCase());
    if (new Set(texts).size !== texts.length) say(`${at} の選択肢に同じものがある`);

    /* 根拠 */
    const ev = q.evidence || [];
    if (!ev.length) say(`${at} に evidence が無い`);
    ev.forEach((e, ei) => {
      const d = docs[e.d];
      const p = d && (d.paragraphs || [])[e.p];
      const s = p && (p.sentences || [])[e.s];
      if (!s) say(`${at}.evidence[${ei}] が実在しない場所を指している: d${e.d} p${e.p} s${e.s}`);
    });

    if (q.cross) {
      nCross++;
      const ds = new Set(ev.map((e) => e.d));
      if (ds.size < 2) say(`${at} は cross なのに evidence が1つの文書だけを指している`);
    }

    if (q.type === 'insert') {
      if (fmt !== 'single') say(`${at} の insert は single のセットにだけ置ける`);
      if (!q.insert) say(`${at} に insert（入れる文）が無い`);
      const want = ['[1]', '[2]', '[3]', '[4]'];
      ch.forEach((c, ci) => {
        if (String(c.text || '').trim() !== want[ci]) say(`${at} の選択肢が [1]〜[4] でない`);
      });
      [1, 2, 3, 4].forEach((n) => { if (!posSeen[n]) say(`insert があるのに本文に [${n}] の位置が無い`); });
    }

    if (q.type === 'intent' && !docs.some((d) => d.docType === 'chat')) {
      say(`${at} の intent は chat の文書があるときだけ使える`);
    }

    if (!q.explanation) say(`${at} に explanation が無い`);
    if (!q.tip) say(`${at} に tip が無い`);
  });

  if (fmt === 'double' && nCross < 1) say('double なのに cross の設問が無い（両方の文書を見ないと解けない設問を入れる）');
  if (used.filter((t) => t === 'insert').length > 1) say('insert が2問以上ある（1セット最大1問）');
  if (used.filter((t) => t === 'gist').length > 1) say('gist が2問以上ある');
  const tally = {};
  used.forEach((t) => { tally[t] = (tally[t] || 0) + 1; });
  Object.keys(tally).forEach((t) => { if (tally[t] >= 3) say(`同じ型が3問以上ある: ${t} ${tally[t]}問`); });

  /* 設問の並びが本文の流れと合っているか。gist と notTrue は文書全体を見るので外す */
  const heads = qs.map((q, i) => {
    if (q.type === 'gist' || q.type === 'notTrue') return null;
    const ev = (q.evidence || [])[0];
    return ev ? [ev.d, ev.p, ev.s] : null;
  }).filter(Boolean);
  for (let i = 1; i < heads.length; i++) {
    const a = heads[i - 1], b = heads[i];
    const back = b[0] < a[0] || (b[0] === a[0] && (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2])));
    if (back) { warn.push('設問の並びが本文の流れと逆になっている箇所がある'); break; }
  }

  /* ---- 正解の位置 ---- */
  const keyTally = { A: 0, B: 0, C: 0, D: 0 };
  qs.forEach((q) => { if (keyTally[q.answer] !== undefined) keyTally[q.answer]++; });
  KEYS.forEach((k) => { if (keyTally[k] >= 3) say(`正解が ${k} に偏っている: ${keyTally[k]}問`); });

  /* ---- 語注 ---- */
  const text = docText.join(' ');
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

  const info = `${fmt} / 文書${docs.length}本 / ${total}語 / ${qs.length}問 ${used.join(',')} / ` +
    (fmt === 'double' ? `cross${nCross}問 / ` : '') +
    `正解 A${keyTally.A} B${keyTally.B} C${keyTally.C} D${keyTally.D} / 語注${gkeys.length}語（熟語${gPhrases.length}）`;
  return { bad, warn, info };
}

/* ---------------- 入口 ---------------- */

const args = process.argv.slice(2);
let files = args.filter((a) => !a.startsWith('--'));
if (args.includes('--all') || !files.length) {
  if (!fs.existsSync(DIR)) { console.log('data/part7/ がありません'); process.exit(0); }
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
