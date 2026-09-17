#!/usr/bin/env node
/* 時事英語の本文を、文ごとに読み上げた音声にしておく。
   実行するのは GitHub Actions（.github/workflows/part3-audio.yml）。
   API キーは Secret から環境変数で渡すので、リポジトリには入らない。

   使い方:
     GEMINI_API_KEY=... node tools/make-news-audio.js --all
     GEMINI_API_KEY=... node tools/make-news-audio.js data/news/2026-09-13-0540.json
     --force を付けると、すでに音声がある教材も作り直す。

   できること:
     data/news/audio/<id>/NN.mp3   本文の1文ずつ
     並びは summary.paragraphs を段落またぎでつないだ順（アプリの data-i と同じ）。
     まるごと1本のファイルは作らない。アプリ側で順に鳴らせば同じことになるうえ、
     文をタップしたときに頭出しする必要がなくなる。

   1文ずつにするのは、アプリが文タップ再生と行の色付けをしているため。
   まとめて1本にすると、その2つができなくなる。 */

'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./tts-lib');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'news');
const AUDIO_DIR = path.join(DIR, 'audio');

/* 読み手は1人。記事ごとに変えない。
   Part 3 の女性（W = Kore）と紛れないよう、別の女性の声にする。 */
const VOICE = process.env.NEWS_TTS_VOICE || 'Leda';
const KBPS = 32;   /* 1人が淡々と読むだけなので、会話より落として容量を抑える */

/* 段落をまたいで1本の列にする。アプリの data-i と同じ並びにしないと、
   タップした文と鳴る音声がずれる。 */
function flatSentences(pack) {
  const out = [];
  ((pack.summary && pack.summary.paragraphs) || []).forEach((p) => {
    (p.sentences || []).forEach((s) => { if (s && s.en) out.push(s); });
  });
  return out;
}

async function build(file, force) {
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = pack.id || path.basename(file, '.json');
  const sents = flatSentences(pack);

  if (!sents.length) { console.log(`${id}: 本文が無いのでとばします`); return false; }

  if (pack.audio && pack.audio.lines && pack.audio.lines.length && !force) {
    const first = path.join(DIR, pack.audio.lines[0]);
    if (fs.existsSync(first) && pack.audio.lines.length === sents.length) {
      console.log(`${id}: すでに音声あり。とばします`);
      return false;
    }
  }

  console.log(`${id}: ${sents.length}文 → ${sents.length}回の呼び出し`);
  if (!lib.hasFfmpeg()) console.log('  ffmpeg が無いので WAV のまま置きます（容量が大きいので注意）');

  const dir = path.join(AUDIO_DIR, id);
  const lines = [];
  for (let i = 0; i < sents.length; i++) {
    const base = String(i).padStart(2, '0');
    process.stdout.write(`  ${i + 1}/${sents.length} `);
    const pcm = await lib.tts(
      'Read this sentence clearly, at a steady pace, as a news reader would: ' + lib.speechText(sents[i].en),
      lib.oneVoice(VOICE));
    const r = lib.writeAudio(dir, base, [pcm], KBPS);
    lib.trimSilence(path.join(dir, r.name), KBPS);
    lines.push(`audio/${id}/${r.name}`);
    console.log('できました');
  }

  const bytes = lines.reduce((n, f) => n + fs.statSync(path.join(DIR, f)).size, 0);
  pack.audio = {
    lines,
    voice: VOICE,
    bytes,
    model: lib.MODEL,
    madeAt: new Date().toISOString()
  };
  fs.writeFileSync(file, JSON.stringify(pack, null, 2) + '\n');
  console.log(`  → data/news/audio/${id}/ に ${lines.length} 本（合計 ${Math.round(bytes / 1024)} KB）`);
  return true;
}

/* ---------------- 入口 ---------------- */

(async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const all = args.includes('--all');
  let files = args.filter((a) => !a.startsWith('--'));

  if (all || !files.length) {
    files = fs.readdirSync(DIR)
      .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'history.json')
      .map((f) => path.join(DIR, f));
  } else {
    files = files.map((f) => path.resolve(ROOT, f));
  }

  if (!files.length) { console.log('対象の教材がありません'); return; }
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
  console.log(made ? `${made} 本の教材の音声を作りました` : '作った音声はありません');
})();
