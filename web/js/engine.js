/*
 * Coup 規則引擎 + 回合結算狀態機
 * 相容瀏覽器（掛 globalThis.Coup）與 Node（module.exports）。
 *
 * 透過統一的 Agent 介面驅動人類與 AI：
 *   chooseAction / decideChallenge / decideBlock /
 *   decideChallengeBlock / chooseCardToLose / chooseExchange
 */
(function (root) {
  'use strict';
  const Coup = root.Coup = root.Coup || {};

  const CHARACTERS = ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa'];
  Coup.CHARACTERS = CHARACTERS;

  // 角色中文名（顯示用）
  const ZH = {
    Duke: '公爵', Assassin: '刺客', Captain: '隊長',
    Ambassador: '大使', Contessa: '夫人'
  };
  Coup.ZH = ZH;

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  Coup.shuffle = shuffle;

  // 組合數 C(n, k)
  function comb(n, k) {
    if (k < 0 || k > n || n < 0) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return r;
  }
  Coup.comb = comb;

  // 行動中繼資料
  const ACTIONS = {
    income:      { character: null,         targeted: false },
    foreign_aid: { character: null,         targeted: false },
    coup:        { character: null,         targeted: true  },
    tax:         { character: 'Duke',       targeted: false },
    assassinate: { character: 'Assassin',   targeted: true  },
    steal:       { character: 'Captain',    targeted: true  },
    exchange:    { character: 'Ambassador', targeted: false }
  };
  Coup.ACTIONS = ACTIONS;

  const noop = () => {};
  const resolved = () => Promise.resolve();

  class GameController {
    constructor(playerConfigs, hooks) {
      this.hooks = Object.assign({
        onState: noop,    // () => void        重新渲染
        onLog: noop,      // (msg) => void     寫入日誌
        onTurn: noop,     // (playerId) => void
        onGameOver: noop, // (winner) => void
        pause: resolved   // () => Promise     AI 節奏延遲
      }, hooks || {});

      this.players = playerConfigs.map((c, i) => ({
        id: i,
        name: c.name,
        isHuman: !!c.isHuman,
        cards: [],
        lost: [],
        coins: 0,
        alive: true,
        claimLog: [],  // 公開宣示過的角色(AI 嫌疑判讀)
        timeline: []   // 公開事件流(宣示/換牌/大使交換)供玩家點看
      }));
      this.agents = {}; // id -> Agent，由外部設定
      this.deck = [];
      this.current = 0;
      this.over = false;
      this.cancelled = false; // 開新局時用來中止舊的 play() 迴圈
      this.winner = null;
      this.setup();
    }

    setup() {
      const deck = [];
      CHARACTERS.forEach(ch => deck.push(ch, ch, ch)); // 每角色 3 張，共 15
      shuffle(deck);
      this.players.forEach(p => {
        p.cards = [deck.pop(), deck.pop()];
        p.lost = [];
        p.coins = 2;
        p.alive = true;
      });
      // 2 人對局：先手只拿 1 金幣
      if (this.players.length === 2) this.players[0].coins = 1;
      this.deck = deck;
      this.current = 0;
      this.over = false;
      this.winner = null;
    }

    // ---- 工具 ----
    log(msg) { this.hooks.onLog(msg); }
    alive() { return this.players.filter(p => p.alive); }
    influence(p) { return p.cards.length; }

    // 從 startId 之後，依回合順序回傳其他存活玩家 id
    aliveOrderFrom(startId) {
      const n = this.players.length;
      const res = [];
      for (let k = 1; k <= n; k++) {
        const id = (startId + k) % n;
        if (id === startId) continue;
        if (this.players[id].alive) res.push(id);
      }
      return res;
    }

    // 失去影響力（攤一張牌）
    async loseInfluence(player) {
      if (!player.alive || player.cards.length === 0) return;
      let idx = 0;
      if (player.cards.length > 1) {
        idx = await this.agents[player.id].chooseCardToLose(this, player.id);
        if (typeof idx !== 'number' || idx < 0 || idx >= player.cards.length) idx = 0;
      }
      const card = player.cards.splice(idx, 1)[0];
      player.lost.push(card);
      this.log(`💥 ${player.name} 的一名隨從墮入深淵，攤開【${ZH[card]} ${card}】（永久消逝，不可再用）`);
      if (player.cards.length === 0) {
        player.alive = false;
        this.log(`☠️ ${player.name} 的最後一絲影響力殞落，黯然退場！`);
      }
      this.hooks.onState();
    }

    // 誠實者被質疑後：攤示真牌 → 洗回牌庫 → 抽新牌替換
    swapCard(player, character) {
      const i = player.cards.indexOf(character);
      if (i < 0) return null;
      this.deck.push(player.cards[i]);
      shuffle(this.deck);
      player.cards[i] = this.deck.pop();
      return player.cards[i];
    }

    // 通知所有代理人：claimant 宣稱了 character（供 AI 做對手建模）
    notifyClaim(claimantId, character) {
      const c = this.players[claimantId];
      if (c) {
        (c.claimLog || (c.claimLog = [])).push(character);
        (c.timeline || (c.timeline = [])).push({ kind: 'claim', ch: character });
      }
      for (const id in this.agents) {
        const a = this.agents[id];
        if (a && typeof a.observe === 'function') {
          try { a.observe(this, claimantId, character); } catch (e) { /* 觀察失敗不影響流程 */ }
        }
      }
    }

    // 通知所有代理人：playerId 被質疑證實後換了新牌（手牌組成已變,供 AI 重評機率）
    notifySwap(playerId, character) {
      const c = this.players[playerId];
      if (c) (c.timeline || (c.timeline = [])).push({ kind: 'swap', ch: character });
      for (const id in this.agents) {
        const a = this.agents[id];
        if (a && typeof a.onSwap === 'function') {
          try { a.onSwap(this, playerId, character); } catch (e) { /* 觀察失敗不影響流程 */ }
        }
      }
    }

    // 通知所有代理人：一個行動的結果（被擋 / 命中），供 AI 記憶「誰一直擋我」「誰攻擊我」
    notifyOutcome(ev) {
      for (const id in this.agents) {
        const a = this.agents[id];
        if (a && typeof a.observeOutcome === 'function') {
          try { a.observeOutcome(this, ev); } catch (e) { /* 觀察失敗不影響流程 */ }
        }
      }
    }

    // 質疑窗口：詢問可質疑者是否質疑 claimant 的 character 宣稱
    // eligible（可選）：限定哪些玩家可質疑（兩人之間的私下對抗時用）；省略=所有人
    // 回傳 { challenged, success }；success = 質疑成功（宣稱者在吹牛）
    async runChallenge(claimantId, character, eligible) {
      const claimant = this.players[claimantId];
      this.notifyClaim(claimantId, character);
      let order = this.aliveOrderFrom(claimantId);
      if (Array.isArray(eligible)) {
        const allow = new Set(eligible);
        order = order.filter(id => allow.has(id));
      }
      for (const pid of order) {
        const p = this.players[pid];
        if (!p.alive) continue;
        const wants = await this.agents[pid].decideChallenge(this, claimantId, character);
        if (!wants) continue;

        this.log(`❓ ${p.name} 洞悉疑雲，質疑 ${claimant.name} 的【${ZH[character]} ${character}】`);
        this.hooks.onState();
        await this.hooks.pause();

        const truthful = claimant.cards.includes(character);
        if (truthful) {
          this.log(`✅ ${claimant.name} 亮出真正的【${ZH[character]} ${character}】，命運審判了質疑者！`);
          await this.loseInfluence(p);
          const fresh = this.swapCard(claimant, character); // 換新牌，身分重新隱藏
          this.notifySwap(claimantId, character); // 通知 AI：此玩家手牌已變,重新評估內部機率
          this.log(`🔀 ${claimant.name} 將證明的【${ZH[character]} ${character}】洗回命運之輪，改抽一張新牌（原牌並未死亡）`);
          if (claimant.isHuman && fresh) this.log(`🎴 你抽到的新身分牌是【${ZH[fresh]} ${fresh}】`);
          this.hooks.onState();
          return { challenged: true, success: false, challenger: pid };
        } else {
          this.log(`❌ ${claimant.name} 的牌中並無【${ZH[character]} ${character}】——騙局被揭穿！`);
          await this.loseInfluence(claimant);
          return { challenged: true, success: true, challenger: pid };
        }
      }
      return { challenged: false, success: false };
    }

    // 反制窗口：回傳 true 表示行動被擋下
    async runBlock(action) {
      const actor = this.players[action.actorId];
      let blockerIds, blockChars;
      if (action.type === 'foreign_aid') {
        blockerIds = this.aliveOrderFrom(actor.id); // 任何人可宣稱 Duke 擋
        blockChars = ['Duke'];
      } else if (action.type === 'steal') {
        blockerIds = [action.targetId];
        blockChars = ['Captain', 'Ambassador'];
      } else if (action.type === 'assassinate') {
        blockerIds = [action.targetId];
        blockChars = ['Contessa'];
      } else {
        return false;
      }

      for (const bid of blockerIds) {
        const b = this.players[bid];
        if (!b || !b.alive) continue;
        const dec = await this.agents[bid].decideBlock(this, action, blockChars);
        if (!dec || !dec.block) continue;
        const ch = dec.character;

        this.log(`🛡️ ${b.name} 以【${ZH[ch]} ${ch}】之名，舉盾擋下這一擊`);
        this.hooks.onState();
        await this.hooks.pause();

        // 反制只由「當事人」（原行動者）質疑——兩人之間的對抗
        const res = await this.runChallenge(bid, ch, [action.actorId]);
        if (res.challenged && res.success) {
          this.log('➡️ 反制的假面被撕下，原行動繼續降臨');
          return false; // 反制者吹牛被抓 → 反制失敗 → 行動續行
        }
        // 行動被成功擋下：通知 AI（記憶「這人會擋我的這種行動」）
        this.notifyOutcome({ type: action.type, actorId: action.actorId, targetId: action.targetId, blocked: true, blockerId: bid, blockChar: ch });
        return true; // 反制成立 → 行動被擋
      }
      return false;
    }

    // 把要保留的牌（multiset）從牌池移除後，其餘退回牌庫
    applyExchange(player, kept) {
      const pool = player.cards.slice(); // 注意：呼叫前 drawn 已併入 player.cards
      const keep = [];
      const remainder = pool.slice();
      kept.forEach(c => {
        const i = remainder.indexOf(c);
        if (i >= 0) { keep.push(c); remainder.splice(i, 1); }
      });
      // 若代理人回傳不足或不合法，補足
      while (keep.length < player.originalInfluence) {
        keep.push(remainder.shift());
      }
      player.cards = keep.slice(0, player.originalInfluence);
      // 多餘的退回牌庫
      const leftover = pool.slice();
      player.cards.forEach(c => {
        const i = leftover.indexOf(c);
        if (i >= 0) leftover.splice(i, 1);
      });
      leftover.forEach(c => this.deck.push(c));
      shuffle(this.deck);
    }

    async doExchange(actor) {
      const keepCount = actor.cards.length;
      const drawn = [this.deck.pop(), this.deck.pop()].filter(Boolean);
      this.log(`🔄 ${actor.name} 自命運之輪抽出 ${drawn.length} 張,審視更迭`);
      actor.originalInfluence = keepCount;
      actor.cards = actor.cards.concat(drawn); // 暫時併入牌池
      let kept = await this.agents[actor.id].chooseExchange(this, actor.id, drawn);
      if (!Array.isArray(kept)) kept = actor.cards.slice(0, keepCount);
      this.applyExchange(actor, kept);
      delete actor.originalInfluence;
      (actor.timeline || (actor.timeline = [])).push({ kind: 'exchange', ch: 'Ambassador' });
      this.log(`🔄 ${actor.name} 換上新的面孔（保留 ${actor.cards.length} 張）`);
      this.hooks.onState();
    }

    // 修正不合法行動（資源/規則把關）
    sanitizeAction(actor, action) {
      action = action || { type: 'income' };
      const opps = this.alive().filter(p => p.id !== actor.id);
      const pickTarget = () => (opps.sort((a, b) =>
        (b.coins + b.cards.length * 3) - (a.coins + a.cards.length * 3))[0]);

      // 10+ 金幣（房規）：只允許 政變／暗殺／換牌；其餘行動一律改為政變
      if (actor.coins >= 10 && action.type !== 'coup' && action.type !== 'assassinate' && action.type !== 'exchange') {
        action = { type: 'coup', targetId: action.targetId };
      }
      // 負擔不起 → 退回收入
      if (action.type === 'coup' && actor.coins < 7) action = { type: 'income' };
      if (action.type === 'assassinate' && actor.coins < 3) action = { type: 'income' };
      // 目標行動需有合法目標
      if (ACTIONS[action.type] && ACTIONS[action.type].targeted) {
        const valid = opps.some(p => p.id === action.targetId);
        if (!valid) {
          const t = pickTarget();
          if (!t) return { type: 'income', actorId: actor.id };
          action.targetId = t.id;
        }
      }
      action.actorId = actor.id;
      return action;
    }

    // 核心：結算一個行動
    async resolveAction(action) {
      const actor = this.players[action.actorId];
      const meta = ACTIONS[action.type];
      const target = action.targetId != null ? this.players[action.targetId] : null;

      if (action.type === 'income') {
        actor.coins += 1;
        this.log(`💰 ${actor.name} 取一份微薄稅收 +1（共 ${actor.coins}）`);
        this.hooks.onState();
        return;
      }

      if (action.type === 'coup') {
        actor.coins -= 7;
        this.log(`🎯 ${actor.name} 傾盡 7 金幣，對 ${target.name} 發動政變`);
        this.hooks.onState();
        await this.hooks.pause();
        this.notifyOutcome({ type: 'coup', actorId: actor.id, targetId: target.id, blocked: false });
        await this.loseInfluence(target);
        return;
      }

      if (action.type === 'foreign_aid') {
        this.log(`🤝 ${actor.name} 向外邦尋求援助（+2）`);
        this.hooks.onState();
        await this.hooks.pause();
        const blocked = await this.runBlock(action);
        if (!blocked) {
          actor.coins += 2;
          this.log(`💰 援助悄然入袋 +2（共 ${actor.coins}）`);
        } else {
          this.log(`🚫 ${actor.name} 的外援被公爵之手截斷`);
        }
        this.hooks.onState();
        return;
      }

      // === 角色行動：tax / steal / assassinate / exchange ===
      if (action.type === 'assassinate') actor.coins -= 3; // 先付費
      const claimZh = `【${ZH[meta.character]} ${meta.character}】`;
      const deed =
        action.type === 'tax' ? '向國庫索取賦稅（+3）' :
        action.type === 'steal' ? `伸手攫取 ${target.name} 的錢袋` :
        action.type === 'assassinate' ? `對 ${target.name} 拔出匕首` :
        '向命運之輪乞求新的牌';
      this.log(`🗣️ ${actor.name} 披上${claimZh}的面紗，${deed}`);
      this.hooks.onState();
      await this.hooks.pause();

      // 質疑範圍：課稅(公爵)/換牌(大使)＝所有人可質疑；暗殺/偷竊＝只有目標當事人可質疑
      const everyoneCanChallenge = (action.type === 'tax' || action.type === 'exchange');
      const challengeEligible = everyoneCanChallenge ? undefined : [action.targetId];
      const cres = await this.runChallenge(actor.id, meta.character, challengeEligible);
      if (cres.challenged && cres.success) {
        if (action.type === 'assassinate') {
          actor.coins += 3; // 行動作廢 → 退費
          this.log(`↩️ 暗殺隨謊言作廢，退回 3 金幣`);
        }
        this.hooks.onState();
        return;
      }
      if (!actor.alive) return; // 理論上不會發生（誠實者）

      // 反制窗口（偷竊、暗殺）
      if (action.type === 'assassinate' || action.type === 'steal') {
        const blocked = await this.runBlock(action);
        if (blocked) {
          this.log(`🚫 ${actor.name} 的圖謀被擋了下來`);
          this.hooks.onState();
          return; // 暗殺費已付且不退
        }
      }

      // 套用效果
      switch (action.type) {
        case 'tax':
          actor.coins += 3;
          this.log(`💰 ${actor.name} 課得賦稅 +3（共 ${actor.coins}）`);
          break;
        case 'steal': {
          const amt = Math.min(2, target.coins);
          target.coins -= amt;
          actor.coins += amt;
          this.log(`💰 ${actor.name} 自 ${target.name} 攫走 ${amt} 金幣`);
          this.notifyOutcome({ type: 'steal', actorId: actor.id, targetId: target.id, blocked: false });
          break;
        }
        case 'assassinate':
          this.log(`🗡️ 匕首劃破夜空，命中 ${target.name}`);
          this.notifyOutcome({ type: 'assassinate', actorId: actor.id, targetId: target.id, blocked: false });
          await this.loseInfluence(target);
          break;
        case 'exchange':
          await this.doExchange(actor);
          break;
      }
      this.hooks.onState();
    }

    advance() {
      if (this.alive().length <= 1) return;
      do {
        this.current = (this.current + 1) % this.players.length;
      } while (!this.players[this.current].alive);
    }

    checkGameOver() {
      const a = this.alive();
      if (a.length <= 1) {
        this.over = true;
        this.winner = a[0] || null;
        return true;
      }
      return false;
    }

    // 主回合循環
    async play() {
      this.log('🎬 命運之輪開始轉動，宮廷陰謀就此展開……');
      this.hooks.onState();
      let safety = 0;
      while (!this.over && !this.cancelled) {
        if (++safety > 5000) {
          this.log('⚠️ 達到回合上限，依影響力/金幣判定勝者');
          const ranked = this.alive().slice().sort((a, b) =>
            (b.cards.length - a.cards.length) || (b.coins - a.coins));
          this.over = true;
          this.winner = ranked[0] || null;
          break;
        }
        const actor = this.players[this.current];
        if (!actor.alive) { this.advance(); continue; }

        this.hooks.onTurn(actor.id);
        await this.hooks.pause();
        if (this.cancelled) return null; // 開新局：中止舊迴圈，避免兩局並行驅動 UI

        let action = await this.agents[actor.id].chooseAction(this);
        if (this.cancelled) return null;
        action = this.sanitizeAction(actor, action);
        await this.resolveAction(action);
        if (this.cancelled) return null;

        if (this.checkGameOver()) break;
        this.advance();
      }
      this.log(`🏁 塵埃落定，唯一存活者登上權力之巔：${this.winner ? this.winner.name : '無'}`);
      this.hooks.onState();
      this.hooks.onGameOver(this.winner);
      return this.winner;
    }

    cancel() { this.cancelled = true; } // 終止此局（開新局時呼叫）
  }

  Coup.GameController = GameController;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Coup;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
