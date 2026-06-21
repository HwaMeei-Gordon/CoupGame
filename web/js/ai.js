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
      // 吹牛係數 / 質疑積極度
      const presets = {
        easy:   { bluff: 0.20, challenge: 0.85 },
        normal: { bluff: 0.45, challenge: 1.00 },
        hard:   { bluff: 0.60, challenge: 1.15 }
      };
      const p = presets[this.difficulty] || presets.normal;
      this.bluff = p.bluff;
      this.aggr = p.challenge;
      this.model = {}; // 對手建模：id -> { claims:{char:次數}, lostSeen }
      // 吹牛人設：固定偏好一個假身分,讓謊言前後一致、較不易被識破
      this.persona = Math.random() < 0.5 ? 'Duke' : 'Captain';
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
      let threshold = 0.45 * this.aggr;
      if (claimant.cards.length === 1) threshold += 0.10; // 殘血積極抓
      if (me.cards.length === 1) threshold -= 0.15;       // 自己殘血保守
      // 對手建模：宣稱角色種類數超過手牌數 → 提高質疑意願
      threshold += this.suspicion(claimantId, claimant.cards.length) * 0.18;
      threshold += (Math.random() - 0.5) * 0.10;
      return truth < threshold;
    }

    decideChallengeBlock(game, blockerId, character) {
      return this.decideChallenge(game, blockerId, character);
    }

    decideBlock(game, action, blockChars) {
      const me = game.players[this.id];

      if (action.type === 'foreign_aid') {
        const actor = game.players[action.actorId];
        if (me.cards.includes('Duke')) {
          // 真 Duke：對手越領先越想擋
          const lead = actor.coins >= 5 ? 0.8 : 0.5;
          return { block: Math.random() < lead, character: 'Duke' };
        }
        return { block: Math.random() < 0.05 * this.bluff, character: 'Duke' };
      }

      if (action.type === 'steal') {
        if (me.cards.includes('Captain')) return { block: true, character: 'Captain' };
        if (me.cards.includes('Ambassador')) return { block: true, character: 'Ambassador' };
        if (Math.random() < 0.35 * this.bluff) {
          return { block: true, character: Math.random() < 0.5 ? 'Captain' : 'Ambassador' };
        }
        return { block: false };
      }

      if (action.type === 'assassinate') {
        if (me.cards.includes('Contessa')) return { block: true, character: 'Contessa' };
        // 假 Contessa：高風險（被拆穿一次失兩張）。保命時更願意賭。
        const wouldDie = me.cards.length === 1;
        const prob = (wouldDie ? 0.55 : 0.25) * (0.5 + this.bluff);
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

    // 選擇攻擊目標：威脅加權 + 隨機,對「所有人」都有敵意(會打其他 AI,而非只盯玩家)
    pickTarget(game) {
      const opps = game.players.filter(p => p.alive && p.id !== this.id);
      if (opps.length === 0) return null;
      const scored = opps.map(o => {
        let w = o.coins * 0.5 + o.cards.length * 3 + 1;
        if (o.cards.length === 1) w += 7;        // 趁機收人頭
        w += Math.random() * 6;                  // 分散火力,讓 AI 互相攻擊
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
      // 划算政變:能收殘血、金幣充裕、或多半時候都發動(積極搶第一)
      if (me.coins >= 7 && (target.cards.length === 1 || me.coins >= 8 || Math.random() < 0.85))
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

      // === 吹牛 / 累積（依 persona 維持一致,謊言較不易被識破） ===
      const r = Math.random();
      // 吹牛暗殺（有錢、夠兇）
      if (me.coins >= 3 && r < 0.10 * this.bluff) {
        return { type: 'assassinate', targetId: target.id };
      }
      const dukeBias = this.persona === 'Duke' ? 0.20 : 0;
      const capBias = this.persona === 'Captain' ? 0.20 : 0;
      // 吹牛課稅（宣稱 Duke）
      if (r < 0.28 + dukeBias + 0.22 * this.bluff) return { type: 'tax' };
      // 吹牛偷竊（宣稱 Captain）
      if (r < 0.42 + capBias + 0.22 * this.bluff) {
        const t = this.stealTarget(opps);
        if (t) return { type: 'steal', targetId: t.id };
      }
      // 保守：外援 / 收入
      if (Math.random() < 0.5) return { type: 'foreign_aid' };
      return { type: 'income' };
    }
  }

  Coup.AIAgent = AIAgent;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Coup;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
