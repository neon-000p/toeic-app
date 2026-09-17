/* core.js / style.css の内容ハッシュを HTML の参照に付け、
   各ページに版の印（<meta name="app-build">）を書き込む。
   GitHub Pages はアセットを10分ほどキャッシュするため、これが無いと
   「新しい HTML ＋ 古い JS」という組み合わせで読み込まれて壊れる。
   内容が変わればURLが変わるので、その食い違いが起きなくなる。

   使い方: コミット前にリポジトリのルートで
     node tools/bump-assets.js
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = [
  { file: 'core.js', attr: 'src' },
  { file: 'style.css', attr: 'href' }
];
const PAGES = ['index.html', 'news.html', 'vocab.html', 'part3.html', 'part4.html', 'drills.html'];

function hash(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 8);
}

const versions = {};
ASSETS.forEach(function (a) { versions[a.file] = hash(a.file); });

/* 版の印を作る。付け替えた ?v= と前回の印は外してから混ぜる。
   そうしないと、書き込むたびに中身が変わって印が落ち着かない。 */
const BUILD_RE = /(<meta name="app-build" content=")[^"]*(">)/;
function stable(s) {
  return s.replace(/\?v=[a-f0-9]+/g, '').replace(BUILD_RE, '$1$2');
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
  if (s !== before) { fs.writeFileSync(p, s); changed++; console.log('updated ' + page); }
});

console.log('core.js=' + versions['core.js'] + '  style.css=' + versions['style.css'] +
            '  build=' + build + (changed ? '' : '  (変更なし)'));
