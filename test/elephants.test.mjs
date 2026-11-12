// Regressions for the Elephant unit: every test pins one rule from the printed rulebook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARMY_TYPES, BARBARIAN, COMBAT_DIE, PIECE_LIMITS, RECRUIT_TYPES, UNIT_COST } from '../src/engine/data/constants.js';
import { addCity, addUnit } from '../src/engine/state.js';
import { step } from '../src/engine/hex.js';
import { Game } from '../src/engine/game.js';
import { barbarianCities, barbarianMove, barbarianSpawn } from '../src/engine/barbarians.js';
import { battle, trimCargo, trimCargoChoice } from '../src/engine/combat.js';
import { resolveEvent } from '../src/engine/events.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { checkStatus } from '../src/engine/objectives.js';
import { armyAt, cityAt, isLand, unitById, unitsAt, unitsLeft, unitsOf } from '../src/engine/queries.js';
import { battleOdds } from '../src/ai/odds.js';
import { act, addCityAt, capitalOf, fresh, give, hold, kinds, landBattle, listen, openLand, playAIGame, plains, refused, rigDice, ringOf } from './scenario.mjs';

const me = (g) => g.s.players[0]; // refused actions restore the state, so objects are re-read each time

// -------------------------------------------------------------------- the unit
test('Elephants cost 2 Food, with 4 pieces for each player and 4 for the Barbarians; three faces of the Combat die show one', () => {
  assert.deepEqual(UNIT_COST.elephant, { food: 2 });
  assert.equal(PIECE_LIMITS.elephants, 4);
  assert.equal(PIECE_LIMITS.barbarianElephants, 4);
  assert.ok(ARMY_TYPES.includes('elephant'), 'an Elephant is an Army unit');
  assert.ok(RECRUIT_TYPES.includes('elephant'));
  assert.deepEqual(COMBAT_DIE.filter(([, icon]) => icon === 'elephant').map(([v]) => v), [2, 3, 4]);
});

// --------------------------------------------------------------------- recruit
test('Elephants are recruited only in a city with a Market, for 2 Food each', () => {
  const g = fresh();
  const cap = capitalOf(g);
  give(g, 0, { res: { food: 1, wood: 2, ore: 2 } });
  const recruit = { type: 'recruit', city: cap.id, units: { elephant: 1 } };
  assert.match(refused(g, recruit), /Market/);
  capitalOf(g).buildings.market = 0;
  assert.match(refused(g, recruit), /afford/, 'Wood and Ore do not pay for an Elephant');
  give(g, 0, { res: { food: 2 } });
  act(g, recruit);
  const [tusker] = unitsOf(g.s, 0, 'elephant');
  assert.equal(tusker.hex, cap.hex);
  assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore], [0, 2, 2]);
  const event = g.drainEvents().find((e) => e.type === 'recruit');
  assert.deepEqual(event.units, { infantry: 0, cavalry: 0, elephant: 1, settler: 0, ship: 0 });
});

test('Infantry, Cavalry and Elephants can be recruited together and their costs add up', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.buildings.market = 0;
  give(g, 0, { res: { food: 3, wood: 1, ore: 1 } });
  const all = { type: 'recruit', city: cap.id, units: { infantry: 1, cavalry: 1, elephant: 1 } };
  assert.match(refused(g, all), /afford/, 'Food + Ore, Food + Wood and 2 Food: 4 Food in all');
  give(g, 0, { res: { food: 4 } });
  act(g, all);
  assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore], [0, 0, 0]);
  assert.deepEqual(kinds(g, cap.hex), ['cavalry', 'elephant', 'infantry']);
});

test('an Elephant takes up one of the units a city may recruit: size, plus 1 when it is Happy', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.buildings.market = 0; // size 2 and Happy
  give(g, 0, { res: { food: 4, wood: 0, ore: 1 } });
  assert.match(refused(g, { type: 'recruit', city: cap.id, units: { infantry: 2, elephant: 2 } }), /at most 3 units/);
  act(g, { type: 'recruit', city: cap.id, units: { elephant: 2 } });
  assert.deepEqual(kinds(g, cap.hex), ['elephant', 'elephant']);
});

test('Elephants count towards the limit of 4 Army units in a space', () => {
  for (const { infantry, recruit, ok } of [
    { infantry: 3, recruit: 2, ok: false },
    { infantry: 4, recruit: 1, ok: false },
    { infantry: 3, recruit: 1, ok: true },
  ]) {
    const g = fresh();
    const cap = capitalOf(g);
    cap.buildings.market = 0;
    for (let i = 0; i < infantry; i++) addUnit(g.s, 0, 'infantry', cap.hex);
    give(g, 0, { res: { food: 4 } });
    const action = { type: 'recruit', city: cap.id, units: { elephant: recruit } };
    if (ok) {
      act(g, action);
      assert.equal(armyAt(g.s, cap.hex, 0).length, 4);
    } else assert.match(refused(g, action), /at most 4 Army/);
  }
});

test('with all 4 Elephants on the board, a new one comes from the space farthest from the city', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.buildings.market = 0;
  const land = openLand(g, cap.hex, 3);
  const [near] = plains(g, land, 1);
  const [far] = plains(g, land, 3);
  for (let i = 0; i < 3; i++) addUnit(g.s, 0, 'elephant', near);
  const stray = addUnit(g.s, 0, 'elephant', far);
  give(g, 0, { res: { food: 2 } });
  assert.equal(unitsLeft(g.s, 0, 'elephant'), 0);
  act(g, { type: 'recruit', city: cap.id, units: { elephant: 1 } });
  assert.equal(unitsOf(g.s, 0, 'elephant').length, 4, 'there are still only 4');
  assert.equal(unitById(g.s, stray.id).hex, cap.hex);
  assert.equal(armyAt(g.s, near, 0).length, 3);
});

test('Nationalism pays 1 Mood token for recruiting Elephants', () => {
  const g = fresh();
  capitalOf(g).buildings.market = 0;
  give(g, 0, { advances: ['nationalism'], res: { food: 2 }, mood: 0 });
  act(g, { type: 'recruit', city: capitalOf(g).id, units: { elephant: 1 } });
  assert.equal(me(g).mood, 1);
});

test('Draft makes an Infantry cheaper, never an Elephant', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.buildings.market = 0;
  give(g, 0, { advances: ['draft'], res: { food: 2, wood: 0, ore: 0 }, mood: 1 });
  assert.match(refused(g, { type: 'recruit', city: cap.id, units: { elephant: 1 }, draft: true }), /Draft/);
  act(g, { type: 'recruit', city: cap.id, units: { infantry: 1, elephant: 1 }, draft: true });
  assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore, me(g).mood], [0, 0, 0, 0], 'the Elephant still costs 2 Food; the Infantry costs 1 Mood');
});

// ------------------------------------------------------------------------ move
test('Elephants are Army units: they need Tactics, and a lone Elephant takes an empty enemy city with its Market', () => {
  const g = fresh();
  const cap = capitalOf(g);
  const [spot] = plains(g, openLand(g, cap.hex, 1), 1);
  const tusker = addUnit(g.s, 0, 'elephant', cap.hex);
  addCityAt(g, 1, spot).buildings.market = 1;
  const go = { type: 'move', units: [tusker.id], to: spot };
  assert.match(refused(g, go), /Tactics/);
  give(g, 0, { advances: ['tactics'] });
  act(g, go);
  const taken = cityAt(g.s, spot);
  assert.equal(taken.owner, 0);
  assert.equal(taken.buildings.market, 0, 'the captured Market takes the colour of its new owner');
  assert.equal(unitById(g.s, tusker.id).hex, spot);
});

test('a Ship carries 2 land units whatever they are, Elephants included', () => {
  const g = fresh();
  const cap = capitalOf(g);
  const [sea] = plains(g, openLand(g, cap.hex, 1), 1);
  g.s.map.hexes[sea].terrain = 'sea';
  addUnit(g.s, 0, 'ship', sea);
  give(g, 0, { advances: ['tactics'] });
  const [e1, e2] = [addUnit(g.s, 0, 'elephant', cap.hex), addUnit(g.s, 0, 'elephant', cap.hex)];
  const i1 = addUnit(g.s, 0, 'infantry', cap.hex);
  assert.match(refused(g, { type: 'move', units: [e1.id, e2.id, i1.id], to: sea }), /enough room/);
  act(g, { type: 'move', units: [e1.id, i1.id], to: sea });
  assert.deepEqual(unitsAt(g.s, sea).map((u) => u.type).sort(), ['elephant', 'infantry', 'ship']);
});

test('moving Elephants into a space is limited to 4 Army units there, Infantry included', () => {
  const g = fresh();
  const cap = capitalOf(g);
  const [spot] = plains(g, openLand(g, cap.hex, 1), 1);
  give(g, 0, { advances: ['tactics'] });
  for (let i = 0; i < 3; i++) addUnit(g.s, 0, 'infantry', spot);
  const [e1, e2] = [addUnit(g.s, 0, 'elephant', cap.hex), addUnit(g.s, 0, 'elephant', cap.hex)];
  assert.match(refused(g, { type: 'move', units: [e1.id, e2.id], to: spot }), /at most 4 Army/);
  act(g, { type: 'move', units: [e1.id], to: spot });
  assert.equal(armyAt(g.s, spot, 0).length, 4);
});

// ----------------------------------------------------------------------- battle
/**
 * Player 0 attacks player 1 (or the Barbarians) on a Plains space next to its capital, both with Tactics. `units` and `foes` are the unit types
 * of the two armies and `dice` fixes the dice of round 1, the attacker's first. The attacker retreats after that round. `play` and `foePlay`
 * name the Action cards played, `casualties` answers the casualty question and `prepare(g, { cap, spot })` may change the table first.
 */
function clash({ units, foes, dice, foeOwner = 1, cards = [], foeCards = [], play = 'none', foePlay = 'none', casualties, prepare }) {
  const g = fresh('duel');
  const cap = capitalOf(g);
  const [spot] = plains(g, openLand(g, cap.hex, 1), 1);
  give(g, 0, { advances: ['tactics'] });
  give(g, 1, { advances: ['tactics'] });
  hold(g, 0, ...cards);
  hold(g, 1, ...foeCards);
  const mine = units.map((type) => addUnit(g.s, 0, type, cap.hex).id);
  for (const type of foes) addUnit(g.s, foeOwner, type, spot);
  prepare?.(g, { cap, spot });
  const asked = listen(g, 0, { combat_card: play, retreat: 'yes', casualties });
  listen(g, 1, { combat_card: foePlay });
  rigDice(g, ...dice);
  g.drainEvents();
  g._run(battle(g, landBattle(0, foeOwner, spot, cap.hex, mine)));
  const round = g.drainEvents().find((e) => e.type === 'battle_round');
  return { g, cap, spot, asked, round, a: round.a, d: round.d };
}

const retreatPrompt = (t) => t.asked.find((q) => q.kind === 'retreat');

test('Clash: the die of an Elephant adds nothing to the CV, and the Elephant cancels one enemy hit', () => {
  const dice = [[4, 'elephant'], [6, 'infantry']];
  const tusker = clash({ units: ['elephant'], foes: ['infantry'], dice });
  assert.deepEqual(tusker.a.dice, [{ v: 4, icon: 'elephant', ignored: true }], 'the die is left out of the total');
  assert.deepEqual([tusker.a.cv, tusker.a.hits, tusker.a.elephants], [0, 0, 1]);
  assert.deepEqual(tusker.d.dice, [{ v: 6, icon: 'infantry' }]);
  assert.deepEqual([tusker.d.cv, tusker.d.bonus, tusker.d.hits], [7, 1, 1]);
  assert.deepEqual([tusker.round.cancelA, tusker.a.lost], [1, 0], 'the hit on the Elephant is cancelled');
  assert.deepEqual([retreatPrompt(tusker).info.atkEle, retreatPrompt(tusker).info.defEle], [1, 0], 'the retreat question counts the Elephants left');

  const foot = clash({ units: ['infantry'], foes: ['infantry'], dice });
  assert.deepEqual(foot.a.dice, [{ v: 4, icon: 'elephant' }], 'with no Elephant in the fight the icon means nothing');
  assert.deepEqual([foot.a.cv, foot.a.elephants, foot.round.cancelA, foot.a.lost], [4, 0, 0, 1]);
});

test('Clash: each Elephant is used once, on the lowest die with its icon; the other Elephant dice count as plain dice', () => {
  const one = clash({ units: ['elephant', 'infantry'], foes: ['infantry'], dice: [[3, 'elephant'], [2, 'elephant'], [1, 'leader']] });
  assert.deepEqual(one.a.dice, [{ v: 3, icon: 'elephant' }, { v: 2, icon: 'elephant', ignored: true }]);
  assert.deepEqual([one.a.cv, one.a.elephants, one.round.cancelA, one.a.lost, one.d.lost], [3, 1, 1, 0, 0]);

  const two = clash({ units: ['elephant', 'elephant', 'infantry'], foes: ['infantry'], dice: [[4, 'elephant'], [2, 'elephant'], [3, 'elephant'], [1, 'leader']] });
  assert.deepEqual(two.a.dice, [{ v: 4, icon: 'elephant' }, { v: 2, icon: 'elephant', ignored: true }, { v: 3, icon: 'elephant', ignored: true }]);
  assert.deepEqual([two.a.cv, two.a.elephants, two.round.cancelA], [4, 2, 2]);
});

test('the Elephants of a defender cancel hits too, in addition to the Fortress of its city', () => {
  const walls = (g, { spot }) => {
    addCityAt(g, 1, spot).buildings.fortress = 1;
  };
  const t = clash({
    units: ['infantry', 'infantry'],
    foes: ['elephant', 'infantry'],
    prepare: walls,
    dice: [[6, 'infantry'], [6, 'infantry'], [4, 'elephant'], [1, 'leader'], [1, 'leader']],
  });
  assert.deepEqual([t.d.dice.length, t.d.fortress, t.d.elephants, t.d.cv], [3, true, 1, 2], 'the Fortress die is rolled; the die of the Elephant is left out');
  assert.deepEqual([t.a.cv, t.a.hits], [14, 2]);
  assert.deepEqual([t.round.cancelD, t.d.lost], [2, 0], 'one hit for the Elephant and one for the Fortress');
});

test('the owner of a stack with several kinds of Army unit chooses which are lost; the Elephants are kept by default', () => {
  const stack = ['infantry', 'cavalry', 'elephant'];
  const none = [[1, 'leader'], [1, 'leader'], [1, 'leader']];
  const one = (casualties) => clash({ units: stack, foes: ['infantry'], dice: [...none, [6, 'infantry']], casualties });
  const first = one();
  const prompt = first.asked.find((q) => q.kind === 'casualties');
  assert.deepEqual(prompt.options.map((o) => [o.id, o.label]), [['0,0', 'Lose 1 Infantry'], ['1,0', 'Lose 1 Cavalry'], ['0,1', 'Lose 1 Elephant']]);
  assert.equal(prompt.default, '0,0');
  assert.deepEqual(kinds(first.g, first.cap.hex), ['cavalry', 'elephant']);
  for (const [answer, left] of [['1,0', ['elephant', 'infantry']], ['0,1', ['cavalry', 'infantry']]]) {
    const t = one(answer);
    assert.deepEqual(kinds(t.g, t.cap.hex), left, `answer ${answer}`);
  }

  const two = clash({ units: stack, foes: ['infantry', 'infantry'], dice: [...none, [6, 'infantry'], [6, 'infantry']] });
  const pair = two.asked.find((q) => q.kind === 'casualties');
  assert.deepEqual(pair.options.map((o) => [o.id, o.label]), [
    ['1,0', 'Lose 1 Infantry, 1 Cavalry'],
    ['0,1', 'Lose 1 Infantry, 1 Elephant'],
    ['1,1', 'Lose 1 Cavalry, 1 Elephant'],
  ]);
  assert.equal(pair.default, '1,0');
  assert.deepEqual(kinds(two.g, two.cap.hex), ['elephant'], 'two hits take the Infantry and the Cavalry');

  for (const [units, labels] of [[['infantry', 'elephant'], ['Lose 1 Infantry', 'Lose 1 Elephant']], [['cavalry', 'elephant'], ['Lose 1 Cavalry', 'Lose 1 Elephant']]]) {
    const t = clash({ units, foes: ['infantry'], dice: [[1, 'leader'], [1, 'leader'], [6, 'infantry']] });
    const q = t.asked.find((x) => x.kind === 'casualties');
    assert.deepEqual(q.options.map((o) => [o.id, o.label]), [['0', labels[0]], ['1', labels[1]]], units.join(' and '));
    assert.equal(q.default, '0');
  }
});

test('Barbarian Elephants fight like any other, and the Barbarians lose their Infantry before them, without being asked', () => {
  const t = clash({
    units: ['infantry', 'infantry'],
    foes: ['infantry', 'elephant'],
    foeOwner: BARBARIAN,
    dice: [[6, 'infantry'], [6, 'infantry'], [3, 'elephant'], [1, 'leader']],
  });
  assert.deepEqual([t.d.elephants, t.round.cancelD, t.a.hits, t.d.lost], [1, 1, 2, 1], 'two hits, one of them cancelled');
  assert.deepEqual(kinds(t.g, t.spot, BARBARIAN), ['elephant']);
  assert.equal(t.g.pending, null, 'the Barbarians were not asked anything');
  assert.equal(retreatPrompt(t).info.defEle, 1);
});

// -------------------------------------------------------------- cards in a battle
test('High Ground Combat blocks the Elephants too: their dice count and no hit is cancelled', () => {
  const dice = [[4, 'elephant'], [5, 'infantry'], [6, 'infantry']];
  const setup = { units: ['elephant', 'infantry'], foes: ['infantry'], foeCards: ['high_ground_card'], dice };
  const open = clash(setup);
  assert.deepEqual([open.a.cv, open.a.bonus, open.a.elephants, open.round.cancelA, open.a.lost], [6, 1, 1, 1, 0]);

  const blocked = clash({ ...setup, foePlay: 'high_ground_card' });
  assert.deepEqual(blocked.a.dice, [{ v: 4, icon: 'elephant' }, { v: 5, icon: 'infantry' }], 'the Elephant die is no longer left out');
  assert.deepEqual([blocked.a.cv, blocked.a.bonus, blocked.a.elephants, blocked.round.cancelA, blocked.a.lost], [9, 0, 0, 0, 1]);
  assert.deepEqual(blocked.round.notes, [
    `High Ground Combat: ${blocked.g.name(0)} gets no clash bonus.`,
    `High Ground Combat: the Elephants of ${blocked.g.name(0)} cancel no hit.`,
  ]);
});

test('Confusion rerolls the highest die, and the Elephants are put to the lowest Elephant dice again', () => {
  const t = clash({
    units: ['elephant', 'infantry'],
    foes: ['infantry'],
    foeCards: ['sabotage'],
    foePlay: 'sabotage',
    dice: [[3, 'elephant'], [6, 'infantry'], [1, 'leader'], [2, 'elephant']],
  });
  assert.deepEqual(t.a.dice, [{ v: 3, icon: 'elephant' }, { v: 2, icon: 'elephant', ignored: true }], 'the new 2 is left out instead of the 3');
  assert.deepEqual([t.a.cv, t.a.bonus, t.a.elephants, t.round.cancelA], [3, 0, 1, 1]);
  assert.deepEqual(t.round.notes, [`Confusion: ${t.g.name(0)} rerolls a 6 and gets a 2.`]);
});

test('Sabotaged Supplies takes 1 CV off for each die that counts, not for the die of an Elephant', () => {
  const t = clash({
    units: ['elephant', 'infantry'],
    foes: ['infantry'],
    foeCards: ['infiltration'],
    foePlay: 'infiltration',
    dice: [[4, 'elephant'], [5, 'infantry'], [1, 'leader']],
  });
  assert.deepEqual([t.a.mod, t.a.cv, t.a.hits, t.d.lost], [-1, 5, 1, 1], '5 + 1 for the Infantry icon - 1 for the one die that counts');
  assert.deepEqual(t.round.notes, [`Sabotaged Supplies: ${t.g.name(0)} loses 1 point (-1 per die that counts).`]);
});

// ---------------------------------------------------------------- Ships and cargo
test('overloaded Ships leave Settlers behind first, then Infantry, then Cavalry, and Elephants last; the owner may choose otherwise', () => {
  const setup = (types) => {
    const g = fresh();
    const [sea] = ringOf(openLand(g, capitalOf(g).hex, 2), 2);
    g.s.map.hexes[sea].terrain = 'sea';
    addUnit(g.s, 0, 'ship', sea); // one Ship carries 2
    for (const type of types) addUnit(g.s, 0, type, sea);
    return { g, sea, left: () => unitsAt(g.s, sea).map((u) => u.type).sort() };
  };

  for (const [cargo, expected] of [
    [['settler', 'infantry', 'elephant'], ['elephant', 'infantry', 'ship']],
    [['infantry', 'cavalry', 'elephant'], ['cavalry', 'elephant', 'ship']],
    [['cavalry', 'elephant', 'elephant'], ['elephant', 'elephant', 'ship']],
  ]) {
    const t = setup(cargo);
    assert.equal(trimCargo(t.g, t.sea).length, 1, cargo.join(', '));
    assert.deepEqual(t.left(), expected, cargo.join(', '));
  }

  for (const [choice, expected] of [
    ['elephant', ['cavalry', 'settler', 'ship']],
    ['cavalry', ['elephant', 'settler', 'ship']],
    [undefined, ['cavalry', 'elephant', 'ship']],
  ]) {
    const t = setup(['settler', 'cavalry', 'elephant']);
    const asked = listen(t.g, 0, choice ? { choice } : {});
    t.g._run(trimCargoChoice(t.g, t.sea));
    assert.deepEqual(asked[0].options.map((o) => [o.id, o.label]), [
      ['settler', 'Leave a Settler behind'],
      ['cavalry', 'Leave a Cavalry behind'],
      ['elephant', 'Leave an Elephant behind'],
    ]);
    assert.deepEqual(t.left(), expected, `choice ${choice}`);
  }
});

// ------------------------------------------------------------------ Barbarians
/**
 * A Barbarian city on a ring-3 Plains hex holds `infantry` Infantry; player 0 then draws a Barbarian spawn, picks that city to muster in and
 * answers the Cavalry and Elephant questions. `crowd` more Infantry stand far away and `stray` Elephants on another space.
 */
function muster({ infantry, cavalry = 'no', elephant = 'yes', stray = 0, crowd = 0 }) {
  const g = fresh();
  const cap = capitalOf(g);
  const land = openLand(g, cap.hex, 5);
  const [spot, other] = plains(g, land, 3);
  const away = [...plains(g, land, 4), ...plains(g, land, 5)];
  assert.ok(away.length * 4 >= crowd, 'room to stand the crowd in stacks of 4');
  const base = addCity(g.s, BARBARIAN, spot);
  for (let i = 0; i < infantry; i++) addUnit(g.s, BARBARIAN, 'infantry', base.hex);
  for (let i = 0; i < crowd; i++) addUnit(g.s, BARBARIAN, 'infantry', away[Math.floor(i / 4)]);
  for (let i = 0; i < stray; i++) addUnit(g.s, BARBARIAN, 'elephant', other);
  const asked = listen(g, 0, {
    pick_hex: (p) => (p.title === 'Barbarians muster' ? spot : p.default),
    barbarian_cavalry: cavalry,
    barbarian_elephant: elephant,
  });
  g._run(barbarianSpawn(g, 0));
  const newcomer = barbarianCities(g.s).find((c) => c.hex !== spot); // undefined when no Settlement could be placed
  const count = (kind) => asked.filter((p) => p.kind === kind).length;
  return { g, spot, newcomer, at: (hex) => kinds(g, hex, BARBARIAN), horseAsked: count('barbarian_cavalry'), tuskerAsked: count('barbarian_elephant') };
}

test('a Barbarian muster may put an Elephant in place of the Infantry, but only in a city that already has an Infantry', () => {
  let r = muster({ infantry: 1, elephant: 'yes' });
  assert.deepEqual(r.at(r.spot), ['elephant', 'infantry']);
  assert.deepEqual([r.horseAsked, r.tuskerAsked], [1, 1], 'Cavalry are offered first, then Elephants');

  r = muster({ infantry: 1, elephant: 'no' });
  assert.deepEqual(r.at(r.spot), ['infantry', 'infantry']);

  r = muster({ infantry: 1, cavalry: 'yes', elephant: 'yes' });
  assert.deepEqual(r.at(r.spot), ['cavalry', 'infantry'], 'one Unit only: a Cavalry leaves no room for an Elephant');
  assert.equal(r.tuskerAsked, 0);

  r = muster({ infantry: 0, elephant: 'yes' });
  assert.deepEqual(r.at(r.spot), ['infantry'], 'an empty city needs its Infantry first');
  assert.deepEqual([r.horseAsked, r.tuskerAsked], [0, 0]);
});

test('the Barbarian muster skips a full city, and there are only 4 Barbarian Elephants', () => {
  let r = muster({ infantry: 4, elephant: 'yes' });
  assert.deepEqual(r.at(r.spot), ['infantry', 'infantry', 'infantry', 'infantry'], 'the full city was not offered');
  assert.ok(r.newcomer, 'the spawn placed a new Barbarian city');
  assert.deepEqual(r.at(r.newcomer.hex), ['elephant', 'infantry'], 'the new settlement took the Elephant');

  r = muster({ infantry: 1, elephant: 'yes', stray: 4 });
  assert.equal(unitsLeft(r.g.s, BARBARIAN, 'elephant'), 0);
  assert.equal(r.tuskerAsked, 0, 'no Elephant is left to place');
  assert.deepEqual(r.at(r.spot), ['infantry', 'infantry']);
});

test('with every Barbarian Infantry already on the board, an Elephant can still join a city that has an Infantry', () => {
  let r = muster({ infantry: 1, crowd: 19, elephant: 'yes' });
  assert.equal(unitsLeft(r.g.s, BARBARIAN, 'infantry'), 0);
  assert.equal(r.tuskerAsked, 1);
  assert.deepEqual(r.at(r.spot), ['elephant', 'infantry']);
  assert.equal(r.newcomer, undefined, 'a new Settlement needs an Infantry and there is none left');

  r = muster({ infantry: 1, crowd: 19, elephant: 'no' });
  assert.deepEqual(r.at(r.spot), ['infantry'], 'declining places nothing when there is no Infantry left');
});

test('after the Barbarians move, each of their cities near the player may get an Elephant in place of an Infantry', () => {
  const foot = ['infantry', 'infantry', 'infantry', 'infantry'];
  for (const { pick, titles, expected } of [
    { pick: 'elephant', titles: ['Barbarian Cavalry', 'Barbarian Elephants'], expected: ['elephant', 'infantry', 'infantry', 'infantry'] },
    { pick: 'cavalry', titles: ['Barbarian Cavalry'], expected: ['cavalry', 'infantry', 'infantry', 'infantry'] },
    { pick: 'none', titles: ['Barbarian Cavalry', 'Barbarian Elephants'], expected: foot },
  ]) {
    let checked = false;
    for (let n = 0; n < 40 && !checked; n++) {
      const g = fresh(`barbarian-tusker-${n}`);
      const cap = capitalOf(g);
      openLand(g, cap.hex, 2);
      // Two spaces in a straight line from the capital: the far army is blocked by the near one, so it stays put.
      const line = [0, 1, 2, 3, 4, 5].map((d) => [step(cap.hex, d, 1), step(cap.hex, d, 2)]).find(([a, b]) => isLand(g.s, a) && isLand(g.s, b));
      assert.ok(line, 'two land spaces in a line from the capital');
      const [near, far] = line;
      const base = addCity(g.s, BARBARIAN, far);
      for (let i = 0; i < 3; i++) addUnit(g.s, BARBARIAN, 'infantry', far);
      for (let i = 0; i < 2; i++) addUnit(g.s, BARBARIAN, 'infantry', near);
      for (let i = 0; i < 4; i++) addUnit(g.s, 0, 'infantry', cap.hex);
      const asked = listen(g, 0, {
        pick_hex: (p) => (/moves next/.test(p.text) ? far : p.default),
        pick_cities: (p) => ((p.title === 'Barbarian Cavalry' ? pick === 'cavalry' : pick === 'elephant') ? [base.id] : []),
      });
      g._run(barbarianMove(g, 0));
      if (cityAt(g.s, cap.hex).owner !== 0) continue; // the dice favoured the Barbarians: try the next seed
      const prompts = asked.filter((p) => p.kind === 'pick_cities');
      assert.deepEqual(prompts.map((p) => p.title), titles, `${pick}: a city that took a Cavalry is not offered again`);
      assert.deepEqual(prompts.at(-1).options.map((o) => o.id), [base.id]);
      assert.equal(prompts.at(-1).multi.min, 0, 'the player may choose none');
      assert.deepEqual(kinds(g, far, BARBARIAN), expected, pick);
      checked = true;
    }
    assert.ok(checked, `a Barbarian move with the capital held was found (${pick})`);
  }
});

// ----------------------------------------------------------- events and objectives
test('Civil War makes Elephants desert an Angry city like any other Army unit; calm cities keep theirs', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.mood = 'angry';
  const calm = addCityAt(g, 0, plains(g, openLand(g, cap.hex, 3), 3)[0]);
  addUnit(g.s, 0, 'infantry', cap.hex);
  addUnit(g.s, 0, 'elephant', cap.hex);
  addUnit(g.s, 0, 'elephant', calm.hex);
  g.s.decks.event.push('civil_war');
  listen(g, 0);
  g._run(resolveEvent(g, 0));
  assert.deepEqual(armyAt(g.s, cap.hex, 0), []);
  assert.deepEqual(kinds(g, calm.hex), ['elephant']);
});

test('Epidemic takes an Infantry and a Settler, never an Elephant', () => {
  const g = fresh();
  const cap = capitalOf(g);
  addUnit(g.s, 0, 'elephant', cap.hex); // first in line, so it would be the victim if Elephants could be
  addUnit(g.s, 0, 'infantry', cap.hex);
  g.s.decks.event.push('epidemic');
  listen(g, 0);
  g._run(resolveEvent(g, 0));
  assert.deepEqual(unitsOf(g.s, 0).map((u) => u.type), ['elephant']);
});

test('Elephants count as Army units for the Large Army objective', () => {
  const g = fresh();
  const cap = capitalOf(g);
  for (let i = 0; i < 3; i++) addUnit(g.s, 0, 'infantry', cap.hex);
  assert.equal(checkStatus(g.s, 0, 'large_army').ok, false);
  addUnit(g.s, 0, 'elephant', cap.hex);
  assert.equal(checkStatus(g.s, 0, 'large_army').ok, true);
});

// ----------------------------------------------------- candidate actions and saves
test('the action list offers Elephants once a city has a Market and the Food for one', () => {
  const g = fresh();
  const tusker = (a) => a.cat === 'recruit' && a.action.units.elephant > 0;
  give(g, 0, { res: { food: 2 } });
  assert.equal(enumerateActions(g, 0).filter(tusker).length, 0, 'no Market yet');

  capitalOf(g).buildings.market = 0;
  assert.deepEqual(enumerateActions(g, 0).filter(tusker).map((a) => a.action.units), [{ infantry: 0, cavalry: 0, elephant: 1, settler: 0, ship: 0 }]);
  give(g, 0, { res: { food: 4 } });
  assert.ok(enumerateActions(g, 0).some((a) => tusker(a) && a.action.units.elephant === 2), 'two Elephants for 4 Food');
});

test('a saved game keeps its Elephants, and the loaded game plays on', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.buildings.market = 0;
  addUnit(g.s, 0, 'elephant', cap.hex);
  const copy = Game.fromJSON(g.toJSON());
  copy.policy = copy.s.players.map(() => (_g, prompt) => prompt.default);
  assert.equal(unitsOf(copy.s, 0, 'elephant').length, 1);
  give(copy, 0, { res: { food: 2 } });
  act(copy, { type: 'recruit', city: capitalOf(copy).id, units: { elephant: 1 } });
  assert.equal(unitsOf(copy.s, 0, 'elephant').length, 2);
});

// -------------------------------------------------------------------------- AI
test('the AI\'s battle odds count Elephants: their dice add nothing to the CV, but each cancels a hit', () => {
  const real = Math.random;
  Math.random = () => 0.6; // every die shows its 8th face: a 4 with an Elephant icon
  // A fraction of a point changes no result, but gives these calls a cache key of their own.
  const odds = (a, d, options = {}) => battleOdds(a, d, { bonusA: 0.5, bonusD: 0.5, ...options });
  try {
    // 3 Infantry roll 12 CV (2 hits) against 2 Infantry that roll 8 CV (1 hit): the defence is gone in round 1.
    const foot = odds(3, 2);
    assert.deepEqual([foot.win, foot.lossA, foot.lossD], [1, 1, 2]);
    // Two Elephants roll no CV at all, yet they cancel both hits of the attack, so nobody ever dies.
    const held = odds(3, 2, { elephantD: 2 });
    assert.deepEqual([held.win, held.lossA, held.lossD], [0, 0, 0]);
    // The same goes for three Elephants under the 1 hit of the Infantry.
    const guarded = odds(3, 2, { elephantA: 3 });
    assert.deepEqual([guarded.win, guarded.lossA, guarded.lossD], [0, 0, 0]);
  } finally {
    Math.random = real;
  }
});

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('computers that start with Bartering, Tactics, a Market and Elephants play legal games to the end', () => {
  const real = Math.random;
  try {
    for (const seed of [41, 42]) {
      Math.random = seededRandom(seed); // the computer is random: a fixed seed keeps a failure reproducible
      const { g, problems } = playAIGame(seed, {
        prepare: (game) => {
          for (const { idx } of game.s.players) {
            give(game, idx, { advances: ['bartering', 'tactics'] });
            const home = capitalOf(game, idx);
            home.buildings.market = idx;
            for (let i = 0; i < 2; i++) addUnit(game.s, idx, 'elephant', home.hex);
          }
        },
      });
      assert.deepEqual(problems, [], `seed ${seed}`);
      assert.equal(g.s.phase, 'over', `seed ${seed}`);
    }
  } finally {
    Math.random = real;
  }
});
