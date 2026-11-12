// Regressions for the Pirates (Civilizations expansion): every test pins one rule from the printed rulebook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BARBARIAN, PIECE_LIMITS, PIRATE } from '../src/engine/data/constants.js';
import { EVENT_CARDS } from '../src/engine/data/cards.js';
import { addUnit } from '../src/engine/state.js';
import { step } from '../src/engine/hex.js';
import { collectCandidates } from '../src/engine/city.js';
import { battle } from '../src/engine/combat.js';
import { resolveEvent } from '../src/engine/events.js';
import { Game, tradeRoutes } from '../src/engine/game.js';
import { moveOptions, seaReach } from '../src/engine/move.js';
import { pirateRaid, pirateSpawn, placePirates, raidedCities } from '../src/engine/pirates.js';
import { allHexKeys, bfs, cityAt, foesOf, hasAdv, isNpc, isPirate, unitsAt, unitsLeft, unitsOf } from '../src/engine/queries.js';
import { WORLD_EFFECTS } from '../src/engine/worldEvents.js';
import { checkInvariants } from './harness.mjs';
import { act, addCityAt, fresh, give, hold, listen, playAIGame, refused, rigDice } from './scenario.mjs';

const me = (g, p = 0) => g.s.players[p];

// ------------------------------------------------------------------- fixtures
/** An open world of four players: every space is Plains, so a scenario can make Sea and put cities and units wherever it needs them. */
function flat(opponents = 3, seed = 'pirates') {
  const g = fresh(seed, { opponents });
  for (const h of Object.values(g.s.map.hexes)) h.terrain = 'plains';
  return g;
}

const free = (g, k) => !cityAt(g.s, k) && !unitsAt(g.s, k).length;
const [E, NE, NW, W, SW, SE] = [0, 1, 2, 3, 4, 5]; // the six directions, counter-clockwise from the east
/** A stretch of the map where nothing stands within 2 spaces of `o`; `at(E, NE)` walks from `o` one step east and one north-east. */
function bay(g) {
  const o = allHexKeys(g.s).find((k) => {
    const disc = bfs(g.s, k, 2, () => true);
    return disc.size === 19 && [...disc.keys()].every((x) => free(g, x));
  });
  assert.ok(o, 'the map has room for the scenario');
  return { o, at: (...dirs) => dirs.reduce((k, d) => step(k, d), o) };
}

const sea = (g, ...keys) => {
  for (const k of keys) g.s.map.hexes[k].terrain = 'sea';
};
const town = (g, p, k, mood = 'neutral') => addCityAt(g, p, k, mood);
const pirates = (g, ...hexes) => hexes.map((k) => addUnit(g.s, PIRATE, 'ship', k));
const where = (g) => unitsOf(g.s, PIRATE, 'ship').map((u) => u.hex).sort();
const sorted = (list) => [...list].sort();
/** Exactly this much of everything: the Resources of a player, with Mood and Culture tokens. */
const stock = (g, p, { mood = 0, culture = 0, ...res } = {}) => give(g, p, { res: { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0, ...res }, mood, culture });
/** The answers of a series of questions of one kind, in the order they are asked. */
const queue = (...answers) => () => answers.shift();

/** Every player answers with `answers[kind]` (a value, or a function of the prompt) and otherwise with the default. Returns the prompts asked. */
function asking(g, answers = {}) {
  const asked = [];
  g.s.players.forEach((_, q) => {
    g.policy[q] = (_g, prompt) => {
      asked.push(prompt);
      const a = answers[prompt.kind];
      return typeof a === 'function' ? a(prompt) : a !== undefined ? a : prompt.default;
    };
  });
  return asked;
}

function run(g, flow) {
  g.drainEvents();
  const r = g._run(flow);
  assert.ok(r.ok, r.error);
  assert.equal(g.pending, null, 'no question is left open');
  return g.drainEvents();
}

const ofType = (events, type) => events.filter((e) => e.type === type);
const optionIds = (prompt) => prompt.options.map((o) => o.id);

// ------------------------------------------------------------------- the Pirates
test('there are 4 Pirate Ships; the Pirates are neither a player nor the Barbarians, and everyone is their enemy', () => {
  const g = flat();
  assert.equal(PIECE_LIMITS.pirateShips, 4);
  assert.ok(g.s.players.every((p) => p.idx !== PIRATE));
  assert.notEqual(PIRATE, BARBARIAN);
  assert.ok(!foesOf(g.s, 0).includes(PIRATE), 'the Pirates are not one of the players');
  assert.ok(isPirate(PIRATE) && !isPirate(BARBARIAN) && !isPirate(0));
  assert.ok(isNpc(PIRATE) && isNpc(BARBARIAN) && !isNpc(0));
  assert.equal(g.name(PIRATE), 'The Pirates');
  assert.equal(hasAdv(g.s, PIRATE, 'fishing'), false, 'the Pirates own no Advances');
});

test('the Pirates have only Ships, and the supply holds 4 of them', () => {
  const g = flat();
  const { o, at } = bay(g);
  sea(g, o, at(E), at(W));
  assert.equal(unitsLeft(g.s, PIRATE, 'ship'), 4);
  pirates(g, o, at(E));
  assert.equal(unitsLeft(g.s, PIRATE, 'ship'), 2);
  assert.deepEqual(where(g), sorted([o, at(E)]));
});

// ------------------------------------------------------------------- placing them
test('without a Sea space free of player Ships the Pirates are not placed, and nobody is asked', () => {
  const g = flat();
  const { o } = bay(g);
  const asked = asking(g);
  run(g, placePirates(g, 0, 2));
  assert.deepEqual(where(g), [], 'no Sea at all');
  sea(g, o);
  addUnit(g.s, 1, 'ship', o);
  run(g, placePirates(g, 0, 2));
  assert.deepEqual(where(g), [], 'the only Sea space holds a Ship');
  assert.equal(asked.length, 0);
});

test('a Pirate Ship goes to any Sea space without player Ships, also one that holds Pirates already', () => {
  const g = flat();
  const { o, at } = bay(g);
  sea(g, o, at(E), at(NE), at(W), at(SW));
  addUnit(g.s, 1, 'ship', at(W));
  addUnit(g.s, 0, 'ship', at(SW));
  pirates(g, at(E));
  const asked = asking(g, { pick_hex: at(NE) });
  const events = run(g, placePirates(g, 0, 1));
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, 'Pirates spawn');
  assert.deepEqual(sorted(optionIds(asked[0])), sorted([o, at(E), at(NE)]), 'no Ship of any player, and no land');
  assert.deepEqual(where(g), sorted([at(E), at(NE)]));
  assert.deepEqual(ofType(events, 'pirates'), [{ type: 'pirates', kind: 'spawn', hex: at(NE) }]);
});

test('both Pirate Ships of a spawn may share a space', () => {
  const g = flat();
  const { o } = bay(g);
  sea(g, o);
  const asked = asking(g);
  run(g, placePirates(g, 0, 2));
  assert.deepEqual(where(g), [o, o]);
  assert.equal(asked.length, 0, 'a single Sea space needs no decision');

  const wide = flat();
  const { o: p, at } = bay(wide);
  sea(wide, p, at(E));
  asking(wide, { pick_hex: queue(at(E), at(E)) });
  run(wide, placePirates(wide, 0, 2));
  assert.deepEqual(where(wide), [at(E), at(E)]);
});

test('when fewer than 2 Pirate Ships are in the supply, the player first takes some off the map, and may place them again where they were', () => {
  for (const [onMap, leaving] of [[2, 0], [3, 1], [4, 2]]) {
    const g = flat();
    const { o, at } = bay(g);
    sea(g, o, at(E), at(W), at(NE), at(SE));
    const start = [o, o, at(E), at(W)].slice(0, onMap);
    pirates(g, ...start);
    const asked = asking(g, { pick_hex: o });
    const events = run(g, placePirates(g, 0, 2));
    const titles = asked.map((q) => q.title);
    assert.deepEqual(titles, [...Array(leaving).fill('Pirates leave'), 'Pirates spawn', 'Pirates spawn'], `${onMap} Ships on the map`);
    assert.deepEqual(ofType(events, 'pirates').map((e) => e.kind), [...Array(leaving).fill('leave'), 'spawn', 'spawn']);
    assert.equal(unitsOf(g.s, PIRATE, 'ship').length, 4, 'the Pirates have 4 Ships, never more');
    assert.deepEqual(where(g), sorted([...start.slice(leaving), o, o]), 'the Ships taken off are the ones at the chosen space');
  }
});

test('taking Pirates off the map: only spaces with Pirates are offered; by default the Ship next to the drawer\'s own cities goes, the one next to a rival\'s city stays', () => {
  const g = flat();
  const { o, at } = bay(g);
  const mine = at(E);
  const theirs = at(W, NW);
  const empty = at(SE, E);
  sea(g, mine, theirs, empty, at(NE));
  town(g, 0, o);
  town(g, 1, at(W, W));
  pirates(g, mine, theirs, empty, empty);
  const asked = asking(g);
  run(g, placePirates(g, 0, 1));
  const [leave] = asked;
  assert.equal(leave.title, 'Pirates leave');
  assert.deepEqual(sorted(optionIds(leave)), sorted([mine, theirs, empty]));
  assert.equal(leave.default, mine);
  assert.equal(optionIds(leave).at(-1), theirs);
  assert.equal(unitsOf(g.s, PIRATE, 'ship').length, 4);
});

test('by default a Pirate Ship goes next to a rival\'s city rather than to open water or next to the drawer\'s own city', () => {
  const g = flat();
  const { o, at } = bay(g);
  const own = at(E);
  const open = at(NE, NE);
  const rival = at(NW, W);
  sea(g, own, open, rival);
  town(g, 0, o);
  town(g, 1, at(W, W));
  const asked = asking(g);
  run(g, placePirates(g, 0, 1));
  assert.deepEqual(optionIds(asked[0]), [rival, open, own]);
  assert.deepEqual(where(g), [rival]);
});

test('by default the Pirates go to a rival they have not raided yet, so that more players pay', () => {
  for (const raided of [0, 1]) {
    const g = flat();
    const { at } = bay(g);
    const coasts = [at(NW, W), at(E, NE)];
    sea(g, ...coasts);
    town(g, 1, at(W, W));
    town(g, 2, at(NE, NE));
    pirates(g, coasts[raided]);
    const asked = asking(g);
    run(g, placePirates(g, 0, 1));
    assert.equal(asked[0].default, coasts[1 - raided], `player ${raided + 1} has been raided already`);
    assert.deepEqual(where(g), sorted([coasts[0], coasts[1]]));
  }
});

// ------------------------------------------------- the spawn: one Ship next to the drawer
/** The drawer's city stands at `o`; two Sea spaces touch it and two do not. */
function shore(g) {
  const { o, at } = bay(g);
  const touching = [at(E), at(NE)];
  const far = [at(W, W), at(SW, SW)];
  sea(g, ...touching, ...far);
  town(g, 0, o);
  return { touching, far };
}

test('Pirates Spawn: one of the 2 Ships must go next to a city of the drawer, so the second one has to when the first does not', () => {
  const g = flat();
  const { touching, far } = shore(g);
  const asked = asking(g, { pick_hex: queue(far[0], touching[1]) });
  run(g, placePirates(g, 0, 2, { near: true }));
  assert.equal(asked.length, 2);
  assert.deepEqual(sorted(optionIds(asked[0]).slice(0, 2)), sorted(touching), 'the spaces next to the city come first');
  assert.equal(asked[0].options.length, 4);
  assert.match(asked[0].text, /One of the two must be next to one of your cities/);
  assert.deepEqual(sorted(optionIds(asked[1])), sorted(touching), 'the second Ship has no other choice');
  assert.match(asked[1].text, /This one must be next to one of your cities/);
  assert.deepEqual(where(g), sorted([far[0], touching[1]]));
});

test('Pirates Spawn: when only one Sea space touches a city of the drawer, the second Ship goes there without a question', () => {
  const g = flat();
  const { o, at } = bay(g);
  const [touch, away] = [at(E), at(W, W)];
  sea(g, touch, away);
  town(g, 0, o);
  const asked = asking(g, { pick_hex: away });
  run(g, placePirates(g, 0, 2, { near: true }));
  assert.equal(asked.length, 1, 'only the first Ship is placed by the drawer');
  assert.deepEqual(where(g), sorted([touch, away]));
});

test('Pirates Spawn: once a Ship touches a city of the drawer, the other one goes to any Sea space without player Ships', () => {
  const g = flat();
  const { touching, far } = shore(g);
  const asked = asking(g, { pick_hex: queue(touching[0], far[1]) });
  run(g, placePirates(g, 0, 2, { near: true }));
  assert.equal(asked[1].options.length, 4, 'the Sea space of the first Ship is open too');
  assert.doesNotMatch(asked[1].text, /next to one of your cities/);
  assert.deepEqual(where(g), sorted([touching[0], far[1]]));
});

test('Pirates Spawn: the rule is dropped when no open Sea space touches a city of the drawer', () => {
  const g = flat();
  const { o, at } = bay(g);
  const lanes = [at(E, E), at(W, W), at(SW, SW)];
  sea(g, ...lanes);
  town(g, 0, o);
  const asked = asking(g, { pick_hex: queue(lanes[0], lanes[1]) });
  run(g, placePirates(g, 0, 2, { near: true }));
  assert.deepEqual(asked.map((q) => q.options.length), [3, 3]);
  assert.ok(asked.every((q) => !/next to one of your cities/.test(q.text)));
  assert.deepEqual(where(g), sorted([lanes[0], lanes[1]]));
});

// ------------------------------------------------------------------------ the raid
/** A Pirate Ship at sea with a city of each of these players on the shore around it (the first one is `owners[0]`). Returns the cities. */
function coast(g, ...owners) {
  const { o, at } = bay(g);
  sea(g, o);
  pirates(g, o);
  return owners.map((p, i) => town(g, p, at([E, NE, NW, W, SW, SE][i])));
}
const holdings = (g, p) => ({ ...me(g, p).res, mood: me(g, p).mood, culture: me(g, p).culture });

test('Pirate raid: every player with a city next to a Pirate Ship loses 1 Resource, Mood token or Culture token, the drawer first and the rest clockwise', () => {
  const g = flat();
  coast(g, 0, 1, 2);
  for (const p of [0, 1, 2, 3]) stock(g, p, { food: 1, gold: 1 });
  const asked = asking(g);
  const events = run(g, pirateRaid(g, 1));
  assert.deepEqual(asked.map((q) => [q.player, q.kind]), [[1, 'pirate_loss'], [2, 'pirate_loss'], [0, 'pirate_loss']], 'player 3 has no city by the sea');
  assert.deepEqual([0, 1, 2, 3].map((p) => me(g, p).res.gold), [0, 0, 0, 1]);
  assert.deepEqual(ofType(events, 'pirates').map((e) => [e.kind, e.player]), [['raid', 1], ['raid', 2], ['raid', 0]]);
});

test('Pirate raid: the player may give up Food, Wood, Ore, an Idea, Gold, a Mood token or a Culture token, but only what they have; by default the one they can best do without', () => {
  const stocked = { food: 3, ideas: 1, gold: 2, mood: 4, culture: 2 };
  const probe = flat();
  coast(probe, 0);
  stock(probe, 0, stocked);
  const asked = asking(probe);
  run(probe, pirateRaid(probe, 0));
  const [raid] = asked;
  assert.deepEqual(optionIds(raid), ['food', 'ideas', 'gold', 'mood', 'culture'], 'Wood and Ore are not held');
  assert.deepEqual(raid.options.map((o) => o.label), ['Lose 1 Food', 'Lose 1 Idea', 'Lose 1 Gold', 'Lose 1 Mood token', 'Lose 1 Culture token']);
  assert.equal(raid.default, 'mood', 'furthest above what a player wants to keep');
  assert.deepEqual(holdings(probe, 0), { food: 3, wood: 0, ore: 0, ideas: 1, gold: 2, mood: 3, culture: 2 });

  for (const lost of optionIds(raid)) {
    const g = flat();
    coast(g, 0);
    stock(g, 0, stocked);
    asking(g, { pirate_loss: lost });
    run(g, pirateRaid(g, 0));
    const left = { ...stocked, wood: 0, ore: 0 };
    left[lost] -= 1;
    assert.deepEqual(holdings(g, 0), { ...left }, `loses 1 ${lost}`);
  }
});

test('Pirate raid: a player with a single thing to give is not asked', () => {
  const g = flat();
  coast(g, 0);
  stock(g, 0, { culture: 3 });
  const asked = asking(g);
  run(g, pirateRaid(g, 0));
  assert.equal(asked.length, 0);
  assert.equal(me(g).culture, 2);
});

test('Pirate raid: a player is raided once, however many Pirate Ships and cities of theirs are next to each other; cities further away do not count', () => {
  const g = flat();
  const { o, at } = bay(g);
  sea(g, o, at(NE, NE));
  pirates(g, o, o, at(NE, NE));
  town(g, 0, at(E));
  town(g, 0, at(NW));
  town(g, 0, at(W, W));
  stock(g, 0, { food: 2, gold: 2 });
  const asked = asking(g);
  run(g, pirateRaid(g, 0));
  assert.equal(asked.length, 1);
  assert.equal(me(g).res.food + me(g).res.gold, 3, 'one loss of 1 only');
  assert.deepEqual(raidedCities(g.s, 0).map((c) => c.hex).sort(), sorted([at(E), at(NW)]));
});

test('Pirate raid: a player who cannot pay lowers the Mood of a raided city instead; the smallest city is the default, and no city is left to lose it when all are Angry', () => {
  const g = flat();
  const [big, small] = coast(g, 0, 0);
  big.buildings.market = 0;
  big.mood = 'happy';
  small.mood = 'happy';
  stock(g, 0, {});
  const asked = asking(g);
  const events = run(g, pirateRaid(g, 0));
  assert.deepEqual(asked.map((q) => q.kind), ['pick_city']);
  assert.equal(asked[0].default, small.id);
  assert.deepEqual([big.mood, small.mood], ['happy', 'neutral']);
  assert.deepEqual(ofType(events, 'pirates').map((e) => e.kind), ['raid']);

  const picked = flat();
  const [city1, city2] = coast(picked, 0, 0);
  city1.buildings.market = 0;
  city1.mood = city2.mood = 'neutral';
  stock(picked, 0, {});
  asking(picked, { pick_city: city1.id });
  run(picked, pirateRaid(picked, 0));
  assert.deepEqual([city1.mood, city2.mood], ['angry', 'neutral']);

  const sour = flat();
  const [angry, calm] = coast(sour, 0, 0);
  angry.mood = 'angry';
  calm.mood = 'neutral';
  stock(sour, 0, {});
  const nobody = asking(sour);
  run(sour, pirateRaid(sour, 0));
  assert.equal(nobody.length, 0, 'the only city that can lose Mood does so without a question');
  assert.deepEqual([angry.mood, calm.mood], ['angry', 'angry']);

  const lost = flat();
  const cities = coast(lost, 0, 0);
  cities.forEach((c) => {
    c.mood = 'angry';
  });
  stock(lost, 0, {});
  const events2 = run(lost, pirateRaid(lost, 0));
  assert.deepEqual(events2, [], 'nothing happens');
});

test('Pirates Spawn and Raid: 2 Ships appear, one next to a city of the drawer, and then every player next to a Pirate Ship is raided', () => {
  const g = flat();
  const { o, at } = bay(g);
  const [own, rival] = [at(E), at(NW, W)];
  sea(g, own, rival);
  town(g, 0, o);
  town(g, 1, at(W, W));
  town(g, 2, at(SE, SE)); // nowhere near the Sea
  stock(g, 0, { gold: 2 });
  stock(g, 1, { food: 1 });
  stock(g, 2, { food: 1 });
  const asked = asking(g);
  const events = run(g, pirateSpawn(g, 0));
  assert.deepEqual(where(g), sorted([own, rival]), 'by default the drawer must touch a city, and the other Ship hurts a rival');
  assert.deepEqual(asked.map((q) => q.title), ['Pirates spawn', 'Pirates spawn']);
  assert.deepEqual(ofType(events, 'pirates').map((e) => [e.kind, e.hex ?? e.player]), [['spawn', own], ['spawn', rival], ['raid', 0], ['raid', 1]]);
  assert.deepEqual([0, 1, 2].map((p) => me(g, p).res.gold + me(g, p).res.food), [1, 0, 1]);
});

/** Event cards are drawn from the end of the pile: these go on top, the first one is drawn first. */
function stack(g, ...ids) {
  const d = g.s.decks;
  d.event = d.event.filter((x) => !ids.includes(x));
  d.eventDiscard = d.eventDiscard.filter((x) => !ids.includes(x));
  d.event.push(...[...ids].reverse());
}

test('the Pirates Spawn and Raid icon of an Event card: it is announced, 2 Ships appear, the coast is raided, and only then the text of the card is read', () => {
  // The printed Pirate Raids card carries the Barbarian icon, so no card has this one yet: borrow a card whose text is easy to follow.
  const card = EVENT_CARDS.era_of_stability;
  const printed = card.icon;
  card.icon = 'pirates';
  try {
    const g = flat();
    const { o, at } = bay(g);
    const [own, rival] = [at(E), at(NW, W)];
    sea(g, own, rival);
    const home = town(g, 0, o, 'angry');
    town(g, 1, at(W, W));
    stock(g, 0, { gold: 2 });
    stock(g, 1, { food: 1 });
    stack(g, 'era_of_stability');
    const moods = [];
    const asked = asking(g, { pick_hex: (q) => {
      moods.push(home.mood);
      return q.default;
    } });
    const events = run(g, resolveEvent(g, 0));
    assert.deepEqual(asked.map((q) => q.kind), ['event', 'pick_hex', 'pick_hex']);
    assert.equal(asked[0].icon, 'pirates');
    assert.deepEqual(where(g), sorted([own, rival]));
    assert.deepEqual(ofType(events, 'pirates').map((e) => e.kind), ['spawn', 'spawn', 'raid', 'raid']);
    assert.deepEqual([me(g, 0).res.gold, me(g, 1).res.food], [1, 0]);
    assert.deepEqual(moods, ['angry', 'angry'], 'the Ships come first');
    assert.equal(home.mood, 'neutral', 'then the card calms the Angry city');
    assert.equal(g.s.decks.eventDiscard.at(-1), 'era_of_stability');
  } finally {
    card.icon = printed;
  }
});

// ------------------------------------------------------------------- Collect
/** A city of player 0 at `o` that can collect Food from the land and Food, Gold or a Mood token from the Sea spaces E, NE and W. */
function harbour(g) {
  const { o, at } = bay(g);
  sea(g, at(E), at(NE), at(W));
  const city = town(g, 0, o);
  city.buildings.port = 0;
  city.port = at(E);
  give(g, 0, { advances: ['farming', 'fishing'] });
  return { city, o, at };
}
const spaces = (g, city) => collectCandidates(g.s, 0, city).map((c) => c.hex).sort();

test('a Pirate Ship stops Collecting from its own Sea space and from every Sea space next to it, but neither from Land nor from Sea further away', () => {
  const quiet = flat();
  const calm = harbour(quiet);
  const all = sorted([calm.o, ...[E, NE, NW, W, SW, SE].map((d) => calm.at(d))]);
  assert.deepEqual(spaces(quiet, calm.city), all, 'without Pirates every space can be used');

  // [where the Pirate Ship is, the Sea spaces of the city that it shuts]
  const cases = [[[E], [[E], [NE]]], [[E, E], [[E]]], [[NE, NE], [[NE]]], [[W, W], [[W]]], [[SE, SE], []]];
  for (const [path, shut] of cases) {
    const g = flat();
    const { city, at } = harbour(g);
    sea(g, at(...path));
    pirates(g, at(...path));
    const closed = shut.map((d) => at(...d));
    assert.deepEqual(spaces(g, city), sorted(all.filter((k) => !closed.includes(k))), `a Pirate Ship at ${path.join('+')}`);
  }
});

test('Collecting: the Land next to a Pirate Ship still gives its Resources, and a blocked Sea space is refused while the others work', () => {
  const g = flat();
  const { city, at } = harbour(g);
  pirates(g, at(E));
  stock(g, 0, {});
  const take = (k, res) => ({ type: 'collect', city: city.id, picks: [{ hex: k, res }] });
  assert.match(refused(g, take(at(NE), 'food')), /cannot collect from that space/, 'next to the Pirates');
  assert.match(refused(g, take(at(E), 'gold')), /cannot collect from that space/, 'with the Pirates');
  act(g, take(at(SE), 'food'));
  assert.equal(me(g).res.food, 1, 'the Land next to the Pirates is free');

  const far = flat();
  const farHarbour = harbour(far);
  pirates(far, farHarbour.at(E));
  stock(far, 0, {});
  act(far, { type: 'collect', city: farHarbour.city.id, picks: [{ hex: farHarbour.at(W), res: 'gold' }] });
  assert.equal(me(far).res.gold, 1, 'a Sea space the Pirates do not touch still gives Gold to a Port');
});

// -------------------------------------------------------------- Trade Routes
/** Player 0 has a Ship on the Sea space W, with Sea in the middle (o) between it and a city of player 1 on the land space E. */
function strait(g) {
  const { o, at } = bay(g);
  sea(g, at(W), o);
  const ship = addUnit(g.s, 0, 'ship', at(W));
  const port = town(g, 1, at(E));
  give(g, 0, { advances: ['trade_routes'] });
  return { ship, port, o, at };
}
const routes = (g) => tradeRoutes(g.s, 0).map((r) => [r.city, r.unit]);

test('Pirate Ships block the Trade Routes that start in, or go through, a Sea space they are in or next to', () => {
  const open = flat();
  const { ship, port } = strait(open);
  assert.deepEqual(routes(open), [[port.id, ship.id]], 'the Ship reaches the city across the strait');

  // [where the Pirate Ship is, does the route survive?]
  const cases = [
    [[], false, 'in the middle of the strait'],
    [[NE], false, 'next to the middle of the strait'],
    [[W, W], false, 'next to the Sea space of the Ship'],
    [[NW, NW], true, 'two spaces from the strait'],
    [[SE, SE], true, 'two spaces from the strait on the other side'],
    [[NE, E], true, 'next to the city, which is Land'],
  ];
  for (const [path, survives, what] of cases) {
    const g = flat();
    const set = strait(g);
    sea(g, set.at(...path));
    pirates(g, set.at(...path));
    assert.deepEqual(routes(g), survives ? [[set.port.id, set.ship.id]] : [], `a Pirate Ship ${what}`);
  }
});

test('a Settler on Land keeps its Trade Route when a Pirate Ship is next to it, while the Ship is shut out', () => {
  const g = flat();
  const { port, at } = strait(g);
  sea(g, at(NE));
  pirates(g, at(NE));
  const settler = addUnit(g.s, 0, 'settler', at(NE, E));
  assert.deepEqual(routes(g), [[port.id, settler.id]]);
});

// -------------------------------------------------------------- Moving Ships
test('Ships cannot sail past a Pirate Ship: it is as far as they get, and moving into its space starts a naval battle', () => {
  const g = flat();
  const { o, at } = bay(g);
  sea(g, at(W), o, at(E));
  const ship = addUnit(g.s, 0, 'ship', at(W));
  pirates(g, o);
  assert.deepEqual([...seaReach(g.s, 0, at(W))], [[at(W), null], [o, PIRATE]], 'the Sea space behind the Pirates cannot be reached');
  assert.deepEqual(moveOptions(g, 0, [ship.id]).map((m) => [m.to, m.battle?.defender]), [[o, PIRATE]]);
  assert.match(refused(g, { type: 'move', units: [ship.id], to: at(E) }), /cannot reach/);

  const asked = listen(g, 0);
  hold(g, 0);
  rigDice(g, [6, 'infantry'], [1, 'leader']);
  g.drainEvents();
  act(g, { type: 'move', units: [ship.id], to: o });
  const events = g.drainEvents();
  assert.deepEqual(ofType(events, 'battle_start').map((e) => [e.attacker, e.defender, e.hex]), [[0, PIRATE, o]]);
  assert.deepEqual(unitsAt(g.s, o).map((u) => [u.owner, u.type]), [[0, 'ship']], 'the Pirates are gone and the Ship is in their space');
  assert.deepEqual(asked.map((q) => q.kind), ['pirate_bounty']);
});

// ---------------------------------------------------- Attacking the Pirates
const HIT = [6, 'infantry']; // a die worth 6: one hit all by itself
const MISS = [1, 'leader']; // a die worth 1

/**
 * Player 0 attacks the Sea space `o` with `ships` Ships from the Sea space W, where `foes` Pirate Ships lie; `have` is what the player owns.
 * `dice` are the faces the dice show, the attacker's first in every round. `answers` are the answers of the attacker.
 */
function blockade({ ships = 1, foes = 1, have = {}, dice, answers, prepare }) {
  const g = flat();
  const { o, at } = bay(g);
  sea(g, o, at(W));
  const mine = Array.from({ length: ships }, () => addUnit(g.s, 0, 'ship', at(W))).map((u) => u.id);
  pirates(g, ...Array(foes).fill(o));
  stock(g, 0, have);
  hold(g, 0);
  prepare?.(g);
  const asked = listen(g, 0, answers);
  rigDice(g, ...dice);
  g.drainEvents();
  const r = g._run(battle(g, { domain: 'sea', attacker: 0, defender: PIRATE, hex: o, from: at(W), units: mine, settlers: [], carried: [], landed: false, inPlace: false }));
  assert.ok(r.ok, r.error);
  assert.equal(g.pending, null, 'the Pirates are never asked anything');
  const events = g.drainEvents();
  return { g, o, at, mine, asked, events, bounty: asked.filter((q) => q.kind === 'pirate_bounty') };
}

test('every Pirate Ship that goes down pays its sinker 1 Gold and 1 Mood or Culture token', () => {
  for (const [pick, tokens] of [['mood', [1, 0]], ['culture', [0, 1]]]) {
    const t = blockade({ dice: [HIT, MISS], answers: { pirate_bounty: pick } });
    assert.deepEqual(t.bounty.map(optionIds), [['mood', 'culture']]);
    assert.deepEqual([me(t.g).res.gold, me(t.g).mood, me(t.g).culture], [1, ...tokens], `the bounty is 1 Gold and a ${pick} token`);
    assert.deepEqual(where(t.g), [], 'the Pirate Ship is gone');
    assert.equal(unitsLeft(t.g.s, PIRATE, 'ship'), 4, 'and back in the supply');
    assert.deepEqual(unitsAt(t.g.s, t.o).map((u) => [u.owner, u.type]), [[0, 'ship']], 'the winner moves in');
    assert.deepEqual(ofType(t.events, 'pirates'), [{ type: 'pirates', kind: 'bounty', player: 0, ships: 1 }]);
    assert.equal(me(t.g).stats.battlesWon, 1);
  }
});

test('Pirate bounty: by default the player takes the token they have fewer of', () => {
  const rich = blockade({ dice: [HIT, MISS], have: { mood: 2 } });
  assert.equal(rich.bounty[0].default, 'culture');
  assert.deepEqual([me(rich.g).mood, me(rich.g).culture], [2, 1]);
  const poor = blockade({ dice: [HIT, MISS], have: { culture: 2 } });
  assert.equal(poor.bounty[0].default, 'mood');
  assert.deepEqual([me(poor.g).mood, me(poor.g).culture], [1, 2]);
});

test('Pirate bounty: with 2 Ships sunk in one battle the player earns 2 Gold and 2 tokens, within the limit of 7 Gold', () => {
  const t = blockade({ ships: 2, foes: 2, have: { gold: 6 }, dice: [HIT, HIT, MISS, MISS], answers: { pirate_bounty: queue('mood', 'culture') } });
  assert.equal(t.bounty.length, 2);
  assert.deepEqual([me(t.g).res.gold, me(t.g).mood, me(t.g).culture], [7, 1, 1], 'the Gold stops at the limit, the tokens do not');
  assert.deepEqual(where(t.g), []);
  assert.deepEqual(ofType(t.events, 'pirates'), [{ type: 'pirates', kind: 'bounty', player: 0, ships: 2 }]);
});

test('the bounty is paid for the Pirate Ships sunk even when the attacker loses the battle, and nothing is paid when none goes down', () => {
  const lost = blockade({ foes: 2, dice: [HIT, HIT, MISS] });
  assert.deepEqual(unitsOf(lost.g.s, 0, 'ship'), [], 'the only Ship is sunk');
  assert.deepEqual(where(lost.g), [lost.o], 'one Pirate Ship is left');
  assert.equal(lost.bounty.length, 1);
  assert.deepEqual([me(lost.g).res.gold, me(lost.g).mood + me(lost.g).culture], [1, 1]);
  assert.deepEqual([me(lost.g).stats.battlesWon, me(lost.g).stats.battlesLost], [0, 1]);
  assert.equal(ofType(lost.events, 'battle_end')[0].winner, PIRATE);

  const none = blockade({ foes: 2, dice: [MISS, HIT, MISS] });
  assert.deepEqual(unitsOf(none.g.s, 0, 'ship'), []);
  assert.equal(none.bounty.length, 0);
  assert.deepEqual([me(none.g).res.gold, me(none.g).mood, me(none.g).culture], [0, 0, 0]);
  assert.deepEqual(ofType(none.events, 'pirates'), []);
  assert.equal(where(none.g).length, 2);
});

test('retreating after a round keeps the bounty of the Pirate Ship sunk, and the Pirates stay where they were', () => {
  const t = blockade({ foes: 2, dice: [HIT, MISS, MISS], answers: { retreat: 'yes' } });
  assert.deepEqual(t.asked.filter((q) => q.kind === 'retreat').length, 1);
  assert.equal(ofType(t.events, 'battle_end')[0].retreated, true);
  assert.deepEqual(unitsAt(t.g.s, t.at(W)).map((u) => [u.owner, u.type]), [[0, 'ship']], 'the Ship sails back');
  assert.deepEqual(where(t.g), [t.o], 'one Pirate Ship is left');
  assert.deepEqual([me(t.g).res.gold, me(t.g).mood + me(t.g).culture], [1, 1]);
});

test('Ships recruited into the space of a Pirate Ship fight at once, cannot retreat, and earn the bounty', () => {
  const g = flat();
  const { o, at } = bay(g);
  sea(g, at(E));
  const port = town(g, 0, o);
  port.buildings.port = 0;
  port.port = at(E);
  pirates(g, at(E));
  stock(g, 0, { wood: 2 });
  hold(g, 0);
  const asked = listen(g, 0);
  rigDice(g, MISS, MISS, HIT, MISS);
  g.drainEvents();
  act(g, { type: 'recruit', city: port.id, units: { ship: 1 } });
  const events = g.drainEvents();
  assert.equal(ofType(events, 'battle_round').length, 2, 'the fight goes on until one side is gone');
  assert.deepEqual(asked.map((q) => q.kind), ['pirate_bounty'], 'there is no question about retreating');
  assert.deepEqual(unitsAt(g.s, at(E)).map((u) => [u.owner, u.type]), [[0, 'ship']]);
  assert.deepEqual([me(g).res.wood, me(g).res.gold], [0, 1]);
  assert.deepEqual(checkInvariants(g), []);
});

/** Player p holds exactly these Objective cards; they come from the draw pile or, failing that, from another player, who gets another card in return. */
function objectives(g, p, ...cards) {
  const { decks, players } = g.s;
  const hand = players[p].hand.objective;
  decks.objective.unshift(...hand.splice(0));
  for (const id of cards) {
    const i = decks.objective.indexOf(id);
    if (i >= 0) decks.objective.splice(i, 1);
    else {
      const holder = players.find((q) => q.hand.objective.includes(id)).hand.objective;
      const [spare] = decks.objective.splice(decks.objective.findIndex((x) => !cards.includes(x)), 1);
      holder.splice(holder.indexOf(id), 1, spare);
    }
    hand.push(id);
  }
}

test('Objectives: a Pirate Ship counts as an enemy Ship for Scavenger, but the Pirates are not another player for Defiance or Bold', () => {
  const t = blockade({
    ships: 2,
    foes: 3,
    dice: [HIT, HIT, MISS, MISS, MISS, HIT, HIT, MISS],
    prepare: (g) => objectives(g, 0, 'ob7', 'ob16', 'ob21'), // Defiance, Bold, Scavenger
  });
  assert.equal(ofType(t.events, 'battle_end')[0].winner, 0);
  assert.deepEqual(where(t.g), []);
  assert.deepEqual(me(t.g).completed.map((c) => c.id), ['scavenger']);
  assert.deepEqual(me(t.g).hand.objective, ['ob7', 'ob16'], 'a victory over fewer Ships than the Pirates have is no feat against another player');
  assert.deepEqual(checkInvariants(t.g), []);
});

// ------------------------------------------------------------------ the rest
test('a typhoon sinks Pirate Ships in deep water like any other Ship, but spares those next to Land', () => {
  const g = flat();
  const { o, at } = bay(g);
  sea(g, o, ...[E, NE, NW, W, SW, SE].map((d) => at(d)));
  pirates(g, o, at(E));
  run(g, WORLD_EFFECTS.typhoon(g, 0));
  assert.deepEqual(where(g), [at(E)]);
  assert.equal(unitsLeft(g.s, PIRATE, 'ship'), 3, 'the sunken Ship is back in the supply');
});

test('a saved game keeps its Pirate Ships, and the loaded game plays on', () => {
  const g = flat();
  const { o, at } = bay(g);
  sea(g, o, at(E), at(W));
  pirates(g, o, at(E));
  const copy = Game.fromJSON(g.toJSON());
  assert.deepEqual(JSON.parse(copy.toJSON()), JSON.parse(g.toJSON()));
  assert.deepEqual(where(copy), sorted([o, at(E)]));
  assert.deepEqual(checkInvariants(copy), []);
  asking(copy);
  run(copy, placePirates(copy, 0, 2));
  assert.equal(unitsLeft(copy.s, PIRATE, 'ship'), 0, 'the supply of the loaded game is right too');
  assert.equal(where(copy).length, 4);
  assert.deepEqual(checkInvariants(copy), []);
});

// -------------------------------------------------------------------------- AI
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

test('computers play legal games to the end while Pirate Ships keep spawning and raiding on the Sea', () => {
  const real = Math.random;
  try {
    for (const seed of [61, 67]) {
      Math.random = seededRandom(seed); // the computer is random: a fixed seed keeps a failure reproducible
      let turns = 0;
      let peak = 0;
      const { g, problems } = playAIGame(seed, {
        opponents: 2,
        turn: (game, p) => {
          // Every third turn the player in turn draws a card with the Pirates Spawn and Raid icon, as soon as there is Sea to put Ships on.
          if (turns++ % 3) return;
          const r = game._run(pirateSpawn(game, p));
          assert.ok(r.ok, r.error);
          assert.equal(game.pending, null);
          peak = Math.max(peak, where(game).length);
        },
      });
      assert.deepEqual(problems, [], `seed ${seed}`);
      assert.equal(g.s.phase, 'over', `seed ${seed}`);
      assert.ok(peak > 0, `seed ${seed}: the Pirates came to the Sea`);
    }
  } finally {
    Math.random = real;
  }
});

