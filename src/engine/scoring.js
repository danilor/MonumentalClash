// Final scoring and tiebreaks.
import { BARBARIAN } from './data/constants.js';
import { WONDERS } from './data/wonders.js';

export const SCORE_ORDER = ['core', 'advances', 'objectives', 'wonders', 'events'];

/** Who still owns the Great Pyramid's points (its builder, wherever the city ended up). */
export function pyramidBuilder(s) {
  for (const c of s.cities) {
    const w = c.wonders.find((x) => x.id === 'great_pyramid');
    if (w) return w.builder;
  }
  return null;
}

function wonderPoints(s, p) {
  let pts = 0;
  for (const c of s.cities) {
    for (const w of c.wonders) {
      const vp = WONDERS[w.id].vp;
      if (w.id === 'great_pyramid') {
        if (w.builder === p) pts += vp;
      } else if (c.owner === w.builder) {
        if (c.owner === p) pts += vp;
      } else if (c.owner === BARBARIAN) {
        if (w.builder === p) pts += vp / 2;
      } else if (c.owner === p || w.builder === p) {
        pts += vp / 2;
      }
    }
  }
  return pts;
}

export function scoreOf(s, p) {
  const pl = s.players[p];
  const settlements = s.cities.filter((c) => c.owner === p).length;
  const buildings = s.cities.reduce((n, c) => n + Object.values(c.buildings).filter((col) => col === p).length, 0);
  const parts = {
    core: settlements + buildings,
    advances: pl.advances.length / 2,
    objectives: pl.completed.length * 2,
    wonders: wonderPoints(s, p),
    events: pl.vpBonus,
  };
  const total = SCORE_ORDER.reduce((n, k) => n + parts[k], 0);
  return { total, parts, settlements, buildings };
}

/** Compare final scores. Returns { scores, winner, winners }: winner is a player index or 'shared' (then `winners` are the tied players). */
export function finalResult(s) {
  const scores = s.players.map((pl) => scoreOf(s, pl.idx));
  const best = Math.max(...scores.map((x) => x.total));
  let tied = scores.map((x, i) => (x.total === best ? i : -1)).filter((i) => i >= 0);
  if (tied.length > 1) {
    const builder = pyramidBuilder(s);
    if (builder !== null && tied.includes(builder)) tied = [builder];
  }
  for (const key of SCORE_ORDER) {
    if (tied.length <= 1) break;
    const top = Math.max(...tied.map((i) => scores[i].parts[key]));
    tied = tied.filter((i) => scores[i].parts[key] === top);
  }
  return { scores, winner: tied.length === 1 ? tied[0] : 'shared', winners: tied };
}
