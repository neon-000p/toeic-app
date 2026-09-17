/* Gemini TTS の共通部分。時事英語（make-news-audio.js）と
   Part 3（make-audio.js）の両方から使う。

   ここに置いてあるのは「呼び出し方」と「音声ファイルの作り方」だけで、
   どの教材をどう読むかは呼び出す側が決める。

   API キーは環境変数 GEMINI_API_KEY から取る。リポジトリには置かない。 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HOST = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
const KEY = process.env.GEMINI_API_KEY || '';

const RATE = 24000;   /* 返ってくる PCM は 24kHz モノラル 16bit 固定 */

/* 呼び出しの間隔。無料枠は分あたりの回数が小さい。
   まとめて数十回作るときは、429 で弾かれて待たされるより
   最初から間隔を空けたほうが速く終わる。 */
const GAP = Number(process.env.TTS_GAP_MS || 4000);
const TRIES = 4;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
let last = 0;

/* ---------------- API ---------------- */

async function tts(text, speechConfig) {
  if (!KEY) throw new Error('GEMINI_API_KEY が渡っていません');

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
    try { j = JSON.parse(body); } catch (e) { /* 下でそのまま扱う */ }

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

/* 読み上げに渡す前の下ごしらえ。Ms. のような敬称の点を落とす。
   点を見た合成器はそこを文の終わりと見なし、「Hello, Ms.」で切って、
   そのあとを次の文として続けてしまう。教材の JSON は直さない（画面には
   Ms. と出したい）ので、音声を作るときに送る文字列だけを直す。
   あとに大文字の語が続くときだけ落とすので、文末の St. などは触らない。
   アプリ側の端末読み上げにも同じ処理がある（core.js の TTS.forSpeech）。 */
const TITLE = /\b(Mr|Mrs|Ms|Dr|Prof|Rev|Capt|Lt|Sgt|Jr|Sr)\.(?=\s+([A-Z]|and\b|or\b|&))/g;
const PLACE = /\b(St|Mt)\.(?=\s+[A-Z])/g;
function speechText(text) {
  return String(text == null ? '' : text).replace(TITLE, '$1').replace(PLACE, '$1');
}

/* 1人で読ませる。時事英語の本文や、Part 3 の1行ぶんに使う */
function oneVoice(voiceName) {
  return { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' } } };
}

/* 2人まで。Part 3 の会話に使う */
function twoVoices(tags, voices) {
  return {
    multiSpeakerVoiceConfig: {
      speakerVoiceConfigs: tags.map((t) => ({
        speaker: t, voiceConfig: { prebuiltVoiceConfig: { voiceName: voices[t] || 'Kore' } }
      }))
    }
  };
}

/* ---------------- 音声ファイル ---------------- */

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

/* 声だけなのでモノラル 24kHz で足りる。ビットレートは呼び出す側が決める */
function toMp3(wavPath, mp3Path, kbps) {
  execFileSync('ffmpeg', ['-y', '-i', wavPath, '-ac', '1', '-ar', String(RATE),
    '-codec:a', 'libmp3lame', '-b:a', (kbps || 48) + 'k', mp3Path],
    { stdio: ['ignore', 'ignore', 'pipe'] });
}

/* 前後の無音を削る。文ごと・行ごとのクリップは、そのままだと前後に
   0.3秒ほどの間が入っていて、続けて鳴らすと不自然に空く。
   ffmpeg が無い、あるいはフィルタが通らない環境では、何もせず元のまま残す
   （間が空くだけで、学習はできる）。 */
function trimSilence(file, kbps) {
  if (!hasFfmpeg() || !/\.mp3$/.test(file)) return false;
  const tmp = file.replace(/\.mp3$/, '.trim.mp3');
  const f = 'silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB';
  try {
    execFileSync('ffmpeg', ['-y', '-i', file,
      '-af', f + ',areverse,' + f + ',areverse',
      '-codec:a', 'libmp3lame', '-b:a', (kbps || 48) + 'k', tmp],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 512) { fs.rmSync(tmp, { force: true }); return false; }
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    console.log('  無音の削除に失敗したのでそのままにします（' + (e.message || e).slice(0, 80) + '）');
    return false;
  }
}

/* 生PCM を1本の音声ファイルとして書き出す。ffmpeg があれば MP3 にする。
   戻り値は置いたファイル名（拡張子込み）と長さ。 */
function writeAudio(dir, base, parts, kbps) {
  fs.mkdirSync(dir, { recursive: true });
  const { buf, sec } = wav(parts);
  const wavPath = path.join(dir, `${base}.wav`);
  fs.writeFileSync(wavPath, buf);
  if (!hasFfmpeg()) return { name: `${base}.wav`, sec };
  const mp3Path = path.join(dir, `${base}.mp3`);
  toMp3(wavPath, mp3Path, kbps);
  fs.unlinkSync(wavPath);
  return { name: `${base}.mp3`, sec };
}

module.exports = {
  MODEL, RATE, GAP, KEY,
  sleep, tts, speechText, oneVoice, twoVoices,
  wav, hasFfmpeg, toMp3, writeAudio, trimSilence
};
