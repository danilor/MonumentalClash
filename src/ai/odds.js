// Quick Monte-Carlo estimate of land battles, mirroring the dice rules of engine/combat.js.
import { COMBAT_DIE } from '../engine/data/constants.js';

const cache = new Map();
const TRIALS = 240;
const MAX_ROUNDS = 12;

const die = () => COMBAT_DIE[(Math.random() * COMBAT_DIE.length) | 0];

function roll(n, infantry) {
  let sum = 0;
  let icons = 0;
  for (let i = 0; i < n; i++) {
    const [v, icon] = die();
    sum += v;
    if (icon === 'infantry') icons += 1;
  }
  return sum + Math.min(icons, infantry);
}

/**
 * Attackers `a` against defenders `d` (Army units). Options: fortress (defender gets a die and cancels a hit in
 * round 1), bonusA / bonusD (flat CV per round, e.g. Steel Weapons).
 * Returns { win, lossA, lossD, draw } as probabilities / expectations. Attackers fight to the end.
 */
export function battleOdds(a, d, { fortress = false, bonusA = 0, bonusD = 0 } = {}) {
  if (a <= 0) return { win: 0, lossA: 0, lossD: 0, draw: 0 };
  if (d <= 0 && !fortress) return { win: 1, lossA: 0, lossD: 0, draw: 0 };
  const key = `${a}|${d}|${fortress ? 1 : 0}|${bonusA}|${bonusD}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let win = 0;
  let draw = 0;
  let lossA = 0;
  let lossD = 0;
  for (let t = 0; t < TRIALS; t++) {
    let na = a;
    let nd = d;
    let round = 0;
    const startDef = d;
    while (na > 0 && round < MAX_ROUNDS) {
      round += 1;
      const fort = fortress && round === 1;
      const cvA = roll(na, na) + bonusA;
      const cvD = roll(nd + (fort ? 1 : 0), nd) + bonusD;
      const hitsD = Math.max(0, Math.floor(cvA / 5) - (fort ? 1 : 0));
      const hitsA = Math.floor(cvD / 5);
      const killedD = Math.min(nd, hitsD);
      const killedA = Math.min(na, hitsA);
      nd -= killedD;
      na -= killedA;
      lossA += killedA;
      lossD += killedD;
      if (startDef === 0) break;
      if (nd <= 0) break;
    }
    if (na > 0 && nd <= 0) win += 1;
    else if (na <= 0 && nd <= 0) draw += 1;
  }
  const out = { win: win / TRIALS, draw: draw / TRIALS, lossA: lossA / TRIALS, lossD: lossD / TRIALS };
  cache.set(key, out);
  return out;
}
