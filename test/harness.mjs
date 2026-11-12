// Shared helpers for the test suite and the simulation script.
import { Game } from '../src/engine/game.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { BARBARIAN, MAX_PLAYERS, PIECE_LIMITS, PIRATE, RESOURCES, STACK_LIMIT } from '../src/engine/data/constants.js';
import { ACTION_DECK_LIST } from '../src/engine/data/cards.js';
import { OBJECTIVE_CARD_LIST } from '../src/engine/data/cards.js';
import { WONDER_IDS } from '../src/engine/data/wonders.js';
import { ADVANCES, GROUPS } from '../src/engine/data/advances.js';
import { CIVS } from '../src/engine/data/civs.js';
import { CAPTIVE_LIMIT, grantCivAdvances } from '../src/engine/civs.js';
import { randInt, seedFromString } from '../src/engine/rng.js';
import { allOwners, captivesOf, isArmy, resLimit, shipCapacityAt, totalAges } from '../src/engine/queries.js';

export function makeRand(seed) {
  const st = { rng: seedFromString(String(seed)) };
  return {
    int: (n) => randInt(st, n),
    pick: (arr) => arr[randInt(st, arr.length)],
    chance: (p) => randInt(st, 1000) < p * 1000,
  };
}

/** Everything that must hold in any reachable state. Returns a list of problems. */
export function checkInvariants(g) {
  const s = g.s;
  const errs = [];
  const bad = (m) => errs.push(m);
  const seats = s.players.length;
  if (seats < 2 || seats > MAX_PLAYERS) bad(`${seats} players at the table`);
  if (Object.keys(s.map.hexes).length !== { 2: 40, 3: 60, 4: 72 }[seats]) bad(`${Object.keys(s.map.hexes).length} hexes for ${seats} players`);
  if (!Number.isInteger(s.first) || s.first < 0 || s.first >= seats) bad(`first player ${s.first}`);
  if (s.turn && (s.turn.player < 0 || s.turn.player >= seats)) bad(`turn of player ${s.turn.player}`);
  for (const pl of s.players) {
    for (const r of RESOURCES) {
      const v = pl.res[r];
      if (!Number.isInteger(v) || v < 0 || v > resLimit(s, pl.idx, r)) bad(`${pl.name} has ${v} ${r} (limit ${resLimit(s, pl.idx, r)})`);
    }
    if (!Number.isInteger(pl.mood) || pl.mood < 0) bad(`${pl.name} mood ${pl.mood}`);
    if (!Number.isInteger(pl.culture) || pl.culture < 0) bad(`${pl.name} culture ${pl.culture}`);
    if (pl.cubes < 1 || pl.cubes > 3) bad(`${pl.name} cubes ${pl.cubes}`);
    if (new Set(pl.advances).size !== pl.advances.length) bad(`${pl.name} has duplicate advances`);
    const govs = Object.values(GROUPS).filter((x) => x.gov && x.advances.some((a) => pl.advances.includes(a.id)));
    if (govs.length > 1) bad(`${pl.name} has two governments`);
    if (govs.length === 1 && pl.government !== govs[0].id) bad(`${pl.name} government mismatch ${pl.government} vs ${govs[0].id}`);
    if (govs.length === 0 && pl.government) bad(`${pl.name} has a government without advances`);
    if (!s.civs) {
      if (pl.civ || pl.civAdv.length || pl.captives.length) bad(`${pl.name} has Civilization state without the module`);
      continue;
    }
    const civ = CIVS[pl.civ];
    if (!civ) { bad(`${pl.name} has no Civilization (${pl.civ})`); continue; }
    if (s.players.filter((o) => o.civ === pl.civ).length > 1) bad(`${pl.name}: the Civilization ${pl.civ} is played twice`);
    if (new Set(pl.civAdv).size !== pl.civAdv.length) bad(`${pl.name} has duplicate Civilization Advances`);
    for (const id of pl.civAdv) {
      const a = civ.advances.find((x) => x.id === id);
      if (!a) bad(`${pl.name} (${pl.civ}) has the foreign Civilization Advance ${id}`);
      // A Government may be given up later (its cubes move), but the Civilization Advance stays.
      else if (a.trigger === 'government' ? !pl.government : !pl.advances.includes(a.trigger) && !GROUPS[ADVANCES[a.trigger].group].gov) bad(`${pl.name} has ${id} without ${a.trigger}`);
    }
    for (const a of civ.advances) {
      if ((a.trigger === 'government' ? pl.government : pl.advances.includes(a.trigger)) && !pl.civAdv.includes(a.id)) bad(`${pl.name} lacks ${a.id} although ${a.trigger} is theirs`);
    }
    if (pl.captives.length > CAPTIVE_LIMIT) bad(`${pl.name} holds ${pl.captives.length} Captives`);
    if (pl.captives.length && !pl.civAdv.includes('captives')) bad(`${pl.name} holds Captives without the Advance`);
    for (const c of pl.captives) if (!isArmy(c)) bad(`${pl.name} holds a ${c.type} Captive`);
  }

  const owners = {};
  const stack = {};
  const cargo = {};
  const shipsAtHex = {};
  const count = {};
  for (const u of s.units) {
    const h = s.map.hexes[u.hex];
    if (!h) { bad(`unit ${u.id} off the map at ${u.hex}`); continue; }
    if (h.terrain === null) bad(`unit ${u.id} on hidden hex ${u.hex}`);
    (owners[u.hex] ||= new Set()).add(u.owner);
    const ck = `${u.owner}:${u.type}`;
    count[ck] = (count[ck] || 0) + 1;
    if (u.type === 'ship') {
      if (h.terrain !== 'sea') bad(`ship ${u.id} on land ${u.hex}`);
      shipsAtHex[u.hex] = (shipsAtHex[u.hex] || 0) + 1;
    } else {
      if (h.terrain === 'sea') cargo[u.hex] = (cargo[u.hex] || 0) + 1;
      if (isArmy(u) && h.terrain !== 'sea') {
        const k = `${u.hex}:${u.owner}`;
        stack[k] = (stack[k] || 0) + 1;
      }
    }
  }
  for (const [hex, n] of Object.entries(cargo)) {
    if (!(shipsAtHex[hex] > 0)) bad(`land units at sea ${hex} without ships`);
    else if (n > shipCapacityAt(s, hex)) bad(`too much cargo at ${hex}: ${n} on ${shipsAtHex[hex]} ships`);
  }
  for (const [k, n] of Object.entries(stack)) if (n > STACK_LIMIT) bad(`stack of ${n} at ${k}`);
  // Carthage's Pirate Allies share a space with Pirate Ships.
  const sharing = (set) => set.size === 2 && set.has(PIRATE) && [...set].some((o) => o !== PIRATE && s.civs && s.players[o] && s.players[o].civAdv.includes('pirate_allies'));
  for (const [hex, set] of Object.entries(owners)) if (set.size > 1 && !sharing(set)) bad(`mixed owners at ${hex}: ${[...set]}`);
  for (const [k, n] of Object.entries(count)) {
    const [o, type] = k.split(':');
    const lim = Number(o) === BARBARIAN
      ? { infantry: PIECE_LIMITS.barbarianInfantry, cavalry: PIECE_LIMITS.barbarianCavalry, elephant: PIECE_LIMITS.barbarianElephants }[type] ?? 0
      : Number(o) === PIRATE
        ? { ship: PIECE_LIMITS.pirateShips }[type] ?? 0
        : { infantry: PIECE_LIMITS.infantry, cavalry: PIECE_LIMITS.cavalry, elephant: PIECE_LIMITS.elephants, ship: PIECE_LIMITS.ships, settler: PIECE_LIMITS.settlers }[type];
    // Captives are pieces that left the board for their captor's hand.
    if (n + captivesOf(s, Number(o), type) > lim) bad(`owner ${o} has ${n} ${type} (limit ${lim})`);
  }

  const wonders = new Map();
  const cityHexes = new Set();
  const perOwner = {};
  const bcount = {};
  // Egypt's Flood Plains found cities on Barren land and Huns' Nomads move them there.
  const barrenOk = s.civs && s.players.some((pl) => pl.civAdv.includes('flood_plains') || pl.civAdv.includes('nomads'));
  for (const c of s.cities) {
    const h = s.map.hexes[c.hex];
    if (!h || h.terrain === null || h.terrain === 'sea' || (h.terrain === 'barren' && !barrenOk)) bad(`city ${c.id} on ${h && h.terrain} ${c.hex}`);
    if (cityHexes.has(c.hex)) bad(`two cities at ${c.hex}`);
    cityHexes.add(c.hex);
    perOwner[c.owner] = (perOwner[c.owner] || 0) + 1;
    const here = owners[c.hex];
    if (here && (here.size > 1 || !here.has(c.owner))) bad(`foreign units inside city ${c.id} at ${c.hex}`);
    for (const [b, col] of Object.entries(c.buildings)) {
      const k = `${b}:${col}`;
      bcount[k] = (bcount[k] || 0) + 1;
      if (!allOwners(s).includes(col)) bad(`building colour ${col}`);
    }
    if (c.buildings.port !== undefined) {
      const adj = c.port && s.map.hexes[c.port] && s.map.hexes[c.port].terrain === 'sea';
      if (!adj) bad(`port city ${c.id} without a port hex`);
    }
    for (const w of c.wonders) {
      if (wonders.has(w.id)) bad(`wonder ${w.id} in two cities`);
      wonders.set(w.id, c.id);
    }
    if (!['angry', 'neutral', 'happy'].includes(c.mood)) bad(`city mood ${c.mood}`);
  }
  for (const [o, n] of Object.entries(perOwner)) {
    // Barbarians may exceed their supply by capturing cities; the supply only limits new spawns.
    if (Number(o) !== BARBARIAN && n > PIECE_LIMITS.settlements) bad(`owner ${o} has ${n} cities (limit ${PIECE_LIMITS.settlements})`);
  }
  for (const [k, n] of Object.entries(bcount)) if (n > PIECE_LIMITS.buildings) bad(`${n} of building ${k}`);

  // Card conservation
  const tally = (list) => list.reduce((m, id) => m.set(id, (m.get(id) || 0) + 1), new Map());
  const actionAll = [...s.decks.action, ...s.decks.actionDiscard, ...s.players.flatMap((p) => p.hand.action)];
  const want = tally(ACTION_DECK_LIST);
  const got = tally(actionAll);
  for (const [id, n] of want) if ((got.get(id) || 0) !== n) bad(`action card ${id}: ${got.get(id) || 0} of ${n}`);
  if (actionAll.length !== ACTION_DECK_LIST.length) bad(`action cards total ${actionAll.length}`);
  const objAll = [...s.decks.objective, ...s.decks.objectiveDiscard, ...s.players.flatMap((p) => [...p.hand.objective, ...p.completed.filter((c) => c.side === 'obj' || c.card).map((c) => c.card)])];
  if (new Set(objAll).size !== objAll.length && objAll.length > OBJECTIVE_CARD_LIST.length) bad(`objective cards ${objAll.length}`);

  // A Wonder whose city was destroyed leaves the game (rulebook p.28), but its builder still lists it.
  const destroyedWonders = s.players.flatMap((p) => p.builtWonders).filter((id) => !wonders.has(id));
  const wonderAll = [...s.decks.wonder, ...s.players.flatMap((p) => p.hand.wonder), ...wonders.keys(), ...destroyedWonders];
  if (wonderAll.length !== WONDER_IDS.length || new Set(wonderAll).size !== WONDER_IDS.length) bad(`wonder cards: ${wonderAll.join(',')}`);

  if (s.turn && s.turn.actionsLeft < 0) bad(`actionsLeft ${s.turn.actionsLeft}`);
  if (!['main', 'status', 'over'].includes(s.phase)) bad(`phase ${s.phase}`);
  if (s.round < 1 || s.round > 3 || s.age < 1 || s.age > totalAges(s)) bad(`age/round ${s.age}/${s.round} in a game of ${totalAges(s)} Ages`);
  return errs;
}

/**
 * Give player p every Advance (one whole Government, every other category) with the Civilization Advances that come with
 * them, and full stocks: a table where every power of a people is within reach of random play.
 */
export function enrich(g, p, { gov = 'democracy' } = {}) {
  const s = g.s;
  const pl = s.players[p];
  for (const [gid, group] of Object.entries(GROUPS)) {
    if (group.gov && gid !== gov) continue;
    for (const a of group.advances) {
      if (pl.advances.includes(a.id)) continue;
      pl.advances.push(a.id);
      grantCivAdvances(g, p, a.id);
    }
  }
  pl.government = gov;
  for (const r of RESOURCES) pl.res[r] = resLimit(s, p, r);
  pl.mood = 6;
  pl.culture = 6;
}

/** Answer a prompt at random (used for fuzzing). */
export function randomAnswer(rand, prompt) {
  if (prompt.multi) {
    const { min, max } = prompt.multi;
    const n = min + rand.int(Math.min(max, prompt.options.length) - min + 1);
    const pool = prompt.options.map((o) => o.id);
    const out = [];
    while (out.length < n) out.push(pool.splice(rand.int(pool.length), 1)[0]);
    return out;
  }
  return rand.pick(prompt.options).id;
}

const WEIGHT = { end: 0.5, move: 1.2, advance: 2, collect: 1.5, recruit: 1.5, found: 3, construct: 2, wonder: 3 };

/**
 * Play a whole game with a random chooser. `chooser(g, p, list, rand)` may be supplied to override the choice.
 * `ages` sets the game length (the default length when omitted), `opponents` the number of computer players and
 * `civs` switches the Civilizations module on (an array names the peoples of the first seats). `setup(g)` may change
 * the table before the first turn.
 * Returns { g, steps, rejected, errors }.
 */
export function playRandomGame({ seed = 'fuzz', maxSteps = 4000, check = true, chooser = null, pending = false, ages, opponents = 1, civs = false, setup = null } = {}) {
  const rand = makeRand(`rand:${seed}`);
  const g = Game.create({
    seed: String(seed), humans: Array.from({ length: opponents + 1 }, (_, i) => i === 0), ages, opponents,
    civilizations: !!civs, civs: Array.isArray(civs) ? civs : undefined,
  });
  if (setup) setup(g);
  const answer = (_g, prompt) => randomAnswer(rand, prompt);
  g.policy = g.s.players.map((_, i) => (pending && i === 0 ? null : answer));
  g.begin();
  const errors = [];
  let steps = 0;
  let rejected = 0;
  let sinceEnd = 0;
  const stats = { applied: {}, events: {} };
  while (g.s.phase !== 'over' && steps < maxSteps) {
    steps += 1;
    const p = g.cur;
    const list = enumerateActions(g, p);
    let choice;
    if (chooser) choice = chooser(g, p, list, rand);
    else {
      const t = g.s.turn;
      const pool = list.map((c) => ({ c, w: (WEIGHT[c.cat] || 1) * (c.cat === 'end' ? (t.actionsLeft <= 0 || sinceEnd > 12 ? 8 : 0.3) : 1) }));
      let x = rand.int(1000) / 1000 * pool.reduce((n, e) => n + e.w, 0);
      choice = pool[pool.length - 1].c;
      for (const e of pool) {
        x -= e.w;
        if (x <= 0) { choice = e.c; break; }
      }
    }
    const before = check ? JSON.stringify(g.s) : null;
    let r;
    try {
      r = g.apply(choice.action);
    } catch (e) {
      errors.push(`THROW at step ${steps} on ${JSON.stringify(choice.action)}: ${e.stack}`);
      break;
    }
    while (r.ok && g.pending) r = g.respond(randomAnswer(rand, g.pending));
    if (!r.ok) {
      rejected += 1;
      if (check && JSON.stringify(g.s) !== before) errors.push(`state changed after rejected ${JSON.stringify(choice.action)}: ${r.error}`);
      if (rejected > 3000) { errors.push('too many rejections'); break; }
      continue;
    }
    stats.applied[choice.cat] = (stats.applied[choice.cat] || 0) + 1;
    sinceEnd = choice.cat === 'end' ? 0 : sinceEnd + 1;
    if (check) {
      const problems = checkInvariants(g);
      if (problems.length) {
        errors.push(`step ${steps} after ${JSON.stringify(choice.action)}:\n  ${problems.join('\n  ')}`);
        break;
      }
    }
    for (const ev of g.drainEvents()) stats.events[ev.type] = (stats.events[ev.type] || 0) + 1;
  }
  return { g, steps, rejected, errors, stats, over: g.s.phase === 'over' };
}
