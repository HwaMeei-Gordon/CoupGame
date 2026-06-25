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
  ok(cnt('King') === 1, '國王恰 1 張');
  ok(cnt('Duke') === 2, '公爵恰 2 張');
  ok(cnt('Captain') === 3 && cnt('Assassin') === 3 && cnt('Ambassador') === 3 && cnt('Contessa') === 3, '其餘角色各 3 張');
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
  ok(!g.players[0].cards.includes('King'), '國王已洗回牌庫換新牌');

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

  console.log(`\n國王牌測試：通過 ${pass} / 失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
})();
