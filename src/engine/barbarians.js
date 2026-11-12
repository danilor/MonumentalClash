// Barbarian spawning, moving and defending. Barbarian armies are controlled by the game itself.
import { BARBARIAN, PIECE_LIMITS, STACK_LIMIT } from './data/constants.js';
import { addCity } from './state.js';
import {
  allHexKeys, armyAt, bfs, cityAt, citiesOf, citySize, foesOf, hasCivAdv, hexDistance, isArmy, isLand, nbrs, settlementsLeft,
  unitById, unitsAt, unitsLeft,
} from './queries.js';
import { addUnitTo, applyPayment, canPay, planPayment } from './core.js';
import { choose, chooseMany, confirm } from './prompts.js';
import { plural } from './text.js';
import { battle } from './combat.js';

export const barbarianCities = (s) => s.cities.filter((c) => c.owner === BARBARIAN);
const landOnly = (s) => (n) => isLand(s, n);
const dist = (m, k) => (m.has(k) ? m.get(k) : Infinity);
const foeCitiesOf = (s, p) => foesOf(s, p).flatMap((f) => citiesOf(s, f));
const cityOption = (c) => ({ id: c.id, label: `City at ${c.hex}`, hex: c.hex });

/** Is there supply, and room under the stacking limit, for one more Barbarian Unit of this type on a hex? */
const hasRoom = (s, hex, type) => unitsLeft(s, BARBARIAN, type) > 0 && armyAt(s, hex, BARBARIAN).length < STACK_LIMIT;

/** Add one Barbarian Unit to a hex (respects supply and the stacking limit). */
export function addBarbarianUnit(g, hex, type = 'infantry') {
  if (!hasRoom(g.s, hex, type)) return null;
  return addUnitTo(g, BARBARIAN, type, hex);
}

/** A Barbarian city that already has an Infantry may receive a Cavalry or an Elephant in place of another Infantry. */
const mountAllowed = (s, hex, type) => hasRoom(s, hex, type)
  && unitsAt(s, hex).some((u) => u.owner === BARBARIAN && u.type === 'infantry');

const MOUNT_PROMPTS = {
  cavalry: { title: 'Barbarian Cavalry', a: 'a Cavalry' },
  elephant: { title: 'Barbarian Elephants', a: 'an Elephant' },
};

/** Which of these Barbarian cities get a Cavalry (or an Elephant) instead of an Infantry? The player may choose none, some or all. */
function* chooseMountedCities(g, p, cities, type) {
  const s = g.s;
  const eligible = cities.filter((c) => mountAllowed(s, c.hex, type));
  const max = Math.min(eligible.length, unitsLeft(s, BARBARIAN, type));
  if (max <= 0) return new Set();
  const ids = yield* chooseMany(g, p, {
    kind: 'pick_cities',
    title: MOUNT_PROMPTS[type].title,
    text: `These Barbarian cities already have an Infantry, so each may get ${MOUNT_PROMPTS[type].a} instead of another Infantry. Choose which ones do, or none.`,
    options: eligible.map(cityOption),
    min: 0,
    max,
    default: [],
  });
  return new Set(ids);
}

/** Land spaces the player units standing on `hex` may retreat to: no other owner's units or city, and room in the stack. */
function retreatHexes(s, hex) {
  const group = unitsAt(s, hex);
  if (!group.length) return [];
  const owner = group[0].owner;
  const armySize = group.filter(isArmy).length;
  return nbrs(s, hex).filter((n) => {
    if (!isLand(s, n) || unitsAt(s, n).some((u) => u.owner !== owner)) return false;
    const city = cityAt(s, n);
    return !(city && city.owner !== owner) && armyAt(s, n, owner).length + armySize <= STACK_LIMIT;
  });
}

function spawnCandidates(s, p, displace = false) {
  const mine = citiesOf(s, p);
  const foe = foeCitiesOf(s, p);
  const maps = mine.map((c) => bfs(s, c.hex, 3, landOnly(s)));
  const minDist = (k) => Math.min(...maps.map((m) => dist(m, k)));
  const free = allHexKeys(s).filter((k) => {
    const h = s.map.hexes[k];
    if (!isLand(s, k) || h.terrain === 'barren' || h.exhausted) return false;
    if (cityAt(s, k)) return false;
    const there = unitsAt(s, k);
    if (there.length && !(displace && there.every((u) => u.owner !== BARBARIAN) && retreatHexes(s, k).length)) return false;
    return !foe.some((c) => hexDistance(c.hex, k) < 2);
  });
  let cands = free.filter((k) => minDist(k) === 2);
  if (!cands.length) cands = free.filter((k) => minDist(k) === 1);
  return { cands, minDist, maps };
}

/** The player units on a space that is about to become Barbarian land retreat to an adjacent space of their owner's choice. */
function* retreatUnits(g, hex) {
  const s = g.s;
  const group = unitsAt(s, hex);
  const options = retreatHexes(s, hex);
  if (!group.length || !options.length) return;
  const owner = group[0].owner;
  const pick = yield* choose(g, owner, {
    kind: 'pick_hex',
    title: 'Retreat!',
    text: 'Barbarians settle on the space your units hold. Choose the adjacent space they retreat to.',
    options: options.map((k) => ({ id: k, label: k, hex: k })),
    default: options[0],
  });
  const to = options.includes(pick) ? pick : options[0];
  for (const u of group) u.hex = to;
  g.log(`${g.name(owner)}'s units retreat to ${to}.`);
}

/** Step 1 of a Barbarian spawn: a Settlement and an Infantry near the active player's cities. */
export function* placeBarbarianSettlement(g, p, { displace = false } = {}) {
  const s = g.s;
  if (settlementsLeft(s, BARBARIAN) <= 0 || unitsLeft(s, BARBARIAN, 'infantry') <= 0) return null;
  if (!citiesOf(s, p).length) return null;
  const { cands, maps } = spawnCandidates(s, p, displace);
  if (!cands.length) return null;
  const foeCities = foeCitiesOf(s, p);
  // A settlement that pushes a rival's army off its space is worth more than one that drives out the player's own.
  const push = (k) => {
    const there = unitsAt(s, k);
    return there.length ? (there[0].owner === p ? -15 : 15) : 0;
  };
  const score = (k) => {
    const far = maps.reduce((a, m) => a + Math.min(dist(m, k), 6), 0);
    const near = foeCities.length ? Math.min(...foeCities.map((c) => hexDistance(c.hex, k))) : 9;
    return far * 10 - near + push(k);
  };
  const ranked = cands.slice().sort((a, b) => score(b) - score(a));
  const pick = yield* choose(g, p, {
    kind: 'pick_hex',
    title: 'Barbarians appear!',
    text: displace
      ? 'Choose where the Barbarian Settlement is placed. Any units on that space retreat to an adjacent space.'
      : 'Choose where the Barbarian Settlement is placed.',
    options: ranked.map((k) => ({ id: k, label: k, hex: k })),
    default: ranked[0],
  });
  const hex = ranked.includes(pick) ? pick : ranked[0];
  if (unitsAt(s, hex).length) yield* retreatUnits(g, hex);
  const city = addCity(s, BARBARIAN, hex, 'neutral');
  addUnitTo(g, BARBARIAN, 'infantry', hex);
  g.emit({ type: 'barbarians', kind: 'spawn', hex });
  g.log('Barbarians settle near your lands!');
  return city;
}

function* reinforceChosenCity(g, p) {
  const s = g.s;
  const options = barbarianCities(s).filter((c) => hasRoom(s, c.hex, 'infantry') || mountAllowed(s, c.hex, 'cavalry') || mountAllowed(s, c.hex, 'elephant'));
  if (!options.length) return;
  const maps = citiesOf(s, p).map((c) => bfs(s, c.hex, 8, landOnly(s)));
  const far = (c) => Math.min(...maps.map((m) => dist(m, c.hex)));
  options.sort((a, b) => far(b) - far(a));
  const pick = yield* choose(g, p, {
    kind: 'pick_hex',
    title: 'Barbarians muster',
    text: 'Choose a Barbarian city that receives another Infantry. If it already has an Infantry, a Cavalry or an Elephant may take its place.',
    options: options.map((c) => ({ id: c.hex, label: c.hex, hex: c.hex })),
    default: options[0].hex,
  });
  const hex = options.some((c) => c.hex === pick) ? pick : options[0].hex;
  let type = 'infantry';
  const otherwise = () => (hasRoom(s, hex, 'infantry') ? 'Place an Infantry' : 'Place nothing');
  if (mountAllowed(s, hex, 'cavalry')) {
    const horse = yield* confirm(g, p, {
      kind: 'barbarian_cavalry',
      title: 'Barbarian Cavalry',
      text: 'This Barbarian city already has an Infantry, so it may get a Cavalry instead of another Infantry.',
      yes: 'Place a Cavalry',
      no: mountAllowed(s, hex, 'elephant') ? 'No Cavalry' : otherwise(),
      default: false,
    });
    if (horse) type = 'cavalry';
  }
  if (type === 'infantry' && mountAllowed(s, hex, 'elephant')) {
    const tusker = yield* confirm(g, p, {
      kind: 'barbarian_elephant',
      title: 'Barbarian Elephant',
      text: 'This Barbarian city already has an Infantry, so it may get an Elephant instead of another Infantry.',
      yes: 'Place an Elephant',
      no: otherwise(),
      default: false,
    });
    if (tusker) type = 'elephant';
  }
  addBarbarianUnit(g, hex, type);
  g.emit({ type: 'barbarians', kind: 'reinforce', hex });
}

export function* barbarianSpawn(g, p, opts = {}) {
  yield* placeBarbarianSettlement(g, p, opts);
  yield* reinforceChosenCity(g, p);
}

/** Whether a Barbarian spawn would put anything on the board for player `p` (Tribal Allies does not waste its use otherwise). */
export function canSpawnBarbarians(s, p) {
  if (!citiesOf(s, p).length) return false;
  const settle = settlementsLeft(s, BARBARIAN) > 0 && unitsLeft(s, BARBARIAN, 'infantry') > 0 && spawnCandidates(s, p).cands.length > 0;
  return settle || barbarianCities(s).some((c) => hasRoom(s, c.hex, 'infantry') || mountAllowed(s, c.hex, 'cavalry') || mountAllowed(s, c.hex, 'elephant'));
}

export function* barbarianMove(g, p) {
  const s = g.s;
  let cityMaps = [];
  // Rebuilt after every battle, because a Barbarian army may have captured one of the player's cities.
  const refresh = () => {
    cityMaps = citiesOf(s, p).map((c) => ({ city: c, map: bfs(s, c.hex, 12, landOnly(s)) }));
  };
  const nearest = (k) => Math.min(...cityMaps.map((cm) => dist(cm.map, k)));
  refresh();

  const hexes = [...new Set(s.units.filter((u) => u.owner === BARBARIAN && isArmy(u)).map((u) => u.hex))];
  const armies = hexes
    .filter((k) => nearest(k) <= 2)
    .map((k) => ({ from: k, d: nearest(k), ids: armyAt(s, k, BARBARIAN).map((u) => u.id) }))
    .sort((a, b) => a.d - b.d);
  if (!armies.length) {
    yield* placeBarbarianSettlement(g, p);
    return;
  }
  const steer = yield* hunnicSteering(g, p, armies.map((a) => a.from));

  while (armies.length) {
    // The player decides the order in which the armies move.
    let army = armies[0];
    if (armies.length > 1) {
      const hex = yield* choose(g, p, {
        kind: 'pick_hex',
        title: 'Barbarians advance',
        text: 'Choose which Barbarian army moves next.',
        options: armies.map((a) => ({ id: a.from, label: a.from, hex: a.from })),
        default: armies[0].from,
      });
      army = armies.find((a) => a.from === hex) || armies[0];
    }
    armies.splice(armies.indexOf(army), 1);
    yield* advanceBarbarianArmy(g, p, army, cityMaps, { steer });
    refresh();
  }

  // Step 3: an Infantry (or, where one is already stationed, optionally a Cavalry or an Elephant instead) in every
  // Barbarian city within 2 land spaces of the active player's cities.
  const near = barbarianCities(s).filter((c) => nearest(c.hex) <= 2);
  const horse = yield* chooseMountedCities(g, p, near, 'cavalry');
  const tuskers = yield* chooseMountedCities(g, p, near.filter((c) => !horse.has(c.id)), 'elephant');
  for (const c of near) {
    let type = 'infantry';
    if (horse.has(c.id) && mountAllowed(s, c.hex, 'cavalry')) type = 'cavalry';
    else if (tuskers.has(c.id) && mountAllowed(s, c.hex, 'elephant')) type = 'elephant';
    addBarbarianUnit(g, c.hex, type);
  }
}

/**
 * Hunnic Tribes (Huns): when an Event makes the Barbarians move, 1 Gold or 1 Culture - paid once, however many armies there
 * are - lets the Huns decide the direction each army takes. Returns whether the armies are steered (and the price is paid).
 */
function* hunnicSteering(g, p, hexes) {
  const s = g.s;
  if (!hasCivAdv(s, p, 'hunnic_tribes') || !hexes.length) return false;
  const options = [];
  if (canPay(s, p, { gold: 1 })) options.push({ id: 'gold', label: 'Pay 1 Gold' });
  if (canPay(s, p, { culture: 1 })) options.push({ id: 'culture', label: 'Pay 1 Culture' });
  if (!options.length) return false;
  // Worth a token only when an army stands next to somebody's units or city, so that its direction decides a battle.
  const contact = hexes.some((k) => nbrs(s, k).some((n) => isLand(s, n)
    && (unitsAt(s, n).some((u) => u.owner !== BARBARIAN) || (cityAt(s, n) && cityAt(s, n).owner !== BARBARIAN))));
  const pick = yield* choose(g, p, {
    kind: 'hunnic_tribes',
    title: 'Hunnic Tribes',
    text: 'The Barbarians are about to move. Pay 1 Gold or 1 Culture to decide the direction each Barbarian army takes.',
    options: [...options, { id: 'no', label: 'Let them march' }],
    default: contact ? options[0].id : 'no',
  });
  if (!options.some((o) => o.id === pick)) return false;
  applyPayment(g, p, planPayment(s, p, pick === 'gold' ? { gold: 1 } : { culture: 1 }));
  g.log(`${g.name(p)} pays 1 ${pick} to steer the Barbarians (Hunnic Tribes).`);
  return true;
}

/** Whether a Barbarian army may enter a space: a battle is fought there, or the stack has room for the group. */
function enterable(s, group, n) {
  const city = cityAt(s, n);
  const enemy = unitsAt(s, n).some((u) => u.owner !== BARBARIAN) || (city && city.owner !== BARBARIAN);
  return enemy || armyAt(s, n, BARBARIAN).length + group.length <= STACK_LIMIT;
}

/** The space a steered army enters: the Huns choose among every neighbouring land space. Null when it cannot move. */
function* steeredStep(g, p, from, group) {
  const s = g.s;
  const open = nbrs(s, from).filter((n) => isLand(s, n) && enterable(s, group, n));
  if (!open.length) return null;
  const foes = foeCitiesOf(s, p);
  const mine = citiesOf(s, p);
  const away = (k, cities) => (cities.length ? Math.min(...cities.map((c) => hexDistance(c.hex, k))) : 0);
  // Best first: a rival's units or city, then open ground nearer to the rivals and farther from the Huns' own cities.
  const score = (k) => {
    const there = unitsAt(s, k).filter((u) => u.owner !== BARBARIAN);
    const city = cityAt(s, k);
    const owner = there.length ? there[0].owner : city && city.owner !== BARBARIAN ? city.owner : null;
    if (owner === p) return -100;
    if (owner !== null) return 100 - there.length * 5;
    return away(k, mine) - away(k, foes);
  };
  const ranked = open.slice().sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));
  const pick = yield* choose(g, p, {
    kind: 'pick_hex',
    title: 'Hunnic Tribes',
    text: `Choose the space the Barbarian army at ${from} enters.`,
    options: ranked.map((k) => ({ id: k, label: k, hex: k })),
    default: ranked[0],
  });
  return ranked.includes(pick) ? pick : ranked[0];
}

/** The space an unsteered army enters: one step towards the nearest of the cities in `cityMaps`. Null when it stays. */
function* marchStep(g, p, from, group, cityMaps, auto) {
  const s = g.s;
  const dists = cityMaps.map((cm) => ({ cm, d: dist(cm.map, from) })).filter((x) => x.d < Infinity);
  if (!dists.length) return null;
  const best = Math.min(...dists.map((x) => x.d));
  const closest = dists.filter((x) => x.d === best);
  const target = auto ? closest[0].cm.city.id : yield* choose(g, p, {
    kind: 'pick_city',
    title: 'Barbarians advance',
    text: 'Several of your cities are equally close. Choose which one the Barbarians march on.',
    options: closest.map((x) => ({ id: x.cm.city.id, label: `City at ${x.cm.city.hex}`, hex: x.cm.city.hex })),
    default: closest[0].cm.city.id,
  });
  const tcm = closest.find((x) => x.cm.city.id === target) || closest[0];
  const steps = nbrs(s, from).filter((n) => isLand(s, n) && dist(tcm.cm.map, n) === best - 1);
  const open = steps.filter((n) => enterable(s, group, n));
  if (!open.length) return null;
  const dest = auto ? open[0] : yield* choose(g, p, {
    kind: 'pick_hex',
    title: 'Barbarians advance',
    text: 'Choose which space the Barbarian army enters.',
    options: open.map((k) => ({ id: k, label: k, hex: k })),
    default: open[0],
  });
  return open.includes(dest) ? dest : open[0];
}

/**
 * Tribal Allies (Celts): the defender may pay 1 Food per attacking Barbarian unit to call the attack off.
 * Returns true when it is cancelled (the payment is made).
 */
function* tribalAlliesCancel(g, defender, group, to) {
  const s = g.s;
  if (defender === BARBARIAN || !hasCivAdv(s, defender, 'tribal_allies')) return false;
  const plan = planPayment(s, defender, { food: group.length });
  if (!plan) return false;
  const city = cityAt(s, to);
  const cancel = yield* confirm(g, defender, {
    kind: 'tribal_allies_cancel',
    title: 'Tribal Allies',
    text: `${plural(group.length, 'Barbarian unit')} attack${group.length === 1 ? 's' : ''} you at ${to}. Pay ${group.length} Food to call the attack off?`,
    yes: `Pay ${group.length} Food`,
    no: 'Let them attack',
    default: (!!city && city.owner === defender) || group.length >= armyAt(s, to, defender).length,
    hex: to,
  });
  if (!cancel) return false;
  applyPayment(g, defender, plan);
  g.log(`${g.name(defender)} buys off the Barbarian attack at ${to} (Tribal Allies).`);
  return true;
}

/**
 * Moves one Barbarian army a single space towards the nearest of the cities in `cityMaps`. With `auto` nobody is asked
 * to choose a target or a space; with `steer` (Hunnic Tribes) the Huns choose the space instead. Returns the space the
 * army ends on, or null when it was wiped out.
 */
function* advanceBarbarianArmy(g, p, army, cityMaps, { auto = false, steer = false } = {}) {
  const s = g.s;
  const from = army.from;
  // Units that already moved (or died) in this step are not part of the army any more.
  const group = army.ids.map((id) => unitById(s, id)).filter((u) => u && u.hex === from);
  if (!group.length) return null;
  const to = steer ? yield* steeredStep(g, p, from, group) : yield* marchStep(g, p, from, group, cityMaps, auto);
  if (!to) return from;
  const occupants = unitsAt(s, to).filter((u) => u.owner !== BARBARIAN);
  const city = cityAt(s, to);
  const enemyCity = city && city.owner !== BARBARIAN ? city : null;
  const defender = occupants.length ? occupants[0].owner : enemyCity ? enemyCity.owner : null;
  if (defender !== null && (yield* tribalAlliesCancel(g, defender, group, to))) return from;
  g.emit({ type: 'barbarians', kind: 'move', from, hex: to });
  if (defender !== null) {
    yield* battle(g, {
      domain: 'land', attacker: BARBARIAN, defender, hex: to, from,
      units: group.map((u) => u.id), settlers: [], carried: [], landed: false, inPlace: false,
    });
  } else {
    for (const u of group) u.hex = to;
  }
  const alive = group.find((u) => unitById(s, u.id));
  return alive ? alive.hex : null;
}

const barbarianArmyHexes = (s) => [...new Set(s.units.filter((u) => u.owner === BARBARIAN && isArmy(u)).map((u) => u.hex))];

/** Barbarian Incursion: every Barbarian army marches one space towards the nearest city of any player. */
export function* barbarianIncursion(g, p) {
  const s = g.s;
  let cityMaps = [];
  const refresh = () => {
    cityMaps = s.cities.filter((c) => c.owner !== BARBARIAN).map((c) => ({ city: c, map: bfs(s, c.hex, 12, landOnly(s)) }));
  };
  const nearest = (k) => Math.min(...cityMaps.map((cm) => dist(cm.map, k)));
  refresh();
  const armies = barbarianArmyHexes(s)
    .map((k) => ({ from: k, d: nearest(k), ids: armyAt(s, k, BARBARIAN).map((u) => u.id) }))
    .filter((a) => a.d < Infinity)
    .sort((a, b) => a.d - b.d);
  if (!armies.length) g.log('No Barbarian army is in reach of a city.');
  const steer = yield* hunnicSteering(g, p, armies.map((a) => a.from));
  for (const army of armies) {
    yield* advanceBarbarianArmy(g, p, army, cityMaps, { auto: true, steer });
    refresh();
  }
}

/** Feuding Warlords: every Barbarian army next to a player's army attacks the weakest one it borders. */
export function* barbarianFeud(g) {
  const s = g.s;
  const fought = new Set();
  for (;;) {
    let strike = null;
    for (const from of barbarianArmyHexes(s).sort()) {
      const group = armyAt(s, from, BARBARIAN).filter((u) => !fought.has(u.id));
      if (!group.length) continue;
      const targets = nbrs(s, from)
        .filter((n) => isLand(s, n))
        .map((n) => ({ to: n, defenders: unitsAt(s, n).filter((u) => u.owner !== BARBARIAN && isArmy(u)) }))
        .filter((t) => t.defenders.length)
        .sort((a, b) => a.defenders.length - b.defenders.length || (a.to < b.to ? -1 : 1));
      if (targets.length) {
        strike = { from, group, ...targets[0] };
        break;
      }
    }
    if (!strike) return;
    for (const u of strike.group) fought.add(u.id);
    const defender = strike.defenders[0].owner;
    if (yield* tribalAlliesCancel(g, defender, strike.group, strike.to)) continue;
    g.emit({ type: 'barbarians', kind: 'move', from: strike.from, hex: strike.to });
    g.log(`Barbarian warlords strike ${g.name(defender)} at ${strike.to}.`);
    yield* battle(g, {
      domain: 'land', attacker: BARBARIAN, defender, hex: strike.to, from: strike.from,
      units: strike.group.map((u) => u.id), settlers: [], carried: [], landed: false, inPlace: false,
    });
  }
}

/**
 * Scourge of the Steppes: Barbarian Cavalry appears on the known land farthest from the largest city and rides on it.
 * They start at least 3 spaces from every city, so they cannot take one on the turn they appear.
 */
export function* steppeScourge(g, p) {
  const s = g.s;
  const seat = (c) => (c.owner - p + s.players.length) % s.players.length;
  const cities = s.cities.filter((c) => c.owner !== BARBARIAN);
  const target = cities.slice().sort((a, b) => citySize(b) - citySize(a) || seat(a) - seat(b))[0];
  const horsemen = Math.min(2, unitsLeft(s, BARBARIAN, 'cavalry'));
  if (!target || horsemen <= 0) return;
  const map = bfs(s, target.hex, 99, landOnly(s));
  const reach = (k) => Math.min(...cities.map((c) => hexDistance(c.hex, k)));
  const free = allHexKeys(s).filter((k) => isLand(s, k) && !cityAt(s, k) && !unitsAt(s, k).length && dist(map, k) < Infinity);
  const safe = free.filter((k) => reach(k) >= 3);
  const origin = (safe.length ? safe : free).sort((a, b) => dist(map, b) - dist(map, a) || (a < b ? -1 : 1))[0];
  if (!origin) return;
  for (let i = 0; i < horsemen; i++) addBarbarianUnit(g, origin, 'cavalry');
  g.emit({ type: 'barbarians', kind: 'spawn', hex: origin });
  g.log('Barbarian horsemen ride in from the steppes!');
  if (!safe.length) return;
  const steer = yield* hunnicSteering(g, p, [origin]);
  let army = { from: origin, ids: armyAt(s, origin, BARBARIAN).map((u) => u.id) };
  for (let step = 0; step < 2; step++) {
    const at = yield* advanceBarbarianArmy(g, p, army, [{ city: target, map }], { auto: true, steer });
    if (!at || at === army.from) break;
    army = { from: at, ids: army.ids };
  }
}

export { PIECE_LIMITS };
