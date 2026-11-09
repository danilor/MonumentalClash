// Regressions from the rules-fidelity pass: every test pins one rule that was checked against the printed rulebook or board.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADVANCES } from '../src/engine/data/advances.js';
import { BARBARIAN } from '../src/engine/data/constants.js';
import { addCity, addUnit } from '../src/engine/state.js';
import { advanceCost } from '../src/engine/advance.js';
import { barbarianMove } from '../src/engine/barbarians.js';
import { battle, trimCargoChoice } from '../src/engine/combat.js';
import { influenceTypes } from '../src/engine/city.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { armyAt, bfs, cityAt, citySizeCap, hasAdv, owns, resLimit, unitsAt } from '../src/engine/queries.js';
import { act, addCityAt, capitalOf, fresh, give, neighbourWith, refused } from './scenario.mjs';

const me = (g) => g.s.players[0]; // refused actions restore the state, so objects are re-read each time

/** Turn the unexplored hexes around `hex` into Plains so a scenario can put units and cities there. Returns { k, d } pairs. */
function openLand(g, hex, depth) {
  const ring = bfs(g.s, hex, depth, () => true);
  for (const k of ring.keys()) if (g.s.map.hexes[k].terrain === null) g.s.map.hexes[k].terrain = 'plains';
  return [...ring].map(([k, d]) => ({ k, d }));
}
const ringOf = (list, d) => list.filter((x) => x.d === d).map((x) => x.k);

/** Answer prompts with `answers[kind]` when given (a function of the prompt or a fixed value); record every prompt. */
function listen(g, p, answers = {}) {
  const asked = [];
  g.policy[p] = (_g, prompt) => {
    asked.push(prompt);
    const a = answers[prompt.kind];
    return typeof a === 'function' ? a(prompt) : a !== undefined ? a : prompt.default;
  };
  return asked;
}

test('the Seafaring row follows the board: Fishing gives Mood, Navigation Culture, Warships and Cartography nothing', () => {
  assert.deepEqual(['fishing', 'navigation', 'warships', 'cartography'].map((id) => ADVANCES[id].bonus), ['mood', 'culture', null, null]);
  const g = fresh();
  give(g, 0, { res: { food: 2 }, advances: ['fishing'] });
  act(g, { type: 'advance', advance: 'cartography' });
  assert.deepEqual([me(g).mood, me(g).culture], [0, 0]);
});

test('Change Government costs 1 Culture token and 1 Mood token, and only happens when both can be paid', () => {
  for (const [culture, mood, changes] of [[2, 2, true], [2, 0, false], [0, 2, false]]) {
    const g = fresh();
    give(g, 0, { advances: ['philosophy', 'voting', 'draft'], culture, mood });
    me(g).government = 'democracy';
    const asked = listen(g, 0, {
      free_advance: 'engineering', // no token comes with it, so the comparison below stays exact
      government: () => 'autocracy',
    });
    for (let i = 0; i < 6; i++) act(g, { type: 'end_turn' }); // three rounds, then the Status Phase
    assert.equal(asked.filter((p) => p.kind === 'government').length, changes ? 1 : 0);
    assert.equal(me(g).government, changes ? 'autocracy' : 'democracy');
    assert.deepEqual([me(g).culture, me(g).mood], changes ? [culture - 1, mood - 1] : [culture, mood]);
  }
});

test('a Port city may collect Gold or a Mood token from the Sea instead of Food', () => {
  for (const [res, read] of [['gold', (pl) => pl.res.gold], ['mood', (pl) => pl.mood]]) {
    const g = fresh();
    give(g, 0, { advances: ['fishing'] });
    const sea = neighbourWith(g, capitalOf(g).hex, 'forest');
    g.s.map.hexes[sea].terrain = 'sea';
    const take = (what) => ({ type: 'collect', city: capitalOf(g).id, picks: [{ hex: sea, res: what }] });
    assert.match(refused(g, take(res)), /does not give/, 'Fishing alone only gives Food');
    capitalOf(g).buildings.port = 0;
    capitalOf(g).port = sea;
    act(g, take(res));
    assert.equal(read(me(g)), 1);
  }
});

test('Great Mausoleum: its owner may take the top Action discard instead of drawing from the deck', () => {
  for (const [owner, take] of [[true, true], [true, false], [false, true]]) {
    const g = fresh();
    if (owner) capitalOf(g).wonders.push({ id: 'great_mausoleum', builder: 0 });
    g.s.decks.actionDiscard.push('harvest', 'timber');
    const deckTop = g.s.decks.action[g.s.decks.action.length - 1];
    const asked = listen(g, 0, { mausoleum: take ? 'yes' : 'no' });
    me(g).res.food = 2;
    act(g, { type: 'advance', advance: 'writing' });
    const drawn = me(g).hand.action[me(g).hand.action.length - 1];
    assert.equal(asked.filter((p) => p.kind === 'mausoleum').length, owner ? 1 : 0, 'only the owner is asked');
    if (owner && take) {
      assert.equal(drawn, 'timber');
      assert.deepEqual(g.s.decks.actionDiscard, ['harvest']);
      assert.equal(g.s.decks.action[g.s.decks.action.length - 1], deckTop, 'the deck is untouched');
    } else {
      assert.equal(drawn, deckTop);
      assert.deepEqual(g.s.decks.actionDiscard, ['harvest', 'timber']);
    }
  }
});

test('Great Library: one Advance is lent for the turn; its Food limit and discounts end with the turn', () => {
  const g = fresh();
  capitalOf(g).wonders.push({ id: 'great_library', builder: 0 });
  assert.equal(resLimit(g.s, 0, 'food'), 2);
  act(g, { type: 'great_library', advance: 'storage' });
  assert.equal(g.s.turn.actionsLeft, 3, 'borrowing is free');
  assert.ok(hasAdv(g.s, 0, 'storage') && !owns(g.s, 0, 'storage'));
  assert.equal(resLimit(g.s, 0, 'food'), 7);
  assert.match(refused(g, { type: 'great_library', advance: 'math' }), /once/i);
  act(g, { type: 'collect', city: capitalOf(g).id, picks: [{ hex: capitalOf(g).hex, res: 'food' }] });
  assert.equal(me(g).res.food, 3);
  act(g, { type: 'end_turn' });
  assert.equal(me(g).res.food, 2, 'the borrowed Storage is gone, so the extra Food is lost');
  assert.equal(resLimit(g.s, 0, 'food'), 2);
  assert.ok(!me(g).advances.includes('storage'));
});

test('a borrowed Advance also gives its research discount (Math makes Roads free)', () => {
  const g = fresh();
  capitalOf(g).wonders.push({ id: 'great_library', builder: 0 });
  me(g).res.food = 0;
  assert.deepEqual(advanceCost(g.s, 0, 'roads').cost, { food: 2 });
  act(g, { type: 'great_library', advance: 'math' });
  assert.deepEqual(advanceCost(g.s, 0, 'roads').cost, {});
  act(g, { type: 'advance', advance: 'roads' });
  assert.ok(me(g).advances.includes('roads'));
});

test('Dogma is optional: a new Temple only brings a free Theocracy Advance when the player wants one', () => {
  for (const take of [true, false]) {
    const g = fresh();
    give(g, 0, { res: { food: 0, wood: 1, ore: 1 }, advances: ['myths', 'state_religion', 'dogma'] });
    me(g).government = 'theocracy';
    const cap = capitalOf(g);
    addCityAt(g, 0, neighbourWith(g, cap.hex, 'forest'));
    const asked = listen(g, 0, { dogma: take ? 'yes' : 'no', free_advance: 'devotion' });
    act(g, { type: 'construct', city: cap.id, building: 'temple' });
    assert.deepEqual(asked.map((p) => p.kind), take ? ['dogma', 'free_advance'] : ['dogma']);
    assert.equal(me(g).advances.includes('devotion'), take);
    assert.equal(me(g).cubes, take ? 2 : 3, 'declining leaves the Event tracker alone');
  }
});

test('State Religion makes only the first Temple of a turn free of Food', () => {
  const g = fresh();
  give(g, 0, { res: { food: 0, wood: 2, ore: 2 }, advances: ['myths', 'state_religion'] });
  const cap = capitalOf(g);
  const second = addCityAt(g, 0, neighbourWith(g, cap.hex, 'forest'));
  const temples = () => [...new Set(enumerateActions(g, 0).filter((o) => o.cat === 'construct' && o.building === 'temple').map((o) => o.city))];
  assert.deepEqual(temples().sort(), [cap.id, second.id].sort());
  act(g, { type: 'construct', city: cap.id, building: 'temple', templeBonus: 'mood' });
  assert.equal(me(g).res.food, 0);
  assert.deepEqual(temples(), [], 'the second Temple of the turn costs Food again, and there is none');
  assert.match(refused(g, { type: 'construct', city: second.id, building: 'temple' }), /1 Food, 1 Wood and 1 Ore/);
});

test('Monuments shield a Wonder city from enemy Influence, yet its owner may still clear enemy buildings there', () => {
  const g = fresh();
  const cap = capitalOf(g);
  g.s.decks.wonder = g.s.decks.wonder.filter((w) => w !== 'great_wall');
  cap.wonders.push({ id: 'great_wall', builder: 0 });
  Object.assign(cap.buildings, { temple: 0, academy: 1 });
  assert.deepEqual(influenceTypes(g.s, 1, cap), ['temple'], 'without Monuments the rival can flip the Temple');
  give(g, 0, { advances: ['monuments'] });
  assert.deepEqual(influenceTypes(g.s, 1, cap), []);
  assert.deepEqual(influenceTypes(g.s, 0, cap), ['academy'], 'the owner can still take back the rival Academy');
});

test('a city never grows past size 5, nor past the number of cities its owner holds', () => {
  const g = fresh();
  const cap = capitalOf(g);
  give(g, 0, { res: { food: 3, wood: 3, ore: 3 }, advances: ['fishing', 'engineering', 'siegecraft'], wonders: ['great_wall'] });
  Object.assign(cap.buildings, { academy: 0, fortress: 0, temple: 0 });
  const far = ringOf(openLand(g, cap.hex, 3), 3);
  far.slice(0, 2).forEach((k) => addCityAt(g, 0, k));
  assert.equal(citySizeCap(g.s, 0), 3, 'three cities: no city may exceed size 3');
  far.slice(2, 5).forEach((k) => addCityAt(g, 0, k));
  assert.equal(citySizeCap(g.s, 0), 5, 'six cities: the limit is the 5 of the board');

  const port = { type: 'construct', city: cap.id, building: 'port' };
  assert.match(refused(g, port), /Sea/, 'size 4 may still grow to 5: only the missing Sea blocks this Port');
  capitalOf(g).wonders.push({ id: 'great_library', builder: 0 });
  assert.match(refused(g, port), /size 5/);
  assert.match(refused(g, { type: 'construct_wonder', city: cap.id, wonder: 'great_wall' }), /size 5/);
});

test('Barbarian armies advance in the order the active player chooses', () => {
  for (const second of [false, true]) {
    const g = fresh();
    const cap = capitalOf(g);
    const [a, b] = ringOf(openLand(g, cap.hex, 2), 2).filter((_, i, all) => i === 0 || i === all.length - 1);
    for (const k of [a, b]) addUnit(g.s, BARBARIAN, 'infantry', k);
    const asked = listen(g, 0, { pick_hex: (p) => (/moves next/.test(p.text) ? (second ? b : a) : p.default) });
    g._run(barbarianMove(g, 0));
    assert.match(asked[0].text, /moves next/, 'the order is asked first');
    assert.deepEqual(asked[0].options.map((o) => o.id).sort(), [a, b].sort());
    const moved = g.drainEvents().filter((e) => e.type === 'barbarians' && e.kind === 'move').map((e) => e.from);
    assert.deepEqual(moved, second ? [b, a] : [a, b]);
  }
});

test('a Barbarian city is worth a flat 1 Gold whatever its size; beating Barbarian units adds 1 more', () => {
  for (const defenders of [0, 1]) {
    let checked = false;
    for (let n = 0; n < 40 && !checked; n++) {
      const g = fresh(`barbarian-city-${defenders}-${n}`);
      const cap = capitalOf(g);
      give(g, 0, { advances: ['tactics'] });
      const hex = neighbourWith(g, cap.hex, 'forest');
      const city = addCity(g.s, BARBARIAN, hex);
      Object.assign(city.buildings, { academy: 1, temple: 1 }); // size 3
      for (let i = 0; i < defenders; i++) addUnit(g.s, BARBARIAN, 'infantry', hex);
      const army = [1, 2, 3, 4].map(() => addUnit(g.s, 0, 'infantry', cap.hex).id);
      const gold = me(g).res.gold;
      act(g, { type: 'move', units: army, to: hex });
      if (cityAt(g.s, hex).owner !== 0) continue; // the dice favoured the Barbarians: try the next seed
      assert.equal(me(g).res.gold - gold, defenders ? 2 : 1);
      checked = true;
    }
    assert.ok(checked, `a won battle against ${defenders} defenders was found`);
  }
});

test('Fanaticism only places its free Infantry in a city that has room for it', () => {
  let checked = false;
  for (let n = 0; n < 40 && !checked; n++) {
    const g = fresh(`fanatics-${n}`);
    const cap = capitalOf(g);
    give(g, 0, { advances: ['myths', 'fanaticism'] });
    cap.buildings.temple = 0;
    const land = openLand(g, cap.hex, 2);
    const [from] = ringOf(land, 1);
    const [fullHex, openHex] = ringOf(land, 2);
    const full = addCityAt(g, 0, fullHex);
    const open = addCityAt(g, 0, openHex);
    for (let i = 0; i < 4; i++) addUnit(g.s, 0, 'infantry', full.hex);
    addUnit(g.s, 0, 'infantry', cap.hex);
    const raiders = [1, 2, 3, 4].map(() => addUnit(g.s, 1, 'infantry', from).id);
    listen(g, 0);
    g._run(battle(g, { domain: 'land', attacker: 1, defender: 0, hex: cap.hex, from, units: raiders, settlers: [], carried: [], landed: false, inPlace: false }));
    if (cityAt(g.s, cap.hex).owner !== 1) continue; // the defenders held: try the next seed
    assert.equal(armyAt(g.s, full.hex, 0).length, 4, 'a full city gets nothing');
    assert.equal(armyAt(g.s, open.hex, 0).length, 1, 'the free Infantry goes where there is room');
    checked = true;
  }
  assert.ok(checked, 'a lost battle was found');
});

test('after a naval battle the owner of overloaded Ships decides which land unit is left behind', () => {
  for (const leave of ['infantry', 'settler']) {
    const g = fresh();
    const [sea] = ringOf(openLand(g, capitalOf(g).hex, 2), 2);
    g.s.map.hexes[sea].terrain = 'sea';
    addUnit(g.s, 0, 'ship', sea);
    for (const type of ['settler', 'infantry', 'infantry']) addUnit(g.s, 0, type, sea); // one Ship carries 2
    listen(g, 0, { choice: leave });
    g._run(trimCargoChoice(g, sea));
    const left = unitsAt(g.s, sea).map((u) => u.type).sort();
    assert.deepEqual(left, leave === 'infantry' ? ['infantry', 'settler', 'ship'] : ['infantry', 'infantry', 'ship']);
  }
});

