// Influence Culture and what rests on it in the Civilizations module: Code of Laws, Druidic Influence, Proselytism, Hellenization and
// Zoroastrianism; the trade-route powers, Raiders, City Independence, the Obelisk and the Observatory, Man God and City States.
// Every test pins a rule of the rulebook (Civilizations pages), source/civ.md or the text of the Advance; dice are fixed with rigRolls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BARBARIAN, COMBAT_DIE } from '../src/engine/data/constants.js';
import { captureCity } from '../src/engine/combat.js';
import { influenceRange, influenceTypes, isInfluenced, settlerOrigin } from '../src/engine/city.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { cityAt, citySize, hasAdv, hexDistance, isSea, nbrs, unitById, unitsLeft } from '../src/engine/queries.js';
import { randInt, roll } from '../src/engine/rng.js';
import { scoreOf } from '../src/engine/scoring.js';
import { tradePhase, tradeRoutes } from '../src/engine/trade.js';
import { checkInvariants } from './harness.mjs';
import { act, capitalOf, fresh, give, hold, refused, rigRolls, settlerOf } from './scenario.mjs';
import { E, W, asking, barbarians, bay, free, harbour, logged, me, ofType, optionIds, power, ring, run, setTerrain, stock, town, troops, world } from './civs.mjs';

const influence = (extra) => ({ type: 'influence', ...extra });
/** The Influence Culture actions the enumerator offers player p. */
const offers = (g, p = 0) => enumerateActions(g, p).filter((c) => c.cat === 'influence').map((c) => c.action);
/** An action with these fields (a field given as undefined must be absent). */
const shaped = (want) => (a) => Object.entries(want).every(([k, v]) => a[k] === v);
/** The first free space `d` steps from a hex. */
const spot = (g, hex, d = 1) => ring(g, hex, d)[0];
/** The current copy of a city or unit: a refused action restores the game from a snapshot, which leaves earlier references stale. */
const cityNow = (g, city) => g.s.cities.find((c) => c.id === city.id);
const unitNow = (g, unit) => unitById(g.s, unit.id);

// ================================================================== Code of Laws
/** Babylonians next to an enemy Temple that a roll of 5 flips. */
function lawgiver(has = true) {
  const g = world(['babylonia', 'egypt']);
  if (has) power(g, 0, 'code_of_laws');
  const cap = capitalOf(g);
  const foe = town(g, 1, spot(g, cap.hex), 'neutral', ['temple']);
  stock(g, 0, {});
  return { g, cap, foe };
}

test('Code of Laws: a successful Influence Culture draws an Action card while the player holds 4 or fewer', () => {
  const { g, cap, foe } = lawgiver();
  hold(g, 0, 'mass_collect', 'labor', 'supply', 'windfall');
  const pile = g.s.decks.action.length;
  rigRolls(g, 5);
  act(g, influence({ city: cap.id, target: foe.id }));
  assert.equal(foe.buildings.temple, 0, 'the attempt succeeded');
  assert.equal(me(g).hand.action.length, 5);
  assert.equal(g.s.decks.action.length, pile - 1, 'the card comes from the draw pile');
  assert.ok(logged(g, /Action card \(Code of Laws\)/));
});

test('Code of Laws: a failed attempt draws nothing, and neither does a success while holding 5 Action cards', () => {
  const failed = lawgiver();
  hold(failed.g, 0, 'mass_collect', 'labor', 'supply', 'windfall');
  rigRolls(failed.g, 4);
  act(failed.g, influence({ city: failed.cap.id, target: failed.foe.id }));
  assert.equal(failed.foe.buildings.temple, 1, 'the Temple is still theirs');
  assert.equal(me(failed.g).hand.action.length, 4);

  const full = lawgiver();
  hold(full.g, 0, 'mass_collect', 'labor', 'supply', 'windfall', 'bureaucracy');
  rigRolls(full.g, 6);
  act(full.g, influence({ city: full.cap.id, target: full.foe.id }));
  assert.equal(full.foe.buildings.temple, 0);
  assert.equal(me(full.g).hand.action.length, 5, 'five cards is one too many');
  assert.ok(!logged(full.g, /Code of Laws/));
});

test('Code of Laws belongs to the Babylonians who hold it: others draw nothing, and the free Influence of Arts draws like any other', () => {
  const plain = lawgiver(false);
  hold(plain.g, 0);
  rigRolls(plain.g, 5);
  act(plain.g, influence({ city: plain.cap.id, target: plain.foe.id }));
  assert.equal(plain.foe.buildings.temple, 0);
  assert.equal(me(plain.g).hand.action.length, 0);

  const arts = lawgiver();
  give(arts.g, 0, { advances: ['arts'], culture: 1 });
  hold(arts.g, 0);
  rigRolls(arts.g, 5);
  act(arts.g, influence({ free: true, city: arts.cap.id, target: arts.foe.id }));
  assert.equal(arts.foe.buildings.temple, 0);
  assert.equal(me(arts.g).culture, 0, 'Arts cost 1 Culture');
  assert.equal(arts.g.s.turn.actionsLeft, 3, 'and no action');
  assert.equal(me(arts.g).hand.action.length, 1);
});

// ============================================================= Druidic Influence
/** Celts next to a Barbarian city holding these Buildings. */
function druid(buildings = [], has = true) {
  const g = world(['celts', 'egypt']);
  if (has) power(g, 0, 'druidic_influence');
  const cap = capitalOf(g);
  const camp = town(g, BARBARIAN, spot(g, cap.hex), 'neutral', buildings);
  stock(g, 0, {});
  return { g, cap, camp };
}

test('Druidic Influence: a success on a Barbarian city leaves a Culture token under it worth 1 VP; the city stays Barbarian', () => {
  const { g, cap, camp } = druid();
  const before = scoreOf(g.s, 0).total;
  rigRolls(g, 5);
  act(g, influence({ city: cap.id, target: camp.id }));
  assert.equal(camp.druid, 0, 'the token of the first player');
  assert.equal(camp.owner, BARBARIAN);
  assert.deepEqual(camp.buildings, {});
  assert.equal(scoreOf(g.s, 0).parts.civ, 1);
  assert.equal(scoreOf(g.s, 0).total, before + 1);
  assert.equal(scoreOf(g.s, 1).parts.civ, 0, 'nobody else scores it');
  assert.deepEqual(influenceTypes(g.s, 0, camp), [], 'a Settlement has at most one token');
  assert.deepEqual(checkInvariants(g), []);
});

test('Druidic Influence: it takes the power, and a failed attempt leaves no token', () => {
  const plain = druid([], false);
  assert.match(refused(plain.g, influence({ city: plain.cap.id, target: plain.camp.id })), /no Building you can influence/);

  const { g, cap, camp } = druid();
  rigRolls(g, 4);
  act(g, influence({ city: cap.id, target: camp.id }));
  assert.equal(camp.druid, undefined);
  assert.equal(scoreOf(g.s, 0).parts.civ, 0);
});

test('Druidic Influence: against a Barbarian city with a Building the Celts choose the token or the Building', () => {
  const token = druid(['temple']);
  assert.deepEqual(influenceTypes(token.g.s, 0, token.camp), ['temple', 'druid']);
  rigRolls(token.g, 5);
  act(token.g, influence({ city: token.cap.id, target: token.camp.id, building: 'druid' }));
  assert.equal(token.camp.druid, 0);
  assert.equal(token.camp.buildings.temple, BARBARIAN, 'the Temple is untouched');
  assert.deepEqual(influenceTypes(token.g.s, 0, token.camp), ['temple'], 'one token per city');

  const temple = druid(['temple']);
  rigRolls(temple.g, 5);
  act(temple.g, influence({ city: temple.cap.id, target: temple.camp.id, building: 'temple' }));
  assert.equal(temple.camp.buildings.temple, 0, 'the Temple is in the Celtic colour');
  assert.equal(temple.camp.druid, undefined, 'and no token is placed');
  assert.equal(scoreOf(temple.g.s, 0).parts.civ, 0);
});

test('Druidic Influence: the token is removed when any player captures the city, the Celts included', () => {
  const mine = druid();
  power(mine.g, 0, 'tribal_warfare');
  rigRolls(mine.g, 5);
  act(mine.g, influence({ city: mine.cap.id, target: mine.camp.id }));
  const [soldier] = troops(mine.g, 0, 'infantry', mine.cap.hex);
  act(mine.g, { type: 'move', units: [soldier.id], to: mine.camp.hex });
  assert.equal(mine.camp.owner, 0, 'the Celts took the empty city');
  assert.equal(mine.camp.druid, undefined);
  assert.equal(scoreOf(mine.g.s, 0).parts.civ, 0);
  assert.deepEqual(checkInvariants(mine.g), []);

  const other = druid();
  rigRolls(other.g, 5);
  act(other.g, influence({ city: other.cap.id, target: other.camp.id }));
  run(other.g, captureCity(other.g, other.camp, 1));
  assert.equal(other.camp.owner, 1);
  assert.equal(other.camp.druid, undefined);
  assert.equal(scoreOf(other.g.s, 0).parts.civ, 0);
});

test('Druidic Influence: the enumerator offers the token against Barbarian cities, with or without Buildings, only to the Celts', () => {
  const bare = druid();
  assert.ok(offers(bare.g).some(shaped({ city: bare.cap.id, target: bare.camp.id, building: 'druid' })));

  const built = druid(['temple']);
  const found = offers(built.g);
  assert.ok(found.some(shaped({ city: built.cap.id, target: built.camp.id, building: 'druid' })));
  assert.ok(found.some(shaped({ city: built.cap.id, target: built.camp.id, building: 'temple' })));

  const plain = druid(['temple'], false);
  assert.ok(!offers(plain.g).some(shaped({ building: 'druid' })));
  assert.ok(offers(plain.g).some(shaped({ target: plain.camp.id, building: 'temple' })), 'the Temple itself is open to anyone');
  assert.deepEqual(offers(druid([], false).g), [], 'a bare Barbarian city is no target without the power');
});

// ================================================================== Proselytism
/** Indians with `n` Settlers in the open, 3 spaces from home; `near` and `far` are enemy Temples 2 and 3 spaces from them. */
function missionary(n, has = true) {
  const g = world(['india', 'egypt']);
  if (has) power(g, 0, 'proselytism');
  const cap = capitalOf(g);
  const camp = spot(g, cap.hex, 3);
  const first = settlerOf(g);
  first.hex = camp;
  const settlers = [first, ...troops(g, 0, 'settler', camp, n - 1)];
  const near = town(g, 1, spot(g, camp, 2), 'neutral', ['temple']);
  const far = town(g, 1, spot(g, camp, 3), 'neutral', ['temple']);
  stock(g, 0, {});
  return { g, cap, camp, settlers, near, far };
}

test('Proselytism: Settlers Influence Culture at range 2, and each other Settler in their space adds 1 to the range', () => {
  const lone = missionary(1);
  assert.equal(influenceRange(lone.g.s, 0, settlerOrigin(lone.g.s, 0, lone.camp)), 2);
  assert.match(refused(lone.g, influence({ unit: lone.settlers[0].id, target: lone.far.id })), /out of range/);
  rigRolls(lone.g, 5);
  act(lone.g, influence({ unit: lone.settlers[0].id, target: lone.near.id }));
  assert.equal(cityNow(lone.g, lone.near).buildings.temple, 0);
  assert.equal(unitNow(lone.g, lone.settlers[0]).hex, lone.camp, 'the Settler stays where it is');

  const pair = missionary(2);
  assert.equal(influenceRange(pair.g.s, 0, settlerOrigin(pair.g.s, 0, pair.camp)), 3);
  rigRolls(pair.g, 5);
  act(pair.g, influence({ unit: pair.settlers[1].id, target: pair.far.id }));
  assert.equal(pair.far.buildings.temple, 0, 'two Settlers reach 3 spaces');

  const trio = missionary(3);
  assert.equal(influenceRange(trio.g.s, 0, settlerOrigin(trio.g.s, 0, trio.camp)), 4, 'rulebook: 3 Settlers in a space have range 4');
});

test('Proselytism: only one success per turn, whether it started from Settlers or from a city', () => {
  const { g, cap, settlers, near } = missionary(1);
  cap.buildings.temple = 0;
  const other = town(g, 1, spot(g, cap.hex), 'neutral', ['academy']);
  rigRolls(g, 6);
  act(g, influence({ unit: settlers[0].id, target: near.id }));
  assert.equal(refused(g, influence({ city: cap.id, target: other.id })), 'Only one Influence Culture success is possible per turn.');
});

test('Proselytism: Settlers in a city add their number to its range; a size 2 city with 3 Settlers reaches 5 spaces', () => {
  const build = (extraSettlers, has = true) => {
    const g = world(['india', 'egypt']);
    if (has) power(g, 0, 'proselytism');
    const cap = capitalOf(g);
    const home = capitalOf(g, 1);
    cap.buildings.temple = 0;
    home.buildings.academy = 1;
    troops(g, 0, 'settler', cap.hex, extraSettlers);
    stock(g, 0, {});
    return { g, cap, home };
  };
  assert.equal(hexDistance(build(0).cap.hex, build(0).home.hex), 5);

  const three = build(2);
  assert.equal(influenceRange(three.g.s, 0, three.cap), 5);
  rigRolls(three.g, 5);
  act(three.g, influence({ city: three.cap.id, target: three.home.id }));
  assert.equal(three.home.buildings.academy, 0);

  const one = build(0);
  assert.equal(influenceRange(one.g.s, 0, one.cap), 3, 'the Settler that starts in the capital adds 1');
  assert.match(refused(one.g, influence({ city: one.cap.id, target: one.home.id })), /out of range/);

  const without = build(2, false);
  assert.equal(influenceRange(without.g.s, 0, without.cap), 2, 'Settlers add nothing without the power');
});

test('Proselytism: Settlers can only Influence enemy cities, and only with the power', () => {
  const { g, camp, settlers } = missionary(1);
  const mine = town(g, 0, spot(g, camp), 'neutral');
  mine.buildings.temple = 1;
  assert.equal(refused(g, influence({ unit: settlers[0].id, target: mine.id })), 'Settlers can only influence enemy cities.');

  const plain = missionary(1, false);
  assert.match(refused(plain.g, influence({ unit: plain.settlers[0].id, target: plain.near.id })), /Proselytism/);
});

test('Proselytism: the enumerator offers the Settlers\' attempts as far as their number reaches', () => {
  const lone = missionary(1);
  const alone = offers(lone.g).filter((a) => a.unit !== undefined);
  assert.ok(alone.some(shaped({ unit: lone.settlers[0].id, target: lone.near.id, building: 'temple' })));
  assert.ok(!alone.some((a) => a.target === lone.far.id), 'the other Temple is 3 spaces away');

  const pair = missionary(2);
  const reach = offers(pair.g).find((a) => a.unit !== undefined && a.target === pair.far.id && !a.free && a.rangeBoost === undefined);
  assert.ok(reach, 'two Settlers reach it');
  rigRolls(pair.g, 5);
  act(pair.g, reach);
  assert.equal(cityNow(pair.g, pair.far).buildings.temple, 0, 'and the candidate is a legal action');

  const plain = missionary(1, false);
  assert.ok(!offers(plain.g).some((a) => a.unit !== undefined), 'no Settler attempts without the power');
});

// ================================================================= Hellenization
/** Greeks, and the capital of the enemy holding a Greek Temple (size 3): `near` is 3 spaces from it, `beyond` 4. */
function greek({ has = true, mood = 0, culture = 0 } = {}) {
  const g = world(['greece', 'egypt']);
  if (has) power(g, 0, 'hellenization');
  const cap = capitalOf(g);
  const host = capitalOf(g, 1);
  host.buildings.temple = 0;
  host.buildings.market = 1;
  const near = town(g, 1, spot(g, host.hex, 3), 'neutral', ['academy']);
  const beyond = town(g, 1, spot(g, host.hex, 4), 'neutral', ['academy']);
  const foe = town(g, 1, spot(g, cap.hex), 'neutral', ['temple']);
  stock(g, 0, { mood, culture });
  return { g, cap, host, near, beyond, foe };
}

test('Hellenization: attempts may start from a city holding one of your Buildings, with a range equal to its size', () => {
  const { g, host, near, beyond } = greek();
  assert.equal(citySize(host), 3, 'one influenced Building in a size 3 city');
  assert.match(refused(g, influence({ city: host.id, target: beyond.id })), /out of range/);
  rigRolls(g, 5);
  act(g, influence({ city: host.id, target: near.id }));
  assert.equal(cityNow(g, near).buildings.academy, 0);
  assert.equal(cityNow(g, host).owner, 1, 'the host city stays the enemy\'s');
  assert.deepEqual(checkInvariants(g), []);
});

test('Hellenization: a city without a Building of yours cannot start an attempt, and neither can anyone without the power', () => {
  const noBuilding = greek();
  noBuilding.host.buildings.temple = 1;
  assert.equal(refused(noBuilding.g, influence({ city: noBuilding.host.id, target: noBuilding.near.id })), 'Choose one of your cities.');

  const noPower = greek({ has: false });
  assert.equal(refused(noPower.g, influence({ city: noPower.host.id, target: noPower.near.id })), 'Choose one of your cities.');
});

test('Hellenization: Arts may be paid with 2 Mood instead of 1 Culture, costs no action and is still once per turn', () => {
  const { g, cap, foe } = greek({ mood: 3, culture: 1 });
  rigRolls(g, 4);
  act(g, influence({ free: true, artsMood: true, city: cap.id, target: foe.id }));
  assert.equal(me(g).mood, 1, '2 Mood paid');
  assert.equal(me(g).culture, 1, 'and no Culture');
  assert.equal(g.s.turn.actionsLeft, 3);
  assert.equal(cityNow(g, foe).buildings.temple, 1, 'the attempt failed');
  assert.equal(refused(g, influence({ free: true, artsMood: true, city: cap.id, target: foe.id })), 'Arts can be used once per turn.');
  assert.equal(refused(g, influence({ free: true, city: cap.id, target: foe.id })), 'Arts can be used once per turn.');

  rigRolls(g, 5);
  act(g, influence({ city: cap.id, target: foe.id }));
  assert.equal(cityNow(g, foe).buildings.temple, 0, 'an ordinary action still works');
  assert.equal(g.s.turn.actionsLeft, 2);
});

test('Hellenization: Arts still cost 1 Culture the old way, and 2 Mood are needed for the new way', () => {
  const culture = greek({ culture: 1 });
  rigRolls(culture.g, 5);
  act(culture.g, influence({ free: true, city: culture.cap.id, target: culture.foe.id }));
  assert.equal(me(culture.g).culture, 0);
  assert.equal(culture.foe.buildings.temple, 0);

  const poor = greek({ mood: 1 });
  assert.equal(refused(poor.g, influence({ free: true, artsMood: true, city: poor.cap.id, target: poor.foe.id })), 'You need 2 Mood tokens.');

  const plain = greek({ has: false, mood: 3 });
  give(plain.g, 0, { advances: ['arts'] });
  assert.match(refused(plain.g, influence({ free: true, artsMood: true, city: plain.cap.id, target: plain.foe.id })), /Only Hellenization/);
});

test('Hellenization: the enumerator offers attempts from the host city, and Arts for Mood only with 2 Mood and the power', () => {
  const rich = greek({ mood: 2 });
  const found = offers(rich.g);
  assert.ok(found.some(shaped({ city: rich.host.id, target: rich.near.id, building: 'academy', free: undefined })));
  assert.ok(found.some(shaped({ city: rich.cap.id, target: rich.foe.id, building: 'temple', free: true, artsMood: true })));
  assert.ok(found.some(shaped({ city: rich.host.id, target: rich.near.id, free: true, artsMood: true })));

  assert.ok(!offers(greek({ mood: 1 }).g).some((a) => a.artsMood), 'one Mood is not enough');
  const plain = greek({ has: false, mood: 3 });
  assert.ok(!offers(plain.g).some((a) => a.artsMood || a.city === plain.host.id), 'no power, no Mood payment and no host city');
});

// ================================================================ Zoroastrianism
/** Persians with Zoroastrianism; `a` to `d` are free spaces next to their capital. */
function persian() {
  const g = world(['persia', 'egypt']);
  power(g, 0, 'zoroastrianism');
  const cap = capitalOf(g);
  const [a, b, c, d] = ring(g, cap.hex, 1);
  stock(g, 0, {});
  return { g, cap, a, b, c, d };
}

/** The next d6 shows `face`, and the Combat dice after it the given `[value, icon]` faces: an Influence Culture roll followed by a battle. */
function rigInfluenceThenBattle(g, face, ...dice) {
  const slots = dice.map(([v, icon]) => COMBAT_DIE.flatMap(([value, i], k) => (value === v && i === icon ? [k] : [])));
  for (let seed = 1; seed < 5_000_000; seed++) {
    const st = { rng: seed };
    if (roll(st, 6) === face && slots.every((sl) => sl.includes(randInt(st, COMBAT_DIE.length)))) {
      g.s.rng = seed;
      return;
    }
  }
  assert.fail('no random state gives these rolls');
}

test('Zoroastrianism: a successful Influence Culture turns an enemy Army unit outside cities into one of yours', () => {
  const { g, cap, a, b } = persian();
  const [foe] = troops(g, 1, 'infantry', a);
  rigRolls(g, 5);
  act(g, influence({ city: cap.id, targetUnit: foe.id }));
  assert.deepEqual([foe.owner, foe.type, foe.hex], [0, 'infantry', a], 'the same unit, in the same space, in the Persian colour');
  assert.equal(g.s.turn.actionsLeft, 2, 'an ordinary Influence Culture action');
  assert.ok(logged(g, /Zoroastrianism/));
  const [horse] = troops(g, 1, 'cavalry', b);
  assert.equal(refused(g, influence({ city: cap.id, targetUnit: horse.id })), 'Only one Influence Culture success is possible per turn.');
  assert.deepEqual(checkInvariants(g), []);
});

test('Zoroastrianism: a failed attempt leaves the unit where it is, and a further attempt may follow', () => {
  const { g, cap, a } = persian();
  const [foe] = troops(g, 1, 'infantry', a);
  rigRolls(g, 3);
  act(g, influence({ city: cap.id, targetUnit: foe.id }));
  assert.equal(foe.owner, 1);
  assert.equal(g.s.turn.actionsLeft, 2, 'the action is spent all the same');
  rigRolls(g, 6);
  act(g, influence({ city: cap.id, targetUnit: foe.id }));
  assert.equal(foe.owner, 0);
});

test('Zoroastrianism: Barbarian Army units can be turned as well', () => {
  const { g, cap, a } = persian();
  const [raider] = barbarians(g, 'cavalry', a);
  rigRolls(g, 5);
  act(g, influence({ city: cap.id, targetUnit: raider.id }));
  assert.deepEqual([raider.owner, raider.type], [0, 'cavalry']);
  assert.deepEqual(checkInvariants(g), []);
});

test('Zoroastrianism: Settlers, units in cities, units at sea and own units cannot be targeted', () => {
  const { g, cap, a, b, c, d } = persian();
  const cannot = (unit) => refused(g, influence({ city: cap.id, targetUnit: unit.id }));
  const [settler] = troops(g, 1, 'settler', a);
  assert.equal(cannot(settler), 'That unit cannot be influenced.');
  const [own] = troops(g, 0, 'infantry', b);
  assert.equal(cannot(own), 'That unit cannot be influenced.');
  town(g, 1, c);
  const [guard] = troops(g, 1, 'infantry', c);
  assert.equal(cannot(guard), 'That unit cannot be influenced.', 'inside a city');
  setTerrain(g, d, 'sea');
  troops(g, 1, 'ship', d);
  const [passenger] = troops(g, 1, 'infantry', d);
  assert.equal(cannot(passenger), 'That unit cannot be influenced.', 'on a Ship at sea');
});

test('Zoroastrianism: the unit must be of a type the Persians still have in their supply', () => {
  const full = persian();
  troops(full.g, 0, 'cavalry', full.cap.hex, 4);
  const [horse] = troops(full.g, 1, 'cavalry', full.a);
  assert.equal(unitsLeft(full.g.s, 0, 'cavalry'), 0);
  assert.equal(refused(full.g, influence({ city: full.cap.id, targetUnit: horse.id })), 'That unit cannot be influenced.');

  const room = persian();
  troops(room.g, 0, 'cavalry', room.cap.hex, 3);
  const [target] = troops(room.g, 1, 'cavalry', room.a);
  rigRolls(room.g, 5);
  act(room.g, influence({ city: room.cap.id, targetUnit: target.id }));
  assert.equal(target.owner, 0, 'the last Cavalry of the supply');
  assert.equal(unitsLeft(room.g.s, 0, 'cavalry'), 0);
});

test('Zoroastrianism: the other enemies in the space battle the converted unit at once', () => {
  const won = persian();
  const [target, rest] = troops(won.g, 1, 'infantry', won.a, 2);
  rigInfluenceThenBattle(won.g, 5, [6, 'infantry'], [1, 'leader']);
  act(won.g, influence({ city: won.cap.id, targetUnit: target.id }));
  assert.equal(target.owner, 0);
  assert.equal(unitById(won.g.s, rest.id), null, 'the new Infantry hit first and killed the one left');
  assert.deepEqual(checkInvariants(won.g), []);

  const lost = persian();
  const [bait, keeper] = troops(lost.g, 1, 'infantry', lost.a, 2);
  rigInfluenceThenBattle(lost.g, 5, [1, 'leader'], [6, 'infantry']);
  act(lost.g, influence({ city: lost.cap.id, targetUnit: bait.id }));
  assert.equal(unitById(lost.g.s, bait.id), null, 'the converted unit died in the battle');
  assert.equal(keeper.owner, 1);
  assert.deepEqual(checkInvariants(lost.g), []);
});

test('Zoroastrianism: Settlers left alone with the converted unit are defeated automatically', () => {
  const { g, cap, a } = persian();
  const [guard] = troops(g, 1, 'infantry', a);
  const [settler] = troops(g, 1, 'settler', a);
  rigRolls(g, 5);
  act(g, influence({ city: cap.id, targetUnit: guard.id }));
  assert.equal(guard.owner, 0);
  assert.equal(unitById(g.s, settler.id), null, 'unprotected Settlers are defeated');
  assert.deepEqual(checkInvariants(g), []);
});

test('Zoroastrianism: boosting the range or the die works as it normally does', () => {
  const range = persian();
  const [far] = troops(range.g, 1, 'infantry', spot(range.g, range.cap.hex, 2));
  give(range.g, 0, { culture: 1 });
  assert.match(refused(range.g, influence({ city: range.cap.id, targetUnit: far.id })), /out of range/);
  rigRolls(range.g, 5);
  act(range.g, influence({ city: range.cap.id, targetUnit: far.id, rangeBoost: 1 }));
  assert.equal(unitNow(range.g, far).owner, 0);
  assert.equal(me(range.g).culture, 0, '1 Culture for the range');

  const die = persian();
  const [near] = troops(die.g, 1, 'infantry', die.a);
  give(die.g, 0, { culture: 1 });
  const asked = asking(die.g, { influence_boost: 'yes' });
  rigRolls(die.g, 4);
  act(die.g, influence({ city: die.cap.id, targetUnit: near.id }));
  assert.ok(asked.some((q) => q.kind === 'influence_boost'));
  assert.equal(near.owner, 0, '4 and 1 Culture make 5');
  assert.equal(me(die.g).culture, 0);
});

test('Zoroastrianism: the enumerator offers the unit targets, free Arts attempts included, but not units in cities', () => {
  const { g, cap, a, b } = persian();
  const [foe] = troops(g, 1, 'infantry', a);
  town(g, 1, b);
  const [guard] = troops(g, 1, 'infantry', b);
  give(g, 0, { culture: 1, advances: ['arts'] });
  const found = offers(g);
  assert.ok(found.some(shaped({ city: cap.id, targetUnit: foe.id, free: undefined })));
  assert.ok(found.some(shaped({ city: cap.id, targetUnit: foe.id, free: true })));
  assert.ok(!found.some((x) => x.targetUnit === guard.id));

  const plain = world(['rome', 'egypt']);
  troops(plain, 1, 'infantry', spot(plain, capitalOf(plain).hex));
  assert.ok(!offers(plain).some((x) => x.targetUnit !== undefined), 'no unit targets without the power');
});

// ================================================================== Obelisk and Observatory
/** Player 0 with the Advances, the resources of one Building and a size-1 town to build in (a size-2 city cannot grow while there are only 2 cities). */
function mason({ advances = ['arts', 'math'], module = true } = {}) {
  let g;
  if (module) g = world(['egypt', 'rome']);
  else {
    g = fresh('plain');
    for (const h of Object.values(g.s.map.hexes)) h.terrain = 'plains';
  }
  const site = town(g, 0, spot(g, capitalOf(g).hex, 3));
  give(g, 0, { advances });
  stock(g, 0, { food: 1, wood: 1, ore: 1 });
  return { g, site };
}
const construct = (city, building) => ({ type: 'construct', city: city.id, building });
/** The Buildings the enumerator offers player 0 in a city. */
const buildable = (g, city) => [...new Set(enumerateActions(g, 0).filter((c) => c.cat === 'construct' && c.city === city.id).map((c) => c.building))].sort();
/** Player 0 (Rome, who needs no power to influence) beside a city of player 1 that holds these Buildings. */
function neighbours(buildings) {
  const g = world(['rome', 'egypt']);
  const cap = capitalOf(g);
  const foe = town(g, 1, spot(g, cap.hex), 'neutral', buildings);
  stock(g, 0, {});
  return { g, cap, foe };
}

test('The Obelisk and the Observatory only exist in a game with the Civilizations module', () => {
  const off = mason({ module: false });
  assert.match(refused(off.g, construct(off.site, 'obelisk')), /Unknown building/);
  assert.match(refused(off.g, construct(off.site, 'observatory')), /Unknown building/);
  assert.deepEqual(buildable(off.g, off.site), []);

  const on = mason();
  assert.deepEqual(buildable(on.g, on.site), ['obelisk', 'observatory']);
});

test('The Obelisk needs Arts and the Observatory needs Math; each costs an action and 1 Food, 1 Wood and 1 Ore', () => {
  const bare = mason({ advances: [] });
  assert.match(refused(bare.g, construct(bare.site, 'obelisk')), /You need Arts/);
  assert.match(refused(bare.g, construct(bare.site, 'observatory')), /You need Math/);
  const arts = mason({ advances: ['arts'] });
  assert.match(refused(arts.g, construct(arts.site, 'observatory')), /You need Math/);
  assert.deepEqual(buildable(arts.g, arts.site), ['obelisk']);

  const poor = mason();
  stock(poor.g, 0, { food: 1, wood: 1 });
  assert.match(refused(poor.g, construct(poor.site, 'obelisk')), /costs 1 Food, 1 Wood and 1 Ore/);

  const { g, site } = mason();
  act(g, construct(site, 'obelisk'));
  assert.equal(site.buildings.obelisk, 0, 'the Obelisk is in the colour of its builder');
  assert.deepEqual(me(g).res, { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0 });
  assert.equal(g.s.turn.actionsLeft, 2);
});

test('Building an Observatory draws an Action card; an Obelisk draws none', () => {
  const tower = mason();
  hold(tower.g, 0);
  const pile = tower.g.s.decks.action.length;
  act(tower.g, construct(tower.site, 'observatory'));
  assert.equal(tower.site.buildings.observatory, 0);
  assert.equal(me(tower.g).hand.action.length, 1);
  assert.equal(tower.g.s.decks.action.length, pile - 1, 'the card comes from the draw pile');
  assert.ok(logged(tower.g, /draws an Action card/));

  const stone = mason();
  hold(stone.g, 0);
  act(stone.g, construct(stone.site, 'obelisk'));
  assert.equal(me(stone.g).hand.action.length, 0);
});

test('An Obelisk cannot be influenced, though the other Buildings of its city and an Observatory can', () => {
  const lone = neighbours(['obelisk']);
  assert.match(refused(lone.g, influence({ city: lone.cap.id, target: lone.foe.id })), /no Building you can influence/);
  assert.deepEqual(offers(lone.g), [], 'the enumerator offers no attempt either');

  const mixed = neighbours(['obelisk', 'temple']);
  assert.deepEqual(offers(mixed.g).map((a) => a.building), ['temple']);
  rigRolls(mixed.g, 5);
  act(mixed.g, influence({ city: mixed.cap.id, target: mixed.foe.id, building: 'temple' }));
  assert.deepEqual(mixed.foe.buildings, { obelisk: 1, temple: 0 });

  const tower = neighbours(['observatory']);
  rigRolls(tower.g, 5);
  act(tower.g, influence({ city: tower.cap.id, target: tower.foe.id }));
  assert.equal(tower.foe.buildings.observatory, 0);
});

test('An Obelisk stays in the colour of its owner when the city is captured, which leaves the city under influence', () => {
  const g = world(['rome', 'egypt']);
  const cap = capitalOf(g);
  const [a, b] = ring(g, cap.hex, 1);
  const city = town(g, 1, a, 'neutral', ['obelisk', 'temple', 'academy']);
  const other = town(g, 1, b, 'neutral', ['academy']);
  const had = scoreOf(g.s, 1).buildings;
  run(g, captureCity(g, city, 0));
  assert.equal(city.owner, 0);
  assert.deepEqual(city.buildings, { obelisk: 1, temple: 0, academy: 0 });
  assert.equal(scoreOf(g.s, 1).buildings, had - 2, 'the Obelisk still counts for its builder');
  assert.ok(isInfluenced(city));
  assert.match(refused(g, influence({ city: city.id, target: other.id })), /can only target itself/);
  assert.match(refused(g, influence({ city: city.id, target: city.id })), /no Building you can influence/);

  stock(g, 0, {});
  rigRolls(g, 5);
  act(g, influence({ city: cap.id, target: other.id }));
  assert.equal(cityNow(g, other).buildings.academy, 0, 'a city that is not under influence can still act');
});

// ================================================================== City Independence
const coreOf = (g, p = 0) => scoreOf(g.s, p).parts.core;
const advancesOf = (g, p = 0) => scoreOf(g.s, p).parts.advances;
/** Player 0 (Egypt) beside a city of the Phoenicians (player 1) that holds a Port and these Buildings. */
function harbourTown(has = true, extra = []) {
  const g = world(['egypt', 'phoenicia']);
  if (has) power(g, 1, 'city_independence');
  const cap = capitalOf(g);
  const foe = town(g, 1, spot(g, cap.hex), 'neutral', extra);
  harbour(g, foe);
  stock(g, 0, {});
  return { g, cap, foe };
}

test('City Independence: every Port of the Phoenicians scores 1 1/2 VP instead of 1, wherever it stands', () => {
  const g = world(['phoenicia', 'egypt']);
  power(g, 0, 'city_independence');
  const start = coreOf(g);
  harbour(g, capitalOf(g));
  assert.equal(coreOf(g) - start, 1.5, 'a Port in their own city');
  const abroad = town(g, 1, spot(g, capitalOf(g).hex, 3));
  harbour(g, abroad);
  abroad.buildings.port = 0;
  assert.equal(coreOf(g) - start, 3, 'and another one in their colour in a city of an opponent');

  const plain = world(['phoenicia', 'egypt']);
  give(plain, 0, { advances: ['fishing'] });
  const base = coreOf(plain);
  harbour(plain, capitalOf(plain));
  assert.equal(coreOf(plain) - base, 1, 'without the power a Port is a Building like any other');
});

test('City Independence: the Government Advances of the Phoenicians score 0 VP and the other Advances 1/2 VP each', () => {
  const g = world(['phoenicia', 'egypt']);
  power(g, 0, 'city_independence');
  const base = advancesOf(g);
  give(g, 0, { advances: ['nationalism', 'dogma'] });
  assert.equal(advancesOf(g), base, 'two Government Advances');
  give(g, 0, { advances: ['math'] });
  assert.equal(advancesOf(g), base + 0.5, 'an ordinary Advance');

  const others = world(['rome', 'egypt']);
  const start = advancesOf(others);
  give(others, 0, { advances: ['nationalism', 'dogma'] });
  assert.equal(advancesOf(others), start + 1, 'other peoples score their Government Advances');
});

test('City Independence: a Port of the Phoenicians gains the power of the Obelisk and cannot be influenced', () => {
  const lone = harbourTown();
  assert.match(refused(lone.g, influence({ city: lone.cap.id, target: lone.foe.id })), /no Building you can influence/);
  assert.deepEqual(offers(lone.g), []);

  const mixed = harbourTown(true, ['academy']);
  assert.deepEqual(offers(mixed.g).map((a) => a.building), ['academy']);
  rigRolls(mixed.g, 5);
  act(mixed.g, influence({ city: mixed.cap.id, target: mixed.foe.id, building: 'academy' }));
  assert.deepEqual(mixed.foe.buildings, { academy: 0, port: 1 });

  const plain = harbourTown(false);
  assert.deepEqual(offers(plain.g).map((a) => a.building), ['port'], 'a Port without the power is a Building like any other');
  rigRolls(plain.g, 5);
  act(plain.g, influence({ city: plain.cap.id, target: plain.foe.id, building: 'port' }));
  assert.equal(plain.foe.buildings.port, 0);
});

test('City Independence: a captured city keeps its Port in the Phoenician colour, and that Port still scores', () => {
  const g = world(['egypt', 'phoenicia']);
  power(g, 1, 'city_independence');
  const city = town(g, 1, spot(g, capitalOf(g).hex), 'neutral', ['academy']);
  harbour(g, city);
  const before = coreOf(g, 1);
  run(g, captureCity(g, city, 0));
  assert.equal(city.owner, 0);
  assert.equal(city.buildings.port, 1, 'the Port stays Phoenician');
  assert.equal(city.buildings.academy, 0, 'the Academy goes to the captor');
  assert.ok(isInfluenced(city));
  assert.equal(coreOf(g, 1), before - 2, 'only the Settlement and the Academy are lost');

  const plain = world(['egypt', 'phoenicia']);
  const lost = town(plain, 1, spot(plain, capitalOf(plain).hex), 'neutral', ['academy']);
  harbour(plain, lost);
  run(plain, captureCity(plain, lost, 0));
  assert.equal(lost.buildings.port, 0, 'without the power the Port goes to the captor like any Building');
});

// ================================================================== Man God
/** Player 0 as the Egyptians (without Man God for a control) with these Advances and, for a Theocracy Advance, the Theocracy. */
function pharaoh(advances, { man = true, mood = 0 } = {}) {
  const g = world(['egypt', 'rome']);
  if (man) power(g, 0, 'man_god');
  give(g, 0, { advances });
  if (advances.length) me(g).government = 'theocracy';
  stock(g, 0, { mood });
  return { g, cap: capitalOf(g) };
}
/** Player 0 (Rome) with a Culture token and a size 1 capital, 2 spaces from a city of the Egyptians (player 1): it takes a range boost to reach it. */
function pharaohsCity({ man = true, army = true } = {}) {
  const g = world(['rome', 'egypt']);
  if (man) power(g, 1, 'man_god');
  give(g, 1, { advances: ['devotion'] });
  g.s.players[1].government = 'theocracy';
  const cap = capitalOf(g);
  const foe = town(g, 1, spot(g, cap.hex, 2), 'neutral', ['academy']);
  if (army) troops(g, 1, 'infantry', foe.hex);
  stock(g, 0, { culture: 1 });
  return { g, cap, foe };
}
const recruit = (city, extra = {}) => ({ type: 'recruit', city: city.id, units: { infantry: 1 }, ...extra });
/** The types of the actions the enumerator offers a player. */
const offered = (g, p = 0) => enumerateActions(g, p).map((c) => c.action.type);

test('Man God: Dogma also gives the power of Nationalism, which is no Advance of the Egyptians and scores nothing', () => {
  const { g, cap } = pharaoh(['dogma']);
  give(g, 0, { res: { food: 1, ore: 1 } });
  act(g, recruit(cap));
  assert.equal(me(g).mood, 1, 'Nationalism: 1 Mood after recruiting an Army unit');
  assert.ok(!me(g).advances.includes('nationalism'), 'no cube is placed on it');
  assert.equal(advancesOf(g), 2.5, 'Farming, Mining, Priesthood, Dogma and Man God: nothing for Nationalism');

  const culture = pharaoh(['dogma']);
  give(culture.g, 0, { res: { food: 1, ore: 1 } });
  act(culture.g, recruit(culture.cap, { nationalism: 'culture' }));
  assert.equal(me(culture.g).culture, 1, 'Nationalism may pay in Culture instead');
  assert.equal(me(culture.g).mood, 0);

  const bare = pharaoh([]);
  give(bare.g, 0, { res: { food: 1, ore: 1 } });
  act(bare.g, recruit(bare.cap));
  assert.equal(me(bare.g).mood, 0, 'Man God without a Theocracy Advance gives nothing');

  const outsider = pharaoh(['dogma'], { man: false });
  give(outsider.g, 0, { res: { food: 1, ore: 1 } });
  act(outsider.g, recruit(outsider.cap));
  assert.equal(me(outsider.g).mood, 0, 'Dogma without Man God gives nothing');
});

test('Man God: each Theocracy Advance gives the Autocracy Advance directly to its left, and only that one', () => {
  const left = { dogma: 'nationalism', devotion: 'totalitarianism', conversion: 'absolute_power', fanaticism: 'forced_labor' };
  const autocracy = Object.values(left);
  for (const [theocracy, gift] of Object.entries(left)) {
    const { g } = pharaoh([theocracy]);
    assert.deepEqual(autocracy.filter((a) => hasAdv(g.s, 0, a)), [gift], `${theocracy} brings ${gift} and nothing else`);
    const outsider = pharaoh([theocracy], { man: false });
    assert.deepEqual(autocracy.filter((a) => hasAdv(outsider.g.s, 0, a)), [], `${theocracy} alone brings no Autocracy power`);
  }
  const { g } = pharaoh(['dogma'], { mood: 4 });
  const types = offered(g);
  assert.ok(!types.includes('absolute_power') && !types.includes('forced_labor'), 'Dogma is not Conversion or Fanaticism');
});

test('Man God: Devotion also gives Totalitarianism, so Influence Culture against a city with an Army cannot be boosted', () => {
  const asked = (scene) => influence({ city: scene.cap.id, target: scene.foe.id, building: 'academy', rangeBoost: 1 });
  const guarded = pharaohsCity();
  assert.match(refused(guarded.g, asked(guarded)), /cannot boost/);

  const open = pharaohsCity({ army: false });
  rigRolls(open.g, 5);
  act(open.g, asked(open));
  assert.equal(open.foe.buildings.academy, 0, 'without an Army in the city the boost works');
  assert.equal(me(open.g).culture, 0);

  const plain = pharaohsCity({ man: false });
  rigRolls(plain.g, 5);
  act(plain.g, asked(plain));
  assert.equal(plain.foe.buildings.academy, 0, 'Devotion alone does not protect a city with an Army');
});

test('Man God: Conversion also gives Absolute Power: 2 Mood for an extra action, once per turn', () => {
  const { g } = pharaoh(['conversion'], { mood: 4 });
  assert.ok(offered(g).includes('absolute_power'));
  act(g, { type: 'absolute_power' });
  assert.equal(me(g).mood, 2);
  assert.equal(g.s.turn.actionsLeft, 4);
  assert.match(refused(g, { type: 'absolute_power' }), /once per turn/);
  assert.ok(!offered(g).includes('absolute_power'));

  const bare = pharaoh([], { mood: 4 });
  assert.match(refused(bare.g, { type: 'absolute_power' }), /You need Absolute Power/);
});

test('Man God: Fanaticism also gives Forced Labor: for 1 Mood an Angry city acts as a Neutral one', () => {
  const { g, cap } = pharaoh(['fanaticism'], { mood: 1 });
  cap.buildings.temple = 0;
  cap.mood = 'angry';
  give(g, 0, { res: { food: 2, ore: 2 } });
  const two = recruit(cap, { units: { infantry: 2 } });
  assert.match(refused(g, two), /at most 1 unit/);
  assert.ok(offered(g).includes('forced_labor'));
  const infantry = () => g.s.units.filter((u) => u.owner === 0 && u.type === 'infantry').length;
  const before = infantry();
  act(g, { type: 'forced_labor' });
  assert.equal(me(g).mood, 0);
  act(g, two);
  assert.equal(infantry(), before + 2, 'the Angry city recruits as many units as its size');

  const bare = pharaoh([], { mood: 1 });
  assert.match(refused(bare.g, { type: 'forced_labor' }), /You need Forced Labor/);
});

// ================================================================== City States
/** Collect 1 Food next to the city: one action and one activation. */
const harvest = (g, city) => act(g, { type: 'collect', city: city.id, picks: [{ hex: spot(g, city.hex), res: 'food' }] });
const standIns = (asked) => asked.filter((q) => q.kind === 'city_states');
/** The Greeks with a size 2 capital (Neutral unless told otherwise) and more cities, given as [Mood, Buildings] and standing 3 spaces away. */
function league(partners, has = true, mood = 'neutral') {
  const g = world(['greece', 'egypt']);
  if (has) {
    power(g, 0, 'city_states');
    me(g).government = 'democracy';
  }
  const cap = capitalOf(g);
  cap.buildings.temple = 0;
  cap.mood = mood;
  const spaces = ring(g, cap.hex, 3);
  const others = partners.map(([mood, buildings], i) => town(g, 0, spaces[i], mood, buildings));
  stock(g, 0, {});
  return { g, cap, others };
}

test('City States: a city activated a second time may have another city of at least its size and Mood count as activated instead', () => {
  const { g, cap, others: [twin] } = league([['neutral', ['temple']]]);
  const asked = asking(g, { city_states: twin.id });
  harvest(g, cap);
  assert.deepEqual(standIns(asked), [], 'the first activation asks nothing');
  harvest(g, cap);
  const [q] = standIns(asked);
  assert.deepEqual(optionIds(q), [twin.id, 'none']);
  assert.equal(g.s.turn.activated[twin.id], 1);
  assert.equal(g.s.turn.activated[cap.id], 1, 'the capital still counts as activated once');
  assert.equal(cap.mood, 'neutral', 'so its Mood does not fall');
  assert.ok(logged(g, /activates the city at .* in its place \(City States\)/));
  assert.deepEqual(checkInvariants(g), []);
});

test('City States: only a city of at least the size and the Mood can stand in; with none the Mood falls as usual', () => {
  const { g, cap, others: [bigger, same] } = league([
    ['happy', ['temple', 'academy']], ['neutral', ['temple']], ['neutral', []], ['angry', ['temple']],
  ]);
  const asked = asking(g, { city_states: 'none' });
  harvest(g, cap);
  harvest(g, cap);
  const [q] = standIns(asked);
  assert.deepEqual(optionIds(q).sort(), [bigger.id, same.id, 'none'].sort(), 'a bigger Happy city and an equal one, not a smaller or an Angry one');

  const alone = league([['neutral', []], ['angry', ['temple']]]);
  const quiet = asking(alone.g);
  harvest(alone.g, alone.cap);
  harvest(alone.g, alone.cap);
  assert.deepEqual(standIns(quiet), [], 'no city qualifies, so nothing is asked');
  assert.equal(alone.cap.mood, 'angry');
});

test('City States: the stand-in must at least match the Mood of the city, so a Happy city is only replaced by a Happy one', () => {
  const { g, cap, others: [calm, joyful] } = league([['neutral', ['temple']], ['happy', ['temple']]], true, 'happy');
  const asked = asking(g, { city_states: joyful.id });
  harvest(g, cap);
  harvest(g, cap);
  assert.deepEqual(optionIds(standIns(asked)[0]).sort(), [joyful.id, 'none'].sort());
  assert.equal(cap.mood, 'happy', 'the Happy city does not lose Mood');
  assert.equal(g.s.turn.activated[joyful.id], 1);
  assert.equal(g.s.turn.activated[calm.id], undefined);
});

test('City States: the stand-in only has to match the size the city had when its action began, even if the action made it bigger', () => {
  const { g, cap, others: [twin] } = league([['neutral', ['temple']], ['neutral', ['temple']]]);
  give(g, 0, { advances: ['writing'], res: { food: 1, wood: 1, ore: 1 } });
  const asked = asking(g, { city_states: twin.id });
  harvest(g, cap);
  act(g, { type: 'construct', city: cap.id, building: 'academy' });
  assert.equal(citySize(cap), 3);
  assert.ok(optionIds(standIns(asked)[0]).includes(twin.id), 'a size 2 city stands in for the city that has become size 3');
  assert.equal(cap.mood, 'neutral');
  assert.equal(g.s.turn.activated[twin.id], 1);
});

test('City States: a stand-in that was already activated this turn loses Mood, as normal', () => {
  const { g, cap, others: [twin] } = league([['neutral', ['temple']]]);
  const asked = asking(g, { city_states: twin.id });
  harvest(g, twin);
  harvest(g, cap);
  harvest(g, cap);
  assert.equal(standIns(asked).length, 1);
  assert.equal(twin.mood, 'angry');
  assert.equal(cap.mood, 'neutral');
  assert.equal(g.s.turn.activated[twin.id], 2);
});

test('City States: declining the stand-in, or not having the power, lets the second activation lower the Mood as usual', () => {
  const declined = league([['neutral', ['temple']]]);
  const asked = asking(declined.g, { city_states: 'none' });
  harvest(declined.g, declined.cap);
  harvest(declined.g, declined.cap);
  assert.equal(standIns(asked).length, 1);
  assert.equal(declined.cap.mood, 'angry');
  assert.equal(declined.g.s.turn.activated[declined.others[0].id], undefined, 'the other city was not activated');

  const plain = league([['neutral', ['temple']]], false);
  const quiet = asking(plain.g);
  harvest(plain.g, plain.cap);
  harvest(plain.g, plain.cap);
  assert.deepEqual(standIns(quiet), []);
  assert.equal(plain.cap.mood, 'angry');
});

// ================================================================== Trade routes
/** The trade routes of a player as [city, unit] pairs. */
const pairs = (g, p = 0) => tradeRoutes(g.s, p).map((r) => [r.city, r.unit]);
/** Pay a player their trade routes as at the start of their turn: the `trade` event (undefined when they have none). */
const payday = (g, p = 0) => ofType(run(g, tradePhase(g, p)), 'trade')[0];
/** The questions about what a route pays. */
const incomes = (asked) => asked.filter((q) => q.kind === 'trade_route_income');
/** Player 0 as this people, holding these powers (or just the Trade Routes Advance), with an empty store and the Settler on the capital. */
function caravan(civ, ...powers) {
  const g = world([civ, 'egypt']);
  if (powers.length) power(g, 0, ...powers);
  else give(g, 0, { advances: ['trade_routes'] });
  stock(g, 0, {});
  return { g, cap: capitalOf(g), settler: settlerOf(g) };
}

test('Tribal Trade: a Settler of the Celts forms a trade route with a Barbarian city within 2 spaces, and it pays Food', () => {
  const { g, cap, settler } = caravan('celts', 'tribal_trade');
  const camp = town(g, BARBARIAN, spot(g, cap.hex, 2));
  assert.deepEqual(tradeRoutes(g.s, 0), [{ city: camp.id, unit: settler.id, port: null, ship: false, adjacent: false }]);
  const paid = payday(g);
  assert.deepEqual(paid.gain, { food: 1 });
  assert.equal(me(g).res.food, 1);
  assert.ok(logged(g, /earns 1 food from trade routes/));
});

test('Tribal Trade: without the power a Barbarian city is no partner, and 3 spaces are too far', () => {
  const plain = caravan('celts');
  town(plain.g, BARBARIAN, spot(plain.g, plain.cap.hex, 2));
  assert.deepEqual(pairs(plain.g), []);

  const far = caravan('celts', 'tribal_trade');
  town(far.g, BARBARIAN, spot(far.g, far.cap.hex, 3));
  assert.deepEqual(pairs(far.g), []);
});

test('Tribal Trade: a Barbarian route only gives Food, while the routes to opponents may give Gold with Currency', () => {
  const { g, cap } = caravan('celts', 'tribal_trade');
  give(g, 0, { advances: ['currency'] });
  troops(g, 0, 'settler', cap.hex);
  town(g, BARBARIAN, spot(g, cap.hex, 2));
  town(g, 1, spot(g, cap.hex, 1));
  asking(g, { trade_income: 'gold' });
  assert.deepEqual(payday(g).gain, { food: 1, gold: 1 });
  assert.equal(me(g).res.gold, 1);

  const only = caravan('celts', 'tribal_trade');
  give(only.g, 0, { advances: ['currency'] });
  town(only.g, BARBARIAN, spot(only.g, only.cap.hex, 2));
  const asked = asking(only.g, { trade_income: 'gold' });
  assert.deepEqual(payday(only.g).gain, { food: 1 });
  assert.deepEqual(asked, [], 'a Barbarian route gives Food, so there is nothing to choose');
});

test('Prosperity: a trade route may give 1 Mood instead of Food or Gold', () => {
  const { g, cap } = caravan('india', 'prosperity');
  town(g, 1, spot(g, cap.hex, 2));
  const asked = asking(g, { trade_route_income: 'mood' });
  const paid = payday(g);
  assert.deepEqual(optionIds(incomes(asked)[0]), ['food', 'mood']);
  assert.deepEqual(paid.gain, { mood: 1 });
  assert.equal(me(g).mood, 1);
  assert.equal(me(g).res.food, 0);

  const rich = caravan('india', 'prosperity');
  give(rich.g, 0, { advances: ['currency'] });
  town(rich.g, 1, spot(rich.g, rich.cap.hex, 2));
  const choices = asking(rich.g, { trade_route_income: 'gold' });
  assert.deepEqual(payday(rich.g).gain, { gold: 1 });
  assert.deepEqual(optionIds(incomes(choices)[0]), ['food', 'gold', 'mood'], 'Mood is one more choice next to Food and Gold');
});

test('Prosperity: a route to a city that holds one of your Buildings may give 1 Culture instead', () => {
  const { g, cap } = caravan('india', 'prosperity');
  const foe = town(g, 1, spot(g, cap.hex, 2), 'neutral', ['temple']);
  foe.buildings.temple = 0;
  const asked = asking(g, { trade_route_income: 'culture' });
  const paid = payday(g);
  assert.deepEqual(optionIds(incomes(asked)[0]), ['food', 'mood', 'culture']);
  assert.deepEqual(paid.gain, { culture: 1 });
  assert.equal(me(g).culture, 1);

  const clean = caravan('india', 'prosperity');
  town(clean.g, 1, spot(clean.g, clean.cap.hex, 2), 'neutral', ['temple']);
  const quiet = asking(clean.g);
  payday(clean.g);
  assert.deepEqual(optionIds(incomes(quiet)[0]), ['food', 'mood'], 'a city that is not under your influence gives no Culture');
});

test('Prosperity: without the power the routes pay Food as usual and nothing is asked', () => {
  const { g, cap } = caravan('india');
  town(g, 1, spot(g, cap.hex, 2));
  const asked = asking(g);
  assert.deepEqual(payday(g).gain, { food: 1 });
  assert.deepEqual(asked, []);
});

/** The Phoenicians with this many Settlers on the capital and as many cities of player 1 two spaces away: each Settler pairs with a different one. */
function mercantile(settlers, foes, { alphabet = true } = {}) {
  const g = world(['phoenicia', 'egypt']);
  if (alphabet) power(g, 0, 'alphabet');
  give(g, 0, { advances: ['trade_routes'] });
  const cap = capitalOf(g);
  troops(g, 0, 'settler', cap.hex, settlers - 1);
  ring(g, cap.hex, 2).slice(0, foes).forEach((k) => town(g, 1, k));
  stock(g, 0, {});
  return { g, cap };
}

test('Alphabet: up to 2 of the trade routes give 2 Ideas each instead of Food, and the third pays Food', () => {
  const { g } = mercantile(3, 3);
  const asked = asking(g, { trade_route_income: (q) => (optionIds(q).includes('ideas_a') ? 'ideas_a' : 'food') });
  const paid = payday(g);
  const routes = incomes(asked);
  assert.deepEqual(optionIds(routes[0]), ['food', 'culture_a', 'ideas_a']);
  assert.deepEqual(optionIds(routes[1]), ['food', 'culture_a', 'ideas_a'], 'one use of the Alphabet is left for the second route');
  assert.ok(routes.slice(2).every((q) => optionIds(q).join() === 'food'), 'both uses are gone for the third route');
  assert.deepEqual(paid.gain, { ideas: 4, food: 1 });
  assert.equal(me(g).res.ideas, 4);
  assert.equal(me(g).res.food, 1);
});

test('Alphabet: a route may give 1 Culture instead, and the 2 routes can be any of the 3', () => {
  const alone = mercantile(1, 1);
  asking(alone.g, { trade_route_income: 'culture_a' });
  assert.deepEqual(payday(alone.g).gain, { culture: 1 });
  assert.equal(me(alone.g).culture, 1);

  const { g } = mercantile(3, 3);
  const answers = ['food', 'ideas_a', 'culture_a'];
  asking(g, { trade_route_income: () => answers.shift() });
  assert.deepEqual(payday(g).gain, { food: 1, ideas: 2, culture: 1 });
  assert.equal(me(g).culture, 1);
  assert.equal(me(g).res.ideas, 2);
});

test('Alphabet: without the power every route pays Food and nothing is asked', () => {
  const { g } = mercantile(3, 3, { alphabet: false });
  const asked = asking(g);
  assert.deepEqual(payday(g).gain, { food: 3 });
  assert.deepEqual(asked, []);
  assert.equal(me(g).res.ideas, 0);
});

/** A space `d` steps from `from` that stands beside the Sea or not (a free space next to it turns into Sea). */
function shore(g, from, d, coastal) {
  const k = ring(g, from, d).find((x) => !nbrs(g.s, x).some((n) => isSea(g.s, n)));
  if (coastal) setTerrain(g, nbrs(g.s, k).find((n) => free(g, n)), 'sea');
  return k;
}
/** The Phoenicians with a capital that has a Port (or not) and neither Settler nor Ship: only that Port can start a trade route. */
function harbourTrader({ cedars = true, port = true } = {}) {
  const g = world(['phoenicia', 'egypt']);
  if (cedars) power(g, 0, 'cedars_and_dyes');
  else give(g, 0, { advances: ['trade_routes'] });
  g.s.units = g.s.units.filter((u) => u.id !== settlerOf(g).id);
  const cap = capitalOf(g);
  if (port) harbour(g, cap);
  stock(g, 0, {});
  return { g, cap };
}
/** The Phoenicians with a Ship at sea in an empty bay: the only thing that can start a trade route. */
function sailor({ cedars = true } = {}) {
  const g = world(['phoenicia', 'egypt', 'rome'], { opponents: 2 });
  if (cedars) power(g, 0, 'cedars_and_dyes');
  else give(g, 0, { advances: ['trade_routes'] });
  g.s.units = g.s.units.filter((u) => u.id !== settlerOf(g).id);
  const { o } = bay(g);
  setTerrain(g, o, 'sea');
  const [ship] = troops(g, 0, 'ship', o);
  stock(g, 0, {});
  return { g, o, ship };
}

test('Cedars and Dyes: a Port city forms a trade route by itself with a coastal enemy city up to 3 spaces away', () => {
  const cases = [[3, true, true], [3, false, false], [2, true, true], [2, false, false], [4, true, false]];
  for (const [d, coastal, trades] of cases) {
    const { g, cap } = harbourTrader();
    const foe = town(g, 1, shore(g, cap.hex, d, coastal));
    const want = trades ? [{ city: foe.id, unit: null, port: cap.id, ship: false, adjacent: false }] : [];
    assert.deepEqual(tradeRoutes(g.s, 0), want, `${coastal ? 'a coastal' : 'an inland'} city ${d} spaces away`);
  }
  const { g, cap } = harbourTrader();
  town(g, 1, shore(g, cap.hex, 3, true));
  assert.deepEqual(payday(g).gain, { food: 1 });
});

test('Cedars and Dyes: a city trades by itself only with the power, and only with a Port', () => {
  const dry = harbourTrader({ port: false });
  town(dry.g, 1, shore(dry.g, dry.cap.hex, 2, true));
  assert.deepEqual(pairs(dry.g), [], 'a city without a Port needs a Settler or a Ship');

  const plain = harbourTrader({ cedars: false });
  town(plain.g, 1, shore(plain.g, plain.cap.hex, 2, true));
  assert.deepEqual(pairs(plain.g), [], 'a Port is no trader on its own without Cedars and Dyes');
});

test('Cedars and Dyes: Ships form trade routes with coastal enemy cities up to 3 spaces away, and with any city within 2', () => {
  const cases = [[3, true, true], [3, false, false], [2, false, true], [4, true, false]];
  for (const [d, coastal, trades] of cases) {
    const { g, o, ship } = sailor();
    const foe = town(g, 1, shore(g, o, d, coastal));
    assert.deepEqual(pairs(g), trades ? [[foe.id, ship.id]] : [], `${coastal ? 'a coastal' : 'an inland'} city ${d} spaces away`);
  }
  const plain = sailor({ cedars: false });
  town(plain.g, 1, shore(plain.g, plain.o, 3, true));
  assert.deepEqual(pairs(plain.g), [], 'three spaces are too far for a Ship without Cedars and Dyes');

  const near = sailor({ cedars: false });
  const foe = town(near.g, 1, shore(near.g, near.o, 2, false));
  assert.deepEqual(pairs(near.g), [[foe.id, near.ship.id]], 'two spaces are not');
});

test('Cedars and Dyes: with more Ships than that, a player still makes only 4 trade routes', () => {
  const { g, o } = sailor();
  troops(g, 0, 'ship', o, 4);
  ring(g, o, 2).slice(0, 6).forEach((k) => town(g, 1, k));
  assert.equal(tradeRoutes(g.s, 0).length, 4);
  assert.deepEqual(payday(g).gain, { food: 4 });
});

// ================================================================== Marauders
/** The Vikings with no Settler and a bay of empty land around one Sea space: a Ship put there is the only thing that can start a trade route. */
function raider({ marauders = true } = {}) {
  const g = world(['vikings', 'egypt', 'rome'], { opponents: 2 });
  if (marauders) power(g, 0, 'marauders');
  else give(g, 0, { advances: ['trade_routes'] });
  g.s.units = g.s.units.filter((u) => u.id !== settlerOf(g).id);
  const { o, at } = bay(g);
  setTerrain(g, o, 'sea');
  stock(g, 0, {});
  return { g, o, at };
}
/** The questions about which resource the Marauders take. */
const plundered = (asked) => asked.filter((q) => q.kind === 'marauders');
const goods = (g, p) => [me(g, p).res.wood, me(g, p).res.ore];

test('Marauders: when a Ship pairs with a city next to it, the owner of that city loses 1 resource of their choice', () => {
  for (const [pick, left] of [['ore', [2, 0]], ['wood', [1, 1]]]) {
    const { g, o, at } = raider();
    const [ship] = troops(g, 0, 'ship', o);
    const foe = town(g, 1, at(E));
    stock(g, 1, { wood: 2, ore: 1 });
    const asked = asking(g, { marauders: pick });
    const paid = payday(g);
    assert.deepEqual(paid.routes.map((r) => [r.city, r.unit]), [[foe.id, ship.id]]);
    assert.deepEqual(optionIds(plundered(asked)[0]), ['wood', 'ore'], 'the owner picks among what they have');
    assert.deepEqual(goods(g, 1), left, `they lose 1 ${pick}`);
    assert.ok(logged(g, new RegExp(`loses 1 ${pick} to .*Marauders`)));
    assert.deepEqual(paid.gain, { food: 1 }, 'the route pays the Vikings as usual');
  }
});

test('Marauders: a city two spaces from the Ship is a trade partner but is not plundered', () => {
  const { g, o, at } = raider();
  const [ship] = troops(g, 0, 'ship', o);
  const foe = town(g, 1, at(E, E));
  stock(g, 1, { wood: 1, ore: 1 });
  const asked = asking(g);
  assert.deepEqual(pairs(g), [[foe.id, ship.id]]);
  assert.deepEqual(payday(g).gain, { food: 1 });
  assert.deepEqual(plundered(asked), []);
  assert.deepEqual(goods(g, 1), [1, 1]);
});

test('Marauders: nothing is lost without the power, to a Settler instead of a Ship, or from an owner with no resources', () => {
  const plain = raider({ marauders: false });
  troops(plain.g, 0, 'ship', plain.o);
  town(plain.g, 1, plain.at(E));
  stock(plain.g, 1, { wood: 1, ore: 1 });
  const none = asking(plain.g);
  assert.deepEqual(payday(plain.g).gain, { food: 1 });
  assert.deepEqual(plundered(none), []);
  assert.deepEqual(goods(plain.g, 1), [1, 1]);

  const walker = raider();
  troops(walker.g, 0, 'settler', walker.at(W));
  town(walker.g, 1, walker.at(W, W));
  stock(walker.g, 1, { wood: 1, ore: 1 });
  const quiet = asking(walker.g);
  assert.deepEqual(payday(walker.g).gain, { food: 1 });
  assert.deepEqual(plundered(quiet), [], 'only Ships plunder');
  assert.deepEqual(goods(walker.g, 1), [1, 1]);

  const poor = raider();
  troops(poor.g, 0, 'ship', poor.o);
  town(poor.g, 1, poor.at(E));
  stock(poor.g, 1, {});
  const empty = asking(poor.g);
  assert.deepEqual(payday(poor.g).gain, { food: 1 });
  assert.deepEqual(plundered(empty), []);
  assert.deepEqual(goods(poor.g, 1), [0, 0]);
});

test('Marauders: every opponent whose city is paired with an adjacent Ship loses 1 resource', () => {
  const { g, o, at } = raider();
  troops(g, 0, 'ship', o, 2);
  const east = town(g, 1, at(E));
  const west = town(g, 2, at(W));
  stock(g, 1, { wood: 1 });
  stock(g, 2, { ore: 1 });
  asking(g);
  const paid = payday(g);
  assert.deepEqual(paid.routes.map((r) => r.city).sort(), [east.id, west.id].sort());
  assert.deepEqual(paid.gain, { food: 2 });
  assert.deepEqual(goods(g, 1), [0, 0]);
  assert.deepEqual(goods(g, 2), [0, 0]);
});

// ================================================================== Raiders
/** Egypt (player 0) with a Settler 3 spaces from its capital and a Hun Army `distance` spaces from that Settler. The Huns are player 1. */
function raided({ distance = 2, raiders = true, army = 'infantry' } = {}) {
  const g = world(['egypt', 'huns']);
  if (raiders) power(g, 1, 'raiders');
  else give(g, 1, { advances: ['tactics'] });
  g.s.units = g.s.units.filter((u) => u.id !== settlerOf(g).id);
  const camp = spot(g, capitalOf(g).hex, 3);
  const [settler] = troops(g, 0, 'settler', camp);
  troops(g, 1, army, spot(g, camp, distance));
  stock(g, 0, {});
  return { g, camp, settler };
}
/** The same, with the Trade Routes Advance and a city of the Huns next to the Settler as a trade partner. */
function raidedTrader(options) {
  const r = raided(options);
  give(r.g, 0, { advances: ['trade_routes'] });
  r.partner = town(r.g, 1, spot(r.g, r.camp, 1));
  return r;
}
/** Whether the enumerator offers this Settler to Found a city. */
const foundable = (g, settler) => enumerateActions(g, 0).some((c) => c.cat === 'found' && c.action.unit === settler.id);
const found = (g, settler) => act(g, { type: 'found_city', unit: settler.id });

test('Raiders: a Settler within 2 spaces of a Hun Army cannot Found a city', () => {
  for (const army of ['infantry', 'cavalry', 'elephant']) {
    for (const distance of [1, 2]) {
      const { g, settler } = raided({ distance, army });
      assert.equal(foundable(g, settler), false, `a Hun ${army} ${distance} spaces away`);
      assert.match(refused(g, { type: 'found_city', unit: settler.id }), /Hunnic Raiders/);
    }
  }
});

test('Raiders: the Settler founds its city when the Hun Army is 3 spaces away, is no Army, or has no Raiders', () => {
  const cases = {
    'a Hun Army 3 spaces away': raided({ distance: 3 }),
    'a Hun Settler 2 spaces away': raided({ army: 'settler' }),
    'Huns without the power': raided({ raiders: false }),
  };
  for (const [what, { g, camp, settler }] of Object.entries(cases)) {
    assert.equal(foundable(g, settler), true, what);
    found(g, settler);
    assert.equal(cityAt(g.s, camp).owner, 0, what);
  }
});

test('Raiders: a Settler with an Army of its own on the same space can Found a city', () => {
  const { g, camp, settler } = raided();
  troops(g, 0, 'infantry', camp);
  assert.equal(foundable(g, settler), true);
  found(g, settler);
  assert.equal(cityAt(g.s, camp).owner, 0);
});

test('Raiders: only opponents are held back, the Huns found cities as they like', () => {
  const g = world(['huns', 'egypt']);
  power(g, 0, 'raiders');
  g.s.units = g.s.units.filter((u) => u.id !== settlerOf(g).id);
  const camp = spot(g, capitalOf(g).hex, 3);
  const [settler] = troops(g, 0, 'settler', camp);
  troops(g, 0, 'infantry', spot(g, camp, 1));
  troops(g, 1, 'infantry', spot(g, camp, 2));
  assert.equal(foundable(g, settler), true);
  found(g, settler);
  assert.equal(cityAt(g.s, camp).owner, 0);
});

test('Raiders: a Settler within 2 spaces of a Hun Army forms no trade route', () => {
  const { g } = raidedTrader();
  const asked = asking(g);
  assert.deepEqual(pairs(g), []);
  assert.equal(payday(g), undefined, 'there is nothing to pay');
  assert.deepEqual(asked, []);
});

test('Raiders: the Settler trades when the Army is 3 spaces away, has no Raiders, or the Settler has an Army or a city of its own', () => {
  const escorted = raidedTrader();
  troops(escorted.g, 0, 'infantry', escorted.camp);
  const housed = raidedTrader();
  town(housed.g, 0, housed.camp);
  const cases = {
    'a Hun Army 3 spaces away': raidedTrader({ distance: 3 }),
    'Huns without the power': raidedTrader({ raiders: false }),
    'with an Army of its own': escorted,
    'in a city of its own': housed,
  };
  for (const [what, { g, partner, settler }] of Object.entries(cases)) {
    assert.deepEqual(pairs(g), [[partner.id, settler.id]], what);
  }
});

test('Raiders: a Ship still forms a trade route while the Settlers beside the Hun Army cannot', () => {
  const { g, partner } = raidedTrader();
  const sea = spot(g, partner.hex, 1);
  setTerrain(g, sea, 'sea');
  const [ship] = troops(g, 0, 'ship', sea);
  assert.deepEqual(pairs(g).map(([, unit]) => unit), [ship.id], 'only the Ship trades');
  assert.deepEqual(payday(g).gain, { food: 1 });
});
