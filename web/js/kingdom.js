/*
 * 《王國暗戰》Hidden Kingdom —— 隱藏陣營推理模式（獨立於 Coup 主遊戲）。
 *
 * 身分(秘密，連隊友都不知)：👑王子 / 🛡忠臣 / 🗡叛徒。
 * 隊伍：王室(王子+忠臣) vs 叛徒。共用「民心」池(0~10)。
 * 勝利：民心 10 = 王室；民心 0 = 叛徒；王子被殺 = 叛徒；叛徒盡除 = 王室。
 * 動作：維持民生(民心+1)、收入(金+1)、課稅(金+2,民心-1)、招募(花1金→兵+1)、
 *       出兵(削敵兵；敵無兵則斬殺翻陣營；民心-1)。
 * 純陣營推理：沒有 Coup 的角色宣稱/質疑層；鬥智來自民心拉鋸 + 隱藏立場 + 誰打誰。
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

  // 各人數的陣營分配（王子恆 1；叛徒略多以平衡「要找出王子」的難度）
  function factionSet(n) {
    if (n <= 4) return ['prince', 'loyalist', 'traitor', 'traitor'];
    if (n === 5) return ['prince', 'loyalist', 'loyalist', 'traitor', 'traitor'];
    return ['prince', 'loyalist', 'loyalist', 'traitor', 'traitor', 'traitor']; // 6
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
      // 可調平衡參數（用模擬掃出 ~50/50）
      // 平衡參數（由模擬掃出 ~50/50：maintain+2 / tax-1 / 起始民心5 / 起始兵1）
      this.maintainGain = opts.maintainGain != null ? opts.maintainGain : 2; // 維持民生 +X
      this.taxDrop = opts.taxDrop != null ? opts.taxDrop : 1;                 // 課稅 -X 民心
      this.warDrop = opts.warDrop != null ? opts.warDrop : 1;                 // 戰爭 -X 民心
      this.players = configs.map((c, i) => ({
        id: i, name: c.name, isHuman: !!c.isHuman, faction: fac[i],
        coins: 2, soldiers: opts.startSoldiers != null ? opts.startSoldiers : 1, alive: true
      }));
      this.morale = opts.startMorale != null ? opts.startMorale : 5;
      this.MWIN = 10; this.MLOSE = 0;
      this.current = 0;
      this.over = false; this.winner = null; this.winTeam = null; this.winReason = '';
      this.cancelled = false;
      this.agents = {};
      this.actions = []; // 公開行動史（供 AI 推理與戰報）：{ actor, type, target, morale }
    }

    team(f) { return f === 'traitor' ? 'traitor' : 'crown'; }
    alivePlayers() { return this.players.filter(p => p.alive); }
    traitorsAlive() { return this.players.filter(p => p.alive && p.faction === 'traitor'); }
    prince() { return this.players.find(p => p.faction === 'prince'); }
    say(msg) { this.hooks.onLog(msg); }

    advance() {
      const n = this.players.length;
      for (let k = 1; k <= n; k++) {
        const id = (this.current + k) % n;
        if (this.players[id].alive) { this.current = id; return; }
      }
    }

    sanitize(actor, action) {
      action = action || { type: 'income' };
      const t = action.type;
      if (t === 'recruit' && actor.coins < 1) return { type: 'income' };
      if (t === 'attack') {
        const tgt = action.targetId != null ? this.players[action.targetId] : null;
        if (actor.soldiers < 1 || !tgt || !tgt.alive || tgt.id === actor.id) {
          // 無兵或無目標 → 改招募(有錢)否則收入
          return actor.coins >= 1 ? { type: 'recruit' } : { type: 'income' };
        }
      }
      return action;
    }

    applyAction(actor, action) {
      const rec = { actor: actor.id, type: action.type, target: action.targetId != null ? action.targetId : null };
      switch (action.type) {
        case 'maintain':
          this.morale = clamp(this.morale + this.maintainGain, 0, 10);
          this.say(`🌾 ${actor.name} 維持民生 —— 民心升至 ${this.morale}`);
          break;
        case 'income':
          actor.coins += 1;
          this.say(`🪙 ${actor.name} 取一份收入（金幣 ${actor.coins}）`);
          break;
        case 'tax':
          actor.coins += 2; this.morale = clamp(this.morale - this.taxDrop, 0, 10);
          this.say(`💰 ${actor.name} 加重課稅（金幣 ${actor.coins}）—— 民心跌至 ${this.morale}`);
          break;
        case 'recruit':
          actor.coins -= 1; actor.soldiers += 1;
          this.say(`⚔️ ${actor.name} 招募士兵（兵力 ${actor.soldiers}）`);
          break;
        case 'attack': {
          const t = this.players[action.targetId];
          this.morale = clamp(this.morale - this.warDrop, 0, 10);
          if (t.soldiers > 0) {
            t.soldiers -= 1; actor.soldiers -= 1; // 兩軍交鋒，各損一兵
            this.say(`🔥 ${actor.name} 出兵攻打 ${t.name} —— ${t.name} 殘兵 ${t.soldiers}（民心 ${this.morale}）`);
          } else {
            t.alive = false;
            rec.killed = t.id; rec.revealed = t.faction;
            this.say(`☠️ ${actor.name} 攻破 ${t.name} 的城門將其誅殺！真實身分揭曉：【${FACTION_ZH[t.faction]}】（民心 ${this.morale}）`);
          }
          break;
        }
      }
      rec.morale = this.morale;
      this.actions.push(rec);
    }

    checkWin() {
      const prince = this.prince();
      if (!prince || !prince.alive) return this.end('traitor', '王子身殞，王國易主 —— 叛徒得逞');
      if (this.traitorsAlive().length === 0) return this.end('crown', '叛徒盡除，朝堂清明 —— 王室安定');
      if (this.morale >= this.MWIN) return this.end('crown', '民心歸附，王子登基 —— 王室勝出');
      if (this.morale <= this.MLOSE) return this.end('traitor', '民心盡失，王國崩潰 —— 叛徒勝出');
      return false;
    }

    end(team, reason) {
      this.over = true; this.winTeam = team; this.winReason = reason;
      this.winner = this.players.filter(p => this.team(p.faction) === team);
      return true;
    }

    async play() {
      this.say('🎬 暗潮湧動，王國的命運落入四人之手……（民心起始 5）');
      this.hooks.onState();
      let safety = 0;
      while (!this.over && !this.cancelled) {
        if (++safety > 3000) { this.end(this.morale >= 5 ? 'crown' : 'traitor', '時局僵持，依民心定奪'); break; }
        const actor = this.players[this.current];
        if (!actor.alive) { this.advance(); continue; }
        this.hooks.onTurn(actor.id);
        await this.hooks.pause();
        if (this.cancelled) return null;
        let action = await this.agents[actor.id].chooseAction(this);
        if (this.cancelled) return null;
        action = this.sanitize(actor, action);
        this.applyAction(actor, action);
        this.hooks.onState();
        if (this.checkWin()) break;
        this.advance();
      }
      if (this.cancelled) return null;
      this.say(`🏁 ${this.winReason}`);
      this.hooks.onState();
      this.hooks.onGameOver(this);
      return this.winTeam;
    }

    cancel() { this.cancelled = true; }
  }

  // ---------- 推理 AI ----------
  // 從公開行動史推估每位玩家的「王室傾向」與「王子嫌疑」，並依自身陣營行動。
  class KAI {
    constructor(id, opts) {
      this.id = id;
      opts = opts || {};
      this.iq = opts.iq != null ? opts.iq : 0.6 + Math.random() * 0.4;     // 判讀精準
      this.guile = opts.guile != null ? opts.guile : Math.random();        // 偽裝(叛徒裝忠/王子裝平民)
      this.aggression = opts.aggression != null ? opts.aggression : Math.random();
    }

    // 對每位他人累計：crownLean（越高越像王室）、maintainCount（越高越像王子）
    read(game) {
      const lean = {}, maintainCnt = {}, taxWarCnt = {};
      game.players.forEach(p => { lean[p.id] = 0; maintainCnt[p.id] = 0; taxWarCnt[p.id] = 0; });
      game.actions.forEach(a => {
        if (a.actor === this.id) return;
        if (a.type === 'maintain') { lean[a.actor] += 1.6; maintainCnt[a.actor] += 1; }
        else if (a.type === 'tax') { lean[a.actor] -= 1.3; taxWarCnt[a.actor] += 1; }
        else if (a.type === 'attack') {
          taxWarCnt[a.actor] += 1; lean[a.actor] -= 0.5;
          // 攻打對象的傾向反推：打「像王室的人」→ 更像叛徒；打「像叛徒的人」→ 更像王室
          if (a.target != null && a.target !== this.id) lean[a.actor] += (lean[a.target] < 0 ? 0.8 : -0.8);
        }
      });
      return { lean, maintainCnt, taxWarCnt };
    }

    // 在「他人」中找最可能的王子（王室傾向高且最常維持民生者）
    suspectPrince(game, info) {
      let best = null, bestScore = -Infinity;
      game.players.forEach(p => {
        if (p.id === this.id || !p.alive) return;
        const s = info.lean[p.id] + info.maintainCnt[p.id] * 1.2;
        if (s > bestScore) { bestScore = s; best = p; }
      });
      return best;
    }
    // 最可能的叛徒（傾向最低/最常課稅戰爭者）
    suspectTraitor(game, info, avoidId) {
      let best = null, bestScore = Infinity;
      game.players.forEach(p => {
        if (p.id === this.id || !p.alive || p.id === avoidId) return;
        const s = info.lean[p.id] - info.taxWarCnt[p.id] * 0.6;
        if (s < bestScore) { bestScore = s; best = p; }
      });
      return best;
    }

    canKill(me, target) { return me.soldiers >= 1 && target && target.alive && target.soldiers === 0; }

    chooseAction(game) {
      const me = game.players[this.id];
      const info = this.read(game);
      const f = me.faction;
      const morale = game.morale;
      const opps = game.players.filter(p => p.alive && p.id !== this.id);

      const maxOppArmy = opps.reduce((m, o) => Math.max(m, o.soldiers), 0);
      const moraleDanger = morale <= 3;   // 民心快崩 → 優先搶救
      const moraleClose = morale >= 8;    // 快達標 → 衝刺

      // ---- 王子：民心危/近達標就拉；安全時補防；其餘衝民心 ----
      if (f === 'prince') {
        if (moraleClose || moraleDanger) return { type: 'maintain' };
        const underArmed = me.soldiers < Math.min(3, maxOppArmy + 1);
        if (underArmed) return me.coins >= 1 ? { type: 'recruit' } : { type: 'income' };
        if (Math.random() < 0.2) return me.coins >= 1 ? { type: 'recruit' } : { type: 'income' };
        return { type: 'maintain' };
      }

      // ---- 忠臣：當王子的「誘餌+護衛」——撐民心 + 反殺進逼的叛徒（小心別殺到王子）----
      if (f === 'loyalist') {
        const princeGuess = this.suspectPrince(game, info);
        const traitorGuess = this.suspectTraitor(game, info, princeGuess ? princeGuess.id : -1);
        if (moraleDanger) return { type: 'maintain' };                       // 民心快崩，先救
        // 鎖定叛徒可補刀 → 殺（推進「殺光叛徒」勝利路）
        if (traitorGuess && info.lean[traitorGuess.id] < -0.8 && this.canKill(me, traitorGuess)) return { type: 'attack', targetId: traitorGuess.id };
        if (morale < 8) return { type: 'maintain' };                         // 未達標也未危 → 助攻民心(兼誘餌)
        if (me.soldiers < 3 && me.coins >= 1) return { type: 'recruit' };    // 民心安全 → 攢兵獵叛徒
        if (traitorGuess && info.lean[traitorGuess.id] < -1.6 && me.soldiers >= 1) return { type: 'attack', targetId: traitorGuess.id };
        return { type: 'maintain' };
      }

      // ---- 叛徒：壓民心 + 找出王子殺之；必要時偽裝 ----
      // 偽裝：自己看起來太像叛徒(被課稅戰爭拖累)時，偶爾維持民生洗白
      const myTaxWar = game.actions.filter(a => a.actor === this.id && (a.type === 'tax' || a.type === 'attack')).length;
      const myMaintain = game.actions.filter(a => a.actor === this.id && a.type === 'maintain').length;
      const exposed = myTaxWar - myMaintain;
      if (exposed >= 2 && Math.random() < 0.45 * this.guile) return { type: 'maintain' }; // 洗白

      const princeGuess = this.suspectPrince(game, info);
      // 鎖定王子且能補刀 → 殺(直接獲勝)
      if (princeGuess && this.canKill(me, princeGuess)) return { type: 'attack', targetId: princeGuess.id };
      // 對王子嫌疑高者：有兵就削、沒兵就攢
      if (princeGuess && (info.lean[princeGuess.id] + info.maintainCnt[princeGuess.id]) > 1.5) {
        if (me.soldiers >= 1) return { type: 'attack', targetId: princeGuess.id };
        if (me.coins >= 1) return { type: 'recruit' };
      }
      // 否則壓民心：接近 0 全力課稅收尾；平時課稅壓民心、有餘裕則攢兵備戰找王子
      if (morale <= 2) return { type: 'tax' };
      if (me.coins < 2) return { type: 'tax' };
      if (me.soldiers < 3 && Math.random() < 0.5) return { type: 'recruit' };
      return { type: 'tax' };
    }
  }

  // ---------- UI 控制器（人類玩家 = Agent；渲染進 #kingdom 容器）----------
  const NAME_POOL = ['老謀子', '鐵衛', '影后', '賭徒', '修士', '暴君', '狐', '雛鳥', '血手', '屠夫'];
  const GOAL = {
    prince: '👑 你是【王子】——把民心衝到 10 即登基；但別讓叛徒認出你並殺了你。',
    loyalist: '🛡 你是【忠臣】——保護王子(但你也不知他是誰)、剷除兩名叛徒、或讓民心達 10。',
    traitor: '🗡 你是【叛徒】——殺掉王子，或把民心壓到 0。隊友是誰你也不知道。'
  };

  const KUI = {
    game: null, speed: 700, turn: 0, logs: [], _resolve: null, _pickTarget: false,
    el() { return typeof document !== 'undefined' ? document.getElementById('kingdom') : null; },

    start(numPlayers, speed) {
      if (this.game) this.game.cancel();
      this.speed = speed || 700;
      this.logs = []; this._resolve = null; this._pickTarget = false;
      const n = Math.max(4, Math.min(6, numPlayers || 4));
      const names = NAME_POOL.slice().sort(() => Math.random() - 0.5);
      const configs = [{ name: '你', isHuman: true }];
      for (let i = 1; i < n; i++) configs.push({ name: names[i - 1] || ('電腦' + i) });
      const game = new KGame(configs, {
        onLog: m => { this.logs.unshift(m); if (this.logs.length > 80) this.logs.pop(); this.render(); },
        onState: () => this.render(),
        onTurn: id => { this.turn = id; this.render(); },
        onGameOver: g => this.showResult(g),
        pause: () => new Promise(r => setTimeout(r, this.speed))
      });
      game.agents[0] = this;
      for (let i = 1; i < n; i++) game.agents[i] = new KAI(i);
      this.game = game; this.turn = 0;
      const root = this.el(); if (root) root.style.display = 'flex';
      this.render();
      game.play();
    },

    quit() {
      if (this.game) this.game.cancel();
      const r = this.el(); if (r) { r.style.display = 'none'; r.innerHTML = ''; }
      const home = typeof document !== 'undefined' ? document.getElementById('home') : null;
      if (home) home.style.display = 'flex';
    },

    // 人類 Agent 介面
    chooseAction(game) { return new Promise(res => { this._resolve = res; this._pickTarget = false; this.render(); }); },
    _act(a) { const r = this._resolve; this._resolve = null; this._pickTarget = false; this.render(); if (r) r(a); },

    moraleBar(m) {
      let s = '';
      for (let i = 10; i >= 1; i--) s += `<div class="k-m-cell ${i <= m ? 'on' : ''} ${i === 10 ? 'win' : ''} ${i === 1 ? 'lose' : ''}">${i}</div>`;
      return s;
    },

    playerCard(p, me) {
      const isTurn = this.game.current === p.id && p.alive && !this.game.over;
      const dead = !p.alive;
      const showFaction = p.id === me.id || dead || this.game.over; // 只看得到自己的；死亡/結束則公開
      const fz = showFaction ? FACTION_ZH[p.faction] : '？';
      const facCls = showFaction ? p.faction : 'hidden';
      return `<div class="k-pl ${dead ? 'dead' : ''} ${isTurn ? 'turn' : ''} ${p.id === me.id ? 'me' : ''}">
        <div class="k-pl-top"><b>${p.name}</b><span class="k-fac ${facCls}">${dead ? '☠ ' : ''}${fz}</span></div>
        <div class="k-pl-res">🪙 ${p.coins}　⚔️ ${p.soldiers}</div>
      </div>`;
    },

    render() {
      const root = this.el(); if (!root || !this.game) return;
      const g = this.game, me = g.players[0];
      const myTurn = g.current === 0 && me.alive && !g.over && this._resolve;
      const opps = g.players.filter(p => p.id !== 0);
      let actions = '';
      if (myTurn && !this._pickTarget) {
        const canRecruit = me.coins >= 1, canAttack = me.soldiers >= 1 && opps.some(o => o.alive);
        actions = `<div class="k-acts">
          <button class="k-act" data-a="maintain">🌾 維持民生<small>民心 +${g.maintainGain}</small></button>
          <button class="k-act" data-a="income">🪙 收入<small>金幣 +1</small></button>
          <button class="k-act" data-a="tax">💰 課稅<small>金幣 +2，民心 −${g.taxDrop}</small></button>
          <button class="k-act" data-a="recruit" ${canRecruit ? '' : 'disabled'}>⚔️ 招募<small>花 1 金 → 兵 +1</small></button>
          <button class="k-act" data-a="attack" ${canAttack ? '' : 'disabled'}>🔥 出兵<small>削敵兵/破城斬殺</small></button>
        </div>`;
      } else if (myTurn && this._pickTarget) {
        actions = `<div class="k-acts"><div class="k-pick-label">選擇攻打目標：</div>` +
          opps.filter(o => o.alive).map(o => `<button class="k-act tgt" data-t="${o.id}">🔥 ${o.name}（⚔️${o.soldiers}）</button>`).join('') +
          `<button class="k-act cancel" data-cancel="1">取消</button></div>`;
      }
      root.innerHTML = `
        <div class="k-box">
          <div class="k-head"><span>⚔️ 王國暗戰</span><button class="k-quit">✕ 離開</button></div>
          <div class="k-morale"><div class="k-m-lab">民心</div><div class="k-m-track">${this.moraleBar(g.morale)}</div></div>
          <div class="k-players">${g.players.map(p => this.playerCard(p, me)).join('')}</div>
          <div class="k-you">${GOAL[me.faction]}${me.alive ? '' : '　（你已陣亡，旁觀至終局）'}</div>
          ${actions}
          <div class="k-log">${this.logs.map((m, i) => `<div class="k-log-line ${i === 0 ? 'new' : ''}">${m}</div>`).join('')}</div>
        </div>`;
      if (typeof root.querySelector === 'function') {
        const q = root.querySelector('.k-quit'); if (q) q.onclick = () => this.quit();
        root.querySelectorAll('.k-act').forEach(b => {
          b.onclick = () => {
            if (b.dataset.cancel) { this._pickTarget = false; this.render(); return; }
            if (b.dataset.t != null) { this._act({ type: 'attack', targetId: +b.dataset.t }); return; }
            const a = b.dataset.a;
            if (a === 'attack') { this._pickTarget = true; this.render(); return; }
            this._act({ type: a });
          };
        });
      }
    },

    showResult(g) {
      const root = this.el(); if (!root) return;
      const me = g.players[0];
      const iWon = g.winTeam === g.team(me.faction);
      const teamZh = g.winTeam === 'crown' ? '王室(王子+忠臣)' : '叛徒';
      const roster = g.players.map(p => `${p.name}：${FACTION_ZH[p.faction]}${p.alive ? '' : '（陣亡）'}`).join('　');
      const box = root.querySelector ? root.querySelector('.k-box') : null;
      if (!box) return;
      const ov = document.createElement('div');
      ov.className = 'k-result';
      ov.innerHTML = `<div class="k-result-in ${iWon ? 'win' : 'lose'}">
        <div class="k-r-title">${iWon ? '🎉 你的陣營獲勝！' : '💀 你的陣營落敗'}</div>
        <div class="k-r-sub">${g.winReason}</div>
        <div class="k-r-team">勝方：${teamZh}</div>
        <div class="k-r-roster">${roster}</div>
        <button class="k-again">再來一局</button><button class="k-home2">回首頁</button>
      </div>`;
      box.appendChild(ov);
      const again = ov.querySelector('.k-again'); if (again) again.onclick = () => this.start(g.players.length, this.speed);
      const home2 = ov.querySelector('.k-home2'); if (home2) home2.onclick = () => this.quit();
    }
  };

  Coup.Kingdom = { Game: KGame, AI: KAI, UI: KUI, factionSet: factionSet };

  if (typeof module !== 'undefined' && module.exports) module.exports = Coup;
})(typeof globalThis !== 'undefined' ? globalThis : this);
