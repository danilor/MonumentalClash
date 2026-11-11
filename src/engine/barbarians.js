// Barbarians: spawning, moving and defending. Barbarian armies are controlled by the game itself.
import { BARBARIAN, PIECE_LIMITS, STACK_LIMIT } from './data/constants.js';
import { addCity } from './state.js';
import {
  allHexKeys, armyAt, bfs, cityAt, citiesOf, foesOf, hexDistance, isLand, nbrs, settlementsLeft, unitById, unitsAt, unitsLeft,
} from './queries.js';
import { addUnitTo } from './core.js';
import { choose } from './prompts.js';
import { battle } from './combat.js';

export const barbarianCities = (s) => s.cities.filter((c) => c.owner === BARBARIAN);
const landOnly = (s) => (n) => isLand(s, n);
const dist = (m, k) => (m.has(k) ? m.get(k) : Infinity);
const foeCitiesOf = (s, p) => foesOf(s, p).flatMap((f) => citiesOf(s, f));

/** Add one Barbarian Infantry to a hex (respects supply and the stacking limit). */
export function addBarbarianInfantry(g, hex) {
  const s = g.s;
  if (unitsLeft(s, BARBARIAN, 'infantry') <= 0) return null;
  if (armyAt(s, hex, BARBARIAN).length >= STACK_LIMIT) return null;
  return addUnitTo(g, BARBARIAN, 'infantry', hex);
}

function spawnCandidates(s, p) {
  const mine = citiesOf(s, p);
  const foe = foeCitiesOf(s, p);
  const maps = mine.map((c) => bfs(s, c.hex, 3, landOnly(s)));
  const minDist = (k) => Math.min(...maps.map((m) => dist(m, k)));
  const free = allHexKeys(s).filter((k) => {
    const h = s.map.hexes[k];
    if (!isLand(s, k) || h.terrain === 'barren' || h.exhausted) return false;
    if (cityAt(s, k) || unitsAt(s, k).length) return false;
    return !foe.some((c) => hexDistance(c.hex, k) < 2);
  });
  let cands = free.filter((k) => minDist(k) === 2);
  if (!cands.length) cands = free.filter((k) => minDist(k) === 1);
  return { cands, minDist, maps };
}

/** Step 1 of a Barbarian spawn: a Settlement and an Infantry near the active player's cities. */
export function* placeBarbarianSettlement(g, p) {
  const s = g.s;
  if (settlementsLeft(s, BARBARIAN) <= 0 || unitsLeft(s, BARBARIAN, 'infantry') <= 0) return null;
  if (!citiesOf(s, p).length) return null;
  const { cands, maps } = spawnCandidates(s, p);
  if (!cands.length) return null;
  const foeCities = foeCitiesOf(s, p);
  const score = (k) => {
    const far = maps.reduce((a, m) => a + Math.min(dist(m, k), 6), 0);
    const near = foeCities.length ? Math.min(...foeCities.map((c) => hexDistance(c.hex, k))) : 9;
    return far * 10 - near;
  };
  const ranked = cands.slice().sort((a, b) => score(b) - score(a));
  const pick = yield* choose(g, p, {
    kind: 'pick_hex',
    title: 'Barbarians appear!',
    text: 'Choose where the Barbarian Settlement is placed.',
    options: ranked.map((k) => ({ id: k, label: k, hex: k })),
    default: ranked[0],
  });
  const hex = ranked.includes(pick) ? pick : ranked[0];
  const city = addCity(s, BARBARIAN, hex, 'neutral');
  addUnitTo(g, BARBARIAN, 'infantry', hex);
  g.emit({ type: 'barbarians', kind: 'spawn', hex });
  g.log('Barbarians settle near your lands!');
  return city;
}

function* reinforceChosenCity(g, p) {
  const s = g.s;
  const options = barbarianCities(s).filter(
    (c) => armyAt(s, c.hex, BARBARIAN).length < STACK_LIMIT && unitsLeft(s, BARBARIAN, 'infantry') > 0,
  );
  if (!options.length) return;
  const maps = citiesOf(s, p).map((c) => bfs(s, c.hex, 8, landOnly(s)));
  const far = (c) => Math.min(...maps.map((m) => dist(m, c.hex)));
  options.sort((a, b) => far(b) - far(a));
  const pick = yield* choose(g, p, {
    kind: 'pick_hex',
    title: 'Barbarians muster',
    text: 'Choose a Barbarian city that receives another Infantry.',
    options: options.map((c) => ({ id: c.hex, label: c.hex, hex: c.hex })),
    default: options[0].hex,
  });
  addBarbarianInfantry(g, options.find((c) => c.hex === pick) ? pick : options[0].hex);
  g.emit({ type: 'barbarians', kind: 'reinforce', hex: pick });
}

export function* barbarianSpawn(g, p) {
  yield* placeBarbarianSettlement(g, p);
  yield* reinforceChosenCity(g, p);
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

  const hexes = [...new Set(s.units.filter((u) => u.owner === BARBARIAN && u.type === 'infantry').map((u) => u.hex))];
  const armies = hexes
    .filter((k) => nearest(k) <= 2)
    .map((k) => ({ from: k, d: nearest(k), ids: armyAt(s, k, BARBARIAN).map((u) => u.id) }))
    .sort((a, b) => a.d - b.d);
  if (!armies.length) {
    yield* placeBarbarianSettlement(g, p);
    return;
  }

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
    yield* advanceBarbarianArmy(g, p, army, cityMaps);
    refresh();
  }

  // Step 3: reinforce every Barbarian city within 2 land spaces of the active player's cities.
  for (const c of barbarianCities(s)) {
    if (nearest(c.hex) <= 2) addBarbarianInfantry(g, c.hex);
  }
}

/** Moves one Barbarian army a single space towards the nearest of the player's cities. */
function* advanceBarbarianArmy(g, p, army, cityMaps) {
  const s = g.s;
  const from = army.from;
  // Units that already moved (or died) in this step are not part of the army any more.
  const group = army.ids.map((id) => unitById(s, id)).filter((u) => u && u.hex === from);
  if (!group.length) return;
  const dists = cityMaps.map((cm) => ({ cm, d: dist(cm.map, from) })).filter((x) => x.d < Infinity);
  if (!dists.length) return;
  const best = Math.min(...dists.map((x) => x.d));
  const closest = dists.filter((x) => x.d === best);
  const target = yield* choose(g, p, {
    kind: 'pick_city',
    title: 'Barbarians advance',
    text: 'Several of your cities are equally close. Choose which one the Barbarians march on.',
    options: closest.map((x) => ({ id: x.cm.city.id, label: `City at ${x.cm.city.hex}`, hex: x.cm.city.hex })),
    default: closest[0].cm.city.id,
  });
  const tcm = closest.find((x) => x.cm.city.id === target) || closest[0];
  const steps = nbrs(s, from).filter((n) => isLand(s, n) && dist(tcm.cm.map, n) === best - 1);
  const open = steps.filter((n) => {
    const enemy = unitsAt(s, n).some((u) => u.owner !== BARBARIAN) || (cityAt(s, n) && cityAt(s, n).owner !== BARBARIAN);
    return enemy || armyAt(s, n, BARBARIAN).length + group.length <= STACK_LIMIT;
  });
  if (!open.length) return;
  const dest = yield* choose(g, p, {
    kind: 'pick_hex',
    title: 'Barbarians advance',
    text: 'Choose which space the Barbarian army enters.',
    options: open.map((k) => ({ id: k, label: k, hex: k })),
    default: open[0],
  });
  const to = open.includes(dest) ? dest : open[0];
  const occupants = unitsAt(s, to).filter((u) => u.owner !== BARBARIAN);
  const city = cityAt(s, to);
  const enemyCity = city && city.owner !== BARBARIAN ? city : null;
  g.emit({ type: 'barbarians', kind: 'move', from, hex: to });
  if (occupants.length || enemyCity) {
    const defender = occupants.length ? occupants[0].owner : enemyCity.owner;
    yield* battle(g, {
      domain: 'land', attacker: BARBARIAN, defender, hex: to, from,
      units: group.map((u) => u.id), settlers: [], carried: [], landed: false, inPlace: false,
    });
  } else {
    for (const u of group) u.hex = to;
  }
}

export { PIECE_LIMITS };
