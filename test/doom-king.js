/*
 * 亡國模式 · 國王牌測試：
 *  1) 牌庫組成：1 國王 + 2 公爵 + 其餘各 3，共 15
 *  2) 國王視為公爵（holdsRole）
 *  3) 強制徵收：宣示公爵被質疑、攤國王為真 → 質疑者失 1 影響力 + 被收 2 金幣、
 *     質疑者下家被收 1 金幣、國王共得 3 金幣（再加課稅 +3）
 *  4) 下家為國王本人時不徵收
 *   執行：node test/doom-king.js
 */
const Coup = require('../web/js/engine.js');
require('../web/js/ai.js');
const { GameController, holdsRole } = Coup;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };

function challenger(id, willChallenge) {
  return {
    id,
    chooseAction() { return { type: 'income' }; },
    decideChallenge(g, claimantId, ch) { return willChallenge && claimantId !== id; },
    decideChallengeBlock() { return false; },
    decideBlock() { return { block: false }; },
    chooseCardToLose() { return 0; },
    chooseExchange(g, pid) { return g.players[pid].cards.slice(0, g.players[pid].originalInfluence); },
    observe() {}, onSwap() {}, observeOutcome() {}, privateNote() {}
  };
}

// ---- 1) 牌庫組成 ----
(function () {
  const g = new GameController([{ name: 'A' }, { name: 'B' }, { name: 'C' }], {}, { mode: 'kingdom' });
  const all = g.deck.concat(...g.players.map(p => p.cards));
  const cnt = c => all.filter(x => x === c).length;
  ok(all.length === 15, '總牌數 15');
  ok(cnt('King') === 1 && cnt('Duke') === 2, '國王 1 + 公爵 2');
  ok(cnt('Bandit') === 1 && cnt('Assassin') === 2, '強盜 1 + 刺客 2');
  ok(cnt('Queen') === 1 && cnt('Contessa') === 2, '皇后 1 + 夫人 2');
  ok(cnt('Captain') === 3 && cnt('Ambassador') === 3, '隊長／大使各 3 張');
  ok(g.mode === 'kingdom', 'mode = kingdom');
})();

// ---- 2) 國王視為公爵 ----
ok(holdsRole(['King', 'Captain'], 'Duke') === true, 'holdsRole：國王算公爵');
ok(holdsRole(['Captain'], 'Duke') === false, 'holdsRole：沒公爵就是沒有');

// ---- 3) 強制徵收（4 人，下家非國王）----
(async function () {
  const g = new GameController([{ name: 'P0' }, { name: 'P1' }, { name: 'P2' }, { name: 'P3' }], {
    onLog: () => {}, onState: () => {}, pause: () => Promise.resolve()
  }, { mode: 'kingdom' });
  g.players.forEach((p, i) => { p.cards = ['Captain', 'Contessa']; p.coins = 2; });
  g.players[0].cards = ['King', 'Captain']; // P0 持國王
  g.agents[0] = challenger(0, false);
  g.agents[1] = challenger(1, true);  // P1 質疑
  g.agents[2] = challenger(2, false);
  g.agents[3] = challenger(3, false);

  await g.resolveAction({ type: 'tax', actorId: 0 });

  ok(g.players[1].cards.length === 1, 'P1 質疑錯 → 失 1 影響力');
  ok(g.players[1].coins === 0, 'P1 被國王收 2 金幣（2→0）');
  ok(g.players[2].coins === 1, 'P1 的下家 P2 被收 1 金幣（2→1）');
  ok(g.players[0].coins === 8, 'P0 國王：起手2 +徵收3 +課稅3 = 8');
  // 註：國王洗回後可能被隨機重抽回手上,屬合法隨機結果,故不檢查「不在手上」

  // ---- 4) 下家為國王本人 → 不徵收（2 人局：P1 的下家就是 P0/國王）----
  const g2 = new GameController([{ name: 'P0' }, { name: 'P1' }], {
    onLog: () => {}, onState: () => {}, pause: () => Promise.resolve()
  }, { mode: 'kingdom' });
  g2.players[0].cards = ['King', 'Captain']; g2.players[0].coins = 2;
  g2.players[1].cards = ['Captain', 'Contessa']; g2.players[1].coins = 2;
  g2.agents[0] = challenger(0, false);
  g2.agents[1] = challenger(1, true);
  await g2.resolveAction({ type: 'tax', actorId: 0 });
  ok(g2.players[1].coins === 0, '2人局：P1 仍被收 2 金幣');
  ok(g2.players[0].coins === 2 + 2 + 3, '2人局：下家是國王本人→只收質疑者2，國王 = 2+2+3 = 7（無下家1金）');

  // ---- 5) 強盜：成功暗殺累積金幣、被質疑兌現；被擋不累積 ----
  const gb = new GameController([{ name: 'P0' }, { name: 'P1' }, { name: 'P2' }], {
    onLog: () => {}, onState: () => {}, pause: () => Promise.resolve()
  }, { mode: 'kingdom' });
  gb.players[0].cards = ['Bandit', 'Captain']; gb.players[0].coins = 12;
  gb.players[1].cards = ['Captain', 'Captain']; gb.players[1].coins = 2;
  gb.players[2].cards = ['Captain', 'Captain']; gb.players[2].coins = 2;
  gb.agents[0] = challenger(0, false);
  gb.agents[1] = challenger(1, false); // 不質疑、不擋
  gb.agents[2] = challenger(2, false);
  await gb.resolveAction({ type: 'assassinate', actorId: 0, targetId: 1 });
  ok(gb.banditCoins === 1, '強盜成功暗殺 → 卡累積 1 金幣');
  await gb.resolveAction({ type: 'assassinate', actorId: 0, targetId: 2 });
  ok(gb.banditCoins === 2, '再次成功暗殺 → 累積 2 金幣');
  // 被夫人擋下 → 不累積
  gb.players[1].cards = ['Contessa', 'Captain'];
  gb.agents[1] = { id: 1, decideChallenge: () => false, decideChallengeBlock: () => false,
    decideBlock: (g, a) => (a.type === 'assassinate' ? { block: true, character: 'Contessa' } : { block: false }),
    chooseCardToLose: () => 0, chooseExchange: (g, pid) => g.players[pid].cards.slice(0, g.players[pid].originalInfluence),
    observe() {}, onSwap() {}, observeOutcome() {}, privateNote() {} };
  await gb.resolveAction({ type: 'assassinate', actorId: 0, targetId: 1 });
  ok(gb.banditCoins === 2, '被夫人擋下＝未成功 → 不累積（仍 2）');

  // 兌現：P0 暗殺 P2、P2 質疑 → 攤強盜（卡上 2 金幣）→ P2 失影響力 + P0 收 2 金幣、卡歸零
  gb.banditCoins = 2;
  const coinsBefore = gb.players[0].coins;
  gb.agents[2] = challenger(2, true); // P2 質疑暗殺
  await gb.resolveAction({ type: 'assassinate', actorId: 0, targetId: 2 });
  ok(gb.banditCoins === 0, '強盜被質疑兌現後卡歸零');
  ok(gb.players[0].coins === coinsBefore - 3 + 2, 'P0 兌現得 2 金幣（扣暗殺3 + 兌現2）');
  // 註：強盜洗回後可能被隨機重抽回手上,屬合法隨機結果,故不檢查「不在手上」

  // ---- 6) 皇后：被質疑夫人反制 → 額外抽牌（手牌可達 3）----
  const gq = new GameController([{ name: 'P0' }, { name: 'P1' }], {
    onLog: () => {}, onState: () => {}, pause: () => Promise.resolve()
  }, { mode: 'kingdom' });
  gq.players[0].cards = ['Captain', 'Captain']; gq.players[0].coins = 5; // P0 暗殺者
  gq.players[1].cards = ['Queen', 'Captain']; gq.players[1].coins = 2;   // P1 持皇后
  gq.agents[0] = { id: 0, decideChallenge: (g, c, ch) => ch === 'Contessa', // P0 質疑 P1 的夫人反制
    decideChallengeBlock: (g, c, ch) => ch === 'Contessa',
    decideBlock: () => ({ block: false }), chooseCardToLose: () => 0,
    chooseExchange: (g, pid) => g.players[pid].cards.slice(0, g.players[pid].originalInfluence),
    observe() {}, onSwap() {}, observeOutcome() {}, privateNote() {} };
  gq.agents[1] = { id: 1, decideChallenge: () => false, decideChallengeBlock: () => false,
    decideBlock: (g, a) => (a.type === 'assassinate' ? { block: true, character: 'Contessa' } : { block: false }),
    chooseCardToLose: () => 0, chooseExchange: (g, pid) => g.players[pid].cards.slice(0, g.players[pid].originalInfluence),
    observe() {}, onSwap() {}, observeOutcome() {}, privateNote() {} };
  await gq.resolveAction({ type: 'assassinate', actorId: 0, targetId: 1 });
  ok(gq.players[1].cards.length === 3, '皇后被質疑證實 → 額外抽牌，手牌增為 3 張（超過上限）');
  ok(gq.players[0].cards.length === 1, '質疑皇后失敗的 P0 失 1 影響力');
  ok(gq.players[1].lost.length === 0, '皇后擋下暗殺，未受傷');

  const total = pass + fail;
  console.log(`\n亡國模式角色測試：通過 ${pass} / 失敗 ${fail}（共 ${total}）`);
  process.exit(fail ? 1 : 0);
})();
