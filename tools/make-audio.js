#!/usr/bin/env node
/* Part 3 の会話音声を先に作っておく。
   実行するのは GitHub Actions（.github/workflows/part3-audio.yml）。
   API キーは Secret から環境変数で渡すので、リポジトリには入らない。

   使い方:
     GEMINI_API_KEY=... node tools/make-audio.js --all
     GEMINI_API_KEY=... node tools/make-audio.js data/part3/p3-sample-1.json
     --force を付けると、すでに音声があるセットも作り直す。

   できること:
     data/part3/audio/<id>.mp3       会話まるごと（設問ステップで流す）
     data/part3/audio/<id>/NN.mp3    1行ずつ（対訳で1文だけ鳴らす用）
     どちらも作り、セットの JSON に audio を書き足す。
     ffmpeg が無い環境では WAV のまま置く（容量が5倍以上になるので注意）。 */

'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./tts-lib');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'part3');
const AUDIO_DIR = path.join(DIR, 'audio');

const VOICES = { M: 'Puck', W: 'Kore', M2: 'Charon', W2: 'Leda' };
const KBPS = 48;   /* 会話は聞き取りが要なので、時事英語より少し良い音にする */

const tts = lib.tts;
const hasFfmpeg = lib.hasFfmpeg;
const toMp3 = (a, b) => lib.toMp3(a, b, KBPS);
const writeAudio = (dir, base, parts) => lib.writeAudio(dir, base, parts, KBPS);

/* ---------------- 音声を組む ---------------- */

/* 1回の呼び出しで指定できる声は2人まで。
   「同時に出てくる話者が2人まで」のかたまりに切る。 */
function chunkBySpeaker(lines) {
  const out = [];
  let cur = [], seen = [];
  for (const l of lines) {
    if (!seen.includes(l.tag) && seen.length >= 2) { out.push({ lines: cur, tags: seen }); cur = []; seen = []; }
    if (!seen.includes(l.tag)) seen.push(l.tag);
    cur.push(l);
  }
  if (cur.length) out.push({ lines: cur, tags: seen });
  return out;
}

/* 対訳で1行だけ鳴らすための音声。会話本体と同じ声を使うので、
   端末の読み上げに切り替わって声が変わることがなくなる。
   会話本体は流れを保つため2人ずつのかたまりで作り、こちらは別に作る。 */
async function lineClips(set, id, voices) {
  const dir = path.join(AUDIO_DIR, id);
  const out = [];
  for (let i = 0; i < set.lines.length; i++) {
    const l = set.lines[i];
    const base = String(i).padStart(2, '0');
    process.stdout.write(`  行 ${i + 1}/${set.lines.length} `);
    const pcm = await tts('Say this line naturally, at a steady pace: ' + l.en,
      lib.oneVoice(voices[l.tag]));
    const r = writeAudio(dir, base, [pcm]);
    lib.trimSilence(path.join(dir, r.name), KBPS);
    out.push(`audio/${id}/${r.name}`);
    console.log('できました');
  }
  return out;
}

/* ---------------- 1セット分 ---------------- */

async function build(file, force) {
  const set = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = set.id || path.basename(file, '.json');

  if (set.audio && set.audio.file && !force) {
    const p = path.join(DIR, set.audio.file);
    if (fs.existsSync(p)) {
      /* WAV のまま置かれているなら、API を呼ばずに MP3 へ差し替える。
         ffmpeg の無い環境で作った音声を、あとから軽くするため。 */
      if (p.endsWith('.wav') && hasFfmpeg()) {
        const mp3 = p.replace(/\.wav$/, '.mp3');
        toMp3(p, mp3);
        fs.unlinkSync(p);
        set.audio.file = set.audio.file.replace(/\.wav$/, '.mp3');
        set.audio.bytes = fs.statSync(mp3).size;
        fs.writeFileSync(file, JSON.stringify(set, null, 2) + '\n');
        console.log(`${id}: WAV を MP3 にしました（${Math.round(set.audio.bytes / 1024)} KB）`);
        if (!set.audio.lines || !set.audio.lines.length) {
          set.audio.lines = await lineClips(set, id, VOICES);
        }
        fs.writeFileSync(file, JSON.stringify(set, null, 2) + '\n');
        return true;
      }
      /* 会話本体はあるが行ごとのクリップが無い場合は、それだけ足す */
      if (!set.audio.lines || !set.audio.lines.length) {
        console.log(`${id}: 会話はあるので、行ごとの音声だけ作ります（${set.lines.length}行）`);
        set.audio.lines = await lineClips(set, id, VOICES);
        fs.writeFileSync(file, JSON.stringify(set, null, 2) + '\n');
        return true;
      }
      console.log(`${id}: すでに音声あり。とばします`);
      return false;
    }
  }
  if (!Array.isArray(set.lines) || !set.lines.length) { console.log(`${id}: lines が無いのでとばします`); return false; }

  const v = VOICES;
  const chunks = chunkBySpeaker(set.lines);
  console.log(`${id}: ${set.lines.length}行 / 話者${(set.speakers || []).length}人 → 会話 ${chunks.length}回 + 行ごと ${set.lines.length}回の呼び出し`);

  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    let text, speechConfig;
    if (c.tags.length < 2) {
      text = 'Say this naturally, as part of a conversation, at a steady pace: ' +
        c.lines.map((l) => l.en).join(' ');
      speechConfig = lib.oneVoice(VOICES[c.tags[0]]);
    } else {
      text = 'Read the following conversation naturally, at a steady pace suitable for an English ' +
        'listening test. Do not add any words of your own.\n\n' +
        c.lines.map((l) => `${l.tag}: ${l.en}`).join('\n');
      speechConfig = lib.twoVoices(c.tags, VOICES);
    }
    process.stdout.write(`  ${i + 1}/${chunks.length} [${c.tags.join(',')}] `);
    parts.push(await tts(text, speechConfig));
    console.log('できました');
  }

  if (!hasFfmpeg()) console.log('  ffmpeg が無いので WAV のまま置きます（容量が大きいので注意）');
  const conv = writeAudio(AUDIO_DIR, id, parts);
  const bytes = fs.statSync(path.join(AUDIO_DIR, conv.name)).size;

  /* 対訳用に1行ずつも作る */
  const clips = await lineClips(set, id, v);

  set.audio = {
    file: `audio/${conv.name}`,
    sec: Math.round(conv.sec * 10) / 10,
    bytes,
    lines: clips,
    model: lib.MODEL,
    madeAt: new Date().toISOString()
  };
  fs.writeFileSync(file, JSON.stringify(set, null, 2) + '\n');
  console.log(`  → data/part3/audio/${conv.name}（${Math.round(bytes / 1024)} KB / ${set.audio.sec} 秒）` +
    ` ＋ 行ごと ${clips.length} 本`);
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
