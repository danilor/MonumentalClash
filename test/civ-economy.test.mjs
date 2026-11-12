// Scenarios for the economy powers of the Civilizations module: Collect, city size, Advances and resources.
// Powers without a rulebook text (Terracing, Stelas, Architecture, Slave Economy, Ziggurats, Peace and Poetry, Aztec Gold, Star
// Catalogs, Aqueducts, Banking) are pinned to source/civ.md and the text in src/engine/data/civs.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureCity } from '../src/engine/combat.js';
import { BARBARIAN } from '../src/engine/data/constants.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { resolveEvent } from '../src/engine/events.js';
import { nbrs } from '../src/engine/queries.js';
import { WORLD_EFFECTS } from '../src/engine/worldEvents.js';
import { checkInvariants } from './harness.mjs';
import { act, addCityAt, capitalOf, give, hold, refused, settlerOf } from './scenario.mjs';
import { asking, barbarians, free, harbour, logged, me, optionIds, power, ring, run, setTerrain, stack, stock, town, troops, world } from './civs.mjs';

// ------------------------------------------------------------------ fixtures
/** Player 0 plays `people` and holds these powers; the other seat plays a people that has nothing to do with them. */
const table = (people, ...powers) => {
  const g = world([people, people === 'china' ? 'rome' : 'china']);
  power(g, 0, ...powers);
  return g;
};
/** What a player holds, without the empty piles: `{ food: 2, mood: 1 }`. */
const holds = (g, p = 0) => {
  const pl = me(g, p);
  return Object.fromEntries(Object.entries({ ...pl.res, mood: pl.mood, culture: pl.culture }).filter(([, n]) => n));
};
const pick = (hex, res) => ({ hex, res });
const gather = (city, picks, extra = {}) => ({ type: 'collect', city: city.id, picks, ...extra });
/** A Fortress makes the city one size larger: it collects (and recruits) one more. */
const grown = (city) => {
  city.buildings.fortress = city.owner;
  return city;
};
/** A Government for the table, so that Advances hanging on "a Government" are consistent. */
const govern = (g, p = 0) => {
  give(g, p, { advances: ['voting'] });
  me(g, p).government = 'democracy';
};

// ------------------------------------------------------------------ Canals (Babylonia)
test('Babylonia: Canals add 1 Food to a Collect that gathers exactly 1 Food, whatever else it takes', () => {
  const g = table('babylonia', 'canals');
  const city = capitalOf(g);
  const [plain, forest] = ring(g, city.hex, 1);
  setTerrain(g, forest, 'forest');
  stock(g, 0, {});
  act(g, gather(city, [pick(plain, 'food'), pick(forest, 'wood')]));
  assert.deepEqual(holds(g), { food: 2, wood: 1 }, 'the extra Food comes on top of the 2 spaces the city may use');
});

test('Canals give nothing to a Collect of no Food, or of 2 or more Food', () => {
  const none = table('babylonia', 'canals');
  const home = capitalOf(none);
  const [forest] = ring(none, home.hex, 1);
  setTerrain(none, forest, 'forest');
  stock(none, 0, {});
  act(none, gather(home, [pick(forest, 'wood')]));
  assert.deepEqual(holds(none), { wood: 1 });

  const two = table('babylonia', 'canals');
  give(two, 0, { advances: ['storage'] });
  stock(two, 0, {});
  const city = grown(capitalOf(two));
  const [a, b, c] = ring(two, city.hex, 1);
  act(two, gather(city, [pick(a, 'food'), pick(b, 'food')]));
  assert.deepEqual(holds(two), { food: 2 }, '2 Food stay 2 Food');
  stock(two, 0, {});
  act(two, gather(capitalOf(two), [pick(a, 'food'), pick(b, 'food'), pick(c, 'food')]));
  assert.deepEqual(holds(two), { food: 3 }, '3 Food stay 3 Food');
});

test('Canals work in every Collect of the turn, Mass Collection included', () => {
  const g = table('babylonia', 'canals');
  give(g, 0, { advances: ['storage'] });
  stock(g, 0, {});
  const city = capitalOf(g);
  const second = town(g, 0, ring(g, city.hex, 3)[0]);
  act(g, gather(city, [pick(ring(g, city.hex, 1)[0], 'food')]));
  act(g, gather(second, [pick(ring(g, second.hex, 1)[0], 'food')]));
  assert.deepEqual(holds(g), { food: 4 }, 'each of the two Collects gathered 1 Food');

  const mass = table('babylonia', 'canals');
  stock(mass, 0, {});
  hold(mass, 0, 'mass_collect');
  const home = capitalOf(mass);
  const [plain, ...woods] = ring(mass, home.hex, 1).slice(0, 4);
  for (const k of woods) setTerrain(mass, k, 'forest');
  act(mass, gather(home, [pick(plain, 'food'), ...woods.map((k) => pick(k, 'wood'))], { card: 'mass_collect' }));
  assert.deepEqual(holds(mass), { food: 2, wood: 3 });
  assert.ok(!me(mass).hand.action.includes('mass_collect'), 'the card was played');
});

test('Without Canals a Collect of 1 Food gives 1 Food', () => {
  const g = table('rome');
  stock(g, 0, {});
  const city = capitalOf(g);
  act(g, gather(city, [pick(ring(g, city.hex, 1)[0], 'food')]));
  assert.deepEqual(holds(g), { food: 1 });
});

// ------------------------------------------------------------------ Rice Paddies (China)
test('China: Rice Paddies give 1 extra Food for each Plains space with a Settler, at most 2, outside the city limit', () => {
  const g = table('china', 'rice_paddies');
  give(g, 0, { advances: ['storage'] });
  stock(g, 0, {});
  const city = grown(capitalOf(g));
  const spaces = ring(g, city.hex, 1).slice(0, 3);
  for (const k of spaces) troops(g, 0, 'settler', k);
  act(g, gather(city, spaces.map((k) => pick(k, 'food'))));
  assert.deepEqual(holds(g), { food: 5 }, '3 Food from the 3 spaces, and 2 extra rather than 3');
  assert.deepEqual(checkInvariants(g), []);
});

test('Rice Paddies need a Settler on a Plains space outside the city, and give 1 per space however many Settlers stand there', () => {
  const g = table('china', 'rice_paddies');
  give(g, 0, { advances: ['storage'] });
  stock(g, 0, {});
  const city = capitalOf(g); // the starting Settler stands in it
  const [plain, forest] = ring(g, city.hex, 1);
  setTerrain(g, forest, 'forest');
  troops(g, 0, 'settler', plain, 2);
  troops(g, 0, 'settler', forest);
  act(g, gather(city, [pick(plain, 'food'), pick(forest, 'wood')]));
  assert.deepEqual(holds(g), { food: 2, wood: 1 }, 'two Settlers on one space give 1; a Settler in a Forest gives none');
  act(g, gather(capitalOf(g), [pick(city.hex, 'food')]));
  assert.deepEqual(holds(g), { food: 3, wood: 1 }, "the city's own space is not outside the city, though a Settler stands on it");
});

test('Without Rice Paddies a Settler on a Plains space adds no Food', () => {
  const g = table('rome');
  stock(g, 0, {});
  const city = capitalOf(g);
  const [plain] = ring(g, city.hex, 1);
  troops(g, 0, 'settler', plain);
  act(g, gather(city, [pick(plain, 'food')]));
  assert.deepEqual(holds(g), { food: 1 });
});

// ------------------------------------------------------------------ Pottery (Japan)
test('Japan: Pottery gives 1 Culture when a single Collect gathers at least 3 Food', () => {
  const g = table('japan', 'pottery');
  stock(g, 0, {});
  const city = grown(capitalOf(g));
  const [a, b, c] = ring(g, city.hex, 1);
  act(g, gather(city, [pick(a, 'food'), pick(b, 'food'), pick(c, 'food')]));
  assert.deepEqual(holds(g), { food: 3, culture: 1 });
});

test('Pottery counts Mass Collection, gives 1 Culture however many Food were gathered, and nothing for fewer than 3', () => {
  const mass = table('japan', 'pottery');
  stock(mass, 0, {});
  hold(mass, 0, 'mass_collect');
  const home = capitalOf(mass);
  act(mass, gather(home, ring(mass, home.hex, 1).slice(0, 4).map((k) => pick(k, 'food')), { card: 'mass_collect' }));
  assert.deepEqual(holds(mass), { food: 4, culture: 1 }, '4 Food in one Collect: 1 Culture, not 2');

  const g = table('japan', 'pottery');
  stock(g, 0, {});
  const city = grown(capitalOf(g));
  const [a, b, forest] = ring(g, city.hex, 1);
  setTerrain(g, forest, 'forest');
  act(g, gather(city, [pick(a, 'food'), pick(b, 'food'), pick(forest, 'wood')]));
  assert.deepEqual(holds(g), { food: 2, wood: 1 }, '2 Food and 1 Wood is not 3 Food');
});

test('Pottery pays for each Collect that gathers 3 Food, and only for Japan', () => {
  const g = table('japan', 'pottery');
  stock(g, 0, {});
  const city = grown(capitalOf(g));
  const second = grown(town(g, 0, ring(g, city.hex, 3)[0], 'happy'));
  act(g, gather(city, ring(g, city.hex, 1).slice(0, 3).map((k) => pick(k, 'food'))));
  act(g, gather(second, ring(g, second.hex, 1).slice(0, 3).map((k) => pick(k, 'food'))));
  assert.deepEqual(holds(g), { food: 6, culture: 2 });

  const rome = table('rome');
  give(rome, 0, { advances: ['storage'] });
  stock(rome, 0, {});
  const home = grown(capitalOf(rome));
  act(rome, gather(home, ring(rome, home.hex, 1).slice(0, 3).map((k) => pick(k, 'food'))));
  assert.deepEqual(holds(rome), { food: 3 });
});

// ------------------------------------------------------------------ Terracing (Maya)
test('Maya: Terracing lets a city Collect Ore, Wood or Food from a Mountain space', () => {
  const g = table('maya', 'terracing');
  stock(g, 0, {});
  const city = grown(capitalOf(g));
  const [ore, wood, food] = ring(g, city.hex, 1);
  for (const k of [ore, wood, food]) setTerrain(g, k, 'mountain');
  act(g, gather(city, [pick(ore, 'ore'), pick(wood, 'wood'), pick(food, 'food')]));
  assert.deepEqual(holds(g), { ore: 1, wood: 1, food: 1 });
});

test('Without Terracing a Mountain gives only Ore', () => {
  const g = table('rome');
  stock(g, 0, {});
  const city = capitalOf(g);
  const [mountain] = ring(g, city.hex, 1);
  setTerrain(g, mountain, 'mountain');
  assert.match(refused(g, gather(city, [pick(mountain, 'wood')])), /does not give/);
  assert.match(refused(g, gather(city, [pick(mountain, 'food')])), /does not give/);
  act(g, gather(capitalOf(g), [pick(mountain, 'ore')]));
  assert.deepEqual(holds(g), { ore: 1 });
});

test('Terracing: a Settler walks on after entering a Mountain, while Army units and the Settlers of other peoples must stop', () => {
  // The Settler or Infantry of player 0 steps onto a Mountain next to the capital; `beyond` is the space behind it.
  const stepOnto = (people, powers, type) => {
    const g = table(people, ...powers);
    const city = capitalOf(g);
    const [mountain] = ring(g, city.hex, 1);
    setTerrain(g, mountain, 'mountain');
    const beyond = nbrs(g.s, mountain).find((k) => k !== city.hex && free(g, k));
    const unit = type === 'settler' ? settlerOf(g) : troops(g, 0, 'infantry', city.hex)[0];
    give(g, 0, { advances: ['tactics'] }); // Army units need it to move at all
    act(g, { type: 'move', units: [unit.id], to: mountain });
    return { g, move: { type: 'move', units: [unit.id], to: beyond }, beyond, unit };
  };

  const maya = stepOnto('maya', ['terracing'], 'settler');
  act(maya.g, maya.move);
  assert.equal(maya.g.s.units.find((u) => u.id === maya.unit.id).hex, maya.beyond);
  assert.deepEqual(checkInvariants(maya.g), []);

  for (const [people, powers, type] of [['rome', [], 'settler'], ['maya', ['terracing'], 'infantry']]) {
    const { g, move } = stepOnto(people, powers, type);
    assert.match(refused(g, move), /stopped on a Mountain/, `${people} ${type}`);
  }
});

// @@END@@
