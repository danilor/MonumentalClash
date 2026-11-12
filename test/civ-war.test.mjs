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

// @@MORE@@
