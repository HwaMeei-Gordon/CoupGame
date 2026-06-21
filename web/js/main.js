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
    document.getElementById('newGame').onclick = () => {
      Main.start();
      setup.classList.remove('open'); // 開新局後收起設定抽屜
    };
    Main.start(); // 一進場就開一局
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
