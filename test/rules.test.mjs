import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, roman } from '../src/engine/game.js';
import { ADVANCES } from '../src/engine/data/advances.js';
import { DEFAULT_AGES, MAX_AGES, MIN_AGES } from '../src/engine/data/constants.js';
import { WONDER_IDS } from '../src/engine/data/wonders.js';
import { availableAdvances } from '../src/engine/advance.js';
import { totalAges } from '../src/engine/queries.js';
import { checkInvariants } from './harness.mjs';
import { act, capitalOf, fresh, give, neighbourWith, refused, settlerOf } from './scenario.mjs';

test('setup: one Happy city, one Settler and 2 Food each, only the home Regions are revealed', () => {
  const g = fresh();
  const s = g.s;
  for (const p of [0, 1]) {
    const pl = s.players[p];
    const mine = s.cities.filter((c) => c.owner === p);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].mood, 'happy');
    assert.equal(s.map.hexes[mine[0].hex].terrain, 'plains');
    assert.equal(s.units.filter((u) => u.owner === p).length, 1);
    assert.equal(settlerOf(g, p).hex, mine[0].hex);
    assert.deepEqual(pl.res, { food: 2, wood: 0, ore: 0, ideas: 0, gold: 0 });
    assert.deepEqual(pl.advances, ['farming', 'mining']);
    assert.equal(pl.hand.action.length, 1);
    assert.equal(pl.hand.objective.length, 1);
    assert.equal(pl.hand.wonder.length, 0);
  }
  assert.equal(s.map.regions.length, 10);
  assert.equal(Object.keys(s.map.hexes).length, 40);
  assert.deepEqual(s.map.regions.map((r) => r.flipped !== null), [true, true, ...Array(8).fill(false)]);
  assert.equal(s.decks.wonder.length, WONDER_IDS.length);
  assert.equal(Object.keys(ADVANCES).length, 48);
  assert.deepEqual(checkInvariants(g), []);
});

test('the same seed always builds the same game', () => {
  const a = Game.create({ seed: 'twin' });
  const b = Game.create({ seed: 'twin' });
  assert.equal(a.toJSON(), b.toJSON());
  assert.notEqual(a.toJSON(), Game.create({ seed: 'other' }).toJSON());
});

test('a turn has three actions and a fourth is refused', () => {
  const g = fresh();
  const city = capitalOf(g);
  const forest = neighbourWith(g, city.hex, 'forest');
  assert.ok(forest, 'the home Region has a Forest next to the capital');
  const collect = { type: 'collect', city: city.id, picks: [{ hex: forest, res: 'wood' }] };
  for (const left of [2, 1, 0]) {
    act(g, collect);
    assert.equal(g.s.turn.actionsLeft, left);
  }
  give(g, 0, { res: { food: 2 } });
  assert.match(refused(g, { type: 'advance', advance: 'storage' }), /no actions left/i);
});

test('ending a turn passes play on; rounds, Ages and the Status Phase follow the rulebook', () => {
  const g = fresh();
  const s = g.s;
  assert.deepEqual([s.age, s.round, g.cur], [1, 1, 0]);
  act(g, { type: 'end_turn' });
  assert.deepEqual([s.age, s.round, g.cur], [1, 1, 1]);
  act(g, { type: 'end_turn' });
  assert.deepEqual([s.age, s.round, g.cur], [1, 2, 0]);
  for (let i = 0; i < 4; i++) act(g, { type: 'end_turn' });
  // Round 3 ended: Status Phase, then Age II starts.
  assert.deepEqual([s.age, s.round, s.phase], [2, 1, 'main']);
  for (const pl of s.players) {
    assert.equal(pl.advances.length, 3, 'the Status Phase gives each player a free Advance');
    assert.equal(pl.hand.action.length, 2);
    assert.equal(pl.hand.objective.length, 2);
  }
  assert.ok(s.log.some((l) => l.includes('Status Phase of Age 1')));
});

test('the game ends after the Status Phase of Age VI', () => {
  const g = fresh();
  let turns = 0;
  while (g.s.phase !== 'over' && turns < 100) {
    act(g, { type: 'end_turn' });
    turns += 1;
  }
  assert.equal(turns, 36, '6 Ages x 3 rounds x 2 players');
  assert.ok(g.s.final);
  assert.equal(refused(g, { type: 'end_turn' }), 'The game is over.');
});

test('the game length can be 4 to 12 Ages and is six when nothing is asked for', () => {
  assert.deepEqual([DEFAULT_AGES, MIN_AGES, MAX_AGES], [6, 4, 12]);
  assert.equal(Game.create({ seed: 'length' }).s.ages, 6);
  const wanted = [
    [4, 4], [8, 8], [12, 12], // anything from 4 to 12 is accepted as it is
    [3, 4], [0, 4], [-5, 4], [13, 12], [99, 12], // too short or too long: the nearest allowed length
    [7.6, 8], ['9', 9], [' 10 ', 10], // numbers typed or stored as text
    [undefined, 6], [null, 6], ['', 6], ['many', 6], [NaN, 6], // nothing usable: the default
  ];
  for (const [asked, ages] of wanted) {
    assert.equal(Game.create({ seed: 'length', ages: asked }).s.ages, ages, `asked for ${String(asked)}`);
  }
});

for (const ages of [4, 5, 9, 12]) {
  test(`a game of ${ages} Ages ends after the Status Phase of Age ${roman(ages)}`, () => {
    const g = fresh('length', { ages });
    assert.equal(totalAges(g.s), ages);
    let turns = 0;
    while (g.s.phase !== 'over' && turns < 200) {
      act(g, { type: 'end_turn' });
      turns += 1;
      assert.deepEqual(checkInvariants(g), []);
    }
    assert.equal(turns, ages * 3 * 2, `${ages} Ages x 3 rounds x 2 players`);
    assert.equal(g.s.age, ages, 'the Age counter stops at the last Age');
    assert.ok(g.s.final);
    assert.ok(g.s.log.some((l) => l.includes(`Status Phase of Age ${ages}`)));
    assert.equal(refused(g, { type: 'end_turn' }), 'The game is over.');
  });
}

test('a saved game keeps its length, and a save from before the option existed lasts six Ages', () => {
  const playOut = (g) => {
    let turns = 0;
    while (g.s.phase !== 'over' && turns < 200) {
      act(g, { type: 'end_turn' });
      turns += 1;
    }
    return turns;
  };

  const short = fresh('length-save', { ages: 4 });
  const loaded = Game.fromJSON(short.toJSON());
  loaded.policy = short.policy;
  assert.equal(loaded.s.ages, 4);
  assert.equal(playOut(loaded), 24, 'the loaded game still lasts 4 Ages');

  const old = fresh('length-old');
  delete old.s.ages;
  const restored = Game.fromJSON(old.toJSON());
  restored.policy = old.policy;
  assert.equal(totalAges(restored.s), 6);
  assert.equal(playOut(restored), 36, 'a game saved without a length lasts the usual 6 Ages');
});

test('researching: 2 Food, Ideas or Gold can replace Food, categories open from the top down', () => {
  const g = fresh();
  const me = () => g.s.players[0]; // refused actions restore the state, so objects are re-read each time
  assert.match(refused(g, { type: 'advance', advance: 'public_education' }), /Writing/);
  assert.match(refused(g, { type: 'advance', advance: 'farming' }), /already/);
  assert.match(refused(g, { type: 'advance', advance: 'voting' }), /Philosophy/);
  assert.ok(availableAdvances(g.s, 0).includes('storage'));
  me().res = { food: 0, wood: 0, ore: 0, ideas: 1, gold: 1 };
  act(g, { type: 'advance', advance: 'storage' });
  assert.deepEqual(me().res, { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0 });
  assert.ok(me().advances.includes('storage'));
  assert.equal(me().mood, 1, 'Storage carries a Mood token');
  assert.match(refused(g, { type: 'advance', advance: 'irrigation' }), /costs 2 Food/);
});

test('the Food limit is 2 until Storage lifts it to 7', () => {
  const g = fresh();
  const pl = g.s.players[0];
  const plains = capitalOf(g).hex;
  const collect = () => act(g, { type: 'collect', city: capitalOf(g).id, picks: [{ hex: plains, res: 'food' }] });
  collect();
  assert.equal(pl.res.food, 2);
  give(g, 0, { advances: ['storage'] });
  collect();
  assert.equal(pl.res.food, 3);
});

test('every third Advance triggers an Event and resets the cubes', () => {
  const g = fresh();
  const pl = g.s.players[0];
  const cubes = [];
  for (const adv of ['storage', 'irrigation', 'husbandry']) {
    pl.res.food = 2;
    act(g, { type: 'advance', advance: adv });
    cubes.push(pl.cubes);
  }
  assert.deepEqual(cubes, [2, 1, 3]);
  assert.ok(g.drainEvents().some((e) => e.type === 'event'));
});

test('Writing and Engineering draw cards', () => {
  const g = fresh();
  const pl = g.s.players[0];
  pl.res.food = 2;
  act(g, { type: 'advance', advance: 'writing' });
  assert.equal(pl.hand.action.length, 2);
  assert.equal(pl.hand.objective.length, 2);
  assert.equal(pl.culture, 1);
  pl.res.food = 2;
  act(g, { type: 'advance', advance: 'engineering' });
  assert.equal(pl.hand.wonder.length, 1);
});

test('Philosophy gives an Idea', () => {
  const g = fresh();
  const pl = g.s.players[0];
  give(g, 0, { res: { food: 2 }, advances: ['writing'] });
  act(g, { type: 'advance', advance: 'philosophy' });
  assert.equal(pl.res.ideas, 1);
});

test('only one Government can be held, and each needs its prerequisite Advance', () => {
  const g = fresh();
  give(g, 0, { res: { food: 2 }, advances: ['philosophy', 'draft'] });
  act(g, { type: 'advance', advance: 'voting' });
  assert.equal(g.s.players[0].government, 'democracy');
  assert.match(refused(g, { type: 'advance', advance: 'nationalism' }), /one Government/);
});
