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

  const UI = {
    game: null,
    speed: 800,
    currentTurn: -1,

    init() {
      this.els = {
        opponents: document.getElementById('opponents'),
        human: document.getElementById('human'),
        center: document.getElementById('center'),
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
      div.className = 'log-line';
      div.textContent = msg;
      this.els.log.appendChild(div);
      this.els.log.scrollTop = this.els.log.scrollHeight;
    },

    // ---------- 渲染 ----------
    cardEl(ch, faceUp, lost) {
      if (!faceUp) {
        return '<div class="card back"><div class="back-orn">✦</div></div>';
      }
      const a = ARCANA[ch];
      return `<div class="card ${ch} ${lost ? 'lost' : ''}">
        <div class="card-corner tl">${a.roman}</div>
        <div class="card-corner br">${a.roman}</div>
        <div class="card-sym">${a.sym}</div>
        <div class="card-name">${a.zh}</div>
        <div class="card-en">${a.en}</div>
        <div class="card-arcana">${a.arcana}</div>
      </div>`;
    },

    playerEl(p) {
      const isMe = p.isHuman;
      const cls = ['player'];
      if (isMe) cls.push('me');
      if (this.currentTurn === p.id && p.alive) cls.push('current');
      if (!p.alive) cls.push('dead');

      const hidden = p.cards.map(c => this.cardEl(c, isMe, false)).join('');
      const lost = p.lost.map(c => this.cardEl(c, true, true)).join('');
      const coinPips = '●'.repeat(Math.min(p.coins, 12)) + (p.coins > 12 ? '…' : '');
      return `<div class="${cls.join(' ')}">
        <div class="phead">
          <span class="pname">${p.name}</span>
          <span class="pcoins" title="金幣"><b>${p.coins}</b><i class="coin">⊚</i></span>
        </div>
        <div class="pcards">${hidden}${lost}</div>
        <div class="pinfo"><span class="pips">${coinPips || '○'}</span>
          <span class="inf">影響力 ${p.cards.length}${p.alive ? '' : ' · 出局'}</span></div>
      </div>`;
    },

    render() {
      if (!this.game) return;
      const g = this.game;
      this.els.opponents.innerHTML = g.players
        .filter(p => !p.isHuman).map(p => this.playerEl(p)).join('');
      this.els.human.innerHTML = g.players
        .filter(p => p.isHuman).map(p => this.playerEl(p)).join('');
      const cur = g.players[this.currentTurn];
      this.els.center.innerHTML =
        `<div class="deck-info">牌庫 Court Deck：${g.deck.length} 張</div>` +
        `<div class="turn-info">${g.over ? '遊戲結束' : '目前回合：' + (cur ? cur.name : '')}</div>`;
    },

    showWinner(w) {
      const isMe = w && w.isHuman;
      this.els.overlay.innerHTML =
        `<div class="win-box ${isMe ? 'win' : 'lose'}">
          <div class="win-title">${isMe ? '🎉 你獲勝了！' : '💀 你被淘汰了'}</div>
          <div class="win-sub">勝者：${w ? w.name : '無'}</div>
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
      const me = game.players[0];
      const opps = game.players.filter(p => p.alive && p.id !== 0);
      const forced = me.coins >= 10;
      const defs = [
        { type: 'income',      label: '收入 +1',            ok: !forced },
        { type: 'foreign_aid', label: '外援 +2',            ok: !forced },
        { type: 'tax',         label: '課稅 (公爵) +3',     ok: !forced },
        { type: 'steal',       label: '偷竊 (隊長)',        ok: !forced && opps.length > 0 },
        { type: 'exchange',    label: '交換 (大使)',        ok: !forced },
        { type: 'assassinate', label: '暗殺 (刺客) 付3',    ok: !forced && me.coins >= 3 && opps.length > 0 },
        { type: 'coup',        label: '政變 付7',           ok: me.coins >= 7 && opps.length > 0 }
      ];
      const buttons = defs.map(d => ({
        label: d.label, value: d.type, disabled: !d.ok, cls: 'act'
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
        if (!me.cards.includes('Duke')) return { block: false }; // 沒公爵自動放行
        const v = await this.prompt(`${actor.name} 想拿外援，要用【公爵 Duke】阻擋嗎？`, [
          { label: '🛡️ 用公爵阻擋', value: true, cls: 'shield' },
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
                `<div class="card-corner tl">${a.roman}</div>` +
                `<div class="card-sym">${a.sym}</div>` +
                `<div class="card-name">${a.zh}</div>` +
                `<div class="card-en">${a.en}</div>` +
                `<div class="card-arcana">${a.arcana}</div></button>`;
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
