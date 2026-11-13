// The powers that are actions of their own, or that change Movement, cards and Events: Hegemony, Sprawling, Fighting
// Bands, Tribal Allies, Human Sacrifice, the Calendar, Subterfuge, the Shogunate, Nomads, Imperial Roads, Shipcraft,
// Pirate Allies and Hunnic Tribes. The fixtures are in test/civs.mjs; the other powers are in the other civ-*.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BARBARIAN, PIRATE } from '../src/engine/data/constants.js';
import { CIV_ORDER, CIVS } from '../src/engine/data/civs.js';
import { advanceCost, gainAdvance } from '../src/engine/advance.js';
import { barbarianCities, barbarianFeud, barbarianIncursion, steppeScourge } from '../src/engine/barbarians.js';
import { collectCandidates } from '../src/engine/city.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { resolveEvent } from '../src/engine/events.js';
import { moveOptions, seaReach, shipRoutes } from '../src/engine/move.js';
import { placePirates, pirateRaid, raidedCities } from '../src/engine/pirates.js';
import {
  allHexKeys, armyAt, cityAt, controlledPirates, freePirates, hasAdv, hexDistance, navyAt, nbrs, pirateBlocked, pirateMaster,
  settlementsLeft, shipsAt, unitsLeft,
} from '../src/engine/queries.js';
import { tradeRoutes } from '../src/engine/trade.js';
import { checkInvariants } from './harness.mjs';
import { act, capitalOf, fresh, give, hold, refused, rigDice, settlerOf } from './scenario.mjs';
import {
  asking, barbarians, bay, E, free, harbour, logged, me, NE, NW, ofType, optionIds, pirates, power, ring, run, setTerrain, SE, stack, stock, SW,
  town, troops, W, world,
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

// ------------------------------------------------------------------ subterfuge
/** Rome plays and Japan watches with Subterfuge: its Infantry stands `d` spaces from the Roman capital, and it holds these cards. */
function intrigue({ mine = ['caravan'], theirs = ['harvest', 'timber'], d = 2, spy = true } = {}) {
  const g = world(['rome', 'japan']);
  if (spy) power(g, 1, 'subterfuge');
  hold(g, 0, ...mine);
  hold(g, 1, ...theirs);
  if (d) troops(g, 1, 'infantry', ring(g, capitalOf(g).hex, d)[0]);
  stock(g, 0, {});
  return g;
}
const watched = (asked) => asked.filter((q) => q.kind === 'subterfuge');
const play = (card) => ({ type: 'play_card', card });

test('Subterfuge: a rival discards an Action card to cancel the card played, which costs no action and does nothing', () => {
  const g = intrigue();
  const asked = asking(g, { subterfuge: 'harvest' });
  g.drainEvents();
  act(g, play('caravan'));
  const [q, ...rest] = watched(asked);
  assert.equal(rest.length, 0);
  assert.deepEqual([q.player, q.by, q.card, q.default], [1, 0, 'caravan', 'no']);
  assert.deepEqual(optionIds(q), ['no', 'harvest', 'timber']);
  assert.deepEqual([me(g).res.gold, g.s.turn.actionsLeft], [0, 3]);
  assert.deepEqual([me(g, 0).hand.action, me(g, 1).hand.action], [[], ['timber']]);
  assert.deepEqual(g.s.decks.actionDiscard.slice(-2), ['caravan', 'harvest'], 'both cards are discarded');
  const events = g.drainEvents();
  assert.deepEqual(ofType(events, 'card').map((e) => e.card), ['caravan'], 'the card was played');
  assert.deepEqual(ofType(events, 'subterfuge').map((e) => [e.player, e.by, e.card, e.discarded]), [[1, 0, 'caravan', 'harvest']]);
  assert.ok(logged(g, /discards Bountiful Harvest to cancel Trade Caravan \(Subterfuge\)/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Subterfuge: when the rival lets the card happen it works, and costs its action', () => {
  const g = intrigue();
  const asked = asking(g);
  act(g, play('caravan'));
  assert.equal(watched(asked).length, 1);
  assert.deepEqual([me(g).res.gold, g.s.turn.actionsLeft], [1, 2]);
  assert.deepEqual(me(g, 1).hand.action, ['harvest', 'timber']);
  assert.deepEqual(g.s.decks.actionDiscard, ['caravan']);
  assert.deepEqual(ofType(g.drainEvents(), 'subterfuge'), []);
});

test('Subterfuge: the rival needs an Action card, and a city or an Army unit within 2 spaces of a unit or a city of the player', () => {
  const home = (g) => capitalOf(g).hex;
  const cases = [
    ['an Army unit 2 spaces from a city of the player', true, {}],
    ['an Army unit 3 spaces away', false, { d: 3 }],
    ['a Settler beside the city: Settlers are no Army', false, { d: 0, then: (g) => troops(g, 1, 'settler', ring(g, home(g), 1)[0]) }],
    ['a city 2 spaces away', true, { d: 0, then: (g) => town(g, 1, ring(g, home(g), 2)[0]) }],
    ['a Settler of the player 2 spaces from a city of the rival', true, { d: 0, then: (g) => troops(g, 0, 'settler', ring(g, capitalOf(g, 1).hex, 2)[0]) }],
    ['no Action card in hand', false, { theirs: [] }],
    ['no Subterfuge', false, { spy: false }],
  ];
  for (const [why, expected, { then, ...options }] of cases) {
    const g = intrigue(options);
    then?.(g);
    const asked = asking(g, { subterfuge: 'harvest' });
    act(g, play('caravan'));
    assert.equal(watched(asked).length, expected ? 1 : 0, why);
    assert.equal(me(g).res.gold, expected ? 0 : 1, why);
  }
});

test('Subterfuge: a free card can be cancelled too, and a play the rules refuse is not announced', () => {
  const g = intrigue({ mine: ['harvest', 'caravan'], theirs: ['timber', 'timber'] });
  const asked = asking(g, { subterfuge: 'timber' });
  act(g, play('harvest'));
  assert.deepEqual([me(g).res.food, g.s.turn.actionsLeft], [0, 3], 'no Food from a free card either');
  assert.equal(watched(asked).length, 1);
  g.s.turn.actionsLeft = 0;
  assert.match(refused(g, play('caravan')), /no actions left/);
  assert.equal(watched(asked).length, 1, 'Japan was not asked');
  assert.deepEqual(me(g, 0).hand.action, ['caravan']);
});

test('Subterfuge: copies of a card make one choice, and one copy is discarded', () => {
  const g = intrigue({ theirs: ['harvest', 'harvest', 'timber'] });
  const asked = asking(g, { subterfuge: 'harvest' });
  act(g, play('caravan'));
  assert.deepEqual(optionIds(watched(asked)[0]), ['no', 'harvest', 'timber']);
  assert.deepEqual(me(g, 1).hand.action, ['harvest', 'timber']);
  assert.deepEqual(g.s.decks.actionDiscard, ['caravan', 'harvest']);
});

// ------------------------------------------------------------------- shogunate
/** The Japanese under a Government, with the Shogunate, holding these Action cards and no Resources. */
function shogun(...cards) {
  const g = world('japan');
  autocracy(g);
  assert.ok(me(g).civAdv.includes('shogunate'));
  hold(g, 1);
  hold(g, 0, ...cards);
  stock(g, 0, {});
  return g;
}

test('Shogunate: a card that says "As an Action" is played as a free action, as often as there are cards', () => {
  const g = shogun('caravan', 'caravan');
  g.s.turn.actionsLeft = 0;
  act(g, play('caravan'));
  act(g, play('caravan'));
  assert.deepEqual([me(g).res.gold, g.s.turn.actionsLeft, me(g).hand.action], [2, 0, []]);
  assert.deepEqual(checkInvariants(g), []);
});

test('Shogunate: without it the same card costs an action, and cannot be played when none is left', () => {
  const rome = world('rome');
  hold(rome, 1);
  hold(rome, 0, 'caravan', 'caravan');
  stock(rome, 0, {});
  act(rome, play('caravan'));
  assert.deepEqual([me(rome).res.gold, rome.s.turn.actionsLeft], [1, 2]);
  rome.s.turn.actionsLeft = 0;
  assert.match(refused(rome, play('caravan')), /You have no actions left/);

  const japan = world('japan');
  hold(japan, 0, 'caravan');
  act(japan, play('caravan'));
  assert.equal(japan.s.turn.actionsLeft, 2, 'the Japanese before a Government pay for it too');
});

test('Shogunate: Draft pays 1 Mood to draw an Action card in place of an Infantry', () => {
  const g = shogun();
  const city = capitalOf(g);
  give(g, 0, { mood: 2 });
  const top = g.s.decks.action.at(-1);
  const left = g.s.decks.action.length;
  act(g, { type: 'recruit', city: city.id, units: {}, draftCard: true });
  assert.deepEqual(me(g).hand.action, [top]);
  assert.equal(g.s.decks.action.length, left - 1);
  assert.equal(me(g).mood, 1);
  assert.equal(g.s.turn.actionsLeft, 2, 'it is a Recruit action');
  assert.deepEqual(typesAt(g, city.hex), ['settler'], 'no unit is recruited');
  assert.equal(g.s.turn.draftUses, 1);
  assert.ok(logged(g, /recruits an Action card/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Shogunate: the card needs Draft and the Shogunate, 1 Mood and a free place in the city, and Draft is used once', () => {
  const g = shogun();
  const draw = (extra = {}) => ({ type: 'recruit', city: capitalOf(g).id, units: {}, draftCard: true, ...extra });
  assert.match(refused(g, draw()), /You cannot afford that/);
  give(g, 0, { mood: 3 });
  assert.match(refused(g, draw({ draft: true, units: { infantry: 1 } })), /Draft can be used once per Recruit action/);
  assert.match(refused(g, draw({ units: { settler: 2 } })), /at most 2 units/);

  const without = (civ, ...powers) => {
    const w = world(civ);
    give(w, 0, { advances: ['draft'], mood: 3 });
    if (powers.length) power(w, 0, ...powers);
    return w;
  };
  for (const [why, w] of [['without the Shogunate', without('japan')], ['Rome', without('rome')], ['without Draft', (() => { const w = without('japan', 'shogunate'); w.s.players[0].advances = w.s.players[0].advances.filter((a) => a !== 'draft'); return w; })()]]) {
    assert.match(refused(w, { type: 'recruit', city: capitalOf(w).id, units: {}, draftCard: true }), /The Shogunate lets Draft draw an Action card/, why);
  }
});

// ---------------------------------------------------------------------- nomads
/** The Huns with Nomads and no Resources: their capital is a size-1 happy city on an open plain, and `to` is a free space beside it. */
function steppe() {
  const g = world('huns');
  power(g, 0, 'nomads');
  stock(g, 0, {});
  const city = capitalOf(g);
  return { g, city: city.id, from: city.hex, to: nbrs(g.s, city.hex).find((k) => free(g, k)) };
}
const trek = (city, to, units = []) => ({ type: 'move', units, city, to });

test('Nomads: a size-1 city moves one space like a unit and gains 1 Resource of its new space', () => {
  const { g, city, from, to } = steppe();
  const settler = settlerOf(g).id;
  g.drainEvents();
  act(g, trek(city, to));
  assert.equal(capitalOf(g).hex, to);
  assert.equal(cityAt(g.s, from), null);
  assert.equal(hexOf(g, settler), from, 'the Settler stays behind');
  assert.equal(me(g).res.food, 1);
  assert.equal(g.s.turn.actionsLeft, 2, 'it is a Move action');
  assert.equal(capitalOf(g).mood, 'happy', 'the first activation is free');
  assert.equal(g.s.turn.activated[city], 1);
  assert.deepEqual(ofType(g.drainEvents(), 'move').map((e) => [e.from, e.to, e.city]), [[from, to, city]]);
  assert.ok(logged(g, /city moves to a new space and gains 1 food \(Nomads\)/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Nomads: the city is one group of a Move action, and every move activates it again', () => {
  const { g, city, from, to } = steppe();
  const [camp] = troops(g, 0, 'settler', ring(g, from, 3)[0]).map((u) => u.id);
  act(g, trek(city, to));
  act(g, { type: 'move', units: [camp], to: nbrs(g.s, hexOf(g, camp)).find((k) => free(g, k)) });
  assert.equal(g.s.turn.actionsLeft, 2, 'another group of the same Move action is free');

  const second = nbrs(g.s, to).find((k) => free(g, k) && k !== from);
  act(g, trek(city, second));
  assert.equal(g.s.turn.actionsLeft, 1, 'the same city moving again starts another Move action');
  assert.equal(capitalOf(g).mood, 'neutral', 'its second activation costs a Mood step');
  assert.equal(me(g).res.food, 2);
  const third = nbrs(g.s, second).find((k) => free(g, k) && k !== to);
  act(g, trek(city, third));
  assert.equal(capitalOf(g).mood, 'angry');
  assert.match(refused(g, trek(city, nbrs(g.s, third).find((k) => free(g, k)))), /Angry cities cannot move/);
  assert.deepEqual(checkInvariants(g), []);
});

test('Nomads: the Resource is the one a city could collect from that space, and a Mountain stops the city for the turn', () => {
  const cases = [['plains', 'food'], ['forest', 'wood'], ['mountain', 'ore'], ['barren', null], ['exhausted', null]];
  for (const [terrain, gained] of cases) {
    const { g, city, to } = steppe();
    if (terrain === 'exhausted') g.s.map.hexes[to].exhausted = true;
    else setTerrain(g, to, terrain);
    act(g, trek(city, to));
    assert.deepEqual(me(g).res, { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0, ...(gained ? { [gained]: 1 } : {}) }, terrain);
    assert.equal(logged(g, /gains 1 \w+ \(Nomads\)/), gained !== null, terrain);
    assert.ok(logged(g, /city moves to a new space/), terrain);
    const next = nbrs(g.s, to).find((k) => free(g, k));
    if (terrain === 'mountain') assert.match(refused(g, trek(city, next)), /stopped on a Mountain and cannot move again this turn/);
    else act(g, trek(city, next));
  }
});

test('Nomads: only a size-1 city that is not Angry moves, one space at a time onto an empty land space and without Roads', () => {
  const refusals = [
    [/Only cities of size 1 can move/, (g, c) => { c.buildings.market = 0; }],
    [/Angry cities cannot move/, (g, c) => { c.mood = 'angry'; }],
    [/can never move onto another city/, (g, c, to) => { town(g, 0, to); }],
    [/Enemy units are in the way/, (g, c, to) => { troops(g, 1, 'infantry', to); }],
    [/neither sail nor explore/, (g, c, to) => { setTerrain(g, to, 'sea'); }],
    [/one space at a time/, (g, c, to, far) => ({ to: far })],
    [/cannot use Roads/, () => ({ roads: true })],
  ];
  for (const [message, setup] of refusals) {
    const { g, city, from, to } = steppe();
    const change = setup(g, capitalOf(g), to, ring(g, from, 2)[0]);
    assert.match(refused(g, { ...trek(city, to), ...change }), message);
  }
});

test('Nomads: only the Huns who have them move a city, and only their own', () => {
  const { g, city, to } = steppe();
  assert.match(refused(g, trek(capitalOf(g, 1).id, to)), /Choose one of your cities/);
  for (const bare of [world('huns'), world('rome')]) {
    const c = capitalOf(bare);
    assert.match(refused(bare, trek(c.id, nbrs(bare.s, c.hex).find((k) => free(bare, k)))), /You need Nomads to move a city/);
  }
  assert.ok(city);
});

test('Nomads: the Settlers in the city go along with it, and an Army goes only with Tactics', () => {
  const { g, city, from, to } = steppe();
  const first = settlerOf(g).id;
  const [mate] = troops(g, 0, 'settler', from).map((u) => u.id);
  const [soldier] = troops(g, 0, 'infantry', from).map((u) => u.id);
  assert.match(refused(g, trek(city, to, [soldier])), /You need Tactics/);
  act(g, trek(city, to, [first, mate]));
  assert.deepEqual([first, mate].map((id) => hexOf(g, id)), [to, to]);
  assert.equal(hexOf(g, soldier), from);
  assert.equal(capitalOf(g).hex, to);
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.deepEqual(checkInvariants(g), []);
});

// -------------------------------------------------------------- imperial roads
/** Rome with Roads (and Imperial Roads) and two of its cities in a line 4 spaces long: 2 Settlers wait in the west one. */
function highway(imperial = true) {
  const g = world('rome', { opponents: 2 });
  const { o, at } = bay(g);
  if (imperial) power(g, 0, 'imperial_roads');
  else give(g, 0, { advances: ['roads'] });
  const [west, east] = [at(W, W), at(E, E)];
  town(g, 0, west);
  town(g, 0, east);
  const crew = troops(g, 0, 'settler', west, 2).map((u) => u.id);
  stock(g, 0, { food: 1, ore: 1 });
  return { g, o, at, west, east, crew };
}
const drive = (crew, to) => ({ type: 'move', units: crew, to, roads: true });

test('Imperial Roads: a group goes 4 spaces from one of its cities to another for 1 Food and 1 Ore', () => {
  const { g, east, crew } = highway();
  act(g, drive(crew, east));
  assert.deepEqual(crew.map((id) => hexOf(g, id)), [east, east]);
  assert.deepEqual([me(g).res.food, me(g).res.ore], [0, 0], 'the group pays once, not for each Settler');
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.deepEqual(checkInvariants(g), []);
});

test('Imperial Roads: between two cities it reaches 3 and 4 spaces, and not 5', () => {
  for (const d of [2, 3, 4, 5]) {
    const { g, o, at, west, crew } = highway();
    const to = d === 5 ? ring(g, west, 5)[0] : [null, null, o, at(E), at(E, E)][d];
    assert.equal(hexDistance(west, to), d);
    if (!cityAt(g.s, to)) town(g, 0, to);
    if (d === 5) assert.match(refused(g, drive(crew, to)), /too far/, `${d} spaces`);
    else {
      act(g, drive(crew, to));
      assert.deepEqual(crew.map((id) => hexOf(g, id)), [to, to], `${d} spaces`);
    }
  }
});

test('Imperial Roads: both ends must be cities of the player, or the road is 2 spaces long, like Roads', () => {
  const plain = highway(false);
  assert.match(refused(plain.g, drive(plain.crew, plain.east)), /too far/, 'Roads alone');
  town(plain.g, 0, plain.o);
  act(plain.g, drive(plain.crew, plain.o));
  assert.deepEqual(plain.crew.map((id) => hexOf(plain.g, id)), [plain.o, plain.o]);

  const { g, at, east, crew } = highway();
  assert.match(refused(g, drive(crew, at(E))), /too far/, 'to a space that is no city');
  const walkers = troops(g, 0, 'settler', at(W)).map((u) => u.id);
  assert.match(refused(g, drive(walkers, east)), /too far/, 'from a space that is no city');
  assert.match(refused(g, { type: 'move', units: crew, to: east }), /too far/, 'and without Roads it is one space');
});

test('Imperial Roads: the spaces on the way must be land, and free of enemy units and cities', () => {
  const blocks = [
    ['a Sea space', (g, o) => setTerrain(g, o, 'sea')],
    ['enemy units', (g, o) => troops(g, 1, 'infantry', o)],
    ['an enemy city', (g, o) => town(g, 1, o)],
  ];
  for (const [why, block] of blocks) {
    const { g, o, east, crew } = highway();
    block(g, o);
    assert.match(refused(g, drive(crew, east)), /There is no clear road to that space/, why);
  }
});

test('Imperial Roads: an Army group needs Tactics, and the stack limit holds for every space it passes through', () => {
  const { g, o, east, west } = highway();
  const army = troops(g, 0, 'infantry', west, 2).map((u) => u.id);
  assert.match(refused(g, drive(army, east)), /You need Tactics/);
  give(g, 0, { advances: ['tactics'] });
  const wall = troops(g, 0, 'infantry', o, 3);
  assert.match(refused(g, drive(army, east)), /There is no clear road to that space/);
  g.s.units = g.s.units.filter((u) => u.id !== wall[0].id);
  act(g, drive(army, east));
  assert.deepEqual(army.map((id) => hexOf(g, id)), [east, east]);
  assert.deepEqual(checkInvariants(g), []);
});

test('Imperial Roads: the 1 Food and 1 Ore are always due', () => {
  const { g, east, crew } = highway();
  stock(g, 0, { food: 1 });
  assert.match(refused(g, drive(crew, east)), /Roads cost 1 Food and 1 Ore per group/);
  stock(g, 0, {});
  assert.match(refused(g, drive(crew, east)), /Roads cost 1 Food and 1 Ore per group/);
});

// ------------------------------------------------------------------ shipcraft
/** Vikings with Shipcraft on a bay: `o` is Sea, the six spaces around it are Land, and the purse is empty. */
function fjord() {
  const g = world('vikings', { opponents: 2 });
  const { o, at } = bay(g);
  power(g, 0, 'shipcraft');
  setTerrain(g, o, 'sea');
  stock(g, 0, {});
  return { g, o, at };
}
/** A Move into the next space that converts: `more` adds `convert: [ids]`, `into`, `carry` and the like. */
const convert = (units, to, more = {}) => ({ type: 'move', units, to, convert: true, ...more });
const supply = (g, ...types) => types.map((type) => unitsLeft(g.s, 0, type));

test('Shipcraft: Settlers and Infantry that step onto the Sea become Ships, in one Move action', () => {
  const { g, o, at } = fjord();
  give(g, 0, { advances: ['tactics'] });
  const crew = [...troops(g, 0, 'settler', at(W), 2), ...troops(g, 0, 'infantry', at(W))].map((u) => u.id);
  const before = supply(g, 'settler', 'infantry', 'ship');
  g.drainEvents();
  act(g, convert(crew, o));
  assert.deepEqual(crew.map((id) => [unit(g, id).type, hexOf(g, id)]), crew.map(() => ['ship', o]));
  assert.deepEqual(supply(g, 'settler', 'infantry', 'ship'), [before[0] + 2, before[1] + 1, before[2] - 3]);
  assert.equal(g.s.turn.actionsLeft, 2);
  const events = g.drainEvents();
  assert.deepEqual(events.filter((e) => e.type === 'move' || e.type === 'convert').map((e) => [e.type, e.units]), [['move', crew], ['convert', crew]]);
  assert.ok(logged(g, /settler becomes a Ship \(Shipcraft\)/));
  assert.ok(logged(g, /infantry becomes a Ship \(Shipcraft\)/));

  setTerrain(g, at(E), 'sea');
  act(g, { type: 'move', units: [crew[0]], to: at(E) });
  assert.equal(hexOf(g, crew[0]), at(E));
  assert.equal(g.s.turn.actionsLeft, 1, 'converted units are the same units: Moving them again is a new Move action');
  assert.deepEqual(checkInvariants(g), []);
});

test('Shipcraft: part of a group becomes Ships and the rest board them, as far as the Ships hold them', () => {
  const { g, o, at } = fjord();
  give(g, 0, { advances: ['tactics'] });
  const settlers = troops(g, 0, 'settler', at(W), 2).map((u) => u.id);
  const guards = troops(g, 0, 'infantry', at(W), 2).map((u) => u.id);
  const crew = [...settlers, ...guards];
  assert.match(refused(g, convert(crew, o, { convert: [settlers[0]] })), /There is not enough room on the Ships/, 'one new Ship holds 2 of the 3 others');
  const [anchored] = troops(g, 0, 'ship', o).map((u) => u.id);
  act(g, convert(crew, o, { convert: [settlers[0]] }));
  assert.deepEqual(crew.map((id) => [unit(g, id).type, hexOf(g, id)]), [['ship', o], ['settler', o], ['infantry', o], ['infantry', o]], 'the others sail as passengers');
  assert.deepEqual(shipsAt(g.s, o, 0).map((u) => u.id).sort(), [anchored, settlers[0]].sort());
  assert.deepEqual(ofType(g.drainEvents(), 'convert').map((e) => e.units), [[settlers[0]]]);
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.deepEqual(checkInvariants(g), []);
});

test('Shipcraft: a Ship that steps onto the Land becomes a Settler, and its passengers land with it', () => {
  const { g, o, at } = fjord();
  const [ship] = troops(g, 0, 'ship', o).map((u) => u.id);
  const [rider] = troops(g, 0, 'settler', o).map((u) => u.id);
  const before = supply(g, 'settler', 'ship');
  g.drainEvents();
  act(g, convert([ship], at(E)));
  assert.deepEqual([ship, rider].map((id) => [unit(g, id).type, hexOf(g, id)]), [['settler', at(E)], ['settler', at(E)]]);
  assert.deepEqual(supply(g, 'settler', 'ship'), [before[0] - 1, before[1] + 1]);
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.deepEqual(ofType(g.drainEvents(), 'convert').map((e) => [e.units, e.to]), [[[ship], at(E)]]);
  assert.ok(logged(g, /ship becomes a Settler \(Shipcraft\)/));
  act(g, { type: 'move', units: [ship], to: at(E, E) });
  assert.equal(g.s.turn.actionsLeft, 1, 'the new Settler needs a Move action of its own');
  assert.deepEqual(checkInvariants(g), []);
});

test('Shipcraft: a Ship becomes an Infantry only with Tactics, and within the stack limit of the Army', () => {
  const { g, o, at } = fjord();
  const [ship] = troops(g, 0, 'ship', o).map((u) => u.id);
  const landing = convert([ship], at(E), { into: 'infantry' });
  assert.match(refused(g, landing), /You need Tactics to make Infantry/);
  give(g, 0, { advances: ['tactics'] });
  const wall = troops(g, 0, 'infantry', at(E), 4).map((u) => u.id);
  assert.match(refused(g, landing), /A space holds at most 4 Army units/);
  g.s.units = g.s.units.filter((u) => u.id !== wall[0]);
  act(g, landing);
  assert.equal(unit(g, ship).type, 'infantry');
  assert.equal(armyAt(g.s, at(E), 0).length, 4);
  assert.deepEqual(checkInvariants(g), []);
});

test('Shipcraft: the passengers who stay need other Ships to hold them, and the Army that lands keeps to the stack limit', () => {
  const { g, o, at } = fjord();
  give(g, 0, { advances: ['tactics'] });
  const [a, b] = troops(g, 0, 'ship', o, 2).map((u) => u.id);
  const [g1, g2] = troops(g, 0, 'infantry', o, 3).map((u) => u.id);
  const landing = at(E);
  troops(g, 0, 'infantry', landing, 3);
  assert.match(refused(g, convert([a], landing)), /at most 4 Army units/, 'all three passengers would land');
  assert.match(refused(g, convert([a], landing, { carry: [] })), /Ships left behind cannot hold the remaining units/, 'the other Ship holds two of the three');
  assert.match(refused(g, convert([a], landing, { carry: [g1, 'nobody'] })), /Those units are not on board/);
  assert.match(refused(g, convert([a], landing, { carry: [g1, g2] })), /at most 4 Army units/);
  act(g, convert([a], landing, { carry: [g1] }));
  assert.deepEqual(typesAt(g, landing), ['infantry', 'infantry', 'infantry', 'infantry', 'settler']);
  assert.deepEqual(typesAt(g, o), ['infantry', 'infantry', 'ship']);
  assert.equal(unit(g, b).type, 'ship');
  assert.deepEqual(checkInvariants(g), []);
});

test('Shipcraft: Navigation costs the Vikings no Food, and no other Advance does', () => {
  const g = world('vikings', { opponents: 2 });
  power(g, 0, 'shipcraft');
  stock(g, 0, {});
  assert.deepEqual(advanceCost(g.s, 0, 'navigation'), { cost: {}, via: 'shipcraft' });
  assert.deepEqual(advanceCost(g.s, 0, 'warships'), { cost: { food: 2 }, via: null });
  assert.ok(listed(g, 'advance').some((c) => c.id === 'navigation'), 'it is offered to a player with an empty purse');
  assert.ok(!listed(g, 'advance').some((c) => c.id === 'warships'));
  act(g, { type: 'advance', advance: 'navigation' });
  assert.ok(hasAdv(g.s, 0, 'navigation'));
  assert.deepEqual(['food', 'gold', 'ideas'].map((r) => me(g).res[r]), [0, 0, 0]);
  assert.equal(g.s.turn.actionsLeft, 2, 'it is an Action, though');
  stock(g, 0, { food: 1 });
  assert.match(refused(g, { type: 'advance', advance: 'warships' }), /An Advance costs 2 Food/);
  stock(g, 0, { food: 2 });
  act(g, { type: 'advance', advance: 'warships' });
  assert.equal(me(g).res.food, 0);

  const rome = world('rome', { opponents: 2 });
  give(rome, 0, { advances: ['fishing'] });
  stock(rome, 0, {});
  assert.deepEqual(advanceCost(rome.s, 0, 'navigation'), { cost: { food: 2 }, via: null });
  assert.ok(!listed(rome, 'advance').some((c) => c.id === 'navigation'));
  assert.match(refused(rome, { type: 'advance', advance: 'navigation' }), /An Advance costs 2 Food/);
});

test('Shipcraft refuses conversions the rules do not allow, and nothing changes', () => {
  const land = (t) => troops(t.g, 0, 'settler', t.at(W)).map((u) => u.id);
  const afloat = (t) => troops(t.g, 0, 'ship', t.o).map((u) => u.id);
  const cases = [
    ['Roads', /cannot be combined with Roads/, (t) => convert(land(t), t.o, { roads: true })],
    ['two spaces away', /convert as they move to an adjacent space/, (t) => convert(troops(t.g, 0, 'settler', t.at(W, W)).map((u) => u.id), t.o)],
    ['Land to Land', /Ships into land units on Land, and land units into Ships on the Sea/, (t) => convert(land(t), t.at(NW))],
    ['Sea to Sea', /Ships into land units on Land, and land units into Ships on the Sea/, (t) => {
      setTerrain(t.g, t.at(E), 'sea');
      return convert(afloat(t), t.at(E));
    }],
    ['an enemy Ship in the Sea', /must be clear of enemies/, (t) => {
      troops(t.g, 1, 'ship', t.o);
      return convert(land(t), t.o);
    }],
    ['a Pirate Ship in the Sea', /must be clear of enemies/, (t) => {
      pirates(t.g, t.o);
      return convert(land(t), t.o);
    }],
    ['an enemy city on the Land', /must be clear of enemies/, (t) => {
      town(t.g, 1, t.at(E));
      return convert(afloat(t), t.at(E));
    }],
    ['Barbarians on the Land', /must be clear of enemies/, (t) => {
      barbarians(t.g, 'infantry', t.at(E));
      return convert(afloat(t), t.at(E));
    }],
    ['four Ships already in play', /You have no Ships left/, (t) => {
      setTerrain(t.g, t.at(E, E), 'sea');
      troops(t.g, 0, 'ship', t.at(E, E), 4);
      return convert(land(t), t.o);
    }],
    ['four Settlers already in play', /You have no Settlers left/, (t) => {
      troops(t.g, 0, 'settler', t.at(NE, NE), 3);
      return convert(afloat(t), t.at(E));
    }],
    ['Cavalry', /Choose the units that become Ships/, (t) => convert(troops(t.g, 0, 'cavalry', t.at(W)).map((u) => u.id), t.o)],
    ['Cavalry among those chosen', /Only Settlers and Infantry become Ships/, (t) => {
      const horse = troops(t.g, 0, 'cavalry', t.at(W))[0].id;
      return convert([horse, ...land(t)], t.o, { convert: [horse] });
    }],
    ['passengers alone at sea', /Only Ships convert at sea/, (t) => {
      afloat(t);
      return convert(troops(t.g, 0, 'settler', t.o).map((u) => u.id), t.at(E));
    }],
    ['a Ship in a group with its passengers', /Ships move separately from land units/, (t) => convert([...afloat(t), ...troops(t.g, 0, 'settler', t.o).map((u) => u.id)], t.at(E))],
  ];
  for (const [why, pattern, setup] of cases) {
    const t = fjord();
    give(t.g, 0, { advances: ['tactics'] });
    assert.match(refused(t.g, setup(t)), pattern, why);
  }
  const g = world('vikings', { opponents: 2 });
  const { o, at } = bay(g);
  setTerrain(g, o, 'sea');
  assert.match(refused(g, convert(troops(g, 0, 'settler', at(W)).map((u) => u.id), o)), /You need Shipcraft to convert units/, 'without the power');
});

test('Shipcraft shows among the Moves of a group, for the people who have it', () => {
  const { g, o, at } = fjord();
  const [settler] = troops(g, 0, 'settler', at(W)).map((u) => u.id);
  const [ship] = troops(g, 0, 'ship', o).map((u) => u.id);
  const conversions = (ids, p = 0, game = g) => moveOptions(game, p, ids).filter((m) => m.convert).map((m) => [m.to, m.convert.into]);
  assert.deepEqual(conversions([settler]), [[o, null]]);
  assert.deepEqual(conversions([ship]).map(([, into]) => into), Array(6).fill('settler'), 'a Settler on each of the six spaces of Land');
  give(g, 0, { advances: ['tactics'] });
  assert.equal(conversions([ship]).filter(([, into]) => into === 'infantry').length, 6, 'and an Infantry, with Tactics');
  const moves = listed(g, 'move').filter((c) => c.action.convert);
  assert.ok(moves.some((c) => c.action.units[0] === settler && c.action.to === o && !c.action.into));
  assert.ok(moves.some((c) => c.action.units[0] === ship && c.action.to === at(E) && c.action.into === 'infantry'));

  const rome = world('rome', { opponents: 2 });
  const { o: sea, at: next } = bay(rome);
  setTerrain(rome, sea, 'sea');
  const walker = troops(rome, 0, 'settler', next(W))[0].id;
  assert.deepEqual(conversions([walker], 0, rome), []);
  assert.deepEqual(listed(rome, 'move').filter((c) => c.action.convert), []);
});

// ------------------------------------------------------------- pirate allies
const HIT = [6, 'infantry']; // a die worth 6: one hit all by itself
const MISS = [1, 'leader']; // a die worth 1
/** Three Sea spaces in a row, west to east: a Pirate Ship in the middle one and a Ship of seat 0 (Carthage, or Rome) in the west one. */
function channel(civ = 'carthage') {
  const g = world(civ, { opponents: 2 });
  const { o: mid, at } = bay(g);
  if (civ === 'carthage') power(g, 0, 'pirate_allies');
  const [west, east] = [at(W), at(E)];
  for (const k of [west, mid, east]) setTerrain(g, k, 'sea');
  const [pirate] = pirates(g, mid).map((u) => u.id);
  const [ship] = troops(g, 0, 'ship', west).map((u) => u.id);
  stock(g, 0, {});
  return { g, mid, west, east, pirate, ship, at };
}
const reach = (t) => [...seaReach(t.g.s, 0, t.west)];

test('Pirate Allies: the Ships of Carthage sail past a Pirate Ship, which stops the Ships of every other people', () => {
  const t = channel();
  const { g, mid, west, east, ship } = t;
  assert.deepEqual(reach(t), [[west, null], [mid, null], [east, null]]);
  assert.deepEqual(
    moveOptions(g, 0, [ship]).filter((m) => m.to === mid).map((m) => [m.attack, m.battle]),
    [[false, null], [true, { defender: PIRATE }]],
    'a Move into the Pirate space shares it, or attacks it',
  );
  assert.deepEqual(listed(g, 'move').filter((c) => c.action.to === mid).map((c) => !!c.action.attack), [false, true]);
  g.drainEvents();
  act(g, { type: 'move', units: [ship], to: east });
  assert.equal(hexOf(g, ship), east);
  assert.deepEqual(ofType(g.drainEvents(), 'battle_start'), []);
  assert.equal(shipsAt(g.s, mid, PIRATE).length, 1, 'the Pirate Ship is left where it was');

  const rome = channel('rome');
  assert.deepEqual(reach(rome), [[rome.west, null], [rome.mid, PIRATE]], 'the Sea space behind the Pirates cannot be reached');
  assert.match(refused(rome.g, { type: 'move', units: [rome.ship], to: rome.east }), /cannot reach/);
  assert.deepEqual(moveOptions(rome.g, 0, [rome.ship]).map((m) => [m.to, m.attack, m.battle.defender]), [[rome.mid, false, PIRATE]]);
});

test('Pirate Allies: a Ship that moves into a Pirate space shares it, and nobody fights', () => {
  const { g, mid, ship, pirate } = channel();
  g.drainEvents();
  act(g, { type: 'move', units: [ship], to: mid });
  assert.deepEqual(ofType(g.drainEvents(), 'battle_start'), []);
  assert.deepEqual([ship, pirate].map((id) => hexOf(g, id)), [mid, mid]);
  assert.equal(me(g).res.gold, 0, 'and no bounty is paid');
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.deepEqual(checkInvariants(g), []);
});

test('Pirate Allies: Carthage may attack the Pirate Ship instead, and earns the bounty', () => {
  const { g, mid, ship, pirate } = channel();
  const asked = asking(g, { pirate_bounty: 'mood' });
  hold(g, 0);
  rigDice(g, HIT, MISS);
  g.drainEvents();
  act(g, { type: 'move', units: [ship], to: mid, attack: true });
  assert.deepEqual(ofType(g.drainEvents(), 'battle_start').map((e) => [e.attacker, e.defender, e.hex]), [[0, PIRATE, mid]]);
  assert.deepEqual(asked.map((q) => q.kind), ['pirate_bounty']);
  assert.deepEqual([me(g).res.gold, me(g).mood], [1, 1]);
  assert.equal(unit(g, pirate), undefined);
  assert.deepEqual(typesAt(g, mid), ['ship']);
  assert.equal(unitsLeft(g.s, PIRATE, 'ship'), 4);
  assert.deepEqual(checkInvariants(g), []);
});

test('Pirate Allies: Land units board a Pirate Ship, two to a Ship, and Rome has no Ship there', () => {
  const { g, mid, at, pirate } = channel();
  const [a, b, c] = troops(g, 0, 'settler', at(NE), 3).map((u) => u.id);
  assert.match(refused(g, { type: 'move', units: [a, b, c], to: mid }), /not enough room on the Ships/);
  act(g, { type: 'move', units: [a, b], to: mid });
  assert.deepEqual([a, b, pirate].map((id) => hexOf(g, id)), [mid, mid, mid]);
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.match(refused(g, { type: 'move', units: [c], to: mid }), /not enough room on the Ships/, 'the Pirate Ship holds two units');
  assert.deepEqual(checkInvariants(g), []);

  const rome = channel('rome');
  const walker = troops(rome.g, 0, 'settler', rome.at(NE))[0].id;
  assert.match(refused(rome.g, { type: 'move', units: [walker], to: rome.mid }), /You have no Ship there/);
});

test('Pirate Allies: a Pirate Ship counts as one of your Ships while a unit of yours shares its space, and not otherwise', () => {
  const { g, mid, west, ship, pirate } = channel();
  const state = () => [
    pirateMaster(g.s, mid), controlledPirates(g.s, 0, mid).map((u) => u.id), freePirates(g.s).map((u) => u.id),
    pirateBlocked(g.s, mid), pirateBlocked(g.s, west),
  ];
  assert.deepEqual(state(), [null, [], [pirate], true, true]);
  act(g, { type: 'move', units: [ship], to: mid });
  assert.deepEqual(state(), [0, [pirate], [], false, false]);
  assert.deepEqual(navyAt(g.s, mid, 0).map((u) => u.id), [pirate, ship], 'the Pirate Ship is lost before the real one');
  act(g, { type: 'move', units: [ship], to: west });
  assert.deepEqual(state(), [null, [], [pirate], true, true], 'it is free again once the Ship sails away');

  const rival = channel();
  troops(rival.g, 1, 'ship', rival.mid);
  assert.equal(pirateMaster(rival.g.s, rival.mid), null, 'a Ship of another people shares nothing');
});

test('Pirate Allies: a shared Pirate Ship does not raid the coast, and its Sea can be Collected from', () => {
  const { g, mid, east, at, ship } = channel();
  give(g, 0, { advances: ['fishing'] });
  const city = town(g, 0, at(NE));
  stock(g, 0, { food: 2 });
  const spaces = () => collectCandidates(g.s, 0, city).map((c) => c.hex);
  assert.deepEqual(raidedCities(g.s, 0).map((c) => c.id), [city.id]);
  assert.ok(![mid, east].some((k) => spaces().includes(k)), 'a free Pirate Ship shuts its space and the Sea next to it');
  run(g, pirateRaid(g, 0));
  assert.equal(me(g).res.food, 1);
  assert.ok(logged(g, /loses 1 Food to the Pirates/));

  act(g, { type: 'move', units: [ship], to: mid });
  assert.deepEqual(raidedCities(g.s, 0), []);
  run(g, pirateRaid(g, 0));
  assert.equal(me(g).res.food, 1, 'the raid finds nothing to plunder');
  assert.ok([mid, east].every((k) => spaces().includes(k)), 'both Sea spaces can be Collected from');
  stock(g, 0, {});
  act(g, { type: 'collect', city: city.id, picks: [{ hex: mid, res: 'food' }] });
  assert.equal(me(g).res.food, 1, 'the Food of the Sea space that Carthage shares with the Pirate Ship');
  assert.deepEqual(checkInvariants(g), []);
});

test('Pirate Allies: Trade Routes may start from the Sea space that a Ship shares with a Pirate Ship, with either Ship', () => {
  const { g, mid, west, at, ship, pirate } = channel();
  give(g, 0, { advances: ['trade_routes'] });
  const cities = [town(g, 1, at(SE)).id, town(g, 2, at(SW)).id];
  const routes = () => tradeRoutes(g.s, 0);
  assert.deepEqual(routes(), [], `a free Pirate Ship shuts the Ship at ${west} out`);
  act(g, { type: 'move', units: [ship], to: mid });
  assert.deepEqual(routes().map((r) => r.city).sort(), cities.sort());
  assert.deepEqual(routes().map((r) => r.unit).sort(), [pirate, ship].sort(), 'each city has a Ship of its own to trade with');
  assert.ok(routes().every((r) => r.ship));
});

test('Pirate Allies: a rival who attacks the shared space fights Carthage, and wins nothing for sinking the Pirate Ship', () => {
  const { g, mid, east, ship, pirate } = channel();
  const rival = troops(g, 1, 'ship', east)[0].id;
  assert.deepEqual(shipRoutes(g.s, 1, east, false).map((r) => [r.dest, r.battle]), [[mid, PIRATE]]);
  act(g, { type: 'move', units: [ship], to: mid });
  assert.deepEqual(shipRoutes(g.s, 1, east, false).map((r) => [r.dest, r.battle]), [[mid, 0]], 'the shared Pirate Ship is no longer the Pirates\'');
  act(g, { type: 'end_turn' });
  assert.equal(g.cur, 1);
  hold(g, 0);
  hold(g, 1);
  const asked = asking(g, { retreat: 'yes' });
  rigDice(g, HIT, MISS, MISS);
  g.drainEvents();
  act(g, { type: 'move', units: [rival], to: mid });
  const events = g.drainEvents();
  assert.deepEqual(ofType(events, 'battle_start').map((e) => [e.attacker, e.defender, e.hex, e.def]), [[1, 0, mid, [pirate, ship]]]);
  assert.equal(ofType(events, 'battle_round')[0].d.lost, 1);
  assert.equal(unit(g, pirate), undefined, 'the Pirate Ship goes down first');
  assert.equal(hexOf(g, ship), mid);
  assert.equal(hexOf(g, rival), east, 'the rival retreats');
  assert.deepEqual(asked.map((q) => q.kind), ['retreat'], 'no bounty is asked of the rival');
  assert.equal(me(g, 1).res.gold, 0);
  assert.equal(unitsLeft(g.s, PIRATE, 'ship'), 4);
  assert.deepEqual(checkInvariants(g), []);
});

test('Pirate Allies: a Ship recruited into a Pirate port shares the space, unless Carthage chooses to attack', () => {
  const recruit = (attack) => {
    const g = world('carthage', { opponents: 2 });
    const { o } = bay(g);
    power(g, 0, 'pirate_allies');
    const city = town(g, 0, o);
    const sea = harbour(g, city);
    const [pirate] = pirates(g, sea).map((u) => u.id);
    stock(g, 0, { wood: 2 });
    hold(g, 0);
    const asked = asking(g, { pirate_bounty: 'mood' });
    if (attack) rigDice(g, HIT, MISS);
    g.drainEvents();
    act(g, { type: 'recruit', city: city.id, units: { ship: 1 }, ...(attack ? { attack: true } : {}) });
    return { g, sea, pirate, asked, events: g.drainEvents() };
  };
  const shared = recruit(false);
  assert.deepEqual(ofType(shared.events, 'battle_start'), []);
  assert.deepEqual(typesAt(shared.g, shared.sea, PIRATE).concat(typesAt(shared.g, shared.sea)), ['ship', 'ship']);
  assert.deepEqual([me(shared.g).res.wood, me(shared.g).res.gold], [0, 0]);
  assert.deepEqual(checkInvariants(shared.g), []);

  const fought = recruit(true);
  assert.equal(ofType(fought.events, 'battle_start').length, 1);
  assert.deepEqual(fought.asked.map((q) => q.kind), ['pirate_bounty'], 'there is no question about retreating');
  assert.equal(unit(fought.g, fought.pirate), undefined);
  assert.deepEqual(typesAt(fought.g, fought.sea), ['ship']);
  assert.deepEqual([me(fought.g).res.gold, me(fought.g).mood], [1, 1]);
  assert.deepEqual(checkInvariants(fought.g), []);
});

test('Pirate Allies: Events cannot place or recall the Pirate Ships that Carthage controls', () => {
  const g = world('carthage', { opponents: 2 });
  const { o, at } = bay(g);
  power(g, 0, 'pirate_allies');
  const lanes = [at(E), at(NE), at(NW), at(W)];
  for (const k of [o, at(SW), ...lanes]) setTerrain(g, k, 'sea');
  for (const k of lanes) {
    pirates(g, k);
    troops(g, 0, 'ship', k);
  }
  const where = () => g.s.units.filter((u) => u.owner === PIRATE).map((u) => u.hex).sort();
  const asked = asking(g, {});
  const held = where();
  assert.equal(unitsLeft(g.s, PIRATE, 'ship'), 0);
  run(g, placePirates(g, 0, 2, { near: true }));
  assert.deepEqual(where(), held, 'all four are Carthage\'s: the Event does nothing');
  assert.deepEqual(asked, []);

  g.s.units = g.s.units.filter((u) => !(u.owner === 0 && u.hex === lanes[3]));
  assert.equal(freePirates(g.s).length, 1);
  run(g, placePirates(g, 0, 2, { near: true }));
  assert.equal(where().length, 4, 'a Pirate Ship that nobody controls is taken off the map and placed again');
  assert.ok(lanes.slice(0, 3).every((k) => where().includes(k)), 'the three that Carthage controls stay');
  assert.deepEqual(checkInvariants(g), []);
});

// ------------------------------------------------------------- hunnic tribes
/** The answer to the question of the space a steered army enters: the neighbour farthest from `home`. `picks` records the answers. */
const farthest = (home, picks = []) => (q) => {
  if (q.title !== 'Hunnic Tribes') return undefined;
  const [pick] = q.options.map((x) => x.id).sort((a, b) => hexDistance(home, b) - hexDistance(home, a));
  picks.push(pick);
  return pick;
};
const tokens = (g) => [me(g).res.gold, me(g).culture];
/**
 * The Huns (their Government is Autocracy), or another people, with a city at `o`, 1 Gold and 1 Culture, and a Barbarian Infantry two
 * spaces east of it. The Event on top of the pile makes the Barbarians move and does nothing else: nothing of the player is Angry.
 */
function horde(civ = 'huns', government = true) {
  const g = world(civ, { opponents: 2 });
  if (government) autocracy(g);
  const { o, at } = bay(g);
  town(g, 0, o);
  const army = barbarians(g, 'infantry', at(E, E))[0].id;
  stack(g, 'civil_war');
  stock(g, 0, { gold: 1, culture: 1 });
  return { g, o, at, army };
}

test('Hunnic Tribes: 1 Gold or 1 Culture lets the Huns choose the space a Barbarian army enters, instead of its march on the city', () => {
  for (const [token, kept] of [['gold', [0, 1]], ['culture', [1, 0]]]) {
    const t = horde();
    const picks = [];
    const asked = asking(t.g, { hunnic_tribes: token, pick_hex: farthest(t.o, picks) });
    run(t.g, resolveEvent(t.g, 0));
    assert.deepEqual(asked.map((q) => q.kind), ['event', 'hunnic_tribes', 'pick_hex']);
    const hex = hexOf(t.g, t.army);
    assert.deepEqual(picks, [hex]);
    assert.equal(hexDistance(hex, t.at(E, E)), 1, 'it takes a single step');
    assert.equal(hexDistance(t.o, hex), 3, 'away from the city of the Huns');
    assert.deepEqual(tokens(t.g), kept, `1 ${token} is paid`);
    assert.ok(logged(t.g, new RegExp(`pays 1 ${token} to steer the Barbarians \\(Hunnic Tribes\\)`)));
    assert.deepEqual(checkInvariants(t.g), []);
  }
  const march = horde();
  const asked = asking(march.g, { hunnic_tribes: 'no', pick_hex: farthest(march.o) });
  run(march.g, resolveEvent(march.g, 0));
  assert.deepEqual(asked.map((q) => q.kind), ['event', 'hunnic_tribes'], 'let them march: no direction is asked');
  assert.equal(hexOf(march.g, march.army), march.at(E), 'the army steps towards the city');
  assert.deepEqual(tokens(march.g), [1, 1]);
});

test('Hunnic Tribes: the offer lists the tokens the Huns can pay, and is accepted by default only when an army stands in contact', () => {
  const offer = (setup) => {
    const t = horde();
    setup(t);
    const asked = asking(t.g, {});
    run(t.g, resolveEvent(t.g, 0));
    const q = asked.find((x) => x.kind === 'hunnic_tribes');
    return [optionIds(q), q.default];
  };
  assert.deepEqual(offer(() => {}), [['gold', 'culture', 'no'], 'no']);
  assert.deepEqual(offer((t) => { unit(t.g, t.army).hex = t.at(E); }), [['gold', 'culture', 'no'], 'gold'], 'next to a city of the Huns');
  assert.deepEqual(offer((t) => { unit(t.g, t.army).hex = t.at(E); stock(t.g, 0, { culture: 1 }); }), [['culture', 'no'], 'culture']);
  assert.deepEqual(offer((t) => stock(t.g, 0, { gold: 1 })), [['gold', 'no'], 'no']);
});

test('Hunnic Tribes: every army of the Event is steered for a single token', () => {
  const t = horde();
  const second = barbarians(t.g, 'infantry', t.at(NE, NE))[0].id;
  const picks = [];
  const asked = asking(t.g, { hunnic_tribes: 'gold', pick_hex: farthest(t.o, picks) });
  run(t.g, resolveEvent(t.g, 0));
  assert.equal(asked.filter((q) => q.kind === 'hunnic_tribes').length, 1);
  assert.deepEqual(tokens(t.g), [0, 1], 'one token pays for both');
  const steered = asked.filter((q) => q.kind === 'pick_hex' && q.title === 'Hunnic Tribes');
  assert.equal(steered.length, 2, 'the Huns choose the space of each army');
  assert.ok(steered[0].text.includes(t.at(E, E)) && steered[1].text.includes(t.at(NE, NE)));
  assert.deepEqual([hexOf(t.g, t.army), hexOf(t.g, second)], picks);
  assert.deepEqual([hexDistance(picks[0], t.at(E, E)), hexDistance(picks[1], t.at(NE, NE))], [1, 1]);
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Hunnic Tribes: nobody else is offered it, nor the Huns without their Government, a token to pay, or an army in reach', () => {
  const cases = [
    ['the Huns before their Government', () => horde('huns', false), true],
    ['Rome, with the same tokens', () => horde('rome'), true],
    ['the Huns with no Gold or Culture', () => {
      const t = horde();
      stock(t.g, 0, {});
      return t;
    }, true],
    ['the Huns with no army within 2 spaces of their cities', () => {
      const t = horde();
      unit(t.g, t.army).hex = t.at(E, E, E);
      return t;
    }, false],
  ];
  for (const [why, setup, marches] of cases) {
    const t = setup();
    const asked = asking(t.g, {});
    const before = tokens(t.g);
    run(t.g, resolveEvent(t.g, 0));
    assert.ok(!asked.some((q) => q.kind === 'hunnic_tribes' || q.title === 'Hunnic Tribes'), `${why}: nothing is asked`);
    assert.deepEqual(tokens(t.g), before, why);
    if (marches) assert.equal(hexOf(t.g, t.army), t.at(E), `${why}: the army marches on the city`);
  }
});

test('Hunnic Tribes: the Huns steer the march of a Barbarian Incursion as well', () => {
  const steered = horde();
  const picks = [];
  const asked = asking(steered.g, { hunnic_tribes: 'culture', pick_hex: farthest(steered.o, picks) });
  run(steered.g, barbarianIncursion(steered.g, 0));
  assert.deepEqual(asked.map((q) => q.kind), ['hunnic_tribes', 'pick_hex']);
  assert.deepEqual(picks, [hexOf(steered.g, steered.army)]);
  assert.equal(hexDistance(steered.o, picks[0]), 3);
  assert.deepEqual(tokens(steered.g), [1, 0]);

  const marching = horde();
  const answered = asking(marching.g, { hunnic_tribes: 'no' });
  run(marching.g, barbarianIncursion(marching.g, 0));
  assert.deepEqual(answered.map((q) => q.kind), ['hunnic_tribes']);
  assert.equal(hexOf(marching.g, marching.army), marching.at(E));
  assert.deepEqual(tokens(marching.g), [1, 1]);
});

test('Hunnic Tribes: the Huns steer both steps of the horsemen of the Scourge of the Steppes', () => {
  const scourge = (answer, picks) => {
    const t = horde();
    t.g.s.units = t.g.s.units.filter((u) => u.id !== t.army);
    const asked = asking(t.g, { hunnic_tribes: answer, pick_hex: farthest(t.o, picks) });
    const spawn = ofType(run(t.g, steppeScourge(t.g, 0)), 'barbarians').find((e) => e.kind === 'spawn').hex;
    return { ...t, asked, spawn };
  };
  const picks = [];
  const steered = scourge('gold', picks);
  assert.deepEqual(steered.asked.map((q) => q.kind), ['hunnic_tribes', 'pick_hex', 'pick_hex']);
  assert.equal(picks.length, 2);
  assert.deepEqual([hexDistance(steered.spawn, picks[0]), hexDistance(picks[0], picks[1])], [1, 1]);
  assert.equal(armyAt(steered.g.s, picks[1], BARBARIAN).length, 2, 'both horsemen stand where the Huns sent them');
  assert.deepEqual(tokens(steered.g), [0, 1]);

  // All the cities are size 1: the largest is the first of the drawer's, their capital.
  const marched = scourge('no', []);
  const home = capitalOf(marched.g).hex;
  const [end] = marched.g.s.units.filter((u) => u.owner === BARBARIAN).map((u) => u.hex);
  assert.deepEqual(marched.asked.map((q) => q.kind), ['hunnic_tribes']);
  assert.equal(hexDistance(home, end), hexDistance(home, marched.spawn) - 2, 'two steps towards the largest city');
  assert.deepEqual(tokens(marched.g), [1, 1]);
});

test('Hunnic Tribes does not steer the attack of Feuding Warlords: the Huns are asked nothing', () => {
  const t = horde();
  give(t.g, 0, { advances: ['tactics'] });
  const guard = troops(t.g, 0, 'infantry', t.at(E))[0].id;
  const asked = asking(t.g, {});
  hold(t.g, 0);
  rigDice(t.g, HIT, MISS);
  const events = run(t.g, barbarianFeud(t.g));
  assert.deepEqual(ofType(events, 'barbarians').map((e) => [e.kind, e.from, e.hex]), [['move', t.at(E, E), t.at(E)]], 'the army next to the Huns attacks');
  assert.equal(unit(t.g, guard), undefined);
  assert.deepEqual(asked, []);
  assert.deepEqual(tokens(t.g), [1, 1]);
});

// ------------------------------------------------------------------- enumerate
const CIV_ACTIONS = ['hegemony', 'sprawl', 'fighting_bands', 'tribal_allies', 'human_sacrifice', 'calendar'];
/** The kinds of these six actions that `enumerateActions` offers player `p`, sorted. */
const civTypes = (g, p = 0) => [...new Set(enumerateActions(g, p).map((c) => c.action.type).filter((type) => CIV_ACTIONS.includes(type)))].sort();
/** The people that have a power that is an action of its own, and the actions they have. */
const OWN = { aztecs: ['human_sacrifice'], carthage: ['hegemony'], celts: ['tribal_allies'], china: ['fighting_bands', 'sprawl'], maya: ['calendar'] };
/**
 * Every condition of the six actions is met for player 0: a Ship on a Sea space with free land around it, Settlers and Infantry
 * together in the capital, a Captive, a Recruit that made a Settler, and room for the Barbarians.
 */
function plentiful(g) {
  const { o } = bay(g);
  setTerrain(g, o, 'sea');
  const ship = troops(g, 0, 'ship', o)[0].id;
  const soldier = troops(g, 0, 'infantry', capitalOf(g).hex)[0].id;
  me(g).captives = [{ owner: 1, type: 'infantry' }];
  g.s.turn.sprawl = true;
  return { o, ship, soldier };
}

test('enumerateActions lists Hegemony for each free coast beside a Ship, with the Army that has to stay aboard', () => {
  const sites = (t) => listed(t.g, 'hegemony').map((c) => c.to).sort();
  const t = gulf();
  assert.deepEqual(sites(t), nbrs(t.g.s, t.sea).sort());
  assert.ok(listed(t.g, 'hegemony').every((c) => c.unit === t.ship && c.action.type === 'hegemony' && c.action.unit === t.ship));
  for (const to of nbrs(t.g.s, t.sea)) {
    const w = gulf();
    act(w.g, listed(w.g, 'hegemony').find((c) => c.to === to).action);
    assert.equal(cityAt(w.g.s, to)?.owner, 0, `every listed Hegemony works: ${to}`);
  }
  troops(t.g, 1, 'infantry', t.at(E));
  town(t.g, 1, t.at(NE));
  setTerrain(t.g, t.at(NW), 'barren');
  t.g.s.map.hexes[t.at(W)].exhausted = true;
  setTerrain(t.g, t.at(SW), 'sea');
  assert.deepEqual(sites(t), [t.at(SE)], 'an enemy, a city, Barren land, an exhausted space and the Sea are left out');
  t.g.s.turn.actionsLeft = 0;
  assert.deepEqual(sites(t), [], 'it is an action');

  const crowded = gulf();
  const to = crowded.at(E);
  troops(crowded.g, 0, 'infantry', to, 3);
  const [first, last] = troops(crowded.g, 0, 'infantry', crowded.sea, 2).map((u) => u.id);
  assert.ok(!sites(crowded).includes(to), 'no other Ship holds the Army that would not fit');
  troops(crowded.g, 0, 'ship', crowded.sea);
  const entry = listed(crowded.g, 'hegemony').find((c) => c.to === to);
  assert.deepEqual(entry.action.stay, [last]);
  act(crowded.g, entry.action);
  assert.deepEqual([hexOf(crowded.g, first), hexOf(crowded.g, last)], [to, crowded.sea]);
  assert.equal(armyAt(crowded.g.s, to, 0).length, 4);
  assert.deepEqual(checkInvariants(crowded.g), []);
});

test('enumerateActions lists Hegemony only for the people that have it, and a Ship of their own', () => {
  const harbour = (civ) => {
    const g = world(civ, { opponents: 2 });
    const { o } = bay(g);
    setTerrain(g, o, 'sea');
    troops(g, 0, 'ship', o);
    return { g, o };
  };
  for (const civ of ['rome', 'carthage']) assert.deepEqual(listed(harbour(civ).g, 'hegemony'), [], `${civ} before Cartography`);
  const armed = harbour('carthage');
  power(armed.g, 0, 'hegemony');
  assert.equal(listed(armed.g, 'hegemony').length, 6);
  const alien = harbour('carthage');
  power(alien.g, 0, 'hegemony');
  for (const u of alien.g.s.units) if (u.type === 'ship') u.owner = 1;
  assert.deepEqual(listed(alien.g, 'hegemony'), [], 'a Ship of another player is not yours to use');
});

test('enumerateActions lists Sprawl after a Recruit that made a Settler, until it is used or another action is spent', () => {
  const sprawl = (g) => listed(g, 'sprawl').map((c) => c.action);
  const t = chinese(1);
  assert.deepEqual(sprawl(t.g), [], 'no Recruit yet');
  recruitSettler(t.g, t.city);
  assert.deepEqual(sprawl(t.g), [{ type: 'sprawl' }]);
  act(t.g, { type: 'sprawl' });
  assert.deepEqual(sprawl(t.g), [], 'once');

  const spent = chinese(2);
  recruitSettler(spent.g, spent.city);
  const [walker] = spent.g.s.units.filter((u) => u.owner === 0 && u.type === 'settler').map((u) => u.id);
  act(spent.g, { type: 'move', units: [walker], to: spent.at(E) });
  assert.deepEqual(sprawl(spent.g), [], 'another action spends it');

  const soldiers = chinese(1);
  stock(soldiers.g, 0, { food: 2, ore: 1 });
  act(soldiers.g, { type: 'recruit', city: soldiers.city, units: { infantry: 1 } });
  assert.deepEqual(sprawl(soldiers.g), [], 'Infantry are not Settlers');

  const rome = world('rome');
  stock(rome, 0, { food: 2 });
  recruitSettler(rome, capitalOf(rome).id);
  assert.deepEqual(sprawl(rome), [], 'Rome does not Sprawl');
});

test('enumerateActions lists the exchanges of Fighting Bands that fit the supply and the stack limit, once per turn', () => {
  const china = () => {
    const g = world('china');
    autocracy(g);
    return g;
  };
  const exchanges = (g) => Object.fromEntries(listed(g, 'bands').map((c) => [c.to, c.action.units]));
  const g = china();
  const home = capitalOf(g).hex;
  const settler = settlerOf(g).id;
  assert.deepEqual(exchanges(g), { infantry: [settler] });
  const [soldier] = troops(g, 0, 'infantry', home).map((u) => u.id);
  assert.deepEqual(exchanges(g), { infantry: [settler], settler: [soldier] });
  assert.ok(listed(g, 'bands').every((c) => c.hex === home && c.action.type === 'fighting_bands'));
  for (const to of ['infantry', 'settler']) {
    const w = china();
    troops(w, 0, 'infantry', home);
    const entry = listed(w, 'bands').find((c) => c.to === to);
    act(w, entry.action);
    assert.ok(entry.action.units.every((id) => unit(w, id).type === to), `every unit becomes ${to}`);
    assert.deepEqual(exchanges(w), {}, 'once per turn');
  }
  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  assert.deepEqual(Object.keys(exchanges(g)).sort(), ['infantry', 'settler'], 'and again the next turn');

  const three = china();
  troops(three, 0, 'infantry', home, 3);
  assert.deepEqual(Object.keys(exchanges(three)).sort(), ['infantry', 'settler'], 'the Settler fits the stack, and three Settlers are in the supply');
  troops(three, 0, 'infantry', home);
  assert.deepEqual(exchanges(three), {}, 'a fifth Army unit does not fit, and the supply has no 4 Settlers for the Infantry');

  const rome = world('rome');
  troops(rome, 0, 'infantry', capitalOf(rome).hex);
  assert.deepEqual(exchanges(rome), {}, 'Rome');
  const early = world('china');
  troops(early, 0, 'infantry', capitalOf(early).hex);
  assert.deepEqual(exchanges(early), {}, 'the Chinese before their Government');
});

test('enumerateActions lists Tribal Allies while the turn has not used it and Barbarians could appear', () => {
  const tribal = (g) => listed(g, 'tribal').map((c) => c.action);
  const g = world('celts');
  assert.deepEqual(tribal(g), [], 'before Draft');
  power(g, 0, 'tribal_allies');
  assert.deepEqual(tribal(g), [{ type: 'tribal_allies' }]);
  act(g, { type: 'tribal_allies' });
  assert.deepEqual(tribal(g), [], 'once per turn');
  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  assert.deepEqual(tribal(g), [{ type: 'tribal_allies' }], 'and again the next turn');

  const full = world('celts');
  power(full, 0, 'tribal_allies');
  const horde = spots(full, 5).flatMap((k) => barbarians(full, 'infantry', k, 4)).map((u) => u.id);
  assert.deepEqual(tribal(full), [], 'every Barbarian Infantry is on the board');
  full.s.units = full.s.units.filter((u) => u.id !== horde[0]);
  assert.deepEqual(tribal(full), [{ type: 'tribal_allies' }]);
  assert.deepEqual(tribal(world('rome')), []);
});

test('enumerateActions lists Human Sacrifice for each Resource, for all the Captives and for one of them', () => {
  const gains = (g) => listed(g, 'sacrifice').map((c) => `${c.gain}:${JSON.stringify(c.action.gain)}`).sort();
  assert.deepEqual(gains(sacrificer([1])), ['culture:{"culture":1}', 'food:{"food":1}', 'mood:{"mood":1}']);
  assert.deepEqual(gains(sacrificer([1, BARBARIAN, 2])), [
    'culture:{"culture":1}', 'culture:{"culture":3}', 'food:{"food":1}', 'food:{"food":3}', 'mood:{"mood":1}', 'mood:{"mood":3}',
  ]);
  const crowd = sacrificer([1, BARBARIAN, 2]);
  for (const c of listed(crowd, 'sacrifice')) {
    const w = sacrificer([1, BARBARIAN, 2]);
    const [kind] = Object.keys(c.action.gain);
    act(w, c.action);
    assert.equal(me(w).captives.length, 3 - c.action.gain[kind], `${kind}: ${JSON.stringify(c.action.gain)}`);
  }
  assert.deepEqual(gains(sacrificer([])), [], 'no Captive');
  assert.deepEqual(gains(sacrificer([1, 1], ['captives'])), [], 'Captives alone are only points');
  assert.equal(gains(sacrificer([1, 1])).length, 6);
  const none = sacrificer([1]);
  none.s.turn.actionsLeft = 0;
  assert.equal(listed(none, 'sacrifice').length, 3, 'it is free of an action');
});

test('enumerateActions lists the Calendar for the Maya who have it, even with no action left', () => {
  const g = calendar(0);
  g.s.turn.actionsLeft = 0;
  assert.deepEqual(listed(g, 'calendar').map((c) => c.action), [{ type: 'calendar' }]);
  assert.deepEqual(listed(world('maya'), 'calendar'), [], 'the Maya before their power');
  assert.deepEqual(listed(world('rome'), 'calendar'), []);
});

test('enumerateActions lists the moves of a size-1 city for the Huns who have Nomads', () => {
  const moves = (g) => listed(g, 'move').filter((c) => c.action.city);
  const t = steppe();
  const settler = settlerOf(t.g).id;
  const around = nbrs(t.g.s, t.from).filter((k) => free(t.g, k)).sort();
  const alone = moves(t.g).filter((c) => !c.action.units.length);
  const crewed = moves(t.g).filter((c) => c.action.units.length);
  assert.deepEqual(alone.map((c) => c.to).sort(), around, 'the city alone');
  assert.deepEqual(crewed.map((c) => c.to).sort(), around, 'with the Settler that stands in it');
  assert.ok(crewed.every((c) => c.action.units.length === 1 && c.action.units[0] === settler));
  assert.ok(moves(t.g).every((c) => c.action.city === t.city && c.from === t.from && c.action.type === 'move'));
  for (const c of [alone[0], crewed.at(-1)]) {
    const w = steppe();
    act(w.g, c.action);
    assert.equal(capitalOf(w.g).hex, c.to);
  }

  const grown = steppe();
  capitalOf(grown.g).buildings.market = 0;
  assert.deepEqual(moves(grown.g), [], 'a city of size 2 stays');
  const angry = steppe();
  capitalOf(angry.g).mood = 'angry';
  assert.deepEqual(moves(angry.g), [], 'an Angry city stays');
  for (const civ of ['huns', 'rome']) assert.deepEqual(moves(world(civ)), [], `${civ} without Nomads`);
});

test('enumerateActions lists the 4-space Roads of Imperial Roads between two cities, for 1 Food and 1 Ore', () => {
  const roads = (g) => listed(g, 'move').filter((c) => c.roads);
  const t = highway();
  const long = roads(t.g).filter((c) => c.to === t.east);
  assert.ok(long.length >= 1 && long.every((c) => c.action.roads === true && c.action.type === 'move' && c.from === t.west));
  const both = long.find((c) => c.action.units.length === 2);
  assert.deepEqual([...both.action.units].sort(), [...t.crew].sort(), 'the whole group');
  act(t.g, both.action);
  assert.deepEqual(t.crew.map((id) => hexOf(t.g, id)), [t.east, t.east]);
  assert.deepEqual([me(t.g).res.food, me(t.g).res.ore], [0, 0]);

  assert.deepEqual(roads(highway(false).g).filter((c) => c.to === t.east), [], 'the Roads of every people stop at 2 spaces');
  for (const poor of [{ food: 1 }, { ore: 1 }, {}]) {
    const w = highway();
    stock(w.g, 0, poor);
    assert.deepEqual(roads(w.g), [], `no Roads for ${JSON.stringify(poor)}`);
  }
});

test('enumerateActions lists a card played "as an Action" with no action left only for the Shogunate, and the Draft that draws one', () => {
  const cards = (g) => listed(g, 'card').map((c) => c.action);
  const caravan = { type: 'play_card', card: 'caravan' };
  const japan = shogun('caravan');
  japan.s.turn.actionsLeft = 0;
  assert.deepEqual(cards(japan), [caravan]);
  const rome = world('rome');
  hold(rome, 0, 'caravan');
  rome.s.turn.actionsLeft = 0;
  assert.deepEqual(cards(rome), [], 'Rome needs an action');
  rome.s.turn.actionsLeft = 1;
  assert.deepEqual(cards(rome), [caravan]);
  const early = world('japan');
  hold(early, 0, 'caravan');
  early.s.turn.actionsLeft = 0;
  assert.deepEqual(cards(early), [], 'the Japanese before their Government');

  const drafts = (g) => listed(g, 'recruit').map((c) => c.action).filter((a) => a.draftCard);
  const g = shogun();
  assert.deepEqual(drafts(g), [], 'no Mood to pay');
  give(g, 0, { mood: 2 });
  assert.ok(drafts(g).length >= 1);
  act(g, drafts(g)[0]);
  assert.equal(me(g).hand.action.length, 1);
  for (const civ of ['japan', 'rome']) {
    const w = world(civ);
    give(w, 0, { advances: ['draft'], mood: 3 });
    assert.deepEqual(drafts(w), [], `${civ} without the Shogunate`);
  }
});

test('enumerateActions lists a civ action only for the people that hold its power, and never in a game without the module', () => {
  for (const civ of CIV_ORDER) {
    const bare = world(civ, { opponents: 2 });
    plentiful(bare);
    assert.deepEqual(civTypes(bare), [], `${civ} with no power`);
    const armed = world(civ, { opponents: 2 });
    power(armed, 0, ...CIVS[civ].advances.map((a) => a.id));
    plentiful(armed);
    assert.deepEqual(civTypes(armed), OWN[civ] ?? [], `${civ} with its four powers`);
  }
  const plain = fresh('plain', { opponents: 2 });
  plentiful(plain);
  assert.deepEqual(civTypes(plain), [], 'a game without the module');
  assert.equal(plain.s.civs, false);
});

test('Rome, with the module on, holds none of the six actions: each is refused and none is listed', () => {
  const g = world('rome', { opponents: 2 });
  const { o, ship, soldier } = plentiful(g);
  const refusals = [
    [{ type: 'hegemony', unit: ship, to: nbrs(g.s, o)[0] }, /You do not have Hegemony/],
    [{ type: 'sprawl' }, /You do not have Sprawling/],
    [{ type: 'fighting_bands', units: [soldier] }, /You do not have Fighting Bands/],
    [{ type: 'tribal_allies' }, /You do not have Tribal Allies/],
    [{ type: 'human_sacrifice', gain: { food: 1 } }, /You do not have Human Sacrifice/],
    [{ type: 'calendar' }, /You do not have the Calendar/],
  ];
  for (const [action, why] of refusals) assert.match(refused(g, action), why);
  assert.deepEqual(civTypes(g), []);
});
