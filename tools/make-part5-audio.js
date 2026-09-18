#!/usr/bin/env node
/* Part 5 の設問文を、1問ずつ読み上げた音声にしておく。
   実行するのは GitHub Actions（.github/workflows/part3-audio.yml）。
   API キーは Secret から環境変数で渡すので、リポジトリには入らない。

   使い方:
     GEMINI_API_KEY=... node tools/make-part5-audio.js --all
     GEMINI_API_KEY=... node tools/make-part5-audio.js data/part5/2026-09-18-1258-1.json
     --force を付けると、すでに音声があるセットも作り直す。

   できること:
     data/part5/audio/<id>/NN.mp3   設問の1文ずつ（並びは questions と同じ）
     時事英語と同じ形にしてある。まるごと1本のファイルは作らない
     （順に鳴らせば同じことになるうえ、文をタップしたときに頭出しが要らない）。

   読み上げるのは、空所を正解で埋めた文。正しい形のまま耳に入れるためで、
   ハイフンの並びをそのまま渡すと読み上げが崩れる。 */

'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./tts-lib');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'part5');
const AUDIO_DIR = path.join(DIR, 'audio');

/* 読み手は1人。Part 3 の会話や時事英語の読み手と紛れない声にする */
const VOICE = process.env.PART5_TTS_VOICE || 'Charon';
const KBPS = 32;   /* 1人が1文を読むだけなので、会話より落として容量を抑える */

const BLANK = /-{4,}/;

/* 空所を正解で埋めた文。読み上げにも、作り直しの判定にも使う */
function filled(q) {
  const hit = (q.choices || []).filter((c) => c.key === q.answer)[0];
  return String(q.prompt || '').replace(BLANK, hit ? hit.text : '');
}

async function build(file, force) {
  const set = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = set.id || path.basename(file, '.json');
  const qs = set.questions || [];

  if (!qs.length) { console.log(`${id}: 設問が無いのでとばします`); return false; }

  if (set.audio && set.audio.lines && set.audio.lines.length && !force) {
    const first = path.join(DIR, set.audio.lines[0]);
    if (fs.existsSync(first) && set.audio.lines.length === qs.length) {
      console.log(`${id}: すでに音声あり。とばします`);
      return false;
    }
  }

  console.log(`${id}: ${qs.length}問 → ${qs.length}回の呼び出し`);
  if (!lib.hasFfmpeg()) console.log('  ffmpeg が無いので WAV のまま置きます（容量が大きいので注意）');

  const dir = path.join(AUDIO_DIR, id);
  const lines = [];
  for (let i = 0; i < qs.length; i++) {
    const base = String(i).padStart(2, '0');
    process.stdout.write(`  ${i + 1}/${qs.length} `);
    const pcm = await lib.tts(
      'Read this sentence clearly, at a steady pace, as in an English test: ' +
      lib.speechText(filled(qs[i])), lib.oneVoice(VOICE));
    const r = lib.writeAudio(dir, base, [pcm], KBPS);
    lib.trimSilence(path.join(dir, r.name), KBPS);
    lines.push(`audio/${id}/${r.name}`);
    console.log('できました');
  }

  const bytes = lines.reduce((n, f) => n + fs.statSync(path.join(DIR, f)).size, 0);
  set.audio = {
    lines,
    voice: VOICE,
    bytes,
    model: lib.MODEL,
    madeAt: new Date().toISOString()
  };
  fs.writeFileSync(file, JSON.stringify(set, null, 2) + '\n');
  console.log(`  → data/part5/audio/${id}/ に ${lines.length} 本（合計 ${Math.round(bytes / 1024)} KB）`);
  return true;
}

/* ---------------- 入口 ---------------- */

(async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const all = args.includes('--all');
  let files = args.filter((a) => !a.startsWith('--'));

  if (all || !files.length) {
    if (!fs.existsSync(DIR)) { console.log('data/part5/ がありません'); return; }
    files = fs.readdirSync(DIR)
      .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'history.json')
      .map((f) => path.join(DIR, f));
  } else {
    files = files.map((f) => path.resolve(ROOT, f));
  }

  if (!files.length) { console.log('対象のセットがありません'); return; }
  if (!lib.KEY) {
    console.error('GEMINI_API_KEY が渡っていません。' +
      'Actions なら Secret（GEMINI_API_KEY）を登録してください。');
    process.exit(1);
  }

  let made = 0;
  for (const f of files) {
    try { if (await build(f, force)) made++; }
    catch (e) {
      console.error(`${path.basename(f)}: 失敗 — ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log(made ? `${made} セットの音声を作りました` : '作った音声はありません');
})();
