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
  var SETTINGS_DEFAULT = { voiceURI: '', rate: 1, showJa: false };
  var Settings = {
    all: function () {
      var s = read('settings', {});
      var out = {};
      for (var k in SETTINGS_DEFAULT) out[k] = (s && s[k] !== undefined) ? s[k] : SETTINGS_DEFAULT[k];
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
    function resolve(uri) {
      if (uri) {
        var hit = cache.filter(function (v) { return v.voiceURI === uri; })[0];
        if (hit) return hit;
      }
      return pickDefault();
    }
    function cancel() { if (synth) { try { synth.cancel(); } catch (e) {} } }
    /* speak(text, {rate, voiceURI, onend, onerror}) */
    function speak(text, opts) {
      if (!synth || !text) { if (opts && opts.onend) opts.onend(); return null; }
      opts = opts || {};
      cancel();
      var u = new SpeechSynthesisUtterance(text);
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
            speak(text, opts);
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
            if (r.status === 400 || r.status === 401 || r.status === 403) msg = 'キーが無効か権限がありません（' + msg + '）';
            if (r.status === 404) msg = 'モデル名が違うようです（' + msg + '）';
            if (r.status === 429) msg = '呼び出し回数の上限に達しました';
            throw new Error(msg);
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

      /* 応答から本文だけを拾う。思考の断片（thought）は混ぜない。
         parts が複数に割れて返ることがあるので全部つなぐ。 */
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

      function ask(isRetry) {
        return call('/models/' + encodeURIComponent(cfg().model) + ':generateContent', {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            /* 内部の思考でトークンを使い切ると本文が空で返るため、多めに取る */
            maxOutputTokens: 2048,
            responseMimeType: 'application/json'
          }
        }).then(function (j) {
          var got = pick(j);
          var obj = null;
          try { obj = JSON.parse(unfence(got.text)); } catch (e) {}
          var out = obj ? { pos: obj.pos || '', ja: obj.ja || '', tip: obj.tip || '' } : null;
          if (!out || (!out.ja && !out.tip)) {
            /* まれに空で返るので1度だけ引き直す */
            if (!isRetry) return ask(true);
            throw new Error('応答が空でした' + (got.finish ? '（' + got.finish + '）' : ''));
          }
          out.at = Date.now();
          cachePut(key, out);
          return out;
        });
      }
      return ask(false);
    }

    return { cfg: cfg, setCfg: setCfg, enabled: enabled, models: models, lookup: lookup };
  })();

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
  /* 英文を語注つき HTML にする。glossary のキーは小文字表層形。 */
  function markupEnglish(text, glossary) {
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
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  global.TOEIC = {
    read: read, write: write,
    Settings: Settings, Vocab: Vocab, Log: Log, TTS: TTS, AI: AI,
    esc: esc, splitWords: splitWords, markupEnglish: markupEnglish, toast: toast
  };
})(window);
