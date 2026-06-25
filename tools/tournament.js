/*
 * Coup AI 聯賽：每場 6 位隨機具名 AI、隨機手牌、深思版「真比賽」，
 * 統計每位 AI 的完整戰績（勝率 / 平均名次 / 進決賽率 / 場均擊殺 / 攻擊 /
 * 吹牛 / 吹牛被抓率 / 質疑 / 質疑成功率）。
 *
 *   用法：node tools/tournament.js [場數=100] [模式=kingdom|normal|both] [人數=6]
 *   範例：node tools/tournament.js 2000 both
 */
const Coup = require('../web/js/engine.js');
require('../web/js/ai.js');
const { GameController, AIAgent, holdsRole } = Coup;

const GAMES = parseInt(process.argv[2], 10) || 100;
const MODEARG = (process.argv[3] || 'kingdom').toLowerCase();
const SEATS = parseInt(process.argv[4], 10) || 6;
const MODES = MODEARG === 'both' ? ['normal', 'kingdom'] : [MODEARG === 'normal' ? 'normal' : 'kingdom'];

const moe = (p, n) => 1.96 * Math.sqrt(p * (1 - p) / n) * 100; // 95% 信賴區間半寬(%)

// 走訪一場的 history，算出名次與每位行為數據
function analyze(history, np) {
  const end = history.find(e => e.k === 'end');
  const winner = end ? end.winner : null;
  const outOrder = history.filter(e => e.k === 'out').map(e => e.who);
  const place = {};
  if (winner != null) place[winner] = 1;
  outOrder.forEach((id, i) => { place[id] = np - i; }); // 第 i 個出局 → 名次 np-i
  const per = {};
  for (let id = 0; id < np; id++) per[id] = { coup:0, assassin:0, steal:0, tax:0, exch:0, income:0, fa:0, bluffs:0, bluffCaught:0, challenges:0, chalWon:0, kills:0, out:false, lastActTurn:0 };
  let turn = 0, lastAct = null, lastChal = null;
  history.forEach(e => {
    if (e.k === 'act') {
      turn++;
      const a = per[e.actor]; a.lastActTurn = turn;
      a[e.type === 'foreign_aid' ? 'fa' : e.type === 'assassinate' ? 'assassin' : e.type] += 1;
      if (e.claim && !holdsRole(e.hand || [], e.claim)) a.bluffs++;
      lastAct = e; lastChal = null;
    } else if (e.k === 'chal') {
      const c = per[e.by]; c.challenges++; if (!e.truthful) { c.chalWon++; per[e.of].bluffCaught++; }
      lastChal = e;
    } else if (e.k === 'lose') {
      if (lastChal && !lastChal.truthful && lastChal.of === e.who) per[lastChal.by].kills++;
      else if (lastChal && lastChal.truthful && lastChal.by === e.who) per[lastChal.of].kills++;
      else if (lastAct && (lastAct.type === 'coup' || lastAct.type === 'assassinate') && lastAct.target === e.who) per[lastAct.actor].kills++;
    } else if (e.k === 'devil') {
      per[e.who].kills++;
    } else if (e.k === 'out') {
      per[e.who].out = true;
    }
  });
  return { winner, place, per };
}

async function runMode(mode) {
  const S = {};
  AIAgent.PERSONAS.forEach(p => S[p.name] = { think: p.think, iq: p.iq, games:0, wins:0, placeSum:0, finalist:0, eliminated:0, coup:0, assassin:0, steal:0, tax:0, exch:0, income:0, fa:0, bluffs:0, bluffCaught:0, challenges:0, chalWon:0, kills:0 });
  for (let g = 0; g < GAMES; g++) {
    const personas = AIAgent.drawPersonas(SEATS);
    const game = new GameController(personas.map(p => ({ name: p.name })),
      { onLog(){}, onState(){}, onTurn(){}, onGameOver(){}, pause:()=>Promise.resolve(), onThink:()=>Promise.resolve() },
      { mode });
    for (let i = 0; i < SEATS; i++) game.agents[i] = new AIAgent(i, personas[i]);
    await game.play();
    const a = analyze(game.history, SEATS);
    personas.forEach((p, id) => {
      const s = S[p.name], d = a.per[id], pl = a.place[id] || SEATS;
      s.games++; if (a.winner === id) s.wins++; s.placeSum += pl;
      if (pl <= 2) s.finalist++; if (d.out) s.eliminated++;
      ['coup','assassin','steal','tax','exch','income','fa','bluffs','bluffCaught','challenges','chalWon','kills'].forEach(k => s[k] += d[k]);
    });
  }
  return S;
}

function printMode(mode, S) {
  console.log(`\n========== 🏆 六人${mode === 'kingdom' ? '亡國' : '一般'}模式 · ${GAMES} 場完整數據 ==========`);
  console.log('每場隨機 6 位 AI、隨機手牌、深思版真比賽。公平勝率均值 = 16.7%');
  const rows = Object.keys(S).map(name => {
    const s = S[name], g = s.games || 1;
    return { name, think: s.think, g: s.games, winr: s.wins/g*100, moe: moe(s.wins/g, g),
      place: s.placeSum/g, fin: s.finalist/g*100, kills: s.kills/g, atk: (s.coup+s.assassin)/g,
      bluff: s.bluffs/g, caught: s.bluffCaught/g,
      chal: s.challenges/g, chalWin: s.challenges ? s.chalWon/s.challenges*100 : 0 };
  }).sort((a, b) => a.place - b.place);
  console.log('排名 AI       型態      勝率±誤差     名次 進決賽 擊殺 攻擊 吹牛 被抓 質疑 質疑勝');
  rows.forEach((r, i) => console.log(
    String(i+1).padStart(2)+'  '+r.name.padEnd(8)+' '+r.think.padEnd(9)+' '+
    (r.winr.toFixed(1)+'±'+r.moe.toFixed(0)+'%').padStart(10)+'  '+r.place.toFixed(2)+'  '+
    (r.fin.toFixed(0)+'%').padStart(4)+'  '+r.kills.toFixed(2)+' '+r.atk.toFixed(2)+' '+
    r.bluff.toFixed(2)+' '+r.caught.toFixed(2)+' '+r.chal.toFixed(2)+' '+(r.chalWin.toFixed(0)+'%').padStart(4)));
  const bt = {};
  rows.forEach(r => { const t = bt[r.think] || (bt[r.think] = { w:0, g:0 }); t.w += S[r.name].wins; t.g += r.g; });
  console.log('依思考型態勝率：' + Object.keys(bt).sort((a,b)=>bt[b].w/bt[b].g-bt[a].w/bt[a].g)
    .map(t => `${t} ${(bt[t].w/bt[t].g*100).toFixed(1)}%`).join('　|　'));
  console.log('（名次 1=冠軍最佳；進決賽=打進最後 2 人比例；擊殺/攻擊/吹牛/被抓/質疑皆為每場平均次數，吹牛=出招詐唬、被抓=詐唬被質疑拆穿）');
}

(async () => {
  for (const mode of MODES) printMode(mode, await runMode(mode));
})();
