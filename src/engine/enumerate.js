// Candidate actions for the AI and for random-play tests. Candidates are plausible rather than guaranteed
// legal: callers simulate them (or apply them and accept the rejection).
import { ARMY_TYPES, BUILDINGS, RESOURCES, STACK_LIMIT } from './data/constants.js';
import { ACTION_CARDS, TOP_EFFECTS } from './data/cards.js';
import {
  armyAt, cargoAt, citiesOf, citySize, hasAdv, hasBuilding, hasCivAdv, isArmy, isPortCity, isSea, navyAt, owns, playerOwnsWonder,
  resLimit, shipCap, terrainOf, unitsLeft,
} from './queries.js';
import { canPay, planPayment } from './core.js';
import { advanceCost, availableAdvances } from './advance.js';
import {
  canBoostInfluence, cityCapacity, collectCandidates, constructBlocked, effMood, farCollectLimit, foundBlocked, happinessRoom,
  influenceBlocked, influenceOrigins, influenceTypes, recruitBlocked, wonderBlocked, zoroastrianTargets,
} from './city.js';
import { moveOptions } from './move.js';
import { CAPTIVE_LIMIT, canDraftShip, canMountHere, sizePay } from './civs.js';
import { hegemonyShips, hegemonySites } from './civActions.js';
import { canSpawnBarbarians } from './barbarians.js';
import { ADVANCES, GROUPS } from './data/advances.js';

const uniform = () => Object.fromEntries(RESOURCES.map((r) => [r, 1]));

/**
 * Good Collect picks for a city, steered by per-resource weights. Several "focus" variants are returned so
 * callers can compare them.
 */
export function collectPlans(s, p, city, weights = uniform(), extra = 0) {
  const cands = collectCandidates(s, p, city);
  if (!cands.length) return [];
  const cap = cityCapacity(s, city) + extra;
  const farMax = farCollectLimit(s, p);
  const have = s.players[p].res;
  const captiveRoom = CAPTIVE_LIMIT - s.players[p].captives.length;
  const plans = new Map();
  for (const focus of [null, ...RESOURCES]) {
    const w = (r) => {
      if (r === 'captive') return captiveRoom > 0 ? (weights.captive ?? 1.2) : 0;
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
    let captives = 0;
    for (const e of scored) {
      if (picks.length >= cap) break;
      if (e.v <= 0 || (e.c.sea && seas >= 1) || (e.c.far && far >= farMax)) continue;
      if (e.r === 'captive' && captives >= captiveRoom) continue;
      picks.push({ hex: e.c.hex, res: e.r });
      if (e.r === 'captive') captives += 1;
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
  const army = here.filter(isArmy);
  const settlers = here.filter((u) => u.type === 'settler');
  const groups = [];
  const seen = new Set();
  const ids = (list) => list.map((u) => u.id);
  const add = (group) => {
    const key = [...group].sort().join(',');
    if (seen.has(key)) return;
    seen.add(key);
    groups.push(group);
  };
  if (ships.length) {
    add(ids(ships));
    if (ships.length > 1) for (const sh of ships) add([sh.id]);
  }
  // A mixed Army is offered once for each kind that could lead the attack (Infantry, Cavalry or Elephants first).
  for (const lead of ARMY_TYPES) {
    const ordered = [...army.filter((u) => u.type === lead), ...army.filter((u) => u.type !== lead)];
    for (let k = 1; k <= ordered.length; k++) add(ids(ordered.slice(0, k)));
  }
  if (settlers.length) {
    add([settlers[0].id]);
    if (settlers.length > 1) add(ids(settlers));
  }
  if (army.length && settlers.length) add([...ids(army), settlers[0].id]);
  return groups;
}

function recruitVariants(g, p, city) {
  const s = g.s;
  const out = [];
  const base = cityCapacity(s, city);
  // Ballcourts: pay 1 Mood to recruit as if the city were 1 size larger.
  const ball = hasCivAdv(s, p, 'ballcourts') && effMood(s, city) !== 'angry' && canPay(s, p, { mood: 1 });
  const cap = base + (ball ? 1 : 0);
  const room = STACK_LIMIT - armyAt(s, city.hex, p).length;
  const port = isPortCity(city);
  const market = hasBuilding(city, 'market');
  const draft = hasAdv(s, p, 'draft');
  const pays = [null, ...(hasCivAdv(s, p, 'mercenaries') ? ['gold'] : []), ...(hasCivAdv(s, p, 'spartans') ? ['culture'] : [])];
  const seen = new Set();
  const push = (units, extra = {}) => {
    const total = Object.values(units).reduce((n, x) => n + x, 0) + (extra.draftCard ? 1 : 0);
    const a = { type: 'recruit', city: city.id, units, ...extra, ...(total > base ? { ballcourts: true } : {}) };
    const k = JSON.stringify(a);
    if (seen.has(k)) return;
    seen.add(k);
    if (!recruitBlocked(g, p, city, a).why) out.push(a);
  };
  // Draft can pay for an Infantry, or a Ship (Mercenaries), or an Action card (Shogunate); Gold (Mercenaries) or Culture (Spartans) may pay for it.
  const drafts = (units) => {
    if (!draft) return;
    for (const draftWith of pays) {
      const w = draftWith ? { draftWith } : {};
      if (units.infantry) push(units, { draft: true, ...w });
      if (units.ship && canDraftShip(s, p, city)) push(units, { draftShip: true, ...w });
      if (hasCivAdv(s, p, 'shogunate')) push(units, { draftCard: true, ...w });
    }
  };
  drafts({ infantry: 0, cavalry: 0, elephant: 0, settler: 0, ship: 0 });
  // Cavalry and Elephants (at most two mounted Units at a time, to keep the list short) need a Market, or a power that lets every city build them.
  const cavalryOk = market || canMountHere(s, p, 'cavalry');
  const elephantsOk = market || canMountHere(s, p, 'elephant');
  const mounted = [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [1, 1]].filter(([cav, ele]) => (!cav || cavalryOk) && (!ele || elephantsOk));
  for (let inf = 0; inf <= Math.min(cap, room); inf++) {
    for (const [cav, ele] of mounted) {
      if (inf + cav + ele > Math.min(cap, room)) continue;
      for (let st = 0; st + inf + cav + ele <= cap && st <= 2; st++) {
        for (let sh = 0; sh + st + inf + cav + ele <= cap && sh <= (port ? 2 : 0); sh++) {
          if (inf + cav + ele + st + sh === 0) continue;
          const units = { infantry: inf, cavalry: cav, elephant: ele, settler: st, ship: sh };
          push(units);
          drafts(units);
          if (st && hasAdv(s, p, 'sanitation')) push(units, { sanitation: true });
        }
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

  // Advances. Peace and Poetry pays the Food with 1 Mood; Rome's Aqueducts buy Sanitation for 2 Food but no action.
  for (const id of availableAdvances(s, p)) {
    const opts = { ideasAsFood: true, ideasFirst: true };
    const { cost } = advanceCost(s, p, id);
    if (left > 0) {
      if (planPayment(s, p, cost, opts)) {
        add('advance', { type: 'advance', advance: id }, { id });
        if (hasAdv(s, p, 'free_education') && id !== 'free_education') {
          add('advance', { type: 'advance', advance: id, freeEducation: true }, { id });
        }
      }
      if (cost.food && hasCivAdv(s, p, 'peace_and_poetry') && !t.used.peacePoetry) {
        const { food, ...rest } = cost;
        if (planPayment(s, p, { ...rest, mood: 1 }, opts)) add('advance', { type: 'advance', advance: id, peace: true }, { id });
      }
    }
    if (id === 'sanitation' && hasCivAdv(s, p, 'aqueducts')) {
      const full = advanceCost(s, p, id, { full: true }).cost;
      if (planPayment(s, p, full, opts)) add('advance', { type: 'advance', advance: id, noAction: true }, { id });
    }
  }
  if (left > 0) {
    const seenHex = new Set();
    for (const u of s.units) {
      if (u.owner !== p || u.type !== 'settler' || seenHex.has(u.hex)) continue;
      seenHex.add(u.hex);
      if (!foundBlocked(s, p, u.hex)) add('found', { type: 'found_city', unit: u.id }, { hex: u.hex });
    }
  }

  // Every way a Collect with these picks may be taken: Metallurgy and Aztec Gold change what the Ore becomes.
  const collects = (c, picks, base = {}) => {
    add('collect', { type: 'collect', city: c.id, picks, ...base }, { city: c.id });
    if (base.free) return;
    const ore = picks.filter((x) => x.res === 'ore').length;
    if (ore >= 2 && hasAdv(s, p, 'metallurgy')) add('collect', { type: 'collect', city: c.id, picks, metallurgy: true }, { city: c.id });
    if (hasCivAdv(s, p, 'aztec_gold') && !t.used.aztecGold && picks.some((x) => x.res === 'ore' && terrainOf(s, x.hex) === 'mountain')) {
      for (const aztecGold of ['gold', 'culture']) add('collect', { type: 'collect', city: c.id, picks, aztecGold }, { city: c.id });
    }
  };

  for (const c of mine) {
    if (!activatable(c)) continue;
    if (left > 0) {
      for (const picks of collectPlans(s, p, c, weights)) collects(c, picks);
      if (hasCivAdv(s, p, 'ballcourts') && effMood(s, c) !== 'angry' && canPay(s, p, { mood: 1 })) {
        for (const picks of collectPlans(s, p, c, weights, 1)) {
          if (picks.length > cityCapacity(s, c)) add('collect', { type: 'collect', city: c.id, picks, ballcourts: true }, { city: c.id });
        }
      }
      for (const b of BUILDINGS) {
        if (constructBlocked(s, p, c, b)) continue;
        const freeFood = b === 'temple' && hasAdv(s, p, 'state_religion') && !t.used.stateReligion;
        if (!planPayment(s, p, { food: freeFood ? 0 : 1, wood: 1, ore: 1 }, sizePay(s, p, b))) continue;
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
      for (const picks of collectPlans(s, p, c, weights)) collects(c, picks, { free: true });
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
    const unitTargets = zoroastrianTargets(s, p);
    const arts = hasAdv(s, p, 'arts') && !t.used.arts;
    const artsMood = arts && hasCivAdv(s, p, 'hellenization') && canPay(s, p, { mood: 2 });
    for (const acting of influenceOrigins(s, p)) {
      if (acting.owner === p && !acting.settlers && !activatable(acting)) continue;
      const from = acting.settlers
        ? { unit: s.units.find((u) => u.owner === p && u.type === 'settler' && u.hex === acting.hex).id }
        : { city: acting.id };
      for (const target of s.cities) {
        if (influenceBlocked(s, p, acting, target)) continue;
        const types = influenceTypes(s, p, target);
        const meta = { city: acting.id, target: target.id };
        for (const building of types) {
          if (left > 0) add('influence', { type: 'influence', ...from, target: target.id, building }, meta);
          if (arts && canPay(s, p, { culture: 1 })) add('influence', { type: 'influence', free: true, ...from, target: target.id, building }, meta);
          if (artsMood) add('influence', { type: 'influence', free: true, artsMood: true, ...from, target: target.id, building }, meta);
        }
        if (left > 0 && canBoostInfluence(s, p, acting, target) && canPay(s, p, { culture: 1 }) && target.id !== acting.id) {
          if (!influenceBlocked(s, p, acting, target, 1)) {
            add('influence', { type: 'influence', ...from, target: target.id, building: types[0], rangeBoost: 1 }, meta);
          }
        }
      }
      if (acting.settlers) continue;
      for (const unit of unitTargets) {
        if (influenceBlocked(s, p, acting, unit)) continue;
        const meta = { city: acting.id, target: unit.id };
        if (left > 0) add('influence', { type: 'influence', city: acting.id, targetUnit: unit.id }, meta);
        if (arts && canPay(s, p, { culture: 1 })) add('influence', { type: 'influence', free: true, city: acting.id, targetUnit: unit.id }, meta);
        if (artsMood) add('influence', { type: 'influence', free: true, artsMood: true, city: acting.id, targetUnit: unit.id }, meta);
      }
    }
  }

  // Movement. Moves that continue an open Move action do not cost an action.
  const moveAdd = (ids, hex, cityId = null) => {
    for (const o of moveOptions(g, p, ids, cityId)) {
      if (o.fresh && left <= 0) continue;
      const action = { type: 'move', units: ids, to: o.to };
      if (cityId) action.city = cityId;
      if (o.roads) action.roads = true;
      if (o.nav) action.nav = o.nav;
      if (o.convert) {
        action.convert = true;
        if (o.convert.into) action.into = o.convert.into;
      }
      if (o.attack) action.attack = true;
      add('move', action, { ids, from: hex, to: o.to, kind: o.kind, battle: o.battle, explore: o.explore, roads: o.roads, fresh: o.fresh });
    }
  };
  const hexes = [...new Set(s.units.filter((u) => u.owner === p).map((u) => u.hex))];
  for (const hex of hexes) {
    for (const ids of moveGroups(s, p, hex)) moveAdd(ids, hex);
  }
  // Nomads: a size-1 city that is not Angry may move, alone or with the land units that stand in it.
  if (hasCivAdv(s, p, 'nomads')) {
    const stuck = (u) => {
      const f = t.unitFlags[u.id];
      return !!(f && (f.fought || f.stopped));
    };
    for (const c of mine) {
      if (citySize(c) !== 1 || effMood(s, c) === 'angry') continue;
      moveAdd([], c.hex, c.id);
      const crew = s.units.filter((u) => u.owner === p && u.hex === c.hex && u.type !== 'ship' && !stuck(u)).map((u) => u.id);
      if (crew.length) moveAdd(crew, c.hex, c.id);
    }
  }

  // Cards
  const seenCard = new Set();
  for (const id of pl.hand.action) {
    if (seenCard.has(id)) continue;
    seenCard.add(id);
    const top = TOP_EFFECTS[ACTION_CARDS[id].top];
    if (top.timing === 'with') continue;
    if (top.timing === 'action' && left <= 0 && !hasCivAdv(s, p, 'shogunate')) continue;
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

  // Civilization actions
  if (hasCivAdv(s, p, 'hegemony') && left > 0) {
    const seen = new Set();
    for (const ship of hegemonyShips(s, p)) {
      const key = `${ship.hex}:${ship.owner}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const army = cargoAt(s, ship.hex).filter((u) => u.owner === p && isArmy(u));
      const others = navyAt(s, ship.hex, p).filter((x) => x.id !== ship.id).length * shipCap(s, p);
      for (const to of hegemonySites(s, p, ship)) {
        const over = Math.max(0, armyAt(s, to, p).length + army.length - STACK_LIMIT);
        const stay = army.slice(army.length - over).map((u) => u.id);
        if (stay.length > others) continue;
        add('hegemony', { type: 'hegemony', unit: ship.id, to, ...(stay.length ? { stay } : {}) }, { unit: ship.id, to });
      }
    }
  }
  if (t.sprawl && hasCivAdv(s, p, 'sprawling')) add('sprawl', { type: 'sprawl' });
  if (hasCivAdv(s, p, 'fighting_bands') && !t.used.fightingBands) {
    for (const hex of hexes) {
      const settlers = s.units.filter((u) => u.owner === p && u.hex === hex && u.type === 'settler');
      const infantry = s.units.filter((u) => u.owner === p && u.hex === hex && u.type === 'infantry');
      if (settlers.length && unitsLeft(s, p, 'infantry') >= settlers.length
        && (isSea(s, hex) || armyAt(s, hex, p).length + settlers.length <= STACK_LIMIT)) {
        add('bands', { type: 'fighting_bands', units: settlers.map((u) => u.id) }, { hex, to: 'infantry' });
      }
      if (infantry.length && unitsLeft(s, p, 'settler') >= infantry.length) {
        add('bands', { type: 'fighting_bands', units: infantry.map((u) => u.id) }, { hex, to: 'settler' });
      }
    }
  }
  if (hasCivAdv(s, p, 'tribal_allies') && !t.used.tribalAllies && canSpawnBarbarians(s, p)) add('tribal', { type: 'tribal_allies' });
  if (hasCivAdv(s, p, 'human_sacrifice') && pl.captives.length) {
    for (const k of ['food', 'mood', 'culture']) add('sacrifice', { type: 'human_sacrifice', gain: { [k]: pl.captives.length } }, { gain: k });
    for (const k of ['food', 'mood', 'culture']) {
      if (pl.captives.length > 1) add('sacrifice', { type: 'human_sacrifice', gain: { [k]: 1 } }, { gain: k });
    }
  }
  if (hasCivAdv(s, p, 'calendar')) add('calendar', { type: 'calendar' });

  add('end', { type: 'end_turn' });
  return out;
}
