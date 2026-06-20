# CoupGame

桌遊《Coup（政變）》的研究與網頁實作 — **人類 vs AI** 對戰。

A research project and web implementation of the bluffing card game **Coup**, featuring **human-vs-AI** play.

## 🎮 立即遊玩 Play（純前端、無需後端）

```bash
cd web
python3 -m http.server 8000
# 瀏覽器開啟 http://localhost:8000
```

或直接用瀏覽器開啟 `web/index.html` 亦可（純前端、無建置步驟）。

**特色：**
- 1 名人類 + 1~5 名 AI（總 2~6 人），可選 AI 難度（簡單／普通／困難）與節奏速度。
- 完整實作 **行動 → 質疑 → 反制 → 質疑反制** 的結算順序與所有邊角案例。
- AI 會**虛張聲勢（bluff）**、用**牌面機率 + 期望值**決定是否**質疑**、會偷竊／暗殺／課稅／換牌。
- 即時行動日誌，看得懂每一步誰質疑誰、誰擋誰。

## 📖 文件 Documentation

- **[docs/coup-deep-research.md](docs/coup-deep-research.md)** — 《Coup》規則與策略深度研究報告（中英對照）
- **[docs/game-design.md](docs/game-design.md)** — 網頁版設計與架構解析（引擎 / AI / UI 三層設計）

## 🧪 測試 Tests（Node，無需相依套件）

```bash
node test/sim.js 600       # AI-vs-AI 跑 600 局，驗證規則引擎正確、不崩、卡牌守恆
node test/ui-smoke.js      # 無頭 DOM mock，驗證 UI 渲染與人類 Agent 路徑
```

## 🗂️ 專案結構 Structure

```
web/
  index.html          入口
  styles.css          樣式
  js/
    engine.js         規則引擎 + 回合結算狀態機（GameController）
    ai.js             AIAgent（機率 / 期望值 / 吹牛）
    ui.js             UI 渲染 + HumanAgent（Promise 決策）
    main.js           初始化、開新局
test/
  sim.js              AI-vs-AI 模擬測試
  ui-smoke.js         UI 無頭煙霧測試
docs/
  coup-deep-research.md   規則與策略研究
  game-design.md          設計與架構
```

## 架構重點 Architecture

採「**引擎 / 代理人 / 介面**」三層解耦：引擎透過統一的 `Agent` 介面詢問決策，
同一套規則同時驅動 AI（同步決策）與人類（UI 以 Promise 回傳），因此回合循環是
`async/await`，遇到人類自然暫停等待點擊。`engine.js` 與 `ai.js` 同時相容瀏覽器與
Node，故能用純邏輯模擬測試。詳見 [docs/game-design.md](docs/game-design.md)。
