/*
 * Node 端 AI-vs-AI 模擬測試。
 * 跑多局純 AI 對戰，驗證：每局都結束、恰有一名勝者、無例外、卡牌守恆。
 *   執行：node test/sim.js [局數]
 */
const Coup = require('../web/js/engine.js');
require('../web/js/ai.js');

const { GameController, AIAgent } = Coup;

function countCards(game) {
  // 場上所有牌（手牌 + 已攤開 + 牌庫）應恆為 15
  let n = game.deck.length;
  game.players.forEach(p => { n += p.cards.length + p.lost.length; });
  return n;
}

async function runOne(numPlayers) {
  const configs = [];
  for (let i = 0; i < numPlayers; i++) configs.push({ name: `AI${i + 1}`, isHuman: false });

  let cardErr = null;
  const game = new GameController(configs, {
    onState: () => {
      if (countCards(game) !== 15 && !cardErr) cardErr = countCards(game);
    },
    pause: () => Promise.resolve()
  });
  configs.forEach((c, i) => { game.agents[i] = new AIAgent(i, 'normal'); });

  const winner = await game.play();
  return { winner, game, cardErr };
}

async function main() {
  const total = parseInt(process.argv[2] || '300', 10);
  let ok = 0, fail = 0;
  const winCounts = {};
  const playerCounts = [2, 3, 4, 5, 6];

  for (let i = 0; i < total; i++) {
    const np = playerCounts[i % playerCounts.length];
    try {
      const { winner, game, cardErr } = await runOne(np);
      const aliveCount = game.players.filter(p => p.alive).length;
      if (!winner) throw new Error(`無勝者 alive=${aliveCount}`);
      // 正常情況應只剩 1 人；安全上限的罕見和局例外（仍須有勝者）
      if (aliveCount !== 1) console.warn(`  · 第 ${i + 1} 局以判定收場（alive=${aliveCount}）`);
      if (cardErr != null) throw new Error(`牌數不守恆：${cardErr} != 15`);
      // 金幣不可為負
      game.players.forEach(p => { if (p.coins < 0) throw new Error(`金幣為負 ${p.name}=${p.coins}`); });
      ok++;
      winCounts[np] = (winCounts[np] || 0) + 1;
    } catch (e) {
      fail++;
      console.error(`第 ${i + 1} 局（${np} 人）失敗:`, e.message);
      if (fail <= 3) console.error(e.stack);
    }
  }

  console.log('\n==============================');
  console.log(`模擬 ${total} 局：通過 ${ok}，失敗 ${fail}`);
  console.log('各人數完成局數:', winCounts);
  console.log('==============================');
  process.exit(fail === 0 ? 0 : 1);
}

main();
