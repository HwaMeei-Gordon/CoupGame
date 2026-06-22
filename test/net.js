/*
 * 連線核心測試（不需 WebRTC）：用記憶體通道把「房主引擎 + RemoteAgent」接到
 * 「客人回應器（以 AI 依私有視角作答）」，驗證：
 *   1) 私有視角只露自己的牌，別人一律 null（不洩漏手牌）
 *   2) 請求-回應協定能驅動整局到結束
 *   3) 跨網路的資料皆可序列化（JSON round-trip）
 *   4) 客人僅憑「視角快照」就足以做出合法決策（AI 吃 view 也能玩）
 *   執行：node test/net.js
 */
const Coup = require('../web/js/engine.js');
require('../web/js/ai.js');
require('../web/js/net.js');
const { GameController, AIAgent, Net } = Coup;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

// 記憶體雙向通道（模擬 WebRTC data channel；JSON round-trip 確保只送可序列化資料）
function channelPair() {
  const a = { h: [] }, b = { h: [] };
  const deliver = (target, m) => setTimeout(() => target.h.forEach(fn => fn(JSON.parse(JSON.stringify(m)))), 0);
  a.send = m => deliver(b, m); b.send = m => deliver(a, m);
  a.on = (ev, fn) => { if (ev === 'data') a.h.push(fn); };
  b.on = (ev, fn) => { if (ev === 'data') b.h.push(fn); };
  return [a, b];
}

// 客人回應器：收到 request 用 AI 依「視角」作答；收集所有 state 快照供洩漏檢查
function makeGuestResponder(seat, channelGuestSide, collected) {
  const ai = new AIAgent(seat);
  channelGuestSide.on('data', msg => {
    if (msg.t === 'state' || msg.t === 'start') {
      collected.push(msg.view);
    } else if (msg.t === 'request') {
      collected.push(msg.view);
      const view = msg.view;
      let val;
      try { val = ai[msg.method].apply(ai, [view].concat(msg.args || [])); } catch (e) { val = undefined; }
      Promise.resolve(val).then(v => channelGuestSide.send({ t: 'response', reqId: msg.reqId, value: v }));
    }
  });
}

// ---------- 測試 1：serializeView 只露自己的牌 ----------
(function testSerialize() {
  const g = new GameController([{ name: 'A' }, { name: 'B' }, { name: 'C' }], {});
  g.players[0].cards = ['Duke', 'Captain'];
  g.players[1].cards = ['Assassin', 'Contessa'];
  g.players[2].cards = ['Ambassador', 'Duke'];
  g.players[1].lost = []; g.players[2].lost = ['Captain']; g.players[2].cards = ['Ambassador'];
  const view = Net.serializeView(g, 1);
  ok(view.players[1].cards.every(c => c !== null), '視角玩家(座位1)看得到自己的牌');
  ok(view.players[0].cards.every(c => c === null), '看不到玩家0的牌內容');
  ok(view.players[2].cards.every(c => c === null), '看不到玩家2的牌內容');
  ok(view.players[0].cards.length === 2, '玩家0張數正確(2)');
  ok(view.players[2].cards.length === 1 && view.players[2].lost.length === 1, '別人的死牌與張數仍可見');
  ok(view.myId === 1 && view.players[1].isHuman === true, '視角玩家被標為 isHuman');
})();

// ---------- 測試 2：完整一局透過遠端代理跑完 + 全程零洩漏 ----------
async function testFullGame(nPlayers, nRemotes) {
  const configs = [];
  for (let i = 0; i < nPlayers; i++) configs.push({ name: 'P' + i, isHuman: i <= nRemotes });
  const collectedBySeat = {}; // seat -> [views]
  const hostConns = {};

  const game = new GameController(configs, {
    onLog: () => {},
    onState: () => { // 房主每次狀態變動 → 廣播各自的私有視角
      for (let s = 1; s <= nRemotes; s++) hostConns[s].send({ t: 'state', view: Net.serializeView(game, s) });
    },
    onTurn: () => {},
    onGameOver: () => {},
    pause: () => Promise.resolve()
  });

  // 座位 0 = 房主（測試用 AI 代打）；座位 1..nRemotes = 遠端真人（RemoteAgent ↔ 回應器）；其餘 AI
  game.agents[0] = new AIAgent(0);
  for (let s = 1; s <= nRemotes; s++) {
    const [hostSide, guestSide] = channelPair();
    hostConns[s] = hostSide;
    const agent = new Net.RemoteAgent(s, hostSide, { fallback: new AIAgent(s), timeoutMs: 5000 });
    game.agents[s] = agent;
    hostSide.on('data', msg => { if (msg && msg.t === 'response') agent.resolveResponse(msg.reqId, msg.value); });
    collectedBySeat[s] = [];
    makeGuestResponder(s, guestSide, collectedBySeat[s]);
  }
  for (let i = 0; i < nPlayers; i++) if (!game.agents[i]) game.agents[i] = new AIAgent(i);

  const winner = await game.play();

  ok(!!winner || game.over, `${nPlayers}人(${nRemotes}遠端) 遊戲跑完並有結果`);
  // 洩漏檢查：每位客人收到的所有視角中，別人的牌一律 null、自己的牌不為 null
  let leaks = 0, sawOwn = 0;
  for (let s = 1; s <= nRemotes; s++) {
    collectedBySeat[s].forEach(view => {
      view.players.forEach(p => {
        if (p.id === s) { if (p.cards.some(c => c !== null)) sawOwn++; }
        else { if (p.cards.some(c => c !== null)) leaks++; }
      });
    });
  }
  ok(leaks === 0, `零手牌洩漏（${nPlayers}人，檢查 ${Object.values(collectedBySeat).reduce((a, b) => a + b.length, 0)} 份視角）`);
  ok(sawOwn > 0, '客人確實有收到自己的牌（視角有效）');
}

(async () => {
  await testFullGame(3, 1);
  await testFullGame(4, 2);
  await testFullGame(6, 3);
  // 多跑幾局確保穩定
  for (let i = 0; i < 10; i++) await testFullGame(4, 2);
  console.log(`\n連線核心測試：通過 ${pass} / 失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
})();
