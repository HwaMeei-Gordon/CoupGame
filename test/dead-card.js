/*
 * 死牌不變量測試：證明「正面朝上(已攤開)的牌」永遠不能用來滿足宣稱。
 *   執行：node test/dead-card.js
 *
 * 直接以決定性手牌呼叫 engine.runChallenge，涵蓋使用者回報的情境：
 *   A) 玩家原本兩張刺客 → 攤開一張(死) + 手上仍有一張(活) → 宣稱刺客為「真」(合法)
 *   B) 玩家只有一張刺客且已攤開(死)，手上是別的牌 → 宣稱刺客必須「被抓」(死牌不算)
 * 並附帶大量隨機對局的「每角色守恆 = 3」檢查。
 */
const Coup = require('../web/js/engine.js');
require('../web/js/ai.js');
const { GameController, CHARACTERS } = Coup;

function makeGame() {
  const g = new GameController(
    [{ name: 'A', isHuman: false }, { name: 'B', isHuman: false }],
    { pause: () => Promise.resolve() }
  );
  const challenger = {
    decideChallenge: () => true,            // 永遠質疑
    chooseCardToLose: () => 0,
    decideBlock: () => ({ block: false }),
    observe() {}
  };
  const passive = {
    decideChallenge: () => false,
    chooseCardToLose: () => 0,
    decideBlock: () => ({ block: false }),
    observe() {}
  };
  g.agents[0] = passive;      // 宣稱者(被質疑方)
  g.agents[1] = challenger;   // 質疑者
  return g;
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

async function scenarios() {
  console.log('情境測試（死牌不變量）：');

  // A) 兩張刺客,其中一張已攤開為死牌,手上仍有一張活的 → 宣稱為真
  let g = makeGame();
  g.players[0].cards = ['Assassin'];   // 活牌:1 張刺客
  g.players[0].lost  = ['Assassin'];   // 死牌:1 張刺客(已攤開)
  g.players[1].cards = ['Duke', 'Captain'];
  let res = await g.runChallenge(0, 'Assassin');
  check('A 手上仍有活刺客 → 宣稱刺客為真(質疑失敗)', res.challenged && res.success === false);
  check('A 質疑者(B)失去一張影響力', g.players[1].lost.length === 1);

  // B) 唯一的刺客已攤開為死牌,手上是別的牌 → 宣稱刺客必須被抓
  g = makeGame();
  g.players[0].cards = ['Duke'];        // 活牌:沒有刺客
  g.players[0].lost  = ['Assassin'];    // 死牌:刺客(已攤開)
  g.players[1].cards = ['Captain', 'Contessa'];
  res = await g.runChallenge(0, 'Assassin');
  check('B 只有死刺客 → 宣稱刺客被抓(質疑成功)★關鍵', res.challenged && res.success === true);
  check('B 宣稱者(A)因吹牛再失一張(死牌不能護身)', g.players[0].lost.length === 2);
}

function perCharOK(game) {
  const cnt = {};
  CHARACTERS.forEach(c => cnt[c] = 0);
  game.deck.forEach(c => cnt[c]++);
  game.players.forEach(p => { p.cards.forEach(c => cnt[c]++); p.lost.forEach(c => cnt[c]++); });
  return CHARACTERS.every(c => cnt[c] === 3);
}

async function bulkConservation(n) {
  console.log(`\n每角色守恆檢查（每種角色恆為 3 張）：跑 ${n} 局`);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const np = 2 + (i % 5);
    const configs = [];
    for (let k = 0; k < np; k++) configs.push({ name: 'AI' + k, isHuman: false });
    let viol = false;
    const game = new GameController(configs, {
      onState: () => { if (!viol && !perCharOK(game)) viol = true; },
      pause: () => Promise.resolve()
    });
    configs.forEach((c, k) => game.agents[k] = new Coup.AIAgent(k, 'normal'));
    await game.play();
    if (viol || !perCharOK(game)) bad++;
  }
  check(`${n} 局每角色皆守恆(無死牌複製/復活)`, bad === 0);
}

(async () => {
  await scenarios();
  await bulkConservation(3000);
  console.log(`\n死牌測試：通過 ${pass} / 失敗 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
