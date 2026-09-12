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
  var SETTINGS_DEFAULT = { voiceURI: '', rate: 0.95, showJa: false };
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
    /* 米→英→豪→その他の英語 の順で妥当なものを選ぶ */
    function pickDefault() {
      var list = english();
      if (!list.length) return null;
      var order = ['en-US', 'en-GB', 'en-AU', 'en-CA'];
      for (var i = 0; i < order.length; i++) {
        var hit = list.filter(function (v) { return (v.lang || '').replace('_', '-') === order[i]; });
        if (hit.length) {
          var local = hit.filter(function (v) { return v.localService; });
          return (local[0] || hit[0]);
        }
      }
      return list[0];
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
      u.onerror = opts.onerror || function () { if (opts.onend) opts.onend(); };
      try { synth.speak(u); } catch (e) { if (opts.onend) opts.onend(); }
      return u;
    }
    return {
      available: !!synth, onReady: onReady, voices: function () { return cache; },
      english: english, pickDefault: pickDefault, speak: speak, cancel: cancel
    };
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
    Settings: Settings, Vocab: Vocab, Log: Log, TTS: TTS,
    esc: esc, splitWords: splitWords, markupEnglish: markupEnglish, toast: toast
  };
})(window);
