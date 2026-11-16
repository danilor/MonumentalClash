// The Actions and Free Actions Leaders grant (Civilizations module). Every one is the single action
// `{ type: 'leader', ability: '<leader>_<a|b>', ...parameters }`; what the other abilities change sits where their rule lives.
// "AAA" abilities cost one of the 3 main actions, Free ones do not. `leaderActionList` offers them to the AI and to random play.
import { ADVANCES } from './data/advances.js';
import { BUILDINGS, BUILDING_COST } from './data/constants.js';
import { ACTION_CARDS, OBJECTIVES, OBJECTIVE_CARDS } from './data/cards.js';
import { LEADERS } from './data/leaders.js';
import {
  armyAt, buildingsLeft, cargoAt, cityAt, citySize, hasAdv, hexDistance, isArmy, isLand, isNpc, isSea, leaderCity, leaderIdOf,
  leaderOf, leaderUnit, nbrs, shipCap, shipsAt, stackLimit, unitById, unitsAt,
} from './queries.js';
import { RuleError, applyPayment, discardCard, drawActionCard, drawObjectiveCard, fail, gainRes, planPayment, unitFlags } from './core.js';
import { choose } from './prompts.js';
import { leaderAdvance, leaderAdvanceOptions, leaderTokens } from './advance.js';
import {
  addCosts, checkActivatable, constructBlocked, effMood, finishActivation, happinessAction, happinessRoom, leaderBuildPrice, markStart,
  performConstruct, performWonder, taxationAction, wonderBlocked, wonderChoices,
} from './city.js';
import { moveAction, moveOptions } from './move.js';
import { sizePay } from './civs.js';
import { regionOf, regionsWithCities } from './leaders.js';
import { plural } from './text.js';

const once = (t, key, who) => {
  if (t.used[key]) fail(`${who} can be used once per turn.`);
  t.used[key] = true;
};

/** The city of p that Leader `id` is in. */
function homeCity(g, p, id) {
  const city = leaderCity(g.s, p, id);
  if (!city) fail(`${LEADERS[id].name} must be in one of your cities.`);
  return city;
}

/** Start an action that activates `city`. */
function begin(g, city) {
  checkActivatable(g, city);
  markStart(g, city);
}

/** Wu Zetian, Sun Tzu, Pericles, Hiram: activate the Leader's city to buy an Advance of one category for a token instead of the Food. */
function* groupAdvance(g, p, a, leader, group) {
  const city = homeCity(g, p, leader);
  begin(g, city);
  if (!ADVANCES[a.advance]) fail('Choose an Advance.');
  g.spendAction();
  yield* leaderAdvance(g, p, a.advance, { swap: true, group, token: a.token });
  yield* finishActivation(g, city);
}

/** A free build in the Leader's city: the price of a Building plus `extra`, or (`a.wonder`) a Wonder. */
function* freeBuild(g, p, a, leader, key, extra, sacrifice) {
  const city = homeCity(g, p, leader);
  once(g.s.turn, key, LEADERS[leader].name);
  if (a.wonder) {
    if (!sacrifice) fail(`${LEADERS[leader].name} builds Buildings only.`);
    yield* performWonder(g, p, city, a.wonder, { spendAction: false, sacrifice });
    return;
  }
  yield* performConstruct(g, p, city, a.building, { portHex: a.port, templeBonus: a.templeBonus, spendAction: false, extra, sacrifice });
}

const cardName = (deck, id) => {
  if (deck === 'action') return ACTION_CARDS[id].name;
  const card = OBJECTIVE_CARDS[id];
  return `${OBJECTIVES[card.dev].name} / ${OBJECTIVES[card.mil].name}`;
};

/** A move that is a Free Action: it opens a Move of its own (one group) and leaves the Move action in progress as it was. */
function* freeMove(g, a, only) {
  const t = g.s.turn;
  const saved = t.move;
  t.move = { credits: 1, moved: {}, shipMoved: false, navUsed: false, only, free: true };
  try {
    yield* moveAction(g, a);
  } finally {
    t.move = saved;
  }
}

const ABILITIES = {
  *wu_zetian_a(g, p, a) {
    yield* groupAdvance(g, p, a, 'wu_zetian', 'agriculture');
  },
  *sun_tzu_a(g, p, a) {
    yield* groupAdvance(g, p, a, 'sun_tzu', 'warfare');
  },
  *pericles_a(g, p, a) {
    yield* groupAdvance(g, p, a, 'pericles', 'education');
  },
  *hiram_b(g, p, a) {
    yield* groupAdvance(g, p, a, 'hiram', 'construction');
  },

  *maharaja_a(g, p, a) {
    const city = homeCity(g, p, 'maharaja');
    begin(g, city);
    if (!ADVANCES[a.advance]) fail('Choose an Advance.');
    yield* leaderAdvance(g, p, a.advance, { newCategory: true, extra: { culture: 1 }, full: true });
    yield* finishActivation(g, city);
  },

  *darius_b(g, p, a) {
    yield* freeBuild(g, p, a, 'darius', 'darius', { culture: 2 }, 0);
  },
  *ahuitzotl_b(g, p, a) {
    yield* freeBuild(g, p, a, 'ahuitzotl', 'ahuitzotl', null, 2);
  },

  *cyrus_a(g, p, a) {
    const s = g.s;
    const pl = s.players[p];
    const city = homeCity(g, p, 'cyrus');
    begin(g, city);
    const n = Math.min(citySize(city), regionsWithCities(s, p).size);
    g.spendAction();
    let culture = a.culture;
    if (!Number.isInteger(culture) || culture < 0 || culture > n) {
      let cult = pl.culture;
      let mood = pl.mood;
      for (let i = 0; i < n; i++) {
        if (cult <= mood) cult += 1;
        else mood += 1;
      }
      culture = yield* choose(g, p, {
        kind: 'cyrus_tokens',
        title: 'Cyrus the Great',
        text: `Take ${plural(n, 'token')}: how many are Culture, how many Mood?`,
        options: Array.from({ length: n + 1 }, (_, k) => ({ id: String(k), label: `${k} Culture, ${n - k} Mood` })),
        default: String(cult - pl.culture),
      });
      culture = Number(culture);
    }
    gainRes(g, p, { culture, mood: n - culture });
    g.log(`${g.name(p)} gains ${culture} Culture and ${n - culture} Mood (Cyrus the Great).`);
    yield* finishActivation(g, city);
  },

  *augustus_a(g, p, a) {
    const s = g.s;
    const city = homeCity(g, p, 'augustus');
    begin(g, city);
    once(s.turn, 'augustus', 'Augustus');
    const deck = a.draw === 'objective' ? 'objective' : 'action';
    if (!s.decks[deck].length && !s.decks[`${deck}Discard`].length) fail(`There is no ${deck === 'action' ? 'Action' : 'Objective'} card to draw.`);
    g.spendAction();
    if (deck === 'action') yield* drawActionCard(g, p);
    else drawObjectiveCard(g, p);
    const hand = s.players[p].hand[deck];
    const ids = [...new Set(hand)];
    const gone = ids.includes(a.discard)
      ? a.discard
      : yield* choose(g, p, {
        kind: 'augustus',
        title: 'Emperor Augustus',
        text: `Discard ${deck === 'action' ? 'an Action' : 'an Objective'} card.`,
        options: ids.map((id) => ({ id, label: cardName(deck, id) })),
        default: ids[0],
      });
    if (gone && hand.includes(gone)) {
      hand.splice(hand.indexOf(gone), 1);
      discardCard(g, p, deck, gone);
      g.log(`${g.name(p)} discards ${deck === 'action' ? 'an Action' : 'an Objective'} card (Emperor Augustus).`);
    }
    yield* finishActivation(g, city);
  },

  *cleopatra_b(g, p) {
    const s = g.s;
    const city = homeCity(g, p, 'cleopatra');
    once(s.turn, 'cleopatra', 'Cleopatra');
    const plan = planPayment(s, p, { culture: 1 }, { noArena: true });
    if (!plan) fail('You need 1 Culture token.');
    applyPayment(g, p, plan);
    city.beloved = (city.beloved || 0) + 1;
    g.emit({ type: 'beloved', player: p, city: city.id });
    g.log(`${g.name(p)} places a Culture token in the city at ${city.hex} (Cleopatra).`);
    yield* [];
  },

  *eric_a(g, p, a, eric) {
    const s = g.s;
    const pl = s.players[p];
    if (!isSea(s, eric.hex)) fail('Eric the Red must be on a Ship.');
    const region = regionOf(s, eric.hex);
    if (pl.ericTokens.includes(region)) fail('Eric has a Culture token on this Region already.');
    const plan = planPayment(s, p, { culture: 1 }, { noArena: true });
    if (!plan) fail('You need 1 Culture token.');
    g.spendAction();
    applyPayment(g, p, plan);
    pl.ericTokens.push(region);
    g.emit({ type: 'eric_token', player: p, region, hex: eric.hex });
    g.log(`${g.name(p)} places a Culture token on a Region (Eric the Red): 1 VP.`);
    yield* [];
  },

  *eric_b(g, p, a, eric) {
    const s = g.s;
    if (!isSea(s, eric.hex)) fail('Eric the Red must be on a Ship.');
    const crew = [...new Set(a.units || [])].filter((id) => id !== eric.id);
    for (const id of crew) {
      const u = unitById(s, id);
      if (!u || u.owner !== p || u.hex !== eric.hex || u.type === 'ship') fail('Only Land units on board with Eric can go with him.');
    }
    yield* freeMove(g, { type: 'move', units: [eric.id, ...crew], to: a.to }, 'army');
  },

  *hanno_a(g, p, a, hanno) {
    const s = g.s;
    const t = s.turn;
    if (!isSea(s, hanno.hex)) fail('Hanno must be on a Ship.');
    const ids = [...new Set(a.ships || [])];
    const ships = ids.map((id) => unitById(s, id));
    if (!ships.length || ships.some((u) => !u || u.owner !== p || u.type !== 'ship' || u.hex !== hanno.hex)) fail('Choose the Ships Hanno sails with.');
    if (ships.some((u) => { const f = t.unitFlags[u.id] || {}; return f.moved || f.fought || f.stopped; })) fail('Hanno can only sail Ships that have not moved this turn.');
    once(t, 'hanno', 'Hanno');
    const aboard = cargoAt(s, hanno.hex).filter((u) => u.owner === p && u.id !== hanno.id).map((u) => u.id);
    const room = Math.max(0, ids.length * shipCap(s, p) - 1);
    const carry = [hanno.id, ...(Array.isArray(a.carry) ? a.carry.filter((id) => id !== hanno.id) : aboard.slice(0, room))];
    yield* freeMove(g, { type: 'move', units: ids, to: a.to, nav: a.nav, attack: a.attack, carry }, 'ships');
    for (const id of ids) if (unitById(s, id)) unitFlags(g, id).stopped = 'hanno';
  },

  *marqzen_b(g, p, a, marqzen) {
    const s = g.s;
    const unit = unitById(s, a.unit);
    if (!unit || unit.owner === p || isNpc(unit.owner) || !isLand(s, unit.hex) || hexDistance(unit.hex, marqzen.hex) !== 1) {
      fail("Choose an enemy player's Land unit next to Marqzen.");
    }
    const to = a.to;
    if (!to || !nbrs(s, unit.hex).includes(to)) fail('Choose a space next to the unit.');
    if (!isLand(s, to)) fail('The unit can only go to a revealed Land space.');
    if (hexDistance(to, marqzen.hex) <= 1) fail('The space must not be next to Marqzen.');
    const city = cityAt(s, to);
    if (unitsAt(s, to).some((u) => u.owner !== unit.owner) || (city && city.owner !== unit.owner)) fail('The unit cannot be moved into a battle.');
    if (isArmy(unit) && armyAt(s, to, unit.owner).length + 1 > stackLimit(s, unit.owner, to, [unit])) fail('That space is full.');
    once(s.turn, 'marqzen', 'Marqzen');
    g.spendAction();
    const from = unit.hex;
    unit.hex = to;
    g.emit({ type: 'move', player: unit.owner, units: [unit.id], from, to });
    g.log(`${g.name(p)} moves a ${unit.type} of ${g.name(unit.owner)} (Marqzen).`);
    yield* [];
  },

  *suiko_a(g, p, a) {
    const s = g.s;
    const city = homeCity(g, p, 'suiko');
    const b = a.building;
    const holder = city.buildings[b];
    if (holder === undefined || holder === p || b === 'obelisk') fail('Choose a piece of another player in this city (not an Obelisk).');
    if (buildingsLeft(s, p, b) <= 0) fail('You have no pieces of that building left.');
    if (!hasAdv(s, p, 'state_religion')) g.spendAction();
    city.buildings[b] = p;
    g.emit({ type: 'revert', player: p, city: city.id, building: b });
    g.log(`${g.name(p)} takes back the ${b} in the city at ${city.hex} (Empress Suiko).`);
    yield* [];
  },

  *caesar_a(g, p, a) {
    const city = homeCity(g, p, 'caesar');
    yield* happinessAction(g, { cities: [{ city: city.id, steps: a.steps || 1 }], caesar: true, pay: a.pay });
  },

  *cnut_b(g, p, a) {
    const city = homeCity(g, p, 'cnut');
    yield* taxationAction(g, { cnut: city.id, gain: a.gain });
  },
};

export const LEADER_ABILITY_IDS = Object.keys(ABILITIES);

/** Use a Leader's Action or Free Action. */
export function* leaderAction(g, a) {
  const s = g.s;
  const p = g.cur;
  if (!s.civs) fail('Leaders belong to the Civilizations module.');
  const m = /^(.+)_([ab])$/.exec(String(a.ability || ''));
  const leader = m && LEADERS[m[1]];
  const ability = leader && leader.abilities.find((x) => x.id === a.ability);
  if (!ability || ability.kind === 'passive' || !ABILITIES[a.ability]) fail('That is not an ability you can use.');
  const unit = leaderOf(s, p, m[1]);
  if (!unit) fail(`${leader.name} is not in play.`);
  yield* ABILITIES[a.ability](g, p, a, unit);
}

// ------------------------------------------------------------ candidates
/** Every way to take one Resource per city in Taxation (two kinds at most, to keep the list short). */
export function taxGains(s, p) {
  const n = s.cities.filter((c) => c.owner === p).length;
  const kinds = hasAdv(s, p, 'currency') ? ['food', 'wood', 'ore', 'gold'] : ['food', 'wood', 'ore'];
  const seen = new Set();
  const out = [];
  for (const a of kinds) {
    for (const b of kinds) {
      for (let k = 0; k <= n; k++) {
        const gain = {};
        gain[a] = (gain[a] || 0) + k;
        gain[b] = (gain[b] || 0) + (n - k);
        const key = JSON.stringify(Object.entries(gain).filter(([, v]) => v).sort());
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(gain);
      }
    }
  }
  return out;
}

/** Whether a Building could be built in `city` for its price plus `extra` (Darius and Ahuitzotl build with an extra price). */
function buildable(s, p, city, building, extra = null) {
  if (constructBlocked(s, p, city, building)) return false;
  const price = leaderBuildPrice(s, p, city, building, { ...BUILDING_COST });
  return !!planPayment(s, p, extra ? addCosts(price, extra) : price, sizePay(s, p, building, city));
}

const stuck = (t, u) => {
  const f = t.unitFlags[u.id];
  return !!(f && (f.moved || f.fought || f.stopped));
};

/** Run `fn` with a Move of its own open for `only` (what a Free Action Move opens), then put the real one back. */
function withFreeMove(t, only, fn) {
  const saved = t.move;
  t.move = { credits: 1, moved: {}, shipMoved: false, navUsed: false, only, free: true };
  try {
    return fn();
  } finally {
    t.move = saved;
  }
}

const activatable = (g, city) => {
  try {
    checkActivatable(g, city);
    return true;
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    return false;
  }
};

/**
 * What the Leader a player has in play could do right now, as { cat: 'leader', action, ability, ...meta }. Like the rest of
 * enumerateActions these are plausible rather than guaranteed legal.
 */
export function leaderActionList(g, p) {
  const s = g.s;
  const t = s.turn;
  const id = leaderIdOf(s, p);
  const unit = s.civs && id ? leaderUnit(s, p) : null;
  if (!unit) return [];
  const pl = s.players[p];
  const out = [];
  const add = (ability, params = {}, meta = {}) => out.push({ cat: 'leader', action: { type: 'leader', ability, ...params }, ability, leader: id, ...meta });
  const left = t.actionsLeft;
  const city = leaderCity(s, p, id);
  const ready = !!city && activatable(g, city);
  const hasCulture = !!planPayment(s, p, { culture: 1 }, { noArena: true });

  const groups = { wu_zetian: 'agriculture', sun_tzu: 'warfare', pericles: 'education', hiram: 'construction' };
  if (groups[id] && left > 0 && ready) {
    const opts = { group: groups[id], swap: true };
    const ability = `${id}_${id === 'hiram' ? 'b' : 'a'}`;
    for (const advance of leaderAdvanceOptions(s, p, opts)) {
      for (const token of leaderTokens(s, p, advance, opts)) add(ability, { advance, token }, { advance });
    }
  }
  if (id === 'maharaja' && ready) {
    for (const advance of leaderAdvanceOptions(s, p, { newCategory: true, extra: { culture: 1 }, full: true })) add('maharaja_a', { advance }, { advance });
  }
  if (id === 'darius' && city && !t.used.darius) {
    for (const building of BUILDINGS) {
      if (!buildable(s, p, city, building, { culture: 2 })) continue;
      if (building === 'temple') for (const templeBonus of ['mood', 'culture']) add('darius_b', { building, templeBonus }, { building });
      else add('darius_b', { building }, { building });
    }
  }
  if (id === 'ahuitzotl' && city && !t.used.ahuitzotl && pl.captives.length >= 2) {
    for (const building of BUILDINGS) {
      if (!buildable(s, p, city, building)) continue;
      if (building === 'temple') for (const templeBonus of ['mood', 'culture']) add('ahuitzotl_b', { building, templeBonus }, { building });
      else add('ahuitzotl_b', { building }, { building });
    }
    for (const wonder of wonderChoices(s, p, city)) if (!wonderBlocked(s, p, city, wonder)) add('ahuitzotl_b', { wonder }, { wonder });
  }
  if (id === 'cyrus' && left > 0 && ready) {
    const n = Math.min(citySize(city), regionsWithCities(s, p).size);
    for (const culture of new Set([0, Math.floor(n / 2), n])) add('cyrus_a', { culture }, { culture });
  }
  if (id === 'augustus' && left > 0 && ready && !t.used.augustus) {
    for (const draw of ['action', 'objective']) {
      if (s.decks[draw].length || s.decks[`${draw}Discard`].length) add('augustus_a', { draw }, { draw });
    }
  }
  if (id === 'cleopatra' && city && !t.used.cleopatra && hasCulture) add('cleopatra_b', {});
  if (id === 'eric' && isSea(s, unit.hex)) {
    if (left > 0 && hasCulture && !pl.ericTokens.includes(regionOf(s, unit.hex))) add('eric_a', {});
    const aboard = cargoAt(s, unit.hex).filter((u) => u.owner === p && u.id !== unit.id && !stuck(t, u)).map((u) => u.id);
    const seen = new Set();
    withFreeMove(t, 'army', () => {
      for (const crew of aboard.length ? [[], aboard] : [[]]) {
        for (const o of moveOptions(g, p, [unit.id, ...crew])) {
          const key = `${crew.length}:${o.to}`;
          if (seen.has(key) || o.roads || o.convert || !isLand(s, o.to)) continue;
          seen.add(key);
          add('eric_b', { units: [unit.id, ...crew], to: o.to }, { to: o.to, battle: !!o.battle });
        }
      }
    });
  }
  if (id === 'hanno' && !t.used.hanno && isSea(s, unit.hex)) {
    const fleet = shipsAt(s, unit.hex, p).filter((u) => !stuck(t, u));
    const sets = fleet.length > 1 ? [fleet.map((u) => u.id), ...fleet.map((u) => [u.id])] : fleet.length ? [fleet.map((u) => u.id)] : [];
    withFreeMove(t, 'ships', () => {
      for (const ships of sets) {
        for (const o of moveOptions(g, p, ships)) {
          if (o.convert) continue;
          add('hanno_a', { ships, to: o.to, ...(o.nav ? { nav: o.nav } : {}), ...(o.attack ? { attack: true } : {}) }, { to: o.to, battle: !!o.battle, explore: o.explore !== null });
        }
      }
    });
  }
  if (id === 'marqzen' && left > 0 && !t.used.marqzen) {
    for (const u of s.units) {
      if (u.owner === p || isNpc(u.owner) || !isLand(s, u.hex) || hexDistance(u.hex, unit.hex) !== 1) continue;
      for (const to of nbrs(s, u.hex)) {
        if (!isLand(s, to) || hexDistance(to, unit.hex) <= 1) continue;
        const there = cityAt(s, to);
        if (unitsAt(s, to).some((x) => x.owner !== u.owner) || (there && there.owner !== u.owner)) continue;
        add('marqzen_b', { unit: u.id, to }, { target: u.id, to });
      }
    }
  }
  if (id === 'suiko' && city && (left > 0 || hasAdv(s, p, 'state_religion'))) {
    for (const [building, holder] of Object.entries(city.buildings)) {
      if (holder !== p && building !== 'obelisk' && buildingsLeft(s, p, building) > 0) add('suiko_a', { building }, { building });
    }
  }
  if (id === 'caesar' && ready) {
    for (let steps = 1; steps <= happinessRoom(city); steps++) {
      if (planPayment(s, p, { mood: steps * citySize(city) })) add('caesar_a', { steps }, { steps });
    }
  }
  if (id === 'cnut' && left > 0 && ready && hasAdv(s, p, 'taxation') && !t.used.taxation && effMood(s, city) === 'happy') {
    for (const gain of taxGains(s, p)) add('cnut_b', { gain });
  }
  return out;
}

