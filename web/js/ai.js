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

  const VALUE = { Duke: 5, Captain: 4, Assassin: 4, Ambassador: 4, Contessa: 3, King: 6, Bandit: 5, Queen: 4 };
  const STYLES = ['leader', 'even', 'finish', 'rich', 'random'];
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
      } else {
        // 無具名：每維獨立隨機（測試/後備用）
        this.iq        = rnd(0.15, 1.0); // 智商：機率判讀精準度、應變、少犯蠢、認得套路
        this.trust     = rnd(0.0, 1.0);  // 對他人信任度：越高越少質疑、越信任宣示
        this.deceit    = rnd(0.0, 1.0);  // 說謊能力：吹牛行動與假反制的頻率
        this.ambition  = rnd(0.2, 1.0);  // 勝利渴望：進攻、政變時機、衝向致命金幣
        this.vengeance = rnd(0.0, 1.0);  // 報復程度：優先攻擊傷害過自己的人
        this.nerve     = rnd(0.0, 1.0);  // 膽識：壓力下/殘血時敢不敢賭一把
        this.style     = STYLES[Math.floor(Math.random() * STYLES.length)]; // 進攻取向
        this.personaName = this._dominantTrait();
      }
      this.bluffRole = Math.random() < 0.5 ? 'Duke' : 'Captain'; // 固定假身分，前後一致

      this.model = {};     // id -> { claims:{char:count}, lostSeen }  宣示建模
      this.blockedBy = {}; // blockerId -> { actionType: count }       我的行動被誰擋過幾次
      this.grudge = {};    // id -> 仇恨值（被攻擊/針對累積）           報復目標依據
      this.probing = false; // 本回合是否「故意拿外援去逼問公爵」（→ 之後更願意質疑該反制）
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

    // 對手「宣稱角色種類數」超過其手牌數的程度（吹牛嫌疑）
    suspicion(claimantId, influence) {
      const m = this.model[claimantId];
      if (!m) return 0;
      const distinct = Object.keys(m.claims).length;
      return Math.max(0, distinct - influence);
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

      // 信任度 → 對「會宣稱者通常為真」的先驗；智商 → 更會用行為訊號
      const honesty = 0.18 + this.trust * 0.30;            // 0.18~0.48
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
      threshold += (Math.random() - 0.5) * 0.10 * (1.4 - this.iq);     // 智商低 → 更隨機
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
        // （新規則下擋外援只有原行動者能質疑，詐唬更安全）
        let pr = 0.04 + this.deceit * 0.10;
        if (nearLethal) pr += (0.25 + 0.40 * this.ambition) * (0.4 + 0.6 * this.nerve);
        if (leftTwo) pr += 0.15 * this.ambition;       // 只剩兩人，不擋就被 farm 死
        return { block: Math.random() < Math.min(0.9, pr), character: 'Duke' };
      }

      if (action.type === 'steal') {
        if (me.cards.includes('Captain')) return { block: true, character: 'Captain' };
        if (me.cards.includes('Ambassador')) return { block: true, character: 'Ambassador' };
        const pr = Math.min(0.85, (0.12 + this.deceit * 0.40) * (0.5 + 0.7 * this.nerve));
        if (Math.random() < pr) return { block: true, character: Math.random() < 0.5 ? 'Captain' : 'Ambassador' };
        return { block: false };
      }

      if (action.type === 'assassinate') {
        if (holdsRole(me.cards, 'Contessa')) return { block: true, character: 'Contessa' };
        const wouldDie = myInf === 1; // 假夫人高風險（拆穿一次失兩張）；保命時更敢賭
        const pr = Math.min(0.9, (wouldDie ? 0.55 : 0.18) * (0.4 + this.deceit + this.nerve * 0.5));
        if (Math.random() < pr) return { block: true, character: 'Contessa' };
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

    chooseAction(game) {
      const me = game.players[this.id];
      const opps = game.players.filter(p => p.alive && p.id !== this.id);
      const target = this.pickTarget(game);
      this.probing = false; // 每回合重置試探旗標
      if (!target) return { type: 'income' };

      // 強制政變
      if (me.coins >= 10) return { type: 'coup', targetId: target.id };
      // 8+ 幾乎必政變：囤金幣只會被白白政變掉，且 10 就強制（修正觀察到的「囤到 11 反而送頭」）
      if (me.coins >= 8) return { type: 'coup', targetId: target.id };
      // 7：殘血必收，否則依野心決定政變或續攢
      const coupUrge = 0.30 + this.ambition * 0.60;
      if (me.coins >= 7 && (target.cards.length === 1 || Math.random() < coupUrge))
        return { type: 'coup', targetId: target.id };

      // 真 Assassin 暗殺
      if (holdsRole(me.cards, 'Assassin') && me.coins >= 3) {
        return { type: 'assassinate', targetId: target.id };
      }
      // 真 Captain 偷竊 — 被某人擋過「一次」就別再撞同一面盾（智商越高越果斷），改攢錢
      if (me.cards.includes('Captain')) {
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
      if (me.cards.includes('Ambassador')) {
        const weak = !holdsRole(me.cards, 'Duke') && !holdsRole(me.cards, 'Contessa');
        if (weak && Math.random() < 0.4 + 0.2 * this.iq) return { type: 'exchange' };
      }

      // 攢錢取向：聰明且有野心者在 4~6 金幣時更傾向穩定累積，衝向 7 政變（不空轉）
      const wantBank = me.coins >= 4 && me.coins < 7 && (this.iq * 0.5 + this.ambition * 0.5) > 0.5;

      // === 吹牛 / 累積 ===
      const r = Math.random();
      const dec = this.deceit;
      // 吹牛暗殺（有錢、夠敢）
      if (me.coins >= 3 && r < 0.10 * dec * (0.5 + this.ambition)) {
        return { type: 'assassinate', targetId: target.id };
      }
      const dukeBias = this.bluffRole === 'Duke' ? 0.18 : 0;
      const capBias = this.bluffRole === 'Captain' ? 0.18 : 0;
      // 吹牛課稅（宣稱 Duke）— 攢錢取向更愛
      if (r < 0.22 + dukeBias + 0.26 * dec + (wantBank ? 0.15 : 0)) return { type: 'tax' };
      // 吹牛偷竊（宣稱 Captain）
      if (r < 0.38 + capBias + 0.20 * dec) {
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
  }

  // 10 位具名角色：性格相對固定（每場僅微浮動），各有鮮明風格。
  // 參數 0~1：iq 智商、trust 信任、deceit 詐術、ambition 野心、vengeance 仇恨傾向、nerve 膽識。
  AIAgent.PERSONAS = [
    { name: '老謀子', iq: 0.92, trust: 0.30, deceit: 0.70, ambition: 0.55, vengeance: 0.45, nerve: 0.70, style: 'random' }, // 老練謀士，難捉摸
    { name: '鐵衛',   iq: 0.85, trust: 0.80, deceit: 0.20, ambition: 0.55, vengeance: 0.25, nerve: 0.50, style: 'even'   }, // 正直穩健
    { name: '血手',   iq: 0.55, trust: 0.25, deceit: 0.45, ambition: 0.90, vengeance: 0.85, nerve: 0.85, style: 'leader' }, // 兇悍記仇
    { name: '影后',   iq: 0.88, trust: 0.45, deceit: 0.92, ambition: 0.55, vengeance: 0.30, nerve: 0.80, style: 'rich'   }, // 詐術大師
    { name: '賭徒',   iq: 0.50, trust: 0.50, deceit: 0.75, ambition: 0.80, vengeance: 0.50, nerve: 0.95, style: 'random' }, // 豪賭莽撞
    { name: '修士',   iq: 0.86, trust: 0.85, deceit: 0.12, ambition: 0.35, vengeance: 0.15, nerve: 0.30, style: 'even'   }, // 清心寡慾、誠實被動
    { name: '屠夫',   iq: 0.45, trust: 0.30, deceit: 0.40, ambition: 0.95, vengeance: 0.80, nerve: 0.80, style: 'finish' }, // 嗜殺、專收殘血
    { name: '狐',     iq: 0.96, trust: 0.30, deceit: 0.78, ambition: 0.55, vengeance: 0.45, nerve: 0.55, style: 'rich'   }, // 極聰明的機會主義者
    { name: '雛鳥',   iq: 0.25, trust: 0.85, deceit: 0.25, ambition: 0.45, vengeance: 0.25, nerve: 0.30, style: 'random' }, // 生澀好騙（較弱）
    { name: '暴君',   iq: 0.78, trust: 0.25, deceit: 0.50, ambition: 0.95, vengeance: 0.92, nerve: 0.85, style: 'leader' }  // 強勢、睚眥必報
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
