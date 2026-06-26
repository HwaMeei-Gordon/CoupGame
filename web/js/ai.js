/*
 * AIAgent：以牌面機率 + 對手建模 + 多維隨機性格驅動的電腦對手。
 *
 * 不再有「難度」差異——每個 AI 在每場開局時，獨立隨機抽取多個性格維度
 * （智商 / 信任 / 說謊 / 野心 / 報復 / 膽識 + 進攻風格），可重複，藏於暗處，
 * 讓每位對手難以捉摸。各維度都實際影響不同決策。
 */
(function (root) {
  'use strict';
  const Coup = root.Coup = root.Coup || {};
  const comb = Coup.comb;
  const holdsRole = Coup.holdsRole || ((cards, ch) => (cards || []).includes(ch));
  const roleMatches = Coup.roleMatches || ((c, ch) => c === ch);

  const VALUE = { Duke: 5, Captain: 4, Assassin: 4, Ambassador: 4, Contessa: 3, King: 6, Devil: 6, Queen: 4, Mole: 5, Commander: 5 };
  const STYLES = ['leader', 'even', 'finish', 'rich', 'random'];
  // 思考型態：直覺(快/憑感覺)、思考(慢/精算)、計謀(深/善詐善看破)、賭博(中/愛拚)
  const THINK = ['intuition', 'analysis', 'scheme', 'gamble'];
  const THINK_DEPTH = { intuition: 0.20, analysis: 0.95, scheme: 0.88, gamble: 0.52 }; // 思考深度基準（計謀＝深算、賭博＝憑直覺搏命）
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sum = obj => Object.keys(obj).reduce((s, k) => s + obj[k], 0);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const jit = (base, amt) => base + (Math.random() * 2 - 1) * amt; // 微微浮動

  class AIAgent {
    constructor(id, persona) {
      this.id = id;
      if (persona && typeof persona === 'object') {
        // 具名角色：性格相對固定，每場僅微微浮動（±0.08）
        this.personaName = persona.name;
        this.iq        = clamp(jit(persona.iq, 0.08), 0.1, 1);
        this.trust     = clamp(jit(persona.trust, 0.08), 0, 1);
        this.deceit    = clamp(jit(persona.deceit, 0.08), 0, 1);
        this.ambition  = clamp(jit(persona.ambition, 0.08), 0.2, 1);
        this.vengeance = clamp(jit(persona.vengeance, 0.08), 0, 1);
        this.nerve     = clamp(jit(persona.nerve, 0.08), 0, 1);
        this.style     = persona.style;
        this.think     = persona.think || THINK[Math.floor(Math.random() * THINK.length)];
      } else {
        // 無具名：每維獨立隨機（測試/後備用）
        this.iq        = rnd(0.15, 1.0); // 智商：機率判讀精準度、應變、少犯蠢、認得套路
        this.trust     = rnd(0.0, 1.0);  // 對他人信任度：越高越少質疑、越信任宣示
        this.deceit    = rnd(0.0, 1.0);  // 說謊能力：吹牛行動與假反制的頻率
        this.ambition  = rnd(0.2, 1.0);  // 勝利渴望：進攻、政變時機、衝向致命金幣
        this.vengeance = rnd(0.0, 1.0);  // 報復程度：優先攻擊傷害過自己的人
        this.nerve     = rnd(0.0, 1.0);  // 膽識：壓力下/殘血時敢不敢賭一把
        this.style     = STYLES[Math.floor(Math.random() * STYLES.length)]; // 進攻取向
        this.think     = THINK[Math.floor(Math.random() * THINK.length)];   // 思考型態
        this.personaName = this._dominantTrait();
      }
      // 思考「深度」現在只決定【思考時間長短】的表演（直覺型答得快、思考型沉吟久）
      this.depth = clamp(THINK_DEPTH[this.think] * 0.6 + this.iq * 0.4, 0.1, 1);
      // 「技術」與深度脫鉤：每個人都很厲害（都會算 EV、看公開牌、質疑精準），
      // 只隨智商微幅高低。風格(冒險/詐術/穩健)才是差異所在，技術一律在線。
      this.skill = clamp(0.82 + this.iq * 0.16, 0.6, 1);
      this.focusId = null; // 策略規劃：鎖定中的施壓目標（思考/計謀型會跨回合維持）
      this.bluffRole = Math.random() < 0.5 ? 'Duke' : 'Captain'; // 固定假身分，前後一致

      this.model = {};     // id -> { claims:{char:count}, lostSeen }  宣示建模
      this.blockedBy = {}; // blockerId -> { actionType: count }       我的行動被誰擋過幾次
      this.grudge = {};    // id -> 仇恨值（被攻擊/針對累積）           報復目標依據
      this.probing = false; // 本回合是否「故意拿外援去逼問公爵」（→ 之後更願意質疑該反制）
      // 過程中的動態調整：基礎參數固定，這些隨「自己的表現」累積，邊打邊修正策略
      this.adapt = { bluffsMade: 0, bluffsCaught: 0, challMade: 0, challWrong: 0 };
    }

    _dominantTrait() {
      const t = [['智多', this.iq], ['多疑', 1 - this.trust], ['詐術', this.deceit],
                 ['野心', this.ambition], ['睚眥', this.vengeance], ['膽識', this.nerve]];
      t.sort((a, b) => b[1] - a[1]);
      return t[0][0];
    }

    // ---- 觀察 / 記憶 ----

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

    // 某玩家被質疑、亮牌證實後換了新牌：手牌已變 → 重置其宣示模型，內部機率重新評估。
    onSwap(game, playerId, character) {
      if (playerId === this.id) return;
      const m = this.model[playerId];
      if (!m) return;
      const target = game.players[playerId];
      m.claims = {};
      m.lostSeen = target ? target.lost.length : 0;
    }

    // 行動結果回報：記憶「誰一直擋我」（反制鬼打牆）與「誰攻擊我」（報復）
    observeOutcome(game, ev) {
      if (!ev) return;
      if (ev.blocked && ev.blockerId != null) {
        const b = this.blockedBy[ev.blockerId] || (this.blockedBy[ev.blockerId] = {});
        // 我的行動被擋：強記；旁觀他人被同一人擋下：公開資訊，弱學習(別跟著去餵)
        b[ev.type] = (b[ev.type] || 0) + (ev.actorId === this.id ? 1 : 0.5);
      }
      if (!ev.blocked && ev.targetId === this.id && ev.actorId !== this.id && ev.actorId != null) {
        const w = (ev.type === 'coup' || ev.type === 'assassinate') ? 3 : 1;
        this.grudge[ev.actorId] = (this.grudge[ev.actorId] || 0) + w;
      }
    }

    // 質疑結果回報（過程中學習）：自己的吹牛被抓 → 之後收斂；自己質疑猜錯 → 之後更謹慎
    observeChallenge(game, ev) {
      if (!ev) return;
      if (ev.of === this.id && ev.success) this.adapt.bluffsCaught++;   // 我被拆穿
      if (ev.by === this.id) { this.adapt.challMade++; if (!ev.success) this.adapt.challWrong++; } // 我質疑（猜錯=對方為真）
    }

    // 局勢評估：我相對全場的強弱（-1 落後 .. +1 領先），用影響力(權重高)+金幣
    _standing(game) {
      const me = game.players[this.id];
      const alive = game.players.filter(p => p.alive);
      if (!alive.length) return 0;
      const pow = p => p.cards.length * 3 + p.coins * 0.5;
      const avg = alive.reduce((s, p) => s + pow(p), 0) / alive.length;
      return clamp((pow(me) - avg) / 6, -1, 1);
    }
    // 殘局程度：0=開局滿員 .. 1=只剩兩人決鬥
    _phase(game) {
      const total = game.players.length, alive = game.players.filter(p => p.alive).length;
      return total <= 2 ? 1 : clamp((total - alive) / (total - 2), 0, 1);
    }
    // 動態參數：基礎性格 + 局勢(領先/落後/殘局) + 自己的表現(被抓/猜錯) → 即時調整
    _dyn(game) {
      const st = this._standing(game), ph = this._phase(game), a = this.adapt;
      // 落後 → 更敢拚；領先 → 守成；殘局 → 整體更積極
      const aggr = clamp(this.ambition + (st < 0 ? -st * 0.35 : -st * 0.20) + ph * 0.20, 0, 1.3);
      const risk = clamp(this.nerve + (st < 0 ? -st * 0.30 : 0) + ph * 0.15, 0, 1.3);
      // 吹牛被抓越多 → 越收斂；落後/殘局 → 略增搏一把
      const caughtRate = a.bluffsMade ? a.bluffsCaught / a.bluffsMade : 0;
      const bluffProp = clamp(1 - caughtRate * 0.6 + (st < 0 ? 0.15 : 0) + ph * 0.10, 0.25, 1.4);
      // 質疑猜錯越多 → 越謹慎(threshold↓)。注意：落後不該「亂質疑」(那只會死更快)——
      // 落後的搏命改由 bluffProp/aggr 表現(多詐唬、多攻擊)，質疑反而要更冷靜。
      const wrongRate = a.challMade ? a.challWrong / a.challMade : 0;
      const challBias = -wrongRate * 0.13 + ph * 0.04;
      return { aggr, risk, bluffProp, challBias, st, ph };
    }

    // 對手「宣稱角色種類數」超過其手牌數的程度（吹牛嫌疑）
    suspicion(claimantId, influence) {
      const m = this.model[claimantId];
      if (!m) return 0;
      const distinct = Object.keys(m.claims).length;
      return Math.max(0, distinct - influence);
    }

    // 思考時間倍率（引擎在 AI 決策前以此乘上基礎節奏）：思考越深 → 停頓越久；
    // 直覺型幾乎即答、思考型沉吟良久。kind: 'action'(主要決策) / 'react'(臨場反應)
    thinkScale(kind) {
      const base = kind === 'action' ? 0.55 + this.depth * 1.75 : 0.4 + this.depth * 0.8;
      return clamp(base * (0.8 + Math.random() * 0.5), 0.3, 2.8);
    }

    // 決策前準備：不再讀秒——只設定本回合的「深思預算」，讓 AI 馬上就能下出夠聰明的一手。
    // 技術(skill)一律在線：人人都全量評估候選、噪音小、看公開牌、質疑精準；風格才是差異。
    thinkTime(game, kind) {
      if (kind === 'action') {
        this._deliberation = Math.round(7 + this.skill * 5);          // ≈ 11~12 條候選，算很多
        this._roundQuality = clamp(0.80 + this.skill * 0.18, 0.7, 1); // 噪音小 → 夠聰明
      }
      return 0; // 已不用於讀秒
    }

    // 從本 AI 視角，推估某對手「至少持有一張 character」的機率
    estimateOpponentHas(game, targetId, character) {
      const me = game.players[this.id];
      let seen = 0;
      me.cards.forEach(c => { if (roleMatches(c, character)) seen++; }); // 國王算公爵
      let totalLost = 0;
      game.players.forEach(p => p.lost.forEach(c => {
        totalLost++;
        if (roleMatches(c, character)) seen++;
      }));
      const unknownTotal = 15 - me.cards.length - totalLost;
      const copies = 3 - seen;
      const target = game.players[targetId];
      const h = target.cards.length;
      if (copies <= 0 || unknownTotal <= 0 || h <= 0) return 0;
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

      // 信任度 → 對「會宣稱者通常為真」的先驗（技術好＝懂得「沒鐵證別亂質疑」，
      // 在大家都聰明少詐的盤面，宣稱多半為真 → 先驗拉高，減少亂質疑送頭）
      const honesty = 0.30 + this.trust * 0.26;            // 0.30~0.56
      const truth = p + (1 - p) * honesty;
      const m = this.model[claimantId];
      const sus = this.suspicion(claimantId, claimant.cards.length); // 宣稱種類>手牌
      const repeats = (m && m.claims[character]) || 0;              // 一再宣稱同角色

      // 基礎門檻低（牌面不可靠，主要看行為）；信任越高基礎越低。
      let threshold = 0.30 * (1 - this.trust * 0.5);
      threshold += sus * (0.34 + 0.20 * this.iq);          // 嫌疑：主要訊號，智商越高越敏銳
      if (repeats >= 2) threshold -= 0.10 * this.iq;       // 前後一致較可信（聰明者看得出）
      // 反制鬼打牆：這人一直擋我 → 賭一把拆穿（膽識加成）
      const b = this.blockedBy[claimantId];
      if (b) {
        const tot = sum(b);
        if (tot >= 2) threshold += Math.min(0.25, 0.08 * tot) * (0.5 + this.nerve);
      }
      // 報復：對仇人更願意賭質疑
      if (this.grudge[claimantId]) threshold += Math.min(0.12, this.grudge[claimantId] * 0.03) * this.vengeance;
      if (claimant.cards.length === 1) threshold += 0.05;  // 對方殘血值得拚
      if (me.cards.length === 1) threshold -= 0.18 * (1 - this.nerve); // 自己殘血別亂送（膽識高敢賭）
      // 挑戰刺客＝雙重風險（質疑錯→失質疑牌＋仍被暗殺＝一回合掉兩張），沒把握別賭命
      if (character === 'Assassin') threshold -= 0.16 + (me.cards.length <= 2 ? 0.05 : 0);
      // 手握大量金幣／領先時，別為小事冒險送命，守住優勢
      if (me.coins >= 7) threshold -= 0.08;
      // 我是「故意拿外援逼問公爵」的 → 既然來試探，就跟進質疑這個擋來驗證真偽（邏輯自洽）
      if (this.probing && character === 'Duke') { threshold += 0.24; this.probing = false; }

      // 思考型態：計謀者善看破綻（重訊號、少亂拆）、賭徒愛拚但也看一點訊號、
      // 思考者沒把握不出手、直覺者憑感覺
      if (this.think === 'scheme') threshold += sus * 0.22 - 0.05;          // 讀牌：很選擇性、只在真有破綻才拆
      else if (this.think === 'gamble') threshold += sus * 0.13 + 0.02 * (0.5 + this.nerve); // 敢拚但看訊號，不盲拆
      else if (this.think === 'analysis') threshold -= 0.04;
      // 亡國模式規則認知：各變體都讓「錯誤質疑」更慘（被多收金幣／奪牌／被換牌），更謹慎
      if (game.mode === 'kingdom') threshold -= 0.06 * (0.6 + this.skill); // 懂規則：錯誤質疑在亡國更慘

      // 過程中的動態調整：自己質疑常猜錯 → 更謹慎；殘局/落後 → 更願冒險質疑
      threshold += this._dyn(game).challBias;

      // 技術高 → 質疑少憑運氣（人人精準）；計謀型讀牌再精準（噪音再砍半）。風格差異在前面的加權。
      const noiseMul = this.think === 'scheme' ? 0.5 : 1;
      threshold += (Math.random() - 0.5) * 0.10 * clamp(1.3 - this.skill * 1.1, 0.12, 0.9) * noiseMul;
      return truth < threshold;
    }

    decideChallengeBlock(game, blockerId, character) {
      return this.decideChallenge(game, blockerId, character);
    }

    decideBlock(game, action, blockChars) {
      const me = game.players[this.id];
      const actor = game.players[action.actorId];
      const myInf = me.cards.length;

      if (action.type === 'foreign_aid') {
        const haveDuke = holdsRole(me.cards, 'Duke');
        const after = actor.coins + 2;
        const nearLethal = after >= 7;                 // 拿了這 +2 下一步就能政變
        const leftTwo = game.alive().length <= 2;
        if (haveDuke) {
          let pr = 0.45 + this.ambition * 0.35;
          if (actor.coins >= 5) pr += 0.2;
          if (nearLethal) pr += 0.3;
          return { block: Math.random() < Math.min(0.98, pr), character: 'Duke' };
        }
        // 沒公爵 → 詐唬擋。平時很少，但「對手逼近致命金幣／殘局」時野心+膽識會拚。
        // 看公開牌：公爵若已大量死光，硬宣稱公爵會被拆穿 → 大幅降低（全死光則不擋）。
        const credD = this._claimCredibility(game, 'Duke');
        let pr = 0.04 + this.deceit * 0.10;
        if (nearLethal) pr += (0.25 + 0.40 * this.ambition) * (0.4 + 0.6 * this.nerve);
        if (leftTwo) pr += 0.15 * this.ambition;       // 只剩兩人，不擋就被 farm 死
        pr *= credD;                                   // 公爵越不可信 → 越不該詐唬擋
        return { block: credD > 0 && Math.random() < Math.min(0.9, pr), character: 'Duke' };
      }

      if (action.type === 'steal') {
        if (holdsRole(me.cards, 'Captain')) return { block: true, character: 'Captain' };
        if (holdsRole(me.cards, 'Ambassador')) return { block: true, character: 'Ambassador' };
        // 詐唬擋：選「公開牌下較可信」的那張盾（隊長 vs 大使）
        const credC = this._claimCredibility(game, 'Captain'), credA = this._claimCredibility(game, 'Ambassador');
        const useCap = credC >= credA;
        const cred = Math.max(credC, credA);
        const pr = Math.min(0.85, (0.12 + this.deceit * 0.40) * (0.5 + 0.7 * this.nerve)) * cred;
        if (cred > 0 && Math.random() < pr) return { block: true, character: useCap ? 'Captain' : 'Ambassador' };
        return { block: false };
      }

      if (action.type === 'assassinate') {
        if (holdsRole(me.cards, 'Contessa')) return { block: true, character: 'Contessa' };
        // 詐唬夫人擋命：看公開牌——夫人若已全死光，硬宣稱必被拆 → 寧可不擋（白送一張）
        const credCo = this._claimCredibility(game, 'Contessa');
        const wouldDie = myInf === 1; // 假夫人高風險（拆穿一次失兩張）；保命時更敢賭
        const pr = Math.min(0.9, (wouldDie ? 0.55 : 0.18) * (0.4 + this.deceit + this.nerve * 0.5)) * credCo;
        if (credCo > 0 && Math.random() < pr) return { block: true, character: 'Contessa' };
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

    // 被內奸奪牌：交出最不值錢的一張（留下好牌）
    chooseCardToGive(game, playerId) {
      return this.chooseCardToLose(game, playerId);
    }

    chooseExchange(game, playerId, drawn) {
      const me = game.players[playerId];
      const pool = me.cards.slice(); // 引擎已把 drawn 併入 me.cards
      const keepCount = me.originalInfluence != null ? me.originalInfluence : (pool.length - drawn.length);
      const scored = pool.map(c => ({ c, v: (VALUE[c] || 3) + Math.random() * (0.4 - this.iq * 0.3) }));
      // 智商越高越懂得保留多樣性（避免同名重複，攻防更靈活）
      const seen = {};
      scored.forEach(s => { if (seen[s.c]) s.v -= 1.0 * (0.5 + this.iq); seen[s.c] = true; });
      scored.sort((a, b) => b.v - a.v);
      return scored.slice(0, keepCount).map(s => s.c);
    }

    // 選擇攻擊目標：依風格 + 野心 + 報復加權 + 隨機（智商越低越隨機）。對所有人都有敵意。
    pickTarget(game) {
      const opps = game.players.filter(p => p.alive && p.id !== this.id);
      if (opps.length === 0) return null;
      const maxInf = Math.max.apply(null, opps.map(o => o.cards.length));
      const maxCoins = Math.max.apply(null, opps.map(o => o.coins).concat(1));
      const scored = opps.map(o => {
        let w = 1;
        switch (this.style) {
          case 'leader': w += o.cards.length * 6 + o.coins * 0.5 + (o.cards.length === maxInf ? 5 : 0); break;
          case 'even':   w += o.cards.length * 5 + ((o.cards.length === maxInf && maxInf > 1) ? 6 : 0); break;
          case 'finish': w += (3 - o.cards.length) * 4 + o.coins * 0.2 + (o.cards.length === 1 ? 9 : 0); break;
          case 'rich':   w += (o.coins / maxCoins) * 9 + o.cards.length * 1.5; break;
          default:       w += o.cards.length * 1.5 + o.coins * 0.3; break;
        }
        if (o.cards.length === 1) w += (this.style === 'even' ? 1 : 3); // 殘血終究誘人
        if (this.grudge[o.id]) w += Math.min(8, this.grudge[o.id]) * this.vengeance * 1.4; // 報復
        w += o.cards.length * this.ambition * 1.0; // 野心：盯著影響力高的領先者
        w += Math.random() * (2 + (1 - this.iq) * 8 + (this.style === 'random' ? 6 : 0));
        return { o, w };
      });
      scored.sort((a, b) => b.w - a.w);
      return scored[0].o;
    }

    // 偷竊目標：有錢者優先；避開老擋我的人（智商越高越會避）；仇人加權
    stealTarget(opps) {
      const rich = opps.filter(o => o.coins >= 1);
      if (!rich.length) return null;
      return rich.map(o => {
        let w = o.coins + Math.random() * 3;
        const blk = (this.blockedBy[o.id] && this.blockedBy[o.id].steal) || 0;
        if (blk) w -= blk * 4 * (0.5 + this.iq);
        if (this.grudge[o.id]) w += this.grudge[o.id] * this.vengeance;
        return { o, w };
      }).sort((a, b) => b.w - a.w)[0].o;
    }

    // 場上「有人會用公爵擋外援」的可信度 0..1：誰宣示過公爵、誰擋過我外援。
    // 用來判斷「現在拿外援會不會被白擋」——已立公爵的人在場，外援多半是浪費回合。
    dukeBlockThreat(game) {
      let threat = 0;
      game.players.forEach(p => {
        if (!p.alive || p.id === this.id) return;
        let t = 0;
        const m = this.model[p.id];
        const dukeClaims = (m && m.claims['Duke']) || 0;
        if (dukeClaims > 0) t = Math.min(0.85, 0.45 + 0.2 * dukeClaims); // 宣示過公爵(越多次越可信)
        const bb = (this.blockedBy[p.id] && this.blockedBy[p.id].foreign_aid) || 0;
        if (bb > 0) t = Math.max(t, Math.min(0.95, 0.6 + 0.2 * bb));     // 曾擋過我外援(鐵證)
        threat = Math.max(threat, t);
      });
      return threat;
    }

    // 直覺策略（本能手）：快速、帶性格與隨機/吹牛。深思時會被當成候選之一再評估。
    _basePolicy(game) {
      const me = game.players[this.id];
      const opps = game.players.filter(p => p.alive && p.id !== this.id);
      let target = this.pickTarget(game);
      this.probing = false; // 每回合重置試探旗標
      if (!target) { this.focusId = null; return { type: 'income' }; }

      // 策略規劃：思考／計謀型「鎖定目標」跨回合持續施壓，不每回合亂換——
      // 但若有殘血（1 張）可直接清，仍優先了結（除非鎖定的就是他）。
      if ((this.think === 'analysis' || this.think === 'scheme') && this.focusId != null) {
        const f = game.players[this.focusId];
        if (f && f.alive && f.id !== this.id) {
          const finishable = opps.find(o => o.cards.length === 1);
          if (!finishable || finishable.id === f.id) target = f;
        }
      }
      this.focusId = target.id;

      // 強制政變
      if (me.coins >= 10) return { type: 'coup', targetId: target.id };
      // 8+ 幾乎必政變：囤金幣只會被白白政變掉，且 10 就強制（修正觀察到的「囤到 11 反而送頭」）
      if (me.coins >= 8) return { type: 'coup', targetId: target.id };
      // 7：殘血必收，否則依野心決定政變或續攢（賭徒更急著動手、思考者更願再等一拍）
      const dyn = this._dynCache || {};
      const coupUrge = 0.30 + this.ambition * 0.60
        + (this.think === 'gamble' ? 0.15 : 0) - (this.think === 'analysis' ? 0.08 : 0)
        + (dyn.aggr != null ? (dyn.aggr - this.ambition) * 0.5 : 0); // 落後/殘局更急著動手
      if (me.coins >= 7 && (target.cards.length === 1 || Math.random() < coupUrge))
        return { type: 'coup', targetId: target.id };

      // 真 Assassin 暗殺
      if (holdsRole(me.cards, 'Assassin') && me.coins >= 3) {
        return { type: 'assassinate', targetId: target.id };
      }
      // 真 Captain 偷竊 — 被某人擋過「一次」就別再撞同一面盾（智商越高越果斷），改攢錢
      if (holdsRole(me.cards, 'Captain')) {
        const t = this.stealTarget(opps);
        if (t) {
          const blk = (this.blockedBy[t.id] && this.blockedBy[t.id].steal) || 0;
          const giveUp = blk >= 1 && Math.random() < (0.5 + 0.45 * this.iq) * Math.min(1, blk);
          if (!giveUp && Math.random() < 0.85) return { type: 'steal', targetId: t.id };
        }
      }
      // 真 Duke 課稅
      if (holdsRole(me.cards, 'Duke')) return { type: 'tax' };
      // 大使換牌（手牌偏弱時）
      if (holdsRole(me.cards, 'Ambassador')) {
        const weak = !holdsRole(me.cards, 'Duke') && !holdsRole(me.cards, 'Contessa');
        if (weak && Math.random() < 0.4 + 0.2 * this.iq) return { type: 'exchange' };
      }

      // 攢錢取向：聰明且有野心者在 4~6 金幣時更傾向穩定累積，衝向 7 政變（思考型尤甚）
      const wantBank = me.coins >= 4 && me.coins < 7 &&
        ((this.iq * 0.5 + this.ambition * 0.5) > 0.5 || this.think === 'analysis');

      // === 吹牛 / 累積 ===
      const r = Math.random();
      const dec = this.deceit;
      // 思考型態調節詐唬頻率（保留鮮明個性！計謀＝大膽詐術、賭徒＝高頻搏命、
      // 思考型謹慎少詐、直覺型居中）。再乘上動態調整：吹牛常被抓 → 收斂；落後/殘局 → 略增
      const bluffMul = (this.think === 'scheme' ? 1.28 : this.think === 'gamble' ? 1.32
        : this.think === 'analysis' ? 0.7 : 1.0) * (dyn.bluffProp != null ? dyn.bluffProp : 1);
      // 吹牛暗殺（有錢、夠敢）
      if (me.coins >= 3 && r < 0.10 * dec * bluffMul * (0.5 + this.ambition)) {
        return { type: 'assassinate', targetId: target.id };
      }
      const dukeBias = this.bluffRole === 'Duke' ? 0.18 : 0;
      const capBias = this.bluffRole === 'Captain' ? 0.18 : 0;
      // 吹牛課稅（宣稱 Duke）— 攢錢取向更愛
      if (r < 0.22 + dukeBias + 0.26 * dec * bluffMul + (wantBank ? 0.15 : 0)) return { type: 'tax' };
      // 吹牛偷竊（宣稱 Captain）
      if (r < 0.38 + capBias + 0.20 * dec * bluffMul) {
        const t = this.stealTarget(opps);
        if (t) return { type: 'steal', targetId: t.id };
      }
      // 外援 / 收入。場上若有已立可信公爵(會擋外援)：拿外援本身合法,但通常較低；
      // 多疑/有膽者會「故意拿外援逼問」對方跳公爵,再反過來質疑去驗證(設 probing 旗標跟進)。
      const threat = this.dukeBlockThreat(game);
      if (threat > 0.3) {
        const probe = ((1 - this.trust) * 0.35 + this.nerve * 0.20) * Math.max(0.05, 1 - threat * 0.8);
        if (Math.random() < probe) { this.probing = true; return { type: 'foreign_aid' }; }
        return { type: 'income' }; // 尊重已立公爵,不白送外援
      }
      // 無公爵威脅：正常多半拿外援(+2 優於收入)
      return Math.random() < 0.7 ? { type: 'foreign_aid' } : { type: 'income' };
    }

    // 列舉當前合法且有意義的候選行動（供深思評估）
    _candidates(game) {
      const me = game.players[this.id];
      const opps = game.players.filter(p => p.alive && p.id !== this.id);
      const out = [{ type: 'income' }, { type: 'tax' }, { type: 'exchange' }];
      if (me.coins < 10) out.push({ type: 'foreign_aid' });
      const tgt = this.pickTarget(game);
      const st = this.stealTarget(opps);
      if (st) out.push({ type: 'steal', targetId: st.id });
      if (me.coins >= 3 && tgt) out.push({ type: 'assassinate', targetId: tgt.id });
      if (me.coins >= 7 && tgt) out.push({ type: 'coup', targetId: tgt.id });
      return out;
    }

    // 某角色「至少一名（指定）對手持有」的機率（不指定＝任一對手）
    _pAnyHas(game, character, onlyId) {
      const ids = onlyId != null ? [onlyId]
        : game.players.filter(p => p.alive && p.id !== this.id).map(p => p.id);
      let pNo = 1;
      ids.forEach(id => { pNo *= (1 - this.estimateOpponentHas(game, id, character)); });
      return 1 - pNo;
    }

    // 詐唬（宣稱沒有的角色）被抓機率：對手越多、我牌越少（宣稱越誇張）越危險；擅詐者較不易露餡
    // 公開牌可信度：依「場上已亮出的死牌」推算宣稱 role 還有多可信（含變體）。
    // 1=完全可信(三張都還沒現身)；0=根本不可能(三張全死光，硬騙必被拆穿)。
    _claimCredibility(game, role) {
      let dead = 0;
      game.players.forEach(p => (p.lost || []).forEach(c => { if (roleMatches(c, role)) dead++; }));
      return Math.max(0, 3 - dead) / 3; // 1, 0.67, 0.33, 0
    }

    // 詐唬「宣稱 role」被拆穿的機率：對手越多越危險；公開死牌顯示越不可信 → 越易被抓；
    // 全部死光 → 幾乎必被拆。擅詐者(deceit)演技好，略降（但壓不過鐵證）。
    _bluffRisk(game, role) {
      const me = game.players[this.id];
      const n = game.players.filter(p => p.alive && p.id !== this.id).length;
      const cred = role ? this._claimCredibility(game, role) : 1;
      let pc = clamp(0.10 * n + (me.cards.length === 1 ? 0.10 : 0), 0.05, 0.72);
      pc += (1 - cred) * 0.5;          // 看公開牌：越不可信 → 被抓率大增
      pc *= (1 - this.deceit * 0.30);  // 演技
      if (cred <= 0) pc = 0.95;        // 該角色全死光：再會演也沒用
      return clamp(pc, 0.02, 0.95);
    }

    // 行動的期望價值評估（深思的核心）：含經濟/影響力收益、被質疑/反制風險、性格權重。
    // 單位約以「金幣當量」計；一張影響力 ≈ 7。深思者據此挑出高 EV 手，直覺者噪音大常憑本能。
    evalAction(game, a) {
      if (!a) return -Infinity;
      const me = game.players[this.id];
      const INF = 7, GAINC = 0.9, COSTC = 0.7;
      const tgt = a.targetId != null ? game.players[a.targetId] : null;
      const has = r => holdsRole(me.cards, r);
      const dyn = this._dynCache || {};
      const aggrRew = 1; // EV 一律「老實估」，不灌水——人人技術都在線（風格改由選擇時加權，見 _styleBonus）
      const riskTol = 1 - (dyn.risk != null ? dyn.risk : this.nerve) * 0.15; // 膽識/落後 略降風險感（但不無視）
      // 詐唬被抓機率（看公開牌算可信度，逐角色）；被抓多 → 更怕(↑)；落後/殘局 → 略降(↓)
      const bpropMul = dyn.bluffProp != null ? clamp(dyn.bluffProp, 0.4, 1.4) : 1;
      const bpc = role => clamp(this._bluffRisk(game, role) * riskTol / bpropMul, 0.02, 0.97);
      const grudgeB = (tgt && this.grudge[tgt.id]) ? Math.min(3, this.grudge[tgt.id]) * this.vengeance * 0.6 : 0;
      const CERTAIN = 0.9; // 機率高過此值＝「肯定」→ 硬性禁止白費的行動（不肯定則照常評估，由智商/噪音決定）
      const dead = role => this._claimCredibility(game, role) <= 0; // 該角色三張全公開死光＝宣稱必假
      switch (a.type) {
        case 'income': return 1 * GAINC + 0.2;               // 穩、無風險
        case 'foreign_aid': {
          if (has('Duke')) return -Infinity;                 // 絕不合理：手握公爵就課稅(+3)，不拿外援(+2 還可能被擋)
          const pB = Math.max(this.dukeBlockThreat(game), 0.6 * this._pAnyHas(game, 'Duke'));
          return 2 * GAINC * (1 - pB);
        }
        case 'tax': {
          if (has('Duke')) return 3 * GAINC + 0.4;           // 真公爵，被質疑反害對方
          if (dead('Duke')) return -Infinity;                // 絕不合理：公爵三張全死光還喊公爵
          const pc = bpc('Duke');
          return 3 * GAINC * (1 - pc) - pc * INF * riskTol;  // 吹牛課稅
        }
        case 'steal': {
          if (!tgt) return -1;
          const eCap = this.estimateOpponentHas(game, tgt.id, 'Captain');
          const eAmb = this.estimateOpponentHas(game, tgt.id, 'Ambassador');
          if (eCap >= CERTAIN || eAmb >= CERTAIN) return -Infinity; // 絕不合理：肯定對方有隊長/大使可擋，偷了白偷
          if (!has('Captain') && dead('Captain')) return -Infinity; // 絕不合理：隊長全死光還喊隊長偷
          const amt = Math.min(2, tgt.coins);
          const pB = 0.7 * (1 - (1 - eCap) * (1 - eAmb));
          const base = (amt * GAINC * (1 - pB) + grudgeB) * aggrRew;
          if (has('Captain')) return base + 0.3;
          const pc = bpc('Captain');
          return base * (1 - pc) - pc * INF * riskTol;
        }
        case 'assassinate': {
          if (!tgt) return -1;
          if (this.estimateOpponentHas(game, tgt.id, 'Contessa') >= CERTAIN) return -Infinity; // 絕不合理：肯定對方有夫人擋，白花 3 金幣
          if (!has('Assassin') && dead('Assassin')) return -Infinity; // 絕不合理：刺客全死光還喊暗殺
          const killV = INF * (tgt.cards.length === 1 ? 1.35 : 1.0) * (1 + this.ambition * 0.25) * aggrRew + grudgeB * 1.5;
          const pB = 0.8 * this.estimateOpponentHas(game, tgt.id, 'Contessa');
          const ev = killV * (1 - pB) - 3 * COSTC;
          if (has('Assassin')) return ev;
          const pc = bpc('Assassin');
          return ev * (1 - pc) - pc * INF * riskTol;          // 吹牛暗殺被質疑掉一張
        }
        case 'exchange': {
          const weak = !has('Duke') && !has('Contessa') && !has('Assassin');
          const v = (weak ? 1.8 : 0.8) + (me.cards.length === 1 ? 0.5 : 0);
          if (has('Ambassador')) return v;
          if (dead('Ambassador')) return -Infinity;          // 絕不合理：大使全死光還喊大使換牌
          const pc = bpc('Ambassador');
          return v * (1 - pc) - pc * INF * riskTol;
        }
        case 'coup': {
          if (!tgt) return -1;
          const killV = INF * (tgt.cards.length === 1 ? 1.4 : 1.0) * (1 + this.ambition * 0.3) * aggrRew + grudgeB * 1.5;
          return killV - 7 * COSTC + Math.max(0, me.coins - 7) * 0.6; // 不可擋/不可質疑；囤太多金幣→催促動手
        }
      }
      return 0;
    }

    // 風格偏好（在「老實 EV」之上的小幅加權）：人人技術都在線、決策都合理，
    // 風格只決定「在差不多好的選項裡偏愛哪種」——賭徒偏高變異攻擊、計謀偏詐術操作、
    // 思考偏穩健累積。幅度小，不會讓人去選明顯虧的手（所以大家都厲害，只是味道不同）。
    _styleBonus(type) {
      const t = this.think;
      if (t === 'gamble') return (type === 'coup' || type === 'assassinate' || type === 'steal') ? 0.45
        : (type === 'tax' || type === 'exchange') ? 0.22 : 0;         // 愛搏命攻擊、敢下注
      if (t === 'scheme') return (type === 'tax' || type === 'steal' || type === 'assassinate' || type === 'exchange') ? 0.28 : 0; // 愛用角色牌操作
      if (t === 'analysis') return (type === 'income' || type === 'foreign_aid') ? 0.3 : 0; // 偏穩健累積
      return 0; // 直覺：中性、靠快與臨場
    }

    // 主決策：深思＝真的算更多。預算(budget)由 thinkTime 依思考深度/局面難度設定——
    // 想越久 budget 越大 → 評估越多候選、噪音越小 → 決策品質越高（直覺型則少算、憑本能）。
    chooseAction(game) {
      const me = game.players[this.id];
      this._dynCache = this._dyn(game); // 本回合的動態調整（_basePolicy / evalAction 取用）
      const tgt = this.pickTarget(game);
      this.probing = false;
      if (!tgt) { this.focusId = null; return { type: 'income' }; }
      if (me.coins >= 10) { this.focusId = tgt.id; return { type: 'coup', targetId: tgt.id }; } // 強制

      const budget = this._deliberation || Math.round(2 + this.depth * 8);
      const q = this._roundQuality != null ? this._roundQuality : 0.5; // 本回合規劃量
      this._deliberation = 0; this._roundQuality = null; // 用完歸零（下次 thinkTime 再設）

      // 候選池：多次取樣本能手（風格/詐術/性格） + 列舉理性候選
      const pool = [];
      const samples = clamp(Math.round(budget * 0.6), 1, 7);
      for (let i = 0; i < samples; i++) pool.push(this._basePolicy(game));
      this._candidates(game).forEach(a => pool.push(a));

      // 技術高 → 認真評估全部候選、噪音小、挑得出最佳手（人人厲害；風格差異在 evalAction 權重）
      const considered = budget <= 3 ? pool.slice(0, 3) : pool;
      const noise = (1 - q) * 3.0;                  // 本回合規劃越多(想越久) → 噪音越小 → 這一手越聰明
      let best = null, bestV = -Infinity;
      considered.forEach(a => {
        const v = this.evalAction(game, a) + this._styleBonus(a.type) + (Math.random() * 2 - 1) * noise;
        if (v > bestV) { bestV = v; best = a; }
      });
      best = best || { type: 'income' };

      // probing 只有最終確為 foreign_aid 時才保留（本能取樣時可能設過）
      if (best.type !== 'foreign_aid') this.probing = false;
      // 策略規劃：鎖定目標跨回合（思考/計謀型）
      if (best.targetId != null) this.focusId = best.targetId;
      // 過程中學習：記錄這次是否吹牛（之後 _dyn 用被抓率收斂詐唬）
      const CLAIM = { tax: 'Duke', steal: 'Captain', assassinate: 'Assassin', exchange: 'Ambassador' };
      const claim = CLAIM[best.type];
      if (claim && !holdsRole(me.cards, claim)) this.adapt.bluffsMade++;
      return best;
    }
  }

  // 10 位具名角色：性格相對固定（每場僅微浮動），各有鮮明風格。
  // 參數 0~1：iq 智商、trust 信任、deceit 詐術、ambition 野心、vengeance 仇恨傾向、nerve 膽識。
  AIAgent.PERSONAS = [
    { name: '老謀子', iq: 0.92, trust: 0.30, deceit: 0.70, ambition: 0.55, vengeance: 0.45, nerve: 0.70, style: 'random', think: 'scheme'    }, // 老練謀士，深算難捉摸
    { name: '鐵衛',   iq: 0.85, trust: 0.80, deceit: 0.20, ambition: 0.55, vengeance: 0.25, nerve: 0.50, style: 'even',   think: 'analysis'  }, // 正直穩健、沉著精算
    { name: '血手',   iq: 0.55, trust: 0.25, deceit: 0.45, ambition: 0.90, vengeance: 0.85, nerve: 0.85, style: 'leader', think: 'gamble'    }, // 兇悍記仇、敢拚
    { name: '影后',   iq: 0.88, trust: 0.45, deceit: 0.92, ambition: 0.55, vengeance: 0.30, nerve: 0.80, style: 'rich',   think: 'scheme'    }, // 詐術大師、機關算盡
    { name: '賭徒',   iq: 0.50, trust: 0.50, deceit: 0.75, ambition: 0.80, vengeance: 0.50, nerve: 0.95, style: 'random', think: 'gamble'    }, // 豪賭莽撞
    { name: '修士',   iq: 0.86, trust: 0.85, deceit: 0.12, ambition: 0.35, vengeance: 0.15, nerve: 0.30, style: 'even',   think: 'analysis'  }, // 清心寡慾、誠實被動、深思
    { name: '屠夫',   iq: 0.45, trust: 0.30, deceit: 0.40, ambition: 0.95, vengeance: 0.80, nerve: 0.80, style: 'finish', think: 'intuition' }, // 嗜殺、憑直覺專收殘血
    { name: '狐',     iq: 0.96, trust: 0.30, deceit: 0.78, ambition: 0.55, vengeance: 0.45, nerve: 0.55, style: 'rich',   think: 'analysis'  }, // 極聰明的機會主義者
    { name: '雛鳥',   iq: 0.25, trust: 0.85, deceit: 0.25, ambition: 0.45, vengeance: 0.25, nerve: 0.30, style: 'random', think: 'intuition' }, // 生澀好騙、憑感覺（較弱）
    { name: '暴君',   iq: 0.78, trust: 0.25, deceit: 0.50, ambition: 0.95, vengeance: 0.92, nerve: 0.85, style: 'leader', think: 'scheme'    }  // 強勢、睚眥必報、城府深
  ];

  // 抽 n 位「不重複」的具名角色（每場開局由外層呼叫，隨機配發）
  AIAgent.drawPersonas = function (n) {
    const pool = AIAgent.PERSONAS.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.max(0, n));
  };

  Coup.AIAgent = AIAgent;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Coup;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
