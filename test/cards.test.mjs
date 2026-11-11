// Regressions for the 12 Action cards of source/action.csv: every test pins one rule of a civic (top) or combat (bottom) effect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_CARD_TYPES, ACTION_DECK_LIST, COMBAT_EFFECTS, EVENT_CARD_LIST, TOP_EFFECTS } from '../src/engine/data/cards.js';
import { addUnit } from '../src/engine/state.js';
import { heldModifier } from '../src/engine/core.js';
import { cityCapacity, collectCandidates, influenceBlocked, rapidPrice } from '../src/engine/city.js';
import { combatCardOptions, battle } from '../src/engine/combat.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { moveOptions } from '../src/engine/move.js';
import { scoreOf } from '../src/engine/scoring.js';
import { armyAt, hexDistance, nbrs, unitsLeft, unitsOf } from '../src/engine/queries.js';
import { BARBARIAN } from '../src/engine/data/constants.js';
import { answerPrompt } from '../src/ai/index.js';
import { checkInvariants } from './harness.mjs';
import { act, addCityAt, capitalOf, fresh, give, hold, kinds, landBattle, listen, neighbourWith, openLand, plains, readCsv, refused, rigDice, rigRolls, ringOf, settlerOf } from './scenario.mjs';

const me = (g) => g.s.players[0]; // refused actions restore the state, so objects are re-read each time
const NEW_CARDS = ACTION_CARD_TYPES.slice(21);
const OLD_EVENTS = 18;

/** Player 0 holds what every card needs: resources and tokens, Tactics, a second city with a Building, an Infantry at home, a Ship at sea and an enemy Infantry next door. */
function rich(seed = 'rich') {
  const g = fresh(seed);
  const cap = capitalOf(g);
  const ring = openLand(g, cap.hex, 2);
  const [one, two] = plains(g, ring, 1);
  const sea = ringOf(ring, 2)[0];
  g.s.map.hexes[sea].terrain = 'sea';
  give(g, 0, { res: { food: 2, wood: 3, ore: 3, gold: 3, ideas: 1 }, culture: 3, mood: 3, advances: ['tactics'] });
  cap.buildings.market = 0;
  addCityAt(g, 0, one).buildings.academy = 0;
  addUnit(g.s, 0, 'infantry', cap.hex);
  addUnit(g.s, 0, 'ship', sea);
  addUnit(g.s, 1, 'infantry', two);
  return g;
}

// ------------------------------------------------------------------------ data
test('the Action deck has 33 different cards, two copies of each: 66 cards', () => {
  assert.equal(ACTION_CARD_TYPES.length, 33);
  assert.equal(NEW_CARDS.length, 12);
  assert.equal(ACTION_DECK_LIST.length, 66);
  assert.equal(new Set(ACTION_CARD_TYPES.map((c) => c.id)).size, 33);
  assert.equal(new Set(ACTION_CARD_TYPES.map((c) => c.name)).size, 33);
  for (const c of ACTION_CARD_TYPES) assert.equal(ACTION_DECK_LIST.filter((id) => id === c.id).length, 2, c.id);
  const g = fresh();
  assert.equal(g.s.decks.action.length + g.s.players.reduce((n, p) => n + p.hand.action.length, 0), 66);
  assert.deepEqual(checkInvariants(g), []);
});

test('every Action card has a top and a combat effect that exist; the new ones have a name and a text too', () => {
  for (const c of ACTION_CARD_TYPES) {
    const top = TOP_EFFECTS[c.top];
    const combat = COMBAT_EFFECTS[c.combat];
    assert.ok(top && top.text, `${c.id}: top effect ${c.top}`);
    assert.ok(combat && combat.name && combat.text, `${c.id}: combat effect ${c.combat}`);
    assert.ok(['free', 'action', 'with'].includes(top.timing), `${c.id}: timing ${top.timing}`);
    assert.ok(['attacker', 'defender', 'any'].includes(combat.side) && ['land', 'sea', 'any'].includes(combat.domain), c.id);
  }
  for (const c of NEW_CARDS) assert.ok(TOP_EFFECTS[c.top].name, `${c.id}: the top effect has a name`);
});

test('Resource Surge, Rapid Construction and Soft Power are played together with a Collect, Construct and Influence action; the other new effects are free', () => {
  const timing = Object.fromEntries(NEW_CARDS.map((c) => [TOP_EFFECTS[c.top].name, TOP_EFFECTS[c.top].timing + (TOP_EFFECTS[c.top].with ? `:${TOP_EFFECTS[c.top].with}` : '')]));
  assert.deepEqual(timing, {
    'Resource Surge': 'with:collect',
    'Rapid Construction': 'with:construct',
    'Free Swap': 'free',
    'Tax Harvest': 'free',
    'Scouting Report': 'free',
    'Blitz Move': 'free',
    'Sailing Fleet': 'free',
    Reinforce: 'free',
    'Denial of Progress': 'free',
    'Spy Network': 'free',
    'Soft Power': 'with:influence',
    'Non-Aggression': 'free',
  });
});

const actionCsv = readCsv('action.csv');
test('source/action.csv: its 12 cards are in the game, with the same name for each top and bottom ability', { skip: actionCsv ? false : 'source/action.csv is not there' }, () => {
  const [header, ...rows] = actionCsv;
  assert.match(header.join(','), /Card Name.*Top Ability.*Bottom Ability/);
  assert.equal(rows.length, 12);
  const abilityName = (cell) => cell.split(':')[0].trim();
  for (const [name, top, bottom] of rows) {
    const card = ACTION_CARD_TYPES.find((c) => c.name === name);
    assert.ok(card, `${name} is not an Action card`);
    assert.equal(TOP_EFFECTS[card.top].name, abilityName(top), `${name}: top ability`);
    assert.equal(COMBAT_EFFECTS[card.combat].name, abilityName(bottom), `${name}: bottom ability`);
  }
  assert.deepEqual(rows.map((r) => r[0]).sort(), NEW_CARDS.map((c) => c.name).sort(), 'no card of the file is missing, none is invented');
});

const ICONS = { 'Barbarians Spawn': 'spawn', 'Exhausted Land': 'exhausted', 'Gold Mine': 'gold_mine', None: null };
const eventsCsv = readCsv('events.csv');
test('source/events.csv: its 38 events are in the game, each with the icon of the file', { skip: eventsCsv ? false : 'source/events.csv is not there' }, () => {
  const [header, ...rows] = eventsCsv;
  assert.match(header.join(','), /Card Name.*Immediate Icon.*Resolution Effects/);
  assert.equal(rows.length, 38);
  const ids = rows.map(([name, icon]) => {
    assert.ok(icon in ICONS, `unknown icon ${icon}`);
    const found = EVENT_CARD_LIST.filter((e) => e.name === name && e.icon === ICONS[icon]);
    assert.equal(found.length, 1, `${name} (${icon}) is one event`);
    return found[0].id;
  });
  assert.deepEqual([...ids].sort(), EVENT_CARD_LIST.slice(OLD_EVENTS).map((e) => e.id).sort(), 'the file holds exactly the new events');
});

test('the Event deck has 56 different cards; a new game shuffles all of them', () => {
  assert.equal(EVENT_CARD_LIST.length, 56);
  assert.equal(new Set(EVENT_CARD_LIST.map((e) => e.id)).size, 56);
  const g = fresh();
  assert.deepEqual([...g.s.decks.event, ...g.s.decks.eventDiscard].sort(), EVENT_CARD_LIST.map((e) => e.id).sort());
});

// ------------------------------------------------------------------- every card
test('every Action card can be played from a hand without crashing, and keeps the pieces and cards in order', () => {
  for (const c of ACTION_CARD_TYPES) {
    for (const make of [fresh, rich]) {
      const g = make(`play-${c.id}`);
      hold(g, 0, c.id);
      let r;
      assert.doesNotThrow(() => { r = g.apply({ type: 'play_card', card: c.id }); }, `${c.id} in a ${make.name} state`);
      assert.ok(r.ok || typeof r.error === 'string', c.id);
      assert.deepEqual(checkInvariants(g), [], `${c.id} in a ${make.name} state`);
      if (TOP_EFFECTS[c.top].timing === 'with') assert.equal(r.ok, false, `${c.id} is a modifier, not a Play Card action`);
    }
  }
});

test('in a game where everything is at hand each new free effect can be played', () => {
  for (const c of NEW_CARDS.filter((x) => TOP_EFFECTS[x.top].timing === 'free')) {
    const g = rich(`free-${c.id}`);
    hold(g, 0, c.id);
    const actions = g.s.turn.actionsLeft;
    act(g, { type: 'play_card', card: c.id });
    assert.equal(g.s.turn.actionsLeft, actions, `${c.id} is free`);
    assert.equal(me(g).hand.action.length, 0);
    assert.equal(g.s.decks.actionDiscard.at(-1), c.id);
    assert.ok(g.drainEvents().some((e) => e.type === 'card' && e.card === c.id && e.player === 0));
  }
});

// ----------------------------------------------------- cards played with an action
test('the three cards that go with another action cannot be played on their own', () => {
  for (const [id, message] of [
    ['mass_collect', /Resource Surge is played together with a Collect action, not on its own/],
    ['labor', /Rapid Construction is played together with a Construct action, not on its own/],
    ['assimilation', /Soft Power is played together with an Influence Culture action, not on its own/],
  ]) {
    const g = fresh();
    hold(g, 0, id);
    assert.match(refused(g, { type: 'play_card', card: id }), message);
    assert.deepEqual(me(g).hand.action, [id]);
  }
});

test('the Play Card list leaves out the cards that go with another action; heldModifier finds the one for an action', () => {
  const g = fresh();
  hold(g, 0, 'mass_collect', 'labor', 'assimilation', 'supply');
  assert.deepEqual(enumerateActions(g, 0).filter((c) => c.cat === 'card').map((c) => c.action.card), ['supply']);
  assert.equal(heldModifier(g.s, 0, 'collect').id, 'mass_collect');
  assert.equal(heldModifier(g.s, 0, 'construct').id, 'labor');
  assert.equal(heldModifier(g.s, 0, 'influence').id, 'assimilation');
  hold(g, 0, 'supply');
  for (const action of ['collect', 'construct', 'influence']) assert.equal(heldModifier(g.s, 0, action), null);
});

test('a card played with an action has to be in your hand and has to belong to that action', () => {
  const g = fresh();
  const cap = capitalOf(g);
  openLand(g, cap.hex, 1);
  const collect = { type: 'collect', city: cap.id, picks: [{ hex: collectCandidates(g.s, 0, cap)[0].hex }] };
  hold(g, 0, 'mass_collect');
  assert.match(refused(g, { ...collect, card: 'labor' }), /do not hold that card/);
  hold(g, 0, 'mass_collect', 'labor', 'assimilation', 'windfall');
  assert.match(refused(g, { ...collect, card: 'labor' }), /Forced Labor cannot be played with this action/);
  assert.match(refused(g, { ...collect, card: 'assimilation' }), /Cultural Assimilation cannot be played with this action/);
  assert.match(refused(g, { ...collect, card: 'windfall' }), /cannot be played with this action/);
  assert.match(refused(g, { type: 'construct', city: cap.id, building: 'fortress', card: 'mass_collect' }), /Mass Collection cannot be played with this action/);
  assert.match(refused(g, { type: 'influence', city: cap.id, target: cap.id, card: 'labor' }), /Forced Labor cannot be played with this action/);
});

// ---------------------------------------------------------------- Resource Surge
test('Resource Surge lets a city collect from 2 more spaces than normal, 1 resource per space, and the Collect still costs its action', () => {
  const g = fresh();
  const cap = capitalOf(g);
  openLand(g, cap.hex, 2);
  give(g, 0, { res: { food: 0, wood: 0, ore: 0 } });
  hold(g, 0, 'mass_collect');
  const spots = (res) => collectCandidates(g.s, 0, capitalOf(g)).filter((c) => c.opts[0] === res).map((c) => ({ hex: c.hex, res }));
  const four = [spots('wood')[0], spots('ore')[0], ...spots('food').slice(0, 2)];
  const collect = (picks, card) => ({ type: 'collect', city: cap.id, picks, ...(card && { card }) });
  assert.equal(cityCapacity(g.s, cap), 2, 'a Happy city of size 1 collects from 2 spaces');
  assert.match(refused(g, collect(four)), /at most 2 Resources/);
  assert.match(refused(g, collect([...four, spots('food')[2]], 'mass_collect')), /at most 4 Resources/);
  act(g, collect(four, 'mass_collect'));
  assert.deepEqual([me(g).res.food, me(g).res.wood, me(g).res.ore], [2, 1, 1]);
  assert.equal(g.s.turn.actionsLeft, 2, 'the Collect used one action, the card none');
  assert.deepEqual(me(g).hand.action, []);
  assert.equal(g.s.decks.actionDiscard.at(-1), 'mass_collect');
  const events = g.drainEvents();
  assert.ok(events.some((e) => e.type === 'card' && e.card === 'mass_collect'));
  assert.equal(events.find((e) => e.type === 'collect').picks.length, 4);
  assert.deepEqual(checkInvariants(g), []);
});

test('Resource Surge adds its 2 spaces to the capacity of an Angry city, too', () => {
  const g = fresh();
  const cap = capitalOf(g);
  openLand(g, cap.hex, 2);
  cap.mood = 'angry';
  hold(g, 0, 'mass_collect');
  const picks = collectCandidates(g.s, 0, cap).slice(0, 4).map((c) => ({ hex: c.hex }));
  assert.match(refused(g, { type: 'collect', city: cap.id, picks: picks.slice(0, 2) }), /at most 1 Resource\./);
  assert.match(refused(g, { type: 'collect', city: cap.id, picks, card: 'mass_collect' }), /at most 3 Resources/);
  act(g, { type: 'collect', city: cap.id, picks: picks.slice(0, 3), card: 'mass_collect' });
  assert.equal(g.s.decks.actionDiscard.at(-1), 'mass_collect');
});

// ------------------------------------------------------------ Rapid Construction
/** Player 0 holds Rapid Construction and Tactics (for a Fortress), with a second city so that the capital may grow. */
function builder(res, advances = ['tactics']) {
  const g = fresh();
  const cap = capitalOf(g);
  addCityAt(g, 0, neighbourWith(g, cap.hex, 'forest'));
  give(g, 0, { res, advances });
  hold(g, 0, 'labor');
  return { g, cap, build: (extra = {}) => ({ type: 'construct', city: cap.id, building: 'fortress', ...extra }) };
}
const stock = (g) => ['food', 'wood', 'ore'].map((r) => me(g).res[r]);

test('Rapid Construction makes a Building cost 1 resource less: the one you hold least of, unless you ask for another', () => {
  let t = builder({ food: 3, wood: 2, ore: 1 });
  act(t.g, t.build({ card: 'labor' }));
  assert.deepEqual(stock(t.g), [2, 1, 1], 'the Ore was held least, so it is the one that is waived');
  assert.equal(capitalOf(t.g).buildings.fortress, 0);
  assert.equal(t.g.s.turn.actionsLeft, 2, 'the Construct used one action, the card none');
  assert.deepEqual(me(t.g).hand.action, []);
  assert.equal(t.g.s.decks.actionDiscard.at(-1), 'labor');
  assert.ok(t.g.drainEvents().some((e) => e.type === 'card' && e.card === 'labor'));
  assert.deepEqual(checkInvariants(t.g), []);

  t = builder({ food: 3, wood: 2, ore: 1 });
  act(t.g, t.build({ card: 'labor', waive: 'food' }));
  assert.deepEqual(stock(t.g), [3, 1, 0]);
});

test('Rapid Construction lets you build when 1 resource is missing; without the card the same stock is refused', () => {
  const { g, build } = builder({ food: 1, wood: 1, ore: 0 });
  assert.match(refused(g, build()), /costs 1 Food, 1 Wood and 1 Ore/);
  act(g, build({ card: 'labor' }));
  assert.deepEqual(stock(g), [0, 0, 0]);
});

test('Rapid Construction does not help when 2 resources are missing, or when the resource you waive is not the one you lack', () => {
  const poor = builder({ food: 1, wood: 0, ore: 0 });
  assert.match(refused(poor.g, poor.build({ card: 'labor' })), /even with Rapid Construction/);
  assert.deepEqual(me(poor.g).hand.action, ['labor'], 'the card is kept when the action is refused');
  const asked = builder({ food: 0, wood: 1, ore: 3 });
  assert.match(refused(asked.g, asked.build({ card: 'labor', waive: 'ore' })), /even with Rapid Construction/);
  act(asked.g, asked.build({ card: 'labor' }));
  assert.deepEqual(stock(asked.g), [0, 0, 3 - 1], 'by default the missing Food is the one that is waived');
});

test('Rapid Construction also lowers the price of a Temple that State Religion already makes cheaper', () => {
  const { g, cap } = builder({ food: 0, wood: 1, ore: 0 }, ['myths', 'state_religion']);
  const temple = { type: 'construct', city: cap.id, building: 'temple' };
  assert.match(refused(g, temple), /costs/);
  act(g, { ...temple, card: 'labor' });
  assert.deepEqual(stock(g), [0, 0, 0]);
  assert.equal(capitalOf(g).buildings.temple, 0);
});

test('rapidPrice waives the resource asked for when it is owed, else the owed resource held least of', () => {
  const g = fresh();
  give(g, 0, { res: { food: 3, wood: 1, ore: 2 } });
  const all = { food: 1, wood: 1, ore: 1 };
  assert.deepEqual(rapidPrice(g.s, 0, all), { price: { food: 1, wood: 0, ore: 1 }, waived: 'wood' });
  assert.deepEqual(rapidPrice(g.s, 0, all, 'food'), { price: { food: 0, wood: 1, ore: 1 }, waived: 'food' });
  assert.deepEqual(rapidPrice(g.s, 0, { food: 0, wood: 1, ore: 1 }, 'food'), { price: { food: 0, wood: 0, ore: 1 }, waived: 'wood' }, 'nothing is owed in Food');
  give(g, 0, { res: { food: 1, wood: 1, ore: 1 } });
  assert.equal(rapidPrice(g.s, 0, all).waived, 'food', 'a tie goes to the first of Food, Wood and Ore');
});

// ------------------------------------------------------------------- Soft Power
/** Player 0 (a size 1 city: range 1) holds Soft Power; player 1 has a Temple in a city 2 spaces away and another 3 spaces away. */
function envoy() {
  const g = fresh();
  const cap = capitalOf(g);
  const ring = openLand(g, cap.hex, 3);
  const target = addCityAt(g, 1, plains(g, ring, 2)[0]);
  const distant = addCityAt(g, 1, plains(g, ring, 3)[0]);
  target.buildings.temple = 1;
  distant.buildings.temple = 1;
  hold(g, 0, 'assimilation');
  const influence = (extra = {}) => ({ type: 'influence', city: cap.id, target: target.id, ...extra });
  return { g, cap, target, distant, influence };
}

test('Soft Power adds 1 to the range of an Influence Culture action for free', () => {
  const { g, target, distant, influence } = envoy();
  assert.match(refused(g, influence()), /out of range/);
  assert.match(refused(g, { ...influence({ card: 'assimilation' }), target: distant.id }), /out of range/, 'range 2 does not reach 3 spaces');
  rigRolls(g, 6);
  act(g, influence({ card: 'assimilation' }));
  const event = g.drainEvents().find((e) => e.type === 'influence');
  assert.deepEqual([event.target, event.success, event.roll], [target.id, true, 6]);
  assert.equal(g.s.cities.find((c) => c.id === target.id).buildings.temple, 0, 'the Temple now has the colour of player 0');
  assert.equal(g.s.turn.actionsLeft, 2, 'the Influence used one action, the card none');
  assert.deepEqual(me(g).hand.action, []);
  assert.equal(g.s.decks.actionDiscard.at(-1), 'assimilation');
});

test('Soft Power is spent on a failed attempt, too', () => {
  const { g, target, influence } = envoy();
  rigRolls(g, 1);
  act(g, influence({ card: 'assimilation' }));
  assert.equal(g.drainEvents().find((e) => e.type === 'influence').success, false);
  assert.equal(g.s.cities.find((c) => c.id === target.id).buildings.temple, 1);
  assert.deepEqual(me(g).hand.action, []);
});

test('Soft Power stacks with the Culture boost: size 1 + 1 + 1 reaches 3 spaces', () => {
  const { g, distant, influence } = envoy();
  give(g, 0, { culture: 1 });
  const far = { ...influence({ card: 'assimilation' }), target: distant.id };
  assert.match(refused(g, { ...far, rangeBoost: 0 }), /out of range/);
  rigRolls(g, 6);
  act(g, { ...far, rangeBoost: 1 });
  assert.equal(me(g).culture, 0, 'only the boost costs Culture');
  assert.equal(g.s.cities.find((c) => c.id === distant.id).buildings.temple, 0);
});

test('Soft Power is no Culture boost: Devotion cannot block it, but it blocks the paid boost', () => {
  const { g, cap, target, influence } = envoy();
  give(g, 1, { advances: ['devotion'] });
  give(g, 0, { culture: 2 });
  assert.equal(influenceBlocked(g.s, 0, cap, target, 0, 1), null);
  assert.match(influenceBlocked(g.s, 0, cap, target, 1, 1), /cannot boost/);
  assert.match(refused(g, influence({ rangeBoost: 1 })), /cannot boost/);
  assert.match(refused(g, influence({ rangeBoost: 1, card: 'assimilation' })), /cannot boost/);
  act(g, influence({ card: 'assimilation' }));
  assert.equal(me(g).culture, 2);
  assert.deepEqual(me(g).hand.action, []);
});

// -------------------------------------------------------------------- Free Swap
test('Free Swap trades up to 3 of one resource for another, as far as the limits allow, and costs no action', () => {
  const g = fresh();
  give(g, 0, { res: { food: 0, wood: 5, ore: 0, ideas: 0, gold: 0 } });
  hold(g, 0, 'supply', 'supply');
  const swap = (extra) => ({ type: 'play_card', card: 'supply', ...extra });
  assert.match(refused(g, swap({ from: 'wood', to: 'ore', n: 4 })), /between 1 and 3 wood/);
  assert.match(refused(g, swap({ from: 'wood', to: 'ore', n: 0 })), /between 1 and 3 wood/);
  assert.match(refused(g, swap({ from: 'wood', to: 'food', n: 3 })), /between 1 and 2 wood/, 'only 2 Food fit under the limit');
  act(g, swap({ from: 'wood', to: 'ore', n: 3 }));
  assert.deepEqual(stock(g), [0, 2, 3]);
  assert.equal(g.s.turn.actionsLeft, 3);
  assert.deepEqual(me(g).hand.action, ['supply']);
  assert.equal(g.s.decks.actionDiscard.at(-1), 'supply');
  act(g, swap({ from: 'ore', to: 'gold', n: 2 }));
  assert.deepEqual([me(g).res.ore, me(g).res.gold], [1, 2]);
  assert.deepEqual(checkInvariants(g), []);
});

test('Free Swap asks what you give, what you get and how many when the action does not say', () => {
  const g = fresh();
  give(g, 0, { res: { food: 0, wood: 5, ore: 1, ideas: 0, gold: 0 } });
  hold(g, 0, 'supply');
  const asked = listen(g, 0, { pick_resource: (p) => (p.role === 'give' ? 'wood' : 'gold'), choice: '2' });
  act(g, { type: 'play_card', card: 'supply' });
  assert.deepEqual(asked.map((p) => [p.kind, p.role]), [['pick_resource', 'give'], ['pick_resource', 'get'], ['choice', undefined]]);
  assert.deepEqual(asked[0].options.map((o) => o.id), ['wood', 'ore'], 'only what you hold can be given');
  assert.deepEqual(asked[1].options.map((o) => o.id), ['food', 'ore', 'ideas', 'gold']);
  assert.deepEqual(asked[2].options.map((o) => o.id), ['1', '2', '3']);
  assert.deepEqual([me(g).res.wood, me(g).res.gold], [3, 2]);
});

test('Free Swap, when nobody chooses, gives what you hold most of for what you hold least of, as many as it can', () => {
  const g = fresh();
  give(g, 0, { res: { food: 1, wood: 5, ore: 2, ideas: 0, gold: 3 } });
  hold(g, 0, 'supply');
  const asked = listen(g, 0);
  act(g, { type: 'play_card', card: 'supply' });
  assert.deepEqual(asked.map((p) => p.default), ['wood', 'ideas', '3']);
  assert.deepEqual([me(g).res.wood, me(g).res.ideas], [2, 3]);
});

test('Free Swap needs something to give and room for what you get', () => {
  const empty = fresh();
  give(empty, 0, { res: { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0 } });
  hold(empty, 0, 'supply');
  assert.match(refused(empty, { type: 'play_card', card: 'supply' }), /nothing to swap/);
  assert.deepEqual(me(empty).hand.action, ['supply'], 'the card stays in your hand');
  const full = fresh();
  give(full, 0, { res: { food: 2, wood: 7, ore: 7, ideas: 7, gold: 7 } });
  hold(full, 0, 'supply');
  assert.match(refused(full, { type: 'play_card', card: 'supply' }), /no room/);
});

// ------------------------------------------------------------------ Tax Harvest
test('Tax Harvest pays 1 Gold for every 2 Buildings in your color, in any city', () => {
  const g = fresh();
  const cap = capitalOf(g);
  const ring = openLand(g, cap.hex, 2);
  const second = addCityAt(g, 0, plains(g, ring, 1)[0]);
  const foe = addCityAt(g, 1, plains(g, ring, 2)[0]);
  hold(g, 0, 'bureaucracy', 'bureaucracy');
  const tax = { type: 'play_card', card: 'bureaucracy' };
  give(g, 0, { res: { gold: 0 } });
  cap.buildings.market = 0;
  cap.buildings.temple = 1;
  const city = (c) => g.s.cities.find((x) => x.id === c.id); // refused actions restore the state: look the cities up again
  assert.match(refused(g, tax), /at least 2 Buildings in your color/, 'the Temple of player 1 does not count');
  city(second).buildings.academy = 0;
  act(g, tax);
  assert.equal(me(g).res.gold, 1);
  assert.equal(g.s.turn.actionsLeft, 3);
  assert.equal(g.s.decks.actionDiscard.at(-1), 'bureaucracy');
  me(g).hand.action.push(g.s.decks.actionDiscard.pop());
  city(second).buildings.temple = 0;
  act(g, tax);
  assert.equal(me(g).res.gold, 2, '3 Buildings pay 1 Gold: the odd one earns nothing');
  me(g).hand.action.push(g.s.decks.actionDiscard.pop());
  city(foe).buildings.fortress = 0; // an influenced Building counts, too
  act(g, tax);
  assert.equal(me(g).res.gold, 4, '4 Buildings pay 2 Gold');
  assert.deepEqual(checkInvariants(g), []);
});

// ------------------------------------------------- Scouting Report and Blitz Move
const move = (units, to) => ({ type: 'move', units, to });
const playCard = (card) => ({ type: 'play_card', card });

/** Player 0 has Tactics, a Settler and 2 Infantry at the capital, with Plains around it. */
function field(...cards) {
  const g = fresh();
  const cap = capitalOf(g);
  const ring = openLand(g, cap.hex, 3);
  give(g, 0, { advances: ['tactics'] });
  hold(g, 0, ...cards);
  const army = [addUnit(g.s, 0, 'infantry', cap.hex).id, addUnit(g.s, 0, 'infantry', cap.hex).id];
  return { g, cap, ring, army };
}
/** `[via, to]`: a space 2 steps from `from` that can only be reached through `via`; both are made Plains. */
function straight(g, from) {
  const next = nbrs(g.s, from);
  for (const via of next) {
    for (const to of nbrs(g.s, via)) {
      if (to === from || next.includes(to) || next.filter((m) => nbrs(g.s, to).includes(m)).length !== 1) continue;
      g.s.map.hexes[via].terrain = 'plains';
      g.s.map.hexes[to].terrain = 'plains';
      return [via, to];
    }
  }
  return assert.fail('no straight line of 2 spaces');
}

test('Scouting Report and Blitz Move need Tactics and an Army unit; a refusal keeps the card', () => {
  for (const card of ['high_ground_card', 'surprise']) {
    const g = fresh();
    hold(g, 0, card);
    assert.match(refused(g, playCard(card)), /need Tactics/);
    give(g, 0, { advances: ['tactics'] });
    assert.match(refused(g, playCard(card)), /no Army units to move/, 'a Settler is no Army unit');
    addUnit(g.s, 0, 'infantry', capitalOf(g).hex);
    act(g, playCard(card));
    assert.deepEqual(me(g).hand.action, []);
    assert.equal(g.s.decks.actionDiscard.at(-1), card);
    assert.equal(g.s.turn.actionsLeft, 3, 'playing the card is free');
  }
});

test('Scouting Report opens a free Move of 1 Army group that may step 2 spaces', () => {
  const { g, cap, army } = field('high_ground_card');
  const [, far] = straight(g, cap.hex);
  assert.match(refused(g, move(army, far)), /too far away/);
  act(g, playCard('high_ground_card'));
  assert.deepEqual(g.s.turn.move, { credits: 1, moved: {}, shipMoved: false, navUsed: false, only: 'army', scout: true, free: true });
  const three = nbrs(g.s, far).find((k) => hexDistance(cap.hex, k) === 3);
  g.s.map.hexes[three].terrain = 'plains';
  assert.match(refused(g, move(army, three)), /too far away/, '3 spaces are too many');
  act(g, move(army, far));
  assert.deepEqual(kinds(g, far), ['infantry', 'infantry']);
  assert.equal(g.s.turn.actionsLeft, 3, 'the step was free');
  assert.equal(g.s.turn.move.credits, 0);
});

test('Blitz Move opens a free Move of 1 Army group that steps 1 space', () => {
  const { g, cap, army } = field('surprise');
  const [via, far] = straight(g, cap.hex);
  act(g, playCard('surprise'));
  assert.deepEqual(g.s.turn.move, { credits: 1, moved: {}, shipMoved: false, navUsed: false, only: 'army', scout: false, free: true });
  assert.match(refused(g, move(army, far)), /too far away/);
  act(g, move(army, via));
  assert.deepEqual(kinds(g, via), ['infantry', 'infantry'], 'a group moves together');
  assert.equal(g.s.turn.actionsLeft, 3);
});

test('after its free step, the next group of a Scouting Report or Blitz Move is a Move action of its own', () => {
  const { g, cap, army } = field('surprise');
  const [one, two] = nbrs(g.s, cap.hex).filter((k) => g.s.map.hexes[k].terrain === 'plains');
  act(g, playCard('surprise'));
  act(g, move([army[0]], one));
  assert.equal(g.s.turn.actionsLeft, 3);
  act(g, move([army[1]], two));
  assert.equal(g.s.turn.actionsLeft, 2, 'the free step was used up');
  assert.equal(g.s.turn.move.credits, 2, 'and this one opened a normal Move of 3 steps');
  assert.equal(g.s.turn.move.only, undefined);
});

test('a group of another kind starts a normal Move even when a free one is open', () => {
  const { g, cap } = field('surprise');
  const [one] = nbrs(g.s, cap.hex).filter((k) => g.s.map.hexes[k].terrain === 'plains');
  act(g, playCard('surprise'));
  act(g, move([settlerOf(g).id], one));
  assert.equal(g.s.turn.actionsLeft, 2, 'Settlers are no Army: the Move costs an action');
  assert.equal(g.s.turn.move.free, undefined, 'and replaces the free Move');
});

test('a free Move card replaces a Move that is in progress, and the units that moved may move again', () => {
  const { g, cap, army } = field('surprise');
  const [one, two] = nbrs(g.s, cap.hex).filter((k) => g.s.map.hexes[k].terrain === 'plains');
  act(g, move([army[0]], one));
  assert.equal(g.s.turn.actionsLeft, 2);
  act(g, playCard('surprise'));
  assert.deepEqual(g.s.turn.move.moved, {});
  act(g, move([army[0]], two));
  assert.equal(g.s.turn.actionsLeft, 2, 'a free step from the card');
  assert.equal(g.s.units.find((u) => u.id === army[0]).hex, two);
});

test('Scouting Report cannot explore a new Region, attack from 2 spaces away, or pass through an enemy or a full space', () => {
  const hidden = field('high_ground_card');
  const [, far] = straight(hidden.g, hidden.cap.hex);
  act(hidden.g, playCard('high_ground_card'));
  hidden.g.s.map.hexes[far].terrain = null;
  assert.match(refused(hidden.g, move(hidden.army, far)), /cannot explore a new Region/);

  const attack = field('high_ground_card');
  const [, there] = straight(attack.g, attack.cap.hex);
  addUnit(attack.g.s, 1, 'infantry', there);
  act(attack.g, playCard('high_ground_card'));
  assert.match(refused(attack.g, move(attack.army, there)), /cannot attack: the enemy is two spaces away/);

  const blocked = field('high_ground_card');
  const [via, beyond] = straight(blocked.g, blocked.cap.hex);
  addUnit(blocked.g.s, 1, 'infantry', via);
  act(blocked.g, playCard('high_ground_card'));
  assert.match(refused(blocked.g, move(blocked.army, beyond)), /no clear path/);

  const crowded = field('high_ground_card');
  const [pass, onwards] = straight(crowded.g, crowded.cap.hex);
  for (let i = 0; i < 3; i++) addUnit(crowded.g.s, 0, 'infantry', pass);
  act(crowded.g, playCard('high_ground_card'));
  assert.match(refused(crowded.g, move(crowded.army, onwards)), /no clear path/, 'the 2 Units would not fit in the space they cross');
});

test('Scouting Report gives no 2-space step to an Army that leaves a Ship', () => {
  const { g, ring, army } = field('high_ground_card');
  const [sea] = lake(g, ring, 1);
  const [, inland] = straight(g, sea);
  const unit = g.s.units.find((u) => u.id === army[0]);
  addUnit(g.s, 0, 'ship', sea);
  unit.hex = sea;
  act(g, playCard('high_ground_card'));
  assert.match(refused(g, move([unit.id], inland)), /too far away/);
  const options = moveOptions(g, 0, [unit.id]);
  assert.ok(options.length > 0 && options.every((o) => hexDistance(sea, o.to) === 1), 'only the spaces next to the Ship');
});

test('Scouting Report can attack an enemy next door, as a free step', () => {
  const { g, cap, army } = field('high_ground_card');
  const [one] = nbrs(g.s, cap.hex).filter((k) => g.s.map.hexes[k].terrain === 'plains');
  addUnit(g.s, 1, 'infantry', one);
  act(g, playCard('high_ground_card'));
  act(g, move(army, one));
  assert.ok(g.drainEvents().some((e) => e.type === 'battle_round' && e.hex === one));
  assert.equal(g.s.turn.actionsLeft, 3);
});

test('a Scouting Report step ignores the Mountain and Forest penalties that stop a normal step', () => {
  const setup = (card) => {
    const t = field(card);
    const [next] = nbrs(t.g.s, t.cap.hex).filter((k) => t.g.s.map.hexes[k].terrain === 'plains');
    const beyond = nbrs(t.g.s, next).find((k) => k !== t.cap.hex && !nbrs(t.g.s, t.cap.hex).includes(k));
    t.g.s.map.hexes[beyond].terrain = 'plains';
    return { ...t, next, beyond };
  };
  for (const scouting of [false, true]) {
    const mountain = setup('high_ground_card');
    mountain.g.s.map.hexes[mountain.next].terrain = 'mountain';
    if (scouting) act(mountain.g, playCard('high_ground_card'));
    act(mountain.g, move([mountain.army[0]], mountain.next));
    const onwards = move([mountain.army[0]], mountain.beyond);
    if (scouting) act(mountain.g, onwards);
    else assert.match(refused(mountain.g, onwards), /stopped on a Mountain/);

    const forest = setup('high_ground_card');
    forest.g.s.map.hexes[forest.next].terrain = 'forest';
    addUnit(forest.g.s, 1, 'infantry', forest.beyond);
    if (scouting) act(forest.g, playCard('high_ground_card'));
    act(forest.g, move([forest.army[0]], forest.next));
    const attack = move([forest.army[0]], forest.beyond);
    if (scouting) {
      act(forest.g, attack);
      assert.ok(forest.g.drainEvents().some((e) => e.type === 'battle_round'));
    } else {
      assert.match(refused(forest.g, attack), /entered a Forest cannot attack/);
    }
  }
});

test('moveOptions marks the steps of a Scouting Report and lists the 2-space ones only then', () => {
  const { g, cap, army } = field('high_ground_card');
  const dist = (o) => hexDistance(cap.hex, o.to);
  const normal = moveOptions(g, 0, [army[0]]);
  assert.ok(normal.length > 0);
  assert.ok(normal.every((o) => dist(o) === 1 && !o.scout));
  act(g, playCard('high_ground_card'));
  const scouting = moveOptions(g, 0, [army[0]]);
  assert.ok(scouting.some((o) => dist(o) === 2));
  assert.ok(scouting.every((o) => o.scout && !o.fresh));
  const settler = moveOptions(g, 0, [settlerOf(g).id]);
  assert.ok(settler.every((o) => !o.scout && o.fresh && dist(o) === 1), 'the Settler is another group');
});

// ----------------------------------------------------------------- Sailing Fleet
/** `n` connected Sea spaces starting at a land space 2 steps from the capital. */
function lake(g, ring, n) {
  const found = [plains(g, ring, 2)[0]];
  for (let i = 0; i < found.length && found.length < n; i++) {
    for (const k of nbrs(g.s, found[i])) {
      if (found.length < n && !found.includes(k) && g.s.map.hexes[k].terrain === 'plains') found.push(k);
    }
  }
  for (const k of found) g.s.map.hexes[k].terrain = 'sea';
  return found;
}

test('Sailing Fleet needs a Ship, and opens 2 free Ship moves', () => {
  const dry = fresh();
  hold(dry, 0, 'escort');
  assert.match(refused(dry, playCard('escort')), /no Ships to move/);

  const g = fresh();
  const cap = capitalOf(g);
  const ring = openLand(g, cap.hex, 3);
  const water = lake(g, ring, 5);
  const ships = [0, 1, 2].map(() => addUnit(g.s, 0, 'ship', water[0]).id);
  hold(g, 0, 'escort');
  act(g, playCard('escort'));
  assert.deepEqual(g.s.turn.move, { credits: 2, moved: {}, shipMoved: false, navUsed: false, only: 'ships', scout: false, free: true });
  act(g, move([ships[0]], water[1]));
  act(g, move([ships[1]], water[2]));
  assert.equal(g.s.turn.actionsLeft, 3, 'two Ships sailed for free');
  act(g, move([ships[2]], water[3]));
  assert.equal(g.s.turn.actionsLeft, 2, 'the third Ship needs a Move action');
  assert.deepEqual(g.s.units.filter((u) => u.type === 'ship').map((u) => u.hex).sort(), [water[1], water[2], water[3]].sort());
});

test('a Ship that has sailed on Sailing Fleet cannot sail again for free, and a land group is paid for', () => {
  const g = fresh();
  const cap = capitalOf(g);
  const ring = openLand(g, cap.hex, 3);
  const water = lake(g, ring, 4);
  const ship = addUnit(g.s, 0, 'ship', water[0]).id;
  hold(g, 0, 'escort', 'escort');
  act(g, playCard('escort'));
  act(g, move([ship], water[1]));
  act(g, move([ship], water[2]));
  assert.equal(g.s.turn.actionsLeft, 2, 'the same Ship again is a Move action');
  assert.equal(g.s.turn.move.free, undefined);

  const land = fresh();
  const lake2 = lake(land, openLand(land, capitalOf(land).hex, 3), 3);
  addUnit(land.s, 0, 'ship', lake2[0]);
  hold(land, 0, 'escort');
  act(land, playCard('escort'));
  const [one] = nbrs(land.s, capitalOf(land).hex).filter((k) => land.s.map.hexes[k].terrain === 'plains');
  act(land, move([settlerOf(land).id], one));
  assert.equal(land.s.turn.actionsLeft, 2);
});

// -------------------------------------------------------------------- Reinforce
/** Player 0 holds 3 Reinforce cards; the capital has 2 free spaces around it to hold an enemy next door. */
function garrison() {
  const g = fresh();
  const cap = capitalOf(g);
  const ring = openLand(g, cap.hex, 2);
  hold(g, 0, 'garrison', 'garrison');
  return { g, cap, ring, play: (extra) => ({ type: 'play_card', card: 'garrison', ...extra }) };
}

test('Reinforce puts a free Infantry in a city that has an enemy Army next to it', () => {
  const { g, cap, ring, play } = garrison();
  assert.match(refused(g, play()), /None of your cities has an enemy Army next to it/);
  addUnit(g.s, 1, 'settler', plains(g, ring, 1)[0]);
  assert.match(refused(g, play()), /enemy Army next to it/, 'a Settler is no Army');
  addUnit(g.s, 1, 'cavalry', plains(g, ring, 2)[0]);
  assert.match(refused(g, play()), /enemy Army next to it/, 'two spaces away is not next to the city');
  assert.deepEqual(me(g).hand.action, ['garrison', 'garrison'], 'a refusal keeps the card');
  addUnit(g.s, 1, 'cavalry', plains(g, ring, 1)[1]);
  act(g, play());
  assert.deepEqual(kinds(g, cap.hex), ['infantry']);
  assert.equal(g.s.turn.actionsLeft, 3, 'the card is free');
  assert.equal(g.s.decks.actionDiscard.at(-1), 'garrison');
  const recruit = g.drainEvents().find((e) => e.type === 'recruit');
  assert.deepEqual([recruit.city, recruit.units], [cap.id, { infantry: 1 }]);
  assert.deepEqual(checkInvariants(g), []);
});

test('Reinforce counts Barbarians as an enemy Army, and a city with 4 Army units cannot take another', () => {
  const { g, cap, ring, play } = garrison();
  addUnit(g.s, BARBARIAN, 'infantry', plains(g, ring, 1)[0]);
  for (let i = 0; i < 4; i++) addUnit(g.s, 0, 'infantry', cap.hex);
  assert.match(refused(g, play()), /enemy Army next to it/, 'the city is full');
  g.s.units.splice(g.s.units.findIndex((u) => u.owner === 0 && u.type === 'infantry'), 1);
  act(g, play());
  assert.equal(armyAt(g.s, cap.hex, 0).length, 4);
});

test('Reinforce is not for your own Army next to a city', () => {
  const { g, ring, play } = garrison();
  addUnit(g.s, 0, 'infantry', plains(g, ring, 1)[0]);
  assert.match(refused(g, play()), /enemy Army next to it/);
});

test('Reinforce takes the city from the action, or asks when several cities qualify', () => {
  const { g, cap, ring, play } = garrison();
  const [near, apart] = plains(g, ring, 1);
  const second = addCityAt(g, 0, plains(g, ring, 2)[0]);
  addUnit(g.s, 1, 'infantry', near);
  addUnit(g.s, 1, 'infantry', nbrs(g.s, second.hex).find((k) => g.s.map.hexes[k].terrain === 'plains' && k !== apart && k !== cap.hex && !nbrs(g.s, cap.hex).includes(k)));
  assert.match(refused(g, play({ city: 'nowhere' })), /Choose a valid city/);
  const asked = listen(g, 0);
  act(g, play({ city: second.id }));
  assert.deepEqual(asked, [], 'the action named the city');
  assert.deepEqual([armyAt(g.s, second.hex, 0).length, armyAt(g.s, cap.hex, 0).length], [1, 0]);
  const choice = listen(g, 0, { pick_cities: [cap.id] });
  act(g, play());
  assert.deepEqual(choice[0].options.map((o) => o.id).sort(), [cap.id, second.id].sort());
  assert.equal(armyAt(g.s, cap.hex, 0).length, 1);
});

test('Reinforce uses an Infantry from elsewhere on the map when all 16 are in play', () => {
  const { g, cap, ring, play } = garrison();
  addUnit(g.s, 1, 'infantry', plains(g, ring, 1)[0]);
  const spots = plains(g, ring, 2);
  for (let i = 0; unitsLeft(g.s, 0, 'infantry') > 0; i++) addUnit(g.s, 0, 'infantry', spots[Math.floor(i / 4)]);
  act(g, play());
  assert.equal(unitsOf(g.s, 0, 'infantry').length, 16);
  assert.equal(armyAt(g.s, cap.hex, 0).length, 1);
});

// ------------------------------------------------------------ Denial of Progress
test('Denial of Progress costs 1 Culture; the opponent has 1 action fewer on the next turn only', () => {
  const g = fresh();
  hold(g, 0, 'sabotage', 'sabotage');
  const denial = playCard('sabotage');
  assert.match(refused(g, denial), /need 1 Culture token/);
  give(g, 0, { culture: 2 });
  act(g, denial);
  assert.equal(me(g).culture, 1);
  assert.equal(g.s.turn.actionsLeft, 3, 'the card is free');
  assert.equal(g.s.players[1].denied, 1);
  assert.match(refused(g, denial), /already has 1 action fewer/, 'the only opponent is already denied');
  act(g, { type: 'end_turn' });
  assert.equal(g.cur, 1);
  assert.equal(g.s.turn.actionsLeft, 2);
  assert.equal(g.s.players[1].denied, 0);
  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  assert.equal(g.cur, 1);
  assert.equal(g.s.turn.actionsLeft, 3, 'it was for one turn');
});

test('Denial of Progress hits the opponent chosen, else the one with the best score', () => {
  const g = fresh('denial', { opponents: 2 });
  give(g, 2, { advances: ['storage', 'irrigation', 'husbandry', 'sanitation', 'roads'] });
  assert.ok(scoreOf(g.s, 2).total > scoreOf(g.s, 1).total);
  give(g, 0, { culture: 3 });
  hold(g, 0, 'sabotage', 'sabotage');
  const asked = listen(g, 0);
  act(g, playCard('sabotage'));
  assert.equal(asked[0].default, '2');
  assert.deepEqual(g.s.players.map((p) => p.denied || 0), [0, 0, 1]);
  hold(g, 0, 'sabotage');
  act(g, { ...playCard('sabotage'), player: 1 });
  assert.deepEqual(g.s.players.map((p) => p.denied || 0), [0, 1, 1]);
  assert.equal(me(g).culture, 1);
});

// --------------------------------------------------------------------- Spy Network
test('Spy Network makes an opponent discard one copy of an Action or Objective card that you choose', () => {
  const g = fresh();
  hold(g, 0, 'infiltration', 'infiltration');
  hold(g, 1, 'windfall', 'windfall', 'harvest');
  const objective = g.s.players[1].hand.objective[0];
  const spy = (extra) => ({ ...playCard('infiltration'), player: 1, ...extra });
  act(g, spy({ deck: 'action', target: 'windfall' }));
  assert.deepEqual(g.s.players[1].hand.action, ['windfall', 'harvest']);
  assert.equal(g.s.decks.actionDiscard.at(-1), 'windfall');
  assert.equal(g.s.turn.actionsLeft, 3, 'the card is free');
  act(g, spy({ deck: 'objective', target: objective }));
  assert.deepEqual(g.s.players[1].hand.objective, []);
  assert.equal(g.s.decks.objectiveDiscard.at(-1), objective);
  assert.deepEqual(checkInvariants(g), []);
});

test('Spy Network asks for the deck and the card; its default is an Objective card', () => {
  const g = fresh();
  hold(g, 0, 'infiltration', 'infiltration');
  hold(g, 1, 'windfall', 'harvest');
  const objective = g.s.players[1].hand.objective[0];
  const first = listen(g, 0);
  act(g, playCard('infiltration'));
  assert.equal(first.length, 1, 'with 1 Objective card there is nothing to choose in that deck');
  assert.deepEqual(first[0].options.map((o) => o.id), ['objective', 'action']);
  assert.equal(first[0].default, 'objective');
  assert.deepEqual(g.s.players[1].hand.objective, []);
  assert.equal(g.s.decks.objectiveDiscard.at(-1), objective);
  const second = listen(g, 0, { choice: (p) => (p.options[0].id === 'windfall' ? 'harvest' : 'action') });
  act(g, playCard('infiltration'));
  assert.equal(second.length, 1, 'only 1 deck is left: just the card is asked');
  assert.deepEqual(second[0].options.map((o) => o.label), ["Scholars' Windfall", 'Bountiful Harvest']);
  assert.deepEqual(g.s.players[1].hand.action, ['windfall']);
});

test('Spy Network needs an opponent who holds a card; the refusal keeps the card', () => {
  const g = fresh();
  hold(g, 0, 'infiltration');
  hold(g, 1);
  g.s.decks.objective.unshift(...g.s.players[1].hand.objective);
  g.s.players[1].hand.objective = [];
  assert.match(refused(g, playCard('infiltration')), /No opponent holds an Action or Objective card/);
  assert.deepEqual(me(g).hand.action, ['infiltration']);
});

test('Spy Network, when nobody chooses, looks at the opponent who holds the most cards', () => {
  const g = fresh('spy', { opponents: 2 });
  hold(g, 0, 'infiltration');
  hold(g, 1, 'windfall');
  hold(g, 2, 'windfall', 'harvest', 'timber');
  const asked = listen(g, 0);
  act(g, playCard('infiltration'));
  assert.deepEqual(asked[0].options.map((o) => o.id), ['1', '2']);
  assert.equal(asked[0].default, '2');
  assert.deepEqual(g.s.players.map((p) => p.hand.objective.length), [1, 1, 0], 'the Objective card of player 2 was discarded');
});

// ------------------------------------------------------------------ Non-Aggression
/** Player 0 has an Infantry on A next to its capital; each opponent has an Infantry on another space next to A. */
function standoff(opponents = 1) {
  const g = fresh('standoff', { opponents });
  const cap = capitalOf(g);
  openLand(g, cap.hex, 2);
  const a = nbrs(g.s, cap.hex).find((k) => g.s.map.hexes[k].terrain === 'plains');
  const next = nbrs(g.s, a).filter((k) => k !== cap.hex && g.s.map.hexes[k].terrain === 'plains');
  for (let p = 0; p <= opponents; p++) give(g, p, { advances: ['tactics'] });
  const mine = addUnit(g.s, 0, 'infantry', a).id;
  const theirs = Array.from({ length: opponents }, (_, i) => addUnit(g.s, i + 1, 'infantry', next[i]).id);
  hold(g, 0, 'immunity', 'immunity');
  return { g, cap, a, mine, theirs, next, protect: (foe) => ({ ...playCard('immunity'), player: foe }) };
}
const battles = (g) => g.drainEvents().filter((e) => e.type === 'battle_round');

test('Non-Aggression stops the Army of one opponent from entering your spaces until the end of the round', () => {
  const { g, cap, a, theirs, protect } = standoff();
  act(g, protect(1));
  assert.equal(g.s.turn.actionsLeft, 3, 'the card is free');
  assert.deepEqual(g.s.flags.protect, [{ by: 0, foe: 1 }]);
  assert.match(refused(g, protect(1)), /already protected from every opponent/);
  act(g, { type: 'end_turn' });
  assert.match(refused(g, move([theirs[0]], a)), /has played Non-Aggression: you cannot enter their spaces this round/, 'a space with your units');
  const side = nbrs(g.s, cap.hex).find((k) => k !== a && nbrs(g.s, a).includes(k));
  g.s.units.find((u) => u.id === theirs[0]).hex = side;
  assert.match(refused(g, move([theirs[0]], cap.hex)), /Non-Aggression/, 'a space with your city');
  const empty = nbrs(g.s, side).find((k) => k !== cap.hex && k !== a && g.s.map.hexes[k].terrain === 'plains' && !g.s.units.some((u) => u.hex === k));
  act(g, move([theirs[0]], empty));
  assert.deepEqual(battles(g), [], 'an empty space is fine');
});

test('Non-Aggression is one-sided: you may still attack, and it ends with the round', () => {
  const { g, mine, next, protect } = standoff();
  act(g, protect(1));
  act(g, move([mine], next[0]));
  assert.ok(battles(g).some((e) => e.hex === next[0]), 'the player who plays it can attack');
  act(g, { type: 'end_turn' });
  act(g, { type: 'end_turn' });
  assert.equal(g.s.round, 2, 'a new round has begun');
  assert.equal(g.s.flags.protect, undefined);
});

test('Non-Aggression protects against the opponent named only', () => {
  const { g, a, theirs, protect } = standoff(2);
  act(g, protect(1));
  act(g, { type: 'end_turn' });
  assert.match(refused(g, move([theirs[0]], a)), /Non-Aggression/);
  act(g, { type: 'end_turn' });
  assert.equal(g.cur, 2);
  act(g, move([theirs[1]], a));
  assert.ok(battles(g).some((e) => e.hex === a), 'the other opponent may attack');
});

test('Non-Aggression is for 1 opponent at a time: with 2 it can be played on each', () => {
  const { g, protect } = standoff(2);
  act(g, protect(1));
  act(g, protect(2));
  assert.deepEqual(g.s.flags.protect, [{ by: 0, foe: 1 }, { by: 0, foe: 2 }]);
});

test('Non-Aggression, when nobody chooses, protects you from the opponent with the largest Army', () => {
  const { g, next } = standoff(2);
  addUnit(g.s, 2, 'infantry', next[1]);
  addUnit(g.s, 2, 'cavalry', next[1]);
  const asked = listen(g, 0);
  act(g, playCard('immunity'));
  assert.deepEqual(asked.map((p) => p.default), ['2']);
  assert.deepEqual(g.s.flags.protect, [{ by: 0, foe: 2 }]);
});

test('Non-Aggression protects a city of yours that has no units in it', () => {
  const { g, cap, a, next, theirs, protect } = standoff();
  const spot = nbrs(g.s, next[0]).find((k) => k !== a && k !== cap.hex && !g.s.units.some((u) => u.hex === k) && !g.s.cities.some((c) => c.hex === k));
  g.s.map.hexes[spot].terrain = 'plains';
  const town = addCityAt(g, 0, spot);
  act(g, protect(1));
  act(g, { type: 'end_turn' });
  assert.match(refused(g, move([theirs[0]], town.hex)), /Non-Aggression/);
});

// ----------------------------------------------------------------- combat cards: who may play what
const plain = (v) => (v === 1 ? [1, 'leader'] : [v, 'elephant']); // a face of the Combat die without a Clash icon
const BASE = {
  units: 2, infantry: 2, enemyFortress: false, foe: 2, round: 1, kills: 0, losses: 1,
  nearCity: false, supplied: false, foeClash: false, flank: false, ownFortress: false, foeInfantry: false, canDisengage: false,
};
// card, who may play it, in which battles, and what has to be true of the battle
const COMBAT_CARDS = [
  ['mass_collect', 'any', 'any', { kills: 1 }],
  ['labor', 'any', 'any', { nearCity: true }],
  ['supply', 'any', 'land', { supplied: true }],
  ['bureaucracy', 'any', 'any', {}],
  ['high_ground_card', 'any', 'land', { foeClash: true }],
  ['surprise', 'attacker', 'land', { flank: true }],
  ['escort', 'any', 'sea', {}],
  ['garrison', 'defender', 'land', { ownFortress: true }],
  ['sabotage', 'any', 'any', {}],
  ['infiltration', 'any', 'any', {}],
  ['assimilation', 'any', 'land', { foeInfantry: true }],
  ['immunity', 'any', 'land', { canDisengage: true }],
];

test('each new combat card is offered only to its side, in its kind of battle, and when its condition holds', () => {
  const g = fresh();
  give(g, 0, { advances: ['tactics'], res: { gold: 1 } });
  const offered = (card, role, domain, info) => {
    hold(g, 0, card);
    return combatCardOptions(g, 0, { domain }, role, { ...BASE, ...info }).map((o) => o.id);
  };
  assert.deepEqual(COMBAT_CARDS.map(([card]) => card).sort(), NEW_CARDS.map((c) => c.id).sort(), 'every new card is in the table');
  for (const [card, side, where, needs] of COMBAT_CARDS) {
    for (const role of ['attacker', 'defender']) {
      for (const domain of ['land', 'sea']) {
        const fits = (side === 'any' || side === role) && (where === 'any' || where === domain);
        const label = `${card} as the ${role} in a ${domain} battle`;
        assert.deepEqual(offered(card, role, domain, needs), fits ? [card] : [], label);
        if (fits && Object.keys(needs).length) assert.deepEqual(offered(card, role, domain, {}), [], `${label} without its condition`);
      }
    }
  }
  assert.deepEqual(offered('mass_collect', 'attacker', 'land', { kills: 2, losses: 2 }), ['mass_collect'], 'as many killed as lost is enough');
});

test('combat cards need Tactics and Units to fight with, are listed once, cost what they cost, and are never offered to Barbarians', () => {
  const g = fresh();
  hold(g, 0, 'sabotage', 'sabotage', 'infiltration');
  const options = (p = 0, info = BASE) => combatCardOptions(g, p, { domain: 'land' }, 'attacker', info);
  assert.deepEqual(options(), [], 'no Tactics');
  give(g, 0, { advances: ['tactics'] });
  assert.deepEqual(options().map((o) => o.id), ['sabotage', 'infiltration'], 'a card held twice is listed once');
  assert.deepEqual(options(0, { ...BASE, units: 0 }), [], 'no Unit left to fight with');
  assert.deepEqual(options(BARBARIAN), []);
  const [confusion] = options();
  assert.deepEqual({ ...confusion, desc: confusion.desc.slice(0, 11) }, { id: 'sabotage', label: 'Political Sabotage', desc: 'Confusion: ', effect: 'confusion' });
  hold(g, 0, 'bureaucracy');
  assert.deepEqual(options(), [], 'Financial Incentive needs 1 Gold');
  me(g).res.gold = 1;
  assert.deepEqual(options().map((o) => o.id), ['bureaucracy']);
});

// ------------------------------------------------------------------ combat cards: in a battle
/** Fix the dice, answer the questions of both players (the attacker stops after round 1 unless `stop` says otherwise) and fight. */
function fight(g, ctx, { play, foePlay, dice, stop = 'yes' }) {
  const asked = [listen(g, 0, { combat_card: play ?? 'none', retreat: stop }), listen(g, 1, { combat_card: foePlay ?? 'none' })];
  if (dice) rigDice(g, ...dice);
  g.drainEvents();
  g._run(battle(g, ctx));
  const events = g.drainEvents();
  return {
    g,
    asked: asked.map((list) => list.filter((q) => q.kind === 'combat_card')),
    events,
    round: events.find((e) => e.type === 'battle_round'),
    end: events.find((e) => e.type === 'battle_end'),
  };
}

/**
 * Player 0 attacks player 1 on a Plains space next to its capital; both have Tactics and the cards in `cards` and `foeCards`.
 * `units` and `foes` are the types of the two armies. `prepare(g, { cap, spot, ring })` may change the table, `ctx` (an object or
 * a function of the same arguments) changes the battle.
 */
function duel({ units = ['infantry'], foes = ['infantry'], cards = [], foeCards = [], gold = 0, ctx, prepare, ...rest } = {}) {
  const g = fresh('duel');
  const cap = capitalOf(g);
  const ring = openLand(g, cap.hex, 2);
  const [spot] = plains(g, ring, 1);
  give(g, 0, { advances: ['tactics'], res: { gold } });
  give(g, 1, { advances: ['tactics'] });
  hold(g, 0, ...cards);
  hold(g, 1, ...foeCards);
  const mine = units.map((type) => addUnit(g.s, 0, type, cap.hex).id);
  for (const type of foes) addUnit(g.s, 1, type, spot);
  const at = { cap, spot, ring };
  prepare?.(g, at);
  const extra = typeof ctx === 'function' ? ctx(g, at) : ctx;
  return { ...at, ...fight(g, { ...landBattle(0, 1, spot, cap.hex, mine), ...extra }, rest) };
}

/** The Ships of player 0 attack the Ships of player 1 on the next Sea space. */
function fleets({ ships = 2, foes = 2, cards = [], foeCards = [], advances = [], foeAdvances = [], ...rest } = {}) {
  const g = fresh('fleets');
  const cap = capitalOf(g);
  const [from, hex] = lake(g, openLand(g, cap.hex, 3), 2);
  give(g, 0, { advances: ['tactics', ...advances] });
  give(g, 1, { advances: ['tactics', ...foeAdvances] });
  hold(g, 0, ...cards);
  hold(g, 1, ...foeCards);
  const mine = Array.from({ length: ships }, () => addUnit(g.s, 0, 'ship', from).id);
  for (let i = 0; i < foes; i++) addUnit(g.s, 1, 'ship', hex);
  const ctx = { domain: 'sea', attacker: 0, defender: 1, hex, from, units: mine, settlers: [], carried: [], landed: false, inPlace: false };
  return { from, hex, ...fight(g, ctx, rest) };
}

/** A city of player 1 on a Plains space next to the battle space. */
const cityNextTo = (g, { cap, spot }) => {
  const k = nbrs(g.s, spot).find((h) => h !== cap.hex && g.s.map.hexes[h].terrain === 'plains' && !g.s.units.some((u) => u.hex === h));
  return addCityAt(g, 1, k);
};
/** A Fortress in the city of player 1 on the battle space. */
const fortified = (g, { spot }) => {
  addCityAt(g, 1, spot).buildings.fortress = 1;
};
/** The attackers come from a Plains space next to the battle space that is 2 steps from the capital, so no city of theirs is near it. */
const outpost = (g, { spot, ring }) => ({
  from: nbrs(g.s, spot).find((k) => ringOf(ring, 2).includes(k) && g.s.map.hexes[k].terrain === 'plains'),
});

test('Routing Army (Mass Collection) adds 3 to the CV of the army that plays it, and the card is used up', () => {
  const dice = [plain(2), plain(1)];
  const played = duel({ cards: ['mass_collect'], play: 'mass_collect', dice });
  const { a, d } = played.round;
  assert.deepEqual([a.card, a.mod, a.cv, a.hits, d.lost], ['mass_collect', 3, 5, 1, 1]);
  assert.deepEqual(me(played.g).hand.action, []);
  assert.equal(played.g.s.decks.actionDiscard.at(-1), 'mass_collect');

  const held = duel({ cards: ['mass_collect'], dice });
  assert.deepEqual([held.round.a.card, held.round.a.mod, held.round.a.cv, held.round.a.hits, held.round.d.lost], [null, 0, 2, 0, 0]);
  assert.deepEqual(me(held.g).hand.action, ['mass_collect'], 'a card that is not played stays in the hand');

  const defending = duel({ foeCards: ['mass_collect'], foePlay: 'mass_collect', dice });
  assert.deepEqual([defending.round.d.mod, defending.round.d.cv, defending.round.a.lost], [3, 4, 0], 'the defender gets the 3 too');
});

test('Routing Army is offered in a later round only to the side that has killed at least as many Units as it has lost', () => {
  const t = duel({
    units: ['infantry', 'infantry'],
    foes: ['infantry', 'infantry'],
    cards: ['mass_collect'],
    foeCards: ['mass_collect'],
    dice: [plain(1), plain(1), [5, 'cavalry'], plain(1)],
    stop: (q) => (q.info.round >= 2 ? 'yes' : 'no'),
  });
  assert.deepEqual([t.round.a.lost, t.round.d.lost], [1, 0], 'round 1: the attacker loses a Unit and kills none');
  assert.equal(t.asked[0].length, 1, 'the attacker is asked in round 1 only');
  assert.equal(t.asked[1].length, 2, 'the defender is asked in both rounds');
  assert.deepEqual(t.asked[1][1].info.kills - t.asked[1][1].info.losses, 1);
});

test('Desperate Defense (Forced Labor) cancels 1 hit, but only near a city of yours', () => {
  const dice = [plain(1), [6, 'infantry']];
  const saved = duel({ cards: ['labor'], play: 'labor', foeCards: ['labor'], dice });
  assert.deepEqual([saved.round.d.hits, saved.round.cancelA, saved.round.a.lost], [1, 1, 0]);
  assert.equal(saved.asked[1].length, 0, 'the defender has no city of its own near the space');

  const lost = duel({ cards: ['labor'], dice });
  assert.deepEqual([lost.round.d.hits, lost.round.cancelA, lost.round.a.lost], [1, 0, 1]);

  const home = duel({ foeCards: ['labor'], foePlay: 'labor', prepare: cityNextTo, dice: [[6, 'infantry'], plain(1)] });
  assert.deepEqual([home.round.a.hits, home.round.cancelD, home.round.d.lost], [1, 1, 0], 'a defender with a city next door cancels a hit');
});

test('Supply Lines (Bountiful Supply) adds a die, to an army with a city of its owner in or next to the space it fights from', () => {
  const more = duel({ cards: ['supply'], play: 'supply', dice: [plain(2), plain(3), plain(1)] });
  assert.deepEqual([more.round.a.dice.length, more.round.a.cv, more.round.a.hits, more.round.d.lost], [2, 5, 1, 1]);
  const one = duel({ cards: ['supply'], dice: [plain(2), plain(1)] });
  assert.deepEqual([one.round.a.dice.length, one.round.a.cv, one.round.a.hits], [1, 2, 0]);

  const cut = duel({ cards: ['supply'], play: 'supply', ctx: outpost });
  assert.equal(cut.asked[0].length, 0, 'it is the space the army comes from that counts, and no city is near it');

  const defending = duel({ foeCards: ['supply'], foePlay: 'supply', prepare: cityNextTo, dice: [plain(1), plain(2), plain(3)] });
  assert.deepEqual([defending.round.d.dice.length, defending.round.d.cv, defending.round.a.lost], [2, 5, 1]);
  const far = duel({ foeCards: ['supply'], foePlay: 'supply' });
  assert.equal(far.asked[1].length, 0, 'a defender with no city near the space is not supplied');
});

test('Financial Incentive (Bureaucracy) pays 1 Gold for +1 CV, and is not offered without Gold', () => {
  const dice = [plain(4), plain(1)];
  const paid = duel({ cards: ['bureaucracy'], play: 'bureaucracy', gold: 2, dice });
  assert.deepEqual([paid.round.a.mod, paid.round.a.cv, paid.round.a.hits, paid.round.d.lost], [1, 5, 1, 1]);
  assert.equal(me(paid.g).res.gold, 1);

  const broke = duel({ cards: ['bureaucracy'], play: 'bureaucracy', gold: 0, dice });
  assert.equal(broke.asked[0].length, 0);
  assert.deepEqual([broke.round.a.cv, broke.round.d.lost], [4, 0]);
});

test('High Ground Combat (High Ground) takes the clash bonus from the opponent, and only from the opponent', () => {
  const same = { units: ['infantry', 'infantry'], foes: ['infantry', 'infantry'], cards: ['high_ground_card'] };
  const dice = [[3, 'infantry'], plain(1), [3, 'infantry'], plain(1)];
  const blocked = duel({ ...same, play: 'high_ground_card', dice });
  const { a, d, notes } = blocked.round;
  assert.deepEqual([a.bonus, a.cv, d.bonus, d.cv], [1, 5, 0, 4]);
  assert.deepEqual([a.lost, d.lost], [0, 1]);
  assert.deepEqual(notes, [`High Ground Combat: ${blocked.g.name(1)} gets no clash bonus.`]);

  const open = duel({ ...same, dice });
  assert.deepEqual([open.round.d.bonus, open.round.d.cv, open.round.a.lost, open.round.d.lost], [1, 5, 1, 1]);

  const horse = { foes: ['infantry', 'cavalry'], cards: ['high_ground_card'], dice: [plain(1), plain(1), [2, 'cavalry']] };
  const charge = duel(horse);
  assert.deepEqual([charge.round.d.cavalry, charge.round.d.cv, charge.round.a.lost], [2, 5, 1], 'a Cavalry charge is worth 2 CV');
  const stopped = duel({ ...horse, play: 'high_ground_card' });
  assert.deepEqual([stopped.round.d.cavalry, stopped.round.d.cv, stopped.round.a.lost], [0, 3, 0]);

  const walls = duel({ foes: [], cards: ['high_ground_card'], prepare: fortified });
  assert.equal(walls.asked[0].length, 0, 'a Fortress with no Unit behind it has no clash bonus to take away');
});

test('Flanking Maneuver (Surprise March) adds 1 CV to an attacker that comes from another land space', () => {
  const dice = [plain(4), plain(1)];
  const { round } = duel({ cards: ['surprise'], play: 'surprise', dice });
  assert.deepEqual([round.a.mod, round.a.cv, round.a.hits, round.d.lost], [1, 5, 1, 1]);
  assert.equal(duel({ foeCards: ['surprise'], foePlay: 'surprise' }).asked[1].length, 0, 'a defender cannot flank');
  assert.equal(duel({ cards: ['surprise'], ctx: { landed: true } }).asked[0].length, 0, 'an army that lands from a Ship cannot');
  assert.equal(duel({ cards: ['surprise'], ctx: { from: null } }).asked[0].length, 0, 'nor can one with no space to come from');
  assert.equal(duel({ cards: ['surprise'], ctx: { inPlace: true } }).asked[0].length, 0, 'nor one that fights where it stands');
});

test('a Move that attacks asks the attacker for a combat card, and Flanking Maneuver counts for it', () => {
  const { g, mine, next } = standoff();
  hold(g, 0, 'surprise');
  const asked = listen(g, 0, { combat_card: 'surprise', retreat: 'yes' });
  act(g, move([mine], next[0]));
  const [round] = battles(g);
  assert.deepEqual([round.a.card, round.a.mod], ['surprise', 1]);
  const prompt = asked.find((q) => q.kind === 'combat_card');
  assert.deepEqual(prompt.options.map((o) => o.id), ['none', 'surprise']);
  assert.equal(prompt.info.flank, true);
});

test('Wall Defense (Garrison Command) adds 2 CV to a defender whose city has a Fortress', () => {
  const dice = [plain(1), plain(1), plain(2)];
  const held = duel({ foeCards: ['garrison'], foePlay: 'garrison', prepare: fortified, dice });
  const { a, d } = held.round;
  assert.deepEqual([d.fortress, d.dice.length, d.mod, d.cv, d.hits, a.lost], [true, 2, 2, 5, 1, 1], 'the Fortress die is rolled and counted too');

  const bare = duel({ foeCards: ['garrison'], prepare: fortified, dice });
  assert.deepEqual([bare.round.d.cv, bare.round.a.lost], [3, 0]);
  assert.equal(duel({ foeCards: ['garrison'], foePlay: 'garrison', dice }).asked[1].length, 0, 'no Fortress, no Wall Defense');
  assert.equal(duel({ cards: ['garrison'], prepare: fortified }).asked[0].length, 0, 'an attacker cannot play it');
});

test('Confusion (Political Sabotage) makes the opponent roll its highest die again', () => {
  const same = { units: ['infantry', 'infantry'], foes: ['infantry', 'infantry'], cards: ['sabotage'] };
  const dice = [plain(1), plain(1), [6, 'infantry'], plain(1)];
  const open = duel({ ...same, dice });
  assert.deepEqual([open.round.d.cv, open.round.a.lost], [8, 1]);

  const confused = duel({ ...same, play: 'sabotage', dice: [...dice, plain(2)] });
  const { a, d, notes } = confused.round;
  assert.deepEqual(d.dice, [{ v: 2, icon: 'elephant' }, { v: 1, icon: 'leader' }]);
  assert.deepEqual([d.cv, d.bonus, d.hits, a.lost], [3, 0, 0, 0]);
  assert.deepEqual(notes, [`Confusion: ${confused.g.name(1)} rerolls a 6 and gets a 2.`]);
  assert.deepEqual(a.dice, [{ v: 1, icon: 'leader' }, { v: 1, icon: 'leader' }], 'the dice of the player of the card stay');

  const defending = duel({ foeCards: ['sabotage'], foePlay: 'sabotage', dice: [[6, 'infantry'], plain(1), plain(2)] });
  assert.deepEqual([defending.round.a.cv, defending.round.d.lost], [2, 0]);
  assert.deepEqual(defending.round.notes, [`Confusion: ${defending.g.name(0)} rerolls a 6 and gets a 2.`]);
});

test('Confusion rerolls the die whose Clash icon counts when the highest dice tie', () => {
  const t = duel({ foes: ['infantry', 'infantry'], cards: ['sabotage'], play: 'sabotage', dice: [plain(1), [5, 'cavalry'], [5, 'infantry'], plain(2)] });
  assert.deepEqual(t.round.d.dice, [{ v: 5, icon: 'cavalry' }, { v: 2, icon: 'elephant' }], 'the Cavalry die means nothing to an army of Infantry');
  assert.deepEqual([t.round.d.cv, t.round.d.bonus], [7, 0]);
  assert.deepEqual(t.round.notes, [`Confusion: ${t.g.name(1)} rerolls a 5 and gets a 2.`]);
});

test('Sabotaged Supplies (Infiltration) takes 1 CV off the opponent for every die it rolls', () => {
  const dice = [plain(1), plain(3), plain(3)];
  const hit = duel({ foes: ['infantry', 'infantry'], cards: ['infiltration'], play: 'infiltration', dice });
  assert.deepEqual([hit.round.d.mod, hit.round.d.cv, hit.round.d.hits, hit.round.a.lost], [-2, 4, 0, 0]);
  assert.deepEqual(hit.round.notes, [`Sabotaged Supplies: ${hit.g.name(1)} loses 2 points (-1 per die).`]);

  const free = duel({ foes: ['infantry', 'infantry'], cards: ['infiltration'], dice });
  assert.deepEqual([free.round.d.mod, free.round.d.cv, free.round.d.hits, free.round.a.lost], [0, 6, 1, 1]);

  const fort = duel({ cards: ['infiltration'], play: 'infiltration', prepare: fortified, dice: [plain(4), plain(3), plain(3)] });
  assert.deepEqual([fort.round.d.dice.length, fort.round.d.mod, fort.round.d.cv], [2, -2, 4], 'the Fortress die counts too');
});

test('Boarding Party (Naval Escort) adds a hit that nothing cancels, when your CV at least matches the enemy CV', () => {
  const rolls = [plain(3), plain(3), plain(1), plain(1)];
  const higher = fleets({ cards: ['escort'], play: 'escort', dice: rolls });
  assert.deepEqual([higher.round.a.cv, higher.round.d.cv, higher.round.extraA, higher.round.d.lost], [6, 2, 1, 2]);
  const none = fleets({ cards: ['escort'], dice: rolls });
  assert.deepEqual([none.round.extraA, none.round.d.lost], [0, 1], 'without the card there is only the normal hit');

  const tie = fleets({ cards: ['escort'], play: 'escort', dice: [plain(3), plain(2), plain(3), plain(2)] });
  assert.deepEqual([tie.round.a.cv, tie.round.d.cv, tie.round.extraA, tie.round.d.lost, tie.round.a.lost], [5, 5, 1, 2, 1]);
  const lower = fleets({ cards: ['escort'], play: 'escort', dice: [plain(1), plain(1), plain(3), plain(3)] });
  assert.deepEqual([lower.round.extraA, lower.round.d.lost, lower.round.a.lost], [0, 0, 1], 'a lower CV earns nothing');

  const warships = fleets({ cards: ['escort'], play: 'escort', foeAdvances: ['warships'], dice: rolls });
  assert.deepEqual([warships.round.cancelD, warships.round.d.lost], [1, 1], 'Warships cancel the normal hit but not the extra one');
  const nothing = fleets({ cards: ['escort'], play: 'escort', foeAdvances: ['warships'], dice: [plain(2), plain(2), plain(1), plain(1)] });
  assert.deepEqual([nothing.round.a.hits, nothing.round.cancelD, nothing.round.extraA, nothing.round.d.lost], [0, 1, 1, 1], 'with no normal hit left to cancel the extra one still sinks a Ship');

  const defending = fleets({ foeCards: ['escort'], foePlay: 'escort', dice: [plain(1), plain(1), plain(2), plain(2)] });
  assert.deepEqual([defending.round.extraD, defending.round.a.lost], [1, 1]);
  const level = fleets({ foeCards: ['escort'], foePlay: 'escort', dice: [plain(3), plain(2), plain(3), plain(2)] });
  assert.deepEqual([level.round.extraD, level.round.a.lost, level.round.d.lost], [1, 2, 1], 'the defender needs no more than a tie, either');
  const weaker = fleets({ foeCards: ['escort'], foePlay: 'escort', dice: [plain(3), plain(3), plain(1), plain(1)] });
  assert.deepEqual([weaker.round.extraD, weaker.round.a.lost, weaker.round.d.lost], [0, 0, 1]);
  const guarded = fleets({ foeCards: ['escort'], foePlay: 'escort', advances: ['warships'], dice: [plain(1), plain(1), plain(2), plain(2)] });
  assert.deepEqual([guarded.round.cancelA, guarded.round.extraD, guarded.round.a.lost], [1, 1, 1], 'Warships cannot stop the extra hit of the defender either');
  assert.equal(duel({ cards: ['escort'] }).asked[0].length, 0, 'a land battle is no place for it');
});

test('Ideological Defection (Cultural Assimilation) gives the winner a free Infantry when its enemy lost Infantry', () => {
  const won = duel({ cards: ['assimilation'], play: 'assimilation', dice: [[6, 'infantry'], plain(1)] });
  assert.equal(won.end.winner, 0);
  assert.deepEqual(kinds(won.g, won.spot), ['infantry', 'infantry'], 'the Infantry that fought and the one that joined it');
  assert.ok(won.g.s.log.some((line) => /Ideological Defection/.test(line)));

  const plainWin = duel({ cards: ['assimilation'], dice: [[6, 'infantry'], plain(1)] });
  assert.deepEqual(kinds(plainWin.g, plainWin.spot), ['infantry']);

  const lost = duel({ cards: ['assimilation'], play: 'assimilation', dice: [plain(1), [6, 'infantry']] });
  assert.equal(lost.end.winner, 1);
  assert.deepEqual([kinds(lost.g, lost.spot, 0), kinds(lost.g, lost.spot, 1)], [[], ['infantry']], 'the loser gains nothing');

  const cavalry = duel({ cards: ['assimilation'], foes: ['cavalry'] });
  assert.equal(cavalry.asked[0].length, 0, 'there is no Infantry to win over');
});

test('Ideological Defection counts the Infantry destroyed in an earlier round, and needs room for the new Unit', () => {
  const later = duel({
    units: ['infantry', 'infantry'],
    foes: ['infantry', 'cavalry'],
    cards: ['assimilation'],
    play: (q) => (q.info.round === 2 ? 'assimilation' : 'none'),
    stop: 'no',
    dice: [plain(3), plain(2), plain(1), plain(1), plain(3), plain(2), plain(1)],
  });
  const rounds = later.events.filter((e) => e.type === 'battle_round');
  assert.deepEqual(rounds.map((r) => [r.a.lost, r.d.lost]), [[0, 1], [0, 1]]);
  assert.equal(later.asked[0].length, 2, 'offered in round 2, when only the Cavalry is left');
  assert.deepEqual(kinds(later.g, later.spot), ['infantry', 'infantry', 'infantry']);

  const full = duel({
    units: ['infantry', 'infantry', 'infantry', 'infantry'],
    cards: ['assimilation'],
    play: 'assimilation',
    dice: [[5, 'infantry'], [5, 'infantry'], [5, 'infantry'], [5, 'infantry'], plain(1)],
  });
  assert.deepEqual(kinds(full.g, full.spot), ['infantry', 'infantry', 'infantry', 'infantry'], 'a space holds 4 Army Units at most');
  assert.deepEqual(checkInvariants(full.g), []);

  const spent = duel({
    cards: ['assimilation'],
    play: 'assimilation',
    prepare: (g, { ring }) => {
      const spots = plains(g, ring, 2);
      for (let i = 0; unitsLeft(g.s, 0, 'infantry') > 0; i++) addUnit(g.s, 0, 'infantry', spots[Math.floor(i / 4)]);
    },
    dice: [[6, 'infantry'], plain(1)],
  });
  assert.equal(spent.end.winner, 0);
  assert.deepEqual([kinds(spent.g, spent.spot), unitsOf(spent.g.s, 0, 'infantry').length], [['infantry'], 16], 'all 16 Infantry are in play: there is none to win over');
  assert.deepEqual(checkInvariants(spent.g), []);
});

test('Feigned Retreat (Diplomatic Immunity) ends the battle at once: nobody rolls, nobody dies and nobody moves', () => {
  let before;
  const t = duel({
    units: ['infantry', 'infantry'],
    foes: ['infantry', 'infantry'],
    cards: ['immunity'],
    play: 'immunity',
    prepare: (g) => {
      before = g.s.rng;
    },
  });
  const { g, cap, spot, round, end } = t;
  assert.equal(t.events.filter((e) => e.type === 'battle_round').length, 1);
  assert.equal(round.disengage, true);
  assert.deepEqual([round.a.dice, round.d.dice, round.a.lost, round.d.lost, round.a.card], [[], [], 0, 0, 'immunity']);
  assert.deepEqual(round.notes, ['Both armies step back: the battle ends with no further casualties.']);
  assert.deepEqual([end.winner, end.retreated, end.captured], [null, true, false]);
  assert.deepEqual([kinds(g, cap.hex), kinds(g, spot, 1)], [['infantry', 'infantry'], ['infantry', 'infantry']]);
  assert.equal(g.s.rng, before, 'no die was rolled');
  assert.equal(g.s.decks.actionDiscard.at(-1), 'immunity');
  assert.deepEqual(checkInvariants(g), []);
});

test('Feigned Retreat can be played by the defender, takes the other card with it, and needs a space to step back to', () => {
  const both = duel({ cards: ['mass_collect'], foeCards: ['immunity'], play: 'mass_collect', foePlay: 'immunity' });
  assert.equal(both.round.disengage, true);
  assert.deepEqual([both.round.a.card, both.round.d.card], ['mass_collect', 'immunity']);
  assert.deepEqual(both.g.s.decks.actionDiscard.slice(-2).sort(), ['immunity', 'mass_collect'], 'both cards are used up');
  assert.deepEqual([me(both.g).hand.action, both.g.s.players[1].hand.action], [[], []]);
  assert.deepEqual([both.end.winner, kinds(both.g, both.cap.hex), kinds(both.g, both.spot, 1)], [null, ['infantry'], ['infantry']]);

  assert.equal(duel({ cards: ['immunity'], ctx: { from: null } }).asked[0].length, 0, 'no space to step back to');
  assert.equal(duel({ cards: ['immunity'], ctx: { inPlace: true } }).asked[0].length, 0, 'a battle that is already in place');
});

test('the computer plays Feigned Retreat only when it is outnumbered, and Financial Incentive only with 3 Gold or more', () => {
  const g = fresh();
  const ask = (option, info, gold = 0) => {
    me(g).res.gold = gold;
    return answerPrompt(g, { kind: 'combat_card', player: 0, default: 'none', options: [{ id: 'none' }, option], info });
  };
  const retreat = { id: 'immunity', effect: 'feigned_retreat' };
  const incentive = { id: 'bureaucracy', effect: 'incentive' };
  assert.equal(ask(retreat, { units: 3, foe: 3, round: 1 }), 'none');
  assert.equal(ask(retreat, { units: 2, foe: 3, round: 1 }), 'immunity');
  assert.equal(ask(incentive, { units: 2, foe: 3, round: 1 }, 2), 'none');
  assert.equal(ask(incentive, { units: 2, foe: 3, round: 1 }, 3), 'bureaucracy');
});
