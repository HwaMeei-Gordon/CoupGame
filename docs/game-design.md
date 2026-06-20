# 《Coup》網頁版設計與架構解析
### Game Design & Architecture for a Web-based Human-vs-AI *Coup*

> 本文是把第一份研究報告（`coup-deep-research.md`）的規則與策略，轉譯為**可實作的網頁遊戲設計**。
> 目標：**單機網頁、純前端、人類玩家 vs 多個 AI**，AI 會課稅/偷竊/暗殺、會**吹牛**、也會**抓詐（質疑）**。

---

## 1. 設計目標 Design Goals

| 目標 | 說明 |
|---|---|
| 純前端可部署 | 無後端，所有邏輯在瀏覽器執行，可直接開 `index.html` 或丟上 GitHub Pages |
| 規則正確 | 嚴格實作行動 → 質疑 → 反制 → 質疑反制的結算順序與所有邊角案例 |
| 人機對戰 | 1 名人類 + 1~5 名 AI（總 2~6 人） |
| AI 有靈魂 | AI 會**虛張聲勢（bluff）**、用**牌面機率 + 期望值**決定是否**質疑** |
| 可觀戰可讀 | 有清楚的行動日誌（log）、AI 動作有節奏延遲，讓玩家看得懂發生什麼事 |
| 可測試 | 規則引擎與 UI 解耦，可用 Node 跑 AI-vs-AI 模擬驗證 |

---

## 2. 系統架構 Architecture

採「**引擎 / 代理人 / 介面**」三層解耦，讓同一套規則引擎能同時驅動 AI 與人類，且能在 Node 環境下純跑邏輯測試。

```
            ┌─────────────────────────────────────────┐
            │            GameController                │  engine.js
            │  狀態 + 回合循環 + 結算順序（FSM）         │
            │  challenge / block / loseInfluence...     │
            └───────────────┬─────────────────────────┘
                            │ 透過統一的 Agent 介面詢問決策
              ┌─────────────┴─────────────┐
              ▼                           ▼
      ┌───────────────┐           ┌────────────────┐
      │   AIAgent     │ ai.js     │  HumanAgent     │ ui.js
      │ 機率/EV/吹牛   │           │  回傳 Promise，  │
      │ 同步決策       │           │  由 UI 按鈕解析  │
      └───────────────┘           └────────────────┘
                                          │
                                   ┌──────┴───────┐
                                   │   UI / DOM   │ ui.js
                                   │ 渲染 + 提示    │
                                   └──────────────┘
```

**關鍵設計：統一的 Agent 介面（Strategy Pattern）。** 引擎不在乎對方是人是 AI，只透過介面詢問決策：

```js
interface Agent {
  chooseAction(game): { type, targetId? }              // 選行動
  decideChallenge(game, claimantId, character): bool    // 是否質疑
  decideBlock(game, action, blockChars): { block, character? }   // 是否反制
  decideChallengeBlock(game, blockerId, character): bool          // 是否質疑反制
  chooseCardToLose(game, playerId): index               // 失去影響力時棄哪張
  chooseExchange(game, playerId, drawn): kept[]          // 大使交換留哪些
}
```

- **AIAgent** 同步回傳決策。
- **HumanAgent**（由 UI 實作）回傳 **Promise**，渲染提示按鈕，玩家點擊時 `resolve`。
- 因此引擎的回合循環是 **`async/await`**：遇到人類就自然「暫停」等待點擊，遇到 AI 就立即取得決策（再加上刻意的延遲做節奏）。

---

## 3. 狀態模型 State Model

```js
player = {
  id, name, isHuman,
  cards: [Character, ...],   // 未攤開的隱藏牌 = 影響力
  lost:  [Character, ...],   // 已攤開/失去的牌（公開）
  coins, alive
}

game = {
  players: [...],
  deck: [Character, ...],    // Court Deck（中央牌庫）
  current,                   // 目前回合玩家索引
  over, winner
}
```

- **影響力 = `cards.length`**（最多 2）。`cards` 全空 → `alive=false` 淘汰。
- **隱藏資訊邊界**：UI 只把「人類自己的 `cards`」攤開顯示；AI 的 `cards` 渲染成牌背，只有 `lost` 公開。AI 決策時也**只能看自己的 `cards` 與所有人的 `lost`**（靠 `estimateOpponentHas()` 做牌面機率推估，而非偷看）。

---

## 4. 回合結算狀態機 Turn Resolution FSM

這是整個遊戲最容易寫錯的地方，嚴格依研究報告第 5 節順序實作：

```
選擇行動
  │
  ├─ income  → +1，結束（不可質疑/反制）
  ├─ coup    → 付7 → 目標失去影響力，結束（不可質疑/反制）
  ├─ foreign_aid → [反制窗口: 任何人可宣稱 Duke 擋]
  │                   └ 有人擋 → [質疑反制窗口] → 擋成立則無效 / 拆穿則 +2
  │                   └ 無人擋 → +2
  └─ 角色行動(tax/steal/assassinate/exchange)
        │ (assassinate 先付3)
        ├─ [質疑行動窗口]
        │     └ 拆穿吹牛 → 行動者失1張，行動作廢（assassinate 退3）
        │     └ 質疑失敗(行動者誠實) → 質疑者失1張，行動者「換牌」，行動續行
        ├─ 可反制者(steal/assassinate) → [反制窗口]
        │     └ 同上：反制亦可被質疑
        └─ 套用效果（tax+3 / steal偷2 / assassinate目標失1張 / exchange換牌）
```

**已實作的關鍵邊角案例（對應報告 FAQ）：**
- 假 Contessa 擋暗殺被拆穿 → **一次失 2 張影響力**（質疑輸 1 + 暗殺生效 1）→ 可能直接淘汰。
- 暗殺被 Contessa 合法擋下 → **3 金幣不退**；但行動者吹牛 Assassin 被拆穿、行動作廢 → **退 3 金幣**。
- 誠實者被質疑 → 攤牌、**洗回牌庫、抽新牌替換**（身分重新隱藏，影響力不變）。
- **任何**其他玩家都能質疑（不限被影響者）；以回合順序「最先質疑者」生效。
- 10 金幣（含）以上 → **強制只能政變**；7 金幣才可政變、3 金幣才可暗殺（引擎與 UI 雙重把關）。

---

## 5. AI 設計 AI Design（重點）

AI 的「靈魂」來自三件事：**牌面機率、期望值質疑、混合策略吹牛**。

### 5.1 牌面機率推估 `estimateOpponentHas()`

完全採用報告第 8 節的組合數學。從 AI 視角，能看到自己的牌 + 全場攤開的牌，其餘為「未知」：

```
未知張數 U = 15 − 我的手牌數 − 全場已攤開張數
某角色未知份數 c = 3 − 我看到的該角色張數
對手有 h 張隱藏牌，他「至少有一張該角色」的機率：
        P = 1 − C(U−c, h) / C(U, h)
```

- 若 `c <= 0`（三張都被我看光）→ `P = 0` → 對手**不可能**有 → **必定質疑**。

### 5.2 是否質疑（期望值門檻）`decideChallenge()`

```
truth = P + (1−P)·0.30          // 行為偏差：會宣稱者通常更可能為真
門檻 threshold = 0.45
  對手剩 1 張影響力 → 0.55（更想抓，抓中即淘汰）
  我自己剩 1 張   → 0.30（更保守，輸不起）
  ± 隨機抖動
若 truth < threshold → 質疑
```

效果：早期 Duke 課稅（truth≈0.6）通常**放過**；殘血玩家的宣稱（truth 低）**積極抓**；牌面不可能時**必抓**。

### 5.3 吹牛與反制 `chooseAction()` / `decideBlock()`

- **行動選擇**優先序：強制政變 → 政變(≥7) → 真 Assassin 暗殺 → 真 Captain 偷竊 → 真 Duke 課稅 → 適時大使換牌 → 否則在 **收入 / 吹牛課稅 / 吹牛偷竊 / 外援** 間以機率混合（避免被讀牌）。
- **目標選擇**：優先殺**殘血**對手（接近淘汰）；否則打**領先者**（金幣 + 影響力加權最高）。
- **反制**：持有真牌必擋；**假 Contessa 擋暗殺**的吹牛機率，會因「擋下去能否保命」而提高（保命 0.55 / 一般 0.25），反映高風險高報酬。
- 以一個 `bluffiness`（吹牛係數）參數對應難度（簡單/普通/困難），調整吹牛頻率與質疑積極度。

### 5.4 失牌與換牌 `chooseCardToLose()` / `chooseExchange()`

- 失去影響力：保留高價值角色（Duke>Captain≈Assassin≈Ambassador>Contessa），棄最低價值/重複牌。
- 大使交換：從 `手牌 + 抽到的2張` 池中挑價值最高的 `keepCount` 張。

---

## 6. UI / UX 設計

- **版面**：上方環繞 AI 對手面板（牌背 + 已攤開牌 + 金幣 + 影響力），中央牌庫資訊，右側即時**行動日誌**，下方為人類玩家（攤開自己的牌 + 金幣 + 行動按鈕）。
- **節奏**：AI 行動間插入約 0.7–1.0s 延遲，並把每一步寫進日誌，讓玩家跟得上「誰質疑誰、誰擋誰」。
- **決策提示**：質疑/反制/失牌/交換都用底部提示區的按鈕呈現；可負擔性與 10 金幣規則會即時 disable 不合法按鈕。
- **減少疲勞**：外援的「用 Duke 阻擋」只有在玩家**真的持有 Duke** 時才提示（其餘自動放行），偷竊/暗殺因玩家是目標故一律提示。
- **開新局**：可選人數（2–6）與 AI 難度。

---

## 7. 檔案結構 File Layout

```
web/
  index.html          入口
  styles.css          樣式
  js/
    engine.js         規則引擎 + 回合 FSM（GameController）
    ai.js             AIAgent（機率/EV/吹牛）
    ui.js             UI 渲染 + HumanAgent（Promise 決策）
    main.js           初始化、開新局、串接 agents
test/
  sim.js              Node 端 AI-vs-AI 模擬，驗證引擎不崩、必有勝者
```

- `engine.js` 與 `ai.js` 同時相容瀏覽器（掛 `globalThis.Coup`）與 Node（`module.exports`），故可在無 DOM 環境跑模擬測試。

---

## 8. 驗證計畫 Verification

1. **規則模擬**：`node test/sim.js` 跑數百局 AI-vs-AI，斷言每局都在合理回合內結束、恰有 1 名勝者、金幣與影響力守恆、無例外。
2. **邊角案例**：針對假 Contessa 雙亡、暗殺退費/不退費、誠實被質疑換牌，於測試或手動對局確認。
3. **人機實玩**：以本機 `python3 -m http.server` 開 `web/`，完整玩一局，確認質疑/反制/交換/淘汰流程與 UI 一致。

---

## 9. 後續可擴充 Future Work

- Reformation 陣營制與 Inquisitor 角色（資料驅動已預留角色表）。
- 線上多人（把 GameController 移到伺服器，加上隱藏資訊權威與可驗證亂數）。
- 更強 AI：對手建模（追蹤宣稱歷史）、賽局論混合策略均衡、蒙地卡羅模擬。
