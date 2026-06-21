/* 初始化與開新局串接 */
(function (root) {
  'use strict';
  const Main = root.CoupMain = {
    start() {
      const n = parseInt(document.getElementById('numPlayers').value, 10);
      const diff = document.getElementById('difficulty').value;
      const speedMap = { fast: 350, normal: 800, slow: 1400 };
      const speed = speedMap[document.getElementById('speed').value] || 800;
      root.Coup.UI.newGame(n, diff, speed);
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    root.Coup.UI.init();
    const setup = document.getElementById('setup');
    document.getElementById('settingsToggle').onclick = () => setup.classList.toggle('open');

    // 音效 / 觸覺：首次互動時解鎖 AudioContext;標題列可一鍵靜音
    const fb = root.Coup.UI.fb;
    document.addEventListener('pointerdown', () => fb.ensure(), { once: true });
    const mute = document.getElementById('muteToggle');
    mute.onclick = () => {
      fb.muted = !fb.muted;
      mute.textContent = fb.muted ? '🔇' : '🔊';
      if (!fb.muted) { fb.ensure(); fb.tone(660, 0.1, 'sine', 0.05); }
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
