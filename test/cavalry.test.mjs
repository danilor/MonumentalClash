// Regressions for the Cavalry unit and the Market building: every test pins one rule from the printed rulebook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADVANCES } from '../src/engine/data/advances.js';
import { BARBARIAN, BUILDINGS, BUILDING_ADVANCE, PIECE_LIMITS, UNIT_COST } from '../src/engine/data/constants.js';
import { addCity, addUnit } from '../src/engine/state.js';
import { step } from '../src/engine/hex.js';
import { Game, tradeRoutes } from '../src/engine/game.js';
import { constructBlocked } from '../src/engine/city.js';
import { barbarianCities, barbarianMove, barbarianSpawn } from '../src/engine/barbarians.js';
import { battle, trimCargo, trimCargoChoice } from '../src/engine/combat.js';
import { resolveEvent } from '../src/engine/events.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { checkStatus } from '../src/engine/objectives.js';
import { armyAt, buildingsLeft, cityAt, citySize, isLand, unitById, unitsAt, unitsLeft, unitsOf } from '../src/engine/queries.js';
import { battleOdds } from '../src/ai/odds.js';
import { act, addCityAt, capitalOf, fresh, give, kinds, landBattle, listen, neighbourWith, openLand, playAIGame, plains, refused, ringOf } from './scenario.mjs';

const me = (g) => g.s.players[0]; // refused actions restore the state, so objects are re-read each time

// ------------------------------------------------------------------ the Market
test('the Market is a building that needs the Bartering Advance; Cavalry cost 1 Food and 1 Wood, with 4 pieces each', () => {
  assert.ok(BUILDINGS.includes('market'));
  assert.equal(BUILDING_ADVANCE.market, 'bartering');
  assert.equal(ADVANCES.bartering.building, 'market');
  assert.match(ADVANCES.bartering.text, /Market/);
  assert.deepEqual(UNIT_COST.cavalry, { food: 1, wood: 1 });
  assert.equal(PIECE_LIMITS.cavalry, 4);
  assert.equal(PIECE_LIMITS.barbarianCavalry, 4);
});

test('a Market is built like any building: it needs Bartering, 1 Food + 1 Wood + 1 Ore, and a city with room to grow', () => {
  const g = fresh();
  const market = () => ({ type: 'construct', city: capitalOf(g).id, building: 'market' });
  give(g, 0, { res: { food: 1, wood: 1, ore: 1 } });
  assert.match(refused(g, market()), /Bartering/);
  give(g, 0, { advances: ['bartering'] });
  assert.match(refused(g, market()), /larger than size/, 'one city cannot grow to size 2');
  addCityAt(g, 0, neighbourWith(g, capitalOf(g).hex, 'forest'));
  act(g, market());
  const cap = capitalOf(g);
  assert.equal(cap.buildings.market, 0);
  assert.equal(citySize(cap), 2);
  assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore], [0, 0, 0]);
  assert.equal(buildingsLeft(g.s, 0, 'market'), 4);
  assert.match(constructBlocked(g.s, 0, cap, 'market'), /already/, 'one Market per city');
});

test('a player has only five Market pieces', () => {
  const g = fresh();
  const cap = capitalOf(g);
  give(g, 0, { res: { food: 1, wood: 1, ore: 1 }, advances: ['bartering'] });
  const far = plains(g, openLand(g, cap.hex, 3), 3);
  assert.ok(far.length >= 5);
  for (const hex of far.slice(0, 5)) addCityAt(g, 0, hex).buildings.market = 0;
  assert.equal(buildingsLeft(g.s, 0, 'market'), 0);
  assert.match(refused(g, { type: 'construct', city: cap.id, building: 'market' }), /no pieces/);
});

test('a Market of any colour lets its city recruit Cavalry, with or without Bartering', () => {
  const g = fresh();
  capitalOf(g).buildings.market = 1;
  give(g, 0, { res: { food: 1, wood: 1 } });
  assert.equal(me(g).advances.includes('bartering'), false);
  act(g, { type: 'recruit', city: capitalOf(g).id, units: { cavalry: 1 } });
  assert.equal(unitsOf(g.s, 0, 'cavalry').length, 1);
});

// --------------------------------------------------------------------- recruit
test('Cavalry are recruited only in a city with a Market, for 1 Food and 1 Wood each', () => {
  const g = fresh();
  const cap = capitalOf(g);
  give(g, 0, { res: { food: 1, wood: 1, ore: 0 } });
  const recruit = { type: 'recruit', city: cap.id, units: { cavalry: 1 } };
  assert.match(refused(g, recruit), /Market/);
  capitalOf(g).buildings.market = 0;
  act(g, recruit);
  const [horse] = unitsOf(g.s, 0, 'cavalry');
  assert.equal(horse.hex, cap.hex);
  assert.deepEqual([me(g).res.food, me(g).res.wood], [0, 0]);
  const event = g.drainEvents().find((e) => e.type === 'recruit');
  assert.deepEqual(event.units, { infantry: 0, cavalry: 1, settler: 0, ship: 0 });
});

test('Infantry and Cavalry can be recruited together and their costs add up', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.buildings.market = 0;
  give(g, 0, { res: { food: 1, wood: 1, ore: 1 } });
  const both = { type: 'recruit', city: cap.id, units: { infantry: 1, cavalry: 1 } };
  assert.match(refused(g, both), /afford/, 'the Infantry costs Food + Ore and the Cavalry Food + Wood: 2 Food in all');
  give(g, 0, { res: { food: 2 } });
  act(g, both);
  assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore], [0, 0, 0]);
  assert.deepEqual(kinds(g, cap.hex), ['cavalry', 'infantry']);
});

test('a Cavalry takes up one of the units a city may recruit: size, plus 1 when it is Happy', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.buildings.market = 0; // size 2 and Happy
  give(g, 0, { res: { food: 2, wood: 2, ore: 1 } });
  assert.match(refused(g, { type: 'recruit', city: cap.id, units: { infantry: 2, cavalry: 2 } }), /at most 3 units/);
  act(g, { type: 'recruit', city: cap.id, units: { cavalry: 2 } });
  assert.deepEqual(kinds(g, cap.hex), ['cavalry', 'cavalry']);
});

test('Cavalry count towards the limit of 4 Army units in a space', () => {
  for (const { infantry, recruit, ok } of [
    { infantry: 3, recruit: 2, ok: false },
    { infantry: 4, recruit: 1, ok: false },
    { infantry: 3, recruit: 1, ok: true },
  ]) {
    const g = fresh();
    const cap = capitalOf(g);
    cap.buildings.market = 0;
    for (let i = 0; i < infantry; i++) addUnit(g.s, 0, 'infantry', cap.hex);
    give(g, 0, { res: { food: 2, wood: 2 } });
    const action = { type: 'recruit', city: cap.id, units: { cavalry: recruit } };
    if (ok) {
      act(g, action);
      assert.equal(armyAt(g.s, cap.hex, 0).length, 4);
    } else assert.match(refused(g, action), /at most 4 Army/);
  }
});

test('with all 4 Cavalry on the board, a new one comes from the space farthest from the city', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.buildings.market = 0;
  const land = openLand(g, cap.hex, 3);
  const [near] = plains(g, land, 1);
  const [far] = plains(g, land, 3);
  for (let i = 0; i < 3; i++) addUnit(g.s, 0, 'cavalry', near);
  const stray = addUnit(g.s, 0, 'cavalry', far);
  give(g, 0, { res: { food: 1, wood: 1 } });
  assert.equal(unitsLeft(g.s, 0, 'cavalry'), 0);
  act(g, { type: 'recruit', city: cap.id, units: { cavalry: 1 } });
  assert.equal(unitsOf(g.s, 0, 'cavalry').length, 4, 'there are still only 4');
  assert.equal(unitById(g.s, stray.id).hex, cap.hex);
  assert.equal(armyAt(g.s, near, 0).length, 3);
});

test('Nationalism pays 1 Mood token for recruiting Cavalry', () => {
  const g = fresh();
  capitalOf(g).buildings.market = 0;
  give(g, 0, { advances: ['nationalism'], res: { food: 1, wood: 1 }, mood: 0 });
  act(g, { type: 'recruit', city: capitalOf(g).id, units: { cavalry: 1 } });
  assert.equal(me(g).mood, 1);
});

test('Draft makes an Infantry cheaper, never a Cavalry', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.buildings.market = 0;
  give(g, 0, { advances: ['draft'], res: { food: 1, wood: 1, ore: 0 }, mood: 1 });
  assert.match(refused(g, { type: 'recruit', city: cap.id, units: { cavalry: 1 }, draft: true }), /Draft/);
  act(g, { type: 'recruit', city: cap.id, units: { infantry: 1, cavalry: 1 }, draft: true });
  assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore, me(g).mood], [0, 0, 0, 0], 'the Cavalry still costs 1 Food + 1 Wood; the Infantry costs 1 Mood');
});

// ------------------------------------------------------------------------ move
test('Cavalry are Army units: they need Tactics, and a lone Cavalry takes an empty enemy city with its Market', () => {
  const g = fresh();
  const cap = capitalOf(g);
  const [spot] = plains(g, openLand(g, cap.hex, 1), 1);
  const horse = addUnit(g.s, 0, 'cavalry', cap.hex);
  addCityAt(g, 1, spot).buildings.market = 1;
  const go = { type: 'move', units: [horse.id], to: spot };
  assert.match(refused(g, go), /Tactics/);
  give(g, 0, { advances: ['tactics'] });
  act(g, go);
  const taken = cityAt(g.s, spot);
  assert.equal(taken.owner, 0);
  assert.equal(taken.buildings.market, 0, 'the captured Market takes the colour of its new owner');
  assert.equal(unitById(g.s, horse.id).hex, spot);
});

test('a Ship carries 2 land units whatever they are, Cavalry included', () => {
  const g = fresh();
  const cap = capitalOf(g);
  const [sea] = plains(g, openLand(g, cap.hex, 1), 1);
  g.s.map.hexes[sea].terrain = 'sea';
  addUnit(g.s, 0, 'ship', sea);
  give(g, 0, { advances: ['tactics'] });
  const [c1, c2] = [addUnit(g.s, 0, 'cavalry', cap.hex), addUnit(g.s, 0, 'cavalry', cap.hex)];
  const i1 = addUnit(g.s, 0, 'infantry', cap.hex);
  assert.match(refused(g, { type: 'move', units: [c1.id, c2.id, i1.id], to: sea }), /enough room/);
  act(g, { type: 'move', units: [c1.id, i1.id], to: sea });
  assert.deepEqual(unitsAt(g.s, sea).map((u) => u.type).sort(), ['cavalry', 'infantry', 'ship']);
});

test('moving Cavalry into a space is limited to 4 Army units there, Infantry included', () => {
  const g = fresh();
  const cap = capitalOf(g);
  const [spot] = plains(g, openLand(g, cap.hex, 1), 1);
  give(g, 0, { advances: ['tactics'] });
  for (let i = 0; i < 3; i++) addUnit(g.s, 0, 'infantry', spot);
  const [c1, c2] = [addUnit(g.s, 0, 'cavalry', cap.hex), addUnit(g.s, 0, 'cavalry', cap.hex)];
  assert.match(refused(g, { type: 'move', units: [c1.id, c2.id], to: spot }), /at most 4 Army/);
  act(g, { type: 'move', units: [c1.id], to: spot });
  assert.equal(armyAt(g.s, spot, 0).length, 4);
});

// ----------------------------------------------------------------------- battle
test('Clash: an Infantry icon adds +1 CV and a Cavalry icon +2 CV, each for at most as many Units of that kind as fight', () => {
  let capped = 0;
  let boosted = 0;
  for (let n = 0; n < 30; n++) {
    const g = fresh(`clash-${n}`);
    const cap = capitalOf(g);
    const [spot] = plains(g, openLand(g, cap.hex, 1), 1);
    const attackers = ['infantry', 'infantry', 'infantry', 'cavalry'].map((type) => addUnit(g.s, 0, type, cap.hex).id);
    for (const type of ['infantry', 'infantry', 'cavalry', 'cavalry']) addUnit(g.s, 1, type, spot);
    listen(g, 0);
    listen(g, 1);
    g._run(battle(g, landBattle(0, 1, spot, cap.hex, attackers)));
    const rounds = g.drainEvents().filter((e) => e.type === 'battle_round');
    assert.ok(rounds.length >= 1);
    const stand = { a: { infantry: 3, cavalry: 1 }, d: { infantry: 2, cavalry: 2 } };
    for (const e of rounds) {
      for (const side of ['a', 'd']) {
        const x = e[side];
        const { infantry, cavalry } = stand[side];
        const icons = (kind) => x.dice.filter((d) => d.icon === kind).length;
        assert.equal(x.dice.length, infantry + cavalry, 'one die per Army unit');
        assert.equal(x.bonus, Math.min(icons('infantry'), infantry));
        assert.equal(x.cavalry, 2 * Math.min(icons('cavalry'), cavalry));
        assert.equal(x.cv, x.dice.reduce((sum, d) => sum + d.v, 0) + x.bonus + x.cavalry + x.mod);
        assert.equal(x.hits, Math.floor(x.cv / 5));
        if (icons('infantry') > infantry || icons('cavalry') > cavalry) capped += 1;
        if (x.cavalry > 0) boosted += 1;
      }
      // Without a choice to make the Infantry falls first.
      for (const [side, foe] of [['a', 'd'], ['d', 'a']]) {
        assert.equal(e[side].lost, Math.min(e[foe].hits, stand[side].infantry + stand[side].cavalry));
        const foot = Math.min(e[side].lost, stand[side].infantry);
        stand[side].infantry -= foot;
        stand[side].cavalry -= e[side].lost - foot;
      }
    }
  }
  assert.ok(capped > 0, 'a case with more icons than Units was seen');
  assert.ok(boosted > 0, 'a Cavalry bonus was seen');
});

/** Player 0 attacks 4 Infantry with 2 Infantry and 2 Cavalry and answers the casualty question with `pick`; the first round is all that is played. */
function skirmish(seed, pick) {
  const g = fresh(seed);
  const cap = capitalOf(g);
  const [spot] = plains(g, openLand(g, cap.hex, 1), 1);
  const attackers = ['infantry', 'infantry', 'cavalry', 'cavalry'].map((type) => addUnit(g.s, 0, type, cap.hex).id);
  for (let i = 0; i < 4; i++) addUnit(g.s, 1, 'infantry', spot);
  const seen = { casualties: null, retreat: null, left: null };
  listen(g, 1);
  g.policy[0] = (_g, prompt) => {
    if (prompt.kind === 'casualties') {
      seen.casualties = prompt;
      return pick(prompt);
    }
    if (prompt.kind === 'retreat') {
      seen.retreat = prompt;
      seen.left = kinds(g, cap.hex);
      return 'yes';
    }
    return prompt.default;
  };
  g._run(battle(g, landBattle(0, 1, spot, cap.hex, attackers)));
  return seen;
}

test('the owner of a mixed Infantry and Cavalry stack chooses which Army units are lost; the default is Infantry first', () => {
  let asked = 0;
  let survivors = 0;
  for (let n = 0; n < 30; n++) {
    const seed = `casualties-${n}`;
    const byDefault = skirmish(seed, (p) => p.default);
    if (!byDefault.casualties) continue; // nobody, or everybody, was hit
    asked += 1;
    const prompt = byDefault.casualties;
    const hits = Number(/remove (\d+)/.exec(prompt.text)[1]);
    const fewest = Math.max(0, hits - 2);
    const most = Math.min(hits, 2);
    assert.deepEqual(prompt.options.map((o) => o.id), Array.from({ length: most - fewest + 1 }, (_, i) => String(fewest + i)));
    assert.equal(prompt.default, String(fewest), 'a Cavalry is only lost when the Infantry cannot take the hits');
    const byChoice = skirmish(seed, () => String(most));
    for (const [seen, horsesLost] of [[byDefault, fewest], [byChoice, most]]) {
      if (!seen.retreat) continue; // the other side was wiped out
      survivors += 1;
      assert.equal(seen.retreat.info.atkCav, 2 - horsesLost);
      const left = [...Array(2 - (hits - horsesLost)).fill('infantry'), ...Array(2 - horsesLost).fill('cavalry')].sort();
      assert.deepEqual(seen.left, left);
    }
  }
  assert.ok(asked >= 3, `the question was asked ${asked} times`);
  assert.ok(survivors >= 3, `${survivors} battles went on after the choice`);
});

test('Barbarians are never asked about casualties: they lose their Infantry before their Cavalry', () => {
  let checked = false;
  for (let n = 0; n < 400 && !checked; n++) {
    const g = fresh(`barbarian-losses-${n}`);
    const cap = capitalOf(g);
    const [spot] = plains(g, openLand(g, cap.hex, 1), 1);
    const attackers = Array.from({ length: 4 }, () => addUnit(g.s, 0, 'infantry', cap.hex).id);
    addUnit(g.s, BARBARIAN, 'infantry', spot);
    addUnit(g.s, BARBARIAN, 'cavalry', spot);
    let retreat = null;
    let left = null;
    g.policy[0] = (_g, prompt) => {
      if (prompt.kind !== 'retreat') return prompt.default;
      retreat = prompt;
      left = kinds(g, spot, BARBARIAN);
      return 'yes';
    };
    g._run(battle(g, landBattle(0, BARBARIAN, spot, cap.hex, attackers)));
    const first = g.drainEvents().find((e) => e.type === 'battle_round');
    if (first.a.hits !== 1) continue; // the Barbarians must lose exactly one of their two units in the first round
    assert.deepEqual(left, ['cavalry']);
    assert.equal(retreat.info.defCav, 1);
    assert.equal(g.pending, null, 'the Barbarians were not asked anything');
    checked = true;
  }
  assert.ok(checked, 'a first round with exactly one hit was found');
});

test('overloaded Ships leave Settlers behind first, then Infantry, then Cavalry; the owner may choose otherwise', () => {
  const setup = (types) => {
    const g = fresh();
    const [sea] = ringOf(openLand(g, capitalOf(g).hex, 2), 2);
    g.s.map.hexes[sea].terrain = 'sea';
    addUnit(g.s, 0, 'ship', sea); // one Ship carries 2
    for (const type of types) addUnit(g.s, 0, type, sea);
    return { g, sea, left: () => unitsAt(g.s, sea).map((u) => u.type).sort() };
  };

  let t = setup(['settler', 'infantry', 'cavalry']);
  assert.equal(trimCargo(t.g, t.sea).length, 1);
  assert.deepEqual(t.left(), ['cavalry', 'infantry', 'ship']);

  t = setup(['infantry', 'cavalry', 'cavalry']);
  trimCargo(t.g, t.sea);
  assert.deepEqual(t.left(), ['cavalry', 'cavalry', 'ship']);

  for (const [choice, expected] of [
    ['cavalry', ['infantry', 'settler', 'ship']],
    ['infantry', ['cavalry', 'settler', 'ship']],
    [undefined, ['cavalry', 'infantry', 'ship']],
  ]) {
    t = setup(['settler', 'infantry', 'cavalry']);
    const asked = listen(t.g, 0, choice ? { choice } : {});
    t.g._run(trimCargoChoice(t.g, t.sea));
    assert.deepEqual(asked[0].options.map((o) => o.id), ['settler', 'infantry', 'cavalry']);
    assert.deepEqual(t.left(), expected);
  }
});

// ------------------------------------------------------------------ Barbarians
/** A Barbarian city on a ring-3 Plains hex holds `infantry` Infantry; player 0 then draws a Barbarian spawn, picks that city to muster in and answers `horse`. `crowd` more Infantry stand far away, `elsewhere` Cavalry on another space. */
function muster({ infantry, horse = 'yes', elsewhere = 0, crowd = 0 }) {
  const g = fresh();
  const cap = capitalOf(g);
  const land = openLand(g, cap.hex, 5);
  const [spot, other] = plains(g, land, 3);
  const away = [...plains(g, land, 4), ...plains(g, land, 5)];
  assert.ok(away.length * 4 >= crowd, 'room to stand the crowd in stacks of 4');
  const base = addCity(g.s, BARBARIAN, spot);
  for (let i = 0; i < infantry; i++) addUnit(g.s, BARBARIAN, 'infantry', base.hex);
  for (let i = 0; i < crowd; i++) addUnit(g.s, BARBARIAN, 'infantry', away[Math.floor(i / 4)]);
  for (let i = 0; i < elsewhere; i++) addUnit(g.s, BARBARIAN, 'cavalry', other);
  const asked = listen(g, 0, {
    pick_hex: (p) => (p.title === 'Barbarians muster' ? spot : p.default),
    barbarian_cavalry: horse,
  });
  g._run(barbarianSpawn(g, 0));
  const newcomer = barbarianCities(g.s).find((c) => c.hex !== spot); // undefined when no Settlement could be placed
  return { g, spot, newcomer, at: (hex) => kinds(g, hex, BARBARIAN), cavalryAsked: asked.filter((p) => p.kind === 'barbarian_cavalry').length };
}

test('a Barbarian muster may put a Cavalry in place of the Infantry, but only in a city that already has an Infantry', () => {
  let r = muster({ infantry: 1, horse: 'yes' });
  assert.deepEqual(r.at(r.spot), ['cavalry', 'infantry']);
  assert.equal(r.cavalryAsked, 1);

  r = muster({ infantry: 1, horse: 'no' });
  assert.deepEqual(r.at(r.spot), ['infantry', 'infantry']);

  r = muster({ infantry: 0, horse: 'yes' });
  assert.deepEqual(r.at(r.spot), ['infantry'], 'an empty city needs its Infantry first');
  assert.equal(r.cavalryAsked, 0);
});

test('the Barbarian muster skips a full city, and there are only 4 Barbarian Cavalry', () => {
  let r = muster({ infantry: 4, horse: 'yes' });
  assert.deepEqual(r.at(r.spot), ['infantry', 'infantry', 'infantry', 'infantry'], 'the full city was not offered');
  assert.ok(r.newcomer, 'the spawn placed a new Barbarian city');
  assert.deepEqual(r.at(r.newcomer.hex), ['cavalry', 'infantry'], 'the new settlement took the Cavalry');

  r = muster({ infantry: 1, horse: 'yes', elsewhere: 4 });
  assert.equal(unitsLeft(r.g.s, BARBARIAN, 'cavalry'), 0);
  assert.equal(r.cavalryAsked, 0, 'no Cavalry is left to place');
  assert.deepEqual(r.at(r.spot), ['infantry', 'infantry']);
});

test('with every Barbarian Infantry already on the board, a Cavalry can still join a city that has an Infantry', () => {
  let r = muster({ infantry: 1, crowd: 19, horse: 'yes' });
  assert.equal(unitsLeft(r.g.s, BARBARIAN, 'infantry'), 0);
  assert.equal(r.cavalryAsked, 1);
  assert.deepEqual(r.at(r.spot), ['cavalry', 'infantry']);
  assert.equal(r.newcomer, undefined, 'a new Settlement needs an Infantry and there is none left');

  r = muster({ infantry: 1, crowd: 19, horse: 'no' });
  assert.deepEqual(r.at(r.spot), ['infantry'], 'declining places nothing when there is no Infantry left');
});

test('after the Barbarians move, each of their cities near the player may get a Cavalry in place of an Infantry', () => {
  for (const horse of [true, false]) {
    let checked = false;
    for (let n = 0; n < 40 && !checked; n++) {
      const g = fresh(`barbarian-horse-${n}`);
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
        pick_cities: horse ? [base.id] : [],
      });
      g._run(barbarianMove(g, 0));
      if (cityAt(g.s, cap.hex).owner !== 0) continue; // the dice favoured the Barbarians: try the next seed
      const prompt = asked.find((p) => p.kind === 'pick_cities');
      assert.deepEqual(prompt.options.map((o) => o.id), [base.id]);
      assert.equal(prompt.multi.min, 0, 'the player may choose none');
      assert.deepEqual(kinds(g, far, BARBARIAN), horse ? ['cavalry', 'infantry', 'infantry', 'infantry'] : ['infantry', 'infantry', 'infantry', 'infantry']);
      checked = true;
    }
    assert.ok(checked, `a Barbarian move with the capital held was found (Cavalry: ${horse})`);
  }
});

// ------------------------------------------------------------ trade and Markets
/** In round 2 player 0 trades with `markets` Market cities and `bare` cities without one, all of player 1 and next to the capital. */
function tradeTurn({ markets = 0, bare = 0, settlers = 1, answers = {} }) {
  const g = fresh();
  const cap = capitalOf(g);
  const spots = plains(g, openLand(g, cap.hex, 1), 1);
  give(g, 0, { advances: ['trade_routes'], res: { food: 0 } });
  give(g, 1, { res: { gold: 0 } });
  for (let i = 0; i < markets + bare; i++) {
    const city = addCityAt(g, 1, spots[i]);
    if (i < markets) city.buildings.market = 1;
  }
  for (let i = 1; i < settlers; i++) addUnit(g.s, 0, 'settler', cap.hex);
  const asked = listen(g, 0, answers);
  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  const trade = g.drainEvents().find((e) => e.type === 'trade');
  return { g, asked, trade, food: me(g).res.food, gold: g.s.players[1].res.gold };
}

test('an opponent who trades with your Market pays you 1 Gold, and may decline to use that route', () => {
  let t = tradeTurn({ markets: 1 });
  assert.deepEqual([t.food, t.gold], [1, 1]);
  assert.deepEqual(t.trade.marketGold, [1]);
  assert.equal(t.asked.filter((p) => p.kind === 'trade_market').length, 1);

  t = tradeTurn({ markets: 1, answers: { trade_market: 'no' } });
  assert.deepEqual([t.food, t.gold], [0, 0], 'declining the Market route gives nobody anything');
  assert.equal(t.trade, undefined);
});

test('a Market owner gets at most 1 Gold per trading opponent, however many routes end in Markets', () => {
  const t = tradeTurn({ markets: 2, settlers: 2 });
  assert.deepEqual([t.food, t.gold], [2, 1]);
  assert.deepEqual(t.trade.marketGold, [1]);
});

test('trade routes without a Market come first, so nobody is paid when another city can be used', () => {
  const g = fresh();
  const cap = capitalOf(g);
  const [a, b] = plains(g, openLand(g, cap.hex, 1), 1);
  give(g, 0, { advances: ['trade_routes'] });
  addCityAt(g, 1, a).buildings.market = 1;
  const bare = addCityAt(g, 1, b);
  assert.deepEqual(tradeRoutes(g.s, 0).map((r) => r.city), [bare.id]);
});

// ----------------------------------------------------------- events and objectives
test('Civil War makes Cavalry desert an Angry city like any other Army unit; calm cities keep theirs', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.mood = 'angry';
  const calm = addCityAt(g, 0, plains(g, openLand(g, cap.hex, 3), 3)[0]);
  addUnit(g.s, 0, 'infantry', cap.hex);
  addUnit(g.s, 0, 'cavalry', cap.hex);
  addUnit(g.s, 0, 'cavalry', calm.hex);
  g.s.decks.event.push('civil_war');
  listen(g, 0);
  g._run(resolveEvent(g, 0));
  assert.deepEqual(armyAt(g.s, cap.hex, 0), []);
  assert.deepEqual(kinds(g, calm.hex), ['cavalry']);
  assert.equal(unitsOf(g.s, 0, 'settler').length, 1, 'Settlers do not desert');
});

test('Epidemic takes an Infantry and a Settler, never a Cavalry', () => {
  const g = fresh();
  const cap = capitalOf(g);
  addUnit(g.s, 0, 'cavalry', cap.hex); // first in line, so it would be the victim if Cavalry could be
  addUnit(g.s, 0, 'infantry', cap.hex);
  g.s.decks.event.push('epidemic');
  listen(g, 0);
  g._run(resolveEvent(g, 0));
  assert.deepEqual(unitsOf(g.s, 0).map((u) => u.type), ['cavalry']);
});

test('Cavalry count as Army units for the Large Army objective', () => {
  const g = fresh();
  const cap = capitalOf(g);
  for (let i = 0; i < 3; i++) addUnit(g.s, 0, 'infantry', cap.hex);
  assert.equal(checkStatus(g.s, 0, 'large_army').ok, false);
  addUnit(g.s, 0, 'cavalry', cap.hex);
  assert.equal(checkStatus(g.s, 0, 'large_army').ok, true);
});

// ----------------------------------------------------- candidate actions and saves
test('the action list offers a Market once Bartering is known and Cavalry once a city has one', () => {
  const g = fresh();
  const cap = capitalOf(g);
  const offers = (cat, wanted) => enumerateActions(g, 0).filter((a) => a.cat === cat && wanted(a));
  const market = (a) => a.building === 'market' && a.city === cap.id;
  const horse = (a) => a.action.units.cavalry > 0;
  give(g, 0, { res: { food: 1, wood: 1, ore: 1 } });
  assert.equal(offers('construct', market).length, 0, 'no Bartering yet');
  assert.equal(offers('recruit', horse).length, 0, 'no Market yet');

  give(g, 0, { advances: ['bartering'] });
  addCityAt(g, 0, neighbourWith(g, cap.hex, 'forest'));
  assert.equal(offers('construct', market).length, 1);

  capitalOf(g).buildings.market = 0;
  assert.equal(offers('construct', market).length, 0, 'the city has its Market');
  assert.ok(offers('recruit', horse).length > 0);
});

test('a saved game keeps its Markets and Cavalry, and the loaded game plays on', () => {
  const g = fresh();
  const cap = capitalOf(g);
  cap.buildings.market = 0;
  addUnit(g.s, 0, 'cavalry', cap.hex);
  const copy = Game.fromJSON(g.toJSON());
  copy.policy = copy.s.players.map(() => (_g, prompt) => prompt.default);
  assert.equal(capitalOf(copy).buildings.market, 0);
  assert.equal(unitsOf(copy.s, 0, 'cavalry').length, 1);
  give(copy, 0, { res: { food: 1, wood: 1 } });
  act(copy, { type: 'recruit', city: capitalOf(copy).id, units: { cavalry: 1 } });
  assert.equal(unitsOf(copy.s, 0, 'cavalry').length, 2);
});

// -------------------------------------------------------------------------- AI
test('the AI\'s battle odds count Cavalry: their icons are worth 2 CV each, up to the number of Cavalry', () => {
  const real = Math.random;
  Math.random = () => 0.2; // every die shows the second face: 2 pips and a Cavalry icon
  try {
    // Four Cavalry roll 4 x 2 + 4 x 2 = 16 CV (3 hits) against 8 CV (1 hit): the defence is gone in round 2.
    assert.equal(battleOdds(4, 4, { horseA: 4, bonusA: 0.5 }).win, 1);
    // The same Infantry get nothing from the icons: 8 CV a round on both sides is a stalemate of 2 against 2.
    assert.equal(battleOdds(4, 4, { bonusA: 0.5 }).win, 0);
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

test('computers that start with Bartering, Tactics, a Market and Cavalry play legal games to the end', () => {
  const real = Math.random;
  try {
    for (const seed of [31, 32]) {
      Math.random = seededRandom(seed); // the computer is random: a fixed seed keeps a failure reproducible
      const { g, problems } = playAIGame(seed, {
        prepare: (game) => {
          for (const { idx } of game.s.players) {
            give(game, idx, { advances: ['bartering', 'tactics'] });
            const home = capitalOf(game, idx);
            home.buildings.market = idx;
            for (let i = 0; i < 2; i++) addUnit(game.s, idx, 'cavalry', home.hex);
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
