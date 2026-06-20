# 《Coup（政變）》深度研究報告
### A Deep-Dive Research Report on the Bluffing Card Game *Coup*

> 本報告以繁體中文為主敘述，關鍵術語採中英對照，方便中／英切換閱讀。
> 重點放在 **規則與機制（Rules & Mechanics）** 以及 **策略與心理戰（Strategy & Psychology）**，並附機率實算與數位化實作考量。
> 內容以使用者上傳的官方「行動參照卡（Action Reference Card）」為錨點，並以多方公開資料佐證（見文末 References）。

---

## 目錄 Table of Contents

1. [概覽 Overview](#1-概覽-overview)
2. [元件與設定 Components & Setup](#2-元件與設定-components--setup)
3. [核心循環 Core Loop](#3-核心循環-core-loop)
4. [行動總表 Actions](#4-行動總表-actions)
5. [質疑與反制機制 Challenge & Block](#5-質疑與反制機制-challenge--block)
6. [影響力與淘汰 Influence & Elimination](#6-影響力與淘汰-influence--elimination)
7. [策略與心理戰 Strategy & Psychology（重點）](#7-策略與心理戰-strategy--psychology重點)
8. [機率實算 Probability Analysis](#8-機率實算-probability-analysis)
9. [常見規則裁決 Edge Cases / FAQ](#9-常見規則裁決-edge-cases--faq)
10. [變體與擴充 Variants & Expansions](#10-變體與擴充-variants--expansions)
11. [數位化實作考量 Implementation Notes（附錄）](#11-數位化實作考量-implementation-notes附錄)
12. [參考資料 References](#12-參考資料-references)

---

## 1. 概覽 Overview

**《Coup》** 是一款由 **Rikki Tahta** 設計、於 **2012 年** 由 **Indie Boards & Cards** 與 **La Mame Games** 出版的社交推理／虛張聲勢卡牌遊戲（social deduction / bluffing card game）。

| 項目 Item | 內容 |
|---|---|
| 設計者 Designer | Rikki Tahta |
| 出版 Publisher / Year | Indie Boards & Cards、La Mame Games，2012 |
| 人數 Players | 2–6 人（官方核心盒；搭配 Reformation 擴充可達 10 人） |
| 時長 Play time | 約 15 分鐘 |
| 建議年齡 Age | 14+（部分版本標示 10+） |
| 類型 Genre | 社交推理、虛張聲勢、淘汰制（social deduction, bluffing, player elimination） |

**主題 Theme.** Coup 屬於 Indie Boards & Cards 的「反抗軍宇宙／反烏托邦宇宙（The Resistance / Dystopian Universe）」。背景設定在一個由跨國 CEO 掌權、貪腐的近未來城邦，但美術與風味卻帶有 **義大利文藝復興（Italian Renaissance）** 宮廷氣息——你是某個家族的首腦，透過操弄、吹牛與賄賂，摧毀其他家族的「影響力」，奪取城邦控制權。

**核心張力 Core tension.** Coup 的魅力來自 **資訊不對稱（hidden information）＋ 公開吹牛（open bluffing）**：
- 你**手上的角色牌是蓋著的**，沒人知道你是誰。
- 但你**可以宣稱自己是任何角色**並使用其能力——即使你根本沒那張牌。
- 任何人都能 **質疑（Challenge）** 你的宣稱；賭錯的一方立刻失去一張影響力。

於是每個行動都是一場「我敢不敢吹、你敢不敢抓」的博弈。遊戲節奏極快、淘汰直接、心理張力高，是同類型（如 The Resistance、Love Letter）中最精煉的代表之一。

---

## 2. 元件與設定 Components & Setup

### 2.1 牌庫組成 Deck composition

核心遊戲共 **15 張角色牌（character cards）**：5 種角色，**每種各 3 張**。

| 角色 Character | 數量 | 主動行動 Action | 反制 Counteraction |
|---|---|---|---|
| 公爵 Duke | ×3 | 課稅 Tax（+3） | 阻擋外援 Blocks Foreign Aid |
| 刺客 Assassin | ×3 | 暗殺 Assassinate（付 3） | — |
| 大使 Ambassador | ×3 | 交換 Exchange（換牌） | 阻擋偷竊 Blocks Stealing |
| 隊長 Captain | ×3 | 偷竊 Steal（偷 2） | 阻擋偷竊 Blocks Stealing |
| 夫人 Contessa | ×3 | —（無主動行動） | 阻擋暗殺 Blocks Assassination |

> 另有金幣代幣（coins）若干，以及行動／反制的參照卡。

### 2.2 影響力與起始手牌 Influence & starting hand

- 每位玩家獲發 **2 張蓋著的角色牌**。每張牌代表 1 點 **影響力（Influence）**。
- 每位玩家起始持有 **2 枚金幣（coins）**。
- 其餘角色牌洗勻後置於中央，形成 **宮廷牌庫（Court Deck）**。

你的角色牌**始終蓋著**，只有在「失去影響力」或「被質疑後攤牌」時才會被翻開。換言之，「你是誰」是隱藏資訊，而「你宣稱是誰」是公開資訊——兩者未必相符。

### 2.3 兩人對局的特殊設定 Two-player setup

官方為 2 人對局提供平衡規則：
- 把 15 張牌分成 **3 套各 5 張（每套含 5 種角色各一）**。
- 兩位玩家各拿一套，**秘密選 1 張留下、其餘棄掉**。
- 第三套洗勻，**各發 1 張**給兩人（湊成各 2 張影響力），剩餘 3 張作為 Court Deck。
- **起始玩家（先手）只拿 1 枚金幣，後手拿 2 枚金幣**，以補償先手優勢。

---

## 3. 核心循環 Core Loop

遊戲依順時針輪流進行。**輪到你時，你只能執行「一個」行動（take one Action）**：

1. 宣告你要做的行動（可能需要宣稱某個角色）。
2. 其他玩家有機會 **質疑（Challenge）** 你的角色宣稱，或對可被反制的行動進行 **反制（Counteraction / Block）**。
3. 若無人質疑也無人反制，行動結算生效。

**強制政變規則（10-coin rule）：** 如同參照卡頂端所述——
> *Take one Action（If 10+ coins must choose to launch Coup）*

只要你在回合**開始時持有 10 枚或更多金幣**，你**唯一能做的行動就是政變（Coup）**。這條規則確保金幣不會無限囤積，遊戲必然走向終局。

---

## 4. 行動總表 Actions

下表逐項對照官方行動參照卡。**「可被質疑」** 指該行動／反制是否宣稱了角色（宣稱角色＝可被 Challenge）。

| 角色 Character | 行動 Action | 效果 Effect | 反制 Counteraction | 可被質疑？ |
|---|---|---|---|---|
| —（通用） | **收入 Income** | 拿 1 枚金幣（+1） | ✖（不可擋） | ✖ 不可（不宣稱角色） |
| —（通用） | **外援 Foreign Aid** | 拿 2 枚金幣（+2） | 被 **公爵 Duke** 阻擋 | ✖ 不可（但可被 Duke 反制） |
| —（通用） | **政變 Coup** | 付 7 枚金幣；指定一名玩家**失去 1 點影響力** | ✖（不可擋） | ✖ 不可（無法阻擋、無法質疑） |
| 公爵 Duke | **課稅 Tax** | 拿 3 枚金幣（+3） | ✖ | ✔ 可被質疑 |
| 刺客 Assassin | **暗殺 Assassinate** | 付 3 枚金幣；指定一名玩家**失去 1 點影響力** | 被 **夫人 Contessa** 阻擋 | ✔ 可被質疑 |
| 大使 Ambassador | **交換 Exchange** | 與 Court Deck **交換手牌** | ✖（但 Ambassador 可反制偷竊） | ✔ 可被質疑 |
| 隊長 Captain | **偷竊 Steal** | 從另一名玩家處**拿走 2 枚金幣** | 被 **隊長 Captain 或 大使 Ambassador** 阻擋 | ✔ 可被質疑 |
| 夫人 Contessa | —（無主動行動） | — | **阻擋暗殺 Blocks Assassination** | ✔（反制時可被質疑） |

### 重點機制說明 Key mechanics

- **三個「無風險」通用行動之一：Income**。+1 金幣，永遠安全、無法被擋、無法被質疑——這是底線收入。
- **Foreign Aid（外援）** 比 Income 多 1 金幣，但任何宣稱 **Duke** 的玩家都能阻擋它（而那個 Duke 宣稱本身又可被質疑）。
- **Coup（政變）** 是遊戲中**唯一完全不可阻擋、不可質疑**的攻擊：只要你付得起 7 金幣，目標必定失去 1 影響力。它是「真實實力」的展現，不需要任何角色。
- **Tax（課稅）** 是 Duke 的招牌：+3，比 Foreign Aid 更好且**不能被 Duke 擋**（沒有角色能擋 Tax），只能被「質疑你是否真有 Duke」。
- **Assassinate（暗殺）** 只要 3 金幣就能除掉 1 影響力，CP 值遠高於 7 金幣的 Coup，但**可被 Contessa 阻擋、也可被質疑**。
- **Exchange（交換）**：Ambassador 從 Court Deck **抽 2 張**，與自己手牌合併後，**挑選要保留的張數（等同原影響力數）**，把多餘的牌放回 Court Deck 並洗勻。這能換掉爛牌、洗白被人看穿的身分、或追逐特定角色。
- **Steal（偷竊）**：Captain 從目標處拿 2 金幣（目標不足 2 則拿光）。可由目標宣稱 **Captain 或 Ambassador** 來反制。

---

## 5. 質疑與反制機制 Challenge & Block

這是 Coup 的心臟。所有「宣稱角色」的行動或反制都可被質疑。

### 5.1 質疑流程 Challenge resolution

當某玩家宣稱角色（例如「我用 Duke 課稅」）：

1. **任何其他玩家**（不限於被影響者）都能喊「**我質疑（Challenge）**」。
2. 被質疑者必須**攤出該角色牌**：
   - **若他真的有** → 質疑者賭輸：**質疑者立即失去 1 影響力**。被質疑者把那張**攤開的牌洗回 Court Deck，再抽 1 張新牌替換**（因此他的身分重新隱藏，且仍保有影響力數）。行動／反制**照常生效**。
   - **若他沒有（吹牛被抓）** → 被質疑者賭輸：**被質疑者立即失去 1 影響力**，且該行動／反制**失敗、不生效**。

> 關鍵細節：**質疑成功者沒有任何懲罰**，賭輸者才失去影響力。而**誠實被質疑的人會「換到一張新牌」**——這是一個重要的策略副作用（見第 7 節）。

### 5.2 反制與「反制也能被質疑」Block & challenging the block

部分行動可被 **反制（Counteraction / Block）**，反制同樣靠「宣稱角色」：
- 外援 → 被宣稱 **Duke** 者反制。
- 暗殺 → 被宣稱 **Contessa** 者反制。
- 偷竊 → 被宣稱 **Captain / Ambassador** 者反制。

**反制本身也是一個角色宣稱，因此也能被質疑。** 於是會出現連鎖：

```
行動 Action  →  (可質疑)  →  反制 Block  →  (可質疑反制)  →  結算
```

### 5.3 結算順序 Order of resolution

一個完整回合的判定順序大致是：

1. 玩家宣告行動（必要時宣稱角色）。
2. **對「行動」的質疑窗口**：有人質疑 → 先結算質疑；行動者吹牛被抓則行動中止。
3. 若行動存活且可被反制 → **反制窗口**：有人宣稱角色反制。
4. **對「反制」的質疑窗口**：有人質疑反制者；反制者吹牛被抓則反制失敗、原行動生效。
5. 全部塵埃落定後結算金幣／影響力變化。

> 直覺記法：**先問「你真的是那個角色嗎？」（質疑），再問「有沒有人要擋？」（反制），擋的人又要再面對一次「你真的是那個角色嗎？」**。

---

## 6. 影響力與淘汰 Influence & Elimination

- 每張角色牌＝ **1 點影響力（Influence）**。每位玩家起始 2 點。
- **失去影響力**時，由**該玩家自己選擇**要攤開／棄掉哪一張牌（被 Coup 或暗殺時，是被攻擊者自己選擇捨棄哪張）。被攤開的牌**正面朝上留在玩家面前**，公開且不可再使用。
- 當一名玩家 **失去全部 2 點影響力 → 立即淘汰出局（eliminated）**，其金幣與剩牌移出遊戲。
- **最後存活的玩家獲勝。**

被迫攤牌會洩漏資訊：一旦你攤出一張 Contessa，所有人都知道你「剩下的那張不是已被攤開的角色」（在某些推理下能縮小範圍），也知道你失去了一道暗殺防線。

---

## 7. 策略與心理戰 Strategy & Psychology（重點）

> Coup 是「資訊 × 機率 × 心理」的三重博弈。以下從**節奏、吹牛、質疑、針對、人數差異**五個面向拆解。

### 7.1 金幣經濟與節奏 Tempo & coin economy

關鍵金幣門檻：

| 金幣 Coins | 可做什麼 | 意義 |
|---|---|---|
| **3** | 暗殺 Assassinate | 第一個「攻擊門檻」——能除掉 1 影響力 |
| **7** | 政變 Coup | **不可擋、不可質疑** 的攻擊門檻 |
| **10** | 強制政變 | 回合開始 ≥10 必須 Coup |

- **「Income → 7 → Coup」是最安全的勝利路線（unbluffable line）**：完全不宣稱角色，無從質疑、無從阻擋。缺點是慢（至少要好幾回合純收入），容易在你攢錢時被別人先打。
- **Tax（Duke）是經濟引擎**：+3 比外援的 +2 更快累積，且不能被擋。多數高手開局傾向宣稱 Duke 課稅，因為早期質疑風險低（Duke 有 3 張，吹牛成功率高）。
- **Foreign Aid 是「誘餌」**：它逼桌上的 Duke 跳出來擋（暴露身分／或暴露吹牛）。如果沒人擋，你白賺 2 金幣；如果有人擋，你獲得了情報。

### 7.2 何時吹牛 When to bluff

- **早期吹牛便宜、可信**：因為桌上資訊少、每種角色有 3 張，「你宣稱 Duke」在統計上很可能為真（見第 8 節數字），別人不太敢質疑。**開局吹一個 Duke 課稅常常無人敢抓。**
- **吹「進可攻退可守」的角色**：Captain（偷竊兼擋偷）、Ambassador（換牌兼擋偷）這類雙用途角色，吹起來後續更好圓。
- **被質疑也可能是好事**：若你**真的**持有該角色，被質疑後你不但讓對方白白損失 1 影響力，還能**把攤開的牌換成一張新牌**，重新隱藏身分。因此**手握真角色時，可以「故意高調」誘人質疑。**
- **致命的吹牛：假 Contessa 擋暗殺**。若你沒有 Contessa 卻宣稱擋暗殺並被質疑，你會**一次損失 2 影響力**（質疑輸 1 ＋ 暗殺仍生效 1）→ 直接出局（見第 9 節）。這是最高風險的吹牛之一。

### 7.3 何時質疑 When to challenge（期望值思維）

質疑是一個**期望值（EV）決策**：
- 賭贏（對方在吹牛）→ 對方 −1 影響力，你得利。
- 賭輸（對方為真）→ **你 −1 影響力**，而且對方還換到新牌（更不透明）。

實務準則：
- **不要在早期亂質疑高頻角色（Duke）**——機率對你不利（見 8.2）。
- **針對「殘血」玩家質疑更划算**：對手只剩 1 影響力時，他持有某特定角色的機率較低（單卡而非雙卡），質疑成功率上升，且一旦抓中就直接淘汰他。
- **行為訊號（tells）**：誰太快宣稱稀有組合？誰在牌已被攤開、邏輯上不可能仍持有某角色時還宣稱它？（例如三張 Duke 已有兩張被攤開＋你手上一張＝對方不可能有 Duke → **必抓**。）
- **「逼擋」資訊**：用 Foreign Aid／Steal 逼對手亮出 Duke／Captain／Ambassador，藉反制與否更新你對其手牌的推測。

### 7.4 針對誰 Targeting

- **先打威脅最大者**：金幣最多（快 Coup）、或已展現強勢經濟引擎（穩定課稅）的人。
- **集火殘血**：對只剩 1 影響力的人，暗殺／政變／成功質疑都能直接淘汰，移除一個行動者能大幅改善你的相對地位。
- **小心成為公敵**：過度高調（連續吹牛、連續攻擊）會讓全桌針對你。Coup 有很強的「政治」層面——保持低調有時比搶跑更安全。

### 7.5 人數差異 Player-count dynamics

- **2 人（決鬥）**：純資訊與機率對抗，沒有「結盟」與「眾矢之的」。節奏緊湊，常圍繞「Tax 累積 vs Assassinate 壓制」。後手起始多 1 金幣的補償很關鍵。
- **3–4 人**：開始出現「該打誰」的政治判斷，質疑的旁觀者增多（任何人都能質疑），吹牛被抓機率上升。
- **5–6 人**：你被輪到前桌面會發生很多事，資訊量大；早期容易被多人圍剿，**低調累積＋伺機質疑**通常優於高調搶跑。Coup 的混亂度與「臨時默契聯合打老大」現象在此最明顯。

---

## 8. 機率實算 Probability Analysis

> 以下數字皆以 **15 張牌、每角色 3 張** 為基礎用組合數學計算，可獨立複核。設定：**從「你」的視角，你看得見自己 2 張牌，其餘 13 張（對手手牌＋Court Deck）對你而言未知。**

### 8.1 對手某張牌是特定角色的先驗機率

完全開局、未看任何牌時，任一張隱藏牌是 Duke 的機率 = 3/15 = **20%**。

### 8.2 「對手宣稱 Duke，他到底有沒有？」

設你手上**沒有 Duke**，則 3 張 Duke 全在那 13 張未知牌中。某位對手（持 2 張）**至少有一張 Duke** 的機率：

$$
P(\text{至少一張Duke}) = 1 - \frac{\binom{10}{2}}{\binom{13}{2}} = 1 - \frac{45}{78} \approx \mathbf{42.3\%}
$$

也就是說，**開局有人宣稱 Duke，他真有的機率約四成多**——質疑他，你有近 58% 機率賭贏？**不盡然**，因為這只是「持有任一 Duke」的牌面先驗，未計入「持有者更可能去宣稱」這個行為偏差（會把真實機率往上拉）。所以**單純牌面就有逾四成，加上行為偏差後通常 >50%，早期質疑 Duke 並不划算。**

若你**自己手上有 1 張 Duke**（剩 2 張 Duke 在 13 張未知中）：

$$
P(\text{對手至少一張Duke}) = 1 - \frac{\binom{11}{2}}{\binom{13}{2}} = 1 - \frac{55}{78} \approx \mathbf{29.5\%}
$$

→ **你持有該角色，反而是質疑別人宣稱同角色的好時機**（牌變少了）。

### 8.3 質疑「殘血」對手最划算

對手只剩 **1 張**牌並宣稱 Duke，你手上無 Duke（3 張 Duke 在 13 張未知中）：

$$
P(\text{那張牌是Duke}) = \frac{3}{13} \approx \mathbf{23.1\%}
$$

→ 牌面上他**只有約 23% 為真**，質疑賭贏機率高，且抓中即淘汰他。**這就是「針對殘血質疑」原則的數學基礎。**

### 8.4 小結表 Quick reference

| 情境 | 你的 Duke 數 | 對手影響力 | 對手「真的有 Duke」的牌面機率 |
|---|---|---|---|
| 開局宣稱 | 0 | 2 | ~42.3% |
| 開局宣稱 | 1 | 2 | ~29.5% |
| 殘血宣稱 | 0 | 1 | ~23.1% |

> 同樣的公式可套用到任何角色（皆 3 張）。**通則：你手上越多該角色、對手影響力越少 → 質疑越划算。**

### 8.5 Exchange 的隱藏價值

Ambassador 交換時從 Court Deck **抽 2 張**，與手牌合併後**挑最好的留下**。等於用「4 選 2（或 3 選 1）」的方式洗掉廢牌、追逐 Contessa/Duke、或洗白已被看穿的身分——這是被低估但極強的長期資訊／韌性工具。

---

## 9. 常見規則裁決 Edge Cases / FAQ

**Q1. 假 Contessa 擋暗殺被質疑會怎樣？**
A：**可能一次死兩張、直接出局。** 你宣稱 Contessa 擋暗殺 → 被質疑 → 你沒有 Contessa（輸質疑）→ 失去 1 影響力；且反制失敗 → 暗殺生效 → 再失去 1 影響力。**兩張全沒＝淘汰。** 這是 Coup 最經典的高風險瞬間。

**Q2. 暗殺被成功擋下，刺客的 3 金幣退不退？**
A：**不退。** 暗殺即使被 Contessa 合法擋下，**支付的費用已花掉、不返還**。Coup 的 7 金幣同理（但 Coup 不可擋）。

**Q3. 真有角色被質疑，吃虧了嗎？**
A：**沒有，反而賺。** 質疑者白送你 1 影響力，你把攤開的真牌**洗回 Court Deck 並抽新牌替換**——身分重新隱藏、影響力不變。

**Q4. 質疑的人一定要是被影響的那個人嗎？**
A：**不必。** **任何**其他玩家都能質疑一個角色宣稱，無論是否為該行動的目標。

**Q5. 多人同時想質疑怎麼辦？**
A：實務上以「最先喊出」或桌上約定的順序處理；一旦攤牌定真偽，後續質疑即無意義（牌已公開）。

**Q6. 失去影響力時誰決定棄哪張？**
A：**失去影響力的玩家自己選**要攤開哪一張（包含被 Coup／暗殺時）。

**Q7. 一定要等到 10 金幣才能 Coup 嗎？**
A：不是。**7 金幣即可 Coup**；**10 金幣（含以上）則是回合開始時「被強制」只能 Coup**。

**Q8. Tax（課稅）能被擋嗎？**
A：**不能被反制**，沒有任何角色能擋 Tax；只能對「你是否真有 Duke」提出質疑。（能被擋的是 Foreign Aid，由 Duke 擋。）

---

## 10. 變體與擴充 Variants & Expansions

### 10.1 Coup: Reformation（2014，擴充）

由 Rikki Tahta／La Mame Games 推出，把人數擴展到 **2–10 人**，並加入兩大機制：

- **陣營 Allegiances（Loyalist 效忠派 / Reformist 改革派）**：每人有一張雙面陣營卡（紅＝Loyalist、藍＝Reformist）。**你不能對「同陣營」的玩家** 政變、暗殺、偷竊或反制——對抗只發生在跨陣營之間，增加了「臨時隊友」與背叛的政治層。
- **轉化 Convert ＋ 國庫儲備 Treasury Reserve**：
  - 花 **1 金幣** 改變**自己**的陣營，或花 **2 金幣** 改變**他人**的陣營；
  - 這些金幣**放到「國庫儲備（Treasury Reserve）」卡上**累積。
  - **挪用 Embezzle**：宣稱自己**沒有 Duke**，即可把 Treasury Reserve 上所有金幣全部拿走（這個宣稱同樣可被質疑——若你其實有 Duke 就會穿幫）。

### 10.2 Inquisitor 審判官（Reformation 內的可選角色）

- **取代 Ambassador（大使）** 的可選變體角色。
- 行動較弱版的 Exchange：**只從 Court Deck 抽 1 張**，決定是否與手牌換一張。
- 獨特能力：**可以查看某位對手的一張牌**，並可**強迫該對手把那張牌棄掉換新**（資訊／壓制工具）。
- 同樣**可反制偷竊（blocks stealing）**，功能近似 Ambassador。

### 10.3 其他常見變體 Other variants

- **Anarchy / 大牌庫變體**：搭配更多角色卡的延伸版（Coup: Rebellion G54 等衍生品提供新角色與規則模組）。
- **家規（house rules）**：例如「Inquisitor 完全替換 Ambassador」、調整 2 人規則、新增角色等，社群流傳甚多。

---

## 11. 數位化實作考量 Implementation Notes（附錄）

> 本節為「若未來要把 Coup 做成數位版」的種子思路，**不含程式碼**，供 `CoupGame` 後續開發參考。

- **狀態機與結算順序**：把一個回合建模為明確的階段機（FSM）：
  `宣告行動 → 質疑窗口（行動）→ 反制窗口 → 質疑窗口（反制）→ 結算`。
  每個「窗口」需要等待所有相關玩家的回應或 pass，務必嚴格依第 5.3 節順序，否則邊角案例（如假 Contessa 雙亡）會算錯。
- **隱藏資訊 Hidden information**：伺服器須是唯一掌握全牌真值的權威；客戶端只看得到「自己的牌＋公開攤牌＋公開金幣」。切忌把對手手牌下發到前端。
- **隨機性與洗牌**：質疑成功（誠實者）時「攤牌→洗回 Court Deck→抽新牌」必須是**伺服器端**的可驗證隨機；可考慮 commit-reveal 或可稽核亂數，防作弊。
- **金幣與門檻校驗**：在伺服器強制 7 金幣才可 Coup、回合開始 ≥10 強制 Coup、暗殺付費後即使被擋也扣費等規則。
- **AI／Bot 的吹牛建模**：
  - 用第 8 節的**組合機率**做基準先驗，估「對手宣稱為真」的機率；
  - 疊加**行為偏差**（持有者更愛宣稱）與**對局狀態**（殘血、金幣、被針對度）；
  - 質疑決策用**期望值門檻**（賭贏 vs 賭輸對影響力與資訊的淨值）；
  - 吹牛頻率可用混合策略（mixed strategy）避免被讀牌，必要時引入賽局論的均衡近似。
- **可測試性**：把規則引擎與 UI 分離，對所有 FAQ／邊角案例（第 9 節）寫單元測試（尤其雙亡、退費、誠實被質疑換牌）。

---

## 12. 參考資料 References

- Wikipedia — *Coup (card game)*：設計者、出版、人數、玩法、Reformation 概述。<https://en.wikipedia.org/wiki/Coup_(card_game)>
- Indie Boards & Cards 官方頁 — *Coup*：出版商與宇宙設定。<https://indieboardsandcards.com/our-games/coup/>
- UltraBoardGames — *How to play Coup（官方規則）*：行動、反制、質疑流程。<https://www.ultraboardgames.com/coup/game-rules.php>
- UltraBoardGames — *Coup Reformation 規則*：陣營、Convert、Inquisitor。<https://ultraboardgames.com/coup/reformation.php>
- gamerules.com — *Coup Rules*：行動成本與質疑後果。<https://gamerules.com/rules/coup/>
- officialgamerules.org — *Coup Rules*：規則彙整。<https://officialgamerules.org/game-rules/coup/>
- Dized Rules — *Coup: Two-player variant setup*：2 人對局與起始金幣（先手 1／後手 2）。<https://rules.dized.com/game/xzsTtI3VTV-2wvos3otxIg/HvgSyeErQJu2CsY62hqNig/two-player-variant-setup>
- Dized Rules — *Block assassinate (Contessa)* / *Assassinate (Assassin)*：暗殺與反制細節。<https://rules.dized.com/game/xzsTtI3VTV-2wvos3otxIg/vn1Jy3lnRzq-_-YW0Poqeg/block-assassinate-contessa>
- Group Games 101 — *Coup Reformation Rules*：擴充細節。<https://groupgames101.com/coup-reformation-rules/>
- BoardGameGeek — *Treasury Reserve*（Reformation）討論串：Embezzle／國庫儲備。<https://boardgamegeek.com/thread/1385625/treasury-reserve>
- Amazon — *Coup (The Dystopian Universe)*：反烏托邦宇宙背景。<https://www.amazon.com/Coup-Bluffing-Players-Perfect-Friends/dp/B00GDI4HX4>

> 機率章節（第 8 節）之數值由本報告以組合數學自行計算，可獨立複核；其餘事實均對照上述公開來源與使用者提供之官方行動參照卡。

---

*本報告為《Coup》遊戲之研究與教學整理，無附屬於出版商；商標與美術版權歸 Indie Boards & Cards 所有。*
