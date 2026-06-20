/*
 * 對手建模測試：驗證 AI 對「宣稱角色種類數 > 手牌數」的吹牛者，
 * 質疑意願顯著上升。
 *   執行：node test/ai-model.js
 */
const Coup = require('../web/js/engine.js');
require('../web/js/ai.js');
const { GameController, AIAgent } = Coup;

function makeGame() {
  const g = new GameController([{ name: '我' }, { name: '對手' }], {});
  // 固定盤面：我手上沒有 Duke/Captain/Assassin（讓機率穩定），對手 2 影響力
  g.players[0].cards = ['Contessa', 'Contessa'];
  g.players[1].cards = ['Duke', 'Duke'];
  g.players.forEach(p => { p.lost = []; });
  return g;
}

function rate(setupObserve, trials) {
  let hit = 0;
  for (let i = 0; i < trials; i++) {
    const ai = new AIAgent(0, 'normal');
    const g = makeGame();
    setupObserve(ai, g);
    if (ai.decideChallenge(g, 1, 'Duke')) hit++;
  }
  return hit / trials;
}

const T = 4000;

// 基準：對手只宣稱過一種角色（Duke）
const base = rate((ai, g) => { ai.observe(g, 1, 'Duke'); }, T);

// 可疑：對手 2 影響力卻已宣稱過 3 種不同角色
const sus = rate((ai, g) => {
  ai.observe(g, 1, 'Duke');
  ai.observe(g, 1, 'Captain');
  ai.observe(g, 1, 'Assassin');
}, T);

console.log(`基準（單一宣稱）質疑率：   ${(base * 100).toFixed(1)}%`);
console.log(`可疑（3 種宣稱）質疑率：   ${(sus * 100).toFixed(1)}%`);

const ok = sus > base + 0.15; // 至少高出 15 個百分點
console.log(ok
  ? `\n✓ 對手建模生效：可疑者被質疑機率明顯較高（+${((sus - base) * 100).toFixed(1)} pt）`
  : `\n✗ 對手建模未達預期`);
process.exit(ok ? 0 : 1);
