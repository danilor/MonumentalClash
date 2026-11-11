// AI-vs-AI (or AI-vs-random) simulations: node test/simulate.mjs [games=4] [firstSeed=1] [--opponents=1] [--vs=ai|random] [--ages=6] [--check] [-v]
import { Game } from '../src/engine/game.js';
import { attachAI, chooseAction } from '../src/ai/index.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { normalizeOpponents } from '../src/engine/queries.js';
import { scoreOf } from '../src/engine/scoring.js';
import { checkInvariants, makeRand, randomAnswer } from './harness.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === name);
const opt = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const games = nums[0] ?? 4;
const firstSeed = nums[1] ?? 1;
const vs = opt('vs', 'ai');
const verbose = flag('-v');
const check = flag('--check');
const ages = opt('ages', undefined);
const opponents = normalizeOpponents(opt('opponents', undefined));
const seats = opponents + 1;
const zeros = () => Array.from({ length: seats }, () => 0);

function playOne(seed) {
  const g = Game.create({ seed: String(seed), humans: Array.from({ length: seats }, () => false), ages, opponents });
  const rand = makeRand(`sim:${seed}`);
  for (let p = 0; p < seats; p++) attachAI(g, p);
  if (vs === 'random') g.policy[0] = (_g, prompt) => randomAnswer(rand, prompt);
  g.begin();
  const stats = { actions: Array.from({ length: seats }, () => ({})), ms: zeros(), count: zeros(), max: zeros() };
  const problems = [];
  let guard = 0;
  while (g.s.phase !== 'over' && guard++ < 3000 * seats) {
    const p = g.cur;
    let acts = 0;
    while (g.s.phase !== 'over' && g.cur === p && acts++ < 40) {
      const t0 = performance.now();
      let choice;
      if (vs === 'random' && p === 0) {
        const list = enumerateActions(g, p);
        const w = list.filter((c) => c.cat !== 'end');
        choice = !w.length || g.s.turn.actionsLeft <= 0 || rand.chance(0.15) ? { action: { type: 'end_turn' }, cat: 'end' } : rand.pick(w);
      } else {
        choice = chooseAction(g, p);
      }
      const dt = performance.now() - t0;
      stats.ms[p] += dt;
      stats.count[p] += 1;
      stats.max[p] = Math.max(stats.max[p], dt);
      let r = g.apply(choice.action);
      if (!r.ok) {
        if (verbose) console.log(`  rejected ${JSON.stringify(choice.action)}: ${r.error}`);
        r = g.apply({ type: 'end_turn' });
      }
      stats.actions[p][choice.cat] = (stats.actions[p][choice.cat] || 0) + 1;
      if (verbose) console.log(`  P${p} ${choice.cat} ${JSON.stringify(choice.action)} (${(choice.gain ?? 0).toFixed(2)})`);
      if (check) {
        const errs = checkInvariants(g);
        if (errs.length) {
          problems.push(`seed ${seed}: ${errs.join('; ')}`);
          return { g, stats, problems };
        }
      }
      g.drainEvents();
    }
  }
  return { g, stats, problems };
}

const wins = Array.from({ length: seats + 1 }, () => 0);
const total = { ms: 0, n: 0, max: 0 };
for (let i = 0; i < games; i++) {
  const seed = firstSeed + i;
  const t0 = performance.now();
  const { g, stats, problems } = playOne(seed);
  const s = g.s;
  const sc = s.players.map((pl) => scoreOf(s, pl.idx));
  const w = s.winner;
  wins[w === 'shared' || w === null ? seats : w] += 1;
  total.ms += stats.ms.reduce((a, b) => a + b, 0);
  total.n += stats.count.reduce((a, b) => a + b, 0);
  total.max = Math.max(total.max, ...stats.max);
  const line = (p) => {
    const pl = s.players[p];
    const cs = s.cities.filter((c) => c.owner === p);
    const b = Object.values(sc[p].parts).map((x) => x).join('/');
    return `P${p} ${sc[p].total.toFixed(1)}vp [${b}] cities ${cs.length} adv ${pl.advances.length} wond ${pl.builtWonders.length} obj ${pl.completed.length}`;
  };
  const lines = s.players.map((pl) => line(pl.idx)).join(' | ');
  console.log(`seed ${seed}: age ${s.age} phase ${s.phase} winner ${w} | ${lines} | ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  if (verbose) console.log('  actions', JSON.stringify(stats.actions));
  for (const pr of problems) console.log('  PROBLEM', pr);
}
const tally = wins.slice(0, seats).map((n, p) => `P${p} ${n}`).join(' ');
console.log(`wins ${tally} shared ${wins[seats]} | avg decision ${(total.ms / Math.max(1, total.n)).toFixed(1)}ms, max ${total.max.toFixed(0)}ms`);
