/*
 * 把 web/ 打包成單一自含 HTML（內聯 CSS + 所有 JS），輸出 dist/coup.html。
 * 產物可直接用瀏覽器開啟（手機也可），或丟到任何單檔靜態主機。
 *   執行：node scripts/bundle.js
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const OUT_DIR = path.join(__dirname, '..', 'dist');
const OUT = path.join(OUT_DIR, 'coup.html');

let html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

// 內聯 styles.css
const css = fs.readFileSync(path.join(WEB, 'styles.css'), 'utf8');
html = html.replace(
  /<link rel="stylesheet" href="styles\.css" \/>/,
  `<style>\n${css}\n</style>`
);

// 內聯各 JS（保持原順序）
['engine', 'ai', 'ui', 'net', 'main'].forEach(name => {
  const js = fs.readFileSync(path.join(WEB, 'js', `${name}.js`), 'utf8');
  const tag = new RegExp(`<script src="js/${name}\\.js"></script>`);
  html = html.replace(tag, `<script>\n${js}\n</script>`);
});

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`已輸出 ${path.relative(path.join(__dirname, '..'), OUT)}（${kb} KB，單檔自含）`);

// 簡單健全性檢查：不應再有外部本地資源引用
if (/href="styles\.css"|src="js\//.test(html)) {
  console.error('警告：仍有未內聯的本地資源引用');
  process.exit(1);
}
