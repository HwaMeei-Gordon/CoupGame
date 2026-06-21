/*
 * UI：渲染遊戲狀態 + 行動日誌，並實作「人類玩家」的 Agent 介面。
 * 人類決策以 Promise 回傳，由提示區按鈕點擊解析。
 */
(function (root) {
  'use strict';
  const Coup = root.Coup = root.Coup || {};
  const ZH = Coup.ZH;

  // 將 Coup 角色對應到古典塔羅大阿爾克那（羅馬數字 + 象徵）
  const ARCANA = {
    Duke:       { zh: '公爵', en: 'Duke',       arcana: '皇帝 The Emperor',      roman: 'IV',   sym: '♔' },
    Assassin:   { zh: '刺客', en: 'Assassin',   arcana: '死神 Death',           roman: 'XIII', sym: '⚔' },
    Captain:    { zh: '隊長', en: 'Captain',    arcana: '戰車 The Chariot',      roman: 'VII',  sym: '⚓' },
    Ambassador: { zh: '大使', en: 'Ambassador', arcana: '女祭司 High Priestess', roman: 'II',   sym: '☽' },
    Contessa:   { zh: '夫人', en: 'Contessa',   arcana: '女皇 The Empress',      roman: 'III',  sym: '♕' }
  };

  // 每角色一整張版畫風塔羅插畫（inline SVG，無需圖檔）。viewBox 100x150，
  // 由 cardEl 包上 <svg> 與外框；以 currentColor 線描呈現。
  const CARDART = {
    // 公爵／皇帝：鐵座領主、兜帽陰影、稅印、絲線連金幣堆、哥德城堡、天秤與∞
    Duke: `<g opacity=".22"><path d="M12 58V32h9v26M12 32l4.5-5 4.5 5M21 36h7v22M28 36l3-3 3 3v22"/><path d="M88 58V32h-9v26M88 32l-4.5-5-4.5 5M79 36h-7v22M72 36l-3-3-3 3v22"/></g>
<path d="M26 62V118M74 62V118"/><circle cx="26" cy="58" r="4"/><circle cx="74" cy="58" r="4"/>
<path d="M39 42l5 7 6-9 6 9 5-7-2 14H41z"/><circle cx="50" cy="38" r="1.3" fill="currentColor" stroke="none"/>
<path d="M43 56a7 7 0 0 1 14 0v5a7 7 0 0 1-14 0z"/><path d="M45.5 61h3.5M51 61h3.5" opacity=".7"/>
<path d="M38 116Q41 82 50 78 59 82 62 116Z"/><path d="M50 78V114M44 92V114M56 92V114" opacity=".3"/>
<path d="M46 64c0-3 4-3 4 0s4 3 4 0-4-3-4 0-4 3-4 0z" opacity=".55"/>
<g opacity=".7"><ellipse cx="37" cy="120" rx="5" ry="2"/><ellipse cx="50" cy="122" rx="5" ry="2"/><ellipse cx="63" cy="120" rx="5" ry="2"/></g>
<g opacity=".5"><path d="M44 112l-5 6M56 112l5 6"/></g>
<path d="M66 84v3M62 87h8M64 87l-2 4h4zM68 87l2 4h-4z" opacity=".7"/>`,
    // 刺客／死神：黑袍骷髏、滴血匕首、崩塌高塔、沙漏、破碎皇冠、枯萎玫瑰
    Assassin: `<g opacity=".28"><path d="M74 30l10 2-2 26-9-2zM74 30l-1 24 9 2M74 30l3-4 7 1M70 40l8-3M76 50l8-2"/><path d="M80 24l3 1-1 5-3-1z" opacity=".7"/></g>
<g fill="currentColor" stroke="none" opacity=".5"><circle cx="24" cy="24" r="1"/><circle cx="34" cy="18" r=".8"/></g>
<path d="M40 56l12-3 12 3-3 60H43z" opacity=".5"/>
<circle cx="52" cy="74" r="11"/><path d="M52 79l-2 4h4z"/>
<circle cx="47.5" cy="72" r="2.5" fill="currentColor" stroke="none"/><circle cx="56.5" cy="72" r="2.5" fill="currentColor" stroke="none"/>
<path d="M47 85h10M48 88h8" opacity=".85"/>
<path d="M30 40l4 50M30 40l-2-6h6zM30 90l-2 4h4z"/>
<path d="M28 56l4 1" opacity=".5"/>
<path d="M20 108l4 6 4-6-2 8h-4z" opacity=".6"/>
<path d="M74 110a4 4 0 1 1 6 0c2 2 1 6-3 6s-5-4-3-6z" opacity=".55"/>`,
    // 隊長／戰車：鋼鎧執法者、帶刺鎖鏈纏金元寶、獅紋巨盾、雷雨港
    Captain: `<g opacity=".25"><path d="M14 36q8-4 14 0M70 32q9-4 16 0"/><path d="M30 30l-3 8 5-2-2 7"/></g>
<path d="M40 40q10-6 20 0v8q-10 5-20 0z"/><path d="M40 44h20" opacity=".5"/><path d="M50 32v8" opacity=".6"/>
<path d="M44 56h12l-2 40H46z"/><path d="M44 62h12" opacity=".5"/>
<path d="M62 58h16v22H62z"/><circle cx="70" cy="67" r="5"/><path d="M66 64l-3-3M74 64l3-3M67 71q3 3 6 0" opacity=".7"/><path d="M70 72v5M67 75h6" opacity=".6"/>
<g opacity=".8"><circle cx="26" cy="92" r="4"/><circle cx="34" cy="98" r="4"/><path d="M30 70q-8 6-4 18M30 70l3 4M30 70l-3 4" stroke-dasharray="1.5 2.5"/></g>`,
    // 外交官／魔術師：一手指天一手指地、權杖、無限符號、銜尾蛇、漂浮雙牌
    Ambassador: `<path d="M46 40c0-2.6 4-2.6 4 0s4 2.6 4 0-4-2.6-4 0-4 2.6-4 0z" opacity=".6"/>
<circle cx="50" cy="50" r="5"/>
<path d="M43 100Q44 62 50 58 56 62 57 100Z"/>
<path d="M52 64l11-13M63 51v-9"/><circle cx="63" cy="40" r="1.6" fill="currentColor" stroke="none"/>
<path d="M48 66l-11 15"/>
<rect x="25" y="66" width="11" height="15" rx="1.5" transform="rotate(-16 30 73)" opacity=".65"/>
<rect x="64" y="70" width="11" height="15" rx="1.5" transform="rotate(15 69 77)" opacity=".65"/>
<g fill="currentColor" stroke="none" opacity=".5"><circle cx="30" cy="50" r="1.2"/><circle cx="70" cy="50" r="1.2"/></g>
<path d="M37 112a13 9 0 1 0 26 0 13 9 0 0 1-24 2" opacity=".5"/><path d="M39 114l-3-2 1 4z" fill="currentColor" stroke="none" opacity=".5"/>`,
    // 貴婦／女皇：玫瑰禮服、舉聖鏡反射黑匕首、荊棘玫瑰、花園
    Contessa: `<g opacity=".25"><path d="M16 116q4-10 0-20M16 100l-4-3M16 100l4-3M84 116q-4-10 0-20M84 100l4-3M84 100l-4-3"/></g>
<path d="M38 36l4 6 8-7 8 7 4-6-2 13H40z"/>
<circle cx="50" cy="56" r="7"/><path d="M44 55q6 4 12 0" opacity=".4"/>
<path d="M33 118Q39 76 50 70 61 76 67 118Z"/><path d="M50 70V116M42 90V116M58 90V116" opacity=".28"/>
<circle cx="66" cy="50" r="8"/><path d="M66 50m-8 0a8 8 0 0 1 16 0" opacity=".5"/><path d="M66 58v6" opacity=".6"/>
<path d="M58 50l-12-8M46 42l3-1-1 3zM46 42l-2 8" opacity=".75"/>
<g opacity=".7"><circle cx="30" cy="112" r="3.2"/><path d="M30 112a3.2 3.2 0 0 1 0-3M28 116l-3 4M32 116l3 4"/></g>
<path d="M22 118h56" opacity=".4"/>`
  };

  const UI = {
    game: null,
    speed: 800,
    currentTurn: -1,

    // 回饋層：Web Audio 合成音效（無需音檔）+ 手機觸覺震動
    fb: {
      ctx: null, muted: false,
      ensure() {
        if (typeof window === 'undefined') return null;
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          if (!this.ctx) this.ctx = new AC();
          if (this.ctx.state === 'suspended') this.ctx.resume();
        } catch (e) { return null; }
        return this.ctx;
      },
      tone(freq, dur, type, gain) {
        if (this.muted) return;
        const c = this.ensure(); if (!c) return;
        try {
          const o = c.createOscillator(), g = c.createGain();
          o.type = type || 'sine'; o.frequency.value = freq;
          o.connect(g); g.connect(c.destination);
          const t = c.currentTime;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(gain || 0.05, t + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.15));
          o.start(t); o.stop(t + (dur || 0.15) + 0.03);
        } catch (e) { /* 音效失敗不影響遊戲 */ }
      },
      buzz(p) { try { if (typeof navigator !== 'undefined' && navigator.vibrate && !this.muted) navigator.vibrate(p); } catch (e) {} },
      turn()      { this.tone(660, 0.12, 'sine', 0.05); this.buzz(25); },
      challenge() { this.tone(247, 0.16, 'sawtooth', 0.05); this.buzz(35); },
      death()     { this.tone(150, 0.28, 'sawtooth', 0.06); this.buzz([25, 35, 55]); },
      win()  { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'sine', 0.06), i * 110)); this.buzz([20, 40, 20, 40, 90]); },
      lose() { [392, 294, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.26, 'sine', 0.05), i * 150)); this.buzz(140); },
      slash()     { this.tone(180, 0.08, 'sawtooth', 0.05); setTimeout(() => this.tone(90, 0.18, 'sawtooth', 0.05), 70); this.buzz([15, 30, 15]); },
      fromLog(m) {
        if (m.indexOf('🗡️') >= 0) this.slash();
        else if (m.indexOf('💥') >= 0 || m.indexOf('☠️') >= 0) this.death();
        else if (m.indexOf('❓') >= 0 || m.indexOf('🛡️') >= 0) this.challenge();
      }
    },

    // 全螢幕電影級特效層（依事件觸發,不阻擋互動）
    fx: {
      el: null,
      ensure() { if (!this.el && typeof document !== 'undefined') this.el = document.getElementById('fx'); return this.el; },
      spawn(cls, ms) {
        const root = this.ensure(); if (!root || typeof document === 'undefined') return;
        const node = document.createElement('div');
        if (!node || !node.classList || typeof node.classList.add !== 'function') return;
        node.className = cls;
        root.appendChild(node);
        setTimeout(() => { try { node.remove(); } catch (e) {} }, ms || 900);
      },
      fromLog(m) {
        if (m.indexOf('🗡️') >= 0) this.spawn('fx-slash', 700);
        else if (m.indexOf('🛡️') >= 0) this.spawn('fx-shield', 750);
        else if (m.indexOf('課得賦稅') >= 0 || m.indexOf('援助悄然入袋') >= 0) this.spawn('fx-gold', 800);
        else if (m.indexOf('❓') >= 0) this.spawn('fx-crack', 500);
        else if (m.indexOf('☠️') >= 0) this.spawn('fx-dark', 800);
      }
    },

    init() {
      this.els = {
        opponents: document.getElementById('opponents'),
        me: document.getElementById('me'),
        statusbar: document.getElementById('statusbar'),
        prompt: document.getElementById('prompt'),
        log: document.getElementById('log'),
        overlay: document.getElementById('overlay')
      };
    },

    // ---------- 開新局 ----------
    newGame(numPlayers, difficulty, speed) {
      if (this.game) this.game.cancel(); // 終止上一局，避免並行
      this.speed = speed;
      this.els.log.innerHTML = '';
      this.els.prompt.innerHTML = '';
      this.els.overlay.classList.remove('show');
      this.els.overlay.innerHTML = '';

      const configs = [{ name: '你', isHuman: true }];
      for (let i = 1; i < numPlayers; i++) configs.push({ name: '電腦 ' + i, isHuman: false });

      const game = new Coup.GameController(configs, {
        onLog: (m) => this.log(m),
        onState: () => this.render(),
        onTurn: (id) => { this.currentTurn = id; this.render(); },
        onGameOver: (w) => this.showWinner(w),
        pause: () => new Promise(r => setTimeout(r, this.speed))
      });
      game.agents[0] = this; // 人類 = 本 UI（實作 Agent 介面）
      for (let i = 1; i < numPlayers; i++) game.agents[i] = new Coup.AIAgent(i, difficulty);

      this.game = game;
      this.currentTurn = 0;
      this.render();
      game.play();
    },

    log(msg) {
      const div = document.createElement('div');
      div.className = 'log-line' + this.logClass(msg);
      div.textContent = msg;
      this.els.log.appendChild(div);
      this.els.log.scrollTop = this.els.log.scrollHeight;
      this.fb.fromLog(msg);
      this.fx.fromLog(msg);
    },

    // 依事件類型為日誌上色，方便快速掃讀
    logClass(m) {
      if (m.indexOf('💥') >= 0 || m.indexOf('☠️') >= 0) return ' l-bad';
      if (m.indexOf('❓') >= 0) return ' l-challenge';
      if (m.indexOf('🛡️') >= 0) return ' l-block';
      if (m.indexOf('✅') >= 0) return ' l-good';
      if (m.indexOf('🎬') >= 0 || m.indexOf('🏁') >= 0) return ' l-meta';
      return '';
    },

    // ---------- 渲染 ----------
    cardEl(ch, faceUp, lost) {
      if (!faceUp) {
        return '<div class="card back"><div class="back-orn">✦</div></div>';
      }
      const a = ARCANA[ch];
      return `<div class="card ${ch} ${lost ? 'lost' : ''}">
        <svg class="card-art" viewBox="0 0 100 150" preserveAspectRatio="xMidYMid slice"
             fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3.5" y="3.5" width="93" height="143" rx="7" stroke-width="1.5" opacity=".85"/>
          <rect x="6.5" y="6.5" width="87" height="137" rx="5" stroke-width=".6" opacity=".4"/>
          <g opacity=".7" stroke-width="1">
            <path d="M12 6.5q-5.5 0-5.5 5.5M88 6.5q5.5 0 5.5 5.5M12 143.5q-5.5 0-5.5-5.5M88 143.5q5.5 0 5.5-5.5"/>
            <path d="M42 6.5q8 5 16 0M42 143.5q8-5 16 0" opacity=".75"/>
          </g>
          <g fill="currentColor" stroke="none" opacity=".75"><circle cx="50" cy="6.5" r="1.4"/><circle cx="50" cy="143.5" r="1.4"/><circle cx="6.5" cy="50" r="1.1"/><circle cx="93.5" cy="50" r="1.1"/></g>
          ${CARDART[ch] || ''}
        </svg>
        <div class="card-corner tl">${a.roman}</div>
        <div class="card-banner">${a.zh}<small>${a.en}</small></div>
        ${lost ? `<div class="card-deceased">DECEASED<span>${a.roman}</span></div>` : ''}
      </div>`;
    },

    // 對手小卡（牌背 / 已攤開的死牌）
    miniCard(ch, lost) {
      if (!lost) return '<div class="mini back"></div>';
      const a = ARCANA[ch];
      return `<div class="mini lost ${ch}" title="${a.zh} ${a.en}（死牌）">${a.sym}</div>`;
    },

    // 對手座位卡（精簡：名稱 / 金幣 / 影響力小卡）
    oppEl(p) {
      const cls = ['opp'];
      if (this.currentTurn === p.id && p.alive) cls.push('current');
      if (!p.alive) cls.push('dead');
      const minis = p.cards.map(() => this.miniCard(null, false)).join('') +
                    p.lost.map(c => this.miniCard(c, true)).join('');
      return `<div class="${cls.join(' ')}">
        <div class="opp-head"><span class="opp-name">${p.name}</span>
          <span class="opp-coin">🪙 ${p.coins}</span></div>
        <div class="opp-cards">${minis}</div>
        <div class="opp-inf">${p.alive ? '影響 ' + p.cards.length : '出局'}</div>
      </div>`;
    },

    // 人類手牌區（大牌 + 資訊）
    meEl(p) {
      const cls = ['me-inner'];
      if (this.currentTurn === 0 && p.alive) cls.push('current');
      if (!p.alive) cls.push('dead');
      const hand = p.cards.map(c => this.cardEl(c, true, false)).join('') +
                   p.lost.map(c => this.cardEl(c, true, true)).join('');
      return `<div class="${cls.join(' ')}">
        <div class="me-foot">
          <span class="me-name">你</span>
          <span class="me-coin">🪙 <b>${p.coins}</b></span>
          <span class="me-inf">影響 ${p.cards.length}${p.alive ? '' : ' · 出局'}</span>
        </div>
        <div class="me-cards">${hand}</div>
      </div>`;
    },

    render() {
      if (!this.game) return;
      const g = this.game;
      this.els.opponents.innerHTML = g.players
        .filter(p => !p.isHuman).map(p => this.oppEl(p)).join('');
      this.els.me.innerHTML = g.players
        .filter(p => p.isHuman).map(p => this.meEl(p)).join('');
      const cur = g.players[this.currentTurn];
      this.els.statusbar.innerHTML =
        `<span class="sb-deck">❖ 牌庫 ${g.deck.length}</span>` +
        `<span class="sb-turn">${g.over ? '🏁 遊戲結束' : '🎲 ' + (cur ? cur.name : '') + ' 的回合'}</span>`;
    },

    showWinner(w) {
      const isMe = w && w.isHuman;
      this.fb[isMe ? 'win' : 'lose']();
      const hand = (w && w.cards && w.cards.length)
        ? `<div class="win-sub">勝者手牌</div><div class="win-cards">${w.cards.map(c => this.cardEl(c, true, false)).join('')}</div>`
        : '';
      this.els.overlay.innerHTML =
        `<div class="win-box ${isMe ? 'win' : 'lose'}">
          <div class="win-title">${isMe ? '🎉 你獲勝了！' : '💀 你被淘汰了'}</div>
          <div class="win-sub">勝者：${w ? w.name : '無'}</div>
          ${hand}
          <button id="againBtn" class="pbtn act">再來一局</button>
        </div>`;
      this.els.overlay.classList.add('show');
      const btn = document.getElementById('againBtn');
      if (btn) btn.onclick = () => root.CoupMain.start();
    },

    // ---------- 提示工具 ----------
    prompt(title, buttons) {
      return new Promise(resolve => {
        const el = this.els.prompt;
        el.innerHTML = `<div class="prompt-title">${title}</div>` +
          `<div class="prompt-btns">` +
          buttons.map((b, i) =>
            `<button class="pbtn ${b.cls || ''}" data-i="${i}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`
          ).join('') + `</div>`;
        el.querySelectorAll('button').forEach(btn => {
          btn.onclick = () => {
            const b = buttons[+btn.dataset.i];
            if (b.disabled) return;
            el.innerHTML = '';
            resolve(b.value);
          };
        });
      });
    },

    // ========== Agent 介面（人類 = players[0]）==========

    async chooseAction(game) {
      this.fb.turn(); // 輪到你：提示音 + 震動
      const me = game.players[0];
      const opps = game.players.filter(p => p.alive && p.id !== 0);
      const forced = me.coins >= 10;
      const defs = [
        { type: 'income',      ic: '＋', name: '收入', sub: '+1 金幣',   ok: !forced, role: '' },
        { type: 'foreign_aid', ic: '🤝', name: '外援', sub: '+2 金幣',   ok: !forced, role: '' },
        { type: 'tax',         ic: '♔', name: '課稅', sub: '公爵 · +3',  ok: !forced, role: 'Duke' },
        { type: 'steal',       ic: '⚓', name: '偷竊', sub: '隊長 · 偷2', ok: !forced && opps.length > 0, role: 'Captain' },
        { type: 'exchange',    ic: '☽', name: '換牌', sub: '大使',       ok: !forced, role: 'Ambassador' },
        { type: 'assassinate', ic: '⚔', name: '暗殺', sub: '刺客 · 付3', ok: !forced && me.coins >= 3 && opps.length > 0, role: 'Assassin' },
        { type: 'coup',        ic: '🎯', name: '政變', sub: '付7',        ok: me.coins >= 7 && opps.length > 0, role: '' }
      ];
      const buttons = defs.map(d => ({
        label: `<span class="b-ic">${d.ic}</span><span class="b-tx"><b>${d.name}</b><small>${d.sub}</small></span>`,
        value: d.type, disabled: !d.ok, cls: 'actbtn' + (d.role ? ' r-' + d.role : '')
      }));
      const title = forced ? '你有 10+ 金幣，必須發動政變！' : '輪到你了，選擇一個行動：';
      const type = await this.prompt(title, buttons);

      if (Coup.ACTIONS[type].targeted) {
        const tbtns = opps.map(o => ({
          label: `${o.name}（影響 ${o.cards.length} / 🪙 ${o.coins}）`, value: o.id, cls: 'target'
        }));
        tbtns.push({ label: '↩ 重選行動', value: '__cancel__', cls: 'cancel' });
        const verb = type === 'coup' ? '政變' : type === 'assassinate' ? '暗殺' : '偷竊';
        const tid = await this.prompt(`選擇要${verb}的目標：`, tbtns);
        if (tid === '__cancel__') return this.chooseAction(game);
        return { type, targetId: tid };
      }
      return { type };
    },

    decideChallenge(game, claimantId, character) {
      if (claimantId === 0) return false;
      const claimant = game.players[claimantId];
      let visible = 0;
      game.players.forEach(p => p.lost.forEach(c => { if (c === character) visible++; }));
      const title = `${claimant.name} 宣稱【${ZH[character]} ${character}】。是否質疑？` +
        `<br><small>檯面已公開 ${visible} 張此角色（共 3 張）</small>`;
      return this.prompt(title, [
        { label: '🔮 質疑！', value: true, cls: 'danger crystal' },
        { label: '🌫 默許', value: false, cls: 'smoke' }
      ]);
    },

    decideChallengeBlock(game, blockerId, character) {
      return this.decideChallenge(game, blockerId, character);
    },

    async decideBlock(game, action, blockChars) {
      const me = game.players[0];
      const actor = game.players[action.actorId];

      if (action.type === 'foreign_aid') {
        const hasDuke = me.cards.includes('Duke');
        const title = hasDuke
          ? `${actor.name} 想拿外援，要用【公爵 Duke】阻擋嗎？`
          : `${actor.name} 想拿外援。你沒有公爵——要<b>詐唬</b>宣稱【公爵 Duke】阻擋嗎？` +
            `<br><small>若被質疑拆穿，你將失去一張影響力</small>`;
        const v = await this.prompt(title, [
          { label: hasDuke ? '🛡️ 用公爵阻擋' : '🎭 詐唬公爵阻擋', value: true, cls: 'shield' },
          { label: '放行', value: false, cls: '' }
        ]);
        return { block: v, character: 'Duke' };
      }

      if (action.type === 'steal') {
        const v = await this.prompt(`${actor.name} 要偷你 2 金幣，如何反制？`, [
          { label: '🛡️ 宣稱隊長 Captain', value: 'Captain', cls: 'shield' },
          { label: '🛡️ 宣稱大使 Ambassador', value: 'Ambassador', cls: 'shield' },
          { label: '不阻擋', value: '__no__', cls: '' }
        ]);
        if (v === '__no__') return { block: false };
        return { block: true, character: v };
      }

      if (action.type === 'assassinate') {
        const v = await this.prompt(
          `⚠️ ${actor.name} 要暗殺你！要用【夫人 Contessa】阻擋嗎？` +
          `<br><small>若你沒有夫人被拆穿，將一次失去兩張影響力</small>`, [
          { label: '🛡️ 宣稱夫人阻擋', value: true, cls: 'shield' },
          { label: '不阻擋', value: false, cls: '' }
        ]);
        return { block: v, character: 'Contessa' };
      }
      return { block: false };
    },

    chooseCardToLose(game, playerId) {
      const me = game.players[playerId];
      const buttons = me.cards.map((c, i) => ({
        label: `攤開 ${ZH[c]} ${c}`, value: i, cls: c
      }));
      return this.prompt('你失去一張影響力，選擇要攤開哪一張：', buttons);
    },

    chooseExchange(game, playerId, drawn) {
      return new Promise(resolve => {
        const me = game.players[playerId];
        const pool = me.cards.slice(); // 引擎已把抽到的牌併入
        const keep = me.originalInfluence;
        const sel = new Set();
        const el = this.els.prompt;
        const redraw = () => {
          el.innerHTML =
            `<div class="prompt-title">大使交換：選擇保留 ${keep} 張（已選 ${sel.size}）</div>` +
            `<div class="exchange">` + pool.map((c, i) => {
              const a = ARCANA[c];
              return `<button class="card ${c} ${sel.has(i) ? 'picked' : ''}" data-i="${i}">` +
                `<svg class="card-art" viewBox="0 0 100 150" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
                `<rect x="4" y="4" width="92" height="142" rx="6" stroke-width="1.6" opacity=".8"/>${CARDART[c] || ''}</svg>` +
                `<div class="card-corner tl">${a.roman}</div>` +
                `<div class="card-banner">${a.zh}<small>${a.en}</small></div></button>`;
            }).join('') + `</div>` +
            `<div class="prompt-btns"><button class="pbtn act confirm" ${sel.size === keep ? '' : 'disabled'}>確定保留</button></div>`;
          el.querySelectorAll('.card').forEach(b => {
            b.onclick = () => {
              const i = +b.dataset.i;
              if (sel.has(i)) sel.delete(i);
              else { if (sel.size >= keep) return; sel.add(i); }
              redraw();
            };
          });
          const cf = el.querySelector('.confirm');
          if (cf) cf.onclick = () => {
            if (sel.size !== keep) return;
            el.innerHTML = '';
            resolve([...sel].map(i => pool[i]));
          };
        };
        redraw();
      });
    }
  };

  Coup.UI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
