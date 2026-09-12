#!/usr/bin/env node
/* 古い教材を片づける。音声を持つようになって容量が増えるので、
   置いておく量に上限を決めておく。

   使い方:
     node tools/prune.js            実際に消す
     node tools/prune.js --dry      消さずに、消す対象だけ出す

   決めごと:
     時事英語（data/news/）  … 直近1年ぶんだけ残す
     各パート（data/part3/ …）… 新しいほうから100本だけ残す

   消すのは教材の JSON と音声、そして index.json の項目。
   history.json は消さない。ジャンルや場面の重複判定に使っており、
   ここを削ると同じ題材が続けて出るようになるため。 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

const NEWS_DAYS = 365;
const PART_KEEP = 100;

const dry = process.argv.includes('--dry');

function rm(p) {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  const size = st.isDirectory()
    ? fs.readdirSync(p).reduce((n, f) => n + fs.statSync(path.join(p, f)).size, 0)
    : st.size;
  if (!dry) fs.rmSync(p, { recursive: true, force: true });
  return size;
}

/* 1件ぶんの実体（教材 JSON と音声）を消す */
function dropItem(dir, it) {
  let size = 0;
  size += rm(path.join(dir, it.file || (it.id + '.json')));
  size += rm(path.join(dir, 'audio', it.id));            /* 文・行ごとの音声 */
  size += rm(path.join(dir, 'audio', it.id + '.mp3'));   /* 会話まるごと（Part 3） */
  size += rm(path.join(dir, 'audio', it.id + '.wav'));
  return size;
}

function loadIndex(dir) {
  const p = path.join(dir, 'index.json');
  if (!fs.existsSync(p)) return null;
  return { p, idx: JSON.parse(fs.readFileSync(p, 'utf8')) };
}

function saveIndex(p, idx) {
  idx.updatedAt = new Date().toISOString();
  if (!dry) fs.writeFileSync(p, JSON.stringify(idx, null, 2) + '\n');
}

/* 新しい順に並べ替える。id は日付とは限らないので date + time で見る */
function newestFirst(items) {
  const key = (x) => (x.date || '') + ' ' + (x.time || '') + ' ' + (x.id || '');
  return items.slice().sort((a, b) => key(b).localeCompare(key(a)));
}

function pruneNews() {
  const dir = path.join(DATA, 'news');
  const got = loadIndex(dir);
  if (!got) { console.log('時事英語: index.json が無いのでとばします'); return; }

  const limit = new Date(Date.now() - NEWS_DAYS * 86400000).toISOString().slice(0, 10);
  const items = newestFirst(got.idx.items || []);
  const keep = items.filter((it) => (it.date || '') >= limit);
  const drop = items.filter((it) => (it.date || '') < limit);

  let size = 0;
  drop.forEach((it) => { size += dropItem(dir, it); });

  if (drop.length) {
    got.idx.items = keep;
    saveIndex(got.p, got.idx);
  }
  console.log(`時事英語: ${keep.length} 本を残し、${drop.length} 本を片づけました` +
    (size ? `（${Math.round(size / 1024)} KB）` : '') +
    `　※ ${limit} より古いもの`);
}

function prunePart(n) {
  const dir = path.join(DATA, 'part' + n);
  const got = loadIndex(dir);
  if (!got) return;

  const items = newestFirst(got.idx.items || []);
  const keep = items.slice(0, PART_KEEP);
  const drop = items.slice(PART_KEEP);

  let size = 0;
  drop.forEach((it) => { size += dropItem(dir, it); });

  if (drop.length) {
    got.idx.items = keep;
    saveIndex(got.p, got.idx);
  }
  console.log(`Part ${n}: ${keep.length} 本を残し、${drop.length} 本を片づけました` +
    (size ? `（${Math.round(size / 1024)} KB）` : ''));
}

if (dry) console.log('（--dry：実際には消しません）\n');
pruneNews();
[3, 4, 5, 6, 7].forEach(prunePart);
