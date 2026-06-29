/* 初始化、開新局串接、連線對戰大廳 */
(function (root) {
  'use strict';
  const SPEEDS = { fast: 260, normal: 620, slow: 1100 };
  const Main = root.CoupMain = {
    _spectate: false,
    start() {
      const n = parseInt(document.getElementById('numPlayers').value, 10);
      const speed = SPEEDS[document.getElementById('speed').value] || 800;
      const modeEl = document.getElementById('mode');
      const mode = modeEl ? modeEl.value : 'normal';
      root.Coup.UI.newGame(n, speed, mode, this._spectate);
    }
  };

  // ---------- 連線對戰大廳 ----------
  function makeLobby() {
    const UI = root.Coup.UI, Net = root.Coup.Net;
    const ov = () => UI.els.overlay;
    const speedVal = () => ({ fast: 260, normal: 620, slow: 1100 })[document.getElementById('speed').value] || 800;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function show(html) { const o = ov(); o.innerHTML = '<div class="lobby-box">' + html + '</div>'; o.classList.add('show'); wireClose(); }
    function close() { const o = ov(); o.classList.remove('show'); o.innerHTML = ''; }
    function wireClose() { const b = ov().querySelector('.lb-close'); if (b) b.onclick = () => { try { Net.leave(); } catch (e) {} close(); }; }
    function msg(t) { const m = ov().querySelector('#lbMsg'); if (m) m.textContent = t || ''; }
    function rosterHTML(list) {
      return '<div class="lb-roster-t">座上玩家（' + list.length + '）</div><div class="lb-roster">' +
        list.map(r => '<span class="lb-seat">👤 ' + esc(r.name) + (r.you ? '（你）' : '') + '</span>').join('') + '</div>';
    }

    function open() {
      show(
        '<button class="lb-close" aria-label="關閉">✕</button>' +
        '<div class="lobby-title">🌐 連線對戰</div>' +
        '<label class="lobby-field">你的暱稱<input id="lbName" maxlength="8" placeholder="例如：阿明" /></label>' +
        '<button class="pbtn act wide" id="lbCreate">建立房間（當房主）</button>' +
        '<div class="lobby-or">— 或 —</div>' +
        '<div class="lobby-join"><input id="lbCode" maxlength="5" placeholder="輸入房號" autocapitalize="characters" />' +
        '<button class="pbtn" id="lbJoin">加入</button></div>' +
        '<div class="lobby-hint">建立房間後把房號給朋友；朋友輸入房號加入。不足的座位由電腦補。<br>※ 需要網路連線。</div>' +
        '<div class="lobby-msg" id="lbMsg"></div>'
      );
      const nameEl = ov().querySelector('#lbName');
      ov().querySelector('#lbCreate').onclick = () => hostFlow((nameEl.value || '房主').trim());
      ov().querySelector('#lbJoin').onclick = () => {
        const code = (ov().querySelector('#lbCode').value || '').trim();
        if (!code) { msg('請輸入房號'); return; }
        guestFlow(code, (nameEl.value || '玩家').trim());
      };
    }

    function hostFlow(name) {
      show(
        '<button class="lb-close" aria-label="關閉">✕</button>' +
        '<div class="lobby-title">建立房間中…</div><div class="lobby-msg" id="lbMsg">連線中，請稍候</div>'
      );
      Net.createRoom(name, {
        onError: t => msg(t),
        onCode: code => renderHost(code, [{ name: name, you: true }]),
        onRoster: list => { const r = ov().querySelector('#lbRoster'); if (r) r.outerHTML = '<div id="lbRoster">' + rosterHTML(list) + '</div>'; }
      });
    }

    function renderHost(code, list) {
      show(
        '<button class="lb-close" aria-label="關閉">✕</button>' +
        '<div class="lobby-title">房間已建立</div>' +
        '<div class="lb-code">房號 <b>' + esc(code) + '</b> <button class="pbtn small" id="lbCopy">複製</button></div>' +
        '<div class="lobby-sub">把房號給朋友，等他們加入後按開始</div>' +
        '<div id="lbRoster">' + rosterHTML(list) + '</div>' +
        '<label class="lobby-field">總人數<select id="lbTotal">' +
          [2, 3, 4, 5, 6].map(n => '<option value="' + n + '"' + (n === 4 ? ' selected' : '') + '>' + n + ' 人</option>').join('') +
        '</select>（不足由電腦補）</label>' +
        '<button class="pbtn act wide" id="lbStart">開始遊戲</button>' +
        '<div class="lobby-msg" id="lbMsg"></div>'
      );
      ov().querySelector('#lbCopy').onclick = () => {
        try { navigator.clipboard.writeText(code); msg('已複製房號 ' + code); } catch (e) { msg('房號：' + code); }
      };
      ov().querySelector('#lbStart').onclick = () => {
        const modeEl = document.getElementById('mode');
        Net.startGame(parseInt(ov().querySelector('#lbTotal').value, 10), speedVal(), modeEl ? modeEl.value : 'normal');
        close();
      };
    }

    function guestFlow(code, name) {
      show(
        '<button class="lb-close" aria-label="關閉">✕</button>' +
        '<div class="lobby-title">加入房間 ' + esc(code.toUpperCase()) + '…</div>' +
        '<div id="lbRoster"></div><div class="lobby-msg" id="lbMsg">連線中，請稍候</div>'
      );
      Net.joinRoom(code, name, {
        onError: t => msg(t),
        onLobbyJoined: () => msg('已連上，等待房主開始…'),
        onRoster: list => { const r = ov().querySelector('#lbRoster'); if (r) r.innerHTML = rosterHTML(list); },
        onStart: () => close() // 房主開始 → 收起大廳，棋盤接管
      });
    }

    return { open };
  }

  document.addEventListener('DOMContentLoaded', () => {
    root.Coup.UI.init();
    const setup = document.getElementById('setup');
    document.getElementById('settingsToggle').onclick = () => setup.classList.toggle('open');

    // 音效 / 音樂 / 觸覺：首次互動時解鎖 AudioContext 並奏起中世紀宮廷樂;標題列可一鍵靜音
    const fb = root.Coup.UI.fb;
    const music = root.Coup.UI.music;
    document.addEventListener('pointerdown', () => {
      const ctx = fb.ensure();
      if (ctx && !fb.muted) music.start(ctx); // 自動播放政策：須首次手勢後才能發聲
    }, { once: true });
    const mute = document.getElementById('muteToggle');
    mute.onclick = () => {
      fb.muted = !fb.muted;
      mute.textContent = fb.muted ? '🔇' : '🔊';
      const ctx = fb.ensure();
      music.setMuted(fb.muted);
      if (!fb.muted) {
        if (ctx) music.start(ctx); // 若尚未開始(例如一進場就先按)則啟動
        fb.tone(660, 0.1, 'sine', 0.05);
      }
    };
    document.getElementById('newGame').onclick = () => {
      Main.start();
      setup.classList.remove('open'); // 開新局後收起設定抽屜
    };
    // 連線對戰
    const lobby = makeLobby();
    document.getElementById('onlineBtn').onclick = () => { lobby.open(); setup.classList.remove('open'); };

    // 視覺風格：塔羅（預設）/ 簡約，可記憶
    const themeSel = document.getElementById('theme');
    const applyTheme = v => document.body.classList.toggle('minimal', v === 'minimal');
    let saved = null; try { saved = localStorage.getItem('coupTheme'); } catch (e) {}
    if (saved) { themeSel.value = saved; applyTheme(saved); }
    themeSel.onchange = () => {
      applyTheme(themeSel.value);
      try { localStorage.setItem('coupTheme', themeSel.value); } catch (e) {}
    };

    // ---------- 首頁 ----------
    const home = document.getElementById('home');
    const homeModes = home.querySelectorAll('.mode-opt');
    homeModes.forEach(btn => {
      btn.onclick = () => { homeModes.forEach(b => b.classList.remove('selected')); btn.classList.add('selected'); };
    });
    const selectedMode = () => {
      const sel = home.querySelector('.mode-opt.selected');
      return sel ? sel.getAttribute('data-mode') : 'normal';
    };
    const showHome = () => {
      if (root.Coup.UI.game) root.Coup.UI.game.cancel(); // 停掉背景對局
      home.style.display = 'flex';
    };
    const enterGame = (spectate) => {
      // 把首頁選擇同步到遊戲內設定，套用主題，開始
      const mode = selectedMode();
      document.getElementById('numPlayers').value = document.getElementById('homeNum').value;
      document.getElementById('speed').value = document.getElementById('homeSpeed').value;
      const t = document.getElementById('homeTheme').value;
      document.getElementById('theme').value = t; applyTheme(t);
      try { localStorage.setItem('coupTheme', t); } catch (e) {}
      document.getElementById('mode').value = mode;
      home.style.display = 'none';
      Main._spectate = !!spectate;
      Main.start();
    };
    document.getElementById('homeStart').onclick = () => enterGame(false);
    const specBtn = document.getElementById('homeSpectate');
    if (specBtn) specBtn.onclick = () => enterGame(true);
    document.getElementById('homeOnline').onclick = () => { home.style.display = 'none'; lobby.open(); };
    const kBtn = document.getElementById('homeKingdom');
    if (kBtn) kBtn.onclick = () => {
      const n = parseInt(document.getElementById('homeNum').value, 10) || 4;
      const speed = SPEEDS[document.getElementById('homeSpeed').value] || 700;
      home.style.display = 'none';
      if (root.Coup.Kingdom && root.Coup.Kingdom.UI) root.Coup.Kingdom.UI.start(Math.max(4, n), speed);
    };
    document.getElementById('homeBtn').onclick = () => { setup.classList.remove('open'); showHome(); };
    // 套用首頁記憶的主題（與遊戲內一致）
    if (saved) { try { document.getElementById('homeTheme').value = saved; } catch (e) {} }
    // 進場停在首頁（不自動開局）
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
