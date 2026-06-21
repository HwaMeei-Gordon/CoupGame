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
    Duke: `<g opacity=".4" stroke-width=".7"><path d="M50 30V18"/><path d="M50 30L38 20"/><path d="M50 30L62 20"/><path d="M50 30L30 26"/><path d="M50 30L70 26"/></g>
<path d="M24 64V118M76 64V118"/><circle cx="24" cy="60" r="4.5"/><circle cx="76" cy="60" r="4.5"/>
<path d="M37 44l5 7 8-9 8 9 5-7-2 16H39z"/>
<circle cx="50" cy="66" r="7"/>
<path d="M37 116Q40 84 50 80 60 84 63 116Z"/><path d="M50 80V112" opacity=".35"/>
<path d="M66 76V106"/><circle cx="66" cy="72.5" r="3"/>
<path d="M20 118H80"/>`,
    Assassin: `<path d="M68 26a13 13 0 1 0 5 18 10 10 0 0 1-5-18z" opacity=".35"/>
<path d="M32 28V120"/><path d="M32 34q28-3 33 17-20-13-33-5"/>
<circle cx="54" cy="84" r="14"/>
<circle cx="49" cy="82" r="2.3" fill="currentColor" stroke="none"/><circle cx="59" cy="82" r="2.3" fill="currentColor" stroke="none"/>
<path d="M52 88l2 4 2-4"/>
<path d="M47 95h14M48 99h12M49 102v3M54 102v3M59 102v3" opacity=".8"/>
<path d="M40 120h32" opacity=".5"/>`,
    Captain: `<g opacity=".5"><path d="M16 116q9-7 18 0t18 0 18 0 18 0"/><path d="M16 123q9-7 18 0t18 0 18 0 18 0" opacity=".6"/></g>
<path d="M30 102h40l-7 13H37z"/>
<path d="M50 102V36"/>
<path d="M50 44q20 7 17 33l-17-7z"/><path d="M50 44q-20 7-17 33l17-7z"/>
<path d="M50 36h13l-3.5 4 3.5 4h-13" fill="currentColor" stroke="none" opacity=".85"/>`,
    Ambassador: `<path d="M24 50V120M76 50V120"/>
<rect x="18.5" y="45" width="11" height="6"/><rect x="70.5" y="45" width="11" height="6"/>
<path d="M44 40a6 6 0 0 0 12 0" opacity=".5"/><circle cx="50" cy="38" r="2.6"/>
<circle cx="50" cy="58" r="6"/>
<path d="M38 118Q40 70 50 62 60 70 62 118Z"/><path d="M40 84h20" opacity=".5"/>
<path d="M46 92h8v12h-8z" opacity=".8"/>
<g fill="currentColor" stroke="none" opacity=".5"><circle cx="33" cy="34" r="1"/><circle cx="67" cy="34" r="1"/></g>`,
    Contessa: `<g opacity=".4" stroke-width=".7"><path d="M50 26V16"/><path d="M40 28L36 19"/><path d="M60 28L64 19"/></g>
<path d="M38 36l4 5 8-7 8 7 4-5-2 12H40z"/>
<circle cx="50" cy="56" r="7"/>
<path d="M34 118Q39 76 50 70 61 76 66 118Z"/>
<path d="M50 88c-4-5-11-1-11 4 0 5 11 10 11 10s11-5 11-10c0-5-7-9-11-4z" opacity=".85"/>
<path d="M28 116q3-8 0-14M28 116q-3-8 0-14" opacity=".7"/><path d="M72 116q3-8 0-14M72 116q-3-8 0-14" opacity=".7"/>
<path d="M22 118h56"/>`
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
      fromLog(m) {
        if (m.indexOf('💥') >= 0 || m.indexOf('☠️') >= 0) this.death();
        else if (m.indexOf('❓') >= 0 || m.indexOf('🛡️') >= 0) this.challenge();
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
          <rect x="4" y="4" width="92" height="142" rx="6" stroke-width="1.6" opacity=".8"/>
          <rect x="7.5" y="7.5" width="85" height="135" rx="4" stroke-width=".7" opacity=".4"/>
          <g fill="currentColor" stroke="none" opacity=".7"><circle cx="9" cy="9" r="1.5"/><circle cx="91" cy="9" r="1.5"/><circle cx="9" cy="141" r="1.5"/><circle cx="91" cy="141" r="1.5"/></g>
          ${CARDART[ch] || ''}
        </svg>
        <div class="card-corner tl">${a.roman}</div>
        <div class="card-banner">${a.zh}<small>${a.en}</small></div>
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
        ? `<div class="win-hand">勝者手牌：${w.cards.map(c => `【${ZH[c]} ${c}】`).join(' ')}</div>`
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
        { label: '❓ 質疑！', value: true, cls: 'danger' },
        { label: '放過', value: false, cls: '' }
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
