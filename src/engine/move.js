// Move Units: land steps, boarding and landing, ship voyages (with Navigation and exploration) and Roads.
import { SHIP_CAPACITY, STACK_LIMIT } from './data/constants.js';
import {
  armyAt, cargoAt, cityAt, cityHasWonder, hasAdv, hexDistance, isArmy, isHidden, isLand, isSea, nbrs, seaGroup,
  shipsAt, terrainOf, unitById, unitsAt,
} from './queries.js';
import { RuleError, applyPayment, fail, gainRes, planPayment, unitFlags } from './core.js';
import { perimeterRing } from './ring.js';
import { exploreRegion, orientationCandidates } from './explore.js';
import { battle } from './combat.js';
import { choose } from './prompts.js';

const hostile = (s, p, k) => {
  if (unitsAt(s, k).some((u) => u.owner !== p)) return true;
  const c = cityAt(s, k);
  return !!(c && c.owner !== p);
};

// -------------------------------------------------------------------- sea
/** Sea spaces a ship can sail to from `start`; the value is the owner of an enemy Ship that stops it (or null). */
export function seaReach(s, p, start) {
  const startFoe = shipsAt(s, start).find((u) => u.owner !== p);
  const out = new Map([[start, startFoe ? startFoe.owner : null]]);
  const queue = startFoe ? [] : [start];
  while (queue.length) {
    const k = queue.shift();
    for (const n of nbrs(s, k)) {
      if (!isSea(s, n) || out.has(n)) continue;
      const foe = shipsAt(s, n).find((u) => u.owner !== p);
      out.set(n, foe ? foe.owner : null);
      if (!foe) queue.push(n);
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
  const all = cargoAt(s, from).filter((u) => u.owner === p);
  const here = shipsAt(s, from, p).length;
  const capMoving = ships.length * SHIP_CAPACITY;
  const mustCarry = Math.max(0, all.length - (here - ships.length) * SHIP_CAPACITY);
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
  return {
    kind: 'ship', route, carry: carry.map((u) => u.id), cost: null,
    battle: route.battle !== null && route.battle !== undefined ? { defender: route.battle } : null,
    explore: route.explore,
  };
}

function planLand(g, p, a, units, from, to) {
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
  const plan = { kind: 'land', roads: false, cost: null, battle: null, explore: null, carry: [] };

  if (toTerr === 'sea') {
    if (fromSea) fail('Land units cannot move from Sea to Sea.');
    if (d !== 1) fail('Boarding needs an adjacent Sea space.');
    const ships = shipsAt(s, to, p);
    if (!ships.length) fail('You have no Ship there.');
    if (unitsAt(s, to).some((u) => u.owner !== p)) fail('An enemy Ship is there.');
    const free = ships.length * SHIP_CAPACITY - cargoAt(s, to).filter((u) => u.owner === p).length;
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
  if (d < 1 || d > (plan.roads ? 2 : 1)) fail('That space is too far away.');
  if (d === 2) {
    // The space passed through must be clear, and its stacking limit still applies.
    const vias = nbrs(s, from).filter((m) => hexDistance(m, to) === 1 && isLand(s, m) && !hostile(s, p, m)
      && (!army.length || armyAt(s, m, p).length + army.length <= STACK_LIMIT));
    if (!vias.length) fail('There is no clear road to that space.');
    plan.via = vias.includes(a.via) ? a.via : vias[0];
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

/** Validate a move request without changing anything. Returns the plan or throws a RuleError. */
export function planMove(g, p, a) {
  const s = g.s;
  const t = s.turn;
  if (!t || t.player !== p) fail('It is not your turn.');
  const ids = [...new Set(a.units || [])];
  if (!ids.length) fail('Choose the units to move.');
  const units = ids.map((id) => unitById(s, id));
  if (units.some((u) => !u || u.owner !== p)) fail('You can only move your own units.');
  const from = units[0].hex;
  if (units.some((u) => u.hex !== from)) fail('A group must start in a single space.');
  const to = a.to;
  if (!to || !s.map.hexes[to] || to === from) fail('Choose a destination.');
  for (const u of units) {
    const f = t.unitFlags[u.id] || {};
    if (f.fought) fail('Units that fought cannot move again this turn.');
    if (f.stopped) fail('That unit stopped on a Mountain and cannot move again this turn.');
  }
  const ships = units.filter((u) => u.type === 'ship');
  if (ships.length && ships.length !== units.length) fail('Ships move separately from land units.');
  const fresh = !t.move || t.move.credits <= 0 || ids.some((id) => t.move.moved[id]);
  const plan = ships.length ? planShips(g, p, a, units, from, to) : planLand(g, p, a, units, from, to);
  return { ...plan, ids, from, to, fresh };
}

/** All legal single-group destinations for a set of units (used by the UI and the AI). */
export function moveOptions(g, p, ids) {
  const s = g.s;
  const units = ids.map((id) => unitById(s, id)).filter(Boolean);
  if (!units.length) return [];
  const from = units[0].hex;
  const out = [];
  const attempt = (a) => {
    try {
      const plan = planMove(g, p, { units: ids, ...a });
      out.push({ to: a.to, roads: !!a.roads, nav: a.nav || null, kind: plan.kind, battle: plan.battle, explore: plan.explore, fresh: plan.fresh });
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
    }
  };
  if (units[0].type === 'ship') {
    const nav = hasAdv(s, p, 'navigation');
    for (const r of shipRoutes(s, p, from, nav)) attempt({ to: r.key, nav: r.nav ? r.nav.dir : undefined });
    return out;
  }
  const roads = hasAdv(s, p, 'roads');
  for (const n of nbrs(s, from)) {
    attempt({ to: n });
    if (roads) attempt({ to: n, roads: true });
  }
  if (roads) {
    const seen = new Set(nbrs(s, from));
    for (const n of nbrs(s, from)) {
      for (const m of nbrs(s, n)) {
        if (m === from || seen.has(m)) continue;
        seen.add(m);
        attempt({ to: m, roads: true });
      }
    }
  }
  return out;
}

// -------------------------------------------------------------- execution
function terrainFlags(g, plan, units, landTerrain) {
  for (const u of units) {
    const f = unitFlags(g, u.id);
    if (landTerrain === 'plains') f.plains = true;
    if (plan.roads) continue;
    if (landTerrain === 'mountain') f.stopped = true;
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

  const units = plan.ids.map((id) => unitById(s, id));
  const to = plan.to;
  g.emit({ type: 'move', player: p, units: plan.ids, from: plan.from, to });
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
}

/** Free Move action granted by a card: opens a Move action without spending an action. */
export function openFreeMove(g) {
  g.s.turn.move = { credits: 3, moved: {}, shipMoved: false, navUsed: false };
}
