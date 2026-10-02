/* 端末間の同期（core.js の Sync）を、2台の端末と偽の Firestore で確かめる。
   ブラウザも Firebase も使わない。core.js をそのまま読み、
   localStorage・fetch・firebase（認証）だけを差し替える。

   使い方: リポジトリのルートで
     node tools/test-sync.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8')
  .replace(/var FIREBASE = (null|\{[^}]*\});/,
    "var FIREBASE = { apiKey: 'k', authDomain: 'x.firebaseapp.com', projectId: 'proj', appId: 'a' };");
assert(/projectId: 'proj'/.test(SRC), 'FIREBASE の差し替えに失敗');

/* ---- 偽の Firestore（REST） ---- */
function makeServer() {
  const docs = {};          // path → { raw, at, updateTime }
  let clock = 0;
  const failNext = {};      // path → 回数（条件付き書き込みをわざと失敗させる）
  const log = [];
  function fetch(url, opt) {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname.replace(/^\/v1\/projects\/proj\/databases\/\(default\)\/documents\//, ''));
    const reply = (status, body) => Promise.resolve({
      status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body)
    });
    if (opt.headers.Authorization !== 'Bearer tok-' + p.split('/')[1]) return reply(403, { error: { message: 'denied' } });
    log.push(opt.method + ' ' + p);
    if (api.hook) api.hook(opt.method, p);   // 通信の途中で何かを起こしたいテスト用
    if (opt.method === 'GET') {
      const d = docs[p];
      if (!d) return reply(404, {});
      return reply(200, { fields: { v: { stringValue: d.raw }, at: { integerValue: String(d.at) } }, updateTime: d.updateTime });
    }
    if (opt.method === 'PATCH') {
      if (failNext[p]) { failNext[p]--; return reply(400, { error: { message: 'FAILED_PRECONDITION' } }); }
      const d = docs[p];
      const ut = u.searchParams.get('currentDocument.updateTime');
      const ex = u.searchParams.get('currentDocument.exists');
      if (ex === 'false' && d) return reply(409, { error: { message: 'ALREADY_EXISTS' } });
      if (ut && (!d || d.updateTime !== ut)) return reply(400, { error: { message: 'FAILED_PRECONDITION' } });
      const body = JSON.parse(opt.body);
      docs[p] = { raw: body.fields.v.stringValue, at: Number(body.fields.at.integerValue), updateTime: 't' + (++clock) };
      return reply(200, { updateTime: docs[p].updateTime });
    }
    return reply(400, {});
  }
  const api = { docs, fetch, failNext, log, hook: null, get: (uid, key) => {
    const d = docs['users/' + uid + '/data/' + key];
    return d && JSON.parse(d.raw);
  } };
  return api;
}

/* ---- 端末1台ぶん ---- */
/* opts.store に前の端末の store を渡すと、同じ端末でページを開き直したことになる */
function makeDevice(server, opts) {
  const store = opts.store || {};
  const listeners = {};
  const toasts = [];
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  for (const k in (opts.data || {})) store['toeic.' + k] = JSON.stringify(opts.data[k]);
  if (opts.signedIn) store['toeic.sync.user'] = JSON.stringify({ uid: opts.uid, email: 'me@example.com' });

  let authCb = null;
  const fbUser = { uid: opts.uid, email: 'me@example.com', getIdToken: () => Promise.resolve('tok-' + opts.uid) };
  let current = opts.signedIn ? fbUser : null;
  const auth = {
    onAuthStateChanged(cb) { authCb = cb; setTimeout(() => cb(current), 0); },
    signInWithPopup() { current = fbUser; setTimeout(() => authCb(current), 0); return Promise.resolve(); },
    signOut() { current = null; setTimeout(() => authCb(null), 0); return Promise.resolve(); }
  };
  const authFn = () => auth;
  authFn.GoogleAuthProvider = function () { this.setCustomParameters = () => {}; };

  const win = {
    localStorage,
    sessionStorage: localStorage,
    location: { protocol: 'https:', search: '' },
    navigator: { onLine: true },
    fetch: (u, o) => server.fetch(u, o),
    setTimeout, clearTimeout, setInterval, clearInterval, console, URL, Promise, JSON, Date,
    CustomEvent: function (name, init) { this.type = name; this.detail = init && init.detail; },
    addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); },
    removeEventListener: (n, f) => { listeners[n] = (listeners[n] || []).filter(x => x !== f); },
    dispatchEvent: e => { (listeners[e.type] || []).forEach(f => f(e)); return true; }
  };
  const el = () => ({
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, addEventListener() {}, setAttribute() {}, style: {}
  });
  win.document = {
    visibilityState: 'visible',
    addEventListener() {},
    querySelector: () => null,
    getElementById: id => (id === 'toast' ? { classList: { add() {}, remove() {} }, set textContent(v) { toasts.push(v); } } : null),
    createElement: el,
    body: el(),
    head: { appendChild: s => setTimeout(() => {
      if (/app-compat/.test(s.src)) win.firebase = { apps: [], initializeApp() { this.apps.push(1); }, auth: authFn };
      s.onload();
    }, 0) }
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC.replace('})(window);', '})(this);'), win);
  return { T: win.TOEIC, store, toasts, win, raw: k => JSON.parse(store['toeic.' + k] || 'null') };
}

const tick = (ms) => new Promise(r => setTimeout(r, ms || 20));
async function settle(dev) {
  for (let i = 0; i < 30; i++) {
    await tick(5);
    if (dev.T.Sync.status().phase !== 'busy') { await tick(5); if (dev.T.Sync.status().phase !== 'busy') return; }
  }
}

(async function main() {
  const server = makeServer();
  const UID = 'u1';

  /* 1. 端末A（以前からの記録あり・同期の印なし）が最初にログインする */
  const A = makeDevice(server, {
    uid: UID, signedIn: true,
    data: {
      settings: { rate: 0.9, voiceURI: 'android-voice', showJa: true },
      vocab: [
        { term: 'hike', ja: '引き上げ', addedAt: '2026-09-10T00:00:00.000Z', box: 2, due: '2026-10-05' },
        { term: 'merger', ja: '合併', addedAt: '2026-09-11T00:00:00.000Z', box: 0 }
      ],
      progress: { 'news:2026-09-12': { done: true, updatedAt: '2026-09-12T10:00:00.000Z' } },
      days: ['2026-09-12', '2026-09-13'],
      gemini: { key: 'SECRET-KEY', model: 'm' }
    }
  });
  await settle(A);
  assert.strictEqual(A.T.Sync.status().phase, 'idle', 'A: ' + A.T.Sync.status().msg);
  assert.deepStrictEqual(server.get(UID, 'days'), ['2026-09-12', '2026-09-13']);
  assert.strictEqual(server.get(UID, 'settings').voiceURI, undefined, 'voiceURI は送らない');
  assert.strictEqual(server.get(UID, 'settings').rate, 0.9);
  assert(!JSON.stringify(server.docs).includes('SECRET-KEY'), 'API キーを送っていない');
  assert(!Object.keys(server.docs).some(p => /gemini/.test(p)), 'gemini は同期しない');
  console.log('ok 1 最初の端末の記録がサーバーに入る（API キーと声は送らない）');

  /* 2. 端末B（別の記録あり）がログインすると、両方が合わさる */
  const B = makeDevice(server, {
    uid: UID, signedIn: false,
    data: {
      settings: { rate: 1.1, voiceURI: 'pc-voice' },
      vocab: [
        { term: 'Hike', ja: '値上げ', addedAt: '2026-09-09T00:00:00.000Z', box: 0 },
        { term: 'tariff', ja: '関税', addedAt: '2026-09-14T00:00:00.000Z', box: 0 }
      ],
      progress: { 'part3:p1': { done: false, maxStep: 2, updatedAt: '2026-09-14T08:00:00.000Z' } },
      days: ['2026-09-14']
    }
  });
  await settle(B);
  assert.strictEqual(B.T.Sync.status().account, null);
  await B.T.Sync.signIn();
  await settle(B);
  assert.strictEqual(B.T.Sync.status().phase, 'idle', 'B: ' + B.T.Sync.status().msg);
  assert.deepStrictEqual(B.raw('days'), ['2026-09-12', '2026-09-13', '2026-09-14']);
  assert.deepStrictEqual(B.T.Vocab.all().map(e => e.term.toLowerCase()).sort(), ['hike', 'merger', 'tariff'],
    'hike は1語にまとまる');
  assert(B.T.Log.progress('news:2026-09-12').done, 'A の進捗が B に来る');
  assert(B.T.Log.progress('part3:p1'), 'B の進捗は残る');
  assert.strictEqual(B.T.Settings.get('voiceURI'), 'pc-voice', '声は端末ごと');
  assert.strictEqual(B.T.Settings.get('rate'), 0.9, '先にログインした端末の設定が使われる');
  assert(B.toasts.includes('別の端末の記録を取り込みました'));
  console.log('ok 2 2台目のログインで両方の記録が合わさる');

  /* 3. A が開き直すと B の分が届く */
  await A.T.Sync.run(); await settle(A);
  assert.deepStrictEqual(A.raw('days'), ['2026-09-12', '2026-09-13', '2026-09-14']);
  assert(A.T.Log.progress('part3:p1'));
  assert.strictEqual(A.T.Vocab.all().length, 3);
  assert.strictEqual(A.T.Settings.get('voiceURI'), 'android-voice');
  console.log('ok 3 1台目にも2台目の記録が届く');

  /* 4. もう一度合わせても何も書かない（行ったり来たりしない） */
  const before = server.log.filter(l => l.startsWith('PATCH')).length;
  await A.T.Sync.run(); await B.T.Sync.run(); await settle(A); await settle(B);
  assert.strictEqual(server.log.filter(l => l.startsWith('PATCH')).length, before, '余計な書き込みがない');
  console.log('ok 4 変化がなければ書き込まない');

  /* 5. B で語を消す・復習する・設定を変える → A に届く。消した語は戻らない */
  B.T.Vocab.remove('tariff');
  B.T.Vocab.update('hike', { box: 3, due: '2026-10-10' });
  B.T.Settings.set('rate', 1.05);
  B.T.Settings.set('voiceURI', 'pc-voice-2');
  await tick(3100); await settle(B);   // 書いてから3秒待って送る
  await A.T.Sync.run(); await settle(A);
  assert(!A.T.Vocab.has('tariff'), '消した語が A でも消える');
  assert.strictEqual(A.T.Vocab.all().filter(e => e.term.toLowerCase() === 'hike')[0].box, 3);
  assert.strictEqual(A.T.Settings.get('rate'), 1.05);
  assert.strictEqual(A.T.Settings.get('voiceURI'), 'android-voice');
  await B.T.Sync.run(); await settle(B);
  assert(!B.T.Vocab.has('tariff'), 'B でも戻ってこない');
  console.log('ok 5 削除・復習・設定の変更が届き、消した語は戻らない');

  /* 6. 消した語をもう一度登録すると、また届く */
  A.T.Vocab.add({ term: 'tariff', ja: '関税' });
  await A.T.Sync.run(); await settle(A);
  await B.T.Sync.run(); await settle(B);
  assert(B.T.Vocab.has('tariff'));
  console.log('ok 6 消した語を登録し直すと届く');

  /* 7. 教材の記録を消すと、別の端末でも消える */
  A.T.Log.clearProgress('part3:p1');
  assert.strictEqual(A.T.Log.progress('part3:p1'), null);
  await A.T.Sync.run(); await settle(A);
  await B.T.Sync.run(); await settle(B);
  assert.strictEqual(B.T.Log.progress('part3:p1'), null);
  console.log('ok 7 教材の記録の削除が届く');

  /* 8. 読んだあとに別の端末が書いた（条件付き書き込みの失敗）→ 読み直して合わせる */
  A.T.Log.saveProgress('news:x', { done: true });
  B.T.Log.saveProgress('news:y', { done: true });
  server.failNext['users/' + UID + '/data/progress'] = 1;
  await Promise.all([A.T.Sync.run(), B.T.Sync.run()]);
  await settle(A); await settle(B);
  assert.strictEqual(A.T.Sync.status().phase, 'idle', 'A: ' + A.T.Sync.status().msg);
  assert.strictEqual(B.T.Sync.status().phase, 'idle', 'B: ' + B.T.Sync.status().msg);
  const prog = server.get(UID, 'progress');
  assert(prog['news:x'] && prog['news:y'], '同時に書いても両方残る（読み直して合わせる）');
  await A.T.Sync.run(); await settle(A);
  assert(A.T.Log.progress('news:y') && A.T.Log.progress('news:x'));
  console.log('ok 8 同時に書いても片方が消えない');

  /* 9. 教材を開いた直後に別の端末の続きが届いたら、開き直す */
  let reopened = 0;
  A.T.Sync.follow('news:z', () => { reopened++; });
  B.T.Log.saveProgress('news:z', { step: 3 });
  await B.T.Sync.run(); await settle(B);
  await A.T.Sync.run(); await settle(A);
  assert.strictEqual(reopened, 1, '開き直した');
  assert(A.toasts.includes('別の端末の続きから開きます'));
  /* 自分で記録したあとなら、開き直さない */
  reopened = 0;
  A.T.Sync.follow('news:w', () => { reopened++; });
  A.T.Log.saveProgress('news:w', { step: 1 });
  B.T.Log.saveProgress('news:w', { step: 4 });
  await B.T.Sync.run(); await settle(B);
  await A.T.Sync.run(); await settle(A);
  assert.strictEqual(reopened, 0, '解いている途中は開き直さない');
  console.log('ok 9 開いた直後だけ別の端末の続きから開き直す');

  /* 10. 記録を変えたときは、読まずに送る */
  let n0 = server.log.length;
  A.T.Log.saveProgress('news:fast', { done: true });
  await tick(3100); await settle(A);
  assert.deepStrictEqual(server.log.slice(n0), ['PATCH users/u1/data/progress']);
  assert(server.get(UID, 'progress')['news:fast']);
  console.log('ok 10 記録を変えたときは読まずに送る');

  /* 11. ページを移っても1分以内なら読み直さない。1分たてば読み直す */
  n0 = server.log.length;
  const A2 = makeDevice(server, { uid: UID, signedIn: true, store: A.store });
  await settle(A2);
  assert.deepStrictEqual(server.log.slice(n0), [], '1分以内の開き直しでは読まない');
  A.store['toeic.sync.full'] = JSON.stringify(Date.now() - 61000);
  const A3 = makeDevice(server, { uid: UID, signedIn: true, store: A.store });
  await settle(A3);
  assert.strictEqual(server.log.slice(n0).filter(l => l.startsWith('GET')).length, 4, '1分たてば読み直す');
  console.log('ok 11 1分以内のページ移動では読み直さない');

  /* 12. 読まずに送ろうとして、別の端末が先に書いていたら、読んで合わせる */
  B.T.Log.saveProgress('news:b1', { done: true });
  await B.T.Sync.run(); await settle(B);
  A.T.Log.saveProgress('news:a1', { done: true });
  await tick(3100); await settle(A);
  assert(server.get(UID, 'progress')['news:a1'] && server.get(UID, 'progress')['news:b1']);
  assert(A.T.Log.progress('news:b1'), 'A に B の分も入る');
  console.log('ok 12 先に別の端末が書いていたら、読んで合わせる');

  /* 13. 同期の途中で手元が書き換わったら、版を覚えない。
     覚えてしまうと、次に読まずに送ったとき B の記録を上書きで消してしまう */
  B.T.Log.saveProgress('news:b2', { done: true });
  await B.T.Sync.run(); await settle(B);
  server.hook = (method, p) => {
    if (method === 'GET' && /progress$/.test(p)) { server.hook = null; A.T.Log.saveProgress('news:race', { step: 1 }); }
  };
  await A.T.Sync.run(); await settle(A);
  await tick(3100); await settle(A);
  const p13 = server.get(UID, 'progress');
  assert(p13['news:race'] && p13['news:b2'], '途中で書いた分も B の分も残る: ' + Object.keys(p13).join(','));
  assert(A.T.Log.progress('news:b2'));
  console.log('ok 13 同期の途中で書き換わっても、別の端末の記録を消さない');

  /* 14. ログアウトしても手元の記録は消えず、同期も止まる */
  const n = A.T.Vocab.count();
  await A.T.Sync.signOut(); await tick();
  assert.strictEqual(A.T.Sync.status().account, null);
  assert.strictEqual(A.T.Vocab.count(), n);
  const writes = server.log.length;
  A.T.Vocab.add({ term: 'offline-only', ja: '' });
  await tick(3100);
  assert.strictEqual(server.log.length, writes, 'ログアウト中は送らない');
  console.log('ok 14 ログアウトしても手元の記録は残る');

  console.log('\nすべて通りました');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
