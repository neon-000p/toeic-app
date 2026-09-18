#!/usr/bin/env node
/* すでに置いてある文ごと・行ごとのクリップから、前後の無音を削る。
   API は呼ばないので、作り直しの費用も待ち時間もかからない。

   使い方:
     node tools/trim-existing.js

   一度削った教材には audio.trimmed を立てるので、次からはとばす。
   ffmpeg が無い環境では何もしない。 */

'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./tts-lib');

const ROOT = path.resolve(__dirname, '..');

/* 教材の種類ごとに、どこを見て何 kbps で作り直すか */
const TARGETS = [
  { dir: path.join(ROOT, 'data', 'news'), kbps: 32 },
  { dir: path.join(ROOT, 'data', 'part3'), kbps: 48 },
  { dir: path.join(ROOT, 'data', 'part4'), kbps: 48 },
  { dir: path.join(ROOT, 'data', 'part5'), kbps: 32 }
];

function run(target) {
  if (!fs.existsSync(target.dir)) return 0;

  const files = fs.readdirSync(target.dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'history.json');

  let changed = 0;
  files.forEach((f) => {
    const p = path.join(target.dir, f);
    const set = JSON.parse(fs.readFileSync(p, 'utf8'));
    const a = set.audio;
    if (!a || !a.lines || !a.lines.length || a.trimmed) return;

    let n = 0;
    a.lines.forEach((rel) => {
      const file = path.join(target.dir, rel);
      if (fs.existsSync(file) && lib.trimSilence(file, target.kbps)) n++;
    });

    if (!n) return;

    a.trimmed = true;
    a.bytes = a.lines.reduce((sum, rel) => {
      const file = path.join(target.dir, rel);
      return sum + (fs.existsSync(file) ? fs.statSync(file).size : 0);
    }, 0);
    fs.writeFileSync(p, JSON.stringify(set, null, 2) + '\n');
    console.log(`${set.id || f}: ${n} 本から無音を削りました（合計 ${Math.round(a.bytes / 1024)} KB）`);
    changed++;
  });
  return changed;
}

if (!lib.hasFfmpeg()) {
  console.log('ffmpeg が無いので何もしません');
  process.exit(0);
}

const total = TARGETS.reduce((n, t) => n + run(t), 0);
console.log(total ? `${total} 本の教材を整えました` : '削るものはありませんでした');
