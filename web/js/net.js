/*
 * Net：P2P 連線對戰（WebRTC / PeerJS），房主瀏覽器當「權威裁判」跑引擎。
 *
 * 設計重點（隱藏資訊安全）：
 *  - 房主跑 GameController（完整狀態）；每位遠端玩家是一個 RemoteAgent。
 *  - 引擎要某遠端玩家決策時，RemoteAgent 只送出「該玩家的私有視角」(serializeView)
 *    ——別人的手牌一律以「蓋牌張數」呈現，看不到內容。
 *  - 客人端不跑引擎，只用既有 UI：收到請求 → 跳既有提示 → 回傳決策；收到狀態 → 渲染。
 *  - 斷線或逾時 → 由內建 AI 接手該座位，遊戲不中斷。
 *
 * 真正的 WebRTC 握手由 PeerJS 處理（window.Peer）。核心協定（序列化 / 代理 / 請求-回應）
 * 與傳輸層解耦，可用記憶體通道在 Node 端單元測試。
 */
(function (root) {
  'use strict';
  const Coup = root.Coup = root.Coup || {};

  // 把「完整遊戲狀態」轉成「某視角玩家」可見的快照：只露自己的牌，別人只給張數。
  function serializeView(game, viewerId) {
    return {
      myId: viewerId,
      mode: game.mode || 'normal',
      banditCoins: game.banditCoins || 0, // 強盜卡累積金幣（持有者卡面顯示用）
      current: game.current,
      over: !!game.over,
      winnerId: game.winner ? game.winner.id : null,
      deck: new Array(game.deck ? game.deck.length : 0).fill(null), // 只洩漏牌庫張數
      players: game.players.map(p => ({
        id: p.id,
        name: p.name,
        isHuman: p.id === viewerId,                 // 視角玩家 = 介面上的「你」
        coins: p.coins,
        alive: p.alive,
        lost: (p.lost || []).slice(),
        claimLog: (p.claimLog || []).slice(),
        timeline: (p.timeline || []).map(e => ({ kind: e.kind, ch: e.ch })),
        // 只露自己的真牌；別人以等量的 null 佔位（介面只用張數畫蓋牌）
        cards: p.id === viewerId ? (p.cards || []).slice() : (p.cards || []).map(() => null),
        originalInfluence: p.id === viewerId ? p.originalInfluence : undefined
      }))
    };
  }

  // RemoteAgent：房主端代表「某遠端真人」。實作 Agent 介面；決策走網路請求-回應，
  // 斷線/逾時則由內建 AI（fallback）以房主的真實 game 代為決策。
  class RemoteAgent {
    constructor(seatId, conn, opts) {
      opts = opts || {};
      this.id = seatId;
      this.conn = conn;
      this.connected = !!conn;
      this.timeoutMs = opts.timeoutMs || 60000;
      this.fallback = opts.fallback || new Coup.AIAgent(seatId);
      this.pending = {};
      this.reqSeq = 0;
    }

    _decideRemote(method, args, game) {
      return new Promise(resolve => {
        const useFallback = () => resolve(this.fallback[method].apply(this.fallback, [game].concat(args)));
        if (!this.connected || !this.conn) return useFallback();
        const reqId = ++this.reqSeq;
        let done = false;
        const finish = v => { if (!done) { done = true; delete this.pending[reqId]; resolve(v); } };
        const timer = setTimeout(() => { if (!done) { finish(this.fallback[method].apply(this.fallback, [game].concat(args))); } }, this.timeoutMs);
        this.pending[reqId] = v => { clearTimeout(timer); finish(v); };
        try {
          this.conn.send({ t: 'request', reqId, method, args, view: serializeView(game, this.id) });
        } catch (e) { clearTimeout(timer); useFallback(); }
      });
    }

    // 客人回傳決策時呼叫
    resolveResponse(reqId, value) {
      const cb = this.pending[reqId];
      if (cb) cb(value);
    }
    markDisconnected() { this.connected = false; }

    // ---- Agent 介面 ----
    chooseAction(game)                       { return this._decideRemote('chooseAction', [], game); }
    decideChallenge(game, c, ch)             { return this._decideRemote('decideChallenge', [c, ch], game); }
    decideChallengeBlock(game, b, ch)        { return this._decideRemote('decideChallengeBlock', [b, ch], game); }
    decideBlock(game, action, blockChars)    { return this._decideRemote('decideBlock', [action, blockChars], game); }
    chooseCardToLose(game, pid)              { return this._decideRemote('chooseCardToLose', [pid], game); }
    chooseExchange(game, pid, drawn)         { return this._decideRemote('chooseExchange', [pid, drawn], game); }
    // 觀察類通知：同步餵給 fallback AI，讓它隨時能無縫接手
    observe(game, c, ch)        { try { this.fallback.observe(game, c, ch); } catch (e) {} }
    onSwap(game, p, ch)         { try { this.fallback.onSwap(game, p, ch); } catch (e) {} }
    observeOutcome(game, ev)    { try { this.fallback.observeOutcome(game, ev); } catch (e) {} }
    // 私訊：只送給「這一位」客人（不廣播）；AI fallback 不需要
    privateNote(game, msg)      { if (this.connected && this.conn) { try { this.conn.send({ t: 'private', msg }); } catch (e) {} } }
  }

  // PeerJS 連線設定：多組 STUN（找對外位址）+ 免費 TURN（NAT 穿透失敗時改用中繼）。
  // 沒有 TURN 時，行動網路/嚴格路由器常常連不上；TURN 中繼可大幅提高成功率。
  const ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ];
  const PEER_OPTS = { debug: 1, config: { iceServers: ICE } };

  const Net = {
    role: null,          // 'host' | 'guest' | null
    peer: null,
    seats: [],           // host: [{conn, name, seat, agent}]
    game: null,
    speed: 800,
    hooks: {},           // { onRoster, onCode, onError, onStart, onState, onLog, onOver, onLobbyJoined }

    serializeView,
    RemoteAgent,

    _hasPeer() { return typeof root.Peer === 'function'; },

    _genCode() {
      const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O/1/I
      let c = ''; for (let i = 0; i < 5; i++) c += s[Math.floor(Math.random() * s.length)];
      return c;
    },
    _peerId(code) { return 'coupgame-' + String(code).toUpperCase().replace(/[^A-Z0-9]/g, ''); },

    // ====================== 房主 ======================
    createRoom(hostName, hooks) {
      this.role = 'host';
      this.hooks = hooks || {};
      this.seats = [];
      this.hostName = hostName || '房主';
      if (!this._hasPeer()) { this._err('連線元件未載入（需要網路連線以載入 PeerJS）'); return; }
      this._tryCreate(0);
    },

    _tryCreate(attempt) {
      const code = this._genCode();
      this.roomCode = code;
      this.peer = new root.Peer(this._peerId(code), PEER_OPTS);
      this.peer.on('open', () => { if (this.hooks.onCode) this.hooks.onCode(code); });
      this.peer.on('connection', conn => this._onGuestConn(conn));
      this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (x) {} });
      this.peer.on('error', e => {
        const type = e && e.type ? e.type : '';
        if (type === 'unavailable-id' && attempt < 5) { try { this.peer.destroy(); } catch (x) {} this._tryCreate(attempt + 1); }
        else this._err(this._errText(type));
      });
    },

    _onGuestConn(conn) {
      conn.on('data', msg => this._hostOnData(conn, msg));
      conn.on('close', () => this._onGuestClose(conn));
    },

    _hostOnData(conn, msg) {
      if (!msg) return;
      if (msg.t === 'join') {
        // 遊戲未開始才接受入座
        if (this.game) { try { conn.send({ t: 'full' }); } catch (e) {} return; }
        const seat = this.seats.length + 1; // 房主 = 0
        this.seats.push({ conn, name: msg.name || ('玩家' + seat), seat, agent: null });
        if (this.hooks.onRoster) this.hooks.onRoster(this._roster());
        this._sendLobby();
      } else if (msg.t === 'response') {
        const s = this.seats.find(x => x.conn === conn);
        if (s && s.agent) s.agent.resolveResponse(msg.reqId, msg.value);
      }
    },

    _onGuestClose(conn) {
      const s = this.seats.find(x => x.conn === conn);
      if (!s) return;
      s.connected = false;
      if (s.agent) s.agent.markDisconnected(); // 之後由 AI 接手該座位
      if (!this.game && this.hooks.onRoster) this.hooks.onRoster(this._roster());
      this._sendLobby();
    },

    _roster() {
      return [{ name: this.hostName, seat: 0, you: true }]
        .concat(this.seats.map(s => ({ name: s.name, seat: s.seat })));
    },
    _sendLobby() {
      const names = this._roster().map(r => r.name);
      this.seats.forEach(s => { try { s.conn.send({ t: 'lobby', names }); } catch (e) {} });
    },

    // 房主開始遊戲：humanSeats = 已入座客人；可加 AI 補到 numPlayers
    startGame(numPlayers, speed, mode) {
      const humans = this.seats.slice();
      const total = Math.max(2, Math.min(6, numPlayers || (1 + humans.length)));
      this.speed = speed || 800;
      this.mode = mode === 'kingdom' ? 'kingdom' : 'normal';

      const configs = [{ name: this.hostName, isHuman: true }];
      humans.forEach(s => configs.push({ name: s.name, isHuman: true }));
      const aiCount = total - configs.length;
      const personas = Coup.AIAgent.drawPersonas(aiCount); // AI 補位用具名角色
      for (let k = 0; k < aiCount; k++) {
        const pa = personas[k];
        configs.push({ name: (pa && pa.name) || ('電腦 ' + (configs.length)), isHuman: false });
      }
      this._aiPersonas = personas;

      const UI = Coup.UI;
      if (UI.game) UI.game.cancel();
      UI.myId = 0; // 房主座位
      UI.els.log.innerHTML = ''; UI.els.prompt.innerHTML = '';
      UI.els.overlay.classList.remove('show'); UI.els.overlay.innerHTML = '';

      const self = this;
      const game = new Coup.GameController(configs, {
        onLog: m => { UI.log(m); self._broadcast({ t: 'log', msg: m }); },
        onState: () => { UI.render(); self._broadcastState(game); },
        onTurn: id => { UI.currentTurn = id; UI.render(); self._broadcastState(game); },
        onGameOver: w => { UI.showWinner(w); self._broadcast({ t: 'over', winnerId: w ? w.id : null, report: game.buildReport() }); },
        pause: () => new Promise(r => setTimeout(r, self.speed))
      }, { mode: this.mode });

      game.agents[0] = UI; UI.mode = this.mode; // 房主用本地 UI
      // 已入座客人 → RemoteAgent（座位 1..n）；其餘 → AI
      humans.forEach(s => {
        const agent = new RemoteAgent(s.seat, s.conn, { fallback: new Coup.AIAgent(s.seat) });
        s.agent = agent;
        game.agents[s.seat] = agent;
      });
      let pi = 0;
      for (let i = 0; i < total; i++) {
        if (!game.agents[i]) game.agents[i] = new Coup.AIAgent(i, (this._aiPersonas && this._aiPersonas[pi++]) || undefined);
      }

      this.game = game;
      UI.game = game; UI.currentTurn = 0;
      // 告知每位客人其座位與名單，並送初始狀態
      const names = configs.map(c => c.name);
      humans.forEach(s => { try { s.conn.send({ t: 'start', myId: s.seat, names, view: serializeView(game, s.seat) }); } catch (e) {} });
      if (this.hooks.onStart) this.hooks.onStart();
      UI.render();
      game.play();
    },

    _broadcast(msg) { this.seats.forEach(s => { if (s.conn) { try { s.conn.send(msg); } catch (e) {} } }); },
    _broadcastState(game) { this.seats.forEach(s => { if (s.conn) { try { s.conn.send({ t: 'state', view: serializeView(game, s.seat) }); } catch (e) {} } }); },

    // ====================== 客人 ======================
    joinRoom(code, name, hooks) {
      this.role = 'guest';
      this.hooks = hooks || {};
      if (!this._hasPeer()) { this._err('連線元件未載入（請重新整理，並確認有網路）'); return; }
      this._joined = false;
      this.peer = new root.Peer(PEER_OPTS);
      this.peer.on('error', e => this._err(this._errText(e && e.type ? e.type : '')));
      this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (x) {} });
      this.peer.on('open', () => {
        const conn = this.peer.connect(this._peerId(code), { reliable: true });
        this.conn = conn;
        // 連線逾時提示（15 秒內若沒接上房主）
        const to = setTimeout(() => { if (!this._joined) this._err('連不上房主。請確認房號正確、房主仍在大廳；若仍失敗可換網路（例如改用手機熱點）再試。'); }, 15000);
        conn.on('open', () => {
          this._joined = true; clearTimeout(to);
          conn.send({ t: 'join', name: name || '玩家' });
          if (this.hooks.onLobbyJoined) this.hooks.onLobbyJoined();
        });
        conn.on('data', msg => this._guestOnData(conn, msg));
        conn.on('error', () => this._err('資料通道錯誤，請重試'));
        conn.on('close', () => { if (this._joined) this._err('與房主的連線中斷'); });
      });
    },

    _guestOnData(conn, msg) {
      if (!msg) return;
      const UI = Coup.UI;
      if (msg.t === 'lobby') {
        if (this.hooks.onRoster) this.hooks.onRoster((msg.names || []).map((n, i) => ({ name: n, seat: i })));
      } else if (msg.t === 'full') {
        this._err('遊戲已開始或房間已滿');
      } else if (msg.t === 'start') {
        this._applyView(msg.view);
        if (this.hooks.onStart) this.hooks.onStart();
      } else if (msg.t === 'state') {
        this._applyView(msg.view);
      } else if (msg.t === 'log') {
        UI.log(msg.msg);
      } else if (msg.t === 'private') {
        UI.logPrivate(msg.msg); // 只有這位客人會收到自己的私訊
      } else if (msg.t === 'over') {
        const w = (this.lastView && this.lastView.players) ? this.lastView.players[msg.winnerId] : null;
        UI.reportText = msg.report || ''; // 房主送來的完整戰報（遊戲已結束，可全揭露）
        // 勝者若非自己,手牌在視角中為 null（不洩漏）→ 過濾掉,過場畫面就不顯示牌面
        UI.showWinner(w ? { name: w.name, isHuman: w.id === UI.myId, cards: (w.cards || []).filter(c => c) } : null);
      } else if (msg.t === 'request') {
        this._guestHandleRequest(conn, msg);
      }
    },

    _applyView(view) {
      const UI = Coup.UI;
      this.lastView = view;
      UI.myId = view.myId;
      UI.game = view;
      UI.currentTurn = view.current;
      UI.render();
    },

    _guestHandleRequest(conn, msg) {
      const UI = Coup.UI;
      this._applyView(msg.view);
      let out;
      try {
        out = UI[msg.method].apply(UI, [msg.view].concat(msg.args || []));
      } catch (e) { out = null; }
      Promise.resolve(out).then(value => {
        try { conn.send({ t: 'response', reqId: msg.reqId, value }); } catch (e) {}
      });
    },

    // ====================== 共用 ======================
    _errText(type) {
      const map = {
        'peer-unavailable': '找不到這個房號（房主可能已關閉或房號打錯）',
        'network': '無法連到連線伺服器，請檢查網路後重試',
        'server-error': '連線伺服器忙線，請稍後再試',
        'socket-error': '網路連線中斷，請重試',
        'socket-closed': '網路連線已關閉，請重新整理再試',
        'webrtc': 'WebRTC 連線失敗（可能被防火牆/NAT 擋住，試著換網路或開手機熱點）',
        'browser-incompatible': '此瀏覽器不支援 WebRTC，請改用 Chrome/Safari 最新版',
        'ssl-unavailable': '需以 https 開啟才能連線'
      };
      return '⚠ ' + (map[type] || ('連線錯誤' + (type ? '（' + type + '）' : '')));
    },
    _err(text) { if (this.hooks && this.hooks.onError) this.hooks.onError(text); },
    leave() {
      try { if (this.conn) this.conn.close(); } catch (e) {}
      try { if (this.peer) this.peer.destroy(); } catch (e) {}
      this.peer = null; this.conn = null; this.role = null; this.seats = []; this.game = null;
    }
  };

  Coup.Net = Net;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Coup;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
