// Battles, unit types and the Draft: Captives, Tribal Warfare, Warbeasts, Persian and Indian Elephants, Mounted Archers, Horsemanship,
// Immortals, Biremes, Spartans, Fireworks, Embalming, Runestones, Slave Economy (the Gold and Mood after a victory), Provinces,
// Mercenaries and Longships. The fixtures are in test/civs.mjs; the other powers are in the other civ-*.test.mjs.
// The dice are rigged: a face is `[value, icon]`, and the dice of a round are listed attacker first, then defender, round after round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { BARBARIAN, PIECE_LIMITS, PIRATE, SHIP_CAPACITY } from '../src/engine/data/constants.js';
import { battle } from '../src/engine/combat.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { tradePhase, tradeRoutes } from '../src/engine/trade.js';
import { buildingsLeft, shipCap, unitsAt, unitsLeft, unitsOf } from '../src/engine/queries.js';
import { checkInvariants } from './harness.mjs';
import { act, addCityAt, capitalOf, give, hold, kinds, landBattle, listen, refused, rigDice, settlerOf } from './scenario.mjs';
import {
  barbarians, bay, E, harbour, logged, me, ofType, optionIds, pirates, power, ring, run, setTerrain, stock, town, troops, W, world,
} from './civs.mjs';

/** A face that always scores a hit for Infantry (6, and +1 with the Infantry icon), and one that never scores anything. */
const HIT = [6, 'infantry'];
const MISS = [1, 'leader'];
/** The listed answers in turn, then the default of the prompt. */
const queue = (...answers) => (prompt) => (answers.length ? answers.shift() : prompt.default);
const has = (list, want) => list.some((c) => isDeepStrictEqual(c.action, want));
const asksOf = (asked, kind) => asked.filter((q) => q.kind === kind);
const noted = (round, pattern) => round.notes.some((n) => pattern.test(n));

/**
 * Player 0 attacks, from its capital, the space next to it where `def` stands: units of player `foe` (or of the Barbarians).
 * `dice` fixes the dice from round 1 on. `ask` and `foeAsk` answer the questions of the two players (the attacker retreats after
 * round 1 unless told otherwise); `cards` and `foeCards` are their Action cards, and a player who holds one has Tactics.
 * `prepare(g, { cap, hex })` may change the table before the dice are rigged.
 */
function clash({ civs, foe = 1, atk, def = [], dice, cards = [], foeCards = [], ask = { retreat: 'yes' }, foeAsk = {}, prepare }) {
  const g = world(civs);
  const cap = capitalOf(g);
  const [hex] = ring(g, cap.hex, 1);
  const player = foe !== BARBARIAN;
  if (cards.length || foeCards.length) give(g, 0, { advances: ['tactics'] });
  if (player && (cards.length || foeCards.length)) give(g, foe, { advances: ['tactics'] });
  hold(g, 0, ...cards);
  if (player) hold(g, foe, ...foeCards);
  const mine = atk.map((type) => troops(g, 0, type, cap.hex)[0].id);
  const theirs = def.map((type) => troops(g, foe, type, hex)[0].id);
  prepare?.(g, { cap, hex });
  const asked = listen(g, 0, ask);
  const askedFoe = player ? listen(g, foe, foeAsk) : [];
  if (dice) rigDice(g, ...dice);
  g.drainEvents();
  const r = g._run(battle(g, landBattle(0, foe, hex, cap.hex, mine)));
  assert.ok(r.ok, r.error);
  assert.equal(g.pending, null);
  const events = g.drainEvents();
  const rounds = ofType(events, 'battle_round');
  return { g, cap, hex, mine, theirs, asked, askedFoe, events, rounds, round: rounds[0], a: rounds[0]?.a, d: rounds[0]?.d, end: ofType(events, 'battle_end')[0] };
}

/**
 * Player 0 sails `atk` Ships from a Sea space into the next one, where `def` Ships of player `foe` (or the Pirates) lie.
 * `dice`, `ask`, `foeAsk` and `prepare(g, { o, at })` are as in `clash`.
 */
function seaFight({ civs, foe = PIRATE, atk = 1, def = 1, dice, ask = { retreat: 'yes' }, foeAsk = {}, prepare }) {
  const g = world(civs, { opponents: 2 });
  const { o, at } = bay(g);
  setTerrain(g, o, 'sea');
  setTerrain(g, at(W), 'sea');
  const mine = troops(g, 0, 'ship', at(W), atk).map((u) => u.id);
  if (foe === PIRATE) pirates(g, ...Array(def).fill(o));
  else troops(g, foe, 'ship', o, def);
  prepare?.(g, { o, at, mine });
  hold(g, 0);
  const asked = listen(g, 0, ask);
  if (foe !== PIRATE) {
    hold(g, foe);
    listen(g, foe, foeAsk);
  }
  rigDice(g, ...dice);
  g.drainEvents();
  const ctx = { domain: 'sea', attacker: 0, defender: foe, hex: o, from: at(W), units: mine, settlers: [], carried: [], landed: false, inPlace: false };
  const r = g._run(battle(g, ctx));
  assert.ok(r.ok, r.error);
  assert.equal(g.pending, null);
  const events = g.drainEvents();
  const rounds = ofType(events, 'battle_round');
  return { g, o, at, mine, asked, events, rounds, round: rounds[0], a: rounds[0]?.a, d: rounds[0]?.d, end: ofType(events, 'battle_end')[0] };
}

// ------------------------------------------------------------------ captives
const AZTECS = ['aztecs', 'rome'];
const aztecs = (g) => power(g, 0, 'captives');

test('Captives: the winner of a Land battle keeps the defeated Army units, each owned by the player it was taken from', () => {
  const t = clash({
    civs: AZTECS, atk: ['infantry', 'infantry', 'infantry'], def: ['infantry', 'cavalry', 'elephant'], dice: [HIT, HIT, HIT, MISS, MISS, MISS], prepare: aztecs,
  });
  assert.equal(t.end.winner, 0);
  assert.deepEqual(me(t.g).captives.map((c) => c.owner), [1, 1, 1]);
  assert.deepEqual(me(t.g).captives.map((c) => c.type).sort(), ['cavalry', 'elephant', 'infantry']);
  assert.deepEqual(ofType(t.events, 'captive').map((e) => [e.player, e.from, e.unit]).sort(), [[0, 1, 'cavalry'], [0, 1, 'elephant'], [0, 1, 'infantry']]);
  assert.equal(unitsLeft(t.g.s, 1, 'cavalry'), PIECE_LIMITS.cavalry - 1, 'a Captive is out of the supply of its owner');
  assert.ok(logged(t.g, /keeps 3 defeated units as Captives/));
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Captives: no more than 4 are kept; the Army units beyond that are lost for good', () => {
  const t = clash({
    civs: AZTECS, atk: ['infantry', 'infantry'], def: ['infantry', 'infantry'], dice: [HIT, HIT, MISS, MISS],
    prepare: (g) => {
      aztecs(g);
      me(g).captives = Array.from({ length: 3 }, () => ({ owner: 1, type: 'infantry' }));
    },
  });
  assert.equal(t.end.winner, 0);
  assert.equal(t.rounds[0].d.lost, 2, 'both defenders were defeated');
  assert.equal(me(t.g).captives.length, 4);
  assert.ok(logged(t.g, /keeps 1 defeated unit as Captives/));
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Captives: a defeated Barbarian army is kept too, and its pieces leave the Barbarian supply', () => {
  const t = clash({ civs: AZTECS, foe: BARBARIAN, atk: ['infantry', 'infantry'], def: ['infantry', 'infantry'], dice: [HIT, HIT, MISS, MISS], prepare: aztecs });
  assert.deepEqual(me(t.g).captives, [{ owner: BARBARIAN, type: 'infantry' }, { owner: BARBARIAN, type: 'infantry' }]);
  assert.equal(unitsLeft(t.g.s, BARBARIAN, 'infantry'), PIECE_LIMITS.barbarianInfantry - 2);
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Captives: an Aztec defender that wins keeps the attackers it defeated', () => {
  const t = clash({
    civs: ['rome', 'aztecs'], atk: ['infantry', 'infantry'], def: ['infantry', 'infantry', 'infantry'], dice: [MISS, MISS, HIT, HIT, HIT],
    prepare: (g) => power(g, 1, 'captives'),
  });
  assert.equal(t.end.winner, 1);
  assert.deepEqual(me(t.g, 1).captives, [{ owner: 0, type: 'infantry' }, { owner: 0, type: 'infantry' }]);
  assert.deepEqual(me(t.g, 0).captives, []);
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Captives: nothing is kept by an army that loses, that retreats, or that has no Captives Advance', () => {
  const lost = clash({ civs: AZTECS, atk: ['infantry'], def: ['infantry'], dice: [MISS, HIT], prepare: aztecs });
  assert.equal(lost.end.winner, 1);
  assert.deepEqual([me(lost.g, 0).captives, me(lost.g, 1).captives], [[], []]);

  const away = clash({ civs: AZTECS, atk: ['infantry', 'infantry'], def: ['infantry', 'infantry'], dice: [HIT, MISS, MISS, MISS], prepare: aztecs });
  assert.equal(away.end.retreated, true);
  assert.equal(away.rounds[0].d.lost, 1, 'a defender fell, but the Aztecs did not win the battle');
  assert.deepEqual(me(away.g).captives, []);

  const plain = clash({ civs: AZTECS, atk: ['infantry'], def: ['infantry'], dice: [HIT, MISS] });
  assert.equal(plain.end.winner, 0);
  assert.deepEqual(me(plain.g).captives, []);
});

test('Captives: only Army units are kept: the Settlers that stood with the defeated army are not', () => {
  const t = clash({ civs: AZTECS, atk: ['infantry', 'infantry'], def: ['infantry', 'settler'], dice: [HIT, HIT, MISS], prepare: aztecs });
  assert.equal(t.end.winner, 0);
  assert.deepEqual(me(t.g).captives, [{ owner: 1, type: 'infantry' }]);
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Captives: a victory at sea is not a Land battle, so it takes none', () => {
  const t = seaFight({ civs: AZTECS, foe: 1, dice: [HIT, MISS], prepare: aztecs });
  assert.equal(t.end.winner, 0);
  assert.equal(t.rounds[0].d.lost, 1);
  assert.deepEqual(me(t.g).captives, []);
});

test('Captives: a sacrifice spends a Barbarian Captive before the Captive of a player', () => {
  const g = world(AZTECS);
  power(g, 0, 'captives', 'human_sacrifice');
  stock(g, 0, {});
  me(g).captives = [{ owner: 1, type: 'infantry' }, { owner: BARBARIAN, type: 'cavalry' }];
  g.drainEvents();
  act(g, { type: 'human_sacrifice', gain: { food: 1 } });
  assert.deepEqual(me(g).captives, [{ owner: 1, type: 'infantry' }]);
  assert.deepEqual(ofType(g.drainEvents(), 'sacrifice').map((e) => [e.unit, e.from]), [['cavalry', BARBARIAN]]);
  assert.equal(me(g).res.food, 1);
  assert.deepEqual(checkInvariants(g), []);
});

// ------------------------------------------------------------ tribal warfare
const TRIBES = ['celts', 'rome'];
/** A Barbarian city with `n` Barbarian Infantry, `d` spaces from `around`. */
function camp(g, around, d, n) {
  const k = ring(g, around, d)[0];
  addCityAt(g, BARBARIAN, k);
  barbarians(g, 'infantry', k, n);
}
/** Player p is Celtic with Tribal Warfare, and Barbarian cities of these `[distance, units]` stand around the battle. */
const tribes = (p, camps) => (g, { hex }) => {
  power(g, p, 'tribal_warfare');
  for (const [d, n] of camps) camp(g, hex, d, n);
};

for (const [what, camps, bonus] of [
  ['a Barbarian city with 2 units next to the battle gives +1 CV', [[1, 2]], 1],
  ['a Barbarian city 2 spaces away with 3 units gives +1 CV, no matter how many units it holds', [[2, 3]], 1],
  ['every such Barbarian city gives +1 CV', [[1, 2], [2, 2]], 2],
  ['three such cities give +3 CV', [[1, 2], [2, 2], [1, 2]], 3],
  ['a Barbarian city holding a single unit gives nothing', [[1, 1]], 0],
  ['a Barbarian city 3 spaces away gives nothing', [[3, 2]], 0],
  ['without Barbarians around it gives nothing', [], 0],
]) {
  test(`Tribal Warfare: ${what}`, () => {
    const t = clash({ civs: TRIBES, atk: ['infantry'], def: ['infantry'], dice: [[4, 'cavalry'], MISS], prepare: tribes(0, camps) });
    assert.equal(t.a.mod, bonus);
    assert.equal(t.a.cv, 4 + bonus);
    assert.equal(t.a.hits, bonus ? 1 : 0, 'the CV reaches 5 only with the bonus');
    assert.equal(t.d.mod, 0);
  });
}

test('Tribal Warfare: the bonus is there in every round of the battle', () => {
  const t = clash({
    civs: TRIBES, atk: ['infantry'], def: ['infantry', 'infantry'], dice: [[4, 'cavalry'], MISS, MISS, [4, 'cavalry'], MISS],
    ask: { retreat: queue('no') }, prepare: tribes(0, [[1, 2], [2, 2]]),
  });
  assert.deepEqual(t.rounds.map((r) => [r.a.mod, r.a.cv, r.a.hits, r.d.lost]), [[2, 6, 1, 1], [2, 6, 1, 1]]);
  assert.equal(t.end.winner, 0);
});

test('Tribal Warfare: a Celtic defender gets the bonus, and the attacker does not', () => {
  const t = clash({ civs: ['rome', 'celts'], atk: ['infantry'], def: ['infantry'], dice: [MISS, [4, 'cavalry']], prepare: tribes(1, [[1, 2], [2, 2]]) });
  assert.deepEqual([t.d.mod, t.d.cv, t.d.hits, t.a.mod], [2, 6, 1, 0]);
  assert.equal(t.end.winner, 1);
});

test('Tribal Warfare: it is a power against players: the Barbarians themselves do not suffer it', () => {
  const t = clash({ civs: TRIBES, foe: BARBARIAN, atk: ['infantry'], def: ['infantry'], dice: [[4, 'cavalry'], MISS], prepare: tribes(0, [[1, 2], [2, 2]]) });
  assert.deepEqual([t.a.mod, t.a.cv, t.a.hits], [0, 4, 0]);
});

test('Tribal Warfare: only the Celts with the Advance get it', () => {
  const t = clash({
    civs: TRIBES, atk: ['infantry'], def: ['infantry'], dice: [[4, 'cavalry'], MISS],
    prepare: (g, { hex }) => {
      camp(g, hex, 1, 2);
      camp(g, hex, 2, 2);
    },
  });
  assert.deepEqual([t.a.mod, t.a.cv, t.a.hits], [0, 4, 0]);
});

// ------------------------------------------------------------------ warbeasts
const CARTHAGE = ['carthage', 'rome'];
const warbeasts = (p = 0) => (g) => power(g, p, 'warbeasts');

test('Warbeasts: an Elephant die showing 1 or 2 adds its value to the CV instead of cancelling a hit that is not coming', () => {
  const dice = [[2, 'elephant'], [3, 'infantry'], MISS];
  const t = clash({ civs: CARTHAGE, atk: ['elephant', 'infantry'], def: ['infantry'], dice, prepare: warbeasts() });
  assert.deepEqual([t.a.cv, t.a.hits, t.a.elephants, t.round.cancelA], [6, 1, 0, 0]);
  assert.equal(t.d.lost, 1, 'the extra 2 CV make the hit that kills');
  assert.ok(noted(t.round, /Warbeasts/));
  assert.equal(t.end.winner, 0);

  const plain = clash({ civs: CARTHAGE, atk: ['elephant', 'infantry'], def: ['infantry'], dice });
  assert.deepEqual([plain.a.cv, plain.a.hits, plain.a.elephants, plain.round.cancelA], [4, 0, 1, 1], 'without the power the Elephant only cancels');
  assert.ok(!noted(plain.round, /Warbeasts/));
});

test('Warbeasts: the Elephant still cancels the hit when one is coming', () => {
  const t = clash({ civs: CARTHAGE, atk: ['elephant', 'infantry'], def: ['infantry'], dice: [[2, 'elephant'], [3, 'infantry'], HIT], prepare: warbeasts() });
  assert.deepEqual([t.a.cv, t.a.elephants, t.round.cancelA, t.a.lost], [4, 1, 1, 0]);
  assert.equal(t.d.hits, 1, 'the enemy hit is there');
  assert.ok(!noted(t.round, /Warbeasts/));
});

test('Warbeasts: only a die showing 1 or 2 can be added; a 3 or a 4 cancels as always', () => {
  const t = clash({ civs: CARTHAGE, atk: ['elephant', 'infantry'], def: ['infantry'], dice: [[3, 'elephant'], [3, 'infantry'], MISS], prepare: warbeasts() });
  assert.deepEqual([t.a.cv, t.a.hits, t.a.elephants], [4, 0, 1]);
  assert.ok(!noted(t.round, /Warbeasts/));
});

test('Warbeasts: only as many Elephant dice are added as there are cancels to spare', () => {
  const t = clash({ civs: CARTHAGE, atk: ['elephant', 'elephant'], def: ['infantry'], dice: [[2, 'elephant'], [2, 'elephant'], [5, 'infantry']], prepare: warbeasts() });
  assert.equal(t.d.hits, 1);
  assert.deepEqual([t.a.cv, t.a.elephants, t.round.cancelA, t.a.lost], [2, 1, 1, 0], 'one Elephant adds its 2, the other cancels the hit');
});

test('Warbeasts: a Carthaginian defender uses them too', () => {
  const t = clash({ civs: ['rome', 'carthage'], atk: ['infantry'], def: ['elephant', 'infantry'], dice: [MISS, [2, 'elephant'], [3, 'infantry']], prepare: warbeasts(1) });
  assert.deepEqual([t.d.cv, t.d.hits, t.d.elephants], [6, 1, 0]);
  assert.equal(t.a.lost, 1);
  assert.equal(t.end.winner, 1);
});

// ---------------------------------------------------------- persian elephants
const PERSIA = ['persia', 'rome'];
const persians = (p = 0) => (g) => power(g, p, 'persian_elephants');
const RIDERS = [[4, 'cavalry'], [3, 'infantry']];

test('Persian Elephants: in round 1 an Elephant cancels the bonus of an enemy Cavalry', () => {
  const dice = [[3, 'elephant'], [3, 'infantry'], [3, 'infantry'], ...RIDERS];
  const t = clash({ civs: PERSIA, atk: ['elephant', 'infantry', 'infantry'], def: ['cavalry', 'infantry'], dice, prepare: persians() });
  assert.deepEqual([t.d.cavalry, t.d.cv, t.d.hits], [0, 8, 1], 'the Cavalry bonus of +2 is gone');
  assert.deepEqual([t.round.cancelA, t.a.lost], [1, 0], 'and the Elephant still cancels the one hit that is left');
  assert.ok(noted(t.round, /Persian Elephants.*cancels the bonus of 1 enemy Cavalry/));

  const plain = clash({ civs: PERSIA, atk: ['elephant', 'infantry', 'infantry'], def: ['cavalry', 'infantry'], dice });
  assert.deepEqual([plain.d.cavalry, plain.d.cv, plain.d.hits], [2, 10, 2]);
  assert.equal(plain.a.lost, 1);
  assert.ok(!noted(plain.round, /Persian Elephants/));
});

test('Persian Elephants: it is a power of round 1 only', () => {
  const dice = [[3, 'elephant'], [4, 'cavalry'], [3, 'elephant'], [4, 'cavalry']];
  const t = clash({ civs: PERSIA, atk: ['elephant'], def: ['cavalry'], dice, ask: { retreat: queue('no', 'yes') }, prepare: persians() });
  const [first, second] = t.rounds;
  assert.deepEqual([first.d.cavalry, first.d.cv, first.d.hits], [0, 4, 0]);
  assert.ok(noted(first, /Persian Elephants/));
  assert.deepEqual([second.d.cavalry, second.d.cv, second.d.hits], [2, 6, 1]);
  assert.ok(!noted(second, /Persian Elephants/));
  assert.deepEqual([second.cancelA, second.a.lost], [1, 0], 'in round 2 the Elephant cancels the Cavalry hit instead');
});

test('Persian Elephants: a Persian defender cancels the bonus of the attacking Cavalry', () => {
  const dice = [...RIDERS, MISS];
  const t = clash({ civs: ['rome', 'persia'], atk: ['cavalry', 'infantry'], def: ['elephant'], dice, prepare: persians(1) });
  assert.deepEqual([t.a.cavalry, t.a.cv, t.a.hits], [0, 8, 1]);
  assert.equal(t.d.lost, 1);

  const plain = clash({ civs: ['rome', 'persia'], atk: ['cavalry', 'infantry'], def: ['elephant'], dice });
  assert.deepEqual([plain.a.cavalry, plain.a.cv, plain.a.hits], [2, 10, 2]);
});

test('Persian Elephants: each Elephant cancels the bonus of one Cavalry, no more', () => {
  const dice = [MISS, MISS, [4, 'cavalry'], [4, 'cavalry']];
  const two = clash({ civs: PERSIA, atk: ['elephant', 'elephant'], def: ['cavalry', 'cavalry'], dice, prepare: persians() });
  assert.deepEqual([two.d.cavalry, two.d.cv], [0, 8], 'two Elephants cancel both bonuses of +2');
  const one = clash({ civs: PERSIA, atk: ['elephant'], def: ['cavalry', 'cavalry'], dice: dice.slice(1), prepare: persians() });
  assert.deepEqual([one.d.cavalry, one.d.cv], [2, 10], 'one Elephant cancels only one of them');
});

// --------------------------------- the peoples whose cities all build Elephants or Cavalry
const MOUNTED = [
  ['carthage', 'warbeasts', 'elephant'],
  ['persia', 'persian_elephants', 'elephant'],
  ['india', 'indian_elephants', 'elephant'],
  ['huns', 'mounted_archers', 'cavalry'],
  ['japan', 'horsemanship', 'cavalry'],
  ['rome', 'provinces', 'cavalry'],
];
const PRICE = { elephant: { food: 2 }, cavalry: { food: 1, wood: 1 } };
/** Provinces comes with a Government. */
const autocracy = (g, p = 0) => {
  give(g, p, { advances: ['draft', 'nationalism'] });
  me(g, p).government = 'autocracy';
};

for (const [people, id, type] of MOUNTED) {
  test(`${id}: every city of the ${people} builds ${type === 'elephant' ? 'Elephants' : 'Cavalry'}, with or without a Market`, () => {
    const g = world([people]);
    const cap = capitalOf(g);
    const village = town(g, 0, ring(g, cap.hex, 2)[0]);
    const other = type === 'elephant' ? 'cavalry' : 'elephant';
    const buy = (city, what = type) => ({ type: 'recruit', city: city.id, units: { [what]: 1 } });
    const listed = (city, what = type) => has(enumerateActions(g, 0), { type: 'recruit', city: city.id, units: { infantry: 0, cavalry: 0, elephant: 0, settler: 0, ship: 0, [what]: 1 } });
    const fund = () => stock(g, 0, { food: 2, wood: 1 });

    fund();
    assert.match(refused(g, buy(cap)), /Market/, 'without the power it takes a Market');
    assert.equal(listed(cap), false);

    power(g, 0, id);
    if (id === 'provinces') autocracy(g);
    assert.match(refused(g, buy(cap, other)), /Market/, 'the power is for one kind of unit only');
    assert.equal(listed(cap, other), false);
    for (const city of [cap, village]) {
      fund();
      assert.equal(listed(city), true, 'the Recruit is among the candidate actions');
      act(g, buy(city));
      assert.deepEqual(kinds(g, city.hex), [type]);
      assert.deepEqual([me(g).res.food, me(g).res.wood], [2 - PRICE[type].food, 1 - (PRICE[type].wood ?? 0)], 'the unit costs what it always costs');
    }
    assert.equal(unitsOf(g.s, 0, type).length, 2);
    assert.deepEqual(checkInvariants(g), []);
  });
}

// ----------------------------------------------------------- indian elephants
/** India with Trade Routes and two cities of Rome 2 spaces away; a Settler and an Elephant stand in the capital. */
function caravan() {
  const g = world(['india', 'rome']);
  const cap = capitalOf(g);
  give(g, 0, { advances: ['trade_routes'] });
  for (const k of ring(g, cap.hex, 2).slice(0, 2)) town(g, 1, k);
  const [tusker] = troops(g, 0, 'elephant', cap.hex);
  return { g, cap, tusker, settler: settlerOf(g) };
}
const routeUnits = (g) => tradeRoutes(g.s, 0).map((r) => r.unit).sort();

test('Indian Elephants: an Elephant starts a trade route of its own, next to the Settlers and Ships', () => {
  const { g, tusker, settler } = caravan();
  assert.deepEqual(routeUnits(g), [settler.id], 'the Elephant of any other people starts none');
  power(g, 0, 'indian_elephants');
  assert.deepEqual(routeUnits(g), [settler.id, tusker.id].sort(), 'each unit pairs with a different city');
});

test('Indian Elephants: the routes of an Elephant pay like any other', () => {
  const { g } = caravan();
  stock(g, 0, {});
  const plain = ofType(run(g, tradePhase(g, 0)), 'trade')[0];
  assert.deepEqual([plain.routes.length, plain.gain, me(g).res.food], [1, { food: 1 }, 1]);

  const rich = caravan();
  power(rich.g, 0, 'indian_elephants');
  stock(rich.g, 0, {});
  const trade = ofType(run(rich.g, tradePhase(rich.g, 0)), 'trade')[0];
  assert.deepEqual([trade.routes.length, trade.gain, me(rich.g).res.food], [2, { food: 2 }, 2]);
});

test('Indian Elephants: an Elephant in an Angry city of its own starts no route', () => {
  const { g, cap, settler } = caravan();
  power(g, 0, 'indian_elephants');
  cap.mood = 'angry';
  assert.deepEqual(routeUnits(g), [settler.id], 'only the Settler is left');
  cap.mood = 'neutral';
  assert.equal(routeUnits(g).length, 2);
});

// ------------------------------------------------------------ mounted archers
test('Mounted Archers: the Huns pick their casualties, so a Cavalry may fall before the Infantry (as for every people)', () => {
  const t = clash({
    civs: ['huns', 'rome'], atk: ['infantry', 'cavalry'], def: ['infantry'], dice: [MISS, MISS, HIT],
    ask: { casualties: '1', retreat: 'yes' }, prepare: (g) => power(g, 0, 'mounted_archers'),
  });
  const [question] = asksOf(t.asked, 'casualties');
  assert.deepEqual(optionIds(question), ['0', '1'], 'an Infantry or a Cavalry');
  assert.deepEqual([t.a.lost, kinds(t.g, t.cap.hex)], [1, ['infantry']], 'the Cavalry was the one lost');
});

// ---------------------------------------------------------------- horsemanship
const JAPAN = ['japan', 'rome'];
/** Player p is Japanese with Horsemanship and this much Culture. */
const horsemen = (culture, p = 0) => (g) => {
  power(g, p, 'horsemanship');
  stock(g, p, { culture });
};

test('Horsemanship: in round 1 an Army with Cavalry may reroll its lowest die for 1 Culture', () => {
  const t = clash({ civs: JAPAN, atk: ['cavalry', 'infantry'], def: ['infantry'], dice: [MISS, MISS, MISS, HIT], ask: { horsemanship: 'yes' }, prepare: horsemen(2) });
  assert.equal(asksOf(t.asked, 'horsemanship').length, 1);
  assert.equal(me(t.g).culture, 1, 'the reroll cost 1 Culture');
  assert.deepEqual(t.a.dice.map((d) => d.v), [6, 1], 'the first of the lowest dice was rolled again');
  assert.deepEqual([t.a.cv, t.a.hits, t.d.lost], [8, 1, 1]);
  assert.ok(noted(t.round, /Horsemanship.*rerolls a 1 and gets a 6/));
  assert.equal(t.end.winner, 0);
});

test('Horsemanship: with Rituals the reroll is free', () => {
  const t = clash({
    civs: JAPAN, atk: ['cavalry', 'infantry'], def: ['infantry'], dice: [MISS, MISS, MISS, HIT], ask: { horsemanship: 'yes' },
    prepare: (g) => {
      horsemen(0)(g);
      give(g, 0, { advances: ['rituals'] });
    },
  });
  assert.equal(asksOf(t.asked, 'horsemanship').length, 1);
  assert.equal(me(t.g).culture, 0);
  assert.deepEqual([t.a.cv, t.a.hits], [8, 1]);
});

test('Horsemanship: there is no reroll without 1 Culture to pay (or Rituals), nor for an army without Cavalry', () => {
  const broke = clash({ civs: JAPAN, atk: ['cavalry', 'infantry'], def: ['infantry'], dice: [MISS, MISS, MISS], prepare: horsemen(0) });
  assert.equal(asksOf(broke.asked, 'horsemanship').length, 0);
  assert.equal(broke.a.cv, 2);
  const foot = clash({ civs: JAPAN, atk: ['infantry', 'infantry'], def: ['infantry'], dice: [MISS, MISS, MISS], prepare: horsemen(2) });
  assert.equal(asksOf(foot.asked, 'horsemanship').length, 0);
  assert.equal(me(foot.g).culture, 2);
});

test('Horsemanship: keeping the roll costs nothing, and round 2 has no reroll at all', () => {
  const t = clash({
    civs: JAPAN, atk: ['cavalry'], def: ['infantry'], dice: [MISS, MISS, MISS, MISS], ask: { horsemanship: 'no', retreat: queue('no', 'yes') }, prepare: horsemen(2),
  });
  assert.equal(t.rounds.length, 2);
  assert.equal(asksOf(t.asked, 'horsemanship').length, 1, 'asked in round 1 only');
  assert.equal(me(t.g).culture, 2);
  assert.deepEqual(t.a.dice, [{ v: 1, icon: 'leader' }]);
});

test('Horsemanship: a Japanese defender with Cavalry rerolls too', () => {
  const t = clash({
    civs: ['rome', 'japan'], atk: ['infantry'], def: ['cavalry', 'infantry'], dice: [MISS, MISS, MISS, HIT], foeAsk: { horsemanship: 'yes' }, prepare: horsemen(1, 1),
  });
  assert.equal(asksOf(t.askedFoe, 'horsemanship').length, 1);
  assert.deepEqual([t.d.cv, t.d.hits, t.a.lost], [8, 1, 1]);
  assert.equal(me(t.g, 1).culture, 0);
  assert.equal(t.end.winner, 1);
});

// -------------------------------------------------------------------- immortals
const IMMORTALS = ['persia', 'rome'];
/** Player p is Persian with Immortals and this much Culture. */
const immortals = (culture, p = 0) => (g) => {
  power(g, p, 'immortals');
  stock(g, p, { culture });
};

test('Immortals: before a round Culture can be spent for +1 CV each, up to 4', () => {
  const t = clash({ civs: IMMORTALS, atk: ['infantry'], def: ['infantry'], dice: [[4, 'cavalry'], MISS], ask: { immortals: '3', retreat: 'yes' }, prepare: immortals(6) });
  const [question] = asksOf(t.asked, 'immortals');
  assert.deepEqual(optionIds(question), ['0', '1', '2', '3', '4'], 'never more than 4');
  assert.equal(me(t.g).culture, 3);
  assert.deepEqual([t.a.mod, t.a.cv, t.a.hits, t.d.lost], [3, 7, 1, 1], 'the 3 CV make the hit');
  assert.ok(logged(t.g, /spends 3 Culture for \+3 CV \(Immortals\)/));
  assert.equal(t.end.winner, 0);

  const poor = clash({ civs: IMMORTALS, atk: ['infantry'], def: ['infantry'], dice: [[4, 'cavalry'], MISS], ask: { immortals: '2', retreat: 'yes' }, prepare: immortals(2) });
  assert.deepEqual(optionIds(asksOf(poor.asked, 'immortals')[0]), ['0', '1', '2'], 'and never more than the Culture held');
  assert.equal(me(poor.g).culture, 0);
});

test('Immortals: the Culture is spent anew before each round', () => {
  const dice = [[4, 'cavalry'], MISS, MISS, [4, 'cavalry'], MISS, MISS];
  const t = clash({ civs: IMMORTALS, atk: ['infantry'], def: ['infantry', 'infantry'], dice, ask: { immortals: queue('0', '4'), retreat: queue('no', 'yes') }, prepare: immortals(4) });
  assert.equal(asksOf(t.asked, 'immortals').length, 2);
  assert.deepEqual(t.rounds.map((r) => [r.a.mod, r.a.cv, r.a.hits, r.d.lost]), [[0, 4, 0, 0], [4, 8, 1, 1]]);
  assert.equal(me(t.g).culture, 0);
});

test('Immortals: nothing to spend, nothing asked; and only the Persians with the Advance are asked', () => {
  const broke = clash({ civs: IMMORTALS, atk: ['infantry'], def: ['infantry'], dice: [MISS, MISS], prepare: immortals(0) });
  assert.equal(asksOf(broke.asked, 'immortals').length, 0);
  const plain = clash({ civs: IMMORTALS, atk: ['infantry'], def: ['infantry'], dice: [MISS, MISS], prepare: (g) => stock(g, 0, { culture: 3 }) });
  assert.equal(asksOf(plain.asked, 'immortals').length, 0);
  assert.equal(me(plain.g).culture, 3);
});

test('Immortals: a Persian defender spends Culture too', () => {
  const t = clash({ civs: ['rome', 'persia'], atk: ['infantry'], def: ['infantry'], dice: [MISS, [4, 'cavalry']], foeAsk: { immortals: '4' }, prepare: immortals(4, 1) });
  assert.deepEqual([t.d.mod, t.d.cv, t.d.hits, t.a.lost], [4, 8, 1, 1]);
  assert.equal(me(t.g, 1).culture, 0);
  assert.equal(t.end.winner, 1);
});

// -------------------------------------------------------------------- biremes
const PHOENICIA = ['phoenicia', 'rome'];
const biremes = (p = 0) => (g) => power(g, p, 'biremes');
const warships = (p) => (g) => give(g, p, { advances: ['warships'] });

test('Biremes: round 1 of a naval battle gives the Phoenicians +1 hit against the Pirates, who have no Warships', () => {
  const t = seaFight({ civs: PHOENICIA, atk: 1, def: 2, dice: [MISS, MISS, MISS], prepare: biremes() });
  assert.deepEqual([t.a.cv, t.a.hits], [1, 1], 'a CV of 1 scores no hit: the Biremes do');
  assert.deepEqual([t.d.lost, t.a.lost], [1, 0]);
  assert.equal(t.end.winner, null, 'no one has won: a second Pirate Ship is left');

  const plain = seaFight({ civs: PHOENICIA, atk: 1, def: 2, dice: [MISS, MISS, MISS], prepare: warships(0) });
  assert.deepEqual([plain.a.hits, plain.d.lost], [0, 0], 'Warships alone give no hit');
});

test('Biremes: the extra hit is a bonus of round 1 only', () => {
  const t = seaFight({ civs: PHOENICIA, atk: 1, def: 2, dice: [MISS, MISS, MISS, MISS, MISS], ask: { retreat: queue('no', 'yes') }, prepare: biremes() });
  assert.deepEqual(t.rounds.map((r) => [r.a.hits, r.d.lost]), [[1, 1], [0, 0]]);
});

test('Biremes: an opponent with Warships takes the hit away', () => {
  const dice = [MISS, MISS];
  const without = seaFight({ civs: PHOENICIA, foe: 1, dice, prepare: biremes() });
  assert.deepEqual([without.a.hits, without.d.lost], [1, 1], 'a player without Warships suffers it, like the Pirates');
  const armed = seaFight({ civs: PHOENICIA, foe: 1, dice, prepare: (g) => (biremes()(g), warships(1)(g)) });
  assert.deepEqual([armed.a.hits, armed.d.lost], [0, 0]);
});

test('Biremes: Phoenician defenders score the hit against an attacker without Warships', () => {
  const dice = [MISS, MISS, MISS];
  const t = seaFight({ civs: ['rome', 'phoenicia'], foe: 1, atk: 2, def: 1, dice, prepare: biremes(1) });
  assert.deepEqual([t.d.hits, t.a.lost, t.d.lost], [1, 1, 0]);
  const armed = seaFight({ civs: ['rome', 'phoenicia'], foe: 1, atk: 2, def: 1, dice, prepare: (g) => (biremes(1)(g), warships(0)(g)) });
  assert.deepEqual([armed.d.hits, armed.a.lost], [0, 0]);
});

// -------------------------------------------------------------------- spartans
const GREECE = ['greece', 'rome'];
const draftOf = (city, extra = {}) => ({ type: 'recruit', city: city.id, units: { infantry: 1 }, draft: true, ...extra });
const drafted = (units, extra = {}) => ({ units: { infantry: 0, cavalry: 0, elephant: 0, settler: 0, ship: 0, ...units }, ...extra });

test('Spartans: the Draft may be paid in Culture instead of Mood', () => {
  const g = world(['greece']);
  power(g, 0, 'spartans');
  const cap = capitalOf(g);
  const [village, outpost] = ring(g, cap.hex, 2).slice(0, 2).map((k) => town(g, 0, k));
  stock(g, 0, { mood: 2, culture: 2 });
  act(g, draftOf(cap, { draftWith: 'culture' }));
  assert.deepEqual([me(g).culture, me(g).mood], [1, 2], '1 Culture, no Mood');
  assert.deepEqual(kinds(g, cap.hex), ['infantry']);
  act(g, draftOf(village));
  assert.deepEqual([me(g).culture, me(g).mood], [1, 1], 'Mood still pays when Culture is not asked for');
  assert.deepEqual(kinds(g, village.hex), ['infantry']);
  stock(g, 0, { mood: 0, culture: 1 });
  assert.match(refused(g, draftOf(outpost)), /afford/, 'with no Mood left only the Culture pays');
  act(g, draftOf(outpost, { draftWith: 'culture' }));
  assert.deepEqual([me(g).culture, me(g).mood], [0, 0]);
  assert.deepEqual(checkInvariants(g), []);
});

test('Spartans: nobody else drafts with Culture, and the Culture must be there', () => {
  const rome = world(['rome']);
  give(rome, 0, { advances: ['draft'] });
  stock(rome, 0, { mood: 2, culture: 2 });
  assert.match(refused(rome, draftOf(capitalOf(rome), { draftWith: 'culture' })), /Spartans/);

  const g = world(['greece']);
  power(g, 0, 'spartans');
  stock(g, 0, { mood: 5, culture: 0 });
  assert.match(refused(g, draftOf(capitalOf(g), { draftWith: 'culture' })), /afford/, 'Mood cannot pay for the Culture option');
  assert.match(refused(g, draftOf(capitalOf(g), { draftWith: 'gold' })), /Mercenaries/, 'and the Spartans have no Mercenaries');
});

test('Spartans: the Draft with Culture is among the candidate actions, when there is Culture to pay it', () => {
  const g = world(['greece']);
  power(g, 0, 'spartans');
  const cap = capitalOf(g);
  const culture = { type: 'recruit', city: cap.id, ...drafted({ infantry: 1 }, { draft: true, draftWith: 'culture' }) };
  stock(g, 0, { mood: 2, culture: 2 });
  assert.ok(has(enumerateActions(g, 0), culture));
  assert.ok(has(enumerateActions(g, 0), { type: 'recruit', city: cap.id, ...drafted({ infantry: 1 }, { draft: true }) }), 'the Draft with Mood stays');
  stock(g, 0, { mood: 2, culture: 0 });
  assert.ok(!has(enumerateActions(g, 0), culture));

  const rome = world(['rome']);
  give(rome, 0, { advances: ['draft'] });
  stock(rome, 0, { mood: 2, culture: 2 });
  assert.ok(!has(enumerateActions(rome, 0), { type: 'recruit', city: capitalOf(rome).id, ...drafted({ infantry: 1 }, { draft: true, draftWith: 'culture' }) }));
});

test('Spartans: attackers cannot play Action cards in rounds where the Spartans have fewer Army units', () => {
  const t = clash({
    civs: ['rome', 'greece'], atk: ['infantry', 'infantry'], def: ['infantry'], dice: [MISS, MISS, MISS], cards: ['timber'], foeCards: ['timber'],
    foeAsk: { combat_card: 'timber' }, prepare: (g) => power(g, 1, 'spartans'),
  });
  assert.equal(asksOf(t.asked, 'combat_card').length, 0, 'the attacker is not even asked');
  assert.deepEqual(me(t.g, 0).hand.action, ['timber'], 'and keeps the card');
  assert.equal(asksOf(t.askedFoe, 'combat_card').length, 1, 'the Spartans may play theirs');
  assert.deepEqual([t.d.card, t.d.mod, t.d.cv, t.a.card ?? null], ['timber', 2, 3, null]);

  const level = clash({
    civs: ['rome', 'greece'], atk: ['infantry'], def: ['infantry'], dice: [MISS, MISS], cards: ['timber'], foeCards: ['timber'], prepare: (g) => power(g, 1, 'spartans'),
  });
  assert.equal(asksOf(level.asked, 'combat_card').length, 1, 'against as many Army units the attacker plays cards');

  const plain = clash({ civs: ['rome', 'greece'], atk: ['infantry', 'infantry'], def: ['infantry'], dice: [MISS, MISS, MISS], cards: ['timber'], foeCards: ['timber'] });
  assert.equal(asksOf(plain.asked, 'combat_card').length, 1, 'without the Advance too');
});

test('Spartans: the numbers are counted again in every round', () => {
  const t = clash({
    civs: ['rome', 'greece'], atk: ['infantry', 'infantry'], def: ['infantry', 'infantry'], dice: [HIT, MISS, MISS, MISS, MISS, MISS, MISS],
    cards: ['timber'], foeCards: ['timber'], ask: { retreat: queue('no', 'yes') }, prepare: (g) => power(g, 1, 'spartans'),
  });
  assert.deepEqual(t.rounds.map((r) => r.d.lost), [1, 0], 'round 1 left the Spartans one unit short');
  assert.deepEqual(asksOf(t.asked, 'combat_card').map((q) => q.info.round), [1], 'so the attacker could play in round 1 only');
  assert.deepEqual(asksOf(t.askedFoe, 'combat_card').map((q) => q.info.round), [1, 2]);
});

test('Spartans: a Spartan attacker gets no such protection', () => {
  const t = clash({
    civs: GREECE, atk: ['infantry'], def: ['infantry', 'infantry'], dice: [MISS, MISS, MISS], cards: ['timber'], foeCards: ['timber'], prepare: (g) => power(g, 0, 'spartans'),
  });
  assert.equal(asksOf(t.askedFoe, 'combat_card').length, 1);
  assert.equal(asksOf(t.asked, 'combat_card').length, 1);
});

// -------------------------------------------------------------------- fireworks
const CHINA = ['china', 'rome'];
/** Player p is Chinese with Fireworks and this much Ore. */
const rockets = (ore, p = 0) => (g) => {
  power(g, p, 'fireworks');
  stock(g, p, { ore });
};

test('Fireworks: 1 Ore before round 1 stops the opponent playing a Combat card', () => {
  const t = clash({
    civs: CHINA, atk: ['infantry'], def: ['infantry'], dice: [MISS, MISS], foeCards: ['timber'], ask: { fireworks: 'yes', retreat: 'yes' }, foeAsk: { combat_card: 'timber' }, prepare: rockets(2),
  });
  assert.equal(asksOf(t.asked, 'fireworks').length, 1);
  assert.equal(me(t.g).res.ore, 1, '1 Ore paid');
  assert.equal(asksOf(t.askedFoe, 'combat_card').length, 0, 'the opponent was not even asked');
  assert.deepEqual([me(t.g, 1).hand.action, t.d.card ?? null, t.d.mod], [['timber'], null, 0], 'and keeps the card');
  assert.ok(logged(t.g, /sets off Fireworks/));
});

test('Fireworks: they are a choice; without them the opponent plays its card', () => {
  const t = clash({
    civs: CHINA, atk: ['infantry'], def: ['infantry'], dice: [MISS, MISS], foeCards: ['timber'], ask: { fireworks: 'no', retreat: 'yes' }, foeAsk: { combat_card: 'timber' }, prepare: rockets(2),
  });
  assert.equal(me(t.g).res.ore, 2);
  assert.deepEqual([t.d.card, t.d.mod], ['timber', 2]);
});

test('Fireworks: nothing is asked without Ore, or when the opponent holds no card to stop', () => {
  const noOre = clash({ civs: CHINA, atk: ['infantry'], def: ['infantry'], dice: [MISS, MISS], foeCards: ['timber'], prepare: rockets(0) });
  assert.equal(asksOf(noOre.asked, 'fireworks').length, 0);
  assert.equal(asksOf(noOre.askedFoe, 'combat_card').length, 1, 'the card is played as ever');
  const noCard = clash({ civs: CHINA, atk: ['infantry'], def: ['infantry'], dice: [MISS, MISS], cards: ['timber'], prepare: rockets(2) });
  assert.equal(asksOf(noCard.asked, 'fireworks').length, 0);
  assert.equal(me(noCard.g).res.ore, 2);
});

test('Fireworks: they stop the card of round 1 only', () => {
  const t = clash({
    civs: CHINA, atk: ['infantry'], def: ['infantry'], dice: [MISS, MISS, MISS, MISS], foeCards: ['timber'], ask: { fireworks: 'yes', retreat: queue('no', 'yes') }, prepare: rockets(2),
  });
  assert.equal(asksOf(t.asked, 'fireworks').length, 1, 'there is no second chance in round 2');
  assert.deepEqual(asksOf(t.askedFoe, 'combat_card').map((q) => q.info.round), [2]);
});

test('Fireworks: a Chinese defender may set them off against the attacker', () => {
  const t = clash({
    civs: ['rome', 'china'], atk: ['infantry'], def: ['infantry'], dice: [MISS, MISS], cards: ['timber'], foeAsk: { fireworks: 'yes' }, prepare: rockets(2, 1),
  });
  assert.equal(asksOf(t.askedFoe, 'fireworks').length, 1);
  assert.equal(me(t.g, 1).res.ore, 1);
  assert.equal(asksOf(t.asked, 'combat_card').length, 0);
  assert.deepEqual(me(t.g, 0).hand.action, ['timber']);
});

// -------------------------------------------------------------------- embalming
const EGYPT = ['egypt', 'rome'];
/** Player p is Egyptian with Embalming and this much Culture. */
const mummies = (culture, p = 0) => (g) => {
  power(g, p, 'embalming');
  stock(g, p, { culture });
};

for (const [held, after] of [[0, 1], [4, 5], [5, 5]]) {
  test(`Embalming: after a battle the Egyptians gain 1 Culture if they hold 4 or fewer (${held} -> ${after})`, () => {
    const t = clash({ civs: EGYPT, atk: ['infantry'], def: ['infantry'], dice: [HIT, MISS], prepare: mummies(held) });
    assert.equal(t.end.winner, 0);
    assert.equal(me(t.g).culture, after);
    assert.equal(logged(t.g, /gains 1 culture \(Embalming\)/), held <= 4);
  });
}

test('Embalming: the loser gains the Culture as well, and a defender does too', () => {
  const lost = clash({ civs: EGYPT, atk: ['infantry'], def: ['infantry'], dice: [MISS, HIT], prepare: mummies(0) });
  assert.equal(lost.end.winner, 1);
  assert.equal(me(lost.g).culture, 1);
  const defended = clash({ civs: ['rome', 'egypt'], atk: ['infantry'], def: ['infantry'], dice: [MISS, HIT], prepare: mummies(0, 1) });
  assert.equal(me(defended.g, 1).culture, 1);
  assert.equal(me(defended.g, 0).culture, 0, 'the other side has no Embalming');
});

test('Embalming: any battle counts: an undefended city taken without a die, a Barbarian attack, a battle at sea', () => {
  const auto = clash({
    civs: EGYPT, atk: ['infantry'], def: [],
    prepare: (g, { hex }) => {
      mummies(0)(g);
      town(g, 1, hex);
    },
  });
  assert.equal(auto.rounds.length, 0, 'no round was fought');
  assert.equal(me(auto.g).culture, 1);

  const g = world(EGYPT);
  mummies(0)(g);
  const [hex] = ring(g, capitalOf(g).hex, 1);
  const [from] = ring(g, hex, 1);
  const [raider] = barbarians(g, 'infantry', from);
  troops(g, 0, 'infantry', hex);
  rigDice(g, MISS, HIT);
  g.drainEvents();
  const r = g._run(battle(g, landBattle(BARBARIAN, 0, hex, from, [raider.id])));
  assert.ok(r.ok, r.error);
  assert.equal(me(g).culture, 1);

  const sea = seaFight({ civs: EGYPT, foe: 1, dice: [HIT, MISS], prepare: mummies(0) });
  assert.equal(sea.end.winner, 0);
  assert.equal(me(sea.g).culture, 1);
});

test('Embalming: the Culture comes with the Advance only', () => {
  const t = clash({ civs: EGYPT, atk: ['infantry'], def: ['infantry'], dice: [HIT, MISS], prepare: (g) => stock(g, 0, { culture: 0 }) });
  assert.equal(me(t.g).culture, 0);
});

// -------------------------------------------------------------------- runestones
const VIKINGS = ['vikings', 'rome'];
const runic = (p = 0) => (g) => power(g, p, 'runestones');

test('Runestones: after a battle in which the Vikings lose 2 Army units, an Obelisk becomes a completed Objective', () => {
  const t = clash({ civs: VIKINGS, atk: ['infantry', 'infantry'], def: ['infantry', 'infantry'], dice: [MISS, MISS, HIT, HIT], prepare: runic() });
  assert.equal(t.a.lost, 2);
  assert.equal(me(t.g).runes, 1);
  assert.equal(buildingsLeft(t.g.s, 0, 'obelisk'), 4, 'the Obelisk is out of the supply');
  assert.deepEqual(ofType(t.events, 'runestone').map((e) => e.player), [0]);
  assert.ok(logged(t.g, /raises a runestone/));
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Runestones: one lost unit is not enough, and the Vikings need the Advance', () => {
  const one = clash({ civs: VIKINGS, atk: ['infantry', 'infantry'], def: ['infantry', 'infantry'], dice: [MISS, MISS, HIT, MISS], prepare: runic() });
  assert.equal(one.a.lost, 1);
  assert.equal(me(one.g).runes, 0);
  assert.equal(ofType(one.events, 'runestone').length, 0);

  const plain = clash({ civs: VIKINGS, atk: ['infantry', 'infantry'], def: ['infantry', 'infantry'], dice: [MISS, MISS, HIT, HIT] });
  assert.equal(plain.a.lost, 2);
  assert.equal(me(plain.g).runes, 0);
});

test('Runestones: a Viking defender raises one too when it loses 2 units and wins', () => {
  const t = clash({
    civs: ['rome', 'vikings'], atk: ['infantry', 'infantry'], def: ['infantry', 'infantry', 'infantry'], dice: [HIT, HIT, HIT, HIT, HIT], prepare: runic(1),
  });
  assert.equal(t.d.lost, 2);
  assert.equal(t.end.winner, 1);
  assert.deepEqual([me(t.g, 1).runes, me(t.g, 0).runes], [1, 0]);
});

test('Runestones: only an unused Obelisk can be taken', () => {
  /** n of the 5 Obelisks stand in cities of player 0. */
  const built = (n) => (g, { cap }) => {
    runic()(g);
    cap.buildings.obelisk = 0;
    for (const k of ring(g, cap.hex, 2).slice(0, n - 1)) town(g, 0, k, 'neutral', ['obelisk']);
  };
  const last = clash({ civs: VIKINGS, atk: ['infantry', 'infantry'], def: ['infantry', 'infantry'], dice: [MISS, MISS, HIT, HIT], prepare: built(4) });
  assert.equal(buildingsLeft(last.g.s, 0, 'obelisk'), 0, 'the fifth Obelisk was the runestone');
  assert.equal(me(last.g).runes, 1);
  assert.deepEqual(checkInvariants(last.g), []);

  const none = clash({ civs: VIKINGS, atk: ['infantry', 'infantry'], def: ['infantry', 'infantry'], dice: [MISS, MISS, HIT, HIT], prepare: built(5) });
  assert.equal(none.a.lost, 2);
  assert.equal(me(none.g).runes, 0, 'all 5 Obelisks are built');

  const raised = clash({
    civs: VIKINGS, atk: ['infantry', 'infantry'], def: ['infantry', 'infantry'], dice: [MISS, MISS, HIT, HIT],
    prepare: (g) => {
      runic()(g);
      me(g).runes = 5;
    },
  });
  assert.equal(me(raised.g).runes, 5, 'and so are 5 runestones');
});

test('Runestones: the runestone is out of the supply, so the Vikings can build one Obelisk fewer', () => {
  const g = world(['vikings']);
  runic()(g);
  give(g, 0, { advances: ['arts'] });
  const cap = capitalOf(g);
  const [first, second, third, last] = ring(g, cap.hex, 2).slice(0, 4).map((k) => town(g, 0, k));
  for (const built of [first, second, third]) built.buildings.obelisk = 0;
  me(g).runes = 1;
  stock(g, 0, { food: 3, wood: 3, ore: 3, mood: 3 });
  const obelisk = (city) => ({ type: 'construct', city: city.id, building: 'obelisk' });
  assert.equal(buildingsLeft(g.s, 0, 'obelisk'), 1, 'of the 5 Obelisks 3 stand and 1 is a runestone');
  assert.ok(has(enumerateActions(g, 0), obelisk(cap)));
  act(g, obelisk(cap));
  assert.equal(buildingsLeft(g.s, 0, 'obelisk'), 0);
  assert.match(refused(g, obelisk(last)), /no pieces/);
  assert.ok(!has(enumerateActions(g, 0), obelisk(last)), 'and no Obelisk is offered any more');
  assert.deepEqual(checkInvariants(g), []);
});

test('Runestones: Ships lost at sea do not count', () => {
  const t = seaFight({ civs: VIKINGS, foe: 1, atk: 2, def: 2, dice: [MISS, MISS, HIT, HIT], prepare: runic() });
  assert.equal(t.a.lost, 2);
  assert.equal(me(t.g).runes, 0);
});

// ---------------------------------------------------------------- slave economy
const ROME = ['rome', 'celts'];
const slaves = (p = 0) => (g) => {
  power(g, p, 'slave_economy');
  stock(g, 0, {});
  stock(g, 1, {});
};
const spoils = (t, p = 0) => [me(t.g, p).res.gold, me(t.g, p).mood];

test('Slave Economy: the winner of a battle gains 1 Gold and 1 Mood', () => {
  const t = clash({ civs: ROME, atk: ['infantry'], def: ['infantry'], dice: [HIT, MISS], prepare: slaves() });
  assert.equal(t.end.winner, 0);
  assert.deepEqual(spoils(t, 0), [1, 1]);
  assert.deepEqual(spoils(t, 1), [0, 0]);
  assert.ok(logged(t.g, /gains 1 gold and 1 mood \(Slave Economy\)/));
});

test('Slave Economy: a Roman defender that wins gains them as well', () => {
  const t = clash({ civs: ['celts', 'rome'], atk: ['infantry'], def: ['infantry'], dice: [MISS, HIT], prepare: slaves(1) });
  assert.equal(t.end.winner, 1);
  assert.deepEqual(spoils(t, 1), [1, 1]);
  assert.deepEqual(spoils(t, 0), [0, 0]);
});

test('Slave Economy: a victory at sea counts too', () => {
  const t = seaFight({ civs: ROME, foe: 1, dice: [HIT, MISS], prepare: slaves() });
  assert.equal(t.end.winner, 0);
  assert.deepEqual(spoils(t, 0), [1, 1]);
});

test('Slave Economy: nothing for the loser, for a retreat, or without the Advance', () => {
  const lost = clash({ civs: ROME, atk: ['infantry'], def: ['infantry'], dice: [MISS, HIT], prepare: slaves() });
  assert.equal(lost.end.winner, 1);
  assert.deepEqual(spoils(lost, 0), [0, 0]);
  const away = clash({ civs: ROME, atk: ['infantry'], def: ['infantry'], dice: [MISS, MISS], prepare: slaves() });
  assert.equal(away.end.retreated, true);
  assert.deepEqual(spoils(away, 0), [0, 0]);
  const plain = clash({ civs: ROME, atk: ['infantry'], def: ['infantry'], dice: [HIT, MISS], prepare: (g) => (stock(g, 0, {}), stock(g, 1, {})) });
  assert.equal(plain.end.winner, 0);
  assert.deepEqual(spoils(plain, 0), [0, 0]);
});

// -------------------------------------------------------------------- provinces
const CONQUEST = ['rome', 'celts'];
/** Rome holds Provinces and this much Culture; a city of player 1 stands undefended on the battle hex. */
const provincial = (culture) => (g, { hex }) => {
  power(g, 0, 'provinces');
  autocracy(g);
  stock(g, 0, { culture });
  town(g, 1, hex);
};
const cityAtBattle = (t) => t.g.s.cities.find((c) => c.hex === t.hex);

test('Provinces: a city Rome captures may be made Neutral, or Happy for 1 Culture', () => {
  for (const [choice, mood, culture] of [['angry', 'angry', 3], ['neutral', 'neutral', 3], ['happy', 'happy', 2]]) {
    const t = clash({ civs: CONQUEST, atk: ['infantry'], ask: { provinces: choice }, prepare: provincial(3) });
    assert.equal(t.rounds.length, 0, 'an undefended city falls without a die');
    assert.deepEqual(optionIds(asksOf(t.asked, 'provinces')[0]), ['angry', 'neutral', 'happy']);
    assert.deepEqual([cityAtBattle(t).owner, cityAtBattle(t).mood, me(t.g).culture], [0, mood, culture], choice);
    assert.ok(logged(t.g, new RegExp(`is ${mood}`, 'i')));
    assert.deepEqual(checkInvariants(t.g), []);
  }
});

test('Provinces: with no Culture to pay, Happy is not on offer', () => {
  const t = clash({ civs: CONQUEST, atk: ['infantry'], ask: { provinces: 'neutral' }, prepare: provincial(0) });
  assert.deepEqual(optionIds(asksOf(t.asked, 'provinces')[0]), ['angry', 'neutral']);
  assert.equal(cityAtBattle(t).mood, 'neutral');
});

test('Provinces: a city taken after a battle may be calmed too', () => {
  const t = clash({ civs: CONQUEST, atk: ['infantry'], def: ['infantry'], dice: [HIT, MISS], ask: { provinces: 'happy' }, prepare: provincial(3) });
  assert.equal(t.rounds.length, 1);
  assert.equal(t.end.captured, true);
  assert.deepEqual([cityAtBattle(t).owner, cityAtBattle(t).mood, me(t.g).culture], [0, 'happy', 2]);
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Provinces: without the Advance the captured city is Angry and nothing is asked', () => {
  const t = clash({
    civs: CONQUEST, atk: ['infantry'], prepare: (g, { hex }) => {
      stock(g, 0, { culture: 3 });
      town(g, 1, hex);
    },
  });
  assert.equal(asksOf(t.asked, 'provinces').length, 0);
  assert.deepEqual([cityAtBattle(t).owner, cityAtBattle(t).mood, me(t.g).culture], [0, 'angry', 3]);
});

// ------------------------------------------------------------------ mercenaries
const FOOT = { infantry: 1 };
const SHIPYARD = { ship: 1 };

test('Mercenaries: the Draft may be paid in Gold instead of Mood', () => {
  const g = world(['carthage']);
  power(g, 0, 'mercenaries');
  const cap = capitalOf(g);
  const [village, outpost] = ring(g, cap.hex, 2).slice(0, 2).map((k) => town(g, 0, k));
  stock(g, 0, { gold: 2, mood: 1 });
  act(g, draftOf(cap, { draftWith: 'gold' }));
  assert.deepEqual([me(g).res.gold, me(g).mood], [1, 1], '1 Gold, no Mood');
  assert.deepEqual(kinds(g, cap.hex), ['infantry']);
  act(g, draftOf(village));
  assert.deepEqual([me(g).res.gold, me(g).mood], [1, 0], 'Mood still pays when Gold is not asked for');
  assert.deepEqual(kinds(g, village.hex), ['infantry']);
  assert.match(refused(g, draftOf(outpost)), /afford/, 'with no Mood left only the Gold pays');
  act(g, draftOf(outpost, { draftWith: 'gold' }));
  assert.deepEqual([me(g).res.gold, me(g).mood], [0, 0]);
  assert.deepEqual(checkInvariants(g), []);
});

for (const [people, id, with_, held] of [['carthage', 'mercenaries', 'gold', { gold: 3 }], ['greece', 'spartans', 'culture', { culture: 3 }]]) {
  test(`${id}: Civil Liberties doubles the price of the Draft, in ${with_} too`, () => {
    const g = world([people]);
    power(g, 0, id);
    give(g, 0, { advances: ['civil_liberties'] });
    stock(g, 0, { mood: 3, ...held });
    act(g, draftOf(capitalOf(g), { draftWith: with_ }));
    const left = { gold: me(g).res.gold, culture: me(g).culture };
    assert.deepEqual([left[with_], me(g).mood], [1, 3], 'the Draft cost 2');
  });
}

test('Mercenaries: a city with a Port may Draft a Ship, for Gold or for Mood', () => {
  const g = world(['carthage']);
  power(g, 0, 'mercenaries');
  const cap = capitalOf(g);
  const sea = harbour(g, cap);
  stock(g, 0, { gold: 2, mood: 1 });
  act(g, { type: 'recruit', city: cap.id, units: SHIPYARD, draftShip: true, draftWith: 'gold' });
  assert.deepEqual([me(g).res.gold, me(g).mood, me(g).res.wood], [1, 1, 0], '1 Gold: the Draft takes the place of the 2 Wood');
  assert.deepEqual(unitsAt(g.s, sea).map((u) => [u.owner, u.type]), [[0, 'ship']]);

  const mood = world(['carthage']);
  power(mood, 0, 'mercenaries');
  const port = capitalOf(mood);
  const water = harbour(mood, port);
  stock(mood, 0, { gold: 2, mood: 1 });
  act(mood, { type: 'recruit', city: port.id, units: SHIPYARD, draftShip: true });
  assert.deepEqual([me(mood).res.gold, me(mood).mood], [2, 0]);
  assert.deepEqual(unitsAt(mood.s, water).map((u) => u.type), ['ship']);
  assert.deepEqual(checkInvariants(mood), []);
});

test('Mercenaries: nobody else drafts with Gold or Drafts a Ship, and a Ship needs a Port', () => {
  const rome = world(['rome']);
  give(rome, 0, { advances: ['draft'] });
  const harbourCity = capitalOf(rome);
  harbour(rome, harbourCity);
  stock(rome, 0, { gold: 2, mood: 2 });
  assert.match(refused(rome, draftOf(harbourCity, { draftWith: 'gold' })), /Mercenaries/);
  assert.match(refused(rome, { type: 'recruit', city: harbourCity.id, units: SHIPYARD, draftShip: true }), /Mercenaries/);

  const g = world(['carthage']);
  power(g, 0, 'mercenaries');
  const inland = capitalOf(g);
  stock(g, 0, { gold: 2, mood: 2 });
  assert.match(refused(g, { type: 'recruit', city: inland.id, units: SHIPYARD, draftShip: true, draftWith: 'gold' }), /Port/);
});

test('Mercenaries: the Draft with Gold, and the Ship Draft, are among the candidate actions', () => {
  const g = world(['carthage']);
  power(g, 0, 'mercenaries');
  const cap = capitalOf(g);
  harbour(g, cap);
  stock(g, 0, { gold: 2, mood: 1 });
  const list = enumerateActions(g, 0);
  const at = (units, extra) => ({ type: 'recruit', city: cap.id, ...drafted(units, extra) });
  assert.ok(has(list, at(FOOT, { draft: true, draftWith: 'gold' })));
  assert.ok(has(list, at(FOOT, { draft: true })), 'the Draft with Mood stays');
  assert.ok(has(list, at(SHIPYARD, { draftShip: true, draftWith: 'gold' })));
  assert.ok(has(list, at(SHIPYARD, { draftShip: true })));
  stock(g, 0, { gold: 0, mood: 1 });
  assert.ok(!has(enumerateActions(g, 0), at(FOOT, { draft: true, draftWith: 'gold' })), 'no Gold, no such Draft');

  const rome = world(['rome']);
  give(rome, 0, { advances: ['draft'] });
  const city = capitalOf(rome);
  harbour(rome, city);
  stock(rome, 0, { gold: 2, mood: 1 });
  const others = enumerateActions(rome, 0).map((c) => c.action).filter((a) => a.type === 'recruit');
  assert.ok(others.some((a) => a.draft), 'Rome may Draft Infantry');
  assert.ok(others.every((a) => !a.draftShip && a.draftWith === undefined));
});

// -------------------------------------------------------------------- longships
/** Player 0 is a Viking with Longships (or with Warships only); `o` and the spaces west and east of it are Sea. */
function fjord(longships) {
  const g = world(['vikings', 'rome'], { opponents: 2 });
  const { o, at } = bay(g);
  for (const k of [o, at(W), at(E)]) setTerrain(g, k, 'sea');
  if (longships) power(g, 0, 'longships');
  else give(g, 0, { advances: ['warships'] });
  hold(g, 0);
  return { g, o, west: at(W), east: at(E) };
}
const sails = (ship, to) => ({ type: 'move', units: [ship.id], to });

test('Longships: a Ship carries 3 Land units instead of 2', () => {
  const harbourOf = (longships) => {
    const g = world(['vikings']);
    if (longships) power(g, 0, 'longships');
    else give(g, 0, { advances: ['warships'] });
    give(g, 0, { advances: ['tactics'] });
    const cap = capitalOf(g);
    const sea = harbour(g, cap);
    const [ship] = troops(g, 0, 'ship', sea);
    const foot = troops(g, 0, 'infantry', cap.hex, 3).map((u) => u.id);
    return { g, cap, sea, ship, foot };
  };
  const boards = (t, units) => ({ type: 'move', units, to: t.sea });

  const plain = harbourOf(false);
  assert.equal(shipCap(plain.g.s, 0), SHIP_CAPACITY);
  assert.ok(has(enumerateActions(plain.g, 0), boards(plain, plain.foot.slice(0, 2))));
  assert.ok(!has(enumerateActions(plain.g, 0), boards(plain, plain.foot)), 'three do not fit');
  assert.match(refused(plain.g, boards(plain, plain.foot)), /not enough room/);

  const t = harbourOf(true);
  assert.equal(shipCap(t.g.s, 0), SHIP_CAPACITY + 1);
  assert.ok(has(enumerateActions(t.g, 0), boards(t, t.foot)));
  act(t.g, boards(t, t.foot));
  assert.deepEqual(kinds(t.g, t.sea, 0), ['infantry', 'infantry', 'infantry']);
  const [next] = ring(t.g, t.sea, 1);
  setTerrain(t.g, next, 'sea');
  act(t.g, sails(t.ship, next));
  assert.deepEqual(kinds(t.g, next, 0), ['infantry', 'infantry', 'infantry'], 'the Ship sailed with all 3 aboard');
  assert.deepEqual(unitsAt(t.g.s, next).filter((u) => u.type === 'ship').map((u) => u.id), [t.ship.id]);
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Longships: a Ship that has fought may sail on after the battle', () => {
  const raid = (longships) => {
    const t = fjord(longships);
    const [ship] = troops(t.g, 0, 'ship', t.west);
    pirates(t.g, t.o);
    listen(t.g, 0, { retreat: 'no' });
    rigDice(t.g, HIT, MISS);
    act(t.g, sails(ship, t.o));
    return { ...t, ship };
  };

  const t = raid(true);
  assert.equal(unitsAt(t.g.s, t.o).some((u) => u.owner === PIRATE), false, 'the Pirate Ship went down');
  assert.equal(t.ship.hex, t.o);
  assert.ok(has(enumerateActions(t.g, 0), sails(t.ship, t.east)), 'the move is among the candidates');
  act(t.g, sails(t.ship, t.east));
  assert.equal(t.ship.hex, t.east);
  assert.deepEqual(checkInvariants(t.g), []);

  const plain = raid(false);
  assert.equal(plain.ship.hex, plain.o);
  assert.ok(!has(enumerateActions(plain.g, 0), sails(plain.ship, plain.east)), 'it cannot without Longships');
  assert.match(refused(plain.g, sails(plain.ship, plain.east)), /fought cannot move again/);
});

test('Longships: the Ship may sail into a second battle', () => {
  const t = fjord(true);
  const [ship] = troops(t.g, 0, 'ship', t.west);
  pirates(t.g, t.o, t.east);
  listen(t.g, 0, { retreat: 'no' });
  rigDice(t.g, HIT, MISS, HIT, MISS);
  t.g.drainEvents();
  act(t.g, sails(ship, t.o));
  act(t.g, sails(ship, t.east));
  const fights = ofType(t.g.drainEvents(), 'battle_end');
  assert.deepEqual(fights.map((e) => [e.hex, e.winner]), [[t.o, 0], [t.east, 0]]);
  assert.equal(ship.hex, t.east);
  assert.deepEqual(unitsAt(t.g.s, t.east).map((u) => u.owner), [0]);
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Longships: when a battle sinks one of two Ships, the other keeps its 3 passengers', () => {
  const crossing = (longships) => {
    const t = fjord(longships);
    const fleet = troops(t.g, 0, 'ship', t.west, 2);
    const crew = troops(t.g, 0, 'infantry', t.west, 3).map((u) => u.id);
    pirates(t.g, t.o, t.o);
    listen(t.g, 0, { retreat: 'no' });
    rigDice(t.g, HIT, MISS, HIT, HIT, HIT, MISS);
    act(t.g, { type: 'move', units: fleet.map((u) => u.id), to: t.o });
    return { ...t, afloat: unitsAt(t.g.s, t.o).filter((u) => crew.includes(u.id)) };
  };

  const t = crossing(true);
  assert.equal(unitsAt(t.g.s, t.o).filter((u) => u.type === 'ship').length, 1, 'one Ship went down in round 1, and the Pirates in round 2');
  assert.equal(unitsAt(t.g.s, t.o).some((u) => u.owner === PIRATE), false);
  assert.equal(t.afloat.length, 3, 'and all 3 are still aboard the other');
  assert.ok(!logged(t.g, /no longer fit/));
  assert.deepEqual(checkInvariants(t.g), []);

  const plain = crossing(false);
  assert.equal(plain.afloat.length, 2, 'a Ship carries 2');
  assert.ok(logged(plain.g, /no longer fit/));
});
