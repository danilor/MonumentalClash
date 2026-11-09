// Candidate actions for the AI and for random-play tests. Candidates are plausible rather than guaranteed
// legal: callers simulate them (or apply them and accept the rejection).
import { BUILDINGS, RESOURCES, STACK_LIMIT } from './data/constants.js';
import { ACTION_CARDS, TOP_EFFECTS } from './data/cards.js';
import {
  armyAt, citiesOf, citySize, hasAdv, isPortCity, owns, playerOwnsWonder, resLimit,
} from './queries.js';
import { canPay, planPayment } from './core.js';
import { advanceCost, availableAdvances } from './advance.js';
import {
  cityCapacity, collectCandidates, constructBlocked, effMood, farCollectLimit, foundBlocked, happinessRoom,
  influenceBlocked, influenceTypes, isInfluenced, recruitBlocked, wonderBlocked,
} from './city.js';
import { moveOptions } from './move.js';
import { ADVANCES, GROUPS } from './data/advances.js';

const uniform = () => Object.fromEntries(RESOURCES.map((r) => [r, 1]));

/**
 * Good Collect picks for a city, steered by per-resource weights. Several "focus" variants are returned so
 * callers can compare them.
 */
export function collectPlans(s, p, city, weights = uniform()) {
  const cands = collectCandidates(s, p, city);
  if (!cands.length) return [];
  const cap = cityCapacity(s, city);
  const farMax = farCollectLimit(s, p);
  const have = s.players[p].res;
  const plans = new Map();
  for (const focus of [null, ...RESOURCES]) {
    const w = (r) => {
      if (have[r] >= resLimit(s, p, r)) return 0;
      return (weights[r] ?? 1) * (r === focus ? 3 : 1);
    };
    const scored = cands.map((c) => {
      let best = { r: c.opts[0], v: -1 };
      for (const r of c.opts) if (w(r) > best.v) best = { r, v: w(r) };
      return { c, ...best };
    }).sort((x, y) => y.v - x.v);
    const picks = [];
    let seas = 0;
    let far = 0;
    for (const e of scored) {
      if (picks.length >= cap) break;
      if (e.v <= 0 || (e.c.sea && seas >= 1) || (e.c.far && far >= farMax)) continue;
      picks.push({ hex: e.c.hex, res: e.r });
      if (e.c.sea) seas += 1;
      if (e.c.far) far += 1;
    }
    if (picks.length) plans.set(picks.map((x) => x.hex + x.res).sort().join('|'), picks);
  }
  return [...plans.values()];
}

/** Groups of units standing together that a player might move as one. */
export function moveGroups(s, p, hex) {
  const t = s.turn;
  const free = (u) => {
    const f = t.unitFlags[u.id];
    return !(f && (f.fought || f.stopped));
  };
  const here = s.units.filter((u) => u.owner === p && u.hex === hex && free(u));
  const ships = here.filter((u) => u.type === 'ship');
  const army = here.filter((u) => u.type === 'infantry');
  const settlers = here.filter((u) => u.type === 'settler');
  const groups = [];
  const ids = (list) => list.map((u) => u.id);
  if (ships.length) {
    groups.push(ids(ships));
    if (ships.length > 1) for (const sh of ships) groups.push([sh.id]);
  }
  for (let k = 1; k <= army.length; k++) groups.push(ids(army.slice(0, k)));
  if (settlers.length) {
    groups.push([settlers[0].id]);
    if (settlers.length > 1) groups.push(ids(settlers));
  }
  if (army.length && settlers.length) groups.push([...ids(army), settlers[0].id]);
  return groups;
}

function recruitVariants(g, p, city) {
  const s = g.s;
  const out = [];
  const cap = cityCapacity(s, city);
  const room = STACK_LIMIT - armyAt(s, city.hex, p).length;
  const port = isPortCity(city);
  const seen = new Set();
  const push = (units, extra = {}) => {
    const a = { type: 'recruit', city: city.id, units, ...extra };
    const k = JSON.stringify(a);
    if (seen.has(k)) return;
    seen.add(k);
    if (!recruitBlocked(g, p, city, a).why) out.push(a);
  };
  for (let inf = 0; inf <= Math.min(cap, room); inf++) {
    for (let st = 0; st + inf <= cap && st <= 2; st++) {
      for (let sh = 0; sh + st + inf <= cap && sh <= (port ? 2 : 0); sh++) {
        if (inf + st + sh === 0) continue;
        push({ infantry: inf, settler: st, ship: sh });
        if (inf && hasAdv(s, p, 'draft')) push({ infantry: inf, settler: st, ship: sh }, { draft: true });
        if (st && hasAdv(s, p, 'sanitation')) push({ infantry: inf, settler: st, ship: sh }, { sanitation: true });
      }
    }
  }
  return out;
}

/** Every plausible action for player `p` right now, as { cat, action, ...meta }. */
export function enumerateActions(g, p, { weights = uniform() } = {}) {
  const s = g.s;
  const t = s.turn;
  const pl = s.players[p];
  const out = [];
  const add = (cat, action, meta = {}) => out.push({ cat, action, ...meta });
  const left = t.actionsLeft;
  const mine = citiesOf(s, p);
  const activatable = (c) => {
    const n = t.activated[c.id] || 0;
    if (n === 0 || effMood(s, c) !== 'angry') return true;
    return !!t.angryBy[c.id] && !t.angryExtra[c.id];
  };

  if (left > 0) {
    for (const id of availableAdvances(s, p)) {
      const { cost } = advanceCost(s, p, id);
      if (!planPayment(s, p, cost, { ideasAsFood: true, ideasFirst: true })) continue;
      add('advance', { type: 'advance', advance: id }, { id });
      if (hasAdv(s, p, 'free_education') && id !== 'free_education') {
        add('advance', { type: 'advance', advance: id, freeEducation: true }, { id });
      }
    }
    const seenHex = new Set();
    for (const u of s.units) {
      if (u.owner !== p || u.type !== 'settler' || seenHex.has(u.hex)) continue;
      seenHex.add(u.hex);
      if (!foundBlocked(s, p, u.hex)) add('found', { type: 'found_city', unit: u.id }, { hex: u.hex });
    }
  }

  for (const c of mine) {
    if (!activatable(c)) continue;
    if (left > 0) {
      for (const picks of collectPlans(s, p, c, weights)) {
        const ore = picks.filter((x) => x.res === 'ore').length;
        add('collect', { type: 'collect', city: c.id, picks }, { city: c.id });
        if (ore >= 2 && hasAdv(s, p, 'metallurgy')) add('collect', { type: 'collect', city: c.id, picks, metallurgy: true }, { city: c.id });
      }
      for (const b of BUILDINGS) {
        if (constructBlocked(s, p, c, b)) continue;
        const freeFood = b === 'temple' && hasAdv(s, p, 'state_religion') && !t.used.stateReligion;
        if (!planPayment(s, p, { food: freeFood ? 0 : 1, wood: 1, ore: 1 })) continue;
        if (b === 'temple') {
          add('construct', { type: 'construct', city: c.id, building: b, templeBonus: 'mood' }, { city: c.id, building: b });
          add('construct', { type: 'construct', city: c.id, building: b, templeBonus: 'culture' }, { city: c.id, building: b });
        } else {
          add('construct', { type: 'construct', city: c.id, building: b }, { city: c.id, building: b });
        }
      }
      for (const w of pl.hand.wonder) {
        if (!wonderBlocked(s, p, c, w)) add('wonder', { type: 'construct_wonder', city: c.id, wonder: w }, { city: c.id, wonder: w });
      }
      for (const a of recruitVariants(g, p, c)) add('recruit', a, { city: c.id });
    }
  }
  if (hasAdv(s, p, 'economic_liberty') && t.collects === 0 && canPay(s, p, { mood: 1 })) {
    for (const c of mine) {
      if (!activatable(c)) continue;
      for (const picks of collectPlans(s, p, c, weights)) add('collect', { type: 'collect', city: c.id, picks, free: true }, { city: c.id });
    }
  }

  // Raising Mood
  const room = mine.filter((c) => happinessRoom(c) > 0);
  const moodTokens = (n) => canPay(s, p, { mood: n });
  for (const c of room) {
    for (let steps = 1; steps <= happinessRoom(c); steps++) {
      const cost = steps * citySize(c);
      if (left > 0 && moodTokens(cost)) add('happiness', { type: 'happiness', cities: [{ city: c.id, steps }] }, { city: c.id });
      if (hasAdv(s, p, 'voting') && moodTokens(cost + 1)) add('happiness', { type: 'happiness', free: true, cities: [{ city: c.id, steps }] }, { city: c.id });
      if (left > 0 && hasAdv(s, p, 'sports') && steps <= 2 && canPay(s, p, { culture: steps })) {
        add('happiness', { type: 'circus_sports', city: c.id, steps }, { city: c.id });
      }
    }
  }
  if (left > 0 && room.length > 1) {
    const cost = room.reduce((n, c) => n + citySize(c), 0);
    if (moodTokens(cost)) add('happiness', { type: 'happiness', cities: room.map((c) => ({ city: c.id, steps: 1 })) }, {});
  }

  // Influence Culture
  if (!t.influenceSuccess) {
    const targets = s.cities;
    for (const acting of mine) {
      if (!activatable(acting)) continue;
      for (const target of targets) {
        if (influenceBlocked(s, p, acting, target)) continue;
        const types = influenceTypes(s, p, target);
        for (const building of types) {
          if (left > 0) add('influence', { type: 'influence', city: acting.id, target: target.id, building }, { city: acting.id, target: target.id });
          if (hasAdv(s, p, 'arts') && !t.used.arts && canPay(s, p, { culture: 1 })) {
            add('influence', { type: 'influence', free: true, city: acting.id, target: target.id, building }, { city: acting.id, target: target.id });
          }
        }
        if (left > 0 && !isInfluenced(acting) && canPay(s, p, { culture: 1 }) && target.id !== acting.id) {
          if (!influenceBlocked(s, p, acting, target, 1)) {
            add('influence', { type: 'influence', city: acting.id, target: target.id, building: types[0], rangeBoost: 1 }, { city: acting.id, target: target.id });
          }
        }
      }
    }
  }

  // Movement. Moves that continue an open Move action do not cost an action.
  const hexes = [...new Set(s.units.filter((u) => u.owner === p).map((u) => u.hex))];
  for (const hex of hexes) {
    for (const ids of moveGroups(s, p, hex)) {
      for (const o of moveOptions(g, p, ids)) {
        if (o.fresh && left <= 0) continue;
        const action = { type: 'move', units: ids, to: o.to };
        if (o.roads) action.roads = true;
        if (o.nav) action.nav = o.nav;
        add('move', action, { ids, from: hex, to: o.to, kind: o.kind, battle: o.battle, explore: o.explore, roads: o.roads, fresh: o.fresh });
      }
    }
  }

  // Cards
  const seenCard = new Set();
  for (const id of pl.hand.action) {
    if (seenCard.has(id)) continue;
    seenCard.add(id);
    const top = TOP_EFFECTS[ACTION_CARDS[id].top];
    if (top.timing === 'action' && left <= 0) continue;
    add('card', { type: 'play_card', card: id }, { card: id, top: ACTION_CARDS[id].top });
  }

  // Free abilities
  if (hasAdv(s, p, 'taxation') && !t.used.taxation && left > 0 && canPay(s, p, { mood: 1 })) {
    const n = mine.length;
    const kinds = hasAdv(s, p, 'currency') ? ['food', 'wood', 'ore', 'gold'] : ['food', 'wood', 'ore'];
    const seen = new Set();
    for (const a of kinds) {
      for (const b of kinds) {
        for (let k = 0; k <= n; k++) {
          const gain = {};
          gain[a] = (gain[a] || 0) + k;
          gain[b] = (gain[b] || 0) + (n - k);
          const key = JSON.stringify(Object.entries(gain).filter(([, v]) => v).sort());
          if (seen.has(key)) continue;
          seen.add(key);
          add('tax', { type: 'taxation', gain }, {});
        }
      }
    }
  }
  if (left > 0 && hasAdv(s, p, 'civil_liberties')) add('civil', { type: 'civil_liberties' });
  if (hasAdv(s, p, 'bartering') && !t.used.bartering) {
    for (const id of new Set([...pl.hand.action, ...pl.hand.objective])) {
      for (const gain of ['gold', 'culture']) add('barter', { type: 'bartering', card: id, gain }, { card: id });
    }
  }
  if (hasAdv(s, p, 'theaters') && !t.used.theaters) {
    if (pl.mood > 0) add('theaters', { type: 'theaters', to: 'culture' });
    if (pl.culture > 0) add('theaters', { type: 'theaters', to: 'mood' });
  }
  if (hasAdv(s, p, 'absolute_power') && !t.used.absolutePower && pl.mood >= 2) add('power', { type: 'absolute_power' });
  if (hasAdv(s, p, 'forced_labor') && !t.forcedLabor && pl.mood >= 1) add('labor', { type: 'forced_labor' });
  if (playerOwnsWonder(s, p, 'great_library') && !t.used.greatLibrary) {
    for (const id of Object.keys(ADVANCES)) {
      if (!GROUPS[ADVANCES[id].group].gov && !owns(s, p, id)) add('library', { type: 'great_library', advance: id }, { id });
    }
  }
  if (playerOwnsWonder(s, p, 'great_statue') && !t.used.greatStatue) {
    for (const id of new Set(pl.hand.objective)) add('statue', { type: 'great_statue', card: id }, { card: id });
  }

  add('end', { type: 'end_turn' });
  return out;
}
