// The powers that are actions of their own, or that change Movement, cards and Events: Hegemony, Sprawling, Fighting
// Bands, Tribal Allies, Human Sacrifice, the Calendar, Subterfuge, the Shogunate, Nomads, Imperial Roads, Shipcraft,
// Pirate Allies and Hunnic Tribes. The fixtures are in test/civs.mjs; the other powers are in the other civ-*.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BARBARIAN, PIRATE } from '../src/engine/data/constants.js';
import { CIV_ORDER } from '../src/engine/data/civs.js';
import { gainAdvance } from '../src/engine/advance.js';
import { barbarianCities, barbarianIncursion } from '../src/engine/barbarians.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { resolveEvent } from '../src/engine/events.js';
import { allHexKeys, armyAt, cityAt, citiesOf, hexDistance, nbrs, settlementsLeft, unitsLeft } from '../src/engine/queries.js';
import { checkInvariants } from './harness.mjs';
import { act, capitalOf, fresh, give, refused, settlerOf } from './scenario.mjs';
import {
  asking, barbarians, bay, E, free, logged, me, NE, NW, ofType, optionIds, pirates, power, run, setTerrain, stack, stock, SW, town,
  troops, W, world,
} from './civs.mjs';

const unit = (g, id) => g.s.units.find((u) => u.id === id);
const hexOf = (g, id) => unit(g, id)?.hex;
/** The sorted unit types one owner has in a space. */
const typesAt = (g, hex, owner = 0) => g.s.units.filter((u) => u.hex === hex && u.owner === owner).map((u) => u.type).sort();
const listed = (g, cat, p = 0) => enumerateActions(g, p).filter((c) => c.cat === cat);
/** The first `n` empty spaces of the map. */
const spots = (g, n) => allHexKeys(g.s).filter((k) => free(g, k)).slice(0, n);
/** Autocracy through Nationalism: the Advance that gives the powers that hang on "a Government". */
function autocracy(g, p = 0) {
  give(g, p, { advances: ['draft'] });
  run(g, gainAdvance(g, p, 'nationalism'));
}

// ------------------------------------------------------------------ hegemony
/** Carthage with Hegemony and a Ship on a Sea space; the six spaces around it are free Land. */
function gulf(...powers) {
  const g = world('carthage', { opponents: 2 });
  const { o: sea, at } = bay(g);
  power(g, 0, 'hegemony', ...powers);
  setTerrain(g, sea, 'sea');
  const ship = troops(g, 0, 'ship', sea)[0].id;
  return { g, sea, at, ship };
}

test('Hegemony: a Ship founds a city on the land beside it and goes back to the supply', () => {
  const { g, at, ship } = gulf();
  const to = at(E);
  const res = { ...me(g).res };
  assert.equal(unitsLeft(g.s, 0, 'ship'), 3);
  g.drainEvents();
  act(g, { type: 'hegemony', unit: ship, to });
  const city = cityAt(g.s, to);
  assert.equal(city?.owner, 0);
  assert.equal(city.mood, 'neutral');
  assert.equal(unit(g, ship), undefined);
  assert.equal(unitsLeft(g.s, 0, 'ship'), 4);
  assert.equal(settlementsLeft(g.s, 0), 5);
  assert.equal(g.s.turn.actionsLeft, 2, 'it is an action');
  assert.deepEqual(me(g).res, res, 'and costs nothing else');
  assert.deepEqual(ofType(g.drainEvents(), 'found').map((e) => e.hex), [to]);
  assert.ok(logged(g, /founds a new city from a Ship \(Hegemony\)/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Hegemony: the cargo goes ashore with the new city and cannot Move again this turn', () => {
  const { g, at, sea, ship } = gulf();
  give(g, 0, { advances: ['tactics'] });
  const [settler] = troops(g, 0, 'settler', sea);
  const [soldier] = troops(g, 0, 'infantry', sea);
  const to = at(E);
  act(g, { type: 'hegemony', unit: ship, to });
  for (const u of [settler, soldier]) {
    assert.equal(hexOf(g, u.id), to);
    assert.equal(g.s.turn.unitFlags[u.id].stopped, 'hegemony');
    assert.match(refused(g, { type: 'move', units: [u.id], to: at(E, E) }), /landed by Hegemony cannot move again/);
  }
  assert.deepEqual(checkInvariants(g), []);
});

test('Hegemony: units may stay aboard the other Ships, as many as these carry', () => {
  const { g, at, sea, ship } = gulf();
  troops(g, 0, 'ship', sea); // two Ships carry four units; one is left to carry two
  const [s1, i1, i2, i3] = [...troops(g, 0, 'settler', sea), ...troops(g, 0, 'infantry', sea, 3)].map((u) => u.id);
  const to = at(E);
  assert.match(refused(g, { type: 'hegemony', unit: ship, to, stay: [s1, i1, i2] }), /other Ships cannot carry that many/);
  assert.match(refused(g, { type: 'hegemony', unit: ship, to, stay: [settlerOf(g).id] }), /Only units on these Ships can stay/);
  act(g, { type: 'hegemony', unit: ship, to, stay: [s1, i1] });
  assert.deepEqual([s1, i1].map((id) => hexOf(g, id)), [sea, sea]);
  assert.deepEqual([i2, i3].map((id) => hexOf(g, id)), [to, to]);
  assert.equal(g.s.turn.unitFlags[s1]?.stopped, undefined, 'those that stayed are not stopped');
  assert.equal(g.s.turn.unitFlags[i2].stopped, 'hegemony');
  assert.deepEqual(checkInvariants(g), []);
});

test('Hegemony: the Army that lands may not make a stack of more than four on the new city', () => {
  const { g, at, sea, ship } = gulf();
  troops(g, 0, 'ship', sea);
  const to = at(E);
  troops(g, 0, 'infantry', to, 3);
  const [i1, i2] = troops(g, 0, 'infantry', sea, 2).map((u) => u.id);
  const [settler] = troops(g, 0, 'settler', sea).map((u) => u.id);
  assert.match(refused(g, { type: 'hegemony', unit: ship, to }), /do not fit on the new city/);
  act(g, { type: 'hegemony', unit: ship, to, stay: [i2] });
  assert.equal(armyAt(g.s, to, 0).length, 4);
  assert.deepEqual([hexOf(g, i1), hexOf(g, i2), hexOf(g, settler)], [to, sea, to], 'Settlers are not Army: they land too');
  assert.deepEqual(checkInvariants(g), []);
});

test('Hegemony: it founds only where a Settler could, and only from one of your Ships', () => {
  const { g, at, ship } = gulf();
  troops(g, 1, 'infantry', at(E));
  town(g, 1, at(NE));
  setTerrain(g, at(NW), 'barren');
  g.s.map.hexes[at(W)].exhausted = true;
  setTerrain(g, at(SW), 'sea');
  setTerrain(g, at(W, W), 'sea');
  const foe = troops(g, 1, 'ship', at(W, W))[0].id;
  const refusals = [
    [{ unit: ship, to: at(E) }, /Enemy units are in the way/],
    [{ unit: ship, to: at(NE) }, /already a city/],
    [{ unit: ship, to: at(NW) }, /Barren land cannot hold a city/],
    [{ unit: ship, to: at(W) }, /exhausted/],
    [{ unit: ship, to: at(SW) }, /only be founded on land/],
    [{ unit: ship, to: at(E, E) }, /Land space next to the Ship/],
    [{ unit: foe, to: at(W) }, /Choose one of your Ships/],
    [{ unit: settlerOf(g).id, to: at(E) }, /Choose one of your Ships/],
  ];
  for (const [a, why] of refusals) assert.match(refused(g, { type: 'hegemony', ...a }), why);
});

test('Hegemony: it needs an action and a Settlement in the supply', () => {
  const { g, sea, at, ship } = gulf();
  const to = at(E);
  g.s.turn.actionsLeft = 0;
  assert.match(refused(g, { type: 'hegemony', unit: ship, to }), /no actions left/);
  g.s.turn.actionsLeft = 3;
  for (const k of allHexKeys(g.s).filter((x) => hexDistance(x, sea) > 2 && free(g, x)).slice(0, 6)) town(g, 0, k);
  assert.equal(settlementsLeft(g.s, 0), 0);
  assert.match(refused(g, { type: 'hegemony', unit: ship, to }), /no Settlements left/);
});

test('Hegemony: a Pirate Ship is yours to use only while one of your units shares its space (Pirate Allies)', () => {
  const g = world('carthage', { opponents: 2 });
  const { o: sea, at } = bay(g);
  power(g, 0, 'hegemony', 'pirate_allies');
  setTerrain(g, sea, 'sea');
  const [pirate] = pirates(g, sea).map((u) => u.id);
  const to = at(E);
  assert.equal(unitsLeft(g.s, PIRATE, 'ship'), 3);
  assert.match(refused(g, { type: 'hegemony', unit: pirate, to }), /Choose one of your Ships/);
  const [settler] = troops(g, 0, 'settler', sea).map((u) => u.id);
  act(g, { type: 'hegemony', unit: pirate, to });
  assert.equal(cityAt(g.s, to)?.owner, 0);
  assert.equal(unit(g, pirate), undefined);
  assert.equal(hexOf(g, settler), to, 'the Settler that shared the Ship lands');
  assert.equal(unitsLeft(g.s, PIRATE, 'ship'), 4, 'the Pirate Ship is back in the Pirates\' supply');
  assert.deepEqual(checkInvariants(g), []);
});

// ----------------------------------------------------------------- sprawling
/** China with Sprawling and a happy city on open land, holding `n` Settlers (the first one of the capital) and 2 Food. */
function chinese(n = 1) {
  const g = world('china', { opponents: 2 });
  const { o, at } = bay(g);
  power(g, 0, 'sprawling');
  const city = town(g, 0, o, 'happy').id;
  settlerOf(g).hex = o;
  troops(g, 0, 'settler', o, n - 1);
  stock(g, 0, { food: 2 });
  return { g, city, o, at };
}
const recruitSettler = (g, city) => act(g, { type: 'recruit', city, units: { settler: 1 } });

test('Sprawling: after a Recruit that made a Settler, up to three groups of Settlers move out of their cities for free', () => {
  const { g, city, o, at } = chinese(3);
  recruitSettler(g, city);
  assert.equal(g.s.turn.actionsLeft, 2);
  act(g, { type: 'sprawl' });
  const crew = g.s.units.filter((u) => u.owner === 0 && u.type === 'settler').map((u) => u.id);
  assert.equal(crew.length, 4);
  const goals = [at(E), at(NE), at(NW)];
  crew.slice(0, 3).forEach((id, i) => act(g, { type: 'move', units: [id], to: goals[i] }));
  assert.equal(g.s.turn.actionsLeft, 2, 'three groups moved for free');
  assert.deepEqual(crew.map((id) => hexOf(g, id)), [...goals, o]);
  act(g, { type: 'move', units: [crew[3]], to: at(W) });
  assert.equal(g.s.turn.actionsLeft, 1, 'a fourth group is a Move action of its own');
  assert.deepEqual(checkInvariants(g), []);
});

test('Sprawling: a Settler outside the cities, or Army, makes an ordinary Move and gives up the free ones', () => {
  const { g, city, at } = chinese(1);
  const outside = troops(g, 0, 'settler', at(E))[0].id;
  recruitSettler(g, city);
  act(g, { type: 'sprawl' });
  assert.ok(g.s.turn.move.sprawl);
  act(g, { type: 'move', units: [outside], to: at(E, E) });
  assert.equal(g.s.turn.actionsLeft, 1, 'only Settlers that start in a city move for free');
  assert.ok(!g.s.turn.move.sprawl);

  const again = chinese(1);
  give(again.g, 0, { advances: ['tactics'] });
  const army = troops(again.g, 0, 'infantry', again.o)[0].id;
  recruitSettler(again.g, again.city);
  act(again.g, { type: 'sprawl' });
  act(again.g, { type: 'move', units: [army], to: again.at(NE) });
  assert.equal(again.g.s.turn.actionsLeft, 1, 'Sprawling moves only Settlers');
  assert.ok(!again.g.s.turn.move.sprawl);
});

test('Sprawling: the free Move reaches one space, as any Move of Settlers does', () => {
  const { g, city, at } = chinese(1);
  recruitSettler(g, city);
  act(g, { type: 'sprawl' });
  const crew = g.s.units.filter((u) => u.owner === 0 && u.type === 'settler').map((u) => u.id);
  assert.match(refused(g, { type: 'move', units: [crew[0]], to: at(E, E) }), /too far/);
  assert.equal(g.s.turn.actionsLeft, 2);
});

test('Sprawling follows a Recruit that made a Settler, once, and only until another action is spent', () => {
  const { g, city } = chinese(1);
  stock(g, 0, { food: 5, ore: 1 });
  assert.match(refused(g, { type: 'sprawl' }), /follows a Recruit action that made a Settler/);
  act(g, { type: 'recruit', city, units: { infantry: 1 } });
  assert.match(refused(g, { type: 'sprawl' }), /follows a Recruit action that made a Settler/, 'Infantry are not Settlers');
  recruitSettler(g, city);
  act(g, { type: 'sprawl' });
  assert.match(refused(g, { type: 'sprawl' }), /follows a Recruit action/, 'once per Recruit');

  const next = chinese(2);
  recruitSettler(next.g, next.city);
  const [walker] = next.g.s.units.filter((u) => u.owner === 0 && u.type === 'settler').map((u) => u.id);
  act(next.g, { type: 'move', units: [walker], to: next.at(E) });
  assert.match(refused(next.g, { type: 'sprawl' }), /follows a Recruit action/, 'another action spends it');
});

test('Sprawling: Settlers that other means made (Fighting Bands) do not open it, and only the Chinese Sprawl', () => {
  const g = world('china');
  autocracy(g);
  power(g, 0, 'sprawling');
  const infantry = troops(g, 0, 'infantry', capitalOf(g).hex)[0].id;
  act(g, { type: 'fighting_bands', units: [infantry] });
  assert.equal(unit(g, infantry).type, 'settler');
  assert.match(refused(g, { type: 'sprawl' }), /follows a Recruit action/);

  const rome = world('rome');
  stock(rome, 0, { food: 2 });
  recruitSettler(rome, capitalOf(rome).id);
  assert.ok(!rome.s.turn.sprawl);
  assert.match(refused(rome, { type: 'sprawl' }), /do not have Sprawling/);
});

// ------------------------------------------------------------ fighting bands
test('Fighting Bands: Settlers become Infantry for free, and the supplies follow', () => {
  const g = world('china');
  autocracy(g);
  const home = capitalOf(g).hex;
  const crew = [settlerOf(g).id, troops(g, 0, 'settler', home)[0].id];
  g.drainEvents();
  act(g, { type: 'fighting_bands', units: crew });
  assert.deepEqual(typesAt(g, home), ['infantry', 'infantry']);
  assert.equal(g.s.turn.actionsLeft, 3, 'no action is spent');
  assert.deepEqual([unitsLeft(g.s, 0, 'settler'), unitsLeft(g.s, 0, 'infantry')], [4, 14]);
  assert.deepEqual(ofType(g.drainEvents(), 'convert').map((e) => e.units), [crew]);
  assert.ok(logged(g, /Fighting Bands/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Fighting Bands: Infantry become Settlers, and a swap of one for one can mix them', () => {
  const g = world('china');
  autocracy(g);
  const home = capitalOf(g).hex;
  const [i1, i2] = troops(g, 0, 'infantry', home, 2).map((u) => u.id);
  act(g, { type: 'fighting_bands', units: [i1, i2] });
  assert.deepEqual(typesAt(g, home), ['settler', 'settler', 'settler']);

  const mixed = world('china');
  autocracy(mixed);
  const [a, b] = [settlerOf(mixed).id, troops(mixed, 0, 'infantry', capitalOf(mixed).hex)[0].id];
  act(mixed, { type: 'fighting_bands', units: [a, b] });
  assert.deepEqual([unit(mixed, a).type, unit(mixed, b).type], ['infantry', 'settler']);
});

test('Fighting Bands: once per turn, and again the next turn', () => {
  const g = world('china');
  autocracy(g);
  const [s1, s2] = [settlerOf(g).id, troops(g, 0, 'settler', capitalOf(g).hex)[0].id];
  act(g, { type: 'fighting_bands', units: [s1] });
  assert.match(refused(g, { type: 'fighting_bands', units: [s2] }), /only be used once per turn/);
  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  assert.equal(g.cur, 0);
  act(g, { type: 'fighting_bands', units: [s2] });
  assert.deepEqual([unit(g, s1).type, unit(g, s2).type], ['infantry', 'infantry']);
});

test('Fighting Bands: a stack of Army stays within four, and the exchange of one for one always fits', () => {
  const g = world('china');
  autocracy(g);
  const home = capitalOf(g).hex;
  const settler = settlerOf(g).id;
  troops(g, 0, 'infantry', home, 3);
  const [extra] = troops(g, 0, 'settler', home).map((u) => u.id);
  assert.match(refused(g, { type: 'fighting_bands', units: [settler, extra] }), /Too many Army units would end up in one space/);
  const [fourth] = troops(g, 0, 'infantry', home).map((u) => u.id);
  assert.match(refused(g, { type: 'fighting_bands', units: [settler] }), /Too many Army units/);
  act(g, { type: 'fighting_bands', units: [settler, fourth] });
  assert.equal(unit(g, settler).type, 'infantry');
  assert.equal(unit(g, fourth).type, 'settler');
  assert.equal(armyAt(g.s, home, 0).length, 4);
  assert.deepEqual(checkInvariants(g), []);
});

test('Fighting Bands: it needs the piece in the supply, unless the exchange swaps as many as it takes', () => {
  const g = world('china');
  autocracy(g);
  const home = capitalOf(g).hex;
  troops(g, 0, 'settler', home, 3); // all four Settlers are on the board
  const [soldier] = troops(g, 0, 'infantry', home).map((u) => u.id);
  assert.equal(unitsLeft(g.s, 0, 'settler'), 0);
  assert.match(refused(g, { type: 'fighting_bands', units: [soldier] }), /no Settlers left in your supply/);
  act(g, { type: 'fighting_bands', units: [soldier, settlerOf(g).id] });
  assert.equal(unit(g, soldier).type, 'settler');

  const full = world('china');
  autocracy(full);
  const [a, b, c, d] = spots(full, 4);
  for (const k of [a, b, c, d]) troops(full, 0, 'infantry', k, 4);
  assert.equal(unitsLeft(full.s, 0, 'infantry'), 0);
  assert.match(refused(full, { type: 'fighting_bands', units: [settlerOf(full).id] }), /no Infantry left in your supply/);
});

test('Fighting Bands: only your own Settlers and Infantry', () => {
  const g = world('china');
  autocracy(g);
  const home = capitalOf(g).hex;
  const [horse] = troops(g, 0, 'cavalry', home).map((u) => u.id);
  const [foe] = troops(g, 1, 'infantry', spots(g, 1)[0]).map((u) => u.id);
  for (const units of [[], [horse], [foe], [settlerOf(g).id, horse], ['nobody']]) {
    assert.match(refused(g, { type: 'fighting_bands', units }), /Choose your Settlers and Infantry to exchange/);
  }
});

// --------------------------------------------------------------- tribal allies
/** The Celts with `food` and these powers, and a horde of `n` Barbarian Infantry on the space beside their capital. */
function raided(n, food, ...powers) {
  const g = world('celts');
  if (powers.length) power(g, 0, ...powers);
  const home = capitalOf(g).hex;
  const from = nbrs(g.s, home).find((k) => free(g, k));
  barbarians(g, 'infantry', from, n);
  stock(g, 0, { food });
  return { g, home, from };
}
const offers = (asked) => asked.filter((q) => q.kind === 'tribal_allies_cancel');

test('Tribal Allies: the Celts call Barbarians up as the Event icon does, free of an action and once per turn', () => {
  const g = world('celts');
  power(g, 0, 'tribal_allies');
  const home = capitalOf(g).hex;
  const asked = asking(g);
  g.drainEvents();
  act(g, { type: 'tribal_allies' });
  const camps = barbarianCities(g.s);
  assert.equal(camps.length, 1);
  assert.equal(hexDistance(camps[0].hex, home), 2);
  assert.equal(armyAt(g.s, camps[0].hex, BARBARIAN).length, 2, 'an Infantry comes with the Settlement, and one more musters');
  const sites = asked.find((q) => q.title === 'Barbarians appear!').options;
  assert.ok(sites.length > 1 && sites.every((o) => hexDistance(o.id, home) === 2));
  assert.equal(g.s.turn.actionsLeft, 3, 'it costs no action');
  assert.deepEqual(ofType(g.drainEvents(), 'barbarians').map((e) => e.kind), ['spawn', 'reinforce']);
  assert.ok(logged(g, /calls on the Barbarian tribes \(Tribal Allies\)/));
  assert.match(refused(g, { type: 'tribal_allies' }), /once per turn/);
  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  act(g, { type: 'tribal_allies' });
  assert.equal(barbarianCities(g.s).length, 2, 'and again on the next turn');
  assert.deepEqual(checkInvariants(g), []);
});

test('Tribal Allies: it is refused while no Barbarian could appear, and the refusal does not use the turn up', () => {
  const g = world('celts');
  power(g, 0, 'tribal_allies');
  const horde = spots(g, 5).flatMap((k) => barbarians(g, 'infantry', k, 4)).map((u) => u.id);
  assert.equal(unitsLeft(g.s, BARBARIAN, 'infantry'), 0);
  assert.match(refused(g, { type: 'tribal_allies' }), /No Barbarians can appear now/);
  g.s.units = g.s.units.filter((u) => u.id !== horde[0]);
  act(g, { type: 'tribal_allies' });
  assert.equal(barbarianCities(g.s).length, 1);
  assert.equal(g.s.turn.used.tribalAllies, true);
});

test('Tribal Allies: 1 Food for each Barbarian unit calls off an attack, and the army stays where it was', () => {
  const { g, home, from } = raided(3, 3, 'tribal_allies');
  stack(g, 'civil_war');
  const asked = asking(g, { tribal_allies_cancel: 'yes' });
  const events = run(g, resolveEvent(g, 0));
  const [offer, ...rest] = offers(asked);
  assert.equal(rest.length, 0);
  assert.deepEqual([offer.player, offer.hex, offer.default], [0, home, 'yes']);
  assert.equal(me(g).res.food, 0, '3 Food for 3 units');
  assert.equal(armyAt(g.s, from, BARBARIAN).length, 3);
  assert.equal(cityAt(g.s, home).owner, 0);
  assert.deepEqual(ofType(events, 'barbarians'), []);
  assert.ok(logged(g, /buys off the Barbarian attack at .* \(Tribal Allies\)/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Tribal Allies: a Barbarian Incursion is called off the same way', () => {
  const { g, from } = raided(2, 2, 'tribal_allies');
  const asked = asking(g, { tribal_allies_cancel: 'yes' });
  const events = run(g, barbarianIncursion(g, 0));
  assert.equal(offers(asked).length, 1);
  assert.equal(me(g).res.food, 0, '2 Food for 2 units');
  assert.equal(armyAt(g.s, from, BARBARIAN).length, 2);
  assert.deepEqual(ofType(events, 'barbarians'), []);
  assert.deepEqual(checkInvariants(g), []);
});

test('Tribal Allies: the attack goes ahead without the power, without the Food, or when the Celts decline', () => {
  const cases = [
    { why: 'without the power', powers: [], food: 3, answers: {}, asks: 0 },
    { why: 'with too little Food', powers: ['tribal_allies'], food: 1, answers: {}, asks: 0 },
    { why: 'when the Celts decline', powers: ['tribal_allies'], food: 3, answers: { tribal_allies_cancel: 'no' }, asks: 1 },
  ];
  for (const { why, powers, food, answers, asks } of cases) {
    const { g, home, from } = raided(2, food, ...powers);
    const asked = asking(g, answers);
    const events = run(g, barbarianIncursion(g, 0));
    assert.equal(offers(asked).length, asks, why);
    assert.equal(me(g).res.food, food, why);
    assert.deepEqual(ofType(events, 'barbarians').map((e) => [e.kind, e.from, e.hex]), [['move', from, home]], why);
    assert.ok(!logged(g, /buys off/), why);
  }
});

// ------------------------------------------------------------- human sacrifice
/** The Aztecs with Human Sacrifice (or only these powers), a Captive of each of these owners, and nothing in store. */
function sacrificer(owners, powers = ['captives', 'human_sacrifice']) {
  const g = world('aztecs');
  power(g, 0, ...powers);
  me(g).captives = owners.map((owner) => ({ owner, type: 'infantry' }));
  stock(g, 0, {});
  return g;
}
const sacrifices = (asked) => asked.filter((q) => q.kind === 'human_sacrifice').map((q) => q.card);

test('Human Sacrifice: a Captive cancels the Event card just drawn, icon and text, and another one is drawn', () => {
  const g = sacrificer([1, BARBARIAN]);
  stack(g, 'good_year', 'awesome_year');
  let asks = 0;
  const asked = asking(g, { human_sacrifice: () => (asks++ === 0 ? 'yes' : 'no') });
  const events = run(g, resolveEvent(g, 0));
  assert.deepEqual(sacrifices(asked), ['good_year', 'awesome_year']);
  assert.deepEqual(ofType(events, 'event').map((e) => e.card), ['good_year', 'awesome_year']);
  assert.deepEqual(me(g).res, { food: 1, wood: 1, ore: 1, ideas: 1, gold: 0 }, 'only Awesome Year: not the Gold of the icon, nor the Food of the text');
  assert.deepEqual(me(g).captives, [{ owner: 1, type: 'infantry' }], 'the Barbarian Captive went first');
  assert.deepEqual(ofType(events, 'sacrifice').map((e) => e.from), [BARBARIAN]);
  assert.deepEqual(g.s.decks.eventDiscard.slice(-2), ['good_year', 'awesome_year']);
  assert.ok(logged(g, /sacrifices a Captive to cancel Good Year \(Human Sacrifice\)/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Human Sacrifice: it goes on while Captives are left, and the card drawn after the last one is kept', () => {
  const g = sacrificer([1, 1]);
  stack(g, 'good_year', 'fantastic_year', 'reformation');
  const asked = asking(g, { human_sacrifice: 'yes' });
  run(g, resolveEvent(g, 0));
  assert.deepEqual(sacrifices(asked), ['good_year', 'fantastic_year']);
  assert.equal(me(g).captives.length, 0);
  assert.deepEqual([me(g).mood, me(g).res.food, me(g).res.gold], [1, 0, 0], 'Reformation has no Captive left to cancel it');
  assert.deepEqual(g.s.decks.eventDiscard.slice(-3), ['good_year', 'fantastic_year', 'reformation']);
});

test('Human Sacrifice: a cancelled card with the Barbarian icon brings no Barbarians', () => {
  const kept = sacrificer([1]);
  stack(kept, 'population_boom', 'reformation');
  asking(kept, { human_sacrifice: 'no' });
  run(kept, resolveEvent(kept, 0));
  assert.equal(barbarianCities(kept.s).length, 1, 'kept, the card makes them appear');
  assert.equal(me(kept).captives.length, 1);

  const g = sacrificer([1]);
  stack(g, 'population_boom', 'reformation');
  asking(g, { human_sacrifice: 'yes' });
  const events = run(g, resolveEvent(g, 0));
  assert.equal(barbarianCities(g.s).length, 0);
  assert.deepEqual(ofType(events, 'barbarians'), []);
  assert.equal(me(g).mood, 1);
});

test('Human Sacrifice: nothing is asked without the power, without Captives, or with no card to draw instead', () => {
  const lone = (g) => {
    g.s.decks.event = ['good_year'];
    g.s.decks.eventDiscard = [];
  };
  const cases = [
    { why: 'without the power', make: () => sacrificer([1], ['captives']) },
    { why: 'without Captives', make: () => sacrificer([]) },
    { why: 'with no card to draw instead', make: () => { const g = sacrificer([1]); lone(g); return g; } },
  ];
  for (const { why, make } of cases) {
    const g = make();
    const held = me(g).captives.length;
    if (why !== 'with no card to draw instead') stack(g, 'good_year');
    const asked = asking(g, { human_sacrifice: 'yes' });
    run(g, resolveEvent(g, 0));
    assert.deepEqual(sacrifices(asked), [], why);
    assert.equal(me(g).captives.length, held, why);
    assert.deepEqual([me(g).res.food, me(g).res.gold], [2, 2], `${why}: Good Year takes effect`);
  }
});

test('Human Sacrifice: the cancelled card cannot come straight back from a reshuffled pile', () => {
  const g = sacrificer([1]);
  g.s.decks.event = ['good_year'];
  g.s.decks.eventDiscard = ['reformation'];
  const asked = asking(g, { human_sacrifice: 'yes' });
  run(g, resolveEvent(g, 0));
  assert.deepEqual(sacrifices(asked), ['good_year']);
  assert.equal(me(g).mood, 1, 'Reformation was drawn');
  assert.deepEqual(g.s.decks.eventDiscard, ['good_year', 'reformation']);
});

test('Human Sacrifice: a Captive is worth 1 Food, 1 Mood or 1 Culture, for free', () => {
  const g = sacrificer([1, BARBARIAN, 1]);
  g.s.turn.actionsLeft = 0;
  g.drainEvents();
  act(g, { type: 'human_sacrifice', gain: { food: 1, culture: 1 } });
  assert.deepEqual([me(g).res.food, me(g).culture, me(g).mood], [1, 1, 0]);
  assert.deepEqual(me(g).captives, [{ owner: 1, type: 'infantry' }], 'the Barbarian Captive went first');
  assert.deepEqual(ofType(g.drainEvents(), 'sacrifice').map((e) => e.from), [BARBARIAN, 1]);
  assert.ok(logged(g, /sacrifices 2 Captives \(Human Sacrifice\)/));
  act(g, { type: 'human_sacrifice', gain: { mood: 1 } });
  assert.deepEqual([me(g).mood, me(g).captives.length, g.s.turn.actionsLeft], [1, 0, 0]);
});

test('Human Sacrifice: the free conversion needs the power, a clear choice and the Captives', () => {
  const g = sacrificer([1, 1]);
  const worth = /A Captive is worth 1 Food, 1 Mood or 1 Culture/;
  for (const [gain, message] of [
    [{ gold: 1 }, worth],
    [{ food: 1.5 }, worth],
    [{ food: -1 }, worth],
    [{}, /Choose what the Captives are worth/],
    [{ food: 0 }, /Choose what the Captives are worth/],
    [{ food: 2, mood: 1 }, /do not hold that many Captives/],
  ]) {
    assert.match(refused(g, { type: 'human_sacrifice', gain }), message);
  }
  assert.match(refused(sacrificer([1], ['captives']), { type: 'human_sacrifice', gain: { food: 1 } }), /do not have Human Sacrifice/);
  assert.match(refused(world('aztecs'), { type: 'human_sacrifice', gain: { food: 1 } }), /do not have Human Sacrifice/);
});

// -------------------------------------------------------------------- calendar
/** The Maya with the Calendar and `culture`; the Event deck shows Good Year, then Awesome Year, then Plague. */
function calendar(culture) {
  const g = world('maya');
  power(g, 0, 'calendar');
  stock(g, 0, { culture });
  stack(g, 'good_year', 'awesome_year', 'plague');
  return g;
}

test('Calendar: each Culture paid puts the top Event card at the bottom of the deck, for free', () => {
  const g = calendar(2);
  g.s.turn.actionsLeft = 0;
  const size = g.s.decks.event.length;
  const asked = asking(g, { calendar: 'bottom' });
  act(g, { type: 'calendar' });
  const shown = asked.filter((q) => q.kind === 'calendar');
  assert.deepEqual(shown.map((q) => q.card), ['good_year', 'awesome_year', 'plague']);
  assert.deepEqual(shown.map(optionIds), [['keep', 'bottom'], ['keep', 'bottom'], ['keep']]);
  const deck = g.s.decks.event;
  assert.equal(deck.length, size);
  assert.deepEqual([...deck.slice(0, 2), deck.at(-1)], ['awesome_year', 'good_year', 'plague']);
  assert.equal(me(g).culture, 0);
  assert.equal(g.s.log.filter((l) => /pays 1 culture to bury the next Event card \(Calendar\)/.test(l)).length, 2);
  assert.equal(g.s.turn.actionsLeft, 0, 'no action was needed');
});

test('Calendar: keeping the card costs nothing, and without Culture or a second card it is only a look', () => {
  const g = calendar(1);
  const before = [...g.s.decks.event];
  const asked = asking(g);
  act(g, { type: 'calendar' });
  assert.deepEqual(optionIds(asked[0]), ['keep', 'bottom']);
  assert.deepEqual(g.s.decks.event, before);
  assert.equal(me(g).culture, 1);

  const poor = calendar(0);
  const seen = asking(poor, { calendar: 'bottom' });
  act(poor, { type: 'calendar' });
  assert.deepEqual(optionIds(seen[0]), ['keep']);
  assert.equal(poor.s.decks.event.at(-1), 'good_year');

  const last = calendar(5);
  last.s.decks.event = ['plague'];
  const only = asking(last, { calendar: 'bottom' });
  act(last, { type: 'calendar' });
  assert.deepEqual(optionIds(only[0]), ['keep']);
  assert.deepEqual([me(last).culture, last.s.decks.event], [5, ['plague']]);
});

test('Calendar: only for the Maya who have it, and only while there is an Event card to look at', () => {
  assert.match(refused(world('maya'), { type: 'calendar' }), /do not have the Calendar/);
  assert.match(refused(world('rome'), { type: 'calendar' }), /do not have the Calendar/);
  const g = calendar(2);
  g.s.decks.event = [];
  g.s.decks.eventDiscard = [];
  assert.match(refused(g, { type: 'calendar' }), /no Event cards left/);
  g.s.decks.eventDiscard = ['plague'];
  const asked = asking(g);
  act(g, { type: 'calendar' });
  assert.deepEqual(asked.map((q) => q.card), ['plague'], 'the discard pile is shuffled back when the deck is empty');
});

// MORE
