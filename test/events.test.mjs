// Regressions for the 38 world events of source/events.csv: every test pins one rule of an Event card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_CARD_LIST } from '../src/engine/data/cards.js';
import { BARBARIAN, PIRATE, STACK_LIMIT } from '../src/engine/data/constants.js';
import { addUnit } from '../src/engine/state.js';
import { resolveEvent } from '../src/engine/events.js';
import { WORLD_EFFECTS, endRound } from '../src/engine/worldEvents.js';
import {
  allHexKeys, armyAt, armyOf, bfs, cityAt, citiesOf, citySize, hexDistance, isLand, nbrs, unitById, unitsAt, unitsLeft, unitsOf,
} from '../src/engine/queries.js';
import { checkInvariants } from './harness.mjs';
import { addCityAt, act, capitalOf, fresh, give, hold, refused, settlerOf } from './scenario.mjs';
import { collectCandidates } from '../src/engine/city.js';
import { gainRes } from '../src/engine/core.js';
import { advanceCost, availableAdvances } from '../src/engine/advance.js';
import { scoreOf } from '../src/engine/scoring.js';

const EVENT_IDS = EVENT_CARD_LIST.map((e) => e.id);
const NEW_EVENTS = EVENT_IDS.slice(18);
const me = (g, p = 0) => g.s.players[p];

// ------------------------------------------------------------------- fixtures
/** An open world: every space is Plains, so a scenario can put cities and units wherever it needs them. */
function flat(opponents = 2, seed = 'events') {
  const g = fresh(seed, { opponents });
  for (const h of Object.values(g.s.map.hexes)) h.terrain = 'plains';
  return g;
}

const free = (g, k) => !cityAt(g.s, k) && !unitsAt(g.s, k).length;
/** The spaces exactly `d` steps from `k` that nothing stands on, in map order. */
const ring = (g, k, d) => allHexKeys(g.s).filter((x) => hexDistance(k, x) === d && free(g, x));
const setTerrain = (g, k, terrain) => {
  g.s.map.hexes[k].terrain = terrain;
};

/** A city of p with these Buildings (never a Port: see `harbour`). */
function town(g, p, k, mood = 'neutral', buildings = []) {
  const c = addCityAt(g, p, k, mood);
  for (const b of buildings) c.buildings[b] = p;
  return c;
}

/** Give a city a Port: a free space next to it becomes the Sea space of its harbour. Returns that space. */
function harbour(g, c) {
  const sea = nbrs(g.s, c.hex).find((k) => free(g, k));
  setTerrain(g, sea, 'sea');
  c.buildings.port = c.owner;
  c.port = sea;
  return sea;
}

const stationed = (g, p, type, k, n = 1) => Array.from({ length: n }, () => addUnit(g.s, p, type, k));

/** A crowded table: Angry and happy cities with Buildings and a Port, armies at the front, Barbarians next door, a Ship at sea. */
function busy(seed = 'busy') {
  const g = flat(2, seed);
  const s = g.s;
  const [c0, c1, c2] = [0, 1, 2].map((p) => capitalOf(g, p));
  for (const p of [0, 1, 2]) give(g, p, { res: { food: 2, wood: 2, ore: 2, ideas: 1, gold: 3 }, mood: 2, culture: 2 });
  Object.assign(c0.buildings, { market: 0, temple: 0, academy: 0 });
  const angry = town(g, 0, ring(g, c0.hex, 2)[0], 'angry', ['fortress']);
  const port = town(g, 0, ring(g, c0.hex, 4)[0], 'happy');
  const sea = harbour(g, port);
  stationed(g, 0, 'infantry', c0.hex, 2);
  stationed(g, 0, 'cavalry', c0.hex);
  stationed(g, 0, 'ship', sea);
  give(g, 0, { advances: ['tactics', 'myths', 'fishing', 'writing', 'bartering'] });

  town(g, 1, ring(g, c1.hex, 2)[0], 'angry', ['academy', 'temple']);
  c1.buildings.market = 1;
  stationed(g, 1, 'infantry', ring(g, c1.hex, 1)[0], 2);
  give(g, 1, { advances: ['myths', 'writing', 'bartering'] });

  c2.mood = 'angry';
  c2.buildings.temple = 2;
  town(g, 2, ring(g, c2.hex, 3)[0], 'neutral', ['academy']);
  give(g, 2, { advances: ['draft', 'nationalism', 'state_religion', 'myths'] });
  me(g, 2).government = 'autocracy';

  const camp = addCityAt(g, BARBARIAN, ring(g, c0.hex, 3)[0]);
  stationed(g, BARBARIAN, 'infantry', camp.hex, 2);
  stationed(g, BARBARIAN, 'cavalry', camp.hex);
  stationed(g, BARBARIAN, 'infantry', ring(g, c1.hex, 2)[0], 2);
  assert.deepEqual(checkInvariants(g), [], 'the crowded table is legal');
  return g;
}

/** Put these Event cards on top of the draw pile; the first one is drawn first. */
function stack(g, ...ids) {
  const d = g.s.decks;
  d.event = d.event.filter((x) => !ids.includes(x));
  d.eventDiscard = d.eventDiscard.filter((x) => !ids.includes(x));
  d.event.push(...[...ids].reverse());
}

/** Every player answers with `answers[kind]` (a value, or a function of the prompt) and otherwise with the default. Returns the prompts asked. */
function asking(g, answers = {}) {
  const asked = [];
  g.s.players.forEach((_, q) => {
    g.policy[q] = (_g, prompt) => {
      asked.push(prompt);
      const a = answers[prompt.kind];
      return typeof a === 'function' ? a(prompt) : a !== undefined ? a : prompt.default;
    };
  });
  return asked;
}

function run(g, flow) {
  g.drainEvents();
  const r = g._run(flow);
  assert.ok(r.ok, r.error);
  assert.equal(g.pending, null, 'no question is left open');
  return g.drainEvents();
}

/** The card is drawn for player p: its icon first, then its text. Returns the prompts asked and the events that happened. */
function draw(g, id, p = 0, answers = {}) {
  stack(g, id);
  const asked = asking(g, answers);
  return { asked, events: run(g, resolveEvent(g, p)) };
}

/** Only the text of the card, as player p: no draw, no icon, no announcement. */
function effect(g, id, p = 0, answers = {}) {
  const asked = asking(g, answers);
  return { asked, events: run(g, WORLD_EFFECTS[id](g, p)) };
}

const ofType = (events, type) => events.filter((e) => e.type === type);
const logged = (g, pattern) => g.s.log.some((line) => pattern.test(line));

/** A player who answers every question at random, but legally. */
function gambler(seed) {
  let x = seed;
  const next = (n) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return (x >>> 8) % n;
  };
  return (_g, prompt) => {
    const ids = prompt.options.map((o) => o.id);
    if (!prompt.multi) return ids[next(ids.length)];
    const { min, max } = prompt.multi;
    const pool = [...ids];
    return Array.from({ length: min + next(max - min + 1) }, () => pool.splice(next(pool.length), 1)[0]);
  };
}

// ------------------------------------------------------------ every Event card
test('the 56 Event cards are all in the draw pile; the 38 new ones are world events, each with an effect of its own', () => {
  assert.equal(EVENT_IDS.length, 56);
  assert.equal(NEW_EVENTS.length, 38);
  // Migrating Tribes is its icon alone: a Barbarian settlement that pushes the units on its space away.
  assert.deepEqual(Object.keys(WORLD_EFFECTS).sort(), NEW_EVENTS.filter((id) => id !== 'migrating_tribes').sort());
});

test('every Event card resolves by default, whoever draws it, at a quiet table and at a crowded one; the discard pile gets the card', () => {
  for (const make of [() => flat(2), () => busy()]) {
    for (const id of EVENT_IDS) {
      for (const drawer of [0, 1, 2]) {
        const g = make();
        const { events } = draw(g, id, drawer);
        const first = ofType(events, 'event')[0];
        assert.deepEqual([first.player, first.card], [drawer, id], `${id}: announced`);
        assert.equal(g.s.decks.eventDiscard.at(-1), id, `${id}: discarded`);
        assert.deepEqual(checkInvariants(g), [], `${id} drawn by player ${drawer}`);
      }
    }
  }
});

test('random answers to every question never break the table either', () => {
  for (const id of EVENT_IDS) {
    for (let seed = 1; seed <= 8; seed++) {
      const g = busy(`chaos ${id} ${seed}`);
      const policy = gambler(seed * 7919 + id.length);
      g.policy = g.s.players.map(() => policy);
      stack(g, id);
      g.drainEvents();
      const r = g._run(resolveEvent(g, seed % 3));
      assert.ok(r.ok, `${id}: ${r.error}`);
      assert.equal(g.pending, null);
      assert.deepEqual(checkInvariants(g), [], `${id}, game ${seed}`);
    }
  }
});

// -------------------------------------------------------------------- the icons
test('the Gold Mine icon pays the drawer 2 Gold before the card is read: Economic Boom gives 5 Gold to the drawer and 1 to the others', () => {
  const g = flat();
  draw(g, 'economic_boom', 1);
  assert.deepEqual(g.s.players.map((p) => p.res.gold), [1, 5, 1]);
});

test('Gold stops at the limit of 7 for the drawer and for everybody else', () => {
  const g = flat();
  give(g, 0, { res: { gold: 6 } });
  give(g, 1, { res: { gold: 7 } });
  draw(g, 'economic_boom', 0);
  assert.deepEqual(g.s.players.map((p) => p.res.gold), [7, 7, 1]);
});

test('the Exhausted Land icon marks a space next to a city of the drawer before the text applies', () => {
  const g = flat();
  const { events } = draw(g, 'drought', 1);
  const marked = ofType(events, 'exhausted');
  assert.equal(marked.length, 1);
  const [{ hex }] = marked;
  assert.equal(g.s.map.hexes[hex].exhausted, true);
  assert.ok(citiesOf(g.s, 1).some((c) => nbrs(g.s, c.hex).includes(hex)), 'next to a city of the drawer');
  assert.ok(g.s.flags.drought);
  const lines = g.s.log;
  assert.ok(lines.findIndex((l) => /is exhausted/.test(l)) < lines.findIndex((l) => /^Drought:/.test(l)), 'the icon comes first');
});

test('the Barbarians Spawn icon comes first: the new Barbarians are already on the march when Barbarian Incursion is read', () => {
  const g = flat();
  const cap = capitalOf(g);
  const { events } = draw(g, 'barbarian_incursion', 0);
  assert.deepEqual(ofType(events, 'barbarians').map((e) => e.kind), ['spawn', 'reinforce', 'move']);
  const [camp] = g.s.cities.filter((c) => c.owner === BARBARIAN);
  assert.equal(hexDistance(camp.hex, cap.hex), 2, 'the settlement is 2 spaces from the drawer');
  assert.equal(armyAt(g.s, camp.hex, BARBARIAN).length, 0, 'its Infantry already left');
  const marching = unitsOf(g.s, BARBARIAN, 'infantry');
  assert.equal(marching.length, 2);
  assert.ok(marching.every((u) => u.hex === marching[0].hex && hexDistance(u.hex, cap.hex) === 1), 'one stack, 1 space from the city');
});

// ------------------------------------------------------------ the order of play
test('a world event asks the drawer first and then the other players clockwise', () => {
  const g = flat();
  const { asked } = draw(g, 'severe_famine', 1);
  // The card's Exhausted Land icon is settled by the drawer before anybody pays.
  assert.deepEqual(asked.map((q) => [q.player, q.kind]), [[1, 'event'], [1, 'pick_hex'], [1, 'choice'], [2, 'choice'], [0, 'choice']]);
});

// ------------------------------------------------------------ more fixtures
const only = (p, value) => (q) => (q.player === p ? value : q.default);

/** The capital of p (made neutral, with these Buildings) and one more neutral city for each further list of Buildings. */
function realm(g, p, capital, ...towns) {
  const cap = capitalOf(g, p);
  cap.mood = 'neutral';
  for (const b of capital) cap.buildings[b] = p;
  const spots = ring(g, cap.hex, 2);
  return [cap, ...towns.map((list, i) => town(g, p, spots[i], 'neutral', list))];
}

/** A Wonder that p built in the city (it is taken from the draw pile, so the cards stay conserved). */
function wonder(g, city, id = 'great_gardens') {
  g.s.decks.wonder = g.s.decks.wonder.filter((x) => x !== id);
  city.wonders.push({ id, builder: city.owner });
  me(g, city.owner).builtWonders.push(id);
}

/** The land path length from `k` to every space. */
const walk = (g, k) => bfs(g.s, k, 99, (n) => isLand(g.s, n));

/** A space whose whole disc of radius `r` is on the map and free of cities and units. */
function openSpace(g, r = 1) {
  const k = allHexKeys(g.s).find((x) => {
    const disc = bfs(g.s, x, r, () => true);
    return disc.size === 1 + 3 * r * (r + 1) && [...disc.keys()].every((y) => free(g, y));
  });
  assert.ok(k, `the map has a free disc of radius ${r}`);
  return k;
}

/** A free space `d` steps from the city at `k` and at least 4 steps from every other city: `k` is the nearest city. */
const outpost = (g, k, d) => ring(g, k, d).find((x) => g.s.cities.every((c) => c.hex === k || hexDistance(c.hex, x) >= 4));

/** A space on its own, with the sea all around it. */
function island(g) {
  const k = openSpace(g, 1);
  for (const n of nbrs(g.s, k)) setTerrain(g, n, 'sea');
  return k;
}

const stock = (g, p, res) => give(g, p, { res: { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0, ...res } });
const GOVERNMENTS = { autocracy: ['draft', 'nationalism'], theocracy: ['state_religion', 'dogma'], democracy: ['philosophy', 'voting'] };
function govern(g, p, name) {
  give(g, p, { advances: GOVERNMENTS[name] });
  me(g, p).government = name;
}

// ------------------------------------------------------------------- Barbarians
test('Barbarian Incursion: an army marches 1 space towards the nearest city, a whole stack together, and nobody is asked anything', () => {
  const g = flat();
  const cap = capitalOf(g, 0);
  const from = outpost(g, cap.hex, 3);
  const band = [...stationed(g, BARBARIAN, 'infantry', from, 3), ...stationed(g, BARBARIAN, 'cavalry', from)].map((u) => u.id);
  const { events, asked } = effect(g, 'barbarian_incursion', 2);
  const at = [...new Set(band.map((id) => unitById(g.s, id).hex))];
  assert.equal(at.length, 1, 'the stack stays together');
  const miles = walk(g, cap.hex);
  assert.equal(miles.get(at[0]), miles.get(from) - 1, 'one space nearer to the city');
  assert.deepEqual(ofType(events, 'barbarians').map((e) => [e.kind, e.from, e.hex]), [['move', from, at[0]]]);
  assert.equal(asked.length, 0);
  assert.deepEqual(checkInvariants(g), []);
});

test('Barbarian Incursion: each army heads for the nearest city of any player, not the drawer\'s', () => {
  const g = flat();
  const cities = [0, 1].map((p) => capitalOf(g, p));
  const bands = cities.map((c) => ({ c, from: outpost(g, c.hex, 2) }));
  for (const b of bands) b.ids = stationed(g, BARBARIAN, 'infantry', b.from, 2).map((u) => u.id);
  effect(g, 'barbarian_incursion', 2);
  for (const { c, from, ids } of bands) {
    const [here] = new Set(ids.map((id) => unitById(g.s, id).hex));
    const miles = walk(g, c.hex);
    assert.equal(miles.get(here), miles.get(from) - 1, `the band near ${c.hex} marches on it`);
  }
});

test('Barbarian Incursion: an army next to an undefended city walks in and takes it', () => {
  const g = flat();
  const cap = capitalOf(g, 0);
  stationed(g, BARBARIAN, 'infantry', ring(g, cap.hex, 1)[0], 2);
  const { events } = effect(g, 'barbarian_incursion', 0);
  const [taken] = ofType(events, 'capture');
  assert.deepEqual([taken.city, taken.by, taken.from], [cap.id, BARBARIAN, 0]);
  assert.equal(cap.owner, BARBARIAN);
  assert.equal(armyAt(g.s, cap.hex, BARBARIAN).length, 2, 'the band moved in');
  assert.deepEqual(checkInvariants(g), []);
});

test('Barbarian Incursion: a defended city is attacked, and it falls only when the Barbarians win the battle', () => {
  for (const seed of ['one', 'two', 'three', 'four']) {
    const g = flat(2, `incursion ${seed}`);
    const cap = capitalOf(g, 0);
    const from = ring(g, cap.hex, 1)[0];
    stationed(g, 0, 'infantry', cap.hex, 2);
    stationed(g, BARBARIAN, 'infantry', from, 3);
    const { events } = effect(g, 'barbarian_incursion', 1);
    const [start] = ofType(events, 'battle_start');
    assert.deepEqual([start.attacker, start.defender, start.hex, start.from], [BARBARIAN, 0, cap.hex, from]);
    const [end] = ofType(events, 'battle_end');
    assert.equal(end.captured, end.winner === BARBARIAN);
    assert.equal(cap.owner === BARBARIAN, end.captured);
    assert.deepEqual(checkInvariants(g), []);
  }
});

test('Barbarian Incursion: with no Barbarian army the card does nothing; an army that cannot walk to any city stays put while the others march', () => {
  const quiet = flat();
  const { events } = effect(quiet, 'barbarian_incursion', 0);
  assert.equal(events.length, 0);
  assert.ok(logged(quiet, /No Barbarian army is in reach of a city/));

  const g = flat();
  const cap = capitalOf(g, 0);
  const rock = island(g);
  const lost = stationed(g, BARBARIAN, 'infantry', rock)[0];
  const from = outpost(g, cap.hex, 3);
  const [walker] = stationed(g, BARBARIAN, 'infantry', from);
  const r = effect(g, 'barbarian_incursion', 0);
  assert.equal(ofType(r.events, 'barbarians').length, 1);
  assert.notEqual(walker.hex, from);
  assert.equal(lost.hex, rock, 'the island army stays where it was');
  assert.ok(!logged(g, /No Barbarian army/));
});

test('Barbarian Incursion: when every army is cut off from the cities the card says so and nothing moves', () => {
  const g = flat();
  const rock = island(g);
  const [lost] = stationed(g, BARBARIAN, 'infantry', rock);
  const { events } = effect(g, 'barbarian_incursion', 0);
  assert.equal(events.length, 0);
  assert.equal(lost.hex, rock);
  assert.ok(logged(g, /No Barbarian army is in reach of a city/));
});

test('Barbarian Incursion: the nearest army moves first, and the armies behind it no longer march on a city that has just fallen', () => {
  const g = flat();
  const cap = capitalOf(g, 0);
  const miles = [1, 2].map((p) => walk(g, capitalOf(g, p).hex));
  const gap = (k) => Math.min(...miles.map((m) => m.get(k)));
  const behind = ring(g, cap.hex, 2).find((k) => nbrs(g.s, k).filter((n) => isLand(g.s, n) && gap(n) === gap(k) - 1).every((n) => hexDistance(n, cap.hex) >= 2));
  assert.ok(behind, 'a space from which the way to the other capitals leads away from the first city');
  const first = ring(g, cap.hex, 1)[0];
  stationed(g, BARBARIAN, 'infantry', first, 2);
  const [late] = stationed(g, BARBARIAN, 'infantry', behind);
  const { events } = effect(g, 'barbarian_incursion', 2);
  assert.equal(cap.owner, BARBARIAN, 'the army next to the city took it');
  assert.deepEqual(ofType(events, 'barbarians').map((e) => [e.kind, e.from]), [['move', first], ['move', behind]], 'nearest first');
  assert.equal(gap(late.hex), gap(behind) - 1, 'the army behind marches on a city that still stands');
  assert.ok(hexDistance(late.hex, cap.hex) >= 2);
  assert.deepEqual(checkInvariants(g), []);
});

test('Feuding Warlords: a Barbarian band attacks the weakest army next to it, whoever that is', () => {
  const g = flat();
  const centre = openSpace(g, 1);
  const [strong, weak] = [ring(g, centre, 1)[0], ring(g, centre, 1)[3]];
  stationed(g, 0, 'infantry', strong, 3);
  stationed(g, 1, 'infantry', weak, 1);
  stationed(g, BARBARIAN, 'infantry', centre, 3);
  const { events } = effect(g, 'feuding_warlords', 2);
  const fights = ofType(events, 'battle_start');
  assert.equal(fights.length, 1, 'one band, one fight');
  assert.deepEqual([fights[0].attacker, fights[0].defender, fights[0].hex, fights[0].from], [BARBARIAN, 1, weak, centre]);
});

test('Feuding Warlords: an army inside a city is attacked too; an empty city and a distant army are left alone', () => {
  const g = flat();
  const cap = capitalOf(g, 0);
  stationed(g, 0, 'infantry', cap.hex);
  stationed(g, BARBARIAN, 'infantry', ring(g, cap.hex, 1)[0], 3);
  const { events } = effect(g, 'feuding_warlords', 0);
  assert.deepEqual(ofType(events, 'battle_start').map((e) => e.hex), [cap.hex]);

  const calm = flat();
  const home = capitalOf(calm, 1);
  stationed(calm, BARBARIAN, 'infantry', ring(calm, home.hex, 1)[0], 3);
  const far = outpost(calm, capitalOf(calm, 0).hex, 3);
  stationed(calm, 0, 'infantry', far, 2);
  stationed(calm, BARBARIAN, 'infantry', ring(calm, far, 2)[0], 2);
  const none = effect(calm, 'feuding_warlords', 0);
  assert.equal(ofType(none.events, 'battle_start').length, 0, 'an empty city is not a target, a band two spaces away does not strike');
  assert.equal(none.events.length, 0);
});

test('Feuding Warlords: a band that wins and moves on never fights a second time, whatever the dice say', () => {
  let won = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const g = flat(2, `warlords ${seed}`);
    const centre = openSpace(g, 1);
    const hit = ring(g, centre, 1)[0];
    const next = nbrs(g.s, hit).find((k) => hexDistance(k, centre) === 2 && free(g, k));
    stationed(g, 0, 'infantry', hit, 1);
    stationed(g, 1, 'infantry', next, 1);
    stationed(g, BARBARIAN, 'infantry', centre, 4);
    const { events } = effect(g, 'feuding_warlords', 0);
    assert.equal(ofType(events, 'battle_start').length, 1, `game ${seed}: each band fights once`);
    if (armyAt(g.s, hit, BARBARIAN).length) won += 1;
    assert.deepEqual(checkInvariants(g), []);
  }
  assert.ok(won > 0, 'at least once the band won and stood next to the second army');
});

test('Feuding Warlords: the bands strike in the order of the spaces they stand on, not in the order they arrived', () => {
  const g = flat();
  const posts = [0, 1].map((p) => {
    const cap = capitalOf(g, p);
    stationed(g, p, 'infantry', cap.hex);
    return { cap, from: ring(g, cap.hex, 1)[0] };
  });
  const [early, late] = posts.slice().sort((a, b) => (a.from < b.from ? -1 : 1));
  stationed(g, BARBARIAN, 'infantry', late.from, 2);
  stationed(g, BARBARIAN, 'infantry', early.from, 2);
  const { events } = effect(g, 'feuding_warlords', 2);
  assert.deepEqual(ofType(events, 'battle_start').map((e) => [e.from, e.hex]), [[early.from, early.cap.hex], [late.from, late.cap.hex]]);
});

test('Feuding Warlords: of two armies that are equally weak the band attacks the one on the space that comes first', () => {
  const g = flat();
  const centre = openSpace(g, 1);
  const [first, second] = [ring(g, centre, 1)[0], ring(g, centre, 1)[3]].sort();
  stationed(g, 1, 'infantry', second);
  stationed(g, 0, 'infantry', first);
  stationed(g, BARBARIAN, 'infantry', centre, 3);
  const { events } = effect(g, 'feuding_warlords', 2);
  assert.deepEqual(ofType(events, 'battle_start').map((e) => e.hex), [first]);
});

test('Feuding Warlords: Infantry on board a Ship at sea are out of reach of a band on the shore', () => {
  const g = flat();
  const sea = sail(g, 0);
  stationed(g, 0, 'infantry', sea, 2);
  stationed(g, BARBARIAN, 'infantry', nbrs(g.s, sea)[0], 3);
  const { events } = effect(g, 'feuding_warlords', 0);
  assert.equal(events.length, 0);
  assert.deepEqual(checkInvariants(g), []);
});

test('Feuding Warlords: Barbarian bands do not fight each other', () => {
  const g = flat();
  const centre = openSpace(g, 1);
  stationed(g, BARBARIAN, 'infantry', centre, 2);
  stationed(g, BARBARIAN, 'infantry', ring(g, centre, 1)[0], 2);
  const { events } = effect(g, 'feuding_warlords', 0);
  assert.equal(events.length, 0);
});

test('Migrating Tribes: the settlement can be placed on a rival\'s army, which retreats; other Barbarian cards cannot do that', () => {
  const table = () => {
    const g = flat();
    const cap = capitalOf(g, 0);
    const k = ring(g, cap.hex, 2).find((x) => [1, 2].every((p) => citiesOf(g.s, p).every((c) => hexDistance(c.hex, x) >= 3)));
    stationed(g, 1, 'infantry', k, 2);
    return { g, k };
  };
  const placeOn = (k) => ({ pick_hex: (q) => (q.title === 'Barbarians appear!' ? k : q.default) });

  const { g, k } = table();
  const { asked } = draw(g, 'migrating_tribes', 0, placeOn(k));
  const camp = g.s.cities.find((c) => c.owner === BARBARIAN);
  assert.equal(camp.hex, k, 'the settlement stands on the space of the rival army');
  assert.ok(armyAt(g.s, k, BARBARIAN).length >= 1);
  assert.deepEqual(asked.filter((q) => q.title === 'Retreat!').map((q) => q.player), [1], 'its owner chooses the retreat');
  const where = unitsOf(g.s, 1, 'infantry').map((u) => u.hex);
  assert.equal(new Set(where).size, 1, 'the army retreats as one stack');
  assert.ok(nbrs(g.s, k).includes(where[0]));
  assert.deepEqual(checkInvariants(g), []);

  const other = table();
  draw(other.g, 'barbarian_incursion', 0, placeOn(other.k));
  assert.notEqual(other.g.s.cities.find((c) => c.owner === BARBARIAN).hex, other.k, 'Barbarian Incursion never settles on an army');
  assert.equal(armyAt(other.g.s, other.k, 1).length, 2);
});

test('Steppe Scourge: 2 Barbarian Cavalry appear on the safe space farthest from the largest city and ride 2 spaces towards it', () => {
  const g = flat();
  const big = capitalOf(g, 2);
  big.buildings.market = 2;
  const miles = walk(g, big.hex);
  const reach = (k) => Math.min(...g.s.cities.map((c) => hexDistance(c.hex, k)));
  const safe = allHexKeys(g.s).filter((k) => free(g, k) && reach(k) >= 3);
  const farthest = Math.max(...safe.map((k) => miles.get(k)));
  const owners = g.s.cities.map((c) => c.owner);
  const { events } = effect(g, 'steppe_scourge', 0);
  const marks = ofType(events, 'barbarians');
  assert.deepEqual(marks.map((e) => e.kind), ['spawn', 'move', 'move']);
  assert.ok(safe.includes(marks[0].hex));
  assert.equal(miles.get(marks[0].hex), farthest);
  const horsemen = unitsOf(g.s, BARBARIAN, 'cavalry');
  assert.equal(horsemen.length, 2);
  assert.equal(new Set(horsemen.map((u) => u.hex)).size, 1, 'they ride together');
  assert.equal(miles.get(horsemen[0].hex), farthest - 2);
  assert.deepEqual(g.s.cities.map((c) => c.owner), owners, 'no city falls on the turn they appear');
  assert.deepEqual(checkInvariants(g), []);
});

test('Steppe Scourge: with the cities level the horsemen ride on the one nearest the drawer in seat order', () => {
  for (const drawer of [0, 1, 2]) {
    const g = flat();
    const target = capitalOf(g, drawer);
    const miles = walk(g, target.hex);
    const { events } = effect(g, 'steppe_scourge', drawer);
    const [spawn] = ofType(events, 'barbarians');
    const [horse] = unitsOf(g.s, BARBARIAN, 'cavalry');
    assert.equal(miles.get(horse.hex), miles.get(spawn.hex) - 2, `drawer ${drawer}`);
  }
});

test('Steppe Scourge: with no safe space the horsemen appear on the farthest free space and do not ride', () => {
  const g = flat(1);
  const reach = (k) => Math.min(...g.s.cities.map((c) => hexDistance(c.hex, k)));
  for (let n = 0; ; n++) {
    const far = allHexKeys(g.s).filter((k) => free(g, k) && reach(k) >= 3).sort((a, b) => reach(b) - reach(a))[0];
    if (!far) break;
    town(g, n % 2, far);
  }
  const target = capitalOf(g, 0);
  const miles = walk(g, target.hex);
  const open = allHexKeys(g.s).filter((k) => free(g, k));
  const farthest = Math.max(...open.map((k) => miles.get(k)));
  const { events } = effect(g, 'steppe_scourge', 0);
  assert.deepEqual(ofType(events, 'barbarians').map((e) => e.kind), ['spawn']);
  const horsemen = unitsOf(g.s, BARBARIAN, 'cavalry');
  assert.equal(horsemen.length, 2);
  assert.equal(miles.get(horsemen[0].hex), farthest);
});

test('Steppe Scourge: only as many Cavalry as the Barbarians have left come', () => {
  const one = flat();
  stationed(one, BARBARIAN, 'cavalry', outpost(one, capitalOf(one, 0).hex, 3), 3);
  effect(one, 'steppe_scourge', 0);
  assert.equal(unitsOf(one.s, BARBARIAN, 'cavalry').length, 4);
  assert.equal(unitsLeft(one.s, BARBARIAN, 'cavalry'), 0);

  const none = flat();
  stationed(none, BARBARIAN, 'cavalry', outpost(none, capitalOf(none, 0).hex, 3), 4);
  const { events } = effect(none, 'steppe_scourge', 0);
  assert.equal(events.length, 0);
});

test('Steppe Scourge: when several spaces are equally far the horsemen come in on the one that comes first', () => {
  const g = flat(1);
  const miles = walk(g, capitalOf(g, 0).hex);
  const reach = (k) => Math.min(...g.s.cities.map((c) => hexDistance(c.hex, k)));
  const safe = allHexKeys(g.s).filter((k) => free(g, k) && reach(k) >= 3);
  const farthest = Math.max(...safe.map((k) => miles.get(k)));
  const tied = safe.filter((k) => miles.get(k) === farthest).sort();
  assert.ok(tied.length > 1, 'the premise: there is a tie');
  const [spawn] = ofType(effect(g, 'steppe_scourge', 0).events, 'barbarians');
  assert.equal(spawn.hex, tied[0]);
});

test('Steppe Scourge: the horsemen never appear on a space that already holds units, and never on land that cannot be walked to', () => {
  const probe = flat();
  const [first] = ofType(effect(probe, 'steppe_scourge', 0).events, 'barbarians');

  const crowded = flat();
  stationed(crowded, 1, 'infantry', first.hex);
  const [spawn] = ofType(effect(crowded, 'steppe_scourge', 0).events, 'barbarians');
  assert.notEqual(spawn.hex, first.hex);
  assert.equal(armyAt(crowded.s, first.hex, 1).length, 1);
  assert.deepEqual(checkInvariants(crowded), []);

  const g = flat();
  const rock = island(g);
  assert.ok(Math.min(...g.s.cities.map((c) => hexDistance(c.hex, rock))) >= 3, 'the premise: the island is at a safe distance from every city');
  const [landing] = ofType(effect(g, 'steppe_scourge', 0).events, 'barbarians');
  assert.ok(walk(g, capitalOf(g, 0).hex).has(landing.hex), 'the horsemen come in on land that the cities can be reached from');
  assert.equal(armyAt(g.s, rock, BARBARIAN).length, 0);
});

test('Steppe Scourge: the horsemen make way only where the Barbarian stack would not grow beyond 4', () => {
  const probe = flat();
  const origin = ofType(effect(probe, 'steppe_scourge', 0).events, 'barbarians')[0].hex;
  const ride = (infantry) => {
    const g = flat();
    const miles = walk(g, capitalOf(g, 0).hex);
    const ahead = nbrs(g.s, origin).filter((k) => isLand(g.s, k) && miles.get(k) === miles.get(origin) - 1);
    assert.ok(ahead.length > 0);
    for (const k of ahead) stationed(g, BARBARIAN, 'infantry', k, infantry);
    const { events } = effect(g, 'steppe_scourge', 0);
    return { g, ahead, marks: ofType(events, 'barbarians') };
  };
  const blocked = ride(3);
  assert.deepEqual(blocked.marks.map((e) => e.kind), ['spawn'], '3 Infantry and 2 Cavalry would make 5');
  assert.equal(armyAt(blocked.g.s, origin, BARBARIAN).length, 2, 'the horsemen wait where they appeared');
  assert.deepEqual(checkInvariants(blocked.g), []);

  const room = ride(2);
  assert.deepEqual(room.marks.map((e) => e.kind), ['spawn', 'move', 'move'], '2 Infantry and 2 Cavalry make exactly 4');
  assert.ok(room.ahead.includes(room.marks[1].hex));
  assert.deepEqual(checkInvariants(room.g), []);
});

// ----------------------------------------------- Severe Famine, Corrupt Officials, Slave Revolt
test('Severe Famine: a player feeds as many cities as they can pay Food for, the largest first, and every city left hungry turns Angry', () => {
  const g = flat();
  const [cap, mid, hamlet] = realm(g, 0, ['market', 'temple'], ['market'], []);
  stock(g, 0, { food: 2 });
  const { asked, events } = effect(g, 'severe_famine', 0);
  const mine = asked.filter((q) => q.player === 0);
  assert.deepEqual(mine.map((q) => q.kind), ['choice', 'pick_cities']);
  assert.deepEqual(mine[0].options.map((o) => o.id), ['0', '1', '2'], 'Food for two of the three cities');
  assert.equal(mine[0].default, '2');
  assert.deepEqual(mine[1].default, [cap.id, mid.id], 'the largest cities are fed first');
  assert.deepEqual([cap, mid, hamlet].map((c) => c.mood), ['neutral', 'neutral', 'angry']);
  assert.equal(me(g, 0).res.food, 0);
  assert.deepEqual(ofType(events, 'mood').map((e) => e.city), [hamlet.id]);
  assert.deepEqual(checkInvariants(g), []);
});

test('Severe Famine: the player chooses which cities to feed; paying nothing leaves every city hungry and keeps the Food', () => {
  const g = flat();
  const [cap, mid, hamlet] = realm(g, 0, ['market', 'temple'], ['market'], []);
  stock(g, 0, { food: 2 });
  effect(g, 'severe_famine', 0, { choice: only(0, '1'), pick_cities: only(0, [hamlet.id]) });
  assert.deepEqual([cap, mid, hamlet].map((c) => c.mood), ['angry', 'angry', 'neutral']);
  assert.equal(me(g, 0).res.food, 1);

  const none = flat();
  const towns = realm(none, 0, ['market'], [], []);
  stock(none, 0, { food: 2 });
  const { asked } = effect(none, 'severe_famine', 0, { choice: only(0, '0') });
  assert.ok(towns.every((c) => c.mood === 'angry'));
  assert.equal(me(none, 0).res.food, 2);
  assert.ok(!asked.some((q) => q.kind === 'pick_cities'), 'nothing is paid, so there is nothing to choose');
});

test('Severe Famine: with Food for every city nobody goes hungry and the player is not asked which cities to feed', () => {
  const g = flat();
  const towns = realm(g, 0, [], [], []);
  give(g, 0, { advances: ['storage'] });
  stock(g, 0, { food: 5 });
  const { asked } = effect(g, 'severe_famine', 0);
  assert.deepEqual(asked.filter((q) => q.player === 0).map((q) => q.options.map((o) => o.id)), [['0', '1', '2', '3']]);
  assert.ok(towns.every((c) => c.mood === 'neutral'));
  assert.equal(me(g, 0).res.food, 2);
  assert.deepEqual(checkInvariants(g), []);
});

test('Severe Famine: a player with no Food is not asked and every calm city turns Angry; a city that is Angry already is left out', () => {
  const g = flat();
  const [cap, calm, angry] = realm(g, 0, [], [], []);
  angry.mood = 'angry';
  stock(g, 0, {});
  const { asked, events } = effect(g, 'severe_famine', 0);
  assert.equal(asked.filter((q) => q.player === 0).length, 0);
  assert.deepEqual([cap, calm, angry].map((c) => c.mood), ['angry', 'angry', 'angry']);
  assert.deepEqual(ofType(events, 'mood').map((e) => e.city).sort(), [cap.id, calm.id].sort(), 'the Angry city is not touched again');

  const fed = flat();
  const [home, other] = realm(fed, 0, [], []);
  other.mood = 'angry';
  stock(fed, 0, { food: 2 });
  const r = effect(fed, 'severe_famine', 0);
  assert.deepEqual(r.asked.filter((q) => q.player === 0).map((q) => q.options.map((o) => o.id)), [['0', '1']], 'only one city can be fed');
  assert.equal(me(fed, 0).res.food, 1);
  assert.equal(home.mood, 'neutral');
});

test('Severe Famine: Myths can pay 1 Mood token to keep a hungry city calm; without a token the city simply turns Angry', () => {
  const hungry = (mood, answer) => {
    const g = flat();
    const [cap] = realm(g, 0, []);
    give(g, 0, { advances: ['myths'], mood });
    stock(g, 0, {});
    const { asked } = effect(g, 'severe_famine', 0, answer ? { myths: only(0, answer) } : {});
    return { cap, mood: me(g, 0).mood, asked: asked.filter((q) => q.player === 0).map((q) => q.kind) };
  };
  const paid = hungry(2);
  assert.deepEqual([paid.cap.mood, paid.mood, paid.asked], ['neutral', 1, ['myths']], 'a spare token is paid by default');
  const kept = hungry(1);
  assert.deepEqual([kept.cap.mood, kept.mood, kept.asked], ['angry', 1, ['myths']], 'the last token is kept by default');
  const forced = hungry(1, 'yes');
  assert.deepEqual([forced.cap.mood, forced.mood], ['neutral', 0]);
  const declined = hungry(3, 'no');
  assert.deepEqual([declined.cap.mood, declined.mood], ['angry', 3]);
  const broke = hungry(0);
  assert.deepEqual([broke.cap.mood, broke.asked], ['angry', []], 'no token, no question');
});

test('Severe Famine: Irrigation ignores the card, so its owner is not asked and nothing happens to their cities; the others still pay', () => {
  const g = flat();
  const [cap, other] = realm(g, 0, [], []);
  give(g, 0, { advances: ['irrigation'] });
  stock(g, 0, {});
  const { asked } = effect(g, 'severe_famine', 0);
  assert.deepEqual(asked.map((q) => q.player), [1, 2]);
  assert.deepEqual([cap.mood, other.mood], ['neutral', 'neutral']);
  assert.ok(logged(g, /Irrigation protects .* against the Severe Famine/));
  assert.deepEqual([1, 2].map((p) => me(g, p).res.food), [1, 1], 'the others fed their capitals');
});

test('Severe Famine: the cities to feed are named in a list of exactly as many as were paid for; a shorter list is not accepted', () => {
  const g = flat();
  const [cap, mid, hamlet] = realm(g, 0, ['market', 'temple'], ['market'], []);
  stock(g, 0, { food: 1 });
  const { asked } = effect(g, 'severe_famine', 0, { pick_cities: only(0, []) });
  const pick = asked.find((q) => q.kind === 'pick_cities');
  assert.deepEqual(pick.multi, { min: 1, max: 1 });
  assert.deepEqual([cap, mid, hamlet].map((c) => c.mood), ['neutral', 'angry', 'angry'], 'an empty list gives way to the default, the largest city');
  assert.equal(me(g, 0).res.food, 0);
});

test('Severe Famine: a city that is left unpaid turns Angry at once, even when it was Happy', () => {
  const g = flat();
  const home = capitalOf(g, 0);
  assert.equal(home.mood, 'happy');
  stock(g, 0, {});
  effect(g, 'severe_famine', 0);
  assert.equal(home.mood, 'angry');
});

test('Corrupt Officials: 1 Gold keeps a city honest, every unpaid city turns corrupt without changing its Mood, and a player without Gold cannot pay at all', () => {
  const g = flat();
  const [cap, mid, hamlet] = realm(g, 0, ['market', 'temple'], ['market'], []);
  stock(g, 0, { gold: 1 });
  const { asked, events } = effect(g, 'corrupt_officials', 0);
  const mine = asked.filter((q) => q.player === 0);
  assert.deepEqual(mine.map((q) => q.kind), ['choice', 'pick_cities']);
  assert.deepEqual(mine[0].options.map((o) => o.id), ['0', '1']);
  assert.deepEqual([cap, mid, hamlet].map((c) => !!c.corrupt), [false, true, true], 'the largest city was paid for');
  assert.deepEqual([cap, mid, hamlet].map((c) => c.mood), ['neutral', 'neutral', 'neutral']);
  assert.equal(me(g, 0).res.gold, 0);
  assert.equal(asked.filter((q) => q.player !== 0).length, 0, 'the others have no Gold, so there is nothing to ask');
  assert.deepEqual([1, 2].map((p) => !!capitalOf(g, p).corrupt), [true, true]);
  assert.equal(ofType(events, 'mood').length, 4, 'one change per corrupt city');
  assert.deepEqual(checkInvariants(g), []);
});

test('Corrupt Officials: a corrupt city cannot Collect; any other action there cleans it, and then it Collects again', () => {
  const g = flat();
  realm(g, 0, []);
  stock(g, 0, { food: 1, ore: 1 });
  effect(g, 'corrupt_officials', 0);
  // A refused action restores the state from a snapshot, so the city is looked up again each time.
  const cap = () => capitalOf(g, 0);
  assert.equal(cap().corrupt, true);
  assert.deepEqual(collectCandidates(g.s, 0, cap()), []);
  assert.match(refused(g, { type: 'collect', city: cap().id, picks: [{ hex: cap().hex, res: 'food' }] }), /corrupt/);
  act(g, { type: 'recruit', city: cap().id, units: { infantry: 1 } });
  assert.ok(!cap().corrupt, 'the Recruit action activated the city');
  assert.ok(collectCandidates(g.s, 0, cap()).length > 0);
  act(g, { type: 'collect', city: cap().id, picks: [{ hex: cap().hex, res: 'food' }] });
  assert.equal(me(g, 0).res.food, 1);
});

test('Corrupt Officials: a city that is corrupt already is not charged for again', () => {
  const g = flat();
  const [cap, other] = realm(g, 0, [], []);
  cap.corrupt = true;
  stock(g, 0, { gold: 2 });
  const { asked } = effect(g, 'corrupt_officials', 0);
  assert.deepEqual(asked.filter((q) => q.player === 0).map((q) => q.options.map((o) => o.id)), [['0', '1']], 'only the clean city can be paid for');
  assert.equal(me(g, 0).res.gold, 1);
  assert.deepEqual([cap.corrupt, !!other.corrupt], [true, false]);
});

test('Slave Revolt: only a player under an Autocracy is asked; every city they cannot pay a Gold for turns Angry, an Angry one is left out', () => {
  const g = flat();
  const [cap, mid, riot] = realm(g, 0, ['market'], [], []);
  riot.mood = 'angry';
  govern(g, 0, 'autocracy');
  stock(g, 0, { gold: 1 });
  stock(g, 1, { gold: 3 });
  const { asked, events } = effect(g, 'slave_revolt', 1);
  assert.deepEqual(asked.map((q) => [q.player, q.kind]), [[0, 'choice'], [0, 'pick_cities']], 'nobody else is asked');
  assert.deepEqual([cap, mid, riot].map((c) => c.mood), ['neutral', 'angry', 'angry']);
  assert.equal(me(g, 0).res.gold, 0);
  assert.deepEqual(ofType(events, 'mood').map((e) => e.city), [mid.id]);
  assert.deepEqual([me(g, 1).res.gold, capitalOf(g, 1).mood, capitalOf(g, 2).mood], [3, 'happy', 'happy'], 'the others are untouched');
  assert.deepEqual(checkInvariants(g), []);
});

test('Slave Revolt: a city that is left unpaid turns Angry at once, even when it was Happy', () => {
  const g = flat();
  const home = capitalOf(g, 0);
  assert.equal(home.mood, 'happy');
  govern(g, 0, 'autocracy');
  stock(g, 0, {});
  effect(g, 'slave_revolt', 0);
  assert.equal(home.mood, 'angry');
});

test('Slave Revolt: Gold is never spent on a city that is Angry already, so only the calm cities can be paid for', () => {
  const g = flat();
  const [cap, mid, riot] = realm(g, 0, [], [], []);
  riot.mood = 'angry';
  govern(g, 0, 'autocracy');
  stock(g, 0, { gold: 3 });
  const { asked } = effect(g, 'slave_revolt', 0);
  assert.deepEqual(asked.map((q) => [q.player, q.kind]), [[0, 'choice']], 'both calm cities are paid for, so there is no list to choose from');
  assert.deepEqual(asked[0].options.map((o) => o.id), ['0', '1', '2']);
  assert.equal(asked[0].default, '2');
  assert.equal(me(g, 0).res.gold, 1);
  assert.deepEqual([cap, mid, riot].map((c) => c.mood), ['neutral', 'neutral', 'angry']);
});

// ---------------------------------------------------------------------- Epidemic
const lostBuildings = (events) => ofType(events, 'building_lost').map((e) => [e.city, e.building]);

test('Epidemic: the largest city with a Building loses one, the cheapest by default, and its owner may choose another', () => {
  const g = flat();
  const [big] = realm(g, 0, ['temple', 'market']);
  const [small] = realm(g, 1, ['market']);
  const { asked, events } = effect(g, 'epidemic_city', 0);
  assert.deepEqual(asked.map((q) => [q.player, q.kind]), [[0, 'choice']], 'one city, so only the Building is asked');
  assert.deepEqual(lostBuildings(events), [[big.id, 'market']]);
  assert.deepEqual(Object.keys(big.buildings), ['temple']);
  assert.deepEqual(Object.keys(small.buildings), ['market'], 'the smaller city is spared');

  const chosen = flat();
  const [city] = realm(chosen, 0, ['temple', 'market']);
  effect(chosen, 'epidemic_city', 0, { choice: only(0, 'temple') });
  assert.deepEqual(Object.keys(city.buildings), ['market']);
  assert.deepEqual(checkInvariants(chosen), []);
});

test('Epidemic: when the largest cities belong to several players each of them loses a Building, the drawer first', () => {
  const g = flat();
  const [a] = realm(g, 0, ['market', 'academy']);
  const [b] = realm(g, 1, ['temple', 'fortress']);
  const { asked, events } = effect(g, 'epidemic_city', 1);
  assert.deepEqual(asked.map((q) => q.player), [1, 0], 'clockwise from the drawer');
  assert.deepEqual(lostBuildings(events), [[b.id, 'fortress'], [a.id, 'market']]);
});

test('Epidemic: an owner of several tied cities chooses which one suffers', () => {
  const g = flat();
  const [first, second] = realm(g, 0, ['market'], ['market']);
  const { asked } = effect(g, 'epidemic_city', 0, { pick_city: only(0, second.id) });
  assert.deepEqual(asked.map((q) => q.kind), ['pick_city'], 'each city has one Building, so only the city is asked');
  assert.deepEqual([Object.keys(first.buildings), Object.keys(second.buildings)], [['market'], []]);
});

test('Epidemic: a city with only Wonders is not a victim, and neither is a Barbarian city', () => {
  const g = flat();
  const [home, town1] = realm(g, 0, [], ['market']);
  wonder(g, home, 'great_statue');
  wonder(g, home, 'great_arena');
  const camp = addCityAt(g, BARBARIAN, ring(g, home.hex, 4)[0]);
  Object.assign(camp.buildings, { temple: BARBARIAN, academy: BARBARIAN });
  const { events } = effect(g, 'epidemic_city', 0);
  assert.deepEqual(lostBuildings(events), [[town1.id, 'market']], 'size 3 with Wonders only, and size 3 with Barbarian Buildings, are both safe');
  assert.deepEqual(Object.keys(camp.buildings), ['temple', 'academy']);
  assert.equal(home.wonders.length, 2);
  assert.deepEqual(checkInvariants(g), []);
});

test('Epidemic: with no Building anywhere nothing is lost; a lost Port leaves its city without a harbour', () => {
  const quiet = flat();
  const { events } = effect(quiet, 'epidemic_city', 0);
  assert.equal(events.length, 0);
  assert.ok(logged(quiet, /No city is big enough for the Epidemic to matter/));

  const g = flat();
  const [cap] = realm(g, 0, ['market']);
  harbour(g, cap);
  const r = effect(g, 'epidemic_city', 0, { choice: only(0, 'port') });
  assert.deepEqual(lostBuildings(r.events), [[cap.id, 'port']]);
  assert.equal(cap.port, null);
  assert.deepEqual(Object.keys(cap.buildings), ['market']);
  assert.deepEqual(checkInvariants(g), []);
});

test('Epidemic: Sanitation ignores the card, and the Epidemic does not move on to the next city', () => {
  const g = flat();
  const [big] = realm(g, 0, ['market', 'temple']);
  const [small] = realm(g, 1, ['market']);
  give(g, 0, { advances: ['sanitation'] });
  const { asked, events } = effect(g, 'epidemic_city', 0);
  assert.equal(asked.length, 0);
  assert.equal(events.length, 0);
  assert.deepEqual([Object.keys(big.buildings), Object.keys(small.buildings)], [['market', 'temple'], ['market']]);
  assert.ok(logged(g, /Sanitation protects .* against the Epidemic/));
});

test('Epidemic: left to the default a city gives up its Buildings from the cheapest to the dearest', () => {
  const g = flat();
  const [cap] = realm(g, 0, ['academy', 'temple', 'fortress', 'market']);
  harbour(g, cap);
  const lost = [];
  for (let strike = 0; strike < 5; strike++) lost.push(...lostBuildings(effect(g, 'epidemic_city', 0).events).map(([, building]) => building));
  assert.deepEqual(lost, ['market', 'port', 'fortress', 'temple', 'academy']);
  assert.deepEqual(Object.keys(cap.buildings), []);
  assert.deepEqual(checkInvariants(g), []);
});

test('Epidemic: an answer that is not one of the city\'s Buildings costs it its first Building instead of crashing', () => {
  const g = flat();
  const [cap] = realm(g, 0, ['temple', 'market']);
  const flow = WORLD_EFFECTS.epidemic_city(g, 0);
  assert.equal(flow.next().value.kind, 'choice');
  assert.ok(flow.next('academy').done);
  assert.deepEqual(Object.keys(cap.buildings), ['market']);
});

// ---------------------------------------------------------------- Civil Revolt
const rebels = (events) => ofType(events, 'barbarians').filter((e) => e.kind === 'spawn').map((e) => e.hex);

test('Civil Revolt: the player with the most Angry cities loses a Building in one of them and a Barbarian Infantry rises next to it', () => {
  const g = flat();
  const [cap, hill] = realm(g, 0, ['market', 'temple'], ['academy']);
  cap.mood = 'angry';
  hill.mood = 'angry';
  const [rival] = realm(g, 1, ['market']);
  rival.mood = 'angry';
  const { asked, events } = effect(g, 'civil_revolt', 2);
  assert.deepEqual(asked.map((q) => [q.player, q.kind]), [[0, 'pick_city']], 'the leader names the city; its single Building needs no question');
  assert.deepEqual(lostBuildings(events), [[hill.id, 'academy']], 'by default the smaller city pays');
  assert.deepEqual(Object.keys(rival.buildings), ['market'], 'one Angry city does not make a leader');
  const [spot] = rebels(events);
  assert.ok(nbrs(g.s, hill.hex).includes(spot));
  assert.deepEqual(armyAt(g.s, spot, BARBARIAN).map((u) => u.type), ['infantry']);
  assert.deepEqual(checkInvariants(g), []);

  const chosen = flat();
  const [home, other] = realm(chosen, 0, ['market', 'temple'], ['academy']);
  home.mood = other.mood = 'angry';
  const r = effect(chosen, 'civil_revolt', 0, { pick_city: only(0, home.id), choice: only(0, 'temple') });
  assert.deepEqual(lostBuildings(r.events), [[home.id, 'temple']]);
  assert.ok(nbrs(chosen.s, home.hex).includes(rebels(r.events)[0]));
});

test('Civil Revolt: players tied for the most Angry cities all lose a Building, and a rebel rises for each', () => {
  const g = flat();
  const [a] = realm(g, 0, ['market']);
  const [b] = realm(g, 1, ['temple']);
  a.mood = b.mood = 'angry';
  const { events } = effect(g, 'civil_revolt', 1);
  assert.deepEqual(lostBuildings(events), [[b.id, 'temple'], [a.id, 'market']], 'clockwise from the drawer');
  assert.equal(rebels(events).length, 2);
});

test('Civil Revolt: nothing happens without an Angry city', () => {
  const g = flat();
  const [cap] = realm(g, 0, ['market', 'temple']);
  const { events } = effect(g, 'civil_revolt', 0);
  assert.equal(events.length, 0);
  assert.deepEqual(Object.keys(cap.buildings), ['market', 'temple']);
});

test('Civil Revolt: only the Angry cities are on offer, even when a calm city is smaller and would be the easier choice', () => {
  const g = flat();
  const [riot, unrest, calm] = realm(g, 0, ['market', 'temple'], ['academy', 'market'], ['market']);
  riot.mood = unrest.mood = 'angry';
  const { asked, events } = effect(g, 'civil_revolt', 0);
  const pick = asked.find((q) => q.kind === 'pick_city');
  assert.deepEqual(pick.options.map((o) => o.id).sort(), [riot.id, unrest.id].sort());
  const [[hit]] = lostBuildings(events);
  assert.ok([riot.id, unrest.id].includes(hit), 'one of the Angry cities loses the Building');
  assert.deepEqual(Object.keys(calm.buildings), ['market'], 'the calm city is left alone');
});

test('Civil Revolt: an Angry city with no Building sends the rebels to a Building elsewhere; with none to burn they do not come', () => {
  const g = flat();
  const [cap, village] = realm(g, 0, [], ['market']);
  cap.mood = 'angry';
  const { events } = effect(g, 'civil_revolt', 0);
  assert.deepEqual(lostBuildings(events), [[village.id, 'market']]);
  assert.ok(nbrs(g.s, village.hex).includes(rebels(events)[0]));

  const bare = flat();
  const [home] = realm(bare, 0, []);
  home.mood = 'angry';
  const r = effect(bare, 'civil_revolt', 0);
  assert.equal(r.events.length, 0);
  assert.ok(logged(bare, /has no Building for the rebels to destroy/));
  assert.equal(unitsOf(bare.s, BARBARIAN).length, 0);
});

test('Civil Revolt: the rebels rise on the free space with the fewest units; spaces with foreign units or cities are out of the question', () => {
  const crowd = flat();
  const [cap] = realm(crowd, 0, ['market']);
  cap.mood = 'angry';
  const around = nbrs(crowd.s, cap.hex);
  const empty = around.pop();
  around.forEach((k) => stationed(crowd, BARBARIAN, 'infantry', k, 2));
  const r = effect(crowd, 'civil_revolt', 0);
  assert.deepEqual(rebels(r.events), [empty]);

  const g = flat();
  const [home] = realm(g, 0, ['market']);
  home.mood = 'angry';
  const ring1 = nbrs(g.s, home.hex);
  const open = ring1.pop();
  ring1.forEach((k, i) => (i % 2 ? town(g, 2, k) : stationed(g, 1, 'infantry', k)));
  stationed(g, BARBARIAN, 'infantry', open);
  const { events } = effect(g, 'civil_revolt', 0);
  assert.deepEqual(rebels(events), [open], 'a city or a foreign army blocks the space even when it is emptier');
  assert.equal(armyAt(g.s, open, BARBARIAN).length, 2);
  assert.deepEqual(checkInvariants(g), []);
});

test('Civil Revolt: the Building burns but no rebel comes when the free space holds a full Barbarian stack, or the Barbarians have no Infantry left', () => {
  const shore = () => {
    const g = flat();
    const [cap] = realm(g, 0, ['market']);
    cap.mood = 'angry';
    const [land, ...sea] = nbrs(g.s, cap.hex);
    sea.forEach((k) => setTerrain(g, k, 'sea'));
    return { g, cap, land };
  };
  const full = shore();
  stationed(full.g, BARBARIAN, 'infantry', full.land, STACK_LIMIT);
  const a = effect(full.g, 'civil_revolt', 0);
  assert.deepEqual([lostBuildings(a.events).length, rebels(a.events).length], [1, 0]);
  assert.equal(armyAt(full.g.s, full.land, BARBARIAN).length, STACK_LIMIT);

  const spent = shore();
  const camps = allHexKeys(spent.g.s).filter((k) => free(spent.g, k) && isLand(spent.g.s, k) && hexDistance(k, spent.cap.hex) >= 3);
  for (const k of camps.slice(0, 5)) stationed(spent.g, BARBARIAN, 'infantry', k, STACK_LIMIT);
  assert.equal(unitsLeft(spent.g.s, BARBARIAN, 'infantry'), 0);
  const b = effect(spent.g, 'civil_revolt', 0);
  assert.deepEqual([lostBuildings(b.events).length, rebels(b.events).length], [1, 0]);
  assert.deepEqual(checkInvariants(spent.g), []);
});

// ------------------------------------------------------------ Earthquake, Pirate Raids
test('Earthquake: a random Building of a random city falls, whoever owns it, and nobody is asked', () => {
  const hit = new Set();
  for (let rng = 1; rng <= 60; rng++) {
    const g = flat();
    const [a] = realm(g, 0, ['market', 'temple']);
    const [b] = realm(g, 1, ['academy']);
    g.s.rng = rng;
    const { asked, events } = effect(g, 'earthquake_city', 2);
    assert.equal(asked.length, 0);
    const lost = lostBuildings(events);
    assert.equal(lost.length, 1, `rng ${rng}: one Building falls`);
    hit.add(`${lost[0][0] === a.id ? 'first' : lost[0][0] === b.id ? 'second' : '?'} ${lost[0][1]}`);
    assert.equal(Object.keys(a.buildings).length + Object.keys(b.buildings).length, 2);
  }
  assert.deepEqual([...hit].sort(), ['first market', 'first temple', 'second academy']);

  const quiet = flat();
  const { events } = effect(quiet, 'earthquake_city', 0);
  assert.equal(events.length, 0);
  assert.ok(logged(quiet, /The earthquake finds no Building to topple/));
});

test('Pirate Raids: a Pirate Ship appears first; then every player with a Port loses 1 resource, by default the one they can best do without; the others are spared', () => {
  const g = flat();
  harbour(g, realm(g, 0, ['market'])[0]);
  harbour(g, capitalOf(g, 1));
  stock(g, 0, { food: 2, wood: 1, gold: 3 });
  stock(g, 1, {});
  stock(g, 2, { food: 2, gold: 3 });
  const { asked } = effect(g, 'pirate_raids', 1);
  assert.deepEqual(asked.map((q) => [q.player, q.kind]), [[1, 'pick_hex'], [0, 'pick_resource']], 'the drawer places the Ship; the Port of the player with nothing costs nothing');
  assert.equal(unitsOf(g.s, PIRATE, 'ship').length, 1);
  assert.deepEqual(asked[1].options.map((o) => o.id), ['food', 'wood', 'gold']);
  assert.equal(asked[1].default, 'gold');
  assert.deepEqual([me(g, 0).res.food, me(g, 0).res.wood, me(g, 0).res.gold], [2, 1, 2]);
  assert.deepEqual([me(g, 2).res.food, me(g, 2).res.gold], [2, 3], 'no Port, no raid');

  const picked = flat();
  harbour(picked, capitalOf(picked, 0));
  stock(picked, 0, { food: 2, wood: 1, gold: 3 });
  effect(picked, 'pirate_raids', 0, { pick_resource: only(0, 'wood') });
  assert.deepEqual([me(picked, 0).res.food, me(picked, 0).res.wood, me(picked, 0).res.gold], [2, 0, 3]);
  assert.equal(unitsOf(picked.s, PIRATE, 'ship').length, 1, 'the only Sea space gets the Ship without a question');
  assert.deepEqual(checkInvariants(picked), []);
});

test('Pirate Raids: the drawer is raided first and then the others clockwise', () => {
  const g = flat();
  for (const p of [0, 1, 2]) {
    harbour(g, capitalOf(g, p));
    stock(g, p, { food: 1, gold: 1 });
  }
  const { asked } = effect(g, 'pirate_raids', 1);
  assert.deepEqual(asked.filter((q) => q.kind === 'pick_resource').map((q) => q.player), [1, 2, 0]);
});

// ------------------------------------------------------------ Culture and score
const cultures = (g) => g.s.players.map((p) => p.culture);
const ideas = (g) => g.s.players.map((p) => p.res.ideas);
const bonuses = (g) => g.s.players.map((p) => p.vpBonus);
const scores = (g) => g.s.players.map((_, p) => scoreOf(g.s, p).total);
const moods = (g) => g.s.players.map((p) => [p.mood, p.culture]);

/** End-Game VP that bring every score to exactly these totals. */
function scored(g, ...totals) {
  totals.forEach((total, p) => {
    me(g, p).vpBonus += total - scoreOf(g.s, p).total;
  });
  assert.deepEqual(scores(g), totals);
}

test('Social Unrest: a player with an Angry city loses 1 Culture token and 1 Mood token; the others keep theirs', () => {
  const g = flat();
  for (const p of [0, 1, 2]) give(g, p, { mood: 2, culture: 3 });
  capitalOf(g, 0).mood = 'angry';
  town(g, 2, ring(g, capitalOf(g, 2).hex, 2)[0], 'angry');
  const { asked } = effect(g, 'social_unrest', 1);
  assert.deepEqual(moods(g), [[1, 2], [2, 3], [1, 2]]);
  assert.equal(asked.length, 0, 'nobody is asked');
});

test('Social Unrest: only tokens the player holds are lost, and never more than one of each', () => {
  const g = flat();
  give(g, 0, { mood: 0, culture: 0 });
  give(g, 1, { mood: 5, culture: 0 });
  give(g, 2, { mood: 0, culture: 5 });
  for (const p of [0, 1, 2]) capitalOf(g, p).mood = 'angry';
  effect(g, 'social_unrest', 0);
  assert.deepEqual(moods(g), [[0, 0], [4, 0], [0, 4]]);
  assert.deepEqual(checkInvariants(g), []);
});

test('Golden Age: a player whose cities are all Happy gains 2 Culture, and a single calm or Angry city spoils it', () => {
  const g = flat(3);
  const [c0, c1, c2] = [0, 1, 2].map((p) => capitalOf(g, p));
  town(g, 0, ring(g, c0.hex, 2)[0], 'happy');
  town(g, 1, ring(g, c1.hex, 2)[0], 'neutral');
  town(g, 2, ring(g, c2.hex, 2)[0], 'angry');
  effect(g, 'golden_age', 2);
  assert.deepEqual(cultures(g), [2, 0, 0, 2]);
});

test('Golden Age: a player without a city is not rewarded', () => {
  const g = flat();
  capitalOf(g, 0).owner = BARBARIAN;
  g.s.units = g.s.units.filter((u) => u.owner !== 0);
  effect(g, 'golden_age', 0);
  assert.deepEqual(cultures(g), [0, 2, 2]);
});

test('Monuments of Antiquity: the player with the most different Building types gains 2 Culture; one type in many cities counts once', () => {
  const g = flat();
  realm(g, 0, ['temple'], ['temple'], ['temple']);
  realm(g, 1, ['market', 'academy']);
  const { asked } = effect(g, 'monuments', 2);
  assert.deepEqual(cultures(g), [0, 2, 0]);
  assert.equal(asked.length, 0);
});

test('Monuments of Antiquity: every Wonder counts as much as a type of Building', () => {
  const g = flat();
  const [capital, second] = realm(g, 0, ['temple'], []);
  wonder(g, capital, 'great_statue');
  wonder(g, second, 'great_arena');
  realm(g, 1, ['market', 'academy']);
  effect(g, 'monuments', 1);
  assert.deepEqual(cultures(g), [2, 0, 0], '1 type and 2 Wonders beat 2 types');
  assert.deepEqual(checkInvariants(g), []);
});

test('Monuments of Antiquity: players level at the top all gain the Culture; with nothing built nobody does', () => {
  const g = flat();
  realm(g, 0, ['temple']);
  realm(g, 2, ['market']);
  effect(g, 'monuments', 1);
  assert.deepEqual(cultures(g), [2, 0, 2]);

  const bare = flat();
  effect(bare, 'monuments', 0);
  assert.deepEqual(cultures(bare), [0, 0, 0]);
});

test('Monuments of Antiquity: a Building counts for the colour it was built in, whoever owns the city', () => {
  const g = flat();
  const [c0, c1] = [0, 1].map((p) => capitalOf(g, p));
  c0.buildings.temple = 0;
  c1.buildings.market = 0;
  c0.buildings.fortress = 1;
  effect(g, 'monuments', 2);
  assert.deepEqual(cultures(g), [2, 0, 0], 'a Temple and a Market of the first colour make 2 types against 1');
});

test('Philosophical Debate: the player with the most Ideas gains 1 Culture and the player with the fewest loses 1 Idea', () => {
  const g = flat();
  [3, 2, 1].forEach((n, p) => stock(g, p, { ideas: n }));
  const { asked } = effect(g, 'philosophical_debate', 1);
  assert.deepEqual(ideas(g), [3, 2, 0]);
  assert.deepEqual(cultures(g), [1, 0, 0]);
  assert.equal(asked.length, 0);
});

test('Philosophical Debate: players tied at the top all gain the Culture and players tied at the bottom all lose an Idea', () => {
  const g = flat(3);
  [3, 3, 1, 1].forEach((n, p) => stock(g, p, { ideas: n }));
  effect(g, 'philosophical_debate', 0);
  assert.deepEqual(ideas(g), [3, 3, 0, 0]);
  assert.deepEqual(cultures(g), [1, 1, 0, 0]);
});

test('Philosophical Debate: a loser without Ideas has none to lose, and a table level on Ideas holds no debate', () => {
  const g = flat();
  [2, 1, 0].forEach((n, p) => stock(g, p, { ideas: n }));
  effect(g, 'philosophical_debate', 0);
  assert.deepEqual(ideas(g), [2, 1, 0]);
  assert.deepEqual(cultures(g), [1, 0, 0]);

  for (const n of [0, 2]) {
    const level = flat();
    for (const p of [0, 1, 2]) stock(level, p, { ideas: n });
    effect(level, 'philosophical_debate', 1);
    assert.deepEqual(ideas(level), [n, n, n]);
    assert.deepEqual(cultures(level), [0, 0, 0]);
    assert.ok(logged(level, /Nobody wins the debate/));
  }
});

test('Intellectual Renaissance: the player who gained the most Ideas this round gets 1 End-Game VP, which counts in the score', () => {
  const g = flat();
  const before = scores(g);
  gainRes(g, 0, { ideas: 2 });
  gainRes(g, 1, { ideas: 1 });
  effect(g, 'intellectual_renaissance', 2);
  assert.deepEqual(bonuses(g), [1, 0, 0]);
  assert.deepEqual(scores(g), [before[0] + 1, before[1], before[2]]);
});

test('Intellectual Renaissance: Ideas that were gained and spent still count, and Ideas that did not fit under the limit do not', () => {
  const g = flat();
  gainRes(g, 0, { ideas: 3 });
  me(g, 0).res.ideas = 0;
  give(g, 1, { res: { ideas: 7 } });
  gainRes(g, 1, { ideas: 5 });
  gainRes(g, 2, { ideas: 2 });
  effect(g, 'intellectual_renaissance', 1);
  assert.deepEqual(bonuses(g), [1, 0, 0]);
});

test('Intellectual Renaissance: players level at the top share the VP; when nobody gained an Idea nobody gets it', () => {
  const g = flat();
  gainRes(g, 0, { ideas: 2 });
  gainRes(g, 2, { ideas: 2 });
  effect(g, 'intellectual_renaissance', 1);
  assert.deepEqual(bonuses(g), [1, 0, 1]);

  const quiet = flat();
  effect(quiet, 'intellectual_renaissance', 0);
  assert.deepEqual(bonuses(quiet), [0, 0, 0]);
});

test('Intellectual Renaissance: the tally starts again every round, and Ideas from other Events are on it', () => {
  const g = flat();
  gainRes(g, 0, { ideas: 2 });
  endRound(g);
  effect(g, 'intellectual_renaissance', 0);
  assert.deepEqual(bonuses(g), [0, 0, 0], 'last round\'s Ideas are forgotten');

  const chained = flat();
  realm(chained, 1, ['academy']);
  draw(chained, 'scientific_discovery', 0);
  draw(chained, 'intellectual_renaissance', 0);
  assert.deepEqual(bonuses(chained), [0, 1, 0]);
});

test('Vassal State Demand: the leader on score gives the player who trails 1 resource they choose, by default the one they can best spare', () => {
  const g = flat();
  scored(g, 6, 3, 2);
  stock(g, 0, { food: 2, wood: 5, ore: 1 });
  stock(g, 2, { food: 1 });
  const { asked } = effect(g, 'vassal_demand', 1);
  assert.deepEqual(asked.map((q) => [q.player, q.kind, q.role]), [[0, 'pick_resource', 'give']]);
  assert.deepEqual(asked[0].options.map((o) => o.id), ['food', 'wood', 'ore']);
  assert.deepEqual(g.s.players.map((p) => p.res.wood), [4, 0, 1]);

  const chosen = flat();
  scored(chosen, 6, 3, 2);
  stock(chosen, 0, { food: 2, wood: 5, ore: 1 });
  stock(chosen, 2, { food: 1 });
  effect(chosen, 'vassal_demand', 1, { pick_resource: 'ore' });
  assert.deepEqual(chosen.s.players.map((p) => [p.res.food, p.res.wood, p.res.ore]), [[2, 5, 0], [2, 0, 0], [1, 0, 1]]);
});

test('Vassal State Demand: the leader may only give what the trailing player has room for; with nothing to give nothing happens', () => {
  const g = flat();
  scored(g, 6, 3, 2);
  stock(g, 0, { wood: 1, gold: 2 });
  stock(g, 2, { gold: 7 });
  const { asked } = effect(g, 'vassal_demand', 0);
  assert.equal(asked.length, 0, 'wood is the only resource that fits, so there is no question');
  assert.deepEqual(g.s.players.map((p) => [p.res.wood, p.res.gold]), [[0, 2], [0, 0], [1, 7]]);

  const full = flat();
  scored(full, 6, 3, 2);
  stock(full, 0, { gold: 2 });
  stock(full, 2, { gold: 7 });
  const none = effect(full, 'vassal_demand', 0);
  assert.equal(none.asked.length, 0);
  assert.deepEqual(full.s.players.map((p) => p.res.gold), [2, 0, 7]);
  assert.ok(logged(full, /has nothing .* can take/));
});

test('Vassal State Demand: when every score is level nobody demands tribute', () => {
  const g = flat();
  [0, 1, 2].forEach((p) => stock(g, p, { food: 2, wood: 2 }));
  const { asked } = effect(g, 'vassal_demand', 0);
  assert.equal(asked.length, 0);
  assert.deepEqual(g.s.players.map((p) => [p.res.food, p.res.wood]), [[2, 2], [2, 2], [2, 2]]);
  assert.ok(logged(g, /same score/));
});

test('Vassal State Demand: on a tie the first player from the drawer in seat order is the leader, and the first of the lowest the vassal', () => {
  for (const [drawer, lord, vassal] of [[1, 1, 2], [2, 0, 2], [3, 0, 3]]) {
    const g = flat(3);
    scored(g, 5, 5, 2, 2);
    for (const p of [0, 1, 2, 3]) stock(g, p, { wood: 3, ore: 1 });
    const { asked } = effect(g, 'vassal_demand', drawer);
    assert.deepEqual(asked.map((q) => q.player), [lord], `drawn by player ${drawer}`);
    assert.deepEqual(g.s.players.map((p) => p.res.wood), [0, 1, 2, 3].map((p) => 3 + (p === vassal ? 1 : 0) - (p === lord ? 1 : 0)));
  }
});

test('Vassal State Demand: the score is the real one: Buildings, Wonders, Advances and End-Game VP all count', () => {
  const g = flat();
  realm(g, 0, ['market', 'temple']);
  wonder(g, capitalOf(g, 1), 'great_statue');
  me(g, 2).vpBonus = 1;
  assert.deepEqual(scores(g), [4, 6, 3]);
  stock(g, 1, { ore: 3 });
  stock(g, 2, {});
  const { asked } = effect(g, 'vassal_demand', 0);
  assert.deepEqual(asked.map((q) => q.player), [], 'the Ore is the only thing the leader holds, so there is no question');
  assert.deepEqual(g.s.players.map((p) => p.res.ore), [0, 2, 1]);
});

test('Great Philosopher: from then on the first Collect of every turn brings 1 extra Idea, the other Collects none; a second card makes it 2', () => {
  const g = flat();
  const [cap, second] = realm(g, 0, [], []);
  stock(g, 0, {});
  const collect = (city) => act(g, { type: 'collect', city: city.id, picks: [{ hex: collectCandidates(g.s, 0, city)[0].hex }] });
  draw(g, 'great_philosopher', 0);
  assert.equal(me(g).philosopher, 1);
  assert.equal(me(g).res.gold, 2, 'the Gold Mine icon pays 2 Gold');
  collect(cap);
  assert.equal(me(g).res.ideas, 1);
  collect(second);
  assert.equal(me(g).res.ideas, 1, 'only the first Collect of the turn');

  draw(g, 'great_philosopher', 0);
  assert.equal(me(g).philosopher, 2);
  for (let i = 0; i < 3; i++) act(g, { type: 'end_turn' });
  assert.equal(g.s.turn.player, 0, 'it is the next turn of the same player');
  collect(cap);
  assert.equal(me(g).res.ideas, 3, '2 more Ideas');
  collect(second);
  assert.equal(me(g).res.ideas, 3);
  assert.deepEqual(checkInvariants(g), []);
});

test('Great Philosopher: the extra Idea is for the player who drew the card alone', () => {
  const g = flat();
  draw(g, 'great_philosopher', 1);
  assert.deepEqual(g.s.players.map((p) => p.philosopher), [0, 1, 0]);
});

test('Scientific Discovery: every player with an Academy gains 1 Idea, once, however many Academies they have', () => {
  const g = flat();
  realm(g, 0, ['academy'], ['academy']);
  realm(g, 2, [], ['academy']);
  realm(g, 1, ['market']);
  const { asked } = effect(g, 'scientific_discovery', 1);
  assert.deepEqual(ideas(g), [1, 0, 1]);
  assert.equal(asked.length, 0);
});

test('Scientific Discovery: Ideas stop at the limit of 7, and at 2 under the Dogma of a Theocracy', () => {
  const g = flat();
  for (const p of [0, 1, 2]) realm(g, p, ['academy']);
  give(g, 0, { res: { ideas: 7 } });
  govern(g, 1, 'theocracy');
  give(g, 1, { res: { ideas: 2 } });
  govern(g, 2, 'theocracy');
  give(g, 2, { res: { ideas: 1 } });
  effect(g, 'scientific_discovery', 0);
  assert.deepEqual(ideas(g), [7, 2, 2]);
  assert.deepEqual(g.s.players.map((p) => p.ideasRound), [0, 0, 1], 'a lost Idea is not a gained one');
  assert.deepEqual(checkInvariants(g), []);
});

test('Cultural Breakthrough: the player with the fewest Advances learns one for free, by default the first they could take, and may choose another', () => {
  for (const choice of [undefined, 'fishing']) {
    const g = flat();
    give(g, 0, { advances: ['storage'] });
    give(g, 2, { advances: ['storage', 'irrigation'] });
    stock(g, 1, {});
    const first = availableAdvances(g.s, 1)[0];
    const { asked } = effect(g, 'cultural_breakthrough', 0, choice ? { free_advance: choice } : {});
    assert.deepEqual(asked.map((q) => [q.player, q.kind]), [[1, 'free_advance']]);
    assert.deepEqual(me(g, 1).advances.slice(2), [choice || first]);
    assert.deepEqual(g.s.players.map((p) => p.advances.length), [3, 3, 4], 'the others learn nothing');
    assert.equal(me(g, 1).cubes, 2, 'it fills a slot of the Event tracker');
    assert.deepEqual(me(g, 1).res, { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0 }, 'free');
    assert.deepEqual(checkInvariants(g), []);
  }
});

test('Cultural Breakthrough: players tied for the fewest Advances all learn one, the drawer first; a table level on Advances learns nothing', () => {
  const g = flat();
  give(g, 1, { advances: ['storage'] });
  const { asked } = effect(g, 'cultural_breakthrough', 2);
  assert.deepEqual(asked.map((q) => q.player), [2, 0]);
  assert.deepEqual(g.s.players.map((p) => p.advances.length), [3, 3, 3]);

  const level = flat();
  const none = effect(level, 'cultural_breakthrough', 0);
  assert.equal(none.asked.length, 0);
  assert.deepEqual(level.s.players.map((p) => p.advances.length), [2, 2, 2]);
});

test('Cultural Breakthrough: the free Advance can fill the last slot of the Event tracker, and the Event Card that sets off is played too', () => {
  const g = flat();
  give(g, 0, { advances: ['storage'] });
  give(g, 2, { advances: ['storage'] });
  me(g, 1).cubes = 1;
  stack(g, 'solar_eclipse');
  const { events } = draw(g, 'cultural_breakthrough', 0);
  assert.deepEqual(ofType(events, 'event').map((e) => [e.player, e.card]), [[0, 'cultural_breakthrough'], [1, 'solar_eclipse']]);
  assert.equal(me(g, 1).cubes, 3, 'the tracker starts again');
  assert.ok(g.s.flags.eclipse);
  assert.deepEqual(g.s.decks.eventDiscard.slice(-2), ['solar_eclipse', 'cultural_breakthrough']);
  assert.deepEqual(checkInvariants(g), []);
});

test('Cultural Breakthrough: the Advance is free even during the Dark Age', () => {
  const g = flat();
  give(g, 0, { advances: ['storage'] });
  give(g, 2, { advances: ['storage'] });
  stock(g, 1, {});
  g.s.flags.darkAge = true;
  effect(g, 'cultural_breakthrough', 0);
  assert.equal(me(g, 1).advances.length, 3);
  assert.deepEqual(me(g, 1).res, { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0 });
});

// ------------------------------------- Drought, Locusts, Dark Age, Bountiful Harvest, Mercenary Influx
/** A city in open country: its neighbours are Forest, Mountain, Barren land and then Plains. */
function farm(g, p = 0) {
  const city = town(g, p, openSpace(g, 1));
  const [forest, mountain, barren, plain] = nbrs(g.s, city.hex);
  setTerrain(g, forest, 'forest');
  setTerrain(g, mountain, 'mountain');
  setTerrain(g, barren, 'barren');
  return { city, forest, mountain, barren, plain };
}
/** What the city at `k` can collect, space by space. */
const yields = (g, p, k) => Object.fromEntries(collectCandidates(g.s, p, cityAt(g.s, k)).map((c) => [c.hex, c.opts]));
const NOTHING = { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0 };
const foods = (g) => g.s.players.map((p) => p.res.food);

test('Drought: Forest and Mountain spaces give nothing until the end of the round, while Plains and Barren land keep their yield', () => {
  const g = flat();
  give(g, 0, { advances: ['irrigation'] });
  stock(g, 0, {});
  const f = farm(g);
  const at = f.city.hex;
  assert.deepEqual([yields(g, 0, at)[f.forest], yields(g, 0, at)[f.mountain]], [['wood'], ['ore']]);
  effect(g, 'drought', 1);
  const dry = yields(g, 0, at);
  assert.deepEqual([dry[f.forest], dry[f.mountain]], [undefined, undefined]);
  assert.deepEqual([dry[f.plain], dry[f.barren]], [['food'], ['food']]);
  assert.match(refused(g, { type: 'collect', city: f.city.id, picks: [{ hex: f.forest }] }), /cannot collect from that space/);
  act(g, { type: 'collect', city: f.city.id, picks: [{ hex: f.plain }] });
  assert.equal(me(g).res.food, 1);
  endRound(g);
  assert.deepEqual([yields(g, 0, at)[f.forest], yields(g, 0, at)[f.mountain]], [['wood'], ['ore']]);
  assert.ok(logged(g, /The drought ends/));
});

test('Locusts: Plains give no Food until the end of the round; Great Gardens still give the rest, and Barren land is not Plains', () => {
  const g = flat();
  give(g, 0, { advances: ['irrigation'] });
  const f = farm(g);
  const at = f.city.hex;
  assert.deepEqual([yields(g, 0, at)[f.plain], yields(g, 0, at)[at]], [['food'], ['food']]);
  effect(g, 'locusts', 1);
  const eaten = yields(g, 0, at);
  assert.deepEqual([eaten[f.plain], eaten[at]], [undefined, undefined]);
  assert.deepEqual([eaten[f.forest], eaten[f.mountain], eaten[f.barren]], [['wood'], ['ore'], ['food']]);
  assert.match(refused(g, { type: 'collect', city: f.city.id, picks: [{ hex: f.plain }] }), /cannot collect from that space/);

  wonder(g, cityAt(g.s, at), 'great_gardens');
  assert.deepEqual(yields(g, 0, at)[f.plain], ['wood', 'ore', 'ideas', 'gold']);
  endRound(g);
  assert.deepEqual(yields(g, 0, at)[f.plain], ['food', 'wood', 'ore', 'ideas', 'gold']);
  assert.ok(logged(g, /The locusts move on/));
});

test('Drought, Locusts and the Dark Age last through the other players\' turns and end with the round', () => {
  for (const [card, flag, over] of [['drought', 'drought', /The drought ends/], ['locusts', 'locusts', /The locusts move on/], ['dark_age', 'darkAge', /The Dark Age ends/]]) {
    const g = flat();
    draw(g, card, 0);
    for (let turn = 0; turn < 3; turn++) {
      assert.equal(g.s.turn.player, turn);
      assert.ok(g.s.flags[flag], `${card} is still on in turn ${turn}`);
      act(g, { type: 'end_turn' });
    }
    assert.ok(!g.s.flags[flag], `${card} is over when the round is`);
    assert.ok(logged(g, over));

    const late = flat();
    act(late, { type: 'end_turn' });
    act(late, { type: 'end_turn' });
    draw(late, card, 2);
    assert.ok(late.s.flags[flag]);
    act(late, { type: 'end_turn' });
    assert.ok(!late.s.flags[flag], `${card} drawn in the last turn of the round ends with it`);
  }
});

const BUY = { type: 'advance', advance: 'storage' };
/** A table in the Dark Age where player 0 holds exactly these resources. */
function darkAge(res) {
  const g = flat();
  stock(g, 0, res);
  effect(g, 'dark_age', 1);
  return g;
}

test('Dark Age: until the end of the round an Advance costs 1 more Idea, which Gold can pay; Ideas still stand in for Food', () => {
  assert.deepEqual(advanceCost(flat().s, 0, 'storage'), { cost: { food: 2 }, via: null }, 'the usual price');
  assert.deepEqual(advanceCost(darkAge({}).s, 0, 'storage'), { cost: { food: 2, ideas: 1 }, via: null });
  assert.match(refused(darkAge({ food: 2 }), BUY), /During the Dark Age an Advance costs 2 Food and 1 Idea/);
  assert.match(refused(darkAge({ ideas: 2 }), BUY), /During the Dark Age/);
  for (const res of [{ food: 2, ideas: 1 }, { food: 2, gold: 1 }, { food: 0, ideas: 3 }, { food: 1, gold: 2 }]) {
    const g = darkAge(res);
    act(g, BUY);
    assert.ok(me(g).advances.includes('storage'), JSON.stringify(res));
    assert.deepEqual(me(g).res, NOTHING, `${JSON.stringify(res)} pays for it exactly`);
  }
});

test('Dark Age: when the player chooses how to pay, the extra Idea comes on top, from Ideas first and then Gold', () => {
  assert.match(refused(darkAge({ food: 2 }), { ...BUY, pay: { food: 2 } }), /surcharge of 1 Idea/);
  for (const res of [{ food: 2, ideas: 1 }, { food: 2, gold: 1 }]) {
    const g = darkAge(res);
    act(g, { ...BUY, pay: { food: 2 } });
    assert.deepEqual(me(g).res, NOTHING, JSON.stringify(res));
  }
  const both = darkAge({ food: 2, ideas: 1, gold: 1 });
  act(both, { ...BUY, pay: { food: 2 } });
  assert.deepEqual([me(both).res.ideas, me(both).res.gold], [0, 1], 'the Idea is spent and the Gold kept');
});

test('Dark Age: an Advance that is free anyway stays free, and the price is back to normal when the round ends', () => {
  const g = flat();
  give(g, 0, { advances: ['math'] });
  stock(g, 0, {});
  effect(g, 'dark_age', 1);
  assert.deepEqual(advanceCost(g.s, 0, 'engineering'), { cost: {}, via: 'math' });
  act(g, { type: 'advance', advance: 'engineering' });
  assert.ok(me(g).advances.includes('engineering'));
  assert.deepEqual(advanceCost(g.s, 0, 'storage').cost, { food: 2, ideas: 1 });
  endRound(g);
  assert.deepEqual(advanceCost(g.s, 0, 'storage').cost, { food: 2 });
  assert.ok(logged(g, /The Dark Age ends/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Dark Age: Rapid Learning costs 1 more Idea too, and Gold can pay for it', () => {
  const LEARN = { type: 'play_card', card: 'learning', advance: 'storage' };
  const calm = flat();
  hold(calm, 0, 'learning');
  stock(calm, 0, { food: 1 });
  act(calm, LEARN);
  assert.ok(me(calm).advances.includes('storage'));
  assert.deepEqual(me(calm).res, NOTHING, '1 Food is the usual price');

  const short = darkAge({ food: 1 });
  hold(short, 0, 'learning');
  assert.match(refused(short, LEARN), /You cannot pay 1 Food and 1 Idea/);
  for (const res of [{ food: 1, ideas: 1 }, { food: 1, gold: 1 }, { ideas: 2 }, { gold: 2 }]) {
    const g = darkAge(res);
    hold(g, 0, 'learning');
    act(g, LEARN);
    assert.ok(me(g).advances.includes('storage'), JSON.stringify(res));
    assert.deepEqual(me(g).res, NOTHING, `${JSON.stringify(res)} pays for it exactly`);
  }
});

test('Bountiful Harvest: every player gains 1 Food for each Plains space where they have a city or a unit, up to 2', () => {
  const g = flat();
  for (const p of [0, 1, 2]) stock(g, p, {});
  const [c0, , c2] = [0, 1, 2].map((p) => capitalOf(g, p));
  stationed(g, 0, 'infantry', ring(g, c0.hex, 1)[0]);
  stationed(g, 0, 'infantry', ring(g, c0.hex, 2)[0]);
  settlerOf(g, 2).hex = ring(g, c2.hex, 1)[0];
  const { asked } = effect(g, 'bountiful_harvest', 1);
  assert.deepEqual(foods(g), [2, 1, 2], 'three spaces, one space, a city and a Settler apart');
  assert.equal(asked.length, 0);
  assert.deepEqual(checkInvariants(g), []);
});

test('Bountiful Harvest: Exhausted land and land that is not Plains give nothing, and a space with several pieces counts once', () => {
  const g = flat();
  for (const p of [0, 1, 2]) stock(g, p, {});
  const [c0, c1, c2] = [0, 1, 2].map((p) => capitalOf(g, p));
  g.s.map.hexes[c0.hex].exhausted = true;
  stationed(g, 0, 'infantry', ring(g, c0.hex, 1)[0]);
  setTerrain(g, c1.hex, 'forest');
  stationed(g, 2, 'infantry', c2.hex, 3);
  effect(g, 'bountiful_harvest', 0);
  assert.deepEqual(foods(g), [1, 0, 1]);
});

test('Bountiful Harvest: nobody gains more than 2 Food, however many spaces they hold and however much room they have', () => {
  const g = flat();
  for (const p of [0, 1, 2]) stock(g, p, {});
  give(g, 0, { advances: ['storage'] });
  ring(g, capitalOf(g, 0).hex, 1).slice(0, 3).forEach((k) => stationed(g, 0, 'infantry', k));
  effect(g, 'bountiful_harvest', 0);
  assert.deepEqual(foods(g), [2, 1, 1], 'four spaces still give 2 Food');
});

test('Bountiful Harvest: Food stops at the limit, 2 or 7 with Storage', () => {
  const g = flat();
  for (const p of [0, 1, 2]) stock(g, p, {});
  give(g, 0, { advances: ['storage'], res: { food: 6 } });
  stationed(g, 0, 'infantry', ring(g, capitalOf(g, 0).hex, 1)[0]);
  give(g, 1, { res: { food: 2 } });
  give(g, 2, { res: { food: 1 } });
  effect(g, 'bountiful_harvest', 0);
  assert.deepEqual(foods(g), [7, 2, 2]);
  assert.deepEqual(checkInvariants(g), []);
});

test('Bountiful Harvest: the Locusts eat the harvest, until they move on', () => {
  const g = flat();
  for (const p of [0, 1, 2]) stock(g, p, {});
  effect(g, 'locusts', 0);
  effect(g, 'bountiful_harvest', 0);
  assert.deepEqual(foods(g), [0, 0, 0]);
  assert.ok(logged(g, /The locusts have eaten the harvest/));
  endRound(g);
  effect(g, 'bountiful_harvest', 0);
  assert.deepEqual(foods(g), [1, 1, 1]);
});

/** The Infantry of player 0 two steps from their capital, and a free space beside them for a foe. */
function frontline(g, n = 1) {
  const cap = capitalOf(g, 0);
  const front = ring(g, cap.hex, 2)[0];
  const next = ring(g, front, 1).find((k) => hexDistance(k, cap.hex) >= 2);
  stationed(g, 0, 'infantry', front, n);
  return { cap, front, next };
}
const band = (g, k, owner = BARBARIAN) => stationed(g, owner, 'infantry', k);

test('Mercenary Influx: a player may hire up to 2 Infantry for 2 Gold each at the front; by default nobody is hired', () => {
  const g = flat();
  const { front, next } = frontline(g);
  band(g, next);
  stock(g, 0, { gold: 5 });
  const { asked } = effect(g, 'mercenary_influx', 1);
  assert.deepEqual(asked.map((q) => [q.player, q.kind]), [[0, 'choice']], 'only the player with Gold at the front is asked');
  assert.deepEqual(asked[0].options.map((o) => o.id), ['0', '1', '2']);
  assert.equal(asked[0].default, '0');
  assert.equal(me(g).res.gold, 5);
  assert.equal(armyAt(g.s, front, 0).length, 1);

  for (const hired of [1, 2]) {
    const h = flat();
    const at = frontline(h);
    band(h, at.next);
    stock(h, 0, { gold: 5 });
    effect(h, 'mercenary_influx', 1, { choice: String(hired) });
    const army = armyAt(h.s, at.front, 0);
    assert.equal(army.length, 1 + hired);
    assert.equal(army.filter((u) => u.mercenary).length, hired, 'the new Infantry are mercenaries');
    assert.equal(me(h).res.gold, 5 - 2 * hired);
    assert.deepEqual(checkInvariants(h), []);
  }
});

test('Mercenary Influx: the mercenaries stay until the end of the round and then leave; the Infantry that were there before stay', () => {
  const g = flat();
  const { front, next } = frontline(g);
  band(g, next);
  stock(g, 0, { gold: 4 });
  draw(g, 'mercenary_influx', 0, { choice: '2' });
  assert.deepEqual(armyAt(g.s, front, 0).map((u) => !!u.mercenary), [false, true, true]);
  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  assert.equal(armyAt(g.s, front, 0).length, 3, 'they stay while the round goes on');
  act(g, { type: 'end_turn' });
  assert.deepEqual(armyAt(g.s, front, 0).map((u) => !!u.mercenary), [false]);
  assert.ok(logged(g, /2 mercenaries leave the service/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Mercenary Influx: nobody is asked without 2 Gold, without a foe beside their Army, or without room for another Infantry', () => {
  const asked = (setup, gold = 6) => {
    const g = flat();
    setup(g);
    stock(g, 0, { gold });
    return effect(g, 'mercenary_influx', 0).asked.length;
  };
  assert.equal(asked((g) => band(g, frontline(g).next)), 1, 'the control: Gold and a foe at the front');
  assert.equal(asked((g) => band(g, frontline(g).next), 1), 0, '1 Gold hires nobody');
  assert.equal(asked((g) => band(g, frontline(g, 4).next)), 0, 'a full space has no room');
  assert.equal(asked((g) => frontline(g)), 0, 'no foe near');
  assert.equal(asked((g) => band(g, frontline(g).next, 1)), 1, 'a rival\'s Army is a foe too');
  assert.equal(asked((g) => town(g, 1, frontline(g).next)), 1, 'a rival\'s city is one too');
  assert.equal(asked((g) => {
    const { next } = frontline(g);
    setTerrain(g, next, 'sea');
    stationed(g, 1, 'ship', next);
  }), 0, 'a Ship is not an Army');
  assert.equal(asked((g) => town(g, 0, ring(g, capitalOf(g, 0).hex, 1)[0])), 0, 'their own cities are no foes');
  assert.equal(asked((g) => {
    const sea = sail(g, 0);
    stationed(g, 0, 'infantry', sea, 2);
    band(g, nbrs(g.s, sea)[0]);
  }), 0, 'Infantry on board a Ship cannot be reinforced at sea');
});

test('Mercenary Influx: the drawer is asked first and then the other players clockwise', () => {
  const g = flat();
  for (const p of [0, 1, 2]) {
    band(g, ring(g, capitalOf(g, p).hex, 1)[0]);
    stock(g, p, { gold: 2 });
  }
  const { asked } = effect(g, 'mercenary_influx', 1);
  assert.deepEqual(asked.map((q) => q.player), [1, 2, 0]);
});

test('Mercenary Influx: the number to hire is limited by Gold, by room at the front and by the Infantry left in the supply', () => {
  const options = (n, gold, more = () => {}) => {
    const g = flat();
    band(g, frontline(g, n).next);
    stock(g, 0, { gold });
    more(g);
    return effect(g, 'mercenary_influx', 0).asked.map((q) => q.options.map((o) => o.id));
  };
  assert.deepEqual(options(1, 3), [['0', '1']], '3 Gold buys 1');
  assert.deepEqual(options(1, 7), [['0', '1', '2']], 'never more than 2');
  assert.deepEqual(options(3, 7), [['0', '1']], 'a space with 3 Infantry has room for 1');
  assert.deepEqual(options(1, 7, (g) => {
    const cap = capitalOf(g, 0);
    stationed(g, 0, 'infantry', cap.hex, 4);
    for (const [i, k] of ring(g, cap.hex, 1).slice(0, 3).entries()) stationed(g, 0, 'infantry', k, i < 2 ? 4 : 2);
    assert.equal(unitsLeft(g.s, 0, 'infantry'), 1);
  }), [['0', '1']], 'with 1 Infantry left in the supply');
});

test('Mercenary Influx: the mercenaries arrive at a space with room for all of them, chosen by the player when there are several', () => {
  const setup = () => {
    const g = flat();
    const { cap, front, next } = frontline(g, 3);
    band(g, next);
    band(g, ring(g, cap.hex, 1)[0]);
    stock(g, 0, { gold: 4 });
    return { g, cap, front };
  };
  const two = setup();
  const both = effect(two.g, 'mercenary_influx', 0, { choice: '2' });
  assert.deepEqual(both.asked.map((q) => q.kind), ['choice'], 'only the capital has room for 2: no further question');
  assert.deepEqual([armyAt(two.g.s, two.cap.hex, 0).length, armyAt(two.g.s, two.front, 0).length], [2, 3]);

  const one = setup();
  const single = effect(one.g, 'mercenary_influx', 0, { choice: '1', pick_hex: one.front });
  assert.deepEqual(single.asked.map((q) => q.kind), ['choice', 'pick_hex']);
  assert.deepEqual(single.asked[1].options.map((o) => o.id), [one.cap.hex, one.front].sort());
  assert.deepEqual([armyAt(one.g.s, one.cap.hex, 0).length, armyAt(one.g.s, one.front, 0).length], [0, 4]);
  assert.deepEqual(checkInvariants(one.g), []);
});

// ----------------------------------------------------------- Border Dispute and Local Hero
/** Land steps between the nearest cities of two players. */
const gapBetween = (g, a, b) =>
  Math.min(...citiesOf(g.s, a).flatMap((c) => citiesOf(g.s, b).map((d) => walk(g, c.hex).get(d.hex) ?? Infinity)));

/** A town of player 0 `gap` land steps from the capital of player 1, with this many Infantry each; player 2 is out of reach of both. */
function border(g, gap, army0, army1) {
  const b = capitalOf(g, 1);
  const fromP2 = walk(g, capitalOf(g, 2).hex);
  const a = town(g, 0, ring(g, b.hex, gap).find((k) => fromP2.get(k) > 3));
  stationed(g, 0, 'infantry', a.hex, army0);
  stationed(g, 1, 'infantry', b.hex, army1);
  assert.equal(gapBetween(g, 0, 1), gap, 'the nearest cities of players 0 and 1');
  assert.ok(gapBetween(g, 2, 0) > 3 && gapBetween(g, 2, 1) > 3, 'player 2 is not close to anybody');
  return [a, b];
}

/** A Ship (or n) of p on a space of open sea of its own, far from every city. */
function sail(g, p, n = 1) {
  const k = allHexKeys(g.s).find((x) => free(g, x) && g.s.cities.every((c) => hexDistance(c.hex, x) >= 3));
  setTerrain(g, k, 'sea');
  stationed(g, p, 'ship', k, n);
  return k;
}

test('Border Dispute: where two players have cities close together, the one with fewer Army units cedes 1 resource to the other', () => {
  const g = flat();
  border(g, 3, 2, 1);
  stock(g, 0, {});
  stock(g, 1, { wood: 3, ore: 1 });
  const { asked } = effect(g, 'border_dispute', 0);
  assert.deepEqual(asked.map((q) => [q.player, q.kind]), [[1, 'pick_resource']], 'only the weaker side is asked');
  assert.deepEqual(asked[0].options.map((o) => o.id), ['wood', 'ore']);
  assert.equal(asked[0].default, 'wood', 'the resource it can best spare');
  assert.deepEqual([me(g, 0).res.wood, me(g, 1).res.wood, me(g, 1).res.ore], [1, 2, 1]);
  assert.ok(logged(g, /cedes 1 wood to/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Border Dispute: the weaker side chooses what to cede, whoever drew the card', () => {
  const g = flat();
  border(g, 2, 1, 3);
  stock(g, 0, { wood: 3, ore: 1, gold: 1 });
  stock(g, 1, {});
  effect(g, 'border_dispute', 2, { pick_resource: only(0, 'gold') });
  assert.deepEqual([me(g, 0).res.gold, me(g, 1).res.gold, me(g, 0).res.wood], [0, 1, 3]);
});

test('Border Dispute: nothing happens when the armies are level, when the cities are 4 steps apart, or when the sea lies between them', () => {
  const quiet = (g) => {
    for (const p of [0, 1, 2]) stock(g, p, { wood: 3, ore: 1 });
    const before = structuredClone(g.s.players.map((p) => p.res));
    assert.equal(effect(g, 'border_dispute', 0).asked.length, 0);
    assert.deepEqual(g.s.players.map((p) => p.res), before);
  };
  const level = flat();
  border(level, 3, 2, 2);
  quiet(level);

  const far = flat();
  border(far, 4, 3, 0);
  quiet(far);

  const apart = flat();
  const rock = island(apart);
  const mine = town(apart, 0, rock);
  const theirs = town(apart, 1, ring(apart, rock, 2)[0]);
  stationed(apart, 0, 'infantry', mine.hex, 3);
  assert.equal(hexDistance(mine.hex, theirs.hex), 2);
  assert.ok(!walk(apart, mine.hex).has(theirs.hex), 'no way over land');
  quiet(apart);
});

test('Border Dispute: only a resource the stronger side has room for can be ceded', () => {
  const dispute = (strong, weak, setup = () => {}) => {
    const g = flat();
    border(g, 3, 2, 1);
    stock(g, 0, strong);
    stock(g, 1, weak);
    setup(g);
    const { asked } = effect(g, 'border_dispute', 0);
    return { asked, held: [0, 1].map((p) => ({ ...me(g, p).res })) };
  };
  const full = dispute({ wood: 7 }, { wood: 2 });
  assert.equal(full.asked.length, 0);
  assert.deepEqual([full.held[0].wood, full.held[1].wood], [7, 2], 'no room for Wood');

  const other = dispute({ wood: 7 }, { wood: 2, ore: 1 });
  assert.equal(other.asked.length, 0, 'Ore is the only possible choice, so nobody is asked');
  assert.deepEqual([other.held[0].ore, other.held[1].ore, other.held[1].wood], [1, 0, 2]);

  const food = dispute({ food: 2 }, { food: 1 });
  assert.deepEqual([food.held[0].food, food.held[1].food], [2, 1], 'the limit for Food is 2 without Storage');
  const stored = dispute({ food: 2 }, { food: 1 }, (g) => give(g, 0, { advances: ['storage'] }));
  assert.deepEqual([stored.held[0].food, stored.held[1].food], [3, 0], 'and 7 with it');
});

test('Border Dispute: each close pair settles in turn from the drawer clockwise, and what one dispute takes is gone for the next', () => {
  const triangle = () => {
    const g = flat();
    const hub = openSpace(g, 1);
    const towns = [0, 1, 2].map((p) => town(g, p, nbrs(g.s, hub)[2 * p]));
    [3, 2, 1].forEach((n, p) => stationed(g, p, 'infantry', towns[p].hex, n));
    stock(g, 0, {});
    stock(g, 1, { wood: 1, ore: 1 });
    stock(g, 2, { wood: 1 });
    return g;
  };
  const goods = (g) => g.s.players.map((p) => [p.res.wood, p.res.ore]);

  const first = triangle();
  const a = effect(first, 'border_dispute', 1);
  assert.deepEqual(a.asked.map((q) => [q.player, q.kind]), [[1, 'pick_resource']], 'player 2 has only Wood to cede: no choice');
  assert.deepEqual(goods(first), [[1, 0], [1, 1], [0, 0]], 'player 2 pays player 1, who passes Wood on to player 0');

  const second = triangle();
  const b = effect(second, 'border_dispute', 0);
  assert.deepEqual(b.asked.map((q) => [q.player, q.kind]), [[1, 'pick_resource']]);
  assert.deepEqual(goods(second), [[2, 0], [0, 1], [0, 0]], 'player 0 collects from both neighbours, and player 2 has nothing left for player 1');
});

test('Border Dispute: Infantry and Cavalry count as Army units, Ships and Settlers do not', () => {
  const g = flat();
  const [a, b] = border(g, 3, 1, 2);
  stationed(g, 0, 'cavalry', a.hex);
  stationed(g, 0, 'settler', a.hex);
  sail(g, 0, 2);
  stock(g, 0, { wood: 1 });
  stock(g, 1, {});
  assert.equal(effect(g, 'border_dispute', 0).asked.length, 0);
  assert.deepEqual([me(g, 0).res.wood, me(g, 1).res.wood], [1, 0], 'level at 2 Army units each');
  stationed(g, 1, 'infantry', b.hex);
  effect(g, 'border_dispute', 0);
  assert.deepEqual([me(g, 0).res.wood, me(g, 1).res.wood], [0, 1]);
});

test('Local Hero: the player with the fewest Army units gets a free Infantry in their capital', () => {
  const g = flat();
  stationed(g, 0, 'infantry', capitalOf(g, 0).hex, 2);
  stationed(g, 1, 'cavalry', ring(g, capitalOf(g, 1).hex, 1)[0]);
  const { asked, events } = effect(g, 'local_hero', 0);
  const home = capitalOf(g, 2);
  assert.deepEqual(unitsOf(g.s, 2, 'infantry').map((u) => u.hex), [home.hex]);
  assert.deepEqual(ofType(events, 'recruit').map((e) => [e.player, e.city, e.units]), [[2, home.id, { infantry: 1 }]]);
  assert.deepEqual([armyOf(g.s, 0).length, armyOf(g.s, 1).length], [2, 1], 'nobody else gets one');
  assert.equal(asked.length, 0);
  assert.deepEqual(checkInvariants(g), []);
});

test('Local Hero: players tied for the fewest all get an Infantry, and nobody does when every player is level', () => {
  const g = flat();
  stationed(g, 2, 'infantry', capitalOf(g, 2).hex, 2);
  const { events } = effect(g, 'local_hero', 1);
  assert.deepEqual(ofType(events, 'recruit').map((e) => e.player), [1, 0], 'clockwise from the drawer');
  assert.deepEqual([0, 1, 2].map((p) => armyOf(g.s, p).length), [1, 1, 2]);

  for (const each of [0, 1]) {
    const level = flat();
    for (const p of [0, 1, 2]) stationed(level, p, 'infantry', capitalOf(level, p).hex, each);
    assert.equal(effect(level, 'local_hero', 0).events.length, 0, `${each} Army units each`);
  }
});

test('Local Hero: with the capital full the Infantry joins the biggest city that has room, and with no room anywhere nobody comes', () => {
  const table = (...towns) => {
    const g = flat();
    const cities = realm(g, 0, [], ...towns);
    stationed(g, 0, 'infantry', cities[0].hex, 4);
    for (const p of [1, 2]) {
      const home = capitalOf(g, p).hex;
      stationed(g, p, 'infantry', ring(g, home, 1)[0], 4);
      stationed(g, p, 'infantry', ring(g, home, 2)[0]);
    }
    return { g, cities };
  };
  const { g, cities: [, small, large] } = table([], ['market', 'temple']);
  effect(g, 'local_hero', 0);
  assert.deepEqual([armyAt(g.s, small.hex, 0).length, armyAt(g.s, large.hex, 0).length], [0, 1]);
  assert.deepEqual(checkInvariants(g), []);

  const alone = table().g;
  assert.equal(effect(alone, 'local_hero', 0).events.length, 0);
  assert.equal(armyOf(alone.s, 0).length, 4);
});

test('Local Hero: a player who lost their capital gets the Infantry in their biggest city instead', () => {
  const g = flat();
  const [cap, small, large] = realm(g, 0, [], [], ['market']);
  for (const p of [1, 2]) stationed(g, p, 'infantry', capitalOf(g, p).hex, 2);
  cap.owner = BARBARIAN;
  effect(g, 'local_hero', 0);
  assert.deepEqual([armyAt(g.s, small.hex, 0).length, armyAt(g.s, large.hex, 0).length], [0, 1]);
});

test('Local Hero: the Infantry goes to the capital even when another city is bigger, and only Army units count towards the fewest', () => {
  const g = flat();
  const [cap, , large] = realm(g, 0, [], [], ['market', 'temple']);
  stationed(g, 0, 'infantry', large.hex);
  stationed(g, 0, 'settler', cap.hex);
  sail(g, 0, 2);
  for (const p of [1, 2]) stationed(g, p, 'infantry', capitalOf(g, p).hex, 2);
  effect(g, 'local_hero', 0);
  assert.deepEqual([armyAt(g.s, cap.hex, 0).length, armyAt(g.s, large.hex, 0).length], [1, 1]);
  assert.deepEqual([1, 2].map((p) => armyOf(g.s, p).length), [2, 2], 'the Ships and the Settler make no difference');
  assert.deepEqual(checkInvariants(g), []);
});

test('Local Hero: with every Infantry piece already in play nobody can be sent one', () => {
  const g = flat(1);
  const spots = allHexKeys(g.s).filter((k) => free(g, k));
  const muster = (p, type, n) => {
    for (let left = n; left > 0; left -= 4) stationed(g, p, type, spots.shift(), Math.min(4, left));
  };
  muster(0, 'infantry', 16);
  muster(1, 'infantry', 16);
  muster(1, 'cavalry', 1);
  assert.equal(unitsLeft(g.s, 0, 'infantry'), 0);
  assert.equal(effect(g, 'local_hero', 0).events.length, 0);
  assert.equal(unitsOf(g.s, 0, 'infantry').length, 16);
  assert.deepEqual(checkInvariants(g), []);
});

// ----------------------------------------------------------------- Tax Grievances
test('Tax Grievances: whoever collected Gold pays 2 Gold or one of their cities turns Angry; by default they pay only with 3 Gold or more', () => {
  const g = flat();
  g.s.turn.goldCollected = true;
  for (const p of [1, 2]) me(g, p).goldLast = true;
  [3, 2, 1].forEach((gold, p) => stock(g, p, { gold }));
  const { asked } = effect(g, 'tax_grievances', 0);
  assert.deepEqual(asked.map((q) => [q.player, q.kind, q.default]), [[0, 'tax_grievances', 'yes'], [1, 'tax_grievances', 'no']], 'player 2 cannot pay, so is not asked');
  assert.deepEqual(g.s.players.map((p) => p.res.gold), [1, 2, 1]);
  assert.deepEqual([0, 1, 2].map((p) => capitalOf(g, p).mood), ['happy', 'angry', 'angry']);
  assert.ok(logged(g, /pays 2 Gold in back taxes/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Tax Grievances: the player decides, and with several cities chooses which turns Angry, the smallest by default', () => {
  const table = (gold) => {
    const g = flat();
    g.s.turn.goldCollected = true;
    const cities = realm(g, 0, ['market', 'temple'], ['market'], []);
    stock(g, 0, { gold });
    return { g, cities };
  };
  const paid = table(2);
  effect(paid.g, 'tax_grievances', 0, { tax_grievances: 'yes' });
  assert.equal(me(paid.g, 0).res.gold, 0);
  assert.deepEqual(paid.cities.map((c) => c.mood), ['neutral', 'neutral', 'neutral']);

  const refuse = table(4);
  const [cap, mid, hamlet] = refuse.cities;
  const { asked } = effect(refuse.g, 'tax_grievances', 0, { tax_grievances: 'no' });
  assert.deepEqual(asked.map((q) => q.kind), ['tax_grievances', 'pick_city']);
  assert.deepEqual(asked[1].options.map((o) => o.id), [hamlet.id, mid.id, cap.id]);
  assert.equal(asked[1].default, hamlet.id);
  assert.deepEqual(refuse.cities.map((c) => c.mood), ['neutral', 'neutral', 'angry']);
  assert.equal(me(refuse.g, 0).res.gold, 4, 'nothing is paid');

  const pick = table(4);
  effect(pick.g, 'tax_grievances', 0, { tax_grievances: 'no', pick_city: pick.cities[1].id });
  assert.deepEqual(pick.cities.map((c) => c.mood), ['neutral', 'angry', 'neutral']);
});

test('Tax Grievances: nobody is asked who collected no Gold, or whose cities are all Angry already', () => {
  const g = flat();
  me(g, 1).goldLast = true;
  capitalOf(g, 1).mood = 'angry';
  me(g, 2).goldLast = false;
  for (const p of [0, 1, 2]) stock(g, p, { gold: 5 });
  const { asked, events } = effect(g, 'tax_grievances', 0);
  assert.equal(asked.length, 0);
  assert.equal(ofType(events, 'mood').length, 0);
  assert.deepEqual(g.s.players.map((p) => p.res.gold), [5, 5, 5]);
});

test('Tax Grievances: a city that is Angry already is never the one that turns Angry', () => {
  const g = flat();
  g.s.turn.goldCollected = true;
  const [cap, calm] = realm(g, 0, [], ['market']);
  cap.mood = 'angry';
  stock(g, 0, { gold: 1 });
  const { asked } = effect(g, 'tax_grievances', 0);
  assert.equal(asked.length, 0, '1 Gold cannot pay, and only one city is calm');
  assert.equal(calm.mood, 'angry');
});

test('Tax Grievances: the Gold of the drawer\'s own turn counts, and everybody else is judged by the turn they played last', () => {
  const g = flat();
  const caps = [0, 1, 2].map((p) => capitalOf(g, p));
  const seas = caps.map((c) => harbour(g, c));
  [1, 2, 2].forEach((gold, p) => stock(g, p, { gold }));
  act(g, { type: 'collect', city: caps[0].id, picks: [{ hex: seas[0], res: 'gold' }] });
  act(g, { type: 'end_turn' });
  act(g, { type: 'collect', city: caps[1].id, picks: [{ hex: seas[1], res: 'gold' }] });
  assert.deepEqual(g.s.players.map((p) => p.goldLast), [true, false, false]);
  const { asked } = effect(g, 'tax_grievances', 1);
  assert.deepEqual(asked.map((q) => [q.player, q.default]), [[1, 'yes'], [0, 'no']], 'player 2 collected nothing');
  assert.deepEqual(g.s.players.map((p) => p.res.gold), [2, 1, 2]);
  assert.deepEqual(caps.map((c) => c.mood), ['angry', 'happy', 'happy']);
});

test('Tax Grievances: Gold from the Taxation action counts as collected, and a turn without any does not', () => {
  const g = flat();
  for (const p of [0, 1]) give(g, p, { advances: ['taxation', 'currency'], mood: 3 });
  stock(g, 0, { gold: 2 });
  stock(g, 1, { gold: 5 });
  act(g, { type: 'taxation', gain: { gold: 1 } });
  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  assert.deepEqual(g.s.players.map((p) => p.goldLast), [true, false, false]);
  const { asked } = effect(g, 'tax_grievances', 2);
  assert.deepEqual(asked.map((q) => q.player), [0], 'player 1 had Gold to pay with but collected none');
});

test('Tax Grievances: Myths can pay 1 Mood token to keep the city calm', () => {
  const g = flat();
  g.s.turn.goldCollected = true;
  give(g, 0, { advances: ['myths'], mood: 2 });
  stock(g, 0, { gold: 1 });
  const { asked } = effect(g, 'tax_grievances', 0, { myths: 'yes' });
  assert.deepEqual(asked.map((q) => q.kind), ['myths'], 'with 1 Gold there is nothing to pay');
  assert.equal(capitalOf(g, 0).mood, 'happy');
  assert.equal(me(g, 0).mood, 1);
});

// -------------------------------------------------------------------- Iconoclasm
test('Iconoclasm: a player with a Temple pays 1 Culture or a Temple city turns Angry; by default they pay only with 2 Culture or more', () => {
  const g = flat();
  const caps = [0, 1, 2].map((p) => realm(g, p, ['temple'])[0]);
  [2, 1, 0].forEach((culture, p) => give(g, p, { culture }));
  const { asked } = effect(g, 'iconoclasm', 0);
  assert.deepEqual(asked.map((q) => [q.player, q.kind, q.default]), [[0, 'iconoclasm', 'yes'], [1, 'iconoclasm', 'no']], 'no Culture, no question');
  assert.deepEqual(cultures(g), [1, 1, 0]);
  assert.deepEqual(caps.map((c) => c.mood), ['neutral', 'angry', 'angry']);
  assert.ok(logged(g, /pays 1 Culture to save the Temples/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Iconoclasm: the player chooses whether to pay, and which Temple city turns Angry, the smallest by default', () => {
  const table = () => {
    const g = flat();
    const cities = realm(g, 0, ['temple'], ['temple', 'market'], ['market']);
    give(g, 0, { culture: 3 });
    return { g, cities };
  };
  const { g, cities: [cap, big, plain] } = table();
  const { asked } = effect(g, 'iconoclasm', 0, { iconoclasm: 'no' });
  assert.deepEqual(asked.map((q) => q.kind), ['iconoclasm', 'pick_city']);
  assert.deepEqual(asked[1].options.map((o) => o.id), [cap.id, big.id], 'only the cities with a Temple');
  assert.equal(asked[1].default, cap.id);
  assert.deepEqual([cap, big, plain].map((c) => c.mood), ['angry', 'neutral', 'neutral']);
  assert.equal(me(g, 0).culture, 3);

  const other = table();
  effect(other.g, 'iconoclasm', 0, { iconoclasm: 'no', pick_city: other.cities[1].id });
  assert.deepEqual(other.cities.map((c) => c.mood), ['neutral', 'angry', 'neutral']);

  const paid = table();
  effect(paid.g, 'iconoclasm', 0, { iconoclasm: 'yes' });
  assert.equal(me(paid.g, 0).culture, 2);
  assert.ok(paid.cities.every((c) => c.mood === 'neutral'));
});

test('Iconoclasm: a Temple city that is Angry already is not a target, and a player without any other is left alone', () => {
  const g = flat();
  const [cap, riot] = realm(g, 0, ['temple'], ['temple']);
  riot.mood = 'angry';
  give(g, 0, { culture: 0 });
  const { asked } = effect(g, 'iconoclasm', 0);
  assert.deepEqual(asked.map((q) => q.kind), [], 'one calm Temple city and no Culture: nothing to decide');
  assert.deepEqual([cap.mood, riot.mood], ['angry', 'angry']);

  const spared = flat();
  const [only1] = realm(spared, 0, ['temple']);
  only1.mood = 'angry';
  give(spared, 0, { culture: 3 });
  assert.equal(effect(spared, 'iconoclasm', 0).asked.length, 0);
  assert.equal(me(spared, 0).culture, 3, 'no calm Temple city, so no Culture is asked for');
  const noTemple = flat();
  realm(noTemple, 0, ['market']);
  give(noTemple, 0, { culture: 3 });
  assert.equal(effect(noTemple, 'iconoclasm', 0).asked.length, 0);
});

// ----------------------------------------------------------------- Religious Revival
test('Religious Revival: players with a Temple of their own colour may switch Government, to any category whose first Advance they own', () => {
  const g = flat();
  govern(g, 0, 'autocracy');
  give(g, 0, { advances: ['state_religion'] });
  realm(g, 0, ['temple']);
  govern(g, 1, 'theocracy');
  give(g, 1, { advances: ['draft', 'philosophy'] });
  govern(g, 2, 'democracy');
  give(g, 2, { advances: ['draft', 'state_religion'] });
  capitalOf(g, 2).buildings.temple = 1;
  const { asked, events } = effect(g, 'religious_revival', 0);
  assert.deepEqual(asked.map((q) => [q.player, q.kind, q.default]), [[0, 'government', 'none'], [1, 'government', 'none']],
    'player 1 built the Temple in the city of player 2, so player 2 has none of their own');
  assert.deepEqual(asked.map((q) => q.options.map((o) => o.id)), [['none', 'theocracy'], ['none', 'democracy', 'autocracy']]);
  assert.equal(ofType(events, 'government').length, 0);
  assert.deepEqual(g.s.players.map((p) => p.government), ['autocracy', 'theocracy', 'democracy']);
});

test('Religious Revival: the switch is free and exchanges the Government Advance for the first one of the new category', () => {
  const g = flat();
  govern(g, 0, 'autocracy');
  give(g, 0, { advances: ['state_religion'], mood: 3, culture: 2 });
  stock(g, 0, { ideas: 4, gold: 3 });
  realm(g, 0, ['temple']);
  const { asked, events } = effect(g, 'religious_revival', 0, { government: 'theocracy' });
  assert.deepEqual(asked.map((q) => q.kind), ['government'], 'one Government Advance, so nothing more to choose');
  const pl = me(g, 0);
  assert.equal(pl.government, 'theocracy');
  assert.deepEqual(['draft', 'state_religion', 'dogma'].filter((a) => pl.advances.includes(a)), ['draft', 'state_religion', 'dogma']);
  assert.ok(!pl.advances.includes('nationalism'));
  assert.deepEqual([pl.mood, pl.culture, pl.res.gold], [3, 2, 3], 'nothing is paid');
  assert.equal(pl.res.ideas, 2, 'Dogma limits the Ideas to 2');
  assert.deepEqual(ofType(events, 'government').map((e) => [e.player, e.government]), [[0, 'theocracy']]);
  assert.ok(logged(g, /changes Government to Theocracy/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Religious Revival: every Government Advance beyond the first has to be replaced by one the player picks in the new category', () => {
  const g = flat();
  govern(g, 0, 'autocracy');
  give(g, 0, { advances: ['totalitarianism', 'absolute_power', 'philosophy', 'state_religion'] });
  realm(g, 0, ['temple']);
  const { asked } = effect(g, 'religious_revival', 0, { government: 'theocracy', pick_advances: ['conversion', 'fanaticism'] });
  assert.deepEqual(asked.map((q) => q.kind), ['government', 'pick_advances']);
  assert.deepEqual(asked[0].options.map((o) => o.id), ['none', 'democracy', 'theocracy']);
  assert.deepEqual(asked[1].options.map((o) => o.id), ['devotion', 'conversion', 'fanaticism'], 'Dogma comes with the switch');
  assert.deepEqual([asked[1].multi.min, asked[1].multi.max], [2, 2], 'three Advances in the old category, so two more');
  assert.deepEqual(asked[1].default, ['devotion', 'conversion']);
  const owned = me(g, 0).advances;
  assert.deepEqual(['dogma', 'devotion', 'conversion', 'fanaticism'].filter((a) => owned.includes(a)), ['dogma', 'conversion', 'fanaticism']);
  assert.deepEqual(['nationalism', 'totalitarianism', 'absolute_power', 'forced_labor'].filter((a) => owned.includes(a)), []);
  assert.deepEqual(checkInvariants(g), []);
});

test('Religious Revival: the Temple owners are asked in turn, starting with the drawer', () => {
  const g = flat();
  for (const p of [0, 1, 2]) {
    govern(g, p, 'autocracy');
    give(g, p, { advances: ['state_religion'] });
    realm(g, p, ['temple']);
  }
  const { asked } = effect(g, 'religious_revival', 1);
  assert.deepEqual(asked.map((q) => q.player), [1, 2, 0]);
});

test('Religious Revival: nothing is offered without a Government, or without another category to move to', () => {
  const g = flat();
  govern(g, 0, 'autocracy');
  give(g, 0, { advances: ['state_religion'] });
  realm(g, 0, ['market']);
  give(g, 1, { advances: ['state_religion', 'philosophy'] });
  realm(g, 1, ['temple']);
  govern(g, 2, 'democracy');
  realm(g, 2, ['temple']);
  const { asked } = effect(g, 'religious_revival', 0);
  assert.equal(asked.length, 0, 'no Temple, no Government, no other Advance to switch to');
  assert.deepEqual(g.s.players.map((p) => p.government), ['autocracy', null, 'democracy']);
});

// ------------------------------------------------------------------ Maritime Expansion
/** A lake: the whole disc of radius `r` around a free space turns to Sea. */
function lake(g, r) {
  const centre = openSpace(g, r);
  const spaces = [...bfs(g.s, centre, r, () => true).keys()];
  for (const k of spaces) setTerrain(g, k, 'sea');
  return { centre, spaces };
}
/** Every space exactly `d` steps from `k`, whatever stands on it. */
const around = (g, k, d) => allHexKeys(g.s).filter((x) => hexDistance(k, x) === d);

test('Maritime Expansion: a player whose Ship can sail is asked, and by default stays in port; a player without a Ship is not asked', () => {
  const g = flat();
  const { centre } = lake(g, 2);
  const [ship] = stationed(g, 0, 'ship', centre);
  const { asked, events } = effect(g, 'maritime_expansion', 1);
  assert.deepEqual(asked.map((q) => [q.player, q.kind, q.default]), [[0, 'maritime', 'no']]);
  assert.equal(ofType(events, 'move').length, 0);
  assert.equal(ship.hex, centre);
});

test('Maritime Expansion: a Ship sails for free to any sea space within 2 steps', () => {
  const g = flat();
  const { centre, spaces } = lake(g, 2);
  const [ship] = stationed(g, 0, 'ship', centre);
  const target = around(g, centre, 2)[1];
  const { asked, events } = effect(g, 'maritime_expansion', 0, { maritime: 'yes', pick_hex: target });
  assert.deepEqual(asked.map((q) => q.kind), ['maritime', 'pick_hex'], 'one Ship, so no question about which');
  assert.deepEqual(asked[1].options.map((o) => o.id), spaces.filter((k) => k !== centre).sort(), '18 spaces: all of the lake but its middle');
  assert.equal(asked[1].default, asked[1].options[0].id, 'the first of them by default');
  assert.equal(ship.hex, target);
  assert.deepEqual(ofType(events, 'move').map((e) => [e.player, e.units, e.from, e.to]), [[0, [ship.id], centre, target]]);
  assert.ok(logged(g, new RegExp(`sails a Ship from ${centre} to ${target}`)));
  assert.deepEqual(checkInvariants(g), []);
});

test('Maritime Expansion: the shore limits the range, and a rival Ship closes both its own space and the way through it', () => {
  const rimOf = (g, centre) => around(g, centre, 2).find((k) => nbrs(g.s, k).some((n) => g.s.map.hexes[n].terrain !== 'sea'));
  const options = (g, p, answers = {}) => {
    const { asked } = effect(g, 'maritime_expansion', p, { maritime: only(p, 'yes'), ...answers });
    return asked.find((q) => q.player === p && q.kind === 'pick_hex').options.map((o) => o.id);
  };
  const edge = flat();
  const lakeEdge = lake(edge, 2);
  const rim = rimOf(edge, lakeEdge.centre);
  stationed(edge, 0, 'ship', rim);
  const reach = lakeEdge.spaces.filter((k) => hexDistance(rim, k) >= 1 && hexDistance(rim, k) <= 2).sort();
  assert.ok(reach.length < 18, 'the shore cuts the range short');
  assert.deepEqual(options(edge, 0), reach);

  const blocked = flat();
  const { centre, spaces } = lake(blocked, 2);
  stationed(blocked, 0, 'ship', centre);
  const [near] = around(blocked, centre, 1);
  stationed(blocked, 1, 'ship', near);
  const behind = around(blocked, centre, 2).filter((k) => hexDistance(k, near) === 1 && nbrs(blocked.s, k).filter((n) => hexDistance(n, centre) === 1).length === 1);
  assert.equal(behind.length, 1, 'only one way leads to the space behind');
  const open = options(blocked, 0);
  assert.deepEqual(open, spaces.filter((k) => k !== centre && k !== near && k !== behind[0]).sort());
  assert.equal(open.length, 16);
});

test('Maritime Expansion: Ships left behind keep the units they can carry, and the rest sails along', () => {
  const trip = (ships, cargo) => {
    const g = flat();
    const { centre } = lake(g, 1);
    const [to] = around(g, centre, 1);
    stationed(g, 0, 'ship', centre, ships);
    stationed(g, 0, 'infantry', centre, cargo);
    effect(g, 'maritime_expansion', 0, { maritime: 'yes', pick_hex: to });
    assert.deepEqual(checkInvariants(g), [], `${ships} Ships, ${cargo} Infantry`);
    const at = (k) => [unitsAt(g.s, k).filter((u) => u.type === 'ship').length, unitsAt(g.s, k).filter((u) => u.type !== 'ship').length];
    return [at(centre), at(to)];
  };
  assert.deepEqual(trip(1, 2), [[0, 0], [1, 2]], 'a lone Ship takes its crew');
  assert.deepEqual(trip(2, 2), [[1, 2], [1, 0]], 'the Ship left behind carries both');
  assert.deepEqual(trip(2, 3), [[1, 2], [1, 1]]);
  assert.deepEqual(trip(2, 4), [[1, 2], [1, 2]]);
});

test('Maritime Expansion: players are asked in turn, starting with the drawer', () => {
  const g = flat();
  const { centre } = lake(g, 2);
  stationed(g, 0, 'ship', centre);
  stationed(g, 1, 'ship', around(g, centre, 2)[0]);
  const { asked } = effect(g, 'maritime_expansion', 1);
  assert.deepEqual(asked.map((q) => q.player), [1, 0]);
});

test('Maritime Expansion: a Ship with no space to sail to is not offered the move, and neither is one that a rival Ship blocks', () => {
  const pond = (spaces, rival = false) => {
    const g = flat();
    const k = openSpace(g, 1);
    const other = nbrs(g.s, k)[0];
    setTerrain(g, k, 'sea');
    if (spaces > 1) setTerrain(g, other, 'sea');
    const [ship] = stationed(g, 0, 'ship', k);
    if (rival) stationed(g, 1, 'ship', other);
    const { asked } = effect(g, 'maritime_expansion', 0, { maritime: 'yes' });
    return { asked, moved: ship.hex === other };
  };
  assert.equal(pond(1).asked.length, 0, 'a single sea space');
  const two = pond(2);
  assert.deepEqual(two.asked.map((q) => q.kind), ['maritime'], 'with one place to go nobody needs to choose it');
  assert.ok(two.moved);
  assert.equal(pond(2, true).asked.length, 0, 'the other space is taken');
});

test('Maritime Expansion: with Ships in several places the player picks the one that sails', () => {
  const g = flat();
  const { centre } = lake(g, 1);
  const [rim, other] = around(g, centre, 1);
  const [stays] = stationed(g, 0, 'ship', centre);
  const [sails] = stationed(g, 0, 'ship', rim);
  const { asked } = effect(g, 'maritime_expansion', 0, {
    maritime: 'yes',
    pick_hex: (q) => (/Ship to move/.test(q.text) ? rim : other),
  });
  assert.deepEqual(asked.map((q) => q.kind), ['maritime', 'pick_hex', 'pick_hex']);
  assert.deepEqual(asked[1].options.map((o) => o.id), [centre, rim].sort());
  assert.equal(asked[1].default, [centre, rim].sort()[0]);
  assert.deepEqual([stays.hex, sails.hex], [centre, other]);
});

// ------------------------------------------------------------------------ Typhoon
test('Typhoon: every Ship on the open sea sinks with its cargo whoever owns it, but a Ship at the shore is safe', () => {
  const g = flat();
  const { centre } = lake(g, 2);
  const [open] = around(g, centre, 1);
  const rim = around(g, centre, 2).find((k) => nbrs(g.s, k).some((n) => g.s.map.hexes[n].terrain !== 'sea'));
  stationed(g, 0, 'ship', centre);
  stationed(g, 0, 'infantry', centre, 2);
  stationed(g, 1, 'ship', open, 2);
  stationed(g, 2, 'ship', rim);
  const { asked, events } = effect(g, 'typhoon', 1);
  assert.equal(asked.length, 0);
  assert.deepEqual(ofType(events, 'typhoon').map((e) => e.hex), [centre, open].sort());
  assert.deepEqual([0, 1, 2].map((p) => unitsOf(g.s, p, 'ship').length), [0, 0, 1]);
  assert.equal(unitsOf(g.s, 0, 'infantry').length, 0, 'the crew goes down with the Ship');
  assert.ok(logged(g, new RegExp(`sinks 1 Ship at ${centre}`)) && logged(g, new RegExp(`sinks 2 Ships at ${open}`)));
  assert.ok(logged(g, /loses 2 units that no longer fit on a Ship/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Typhoon: Ships within 1 space of the sea space of any Port weather the storm, whoever owns the Port', () => {
  const g = flat();
  const { centre } = lake(g, 2);
  const harbourSea = around(g, centre, 2).find((k) => nbrs(g.s, k).filter((n) => hexDistance(n, centre) === 1).length === 2
    && nbrs(g.s, k).some((n) => hexDistance(n, centre) === 3));
  const quay = nbrs(g.s, harbourSea).find((n) => hexDistance(n, centre) === 3);
  const port = town(g, 1, quay, 'neutral', ['port']);
  port.port = harbourSea;
  const [near, nearer] = nbrs(g.s, harbourSea).filter((n) => hexDistance(n, centre) === 1);
  const far = around(g, centre, 1).find((k) => hexDistance(k, harbourSea) > 1);
  stationed(g, 0, 'ship', near);
  stationed(g, 1, 'ship', nearer);
  stationed(g, 2, 'ship', centre);
  stationed(g, 2, 'ship', far);
  const { events } = effect(g, 'typhoon', 0);
  assert.deepEqual([0, 1, 2].map((p) => unitsOf(g.s, p, 'ship').length), [1, 1, 0]);
  assert.deepEqual(ofType(events, 'typhoon').map((e) => e.hex), [centre, far].sort());
  assert.deepEqual(checkInvariants(g), []);
});

test('Typhoon: when no Ship is on the open sea the storm spares them all', () => {
  const g = flat();
  const sea = harbour(g, capitalOf(g, 0));
  const [ship] = stationed(g, 0, 'ship', sea);
  const { events } = effect(g, 'typhoon', 0);
  assert.equal(ofType(events, 'typhoon').length, 0);
  assert.equal(ship.hex, sea);
  assert.ok(logged(g, /The typhoon spares every Ship/));
});

// -------------------------------------------------------------------- Currency Reform
/** Answers from a queue, and 'stop' when it is empty. */
const trader = (...queue) => () => queue.shift() ?? 'stop';

test('Currency Reform: every player may trade 1 Food, Wood or Ore for 1 Gold, up to 3 times; by default only a surplus of 3 or more is sold', () => {
  const g = flat();
  stock(g, 0, { wood: 5, ore: 1 });
  stock(g, 1, { wood: 2, ore: 2 });
  stock(g, 2, {});
  const { asked } = effect(g, 'currency_reform', 0);
  assert.deepEqual(asked.map((q) => [q.player, q.default]), [[0, 'wood'], [0, 'wood'], [0, 'wood'], [1, 'stop']], 'player 2 has nothing to sell');
  assert.deepEqual(asked[0].options.map((o) => o.id), ['wood', 'ore', 'stop']);
  assert.deepEqual(g.s.players.map((p) => [p.res.wood, p.res.ore, p.res.gold]), [[2, 1, 3], [2, 2, 0], [0, 0, 0]]);
  assert.ok(logged(g, /trades 1 wood for 1 Gold/));
});

test('Currency Reform: the player chooses what to sell, and 3 trades is the most', () => {
  const g = flat();
  stock(g, 0, { food: 1, wood: 4, ore: 3 });
  stock(g, 1, {});
  stock(g, 2, {});
  const { asked } = effect(g, 'currency_reform', 0, { choice: trader('ore', 'food', 'wood', 'wood') });
  assert.deepEqual(asked.map((q) => q.options.map((o) => o.id)), [['food', 'wood', 'ore', 'stop'], ['food', 'wood', 'ore', 'stop'], ['wood', 'ore', 'stop']],
    'what has run out is not offered again, and there is no fourth question');
  assert.deepEqual([me(g, 0).res.food, me(g, 0).res.wood, me(g, 0).res.ore, me(g, 0).res.gold], [0, 3, 2, 3]);
  assert.deepEqual(checkInvariants(g), []);

  const early = flat();
  stock(early, 0, { wood: 4 });
  effect(early, 'currency_reform', 0, { choice: trader('wood', 'stop', 'wood') });
  assert.deepEqual([me(early, 0).res.wood, me(early, 0).res.gold], [3, 1], 'stopping ends the trading');
});

test('Currency Reform: players trade in turn, starting with the drawer', () => {
  const g = flat();
  for (const p of [0, 1, 2]) stock(g, p, { wood: 4 });
  const { asked } = effect(g, 'currency_reform', 2, { choice: trader() });
  assert.deepEqual(asked.map((q) => q.player), [2, 0, 1]);
});

test('Currency Reform: nothing is traded with a full treasury, or with nothing but Ideas and Gold', () => {
  const g = flat();
  stock(g, 0, { wood: 5, gold: 6 });
  stock(g, 1, { ideas: 2, gold: 1 });
  stock(g, 2, { wood: 3, gold: 7 });
  const { asked } = effect(g, 'currency_reform', 0, { choice: (q) => q.options[0].id });
  assert.deepEqual(asked.map((q) => q.player), [0], 'one trade fills the treasury of player 0');
  assert.deepEqual(g.s.players.map((p) => [p.res.wood, p.res.gold]), [[4, 7], [0, 1], [3, 7]]);
});

// ------------------------------------------------------------------ Sanitation Crisis
test('Sanitation Crisis: every city of size 3 or more turns Angry; smaller cities and cities that are Angry already are left alone', () => {
  const g = flat();
  const cities = realm(g, 0, ['market', 'temple'], ['market', 'temple', 'academy'], ['market'], ['market'], ['market', 'temple']);
  const [cap, t1, t2, t3, t4] = cities;
  wonder(g, t3);
  t4.mood = 'angry';
  assert.deepEqual(cities.map(citySize), [3, 4, 2, 3, 3]);
  const { events, asked } = effect(g, 'sanitation_crisis', 0);
  assert.equal(asked.length, 0);
  assert.deepEqual(cities.map((c) => c.mood), ['angry', 'angry', 'neutral', 'angry', 'angry']);
  assert.deepEqual(ofType(events, 'mood').map((e) => e.city), [cap.id, t1.id, t3.id], 'the Angry city has no mood to lose');
  assert.deepEqual([1, 2].map((p) => capitalOf(g, p).mood), ['happy', 'happy'], 'the other capitals are tiny');
  assert.deepEqual(checkInvariants(g), []);
});

test('Sanitation Crisis: a Happy city turns Angry at once, not just one step worse', () => {
  const g = flat();
  const cap = capitalOf(g, 0);
  Object.assign(cap.buildings, { market: 0, temple: 0 });
  assert.equal(cap.mood, 'happy');
  effect(g, 'sanitation_crisis', 0);
  assert.equal(cap.mood, 'angry');
});

test('Sanitation Crisis: Sanitation and Medicine protect their owners', () => {
  const g = flat();
  for (const p of [0, 1, 2]) realm(g, p, ['market', 'temple']);
  give(g, 0, { advances: ['sanitation'] });
  give(g, 1, { advances: ['medicine'] });
  effect(g, 'sanitation_crisis', 2);
  assert.deepEqual([0, 1, 2].map((p) => capitalOf(g, p).mood), ['neutral', 'neutral', 'angry']);
});

test('Sanitation Crisis: Myths pays 1 Mood token to keep a city calm, one city at a time', () => {
  const g = flat();
  const [cap, other] = realm(g, 0, ['market', 'temple'], ['market', 'temple']);
  give(g, 0, { advances: ['myths'], mood: 2 });
  const { asked } = effect(g, 'sanitation_crisis', 0);
  assert.deepEqual(asked.map((q) => [q.kind, q.default]), [['myths', 'yes'], ['myths', 'no']], 'with 1 Mood token left the default is to accept the loss');
  assert.deepEqual([cap.mood, other.mood, me(g, 0).mood], ['neutral', 'angry', 1]);
});

// ------------------------------------------------------------------------ Great Fair
test('Great Fair: each player trades up to 2 resources with the bank, by default giving up only a surplus; the busiest trader gains 1 Mood', () => {
  const g = flat();
  stock(g, 0, { wood: 5 });
  stock(g, 1, { food: 1, wood: 1 });
  stock(g, 2, {});
  const moods = g.s.players.map((p) => p.mood);
  const { asked } = effect(g, 'great_fair', 0);
  assert.deepEqual(asked.map((q) => [q.player, q.role]), [[0, 'give'], [0, 'get'], [0, 'give'], [0, 'get'], [1, 'give']], 'player 2 has nothing to trade');
  assert.deepEqual(asked.map((q) => q.default), ['wood', 'food', 'wood', 'ore', 'none'], 'what the player needs most');
  assert.deepEqual(asked[0].options.map((o) => o.id), ['wood', 'none']);
  assert.deepEqual(asked[1].options.map((o) => o.id), ['food', 'ore', 'ideas', 'gold'], 'anything but what is given');
  assert.deepEqual([me(g, 0).res.food, me(g, 0).res.wood, me(g, 0).res.ore], [1, 3, 1]);
  assert.deepEqual([me(g, 1).res.food, me(g, 1).res.wood], [1, 1]);
  assert.deepEqual(g.s.players.map((p, i) => p.mood - moods[i]), [1, 0, 0]);
  assert.ok(logged(g, /trades 1 wood for 1 food at the fair/) && logged(g, /trades the most at the fair/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Great Fair: players tied for the most trades all gain the Mood token', () => {
  const g = flat();
  stock(g, 0, { wood: 5 });
  stock(g, 1, { wood: 5 });
  stock(g, 2, { wood: 1 });
  const moods = g.s.players.map((p) => p.mood);
  effect(g, 'great_fair', 1, {
    pick_resource: (q) => (q.role === 'give' ? (q.options.some((o) => o.id === 'wood') ? 'wood' : 'none') : 'gold'),
  });
  assert.deepEqual(g.s.players.map((p) => [p.res.wood, p.res.gold]), [[3, 2], [3, 2], [0, 1]], '2 trades at most, and player 2 ran out of Wood');
  assert.deepEqual(g.s.players.map((p, i) => p.mood - moods[i]), [1, 1, 0]);
});

test('Great Fair: a player with nothing to spare is asked but by default trades nothing, and nobody gains Mood when nobody trades', () => {
  const g = flat();
  const before = g.s.players.map((p) => ({ ...p.res, mood: p.mood }));
  const { asked } = effect(g, 'great_fair', 0);
  assert.deepEqual(asked.map((q) => [q.player, q.role, q.default]), [[0, 'give', 'none'], [1, 'give', 'none'], [2, 'give', 'none']]);
  assert.deepEqual(g.s.players.map((p) => ({ ...p.res, mood: p.mood })), before);
});

test('Great Fair: only a resource that has room can be taken, and when there is just one nobody is asked', () => {
  const g = flat();
  stock(g, 0, { food: 2, wood: 7, ore: 7, ideas: 7 });
  stock(g, 1, { food: 2, wood: 7, ore: 7, ideas: 7, gold: 7 });
  stock(g, 2, {});
  const { asked } = effect(g, 'great_fair', 0, { pick_resource: (q) => (q.role === 'give' ? 'ore' : q.default) });
  assert.deepEqual(asked.map((q) => [q.player, q.role]), [[0, 'give'], [0, 'give']], 'Gold is the only space left, so it is not a choice');
  assert.deepEqual(me(g, 0).res, { food: 2, wood: 7, ore: 5, ideas: 7, gold: 2 });
  assert.deepEqual(me(g, 1).res, { food: 2, wood: 7, ore: 7, ideas: 7, gold: 7 }, 'no room for anything, so no trade');
});

// -------------------------------------------------------------- Provincial Rebellion
test('Provincial Rebellion: the drawer\'s city farthest from their capital turns Angry', () => {
  const g = flat();
  const cap = capitalOf(g, 0);
  cap.mood = 'neutral';
  const cities = [1, 2, 3].map((d) => town(g, 0, ring(g, cap.hex, d)[0]));
  const { asked, events } = effect(g, 'provincial_rebellion', 0);
  assert.equal(asked.length, 0);
  assert.deepEqual([cap, ...cities].map((c) => c.mood), ['neutral', 'neutral', 'neutral', 'angry']);
  assert.deepEqual(ofType(events, 'mood').map((e) => e.city), [cities[2].id]);
  assert.ok(logged(g, new RegExp(`The city at ${cities[2].hex} rebels and becomes Angry`)));
  assert.deepEqual(checkInvariants(g), []);
});

test('Provincial Rebellion: a player with a single city, and a player who is not the drawer, are not affected', () => {
  const g = flat();
  const cap = capitalOf(g, 1);
  town(g, 0, ring(g, capitalOf(g, 0).hex, 3)[0]);
  const { events } = effect(g, 'provincial_rebellion', 1);
  assert.equal(events.length, 0);
  assert.deepEqual([0, 1, 2].map((p) => capitalOf(g, p).mood), ['happy', 'happy', 'happy']);
  assert.equal(cap.mood, 'happy');
  assert.deepEqual(citiesOf(g.s, 0).map((c) => c.mood), ['happy', 'neutral']);
});

test('Provincial Rebellion: of cities equally far the player chooses, by default the smallest, and a calm city is chosen before an Angry one', () => {
  const table = () => {
    const g = flat();
    const [a, b] = ring(g, capitalOf(g, 0).hex, 3);
    const small = town(g, 0, a);
    const big = town(g, 0, b, 'neutral', ['market', 'temple']);
    return { g, small, big };
  };
  const first = table();
  const { asked } = effect(first.g, 'provincial_rebellion', 0);
  assert.deepEqual(asked.map((q) => [q.kind, q.default]), [['pick_city', first.small.id]]);
  assert.deepEqual(asked[0].options.map((o) => o.id), [first.small.id, first.big.id], 'smallest first');
  assert.deepEqual([first.small.mood, first.big.mood], ['angry', 'neutral']);

  const chosen = table();
  effect(chosen.g, 'provincial_rebellion', 0, { pick_city: chosen.big.id });
  assert.deepEqual([chosen.small.mood, chosen.big.mood], ['neutral', 'angry']);

  const calm = table();
  calm.small.mood = 'angry';
  assert.equal(effect(calm.g, 'provincial_rebellion', 0).asked.length, 0, 'one calm city, so no choice');
  assert.deepEqual([calm.small.mood, calm.big.mood], ['angry', 'angry']);

  const lost = table();
  lost.small.mood = 'angry';
  lost.big.mood = 'angry';
  const { events } = effect(lost.g, 'provincial_rebellion', 0);
  assert.equal(ofType(events, 'mood').length, 0);
  assert.ok(!logged(lost.g, /rebels/), 'nothing can get worse');
});

test('Provincial Rebellion: a Happy city turns Angry at once, not just one step worse', () => {
  const g = flat();
  const far = town(g, 0, ring(g, capitalOf(g, 0).hex, 3)[0], 'happy');
  effect(g, 'provincial_rebellion', 0);
  assert.equal(far.mood, 'angry');
});

test('Provincial Rebellion: Myths pays 1 Mood token to keep the rebels quiet', () => {
  const g = flat();
  const far = town(g, 0, ring(g, capitalOf(g, 0).hex, 3)[0]);
  give(g, 0, { advances: ['myths'], mood: 2 });
  const { asked } = effect(g, 'provincial_rebellion', 0);
  assert.deepEqual(asked.map((q) => [q.kind, q.default]), [['myths', 'yes']]);
  assert.equal(far.mood, 'neutral');
  assert.equal(me(g, 0).mood, 1);
  assert.ok(!logged(g, /rebels/));
});

// ---------------------------------------------------------------------- Treasure Fleet
test('Treasure Fleet: the player with the most Ports and Ships gains 3 Gold and everybody else 1', () => {
  const g = flat();
  for (const p of [0, 1, 2]) stock(g, p, {});
  stationed(g, 0, 'ship', harbour(g, capitalOf(g, 0)));
  sail(g, 1);
  const { asked } = effect(g, 'treasure_fleet', 2);
  assert.equal(asked.length, 0);
  assert.deepEqual(g.s.players.map((p) => p.res.gold), [3, 1, 1], 'a Port and a Ship against a single Ship');
  assert.ok(logged(g, new RegExp(`${g.name(0)} gains 3 Gold from the treasure fleet`)));
});

test('Treasure Fleet: players tied for the largest fleet all gain 3 Gold', () => {
  const g = flat();
  for (const p of [0, 1, 2]) stock(g, p, {});
  sail(g, 0);
  sail(g, 1);
  effect(g, 'treasure_fleet', 0);
  assert.deepEqual(g.s.players.map((p) => p.res.gold), [3, 3, 1]);
});

test('Treasure Fleet: with no Port or Ship anywhere everybody gains 1 Gold, and Gold never goes beyond 7', () => {
  const g = flat();
  for (const p of [0, 1, 2]) stock(g, p, {});
  stock(g, 2, { gold: 7 });
  effect(g, 'treasure_fleet', 0);
  assert.deepEqual(g.s.players.map((p) => p.res.gold), [1, 1, 7]);

  const lead = flat();
  for (const p of [1, 2]) stock(lead, p, {});
  stock(lead, 0, { gold: 6 });
  sail(lead, 0);
  effect(lead, 'treasure_fleet', 0);
  assert.deepEqual(lead.s.players.map((p) => p.res.gold), [7, 1, 1]);
  assert.ok(logged(lead, new RegExp(`${lead.name(0)} gains 1 Gold from the treasure fleet`)), 'only what fits is gained');
});
