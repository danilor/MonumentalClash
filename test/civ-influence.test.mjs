// Influence Culture and what rests on it in the Civilizations module: Code of Laws, Druidic Influence, Proselytism, Hellenization and
// Zoroastrianism; the trade-route powers, Raiders, City Independence, the Obelisk and the Observatory, Man God and City States.
// Every test pins a rule of the rulebook (Civilizations pages), source/civ.md or the text of the Advance; dice are fixed with rigRolls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BARBARIAN, COMBAT_DIE } from '../src/engine/data/constants.js';
import { captureCity } from '../src/engine/combat.js';
import { influenceRange, influenceTypes, settlerOrigin } from '../src/engine/city.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { citySize, hexDistance, unitById, unitsLeft } from '../src/engine/queries.js';
import { randInt, roll } from '../src/engine/rng.js';
import { scoreOf } from '../src/engine/scoring.js';
import { checkInvariants } from './harness.mjs';
import { act, capitalOf, give, hold, refused, rigRolls, settlerOf } from './scenario.mjs';
import { asking, barbarians, logged, me, power, ring, run, setTerrain, stock, town, troops, world } from './civs.mjs';

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
