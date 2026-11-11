// Position evaluation for the AI. Values are in "points" where one Victory Point is worth about 2.2.
import { BARBARIAN } from '../engine/data/constants.js';
import { GROUPS } from '../engine/data/advances.js';
import { OBJECTIVES, OBJECTIVE_CARDS } from '../engine/data/cards.js';
import { WONDERS } from '../engine/data/wonders.js';
import { checkStatus } from '../engine/objectives.js';
import { citySize, citySizeCap, foesOf, hasBuilding, hexDistance, isArmy, isHidden, nbrs, resLimit } from '../engine/queries.js';
import { battleOdds } from './odds.js';

export const DEFAULTS = {
  foe: 0.85, // how much the opponents' positions count against ours (the strongest weighs as much as the rest together)
  aggression: 1, // eagerness to march on enemy cities
  noise: 0.05, // random jitter so the AI is not perfectly predictable
};

const ADV_BASE = 1.6;
// Extra worth of individual Advances (on top of their half Victory Point and the Event-tracker progress).
const ADV_BONUS = {
  storage: 1.4, irrigation: 0.2, husbandry: 0.5,
  engineering: 1.0, sanitation: 0.6, roads: 0.5,
  fishing: 0.9, navigation: 0.3, warships: 0.2, cartography: 0.3,
  writing: 1.4, public_education: 0.7, free_education: 0.1, philosophy: 1.0,
  tactics: 2.0, siegecraft: 0.3, steel_weapons: 0.9, draft: 0.7,
  myths: 0.8, rituals: 0.1, priesthood: 0.3, state_religion: 0.5,
  bartering: 0.6, trade_routes: 0.5, taxation: 1.1, currency: 0.2,
  arts: 0.7, sports: 0.4, monuments: 0.8, theaters: 0.3,
  math: 0.3, astronomy: 0.2, medicine: 0.5, metallurgy: 0.4,
  voting: 0.3, separation_of_power: 0.1, civil_liberties: 0.6, economic_liberty: 0.9,
  nationalism: 0.5, totalitarianism: 0.1, absolute_power: 1.1, forced_labor: 0.4,
  dogma: 0.4, devotion: 0.1, conversion: 0.6, fanaticism: 0.6,
};
export const advanceValue = (id) => ADV_BASE + (ADV_BONUS[id] || 0);

const BUILDING_VALUE = { academy: 2.6, fortress: 2.1, market: 2.3, port: 2.4, temple: 2.6 };
const CITY_BASE = 5;
const WONDER_BUILT = 14;
const WONDER_HELD = 4.4;
const WONDER_PLAN = 4;
const RES_WEIGHT = { food: 0.55, wood: 0.5, ore: 0.5, ideas: 0.75, gold: 0.7 };

const unitsByHex = (s) => {
  const m = new Map();
  for (const u of s.units) {
    const l = m.get(u.hex);
    if (l) l.push(u);
    else m.set(u.hex, [u]);
  }
  return m;
};

const canAttack = (s, owner) => owner === BARBARIAN || s.players[owner].advances.includes('tactics');

/** How good a spot is for a new city of player q (about 0 .. 6). */
export function siteQuality(s, q, hex, claimed) {
  const pl = s.players[q];
  const prod = (k) => {
    const h = s.map.hexes[k];
    if (!h) return 0;
    switch (h.terrain) {
      case null: return 0.4;
      case 'plains': return 1;
      case 'forest': return 1;
      case 'mountain': return 1;
      case 'barren': return pl.advances.includes('irrigation') ? 0.8 : 0.1;
      case 'sea': return pl.advances.includes('fishing') ? 0.7 : 0.2;
      default: return 0;
    }
  };
  let v = 0;
  for (const k of [hex, ...nbrs(s, hex)]) {
    if (s.map.hexes[k] && s.map.hexes[k].exhausted) continue;
    v += prod(k) * (claimed.has(k) ? 0.35 : 1);
  }
  return v;
}

function claimedHexes(s, q) {
  const set = new Set();
  for (const c of s.cities) {
    if (c.owner !== q) continue;
    set.add(c.hex);
    for (const n of nbrs(s, c.hex)) set.add(n);
  }
  return set;
}

/** Best reachable city site for a Settler: value = quality - distance. Returns { value, dist }. */
function bestSite(s, q, from, ix, claimed) {
  let best = { value: 0, dist: 9 };
  const seen = new Map([[from, 0]]);
  let frontier = [from];
  for (let d = 0; d <= 5; d++) {
    for (const k of frontier) {
      const h = s.map.hexes[k];
      const here = ix.units.get(k);
      const foreign = here && here.some((u) => u.owner !== q);
      if (h && h.terrain !== 'barren' && !h.exhausted && !foreign && !s.cities.some((c) => c.hex === k)) {
        const ok = s.cities.every((c) => c.owner === q || hexDistance(c.hex, k) > 1);
        if (ok) {
          const quality = siteQuality(s, q, k, claimed);
          if (quality >= 2.4) {
            const value = Math.min(quality, 4.5) - 0.55 * d;
            if (value > best.value) best = { value, dist: d };
          }
        }
      }
    }
    if (d === 5) break;
    const next = [];
    for (const k of frontier) {
      for (const n of nbrs(s, k)) {
        if (seen.has(n)) continue;
        const h = s.map.hexes[n];
        if (!h || h.terrain === null || h.terrain === 'sea') continue;
        const c = s.cities.find((x) => x.hex === n);
        if (c && c.owner !== q) continue;
        const here = ix.units.get(n);
        if (here && here.some((u) => u.owner !== q)) continue;
        seen.set(n, d + 1);
        next.push(n);
      }
    }
    frontier = next;
  }
  return best;
}

const groupCount = (pl, gid) => GROUPS[gid].advances.filter((a) => pl.advances.includes(a.id)).length;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** How close a Status objective is to being completed (0..1). Event objectives return a small constant. */
function objectiveProgress(s, q, id) {
  const pl = s.players[q];
  const foes = foesOf(s, q);
  const mine = s.cities.filter((c) => c.owner === q);
  const chk = checkStatus(s, q, id);
  if (chk.ok) return 1;
  if (OBJECTIVES[id].kind !== 'status') return 0.08;
  const grp = (gid) => groupCount(pl, gid) / 4;
  const buildingCount = (pp, type) => s.cities.filter((c) => c.owner === pp && hasBuilding(c, type)).length;
  const lead = (type) => clamp01(0.3 + 0.35 * (buildingCount(q, type) - Math.max(...foes.map((f) => buildingCount(f, type))) + 1));
  switch (id) {
    case 'large_civ': return mine.length / 6;
    case 'science_lead': return lead('academy');
    case 'coastal_lead': return lead('port');
    case 'religious_fervor': return lead('temple');
    case 'fortifications': return lead('fortress');
    case 'advanced_culture':
      return clamp01(pl.advances.length / 6) * (foes.every((f) => pl.advances.length > s.players[f].advances.length) ? 1 : 0.5);
    case 'city_planner': return grp('construction');
    case 'education_lead': return grp('education');
    case 'culture_focus': return grp('culture');
    case 'science_focus': return grp('science');
    case 'trade_focus': return grp('economy');
    case 'seafarers': return grp('seafaring');
    case 'militarized': return grp('warfare');
    case 'goal_focused': return 0.25;
    case 'government': return Math.max(...['democracy', 'autocracy', 'theocracy'].map(grp));
    case 'happy_population': return mine.filter((c) => c.mood === 'happy').length / 4;
    case 'optimized_storage': return (Math.min(pl.res.food, 3) + Math.min(pl.res.wood, 3) + Math.min(pl.res.ore, 3)) / 9;
    case 'eureka': return Math.min(pl.res.ideas, 5) / 5 * 0.8;
    case 'wealth': return Math.min(pl.res.gold, 5) / 5 * 0.8;
    case 'ore_supplies': return Math.min(pl.res.ore, 5) / 5 * 0.8;
    case 'wood_supplies': return Math.min(pl.res.wood, 5) / 5 * 0.8;
    case 'food_supplies': return Math.min(pl.res.food, 5) / 5 * 0.8;
    case 'architecture': return ['academy', 'fortress', 'port', 'temple'].filter((t) => mine.some((c) => c.buildings[t] === q)).length / 4;
    case 'metropolis': return Math.max(0, ...mine.map(citySize)) / 5;
    case 'expansionist': return mine.length / 8;
    case 'large_fleet': return s.units.filter((u) => u.owner === q && u.type === 'ship').length / 4;
    case 'large_army': {
      const n = (pp) => s.units.filter((u) => u.owner === pp && isArmy(u)).length;
      return clamp01((n(q) - Math.max(...foes.map(n))) / 4) * 0.8;
    }
    case 'standing_army': return mine.filter((c) => s.units.some((u) => u.owner === q && isArmy(u) && u.hex === c.hex)).length / 4;
    case 'military_might': return s.units.filter((u) => u.owner === q && u.type !== 'settler').length / 12;
    case 'colony': return 0.2;
    case 'consulate': return 0.1;
    default: return 0.1;
  }
}

function objectiveValue(s, q) {
  let v = 0;
  for (const cardId of s.players[q].hand.objective) {
    const card = OBJECTIVE_CARDS[cardId];
    const best = Math.max(objectiveProgress(s, q, card.dev), objectiveProgress(s, q, card.mil));
    v += 4.4 * 0.55 * best * best;
  }
  return v;
}

/**
 * The Wonder card in hand that q is closest to building, or null. `ready` (0..1) discounts missing prerequisites,
 * `cover` (0..1) is the share of the cost already in the player's stock.
 */
export function wonderPlan(s, q) {
  const pl = s.players[q];
  if (!pl.hand.wonder.length || !pl.advances.includes('engineering')) return null;
  const mine = s.cities.filter((c) => c.owner === q);
  const roomy = mine.some((c) => citySize(c) + 1 <= citySizeCap(s, q));
  let best = null;
  for (const id of pl.hand.wonder) {
    const w = WONDERS[id];
    const need = w.cost;
    const total = need.food + need.wood + need.ore + need.culture;
    const have = Math.min(pl.res.food, need.food) + Math.min(pl.res.wood, need.wood) + Math.min(pl.res.ore, need.ore) + Math.min(pl.culture, need.culture);
    let ready = 1;
    if (!pl.advances.includes(w.advance)) ready *= 0.55;
    if (!roomy) ready *= 0.6;
    if (resLimit(s, q, 'food') < need.food) ready *= 0.6;
    const cover = have / total;
    if (!best || ready * cover > best.ready * best.cover) best = { id, need, ready, cover };
  }
  return best;
}

function resourceValue(s, q) {
  const pl = s.players[q];
  let v = 0;
  for (const r of ['food', 'wood', 'ore', 'ideas', 'gold']) {
    const have = pl.res[r];
    const full = Math.min(have, r === 'food' ? Math.min(resLimit(s, q, 'food'), 4) : 4);
    v += RES_WEIGHT[r] * full + 0.18 * Math.max(0, have - full);
  }
  const tokens = (n) => 0.38 * Math.min(n, 6) + 0.15 * Math.max(0, n - 6);
  v += tokens(pl.mood) + tokens(pl.culture);
  // Saving up for a Wonder is rewarded so the computer does not spend everything on the next Advance.
  const plan = wonderPlan(s, q);
  if (plan) v += WONDER_PLAN * plan.ready * plan.cover * plan.cover;
  return v;
}

/** Danger to q's cities and exposed armies from adjacent enemy forces, expressed as an expected loss. */
function danger(s, q, ix) {
  let pen = 0;
  const tally = (acc, u) => {
    acc.n += 1;
    if (u.type === 'cavalry') acc.horse += 1;
  };
  /** The Army units `owner` has on a hex: how many, and how many of them are Cavalry. */
  const armyOf = (k, owner) => {
    const acc = { n: 0, horse: 0 };
    for (const u of ix.units.get(k) || []) if (u.owner === owner && isArmy(u)) tally(acc, u);
    return acc;
  };
  for (const c of s.cities) {
    if (c.owner !== q) continue;
    const attackers = {};
    for (const n of nbrs(s, c.hex)) {
      for (const u of ix.units.get(n) || []) {
        if (u.owner !== q && isArmy(u) && canAttack(s, u.owner)) tally((attackers[u.owner] ||= { n: 0, horse: 0 }), u);
      }
    }
    const worst = Object.values(attackers).reduce((top, a) => (!top || a.n > top.n ? a : top), null);
    if (!worst) continue;
    const def = armyOf(c.hex, q);
    const odds = battleOdds(Math.min(worst.n, 5), def.n, { fortress: hasBuilding(c, 'fortress'), horseA: worst.horse, horseD: def.horse });
    const worth = CITY_BASE + 0.6 * (citySize(c) - 1) + 2.2 * Object.keys(c.buildings).length + 9 * c.wonders.length;
    pen += odds.win * (worth + 2 * def.n) * 0.55;
  }
  // Armies standing outside a city next to enemy armies
  const seen = new Set();
  for (const u of s.units) {
    if (u.owner !== q || !isArmy(u) || seen.has(u.hex)) continue;
    seen.add(u.hex);
    if (s.cities.some((c) => c.hex === u.hex && c.owner === q)) continue;
    const foes = { n: 0, horse: 0 };
    for (const n of nbrs(s, u.hex)) {
      for (const e of ix.units.get(n) || []) if (e.owner !== q && isArmy(e) && canAttack(s, e.owner)) tally(foes, e);
    }
    if (!foes.n) continue;
    const mine = armyOf(u.hex, q);
    const odds = battleOdds(Math.min(foes.n, 5), mine.n, { horseA: foes.horse, horseD: mine.horse });
    pen += odds.win * mine.n * 1.4 * 0.5;
  }
  return pen;
}

/** Value of one player's position. */
export function sideValue(s, q, cfg = DEFAULTS, ix = null) {
  ix = ix || { units: unitsByHex(s) };
  const pl = s.players[q];
  let v = 0;
  const claimed = claimedHexes(s, q);
  const mine = s.cities.filter((c) => c.owner === q);

  v += Math.min(mine.length, 4) * CITY_BASE + Math.max(0, mine.length - 4) * 4;
  for (const c of mine) {
    v += 0.6 * (citySize(c) - 1);
    v += 0.3 * Math.min(siteQuality(s, q, c.hex, new Set()), 5);
    if (c.mood === 'happy') v += 1.1;
    else if (c.mood === 'angry') v -= 1.4;
    for (const w of c.wonders) v += w.builder === q ? WONDER_BUILT : WONDER_HELD;
  }
  for (const c of s.cities) {
    for (const [type, colour] of Object.entries(c.buildings)) if (colour === q) v += BUILDING_VALUE[type];
    if (c.owner !== q) for (const w of c.wonders) if (w.builder === q) v += WONDER_HELD;
  }

  for (const id of pl.advances) v += advanceValue(id);
  v += pl.completed.length * 4.4;
  v += objectiveValue(s, q);
  v += resourceValue(s, q);
  v += 0.8 * Math.min(pl.hand.action.length, 3) + 0.3 * Math.max(0, pl.hand.action.length - 3);
  for (const id of pl.hand.wonder) v += pl.advances.includes(WONDERS[id].advance) ? 1.7 : 0.9;
  v += pl.vpBonus * 2.2;

  // Units
  const tactics = pl.advances.includes('tactics');
  const enemyCities = s.cities.filter((c) => c.owner !== q);
  let settlerValue = 0;
  for (const u of s.units) {
    if (u.owner !== q) continue;
    if (isArmy(u)) {
      v += (tactics ? 1.4 : 1.1) + (u.type === 'cavalry' ? 0.25 : 0);
      const home = mine.some((c) => c.hex === u.hex);
      if (!home && tactics && cfg.aggression > 0 && enemyCities.length) {
        const d = Math.min(...enemyCities.map((c) => hexDistance(c.hex, u.hex)));
        v += cfg.aggression * 0.11 * Math.max(0, 7 - d);
      }
    } else if (u.type === 'settler') {
      const site = bestSite(s, q, u.hex, ix, claimed);
      settlerValue += 1.5 + Math.min(2.4, Math.max(0, 0.75 * site.value));
    } else {
      v += 0.7;
    }
  }
  v += settlerValue;
  v -= danger(s, q, ix);
  return v;
}

/** Overall evaluation from player p's point of view: our position against the strongest and the average opponent. */
export function evaluate(s, p, cfg = DEFAULTS) {
  const ix = { units: unitsByHex(s) };
  let revealed = 0;
  for (const r of s.map.regions) if (r.flipped !== null) revealed += 1;
  const foes = foesOf(s, p).map((f) => sideValue(s, f, cfg, ix));
  const rivals = (Math.max(...foes) + foes.reduce((a, b) => a + b, 0) / foes.length) / 2;
  return sideValue(s, p, cfg, ix) - cfg.foe * rivals + 0.9 * revealed;
}

export { isHidden };
