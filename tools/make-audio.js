#!/usr/bin/env node
/* Part 3 の会話音声を先に作っておく。
   実行するのは GitHub Actions（.github/workflows/part3-audio.yml）。
   API キーは Secret から環境変数で渡すので、リポジトリには入らない。

   使い方:
     GEMINI_API_KEY=... node tools/make-audio.js --all
     GEMINI_API_KEY=... node tools/make-audio.js data/part3/p3-sample-1.json
     --force を付けると、すでに音声があるセットも作り直す。

   できること:
     data/part3/audio/<id>.mp3 を作り、セットの JSON に audio を書き足す。
     ffmpeg が無い環境では WAV のまま置く（容量が5倍以上になるので注意）。 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'part3');
const AUDIO_DIR = path.join(DIR, 'audio');

const HOST = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
const KEY = process.env.GEMINI_API_KEY || '';

const VOICES = { M: 'Puck', W: 'Kore', M2: 'Charon', W2: 'Leda' };
const RATE = 24000;          /* 返ってくる PCM は 24kHz モノラル 16bit 固定 */
const GAP = 1500;            /* 呼び出しの間隔。無料枠は分あたりの回数が小さい */
const TRIES = 4;             /* 429 のときのやり直し回数 */

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
let last = 0;

/* ---------------- API ---------------- */

async function tts(text, speechConfig) {
  for (let n = 1; ; n++) {
    await sleep(Math.max(0, GAP - (Date.now() - last)));
    last = Date.now();

    const r = await fetch(`${HOST}/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig }
      })
    });

    const body = await r.text();
    let j = null;
    try { j = JSON.parse(body); } catch (e) { /* そのまま下で扱う */ }

    if (r.ok) {
      const parts = j?.candidates?.[0]?.content?.parts || [];
      const d = parts.find((p) => p?.inlineData?.data)?.inlineData?.data;
      if (d) return Buffer.from(d, 'base64');
      throw new Error(`音声が返らなかった（${j?.candidates?.[0]?.finishReason || '理由不明'}）`);
    }

    const msg = j?.error?.message || `${r.status} ${r.statusText}`;
    if (r.status !== 429 || n >= TRIES) throw new Error(`${r.status}: ${msg}`);

    /* 429 は details に「何秒待て」が入っている。無ければ様子を見て延ばす */
    const det = j?.error?.details || [];
    const info = det.find((d) => /RetryInfo/.test(String(d['@type'] || '')));
    const wait = Math.max(parseFloat(String(info?.retryDelay || '').replace('s', '')) || 0, 10 * n);
    console.log(`  429。${wait} 秒待ってやり直します（${n}/${TRIES - 1}）`);
    await sleep(wait * 1000);
  }
}

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

function wav(parts) {
  const pcm = Buffer.concat(parts);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);            /* PCM */
  h.writeUInt16LE(1, 22);            /* モノラル */
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);     /* 1秒あたりのバイト数 */
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return { buf: Buffer.concat([h, pcm]), sec: pcm.length / (RATE * 2) };
}

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}

/* 会話は声だけなので、モノラル 24kHz・48kbps で足りる */
function toMp3(wavPath, mp3Path) {
  execFileSync('ffmpeg', ['-y', '-i', wavPath, '-ac', '1', '-ar', String(RATE),
    '-codec:a', 'libmp3lame', '-b:a', '48k', mp3Path], { stdio: ['ignore', 'ignore', 'pipe'] });
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
        return true;
      }
      console.log(`${id}: すでに音声あり。とばします`);
      return false;
    }
  }
  if (!Array.isArray(set.lines) || !set.lines.length) { console.log(`${id}: lines が無いのでとばします`); return false; }

  const chunks = chunkBySpeaker(set.lines);
  console.log(`${id}: ${set.lines.length}行 / 話者${(set.speakers || []).length}人 → ${chunks.length}回の呼び出し`);

  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    let text, speechConfig;
    if (c.tags.length < 2) {
      text = 'Say this naturally, as part of a conversation, at a steady pace: ' +
        c.lines.map((l) => l.en).join(' ');
      speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[c.tags[0]] || 'Kore' } } };
    } else {
      text = 'Read the following conversation naturally, at a steady pace suitable for an English ' +
        'listening test. Do not add any words of your own.\n\n' +
        c.lines.map((l) => `${l.tag}: ${l.en}`).join('\n');
      speechConfig = {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: c.tags.map((t) => ({
            speaker: t, voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[t] || 'Kore' } }
          }))
        }
      };
    }
    process.stdout.write(`  ${i + 1}/${chunks.length} [${c.tags.join(',')}] `);
    parts.push(await tts(text, speechConfig));
    console.log('できました');
  }

  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const { buf, sec } = wav(parts);
  const wavPath = path.join(AUDIO_DIR, `${id}.wav`);
  fs.writeFileSync(wavPath, buf);

  let out = `${id}.wav`;
  if (hasFfmpeg()) {
    const mp3Path = path.join(AUDIO_DIR, `${id}.mp3`);
    toMp3(wavPath, mp3Path);
    fs.unlinkSync(wavPath);
    out = `${id}.mp3`;
  } else {
    console.log('  ffmpeg が無いので WAV のまま置きます（容量が大きいので注意）');
  }

  const bytes = fs.statSync(path.join(AUDIO_DIR, out)).size;
  set.audio = {
    file: `audio/${out}`,
    sec: Math.round(sec * 10) / 10,
    bytes,
    model: MODEL,
    madeAt: new Date().toISOString()
  };
  fs.writeFileSync(file, JSON.stringify(set, null, 2) + '\n');
  console.log(`  → data/part3/audio/${out}（${Math.round(bytes / 1024)} KB / ${set.audio.sec} 秒）`);
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
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .map((f) => path.join(DIR, f));
  } else {
    files = files.map((f) => path.resolve(ROOT, f));
  }

  if (!files.length) { console.log('対象のセットがありません'); return; }
  if (!KEY) {
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
