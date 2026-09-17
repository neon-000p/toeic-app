#!/usr/bin/env node
/* Part 4 のトーク音声を先に作っておく。
   実行するのは GitHub Actions（.github/workflows/part3-audio.yml）。
   API キーは Secret から環境変数で渡すので、リポジトリには入らない。

   使い方:
     GEMINI_API_KEY=... node tools/make-part4-audio.js --all
     GEMINI_API_KEY=... node tools/make-part4-audio.js data/part4/p4-sample-1.json
     --force を付けると、すでに音声があるセットも作り直す。

   できること:
     data/part4/audio/<id>.mp3       前置き ＋ トークまるごと（設問ステップで流す）
     data/part4/audio/<id>/NN.mp3    1文ずつ（対訳で1文だけ鳴らす用）
     どちらも作り、セットの JSON に audio を書き足す。
     ffmpeg が無い環境では WAV のまま置く（容量が5倍以上になるので注意）。

   Part 3 との違いは、話し手が1人なのでトーク全体が1回の呼び出しで作れること。
   代わりに前置き（"Questions 1 through 3 refer to the following …"）を
   別の声で作り、間を空けて頭に繋ぐ。本番のナレーションと同じ形にするため。 */

'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./tts-lib');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'part4');
const AUDIO_DIR = path.join(DIR, 'audio');

/* 話し手の声。Part 3 と揃えておくと、パートをまたいでも声の印象が変わらない */
const VOICES = { M: 'Puck', W: 'Kore' };
/* 前置きを読むナレーター。話し手と必ず別の声にする */
const NARRATOR = process.env.PART4_NARRATOR_VOICE || 'Charon';
const KBPS = 48;   /* 聞き取りが要なので、時事英語より少し良い音にする */
const GAP_SEC = 0.8;   /* 前置きとトークの間 */

const tts = lib.tts;
const hasFfmpeg = lib.hasFfmpeg;
const toMp3 = (a, b) => lib.toMp3(a, b, KBPS);
const writeAudio = (dir, base, parts) => lib.writeAudio(dir, base, parts, KBPS);

const silence = (sec) => Buffer.alloc(Math.round(lib.RATE * 2 * sec));

const TALKS = {
  announcement: 'announcement', voicemail: 'telephone message', speech: 'speech',
  broadcast: 'broadcast', ad: 'advertisement', tour: 'tour information',
  instructions: 'instructions', meeting: 'excerpt from a meeting', talk: 'talk'
};

function introOf(set) {
  if (set.intro) return set.intro;
  return 'Questions 1 through 3 refer to the following ' + (TALKS[set.talkType] || 'talk') + '.';
}

/* 話し方の指示。種類によって本番の読まれ方が違う */
const STYLE = {
  announcement: 'as a public address announcement',
  voicemail: 'as a voice message left on an answering machine',
  speech: 'as a short speech in front of an audience',
  broadcast: 'as a radio broadcast',
  ad: 'as a radio advertisement',
  tour: 'as a tour guide speaking to a group',
  instructions: 'as a supervisor giving instructions to staff',
  meeting: 'as a speaker at a business meeting',
  talk: 'as a short talk'
};

/* 対訳で1文だけ鳴らすための音声。トーク本体と同じ声を使うので、
   対訳に移った瞬間に声が変わることがなくなる。 */
async function lineClips(set, id, voice) {
  const dir = path.join(AUDIO_DIR, id);
  const out = [];
  for (let i = 0; i < set.lines.length; i++) {
    const l = set.lines[i];
    const base = String(i).padStart(2, '0');
    process.stdout.write(`  文 ${i + 1}/${set.lines.length} `);
    const pcm = await tts('Say this line naturally, at a steady pace: ' + lib.speechText(l.en),
      lib.oneVoice(voice));
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
  const voice = VOICES[(set.speaker || {}).tag] || 'Kore';

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
          set.audio.lines = await lineClips(set, id, voice);
        }
        fs.writeFileSync(file, JSON.stringify(set, null, 2) + '\n');
        return true;
      }
      /* トーク本体はあるが文ごとのクリップが無い場合は、それだけ足す */
      if (!set.audio.lines || !set.audio.lines.length) {
        console.log(`${id}: トークはあるので、文ごとの音声だけ作ります（${set.lines.length}文）`);
        set.audio.lines = await lineClips(set, id, voice);
        fs.writeFileSync(file, JSON.stringify(set, null, 2) + '\n');
        return true;
      }
      console.log(`${id}: すでに音声あり。とばします`);
      return false;
    }
  }
  if (!Array.isArray(set.lines) || !set.lines.length) { console.log(`${id}: lines が無いのでとばします`); return false; }

  console.log(`${id}: ${set.lines.length}文 / ${set.talkType || 'talk'} → ` +
    `前置き1回 + トーク1回 + 文ごと ${set.lines.length}回の呼び出し`);

  process.stdout.write('  前置き ');
  const introPcm = await tts(
    'Read this announcement clearly and neutrally, as the narrator of an English listening test: ' +
    lib.speechText(introOf(set)), lib.oneVoice(NARRATOR));
  console.log('できました');

  process.stdout.write('  トーク ');
  const talkPcm = await tts(
    'Read the following text naturally, at a steady pace suitable for an English listening test, ' +
    (STYLE[set.talkType] || STYLE.talk) + '. Do not add any words of your own.\n\n' +
    lib.speechText(set.lines.map((l) => l.en).join(' ')),
    lib.oneVoice(voice));
  console.log('できました');

  if (!hasFfmpeg()) console.log('  ffmpeg が無いので WAV のまま置きます（容量が大きいので注意）');
  const talk = writeAudio(AUDIO_DIR, id, [introPcm, silence(GAP_SEC), talkPcm]);
  const bytes = fs.statSync(path.join(AUDIO_DIR, talk.name)).size;

  /* 対訳用に1文ずつも作る */
  const clips = await lineClips(set, id, voice);

  set.audio = {
    file: `audio/${talk.name}`,
    sec: Math.round(talk.sec * 10) / 10,
    bytes,
    lines: clips,
    voice,
    narrator: NARRATOR,
    model: lib.MODEL,
    madeAt: new Date().toISOString()
  };
  fs.writeFileSync(file, JSON.stringify(set, null, 2) + '\n');
  console.log(`  → data/part4/audio/${talk.name}（${Math.round(bytes / 1024)} KB / ${set.audio.sec} 秒）` +
    ` ＋ 文ごと ${clips.length} 本`);
  return true;
}

/* ---------------- 入口 ---------------- */

(async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const all = args.includes('--all');
  let files = args.filter((a) => !a.startsWith('--'));

  if (all || !files.length) {
    if (!fs.existsSync(DIR)) { console.log('data/part4/ がありません'); return; }
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
