// Quick Monte-Carlo estimate of land battles, mirroring the dice rules of engine/combat.js.
import { CLASH_BONUS, COMBAT_DIE } from '../engine/data/constants.js';

const cache = new Map();
const TRIALS = 240;
const MAX_ROUNDS = 12;

const die = () => COMBAT_DIE[(Math.random() * COMBAT_DIE.length) | 0];

/** The CV of `n` dice: the pips plus +1 per Infantry icon and +2 per Cavalry icon, up to `foot` and `horse` Units. */
function roll(n, foot, horse) {
  let sum = 0;
  let footIcons = 0;
  let horseIcons = 0;
  for (let i = 0; i < n; i++) {
    const [v, icon] = die();
    sum += v;
    if (icon === 'infantry') footIcons += 1;
    else if (icon === 'cavalry') horseIcons += 1;
  }
  return sum + CLASH_BONUS.infantry * Math.min(footIcons, foot) + CLASH_BONUS.cavalry * Math.min(horseIcons, horse);
}

/**
 * Attackers `a` against defenders `d` (Army units, `horseA` / `horseD` of them Cavalry). Options: fortress (defender
 * gets a die and cancels a hit in round 1), bonusA / bonusD (flat CV per round, e.g. Steel Weapons).
 * Returns { win, lossA, lossD, draw } as probabilities / expectations. Attackers fight to the end and lose Infantry first.
 */
export function battleOdds(a, d, { fortress = false, bonusA = 0, bonusD = 0, horseA = 0, horseD = 0 } = {}) {
  if (a <= 0) return { win: 0, lossA: 0, lossD: 0, draw: 0 };
  if (d <= 0 && !fortress) return { win: 1, lossA: 0, lossD: 0, draw: 0 };
  horseA = Math.min(horseA, a);
  horseD = Math.min(horseD, d);
  const key = `${a}|${d}|${fortress ? 1 : 0}|${bonusA}|${bonusD}|${horseA}|${horseD}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let win = 0;
  let draw = 0;
  let lossA = 0;
  let lossD = 0;
  for (let t = 0; t < TRIALS; t++) {
    let na = a;
    let nd = d;
    let ca = horseA;
    let cd = horseD;
    let round = 0;
    const startDef = d;
    while (na > 0 && round < MAX_ROUNDS) {
      round += 1;
      const fort = fortress && round === 1;
      const cvA = roll(na, na - ca, ca) + bonusA;
      const cvD = roll(nd + (fort ? 1 : 0), nd - cd, cd) + bonusD;
      const hitsD = Math.max(0, Math.floor(cvA / 5) - (fort ? 1 : 0));
      const hitsA = Math.floor(cvD / 5);
      const killedD = Math.min(nd, hitsD);
      const killedA = Math.min(na, hitsA);
      nd -= killedD;
      na -= killedA;
      cd = Math.min(cd, nd);
      ca = Math.min(ca, na);
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
