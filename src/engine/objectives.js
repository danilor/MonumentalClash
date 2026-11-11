// Objective cards: event objectives complete right after their trigger, status objectives in the Status Phase.
import { BARBARIAN } from './data/constants.js';
import { OBJECTIVES, OBJECTIVE_CARDS } from './data/cards.js';
import { GROUPS } from './data/advances.js';
import { armyOf, citiesOf, cityAt, foesOf, hasBuilding, nbrs, unitsOf, hexDistance } from './queries.js';
import { gainRes } from './core.js';

const SUPPLY_COST = { eureka: 'ideas', wealth: 'gold', ore_supplies: 'ore', wood_supplies: 'wood', food_supplies: 'food' };

const owned = (s, p) => s.players[p].advances;
const ownsGroup = (s, p, group) => GROUPS[group].advances.every((a) => owned(s, p).includes(a.id));
const countBuilding = (s, p, type) => citiesOf(s, p).filter((c) => hasBuilding(c, type)).length;
const warfareCount = (s, p) => GROUPS.warfare.advances.filter((a) => owned(s, p).includes(a.id)).length;
const completeGroups = (s, p) => Object.keys(GROUPS).filter((gid) => ownsGroup(s, p, gid)).length;
const foeCities = (s, p) => foesOf(s, p).flatMap((f) => citiesOf(s, f));
/** Whether `measure` is higher for p than for every other player, by at least `margin`. */
const leads = (s, p, measure, margin = 1) => foesOf(s, p).every((f) => measure(p) >= measure(f) + margin);

/** Which fully-owned Governments are not yet used for a completed Government objective. */
function freeGovernment(s, p) {
  const used = s.players[p].completed.filter((c) => c.id === 'government').map((c) => c.detail);
  return ['democracy', 'autocracy', 'theocracy'].find((gid) => ownsGroup(s, p, gid) && !used.includes(gid)) || null;
}

/** Status objectives: returns { ok, detail? }. Does not spend anything. */
export function checkStatus(s, p, id) {
  const pl = s.players[p];
  const mine = citiesOf(s, p);
  const done = (obj) => pl.completed.some((c) => c.id === obj);
  switch (id) {
    case 'large_civ': return { ok: mine.length >= 6 };
    case 'science_lead': return { ok: leads(s, p, (x) => countBuilding(s, x, 'academy')) };
    case 'coastal_lead': return { ok: leads(s, p, (x) => countBuilding(s, x, 'port')) };
    case 'religious_fervor': return { ok: leads(s, p, (x) => countBuilding(s, x, 'temple')) };
    case 'fortifications': return { ok: leads(s, p, (x) => countBuilding(s, x, 'fortress')) };
    case 'advanced_culture': return { ok: pl.advances.length >= 6 && leads(s, p, (x) => owned(s, x).length) };
    case 'city_planner': return { ok: ownsGroup(s, p, 'construction') };
    case 'education_lead': return { ok: ownsGroup(s, p, 'education') };
    case 'culture_focus': return { ok: ownsGroup(s, p, 'culture') };
    case 'science_focus': return { ok: ownsGroup(s, p, 'science') };
    case 'trade_focus': return { ok: ownsGroup(s, p, 'economy') };
    case 'seafarers': return { ok: ownsGroup(s, p, 'seafaring') };
    case 'militarized': return { ok: ownsGroup(s, p, 'warfare') };
    case 'goal_focused': return { ok: leads(s, p, (x) => completeGroups(s, x)) };
    case 'government': {
      const gov = freeGovernment(s, p);
      return { ok: !!gov, detail: gov };
    }
    case 'happy_population': return { ok: mine.filter((c) => c.mood === 'happy').length >= 4 };
    case 'optimized_storage': return { ok: pl.res.food >= 3 && pl.res.wood >= 3 && pl.res.ore >= 3 };
    case 'eureka': return { ok: pl.res.ideas >= 5 };
    case 'wealth': return { ok: pl.res.gold >= 5 };
    case 'ore_supplies': return { ok: pl.res.ore >= 5 };
    case 'wood_supplies': return { ok: pl.res.wood >= 5 };
    case 'food_supplies': return { ok: pl.res.food >= 5 };
    case 'architecture':
      return { ok: ['academy', 'fortress', 'port', 'temple'].every((t) => mine.some((c) => c.buildings[t] === p)) };
    case 'colony':
      return { ok: pl.homeHex !== null && mine.some((c) => hexDistance(c.hex, pl.homeHex) >= 5) };
    case 'consulate':
      return { ok: foeCities(s, p).filter((c) => Object.values(c.buildings).includes(p)).length >= 2 };
    case 'metropolis': return { ok: mine.some((c) => 1 + Object.keys(c.buildings).length + c.wonders.length >= 5) };
    case 'expansionist':
      return { ok: mine.filter((c) => nbrs(s, c.hex).every((n) => !cityAt(s, n))).length >= 4 };
    case 'sea_blockade':
      return {
        ok: foeCities(s, p).some(
          (c) => c.port && s.units.filter((u) => u.type === 'ship' && u.owner === p && u.hex === c.port).length >= 2,
        ),
      };
    case 'large_fleet': {
      const mineShips = unitsOf(s, p, 'ship').length;
      return { ok: mineShips >= 4 || (mineShips >= 2 && leads(s, p, (x) => unitsOf(s, x, 'ship').length)) };
    }
    case 'large_army': return { ok: leads(s, p, (x) => armyOf(s, x).length, 4) };
    case 'standing_army':
      return {
        ok:
          !done('military_might') &&
          mine.filter((c) => armyOf(s, p).some((u) => u.hex === c.hex)).length >= 4,
      };
    case 'military_might':
      return { ok: !done('standing_army') && armyOf(s, p).length + unitsOf(s, p, 'ship').length >= 12 };
    case 'threat': {
      const foes = foesOf(s, p);
      const n = armyOf(s, p).filter((u) => nbrs(s, u.hex).some((h) => cityAt(s, h) && foes.includes(cityAt(s, h).owner))).length;
      return { ok: n >= 4 };
    }
    default: return { ok: false };
  }
}

export function objectiveSatisfiedNow(s, p, id) {
  return OBJECTIVES[id].kind === 'status' && checkStatus(s, p, id).ok;
}

function complete(g, p, cardId, side, detail = null) {
  const pl = g.s.players[p];
  const card = OBJECTIVE_CARDS[cardId];
  const id = card[side];
  const i = pl.hand.objective.indexOf(cardId);
  if (i < 0) return false;
  pl.hand.objective.splice(i, 1);
  pl.completed.push({ card: cardId, side, id, detail });
  g.log(`${g.name(p)} completes the Objective "${OBJECTIVES[id].name}" (+2 VP).`);
  g.emit({ type: 'objective', player: p, objective: id });
  return true;
}

/** Complete an event objective (if the player holds a matching card). */
export function completeEvent(g, p, objId) {
  if (p === BARBARIAN) return false;
  const hand = g.s.players[p].hand.objective;
  for (const cardId of hand) {
    const card = OBJECTIVE_CARDS[cardId];
    for (const side of ['mil', 'dev']) {
      if (card[side] === objId && OBJECTIVES[objId].kind === 'event') return complete(g, p, cardId, side);
    }
  }
  return false;
}

export function* onBattleEnd(g, res) {
  const s = g.s;
  for (const p of [res.attacker, res.defender]) {
    if (p === BARBARIAN) continue;
    const foe = p === res.attacker ? res.defender : res.attacker;
    const isAtk = p === res.attacker;
    const land = res.domain === 'land';
    const won = res.winner === p;
    const myStart = isAtk ? res.atkStart : res.defStart;
    const foeStart = isAtk ? res.defStart : res.atkStart;
    const myLost = isAtk ? res.atkLost : res.defLost;
    const k = res.kills[p] || { army: 0, settlers: 0, ships: 0 };
    const foePlayer = foe !== BARBARIAN;
    const hits = [];
    if (land && k.army >= 3) hits.push('warmonger');
    if (land && won && foeStart >= 2 && myLost === 0) hits.push('general');
    if (land && res.atkStart + res.defStart >= 6) hits.push('great_battle');
    if (won && foePlayer && myStart < foeStart) hits.push('defiance');
    if (won && foePlayer && (myStart < foeStart || warfareCount(s, foe) > warfareCount(s, p))) hits.push('bold');
    if (isAtk && res.captured && foePlayer && (res.defStart > 0 || res.fortress)) hits.push('conqueror');
    if (isAtk && res.captured && res.landed && foePlayer) hits.push('naval_assault');
    if (isAtk && land && res.cityId && res.citySize >= 5 && res.cityWonders >= 1 && res.atkStart >= 3 && foePlayer) hits.push('legendary_battle');
    if (k.settlers + k.ships >= 1) hits.push('scavenger');
    if (isAtk && land && won && k.army >= 2) hits.push('aggressor');
    if (isAtk && res.captured && foe === BARBARIAN && res.defStart >= 2) hits.push('barbarian_conquest');
    for (const id of hits) completeEvent(g, p, id);
  }
}

/** Status Phase: complete every Objective whose condition is met. Returns the number completed. */
export function completeStatusObjectives(g, p) {
  const s = g.s;
  const pl = s.players[p];
  let total = 0;
  let progress = true;
  while (progress) {
    progress = false;
    for (const cardId of [...pl.hand.objective]) {
      const card = OBJECTIVE_CARDS[cardId];
      for (const side of ['dev', 'mil']) {
        const id = card[side];
        if (OBJECTIVES[id].kind !== 'status') continue;
        const chk = checkStatus(s, p, id);
        if (!chk.ok) continue;
        if (pl.completed.some((c) => c.id === id) && id !== 'government') continue;
        const res = SUPPLY_COST[id];
        if (res) pl.res[res] -= 2;
        complete(g, p, cardId, side, chk.detail || null);
        total += 1;
        progress = true;
        break;
      }
      if (progress) break;
    }
  }
  return total;
}

export const supplyCost = SUPPLY_COST;
export { gainRes };
