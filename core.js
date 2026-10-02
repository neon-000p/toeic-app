/* TOEIC 学習アプリ 共通コア
   時事英語 / Part 3〜7 で共有する。設定・語彙帳・学習ログ・読み上げ。
   ES モジュールにしない（file:// で開けなくなるため）。同一オリジンなので
   localStorage は news.html / part3.html / index.html で自動的に共有される。 */
(function (global) {
  'use strict';

  var NS = 'toeic.';
  /* 端末間で同期するキー（下の「端末間の同期」を参照）。API キーやキャッシュは入れない。
     増やすときは Firestore のルール（README）の key の一覧も直す */
  var SYNC_KEYS = ['settings', 'vocab', 'progress', 'days'];

  /* ---------- localStorage（失敗しても落ちない） ---------- */
  function read(key, fallback) {
    try {
      var v = localStorage.getItem(NS + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); }
    catch (e) { return false; }
    /* 端末間で同期するキーなら、送る印を付ける（Sync は下で定義） */
    if (SYNC_KEYS.indexOf(key) !== -1) Sync.touch(key);
    return true;
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

  /* ---------- 品詞の表記 ----------
     時事の語彙ステップと同じ「名／動／形／副／熟」にそろえる。
     語注（glossary）には n / v / adj や「コロケーション」で書かれたものも
     残っているので、表示と語彙帳への登録の前にここを通す。
     複数品詞は「名・動」。知らない書き方はそのまま返す。 */
  var POS_JA = {
    n: '名', noun: '名', '名詞': '名',
    v: '動', verb: '動', '動詞': '動',
    adj: '形', a: '形', adjective: '形', '形容詞': '形',
    adv: '副', adverb: '副', '副詞': '副',
    prep: '前', preposition: '前', '前置詞': '前',
    conj: '接', conjunction: '接', '接続詞': '接',
    pron: '代', pronoun: '代', '代名詞': '代',
    phr: '熟', phrase: '熟', idiom: '熟', phrasal: '熟',
    '熟語': '熟', '句': '熟', 'コロケーション': '熟', collocation: '熟'
  };
  function posJa(pos) {
    var s = String(pos || '').trim();
    if (!s) return '';
    var seen = {}, out = [];
    s.split(/\s*[・\/／,、]\s*/).forEach(function (p) {
      var k = p.replace(/\.$/, '');
      var j = POS_JA[k.toLowerCase()] || POS_JA[k] || k;
      if (j && !seen[j]) { seen[j] = 1; out.push(j); }
    });
    return out.join('・');
  }

  /* ---------- 語注の例文 ----------
     時事の語彙は教材に例文を持つが、Part 3〜7 の語注には無い。
     そこで本文のうち、その語が出てくる最初の文を例文にする。
     keys は語注のキー（本文の表層形）と原形。先に書いたほうを優先する。
     sents は [{ en, ja }]。語の区切りで照合し、部分一致（rate と rater など）は拾わない。 */
  function exampleFor(keys, sents) {
    function norm(s) { return String(s || '').replace(/[‘’]/g, "'"); }
    var list = (sents || []).filter(function (s) { return s && s.en; });
    for (var i = 0; i < keys.length; i++) {
      var k = norm(keys[i]).trim();
      if (!k) continue;
      var re = new RegExp('(^|[^A-Za-z\'-])' +
        k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') +
        '(?![A-Za-z])', 'i');
      for (var j = 0; j < list.length; j++) {
        if (re.test(norm(list[j].en))) return { en: list[j].en, ja: list[j].ja || '' };
      }
    }
    return null;
  }

  /* ---------- 語彙帳 ---------- */
  /* 1件 = { term, pos, ja, gloss, example, src, srcTitle, addedAt, updatedAt, box }
     box は間隔反復の段階（0=未学習）。
     消した語は配列から抜かず { term, deleted: true, updatedAt } を残す（墓標）。
     抜いてしまうと、別の端末と同期したときに消した語が戻ってくるため。
     all() などの外向きの窓口は墓標を見せない。 */
  function nowIso() { return new Date().toISOString(); }
  var Vocab = {
    /* 墓標を含む生の配列。同期と内部の書き換えだけが使う */
    raw: function () { var v = read('vocab', []); return Array.isArray(v) ? v : []; },
    all: function () { return Vocab.raw().filter(function (e) { return e && !e.deleted; }); },
    key: function (term) { return String(term || '').trim().toLowerCase(); },
    has: function (term) {
      var k = Vocab.key(term);
      return Vocab.all().some(function (e) { return Vocab.key(e.term) === k; });
    },
    add: function (entry) {
      var k = Vocab.key(entry.term);
      if (!k) return false;
      if (Vocab.has(entry.term)) return false;
      var t = nowIso();
      var list = Vocab.raw().filter(function (e) { return Vocab.key(e.term) !== k; });  // 墓標は置き換える
      list.push({
        term: entry.term, pos: posJa(entry.pos), ja: entry.ja || '',
        gloss: entry.gloss || '', example: entry.example || null,
        src: entry.src || '', srcTitle: entry.srcTitle || '',
        addedAt: t, updatedAt: t, box: 0
      });
      write('vocab', list);
      return true;
    },
    remove: function (term) {
      var k = Vocab.key(term), t = nowIso(), hit = false;
      var list = Vocab.raw().map(function (e) {
        if (Vocab.key(e.term) !== k || e.deleted) return e;
        hit = true;
        return { term: e.term, deleted: true, addedAt: e.addedAt || '', updatedAt: t };
      });
      if (hit) write('vocab', list);
    },
    /* 1件を部分更新する。復習結果（box と次回の期日）を書き戻すのに使う */
    update: function (term, patch) {
      var k = Vocab.key(term), list = Vocab.raw(), hit = false;
      list.forEach(function (e) {
        if (Vocab.key(e.term) === k && !e.deleted) {
          for (var p in patch) e[p] = patch[p];
          e.updatedAt = nowIso();
          hit = true;
        }
      });
      if (hit) write('vocab', list);
      return hit;
    },
    /* 読み込み（他端末からの取り込み）。同じ語は既存を残す */
    merge: function (incoming) {
      if (!Array.isArray(incoming)) return 0;
      var have = {}, added = 0;
      var list = Vocab.raw().filter(function (e) {
        if (e.deleted) return false;    // 消した語は貼り付けで戻せるよう、墓標を外す
        have[Vocab.key(e.term)] = 1;
        return true;
      });
      var tombs = Vocab.raw().filter(function (e) { return e.deleted; });
      incoming.forEach(function (e) {
        if (!e || !e.term || e.deleted) return;
        var k = Vocab.key(e.term);
        if (have[k]) return;
        have[k] = 1; added++;
        list.push({
          term: e.term, pos: posJa(e.pos), ja: e.ja || '', gloss: e.gloss || '',
          example: e.example || null, src: e.src || '', srcTitle: e.srcTitle || '',
          addedAt: e.addedAt || nowIso(), updatedAt: nowIso(),
          box: e.box || 0, due: e.due || '', reviewedAt: e.reviewedAt || ''
        });
      });
      tombs.forEach(function (e) { if (!have[Vocab.key(e.term)]) list.push(e); });
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
    progress: function (key) {
      var p = read('progress', {})[key];
      return p && !p.deleted ? p : null;
    },
    saveProgress: function (key, patch) {
      var all = read('progress', {});
      var cur = all[key] && !all[key].deleted ? all[key] : {};
      for (var k in patch) cur[k] = patch[k];
      cur.updatedAt = new Date().toISOString();
      all[key] = cur;
      write('progress', all);
      return cur;
    },
    /* 教材の記録を消す。語彙帳と同じく、同期で戻らないよう墓標を残す */
    clearProgress: function (key) {
      var all = read('progress', {});
      if (!all[key]) return;
      all[key] = { deleted: true, updatedAt: new Date().toISOString() };
      write('progress', all);
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

  /* ---------- 端末間の同期（Firebase） ----------
     Google でログインすると、学習記録（settings / vocab / progress / days）を
     Firestore の users/{uid}/data/{キー} に置き、端末をまたいで共有する。
     ログインしなければ今までどおり、この端末の localStorage だけで動く。

     - Gemini の API キーやキャッシュは同期しない（SYNC_KEYS に入れていない）
     - 設定のうち voiceURI は端末ごとに声の一覧が違うので、その端末の値を残す
     - 全体の上書きはしない。キーごとに中身を突き合わせて合わせる
         progress … 教材ごとに updatedAt の新しいほう
         vocab    … 語ごとに updatedAt の新しいほう（消した語は墓標で勝つ）
         days     … 両方を足し合わせる
         settings … 最後に変えた端末のもの
     - 認証だけ Firebase の SDK（compat 版）を使い、読み書きは Firestore の REST で行う。
       Firestore の SDK は 500KB を超え、毎ページ読むには重いため。
       書き込みは「読んだ時点から変わっていなければ」の条件付きにし、
       2台が同時に書いても片方の記録が消えないようにしている。
     - 全部を読み直すのは1分に1回まで。それ以外は変わったキーだけを、読まずに
       条件付きで送る（無料枠の読み込み回数を利用者全員で分け合うため）。

     FIREBASE に値を入れるまでは同期の欄に「未設定」と出るだけで、何もしない。
     値は公開されてよいもの（守りは Firestore のルールで行う）。手順は README。 */
  var FIREBASE = {
    apiKey: 'AIzaSyBTSQB2bwjcVfz-l5UFnmkpRWGQFnDuBqs',
    authDomain: 'toeic-daily-7cea5.firebaseapp.com',
    projectId: 'toeic-daily-7cea5',
    appId: '1:227084784386:web:2674b140fa4b4cec51e81b'
  };
  var FB_SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
  var DEVICE_ONLY = ['voiceURI'];

  /* 突き合わせ。どちらの端末で行っても同じ結果になるよう、並びも決めて返す */
  var Merge = (function () {
    function stamp(e) { return (e && (e.updatedAt || e.reviewedAt || e.addedAt)) || ''; }
    function pick(a, b) {
      var sa = stamp(a), sb = stamp(b);
      if (sa !== sb) return sa > sb ? a : b;
      return JSON.stringify(a) >= JSON.stringify(b) ? a : b;   // 同時刻なら中身の大小で決める
    }
    function obj(x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; }
    function arr(x) { return Array.isArray(x) ? x : []; }
    function shared(s) {
      var out = {};
      Object.keys(obj(s)).sort().forEach(function (k) { if (DEVICE_ONLY.indexOf(k) === -1) out[k] = s[k]; });
      return out;
    }
    return {
      progress: function (l, r) {
        l = obj(l); r = obj(r);
        var out = {}, keys = {};
        Object.keys(l).concat(Object.keys(r)).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).sort().forEach(function (k) {
          out[k] = !(k in r) ? l[k] : !(k in l) ? r[k] : pick(l[k], r[k]);
        });
        return out;
      },
      days: function (l, r) {
        var set = {};
        arr(l).concat(arr(r)).forEach(function (d) { if (typeof d === 'string') set[d] = 1; });
        return Object.keys(set).sort().slice(-400);
      },
      vocab: function (l, r) {
        var by = {};
        arr(l).concat(arr(r)).forEach(function (e) {
          if (!e || !e.term) return;
          var k = Vocab.key(e.term);
          by[k] = by[k] ? pick(by[k], e) : e;
        });
        return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
          var x = String(a.addedAt || ''), y = String(b.addedAt || '');
          if (x !== y) return x < y ? -1 : 1;
          var ka = Vocab.key(a.term), kb = Vocab.key(b.term);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
      },
      /* 設定は丸ごと新しいほう（lAt / rAt は最後に変えた時刻）。
         返すのは端末ごとの項目を除いた部分 */
      settings: function (l, r, lAt, rAt, rExists) {
        return shared(!rExists || lAt > rAt ? l : r);
      },
      shared: shared
    };
  })();

  var Sync = (function () {
    var API = 'https://firestore.googleapis.com/v1/';
    var sdk = null, user = null;
    var timer = 0, running = null, again = false, againFull = false;
    var state = { phase: 'off', msg: '' };
    /* 全部を読み直すのは、前回から1分以上たったときだけ。
       ページを移るたびに4件ずつ読むと、無料枠（読み込み1日5万回）を
       利用者全員で分け合うには多すぎるため。 */
    var FULL_GAP = 60 * 1000;
    var saves = 0, follow = null;

    function available() {
      return !!FIREBASE && typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
    }
    function account() { return read('sync.user', null); }
    function forget(key) { try { localStorage.removeItem(NS + key); } catch (e) {} }
    function emit(name, detail) {
      try { global.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {}
    }
    function setState(phase, msg) {
      state.phase = phase; state.msg = msg || '';
      emit('toeic:syncstate', status());
    }
    function status() {
      return {
        configured: !!FIREBASE, available: available(), account: account(),
        phase: state.phase, msg: state.msg, last: read('sync.last', 0)
      };
    }
    function lastFull() { return read('sync.full', 0) || 0; }
    /* サーバー上の各キーの版（updateTime）。前回の同期のあと誰も書いていなければ、
       読まずに「この版のままなら書く」という条件付きで送れる。
       ほかのアカウントの版を使わないよう uid と一緒に持つ */
    function revGet(key) {
      var r = read('sync.rev', null);
      return r && user && r.uid === user.uid ? (r.t || {})[key] || '' : '';
    }
    function revSet(key, t) {
      if (!user) return;
      var r = read('sync.rev', null);
      if (!r || r.uid !== user.uid) r = { uid: user.uid, t: {} };
      if (t) r.t[key] = t; else delete r.t[key];
      write('sync.rev', r);
    }

    function markDirty(key) {
      var d = read('sync.dirty', {}) || {};
      d[key] = 1;
      write('sync.dirty', d);
    }

    /* write() から呼ばれる。最後に変えた時刻を残し、少し待ってから送る */
    function touch(key) {
      var at = read('sync.at', {}) || {};
      at[key] = Date.now();
      write('sync.at', at);
      if (key === 'progress') saves++;
      if (!account()) return;
      markDirty(key);
      clearTimeout(timer);
      timer = setTimeout(function () { run(false); }, 3000);
    }

    /* ---- SDK（認証だけ） ---- */
    function loadScript(src) {
      return new Promise(function (ok, ng) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = ok;
        s.onerror = function () { ng(new Error('読み込めません: ' + src)); };
        document.head.appendChild(s);
      });
    }
    function loadSdk() {
      if (!sdk) {
        sdk = loadScript(FB_SDK + 'firebase-app-compat.js')
          .then(function () { return loadScript(FB_SDK + 'firebase-auth-compat.js'); })
          .then(function () {
            var fb = global.firebase;
            if (!fb.apps.length) fb.initializeApp(FIREBASE);
            return new Promise(function (ok) {
              var first = true;
              fb.auth().onAuthStateChanged(function (u) {
                var was = user;
                user = u;
                if (u) write('sync.user', { uid: u.uid, email: u.email || '', name: u.displayName || '' });
                else { forget('sync.user'); forget('sync.dirty'); forget('sync.rev'); forget('sync.full'); }
                setState(u ? 'idle' : 'off');
                if (first) { first = false; ok(fb); }
                else if (u && !was) run(true);     // ログインした直後。両方の記録を合わせる
              });
            });
          });
        sdk.catch(function () { sdk = null; });
      }
      return sdk;
    }

    function signIn() {
      if (!available()) return Promise.reject(new Error(FIREBASE ? 'このページでは使えません' : '未設定です'));
      return loadSdk().then(function (fb) {
        var p = new fb.auth.GoogleAuthProvider();
        p.setCustomParameters({ prompt: 'select_account' });
        return fb.auth().signInWithPopup(p).catch(function (e) {
          /* ポップアップが開けない環境だけ、ページ移動式に切り替える */
          if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-environment')) {
            return fb.auth().signInWithRedirect(p);
          }
          throw e;
        });
      });
    }
    /* ログアウトしても、この端末の記録は消さない */
    function signOut() {
      return loadSdk().then(function (fb) { return fb.auth().signOut(); });
    }

    /* ---- Firestore（REST） ---- */
    function docUrl(key) {
      return API + 'projects/' + encodeURIComponent(FIREBASE.projectId) +
        '/databases/(default)/documents/users/' + encodeURIComponent(user.uid) +
        '/data/' + encodeURIComponent(key);
    }
    function api(method, url, token, body) {
      return fetch(url, {
        method: method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) {
        if (r.status === 404 && method === 'GET') return null;
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) {
            var e = new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
            e.status = r.status;
            throw e;
          }
          return j;
        });
      });
    }
    function getDoc(key, token) {
      return api('GET', docUrl(key), token).then(function (j) {
        if (!j) return { exists: false, raw: '', value: undefined, at: 0, updateTime: '' };
        var f = j.fields || {}, raw = (f.v && f.v.stringValue) || '', value;
        try { value = raw ? JSON.parse(raw) : undefined; } catch (e) { value = undefined; }
        return { exists: true, raw: raw, value: value, at: Number((f.at && f.at.integerValue) || 0), updateTime: j.updateTime || '' };
      });
    }
    function putDoc(key, token, raw, at, prev) {
      var cond = prev.exists
        ? 'currentDocument.updateTime=' + encodeURIComponent(prev.updateTime)
        : 'currentDocument.exists=false';
      return api('PATCH', docUrl(key) + '?' + cond, token,
        { fields: { v: { stringValue: raw }, at: { integerValue: String(at) } } });
    }

    function rawLocal(key) {
      try { return localStorage.getItem(NS + key); } catch (e) { return null; }
    }

    /* 手元を送るだけ（読まない）。前回の同期のあとサーバーを誰も書いていなければ、
       手元はサーバーの中身をすでに含んでいるので、合わせ直す必要がない。
       誰かが書いていれば条件が合わずに断られるので、そのときは読んで合わせる */
    function pushOnly(key, token) {
      var rev = revGet(key), local;
      if (!rev) return syncKey(key, token);
      try { local = JSON.parse(rawLocal(key)); } catch (e) { local = undefined; }
      if (local == null) return syncKey(key, token);
      var shared, at;
      if (key === 'settings') {
        shared = Merge.shared(local);
        at = (read('sync.at', {}) || {}).settings || 0;
      } else {
        shared = Merge[key](local, undefined);
        at = Date.now();
      }
      return putDoc(key, token, JSON.stringify(shared), at, { exists: true, updateTime: rev })
        .then(function (j) { revSet(key, j && j.updateTime); return 'same'; }, function (e) {
          if (e.status === 400 || e.status === 409 || e.status === 404) return syncKey(key, token);
          throw e;
        });
    }

    /* 1つのキーを読んで合わせる。結果は 'same' / 'changed'（手元が変わった）/ 'retry' */
    function syncKey(key, token, tries) {
      var before = rawLocal(key), local;
      try { local = before == null ? undefined : JSON.parse(before); } catch (e) { local = undefined; }
      return getDoc(key, token).then(function (rem) {
        var shared, merged, at, mine;
        if (key === 'settings') {
          var lAt = (read('sync.at', {}) || {}).settings || 0;
          shared = Merge.settings(local, rem.value, lAt, rem.at, rem.exists);
          merged = {};
          for (var k in shared) merged[k] = shared[k];
          DEVICE_ONLY.forEach(function (k) { if (local && local[k] !== undefined) merged[k] = local[k]; });
          at = rem.exists && lAt <= rem.at ? rem.at : lAt;
          mine = Merge.shared(local);
        } else {
          shared = merged = Merge[key](local, rem.value);
          at = Date.now();
          mine = Merge[key](local, undefined);
        }
        var raw = JSON.stringify(shared);
        var push = (!rem.exists || raw !== rem.raw)
          ? putDoc(key, token, raw, at, rem)
          : Promise.resolve({ updateTime: rem.updateTime });
        return push.then(function (j) {
          /* 送っている間に手元が書き換わっていたら、手元はそのままにして次の回で合わせる。
             このとき手元はサーバーの中身を含んでいないので、版は覚えない
             （覚えると、次に読まずに送ったとき別の端末の記録を上書きしてしまう） */
          if (rawLocal(key) !== before) { revSet(key, ''); return 'retry'; }
          var next = JSON.stringify(merged);
          if (next !== before) {
            try { localStorage.setItem(NS + key, next); } catch (e) { revSet(key, ''); return 'same'; }
          }
          revSet(key, j && j.updateTime);
          return JSON.stringify(shared) !== JSON.stringify(mine) ? 'changed' : 'same';
        }, function (e) {
          /* 400 / 409 は「読んだあとに別の端末が書いた」。読み直してやり直す */
          if ((e.status === 400 || e.status === 409) && (tries || 0) < 3) return syncKey(key, token, (tries || 0) + 1);
          throw e;
        });
      });
    }

    function run(full) {
      if (!user || !available()) return Promise.resolve();
      if (running) {
        again = true; againFull = againFull || full;
        return running;
      }
      var dirty = read('sync.dirty', {}) || {};
      var keys = full ? SYNC_KEYS.slice() : SYNC_KEYS.filter(function (k) { return dirty[k]; });
      if (!keys.length) return Promise.resolve();
      keys.forEach(function (k) { delete dirty[k]; });
      write('sync.dirty', dirty);
      clearTimeout(timer);
      setState('busy');

      running = user.getIdToken().then(function (token) {
        return Promise.all(keys.map(function (k) {
          return (full ? syncKey(k, token) : pushOnly(k, token)).then(
            function (r) { return { key: k, r: r }; },
            function (e) { markDirty(k); return { key: k, err: e }; });
        }));
      }).then(function (rs) {
        var changed = [], err = null;
        rs.forEach(function (x) {
          if (x.err) err = err || x.err;
          else if (x.r === 'changed') changed.push(x.key);
          else if (x.r === 'retry') { markDirty(x.key); again = true; }
        });
        if (err) throw err;
        write('sync.last', Date.now());
        if (full) write('sync.full', Date.now());
        setState('idle');
        if (changed.length) after(changed);
      }).catch(fail).then(function () {
        running = null;
        if (again) { var f = againFull; again = againFull = false; return run(f); }
      });
      return running;
    }

    function fail(e) {
      var off = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        e instanceof TypeError || (e && e.code === 'auth/network-request-failed');
      setState(off ? 'offline' : 'error',
        off ? 'つながっていません。つながったら送ります' : (e && e.message) || String(e));
    }

    /* ログイン済みの端末で、SDK を読んで全部を合わせる。
       オフラインで開いて SDK を読めなかったときは、つながったときにやり直す */
    function resume() {
      if (!account()) return;
      if (user) { run(false); return; }
      setState('busy');
      loadSdk().then(function () { if (user) run(Date.now() - lastFull() > FULL_GAP); }).catch(fail);
    }

    /* 他の端末の記録が入ったとき。ページは toeic:synced を受けて描き直せる */
    function after(changed) {
      emit('toeic:synced', { changed: changed });
      if (follow && changed.indexOf('progress') !== -1 && saves === follow.saves &&
          JSON.stringify(Log.progress(follow.key)) !== follow.snap) {
        var cb = follow.cb;
        follow = null;
        toast('別の端末の続きから開きます');
        cb();
        return;
      }
      toast('別の端末の記録を取り込みました');
    }

    /* 教材ページが呼ぶ。開いた直後（まだ何も記録していない間）に
       別の端末の進み具合が届いたら、cb で開き直してもらう */
    function followProgress(key, cb) {
      follow = { key: key, cb: cb, saves: saves, snap: JSON.stringify(Log.progress(key)) };
    }

    function init() {
      if (!available()) { setState(FIREBASE ? 'na' : 'off'); return; }
      document.addEventListener('visibilitychange', function () {
        if (!user) return;
        if (document.visibilityState === 'hidden') run(false);
        else if (Date.now() - lastFull() > FULL_GAP) run(true);
      });
      global.addEventListener('online', resume);
      resume();
    }

    return {
      touch: touch, init: init, run: function () { return run(true); },
      signIn: signIn, signOut: signOut, status: status, follow: followProgress,
      _merge: Merge
    };
  })();

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

    var syncHTML =
      '<hr class="sep">' +
      '<h2>端末間の同期</h2>' +
      '<div id="syncBox"></div>';

    return modal(
      voiceHTML + syncHTML + aiHTML +
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

        /* --- 同期 --- */
        var syncBox = bg.querySelector('#syncBox');
        function drawSync() {
          if (!bg.isConnected) { global.removeEventListener('toeic:syncstate', drawSync); return; }
          var st = Sync.status(), html;
          if (!st.configured) {
            html = '<p class="small muted" style="margin:-6px 0 0">まだ使えません。README の「端末間の同期」の手順で ' +
              'Firebase の設定値を <code>core.js</code> に入れると、Google でログインできるようになります。</p>';
          } else if (!st.available) {
            html = '<p class="small muted" style="margin:-6px 0 0">ファイルを直接開いているときは使えません' +
              '（GitHub Pages 上で使えます）。</p>';
          } else if (!st.account) {
            html = '<p class="small muted" style="margin:-6px 0 10px">Google でログインすると、学習記録・語彙帳・設定を' +
              'ほかの端末と共有します。Gemini の API キーは共有しません（端末ごとに入力）。</p>' +
              '<div class="tool-row"><button class="btn btn-sm btn-primary" id="syncIn">Google でログイン</button></div>';
          } else {
            var line = st.phase === 'busy' ? '同期中…'
              : st.phase === 'error' ? '同期できません: ' + esc(st.msg)
              : st.phase === 'offline' ? esc(st.msg)
              : st.last ? '最終同期 ' + esc(new Date(st.last).toLocaleString('ja-JP',
                  { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
              : 'まだ同期していません';
            html = '<p class="small" style="margin:-6px 0 4px">ログイン中: <b>' + esc(st.account.email || st.account.name) + '</b></p>' +
              '<p class="small muted" style="margin:0 0 10px">' + line + '</p>' +
              '<div class="tool-row"><button class="btn btn-sm" id="syncNow">今すぐ同期</button>' +
                '<button class="btn btn-sm" id="syncOut">ログアウト</button></div>' +
              '<p class="small muted" style="margin:8px 0 0">ログアウトしても、この端末の記録は消えません。</p>';
          }
          syncBox.innerHTML = html;
        }
        drawSync();
        global.addEventListener('toeic:syncstate', drawSync);
        syncBox.addEventListener('click', function (e) {
          var id = e.target.id;
          if (id === 'syncIn') {
            e.target.disabled = true;
            Sync.signIn().catch(function (err) {
              e.target.disabled = false;
              if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
              toast('ログインできません: ' + ((err && (err.code || err.message)) || err), 3000);
            });
          } else if (id === 'syncNow') {
            Sync.run();
          } else if (id === 'syncOut') {
            Sync.signOut().then(function () { toast('ログアウトしました'); });
          }
        });

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

    var btn = null, timer = null, mark = null, pick = null, pressing = false;

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
      /* 指で押している間は、選択が消えてもボタンを引っ込めない。
         触れた時点で端末は選択を解除するので、その知らせ（selectionchange）で
         消してしまうと、押し切る前にボタンが無くなる。 */
      btn.addEventListener('pointerdown', function () {
        pressing = true;
        setTimeout(function () { pressing = false; }, 1500);   /* 押しそこねたとき用 */
      });
      /* touchstart で preventDefault してはいけない。指で触ったときに
         click が起きなくなり、ボタンがまったく反応しなくなる。
         マウスのほうは、押した瞬間に選択が消えるのを止めておく。 */
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      btn.addEventListener('click', function () {
        pressing = false;
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
      /* タップで出したボタンと、いま押されているボタンは消さない */
      if (!got) { if (!mark && !pressing) hide(); return; }

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
      /* なぞって選んでいる最中と、選び終えた直後は、その選択のほうを優先する。
         2語以上をなぞると、離した時点の click は語ではなく行そのものに届く。
         ここで引っ込めると、選んだ直後にボタンが消えてしまう。 */
      var sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed) return;
      var w = e.target.closest ? e.target.closest('.w') : null;
      if (!w) { hide(); return; }

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

    function later(ms) {
      clearTimeout(timer);
      timer = setTimeout(fromSelection, ms);
    }

    document.addEventListener('selectionchange', function () { later(150); });

    /* なぞり終わりをここでも拾う。Edge はマウスを離したあとに selectionchange を
       出さないことがあり、それだけに任せるとボタンが出ないまま終わる。 */
    document.addEventListener('mouseup', function () { later(60); });
    document.addEventListener('touchend', function () { later(60); });

    /* スクロールでは消さずに置き直す。Edge は選択を確定した直後にわずかに
       スクロールすることがあり、消す作りだと出したそばから消えていた。
       指した語句が画面の外へ出たときだけ引っ込める。 */
    function follow() {
      if (!btn || pressing) return;
      var rect = null;
      if (mark) rect = mark.getBoundingClientRect();
      else {
        var got = selectionText();
        if (got) rect = got.range.getBoundingClientRect();
      }
      if (!rect || !rect.width) return;
      if (rect.bottom < 0 || rect.top > document.documentElement.clientHeight) { hide(); return; }
      if (pick) pick.rect = rect;
      place(rect, !mark);
    }
    window.addEventListener('scroll', follow, true);
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

    /* 時事の語彙ステップと同じ並び。見出しの後ろに（品詞）、次の行に訳、その下に補足 */
    function posHTML(pos) {
      var p = posJa(pos);
      return p ? '（' + esc(p) + '）' : '';
    }
    var glossHTML = g
      ? '<div class="ja">' + esc(g.ja) + '</div>' +
        (g.note ? '<div class="note">' + esc(g.note) + '</div>' : '')
      : '<div class="note">この語句の語注はありません。</div>';

    pop.innerHTML = '<div class="term">' + esc(text) +
        '<span class="vpos">' + (ok ? '' : posHTML(g && g.pos)) + '</span></div>' +
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
          (res.ja ? '<div class="ja">' + esc(res.ja) + '</div>' : '') +
          (res.tip ? '<div class="pop-ai-u">' + esc(res.tip) + '</div>' : '');
        pop.querySelector('.term .vpos').innerHTML = posHTML(res.pos);
        pop.dataset.ja = res.ja || '';
        pop.dataset.pos = res.pos || '';
        pop.dataset.tip = res.tip || '';
      }).catch(function (e) {
        var b = pop.querySelector('.pop-ai-b');
        pop.querySelector('.term .vpos').innerHTML = posHTML(g && g.pos);
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
          Vocab.add({ term: term, pos: pop.dataset.pos || (g && g.pos) || '', ja: pop.dataset.ja || (g && g.ja) || '',
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
    Settings: Settings, Vocab: Vocab, Log: Log, TTS: TTS, AI: AI, posJa: posJa, exampleFor: exampleFor,
    modal: modal, openSettings: openSettings,
    flash: flash, takeFlash: takeFlash, numberSets: numberSets, build: build,
    watchSelection: watchSelection, phrasePop: phrasePop,
    esc: esc, splitWords: splitWords, markupEnglish: markupEnglish, toast: toast,
    Sync: Sync
  };

  Sync.init();
})(window);
