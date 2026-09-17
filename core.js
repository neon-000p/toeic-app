/* TOEIC 学習アプリ 共通コア
   時事英語 / Part 3〜7 で共有する。設定・語彙帳・学習ログ・読み上げ。
   ES モジュールにしない（file:// で開けなくなるため）。同一オリジンなので
   localStorage は news.html / part3.html / index.html で自動的に共有される。 */
(function (global) {
  'use strict';

  var NS = 'toeic.';

  /* ---------- localStorage（失敗しても落ちない） ---------- */
  function read(key, fallback) {
    try {
      var v = localStorage.getItem(NS + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* ---------- 設定 ---------- */
  var SETTINGS_DEFAULT = { voiceURI: '', rate: 1, showJa: false, vocabJa: true };
  var Settings = {
    all: function () {
      var s = read('settings', {}) || {};
      var out = {};
      for (var k in SETTINGS_DEFAULT) out[k] = SETTINGS_DEFAULT[k];
      /* 既定値に無いキーも保存されていれば返す。
         以前は SETTINGS_DEFAULT にある分しか返さず、新しく足した設定が
         保存しても読み出せない状態になっていた。 */
      for (var k2 in s) if (s[k2] !== undefined) out[k2] = s[k2];
      return out;
    },
    get: function (k) { return Settings.all()[k]; },
    set: function (k, v) { var s = Settings.all(); s[k] = v; write('settings', s); }
  };

  /* ---------- 語彙帳 ---------- */
  /* 1件 = { term, pos, ja, gloss, example, src, srcTitle, addedAt, box }
     box は将来の間隔反復用（0=未学習）。いまは記録だけしておく。 */
  var Vocab = {
    all: function () { var v = read('vocab', []); return Array.isArray(v) ? v : []; },
    key: function (term) { return String(term || '').trim().toLowerCase(); },
    has: function (term) {
      var k = Vocab.key(term);
      return Vocab.all().some(function (e) { return Vocab.key(e.term) === k; });
    },
    add: function (entry) {
      var list = Vocab.all(), k = Vocab.key(entry.term);
      if (!k) return false;
      if (list.some(function (e) { return Vocab.key(e.term) === k; })) return false;
      list.push({
        term: entry.term, pos: entry.pos || '', ja: entry.ja || '',
        gloss: entry.gloss || '', example: entry.example || null,
        src: entry.src || '', srcTitle: entry.srcTitle || '',
        addedAt: new Date().toISOString(), box: 0
      });
      write('vocab', list);
      return true;
    },
    remove: function (term) {
      var k = Vocab.key(term);
      write('vocab', Vocab.all().filter(function (e) { return Vocab.key(e.term) !== k; }));
    },
    /* 1件を部分更新する。復習結果（box と次回の期日）を書き戻すのに使う */
    update: function (term, patch) {
      var k = Vocab.key(term), list = Vocab.all(), hit = false;
      list.forEach(function (e) {
        if (Vocab.key(e.term) === k) { for (var p in patch) e[p] = patch[p]; hit = true; }
      });
      if (hit) write('vocab', list);
      return hit;
    },
    /* 読み込み（他端末からの取り込み）。同じ語は既存を残す */
    merge: function (incoming) {
      if (!Array.isArray(incoming)) return 0;
      var list = Vocab.all(), have = {}, added = 0;
      list.forEach(function (e) { have[Vocab.key(e.term)] = 1; });
      incoming.forEach(function (e) {
        if (!e || !e.term) return;
        var k = Vocab.key(e.term);
        if (have[k]) return;
        have[k] = 1; added++;
        list.push({
          term: e.term, pos: e.pos || '', ja: e.ja || '', gloss: e.gloss || '',
          example: e.example || null, src: e.src || '', srcTitle: e.srcTitle || '',
          addedAt: e.addedAt || new Date().toISOString(),
          box: e.box || 0, due: e.due || '', reviewedAt: e.reviewedAt || ''
        });
      });
      write('vocab', list);
      return added;
    },
    count: function () { return Vocab.all().length; }
  };

  /* ---------- 学習ログ ---------- */
  function todayKey(d) {
    d = d || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  var Log = {
    todayKey: todayKey,
    /* 教材ごとの進捗 key 例 "news:2026-09-12" */
    progress: function (key) { return read('progress', {})[key] || null; },
    saveProgress: function (key, patch) {
      var all = read('progress', {});
      var cur = all[key] || {};
      for (var k in patch) cur[k] = patch[k];
      cur.updatedAt = new Date().toISOString();
      all[key] = cur;
      write('progress', all);
      return cur;
    },
    /* 学習した日を記録し、連続日数を返す */
    touchToday: function () {
      var days = read('days', []);
      var t = todayKey();
      if (days.indexOf(t) === -1) { days.push(t); days.sort(); write('days', days.slice(-400)); }
      return Log.streak();
    },
    streak: function () {
      var days = read('days', []);
      if (!days.length) return 0;
      var set = {}; days.forEach(function (d) { set[d] = 1; });
      var n = 0, cur = new Date();
      if (!set[todayKey(cur)]) cur.setDate(cur.getDate() - 1); // 今日まだなら昨日から数える
      while (set[todayKey(cur)]) { n++; cur.setDate(cur.getDate() - 1); }
      return n;
    }
  };

  /* ---------- 読み上げ ---------- */
  var TTS = (function () {
    var ready = false, cache = [], waiting = [];
    var synth = global.speechSynthesis;

    function load() {
      if (!synth) return;
      var v = synth.getVoices();
      if (v && v.length) {
        cache = v; ready = true;
        waiting.splice(0).forEach(function (fn) { fn(cache); });
      }
    }
    if (synth) {
      load();
      if (!ready && typeof synth.addEventListener === 'function') {
        synth.addEventListener('voiceschanged', load);
      }
      // Android Chrome は voiceschanged が来ないことがあるので保険
      var tries = 0;
      var t = setInterval(function () { load(); if (ready || ++tries > 20) clearInterval(t); }, 250);
    }

    function onReady(fn) { if (ready) fn(cache); else waiting.push(fn); }
    function english() {
      return cache.filter(function (v) { return /^en(-|_|$)/i.test(v.lang || ''); });
    }
    /* 音声の品質を名前から推し量って点数化する。
       Edge/Windows では高品質な Natural 系がオンライン音声として提供され、
       端末内にあるのは旧 SAPI（... Desktop）なので、localService を
       優先すると逆に品質が落ちる。判断材料は名前に置く。 */
    var LOCALE_BONUS = { 'en-US': 20, 'en-GB': 14, 'en-AU': 8, 'en-CA': 6, 'en-IE': 4, 'en-NZ': 4 };
    function score(v) {
      var n = v.name || '', lang = (v.lang || '').replace('_', '-'), s = 0;
      if (/natural/i.test(n)) s += 100;        // Microsoft ... (Natural)
      else if (/online/i.test(n)) s += 70;     // Edge のオンライン音声
      else if (/google/i.test(n)) s += 40;     // Android/Chrome の標準
      if (/desktop/i.test(n)) s -= 60;         // 旧 SAPI。機械的で聞き取りにくい
      if (/compact|espeak/i.test(n)) s -= 40;
      s += (LOCALE_BONUS[lang] !== undefined ? LOCALE_BONUS[lang] : 2);
      return s;
    }
    /* 品質の高い順に並べた英語音声 */
    function ranked() {
      return english().slice().sort(function (a, b) { return score(b) - score(a); });
    }
    function pickDefault() { return ranked()[0] || null; }
    /* 設定画面に出す品質の表示 */
    function label(v) {
      if (/natural/i.test(v.name || '')) return '自然音声';
      return v.localService ? '端末内' : '通信';
    }
    /* ---- Part 3 用：話者ごとに別の声を割り当てる ----
       Edge のように名前で性別が分かる音声はそれに従い、Android のように
       ロケール名しか持たない音声では高さ（pitch）で作り分ける。
       accent はデータ側の指定（en-US / en-GB / en-AU）。TOEIC が4か国の
       発音を混ぜるので、聞き分けの練習としてもそこに寄せる。 */
    var FEMALE_NAME = /aria|jenny|michelle|sonia|libby|maisie|natasha|emma|clara|neerja|ava|nova|zira|hazel|susan|catherine|linda|female/i;
    var MALE_NAME = /guy|ryan|brian|eric|steffan|roger|davis|tony|andrew|christopher|jason|william|liam|david|mark|george|male/i;

    function genderOf(v) {
      var n = v.name || '';
      if (FEMALE_NAME.test(n)) return 'f';
      if (MALE_NAME.test(n)) return 'm';
      return '';
    }

    /* speakers: [{ tag, accent }] を渡すと { tag: {voiceURI, pitch} } を返す */
    function speakerPlan(speakers) {
      var list = ranked(), used = {}, plan = {};
      var over = Settings.all().p3voice || {};

      (speakers || []).forEach(function (sp) {
        var tag = sp.tag || 'M';
        if (over[tag]) {
          used[over[tag]] = 1;
          plan[tag] = { voiceURI: over[tag], pitch: 1 };
          return;
        }
        var want = tag.charAt(0).toUpperCase() === 'W' ? 'f' : 'm';
        var acc = (sp.accent || '').replace('_', '-');
        var byAccent = acc ? list.filter(function (v) { return (v.lang || '').replace('_', '-') === acc; }) : [];

        function pick(pool) {
          var free = pool.filter(function (v) { return !used[v.voiceURI]; });
          return free[0] || null;
        }
        var v = pick(byAccent.filter(function (x) { return genderOf(x) === want; })) ||
                pick(byAccent) ||
                pick(list.filter(function (x) { return genderOf(x) === want; })) ||
                pick(list) ||
                byAccent[0] || list[0] || null;

        if (!v) { plan[tag] = { voiceURI: '', pitch: 1 }; return; }
        used[v.voiceURI] = 1;
        plan[tag] = { voiceURI: v.voiceURI, pitch: genderOf(v) ? 1 : (want === 'f' ? 1.22 : 0.85) };
      });
      return plan;
    }

    function resolve(uri) {
      if (uri) {
        var hit = cache.filter(function (v) { return v.voiceURI === uri; })[0];
        if (hit) return hit;
      }
      return pickDefault();
    }
    function cancel() { if (synth) { try { synth.cancel(); } catch (e) {} } }
    /* 読み上げに渡す前の下ごしらえ。Ms. のような敬称の点を落とす。
       点を見た合成器はそこを文の終わりと見なし、「Hello, Ms.」で切って
       そのあとを次の文として続けてしまう（本物の文末では切らなくなる）。
       画面の表示は変えない。読み上げに送る文字列だけを直す。
       あとに大文字の語が続くときだけ落とすので、文末の St. などは触らない。 */
    var TITLE = /\b(Mr|Mrs|Ms|Dr|Prof|Rev|Capt|Lt|Sgt|Jr|Sr)\.(?=\s+([A-Z]|and\b|or\b|&))/g;
    var PLACE = /\b(St|Mt)\.(?=\s+[A-Z])/g;
    function forSpeech(text) {
      return String(text == null ? '' : text).replace(TITLE, '$1').replace(PLACE, '$1');
    }

    /* speak(text, {rate, voiceURI, pitch, onend, onerror})
       音声一覧がまだ届いていない状態で喋らせると、声が無いまま失敗して
       onend が即座に呼ばれる。連続再生だと全部の行が一瞬で流れてしまうので、
       一覧が来るまで待ってから喋る。 */
    function speak(text, opts) {
      if (!synth || !text) { if (opts && opts.onend) opts.onend(); return null; }
      if (!ready && !cache.length) {
        var fired = false;
        var go = function () { if (fired) return; fired = true; doSpeak(text, opts); };
        onReady(go);
        setTimeout(go, 2500);   /* 一覧が来ない端末でも詰まらないように */
        return null;
      }
      return doSpeak(text, opts);
    }

    function doSpeak(text, opts) {
      opts = opts || {};
      cancel();
      var u = new SpeechSynthesisUtterance(forSpeech(text));
      var v = resolve(opts.voiceURI !== undefined ? opts.voiceURI : Settings.get('voiceURI'));
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
      u.rate = opts.rate || 1;
      u.pitch = opts.pitch || 1;
      if (opts.onend) u.onend = opts.onend;
      u.onerror = function (e) {
        var why = (e && e.error) || '';
        /* cancel() 由来は失敗ではないので何もしない */
        if (why === 'canceled' || why === 'interrupted') return;
        /* 通信音声が鳴らなかった場合（オフライン等）は端末内の音声で1度だけやり直す */
        if (!opts._retried && v && !v.localService) {
          var fallback = ranked().filter(function (x) { return x.localService; })[0];
          if (fallback) {
            opts._retried = true;
            opts.voiceURI = fallback.voiceURI;
            doSpeak(text, opts);
            return;
          }
        }
        if (opts.onerror) opts.onerror(e);
        else if (opts.onend) opts.onend();
      };
      try { synth.speak(u); } catch (e) { if (opts.onend) opts.onend(); }
      return u;
    }
    return {
      available: !!synth, onReady: onReady, voices: function () { return cache; },
      english: english, ranked: ranked, label: label,
      speakerPlan: speakerPlan, forSpeech: forSpeech,
      pickDefault: pickDefault, speak: speak, cancel: cancel
    };
  })();

  /* ---------- Gemini（語の文脈的な意味） ----------
     API キーはこの端末の localStorage にだけ置く。リポジトリは公開なので
     キーを同梱することはできない。Google Cloud 側で HTTP リファラを
     この Pages のドメインに制限しておくと、漏れたときの被害を抑えられる。 */
  var AI = (function () {
    var HOST = 'https://generativelanguage.googleapis.com/v1beta';
    var CACHE_MAX = 600;

    function cfg() {
      var c = read('gemini', {}) || {};
      return { key: c.key || '', model: c.model || 'gemini-3.5-flash' };
    }
    function setCfg(patch) {
      var c = cfg();
      for (var k in patch) c[k] = patch[k];
      write('gemini', c);
    }
    function enabled() { return !!cfg().key; }

    function cacheGet(k) { var c = read('gemini.cache', {}); return c[k] || null; }
    function cachePut(k, v) {
      var c = read('gemini.cache', {}) || {};
      c[k] = v;
      var keys = Object.keys(c);
      if (keys.length > CACHE_MAX) {
        keys.sort(function (a, b) { return (c[a].at || 0) - (c[b].at || 0); });
        keys.slice(0, keys.length - CACHE_MAX).forEach(function (x) { delete c[x]; });
      }
      write('gemini.cache', c);
    }

    /* 400 の details には、どのフィールドが悪いかが入っていることがある */
    function fieldsOf(j) {
      var det = (j && j.error && j.error.details) || [], out = [];
      for (var i = 0; i < det.length; i++) {
        if (!/BadRequest/.test(String(det[i]['@type'] || ''))) continue;
        var fv = det[i].fieldViolations || [];
        for (var k = 0; k < fv.length; k++) {
          out.push(String(fv[k].field || '') + (fv[k].description ? ': ' + fv[k].description : ''));
        }
      }
      return out.length ? ' / ' + out.join(' / ') : '';
    }

    function call(path, body) {
      var c = cfg();
      if (!c.key) return Promise.reject(new Error('APIキーが未設定です'));
      return fetch(HOST + path, {
        method: body ? 'POST' : 'GET',
        headers: body
          ? { 'Content-Type': 'application/json', 'x-goog-api-key': c.key }
          : { 'x-goog-api-key': c.key },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = JSON.parse(t); } catch (e) {}
          if (!r.ok) {
            var msg = (j && j.error && j.error.message) || (r.status + ' ' + r.statusText);
            /* 400 はキーの問題とは限らない。リクエストの書き方をモデルが受け付けないときも
               同じ 400 で返る。ここで「キーが無効」と決めつけると原因を見失う。 */
            var keyBad = false;
            if (r.status === 401 || r.status === 403 || /api[ _-]?key/i.test(msg)) {
              keyBad = true;
              msg = 'キーが無効か権限がありません（' + msg + '）';
            } else if (r.status === 400) {
              msg = 'リクエストが通りませんでした（' + msg + fieldsOf(j) + '）';
            }
            if (r.status === 404) msg = 'モデル名が違うようです（' + msg + '）';
            var wait = 0;
            if (r.status === 429) {
              /* 429 は details に「どの枠に当たったか」と「何秒待てばよいか」が入っている。
                 ここを拾わないと、枠自体が無いのか呼びすぎただけなのかが区別できない。 */
              var det = (j && j.error && j.error.details) || [], q = [];
              for (var di = 0; di < det.length; di++) {
                var ty = String(det[di]['@type'] || '');
                if (/QuotaFailure/.test(ty)) {
                  var vs = det[di].violations || [];
                  for (var vi = 0; vi < vs.length; vi++) {
                    q.push(String(vs[vi].quotaId || vs[vi].quotaMetric || '') +
                      (vs[vi].quotaValue !== undefined ? '=' + vs[vi].quotaValue : ''));
                  }
                }
                if (/RetryInfo/.test(ty)) wait = parseFloat(String(det[di].retryDelay || '').replace('s', '')) || 0;
              }
              msg = '回数・割当の上限です（' + msg + (q.length ? ' / ' + q.join(', ') : '') +
                (wait ? ' / ' + wait + '秒待つ' : '') + '）';
            }
            var err = new Error(msg);
            err.status = r.status;
            err.keyBad = keyBad;
            err.retryAfter = wait;
            throw err;
          }
          return j;
        });
      });
    }

    /* generateContent が使えるモデルの一覧 */
    function models() {
      return call('/models').then(function (j) {
        return ((j && j.models) || [])
          .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
          .map(function (m) { return { id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || '' }; });
      });
    }

    /* ---- 応答の取り出し（lookup と翻訳で共用） ---- */

    /* 思考の断片（thought）は混ぜない。parts が複数に割れて返ることがあるので全部つなぐ */
    function pick(j) {
      var c = j && j.candidates && j.candidates[0];
      var parts = (c && c.content && c.content.parts) || [];
      var text = parts.filter(function (x) { return x && x.text && !x.thought; })
                      .map(function (x) { return x.text; }).join('');
      return { text: text, finish: (c && c.finishReason) || '' };
    }
    /* responseMimeType を指定していてもコードブロックで返ることがある */
    function unfence(t) {
      t = String(t || '').trim();
      var m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
      return m ? m[1].trim() : t;
    }

    /* 考える枠の書き方はモデルによって違う。thinkingBudget: 0 を受け付けないモデルは
       400（Request contains an invalid argument.）を返すので、書き方を落としながら試す。
       短い JSON を返すだけなので、考える枠は少ないほど速くて安い。
         think 'budget': thinkingConfig.thinkingBudget = 0
         think 'low'   : thinkingConfig.thinkingLevel = 'low'
         think なし    : 指定しない（モデルの既定に任せる）
         plain         : JSON 指定も外し、素のテキストとして受けて自力で解釈する */
    var MODES = [{ think: 'budget' }, { think: 'low' }, {}, { plain: true }];

    /* 通った書き方はモデルごとに覚えておく。毎回1回目から試すと、
       受け付けないモデルでは呼び出しを1回ぶん無駄にしてしまう。 */
    function modeStart() {
      var m = read('gemini.mode', {}) || {};
      var i = m[cfg().model];
      return (typeof i === 'number' && i >= 0 && i < MODES.length) ? i : 0;
    }
    function modeRemember(i) {
      var m = read('gemini.mode', {}) || {};
      if (m[cfg().model] === i) return;
      m[cfg().model] = i;
      write('gemini.mode', m);
    }
    /* 覚えた書き方でも駄目だったら忘れる。次はまた1回目から試す */
    function modeForget() {
      var m = read('gemini.mode', {}) || {};
      if (m[cfg().model] === undefined) return;
      delete m[cfg().model];
      write('gemini.mode', m);
    }

    /* 1回ぶんの呼び出し。条件を変えながら generate から呼ばれる。
       maxOutputTokens は内部の思考でも消費されるため、余裕を持たせる。 */
    function genOnce(prompt, maxTokens, mode) {
      var gc = { temperature: 0.2, maxOutputTokens: maxTokens || 2048 };
      if (!mode.plain) gc.responseMimeType = 'application/json';
      if (mode.think === 'budget') gc.thinkingConfig = { thinkingBudget: 0 };
      else if (mode.think === 'low') gc.thinkingConfig = { thinkingLevel: 'low' };
      return call('/models/' + encodeURIComponent(cfg().model) + ':generateContent', {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: gc
      }).then(pick);
    }

    /* JSON で答えさせる。

       考えるモデルは、考えただけで本文を返さずに終わることがある
       （finishReason は STOP なのに中身が空）。同じ条件で引き直しても
       同じ結果になりやすいので、MODES の条件を変えながら試す。
       400 で弾かれたときも、書き方が合わないだけなので次の条件へ進む。
       キー・割当・モデル名の誤りは何度投げても同じなので、そこで止める。 */
    function generate(prompt, maxTokens, isOk) {
      var lastFinish = '', lastErr = null;

      function run(i) {
        if (i >= MODES.length) {
          modeForget();
          return Promise.reject(lastErr || new Error('答えが返りませんでした' +
            (lastFinish ? '（' + lastFinish + '／' + cfg().model + '）' : '（' + cfg().model + '）')));
        }
        return genOnce(prompt, maxTokens, MODES[i]).then(function (got) {
          if (got.finish) lastFinish = got.finish;
          var obj = null;
          try { obj = JSON.parse(unfence(got.text)); } catch (e) {}
          if (obj && (!isOk || isOk(obj))) { modeRemember(i); return obj; }
          lastErr = null;   /* 返ってはきたので、前の 400 より「空で返った」を伝える */
          return run(i + 1);
        }, function (err) {
          if (err && err.status === 400 && !err.keyBad) { lastErr = err; return run(i + 1); }
          /* 考える枠の指定を受け付けないモデルもある。その場合は外して続ける */
          if (/thinking|thought/i.test((err && err.message) || '')) { lastErr = err; return run(i + 1); }
          throw err;
        });
      }
      return run(modeStart());
    }

    /* 語と、それが入っている英文を渡して、意味と TOEIC 向けの一言を得る。
       構文の説明（「主語である」等）は読めば分かるので求めない。
       点に直結するのは言い換えとコロケーションなので、そこに絞る。 */
    function lookup(word, sentence, scope) {
      var key = 'v2|' + (scope || '') + '|' + String(word).toLowerCase() + '|' + String(sentence || '').slice(0, 60);
      var hit = cacheGet(key);
      if (hit) return Promise.resolve(hit);

      var prompt =
        'TOEIC 学習者向けに、次の英文に出てくる語を説明してください。\n\n' +
        '語: ' + word + '\n' +
        '英文: ' + sentence + '\n\n' +
        '出力は下記のキーを持つ JSON だけにしてください。\n' +
        '- pos: 品詞。名/動/形/副/前/接/熟 のいずれか\n' +
        '- ja: この英文での意味。多義語ならこの文に当てはまる意味だけを書く。20字以内\n' +
        '- tip: TOEIC で再会したときに効くことを1つだけ。45字以内。' +
        '次の優先順で、最も価値の高いものを選ぶ。\n' +
        '  1. 言い換え（本文と選択肢で置き換わりやすい同義語）。例「≒ increase, rise」\n' +
        '  2. よく使う形（コロケーション・語法・とる前置詞）。例「raise rates ⇔ cut rates」\n' +
        '  3. 紛らわしい語との違い。例「rise は自動詞、raise は他動詞」\n' +
        '重要: 固有名詞や、中学レベルで多義でもない語のように、書くべきことが無い場合は ' +
        'tip を空文字にしてください。無理に埋めないこと。' +
        '構文上の役割（主語・目的語など）の説明は読めば分かるので書かないこと。';

      return generate(prompt, 2048, function (o) { return o.ja || o.tip; })
        .then(function (o) {
          var out = { pos: o.pos || '', ja: o.ja || '', tip: o.tip || '', at: Date.now() };
          cachePut(key, out);
          return out;
        });
    }

    /* ---- 音声合成（Gemini TTS） ----
       返るのは 24kHz モノラル 16bit の生PCM。WAV ヘッダーを付けて鳴らす。
       複数話者は1回の呼び出しで最大2人までなので、3人以上は1行ずつ作って繋ぐ。
       アクセント（米・英・豪）は指定できない。 */

    var TTS_MODEL = 'gemini-3.1-flash-tts-preview';
    var TTS_VOICES = { M: 'Puck', W: 'Kore', M2: 'Charon', W2: 'Leda' };
    var PCM_RATE = 24000;

    function ttsCfg() {
      var c = read('gemini', {}) || {};
      return {
        model: c.ttsModel || TTS_MODEL,
        voices: c.ttsVoices || TTS_VOICES
      };
    }

    function b64ToBytes(b64) {
      var s = atob(b64), n = s.length, out = new Uint8Array(n);
      for (var i = 0; i < n; i++) out[i] = s.charCodeAt(i);
      return out;
    }

    /* 生PCM の断片をつないで WAV にする */
    function wavBlob(parts) {
      var total = parts.reduce(function (n, p) { return n + p.length; }, 0);
      var buf = new ArrayBuffer(44 + total);
      var dv = new DataView(buf);
      function str(o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
      var ch = 1, bits = 16;
      str(0, 'RIFF'); dv.setUint32(4, 36 + total, true); str(8, 'WAVE');
      str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
      dv.setUint16(22, ch, true); dv.setUint32(24, PCM_RATE, true);
      dv.setUint32(28, PCM_RATE * ch * bits / 8, true);
      dv.setUint16(32, ch * bits / 8, true); dv.setUint16(34, bits, true);
      str(36, 'data'); dv.setUint32(40, total, true);
      var u8 = new Uint8Array(buf), off = 44;
      parts.forEach(function (p) { u8.set(p, off); off += p.length; });
      return new Blob([buf], { type: 'audio/wav' });
    }

    /* TTS は無料枠だと分あたりの回数がごく小さい。連続で投げると 429 になるので、
       呼び出しの間隔を空け、それでも詰まったら API が言う秒数だけ待って1度やり直す。 */
    var TTS_GAP = 1500;
    var ttsLast = 0;

    function sleep(ms) {
      return new Promise(function (res) { setTimeout(res, ms); });
    }

    function ttsOnce(text, speechConfig) {
      return sleep(Math.max(0, TTS_GAP - (Date.now() - ttsLast))).then(function () {
        ttsLast = Date.now();
        return call('/models/' + encodeURIComponent(ttsCfg().model) + ':generateContent', {
          contents: [{ parts: [{ text: text }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: speechConfig }
        });
      }).then(function (j) {
        var c = j && j.candidates && j.candidates[0];
        var parts = (c && c.content && c.content.parts) || [];
        var d = null;
        parts.forEach(function (pt) { if (!d && pt && pt.inlineData && pt.inlineData.data) d = pt.inlineData.data; });
        if (!d) throw new Error('音声が返りませんでした' + (c && c.finishReason ? '（' + c.finishReason + '）' : ''));
        return b64ToBytes(d);
      });
    }

    function ttsCall(text, speechConfig) {
      return ttsOnce(text, speechConfig).catch(function (e) {
        if (!e || e.status !== 429) throw e;
        return sleep(Math.max(e.retryAfter || 0, 8) * 1000).then(function () {
          return ttsOnce(text, speechConfig);
        });
      });
    }

    /* 会話を「同時に出てくる話者が2人までのかたまり」に切る。
       1回の呼び出しで指定できる声は2人までなので、3人会話でも
       1行ずつではなくこの単位で作れば呼び出し回数がぐっと減る。 */
    function chunkBySpeaker(lines) {
      var out = [], cur = [], seen = [];
      lines.forEach(function (l) {
        if (seen.indexOf(l.tag) < 0 && seen.length >= 2) {
          out.push({ lines: cur, tags: seen });
          cur = []; seen = [];
        }
        if (seen.indexOf(l.tag) < 0) seen.push(l.tag);
        cur.push(l);
      });
      if (cur.length) out.push({ lines: cur, tags: seen });
      return out;
    }

    function chunkAudio(chunk, voices) {
      /* 話者が1人だけのかたまりは multiSpeaker が使えないので単独指定にする */
      if (chunk.tags.length < 2) {
        return ttsCall('Say this naturally, as part of a conversation, at a steady pace: ' +
          TTS.forSpeech(chunk.lines.map(function (l) { return l.en; }).join(' ')),
          { voiceConfig: { prebuiltVoiceConfig: { voiceName: voices[chunk.tags[0]] || 'Kore' } } });
      }
      return ttsCall(
        'Read the following conversation naturally, at a steady pace suitable for an English listening test. ' +
        'Do not add any words of your own.\n\n' +
        chunk.lines.map(function (l) { return l.tag + ': ' + TTS.forSpeech(l.en); }).join('\n'),
        {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: chunk.tags.map(function (t) {
              return { speaker: t, voiceConfig: { prebuiltVoiceConfig: { voiceName: voices[t] || 'Kore' } } };
            })
          }
        });
    }

    /* lines: [{tag, en}] → WAV の Blob。onProgress(done, total) で進み具合を知らせる */
    function conversationAudio(lines, speakers, onProgress) {
      var v = ttsCfg().voices;
      var report = onProgress || function () {};
      var chunks = chunkBySpeaker(lines || []);
      var out = [];

      report(0, chunks.length);
      return chunks.reduce(function (chain, c, i) {
        return chain.then(function () {
          return chunkAudio(c, v).then(function (b) {
            out.push(b);
            report(i + 1, chunks.length);
          });
        });
      }, Promise.resolve()).then(function () { return wavBlob(out); });
    }

    /* 何回の呼び出しになるか。試聴の前に画面に出す */
    function audioCalls(lines) {
      return chunkBySpeaker(lines || []).length;
    }

    /* 背景解説（日本語）を英語に書き直す。段落ごとの配列で返す。
       一度訳したら端末に残すので、同じ教材で2度目は通信しない。 */
    function toEnglish(texts, scope) {
      var store = read('gemini.bg', {}) || {};
      var k = String(scope || '') + '|' + texts.length;
      if (store[k] && store[k].length === texts.length) return Promise.resolve(store[k]);

      var prompt =
        'TOEIC 学習者向けの読み物として、次の日本語の解説を英語に書き直してください。\n\n' +
        '条件:\n' +
        '- 直訳ではなく、同じ内容を自然な英語で書く\n' +
        '- 1文の平均は18語前後。関係代名詞は1文に1つまで。解説だからといって難しくしない\n' +
        '- 段落の数と順番は変えない。1つの段落を分割も結合もしない\n' +
        '- 固有名詞と数字はそのまま使う\n\n' +
        '出力は、各段落の英文を順番に並べた JSON 配列だけ。前後に説明を付けないこと。\n' +
        '例: ["First paragraph in English.", "Second paragraph in English."]\n\n' +
        texts.map(function (t, i) { return '[' + (i + 1) + ']\n' + t; }).join('\n\n');

      return generate(prompt, 4096, function (o) { return Array.isArray(o) && o.length === texts.length; })
        .then(function (arr) {
          store[k] = arr;
          write('gemini.bg', store);
          return arr;
        });
    }

    return { cfg: cfg, setCfg: setCfg, enabled: enabled, models: models, lookup: lookup,
             toEnglish: toEnglish, ttsCfg: ttsCfg, wavBlob: wavBlob, conversationAudio: conversationAudio,
             audioCalls: audioCalls };

  })();

  /* ---------- 画面部品（全ページ共有） ---------- */

  function modal(html, onMount) {
    var bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal">' + html + '</div>';
    bg.addEventListener('click', function (e) { if (e.target === bg) bg.remove(); });
    document.body.appendChild(bg);
    if (onMount) onMount(bg);
    return bg;
  }

  /* 音声と Gemini の設定。どのページからも同じものを開く。
     ページ固有の項目は extraHTML / extraButtons / onMount で足す。 */
  function openSettings(opts) {
    opts = opts || {};
    var s = Settings.all();

    var voiceHTML =
      '<h2>設定</h2>' +
      '<label class="field"><span>読み上げの音声</span>' +
        '<select id="cfgVoice"><option value="">自動で選ぶ</option></select></label>' +
      '<div class="small muted" id="cfgVoiceInfo" style="margin:-6px 0 12px"></div>' +
      '<label class="field"><span>速度 <b id="cfgRateV">' + Number(s.rate).toFixed(2) + '</b></span>' +
        '<input type="range" id="cfgRate" min="0.6" max="1.2" step="0.05" value="' + s.rate + '"></label>' +
      '<div class="tool-row"><button class="btn btn-sm" id="cfgTest">🔊 テスト再生</button></div>';

    var aiHTML =
      '<hr class="sep">' +
      '<h2>語の意味（Gemini）</h2>' +
      '<p class="small muted" style="margin:-6px 0 10px">語をタップしたとき、その文での使われ方を Gemini に尋ねます。' +
        '背景の英訳にも使います。キーは<b>この端末にだけ</b>保存され、GitHub には入りません。' +
        'Google Cloud 側で HTTP リファラを <code>neon-000p.github.io</code> に制限しておくと安全です。</p>' +
      '<label class="field"><span>API キー</span>' +
        '<input type="password" id="gKey" placeholder="AIza…" autocomplete="off" value="' + esc(AI.cfg().key) + '"></label>' +
      '<label class="field"><span>モデル</span><select id="gModel"></select></label>' +
      '<div class="tool-row"><button class="btn btn-sm" id="gFetch">モデル一覧を取得</button>' +
        '<button class="btn btn-sm" id="gTest">動作テスト</button>' +
        '<button class="btn btn-sm" id="gClear">キーを消す</button></div>' +
      '<div class="small muted" id="gInfo" style="margin-top:8px"></div>';

    return modal(
      voiceHTML + aiHTML +
      (opts.extraHTML ? '<hr class="sep">' + opts.extraHTML : '') +
      '<hr class="sep">' +
      '<div class="tool-row">' + (opts.extraButtons || '') +
        '<button class="btn btn-sm" id="cfgClose">閉じる</button></div>',
      function (bg) {
        /* --- 音声 --- */
        var sel = bg.querySelector('#cfgVoice');
        TTS.onReady(function () {
          var list = TTS.ranked();
          list.forEach(function (v) {
            var o = document.createElement('option');
            o.value = v.voiceURI;
            o.textContent = v.name + '（' + v.lang + '・' + TTS.label(v) + '）';
            if (v.voiceURI === s.voiceURI) o.selected = true;
            sel.appendChild(o);
          });
          var auto = TTS.pickDefault();
          bg.querySelector('#cfgVoiceInfo').innerHTML =
            list.length
              ? '品質の高い順に並べています。自動では <b>' + esc(auto ? auto.name : '') + '</b> を使います。' +
                '<br>通信が不安定な場所で使うなら「端末内」の音声を選んでおくと確実です。'
              : '英語の音声が見つかりません。端末の音声データを確認してください。';
        });
        sel.onchange = function () { Settings.set('voiceURI', sel.value); };

        var rate = bg.querySelector('#cfgRate');
        rate.oninput = function () {
          Settings.set('rate', parseFloat(rate.value));
          bg.querySelector('#cfgRateV').textContent = parseFloat(rate.value).toFixed(2);
        };
        bg.querySelector('#cfgTest').onclick = function () {
          TTS.speak('The shipment will arrive at the warehouse on Friday.', { rate: Settings.get('rate') });
        };

        /* --- Gemini --- */
        var gKey = bg.querySelector('#gKey'),
            gModel = bg.querySelector('#gModel'),
            gInfo = bg.querySelector('#gInfo');

        function fillModels(list) {
          var cur = AI.cfg().model;
          gModel.innerHTML = '';
          if (!list.some(function (m) { return m.id === cur; })) {
            list = [{ id: cur, label: '（現在の設定）' }].concat(list);
          }
          list.forEach(function (m) {
            var o = document.createElement('option');
            o.value = m.id;
            o.textContent = m.id + (m.label ? '　' + m.label : '');
            if (m.id === cur) o.selected = true;
            gModel.appendChild(o);
          });
        }
        fillModels([]);

        gKey.onchange = function () {
          AI.setCfg({ key: gKey.value.trim() });
          gInfo.textContent = gKey.value.trim() ? 'キーを保存しました。' : 'キーを消しました。';
        };
        gModel.onchange = function () { AI.setCfg({ model: gModel.value }); };
        bg.querySelector('#gFetch').onclick = function () {
          AI.setCfg({ key: gKey.value.trim() });
          gInfo.textContent = '取得中…';
          AI.models().then(function (list) {
            fillModels(list);
            gInfo.textContent = list.length + ' 件のモデルが使えます。flash 系が速くて安価です。';
          }).catch(function (e) { gInfo.textContent = '取得できません: ' + (e.message || e); });
        };
        bg.querySelector('#gTest').onclick = function () {
          AI.setCfg({ key: gKey.value.trim(), model: gModel.value });
          gInfo.textContent = 'テスト中…';
          AI.lookup('hike', 'A Reuters poll of 68 economists found that 97% now expect a hike.', 'test')
            .then(function (r) { gInfo.textContent = 'OK: hike（' + r.pos + '）' + r.ja + (r.tip ? ' ／ ' + r.tip : ''); })
            .catch(function (e) { gInfo.textContent = '失敗: ' + (e.message || e); });
        };
        bg.querySelector('#gClear').onclick = function () {
          AI.setCfg({ key: '' }); gKey.value = ''; gInfo.textContent = 'キーを消しました。';
        };

        if (opts.onMount) opts.onMount(bg);
        bg.querySelector('#cfgClose').onclick = function () { bg.remove(); };
      }
    );
  }

  /* ---------- 版の印 ----------
     tools/bump-assets.js が各ページの <meta name="app-build"> に書き込む。
     ホームに小さく出して、push した内容が配信されたかを目で確かめるため。 */
  function build() {
    var m = document.querySelector('meta[name="app-build"]');
    var v = m && m.getAttribute('content');
    return v && v !== 'dev' ? v : 'dev';
  }

  /* ---------- ユーティリティ ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* 英文を「語」と「それ以外」に分解する。奇数番目が語。 */
  function splitWords(text) {
    return String(text || '').split(/([A-Za-z][A-Za-z'’-]*)/);
  }
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* 1語ずつ包む。語注の見出しと一致する語には印を付ける */
  function markupWords(text, glossary) {
    var parts = splitWords(text), out = '';
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var w = parts[i], k = w.toLowerCase();
        var hit = glossary && Object.prototype.hasOwnProperty.call(glossary, k);
        out += '<span class="w' + (hit ? ' has-gloss' : '') + '" data-w="' + esc(k) +
               '" data-raw="' + esc(w) + '">' + esc(w) + '</span>';
      } else {
        out += esc(parts[i]);
      }
    }
    return out;
  }

  /* 英文を語注つき HTML にする。glossary のキーは小文字表層形。

     語注の半分以上は `put together` のような2語以上のまとまりなので、
     1語ずつ包むだけだと、その見出しにタップで届かない（put を押しても
     「語注はありません」になる）。先にまとまりを丸ごと1つの塊として包み、
     残りを1語ずつ包む。長い見出しから先に当てるので、`at no charge` の中の
     `charge` だけが別に拾われることはない。 */
  function markupEnglish(text, glossary) {
    var keys = glossary
      ? Object.keys(glossary).filter(function (k) { return /\s/.test(k); })
      : [];
    if (!keys.length) return markupWords(text, glossary);

    keys.sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp('(' + keys.map(reEsc).join('|') + ')', 'gi');
    var src = String(text || ''), out = '', last = 0, m;

    while ((m = re.exec(src))) {
      var head = src.charAt(m.index - 1), tail = src.charAt(m.index + m[0].length);
      /* 語の途中に当たった場合は見送る（`no charge` が `nothing charge` を拾う等） */
      if (/[A-Za-z]/.test(head) || /[A-Za-z]/.test(tail)) continue;
      out += markupWords(src.slice(last, m.index), glossary);
      out += '<span class="w has-gloss phrase" data-w="' + esc(m[0].toLowerCase()) +
             '" data-raw="' + esc(m[0]) + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + markupWords(src.slice(last), glossary);
  }
  /* 教材に通し番号を振る。古いものから 1、2、… とし、返すのは新しい順。
     index.json に no があればそれを使う（あとから過去分を足しても番号がずれない）。
     ホームと一覧ページで同じ番号を出すため、ここに置いて共有する。 */
  function numberSets(items) {
    var list = (items || []).slice();
    var key = function (x) { return (x.date || '') + ' ' + (x.time || '') + ' ' + (x.id || ''); };
    list.sort(function (a, b) { return key(a).localeCompare(key(b)); });
    list.forEach(function (it, i) { if (!it.no) it.no = i + 1; });
    list.reverse();
    return list;
  }

  /* ================= 選択して意味を引く =================
     単語は1タップで引けるが、熟語はタップでは指せない。
     文中をなぞって選ぶと「意味」のボタンが浮き、押すと語注と同じ形で出る。

     単語タップとは競合しない。選択が残っている間は、各ページ側で
     タップを無視するようにしている。 */

  var SEL_MIN = 2;      /* これより短い選択は相手にしない */
  var SEL_MAX = 60;     /* 段落ごと投げられても意味が薄く、通信も無駄 */

  function selectionText() {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var text = String(sel).replace(/\s+/g, ' ').trim();
    if (text.length < SEL_MIN || text.length > SEL_MAX) return null;
    if (!/[A-Za-z]/.test(text)) return null;
    return { text: text, range: sel.getRangeAt(0) };
  }

  /* 語義を文脈つきで引くために渡す1文。和訳や小さな注は落とす */
  function textOf(host) {
    var c = host.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('.j, .tag, .small, .muted, .hint'),
      function (x) { x.remove(); });
    return (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  }

  /* 選択した場所の1文。語義を文脈つきで引くために渡す */
  function contextOfRange(range, selector) {
    var n = range.commonAncestorContainer;
    if (n.nodeType !== 1) n = n.parentNode;
    var host = n.closest ? n.closest(selector) : null;
    if (!host) return String(range).replace(/\s+/g, ' ').trim();
    var c = host.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('.j, .small, .muted, .hint'), function (x) { x.remove(); });
    return (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  }

  /* root の中で語をタップするか、なぞって選ぶと「意味」のボタンを出す。
     押して初めて語義を引く。触れただけで出てしまうと、引くつもりのない語で
     照会が走る（通信も消費する）ので、必ずこのボタンを1つ挟む。
     opts: { ctx: 文を探すセレクタ, onPick: function (text, ctx, rect) } */
  function watchSelection(root, opts) {
    if (!root || root.dataset.selWatch) return;
    root.dataset.selWatch = '1';

    var btn = null, timer = null, mark = null, pick = null;

    function hide() {
      if (mark) { mark.classList.remove('open'); mark = null; }
      if (btn) { btn.remove(); btn = null; }
      pick = null;
    }

    /* ボタンは、指した語句のそばに出す。離れた場所に出ると、何について
       聞いているのかが分からなくなるため。

       ただし、なぞって選んだときは端末の選択メニュー（翻訳・コピー・共有）が
       選択のすぐ上か下に出る。ブラウザが描くもので重なり順を指定できないので、
       ぶつからない側へ回り込む。どのページも上にヘッダーが貼り付いていて、
       本文はその下からしか始まらない。つまり選択の上には必ず余裕があり、
       端末のメニューはほぼ必ず上に出るので、こちらは下に置けばぶつからない。
       語をタップしたときはメニューが出ないので、読みの流れを遮らない上に置く。 */
    var GAP = 10;   /* 語句とボタンの間 */
    var EDGE = 8;   /* 画面の端との間 */

    function place(rect, hasMenu) {
      var vw = document.documentElement.clientWidth;
      var vh = document.documentElement.clientHeight;
      var h = btn.offsetHeight || 36;
      var w = btn.offsetWidth || 96;
      var above = rect.top - h - GAP;
      var below = rect.bottom + GAP;
      var fitsAbove = above >= EDGE;
      var fitsBelow = below + h <= vh - EDGE;
      var top;

      if (hasMenu) top = fitsBelow ? below : above;
      else top = fitsAbove ? above : below;

      top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
      var left = Math.max(EDGE, Math.min(rect.left + rect.width / 2 - w / 2, vw - w - EDGE));

      btn.style.position = 'fixed';
      btn.style.bottom = '';
      btn.style.right = '';
      btn.style.top = top + 'px';
      btn.style.left = left + 'px';
    }

    function ensure() {
      if (btn) return;
      btn = document.createElement('button');
      btn.className = 'sel-btn';
      btn.type = 'button';
      btn.innerHTML = '<span>意味</span><span class="sw"></span>';
      /* 押した瞬間に選択が消えないようにする */
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      btn.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
      btn.addEventListener('click', function () {
        if (!pick) { hide(); return; }
        var got = pick;
        hide();
        if (opts && opts.onPick) opts.onPick(got.text, got.ctx, got.rect);
      });
      document.body.appendChild(btn);
    }

    /* text をボタンに載せて出す。押されたときに onPick へ渡すものを覚えておく。
       hasMenu: なぞって選んだとき（端末の選択メニューが出ている）は true */
    function offer(text, ctx, rect, hasMenu) {
      ensure();
      pick = { text: text, ctx: ctx, rect: rect };
      btn.querySelector('.sw').textContent = text;
      place(rect, hasMenu);
    }

    /* なぞって選んだとき */
    function fromSelection() {
      var got = selectionText();
      /* タップで出したボタンは、選択が無いからといって消さない */
      if (!got) { if (!mark) hide(); return; }

      var n = got.range.commonAncestorContainer;
      if (n.nodeType !== 1) n = n.parentNode;
      if (!root.contains(n)) { hide(); return; }

      var rect = got.range.getBoundingClientRect();
      if (!rect || !rect.width) { hide(); return; }

      if (mark) { mark.classList.remove('open'); mark = null; }
      offer(got.text, contextOfRange(got.range, (opts && opts.ctx) || 'p, div'), rect, true);
    }

    /* 語（または語注の見出しになっているまとまり）をタップしたとき。
       ここでは語義を出さない。ボタンを出すところまで。 */
    root.addEventListener('click', function (e) {
      var w = e.target.closest ? e.target.closest('.w') : null;
      if (!w) { hide(); return; }
      /* なぞって選んでいる最中は、その選択のほうを優先する */
      var sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed) return;

      var same = (mark === w);
      hide();
      if (same) return;   /* 同じ語をもう一度押したら引っ込める */
      mark = w;
      w.classList.add('open');
      var host = w.closest((opts && opts.ctx) || 'p, div');
      var ctx = host ? textOf(host) : (w.dataset.raw || w.textContent);
      offer(w.dataset.raw || w.textContent, ctx, w.getBoundingClientRect(), false);
    });

    /* 画面の他の場所を触ったら引っ込める */
    document.addEventListener('click', function (e) {
      if (!btn) return;
      if (e.target.closest('.sel-btn') || root.contains(e.target)) return;
      hide();
    }, true);

    document.addEventListener('selectionchange', function () {
      clearTimeout(timer);
      timer = setTimeout(fromSelection, 150);
    });
    window.addEventListener('scroll', hide, true);
  }

  /* 選んだ語句の意味をポップで出す。語注にあればそれも使う。
     opts: { text, ctx, rect, scope, gloss } */
  function phrasePop(opts) {
    var text = opts.text;
    var g = opts.gloss || null;
    var inBook = Vocab.has(text);
    var ok = AI.enabled();

    var pop = document.createElement('div');
    pop.className = 'pop';
    pop.dataset.word = text;

    var glossHTML = g
      ? '<div class="ja">' + (g.pos ? '<span class="muted small">(' + esc(g.pos) + ') </span>' : '') + esc(g.ja) + '</div>' +
        (g.note ? '<div class="note">' + esc(g.note) + '</div>' : '')
      : '<div class="note">この語句の語注はありません。</div>';

    pop.innerHTML = '<div class="term">' + esc(text) + '</div>' +
      (ok ? '<div class="pop-ai-b muted small">照会中…</div>'
          : glossHTML + '<div class="pop-hint">⚙ で Gemini のキーを設定すると、この文での使われ方も出ます。</div>') +
      '<div class="row">' +
        '<button class="btn btn-sm icon' + (inBook ? ' on' : '') + '" data-add="' + esc(text) + '" title="' +
          (inBook ? '語彙帳から外す' : '語彙帳に追加') + '">' + (inBook ? '★' : '☆') + '</button>' +
        '<button class="btn btn-sm icon" data-sayw="' + esc(text) + '" title="発音を聞く">🔊</button>' +
      '</div>';
    document.body.appendChild(pop);

    var r = opts.rect;
    var top = r.bottom + window.scrollY + 8;
    var left = Math.min(r.left + window.scrollX,
      window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 12);
    pop.style.top = top + 'px';
    pop.style.left = Math.max(window.scrollX + 12, left) + 'px';

    if (ok) {
      AI.lookup(text, opts.ctx || text, opts.scope || '').then(function (res) {
        var b = pop.querySelector('.pop-ai-b');
        if (!b) return;
        b.className = 'pop-ai-b';
        b.innerHTML =
          (res.ja ? '<div class="pop-ai-ja">' + (res.pos ? '<span class="muted small">(' + esc(res.pos) + ') </span>' : '') +
            esc(res.ja) + '</div>' : '') +
          (res.tip ? '<div class="pop-ai-u">' + esc(res.tip) + '</div>' : '');
        pop.dataset.ja = res.ja || '';
        pop.dataset.pos = res.pos || '';
        pop.dataset.tip = res.tip || '';
      }).catch(function (e) {
        var b = pop.querySelector('.pop-ai-b');
        if (b) b.outerHTML = glossHTML +
          '<div class="pop-hint">' + esc((e && e.message) || '取得できませんでした') + '</div>';
      });
    }

    function close() {
      pop.remove();
      document.removeEventListener('click', outside, true);
    }
    function outside(e) {
      if (pop.contains(e.target)) return;
      close();
    }
    setTimeout(function () { document.addEventListener('click', outside, true); }, 0);

    pop.addEventListener('click', function (e) {
      var add = e.target.closest('[data-add]');
      if (add) {
        var term = add.dataset.add;
        if (Vocab.has(term)) { Vocab.remove(term); toast('語彙帳から外しました'); }
        else {
          Vocab.add({ term: term, pos: pop.dataset.pos || '', ja: pop.dataset.ja || (g && g.ja) || '',
                      gloss: pop.dataset.tip || (g && g.note) || '',
                      src: opts.scope || '', srcTitle: opts.srcTitle || '' });
          toast('語彙帳に追加しました');
        }
        close();
        return;
      }
      var say = e.target.closest('[data-sayw]');
      if (say) { TTS.cancel(); TTS.speak(say.dataset.sayw, { rate: 0.85 }); }
    });

    return pop;
  }

  function toast(msg, ms) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, ms || 1600);
  }

  /* ページをまたいで一度だけ出す短い知らせ。
     Finish のあとホームに戻り、そこで「Done」を出すために使う。
     タブを閉じたら消えてよいので sessionStorage に置く。 */
  function flash(msg) {
    try { sessionStorage.setItem('toeic.flash', msg); } catch (e) {}
  }
  function takeFlash() {
    try {
      var m = sessionStorage.getItem('toeic.flash');
      if (m) sessionStorage.removeItem('toeic.flash');
      return m || '';
    } catch (e) { return ''; }
  }

  global.TOEIC = {
    read: read, write: write,
    Settings: Settings, Vocab: Vocab, Log: Log, TTS: TTS, AI: AI,
    modal: modal, openSettings: openSettings,
    flash: flash, takeFlash: takeFlash, numberSets: numberSets, build: build,
    watchSelection: watchSelection, phrasePop: phrasePop,
    esc: esc, splitWords: splitWords, markupEnglish: markupEnglish, toast: toast
  };
})(window);
