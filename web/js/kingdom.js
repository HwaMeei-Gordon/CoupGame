/*
 * 《王國暗戰》Hidden Kingdom v2 —— 卡牌 + 蓋牌喊行動 + 全員可質疑 的隱藏陣營推理。
 *
 * 四人，各為一座城堡，各自擁有：民心(=血，歸0被人民起義處死)、金幣、軍隊。
 * 身分秘密：👑王子 / 🛡忠臣 / 🗡叛徒×2。隊伍：王室(王子+忠臣) vs 叛徒。
 * 勝利：叛徒→讓王子死；王室→讓兩名叛徒都死。
 *
 * 牌庫(各2張)：課稅/徵兵/建設/支援/出征/造謠/換牌。收成為「萬用·不可質疑」(任何牌都可當收成)。
 * 流程：開局抽2；輪到你→蓋一張牌、喊行動(可與牌不符＝吹牛)、抽1補手。所有人可質疑：
 *   成功(你吹牛)→你民心-2金幣-2、行動取消、質疑者民心+2；失敗(你為真)→行動照常、質疑者民心-2金幣-2。
 * 換牌：抽2選2，並可再出一張(不可再換牌)。
 */
(function (root) {
  'use strict';
  const Coup = root.Coup = root.Coup || {};
  const shuffle = Coup.shuffle || function (a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const FACTION_ZH = { prince: '王子', loyalist: '忠臣', traitor: '叛徒' };
  Coup.KFACTION_ZH = FACTION_ZH;

  const CAP = 10; // 民心/金幣/軍隊上限
  const CARD_TYPES = ['tax', 'conscript', 'build', 'support', 'campaign', 'slander', 'exchange'];
  const ACT = {
    harvest: { zh: '收成', targeted: false, wild: true, can: () => true },
    tax: { zh: '課稅', targeted: false, can: () => true },
    conscript: { zh: '徵兵', targeted: false, can: a => a.coins >= 1 },
    build: { zh: '建設', targeted: false, can: a => a.coins >= 2 },
    support: { zh: '支援', targeted: true, can: a => a.army >= 1 },
    campaign: { zh: '出征', targeted: true, can: a => a.army >= 3 },
    slander: { zh: '造謠', targeted: true, can: a => a.coins >= 2 },
    exchange: { zh: '換牌', targeted: false, can: () => true }
  };
  Coup.KACT = ACT;

  function factionSet(n) {
    if (n <= 4) return ['prince', 'loyalist', 'traitor', 'traitor'];
    if (n === 5) return ['prince', 'loyalist', 'loyalist', 'traitor', 'traitor'];
    return ['prince', 'loyalist', 'loyalist', 'traitor', 'traitor', 'traitor'];
  }

  // ---------- 引擎 ----------
  class KGame {
    constructor(configs, hooks, opts) {
      opts = opts || {};
      this.hooks = Object.assign({
        onLog: () => {}, onState: () => {}, onTurn: () => {}, onGameOver: () => {}, pause: () => Promise.resolve()
      }, hooks || {});
      const n = configs.length;
      const fac = shuffle(factionSet(n).slice());
      const startMorale = opts.startMorale != null ? opts.startMorale : 6;
      const startCoins = opts.startCoins != null ? opts.startCoins : 2;
      const startArmy = opts.startArmy != null ? opts.startArmy : 0;
      this.deck = shuffle(CARD_TYPES.concat(CARD_TYPES)); // 各2張 = 14
      this.discard = [];
      this.players = configs.map((c, i) => ({
        id: i, name: c.name, isHuman: !!c.isHuman, faction: fac[i],
        morale: startMorale, coins: startCoins, army: startArmy, alive: true, hand: [], revealed: false
      }));
      this.players.forEach(p => { p.hand = [this.draw(), this.draw()]; });
      this.current = 0;
      this.over = false; this.winTeam = null; this.winReason = '';
      this.cancelled = false;
      this.agents = {};
      this.actions = []; // 公開行動史(供推理)：{ actor, declare, target, challenged, by, bluff }
    }

    team(f) { return f === 'traitor' ? 'traitor' : 'crown'; }
    alivePlayers() { return this.players.filter(p => p.alive); }
    traitorsAlive() { return this.players.filter(p => p.alive && p.faction === 'traitor'); }
    prince() { return this.players.find(p => p.faction === 'prince'); }
    loyalistAlive() { return this.players.some(p => p.alive && p.faction === 'loyalist'); }
    // 王子可否公開身分：忠臣已死、王子還活、尚未公開
    canReveal(p) { return p.faction === 'prince' && p.alive && !p.revealed && !this.loyalistAlive(); }
    revealPrince(p) {
      p.revealed = true;
      this.gain(p, 'morale', 2); this.gain(p, 'coins', 2); this.gain(p, 'army', 2);
      this.say(`👑 ${p.name} 公開王子身分！號召忠勇 —— 民心${p.morale}、金幣${p.coins}、軍隊${p.army}（從此明著打）`);
      this.hooks.onState();
    }
    say(m) { this.hooks.onLog(m); }

    draw() {
      if (!this.deck.length) { this.deck = shuffle(this.discard); this.discard = []; }
      if (!this.deck.length) this.deck = shuffle(CARD_TYPES.concat(CARD_TYPES)); // 後備
      return this.deck.pop();
    }
    refill(p) { while (p.alive && p.hand.length < 2) p.hand.push(this.draw()); }

    gain(p, key, n) { p[key] = clamp(p[key] + n, 0, CAP); }
    spend(p, key, n) { p[key] = clamp(p[key] - n, 0, CAP); }
    damageMorale(p, n, reason) {
      p.morale = clamp(p.morale - n, 0, CAP);
      if (p.morale <= 0) this.kill(p, reason || '民心盡失，人民起義');
    }
    kill(p, reason) {
      if (!p.alive) return;
      p.alive = false;
      this.discard.push.apply(this.discard, p.hand); p.hand = [];
      this.say(`☠️ ${p.name} ${reason ? '——' + reason : ''}　身分揭曉：【${FACTION_ZH[p.faction]}】`);
    }

    advance() {
      const n = this.players.length;
      for (let k = 1; k <= n; k++) { const id = (this.current + k) % n; if (this.players[id].alive) { this.current = id; return; } }
    }

    // 套用「已喊定且未被拆穿」的行動
    applyAction(actor, declare, target) {
      switch (declare) {
        case 'harvest': this.gain(actor, 'coins', 1); this.gain(actor, 'morale', 1);
          this.say(`🌾 ${actor.name} 收成 —— 金幣${actor.coins}、民心${actor.morale}`); break;
        case 'tax': this.gain(actor, 'coins', 3); this.spend(actor, 'morale', 1);
          this.say(`💰 ${actor.name} 課稅 —— 金幣${actor.coins}、民心${actor.morale}`);
          if (actor.morale <= 0) this.kill(actor, '苛稅激起民變'); break;
        case 'conscript': this.gain(actor, 'army', 2); this.spend(actor, 'coins', 1); this.spend(actor, 'morale', 1);
          this.say(`⚔️ ${actor.name} 徵兵 —— 軍隊${actor.army}、民心${actor.morale}`);
          if (actor.morale <= 0) this.kill(actor, '徵兵過度激起民變'); break;
        case 'build': this.spend(actor, 'coins', 2); this.gain(actor, 'morale', 2);
          this.say(`🏛️ ${actor.name} 建設 —— 金幣${actor.coins}、民心${actor.morale}`); break;
        case 'support': this.spend(actor, 'army', 1); this.gain(actor, 'morale', 1); if (target) this.gain(target, 'army', 1);
          this.say(`🤝 ${actor.name} 支援 ${target ? target.name : ''} —— 對方軍隊${target ? target.army : ''}、自己民心${actor.morale}`); break;
        case 'campaign': this.spend(actor, 'army', 3);
          if (target) {
            if (target.army < 3) { this.say(`🔥 ${actor.name} 出征 ${target.name}，破其城門！`); this.kill(target, '兵敗城破'); }
            else { this.spend(target, 'army', 3); this.say(`🔥 ${actor.name} 出征 ${target.name} —— 對方殘軍${target.army}`); }
          } break;
        case 'slander': this.spend(actor, 'coins', 2);
          if (target) { this.say(`🗣️ ${actor.name} 對 ${target.name} 散布謠言 —— 對方民心${clamp(target.morale - 2, 0, CAP)}`); this.damageMorale(target, 2, '謠言四起，人民起義'); }
          break;
      }
    }

    penalize(p, byChallenge) {
      this.spend(p, 'coins', 2);
      this.damageMorale(p, 2, byChallenge ? '謊言被拆穿，民心崩潰' : '');
    }

    checkWin() {
      const prince = this.prince();
      if (!prince || !prince.alive) return this.end('traitor', '王子身殞，王國易主 —— 叛徒得逞');
      if (this.traitorsAlive().length === 0) return this.end('crown', '叛徒盡除，朝堂清明 —— 王室安定');
      if (this.alivePlayers().length <= 1) return this.end(this.team(this.alivePlayers()[0] ? this.alivePlayers()[0].faction : 'prince'), '塵埃落定');
      return false;
    }
    end(team, reason) { this.over = true; this.winTeam = team; this.winReason = reason; return true; }

    // 解析一次「出牌+喊行動+質疑」；回傳是否真正執行了行動
    async resolveDeclare(actor, dec, isExtra) {
      const declare = dec.declare;
      const target = dec.targetId != null ? this.players[dec.targetId] : null;
      // 取出蓋的牌（換牌特例：牌可能在套用時才動）
      let cardIdx = dec.cardIdx;
      if (typeof cardIdx !== 'number' || cardIdx < 0 || cardIdx >= actor.hand.length) cardIdx = 0;
      const playedCard = actor.hand.splice(cardIdx, 1)[0];
      const rec = { actor: actor.id, declare, target: target ? target.id : null, challenged: false };

      this.say(`🎴 ${actor.name} 蓋下一張牌，宣稱要【${ACT[declare].zh}】${target ? '（對象：' + target.name + '）' : ''}`);
      this.hooks.onState();
      await this.hooks.pause();

      let proceed = true;
      if (declare !== 'harvest') {
        // 質疑窗：其他存活者依序決定（首位質疑者結算）
        const order = [];
        for (let k = 1; k <= this.players.length; k++) { const id = (actor.id + k) % this.players.length; if (this.players[id].alive && id !== actor.id) order.push(id); }
        let challengerId = null;
        for (const pid of order) {
          const ag = this.agents[pid];
          let wants = false;
          if (ag && typeof ag.decideChallenge === 'function') wants = await ag.decideChallenge(this, actor.id, declare, target ? target.id : null);
          if (wants) { challengerId = pid; break; }
        }
        if (challengerId != null) {
          const ch = this.players[challengerId];
          const bluff = (playedCard !== declare);
          rec.challenged = true; rec.by = challengerId; rec.bluff = bluff;
          this.say(`❓ ${ch.name} 質疑 ${actor.name} 的【${ACT[declare].zh}】！攤牌：${playedCard ? '【' + ACT[playedCard].zh + '】' : '（萬用）'}`);
          this.hooks.onState(); await this.hooks.pause();
          if (bluff) {
            this.say(`🔨 拆穿成功！${actor.name} 在吹牛 —— 民心-2、金幣-2；${ch.name} 民心+2`);
            this.penalize(actor, true); this.gain(ch, 'morale', 2);
            proceed = false;
          } else {
            this.say(`🛡️ 所言為真！${ch.name} 誤判 —— 民心-2、金幣-2；${actor.name} 行動照常`);
            this.penalize(ch, true);
          }
        }
      }

      this.discard.push(playedCard);
      this.actions.push(rec);

      if (proceed) {
        if (declare === 'exchange') {
          await this.doExchange(actor);
        } else {
          this.applyAction(actor, declare, target);
        }
      }
      this.hooks.onState();
      return proceed;
    }

    async doExchange(actor) {
      const d1 = this.draw(), d2 = this.draw();
      actor.hand.push(d1, d2); // 手上(已出換牌後剩1) + 抽2 = 3
      this.say(`🔀 ${actor.name} 換牌：抽 2 張，從 ${actor.hand.length} 張中保留 2 張`);
      let keep = await this.agents[actor.id].chooseKeep(this, actor.id, actor.hand.slice());
      if (!Array.isArray(keep) || keep.length !== 2) keep = actor.hand.slice(0, 2);
      // 將未保留的丟棄
      const kept = [];
      keep.forEach(c => { const i = actor.hand.indexOf(c); if (i >= 0) kept.push(actor.hand.splice(i, 1)[0]); });
      while (kept.length < 2 && actor.hand.length) kept.push(actor.hand.pop());
      this.discard.push.apply(this.discard, actor.hand);
      actor.hand = kept;
      this.hooks.onState();
      // 可再出一張(不可再換牌)
      if (!actor.alive) return;
      let extra = await this.agents[actor.id].chooseAction(this, true);
      if (extra && extra.declare && extra.declare !== 'exchange' && ACT[extra.declare] && ACT[extra.declare].can(actor)) {
        await this.resolveDeclare(actor, extra, true);
      }
    }

    async play() {
      this.say('🎬 四座城堡暗潮洶湧 —— 各自的民心、金幣、軍隊，與不可告人的身分……');
      this.hooks.onState();
      let safety = 0;
      while (!this.over && !this.cancelled) {
        if (++safety > 4000) { this.end('crown', '時局僵持'); break; }
        const actor = this.players[this.current];
        if (!actor.alive) { this.advance(); continue; }
        this.hooks.onTurn(actor.id);
        await this.hooks.pause();
        if (this.cancelled) return null;
        const dec = await this.agents[actor.id].chooseAction(this, false);
        if (this.cancelled) return null;
        if (dec && dec.reveal && this.canReveal(actor)) {
          this.revealPrince(actor); // 公開身分＝這一回合的行動（取得 +2/+2/+2）
        } else {
          await this.resolveDeclare(actor, dec, false);
          if (actor.alive) this.refill(actor);
        }
        if (this.checkWin()) break;
        this.advance();
      }
      if (this.cancelled) return null;
      this.winner = this.players.filter(p => this.team(p.faction) === this.winTeam);
      this.say(`🏁 ${this.winReason}`);
      this.hooks.onState();
      this.hooks.onGameOver(this);
      return this.winTeam;
    }
    cancel() { this.cancelled = true; }
  }

  // ---------- 推理 AI ----------
  class KAI {
    constructor(id, opts) {
      this.id = id; opts = opts || {};
      this.iq = opts.iq != null ? opts.iq : 0.55 + Math.random() * 0.4;
      this.guile = opts.guile != null ? opts.guile : Math.random();      // 吹牛傾向
      this.suspicionT = opts.suspicionT != null ? opts.suspicionT : 0.3 + Math.random() * 0.4; // 質疑門檻
    }

    // 從公開行動史推估：誰像叛徒(攻擊性)、誰像我的敵人(攻擊過我/我隊)
    read(game) {
      const aggrAt = {}; // 對每個對象施加的攻擊次數(造謠/出征)
      const aggrBy = {}; // 每人發動攻擊總次數
      game.players.forEach(p => { aggrAt[p.id] = {}; aggrBy[p.id] = 0; });
      game.actions.forEach(a => {
        if ((a.declare === 'slander' || a.declare === 'campaign') && a.target != null && !a.bluff) {
          aggrBy[a.actor] = (aggrBy[a.actor] || 0) + 1;
          aggrAt[a.actor][a.target] = (aggrAt[a.actor][a.target] || 0) + 1;
        }
      });
      return { aggrAt, aggrBy };
    }

    enemyScore(game, info, pid) {
      // 攻擊過我越多 → 越像敵人；整體攻擊性高 → 略可疑
      const at = info.aggrAt[pid] || {};
      return (at[this.id] || 0) * 2 + (info.aggrBy[pid] || 0) * 0.5;
    }
    suspectMostAggressive(game, info) {
      let best = null, s = -1;
      game.players.forEach(p => { if (p.id === this.id || !p.alive) return; const sc = info.aggrBy[p.id] || 0; if (sc > s) { s = sc; best = p; } });
      return best;
    }
    weakest(game, pred) {
      let best = null, m = Infinity;
      game.players.forEach(p => { if (p.id === this.id || !p.alive) return; if (pred && !pred(p)) return; if (p.morale < m) { m = p.morale; best = p; } });
      return best;
    }

    have(me, type) { return me.hand.indexOf(type) >= 0; }
    cardIdxFor(me, type) { const i = me.hand.indexOf(type); return i >= 0 ? i : 0; }
    // 包裝一個宣告：有牌則誠實，沒牌則吹牛(用第一張別的牌蓋)
    decl(me, type, targetId) {
      let idx = me.hand.indexOf(type);
      if (idx < 0) idx = 0; // 吹牛：蓋任一張
      return { declare: type, targetId: targetId, cardIdx: idx };
    }

    chooseKeep(game, pid, pool) {
      // 留「最有用」的兩張：偏好 換牌/出征/造謠/建設
      const rank = { exchange: 5, slander: 5, campaign: 4, build: 4, tax: 3, conscript: 3, support: 1 };
      return pool.slice().sort((a, b) => (rank[b] || 0) - (rank[a] || 0)).slice(0, 2);
    }

    knownPrince(game) { return game.players.find(p => p.alive && p.faction === 'prince' && p.revealed); }

    chooseAction(game, isExtra) {
      const me = game.players[this.id];
      const info = this.read(game);
      const f = me.faction;
      const bluff = (type) => !this.have(me, type) && Math.random() < (0.18 + this.guile * 0.5);
      const canDo = (type) => this.have(me, type) || bluff(type);

      // 王子：忠臣已死 → 多半公開拿 +2/+2/+2 翻盤（已無隱藏價值，明著打也得拚）
      if (f === 'prince' && !isExtra && game.canReveal(me)) {
        if (me.morale <= 6 || me.coins < 3 || me.army < 3 || Math.random() < 0.75) return { reveal: true };
      }

      // 自保：民心危急
      if (me.morale <= 2) {
        if (me.coins >= 2 && canDo('build')) return this.decl(me, 'build');
        return this.decl(me, 'harvest');
      }

      // 鎖定獵物
      let prey = null;
      if (f === 'traitor') {
        prey = this.knownPrince(game) ||
          this.weakest(game, p => { const a = this.suspectMostAggressive(game, info); return !a || p.id !== a.id; }) ||
          this.weakest(game);
      } else {
        prey = this.suspectMostAggressive(game, info) || this.weakest(game);
      }
      // 一擊斃命機會（任何陣營都把握）
      if (prey) {
        if (prey.morale <= 2 && me.coins >= 2 && canDo('slander')) return this.decl(me, 'slander', prey.id);
        if (prey.army < 3 && me.army >= 3 && canDo('campaign')) return this.decl(me, 'campaign', prey.id);
      }

      // ---- 王子：以「活下去」為要——民心顧高、薄有護軍，少用掉民心的稅/兵 ----
      if (f === 'prince') {
        if (me.morale < CAP - 2 && me.coins >= 2 && this.have(me, 'build')) return this.decl(me, 'build');
        if (me.morale < CAP - 1) return this.decl(me, 'harvest'); // 收成穩穩回血+錢，且不可被質疑
        if (me.army < 3 && me.coins >= 1 && me.morale >= 6 && this.have(me, 'conscript')) return this.decl(me, 'conscript');
        if (prey && me.coins >= 2 && this.have(me, 'slander') && (info.aggrBy[prey.id] || 0) >= 1) return this.decl(me, 'slander', prey.id);
        return this.decl(me, 'harvest');
      }

      // ---- 忠臣/叛徒：建軍備戰 + 主動獵殺 ----
      if (me.coins < 2 && this.have(me, 'tax')) return this.decl(me, 'tax');
      if (me.army < 3 && me.coins >= 1 && this.have(me, 'conscript')) return this.decl(me, 'conscript');
      if (prey && me.coins >= 2 && this.have(me, 'slander')) return this.decl(me, 'slander', prey.id);
      if (!isExtra && this.have(me, 'exchange') && Math.random() < 0.4) return this.decl(me, 'exchange');
      if (me.morale < CAP - 2 && me.coins >= 2 && this.have(me, 'build')) return this.decl(me, 'build');
      if (me.coins < 2 && canDo('tax')) return this.decl(me, 'tax');
      if (prey && me.coins >= 2 && bluff('slander')) return this.decl(me, 'slander', prey.id);
      return this.decl(me, 'harvest');
    }

    decideChallenge(game, actorId, declare, targetId) {
      const me = game.players[this.id];
      if (declare === 'harvest') return false;
      // 此行動對我/我隊有多糟
      let harm = 0;
      if ((declare === 'slander' || declare === 'campaign') && targetId === this.id) harm += 2;
      // 攻擊「我認為是隊友」的也想擋(但隊友未知；用「不是最兇者」當粗略隊友)
      const info = this.read(game);
      const aggro = this.suspectMostAggressive(game, info);
      if ((declare === 'slander' || declare === 'campaign') && targetId != null && (!aggro || targetId !== aggro.id) && targetId !== this.id) harm += 0.6;
      // 強力增益(課稅/出征/換牌)也略想壓
      if (declare === 'tax' || declare === 'campaign') harm += 0.3;
      if (harm <= 0) return false;
      // 質疑有風險(-2/-2)：harm 越大、我越多疑(suspicionT 低=愛質疑)才出手
      const p = clamp(harm * 0.22 + (0.5 - this.suspicionT) * 0.3, 0, 0.8);
      return Math.random() < p;
    }
  }

  // ---------- UI 控制器（人類 = Agent；渲染進 #kingdom）----------
  const ICON = { harvest: '🌾', tax: '💰', conscript: '⚔️', build: '🏛️', support: '🤝', campaign: '🔥', slander: '🗣️', exchange: '🔀' };
  const ADESC = {
    harvest: '金幣+1 民心+1（萬用·不可質疑）', tax: '金幣+3 民心−1', conscript: '軍隊+2 民心−1 金幣−1',
    build: '金幣−2 民心+2', support: '我軍−1 民心+1，對方軍隊+1', campaign: '我軍−3，對方軍隊−3（不足→斬殺）',
    slander: '金幣−2，對方民心−2（到0→起義）', exchange: '抽2選2，並可再出一張'
  };
  const GOAL = {
    prince: '👑 你是【王子】——活下去並讓兩名叛徒都死；忠臣死後可「公開身分」拿 +2/+2/+2。',
    loyalist: '🛡 你是【忠臣】——揪出並剷除兩名叛徒、護住王子（但你也不知他是誰）。',
    traitor: '🗡 你是【叛徒】——找出王子並殺了他（或讓他民心歸0）。隊友是誰你也不知道。'
  };
  const NAME_POOL = ['老謀子', '鐵衛', '影后', '賭徒', '修士', '暴君', '狐', '雛鳥', '血手', '屠夫'];
  const RANK = { exchange: 5, slander: 5, campaign: 4, build: 4, tax: 3, conscript: 3, support: 1 };

  const KUI = {
    game: null, speed: 700, turn: 0, logs: [], mode: null, _resolve: null, _ctx: null, _pendingAction: null, _keepSel: [],
    el() { return typeof document !== 'undefined' ? document.getElementById('kingdom') : null; },

    start(numPlayers, speed) {
      if (this.game) this.game.cancel();
      this.speed = speed || 700; this.logs = []; this.mode = null; this._resolve = null; this._pendingAction = null;
      const n = Math.max(4, Math.min(6, numPlayers || 4));
      const names = NAME_POOL.slice().sort(() => Math.random() - 0.5);
      const configs = [{ name: '你', isHuman: true }];
      for (let i = 1; i < n; i++) configs.push({ name: names[i - 1] || ('電腦' + i) });
      const game = new KGame(configs, {
        onLog: m => { this.logs.unshift(m); if (this.logs.length > 90) this.logs.pop(); this.render(); },
        onState: () => this.render(),
        onTurn: id => { this.turn = id; this.render(); },
        onGameOver: g => this.showResult(g),
        pause: () => new Promise(r => setTimeout(r, this.speed))
      });
      game.agents[0] = this;
      for (let i = 1; i < n; i++) game.agents[i] = new KAI(i);
      this.game = game; this.turn = 0;
      const root = this.el(); if (root) root.style.display = 'flex';
      this.render(); game.play();
    },
    quit() {
      if (this.game) this.game.cancel();
      const r = this.el(); if (r) { r.style.display = 'none'; r.innerHTML = ''; }
      const home = typeof document !== 'undefined' ? document.getElementById('home') : null;
      if (home) home.style.display = 'flex';
    },

    // ---- Agent 介面（皆 Promise，待人類點擊）----
    chooseAction(game, isExtra) {
      return new Promise(res => { this.mode = 'action'; this._ctx = { isExtra }; this._pendingAction = null; this._resolve = res; this.render(); });
    },
    decideChallenge(game, actorId, declare, targetId) {
      return new Promise(res => { this.mode = 'challenge'; this._ctx = { actorId, declare, targetId }; this._resolve = res; this.render(); });
    },
    chooseKeep(game, pid, pool) {
      return new Promise(res => { this.mode = 'keep'; this._ctx = { pool: pool.slice() }; this._keepSel = []; this._resolve = res; this.render(); });
    },
    _done(val) { const r = this._resolve; this._resolve = null; this.mode = null; this._pendingAction = null; this.render(); if (r) r(val); },

    _bluffIdx(me) { // 吹牛時棄掉最不值錢的牌
      let idx = 0, lo = 99; me.hand.forEach((c, i) => { const r = RANK[c] || 0; if (r < lo) { lo = r; idx = i; } }); return idx;
    },
    _cardIdx(me, type) { const i = me.hand.indexOf(type); return i >= 0 ? i : this._bluffIdx(me); },

    moraleBar(m) { let s = ''; for (let i = 1; i <= 10; i++) s += `<span class="k-pip ${i <= m ? 'on' : ''}"></span>`; return s; },

    playerCard(p, me) {
      const isTurn = this.game.current === p.id && p.alive && !this.game.over;
      const show = p.id === me.id || !p.alive || p.revealed || this.game.over;
      const fz = show ? FACTION_ZH[p.faction] : '？';
      return `<div class="k-pl ${!p.alive ? 'dead' : ''} ${isTurn ? 'turn' : ''} ${p.id === me.id ? 'me' : ''}">
        <div class="k-pl-top"><b>${p.name}</b><span class="k-fac ${show ? p.faction : 'hidden'}">${!p.alive ? '☠ ' : ''}${p.revealed && p.alive ? '👑公開·' : ''}${fz}</span></div>
        <div class="k-mini"><span class="k-mini-lab">民心</span><span class="k-pips">${this.moraleBar(p.morale)}</span></div>
        <div class="k-pl-res">🪙 ${p.coins}　⚔️ ${p.army}　🎴 ${p.hand.length}</div>
      </div>`;
    },

    bodyHTML() {
      const g = this.game, me = g.players[0];
      // 互動區
      let panel = '';
      if (this.mode === 'challenge' && this._resolve) {
        const c = this._ctx, a = g.players[c.actorId], t = c.targetId != null ? g.players[c.targetId] : null;
        panel = `<div class="k-prompt"><div class="k-prompt-q">❓ ${a.name} 宣稱【${ICON[c.declare]}${ACT[c.declare].zh}】${t ? '（對象：' + t.name + '）' : ''}——你要質疑嗎？</div>
          <div class="k-prompt-hint">質疑對：他民心−2金幣−2、你民心+2｜質疑錯：你民心−2金幣−2</div>
          <div class="k-btns"><button class="k-b danger" data-ch="1">⚖️ 質疑！</button><button class="k-b" data-ch="0">略過</button></div></div>`;
      } else if (this.mode === 'keep' && this._resolve) {
        const pool = this._ctx.pool;
        panel = `<div class="k-prompt"><div class="k-prompt-q">🔀 換牌：點選要【保留】的 2 張</div>
          <div class="k-keeprow">${pool.map((c, i) => `<button class="k-card ${this._keepSel.indexOf(i) >= 0 ? 'sel' : ''}" data-keep="${i}">${ICON[c]}<small>${ACT[c].zh}</small></button>`).join('')}</div>
          <div class="k-btns"><button class="k-b act" data-keepok="1" ${this._keepSel.length === 2 ? '' : 'disabled'}>確定保留</button></div></div>`;
      } else if (this.mode === 'action' && this._resolve && me.alive) {
        if (this._pendingAction) {
          const ty = this._pendingAction;
          panel = `<div class="k-prompt"><div class="k-prompt-q">${ICON[ty]} ${ACT[ty].zh}——選擇對象：</div><div class="k-btns">` +
            g.players.filter(p => p.alive && p.id !== 0).map(p => `<button class="k-b act" data-tgt="${p.id}">${p.name}</button>`).join('') +
            `<button class="k-b" data-tgtcancel="1">返回</button></div></div>`;
        } else {
          const canReveal = g.canReveal(me) && !this._ctx.isExtra;
          const acts = ['harvest', 'tax', 'build', 'conscript', 'support', 'campaign', 'slander', 'exchange'];
          panel = `<div class="k-prompt"><div class="k-prompt-q">${this._ctx.isExtra ? '🔀 換牌後可再出一張：' : '輪到你——蓋一張牌並宣稱行動（手牌沒有＝吹牛）：'}</div>
            <div class="k-acts2">` + acts.map(ty => {
            if (this._ctx.isExtra && ty === 'exchange') return '';
            const afford = ACT[ty].can(me);
            const honest = ty === 'harvest' ? true : me.hand.indexOf(ty) >= 0;
            const tag = ty === 'harvest' ? '' : (honest ? '<i class="k-honest">🎴真</i>' : '<i class="k-lie">🎭詐</i>');
            return `<button class="k-act2" data-a="${ty}" ${afford ? '' : 'disabled'}>${ICON[ty]} ${ACT[ty].zh}${tag}<small>${ADESC[ty]}</small></button>`;
          }).join('') + `</div>` +
            (canReveal ? `<div class="k-btns"><button class="k-b reveal" data-reveal="1">👑 公開王子身分（+2民心/金幣/軍隊，從此明著打）</button></div>` : '') +
            `</div>`;
        }
      }
      const handStr = me.hand.length ? me.hand.map(c => `<span class="k-h">${ICON[c]} ${ACT[c].zh}</span>`).join('') : '（無）';
      return `<div class="k-head"><span>⚔️ 王國暗戰</span><button class="k-quit">✕ 離開</button></div>
        <div class="k-players">${g.players.map(p => this.playerCard(p, me)).join('')}</div>
        <div class="k-you">${GOAL[me.faction]}${me.alive ? '' : '　（你已陣亡，旁觀至終局）'}</div>
        <div class="k-hand">你的手牌：${handStr}</div>
        ${panel}
        <div class="k-log">${this.logs.map((m, i) => `<div class="k-log-line ${i === 0 ? 'new' : ''}">${m}</div>`).join('')}</div>`;
    },

    render() {
      const root = this.el(); if (!root || !this.game) return;
      root.innerHTML = `<div class="k-box">${this.bodyHTML()}</div>`;
      if (typeof root.querySelector !== 'function') return;
      const me = this.game.players[0];
      const q = root.querySelector('.k-quit'); if (q) q.onclick = () => this.quit();
      root.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => this._done(b.dataset.ch === '1'));
      root.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
        const ty = b.dataset.a;
        if (ty === 'harvest') return this._done({ declare: 'harvest', cardIdx: 0 });
        if (ACT[ty].targeted) { this._pendingAction = ty; this.render(); return; }
        this._done({ declare: ty, cardIdx: this._cardIdx(me, ty) });
      });
      root.querySelectorAll('[data-tgt]').forEach(b => b.onclick = () => {
        const ty = this._pendingAction; this._done({ declare: ty, targetId: +b.dataset.tgt, cardIdx: this._cardIdx(me, ty) });
      });
      const tc = root.querySelector('[data-tgtcancel]'); if (tc) tc.onclick = () => { this._pendingAction = null; this.render(); };
      const rv = root.querySelector('[data-reveal]'); if (rv) rv.onclick = () => this._done({ reveal: true });
      root.querySelectorAll('[data-keep]').forEach(b => b.onclick = () => {
        const i = +b.dataset.keep, k = this._keepSel, at = k.indexOf(i);
        if (at >= 0) k.splice(at, 1); else if (k.length < 2) k.push(i);
        this.render();
      });
      const ko = root.querySelector('[data-keepok]'); if (ko) ko.onclick = () => {
        const pool = this._ctx.pool; this._done(this._keepSel.map(i => pool[i]));
      };
    },

    showResult(g) {
      const root = this.el(); if (!root || !root.querySelector) return;
      const me = g.players[0];
      const iWon = g.winTeam === g.team(me.faction);
      const roster = g.players.map(p => `${p.name}：${FACTION_ZH[p.faction]}${p.alive ? '' : '✝'}`).join('　');
      const box = root.querySelector('.k-box'); if (!box) return;
      const ov = document.createElement('div'); ov.className = 'k-result';
      ov.innerHTML = `<div class="k-result-in ${iWon ? 'win' : 'lose'}">
        <div class="k-r-title">${iWon ? '🎉 你的陣營獲勝！' : '💀 你的陣營落敗'}</div>
        <div class="k-r-sub">${g.winReason}</div>
        <div class="k-r-team">勝方：${g.winTeam === 'crown' ? '王室' : '叛徒'}</div>
        <div class="k-r-roster">${roster}</div>
        <button class="k-again">再來一局</button><button class="k-home2">回首頁</button></div>`;
      box.appendChild(ov);
      const ag = ov.querySelector('.k-again'); if (ag) ag.onclick = () => this.start(g.players.length, this.speed);
      const hm = ov.querySelector('.k-home2'); if (hm) hm.onclick = () => this.quit();
    }
  };

  Coup.Kingdom = { Game: KGame, AI: KAI, UI: KUI, factionSet: factionSet, CARD_TYPES: CARD_TYPES };

  if (typeof module !== 'undefined' && module.exports) module.exports = Coup;
})(typeof globalThis !== 'undefined' ? globalThis : this);
