// Quick Monte-Carlo estimate of land battles, mirroring the dice rules of engine/combat.js.
import { CLASH_BONUS, COMBAT_DIE } from '../engine/data/constants.js';

const cache = new Map();
const TRIALS = 240;
const MAX_ROUNDS = 12;

const die = () => COMBAT_DIE[(Math.random() * COMBAT_DIE.length) | 0];

/**
 * One side's roll of `n` dice with `foot` Infantry, `horse` Cavalry and `tusk` Elephants fighting. `cv` is the pips plus
 * +1 per Infantry icon and +2 per Cavalry icon, up to the Units of that kind. Each Elephant icon, up to the Elephants
 * fighting, takes its (lowest) die out of the sum and `cancel`s one enemy hit.
 */
function roll(n, foot, horse, tusk) {
  let sum = 0;
  let footIcons = 0;
  let horseIcons = 0;
  const trunks = [];
  for (let i = 0; i < n; i++) {
    const [v, icon] = die();
    sum += v;
    if (icon === 'infantry') footIcons += 1;
    else if (icon === 'cavalry') horseIcons += 1;
    else if (icon === 'elephant') trunks.push(v);
  }
  trunks.sort((x, y) => x - y);
  const cancel = Math.min(trunks.length, tusk);
  for (let i = 0; i < cancel; i++) sum -= trunks[i];
  return { cv: sum + CLASH_BONUS.infantry * Math.min(footIcons, foot) + CLASH_BONUS.cavalry * Math.min(horseIcons, horse), cancel };
}

/**
 * Attackers `a` against defenders `d` (Army units, `horseA` / `horseD` of them Cavalry and `elephantA` / `elephantD`
 * Elephants). Options: fortress (defender gets a die and cancels a hit in round 1), bonusA / bonusD (flat CV per round,
 * e.g. Steel Weapons). Returns { win, lossA, lossD, draw } as probabilities / expectations. Both sides fight to the end
 * and lose Infantry first, then Cavalry, and their Elephants last.
 */
export function battleOdds(a, d, { fortress = false, bonusA = 0, bonusD = 0, horseA = 0, horseD = 0, elephantA = 0, elephantD = 0 } = {}) {
  if (a <= 0) return { win: 0, lossA: 0, lossD: 0, draw: 0 };
  if (d <= 0 && !fortress) return { win: 1, lossA: 0, lossD: 0, draw: 0 };
  elephantA = Math.min(elephantA, a);
  elephantD = Math.min(elephantD, d);
  horseA = Math.min(horseA, a - elephantA);
  horseD = Math.min(horseD, d - elephantD);
  const key = `${a}|${d}|${fortress ? 1 : 0}|${bonusA}|${bonusD}|${horseA}|${horseD}|${elephantA}|${elephantD}`;
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
    let ea = elephantA;
    let ed = elephantD;
    let round = 0;
    const startDef = d;
    while (na > 0 && round < MAX_ROUNDS) {
      round += 1;
      const fort = fortress && round === 1;
      const rollA = roll(na, na - ca - ea, ca, ea);
      const rollD = roll(nd + (fort ? 1 : 0), nd - cd - ed, cd, ed);
      const hitsD = Math.max(0, Math.floor((rollA.cv + bonusA) / 5) - rollD.cancel - (fort ? 1 : 0));
      const hitsA = Math.max(0, Math.floor((rollD.cv + bonusD) / 5) - rollA.cancel);
      const killedD = Math.min(nd, hitsD);
      const killedA = Math.min(na, hitsA);
      nd -= killedD;
      na -= killedA;
      ed = Math.min(ed, nd);
      cd = Math.min(cd, nd - ed);
      ea = Math.min(ea, na);
      ca = Math.min(ca, na - ea);
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
