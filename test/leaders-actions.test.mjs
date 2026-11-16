// Leaders: the Actions and Free Actions they grant, played as `{ type: 'leader', ability, ...parameters }`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADVANCES } from '../src/engine/data/advances.js';
import { LEADERS } from '../src/engine/data/leaders.js';
import { leaderActionList } from '../src/engine/leaderActions.js';
import { regionOf } from '../src/engine/leaders.js';
import { hexDistance, isLand, leaderUnit, nbrs } from '../src/engine/queries.js';
import { act, capitalOf, give, hold, refused } from './scenario.mjs';
import { asking, barbarians, free, me, ofType, ring, setTerrain, stock, troops } from './civs.mjs';
import { elsewhere, lead, secondCity } from './leaders.mjs';

const use = (ability, params = {}) => ({ type: 'leader', ability, ...params });
const offers = (g, ability) => leaderActionList(g, 0).filter((c) => c.ability === ability);
const tokens = (g) => [me(g).mood, me(g).culture];

// --------------------------------------------------------------------------- Advances for a token
const GROUPED = [
  { civ: 'china', leader: 'wu_zetian', ability: 'wu_zetian_a', advance: 'storage', foreign: 'tactics' },
  { civ: 'china', leader: 'sun_tzu', ability: 'sun_tzu_a', advance: 'tactics', foreign: 'storage' },
  { civ: 'greece', leader: 'pericles', ability: 'pericles_a', advance: 'writing', foreign: 'storage' },
  { civ: 'phoenicia', leader: 'hiram', ability: 'hiram_b', advance: 'engineering', foreign: 'tactics' },
];

for (const c of GROUPED) {
  const name = LEADERS[c.leader].name;
  const bonus = ADVANCES[c.advance].bonus;

  test(`${name}: an action and his city activated buy an ${ADVANCES[c.advance].group} Advance for 1 Culture or 1 Mood token instead of the Food`, () => {
    const { g, cap } = lead(c.civ, c.leader);
    stock(g, 0, { mood: 1, culture: 1 });
    assert.ok(offers(g, c.ability).some((o) => o.action.advance === c.advance && o.action.token === 'culture'), 'the computer players are offered it');
    act(g, use(c.ability, { advance: c.advance, token: 'culture' }));
    assert.ok(me(g).advances.includes(c.advance));
    assert.deepEqual(tokens(g), [1 + (bonus === 'mood' ? 1 : 0), bonus === 'culture' ? 1 : 0], 'the Culture token paid the price, no Food was needed');
    assert.equal(g.s.turn.actionsLeft, 2);
    assert.equal(g.s.turn.activated[cap.id], 1, 'his city is activated');
    assert.deepEqual(ofType(g.drainEvents(), 'advance').map((e) => e.advance), [c.advance]);

    const mood = lead(c.civ, c.leader);
    stock(mood.g, 0, { mood: 1, culture: 0 });
    act(mood.g, use(c.ability, { advance: c.advance, token: 'mood' }));
    assert.ok(me(mood.g).advances.includes(c.advance));
    assert.equal(me(mood.g).mood, bonus === 'mood' ? 1 : 0);
  });

  test(`${name}: only an Advance of his category, only with a token to pay, only from his city, only with an action left`, () => {
    const { g, cap } = lead(c.civ, c.leader);
    stock(g, 0, { food: 2, mood: 1, culture: 1 });
    assert.match(refused(g, use(c.ability, { advance: c.foreign, token: 'culture' })), /category/);
    assert.match(refused(g, use(c.ability, { advance: 'nothing' })), /Choose an Advance/);
    me(g).advances.push(c.advance);
    assert.match(refused(g, use(c.ability, { advance: c.advance, token: 'culture' })), /already/);
    me(g).advances.pop();
    stock(g, 0, { food: 2, mood: 0, culture: 0 });
    assert.match(refused(g, use(c.ability, { advance: c.advance })), /cannot afford/);
    stock(g, 0, { food: 0, mood: 1, culture: 1 });
    g.s.turn.actionsLeft = 0;
    assert.match(refused(g, use(c.ability, { advance: c.advance, token: 'culture' })), /no actions left/);
    g.s.turn.actionsLeft = 3;
    leaderUnit(g.s, 0).hex = elsewhere(g, cap.hex);
    assert.match(refused(g, use(c.ability, { advance: c.advance, token: 'culture' })), /must be in one of your cities/);
    assert.deepEqual(offers(g, c.ability), [], 'nothing is offered away from a city');
  });
}

test('Wu Zetian: with both tokens in hand and none named, the player is asked which one pays', () => {
  const { g } = lead('china', 'wu_zetian');
  stock(g, 0, { mood: 2, culture: 1 });
  const asked = asking(g, { leader_token: 'mood' });
  act(g, use('wu_zetian_a', { advance: 'storage' }));
  assert.deepEqual(asked.map((p) => p.kind), ['leader_token']);
  assert.deepEqual(tokens(g), [2, 1], 'a Mood token paid, and Storage gave one back');
});

test('Maharaja Sri Gupta: his city and 1 more Culture token open a new category of Advances without an action', () => {
  const { g, cap } = lead('india', 'maharaja');
  stock(g, 0, { food: 2, culture: 1 });
  assert.ok(offers(g, 'maharaja_a').some((o) => o.action.advance === 'writing'));
  act(g, use('maharaja_a', { advance: 'writing' }));
  assert.ok(me(g).advances.includes('writing'));
  assert.equal(g.s.turn.actionsLeft, 3, 'no action was spent');
  assert.equal(g.s.turn.activated[cap.id], 1);
  assert.equal(me(g).res.food, 0, 'the usual price was paid');
  assert.equal(me(g).culture, 1, 'one Culture token paid and Writing gave one back');
});

test('Maharaja Sri Gupta: only the first Advance of a category that the player has no Advance in, and only with the extra Culture token', () => {
  const { g } = lead('india', 'maharaja');
  stock(g, 0, { food: 2, culture: 0 });
  assert.match(refused(g, use('maharaja_a', { advance: 'writing' })), /cannot afford/);
  stock(g, 0, { food: 2, culture: 1 });
  assert.match(refused(g, use('maharaja_a', { advance: 'storage' })), /first Advance of a category/, 'agriculture is a category he has');
  assert.match(refused(g, use('maharaja_a', { advance: 'public_education' })), /Writing first/);
  assert.match(refused(g, use('maharaja_a', { advance: 'nothing' })), /Choose an Advance/);
});

// --------------------------------------------------------------------------- free builds
test('Darius: a Building in his city for its price and 2 Culture tokens, with no action and once per turn', () => {
  const { g, cap } = lead('persia', 'darius');
  secondCity(g, cap);
  give(g, 0, { advances: ['bartering', 'myths'] });
  stock(g, 0, { food: 2, wood: 2, ore: 2, culture: 4 });
  assert.ok(offers(g, 'darius_b').some((o) => o.action.building === 'market'));
  act(g, use('darius_b', { building: 'market' }));
  assert.equal(cap.buildings.market, 0);
  assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore, me(g).culture], [1, 1, 1, 2]);
  assert.equal(g.s.turn.actionsLeft, 3, 'no action');
  assert.equal(g.s.turn.activated[cap.id], undefined, 'the city is not activated');
  assert.match(refused(g, use('darius_b', { building: 'temple' })), /once per turn/);
  assert.deepEqual(offers(g, 'darius_b'), []);
});

test('Darius: a Temple still pays its Mood or Culture token; he needs the 2 Culture tokens and the Building price', () => {
  const { g } = lead('persia', 'darius');
  secondCity(g, capitalOf(g));
  give(g, 0, { advances: ['myths'] });
  stock(g, 0, { food: 1, wood: 1, ore: 1, culture: 1 });
  refused(g, use('darius_b', { building: 'temple' }));
  stock(g, 0, { food: 0, wood: 1, ore: 1, culture: 2 });
  refused(g, use('darius_b', { building: 'temple' }));
  stock(g, 0, { food: 1, wood: 1, ore: 1, culture: 2 });
  assert.match(refused(g, use('darius_b', { building: 'academy' })), /Writing/);
  act(g, use('darius_b', { building: 'temple', templeBonus: 'culture' }));
  assert.equal(capitalOf(g).buildings.temple, 0);
  assert.equal(me(g).culture, 1, 'the 2 Culture tokens went and the Temple gave one');
});

test('Darius: his city must be able to grow: a lone city cannot build', () => {
  const { g } = lead('persia', 'darius');
  give(g, 0, { advances: ['bartering'] });
  stock(g, 0, { food: 1, wood: 1, ore: 1, culture: 2 });
  assert.match(refused(g, use('darius_b', { building: 'market' })), /cannot grow larger/);
  assert.deepEqual(offers(g, 'darius_b'), []);
});

test('Ahuitzotl: 2 Captives sacrificed pay for a Building in his city with no action, once per turn', () => {
  const { g, cap } = lead('aztecs', 'ahuitzotl');
  secondCity(g, cap);
  give(g, 0, { advances: ['bartering'] });
  stock(g, 0, { food: 1, wood: 1, ore: 1 });
  me(g).captives = [{ owner: 1, type: 'infantry' }, { owner: 1, type: 'infantry' }, { owner: 1, type: 'cavalry' }];
  assert.ok(offers(g, 'ahuitzotl_b').some((o) => o.action.building === 'market'));
  act(g, use('ahuitzotl_b', { building: 'market' }));
  assert.equal(cap.buildings.market, 0);
  assert.deepEqual(me(g).captives, [{ owner: 1, type: 'cavalry' }], 'the first two Captives were sacrificed');
  assert.equal(me(g).res.food + me(g).res.wood + me(g).res.ore, 0, 'and the Building was paid as usual');
  assert.equal(g.s.turn.actionsLeft, 3);
  assert.match(refused(g, use('ahuitzotl_b', { building: 'market' })), /once per turn/);
});

test('Ahuitzotl: he needs 2 Captives, and the price of what he builds', () => {
  const { g, cap } = lead('aztecs', 'ahuitzotl');
  secondCity(g, cap);
  give(g, 0, { advances: ['bartering'] });
  stock(g, 0, { food: 1, wood: 1, ore: 1 });
  me(g).captives = [{ owner: 1, type: 'infantry' }];
  assert.match(refused(g, use('ahuitzotl_b', { building: 'market' })), /2 Captives/);
  assert.deepEqual(offers(g, 'ahuitzotl_b'), []);
  me(g).captives.push({ owner: 1, type: 'infantry' });
  stock(g, 0, { food: 0, wood: 1, ore: 1 });
  refused(g, use('ahuitzotl_b', { building: 'market' }));
  assert.equal(me(g).captives.length, 2, 'a refused build keeps its Captives');
  assert.match(refused(g, use('ahuitzotl_b', { wonder: 'great_pyramid' })), /Wonder/);
  assert.equal(cap.wonders.length, 0);
});

test('Ahuitzotl: 2 Captives can pay for a Wonder in his city at no action cost', () => {
  const { g, cap } = lead('aztecs', 'ahuitzotl');
  secondCity(g, cap);
  give(g, 0, { advances: ['engineering', 'rituals'], wonders: ['great_pyramid'] });
  stock(g, 0, { food: 2, wood: 3, ore: 7, culture: 5 });
  me(g).captives = [{ owner: 1, type: 'infantry' }, { owner: 1, type: 'infantry' }];
  assert.ok(offers(g, 'ahuitzotl_b').some((o) => o.action.wonder === 'great_pyramid'));
  act(g, use('ahuitzotl_b', { wonder: 'great_pyramid' }));
  assert.deepEqual(cap.wonders.map((w) => w.id), ['great_pyramid']);
  assert.equal(me(g).captives.length, 0);
  assert.equal(g.s.turn.actionsLeft, 3);
  assert.equal(me(g).culture, 0);
});

test('Darius builds Buildings only: not a Wonder', () => {
  const { g, cap } = lead('persia', 'darius');
  secondCity(g, cap);
  give(g, 0, { advances: ['engineering', 'rituals'], wonders: ['great_pyramid'] });
  stock(g, 0, { food: 2, wood: 3, ore: 7, culture: 7 });
  assert.match(refused(g, use('darius_b', { wonder: 'great_pyramid' })), /Buildings only/);
});

// --------------------------------------------------------------------------- tokens and cards
test('Cyrus the Great: his city activated gives a token per Region with one of your cities, up to its size, each Culture or Mood', () => {
  const { g, cap } = lead('persia', 'cyrus');
  cap.buildings.market = 0;
  secondCity(g, cap, 'neutral');
  stock(g, 0, { mood: 0, culture: 0 });
  assert.ok(offers(g, 'cyrus_a').length > 0);
  act(g, use('cyrus_a', { culture: 1 }));
  assert.deepEqual(tokens(g), [1, 1], 'two Regions and a city of size 2: two tokens');
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.equal(g.s.turn.activated[cap.id], 1);
});

test('Cyrus the Great: a lone city of size 1 gives one token; the player is asked how many are Culture when it is not said', () => {
  const { g } = lead('persia', 'cyrus');
  stock(g, 0, { mood: 0, culture: 0 });
  const asked = asking(g, { cyrus_tokens: '1' });
  act(g, use('cyrus_a'));
  assert.deepEqual(asked.map((p) => [p.kind, p.options.length]), [['cyrus_tokens', 2]]);
  assert.deepEqual(tokens(g), [0, 1]);
});

test('Cyrus the Great: the number of tokens is the smaller of the size of his city and the Regions of your cities', () => {
  const { g, cap } = lead('persia', 'cyrus');
  cap.buildings.market = 0;
  cap.buildings.academy = 0;
  stock(g, 0, { mood: 0, culture: 0 });
  act(g, use('cyrus_a', { culture: 1 }));
  assert.equal(tokens(g).reduce((a, b) => a + b, 0), 1, 'a size 3 city in one Region: one token');
});

test('Augustus: his city activated draws an Action card, then the player discards one, once per turn', () => {
  const { g, cap } = lead('rome', 'augustus');
  const [card] = g.s.decks.action;
  hold(g, 0, card);
  const next = g.s.decks.action.at(-1);
  assert.ok(offers(g, 'augustus_a').length >= 2, 'an Action card or an Objective card');
  act(g, use('augustus_a', { draw: 'action', discard: card }));
  assert.deepEqual(me(g).hand.action, [next]);
  assert.equal(g.s.decks.actionDiscard.at(-1), card);
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.equal(g.s.turn.activated[cap.id], 1);
  assert.match(refused(g, use('augustus_a', { draw: 'objective' })), /once per turn/);
});

test('Augustus: he draws an Objective card and discards one of the same type, the player choosing when it is not said', () => {
  const { g } = lead('rome', 'augustus');
  const before = me(g).hand.objective.length;
  const asked = asking(g);
  act(g, use('augustus_a', { draw: 'objective' }));
  assert.equal(me(g).hand.objective.length, before);
  assert.deepEqual(asked.map((p) => p.kind), ['augustus']);
  assert.equal(g.s.decks.objectiveDiscard.length, 1);
});

test('Cleopatra: a Culture token placed in her city, once per turn, and no action', () => {
  const { g, cap } = lead('egypt', 'cleopatra');
  stock(g, 0, { culture: 2 });
  assert.equal(offers(g, 'cleopatra_b').length, 1);
  act(g, use('cleopatra_b'));
  assert.equal(cap.beloved, 1);
  assert.equal(me(g).culture, 1);
  assert.equal(g.s.turn.actionsLeft, 3);
  assert.match(refused(g, use('cleopatra_b')), /once per turn/);
  assert.deepEqual(offers(g, 'cleopatra_b'), []);
  const none = lead('egypt', 'cleopatra');
  assert.match(refused(none.g, use('cleopatra_b')), /1 Culture/);
});

// --------------------------------------------------------------------------- civic improvement and taxes
test('Caesar: his city activated is raised in Mood as a Free action', () => {
  const { g, cap } = lead('rome', 'caesar');
  cap.mood = 'neutral';
  stock(g, 0, { mood: 1 });
  assert.deepEqual(offers(g, 'caesar_a').map((o) => o.action.steps), [1]);
  act(g, use('caesar_a', { steps: 1 }));
  assert.equal(cap.mood, 'happy');
  assert.equal(me(g).mood, 0, 'size 1: one Mood token for the step');
  assert.equal(g.s.turn.actionsLeft, 3, 'a Free action');
  assert.equal(g.s.turn.activated[cap.id], 1);
});

test('Caesar: not above Happy, not without the Mood, and only in his city', () => {
  const { g } = lead('rome', 'caesar');
  stock(g, 0, { mood: 1 });
  assert.match(refused(g, use('caesar_a', { steps: 1 })), /above Happy/);
  assert.deepEqual(offers(g, 'caesar_a'), []);
  capitalOf(g).mood = 'angry';
  stock(g, 0, { mood: 0 });
  refused(g, use('caesar_a', { steps: 1 }));
  stock(g, 0, { mood: 2 });
  leaderUnit(g.s, 0).hex = elsewhere(g, capitalOf(g).hex);
  assert.match(refused(g, use('caesar_a', { steps: 1 })), /must be in one of your cities/);
});

test('Cnut the Great: Taxation in a Happy city he is in, with no Mood cost and no other action, once per turn', () => {
  const { g, cap } = lead('vikings', 'cnut');
  give(g, 0, { advances: ['bartering', 'taxation'] });
  stock(g, 0, { mood: 1 });
  assert.ok(offers(g, 'cnut_b').length > 0);
  act(g, use('cnut_b', { gain: { ore: 1 } }));
  assert.equal(me(g).res.ore, 1);
  assert.equal(me(g).mood, 1, 'no Mood token was paid');
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.equal(g.s.turn.activated[cap.id], 1);
  assert.match(refused(g, { type: 'taxation', gain: { food: 1 } }), /once per turn/, 'it was the Taxation of the turn');
  assert.match(refused(g, use('cnut_b', { gain: { ore: 1 } })), /once per turn/);
});

test('Cnut the Great: he needs Taxation and a Happy city, and exactly one Resource per city', () => {
  const { g } = lead('vikings', 'cnut');
  assert.match(refused(g, use('cnut_b', { gain: { ore: 1 } })), /Taxation/);
  give(g, 0, { advances: ['bartering', 'taxation'] });
  assert.match(refused(g, use('cnut_b', { gain: { ore: 2 } })), /exactly 1 Resource/);
  assert.match(refused(g, use('cnut_b', { gain: { ideas: 1 } })), /cannot take/);
  capitalOf(g).mood = 'neutral';
  assert.match(refused(g, use('cnut_b', { gain: { ore: 1 } })), /Happy/);
  assert.deepEqual(offers(g, 'cnut_b'), []);
});

// --------------------------------------------------------------------------- Empress Suiko
test('Suiko: an influenced piece of another player in her city goes back to the player, for an action', () => {
  const { g, cap } = lead('japan', 'suiko');
  cap.buildings.market = 1;
  cap.buildings.temple = 0;
  assert.deepEqual(offers(g, 'suiko_a').map((o) => o.action.building), ['market']);
  act(g, use('suiko_a', { building: 'market' }));
  assert.equal(cap.buildings.market, 0);
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.equal(g.s.turn.activated[cap.id], undefined, 'it is not an activation, and not a Cultural Influence attempt');
  assert.deepEqual(ofType(g.drainEvents(), 'revert').map((e) => [e.building, e.city]), [['market', cap.id]]);
});

test('Suiko: it is a Free action with State Religion; not an Obelisk, not her own piece, not a piece that is not there', () => {
  const { g, cap } = lead('japan', 'suiko');
  cap.buildings.obelisk = 1;
  cap.buildings.market = 1;
  cap.buildings.temple = 0;
  assert.match(refused(g, use('suiko_a', { building: 'obelisk' })), /not an Obelisk/);
  assert.match(refused(g, use('suiko_a', { building: 'temple' })), /another player/);
  assert.match(refused(g, use('suiko_a', { building: 'academy' })), /another player/);
  give(g, 0, { advances: ['state_religion'] });
  act(g, use('suiko_a', { building: 'market' }));
  assert.equal(g.s.turn.actionsLeft, 3);
  assert.equal(cap.buildings.obelisk, 1);
});

// --------------------------------------------------------------------------- moves
/** Seat 0 plays the Vikings with Eric the Red and a Ship on a Sea space next to its capital. */
function aboard() {
  const { g, cap, unit } = lead('vikings', 'eric');
  const sea = ring(g, cap.hex, 1)[0];
  setTerrain(g, sea, 'sea');
  unit.hex = sea;
  const [ship] = troops(g, 0, 'ship', sea);
  give(g, 0, { advances: ['tactics'] });
  const land = nbrs(g.s, sea).filter((k) => isLand(g.s, k) && free(g, k));
  return { g, cap, eric: unit, sea, ship, land };
}

test('Eric the Red: on a Ship, a Culture token on his Region is a Victory Point, once per Region', () => {
  const { g, sea } = aboard();
  stock(g, 0, { culture: 3 });
  assert.equal(offers(g, 'eric_a').length, 1);
  act(g, use('eric_a'));
  assert.deepEqual(me(g).ericTokens, [regionOf(g.s, sea)]);
  assert.equal(me(g).culture, 2);
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.deepEqual(ofType(g.drainEvents(), 'eric_token').map((e) => e.region), [regionOf(g.s, sea)]);
  assert.match(refused(g, use('eric_a')), /already/);
  assert.deepEqual(offers(g, 'eric_a'), []);
  const other = elsewhere(g, sea);
  setTerrain(g, other, 'sea');
  leaderUnit(g.s, 0).hex = other;
  assert.equal(offers(g, 'eric_a').length, 1);
  act(g, use('eric_a'));
  assert.equal(me(g).ericTokens.length, 2);
  assert.equal(me(g).culture, 1);
});

test('Eric the Red: he must be on a Ship and the player must have a Culture token', () => {
  const { g, sea } = aboard();
  assert.match(refused(g, use('eric_a')), /1 Culture/);
  stock(g, 0, { culture: 1 });
  leaderUnit(g.s, 0).hex = capitalOf(g).hex;
  assert.match(refused(g, use('eric_a')), /on a Ship/);
  assert.deepEqual(offers(g, 'eric_a'), []);
  leaderUnit(g.s, 0).hex = sea;
  g.s.turn.actionsLeft = 0;
  assert.match(refused(g, use('eric_a')), /no actions left/);
});

test('Eric the Red: he and the Land units on board with him go to a Land space next to the Ship as a Free action', () => {
  const { g, eric, sea, ship, land } = aboard();
  const [crew] = troops(g, 0, 'infantry', sea);
  const to = land[0];
  assert.ok(offers(g, 'eric_b').some((o) => o.action.to === to));
  act(g, use('eric_b', { units: [eric.id, crew.id], to }));
  assert.deepEqual([eric.hex, crew.hex, ship.hex], [to, to, sea]);
  assert.equal(g.s.turn.actionsLeft, 3, 'a Free action');
  assert.equal(g.s.turn.move, null, 'it leaves no Move action open');
});

test('Eric the Red: alone, only to a Land space next to him, and only with Land units that are on board with him', () => {
  const { g, eric, sea, land } = aboard();
  const [crew] = troops(g, 0, 'infantry', elsewhere(g, sea));
  const [other] = troops(g, 0, 'infantry', land[1]);
  assert.match(refused(g, use('eric_b', { units: [eric.id, crew.id], to: land[0] })), /on board with Eric/);
  assert.match(refused(g, use('eric_b', { units: [eric.id, other.id], to: land[0] })), /on board with Eric/);
  refused(g, use('eric_b', { units: [eric.id], to: ring(g, sea, 3)[0] }));
  act(g, use('eric_b', { units: [eric.id], to: land[0] }));
  assert.equal(leaderUnit(g.s, 0).hex, land[0]);
  assert.match(refused(g, use('eric_b', { units: [eric.id], to: land[1] })), /on a Ship/);
});

/** Seat 0 plays Carthage with Hanno and two Ships on a Sea space two spaces from its capital. */
function fleet() {
  const { g, cap, unit } = lead('carthage', 'hanno');
  const near = ring(g, cap.hex, 1)[0];
  const sea = nbrs(g.s, near).find((k) => free(g, k) && hexDistance(k, cap.hex) === 2);
  const target = nbrs(g.s, sea).find((k) => free(g, k) && k !== near && hexDistance(k, cap.hex) >= 2);
  for (const k of [near, sea, target]) setTerrain(g, k, 'sea');
  unit.hex = sea;
  const ships = troops(g, 0, 'ship', sea, 2);
  return { g, cap, hanno: unit, sea, target, ships };
}

test('Hanno: a group of Ships that have not moved this turn sails with him as a Free action, and none of them moves again', () => {
  const { g, hanno, sea, target, ships } = fleet();
  assert.ok(offers(g, 'hanno_a').some((o) => o.action.to === target && o.action.ships.length === 2));
  act(g, use('hanno_a', { ships: ships.map((u) => u.id), to: target }));
  assert.deepEqual([...ships.map((u) => u.hex), hanno.hex], [target, target, target], 'the Ships and Hanno are on the new space');
  assert.equal(g.s.turn.actionsLeft, 3, 'a Free action');
  assert.equal(g.s.turn.unitFlags[ships[0].id].stopped, 'hanno');
  assert.equal(g.s.turn.move, null);
  assert.match(refused(g, { type: 'move', units: [ships[0].id], to: sea }), /./, 'the Ships of Hanno are not moved again this turn');
  assert.match(refused(g, use('hanno_a', { ships: ships.map((u) => u.id), to: sea })), /once per turn|have not moved/);
});

test('Hanno: not Ships that moved already this turn, not Ships of another space, only when he is on a Ship', () => {
  const { g, cap, target, sea, ships } = fleet();
  const [far] = troops(g, 0, 'ship', target);
  const ids = ships.map((u) => u.id);
  assert.match(refused(g, use('hanno_a', { ships: [far.id], to: sea })), /Choose the Ships/);
  assert.match(refused(g, use('hanno_a', { ships: [], to: target })), /Choose the Ships/);
  g.s.turn.unitFlags[ids[0]] = { moved: true };
  assert.match(refused(g, use('hanno_a', { ships: ids, to: target })), /not moved/);
  g.s.turn.unitFlags = {};
  leaderUnit(g.s, 0).hex = cap.hex;
  assert.match(refused(g, use('hanno_a', { ships: ids, to: target })), /on a Ship/);
});

test('Marqzen: an enemy player Land unit next to him moves 1 space to a revealed Land space not next to him, for an action, once per turn', () => {
  const { g, cap } = lead('aztecs', 'marqzen');
  const near = ring(g, cap.hex, 1)[0];
  const [foe] = troops(g, 1, 'infantry', near);
  const to = nbrs(g.s, near).find((k) => free(g, k) && hexDistance(k, cap.hex) === 2);
  assert.ok(offers(g, 'marqzen_b').some((o) => o.action.unit === foe.id && o.action.to === to));
  act(g, use('marqzen_b', { unit: foe.id, to }));
  assert.equal(foe.hex, to);
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.deepEqual(ofType(g.drainEvents(), 'move').map((e) => [e.player, e.to]), [[1, to]]);
  const [again] = troops(g, 1, 'infantry', ring(g, cap.hex, 1)[0]);
  assert.match(refused(g, use('marqzen_b', { unit: again.id, to })), /once per turn/);
});

test('Marqzen: only an enemy player Land unit next to him, only to a Land space next to the unit and not next to him, never into a battle', () => {
  const { g, cap } = lead('aztecs', 'marqzen');
  const [near, other, third] = ring(g, cap.hex, 1);
  const [foe] = troops(g, 1, 'infantry', near);
  const [mine] = troops(g, 0, 'infantry', other);
  const [wild] = barbarians(g, 'infantry', third);
  const away = nbrs(g.s, near).find((k) => free(g, k) && hexDistance(k, cap.hex) === 2);
  const beside = nbrs(g.s, near).find((k) => hexDistance(k, cap.hex) === 1);
  assert.match(refused(g, use('marqzen_b', { unit: mine.id, to: away })), /enemy player/);
  assert.match(refused(g, use('marqzen_b', { unit: wild.id, to: away })), /enemy player/);
  assert.match(refused(g, use('marqzen_b', { unit: foe.id, to: ring(g, cap.hex, 3)[0] })), /next to the unit/);
  assert.match(refused(g, use('marqzen_b', { unit: foe.id, to: beside })), /not be next to Marqzen/);
  troops(g, 0, 'infantry', away);
  assert.match(refused(g, use('marqzen_b', { unit: foe.id, to: away })), /battle/);
  const [far] = troops(g, 1, 'infantry', ring(g, cap.hex, 3)[0]);
  assert.match(refused(g, use('marqzen_b', { unit: far.id, to: away })), /enemy player/, 'a unit that is not next to him');
});
