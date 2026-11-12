// Move Units: land steps, boarding and landing, ship voyages (with Navigation and exploration) and Roads.
import { PIRATE, STACK_LIMIT } from './data/constants.js';
import {
  armyAt, bfs, cargoAt, cityAt, cityById, cityHasWonder, citySize, citiesOf, hasAdv, hasCivAdv, hexDistance, isArmy, isHidden, isLand,
  isSea, navyAt, nbrs, pirateMaster, seaGroup, shipCap, shipsAt, terrainOf, unitById, unitsAt, unitsLeft,
} from './queries.js';
import { RuleError, applyPayment, fail, gainRes, planPayment, unitFlags } from './core.js';
import { perimeterRing } from './ring.js';
import { exploreRegion, orientationCandidates } from './explore.js';
import { battle } from './combat.js';
import { choose } from './prompts.js';
import { effMood, finishActivation, markStart, resourcesFrom } from './city.js';

const hostile = (s, p, k) => {
  if (unitsAt(s, k).some((u) => u.owner !== p)) return true;
  const c = cityAt(s, k);
  return !!(c && c.owner !== p);
};

/** Carthage's Pirate Allies: Pirate Ships do not stop its Ships, and its Land units may board them. */
const alliedWithPirates = (s, p) => hasCivAdv(s, p, 'pirate_allies');
/** The owner of the first Ship on `k` that stops p's Ships (a Pirate Ship shared with a Carthage unit counts as Carthage's), else null. */
function foeAt(s, p, k) {
  const master = pirateMaster(s, k);
  for (const u of shipsAt(s, k)) {
    const owner = u.owner === PIRATE && master !== null ? master : u.owner;
    if (owner !== p && !(owner === PIRATE && alliedWithPirates(s, p))) return owner;
  }
  return null;
}

// -------------------------------------------------------------------- sea
/** Sea spaces a ship can sail to from `start`; the value is the owner of an enemy Ship that stops it (or null). */
export function seaReach(s, p, start) {
  const startFoe = foeAt(s, p, start);
  const out = new Map([[start, startFoe]]);
  const queue = startFoe !== null ? [] : [start];
  while (queue.length) {
    const k = queue.shift();
    for (const n of nbrs(s, k)) {
      if (!isSea(s, n) || out.has(n)) continue;
      const foe = foeAt(s, p, n);
      out.set(n, foe);
      if (foe === null) queue.push(n);
    }
  }
  return out;
}

/** Navigation: sail along the map edge from `dep` and report the first new Sea group or unrevealed Region. */
function sail(s, ring, group, dep, dir) {
  const n = ring.length;
  const i0 = ring.indexOf(dep);
  for (let step = 1; step < n; step++) {
    const k = ring[(i0 + dir * step + n) % n];
    const terr = terrainOf(s, k);
    if (terr === null) return { kind: 'region', region: s.map.hexes[k].region, entry: k };
    if (terr === 'sea' && !group.has(k)) return { kind: 'sea', entry: k };
  }
  return null;
}

const regionKeyOf = (s, r) => s.map.regions[r].keys[0];

/**
 * Every voyage open to a Ship starting on `from`.
 * Route: { key, dest, battle, explore, nav, seeds } where `key` identifies the destination for the UI.
 */
export function shipRoutes(s, p, from, navigation) {
  const routes = [];
  const reach = seaReach(s, p, from);
  const seeds = [...reach].filter(([, foe]) => foe === null).map(([k]) => k);
  for (const [k, foe] of reach) {
    if (k !== from) routes.push({ key: k, dest: k, battle: foe, explore: null, nav: null, seeds });
  }
  const regions = new Set();
  for (const k of seeds) for (const n of nbrs(s, k)) if (isHidden(s, n)) regions.add(s.map.hexes[n].region);
  for (const r of regions) routes.push({ key: regionKeyOf(s, r), dest: null, battle: null, explore: r, nav: null, seeds });

  if (navigation) {
    const ring = perimeterRing(s);
    const group = seaGroup(s, from);
    const seen = new Set();
    for (const dir of [1, -1]) {
      for (const dep of seeds) {
        if (!ring.includes(dep)) continue;
        const res = sail(s, ring, group, dep, dir);
        if (!res) continue;
        const nav = { dir, dep, entry: res.entry };
        if (res.kind === 'region') {
          if (regions.has(res.region)) continue;
          const id = `r${res.region}:${dir}`;
          if (seen.has(id)) continue;
          seen.add(id);
          routes.push({ key: regionKeyOf(s, res.region), dest: null, battle: null, explore: res.region, nav, seeds, viaRing: true });
        } else {
          const arrive = seaReach(s, p, res.entry);
          const arriveSeeds = [...arrive].filter(([, foe]) => foe === null).map(([k]) => k);
          for (const [k, foe] of arrive) {
            const id = `${k}:${dir}`;
            if (seen.has(id) || reach.has(k)) continue;
            seen.add(id);
            routes.push({ key: k, dest: k, battle: foe, explore: null, nav, seeds: arriveSeeds });
          }
          const arriveRegions = new Set();
          for (const k of arriveSeeds) for (const n of nbrs(s, k)) if (isHidden(s, n)) arriveRegions.add(s.map.hexes[n].region);
          for (const r of arriveRegions) {
            const id = `r${r}:${dir}`;
            if (seen.has(id) || regions.has(r)) continue;
            seen.add(id);
            routes.push({ key: regionKeyOf(s, r), dest: null, battle: null, explore: r, nav, seeds: arriveSeeds });
          }
        }
      }
    }
  }
  return routes;
}

function chooseCargo(s, p, ships, from, requested) {
  const cap = shipCap(s, p);
  const all = cargoAt(s, from).filter((u) => u.owner === p);
  const here = navyAt(s, from, p).length;
  const capMoving = ships.length * cap;
  const mustCarry = Math.max(0, all.length - (here - ships.length) * cap);
  if (requested) {
    const picked = requested.map((id) => all.find((u) => u.id === id));
    if (picked.some((u) => !u) || new Set(requested).size !== requested.length) fail('Those units are not on board.');
    if (picked.length > capMoving) fail('The Ships cannot carry that many units.');
    if (picked.length < mustCarry) fail('The Ships left behind cannot hold the remaining units.');
    return picked;
  }
  return all.slice(0, capMoving);
}

// -------------------------------------------------------------- planning
function planShips(g, p, a, units, from, to) {
  const s = g.s;
  if (!isSea(s, from)) fail('Ships must be at sea.');
  const routes = shipRoutes(s, p, from, hasAdv(s, p, 'navigation'));
  const hidden = terrainOf(s, to) === null;
  const region = hidden ? s.map.hexes[to].region : null;
  let cands = routes.filter((r) => (hidden ? r.explore === region : r.dest === to));
  if (a.nav) cands = cands.filter((r) => r.nav && r.nav.dir === a.nav);
  else if (cands.some((r) => !r.nav)) cands = cands.filter((r) => !r.nav);
  if (!cands.length) fail('Your Ships cannot reach that space.');
  const route = cands[0];
  const carry = chooseCargo(s, p, units, from, a.carry);
  let defender = route.battle !== null && route.battle !== undefined ? route.battle : null;
  // Pirate Allies: Carthage shares a space with Pirate Ships unless it chooses to attack them.
  if (defender === null && a.attack && route.dest && alliedWithPirates(s, p) && shipsAt(s, route.dest, PIRATE).length) defender = PIRATE;
  if (defender !== null && units.some((u) => (s.turn.unitFlags[u.id] || {}).noBattle)) fail('Units that entered a Forest cannot attack this turn.');
  return {
    kind: 'ship', route, carry: carry.map((u) => u.id), cost: null,
    battle: defender !== null ? { defender } : null,
    explore: route.explore,
  };
}

function planLand(g, p, a, units, from, to, { scout = false, nomad = null } = {}) {
  const s = g.s;
  const t = s.turn;
  const army = units.filter(isArmy);
  const settlers = units.filter((u) => u.type === 'settler');
  if (army.length && !hasAdv(s, p, 'tactics')) fail('You need Tactics to move Army units.');
  const toTerr = terrainOf(s, to);
  const fromSea = isSea(s, from);
  const d = hexDistance(from, to);
  const mine = (k) => {
    const c = cityAt(s, k);
    return !!c && c.owner === p;
  };
  // Scouting Report: a free step of up to 2 spaces that ignores the Mountain and Forest penalties.
  const scouting = scout && army.length > 0 && !fromSea && !a.roads && !nomad;
  const plan = { kind: 'land', roads: false, scout: scouting, cost: null, battle: null, explore: null, carry: [], city: nomad ? nomad.id : null };

  if (nomad) {
    if (a.roads) fail('Cities cannot use Roads.');
    if (toTerr === null || toTerr === 'sea') fail('Cities can neither sail nor explore.');
    if (d !== 1) fail('Cities move one space at a time.');
    if (cityAt(s, to)) fail('A city can never move onto another city.');
    if (hostile(s, p, to)) fail('Enemy units are in the way.');
  }

  if (toTerr === 'sea') {
    if (fromSea) fail('Land units cannot move from Sea to Sea.');
    if (d !== 1) fail('Boarding needs an adjacent Sea space.');
    const pirates = alliedWithPirates(s, p) ? shipsAt(s, to, PIRATE) : [];
    const ships = [...shipsAt(s, to, p), ...pirates];
    if (!ships.length) fail('You have no Ship there.');
    if (unitsAt(s, to).some((u) => u.owner !== p && !(pirates.length && u.owner === PIRATE))) fail('An enemy Ship is there.');
    const free = ships.length * shipCap(s, p) - cargoAt(s, to).filter((u) => u.owner === p).length;
    if (units.length > free) fail('There is not enough room on the Ships.');
    plan.kind = 'embark';
    return plan;
  }

  if (a.roads) {
    if (!hasAdv(s, p, 'roads')) fail('You need Roads.');
    if (!mine(from) && !mine(to)) fail('Roads only help units moving to or from your cities.');
    if (toTerr === null || fromSea) fail('Roads cannot be used for exploring or disembarking.');
    const cost = planPayment(s, p, { food: 1, ore: 1 });
    if (!cost) fail('Roads cost 1 Food and 1 Ore per group.');
    plan.roads = true;
    plan.cost = cost;
  }
  // Imperial Roads: between two of your cities a group may travel up to 4 spaces.
  const imperial = plan.roads && mine(from) && mine(to) && hasCivAdv(s, p, 'imperial_roads');
  if (d < 1 || d > (imperial ? 4 : plan.roads || scouting ? 2 : 1)) fail('That space is too far away.');
  if (d >= 2) {
    if (scouting && toTerr === null) fail('Scouting cannot explore a new Region.');
    // The spaces passed through must be clear, and their stacking limit still applies.
    const clear = (m) => isLand(s, m) && !hostile(s, p, m) && (!army.length || armyAt(s, m, p).length + army.length <= STACK_LIMIT);
    const vias = d === 2 ? nbrs(s, from).filter((m) => hexDistance(m, to) === 1 && clear(m)) : [];
    if (vias.length) plan.via = vias.includes(a.via) ? a.via : vias[0];
    else if (!(imperial && bfs(s, from, 4, clear).has(to))) fail(scouting ? 'There is no clear path to that space.' : 'There is no clear road to that space.');
  }

  if (toTerr === null) {
    const region = s.map.hexes[to].region;
    if (!orientationCandidates(s, s.map.regions[region], { destKey: to }).options.length) {
      fail('That Region cannot be entered from here.');
    }
    plan.explore = region;
  }

  const foeUnits = unitsAt(s, to).filter((u) => u.owner !== p);
  const city = cityAt(s, to);
  const foeCity = city && city.owner !== p ? city : null;
  if (foeUnits.length || foeCity) {
    if (!army.length) fail('Settlers cannot enter enemy spaces without Army units.');
    const sworn = (s.flags.protect || []).find((e) => e.foe === p && (foeUnits.some((u) => u.owner === e.by) || (foeCity && foeCity.owner === e.by)));
    if (sworn) fail(`${g.name(sworn.by)} has played Non-Aggression: you cannot enter their spaces this round.`);
    if (d === 2 && scouting) fail('Scouting cannot attack: the enemy is two spaces away.');
    if (d > 2) fail('Imperial Roads cannot be used to attack.');
    if (d === 2 && !mine(from)) fail('Roads can only be used to attack when leaving one of your cities.');
    for (const u of units) {
      const f = t.unitFlags[u.id] || {};
      if (f.noBattle) fail('Units that entered a Forest cannot attack this turn.');
      if (f.plains && foeCity && cityHasWonder(foeCity, 'great_gardens')) {
        fail('The Great Gardens stop units that just entered Plains from attacking.');
      }
    }
    plan.battle = { defender: foeUnits.length ? foeUnits[0].owner : foeCity.owner };
  } else if (army.length && armyAt(s, to, p).length + army.length > STACK_LIMIT) {
    fail('A space holds at most 4 Army units.');
  }
  plan.kind = fromSea ? 'disembark' : 'land';
  return plan;
}

/** Nomads: the size-1 city a Move may carry along, or a RuleError saying why it cannot go. */
function nomadCity(s, p, id) {
  const c = cityById(s, id);
  if (!c || c.owner !== p) fail('Choose one of your cities.');
  if (!hasCivAdv(s, p, 'nomads')) fail('You need Nomads to move a city.');
  if (citySize(c) !== 1) fail('Only cities of size 1 can move.');
  if (effMood(s, c) === 'angry') fail('Angry cities cannot move.');
  if ((s.turn.unitFlags[c.id] || {}).stopped) fail('That city stopped on a Mountain and cannot move again this turn.');
  return c;
}

/**
 * Shipcraft: Ships step onto an adjacent Land space and become Settlers or Infantry (`a.into`); Settlers and Infantry step onto
 * an adjacent Sea space and become Ships (`a.convert` lists those that do, or `true` for every one that can). The rest board.
 */
function planConvert(g, p, a, units, from, to) {
  const s = g.s;
  if (!hasCivAdv(s, p, 'shipcraft')) fail('You need Shipcraft to convert units.');
  if (a.roads) fail('Shipcraft cannot be combined with Roads.');
  const toTerr = terrainOf(s, to);
  if (toTerr === null) fail('Units that explore a new Region cannot convert.');
  if (hexDistance(from, to) !== 1) fail('Units convert as they move to an adjacent space.');
  const fromSea = isSea(s, from);
  if (fromSea === (toTerr === 'sea')) fail('Shipcraft turns Ships into land units on Land, and land units into Ships on the Sea.');
  const there = cityAt(s, to);
  if (unitsAt(s, to).some((u) => u.owner !== p) || (there && there.owner !== p)) fail('The space must be clear of enemies.');
  const plan = { kind: 'convert', roads: false, scout: false, cost: null, battle: null, explore: null, convert: {}, carry: [], landing: [] };
  const supply = { settler: 'Settlers', infantry: 'Infantry', ship: 'Ships' };
  const stock = (type, n) => {
    if (unitsLeft(s, p, type) < n) fail(`You have no ${supply[type]} left.`);
  };

  if (fromSea) {
    if (units.some((u) => u.type !== 'ship')) fail('Only Ships convert at sea.');
    const into = a.into === 'infantry' ? 'infantry' : 'settler';
    if (into === 'infantry' && !hasAdv(s, p, 'tactics')) fail('You need Tactics to make Infantry.');
    stock(into, units.length);
    const aboard = cargoAt(s, from).filter((u) => u.owner === p);
    const must = Math.max(0, aboard.length - Math.max(0, shipsAt(s, from, p).length - units.length) * shipCap(s, p));
    let carry = aboard;
    if (a.carry) {
      carry = a.carry.map((id) => aboard.find((u) => u.id === id));
      if (carry.some((u) => !u) || new Set(a.carry).size !== a.carry.length) fail('Those units are not on board.');
      if (carry.length < must) fail('The Ships left behind cannot hold the remaining units.');
    }
    const army = (into === 'infantry' ? units.length : 0) + carry.filter(isArmy).length;
    if (armyAt(s, to, p).length + army > STACK_LIMIT) fail('A space holds at most 4 Army units.');
    for (const u of units) plan.convert[u.id] = into;
    plan.carry = carry.map((u) => u.id);
    plan.landing = [...units, ...carry].map((u) => u.id);
    return plan;
  }

  const convertible = (u) => u.type === 'settler' || u.type === 'infantry';
  const chosen = Array.isArray(a.convert) ? a.convert : units.filter(convertible).map((u) => u.id);
  if (!chosen.length) fail('Choose the units that become Ships.');
  if (chosen.some((id) => !units.some((u) => u.id === id && convertible(u)))) fail('Only Settlers and Infantry become Ships.');
  stock('ship', chosen.length);
  const room = (shipsAt(s, to, p).length + chosen.length) * shipCap(s, p) - cargoAt(s, to).filter((u) => u.owner === p).length;
  if (units.length - chosen.length > room) fail('There is not enough room on the Ships.');
  for (const id of chosen) plan.convert[id] = 'ship';
  return plan;
}

/** Validate a move request without changing anything. Returns the plan or throws a RuleError. */
export function planMove(g, p, a) {
  const s = g.s;
  const t = s.turn;
  if (!t || t.player !== p) fail('It is not your turn.');
  const ids = [...new Set(a.units || [])];
  const nomad = a.city ? nomadCity(s, p, a.city) : null;
  if (!ids.length && !nomad) fail('Choose the units to move.');
  const units = ids.map((id) => unitById(s, id));
  if (units.some((u) => !u || u.owner !== p)) fail('You can only move your own units.');
  const from = nomad ? nomad.hex : units[0].hex;
  if (units.some((u) => u.hex !== from)) fail('A group must start in a single space.');
  const to = a.to;
  if (!to || !s.map.hexes[to] || to === from) fail('Choose a destination.');
  for (const u of units) {
    const f = t.unitFlags[u.id] || {};
    // Longships: Ships may sail on after a battle.
    if (f.fought && !(u.type === 'ship' && hasCivAdv(s, p, 'longships'))) fail('Units that fought cannot move again this turn.');
    if (f.stopped) fail(f.stopped === 'hegemony' ? 'Units landed by Hegemony cannot move again this turn.' : 'That unit stopped on a Mountain and cannot move again this turn.');
  }
  const ships = units.filter((u) => u.type === 'ship');
  if (ships.length && ships.length !== units.length) fail('Ships move separately from land units.');
  if (nomad && (ships.length || a.convert)) fail('A city can neither sail nor convert.');
  // A free Move from a card may be limited to one kind of group; any other group starts a Move action of its own.
  const group = nomad ? 'city' : ships.length ? 'ships' : units.some(isArmy) ? 'army' : 'settlers';
  const open = t.move && t.move.credits > 0 ? t.move : null;
  // Sprawling moves only Settlers that start in one of the player's cities.
  const sprawls = !open || !open.sprawl || (cityAt(s, from) && cityAt(s, from).owner === p);
  const fits = !open || ((!open.only || open.only === group) && sprawls);
  const fresh = !open || ids.some((id) => t.move.moved[id]) || !!(nomad && t.move.moved[`city:${nomad.id}`]) || !fits;
  const scout = !fresh && !!open.scout;
  let plan;
  if (a.convert) plan = planConvert(g, p, a, units, from, to);
  else if (ships.length) plan = planShips(g, p, a, units, from, to);
  else plan = planLand(g, p, a, units, from, to, { scout, nomad });
  return { ...plan, ids, from, to, fresh };
}

/** All legal single-group destinations for a set of units (used by the UI and the AI). A Nomads city may go with them. */
export function moveOptions(g, p, ids, cityId = null) {
  const s = g.s;
  const units = ids.map((id) => unitById(s, id)).filter(Boolean);
  const nomad = cityId ? cityById(s, cityId) : null;
  if (!units.length && !nomad) return [];
  const from = nomad ? nomad.hex : units[0].hex;
  const out = [];
  const attempt = (a) => {
    try {
      const plan = planMove(g, p, { units: ids, city: cityId || undefined, ...a });
      out.push({
        to: a.to, roads: !!a.roads, nav: a.nav || null, kind: plan.kind, battle: plan.battle, explore: plan.explore, fresh: plan.fresh,
        scout: !!plan.scout, convert: a.convert ? { into: a.into || null } : null, attack: !!a.attack,
      });
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
    }
  };
  const shipcraft = hasCivAdv(s, p, 'shipcraft');
  if (units[0] && units[0].type === 'ship') {
    const nav = hasAdv(s, p, 'navigation');
    for (const r of shipRoutes(s, p, from, nav)) {
      const nv = r.nav ? r.nav.dir : undefined;
      attempt({ to: r.key, nav: nv });
      if (r.dest && alliedWithPirates(s, p) && shipsAt(s, r.dest, PIRATE).length) attempt({ to: r.key, nav: nv, attack: true });
    }
    if (shipcraft) {
      for (const n of nbrs(s, from)) {
        if (!isLand(s, n)) continue;
        attempt({ to: n, convert: true, into: 'settler' });
        attempt({ to: n, convert: true, into: 'infantry' });
      }
    }
    return out;
  }
  const roads = hasAdv(s, p, 'roads') && !nomad;
  const scouting = !!(s.turn && s.turn.move && s.turn.move.credits > 0 && s.turn.move.scout);
  for (const n of nbrs(s, from)) {
    attempt({ to: n });
    if (roads) attempt({ to: n, roads: true });
    if (shipcraft && !nomad && isSea(s, n)) attempt({ to: n, convert: true });
  }
  if (roads || scouting) {
    const seen = new Set(nbrs(s, from));
    for (const n of nbrs(s, from)) {
      for (const m of nbrs(s, n)) {
        if (m === from || seen.has(m)) continue;
        seen.add(m);
        if (scouting) attempt({ to: m });
        if (roads) attempt({ to: m, roads: true });
      }
    }
  }
  if (roads && hasCivAdv(s, p, 'imperial_roads') && cityAt(s, from) && cityAt(s, from).owner === p) {
    for (const c of citiesOf(s, p)) {
      const d = hexDistance(from, c.hex);
      if (d > 2 && d <= 4) attempt({ to: c.hex, roads: true });
    }
  }
  return out;
}

// -------------------------------------------------------------- execution
function terrainFlags(g, plan, units, landTerrain) {
  for (const u of units) {
    const f = unitFlags(g, u.id);
    if (landTerrain === 'plains') f.plains = true;
    if (plan.roads || plan.scout) continue;
    // Terracing: Settlers walk over Mountains without stopping.
    if (landTerrain === 'mountain' && !(u.type === 'settler' && hasCivAdv(g.s, u.owner, 'terracing'))) f.stopped = true;
    if (landTerrain === 'forest') f.noBattle = true;
  }
}

function* moveShips(g, p, plan) {
  const s = g.s;
  const { route, from } = plan;
  const ships = plan.ids.map((id) => unitById(s, id));
  const carry = plan.carry.map((id) => unitById(s, id));
  const everyone = [...ships, ...carry];
  g.emit({ type: 'move', player: p, units: plan.ids, from, to: route.dest || plan.to, nav: !!route.nav });

  if (route.explore !== null) {
    const region = s.map.regions[route.explore];
    const seeds = new Set(route.seeds);
    const ringSet = route.viaRing ? new Set(perimeterRing(s)) : null;
    yield* exploreRegion(g, p, region, { shipGroup: seeds, ringKeys: ringSet });
    const newSea = region.keys.filter((k) => isSea(s, k));
    const ends = new Set(newSea.filter((k) => nbrs(s, k).some((n) => seeds.has(n)) || (ringSet && ringSet.has(k))));
    const queue = [...ends];
    while (queue.length) {
      const k = queue.shift();
      for (const n of nbrs(s, k)) {
        if (newSea.includes(n) && !ends.has(n)) {
          ends.add(n);
          queue.push(n);
        }
      }
    }
    const options = [...ends].filter((k) => !shipsAt(s, k).some((u) => u.owner !== p));
    if (!options.length) {
      g.log('The Ships explore, then return to where they started.');
      return;
    }
    const hex = yield* choose(g, p, {
      kind: 'pick_hex',
      title: 'Explore by sea',
      text: 'Choose the Sea space where your Ships end their voyage.',
      options: options.map((k) => ({ id: k, label: k, hex: k })),
      default: options[0],
    });
    const dest = options.includes(hex) ? hex : options[0];
    for (const u of everyone) u.hex = dest;
    return;
  }

  if (plan.battle) {
    yield* battle(g, {
      domain: 'sea', attacker: p, defender: plan.battle.defender, hex: route.dest, from,
      units: ships.map((u) => u.id), settlers: [], carried: carry.map((u) => u.id), landed: false, inPlace: false,
    });
    return;
  }
  for (const u of everyone) u.hex = route.dest;
}

/** Nomads: the city has moved; it gains 1 Resource of its new space (not a Collect) and counts as activated. */
function* moveCity(g, p, city, to) {
  const s = g.s;
  markStart(g, city);
  city.hex = to;
  if (terrainOf(s, to) === 'mountain') unitFlags(g, city.id).stopped = true;
  const hex = s.map.hexes[to];
  const opts = hex.terrain === 'barren' || hex.exhausted ? [] : resourcesFrom(s, p, city, hex.terrain);
  if (opts.length) {
    const res = opts.length === 1 ? opts[0] : yield* choose(g, p, {
      kind: 'nomad_resource',
      title: 'Nomads',
      text: 'The city settles into its new space: take 1 Resource.',
      options: opts.map((r) => ({ id: r, label: r })),
      default: opts[0],
    });
    gainRes(g, p, { [opts.includes(res) ? res : opts[0]]: 1 });
    g.log(`${g.name(p)}'s city moves to a new space and gains 1 ${opts.includes(res) ? res : opts[0]} (Nomads).`);
  } else {
    g.log(`${g.name(p)}'s city moves to a new space (Nomads).`);
  }
  yield* finishActivation(g, city);
}

/** Shipcraft: the units change type where they stand, then step into the new space; they must Move again to go further. */
function* convertUnits(g, p, plan) {
  const s = g.s;
  const to = plan.to;
  g.emit({ type: 'move', player: p, units: plan.ids, from: plan.from, to });
  for (const [id, type] of Object.entries(plan.convert)) {
    const u = unitById(s, id);
    g.log(`${g.name(p)}'s ${u.type} becomes ${type === 'ship' ? 'a Ship' : type === 'settler' ? 'a Settler' : 'an Infantry'} (Shipcraft).`);
    u.type = type;
  }
  const everyone = [...new Set([...plan.ids, ...plan.carry])].map((id) => unitById(s, id));
  for (const u of everyone) u.hex = to;
  g.emit({ type: 'convert', player: p, units: Object.keys(plan.convert), to });
  if (!isSea(s, to)) terrainFlags(g, plan, plan.landing.map((id) => unitById(s, id)), terrainOf(s, to));
}

export function* moveAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  const plan = planMove(g, p, a);
  if (plan.fresh) {
    g.spendAction();
    t.move = { credits: 3, moved: {}, shipMoved: false, navUsed: false };
  }
  t.move.credits -= 1;
  for (const id of plan.ids) t.move.moved[id] = true;
  if (plan.city) t.move.moved[`city:${plan.city}`] = true;
  if (plan.cost) applyPayment(g, p, plan.cost);

  if (plan.kind === 'ship') {
    yield* moveShips(g, p, plan);
    if (hasAdv(s, p, 'cartography')) {
      if (!t.move.shipMoved) gainRes(g, p, { ideas: 1 });
      if (plan.route.nav && !t.move.navUsed) gainRes(g, p, { culture: 1 });
    }
    t.move.shipMoved = true;
    if (plan.route.nav) t.move.navUsed = true;
    return;
  }
  if (plan.kind === 'convert') {
    yield* convertUnits(g, p, plan);
    return;
  }

  const units = plan.ids.map((id) => unitById(s, id));
  const to = plan.to;
  g.emit({ type: 'move', player: p, units: plan.ids, from: plan.from, to, city: plan.city || undefined });
  if (plan.kind === 'embark') {
    for (const u of units) u.hex = to;
    return;
  }
  if (plan.explore !== null) {
    yield* exploreRegion(g, p, s.map.regions[plan.explore], { destKey: to });
  }
  if (plan.battle) {
    const res = yield* battle(g, {
      domain: 'land', attacker: p, defender: plan.battle.defender, hex: to, from: plan.via || plan.from,
      units: units.filter(isArmy).map((u) => u.id), settlers: units.filter((u) => u.type === 'settler').map((u) => u.id),
      carried: [], landed: plan.kind === 'disembark', inPlace: false,
    });
    // A retreat after a Roads attack only goes back to the last space the group passed through.
    if (res.retreated && plan.via) {
      for (const id of plan.ids) {
        const u = unitById(s, id);
        if (u) u.hex = plan.via;
      }
    }
    return;
  }
  for (const u of units) u.hex = to;
  terrainFlags(g, plan, units, terrainOf(s, to));
  if (plan.city) yield* moveCity(g, p, cityById(s, plan.city), to);
}

/**
 * Free Move granted by a card: opens a Move action without spending an action. `only` limits it to one kind of group
 * ('army' | 'ships' | 'settlers'); `scout` lets Army groups step 2 spaces without the Mountain and Forest penalties;
 * `sprawl` (Sprawling) limits it to Settlers that start in one of the player's cities.
 */
export function openFreeMove(g, { credits = 3, only = null, scout = false, sprawl = false } = {}) {
  const move = { credits, moved: {}, shipMoved: false, navUsed: false, only, scout, free: true };
  if (sprawl) move.sprawl = true;
  g.s.turn.move = move;
}
