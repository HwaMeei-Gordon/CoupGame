/*
 * UI 無頭煙霧測試：用最小 DOM mock + 自動作答的人類代理，
 * 跑完整一局（人類=自動點第一個可用選項），驗證 render() / 人類 Agent 路徑不丟例外。
 *   執行：node test/ui-smoke.js
 */
const Coup = require('../web/js/engine.js');
require('../web/js/ai.js');

// --- 最小 DOM mock ---
function makeEl() {
  return {
    _html: '', className: '', textContent: '', scrollTop: 0, scrollHeight: 0,
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    set onclick(f) {}, get onclick() { return null; }
  };
}
const els = {};
global.document = {
  getElementById: (id) => (els[id] || (els[id] = makeEl())),
  createElement: () => makeEl(),
  addEventListener: () => {}
};

require('../web/js/ui.js');
const UI = Coup.UI;
UI.init();

// 人類自動作答：永遠選第一個未停用選項；交換保留前 N 張
UI.prompt = (title, buttons) => {
  const b = buttons.find(x => !x.disabled) || buttons[0];
  return Promise.resolve(b.value);
};
UI.chooseExchange = (game, playerId) => {
  const me = game.players[playerId];
  return Promise.resolve(me.cards.slice(0, me.originalInfluence));
};

async function runOne(np) {
  const configs = [{ name: '你', isHuman: true }];
  for (let i = 1; i < np; i++) configs.push({ name: '電腦 ' + i, isHuman: false });

  let renders = 0, err = null;
  const game = new Coup.GameController(configs, {
    onLog: () => {},
    onState: () => { try { UI.game = game; UI.render(); renders++; } catch (e) { err = e; } },
    onTurn: (id) => { UI.currentTurn = id; },
    onGameOver: (w) => { try { UI.game = game; UI.showWinner(w); } catch (e) { err = e; } },
    pause: () => Promise.resolve()
  });
  game.agents[0] = UI;
  for (let i = 1; i < np; i++) game.agents[i] = new Coup.AIAgent(i, 'normal');
  UI.game = game; UI.currentTurn = 0;

  const winner = await game.play();
  if (err) throw err;
  return { winner, renders };
}

(async () => {
  let ok = 0, fail = 0;
  for (let i = 0; i < 50; i++) {
    const np = 2 + (i % 5);
    try {
      const { winner, renders } = await runOne(np);
      if (!winner) throw new Error('無勝者');
      if (renders < 1) throw new Error('render 未被呼叫');
      ok++;
    } catch (e) { fail++; console.error(`UI 煙霧第 ${i + 1} 局（${np}人）失敗:`, e.message, '\n', e.stack); }
  }
  console.log(`\nUI 煙霧測試：通過 ${ok} / 失敗 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
