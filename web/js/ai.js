/*
 * AIAgent：以牌面機率 + 期望值 + 混合策略吹牛驅動的電腦對手。
 * 同步回傳決策（引擎負責加上節奏延遲）。
 */
(function (root) {
  'use strict';
  const Coup = root.Coup = root.Coup || {};
  const CHARACTERS = Coup.CHARACTERS;
  const comb = Coup.comb;

  const VALUE = { Duke: 5, Captain: 4, Assassin: 4, Ambassador: 4, Contessa: 3 };

  class AIAgent {
    constructor(id, difficulty) {
      this.id = id;
      this.difficulty = difficulty || 'normal';
      // 5 種隱藏性格：風險/進攻保守度各異。每場隨機指派、可重複。
      const keys = Object.keys(AIAgent.PERSONAS);
      this.personaKey = keys[Math.floor(Math.random() * keys.length)];
      const P = AIAgent.PERSONAS[this.personaKey];
      this.personaName = P.name;
      // 難度作為全域微調(質疑/吹牛幅度、判讀精準度)
      const diff = ({
        easy:   { c: 0.82, b: 0.90, smart: 0.7 },
        normal: { c: 1.00, b: 1.00, smart: 1.0 },
        hard:   { c: 1.12, b: 1.05, smart: 1.25 }
      })[this.difficulty] || { c: 1, b: 1, smart: 1 };
      this.bluff = Math.min(0.9, P.bluff * diff.b);  // 吹牛頻率
      this.aggr = P.aggr * diff.c;                   // 質疑積極度
      this.attack = P.attack;                        // 進攻意願(政變/暗殺/吹牛攻擊)
      this.blockBluff = P.blockBluff;                // 詐唬反制傾向
      this.coupAt = P.coupAt;                        // 湊到 7 金幣時政變的機率
      this.smart = diff.smart;
      this.target = P.target;                        // 進攻取向(打誰)
      // 各取向的「隨機程度」：隨性型亂打、其餘較貫徹自己的風格
      this.targetNoise = ({ random: 9, even: 2, leader: 2.5, finish: 2.5, rich: 2.5 })[P.target] || 4;
      this.model = {}; // 對手建模：id -> { claims:{char:次數}, lostSeen }
      // 固定一個假身分,讓吹牛前後一致、較不易被識破
      this.bluffRole = Math.random() < 0.5 ? 'Duke' : 'Captain';
    }

    // 觀察某玩家的角色宣稱（引擎在每次宣稱時通知）
    observe(game, claimantId, character) {
      if (claimantId === this.id) return;
      const target = game.players[claimantId];
      const m = this.model[claimantId] ||
        (this.model[claimantId] = { claims: {}, lostSeen: target.lost.length });
      // 對手手牌一旦變動（失牌），先前宣稱的參考價值降低 → 重置
      if (target.lost.length !== m.lostSeen) { m.claims = {}; m.lostSeen = target.lost.length; }
      m.claims[character] = (m.claims[character] || 0) + 1;
    }

    // 某玩家被質疑、亮牌證實後「換了新牌」（公開手牌→洗回→改抽）。引擎在換牌後通知。
    // 該玩家手牌組成已改變,先前累積的角色宣示不再可靠 → 重置其宣示模型,內部機率重新評估。
    onSwap(game, playerId, character) {
      if (playerId === this.id) return; // 自己換牌無須對自己建模
      const m = this.model[playerId];
      if (!m) return;
      const target = game.players[playerId];
      m.claims = {};
      m.lostSeen = target ? target.lost.length : 0;
    }

    // 對手「宣稱角色種類數」超過其手牌數的程度（吹牛嫌疑）
    suspicion(claimantId, influence) {
      const m = this.model[claimantId];
      if (!m) return 0;
      const distinct = Object.keys(m.claims).length;
      return Math.max(0, distinct - influence); // 例如 2 影響力卻宣稱過 3 種角色 → 1
    }

    // 從本 AI 視角，推估某對手「至少持有一張 character」的機率
    estimateOpponentHas(game, targetId, character) {
      const me = game.players[this.id];
      let seen = 0;
      me.cards.forEach(c => { if (c === character) seen++; });
      let totalLost = 0;
      game.players.forEach(p => p.lost.forEach(c => {
        totalLost++;
        if (c === character) seen++;
      }));
      const unknownTotal = 15 - me.cards.length - totalLost;
      const copies = 3 - seen;
      const target = game.players[targetId];
      const h = target.cards.length;
      if (copies <= 0 || unknownTotal <= 0 || h <= 0) return copies <= 0 ? 0 : 0;
      if (unknownTotal - copies < 0) return 1;
      const pNone = comb(unknownTotal - copies, h) / comb(unknownTotal, h);
      return 1 - pNone;
    }

    // ---- Agent 介面 ----

    decideChallenge(game, claimantId, character) {
      if (claimantId === this.id) return false;
      const me = game.players[this.id];
      const claimant = game.players[claimantId];
      const p = this.estimateOpponentHas(game, claimantId, character);
      if (p <= 0.0001) return true; // 牌面不可能 → 必抓

      // 行為偏差：會宣稱者通常更可能為真
      const truth = p + (1 - p) * 0.30;
      const m = this.model[claimantId];
      const sus = this.suspicion(claimantId, claimant.cards.length); // 吹牛嫌疑(宣稱種類>手牌)
      const repeats = (m && m.claims[character]) || 0;               // 一再宣稱同角色(含本次)

      // 質疑代價極大(自失一牌、對方還換新牌),且牌面機率在本遊戲不可靠(換牌/重抽會打亂),
      // 因此「行為(過去宣示)」才是主要依據：基礎門檻很低(牌面只在近乎不可能時才賭),
      // 對「明顯吹牛(宣稱種類>手牌)」大幅提高質疑;對「前後一致宣稱同角色」則降低質疑(較可信)。
      let threshold = 0.26 * this.aggr;
      threshold += sus * 0.40;                            // 行為嫌疑:主要訊號
      if (repeats >= 2) threshold -= 0.10;                // 一再宣稱同角色 → 較可信,別亂質疑
      if (claimant.cards.length === 1) threshold += 0.05; // 殘血對手值得拚
      if (me.cards.length === 1) threshold -= 0.16;       // 自己殘血別亂送命
      threshold += (Math.random() - 0.5) * 0.07;
      return truth < threshold;
    }

    decideChallengeBlock(game, blockerId, character) {
      return this.decideChallenge(game, blockerId, character);
    }

    decideBlock(game, action, blockChars) {
      const me = game.players[this.id];

      const bb = this.blockBluff;

      if (action.type === 'foreign_aid') {
        const actor = game.players[action.actorId];
        if (me.cards.includes('Duke')) {
          // 真 Duke：對手越領先越想擋
          const lead = actor.coins >= 5 ? 0.8 : 0.5;
          return { block: Math.random() < lead, character: 'Duke' };
        }
        return { block: Math.random() < 0.05 * this.bluff * bb, character: 'Duke' };
      }

      if (action.type === 'steal') {
        if (me.cards.includes('Captain')) return { block: true, character: 'Captain' };
        if (me.cards.includes('Ambassador')) return { block: true, character: 'Ambassador' };
        if (Math.random() < 0.35 * this.bluff * bb) {
          return { block: true, character: Math.random() < 0.5 ? 'Captain' : 'Ambassador' };
        }
        return { block: false };
      }

      if (action.type === 'assassinate') {
        if (me.cards.includes('Contessa')) return { block: true, character: 'Contessa' };
        // 假 Contessa：高風險（被拆穿一次失兩張）。保命時更願意賭。
        const wouldDie = me.cards.length === 1;
        const prob = (wouldDie ? 0.55 : 0.25) * (0.5 + this.bluff * bb);
        if (Math.random() < prob) return { block: true, character: 'Contessa' };
        return { block: false };
      }

      return { block: false };
    }

    chooseCardToLose(game, playerId) {
      const me = game.players[playerId];
      let idx = 0, min = Infinity;
      me.cards.forEach((c, i) => {
        const v = (VALUE[c] || 3) + Math.random() * 0.01;
        if (v < min) { min = v; idx = i; }
      });
      return idx;
    }

    chooseExchange(game, playerId, drawn) {
      const me = game.players[playerId];
      const pool = me.cards.slice(); // 引擎已把 drawn 併入 me.cards
      const keepCount = me.originalInfluence != null ? me.originalInfluence : (pool.length - drawn.length);
      const scored = pool.map(c => ({ c, v: (VALUE[c] || 3) + Math.random() * 0.2 }));
      // 略為懲罰重複（保留多樣性）
      const seen = {};
      scored.forEach(s => { if (seen[s.c]) s.v -= 1.0; seen[s.c] = true; });
      scored.sort((a, b) => b.v - a.v);
      return scored.slice(0, keepCount).map(s => s.c);
    }

    // 選擇攻擊目標：依各性格的「進攻取向」加權 + 隨機。對所有人都有敵意(會打其他 AI,而非只盯玩家)。
    //  leader 擒王：打影響力(生命)最多者  even 均衡：讓大家生命盡量齊頭,優先打 2 條的
    //  finish 收割：優先解決殘血清場       rich 劫富：盯著錢多的  random 隨性：純威脅+大量隨機
    pickTarget(game) {
      const opps = game.players.filter(p => p.alive && p.id !== this.id);
      if (opps.length === 0) return null;
      const maxInf = Math.max.apply(null, opps.map(o => o.cards.length));
      const maxCoins = Math.max.apply(null, opps.map(o => o.coins).concat(1));
      const scored = opps.map(o => {
        let w = 1;
        switch (this.target) {
          case 'leader': // 擒賊先擒王：影響力最多者優先,其次有錢
            w += o.cards.length * 6 + o.coins * 0.5;
            if (o.cards.length === maxInf) w += 5;
            break;
          case 'even':   // 均衡：讓大家生命值盡量齊頭,優先打影響力較多的
            w += o.cards.length * 5;
            if (o.cards.length === maxInf && maxInf > 1) w += 6;
            break;
          case 'finish': // 收割：優先解決殘血、趁機清場
            w += (3 - o.cards.length) * 4 + o.coins * 0.2;
            if (o.cards.length === 1) w += 9;
            break;
          case 'rich':   // 劫富：盯著錢多的(視財富為威脅)
            w += (o.coins / maxCoins) * 9 + o.cards.length * 1.5;
            break;
          default:       // random/隨性：輕度威脅加權,大量隨機
            w += o.cards.length * 1.5 + o.coins * 0.3;
            break;
        }
        // 殘血終究誘人(但均衡型刻意少加,以維持齊頭)
        if (o.cards.length === 1) w += (this.target === 'even' ? 1 : 3);
        w += Math.random() * this.targetNoise;
        return { o, w };
      });
      scored.sort((a, b) => b.w - a.w);
      return scored[0].o;
    }

    // 偷竊目標：有錢者優先,但帶隨機(不會每次都偷同一人/玩家)
    stealTarget(opps) {
      const rich = opps.filter(o => o.coins >= 1);
      if (!rich.length) return null;
      return rich.map(o => ({ o, w: o.coins + Math.random() * 4 }))
        .sort((a, b) => b.w - a.w)[0].o;
    }

    chooseAction(game) {
      const me = game.players[this.id];
      const opps = game.players.filter(p => p.alive && p.id !== this.id);
      const target = this.pickTarget(game);
      if (!target) return { type: 'income' };

      // 強制政變
      if (me.coins >= 10) return { type: 'coup', targetId: target.id };
      // 划算政變:殘血必收、金幣充裕、或依性格的政變意願
      if (me.coins >= 7 && (target.cards.length === 1 || me.coins >= 8 || Math.random() < this.coupAt))
        return { type: 'coup', targetId: target.id };

      // 真 Assassin 暗殺
      if (me.cards.includes('Assassin') && me.coins >= 3) {
        return { type: 'assassinate', targetId: target.id };
      }
      // 真 Captain 偷竊
      if (me.cards.includes('Captain')) {
        const t = this.stealTarget(opps);
        if (t && Math.random() < 0.85) return { type: 'steal', targetId: t.id };
      }
      // 真 Duke 課稅
      if (me.cards.includes('Duke')) return { type: 'tax' };
      // 大使換牌（手牌偏弱時）
      if (me.cards.includes('Ambassador')) {
        const weakHand = !me.cards.includes('Duke') && !me.cards.includes('Contessa');
        if (weakHand && Math.random() < 0.45) return { type: 'exchange' };
      }

      // === 吹牛 / 累積（吹牛偏好固定假身分,前後一致;頻率隨性格的進攻意願） ===
      const r = Math.random();
      const atk = this.attack;
      // 吹牛暗殺（有錢、夠兇的性格才會）
      if (me.coins >= 3 && r < 0.12 * this.bluff * atk) {
        return { type: 'assassinate', targetId: target.id };
      }
      const dukeBias = this.bluffRole === 'Duke' ? 0.20 : 0;
      const capBias = this.bluffRole === 'Captain' ? 0.20 : 0;
      // 吹牛課稅（宣稱 Duke）
      if (r < 0.26 + dukeBias + 0.24 * this.bluff) return { type: 'tax' };
      // 吹牛偷竊（宣稱 Captain）— 進攻型更常偷
      if (r < 0.40 + capBias + 0.22 * this.bluff * atk) {
        const t = this.stealTarget(opps);
        if (t) return { type: 'steal', targetId: t.id };
      }
      // 保守：外援 / 收入(保守型更常選)
      if (Math.random() < 0.5) return { type: 'foreign_aid' };
      return { type: 'income' };
    }
  }

  // 5 種隱藏性格（風險、進攻保守度、進攻取向各異）。target = 打誰的取向。
  AIAgent.PERSONAS = {
    cautious:   { name: '謹慎', bluff: 0.20, aggr: 0.78, attack: 0.55, blockBluff: 0.5, coupAt: 0.55, target: 'finish' }, // 保守,專收殘血
    steady:     { name: '穩健', bluff: 0.45, aggr: 1.00, attack: 0.85, blockBluff: 1.0, coupAt: 0.85, target: 'even'   }, // 中庸,打得平均
    aggressive: { name: '兇悍', bluff: 0.55, aggr: 1.10, attack: 1.20, blockBluff: 1.3, coupAt: 1.00, target: 'leader' }, // 猛攻,擒賊先擒王
    cunning:    { name: '狡詐', bluff: 0.80, aggr: 0.92, attack: 0.95, blockBluff: 1.6, coupAt: 0.85, target: 'random' }, // 詐唬多,出手難捉摸
    paranoid:   { name: '多疑', bluff: 0.38, aggr: 1.42, attack: 0.80, blockBluff: 0.8, coupAt: 0.80, target: 'rich'   }  // 疑心重,盯著錢多的打
  };

  Coup.AIAgent = AIAgent;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Coup;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
