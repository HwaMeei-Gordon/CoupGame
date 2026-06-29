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
      const startMorale = opts.startMorale != null ? opts.startMorale : 4;
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
      this.revealed = {}; // 本洗牌週期內「被質疑攤開過」的牌(公開資訊；供算牌)：type -> 次數
      this.coronationPending = null; // 逼近加冕的王子 id(達民心10、待撐過一輪)；公開資訊＝此刻已曝光為王子
      this.declaration = null; // 桌面當前這手牌：{ actorId, declare, targetId, revealed, challengerId, bluff }（供牌桌中央呈現）
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
      if (!this.deck.length) { this.deck = shuffle(this.discard); this.discard = []; this.revealed = {}; } // 洗牌→公開算牌資訊重置
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
      if (!prince || !prince.alive) { this.coronationPending = null; return this.end('traitor', '王子身殞，王國易主 —— 叛徒得逞'); }
      if (this.traitorsAlive().length === 0) return this.end('crown', '叛徒盡除，朝堂清明 —— 王室安定');
      if (this.alivePlayers().length <= 1) return this.end(this.team(this.alivePlayers()[0] ? this.alivePlayers()[0].faction : 'prince'), '塵埃落定');
      // 加冕倒數：王子民心抵頂 → 公開逼近登基，眾人僅剩一輪可反制(造謠打落民心)；撐到下一回合開始仍滿民心才加冕
      if (prince.morale >= CAP && this.coronationPending !== prince.id) {
        this.coronationPending = prince.id;
        this.say(`📯 ${prince.name} 民心鼎盛、眾望所歸 —— 逼近加冕！只要撐到下一回合仍保有滿民心便將登基，此刻僅剩一輪可阻止！`);
      } else if (prince.morale < CAP && this.coronationPending === prince.id) {
        this.coronationPending = null;
        this.say(`📉 ${prince.name} 民心回落，加冕受阻……`);
      }
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
      const rec = { actor: actor.id, declare, target: target ? target.id : null, challenged: false,
        wasBluff: (declare !== 'harvest' && playedCard !== declare) }; // 上帝視角紀錄(分析用;AI 不讀此欄)

      this.declaration = { actorId: actor.id, declare, targetId: target ? target.id : null, revealed: null, challengerId: null, bluff: null };
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
          if (playedCard) this.revealed[playedCard] = (this.revealed[playedCard] || 0) + 1; // 公開算牌資訊
          if (this.declaration) { this.declaration.revealed = playedCard || 'harvest'; this.declaration.challengerId = challengerId; this.declaration.bluff = bluff; }
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
        // 加冕：王子撐過一輪反制，回合開始時仍保有滿民心 → 王室登基
        if (actor.faction === 'prince' && actor.morale >= CAP) {
          this.say(`👑 ${actor.name} 在萬民擁戴中加冕為王 —— 王室登基！`);
          this.end('crown', '民心鼎盛，王子加冕 —— 王室登基');
          break;
        }
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
    // 民心最高的對手（衝加冕的疑似王子）
    highestMorale(game) {
      let best = null, m = -1;
      game.players.forEach(p => { if (p.id === this.id || !p.alive) return; if (p.morale > m) { m = p.morale; best = p; } });
      return best;
    }
    // 疑似王子：王子的破綻是「養民心卻從不主動攻擊」——民心高 × 攻擊性低者最可疑。
    // 已公開/逼近加冕者直接鎖定；否則綜合 民心 與「攻擊次數(造謠/出征)」評分。
    princeSuspect(game, info) {
      const known = this.knownPrince(game); if (known) return known;
      let best = null, s = -Infinity;
      game.players.forEach(p => {
        if (p.id === this.id || !p.alive) return; // 連隊友都不知道，只能憑公開行為推斷(不看 faction)
        const aggr = info.aggrBy[p.id] || 0;
        const sc = p.morale * 1.0 - aggr * 1.6 + (p.army === 0 ? 0.5 : 0); // 養民心、不攻擊、少養兵 → 像王子
        if (sc > s) { s = sc; best = p; }
      });
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

    knownPrince(game) {
      const revealed = game.players.find(p => p.alive && p.faction === 'prince' && p.revealed);
      if (revealed) return revealed;
      // 逼近加冕＝已曝光為王子(公開資訊)
      if (game.coronationPending != null) { const p = game.players[game.coronationPending]; if (p && p.alive) return p; }
      return null;
    }

    chooseAction(game, isExtra) {
      const me = game.players[this.id];
      const info = this.read(game);
      const f = me.faction;
      // 吹牛：避開已攤光的牌(必被算牌抓)；越少公開、越敢騙
      const bluff = (type) => {
        if (this.have(me, type)) return false;
        const rev = game.revealed[type] || 0;
        if (rev >= 2) return false;                 // 兩張都攤過 → 騙必被識破
        return Math.random() < (0.20 + this.guile * 0.55) * (rev === 0 ? 1 : 0.5);
      };
      const canDo = (type) => this.have(me, type) || bluff(type);

      // 王子：忠臣已死 → 多半公開拿 +2/+2/+2 翻盤（已無隱藏價值，明著打也得拚）
      if (f === 'prince' && !isExtra && game.canReveal(me)) {
        if (me.morale <= 4 || (me.morale <= 6 && Math.random() < 0.5) || me.army < 2) return { reveal: true };
      }

      // 阻止加冕：有王子逼近登基(已曝光) → 全力反制(造謠打落民心；可斬則斬)
      if (f === 'traitor' && game.coronationPending != null && game.coronationPending !== me.id) {
        const king = game.players[game.coronationPending];
        if (king && king.alive) {
          if (king.army < 3 && me.army >= 3 && canDo('campaign')) return this.decl(me, 'campaign', king.id); // 破城斬王＝直接獲勝
          if (me.coins >= 2 && canDo('slander')) return this.decl(me, 'slander', king.id);                  // 造謠 −2 打落滿民心
        }
      }

      // 自保：民心危急
      if (me.morale <= 2) {
        if (me.coins >= 2 && canDo('build')) return this.decl(me, 'build');
        return this.decl(me, 'harvest');
      }

      // 鎖定獵物
      let prey = null;
      if (f === 'traitor') {
        // 叛徒：憑「養民心卻不攻擊」的破綻鎖定疑似王子；已公開/逼近加冕者直接鎖定
        prey = this.princeSuspect(game, info) || this.highestMorale(game);
      } else {
        prey = this.suspectMostAggressive(game, info) || this.weakest(game);
      }
      // 一擊斃命機會（任何陣營都把握）
      if (prey) {
        if (prey.morale <= 2 && me.coins >= 2 && canDo('slander')) return this.decl(me, 'slander', prey.id);
        if (prey.army < 3 && me.army >= 3 && canDo('campaign')) return this.decl(me, 'campaign', prey.id);
      }
      // 叛徒：對疑似王子(民心高、逼近加冕)造謠——既擋登基又逼死
      if (f === 'traitor' && prey && prey.morale >= 6 && me.coins >= 2 && canDo('slander')) return this.decl(me, 'slander', prey.id);

      // ---- 王子：高民心既是防禦也是勝利條件，但抵 10 會曝光、給敵人一輪反制 ----
      // 「安全衝刺」＝沒有對手有 ≥2 金幣可造謠(也無 ≥3 軍可破城) → 撐得過那一輪，放心登基。
      if (f === 'prince') {
        const slanderers = game.players.filter(p => p.alive && p.id !== me.id && p.coins >= 2).length;
        const breakers = game.players.filter(p => p.alive && p.id !== me.id && p.army >= 3 && me.army < 3).length;
        const opp = game.alivePlayers().length - 1;
        // 安全衝刺：沒人造得了謠、破得了城，且局勢已收束(對手 ≤2)——避免太早無償加冕
        const safePush = slanderers === 0 && breakers === 0 && opp <= 2;
        if (me.morale <= 3) { // 危急自保
          if (me.coins >= 2 && canDo('build')) return this.decl(me, 'build');
          if (me.army < 2 && me.coins >= 1 && this.have(me, 'conscript')) return this.decl(me, 'conscript');
          return this.decl(me, 'harvest');
        }
        if (safePush) { // 沒人擋得了 → 一路衝上 10 加冕
          if (me.coins >= 2 && canDo('build')) return this.decl(me, 'build');
          return this.decl(me, 'harvest');
        }
        // 不安全：低調混入人群(別當民心最高的顯眼靶)，只攢一點護身的軍與錢，伺機等安全窗口登基
        if (me.morale < 6 && me.coins >= 2 && this.have(me, 'build')) return this.decl(me, 'build');
        if (me.army < 2 && me.coins >= 1 && this.have(me, 'conscript')) return this.decl(me, 'conscript');
        if (me.coins < 3 && canDo('tax')) return this.decl(me, 'tax');
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

    // 算牌：此種牌「還可能在別人手上/牌庫」的張數（2 - 我手上 - 已公開攤過）
    remaining(game, type) {
      const me = game.players[this.id];
      const inHand = me.hand.filter(c => c === type).length;
      return Math.max(0, 2 - inHand - (game.revealed[type] || 0));
    }
    // 宣稱者「在吹牛」的機率：多數宣告是誠實的(低先驗)，再由「算牌」上修——
    // 此牌兩張都已公開(剩0)→必假；剩越少→越可疑。
    pBluff(game, claimantId, type) {
      const rem = this.remaining(game, type);
      if (rem <= 0) return 1;                       // 場面上已無此牌 → 必假(白賺)
      return clamp(0.22 + (2 - rem) * 0.16, 0.1, 0.85); // 剩2≈0.22、剩1≈0.38
    }

    // 質疑＝「嚇阻吹牛的威懾」×「算牌的證據」：
    //  · 算死(剩0)→必拆(穩賺)；剩1→更可疑、加碼想拆。
    //  · 行動越威脅我/隊友→越想拆(即使會猜錯，也得嚇阻對方亂吹牛)。
    decideChallenge(game, actorId, declare, targetId) {
      if (declare === 'harvest') return false;
      const rem = this.remaining(game, declare);
      if (rem <= 0) return true;                    // 算牌算死 → 必拆
      let threat = 0;
      if ((declare === 'slander' || declare === 'campaign') && targetId === this.id) threat += 1.6;
      const info = this.read(game); const aggro = this.suspectMostAggressive(game, info);
      if ((declare === 'slander' || declare === 'campaign') && targetId != null && targetId !== this.id && (!aggro || targetId !== aggro.id)) threat += 0.5;
      if (declare === 'tax' || declare === 'campaign' || declare === 'exchange') threat += 0.3;
      if (threat <= 0 && rem >= 2) return false;    // 與我無關又無證據 → 不浪費
      let p = threat * 0.22 + (0.5 - this.suspicionT) * 0.28; // 威懾傾向
      if (rem === 1) p += 0.22;                      // 算牌證據：只剩1張更可疑
      return Math.random() < clamp(p, 0, 0.85);
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
    prince: '👑 你是【王子】——活下去！讓兩名叛徒都死，或將民心衝上 10 並撐過一輪即「加冕登基」獲勝（但抵 10 會曝光，給敵人一輪造謠反制）；忠臣死後可「公開身分」拿 +2/+2/+2。',
    loyalist: '🛡 你是【忠臣】——揪出並剷除兩名叛徒、護住王子（但你也不知他是誰）。',
    traitor: '🗡 你是【叛徒】——找出王子並殺了他（或讓他民心歸0）；他若逼近加冕，務必造謠打落其民心。隊友是誰你也不知道。'
  };
  const NAME_POOL = ['老謀子', '鐵衛', '影后', '賭徒', '修士', '暴君', '狐', '雛鳥', '血手', '屠夫'];
  const RANK = { exchange: 5, slander: 5, campaign: 4, build: 4, tax: 3, conscript: 3, support: 1 };
  const FCREST = { prince: '👑', loyalist: '🛡️', traitor: '🗡️', hidden: '🎭' };
  const AVATAR = ['🦊', '🐺', '🦅', '🐍', '🦉', '🦁', '🐗', '🐅', '🦂', '🐦‍⬛']; // 各座位的角色頭像(僅裝飾)

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

    // 座位環繞橢圓：人類(id0)固定在底，其餘依回合序順時針分佈
    seatPos(idx, n) {
      const ang = (90 + idx * 360 / n) * Math.PI / 180;
      return { x: 50 + 41 * Math.cos(ang), y: 50 + 41 * Math.sin(ang) };
    },

    seatHTML(p, me) {
      const g = this.game;
      const me0 = p.id === me.id;
      const isTurn = g.current === p.id && p.alive && !g.over;
      const show = me0 || !p.alive || p.revealed || g.over;
      const facClass = show ? p.faction : 'hidden';
      const fz = show ? FACTION_ZH[p.faction] : '？';
      const crest = !p.alive ? '☠️' : FCREST[show ? p.faction : 'hidden'];
      const king = g.coronationPending === p.id && p.alive;
      const pos = this.seatPos(p.id, g.players.length);
      const targetable = this.mode === 'action' && this._pendingAction && ACT[this._pendingAction].targeted && p.alive && !me0;
      const morPct = Math.max(0, Math.min(100, p.morale * 10));
      const backs = (p.alive && !me0) ? Array.from({ length: Math.min(p.hand.length, 3) }, (_, i) => `<span class="k-back" style="--i:${i}"></span>`).join('') : '';
      return `<div class="k-seat ${me0 ? 'me' : ''} ${isTurn ? 'turn' : ''} ${!p.alive ? 'dead' : ''} ${king ? 'king' : ''} ${targetable ? 'targetable' : ''}"
        style="left:${pos.x}%;top:${pos.y}%" ${targetable ? `data-tgt="${p.id}"` : ''}>
        ${king ? '<div class="k-halo"></div>' : ''}
        <div class="k-backs">${backs}</div>
        <div class="k-ava ${facClass}"><span class="k-ava-face">${AVATAR[p.id % AVATAR.length]}</span><span class="k-crest">${crest}</span></div>
        <div class="k-seat-name">${me0 ? '你' : p.name}</div>
        <div class="k-seat-fac ${facClass}">${!p.alive ? '☠ ' : ''}${p.revealed && p.alive ? '公開·' : ''}${fz}</div>
        <div class="k-mor"><span class="k-mor-fill" style="width:${morPct}%"></span><span class="k-mor-n">${p.morale}</span></div>
        <div class="k-seat-res"><span>🪙${p.coins}</span><span>⚔️${p.army}</span><span>🎴${p.hand.length}</span></div>
      </div>`;
    },

    centerHTML() {
      const g = this.game;
      const d = g.declaration;
      let stage;
      if (d) {
        const actor = g.players[d.actorId];
        const tgt = d.targetId != null ? g.players[d.targetId] : null;
        if (d.revealed) {
          const isHarvest = d.revealed === 'harvest';
          const cardZh = isHarvest ? '萬用' : ACT[d.revealed].zh;
          stage = `<div class="k-decl ${d.bluff ? 'bust' : 'truth'}">
            <div class="k-tcard up">${isHarvest ? '🃏' : ICON[d.revealed]}<small>${cardZh}</small></div>
            <div class="k-decl-t"><b>${actor.name}</b> 宣稱【${ACT[d.declare].zh}】<br>${d.bluff ? '🔨 吹牛被拆穿！' : '🛡️ 所言屬實！'}</div>
          </div>`;
        } else {
          stage = `<div class="k-decl">
            <div class="k-tcard back"></div>
            <div class="k-decl-t"><b>${actor.name}</b> 宣稱<br><span class="k-decl-act">${ICON[d.declare]} ${ACT[d.declare].zh}</span>${tgt ? ` <span class="k-decl-arrow">→ ${tgt.name}</span>` : ''}</div>
          </div>`;
        }
      } else {
        stage = `<div class="k-decl idle"><div class="k-tcard back"></div><div class="k-decl-t">王國暗戰</div></div>`;
      }
      return `<div class="k-center">
        <div class="k-deck" title="牌庫剩餘">🂠<span>${g.deck.length}</span></div>
        ${stage}
      </div>`;
    },

    panelHTML() {
      const g = this.game, me = g.players[0];
      if (this.mode === 'challenge' && this._resolve) {
        const c = this._ctx, a = g.players[c.actorId], t = c.targetId != null ? g.players[c.targetId] : null;
        return `<div class="k-sheet"><div class="k-sheet-q">❓ <b>${a.name}</b> 宣稱【${ICON[c.declare]}${ACT[c.declare].zh}】${t ? '（對象：' + t.name + '）' : ''}——你要質疑嗎？</div>
          <div class="k-sheet-hint">質疑對：他民心−2金幣−2、你民心+2｜質疑錯：你民心−2金幣−2</div>
          <div class="k-btns"><button class="k-b danger" data-ch="1">⚖️ 質疑！</button><button class="k-b" data-ch="0">略過</button></div></div>`;
      }
      if (this.mode === 'keep' && this._resolve) {
        const pool = this._ctx.pool;
        return `<div class="k-sheet"><div class="k-sheet-q">🔀 換牌：點選要【保留】的 2 張</div>
          <div class="k-keeprow">${pool.map((c, i) => `<button class="k-card ${this._keepSel.indexOf(i) >= 0 ? 'sel' : ''}" data-keep="${i}">${ICON[c]}<small>${ACT[c].zh}</small></button>`).join('')}</div>
          <div class="k-btns"><button class="k-b act" data-keepok="1" ${this._keepSel.length === 2 ? '' : 'disabled'}>確定保留</button></div></div>`;
      }
      if (this.mode === 'action' && this._resolve && me.alive) {
        if (this._pendingAction) {
          const ty = this._pendingAction;
          return `<div class="k-sheet"><div class="k-sheet-q">${ICON[ty]} ${ACT[ty].zh}——<b>點選牌桌上的對象</b></div>
            <div class="k-btns"><button class="k-b" data-tgtcancel="1">↩ 返回</button></div></div>`;
        }
        const canReveal = g.canReveal(me) && !this._ctx.isExtra;
        const acts = ['harvest', 'tax', 'build', 'conscript', 'support', 'campaign', 'slander', 'exchange'];
        return `<div class="k-sheet"><div class="k-sheet-q">${this._ctx.isExtra ? '🔀 換牌後可再出一張：' : '輪到你——蓋一張牌並宣稱行動（手牌沒有＝吹牛）'}</div>
          <div class="k-acts2">` + acts.map(ty => {
          if (this._ctx.isExtra && ty === 'exchange') return '';
          const afford = ACT[ty].can(me);
          const honest = ty === 'harvest' ? true : me.hand.indexOf(ty) >= 0;
          const tag = ty === 'harvest' ? '' : (honest ? '<i class="k-honest">真</i>' : '<i class="k-lie">詐</i>');
          return `<button class="k-act2" data-a="${ty}" ${afford ? '' : 'disabled'}><span class="k-a2-h">${ICON[ty]} ${ACT[ty].zh}${tag}</span><small>${ADESC[ty]}</small></button>`;
        }).join('') + `</div>` +
          (canReveal ? `<button class="k-b reveal" data-reveal="1">👑 公開王子身分（+2 民心/金幣/軍隊，從此明著打）</button>` : '') +
          `</div>`;
      }
      return '';
    },

    bodyHTML() {
      const g = this.game, me = g.players[0];
      const seats = g.players.map(p => this.seatHTML(p, me)).join('');
      // 你的手牌(扇形展開)
      const hand = me.hand.length
        ? me.hand.map((c, i) => `<div class="k-cardface" style="--k:${i - (me.hand.length - 1) / 2}">${ICON[c]}<small>${ACT[c].zh}</small></div>`).join('')
        : '<div class="k-cardface empty">手牌已空</div>';
      // 算牌情報
      const intel = CARD_TYPES.filter(t => (g.revealed[t] || 0) > 0)
        .map(t => `<span class="k-seen ${(g.revealed[t] || 0) >= 2 ? 'gone' : ''}">${ICON[t]}${ACT[t].zh}×${g.revealed[t]}${(g.revealed[t] || 0) >= 2 ? '已絕' : ''}</span>`).join('');
      const intelStr = intel ? `<div class="k-intel">🔎 已攤開（算牌）：${intel}</div>` : '';
      // 加冕倒數橫幅
      const kp = g.coronationPending != null ? g.players[g.coronationPending] : null;
      const corStr = (kp && kp.alive) ? `<div class="k-coronation">📯 <b>${kp.name}</b> 逼近加冕！撐到其下一回合仍滿民心便登基 —— 僅剩一輪可用<b>造謠</b>打落其民心阻止！</div>` : '';
      const panel = this.panelHTML();
      const newest = this.logs.length ? this.logs[0] : '';
      return `<div class="k-head"><span>⚔️ 王國暗戰</span>
          <button class="k-info-btn" data-info="1" aria-label="說明">？</button>
          <button class="k-quit">✕</button></div>
        ${corStr}
        <div class="k-felt n${g.players.length}"><div class="k-felt-in">${this.centerHTML()}${seats}</div></div>
        ${intelStr}
        <div class="k-self ${me.alive ? '' : 'dead'}">
          <div class="k-self-lab">你的手牌${me.alive ? '' : '（你已陣亡，旁觀至終局）'}</div>
          <div class="k-selfhand">${hand}</div>
        </div>
        ${panel ? panel : `<div class="k-ticker">${newest}</div>`}
        <details class="k-logwrap"><summary>戰報</summary>
          <div class="k-log">${this.logs.map((m, i) => `<div class="k-log-line ${i === 0 ? 'new' : ''}">${m}</div>`).join('')}</div>
        </details>`;
    },

    render() {
      const root = this.el(); if (!root || !this.game) return;
      root.innerHTML = `<div class="k-box">${this.bodyHTML()}</div>`;
      if (typeof root.querySelector !== 'function') return;
      const me = this.game.players[0];
      const q = root.querySelector('.k-quit'); if (q) q.onclick = () => this.quit();
      const ib = root.querySelector('[data-info]'); if (ib) ib.onclick = () => this.showInfo();
      root.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => this._done(b.dataset.ch === '1'));
      root.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
        const ty = b.dataset.a;
        if (ty === 'harvest') return this._done({ declare: 'harvest', cardIdx: 0 });
        if (ACT[ty].targeted) { this._pendingAction = ty; this.render(); return; }
        this._done({ declare: ty, cardIdx: this._cardIdx(me, ty) });
      });
      root.querySelectorAll('[data-tgt]').forEach(b => b.onclick = () => {
        const ty = this._pendingAction; if (!ty) return;
        this._done({ declare: ty, targetId: +b.dataset.tgt, cardIdx: this._cardIdx(me, ty) });
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

    showInfo() {
      const root = this.el(); if (!root || !root.querySelector) return;
      const me = this.game.players[0];
      const box = root.querySelector('.k-box'); if (!box) return;
      const ov = document.createElement('div'); ov.className = 'k-result';
      ov.innerHTML = `<div class="k-result-in info">
        <div class="k-r-title">你的身分與目標</div>
        <div class="k-info-goal">${GOAL[me.faction]}</div>
        <div class="k-info-rules"><b>牌桌速覽</b><br>
          🌾收成(不可質疑) 金幣+1民心+1｜💰課稅 金幣+3民心−1｜🏛️建設 金幣−2民心+2｜⚔️徵兵 軍隊+2<br>
          🗣️造謠 對方民心−2｜🔥出征 對方軍隊−3(不足→斬殺)｜🤝支援｜🔀換牌<br>
          民心歸0 即出局；王子民心達10並撐過一輪＝加冕登基。</div>
        <button class="k-again" data-close="1">明白了</button></div>`;
      box.appendChild(ov);
      const c = ov.querySelector('[data-close]'); if (c) c.onclick = () => ov.remove();
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
