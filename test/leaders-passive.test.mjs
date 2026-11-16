// Leaders: the abilities that work by themselves while a Leader stands in a city or in a group (they need no Action of their own).
// Every test pins a line of source/leaders.md; dice are fixed with rigRolls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BARBARIAN } from '../src/engine/data/constants.js';
import { barbarianIncursion } from '../src/engine/barbarians.js';
import { cityCapacity, deployHexes, foundBlocked, influenceBlocked, influenceRange, influenceTypes, wonderChoices, wonderCost } from '../src/engine/city.js';
import { resolveEvent } from '../src/engine/events.js';
import { allHexKeys, cityAt, hexDistance, isLand, leaderUnit, nbrs, unitById } from '../src/engine/queries.js';
import { scoreOf } from '../src/engine/scoring.js';
import { tradePhase, tradeRoutes } from '../src/engine/trade.js';
import { act, capitalOf, give, hold, refused, rigRolls, settlerOf } from './scenario.mjs';
import { asking, barbarians, free, logged, me, ofType, power, ring, run, setTerrain, stack, stock, town, troops } from './civs.mjs';
import { checkInvariants } from './harness.mjs';
import { elsewhere, lead, secondCity } from './leaders.mjs';

/** The current copy of a city: a refused action restores the game from a snapshot, which leaves earlier references stale. */
const cityNow = (g, city) => g.s.cities.find((c) => c.id === city.id);
const construct = (city, building) => ({ type: 'construct', city: city.id, building });
const gather = (city, ...hexes) => ({ type: 'collect', city: city.id, picks: hexes.map((hex) => ({ hex, res: 'food' })) });
/** A free space next to a hex. */
const beside = (g, hex) => nbrs(g.s, hex).find((k) => free(g, k));
const captives = (...owners) => owners.map((owner) => ({ owner, type: 'infantry' }));

// ================================================================== Aztecs
test('Acamapichtli: Captives pay 1:1 as any resource when his city grows, and only for what the player lacks', () => {
  const { g, cap } = lead('aztecs', 'acamapichtli');
  const other = secondCity(g, cap);
  give(g, 0, { advances: ['bartering'] });
  me(g).captives = [{ owner: 1, type: 'infantry' }, { owner: BARBARIAN, type: 'infantry' }, { owner: 1, type: 'cavalry' }];
  stock(g, 0, { food: 1 });
  assert.match(refused(g, construct(other, 'market')), /A building costs/, 'only in the city he is in');
  act(g, construct(cap, 'market'));
  assert.equal(cityNow(g, cap).buildings.market, 0);
  assert.equal(me(g).res.food, 0, 'the Food that the player had was paid first');
  assert.deepEqual(me(g).captives, [{ owner: 1, type: 'cavalry' }], 'Wood and Ore cost 2 Captives: the Barbarian one first');
  assert.equal(ofType(g.drainEvents(), 'sacrifice').length, 2);
  assert.equal(g.s.turn.actionsLeft, 2);
});

test('Acamapichtli: without enough Captives the building is out of reach, and so is it when he is away from the city', () => {
  const { g, cap } = lead('aztecs', 'acamapichtli');
  secondCity(g, cap);
  give(g, 0, { advances: ['bartering'] });
  me(g).captives = captives(1);
  assert.match(refused(g, construct(cap, 'market')), /A building costs/, '1 Captive is 1 of the 3 resources');
  me(g).captives = captives(1, 1, 1);
  leaderUnit(g.s, 0).hex = elsewhere(g, cap.hex);
  assert.match(refused(g, construct(capitalOf(g), 'market')), /A building costs/);
  assert.equal(me(g).captives.length, 3);
});

test('Acamapichtli: 1 Captive instead of 2 Mood tokens lends Tribute Empire to the city he is in', () => {
  const { g, cap } = lead('aztecs', 'acamapichtli');
  const foe = town(g, 1, beside(g, cap.hex));
  assert.match(refused(g, gather(cap, foe.hex)), /cannot collect from that space/, 'no Captive, no Tribute');
  me(g).captives = captives(1, BARBARIAN);
  act(g, gather(cap, foe.hex));
  assert.equal(me(g).res.food, 1, 'the food of the enemy city space');
  assert.deepEqual(me(g).captives, captives(1), 'a Barbarian Captive was paid');
  assert.ok(logged(g, /pays 1 Captive for Tribute Empire \(Acamapichtli\)/));
  assert.deepEqual(ofType(g.drainEvents(), 'sacrifice').map((e) => e.from), [BARBARIAN]);
});

test('Acamapichtli: the loan needs him in the city, and a people with Tribute Empire of its own pays no Captive', () => {
  const { g, cap } = lead('aztecs', 'acamapichtli');
  const foe = town(g, 1, beside(g, cap.hex));
  me(g).captives = captives(1);
  leaderUnit(g.s, 0).hex = elsewhere(g, cap.hex);
  assert.match(refused(g, gather(capitalOf(g), foe.hex)), /cannot collect from that space/);

  const own = lead('aztecs', 'acamapichtli');
  power(own.g, 0, 'tribute_empire');
  const town2 = town(own.g, 1, beside(own.g, own.cap.hex));
  me(own.g).captives = captives(1);
  act(own.g, gather(own.cap, town2.hex));
  assert.equal(me(own.g).res.food, 1);
  assert.equal(me(own.g).captives.length, 1, 'Tribute Empire needs no Captive');
  assert.ok(!logged(own.g, /Captive for Tribute Empire/));
});

// ================================================================== Babylonia
const improve = (...cities) => ({ type: 'happiness', cities: cities.map((c) => ({ city: c.id, hammurabi: true })) });

test('Hammurabi: a civic improvement raises his city straight to Happy for 1 Culture token', () => {
  for (const mood of ['angry', 'neutral']) {
    const { g, cap } = lead('babylonia', 'hammurabi');
    cap.mood = mood;
    stock(g, 0, { culture: 2 });
    act(g, improve(cap));
    assert.equal(cap.mood, 'happy', mood);
    assert.equal(me(g).culture, 1);
    assert.equal(g.s.turn.actionsLeft, 2);
    assert.equal(g.s.turn.activated[cap.id], undefined, 'Increase Happiness activates no city');
  }
});

test('Hammurabi: only his own city, only below Happy, and only for a Culture token', () => {
  const { g, cap } = lead('babylonia', 'hammurabi');
  cap.mood = 'neutral';
  stock(g, 0, { mood: 5 });
  assert.match(refused(g, improve(cap)), /1 Culture token/);
  stock(g, 0, { culture: 1 });
  capitalOf(g).mood = 'happy';
  assert.match(refused(g, improve(cap)), /above Happy/);
  const other = secondCity(g, capitalOf(g), 'neutral');
  assert.match(refused(g, improve(other)), /Hammurabi must be in that city/);
  assert.match(refused(g, { type: 'happiness', cities: [{ city: other.id, steps: 1 }] }), /Mood token/, 'the others pay the usual Mood');
});

test('Hammurabi: a Fortress in his city costs only the Ore; another Building costs the usual price', () => {
  const { g, cap } = lead('babylonia', 'hammurabi');
  const other = secondCity(g, cap);
  give(g, 0, { advances: ['tactics', 'bartering'] });
  stock(g, 0, { ore: 1 });
  assert.match(refused(g, construct(other, 'fortress')), /A building costs/, 'not in another city');
  assert.match(refused(g, construct(cap, 'market')), /A building costs/, 'not another Building');
  act(g, construct(cap, 'fortress'));
  assert.equal(capitalOf(g).buildings.fortress, 0);
  assert.equal(me(g).res.ore, 0);
  assert.equal(g.s.turn.actionsLeft, 2);
});

// ================================================================== Egypt
test('Imhotep: his city earns 1 Idea whenever it is activated for something other than a Collect', () => {
  const { g, cap } = lead('egypt', 'imhotep');
  const other = secondCity(g, cap);
  give(g, 0, { advances: ['bartering'] });
  stock(g, 0, { food: 1, wood: 1, ore: 1 });
  act(g, gather(cap, ...ring(g, cap.hex, 1).slice(0, 1)));
  assert.equal(me(g).res.ideas, 0, 'a Collect earns nothing');
  act(g, construct(cap, 'market'));
  assert.equal(me(g).res.ideas, 1);
  assert.ok(logged(g, /gains 1 idea \(Imhotep\)/));
  stock(g, 0, { food: 1, wood: 1, ore: 1 });
  act(g, construct(other, 'market'));
  assert.equal(me(g).res.ideas, 0, 'another city of his people earns nothing');
});

test('Imhotep: an Observatory in his city costs only the Ore', () => {
  const { g, cap } = lead('egypt', 'imhotep');
  const other = secondCity(g, cap);
  give(g, 0, { advances: ['math'] });
  stock(g, 0, { ore: 1 });
  const cards = me(g).hand.action.length;
  assert.match(refused(g, construct(other, 'observatory')), /A building costs/);
  act(g, construct(cap, 'observatory'));
  assert.equal(capitalOf(g).buildings.observatory, 0);
  assert.equal(me(g).res.ore, 0);
  assert.equal(me(g).hand.action.length, cards + 1, 'the Observatory still draws its Action card');
  assert.equal(me(g).res.ideas, 1, 'and the activation earns the Idea');
});

test('Ramses II: an Obelisk gives 1 Culture token or 2 Ideas, as the player chooses', () => {
  const cases = [
    { answers: {}, culture: 1, ideas: 0 },
    { answers: { ramses: 'culture' }, culture: 1, ideas: 0 },
    { answers: { ramses: 'ideas' }, culture: 0, ideas: 2 },
  ];
  for (const { answers, culture, ideas } of cases) {
    const { g, cap } = lead('egypt', 'ramses');
    secondCity(g, cap);
    give(g, 0, { advances: ['arts'] });
    stock(g, 0, { food: 1, wood: 1, ore: 1 });
    asking(g, answers);
    act(g, construct(cap, 'obelisk'));
    assert.deepEqual([me(g).culture, me(g).res.ideas], [culture, ideas], JSON.stringify(answers));
  }
});

test('Ramses II: only he is asked; another Leader of Egypt takes the Obelisk without a question', () => {
  const { g, cap } = lead('egypt', 'cleopatra');
  secondCity(g, cap);
  give(g, 0, { advances: ['arts'] });
  stock(g, 0, { food: 1, wood: 1, ore: 1 });
  const asked = asking(g);
  act(g, construct(cap, 'obelisk'));
  assert.deepEqual(asked.map((q) => q.kind), []);
  assert.deepEqual([me(g).culture, me(g).res.ideas], [0, 0]);
});

// ================================================================== Maya
test('Pakal: with Settlers only, the group moves 2 spaces in one Move, which needs Tactics because he is an Army unit', () => {
  const { g, cap, unit } = lead('maya', 'pakal');
  const settler = settlerOf(g);
  const to = ring(g, cap.hex, 2)[0];
  assert.match(refused(g, { type: 'move', units: [unit.id, settler.id], to }), /You need Tactics/);
  give(g, 0, { advances: ['tactics'] });
  act(g, { type: 'move', units: [unit.id, settler.id], to });
  assert.equal(unitById(g.s, unit.id).hex, to);
  assert.equal(unitById(g.s, settler.id).hex, to);
  assert.equal(g.s.turn.actionsLeft, 2);
});

test('Pakal: alone or with another Army unit he moves 1 space like everybody else', () => {
  const { g, cap, unit } = lead('maya', 'pakal');
  give(g, 0, { advances: ['tactics'] });
  const settler = settlerOf(g);
  const [infantry] = troops(g, 0, 'infantry', cap.hex);
  const to = ring(g, cap.hex, 2)[0];
  assert.match(refused(g, { type: 'move', units: [unit.id], to }), /too far/);
  assert.match(refused(g, { type: 'move', units: [unit.id, settler.id, infantry.id], to }), /too far/);
  act(g, { type: 'move', units: [unit.id, settler.id], to: ring(g, cap.hex, 1)[0] });
  assert.equal(g.s.turn.actionsLeft, 2, 'a space away is a Move like any other');
});

test('Pakal: a Culture token pays any 2 resources when his city grows, mixed kinds included', () => {
  const cases = [
    { have: { culture: 2 }, ok: true, left: 0, why: '2 tokens pay the 3 resources of a Building' },
    { have: { food: 1, culture: 1 }, ok: true, left: 0, why: '1 token pays Wood and Ore together' },
    { have: { wood: 1, ore: 1, culture: 1 }, ok: true, left: 0, why: 'a token may pay a single resource' },
    { have: { food: 1, wood: 1, ore: 1, culture: 1 }, ok: true, left: 1, why: 'resources are paid first' },
    { have: { culture: 1 }, ok: false, why: '1 token is only 2 resources' },
  ];
  for (const { have, ok, left, why } of cases) {
    const { g, cap } = lead('maya', 'pakal');
    secondCity(g, cap);
    give(g, 0, { advances: ['bartering'] });
    stock(g, 0, have);
    if (!ok) {
      assert.match(refused(g, construct(cap, 'market')), /A building costs/, why);
      continue;
    }
    act(g, construct(cap, 'market'));
    assert.equal(capitalOf(g).buildings.market, 0, why);
    assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore, me(g).culture], [0, 0, 0, left], why);
  }
});

test('Pakal: the Culture tokens pay only in his city', () => {
  const { g, cap } = lead('maya', 'pakal');
  const other = secondCity(g, cap);
  give(g, 0, { advances: ['bartering'] });
  stock(g, 0, { culture: 2 });
  assert.match(refused(g, construct(other, 'market')), /A building costs/);
  leaderUnit(g.s, 0).hex = elsewhere(g, cap.hex);
  assert.match(refused(g, construct(cap, 'market')), /A building costs/);
});

// ================================================================== Huns
test('Attila: a size 1 city he is in acts as one size larger when collecting or recruiting, unless it is Angry', () => {
  const collect = lead('huns', 'attila');
  collect.cap.mood = 'neutral';
  assert.equal(cityCapacity(collect.g.s, collect.cap), 2);
  act(collect.g, gather(collect.cap, ...ring(collect.g, collect.cap.hex, 1).slice(0, 2)));
  assert.equal(me(collect.g).res.food, 2, 'two spaces of a size 1 city');

  const recruit = lead('huns', 'attila');
  recruit.cap.mood = 'neutral';
  stock(recruit.g, 0, { food: 2, ore: 2 });
  act(recruit.g, { type: 'recruit', city: recruit.cap.id, units: { infantry: 2 } });
  assert.equal(recruit.g.s.units.filter((u) => u.owner === 0 && u.type === 'infantry').length, 2);

  const angry = lead('huns', 'attila');
  angry.cap.mood = 'angry';
  assert.equal(cityCapacity(angry.g.s, angry.cap), 1);
  assert.match(refused(angry.g, gather(angry.cap, ...ring(angry.g, angry.cap.hex, 1).slice(0, 2))), /at most 1 Resource/);
});

test('Attila: only a size 1 city he is in; a larger city or one he is away from acts as usual', () => {
  const { g, cap } = lead('huns', 'attila');
  cap.mood = 'neutral';
  cap.buildings.temple = 0;
  assert.equal(cityCapacity(g.s, cap), 2, 'size 2 is size 2');
  delete cap.buildings.temple;
  leaderUnit(g.s, 0).hex = elsewhere(g, cap.hex);
  assert.equal(cityCapacity(g.s, cap), 1);
});

test('Bleda: his city acts as Happy on its first activation, whatever its Mood, and the Mood itself stays', () => {
  const { g, cap } = lead('huns', 'bleda');
  cap.mood = 'angry';
  const spaces = ring(g, cap.hex, 1).slice(0, 2);
  act(g, gather(cap, ...spaces));
  assert.equal(me(g).res.food, 2, 'an Angry size 1 city collects 1 space, a Happy one 2');
  assert.equal(cap.mood, 'angry');
  assert.match(refused(g, gather(cap, spaces[0])), /Angry cities can only be activated once per turn/);
});

test('Bleda: a Neutral city is Happy only the first time; the second activation is a normal one', () => {
  const { g, cap } = lead('huns', 'bleda');
  cap.mood = 'neutral';
  const [a, b] = ring(g, cap.hex, 1);
  act(g, gather(cap, a, b));
  assert.equal(me(g).res.food, 2);
  assert.equal(cap.mood, 'neutral');
  assert.match(refused(g, gather(cap, cap.hex, b)), /at most 1 Resource/, 'Neutral now');
  act(g, gather(cap, cap.hex));
  assert.equal(capitalOf(g).mood, 'angry', 'the second activation costs the usual Mood');
});

// ================================================================== Influence
const influence = (city, target, extra) => ({ type: 'influence', city: city.id, target: target.id, ...extra });
const kinds = (asked) => asked.map((q) => q.kind);

test('Cleopatra: the city she is in has 1 more space of Influence range, and only while she is there', () => {
  const near = lead('egypt', 'cleopatra');
  const foe = town(near.g, 1, ring(near.g, near.cap.hex, 2)[0], 'neutral', ['temple']);
  assert.equal(influenceRange(near.g.s, 0, near.cap), 2);
  rigRolls(near.g, 5);
  act(near.g, influence(near.cap, foe));
  assert.equal(foe.buildings.temple, 0, 'a size 1 city reaches 2 spaces');

  const plain = lead('egypt', 'imhotep');
  const far = town(plain.g, 1, ring(plain.g, plain.cap.hex, 2)[0], 'neutral', ['temple']);
  assert.equal(influenceRange(plain.g.s, 0, plain.cap), 1);
  assert.match(refused(plain.g, influence(plain.cap, far)), /out of range/);

  const away = lead('egypt', 'cleopatra');
  const distant = town(away.g, 1, ring(away.g, away.cap.hex, 2)[0], 'neutral', ['temple']);
  leaderUnit(away.g.s, 0).hex = elsewhere(away.g, away.cap.hex);
  assert.match(refused(away.g, influence(capitalOf(away.g), distant)), /out of range/);
});

test('Cleopatra: her range comes on top of what a city gets from its size', () => {
  const { g, cap } = lead('egypt', 'cleopatra');
  cap.buildings.temple = 0;
  assert.equal(influenceRange(g.s, 0, cap), 3, 'size 2 and Cleopatra');
  const foe = town(g, 1, ring(g, cap.hex, 3)[0], 'neutral', ['temple']);
  rigRolls(g, 6);
  act(g, influence(cap, foe));
  assert.equal(cityNow(g, foe).buildings.temple, 0);
});

test('Darius: a successful Influence Culture from his city gives 1 Mood token; a failed one gives none', () => {
  for (const [face, mood] of [[5, 1], [4, 0]]) {
    const { g, cap } = lead('persia', 'darius');
    const foe = town(g, 1, ring(g, cap.hex, 1)[0], 'neutral', ['temple']);
    rigRolls(g, face);
    act(g, influence(cap, foe));
    assert.equal(me(g).mood, mood, `a roll of ${face}`);
    if (mood) assert.ok(logged(g, /gains 1 Mood token \(Darius\)/));
  }
});

test('Darius: an attempt of another city of his people gives no Mood', () => {
  const { g, cap } = lead('persia', 'darius');
  const other = secondCity(g, cap);
  const foe = town(g, 1, beside(g, other.hex), 'neutral', ['temple']);
  rigRolls(g, 5);
  act(g, influence(other, foe));
  assert.equal(foe.buildings.temple, 0);
  assert.equal(me(g).mood, 0);
});

test('Ashoka: his city rerolls a failed attempt once per turn when it has a Temple or aims at one', () => {
  const temple = lead('india', 'ashoka');
  temple.cap.buildings.temple = 0;
  const foe = town(temple.g, 1, ring(temple.g, temple.cap.hex, 1)[0], 'neutral', ['market']);
  const asked = asking(temple.g, {});
  rigRolls(temple.g, 2, 5);
  act(temple.g, influence(temple.cap, foe));
  assert.deepEqual(kinds(asked), ['ashoka_reroll'], 'a Temple of his own');
  assert.equal(foe.buildings.market, 0, 'the second roll worked');
  assert.ok(logged(temple.g, /rerolls the attempt \(Ashoka\): 5/));

  const aim = lead('india', 'ashoka');
  const other = town(aim.g, 1, ring(aim.g, aim.cap.hex, 1)[0], 'neutral', ['temple']);
  const asked2 = asking(aim.g, {});
  rigRolls(aim.g, 1, 6);
  act(aim.g, influence(aim.cap, other));
  assert.deepEqual(kinds(asked2), ['ashoka_reroll'], 'a Temple to influence');
  assert.equal(other.buildings.temple, 0);
});

test('Ashoka: no reroll without a Temple on either side, and nothing when the player declines', () => {
  const none = lead('india', 'ashoka');
  const foe = town(none.g, 1, ring(none.g, none.cap.hex, 1)[0], 'neutral', ['market']);
  const asked = asking(none.g, {});
  rigRolls(none.g, 2);
  act(none.g, influence(none.cap, foe));
  assert.deepEqual(kinds(asked), []);
  assert.equal(foe.buildings.market, 1);

  const decline = lead('india', 'ashoka');
  const temple = town(decline.g, 1, ring(decline.g, decline.cap.hex, 1)[0], 'neutral', ['temple']);
  const asked2 = asking(decline.g, { ashoka_reroll: 'no' });
  rigRolls(decline.g, 2);
  act(decline.g, influence(decline.cap, temple));
  assert.deepEqual(kinds(asked2), ['ashoka_reroll']);
  assert.equal(temple.buildings.temple, 1);
  assert.ok(!logged(decline.g, /rerolls the attempt/));
});

test('Ashoka: only one reroll a turn, and it is not used up by a refusal', () => {
  const { g, cap } = lead('india', 'ashoka');
  const foe = town(g, 1, ring(g, cap.hex, 1)[0], 'neutral', ['temple']);
  const asked = asking(g, {});
  rigRolls(g, 2, 3, 2);
  act(g, influence(cap, foe));
  assert.equal(foe.buildings.temple, 1, 'both rolls failed');
  act(g, influence(cap, foe));
  assert.deepEqual(kinds(asked), ['ashoka_reroll'], 'the second attempt of the turn has no reroll');
  assert.equal(g.s.turn.actionsLeft, 1);
});

test('Siyaj Kak: when his city grows, an Influence attempt from it costs no action, and the new size counts for the range', () => {
  const { g, cap } = lead('maya', 'siyaj_kak');
  secondCity(g, cap);
  give(g, 0, { advances: ['bartering'] });
  const foe = town(g, 1, ring(g, cap.hex, 2)[0], 'neutral', ['temple']);
  stock(g, 0, { food: 1, wood: 1, ore: 1 });
  const asked = asking(g, {});
  rigRolls(g, 5);
  act(g, construct(cap, 'market'));
  assert.deepEqual(kinds(asked), ['leader_influence']);
  assert.equal(cityNow(g, foe).buildings.temple, 0, 'size 2 reaches the city two spaces away');
  assert.equal(g.s.turn.actionsLeft, 2, 'the Construct cost the only action');
  assert.equal(g.s.turn.influenceSuccess, true);
});

test('Siyaj Kak: the attempt is optional, and there is none after an Influence success this turn or without a target', () => {
  const decline = lead('maya', 'siyaj_kak');
  secondCity(decline.g, decline.cap);
  give(decline.g, 0, { advances: ['bartering'] });
  const foe = town(decline.g, 1, ring(decline.g, decline.cap.hex, 1)[0], 'neutral', ['temple']);
  stock(decline.g, 0, { food: 1, wood: 1, ore: 1 });
  const asked = asking(decline.g, { leader_influence: 'no' });
  act(decline.g, construct(decline.cap, 'market'));
  assert.deepEqual(kinds(asked), ['leader_influence']);
  assert.equal(foe.buildings.temple, 1);

  const done = lead('maya', 'siyaj_kak');
  secondCity(done.g, done.cap);
  give(done.g, 0, { advances: ['bartering'] });
  const first = town(done.g, 1, ring(done.g, done.cap.hex, 1)[0], 'neutral', ['temple']);
  rigRolls(done.g, 5);
  act(done.g, influence(done.cap, first));
  stock(done.g, 0, { food: 1, wood: 1, ore: 1 });
  const asked2 = asking(done.g, {});
  act(done.g, construct(capitalOf(done.g), 'market'));
  assert.deepEqual(kinds(asked2), [], 'one success a turn is all there is');

  const empty = lead('maya', 'siyaj_kak');
  secondCity(empty.g, empty.cap);
  give(empty.g, 0, { advances: ['bartering'] });
  stock(empty.g, 0, { food: 1, wood: 1, ore: 1 });
  const asked3 = asking(empty.g, {});
  act(empty.g, construct(empty.cap, 'market'));
  assert.deepEqual(kinds(asked3), [], 'nobody to influence');
});

test('Siyaj Kak: a Wonder makes his city larger too, and another city of his people makes no attempt', () => {
  const wonder = lead('maya', 'siyaj_kak');
  secondCity(wonder.g, wonder.cap);
  give(wonder.g, 0, { advances: ['engineering', 'rituals'], wonders: ['great_pyramid'] });
  const foe = town(wonder.g, 1, ring(wonder.g, wonder.cap.hex, 2)[0], 'neutral', ['temple']);
  stock(wonder.g, 0, { food: 2, wood: 3, ore: 7, culture: 5 });
  const asked = asking(wonder.g, {});
  rigRolls(wonder.g, 5);
  act(wonder.g, { type: 'construct_wonder', city: wonder.cap.id, wonder: 'great_pyramid' });
  assert.deepEqual(kinds(asked), ['leader_influence']);
  assert.equal(cityNow(wonder.g, foe).buildings.temple, 0);

  const other = lead('maya', 'siyaj_kak');
  const second = secondCity(other.g, other.cap);
  give(other.g, 0, { advances: ['bartering'] });
  town(other.g, 1, beside(other.g, second.hex), 'neutral', ['temple']);
  stock(other.g, 0, { food: 1, wood: 1, ore: 1 });
  const asked2 = asking(other.g, {});
  act(other.g, construct(second, 'market'));
  assert.deepEqual(kinds(asked2), [], 'he stands in the capital');
});

// ================================================================== Greece
test('Leonidas: a Draft recruit in his city gives 1 Culture token', () => {
  const { g, cap } = lead('greece', 'leonidas');
  give(g, 0, { advances: ['draft'] });
  stock(g, 0, { mood: 1 });
  act(g, { type: 'recruit', city: cap.id, units: { infantry: 1 }, draft: true });
  assert.deepEqual([me(g).mood, me(g).culture], [0, 1]);
  assert.ok(logged(g, /gains 1 Culture token \(Leonidas\)/));
});

test('Leonidas: no Culture for an ordinary recruit, or for a Draft in another city', () => {
  const plain = lead('greece', 'leonidas');
  give(plain.g, 0, { advances: ['draft'] });
  stock(plain.g, 0, { food: 1, ore: 1 });
  act(plain.g, { type: 'recruit', city: plain.cap.id, units: { infantry: 1 } });
  assert.equal(me(plain.g).culture, 0);

  const away = lead('greece', 'leonidas');
  const other = secondCity(away.g, away.cap);
  give(away.g, 0, { advances: ['draft'] });
  stock(away.g, 0, { mood: 1 });
  act(away.g, { type: 'recruit', city: other.id, units: { infantry: 1 }, draft: true });
  assert.equal(me(away.g).culture, 0);
});

// ================================================================== Japan
test('Go-Toba: after an Academy or an Apothecary in his city he researches an Advance at the usual price and for no action', () => {
  for (const [building, advance, res] of [
    ['academy', 'writing', { food: 1, wood: 1, ore: 1 }],
    ['observatory', 'math', { food: 1, wood: 1, ore: 1, gold: 2 }],
  ]) {
    const { g, cap } = lead('japan', 'go_toba');
    secondCity(g, cap);
    give(g, 0, { advances: [advance] });
    stock(g, 0, res);
    const asked = asking(g, { leader_advance: 'myths' });
    act(g, construct(cap, building));
    assert.deepEqual(kinds(asked), ['leader_advance'], building);
    const options = asked[0].options.map((o) => o.id);
    assert.ok(options.includes('myths') && options.includes('none'), building);
    assert.ok(me(g).advances.includes('myths'), building);
    assert.equal(g.s.turn.actionsLeft, 2, `${building}: the Construct was the only action`);
    assert.deepEqual([me(g).res.ideas, me(g).res.gold], [0, 0], `${building}: the Advance was paid with the Ideas or the Gold`);
  }
});

test('Go-Toba: he may decline, and no other Building, city or Leader position gives the Advance', () => {
  const decline = lead('japan', 'go_toba');
  secondCity(decline.g, decline.cap);
  give(decline.g, 0, { advances: ['writing'] });
  stock(decline.g, 0, { food: 1, wood: 1, ore: 1 });
  const asked = asking(decline.g, {});
  act(decline.g, construct(decline.cap, 'academy'));
  assert.deepEqual(kinds(asked), ['leader_advance']);
  assert.deepEqual([me(decline.g).advances.includes('myths'), me(decline.g).res.ideas], [false, 2], 'the default is no Advance, and the Ideas stay');

  const market = lead('japan', 'go_toba');
  secondCity(market.g, market.cap);
  give(market.g, 0, { advances: ['bartering'] });
  stock(market.g, 0, { food: 1, wood: 1, ore: 1, ideas: 2 });
  const asked2 = asking(market.g, { leader_advance: 'myths' });
  act(market.g, construct(market.cap, 'market'));
  assert.deepEqual(kinds(asked2), [], 'only an Academy or an Apothecary');

  const other = lead('japan', 'go_toba');
  const second = secondCity(other.g, other.cap);
  give(other.g, 0, { advances: ['writing'] });
  stock(other.g, 0, { food: 1, wood: 1, ore: 1 });
  const asked3 = asking(other.g, { leader_advance: 'myths' });
  act(other.g, construct(second, 'academy'));
  assert.deepEqual(kinds(asked3), [], 'he stands in the capital');

  const away = lead('japan', 'go_toba');
  secondCity(away.g, away.cap);
  give(away.g, 0, { advances: ['writing'] });
  stock(away.g, 0, { food: 1, wood: 1, ore: 1 });
  leaderUnit(away.g.s, 0).hex = elsewhere(away.g, away.cap.hex);
  const asked4 = asking(away.g, { leader_advance: 'myths' });
  act(away.g, construct(away.cap, 'academy'));
  assert.deepEqual(kinds(asked4), []);
});

test('Go-Toba: an Apothecary that leaves nothing to pay an Advance with offers none', () => {
  const { g, cap } = lead('japan', 'go_toba');
  secondCity(g, cap);
  give(g, 0, { advances: ['math', 'engineering', 'roads'] });
  stock(g, 0, { food: 1, wood: 1, ore: 1 });
  const asked = asking(g, { leader_advance: 'myths' });
  act(g, construct(cap, 'observatory'));
  assert.deepEqual(kinds(asked), [], 'an Apothecary pays no Ideas, and Math makes Engineering and Roads free: those are taken');
  assert.ok(!me(g).advances.includes('myths'));
});

// ================================================================== Wonders
const wonderIn = (city, id) => ({ type: 'construct_wonder', city: city.id, wonder: id });

/** A Leader in his capital, a second city (so that the capital may grow), Engineering and these Advances. */
function builder(civ, leader, ...advances) {
  const f = lead(civ, leader);
  f.other = secondCity(f.g, f.cap);
  give(f.g, 0, { advances: ['engineering', 'storage', ...advances] });
  return f;
}

test('Nebuchadnezzar II: he builds the Great Gardens in his city without the card, from the deck, for 1 Culture and 2 resources less', () => {
  const { g, cap } = builder('babylonia', 'nebuchadnezzar', 'irrigation');
  assert.ok(g.s.decks.wonder.includes('great_gardens') && !me(g).hand.wonder.includes('great_gardens'));
  assert.ok(wonderChoices(g.s, 0, cap).includes('great_gardens'));
  assert.deepEqual(wonderCost(g.s, 0, cap, 'great_gardens'), { food: 4, wood: 4, ore: 2, culture: 4 });
  stock(g, 0, { food: 4, wood: 4, ore: 2, culture: 4 });
  act(g, wonderIn(cap, 'great_gardens'));
  assert.deepEqual(cityNow(g, cap).wonders, [{ id: 'great_gardens', builder: 0 }]);
  assert.ok(!g.s.decks.wonder.includes('great_gardens'), 'the card left the deck');
  assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore, me(g).culture], [0, 0, 0, 0]);
  assert.equal(g.s.turn.actionsLeft, 2);
});

test('Nebuchadnezzar II: a card in his own hand is used first, and one in another hand is taken for a replacement', () => {
  const own = builder('babylonia', 'nebuchadnezzar', 'irrigation');
  give(own.g, 0, { wonders: ['great_gardens'] });
  const left = own.g.s.decks.wonder.length;
  stock(own.g, 0, { food: 4, wood: 4, ore: 2, culture: 4 });
  act(own.g, wonderIn(own.cap, 'great_gardens'));
  assert.deepEqual([me(own.g).hand.wonder, own.g.s.decks.wonder.length], [[], left], 'his own card, no draw from the deck');

  const theirs = builder('babylonia', 'nebuchadnezzar', 'irrigation');
  give(theirs.g, 1, { wonders: ['great_gardens'] });
  const before = theirs.g.s.decks.wonder.length;
  stock(theirs.g, 0, { food: 4, wood: 4, ore: 2, culture: 4 });
  act(theirs.g, wonderIn(theirs.cap, 'great_gardens'));
  assert.equal(cityNow(theirs.g, theirs.cap).wonders.length, 1);
  const rival = theirs.g.s.players[1];
  assert.equal(rival.hand.wonder.length, 1, 'the other player draws a replacement');
  assert.ok(!rival.hand.wonder.includes('great_gardens'));
  assert.equal(theirs.g.s.decks.wonder.length, before - 1);
  assert.ok(logged(theirs.g, /takes the card from .* who draws a replacement/));
});

test('Nebuchadnezzar II: only in the city he is in, only while the Great Gardens are not built, and only himself', () => {
  const away = builder('babylonia', 'nebuchadnezzar', 'irrigation');
  stock(away.g, 0, { food: 4, wood: 4, ore: 2, culture: 4 });
  assert.match(refused(away.g, wonderIn(away.other, 'great_gardens')), /do not hold that Wonder card/, 'he stands in the capital');
  leaderUnit(away.g.s, 0).hex = away.other.hex;
  act(away.g, wonderIn(away.other, 'great_gardens'));
  assert.equal(cityNow(away.g, away.other).wonders.length, 1, 'it goes up in whichever city he is in');

  const built = builder('babylonia', 'nebuchadnezzar', 'irrigation');
  stock(built.g, 0, { food: 4, wood: 4, ore: 2, culture: 4 });
  town(built.g, 1, ring(built.g, built.cap.hex, 2)[0]).wonders.push({ id: 'great_gardens', builder: 1 });
  assert.match(refused(built.g, wonderIn(built.cap, 'great_gardens')), /do not hold that Wonder card/);

  const other = builder('babylonia', 'hammurabi', 'irrigation');
  stock(other.g, 0, { food: 5, wood: 5, ore: 2, culture: 5 });
  assert.match(refused(other.g, wonderIn(other.cap, 'great_gardens')), /do not hold that Wonder card/);
});

test('Qin Shi Huang: he builds the Great Wall in his city without the card, for 1 Culture and 2 resources less', () => {
  const { g, cap, other } = builder('china', 'qin', 'siegecraft');
  stock(g, 0, { food: 3, wood: 2, ore: 5, culture: 4 });
  assert.deepEqual(wonderCost(g.s, 0, cap, 'great_wall'), { food: 3, wood: 2, ore: 5, culture: 4 });
  assert.match(refused(g, wonderIn(other, 'great_wall')), /do not hold that Wonder card/);
  act(g, wonderIn(capitalOf(g), 'great_wall'));
  assert.deepEqual(capitalOf(g).wonders, [{ id: 'great_wall', builder: 0 }]);
  assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore, me(g).culture], [0, 0, 0, 0]);
  assert.ok(!wonderChoices(g.s, 0, capitalOf(g)).includes('great_gardens'), 'the Great Gardens are Nebuchadnezzar\'s');
});

test('Xerxes: any Wonder in his city costs 2 fewer resources or Culture tokens, in any mix', () => {
  const { g, cap, other } = builder('persia', 'xerxes', 'rituals');
  give(g, 0, { wonders: ['great_pyramid'] });
  assert.equal(Object.values(wonderCost(g.s, 0, cap, 'great_pyramid')).reduce((a, b) => a + b, 0), 15, '17 less 2');
  assert.equal(Object.values(wonderCost(g.s, 0, other, 'great_pyramid')).reduce((a, b) => a + b, 0), 17, 'full price elsewhere');
  stock(g, 0, { food: 2, wood: 3, ore: 7, culture: 3 });
  assert.match(refused(g, wonderIn(other, 'great_pyramid')), /cannot afford/);
  act(g, wonderIn(capitalOf(g), 'great_pyramid'));
  assert.equal(capitalOf(g).wonders.length, 1);

  const mixed = builder('persia', 'xerxes', 'rituals');
  give(mixed.g, 0, { wonders: ['great_pyramid'] });
  stock(mixed.g, 0, { food: 2, wood: 3, ore: 6, culture: 4 });
  act(mixed.g, wonderIn(mixed.cap, 'great_pyramid'));
  assert.equal(cityNow(mixed.g, mixed.cap).wonders.length, 1, 'one Ore and one Culture token fewer');
  assert.deepEqual([me(mixed.g).res.ore, me(mixed.g).culture], [0, 0]);
});

// ================================================================== Celts
/** The nearest space to `from`, 2 or more steps away, where a Settler could found a city. */
const site = (g, from) => allHexKeys(g.s)
  .filter((k) => free(g, k) && !foundBlocked(g.s, 0, k) && hexDistance(from, k) >= 2)
  .sort((a, b) => hexDistance(from, a) - hexDistance(from, b))[0];

/** A Leader and a Settler on a space of their own, ready to found a city. */
function settling(civ, leader) {
  const f = lead(civ, leader);
  f.spot = site(f.g, f.cap.hex);
  leaderUnit(f.g.s, 0).hex = f.spot;
  f.settler = troops(f.g, 0, 'settler', f.spot)[0];
  return f;
}

test('Boudica: when her Settler founds a city, 1 Food keeps the Settler', () => {
  const { g, spot, settler } = settling('celts', 'boudica');
  stock(g, 0, { food: 1 });
  act(g, { type: 'found_city', unit: settler.id, keep: true });
  assert.equal(cityAt(g.s, spot).owner, 0);
  assert.ok(unitById(g.s, settler.id), 'the Settler stays');
  assert.equal(me(g).res.food, 0);
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.ok(logged(g, /pays 1 food to keep the Settler \(Queen Boudica\)/));

  const plain = settling('celts', 'boudica');
  act(plain.g, { type: 'found_city', unit: plain.settler.id });
  assert.ok(!unitById(plain.g.s, plain.settler.id), 'the Settler is spent without the Food');
});

test('Boudica: keeping the Settler needs 1 Food, her company and her', () => {
  const poor = settling('celts', 'boudica');
  assert.match(refused(poor.g, { type: 'found_city', unit: poor.settler.id, keep: true }), /costs 1 Food/);

  const away = settling('celts', 'boudica');
  stock(away.g, 0, { food: 1 });
  leaderUnit(away.g.s, 0).hex = away.cap.hex;
  assert.match(refused(away.g, { type: 'found_city', unit: away.settler.id, keep: true }), /Only Queen Boudica/);

  const other = settling('celts', 'vercingetorix');
  stock(other.g, 0, { food: 1 });
  assert.match(refused(other.g, { type: 'found_city', unit: other.settler.id, keep: true }), /Only Queen Boudica/);
});

test('Vercingetorix: each unit he builds goes to the city or to a free Land space next to it', () => {
  const { g, cap } = lead('celts', 'vercingetorix');
  cap.buildings.temple = 0;
  stock(g, 0, { food: 2, ore: 2 });
  const spots = deployHexes(g.s, 0, cap);
  assert.ok(spots.length >= 2, 'the capital has Land neighbours');
  const picks = [spots[0], spots[1]];
  const asked = asking(g, { pick_hex: () => picks.shift() });
  act(g, { type: 'recruit', city: cap.id, units: { infantry: 2 } });
  assert.deepEqual(kinds(asked), ['pick_hex', 'pick_hex']);
  assert.deepEqual(g.s.units.filter((u) => u.owner === 0 && u.type === 'infantry').map((u) => u.hex).sort(), [spots[0], spots[1]].sort());
  assert.ok(logged(g, /deploys a infantry on .* \(Vercingetorix\)/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Vercingetorix: no space with enemy units, an enemy city, the sea or a full stack is offered, and the default is the city', () => {
  const { g, cap } = lead('celts', 'vercingetorix');
  cap.buildings.temple = 0;
  stock(g, 0, { food: 1, ore: 1 });
  const [soldiers, city, sea, full, ...open] = deployHexes(g.s, 0, cap);
  assert.ok(open.length >= 1, 'the capital has enough Land neighbours');
  troops(g, 1, 'infantry', soldiers);
  town(g, 1, city);
  setTerrain(g, sea, 'sea');
  troops(g, 0, 'infantry', full, 4);
  assert.deepEqual(deployHexes(g.s, 0, cap).sort(), [full, ...open].sort(), 'the full stack is still a Land space');
  const asked = asking(g, {});
  act(g, { type: 'recruit', city: cap.id, units: { infantry: 1 } });
  assert.deepEqual(asked[0].options.map((o) => o.id).sort(), [cap.hex, ...open].sort());
  assert.equal(g.s.units.filter((u) => u.owner === 0 && u.type === 'infantry' && u.hex === cap.hex).length, 1, 'the default leaves the unit in the city');
});

test('Vercingetorix: a stack that stays in the city is still limited to 4 Army units, and only his own city deploys', () => {
  const { g, cap } = lead('celts', 'vercingetorix');
  troops(g, 0, 'infantry', cap.hex, 3);
  stock(g, 0, { food: 1, ore: 1 });
  asking(g, { pick_hex: cap.hex });
  assert.match(refused(g, { type: 'recruit', city: cap.id, units: { infantry: 1 } }), /at most 4/);

  const other = lead('celts', 'vercingetorix');
  const second = secondCity(other.g, other.cap);
  stock(other.g, 0, { food: 1, ore: 1 });
  const asked = asking(other.g, {});
  act(other.g, { type: 'recruit', city: second.id, units: { infantry: 1 } });
  assert.deepEqual(kinds(asked), [], 'he stands in the capital');
});

// ================================================================== Carthage
test('Dido: a Settler with her founds a city at no action cost; one without her costs an action', () => {
  const { g, spot, settler } = settling('carthage', 'dido');
  act(g, { type: 'found_city', unit: settler.id });
  assert.equal(cityAt(g.s, spot).owner, 0);
  assert.equal(g.s.turn.actionsLeft, 3);

  const apart = settling('carthage', 'dido');
  leaderUnit(apart.g.s, 0).hex = apart.cap.hex;
  act(apart.g, { type: 'found_city', unit: apart.settler.id });
  assert.equal(apart.g.s.turn.actionsLeft, 2);
});

/** A free Land space next to `hex`. */
const landBeside = (g, hex) => nbrs(g.s, hex).find((k) => free(g, k) && isLand(g.s, k));

test('Hannibal: a group with an Elephant ignores the Mountain penalty, and one without it stops there', () => {
  for (const elephant of [true, false]) {
    const { g, cap, unit } = lead('carthage', 'hannibal');
    give(g, 0, { advances: ['tactics'] });
    const pass = landBeside(g, cap.hex);
    setTerrain(g, pass, 'mountain');
    const group = [unit.id, ...(elephant ? troops(g, 0, 'elephant', cap.hex).map((u) => u.id) : [])];
    act(g, { type: 'move', units: group, to: pass });
    assert.equal(unitById(g.s, unit.id).hex, pass);
    if (elephant) {
      act(g, { type: 'move', units: group, to: cap.hex });
      assert.equal(unitById(g.s, unit.id).hex, cap.hex, 'the group walks on');
    } else assert.match(refused(g, { type: 'move', units: group, to: cap.hex }), /stopped on a Mountain/);
  }
});

test('Hannibal: another Leader with an Elephant stops on a Mountain like anybody else', () => {
  const { g, cap, unit } = lead('carthage', 'dido');
  give(g, 0, { advances: ['tactics'] });
  const pass = landBeside(g, cap.hex);
  setTerrain(g, pass, 'mountain');
  const group = [unit.id, ...troops(g, 0, 'elephant', cap.hex).map((u) => u.id)];
  act(g, { type: 'move', units: group, to: pass });
  assert.match(refused(g, { type: 'move', units: group, to: cap.hex }), /stopped on a Mountain/);
});

// ================================================================== Phoenicia
const payday = (g, p = 0) => ofType(run(g, tradePhase(g, p)), 'trade')[0];

/** Phoenicia with Trade Routes and Storage: `settlers` Settlers in the capital and `foes` rival cities 2 spaces away. */
function merchant(leader, { settlers, foes }) {
  const f = lead('phoenicia', leader);
  give(f.g, 0, { advances: ['trade_routes', 'storage'] });
  troops(f.g, 0, 'settler', f.cap.hex, settlers - 1);
  ring(f.g, f.cap.hex, 2).slice(0, foes).forEach((k) => town(f.g, 1, k));
  return f;
}

test('Hiram: a trade route traced from a Settler with him comes on top of the limit of 4', () => {
  const { g } = merchant('hiram', { settlers: 5, foes: 5 });
  const routes = tradeRoutes(g.s, 0);
  assert.equal(routes.length, 5);
  assert.equal(routes.filter((r) => r.free).length, 1, 'one of them is the extra one');
  assert.deepEqual(payday(g).gain, { food: 5 });
  assert.equal(me(g).res.food, 5);
});

test('Hiram: without him, with him away from the Settlers or with no 5th partner there are 4 routes at most', () => {
  const plain = merchant('ithobaal', { settlers: 5, foes: 5 });
  assert.equal(tradeRoutes(plain.g.s, 0).length, 4);

  const away = merchant('hiram', { settlers: 5, foes: 5 });
  leaderUnit(away.g.s, 0).hex = elsewhere(away.g, away.cap.hex);
  assert.equal(tradeRoutes(away.g.s, 0).length, 4);

  const few = merchant('hiram', { settlers: 5, foes: 4 });
  const routes = tradeRoutes(few.g.s, 0);
  assert.deepEqual([routes.length, routes.filter((r) => r.free).length], [4, 0], 'nothing to add to');
});

test('Pygmalion: one route traced from a Settler with him pays 1 more Gold or Culture token, as chosen', () => {
  const gold = merchant('pygmalion', { settlers: 1, foes: 1 });
  const asked = asking(gold.g, { pygmalion_trade: 'gold' });
  assert.deepEqual(payday(gold.g).gain, { food: 1, gold: 1 });
  assert.deepEqual(kinds(asked), ['pygmalion_trade']);

  const culture = merchant('pygmalion', { settlers: 1, foes: 1 });
  asking(culture.g, {});
  assert.deepEqual(payday(culture.g).gain, { food: 1, culture: 1 }, 'the default is the Culture token');
  assert.equal(me(culture.g).culture, 1);
});

test('Pygmalion: nothing extra when he is not with the Settler, when another Leader is, or when no route is traced', () => {
  const away = merchant('pygmalion', { settlers: 1, foes: 1 });
  leaderUnit(away.g.s, 0).hex = elsewhere(away.g, away.cap.hex);
  const asked = asking(away.g, { pygmalion_trade: 'gold' });
  assert.deepEqual(payday(away.g).gain, { food: 1 });
  assert.deepEqual(kinds(asked), []);

  const other = merchant('hiram', { settlers: 1, foes: 1 });
  assert.deepEqual(payday(other.g).gain, { food: 1 });

  const none = merchant('pygmalion', { settlers: 1, foes: 0 });
  assert.equal(payday(none.g), undefined);
});

// ================================================================== Aztecs: Events
test('Marqzen: when an Event lowers the Mood of his city he may reverse it, and Myths is not needed', () => {
  const kept = lead('aztecs', 'marqzen');
  stack(kept.g, 'plague');
  const asked = asking(kept.g, {});
  run(kept.g, resolveEvent(kept.g, 0));
  assert.deepEqual(kinds(asked).filter((k) => k === 'marqzen'), ['marqzen']);
  assert.equal(capitalOf(kept.g).mood, 'happy', 'the default reverses the drop');
  assert.ok(logged(kept.g, /reverses the Mood drop .* \(Marqzen\)/));

  const lost = lead('aztecs', 'marqzen');
  stack(lost.g, 'plague');
  asking(lost.g, { marqzen: 'no' });
  run(lost.g, resolveEvent(lost.g, 0));
  assert.equal(capitalOf(lost.g).mood, 'neutral');

  const myths = lead('aztecs', 'marqzen');
  give(myths.g, 0, { advances: ['myths'] });
  stock(myths.g, 0, { mood: 2 });
  stack(myths.g, 'plague');
  const asked3 = asking(myths.g, {});
  run(myths.g, resolveEvent(myths.g, 0));
  assert.ok(!kinds(asked3).includes('myths'), 'no Mood is paid for Myths in his city');
  assert.equal(me(myths.g).mood, 2);
});

test('Marqzen: another Leader gets no reversal, and Myths is asked as usual', () => {
  const { g } = lead('aztecs', 'ahuitzotl');
  give(g, 0, { advances: ['myths'] });
  stock(g, 0, { mood: 2 });
  stack(g, 'plague');
  const asked = asking(g, { myths: 'no' });
  run(g, resolveEvent(g, 0));
  assert.deepEqual(kinds(asked).filter((k) => k === 'myths' || k === 'marqzen'), ['myths']);
  assert.equal(capitalOf(g).mood, 'neutral');
});

test('Marqzen: he may take back the units an Event takes from his city, which is what he does by default', () => {
  const kept = lead('aztecs', 'marqzen');
  const [soldier] = troops(kept.g, 0, 'infantry', kept.cap.hex);
  const settler = settlerOf(kept.g);
  stack(kept.g, 'epidemic');
  const asked = asking(kept.g, {});
  run(kept.g, resolveEvent(kept.g, 0));
  assert.deepEqual(kinds(asked).filter((k) => k === 'marqzen_units'), ['marqzen_units']);
  assert.ok(unitById(kept.g.s, soldier.id) && unitById(kept.g.s, settler.id), 'both were taken back');
  assert.ok(logged(kept.g, /takes back 2 units \(Marqzen\)/));

  const lost = lead('aztecs', 'marqzen');
  const [dead] = troops(lost.g, 0, 'infantry', lost.cap.hex);
  const spared = settlerOf(lost.g);
  stack(lost.g, 'epidemic');
  asking(lost.g, { marqzen_units: (q) => q.options.map((o) => o.id).filter((id) => id !== dead.id) });
  run(lost.g, resolveEvent(lost.g, 0));
  assert.ok(!unitById(lost.g.s, dead.id), 'the Infantry was not taken back');
  assert.ok(unitById(lost.g.s, spared.id));
});

test('Marqzen: units outside his city are not his to take back, and a Civil War may spare the Army of his Angry city', () => {
  const out = lead('aztecs', 'marqzen');
  const [soldier] = troops(out.g, 0, 'infantry', landBeside(out.g, out.cap.hex));
  stack(out.g, 'epidemic');
  asking(out.g, {});
  run(out.g, resolveEvent(out.g, 0));
  assert.ok(!unitById(out.g.s, soldier.id), 'the Infantry outside the city died');
  assert.ok(unitById(out.g.s, settlerOf(out.g).id), 'the Settler in the city was taken back');

  const war = lead('aztecs', 'marqzen');
  war.cap.mood = 'angry';
  const [first, second] = troops(war.g, 0, 'infantry', war.cap.hex, 2);
  stack(war.g, 'civil_war');
  asking(war.g, { marqzen_units: (q) => q.options.map((o) => o.id).filter((id) => id !== first.id) });
  run(war.g, resolveEvent(war.g, 0));
  assert.ok(!unitById(war.g.s, first.id), 'only the Infantry that was not taken back deserted');
  assert.ok(unitById(war.g.s, second.id));
  assert.ok(leaderUnit(war.g.s, 0), 'and so did he stay');
});

// ================================================================== Rome
test('Sulla: his city cannot be the target of foreign Cultural Influence, but a city of his own people is not protected', () => {
  const { g, cap } = lead('rome', 'sulla');
  cap.buildings.temple = 0;
  const other = secondCity(g, cap);
  other.buildings.temple = 0;
  const foe = town(g, 1, landBeside(g, cap.hex));
  assert.deepEqual(influenceTypes(g.s, 1, cap), []);
  assert.match(influenceBlocked(g.s, 1, foe, cap), /Sulla protects this city from foreign Influence/);
  assert.deepEqual(influenceTypes(g.s, 1, other), ['temple'], 'he stands in the capital');
  assert.deepEqual(influenceTypes(g.s, 0, cap), [], 'nothing of the others in it');
  act(g, { type: 'end_turn' });
  assert.equal(g.cur, 1);
  assert.match(refused(g, influence(foe, cap)), /Sulla protects this city/);

  const away = lead('rome', 'sulla');
  away.cap.buildings.temple = 0;
  leaderUnit(away.g.s, 0).hex = elsewhere(away.g, away.cap.hex);
  assert.deepEqual(influenceTypes(away.g.s, 1, away.cap), ['temple'], 'he is not in the city');
});

test('Sulla: his owner may call off a Barbarian attack on his own city, which is what happens by default', () => {
  const { g, cap } = lead('rome', 'sulla');
  const camp = landBeside(g, cap.hex);
  const [raider] = barbarians(g, 'infantry', camp);
  const asked = asking(g, {});
  const events = run(g, barbarianIncursion(g, 0));
  assert.deepEqual(kinds(asked), ['sulla_cancel']);
  assert.ok(!ofType(events, 'barbarians').some((e) => e.kind === 'move'), 'no attack');
  assert.equal(unitById(g.s, raider.id).hex, camp);
  assert.ok(logged(g, /calls off the Barbarian attack at .* \(Sulla\)/));

  const fight = lead('rome', 'sulla');
  barbarians(fight.g, 'infantry', landBeside(fight.g, fight.cap.hex));
  asking(fight.g, { sulla_cancel: 'no' });
  const events2 = run(fight.g, barbarianIncursion(fight.g, 0));
  assert.ok(ofType(events2, 'barbarians').some((e) => e.kind === 'move'), 'the attack is not called off');
});

test('Sulla: he may also call off an attack on a rival city within 2 spaces of him, but by default he does not', () => {
  const setup = () => {
    const f = lead('rome', 'sulla');
    const rival = town(f.g, 1, ring(f.g, f.cap.hex, 2).find((k) => isLand(f.g.s, k)));
    const camp = nbrs(f.g.s, rival.hex).find((k) => free(f.g, k) && isLand(f.g.s, k) && hexDistance(k, f.cap.hex) === 3);
    assert.ok(camp, 'there is a Land space behind the rival city');
    f.raider = barbarians(f.g, 'infantry', camp)[0];
    f.camp = camp;
    return f;
  };
  const by = setup();
  const asked = asking(by.g, {});
  const attack = run(by.g, barbarianIncursion(by.g, 0));
  assert.deepEqual(kinds(asked), ['sulla_cancel']);
  assert.ok(ofType(attack, 'barbarians').some((e) => e.kind === 'move'), 'the default lets them attack');

  const off = setup();
  asking(off.g, { sulla_cancel: 'yes' });
  const events = run(off.g, barbarianIncursion(off.g, 0));
  assert.ok(!ofType(events, 'barbarians').some((e) => e.kind === 'move'));
  assert.equal(unitById(off.g.s, off.raider.id).hex, off.camp);

  const far = lead('rome', 'sulla');
  const rival = town(far.g, 1, ring(far.g, far.cap.hex, 3).find((k) => isLand(far.g.s, k)));
  barbarians(far.g, 'infantry', nbrs(far.g.s, rival.hex).find((k) => free(far.g, k) && isLand(far.g.s, k) && hexDistance(k, far.cap.hex) === 4));
  const asked3 = asking(far.g, { sulla_cancel: 'yes' });
  run(far.g, barbarianIncursion(far.g, 0));
  assert.deepEqual(kinds(asked3), [], 'a city 3 spaces away is out of his reach');
});

// ================================================================== India
test('Akbar: 1 Gold whenever he is moved into one of the cities of his people', () => {
  const { g, cap, unit } = lead('india', 'akbar');
  give(g, 0, { advances: ['tactics'] });
  const home = town(g, 0, landBeside(g, cap.hex), 'happy');
  act(g, { type: 'move', units: [unit.id], to: home.hex });
  assert.equal(me(g).res.gold, 1);
  assert.ok(logged(g, /gains 1 gold \(Akbar the Great\)/));
  act(g, { type: 'move', units: [unit.id], to: cap.hex });
  assert.equal(me(g).res.gold, 2, 'and back into the capital');
});

test('Akbar: no Gold into an empty space or a city of the others, and none when another unit moves into the city', () => {
  const { g, cap, unit } = lead('india', 'akbar');
  give(g, 0, { advances: ['tactics'] });
  const [soldier] = troops(g, 0, 'infantry', cap.hex);
  const home = town(g, 0, landBeside(g, cap.hex), 'happy');
  act(g, { type: 'move', units: [soldier.id], to: home.hex });
  assert.equal(me(g).res.gold, 0, 'Akbar did not move');
  act(g, { type: 'move', units: [unit.id], to: landBeside(g, cap.hex) });
  assert.equal(me(g).res.gold, 0, 'an empty space');

  const plain = lead('india', 'maharaja');
  give(plain.g, 0, { advances: ['tactics'] });
  const next = town(plain.g, 0, landBeside(plain.g, plain.cap.hex), 'happy');
  act(plain.g, { type: 'move', units: [plain.unit.id], to: next.hex });
  assert.equal(me(plain.g).res.gold, 0, 'another Leader');
});

// ================================================================== Greece: cards
test('Alexander: an "As an Action" card played through his city costs 1 Culture token and no action', () => {
  const { g, cap } = lead('greece', 'alexander');
  secondCity(g, cap);
  hold(g, 0, 'caravan');
  stock(g, 0, { culture: 1 });
  act(g, { type: 'play_card', card: 'caravan', alexander: true });
  assert.equal(g.s.turn.actionsLeft, 3);
  assert.deepEqual([me(g).culture, me(g).res.gold], [0, 2], 'a Gold for each of the 2 cities');
  assert.equal(g.s.turn.activated[cap.id], 1, 'his city was activated');
  assert.ok(logged(g, /pays 1 Culture token and activates the city .* \(Alexander the Great\)/));

  const plain = lead('greece', 'alexander');
  secondCity(plain.g, plain.cap);
  hold(plain.g, 0, 'caravan');
  stock(plain.g, 0, { culture: 1 });
  act(plain.g, { type: 'play_card', card: 'caravan' });
  assert.deepEqual([plain.g.s.turn.actionsLeft, me(plain.g).culture], [2, 1], 'the usual way costs an action');
});

test('Alexander: the city is activated like any other, so a second card in a turn lowers its Mood', () => {
  const { g, cap } = lead('greece', 'alexander');
  secondCity(g, cap);
  hold(g, 0, 'caravan', 'pioneers');
  stock(g, 0, { culture: 2 });
  asking(g, {});
  act(g, { type: 'play_card', card: 'caravan', alexander: true });
  assert.equal(capitalOf(g).mood, 'happy');
  act(g, { type: 'play_card', card: 'pioneers', alexander: true });
  assert.equal(capitalOf(g).mood, 'neutral');
  assert.equal(g.s.turn.actionsLeft, 3);
});

test('Alexander: he needs to be in a city, 1 Culture token and a card that costs an action', () => {
  const poor = lead('greece', 'alexander');
  hold(poor.g, 0, 'caravan');
  assert.match(refused(poor.g, { type: 'play_card', card: 'caravan', alexander: true }), /You need 1 Culture token/);

  const free1 = lead('greece', 'alexander');
  hold(free1.g, 0, 'windfall');
  stock(free1.g, 0, { culture: 1 });
  assert.match(refused(free1.g, { type: 'play_card', card: 'windfall', alexander: true }), /only plays the cards that need an action/);

  const away = lead('greece', 'alexander');
  hold(away.g, 0, 'caravan');
  stock(away.g, 0, { culture: 1 });
  leaderUnit(away.g.s, 0).hex = elsewhere(away.g, away.cap.hex);
  assert.match(refused(away.g, { type: 'play_card', card: 'caravan', alexander: true }), /must be in one of your cities/);

  const other = lead('greece', 'pericles');
  hold(other.g, 0, 'caravan');
  stock(other.g, 0, { culture: 1 });
  assert.match(refused(other.g, { type: 'play_card', card: 'caravan', alexander: true }), /must be in one of your cities/);
});

// ================================================================== Vikings
test('Cnut: his city scores 1/2 VP for every space between it and the starting city', () => {
  const distant = (f) => town(f.g, 0, ring(f.g, f.cap.hex, 4).find((k) => isLand(f.g.s, k)), 'happy');
  const { g, cap } = lead('vikings', 'cnut');
  const far = distant({ g, cap });
  const base = scoreOf(g.s, 0).parts.civ;
  assert.equal(base, 0, 'in the starting city there is nothing to score');
  leaderUnit(g.s, 0).hex = far.hex;
  assert.equal(hexDistance(far.hex, me(g).homeHex), 4);
  assert.equal(scoreOf(g.s, 0).parts.civ, 2, '4 spaces are 2 VP');

  leaderUnit(g.s, 0).hex = elsewhere(g, cap.hex);
  assert.equal(scoreOf(g.s, 0).parts.civ, 0, 'he is not in a city');

  const plain = lead('vikings', 'ragnar');
  leaderUnit(plain.g.s, 0).hex = distant(plain).hex;
  assert.equal(scoreOf(plain.g.s, 0).parts.civ, 0, 'another Leader');
});

test('Cnut: Taxation through the Happy city he is in costs no Mood, activates the city and is the Taxation of the turn', () => {
  const { g, cap } = lead('vikings', 'cnut');
  give(g, 0, { advances: ['taxation'] });
  stock(g, 0, { mood: 1 });
  act(g, { type: 'taxation', cnut: cap.id, gain: { food: 1 } });
  assert.deepEqual([me(g).res.food, me(g).mood], [1, 1], 'no Mood was paid');
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.equal(g.s.turn.activated[cap.id], 1);
  assert.ok(logged(g, /collects taxes \(Cnut\)/));
  assert.match(refused(g, { type: 'taxation', gain: { food: 1 } }), /once per turn/);

  const plain = lead('vikings', 'cnut');
  give(plain.g, 0, { advances: ['taxation'] });
  stock(plain.g, 0, { mood: 1 });
  act(plain.g, { type: 'taxation', gain: { food: 1 } });
  assert.equal(me(plain.g).mood, 0, 'the usual Taxation costs a Mood token');
  assert.equal(plain.g.s.turn.activated[plain.cap.id], undefined, 'and activates no city');
});

test('Cnut: the city must be Happy and his, and Taxation must be known', () => {
  const angry = lead('vikings', 'cnut');
  give(angry.g, 0, { advances: ['taxation'] });
  angry.cap.mood = 'neutral';
  assert.match(refused(angry.g, { type: 'taxation', cnut: angry.cap.id, gain: { food: 1 } }), /Cnut needs a Happy city/);

  const away = lead('vikings', 'cnut');
  const other = secondCity(away.g, away.cap);
  give(away.g, 0, { advances: ['taxation'] });
  assert.match(refused(away.g, { type: 'taxation', cnut: other.id, gain: { food: 2 } }), /Cnut must be in that city/);

  const without = lead('vikings', 'cnut');
  assert.match(refused(without.g, { type: 'taxation', cnut: without.cap.id, gain: { food: 1 } }), /You need Taxation/);
});
