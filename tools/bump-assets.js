/* core.js / style.css の内容ハッシュを HTML の参照に付け、
   各ページに版の印（<meta name="app-build">）を書き込む。
   GitHub Pages はアセットを10分ほどキャッシュするため、これが無いと
   「新しい HTML ＋ 古い JS」という組み合わせで読み込まれて壊れる。
   内容が変わればURLが変わるので、その食い違いが起きなくなる。

   あわせて各ページの CSP（<meta http-equiv="Content-Security-Policy">）を作り直す。
   ページ内の <script> はハッシュで許可しているので、中身を変えたらこれを
   走らせないとそのページのスクリプトが止まる（ローカルで開けばすぐ気づく）。
   外の配信元を増やすときは下の cspFor() に足す。

   使い方: コミット前にリポジトリのルートで
     node tools/bump-assets.js
   書き込まずに、走らせ忘れが無いかだけ確かめる（CI 用）:
     node tools/bump-assets.js --check
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = [
  { file: 'core.js', attr: 'src' },
  { file: 'style.css', attr: 'href' }
];
const PAGES = ['index.html', 'news.html', 'vocab.html', 'part3.html', 'part4.html', 'part5.html', 'part6.html', 'part7.html', 'drills.html'];
const CHECK = process.argv.indexOf('--check') !== -1;

function hash(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 8);
}

const versions = {};
ASSETS.forEach(function (a) { versions[a.file] = hash(a.file); });

/* 版の印を作る。付け替えた ?v= と前回の印・CSP は外してから混ぜる。
   そうしないと、書き込むたびに中身が変わって印が落ち着かない。 */
const BUILD_RE = /(<meta name="app-build" content=")[^"]*(">)/;
const CSP_RE = /\r?\n<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
function stable(s) {
  return s.replace(/\?v=[a-f0-9]+/g, '').replace(BUILD_RE, '$1$2').replace(CSP_RE, '');
}
function buildId() {
  const h = crypto.createHash('sha1');
  ASSETS.forEach(function (a) { h.update(stable(fs.readFileSync(path.join(ROOT, a.file), 'utf8'))); });
  PAGES.forEach(function (page) {
    const p = path.join(ROOT, page);
    if (fs.existsSync(p)) h.update(stable(fs.readFileSync(p, 'utf8')));
  });
  /* 日付は日本時間。ハッシュだけだと新しいのか古いのか分からない */
  const d = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return d + ' ' + h.digest('hex').slice(0, 7);
}

/* ---- CSP ----
   読み込んでよい先を決めておき、ほかは拒む。教材や Gemini の返事に紛れた
   HTML が万一効いても、外のスクリプトを読んだり、API キーを外へ送ったりしにくくする。
   ページ内のスクリプトは 'unsafe-inline' にせず、中身のハッシュで1本ずつ許す。 */
function authDomain() {
  const m = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8').match(/authDomain:\s*'([^']+)'/);
  return m ? 'https://' + m[1] : '';
}
const AUTH = authDomain();

function inlineHashes(html) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\ssrc=/.test(attrs) || /type="application\/json"/.test(attrs)) continue;
    /* ブラウザは改行を LF にそろえてから照合する。Windows の作業コピー（CRLF）でも合うように */
    const body = m[2].replace(/\r\n?/g, '\n');
    out.push("'sha256-" + crypto.createHash('sha256').update(body, 'utf8').digest('base64') + "'");
  }
  return out;
}

function cspFor(html) {
  return [
    "default-src 'self'",
    /* gstatic は Firebase の SDK、apis.google.com はその SDK がログインのために読むもの */
    ["script-src 'self'"].concat(inlineHashes(html), ['https://www.gstatic.com', 'https://apis.google.com']).join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    ["connect-src 'self'",
      'https://generativelanguage.googleapis.com',   // Gemini
      'https://firestore.googleapis.com',            // 同期
      'https://identitytoolkit.googleapis.com',      // ログイン
      'https://securetoken.googleapis.com',
      'https://www.googleapis.com',
      'https://apis.google.com'].join(' '),
    ['frame-src', AUTH, 'https://accounts.google.com', 'https://apis.google.com'].filter(Boolean).join(' '),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ');
}

const build = buildId();

let changed = 0;
PAGES.forEach(function (page) {
  const p = path.join(ROOT, page);
  if (!fs.existsSync(p)) return;
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  ASSETS.forEach(function (a) {
    const esc = a.file.replace('.', '\\.');
    const re = new RegExp('(' + a.attr + '=")' + esc + '(\\?v=[a-f0-9]+)?(")', 'g');
    s = s.replace(re, '$1' + a.file + '?v=' + versions[a.file] + '$3');
  });
  if (BUILD_RE.test(s)) s = s.replace(BUILD_RE, '$1' + build + '$2');
  else console.log('!! ' + page + ' に <meta name="app-build"> がありません');

  /* CSP は版の印の直後に置く（どのスクリプトよりも前にあれば効く） */
  const nl = s.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const meta = nl + '<meta http-equiv="Content-Security-Policy" content="' + cspFor(s) + '">';
  if (CSP_RE.test(s)) s = s.replace(CSP_RE, function () { return meta; });
  else s = s.replace(/<meta name="app-build" content="[^"]*">/, function (x) { return x + meta; });

  if (CHECK) {
    /* 版の印は日付を含むので比べない。?v= と CSP がずれていれば走らせ忘れ */
    const norm = function (x) { return x.replace(/\r\n?/g, '\n').replace(BUILD_RE, '$1$2'); };
    if (norm(s) !== norm(before)) { changed++; console.log('!! ' + page + ' が古いままです'); }
    return;
  }
  if (s !== before) { fs.writeFileSync(p, s); changed++; console.log('updated ' + page); }
});

if (CHECK) {
  if (changed) {
    console.log('node tools/bump-assets.js を実行してからコミットしてください');
    process.exit(1);
  }
  console.log('ok: アセットの版と CSP はそろっています');
  process.exit(0);
}

console.log('core.js=' + versions['core.js'] + '  style.css=' + versions['style.css'] +
            '  build=' + build + (changed ? '' : '  (変更なし)'));
