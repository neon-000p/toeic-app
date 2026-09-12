/* core.js / style.css の内容ハッシュを HTML の参照に付ける。
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
const PAGES = ['index.html', 'news.html', 'vocab.html'];

function hash(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 8);
}

const versions = {};
ASSETS.forEach(function (a) { versions[a.file] = hash(a.file); });

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
  if (s !== before) { fs.writeFileSync(p, s); changed++; console.log('updated ' + page); }
});

console.log('core.js=' + versions['core.js'] + '  style.css=' + versions['style.css'] +
            (changed ? '' : '  (変更なし)'));
