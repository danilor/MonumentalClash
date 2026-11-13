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

// ------------------------------------------------------------------ Flood Plains (Egypt)
test('Egypt: Flood Plains let a city Collect Food or Wood from a Barren space', () => {
  const g = table('egypt', 'flood_plains');
  stock(g, 0, {});
  const city = capitalOf(g);
  const [dust, sand] = ring(g, city.hex, 1);
  setTerrain(g, dust, 'barren');
  setTerrain(g, sand, 'barren');
  act(g, gather(city, [pick(dust, 'food'), pick(sand, 'wood')]));
  assert.deepEqual(holds(g), { food: 1, wood: 1 });
});

test('Without Flood Plains a Barren space gives Food only with Irrigation, and never Wood', () => {
  const g = table('rome');
  stock(g, 0, {});
  const city = capitalOf(g);
  const [dust] = ring(g, city.hex, 1);
  setTerrain(g, dust, 'barren');
  assert.match(refused(g, gather(city, [pick(dust, 'food')])), /cannot collect from that space/);
  give(g, 0, { advances: ['irrigation'] });
  assert.match(refused(g, gather(city, [pick(dust, 'wood')])), /does not give/);
  act(g, gather(city, [pick(dust, 'food')]));
  assert.deepEqual(holds(g), { food: 1 });
});

test('Flood Plains let Egypt found a city on a Barren space, which costs an action and the Settler; other peoples cannot', () => {
  const g = table('egypt', 'flood_plains');
  const [dust] = ring(g, capitalOf(g).hex, 1);
  setTerrain(g, dust, 'barren');
  const settler = troops(g, 0, 'settler', dust)[0];
  act(g, { type: 'found_city', unit: settler.id });
  const city = g.s.cities.find((c) => c.hex === dust);
  assert.ok(city && city.owner === 0 && city.mood === 'neutral', 'a Neutral city of Egypt stands on the Barren space');
  assert.ok(!g.s.units.some((u) => u.id === settler.id), 'the Settler became the city');
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.deepEqual(checkInvariants(g), []);

  const rome = table('rome');
  const [waste] = ring(rome, capitalOf(rome).hex, 1);
  setTerrain(rome, waste, 'barren');
  const stray = troops(rome, 0, 'settler', waste)[0];
  assert.match(refused(rome, { type: 'found_city', unit: stray.id }), /Barren/);
});

test('A Barren city captured from Egypt stays there and gives its new owner Food, only with Irrigation', () => {
  const g = world(['rome', 'egypt']);
  const [dust] = ring(g, capitalOf(g).hex, 1);
  setTerrain(g, dust, 'barren');
  const lost = town(g, 1, dust);
  power(g, 1, 'flood_plains');
  asking(g);
  run(g, captureCity(g, lost, 0));
  stock(g, 0, {});
  const city = g.s.cities.find((c) => c.hex === dust);
  assert.equal(city.owner, 0);
  assert.equal(g.s.map.hexes[dust].terrain, 'barren');
  assert.match(refused(g, gather(city, [pick(dust, 'food')])), /cannot collect from that space/, 'no Irrigation');
  give(g, 0, { advances: ['irrigation'] });
  assert.match(refused(g, gather(city, [pick(dust, 'wood')])), /does not give/, 'Food only, not Wood');
  act(g, gather(city, [pick(dust, 'food')]));
  assert.deepEqual(holds(g), { food: 1 });
  assert.deepEqual(checkInvariants(g), []);
});

// ------------------------------------------------------------------ Aztec Gold (Aztecs)
/** Player 0's capital with `n` of the spaces around it turned into Mountains. */
const mountainous = (g, n = 2) => {
  const city = capitalOf(g);
  const spaces = ring(g, city.hex, 1).slice(0, n);
  for (const k of spaces) setTerrain(g, k, 'mountain');
  return { city, spaces };
};

test('Aztecs: Aztec Gold turns exactly 1 Ore collected from a Mountain into 1 Gold or 1 Culture', () => {
  for (const [kind, want] of [['gold', { ore: 1, gold: 1 }], ['culture', { ore: 1, culture: 1 }]]) {
    const g = table('aztecs', 'aztec_gold');
    stock(g, 0, {});
    const { city, spaces: [a, b] } = mountainous(g);
    act(g, gather(city, [pick(a, 'ore'), pick(b, 'ore')], { aztecGold: kind }));
    assert.deepEqual(holds(g), want, `2 Ore, one of them taken as ${kind}`);
  }
  const plain = table('aztecs', 'aztec_gold');
  stock(plain, 0, {});
  const { city, spaces: [a, b] } = mountainous(plain);
  act(plain, gather(city, [pick(a, 'ore'), pick(b, 'ore')]));
  assert.deepEqual(holds(plain), { ore: 2 }, 'a Collect without the option keeps its Ore');
});

test('Aztec Gold can be used once per turn and needs Ore from a Mountain', () => {
  const g = table('aztecs', 'aztec_gold');
  stock(g, 0, {});
  const { city, spaces: [a, b] } = mountainous(g);
  act(g, gather(city, [pick(a, 'ore')], { aztecGold: 'gold' }));
  assert.deepEqual(holds(g), { gold: 1 });
  assert.match(refused(g, gather(city, [pick(b, 'ore')], { aztecGold: 'gold' })), /Aztec Gold needs 1 Ore/, 'the second time in a turn');
  act(g, gather(city, [pick(b, 'ore')]));
  assert.deepEqual(holds(g), { gold: 1, ore: 1 }, 'an ordinary Collect is still fine');

  const other = table('aztecs', 'aztec_gold');
  stock(other, 0, {});
  const { city: home, spaces: [hill] } = mountainous(other, 1);
  const [field] = ring(other, home.hex, 1).filter((k) => k !== hill);
  assert.match(refused(other, gather(home, [pick(field, 'food')], { aztecGold: 'gold' })), /Aztec Gold needs 1 Ore/, 'no Ore from a Mountain');
  assert.match(refused(other, gather(home, [pick(hill, 'ore')], { aztecGold: 'wood' })), /Aztec Gold needs 1 Ore/, 'only Gold or Culture');
});

test('Aztec Gold belongs to the Aztecs', () => {
  const g = table('rome');
  stock(g, 0, {});
  const { city, spaces: [hill] } = mountainous(g, 1);
  assert.match(refused(g, gather(city, [pick(hill, 'ore')], { aztecGold: 'gold' })), /Aztec Gold needs 1 Ore/);
});

// ------------------------------------------------------------------ Tribute Empire (Aztecs)
test('Aztecs: Tribute Empire lets a city Collect from the space of an enemy city within 2 spaces, whatever its Mood', () => {
  const g = table('aztecs', 'tribute_empire');
  stock(g, 0, {});
  const city = capitalOf(g);
  const [next] = ring(g, city.hex, 1);
  const [two] = ring(g, city.hex, 2);
  const [three] = ring(g, city.hex, 3);
  setTerrain(g, two, 'forest');
  const cities = [town(g, 1, next, 'angry'), town(g, 1, two, 'happy'), town(g, 1, three)];
  assert.match(refused(g, gather(city, [pick(three, 'food')])), /cannot collect from that space/, '3 spaces away');
  act(g, gather(city, [pick(next, 'food'), pick(two, 'wood')]));
  assert.deepEqual(holds(g), { food: 1, wood: 1 }, 'the resource of the space the enemy city stands on');
  assert.deepEqual(cities.map((c) => g.s.cities.find((x) => x.id === c.id).owner), [1, 1, 1], 'nothing changed for the cities');
});

test('Tribute Empire does not reach a city that enemy units stand in, nor work for other peoples', () => {
  const g = table('aztecs', 'tribute_empire');
  stock(g, 0, {});
  const city = capitalOf(g);
  const [next, held] = ring(g, city.hex, 1);
  town(g, 1, next);
  town(g, 1, held);
  troops(g, 1, 'infantry', held);
  act(g, gather(city, [pick(next, 'food')]));
  assert.match(refused(g, gather(city, [pick(held, 'food')])), /cannot collect from that space/);

  const rome = table('rome');
  const home = capitalOf(rome);
  const [door] = ring(rome, home.hex, 1);
  town(rome, 1, door);
  assert.match(refused(rome, gather(home, [pick(door, 'food')])), /cannot collect from that space/);
});

test('Tribute Empire collects from a Barbarian city, whose Army units can be taken as Captives instead of a resource', () => {
  const lone = table('aztecs', 'tribute_empire');
  stock(lone, 0, {});
  const [empty, guarded] = ring(lone, capitalOf(lone).hex, 2);
  addCityAt(lone, BARBARIAN, empty);
  addCityAt(lone, BARBARIAN, guarded);
  barbarians(lone, 'infantry', guarded, 2);
  act(lone, gather(capitalOf(lone), [pick(empty, 'food')]));
  assert.deepEqual(holds(lone), { food: 1 }, 'an empty Barbarian city gives the resource of its space');
  assert.match(refused(lone, gather(capitalOf(lone), [pick(guarded, 'food')])), /cannot collect from that space/, 'without Captives its defenders are in the way');

  const g = table('aztecs', 'captives', 'tribute_empire');
  govern(g);
  stock(g, 0, {});
  const city = capitalOf(g);
  const [post, fort] = ring(g, city.hex, 2);
  for (const k of [post, fort]) {
    addCityAt(g, BARBARIAN, k);
    barbarians(g, 'infantry', k, 2);
  }
  assert.match(refused(g, gather(city, [pick(post, 'food')])), /does not give/, 'a Captive instead of a resource');
  act(g, gather(capitalOf(g), [pick(post, 'captive'), pick(fort, 'captive')]));
  assert.deepEqual(me(g).captives, [{ owner: BARBARIAN, type: 'infantry' }, { owner: BARBARIAN, type: 'infantry' }]);
  assert.deepEqual(holds(g), {}, 'no resource');
  assert.equal(g.s.units.filter((u) => u.owner === BARBARIAN).length, 2, 'one Barbarian unit left each city');
  assert.deepEqual(checkInvariants(g), []);
});

test('Tribute Empire takes no more Captives than the 4 an Aztec can keep', () => {
  const g = table('aztecs', 'captives', 'tribute_empire');
  govern(g);
  stock(g, 0, {});
  const city = capitalOf(g);
  const [post] = ring(g, city.hex, 2);
  addCityAt(g, BARBARIAN, post);
  barbarians(g, 'infantry', post, 2);
  me(g).captives = Array.from({ length: 4 }, () => ({ owner: BARBARIAN, type: 'infantry' }));
  assert.match(refused(g, gather(city, [pick(post, 'captive')])), /cannot collect from that space/);
  assert.deepEqual(checkInvariants(g), []);
});

// ------------------------------------------------------------------ Ballcourts (Maya)
test('Maya: Ballcourts let a city Collect 1 more Resource for 1 Mood token', () => {
  const g = table('maya', 'ballcourts');
  stock(g, 0, { mood: 1 });
  const city = capitalOf(g);
  const [forest, hill] = ring(g, city.hex, 1);
  setTerrain(g, forest, 'forest');
  setTerrain(g, hill, 'mountain');
  const three = [pick(city.hex, 'food'), pick(forest, 'wood'), pick(hill, 'ore')];
  assert.match(refused(g, gather(city, three)), /at most 2 Resources/, 'a Happy city of size 1 collects 2');
  act(g, gather(city, three, { ballcourts: true }));
  assert.deepEqual(holds(g), { food: 1, wood: 1, ore: 1 }, 'the Mood token is spent');
});

test('Ballcourts need a Mood token, a city that is not Angry and the Maya', () => {
  const g = table('maya', 'ballcourts');
  const city = capitalOf(g);
  const [forest, hill] = ring(g, city.hex, 1);
  setTerrain(g, forest, 'forest');
  setTerrain(g, hill, 'mountain');
  const three = [pick(city.hex, 'food'), pick(forest, 'wood'), pick(hill, 'ore')];
  stock(g, 0, {});
  assert.match(refused(g, gather(city, three, { ballcourts: true })), /need 1 Mood token/);
  stock(g, 0, { mood: 1 });
  capitalOf(g).mood = 'angry';
  assert.match(refused(g, gather(city, three, { ballcourts: true })), /cannot help an Angry city/);

  const rome = table('rome');
  stock(rome, 0, { mood: 1 });
  const home = capitalOf(rome);
  assert.match(refused(rome, gather(home, [pick(home.hex, 'food')], { ballcourts: true })), /need Ballcourts/);
});

test('Maya: Ballcourts let a city Recruit 1 more unit for 1 Mood token', () => {
  const g = table('maya', 'ballcourts');
  give(g, 0, { advances: ['tactics', 'storage'] });
  stock(g, 0, { food: 3, ore: 3, mood: 1 });
  const recruit = (extra = {}) => ({ type: 'recruit', city: capitalOf(g).id, units: { infantry: 3 }, ...extra });
  assert.match(refused(g, recruit()), /at most 2 units/, 'a Happy city of size 1 recruits 2');
  act(g, recruit({ ballcourts: true }));
  assert.deepEqual(holds(g), {}, 'the Mood token and the price of 3 Infantry are spent');
  assert.equal(g.s.units.filter((u) => u.owner === 0 && u.type === 'infantry').length, 3);
  assert.deepEqual(checkInvariants(g), []);
});

test('Recruiting with Ballcourts needs a Mood token, a city that is not Angry and the Maya', () => {
  const g = table('maya', 'ballcourts');
  give(g, 0, { advances: ['tactics', 'storage'] });
  const city = capitalOf(g);
  const recruit = { type: 'recruit', city: city.id, units: { infantry: 3 }, ballcourts: true };
  stock(g, 0, { food: 3, ore: 3 });
  assert.match(refused(g, recruit), /cannot afford/);
  stock(g, 0, { food: 3, ore: 3, mood: 1 });
  capitalOf(g).mood = 'angry';
  assert.match(refused(g, recruit), /Ballcourts cannot make this city larger/);

  const rome = table('rome');
  give(rome, 0, { advances: ['tactics', 'storage'] });
  stock(rome, 0, { food: 3, ore: 3, mood: 1 });
  assert.match(refused(rome, { ...recruit, city: capitalOf(rome).id }), /Ballcourts cannot make this city larger/);
});

test('Maya: Ballcourts make one Spirituality Advance a turn cost 1 Food less', () => {
  const g = table('maya', 'ballcourts');
  stock(g, 0, { food: 3 });
  act(g, { type: 'advance', advance: 'myths' });
  assert.equal(me(g).res.food, 2, 'the first Spirituality Advance costs 1 Food');
  act(g, { type: 'advance', advance: 'rituals' });
  assert.equal(me(g).res.food, 0, 'the second costs 2 Food');
  assert.equal(g.s.turn.actionsLeft, 1);
});

test('The Ballcourts discount is for Spirituality Advances, and for the Maya', () => {
  const g = table('maya', 'ballcourts');
  stock(g, 0, { food: 2 });
  act(g, { type: 'advance', advance: 'storage' });
  assert.equal(me(g).res.food, 0, 'a Farming Advance costs 2 Food');
  assert.match(refused(g, { type: 'advance', advance: 'myths' }), /costs 2 Food/);

  const rome = table('rome');
  stock(rome, 0, { food: 2 });
  act(rome, { type: 'advance', advance: 'myths' });
  assert.equal(me(rome).res.food, 0, 'Rome pays 2 Food');
});

test('The Ballcourts discount comes back each turn', () => {
  const g = table('maya', 'ballcourts');
  stock(g, 0, { food: 2 });
  act(g, { type: 'advance', advance: 'myths' });
  assert.equal(me(g).res.food, 1);
  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  assert.equal(g.cur, 0, 'it is Maya\'s turn again');
  stock(g, 0, { food: 1 });
  act(g, { type: 'advance', advance: 'rituals' });
  assert.equal(me(g).res.food, 0, 'the first Spirituality Advance of the new turn costs 1 Food');
});

// ------------------------------------------------------------------ Architecture (Egypt), Slave Economy (Rome)
/** A second city for player p, away from the capital: a city grows no larger than the number of cities. */
const second = (g, p = 0) => town(g, p, ring(g, capitalOf(g, p).hex, 2)[0]);
const build = (g, building, city = capitalOf(g)) => ({ type: 'construct', city: city.id, building });
const wonder = (g, id = 'great_wall') => ({ type: 'construct_wonder', city: capitalOf(g).id, wonder: id });
/** The Great Wall costs 3 Food, 2 Wood, 7 Ore and 5 Culture. */
const wallReady = (g) => give(g, 0, { advances: ['engineering', 'siegecraft'], wonders: ['great_wall'] });

test('Egypt: Architecture lets Mood tokens pay for the resources of a building', () => {
  const g = table('egypt', 'architecture');
  second(g);
  give(g, 0, { advances: ['bartering'] });
  stock(g, 0, { food: 1, mood: 2 });
  act(g, build(g, 'market'));
  assert.equal(capitalOf(g).buildings.market, 0);
  assert.deepEqual(holds(g), {}, '1 Food and 2 Mood tokens paid for the Food, Wood and Ore');
  assert.deepEqual(checkInvariants(g), []);

  const short = table('egypt', 'architecture');
  second(short);
  give(short, 0, { advances: ['bartering'] });
  stock(short, 0, { food: 1, mood: 1 });
  assert.match(refused(short, build(short, 'market')), /A building costs 1 Food, 1 Wood and 1 Ore/);
});

test('Egypt: Architecture lets Mood tokens pay for the resources and the Culture of a Wonder', () => {
  const g = table('egypt', 'architecture');
  second(g);
  wallReady(g);
  stock(g, 0, { food: 3, wood: 2, ore: 4, culture: 2, mood: 7 });
  act(g, wonder(g));
  assert.deepEqual(capitalOf(g).wonders, [{ id: 'great_wall', builder: 0 }]);
  assert.deepEqual(holds(g), { mood: 1 }, '3 Mood tokens for the missing Ore and 3 for the missing Culture');

  const short = table('egypt', 'architecture');
  second(short);
  wallReady(short);
  stock(short, 0, { food: 3, wood: 2, ore: 4, culture: 2, mood: 5 });
  assert.match(refused(short, wonder(short)), /cannot afford that Wonder/);
});

test('Without Architecture, Mood tokens pay for no resource of a building or a Wonder', () => {
  const g = table('rome');
  second(g);
  give(g, 0, { advances: ['bartering'] });
  stock(g, 0, { food: 1, mood: 6 });
  assert.match(refused(g, build(g, 'market')), /A building costs/);

  const wall = table('rome');
  second(wall);
  wallReady(wall);
  stock(wall, 0, { food: 3, wood: 2, ore: 4, culture: 5, mood: 6 });
  assert.match(refused(wall, wonder(wall)), /cannot afford that Wonder/);
});

test('Rome: Slave Economy lets Mood tokens pay for any resource when a city grows', () => {
  const g = table('rome', 'slave_economy');
  second(g);
  stock(g, 0, { food: 1, mood: 2 });
  act(g, build(g, 'market'));
  assert.equal(capitalOf(g).buildings.market, 0);
  assert.deepEqual(holds(g), {});

  const wall = table('rome', 'slave_economy');
  second(wall);
  wallReady(wall);
  stock(wall, 0, { food: 3, wood: 2, ore: 4, culture: 5, mood: 3 });
  act(wall, wonder(wall));
  assert.deepEqual(holds(wall), {}, '3 Mood tokens paid for the missing Ore');

  const short = table('rome', 'slave_economy');
  second(short);
  give(short, 0, { advances: ['engineering'] });
  stock(short, 0, { food: 1, mood: 1 });
  assert.match(refused(short, build(short, 'market')), /A building costs/);
});

test('Slave Economy pays resources with Mood, not Culture', () => {
  const g = table('rome', 'slave_economy');
  second(g);
  wallReady(g);
  stock(g, 0, { food: 3, wood: 2, ore: 7, culture: 4, mood: 7 });
  assert.match(refused(g, wonder(g)), /cannot afford that Wonder/, 'Culture is not a resource');
  stock(g, 0, { food: 3, wood: 2, ore: 7, culture: 5, mood: 7 });
  act(g, wonder(g));
  assert.deepEqual(holds(g), { mood: 7 });
});

// ------------------------------------------------------------------ Ziggurats (Babylonia)
test('Babylonia: Ziggurats come with Dogma and cancel its limit of 2 Ideas', () => {
  const dogma = (people) => {
    const g = world([people, 'china']);
    give(g, 0, { advances: ['myths', 'state_religion'] });
    stock(g, 0, { food: 2, ideas: 5 });
    act(g, { type: 'advance', advance: 'dogma', pay: { food: 2 } });
    return g;
  };
  const babylon = dogma('babylonia');
  assert.ok(me(babylon).civAdv.includes('ziggurats'));
  assert.equal(me(babylon).res.ideas, 5, 'no limit on Ideas');
  assert.deepEqual(checkInvariants(babylon), []);

  const rome = dogma('rome');
  assert.equal(me(rome).res.ideas, 2, 'Dogma limits the Ideas of the others to 2');
});

test('Ziggurats let Ideas pay for the resources of a Temple, and for nothing else', () => {
  const g = table('babylonia', 'ziggurats');
  me(g).government = 'theocracy';
  give(g, 0, { advances: ['myths', 'writing', 'engineering', 'siegecraft'], wonders: ['great_wall'] });
  const other = second(g);
  asking(g, { dogma: false });
  stock(g, 0, { ideas: 7 });
  assert.match(refused(g, build(g, 'academy', other)), /A building costs/, 'not for an Academy');
  assert.match(refused(g, wonder(g)), /cannot afford that Wonder/, 'not for a Wonder');
  act(g, build(g, 'temple'));
  assert.equal(capitalOf(g).buildings.temple, 0);
  assert.deepEqual(holds(g), { ideas: 4, mood: 1 }, '3 Ideas paid for the Food, Wood and Ore; the Temple gave 1 Mood');
});

test('Ideas pay for a Temple only with Ziggurats', () => {
  const g = table('rome');
  give(g, 0, { advances: ['myths'] });
  second(g);
  stock(g, 0, { ideas: 3 });
  assert.match(refused(g, build(g, 'temple')), /A building costs/);
});

// ------------------------------------------------------------------ Formal Training (Greece)
const academy = (g, p = 0) => {
  capitalOf(g, p).buildings.academy = p;
};
const settle = (g) => ({ type: 'recruit', city: capitalOf(g).id, units: { settler: 1 } });

test('Greece: Formal Training gives 1 Idea when a Recruit is made in a city with an Academy', () => {
  const g = table('greece', 'formal_training');
  academy(g);
  stock(g, 0, { food: 2 });
  act(g, settle(g));
  assert.deepEqual(holds(g), { ideas: 1 });
});

test('Formal Training gives 1 Idea for a Recruit however many units it makes, Ships included', () => {
  const g = table('greece', 'formal_training');
  academy(g);
  give(g, 0, { advances: ['tactics'] });
  stock(g, 0, { food: 2, ore: 2 });
  act(g, { type: 'recruit', city: capitalOf(g).id, units: { infantry: 2 } });
  assert.deepEqual(holds(g), { ideas: 1 });

  const port = table('greece', 'formal_training');
  academy(port);
  harbour(port, capitalOf(port));
  stock(port, 0, { wood: 2 });
  act(port, { type: 'recruit', city: capitalOf(port).id, units: { ship: 1 } });
  assert.equal(port.s.units.filter((u) => u.owner === 0 && u.type === 'ship').length, 1);
  assert.deepEqual(holds(port), { ideas: 1 });
});

test('Formal Training needs an Academy in the city that Recruits, and belongs to Greece', () => {
  const bare = table('greece', 'formal_training');
  stock(bare, 0, { food: 2 });
  act(bare, settle(bare));
  assert.deepEqual(holds(bare), {}, 'no Academy');

  const rome = table('rome');
  academy(rome);
  stock(rome, 0, { food: 2 });
  act(rome, settle(rome));
  assert.deepEqual(holds(rome), {}, 'not Greek');
});

test('Formal Training is only for Recruiting: Collecting and building the Academy give what they always give', () => {
  const g = table('greece', 'formal_training');
  academy(g);
  stock(g, 0, {});
  act(g, gather(capitalOf(g), [pick(capitalOf(g).hex, 'food')]));
  assert.deepEqual(holds(g), { food: 1, ideas: 1 }, 'Public Education gives the Idea of a Collect');

  const school = table('greece', 'formal_training');
  second(school);
  give(school, 0, { advances: ['writing'] });
  stock(school, 0, { food: 1, wood: 1, ore: 1 });
  act(school, build(school, 'academy'));
  assert.deepEqual(holds(school), { ideas: 2 }, 'the Academy gives 2 Ideas');
});

// ------------------------------------------------------------------ Stelas (Maya)
test('Maya: Stelas give 1 Culture or 1 Idea when a Settler founds a city', () => {
  for (const [answers, want] of [[{}, { culture: 1 }], [{ stelas: 'culture' }, { culture: 1 }], [{ stelas: 'ideas' }, { ideas: 1 }]]) {
    const g = table('maya', 'stelas');
    stock(g, 0, {});
    const [hex] = ring(g, capitalOf(g).hex, 1);
    const settler = troops(g, 0, 'settler', hex)[0];
    const asked = asking(g, answers);
    act(g, { type: 'found_city', unit: settler.id });
    assert.deepEqual(holds(g), want, JSON.stringify(answers));
    assert.deepEqual(asked.filter((q) => q.kind === 'stelas').map(optionIds), [['culture', 'ideas']]);
  }
  const rome = table('rome');
  stock(rome, 0, {});
  const [hex] = ring(rome, capitalOf(rome).hex, 1);
  const settler = troops(rome, 0, 'settler', hex)[0];
  const asked = asking(rome);
  act(rome, { type: 'found_city', unit: settler.id });
  assert.deepEqual(holds(rome), {});
  assert.equal(asked.filter((q) => q.kind === 'stelas').length, 0);
});

test('Maya: Stelas give 1 Culture or 1 Idea when a city grows with an Obelisk, and not with another building', () => {
  for (const [answers, want] of [[{}, { culture: 1 }], [{ stelas: 'ideas' }, { ideas: 1 }]]) {
    const g = table('maya', 'stelas');
    second(g);
    stock(g, 0, { food: 1, wood: 1, ore: 1 });
    asking(g, answers);
    act(g, build(g, 'obelisk'));
    assert.equal(capitalOf(g).buildings.obelisk, 0);
    assert.deepEqual(holds(g), want, JSON.stringify(answers));
  }
  const market = table('maya', 'stelas');
  second(market);
  give(market, 0, { advances: ['bartering'] });
  stock(market, 0, { food: 1, wood: 1, ore: 1 });
  const asked = asking(market);
  act(market, build(market, 'market'));
  assert.deepEqual(holds(market), {});
  assert.equal(asked.filter((q) => q.kind === 'stelas').length, 0);

  const rome = table('rome');
  second(rome);
  give(rome, 0, { advances: ['arts'] });
  stock(rome, 0, { food: 1, wood: 1, ore: 1 });
  act(rome, build(rome, 'obelisk'));
  assert.deepEqual(holds(rome), {});
});

test('Maya: Stelas give 1 Culture or 1 Idea when they capture a city, a Barbarian one too', () => {
  const capture = (people, powers, owner, answers = {}) => {
    const g = table(people, ...powers);
    stock(g, 0, {});
    const city = owner === BARBARIAN ? addCityAt(g, BARBARIAN, ring(g, capitalOf(g).hex, 2)[0]) : town(g, owner, ring(g, capitalOf(g).hex, 2)[0]);
    asking(g, answers);
    run(g, captureCity(g, city, 0));
    assert.equal(g.s.cities.find((c) => c.id === city.id).owner, 0, 'the city is theirs');
    return g;
  };
  assert.deepEqual(holds(capture('maya', ['stelas'], 1)), { gold: 1, culture: 1 });
  assert.deepEqual(holds(capture('maya', ['stelas'], 1, { stelas: 'ideas' })), { gold: 1, ideas: 1 });
  assert.deepEqual(holds(capture('maya', ['stelas'], BARBARIAN, { stelas: 'ideas' })), { gold: 1, ideas: 1 });
  assert.deepEqual(holds(capture('rome', [], 1)), { gold: 1 }, 'the loot is all that Rome gets');
});

// ------------------------------------------------------------------ Star Catalogs (Babylonia)
/** Player 0 buys the Advance that fills the Event tracker while a Good Year is on top of the Event cards. */
const fullTracker = (people, powers, answers = {}, cubes = 1) => {
  const g = table(people, ...powers);
  stack(g, 'good_year');
  me(g).cubes = cubes;
  stock(g, 0, { food: 2 });
  const asked = asking(g, answers);
  act(g, { type: 'advance', advance: 'storage' });
  return { g, asked: asked.map((q) => q.kind).filter((kind) => kind === 'star_catalogs' || kind === 'event') };
};

test('Babylonia: Star Catalogs give 1 Idea or 1 Culture before an Event is drawn', () => {
  const rome = fullTracker('rome', []);
  assert.deepEqual(rome.asked, ['event']);
  assert.equal(me(rome.g).res.gold, 2, 'the Good Year');

  const ideas = fullTracker('babylonia', ['star_catalogs']);
  assert.deepEqual(ideas.asked, ['star_catalogs', 'event'], 'asked first, then the Event');
  assert.equal(me(ideas.g).res.ideas, me(rome.g).res.ideas + 1);
  assert.equal(me(ideas.g).culture, me(rome.g).culture);
  assert.equal(me(ideas.g).res.gold, 2);

  const culture = fullTracker('babylonia', ['star_catalogs'], { star_catalogs: 'culture' });
  assert.equal(me(culture.g).culture, me(rome.g).culture + 1);
  assert.equal(me(culture.g).res.ideas, me(rome.g).res.ideas);
});

test('Star Catalogs only count when the Advance triggers an Event', () => {
  const g = fullTracker('babylonia', ['star_catalogs'], {}, 2);
  assert.deepEqual(g.asked, []);
  assert.equal(me(g.g).res.ideas, 0);
  assert.equal(me(g.g).res.gold, 0, 'no Event');
});

// ------------------------------------------------------------------ Aqueducts (Rome)
/** The Famine card is drawn for player 0. */
const famine = (g) => {
  stack(g, 'famine');
  const asked = asking(g);
  run(g, resolveEvent(g, 0));
  return asked;
};
/** The action that buys Sanitation. */
const sanitation = (extra = {}) => ({ type: 'advance', advance: 'sanitation', ...extra });

test('Rome: Aqueducts ignore the Famine event, so no Food is lost and no city loses Mood', () => {
  const g = table('rome', 'aqueducts');
  stock(g, 0, { food: 1 });
  famine(g);
  assert.deepEqual(holds(g), { food: 1 });
  assert.equal(capitalOf(g).mood, 'happy');
  assert.ok(logged(g, /Aqueducts protect against the Famine/));
  assert.deepEqual(checkInvariants(g), []);

  const bare = table('rome');
  give(bare, 0, { advances: ['engineering'] });
  stock(bare, 0, { food: 1 });
  famine(bare);
  assert.deepEqual(holds(bare), {}, 'without the power Engineering does not help: the Food is gone');
  assert.equal(capitalOf(bare).mood, 'neutral', 'and the Food it lacked costs a city 1 Mood');
});

test('Aqueducts ignore the Severe Famine too, which the other players still suffer', () => {
  const g = table('rome', 'aqueducts');
  const realms = [0, 1].map((p) => [capitalOf(g, p), second(g, p)]);
  stock(g, 0, {});
  stock(g, 1, {});
  const asked = asking(g);
  run(g, WORLD_EFFECTS.severe_famine(g, 0));
  assert.deepEqual(realms[0].map((c) => c.mood), ['happy', 'neutral'], 'Rome feeds nobody and loses nothing');
  assert.deepEqual(realms[1].map((c) => c.mood), ['angry', 'angry'], 'China has no Food for its cities');
  assert.equal(asked.filter((q) => q.player === 0).length, 0);
  assert.ok(logged(g, /The Aqueducts protect .* against the Severe Famine/));
  assert.deepEqual(checkInvariants(g), []);

  const bare = table('rome');
  const cities = [capitalOf(bare), second(bare)];
  stock(bare, 0, {});
  asking(bare);
  run(bare, WORLD_EFFECTS.severe_famine(bare, 0));
  assert.deepEqual(cities.map((c) => c.mood), ['angry', 'angry'], 'without the power Rome is hit like the others');
});

test('Rome: Aqueducts buy Sanitation for no Food, which still takes an action', () => {
  const g = table('rome', 'aqueducts');
  stock(g, 0, { food: 2 });
  act(g, sanitation());
  assert.ok(me(g).advances.includes('sanitation'));
  assert.equal(me(g).res.food, 2, 'nothing is paid');
  assert.equal(g.s.turn.actionsLeft, 2);

  const bare = table('rome');
  stock(bare, 0, { food: 2 });
  act(bare, sanitation());
  assert.equal(me(bare).res.food, 0, 'without Aqueducts it costs 2 Food');
  assert.equal(bare.s.turn.actionsLeft, 2);
});

test('Rome: Aqueducts buy Sanitation without an action, for the full 2 Food', () => {
  const g = table('rome', 'aqueducts');
  stock(g, 0, { food: 2 });
  act(g, sanitation({ noAction: true }));
  assert.ok(me(g).advances.includes('sanitation'));
  assert.equal(me(g).res.food, 0, 'it is not the cheap way: Aqueducts give either no Food or no action');
  assert.equal(g.s.turn.actionsLeft, 3, 'no action is spent');

  const spent = table('rome', 'aqueducts');
  stock(spent, 0, { food: 2 });
  spent.s.turn.actionsLeft = 0;
  assert.match(refused(spent, sanitation()), /no actions left/, 'the version that costs an action needs one');
  act(spent, sanitation({ noAction: true }));
  assert.ok(me(spent).advances.includes('sanitation'));
  assert.equal(spent.s.turn.actionsLeft, 0);
});

test('Sanitation without an action is only for Aqueducts, only for Sanitation, and still has to be paid', () => {
  const g = table('rome', 'aqueducts');
  stock(g, 0, { food: 2 });
  assert.match(refused(g, { type: 'advance', advance: 'storage', noAction: true }), /Only Aqueducts lets you buy Sanitation without an action/);
  stock(g, 0, {});
  assert.match(refused(g, sanitation({ noAction: true })), /costs 2 Food/, 'the Food is not waived');

  for (const people of ['rome', 'china']) {
    const bare = table(people);
    stock(bare, 0, { food: 2 });
    assert.match(refused(bare, sanitation({ noAction: true })), /Only Aqueducts lets you buy Sanitation without an action/, people);
  }
});

// ------------------------------------------------------------------ Peace and Poetry (India)
const peace = (advance) => ({ type: 'advance', advance, peace: true });

test('India: Peace and Poetry pay 1 Mood token instead of the 2 Food of an Advance', () => {
  const g = table('india', 'peace_and_poetry');
  stock(g, 0, { food: 2, mood: 2 });
  act(g, peace('roads'));
  assert.ok(me(g).advances.includes('roads'));
  assert.deepEqual(holds(g), { food: 2, mood: 1, culture: 1 }, 'the Food is kept; Roads give their Culture token');
  assert.equal(g.s.turn.actionsLeft, 2, 'it is still an action');

  const none = table('india', 'peace_and_poetry');
  stock(none, 0, { mood: 1 });
  act(none, peace('roads'));
  assert.ok(me(none).advances.includes('roads'), 'no Food is needed at all');
  assert.deepEqual(holds(none), { culture: 1 });
});

test('Peace and Poetry can be used once per turn, and again the next turn', () => {
  const g = table('india', 'peace_and_poetry');
  stock(g, 0, { food: 2, mood: 2 });
  act(g, peace('roads'));
  assert.match(refused(g, peace('tactics')), /once per turn/, 'a Mood token is left, but the power is used');
  act(g, { type: 'advance', advance: 'tactics' });
  assert.deepEqual(holds(g), { mood: 1, culture: 2 }, 'a plain Advance still costs its 2 Food');

  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  assert.equal(g.cur, 0, 'it is the turn of India again');
  act(g, peace('fishing'));
  assert.ok(me(g).advances.includes('fishing'));
  assert.equal(me(g).mood, 1, 'a Mood token was paid, and Fishing gave one');
});

test('Peace and Poetry need the Advance, an Advance that costs Food and a Mood token', () => {
  const rome = table('rome');
  stock(rome, 0, { food: 2, mood: 1 });
  assert.match(refused(rome, peace('roads')), /You need Peace and Poetry/);

  const early = world(['india', 'rome']);
  stock(early, 0, { food: 2, mood: 1 });
  assert.match(refused(early, peace('roads')), /You need Peace and Poetry/, 'India has not earned it yet');

  const g = table('india', 'peace_and_poetry');
  give(g, 0, { advances: ['math'] });
  stock(g, 0, { food: 2, mood: 1 });
  assert.match(refused(g, peace('roads')), /costs no Food to replace/, 'Math makes Roads free');
  stock(g, 0, { food: 2 });
  assert.match(refused(g, peace('tactics')), /costs 2 Food/, 'the Mood token has to be there');
  assert.equal(me(g).res.food, 2);
});

// ------------------------------------------------------------------ Banking (Persia)
/** Player 1 starts a turn holding `gold`; every player answers with `answers`. */
const bankTurn = (people, powers, gold, answers = {}) => {
  const g = world(['rome', people]);
  power(g, 1, ...powers);
  stock(g, 1, { gold });
  const asked = asking(g, answers);
  act(g, { type: 'end_turn' });
  assert.equal(g.cur, 1);
  return { g, asked: asked.filter((q) => q.kind === 'banking') };
};

test('Persia: Banking gives 1 Gold or 1 Culture at the start of the turn to a player who already has Gold', () => {
  for (const [answers, want] of [[{}, { gold: 1, culture: 1 }], [{ banking: 'culture' }, { gold: 1, culture: 1 }], [{ banking: 'gold' }, { gold: 2 }]]) {
    const { g, asked } = bankTurn('persia', ['banking'], 1, answers);
    assert.deepEqual(holds(g, 1), want, JSON.stringify(answers));
    assert.deepEqual(asked.map(optionIds), [['culture', 'gold']]);
  }
});

test('Banking needs Gold in hand, and belongs to Persia', () => {
  const poor = bankTurn('persia', ['banking'], 0);
  assert.deepEqual(poor.asked, []);
  assert.deepEqual(holds(poor.g, 1), {}, 'no Gold, no Banking');

  const other = bankTurn('china', [], 1);
  assert.deepEqual(other.asked, []);
  assert.deepEqual(holds(other.g, 1), { gold: 1 }, 'China has no Banking');
});

test('Banking comes before the trade routes: the Gold they pay counts from the next turn', () => {
  const g = world(['rome', 'persia']);
  power(g, 1, 'banking');
  give(g, 1, { advances: ['trade_routes'] });
  troops(g, 1, 'settler', ring(g, capitalOf(g, 0).hex, 2)[0]);
  stock(g, 1, {});
  const asked = asking(g, { trade_income: 'gold', banking: 'gold' });
  const trade = () => asked.map((q) => q.kind).filter((kind) => kind === 'banking' || kind === 'trade_income');
  act(g, { type: 'end_turn' });
  assert.deepEqual(trade(), ['trade_income'], 'no Gold in hand yet when the turn starts, so no Banking');
  assert.deepEqual(holds(g, 1), { gold: 1 }, 'the route paid 1 Gold');

  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  assert.equal(g.cur, 1);
  assert.deepEqual(trade(), ['trade_income', 'banking', 'trade_income'], 'now Banking is offered first, then the route pays');
  assert.deepEqual(holds(g, 1), { gold: 3 }, '1 Gold held, 1 from Banking and 1 from the route');
});

// ------------------------------------------------------------------ enumerateActions: the candidates of the AI and of random play
/** The candidate actions of player p in a category, whose action satisfies `match`. */
const candidates = (g, cat, match = () => true, p = 0) => enumerateActions(g, p).filter((c) => c.cat === cat && match(c.action));
const headcount = (action) => Object.values(action.units).reduce((n, k) => n + k, 0);

test('enumerateActions offers the Aztec Gold variants of a Collect that takes Ore from a Mountain, until they are used', () => {
  const g = table('aztecs', 'aztec_gold');
  stock(g, 0, {});
  const { city, spaces: [hill] } = mountainous(g, 1);
  const variants = () => candidates(g, 'collect', (a) => a.aztecGold);
  const offered = variants();
  assert.deepEqual([...new Set(offered.map((c) => c.action.aztecGold))].sort(), ['culture', 'gold']);
  assert.ok(offered.every((c) => c.action.city === city.id && c.action.picks.some((x) => x.hex === hill && x.res === 'ore')));
  assert.ok(candidates(g, 'collect', (a) => !a.aztecGold).length > 0, 'the plain Collects are offered as well');
  act(g, offered.find((c) => c.action.aztecGold === 'gold').action);
  assert.equal(me(g).res.gold, 1, 'the candidate can be played');
  assert.equal(variants().length, 0, 'Aztec Gold is used up for the turn');

  const rome = table('rome');
  mountainous(rome, 1);
  assert.ok(candidates(rome, 'collect').length > 0);
  assert.equal(candidates(rome, 'collect', (a) => a.aztecGold).length, 0, 'Rome has no Aztec Gold');
});

test('enumerateActions offers the Ballcourts variants of a Collect and of a Recruit while 1 Mood token can be paid', () => {
  const collects = (g) => candidates(g, 'collect', (a) => a.ballcourts);
  const recruits = (g) => candidates(g, 'recruit', (a) => a.ballcourts);
  const city = (people, powers, mood) => {
    const g = table(people, ...powers);
    give(g, 0, { advances: ['tactics', 'storage'] });
    stock(g, 0, { food: 3, ore: 3, mood });
    return g;
  };

  const g = city('maya', ['ballcourts'], 1);
  assert.ok(collects(g).length > 0);
  assert.ok(collects(g).every((c) => c.action.picks.length === 3), 'one more than the 2 a Happy city of size 1 gathers');
  assert.ok(candidates(g, 'collect', (a) => !a.ballcourts).every((c) => c.action.picks.length <= 2));
  assert.ok(recruits(g).length > 0);
  assert.ok(recruits(g).every((c) => headcount(c.action) === 3), 'one more than the 2 such a city recruits');
  assert.ok(candidates(g, 'recruit', (a) => !a.ballcourts).every((c) => headcount(c.action) <= 2));
  act(g, recruits(g)[0].action);
  assert.equal(me(g).mood, 0, 'the candidate can be played, and costs the Mood token');

  const noMood = city('maya', ['ballcourts'], 0);
  const angry = city('maya', ['ballcourts'], 1);
  capitalOf(angry).mood = 'angry';
  const rome = city('rome', [], 1);
  for (const [label, t] of [['no Mood token', noMood], ['Angry city', angry], ['not the Maya', rome]]) {
    assert.ok(candidates(t, 'collect').length > 0, label);
    assert.equal(collects(t).length, 0, `${label}: no Collect`);
    assert.equal(recruits(t).length, 0, `${label}: no Recruit`);
  }
});

test('enumerateActions offers Advances paid with Mood (Peace and Poetry) and Sanitation without an action (Aqueducts)', () => {
  const moody = (g) => candidates(g, 'advance', (a) => a.peace).map((c) => c.id);
  const plain = (g, advance) => candidates(g, 'advance', (a) => !a.peace && !a.noAction && a.advance === advance).length;
  const india = table('india', 'peace_and_poetry');
  stock(india, 0, { mood: 2 });
  assert.equal(candidates(india, 'advance', (a) => !a.peace).length, 0, 'without Food nothing is offered the ordinary way');
  assert.ok(moody(india).includes('roads'), 'but Mood pays for an Advance');
  stock(india, 0, { food: 2, mood: 1 });
  assert.ok(moody(india).includes('roads') && plain(india, 'roads') === 1, 'with both Food and Mood the two ways are offered');
  act(india, peace('roads'));
  stock(india, 0, { food: 2, mood: 2 });
  assert.deepEqual(moody(india), [], 'Peace and Poetry is used up for the turn');
  assert.equal(plain(india, 'tactics'), 1, 'the ordinary way is still there');
  const poor = table('india', 'peace_and_poetry');
  stock(poor, 0, { food: 2 });
  assert.deepEqual(moody(poor), [], 'a Mood token is needed');
  const rome = table('rome');
  stock(rome, 0, { mood: 2 });
  assert.equal(candidates(rome, 'advance').length, 0, 'Rome cannot pay an Advance with Mood');

  const aqueducts = table('rome', 'aqueducts');
  const withoutAction = (g) => candidates(g, 'advance', (a) => a.noAction).map((c) => c.action);
  stock(aqueducts, 0, { food: 2 });
  assert.deepEqual(withoutAction(aqueducts), [sanitation({ noAction: true })]);
  assert.equal(plain(aqueducts, 'sanitation'), 1, 'the way that costs no Food is offered too');
  aqueducts.s.turn.actionsLeft = 0;
  assert.equal(withoutAction(aqueducts).length, 1, 'with no action left it is the only way');
  assert.equal(candidates(aqueducts, 'advance', (a) => !a.noAction).length, 0);
  stock(aqueducts, 0, {});
  assert.deepEqual(withoutAction(aqueducts), [], 'it has to be paid in full');
  const bare = table('rome');
  stock(bare, 0, { food: 2 });
  assert.deepEqual(withoutAction(bare), []);
});

test('enumerateActions offers founding a city on Barren land to the Egyptians only', () => {
  for (const [people, powers, offered] of [['egypt', ['flood_plains'], 1], ['rome', [], 0]]) {
    const g = table(people, ...powers);
    const [dust] = ring(g, capitalOf(g).hex, 1);
    setTerrain(g, dust, 'barren');
    const settler = troops(g, 0, 'settler', dust)[0];
    const there = candidates(g, 'found', (a) => a.unit === settler.id);
    assert.equal(there.length, offered, people);
    if (!offered) continue;
    assert.equal(there[0].hex, dust);
    act(g, there[0].action);
    assert.equal(g.s.cities.find((c) => c.hex === dust).owner, 0, 'the candidate can be played');
  }
});

