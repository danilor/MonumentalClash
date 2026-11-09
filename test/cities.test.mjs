import test from 'node:test';
import assert from 'node:assert/strict';
import { addUnit } from '../src/engine/state.js';
import { nbrs } from '../src/engine/queries.js';
import { checkInvariants } from './harness.mjs';
import { act, addCityAt, capitalOf, fresh, give, neighbourWith, refused, settlerOf } from './scenario.mjs';

const me = (g) => g.s.players[0]; // refused actions restore the state, so objects are re-read each time

test('a Settler founds a Neutral city where it stands and the action is spent', () => {
  const g = fresh();
  const forest = neighbourWith(g, capitalOf(g).hex, 'forest');
  const settler = settlerOf(g);
  settler.hex = forest;
  act(g, { type: 'found_city', unit: settler.id });
  const city = g.s.cities.find((c) => c.hex === forest);
  assert.equal(city.owner, 0);
  assert.equal(city.mood, 'neutral');
  assert.equal(settlerOf(g), undefined);
  assert.equal(g.s.turn.actionsLeft, 2);
});

test('cities cannot be founded on cities, barren land or exhausted land', () => {
  const g = fresh();
  const settler = settlerOf(g);
  assert.match(refused(g, { type: 'found_city', unit: settler.id }), /already a city/);
  const barren = neighbourWith(g, capitalOf(g).hex, 'barren');
  g.s.units.find((u) => u.id === settler.id).hex = barren;
  assert.match(refused(g, { type: 'found_city', unit: settler.id }), /Barren/);
  const forest = neighbourWith(g, capitalOf(g).hex, 'forest');
  g.s.units.find((u) => u.id === settler.id).hex = forest;
  g.s.map.hexes[forest].exhausted = true;
  assert.match(refused(g, { type: 'found_city', unit: settler.id }), /exhausted/);
});

test('collecting: the city gathers from its own and neighbouring spaces up to its capacity', () => {
  const g = fresh();
  const city = capitalOf(g);
  const forest = neighbourWith(g, city.hex, 'forest');
  const mountain = neighbourWith(g, city.hex, 'mountain');
  const picks = [{ hex: forest, res: 'wood' }, { hex: mountain, res: 'ore' }, { hex: city.hex, res: 'food' }];
  assert.match(refused(g, { type: 'collect', city: city.id, picks }), /at most 2 Resources/);
  assert.match(refused(g, { type: 'collect', city: city.id, picks: [{ hex: forest, res: 'ore' }] }), /does not give/);
  assert.match(refused(g, { type: 'collect', city: city.id, picks: [{ hex: forest, res: 'wood' }, { hex: forest, res: 'wood' }] }), /once/);
  act(g, { type: 'collect', city: city.id, picks: picks.slice(0, 2) });
  assert.deepEqual(me(g).res, { food: 2, wood: 1, ore: 1, ideas: 0, gold: 0 });
});

test('a city activated again in the same turn grows unhappy, and capacity shrinks with its Mood', () => {
  const g = fresh();
  const city = () => capitalOf(g);
  const forest = neighbourWith(g, city().hex, 'forest');
  const mountain = neighbourWith(g, city().hex, 'mountain');
  const two = { type: 'collect', city: city().id, picks: [{ hex: forest, res: 'wood' }, { hex: mountain, res: 'ore' }] };
  const one = { type: 'collect', city: city().id, picks: [{ hex: forest, res: 'wood' }] };
  act(g, two);
  assert.equal(city().mood, 'happy', 'the first activation is free');
  act(g, two);
  assert.equal(city().mood, 'neutral');
  assert.match(refused(g, two), /at most 1 Resource/);
  act(g, one);
  assert.equal(city().mood, 'angry');
  assert.equal(g.s.turn.actionsLeft, 0);
});

test('Angry cities cannot construct', () => {
  const g = fresh();
  give(g, 0, { res: { food: 2, wood: 2, ore: 2 }, advances: ['writing'] });
  addCityAt(g, 0, neighbourWith(g, capitalOf(g).hex, 'forest'));
  capitalOf(g).mood = 'angry';
  assert.match(refused(g, { type: 'construct', city: capitalOf(g).id, building: 'academy' }), /Angry/);
});

test('constructing needs the Advance, 1 Food + 1 Wood + 1 Ore, and a city never outgrows your city count', () => {
  const g = fresh();
  const city = capitalOf(g);
  const build = { type: 'construct', city: city.id, building: 'academy' };
  assert.match(refused(g, build), /Writing/);
  give(g, 0, { res: { food: 2, wood: 2, ore: 2 }, advances: ['writing'] });
  assert.match(refused(g, build), /larger than size 5 or your number of cities/);
  addCityAt(g, 0, neighbourWith(g, city.hex, 'forest'));
  act(g, build);
  assert.deepEqual(me(g).res, { food: 1, wood: 1, ore: 1, ideas: 2, gold: 0 }, 'an Academy pays 2 Ideas');
  assert.equal(capitalOf(g).buildings.academy, 0);
  assert.match(refused(g, build), /already/);
});

test('a Temple pays one Mood or Culture token', () => {
  for (const [bonus, key] of [['mood', 'mood'], ['culture', 'culture']]) {
    const g = fresh();
    give(g, 0, { res: { food: 1, wood: 1, ore: 1 }, advances: ['myths'] });
    addCityAt(g, 0, neighbourWith(g, capitalOf(g).hex, 'forest'));
    act(g, { type: 'construct', city: capitalOf(g).id, building: 'temple', templeBonus: bonus });
    assert.equal(me(g)[key], 1);
  }
});

test('recruiting: costs, capacity, Ports for Ships and the stack limit', () => {
  const g = fresh();
  const city = capitalOf(g);
  const recruit = (units) => ({ type: 'recruit', city: city.id, units });
  assert.match(refused(g, recruit({ infantry: 1 })), /afford/);
  give(g, 0, { res: { food: 6, wood: 2, ore: 3 }, advances: ['storage'] });
  assert.match(refused(g, recruit({ infantry: 3 })), /at most 2 units/);
  assert.match(refused(g, recruit({ ship: 1 })), /Port/);
  act(g, recruit({ infantry: 1, settler: 1 }));
  assert.deepEqual(me(g).res, { food: 3, wood: 2, ore: 2, ideas: 0, gold: 0 });
  assert.equal(g.s.units.filter((u) => u.owner === 0 && u.hex === city.hex).length, 3, 'start Settler + 2 new units');
  for (let i = 0; i < 3; i++) addUnit(g.s, 0, 'infantry', city.hex);
  assert.match(refused(g, recruit({ infantry: 1 })), /at most 4 Army units/);
  assert.deepEqual(checkInvariants(g), []);
});

test('Increase Happiness costs Mood tokens equal to the city size for each step', () => {
  const g = fresh();
  const city = capitalOf(g);
  city.mood = 'angry';
  const raise = (steps) => ({ type: 'happiness', cities: [{ city: city.id, steps }] });
  assert.match(refused(g, raise(1)), /1 Mood token/);
  give(g, 0, { mood: 2 });
  assert.match(refused(g, raise(3)), /above Happy/);
  act(g, raise(2));
  assert.equal(capitalOf(g).mood, 'happy');
  assert.equal(me(g).mood, 0);

  const big = fresh();
  big.s.cities.find((c) => c.owner === 0).buildings.academy = 0; // size 2
  capitalOf(big).mood = 'neutral';
  give(big, 0, { mood: 1 });
  assert.match(refused(big, { type: 'happiness', cities: [{ city: capitalOf(big).id, steps: 1 }] }), /2 Mood tokens/);
});

test('Settlers walk one space; Army units wait for Tactics', () => {
  const g = fresh();
  const city = capitalOf(g);
  const forest = neighbourWith(g, city.hex, 'forest');
  const settler = settlerOf(g);
  const soldier = addUnit(g.s, 0, 'infantry', city.hex);
  assert.match(refused(g, { type: 'move', units: [soldier.id], to: forest }), /Tactics/);
  assert.match(refused(g, { type: 'move', units: [settler.id], to: '0,0' }), /far|Choose a destination|Region|reach/i);
  act(g, { type: 'move', units: [settler.id], to: forest });
  assert.equal(settlerOf(g).hex, forest);
  assert.equal(g.s.turn.actionsLeft, 2);
});

test('walking into the unknown reveals the Region, and the answer to the question is checked', () => {
  const g = fresh('q0'); // on this map both orientations of the new Region are legal, so the player is asked
  g.policy = [null, (_g, p) => p.default];
  const hidden = nbrs(g.s, capitalOf(g).hex).find((k) => g.s.map.hexes[k].terrain === null);
  const region = g.s.map.regions[g.s.map.hexes[hidden].region];
  assert.equal(region.flipped, null);
  let r = g.apply({ type: 'move', units: [settlerOf(g).id], to: hidden });
  assert.ok(r.ok, r.error);
  assert.equal(r.pending.kind, 'orientation');
  assert.equal(g.respond('nonsense').ok, false, 'an answer outside the offered choices is refused');
  assert.ok(g.pending, 'and the question stays open');
  assert.equal(g.apply({ type: 'end_turn' }).ok, false, 'nothing else can be done while a question is open');
  r = g.respond(r.pending.options[0].id);
  assert.ok(r.ok, r.error);
  assert.equal(g.pending, null);
  assert.equal(g.respond('base').ok, false, 'and nothing can be answered when none is open');
  assert.notEqual(region.flipped, null);
  assert.ok(region.keys.every((k) => g.s.map.hexes[k].terrain !== null));
  assert.equal(settlerOf(g).hex, hidden);
  assert.notEqual(g.s.map.hexes[hidden].terrain, 'sea');
  assert.deepEqual(checkInvariants(g), []);
});
