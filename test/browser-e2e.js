/*
 * 真實瀏覽器端對端測試（Playwright + Chromium）。
 * 啟動靜態伺服器 → 載入遊戲 → 驗證渲染、人類回合提示、可互動。
 *   執行：node test/browser-e2e.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('404'); }
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'text/plain');
      res.end(fs.readFileSync(file));
    });
    server.listen(0, () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const base = `http://localhost:${port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 忽略外部 CDN（Google Fonts）資源/憑證類錯誤——僅沙箱網路環境造成，非程式問題
    if (/Failed to load resource|ERR_CERT|fonts\.g(oogleapis|static)/.test(t)) return;
    errors.push('console.error: ' + t);
  });

  let failed = false;
  const assert = (cond, msg) => { if (!cond) { failed = true; console.error('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    // 速度設快，加速 AI 節奏
    await page.selectOption('#speed', 'fast');
    await page.click('#newGame');

    // 1) 標題與面板渲染
    assert((await page.textContent('h1')).includes('Coup'), '標題渲染為 Coup');
    await page.waitForSelector('#human .player.me', { timeout: 5000 });
    assert(await page.$('#human .player.me'), '人類面板渲染');
    const oppCount = await page.$$eval('#opponents .player', els => els.length);
    assert(oppCount === 3, `預設 4 人 → 3 個 AI 對手面板（實得 ${oppCount}）`);

    // 2) 人類手牌應顯示正面（兩張非牌背）
    const myFaces = await page.$$eval('#human .player.me .card', els =>
      els.filter(e => !e.classList.contains('back')).length);
    assert(myFaces === 2, `人類起始 2 張正面牌（實得 ${myFaces}）`);

    // 3) AI 手牌應為牌背（隱藏資訊）
    const backs = await page.$$eval('#opponents .card.back', els => els.length);
    assert(backs >= 1, `AI 手牌以牌背隱藏（背面數 ${backs}）`);

    // 4) 等到輪到人類時，提示區出現行動按鈕，點「收入」可推進
    await page.waitForFunction(() => {
      const t = document.querySelector('.prompt-title');
      return t && /選擇一個行動|必須發動政變/.test(t.textContent);
    }, { timeout: 8000 });
    assert(true, '輪到人類時出現行動提示');
    const actBtns = await page.$$eval('#prompt .pbtn.act', els => els.length);
    assert(actBtns >= 5, `行動按鈕數 >=5（實得 ${actBtns}）`);

    // 點擊「收入 +1」並確認金幣增加
    const coinsBefore = parseInt((await page.textContent('#human .pcoins')).replace(/\D/g, ''), 10);
    const incomeBtn = await page.$('xpath=//*[@id="prompt"]//button[contains(., "收入")]');
    await incomeBtn.click();
    await page.waitForFunction((c) => {
      const el = document.querySelector('#human .pcoins');
      return el && parseInt(el.textContent.replace(/\D/g, ''), 10) === c + 1;
    }, coinsBefore, { timeout: 5000 });
    assert(true, '點擊收入後人類金幣 +1');

    // 5) 行動日誌有內容
    const logLines = await page.$$eval('#log .log-line', els => els.length);
    assert(logLines >= 2, `行動日誌有紀錄（${logLines} 行）`);

    // 6) 全程無 page error / console error
    assert(errors.length === 0, '無 JS 例外 / console error' + (errors.length ? '：' + errors.join(' | ') : ''));
  } catch (e) {
    failed = true;
    console.error('E2E 例外：', e.message);
    if (errors.length) console.error('頁面錯誤：', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failed ? '\n瀏覽器 E2E：失敗 ✗' : '\n瀏覽器 E2E：全部通過 ✓');
  process.exit(failed ? 1 : 0);
})();
