// A table of 2, 3 or 4: setup and seating, turn order, the Status Phase, and the rules that look at every opponent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.js';
import { addCity, addUnit, upgradeState } from '../src/engine/state.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { trimCargo } from '../src/engine/combat.js';
import { checkStatus } from '../src/engine/objectives.js';
import { finalResult } from '../src/engine/scoring.js';
import { BARBARIAN, DEFAULT_OPPONENTS, MAX_OPPONENTS, MAX_PLAYERS, MIN_OPPONENTS } from '../src/engine/data/constants.js';
import { WONDER_IDS } from '../src/engine/data/wonders.js';
import {
  allHexKeys, allOwners, citiesOf, cityAt, foesOf, hexDistance, nbrs, nextSeat, normalizeOpponents, turnOrder,
} from '../src/engine/queries.js';
import { checkInvariants } from './harness.mjs';
import { act, addCityAt, capitalOf, fresh, give, neighbourWith } from './scenario.mjs';

const SIZES = [
  { opponents: 1, seats: 2, regions: 10 },
  { opponents: 2, seats: 3, regions: 15 },
  { opponents: 3, seats: 4, regions: 18 },
];
const seatsOf = (n) => [...Array(n).keys()];

/** Answer prompts with `answers[kind]` (a value, or a function of the prompt) or else their default; returns the prompts asked. */
function listen(g, answers = {}) {
  const asked = [];
  g.policy = g.s.players.map(() => (_g, prompt) => {
    asked.push(prompt);
    const a = answers[prompt.kind];
    return a === undefined ? prompt.default : typeof a === 'function' ? a(prompt) : a;
  });
  return asked;
}

/** End turns until the Age is over (its Status Phase has run) or the game has ended. */
function endAge(g) {
  const age = g.s.age;
  for (let n = 0; n < 60 && g.s.age === age && g.s.phase !== 'over'; n++) act(g, { type: 'end_turn' });
}

/** A finished Wonder in the capital of player p, taken out of the Wonder pile. */
function build(g, p, id) {
  g.s.decks.wonder = g.s.decks.wonder.filter((w) => w !== id);
  capitalOf(g, p).wonders.push({ id, builder: p });
  g.s.players[p].builtWonders.push(id);
}

/** An Action card moved from the draw pile into a hand. */
function hold(g, p, card) {
  const pile = g.s.decks.action;
  assert.ok(pile.includes(card), `${card} is in the draw pile`);
  pile.splice(pile.indexOf(card), 1);
  g.s.players[p].hand.action.push(card);
}

/** Plays by a fixed recipe so two copies of one position can be compared. */
function drive(g, from, steps) {
  for (let i = from; i < from + steps && g.s.phase !== 'over'; i++) {
    const list = enumerateActions(g, g.cur);
    const pick = list[(i * 7 + 3) % list.length];
    if (!g.apply(pick.action).ok) g.apply({ type: 'end_turn' });
  }
}

test('one to three computer opponents can be asked for; anything else is brought into that range', () => {
  assert.deepEqual([MIN_OPPONENTS, MAX_OPPONENTS, DEFAULT_OPPONENTS, MAX_PLAYERS], [1, 3, 1, 4]);
  const wanted = [
    [1, 1], [2, 2], [3, 3], // anything from 1 to 3 is accepted as it is
    [0, 1], [-2, 1], [4, 3], [99, 3], // too few or too many: the nearest allowed number
    [1.4, 1], [2.6, 3], // numbers with decimals
    ['2', 2], [' 3 ', 3], // numbers typed or stored as text
    [undefined, 1], [null, 1], ['', 1], ['many', 1], [NaN, 1], // nothing usable: the default
  ];
  for (const [asked, n] of wanted) {
    assert.equal(normalizeOpponents(asked), n, `asked for ${String(asked)}`);
    assert.equal(Game.create({ seed: 'size', opponents: asked }).s.players.length, n + 1, `a game for ${String(asked)}`);
  }
  assert.equal(Game.create({ seed: 'size' }).s.players.length, 2, 'without a choice it is one against one');
  assert.equal(Game.create({ seed: 'size', humans: [true, false, false] }).s.players.length, 3, 'the seats given set the table when no number is');
});

for (const { opponents, seats, regions } of SIZES) {
  test(`a table of ${seats}: ${regions} Regions, and a Happy city, a Settler and 2 Food for everyone`, () => {
    for (const seed of ['table-a', 'table-b', 'table-c']) {
      const g = fresh(seed, { opponents });
      const s = g.s;
      assert.deepEqual(s.players.map((p) => p.idx), seatsOf(seats));
      assert.deepEqual(allOwners(s), [...seatsOf(seats), BARBARIAN], 'the Barbarians are never one of the players');
      assert.deepEqual(foesOf(s, 0), seatsOf(seats).slice(1));
      assert.equal(nextSeat(s, seats - 1), 0, 'the table is a circle');
      assert.deepEqual(turnOrder(s), seatsOf(seats), 'the first player moves first');

      assert.equal(s.map.regions.length, regions);
      assert.equal(Object.keys(s.map.hexes).length, regions * 4, 'four hexes to a Region, and no hex in two Regions');
      assert.equal(s.map.regions.filter((r) => r.flipped !== null).length, seats, 'only the home Regions are face up');
      const keys = allHexKeys(s);
      const seen = new Set(keys.slice(0, 1));
      for (const k of seen) for (const n of nbrs(s, k)) seen.add(n);
      assert.equal(seen.size, keys.length, 'the Regions make one board without gaps');

      assert.equal(s.cities.length, seats);
      const homes = new Set();
      for (const pl of s.players) {
        const [city, ...more] = citiesOf(s, pl.idx);
        assert.equal(more.length, 0);
        assert.equal(city.mood, 'happy');
        const hex = s.map.hexes[city.hex];
        assert.equal(hex.terrain, 'plains');
        assert.equal(pl.homeHex, city.hex);
        assert.equal(s.map.regions[hex.region].home, pl.idx);
        homes.add(hex.region);
        assert.deepEqual(s.units.filter((u) => u.owner === pl.idx).map((u) => [u.type, u.hex]), [['settler', city.hex]]);
        assert.deepEqual(pl.res, { food: 2, wood: 0, ore: 0, ideas: 0, gold: 0 });
        assert.deepEqual(pl.advances, ['farming', 'mining']);
        assert.equal(pl.hand.action.length, 1);
        assert.equal(pl.hand.objective.length, 1);
      }
      assert.equal(homes.size, seats, 'nobody shares a home Region');
      for (const a of seatsOf(seats)) {
        for (const b of seatsOf(seats).slice(a + 1)) {
          assert.ok(hexDistance(s.players[a].homeHex, s.players[b].homeHex) >= 5, 'the capitals start far apart');
        }
      }
      assert.equal(s.decks.wonder.length, WONDER_IDS.length);
      assert.deepEqual(checkInvariants(g), []);
    }
  });
}

test('the player is the only human, called You; the computers are numbered once there are several', () => {
  assert.deepEqual(Game.create({ seed: 'names' }).s.players.map((p) => [p.name, p.human]), [['You', true], ['Computer', false]]);
  assert.deepEqual(
    Game.create({ seed: 'names', opponents: 3 }).s.players.map((p) => [p.name, p.human]),
    [['You', true], ['Computer 1', false], ['Computer 2', false], ['Computer 3', false]],
  );
  const named = Game.create({ seed: 'names', opponents: 2, names: ['Blue', 'Red', 'Yellow'] });
  assert.deepEqual(named.s.players.map((p) => p.name), ['Blue', 'Red', 'Yellow']);
  assert.equal(named.name(2), 'Yellow');
  assert.equal(named.name(BARBARIAN), 'The Barbarians');
});

test('the same seed always builds the same game at every table size', () => {
  for (const { opponents } of SIZES) {
    const a = Game.create({ seed: 'twin', opponents });
    assert.equal(a.toJSON(), Game.create({ seed: 'twin', opponents }).toJSON());
    assert.notEqual(a.toJSON(), Game.create({ seed: 'other', opponents }).toJSON());
  }
  assert.equal(Game.create({ seed: 'twin' }).toJSON(), Game.create({ seed: 'twin', opponents: 1 }).toJSON(), 'one opponent is the usual game');
  assert.notEqual(Game.create({ seed: 'twin', opponents: 2 }).toJSON(), Game.create({ seed: 'twin', opponents: 3 }).toJSON());
});

test('seats run clockwise on the board; around a bigger table the seating is random, with two it is fixed', () => {
  for (const { opponents, seats } of SIZES) {
    const sat = new Set();
    const started = new Set();
    for (let n = 0; n < 40; n++) {
      const g = Game.create({ seed: `seat-${n}`, opponents });
      const region = g.s.players.map((p) => g.s.map.hexes[p.homeHex].region);
      assert.ok(region.every((r, i) => r === (region[0] + i) % seats), `seed ${n}: neighbours at the table are neighbours on the board`);
      sat.add(region[0]);
      started.add(g.s.first);
      g.policy = g.s.players.map(() => (_g, prompt) => prompt.default);
      g.begin();
      assert.equal(g.cur, g.s.first, 'the first player begins');
    }
    assert.equal(sat.size, opponents === 1 ? 1 : seats, `the human sat in ${sat.size} places at a table of ${seats}`);
    assert.equal(started.size, seats, 'any seat can be the first player');
  }
});

for (const { opponents, seats } of SIZES.slice(1)) {
  test(`a table of ${seats}: play passes clockwise, every seat plays once a round, and the Status Phase follows the last seat`, () => {
    for (const first of [0, seats - 1]) {
      const ages = 4;
      const g = fresh('rounds', { ages, opponents, first });
      const timeline = [];
      const note = () => {
        for (const e of g.drainEvents()) {
          if (e.type === 'turn_start') timeline.push({ at: `${e.age}.${e.round}`, player: e.player });
          if (e.type === 'status_step') timeline.push({ at: `S${e.step}` });
        }
      };
      note();
      let turns = 0;
      for (; g.s.phase !== 'over' && turns < 300; turns++) {
        act(g, { type: 'end_turn' });
        note();
        assert.deepEqual(checkInvariants(g), []);
      }
      assert.equal(turns, ages * 3 * seats, `${ages} Ages x 3 rounds x ${seats} players`);

      const rounds = new Map();
      for (const x of timeline) if (x.player !== undefined) rounds.set(x.at, [...(rounds.get(x.at) || []), x.player]);
      assert.equal(rounds.size, ages * 3);
      for (const [at, order] of rounds) {
        assert.equal(order.length, seats, `round ${at}`);
        order.forEach((p, i) => assert.equal(p, (order[0] + i) % seats, `round ${at}: clockwise from the first player`));
      }
      assert.equal([...rounds.values()][0][0], first, 'the game opens with the first player');

      const age = Array(3 * seats).fill('T').join(' ');
      const expected = [...Array(ages - 1)].map(() => `${age} S1 S2 S3 S4 S5 S6`).concat(`${age} S1`).join(' ');
      assert.equal(timeline.map((x) => (x.player === undefined ? x.at : 'T')).join(' '), expected, 'a Status Phase after every third round, and the last one ends the game');
      assert.equal(g.s.final.scores.length, seats);
    }
  });
}

test('the Status Phase goes round from the first player, and the most Mood and Culture tokens name the next first player', () => {
  const g = fresh('first-player', { opponents: 3, first: 2 });
  g.s.players[1].culture = 5;
  const asked = listen(g);
  endAge(g);
  assert.equal(g.s.age, 2);
  assert.deepEqual(asked.filter((p) => p.kind === 'free_advance').map((p) => p.player), [2, 3, 0, 1], 'everyone acts in turn order, from the first player');
  const picks = asked.filter((p) => p.kind === 'first_player');
  assert.equal(picks.length, 1);
  assert.equal(picks[0].player, 1, 'the player with the most tokens chooses');
  assert.deepEqual(picks[0].options.map((o) => o.id), ['1', '2', '3', '0'], 'the chooser first, then the others in turn order');
  assert.equal(picks[0].default, '1');
  assert.deepEqual([g.s.first, g.cur], [1, 1], 'the usual answer is to go first');
  assert.deepEqual(turnOrder(g.s), [1, 2, 3, 0]);

  const other = fresh('first-player-answer', { opponents: 3, first: 0 });
  other.s.players[3].mood = 4;
  listen(other, { first_player: '2' });
  endAge(other);
  assert.deepEqual([other.s.first, other.cur], [2, 2], 'any seat can be named');
  assert.deepEqual(turnOrder(other.s), [2, 3, 0, 1]);
  assert.deepEqual(checkInvariants(other), []);
});

test('on a tie for the most tokens the tied player closest after the first player chooses; the Great Lighthouse overrides the tokens', () => {
  const tie = fresh('first-player-tie', { opponents: 3, first: 2 });
  tie.s.players[1].culture = 3;
  tie.s.players[3].mood = 3;
  const tied = listen(tie);
  endAge(tie);
  assert.equal(tied.find((p) => p.kind === 'first_player').player, 3, 'turn order from the first player is 2, 3, 0, 1');

  const level = fresh('first-player-level', { opponents: 2, first: 1 });
  const flat = listen(level);
  endAge(level);
  assert.equal(flat.find((p) => p.kind === 'first_player').player, 1, 'with no tokens at all the first player stays in charge');

  const lighthouse = fresh('first-player-lighthouse', { opponents: 3, first: 0 });
  build(lighthouse, 0, 'great_lighthouse');
  lighthouse.s.players[2].culture = 6;
  const owner = listen(lighthouse);
  endAge(lighthouse);
  const pick = owner.find((p) => p.kind === 'first_player');
  assert.equal(pick.player, 0, 'its owner chooses although somebody else has more tokens');
  assert.deepEqual(pick.options.map((o) => o.id), ['0', '1', '2', '3']);
  assert.deepEqual(checkInvariants(lighthouse), []);
});

test('Espionage asks which opponent to spy on, and only offers those who have something to take', () => {
  const g = fresh('spies', { opponents: 3 });
  const s = g.s;
  g.policy[0] = null; // player 0 answers by hand
  hold(g, 0, 'spies');
  Object.assign(s.players[1].res, { food: 0, ore: 3 });
  Object.assign(s.players[2].res, { food: 0, gold: 1 });
  // Player 3 keeps its 2 Food, but player 0 is at the Food limit and cannot hold more.
  const r = g.apply({ type: 'play_card', card: 'spies' });
  assert.ok(r.ok, r.error);
  assert.equal(r.pending.player, 0);
  assert.deepEqual(r.pending.options.map((o) => o.id), ['1', '2'], 'the one with most to take first; nobody else is offered');
  assert.equal(r.pending.default, '1');
  assert.ok(g.respond('2').ok);
  assert.equal(g.pending, null, 'a single resource is taken without asking');
  assert.deepEqual([s.players[2].res.gold, s.players[0].res.gold], [0, 1]);
  assert.deepEqual([s.players[1].res.ore, s.players[0].res.ore], [3, 0], 'the others are untouched');
  assert.deepEqual(checkInvariants(g), []);

  const named = fresh('spies', { opponents: 3 });
  named.policy[0] = null;
  hold(named, 0, 'spies');
  Object.assign(named.s.players[1].res, { food: 0, ore: 3 });
  Object.assign(named.s.players[2].res, { food: 0, gold: 1 });
  const direct = named.apply({ type: 'play_card', card: 'spies', player: 1, resource: 'ore' });
  assert.ok(direct.ok && !direct.pending, 'a named opponent needs no question');
  assert.deepEqual([named.s.players[1].res.ore, named.s.players[0].res.ore], [2, 1]);

  const duel = fresh('spies', { opponents: 1 });
  duel.policy[0] = null;
  hold(duel, 0, 'spies');
  Object.assign(duel.s.players[1].res, { food: 0, ore: 2 });
  const single = duel.apply({ type: 'play_card', card: 'spies' });
  assert.ok(single.ok && !single.pending, 'with one opponent there is nobody to choose');
  assert.deepEqual([duel.s.players[1].res.ore, duel.s.players[0].res.ore], [1, 1]);

  const broke = fresh('spies', { opponents: 3 });
  hold(broke, 0, 'spies');
  broke.s.players.slice(1).forEach((pl) => Object.assign(pl.res, { food: 0 }));
  const refused = broke.apply({ type: 'play_card', card: 'spies' });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /No opponent has anything/);
});

test('Objectives that compare players need a lead over every opponent, and others count any opponent', () => {
  const g = fresh('objectives', { opponents: 3 });
  const s = g.s;
  let n = 0;
  const academy = (p) => {
    addCityAt(g, p, `${40 + n++},0`).buildings.academy = p;
  };
  const science = () => checkStatus(s, 0, 'science_lead').ok;
  [0, 0, 1, 2, 2].forEach(academy); // 2 against 1, 2 and 0
  assert.equal(science(), false, 'level with the third player is not a lead');
  academy(0);
  assert.equal(science(), true, '3 against 1, 2 and 0');
  academy(3);
  academy(3);
  academy(3);
  assert.equal(science(), false, 'the fourth player has caught up');

  const army = (p, count) => {
    for (let i = 0; i < count; i++) addUnit(s, p, 'infantry', `${60 + n++},0`);
  };
  const large = () => checkStatus(s, 0, 'large_army').ok;
  army(0, 6);
  army(1, 2);
  army(2, 1);
  army(3, 3);
  assert.equal(large(), false, 'a lead of 4 over two of them is not enough');
  army(0, 1);
  assert.equal(large(), true, 'a lead of 4 over all three is');

  const consulate = () => checkStatus(s, 0, 'consulate').ok;
  capitalOf(g, 1).buildings.temple = 0;
  assert.equal(consulate(), false, 'one city with your Building');
  capitalOf(g, 2).buildings.temple = 0;
  assert.equal(consulate(), true, 'two cities, belonging to different opponents');
});

test('Units that no longer fit on the Ships of any player are lost, the Barbarians included', () => {
  const g = fresh('cargo', { opponents: 3 });
  const s = g.s;
  const sea = allHexKeys(s).find((k) => s.map.hexes[k].terrain === null);
  s.map.hexes[sea].terrain = 'sea';
  for (const owner of allOwners(s)) {
    addUnit(s, owner, 'ship', sea);
    for (let i = 0; i < 3; i++) addUnit(s, owner, 'infantry', sea);
  }
  assert.equal(trimCargo(g, sea).length, 5, 'one unit too many for each of the five owners');
  for (const owner of allOwners(s)) {
    assert.equal(s.units.filter((u) => u.hex === sea && u.owner === owner && u.type !== 'ship').length, 2, `owner ${owner}`);
  }
  assert.equal(s.log.filter((l) => /no longer fit on a Ship/.test(l)).length, 5);
});

test('a city can be taken from any player at the table, and its loser places a Settler', () => {
  const g = fresh('capture', { opponents: 2 });
  const s = g.s;
  give(g, 0, { advances: ['tactics'] });
  const hex = neighbourWith(g, capitalOf(g).hex, 'forest');
  addCity(s, 2, hex);
  const army = addUnit(s, 0, 'infantry', capitalOf(g).hex).id;
  const settlers = (p) => s.units.filter((u) => u.owner === p && u.type === 'settler').length;
  const before = [settlers(1), settlers(2)];
  act(g, { type: 'move', units: [army], to: hex });
  assert.equal(cityAt(s, hex).owner, 0);
  assert.equal(cityAt(s, hex).mood, 'angry');
  const taken = g.drainEvents().find((e) => e.type === 'capture');
  assert.deepEqual([taken.by, taken.from], [0, 2]);
  assert.ok(s.log.includes("You captures Computer 2's city."));
  assert.equal(settlers(2), before[1] + 1, 'the loser is given a Settler in a city it still has');
  assert.equal(settlers(1), before[0], 'the third player is not involved');
  assert.deepEqual(citiesOf(s, 1).length, 1);
  assert.equal(s.phase, 'main', 'the game goes on while everyone has a city');
  assert.deepEqual(checkInvariants(g), []);
});

test('the game ends at the next Status Phase when any player is left without a city, however many remain', () => {
  const g = fresh('last-city', { opponents: 3 });
  const s = g.s;
  s.cities = s.cities.filter((c) => c.owner !== 3);
  s.units = s.units.filter((u) => u.owner !== 3);
  endAge(g);
  assert.equal(s.phase, 'over');
  assert.equal(s.age, 1, 'the first Status Phase was the last');
  assert.equal(s.final.scores.length, 4);
  assert.deepEqual(s.final, finalResult(s));
  assert.equal(s.winner, s.final.winner);
  assert.deepEqual([s.final.scores[3].settlements, s.final.scores[3].parts.core], [0, 0], 'nothing is left of the fourth player');
  assert.equal(g.apply({ type: 'end_turn' }).error, 'The game is over.');
});

/** What a version-1 save of this game looked like: no version number, and the Barbarians were number 2. */
function asVersion1(g) {
  const old = JSON.parse(g.toJSON());
  delete old.version;
  const was = (o) => (o === BARBARIAN ? 2 : o);
  for (const c of old.cities) {
    c.owner = was(c.owner);
    for (const type of Object.keys(c.buildings)) c.buildings[type] = was(c.buildings[type]);
  }
  for (const u of old.units) u.owner = was(u.owner);
  return JSON.stringify(old);
}

test('a game saved when only two players could sit down loads with the Barbarians under their new number', () => {
  const g = fresh('v1-save');
  const s = g.s;
  const hex = neighbourWith(g, capitalOf(g).hex, 'forest');
  const camp = addCity(s, BARBARIAN, hex);
  camp.buildings.temple = BARBARIAN;
  camp.buildings.academy = 1; // influenced by the other player
  build(g, 0, 'great_wall');
  camp.wonders.push(capitalOf(g, 0).wonders.pop()); // a Wonder the Barbarians took from player 0
  addUnit(s, BARBARIAN, 'infantry', hex);
  assert.deepEqual(checkInvariants(g), []);

  const old = asVersion1(g);
  assert.equal(JSON.parse(old).version, undefined);
  assert.equal(JSON.parse(old).cities.find((c) => c.hex === hex).owner, 2, 'this is how the old save numbers them');
  const loaded = Game.fromJSON(old);
  assert.equal(loaded.s.version, 2);
  assert.deepEqual(JSON.parse(loaded.toJSON()), JSON.parse(g.toJSON()), 'nothing but the number changed');
  assert.equal(cityAt(loaded.s, hex).owner, BARBARIAN);
  assert.deepEqual(cityAt(loaded.s, hex).buildings, { temple: BARBARIAN, academy: 1 });
  assert.deepEqual(loaded.s.units.filter((u) => u.owner === BARBARIAN).map((u) => u.hex), [hex]);

  loaded.policy = g.policy;
  for (let i = 0; i < 8; i++) act(loaded, { type: 'end_turn' });
  assert.deepEqual(checkInvariants(loaded), []);
});

test('a save in the current format keeps a third player numbered 2', () => {
  const g = fresh('v2-save', { opponents: 2 });
  addCityAt(g, 2, neighbourWith(g, capitalOf(g, 2).hex, 'forest')).buildings.temple = 2;
  addUnit(g.s, 2, 'infantry', capitalOf(g, 2).hex);
  const loaded = Game.fromJSON(g.toJSON());
  assert.deepEqual(JSON.parse(loaded.toJSON()), JSON.parse(g.toJSON()));
  assert.equal(citiesOf(loaded.s, 2).length, 2);
  assert.equal(upgradeState(g.s), g.s, 'bringing a current state up to date changes nothing');
});

/** An empty board for `opponents` + 1 players where only what a test adds counts. */
function blank(opponents) {
  const g = fresh('table-score', { opponents });
  g.s.cities = [];
  g.s.units = [];
  for (const pl of g.s.players) {
    pl.advances = [];
    pl.completed = [];
    pl.vpBonus = 0;
  }
  return g;
}

let hexN = 0;
const city = (g, p) => addCityAt(g, p, `${20 + hexN++},0`);
const advances = (g, p, n) => {
  g.s.players[p].advances = Array.from({ length: n }, (_, i) => `a${i}`);
};
const objectives = (g, p, n) => {
  g.s.players[p].completed = Array.from({ length: n }, (_, i) => ({ card: `o${i}`, side: 0, id: `o${i}` }));
};

test('final scores: one for every player, the most points win, and a tie is shared among those who tie', () => {
  let g = blank(3);
  [0, 1, 1, 2, 3].forEach((p) => city(g, p));
  let res = finalResult(g.s);
  assert.deepEqual(res.scores.map((x) => x.total), [1, 2, 1, 1]);
  assert.equal(res.winner, 1);
  assert.deepEqual(res.winners, [1]);

  g = blank(3);
  [0, 0, 1, 1, 2, 3, 3].forEach((p) => city(g, p));
  res = finalResult(g.s);
  assert.deepEqual(res.scores.map((x) => x.total), [2, 2, 1, 2]);
  assert.equal(res.winner, 'shared');
  assert.deepEqual(res.winners, [0, 1, 3], 'the one who is behind does not share');

  g = blank(2);
  [0, 1, 2].forEach((p) => city(g, p));
  assert.equal(finalResult(g.s).winner, 'shared');
  assert.deepEqual(finalResult(g.s).winners, [0, 1, 2]);
});

test('final scores: ties between several players are broken by Settlements, Advances, Objectives, Wonders and Events in turn', () => {
  // Three of four tie on 3 points, all with 1 Settlement: the Advances decide.
  let g = blank(3);
  [0, 1, 2].forEach((p) => city(g, p));
  advances(g, 0, 4);
  objectives(g, 1, 1);
  g.s.players[2].vpBonus = 2;
  assert.deepEqual(finalResult(g.s).scores.map((x) => x.total), [3, 3, 3, 0]);
  assert.equal(finalResult(g.s).winner, 0);

  // Settlements and Buildings come before everything else.
  g = blank(3);
  [0, 1, 1, 1, 2].forEach((p) => city(g, p));
  advances(g, 0, 8);
  g.s.players[2].vpBonus = 2;
  assert.deepEqual(finalResult(g.s).scores.map((x) => x.total), [5, 3, 3, 0]);
  g.s.players[1].vpBonus = 2;
  g.s.players[0].vpBonus = 1;
  assert.deepEqual(finalResult(g.s).scores.map((x) => x.total), [6, 5, 3, 0]);

  // Objectives, after the same Settlements and Advances.
  g = blank(3);
  [0, 1, 2, 3].forEach((p) => city(g, p));
  objectives(g, 2, 1);
  g.s.players[0].vpBonus = 2;
  g.s.players[3].vpBonus = 2;
  assert.deepEqual(finalResult(g.s).scores.map((x) => x.total), [3, 1, 3, 3]);
  assert.deepEqual(finalResult(g.s).winners, [2], 'Objectives beat Event points');
});

test('final scores: the Great Pyramid wins a tie only for a builder who is among the tied players', () => {
  let g = blank(3);
  [0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 3].forEach((p) => city(g, p));
  g.s.cities.find((c) => c.owner === 1).wonders.push({ id: 'great_pyramid', builder: 1 });
  g.s.players[2].vpBonus = 2;
  assert.deepEqual(finalResult(g.s).scores.map((x) => x.total), [6, 6, 6, 1]);
  assert.equal(finalResult(g.s).winner, 1, 'three tie, and the builder is one of them');

  g = blank(3);
  [0, 0, 2, 2, 2, 1].forEach((p) => city(g, p));
  g.s.cities.find((c) => c.owner === 1).wonders.push({ id: 'great_pyramid', builder: 1 });
  g.s.players[0].vpBonus = 6;
  g.s.players[2].vpBonus = 5;
  assert.deepEqual(finalResult(g.s).scores.map((x) => x.total), [8, 6, 8, 0]);
  assert.equal(finalResult(g.s).winner, 2, 'the builder is behind, so the Settlements decide');
});

test('a game of four saved as text and loaded again carries on exactly like the original', () => {
  const a = fresh('save-load-four', { opponents: 3 });
  drive(a, 0, 120);
  assert.ok(a.s.log.length > 10, 'something happened');
  const saved = a.toJSON();
  const b = Game.fromJSON(saved);
  b.policy = a.policy;
  assert.equal(b.toJSON(), saved, 'loading changes nothing');
  drive(a, 120, 200);
  drive(b, 120, 200);
  assert.notEqual(a.toJSON(), saved, 'the game moved on');
  assert.equal(b.toJSON(), a.toJSON(), 'the same moves lead to the same game, dice included');
  assert.deepEqual(checkInvariants(a), []);
});

test('look-ahead copies at a table of four keep your cards, and reshuffle only the three other hands with the draw piles', () => {
  const g = fresh('sandbox-four', { opponents: 3 });
  endAge(g); // the Status Phase deals everyone more cards
  const before = g.toJSON();
  let seed = 11;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const make = g.sandbox(2, rand);
  const others = [0, 1, 3];
  const sorted = (xs) => [...xs].sort();
  let guessed = false;
  for (let i = 0; i < 3; i++) {
    const copy = make();
    assert.deepEqual(copy.s.players[2].hand, g.s.players[2].hand, 'your own cards are known');
    for (const k of ['action', 'objective']) {
      for (const p of others) assert.equal(copy.s.players[p].hand[k].length, g.s.players[p].hand[k].length);
      const unseen = (game) => sorted([...game.s.decks[k], ...others.flatMap((p) => game.s.players[p].hand[k])]);
      assert.deepEqual(unseen(copy), unseen(g), 'the unseen cards are the same ones, dealt out again');
      if (others.some((p) => JSON.stringify(copy.s.players[p].hand[k]) !== JSON.stringify(g.s.players[p].hand[k]))) guessed = true;
    }
  }
  assert.ok(guessed, 'the other hands are guessed, not copied');
  assert.equal(g.toJSON(), before, 'making copies leaves the game alone');
});
