/* 初始化與開新局串接 */
(function (root) {
  'use strict';
  const Main = root.CoupMain = {
    start() {
      const n = parseInt(document.getElementById('numPlayers').value, 10);
      const speedMap = { fast: 260, normal: 620, slow: 1100 };
      const speed = speedMap[document.getElementById('speed').value] || 800;
      // 不再有難度——每個 AI 每場隨機性格
      root.Coup.UI.newGame(n, null, speed);
    }
  };

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
    // 視覺風格：塔羅（預設）/ 簡約，可記憶
    const themeSel = document.getElementById('theme');
    const applyTheme = v => document.body.classList.toggle('minimal', v === 'minimal');
    let saved = null; try { saved = localStorage.getItem('coupTheme'); } catch (e) {}
    if (saved) { themeSel.value = saved; applyTheme(saved); }
    themeSel.onchange = () => {
      applyTheme(themeSel.value);
      try { localStorage.setItem('coupTheme', themeSel.value); } catch (e) {}
    };

    Main.start(); // 一進場就開一局
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
