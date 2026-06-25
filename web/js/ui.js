/*
 * UI：渲染遊戲狀態 + 行動日誌，並實作「人類玩家」的 Agent 介面。
 * 人類決策以 Promise 回傳，由提示區按鈕點擊解析。
 */
(function (root) {
  'use strict';
  const Coup = root.Coup = root.Coup || {};
  const ZH = Coup.ZH;
  const holdsRole = Coup.holdsRole || ((cards, ch) => (cards || []).includes(ch));

  // 將 Coup 角色對應到古典塔羅大阿爾克那（羅馬數字 + 象徵）
  const ARCANA = {
    Duke:       { zh: '公爵', en: 'Duke',       arcana: '皇帝 The Emperor',      roman: 'IV',   sym: '♔' },
    Assassin:   { zh: '刺客', en: 'Assassin',   arcana: '死神 Death',           roman: 'XIII', sym: '⚔' },
    Captain:    { zh: '隊長', en: 'Captain',    arcana: '戰車 The Chariot',      roman: 'VII',  sym: '⚓' },
    Ambassador: { zh: '大使', en: 'Ambassador', arcana: '女祭司 High Priestess', roman: 'II',   sym: '☽' },
    Contessa:   { zh: '夫人', en: 'Contessa',   arcana: '女皇 The Empress',      roman: 'III',  sym: '♕' },
    King:       { zh: '國王', en: 'King',       arcana: '皇帝·王 The King',      roman: 'IV★',  sym: '👑' } // 亡國模式：公爵變體
  };
  const imgRole = ch => (ch === 'King' ? 'Duke' : ch); // 國王沿用公爵畫像（疊王冠標記）

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
    myId: 0, // 「我」在這場的座位 id（單機=0；連線時房主=0、客人=各自座位）

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
      // 濾波噪聲：刀刃／碎裂等質感（from→to 為濾波掃頻）
      noise(dur, o) {
        if (this.muted) return;
        const c = this.ensure(); if (!c) return;
        try {
          o = o || {};
          const len = Math.max(1, Math.floor(c.sampleRate * dur));
          const buf = c.createBuffer(1, len, c.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
          const src = c.createBufferSource(); src.buffer = buf;
          const f = c.createBiquadFilter();
          f.type = o.type || 'bandpass'; f.Q.value = o.q != null ? o.q : 1;
          const g = c.createGain(); const t = c.currentTime;
          f.frequency.setValueAtTime(o.from || 2000, t);
          if (o.to != null) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t + dur);
          g.gain.setValueAtTime(o.gain || 0.06, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          src.connect(f); f.connect(g); g.connect(c.destination);
          src.start(t); src.stop(t + dur + 0.02);
        } catch (e) { /* 音效失敗不影響遊戲 */ }
      },
      buzz(p) { try { if (typeof navigator !== 'undefined' && navigator.vibrate && !this.muted) navigator.vibrate(p); } catch (e) {} },
      turn()      { this.tone(660, 0.12, 'sine', 0.05); this.buzz(25); },
      challenge() { this.tone(247, 0.16, 'sawtooth', 0.05); this.buzz(35); },
      // 隨從殞落：低沉崩塌 + 一抹碎裂
      death()     { this.tone(140, 0.26, 'sawtooth', 0.05); this.noise(0.22, { type: 'lowpass', from: 1400, to: 300, q: 0.6, gain: 0.05 }); this.buzz([25, 35, 55]); },
      win()  { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'sine', 0.06), i * 110)); this.buzz([20, 40, 20, 40, 90]); },
      lose() { [392, 294, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.26, 'sine', 0.05), i * 150)); this.buzz(140); },
      // 暗殺命中：刀刃劃過（高頻噪聲快速下掃 + 金屬殘響）
      slash() {
        this.noise(0.16, { type: 'bandpass', from: 4200, to: 700, q: 0.7, gain: 0.11 });
        this.tone(520, 0.05, 'sawtooth', 0.035);
        setTimeout(() => this.tone(300, 0.07, 'sawtooth', 0.03), 45);
        this.buzz([12, 24, 12]);
      },
      // 政變：崩裂（低頻撞擊 + 玻璃／石塊碎裂顆粒）
      shatter() {
        this.tone(90, 0.18, 'sawtooth', 0.06);
        this.tone(58, 0.30, 'sine', 0.05);
        this.noise(0.30, { type: 'highpass', from: 800, to: 3200, q: 0.8, gain: 0.07 });
        for (let i = 0; i < 4; i++) {
          setTimeout(() => this.noise(0.08, { type: 'bandpass', from: 1600 + Math.random() * 2600, to: 600, q: 2.2, gain: 0.05 }), 55 + i * 50);
        }
        this.buzz([30, 40, 60]);
      },
      // 金幣入袋：數枚明亮金屬叮噹（big=大額多聲；小額單聲）
      coins(big) {
        const n = big ? 4 : 1;
        for (let i = 0; i < n; i++) {
          setTimeout(() => {
            const f = 1700 + Math.random() * 900;
            this.tone(f, 0.08, 'triangle', 0.04);
            this.tone(f * 1.5, 0.05, 'sine', 0.02); // 泛音添金屬感
          }, i * 55);
        }
        this.buzz(big ? [10, 20] : 8);
      },
      // 洗牌：連續的短促摩擦聲（牌的洗動感）
      shuffle() {
        for (let i = 0; i < 5; i++) setTimeout(() => this.noise(0.05, { type: 'bandpass', from: 2600 + Math.random() * 1400, to: 900, q: 1.4, gain: 0.03 }), i * 45);
        this.buzz(12);
      },
      fromLog(m) {
        if (m.indexOf('🗡️') >= 0) this.slash();              // 暗殺命中 → 刀砍
        else if (m.indexOf('🎯') >= 0) this.shatter();        // 政變 → 裂開
        else if (m.indexOf('💥') >= 0 || m.indexOf('☠️') >= 0) this.death();
        else if (m.indexOf('❓') >= 0 || m.indexOf('🛡️') >= 0) this.challenge();
        else if (m.indexOf('洗回命運之輪') >= 0 || m.indexOf('換上新的面孔') >= 0) this.shuffle(); // 洗牌
        if (m.indexOf('💰') >= 0) this.coins(m.indexOf('+1（') < 0); // 拿到錢 → 金幣碰撞(收入單聲,其餘多聲)
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
        else if (m.indexOf('🎯') >= 0) this.spawn('fx-crack', 600);   // 政變：畫面裂開
        else if (m.indexOf('🛡️') >= 0) this.spawn('fx-shield', 750);
        else if (m.indexOf('課得賦稅') >= 0 || m.indexOf('援助悄然入袋') >= 0) this.spawn('fx-gold', 800);
        else if (m.indexOf('❓') >= 0) this.spawn('fx-crack', 500);
        else if (m.indexOf('☠️') >= 0) this.spawn('fx-dark', 800);
      }
    },

    // 中世紀宮廷氛圍音樂：程序合成（無需音檔，單檔自含）。
    // 低音風笛式持續音(drone) + 琉特琴分解和弦 + 直笛旋律 + 小手鼓，D Dorian 調式。
    music: {
      ctx: null, master: null, playing: false, step: 0, nextT: 0, timer: null,
      droneNodes: null, bpm: 80, vol: 0.15,
      mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); },
      // 4 小節 × 八分音符 = 32 步。和弦根音：Dm · C · Dm · G（Dorian 調式色彩）
      chordRoots: [50,50,50,50,50,50,50,50, 48,48,48,48,48,48,48,48,
                   50,50,50,50,50,50,50,50, 55,55,55,55,55,55,55,55],
      // 直笛旋律（稀疏，null = 休止），D Dorian
      melody: [69,null,74,null, 72,null,69,null, 67,null,64,null, 67,null,null,null,
               65,null,69,null, 67,null,65,null, 64,null,62,null, null,null,null,null],
      ensure(ctx) {
        this.ctx = ctx;
        if (!this.master) {
          this.master = ctx.createGain();
          this.master.gain.value = 0.0;
          this.master.connect(ctx.destination);
        }
      },
      start(ctx) {
        if (this.playing || !ctx) return;
        this.ensure(ctx);
        this.playing = true; this.step = 0; this.nextT = ctx.currentTime + 0.15;
        const g = this.master.gain, t = ctx.currentTime;
        g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t);
        g.linearRampToValueAtTime(this.vol, t + 3.0); // 緩緩浮現
        this.startDrone();
        this.loop();
      },
      stop() {
        this.playing = false;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.stopDrone();
      },
      setMuted(m) {
        if (!this.ctx || !this.master) return;
        const g = this.master.gain, t = this.ctx.currentTime;
        g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(m ? 0.0 : this.vol, t + 0.5);
      },
      startDrone() {
        const c = this.ctx; if (!c) return;
        this.stopDrone();
        this.droneNodes = [38, 45].map(m => { // D2 + A2 完全五度持續音
          const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
          o.type = 'sawtooth'; o.frequency.value = this.mtof(m);
          f.type = 'lowpass'; f.frequency.value = 430; f.Q.value = 0.6;
          g.gain.value = 0.05;
          o.connect(f); f.connect(g); g.connect(this.master); o.start();
          return { o, g };
        });
      },
      stopDrone() {
        if (this.droneNodes) { this.droneNodes.forEach(n => { try { n.o.stop(); } catch (e) {} }); this.droneNodes = null; }
      },
      pluck(midi, t, dur, gain) { // 琉特琴撥弦
        const c = this.ctx; if (!c) return;
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'triangle'; o.frequency.value = this.mtof(midi);
        o.connect(g); g.connect(this.master);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t); o.stop(t + dur + 0.03);
      },
      reed(midi, t, dur, gain) { // 直笛/簧管旋律（基音 + 弱八度泛音）
        const c = this.ctx; if (!c) return;
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = this.mtof(midi);
        const o2 = c.createOscillator(), g2 = c.createGain();
        o2.type = 'triangle'; o2.frequency.value = this.mtof(midi) * 2; g2.gain.value = 0.10;
        o2.connect(g2); g2.connect(g); o.connect(g); g.connect(this.master);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.06);
        g.gain.setValueAtTime(gain, t + dur * 0.65);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t); o.stop(t + dur + 0.05); o2.start(t); o2.stop(t + dur + 0.05);
      },
      tabor(t, gain) { // 小手鼓
        const c = this.ctx; if (!c) return;
        const dur = 0.12, buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
        const src = c.createBufferSource(); src.buffer = buf;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 170; f.Q.value = 1.1;
        const g = c.createGain(); g.gain.value = gain;
        src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
      },
      loop() {
        if (!this.playing || !this.ctx) return;
        const c = this.ctx, stepDur = (60 / this.bpm) / 2;
        while (this.nextT < c.currentTime + 0.25) {
          const s = this.step % 32, root = this.chordRoots[s];
          // 大三和弦(C, G 小節) vs 小三和弦(Dm 小節)
          const major = (s >= 8 && s < 16) || (s >= 24 && s < 32);
          const tones = [root, root + (major ? 4 : 3), root + 7, root + 12];
          this.pluck(tones[this.step % tones.length], this.nextT, stepDur * 1.7, 0.045);
          const mel = this.melody[s];
          if (mel != null) this.reed(mel, this.nextT, stepDur * 1.9, 0.055);
          if (s % 4 === 0) this.tabor(this.nextT, s % 8 === 0 ? 0.05 : 0.03);
          this.step++; this.nextT += stepDur;
        }
        this.timer = setTimeout(() => this.loop(), 60);
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
    newGame(numPlayers, speed, mode) {
      if (this.game) this.game.cancel(); // 終止上一局，避免並行
      this.myId = 0; // 單機：你是 player 0
      this.reportText = ''; // 清除上一局戰報
      this.mode = mode === 'kingdom' ? 'kingdom' : 'normal';
      this.speed = speed;
      this.els.log.innerHTML = '';
      this.els.prompt.innerHTML = '';
      this.els.overlay.classList.remove('show');
      this.els.overlay.innerHTML = '';

      // 每場隨機配發不重複的具名角色給 AI 座位（名稱即玩家名）
      const personas = Coup.AIAgent.drawPersonas(numPlayers - 1);
      const configs = [{ name: '你', isHuman: true }];
      for (let i = 1; i < numPlayers; i++) {
        const pa = personas[i - 1];
        configs.push({ name: (pa && pa.name) || ('電腦 ' + i), isHuman: false });
      }

      const game = new Coup.GameController(configs, {
        onLog: (m) => this.log(m),
        onState: () => this.render(),
        onTurn: (id) => { this.currentTurn = id; this.render(); },
        onGameOver: (w) => this.showWinner(w),
        pause: () => new Promise(r => setTimeout(r, this.speed))
      }, { mode: this.mode });
      game.agents[0] = this; // 人類 = 本 UI（實作 Agent 介面）
      for (let i = 1; i < numPlayers; i++) game.agents[i] = new Coup.AIAgent(i, personas[i - 1]);

      this.game = game;
      this.currentTurn = 0;
      this.render();
      game.play();
    },

    log(msg) {
      const div = document.createElement('div');
      div.className = 'log-line' + this.logClass(msg);
      div.textContent = msg;
      const box = this.els.log;
      // 最新訊息置頂(越上面越新)
      if (typeof box.prepend === 'function') box.prepend(div);
      else if (typeof box.insertBefore === 'function') box.insertBefore(div, box.firstChild || null);
      else box.appendChild(div);
      box.scrollTop = 0;
      this.fb.fromLog(msg);
      this.fx.fromLog(msg);
      this.showPhantom(msg);
      this.showReveal(msg);
    },

    // 私密訊息：只在本機顯示成獨立的框（🔒 只有你看得到）。永不進共享歷程、永不廣播。
    // 由引擎 notifyPrivate 經 agent.privateNote 呼叫（人類=本 UI；連線時各客人各自顯示）。
    privateNote(_game, msg) { this.logPrivate(msg); },
    logPrivate(msg) {
      if (!this.els || !this.els.log) return;
      const div = document.createElement('div');
      div.className = 'log-line log-private';
      div.textContent = '🔒 ' + msg;
      const box = this.els.log;
      if (typeof box.prepend === 'function') box.prepend(div);
      else if (typeof box.insertBefore === 'function') box.insertBefore(div, box.firstChild || null);
      else box.appendChild(div);
      box.scrollTop = 0;
    },

    // 質疑為真：該角色牌在中央 3D 翻開,爆發專屬色光芒
    showReveal(msg) {
      if (typeof document === 'undefined' || msg.indexOf('亮出真正的') < 0) return;
      const m = msg.match(/(King|Duke|Assassin|Captain|Ambassador|Contessa)/);
      const stage = document.getElementById('stage');
      if (!m || !stage || typeof stage.appendChild !== 'function') return;
      const wrap = document.createElement('div');
      if (!wrap || !('className' in wrap)) return;
      wrap.className = 'reveal ' + m[1];
      wrap.innerHTML = '<div class="reveal-burst"></div>' + this.cardEl(m[1], true, false);
      stage.appendChild(wrap);
      setTimeout(() => { try { wrap.remove(); } catch (e) {} }, 1900);
    },

    // 宣告/反制時,中央桌面浮現該角色的塔羅牌幻影
    showPhantom(msg) {
      if (typeof document === 'undefined') return;
      if (msg.indexOf('披上') < 0 && msg.indexOf('之名') < 0) return;
      const m = msg.match(/(Duke|Assassin|Captain|Ambassador|Contessa)/);
      const stage = document.getElementById('stage');
      if (!m || !stage || typeof stage.appendChild !== 'function') return;
      const wrap = document.createElement('div');
      if (!wrap || !('className' in wrap)) return;
      wrap.className = 'phantom';
      wrap.innerHTML = this.cardEl(m[1], true, false);
      stage.appendChild(wrap);
      setTimeout(() => { try { wrap.remove(); } catch (e) {} }, 1700);
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
      const a = ARCANA[ch] || ARCANA.Duke;
      return `<div class="card ${ch} ${lost ? 'lost' : ''}">
        <img class="card-img" src="cards/${imgRole(ch)}.webp" alt="${a.zh} ${a.en}" draggable="false" />
        ${ch === 'King' ? '<div class="king-crown">👑 國王</div>' : ''}
        ${lost ? `<div class="card-deceased">DECEASED<span>${a.roman}</span></div>` : ''}
      </div>`;
    },

    // 對手小卡（牌背 / 已攤開的死牌——用與玩家相同的塔羅插畫，方便辨識）
    miniCard(ch, lost) {
      if (!lost) return '<div class="mini back"></div>';
      const a = ARCANA[ch] || ARCANA.Duke;
      return `<div class="mini lost ${ch}" title="${a.zh} ${a.en}（死牌）">
        <img class="mini-img" src="cards/${imgRole(ch)}.webp" alt="${a.zh} ${a.en}" draggable="false" />
        ${ch === 'King' ? '<span class="mini-crown">👑</span>' : ''}
        <span class="mini-x">✕</span></div>`;
    },

    // 對手座位卡（精簡：名稱 / 金幣 / 影響力小卡）；可點擊查看宣示紀錄
    oppEl(p) {
      const cls = ['opp'];
      if (this.currentTurn === p.id && p.alive) cls.push('current');
      if (!p.alive) cls.push('dead');
      const minis = p.cards.map(() => this.miniCard(null, false)).join('') +
                    p.lost.map(c => this.miniCard(c, true)).join('');
      const n = (p.timeline || []).length;
      return `<div class="${cls.join(' ')}" data-pid="${p.id}" title="點擊查看 ${p.name} 的底細（宣示與換牌紀錄）">
        <div class="opp-head"><span class="opp-name">${p.name}</span>
          <span class="opp-coin">🪙 ${p.coins}</span></div>
        <div class="opp-cards">${minis}</div>
        <div class="opp-inf"><span>${p.alive ? '影響 ' + p.cards.length : '出局'}</span><span class="opp-claims">🔍 紀錄 ${n}</span></div>
      </div>`;
    },

    // 點對手 → 彈出他的「底細」：已亮出的死牌 + 公開紀錄(宣示/換牌,越上面越新)
    showClaims(pid) {
      const p = this.game.players[pid];
      if (!p) return;
      // 已公開的死牌（與玩家相同的插畫）
      const dead = (p.lost || []).length
        ? `<div class="rec-dead"><div class="rec-dead-lab">已亮出的死牌</div>
            <div class="rec-dead-cards">${p.lost.map(c => this.miniCard(c, true)).join('')}</div></div>`
        : '';
      // 公開事件流（宣示 / 證實換牌 / 大使換牌）
      const tl = (p.timeline || []).slice().reverse();
      const items = tl.length
        ? tl.map(ev => {
            const ch = ev.ch;
            const a = ARCANA[ch] || { zh: '', en: '' };
            const img = `<img class="rec-img" src="cards/${ch}.webp" alt="${a.zh}" draggable="false" />`;
            let tag, sub;
            if (ev.kind === 'swap') { tag = '🔀 被質疑→證實後換牌'; sub = `亮出真【${a.zh} ${a.en}】，已洗回換新牌`; }
            else if (ev.kind === 'exchange') { tag = '🔄 大使換牌'; sub = '與命運之輪交換手牌'; }
            else { tag = '🗣️ 宣示角色'; sub = `宣稱【${a.zh} ${a.en}】（真偽未知）`; }
            return `<div class="rec-item ${ch} k-${ev.kind}">${img}
              <div class="rec-tx"><b>${tag}</b><small>${sub}</small></div></div>`;
          }).join('')
        : '<div class="claim-empty">尚無任何公開紀錄</div>';
      this.els.overlay.innerHTML =
        `<div class="claims-box">
          <button class="win-close" aria-label="關閉">✕</button>
          <div class="claims-title">${p.name} 的底細</div>
          <div class="claims-sub">${p.alive ? '影響 ' + p.cards.length : '已出局'} · 🪙 ${p.coins} · 公開紀錄共 ${tl.length} 筆（越上面越新）</div>
          ${dead}
          <div class="claims-list">${items}</div>
        </div>`;
      this.els.overlay.classList.add('show');
      const close = this.els.overlay.querySelector('.win-close');
      const hide = () => { this.els.overlay.classList.remove('show'); this.els.overlay.innerHTML = ''; };
      if (close) close.onclick = hide;
      this.els.overlay.onclick = (e) => { if (e.target === this.els.overlay) hide(); };
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
      // 對手卡可點:看宣示紀錄
      if (typeof this.els.opponents.querySelectorAll === 'function') {
        this.els.opponents.querySelectorAll('.opp').forEach(el => {
          el.onclick = () => this.showClaims(+el.dataset.pid);
        });
      }
      this.els.me.innerHTML = g.players
        .filter(p => p.isHuman).map(p => this.meEl(p)).join('');
      const cur = g.players[this.currentTurn];
      this.els.statusbar.innerHTML =
        `<span class="sb-mode">${g.mode === 'kingdom' ? '👑 亡國' : '⚔ 一般'}</span>` +
        `<span class="sb-deck">❖ 牌庫 ${g.deck.length}</span>` +
        `<span class="sb-turn">${g.over ? '🏁 遊戲結束' : '🎲 ' + (cur ? cur.name : '') + ' 的回合'}</span>`;
    },

    showWinner(w) {
      const isMe = w && w.isHuman;
      this.fb[isMe ? 'win' : 'lose']();
      const hand = (w && w.cards && w.cards.length)
        ? `<div class="win-sub">勝者手牌</div><div class="win-cards">${w.cards.map(c => this.cardEl(c, true, false)).join('')}</div>`
        : '';
      // 完整戰報（上帝視角）：單機由本機引擎產生；連線由房主送來存於 this.reportText
      const report = this.reportText ||
        (this.game && typeof this.game.buildReport === 'function' ? this.game.buildReport() : '');
      const reportBtn = report ? `<button class="pbtn copy-report" id="copyReportBtn">📋 複製完整戰報</button>` : '';
      this.els.overlay.innerHTML =
        `<div class="win-box ${isMe ? 'win' : 'lose'}">
          <button class="win-close" aria-label="關閉以回看過程">✕</button>
          <div class="win-title">${isMe ? '🎉 你獲勝了！' : '💀 你被淘汰了'}</div>
          <div class="win-sub">勝者：${w ? w.name : '無'}</div>
          ${hand}
          <button id="againBtn" class="pbtn act">再來一局</button>
          ${reportBtn}
          <button class="win-review" aria-label="回看過程">🔍 回看這局過程</button>
          <div class="report-msg" id="reportMsg"></div>
        </div>`;
      this.els.overlay.classList.add('show');
      const start = () => root.CoupMain.start();
      const btn = document.getElementById('againBtn');
      if (btn) btn.onclick = start;
      const rb = document.getElementById('copyReportBtn');
      if (rb) rb.onclick = () => this.copyReport(report);
      // 關閉遮罩以回看牌局/日誌;底部留一顆持久的「再來一局」
      const dismiss = () => {
        this.els.overlay.classList.remove('show');
        this.els.overlay.innerHTML = '';
        this.els.prompt.innerHTML =
          `<div class="prompt-btns"><button class="pbtn act wide" id="restartBtn">🔄 再來一局</button></div>`;
        const r = document.getElementById('restartBtn');
        if (r) r.onclick = start;
      };
      const closeBtn = this.els.overlay.querySelector('.win-close');
      const reviewBtn = this.els.overlay.querySelector('.win-review');
      if (closeBtn) closeBtn.onclick = dismiss;
      if (reviewBtn) reviewBtn.onclick = dismiss;
    },

    // 複製完整戰報到剪貼簿；失敗則顯示可手動選取複製的文字框
    copyReport(text) {
      const note = t => { const m = document.getElementById('reportMsg'); if (m) m.textContent = t; };
      const fallback = () => {
        // 顯示可長按/選取複製的文字框
        const box = this.els.overlay.querySelector('.win-box') || this.els.overlay;
        let ta = box.querySelector('.report-ta');
        if (!ta) {
          ta = document.createElement('textarea');
          ta.className = 'report-ta';
          box.appendChild(ta);
        }
        ta.value = text;
        ta.readOnly = false;
        ta.focus(); ta.select();
        try { document.execCommand('copy'); note('已複製！（或長按上方文字全選複製）'); }
        catch (e) { note('請長按文字框全選後複製'); }
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => note('✅ 已複製完整戰報到剪貼簿'), fallback);
        } else { fallback(); }
      } catch (e) { fallback(); }
    },

    // ---------- 提示工具 ----------
    prompt(title, buttons, btnsClass) {
      return new Promise(resolve => {
        const el = this.els.prompt;
        el.innerHTML = `<div class="prompt-title">${title}</div>` +
          `<div class="prompt-btns ${btnsClass || ''}">` +
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
      const me = game.players[this.myId];
      const opps = game.players.filter(p => p.alive && p.id !== this.myId);
      const forced = me.coins >= 10;
      const defs = [
        { type: 'income',      ic: '＋', name: '收入', sub: '+1 金幣',   ok: !forced, role: '' },
        { type: 'foreign_aid', ic: '🤝', name: '外援', sub: '+2 金幣',   ok: !forced, role: '' },
        { type: 'tax',         ic: '♔', name: '課稅', sub: '公爵 · +3',  ok: !forced, role: 'Duke' },
        { type: 'steal',       ic: '⚓', name: '偷竊', sub: '隊長 · 偷2', ok: !forced && opps.length > 0, role: 'Captain' },
        { type: 'exchange',    ic: '☽', name: '換牌', sub: '大使',       ok: true, role: 'Ambassador' },
        { type: 'assassinate', ic: '⚔', name: '暗殺', sub: '刺客 · 付3', ok: me.coins >= 3 && opps.length > 0, role: 'Assassin' },
        { type: 'coup',        ic: '🎯', name: '政變', sub: '付7',        ok: me.coins >= 7 && opps.length > 0, role: '' }
      ];
      const buttons = defs.map(d => ({
        label: `<span class="b-ic">${d.ic}</span><span class="b-tx"><b>${d.name}</b><small>${d.sub}</small></span>`,
        value: d.type, disabled: !d.ok, cls: 'actbtn' + (d.role ? ' r-' + d.role : '')
      }));
      const title = forced ? '你有 10+ 金幣：只能 政變／暗殺／換牌' : '輪到你了，選擇一個行動：';
      const type = await this.prompt(title, buttons, 'grid4');

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
      if (claimantId === this.myId) return false;
      const claimant = game.players[claimantId];
      let visible = 0;
      game.players.forEach(p => p.lost.forEach(c => { if (c === character) visible++; }));
      const scales = `<div class="scales"><svg class="scales-svg" viewBox="0 0 60 40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M30 7V31M21 33h18"/><g class="beam"><path d="M11 9h38"/><path d="M11 9l-4.5 8a6.5 3 0 0 0 9 0z"/><path d="M49 9l-4.5 8a6.5 3 0 0 0 9 0z"/></g><circle cx="30" cy="9" r="1.6" fill="currentColor"/></svg></div>`;
      const title = scales + `${claimant.name} 宣稱【${ZH[character]} ${character}】。命運的天秤正在搖晃——是否質疑？` +
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
      const me = game.players[this.myId];
      const actor = game.players[action.actorId];

      if (action.type === 'foreign_aid') {
        const hasDuke = holdsRole(me.cards, 'Duke');
        const title = hasDuke
          ? `${actor.name} 想拿外援，要用【公爵 Duke】阻擋嗎？`
          : `${actor.name} 想拿外援。要宣稱【公爵 Duke】阻擋嗎？` +
            `<br><small>你沒有公爵 → 這是詐唬，被質疑拆穿會失去一張影響力</small>`;
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
        const zh = c => (ARCANA[c] ? ARCANA[c].zh + ' ' + c : c);
        document.body.classList.add('exchanging'); // 換牌時隱藏原本手牌、放大選牌區
        // 私密告知：這次抽到了哪些牌（只有你看得到）
        if (Array.isArray(drawn) && drawn.length) this.logPrivate('大使換牌——你抽到：' + drawn.map(zh).join('、'));
        const finish = result => {
          document.body.classList.remove('exchanging');
          el.innerHTML = '';
          // 私密告知：你最後保留了哪些牌
          if (Array.isArray(result) && result.length) this.logPrivate('大使換牌——你保留：' + result.map(zh).join('、'));
          resolve(result);
        };
        const redraw = () => {
          el.innerHTML =
            `<div class="prompt-title">大使交換：選擇保留 ${keep} 張（已選 ${sel.size}）</div>` +
            `<div class="exchange">` + pool.map((c, i) => {
              const a = ARCANA[c];
              return `<button class="card ${c} ${sel.has(i) ? 'picked' : ''}" data-i="${i}">` +
                `<img class="card-img" src="cards/${c}.webp" alt="${a.zh} ${a.en}" draggable="false" /></button>`;
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
            finish([...sel].map(i => pool[i]));
          };
        };
        redraw();
      });
    }
  };

  Coup.UI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
