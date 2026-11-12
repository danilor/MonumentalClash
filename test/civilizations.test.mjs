// Regressions for the Civilizations module: the fifteen peoples, how they are dealt, how their Advances are gained and
// scored. The powers themselves are in test/civ-economy.test.mjs, civ-war.test.mjs and civ-actions.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADVANCES, GROUPS } from '../src/engine/data/advances.js';
import { BARBARIAN, BUILDINGS, CIV_BUILDINGS } from '../src/engine/data/constants.js';
import { CIVS, CIV_ADVANCES, CIV_ORDER, CIV_OF_ADVANCE, GOVERNMENT_TRIGGER } from '../src/engine/data/civs.js';
import { gainAdvance } from '../src/engine/advance.js';
import { civAdvancesFor, grantCivAdvances } from '../src/engine/civs.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { Game } from '../src/engine/game.js';
import { changeGovernment } from '../src/engine/government.js';
import { buildingsIn, hasCivAdv } from '../src/engine/queries.js';
import { finalResult, scoreOf } from '../src/engine/scoring.js';
import { checkInvariants, enrich, playRandomGame } from './harness.mjs';
import { act, addCityAt, capitalOf, fresh, give, playAIGame, refused } from './scenario.mjs';
import { asking, logged, me, ofType, power, ring, run, stock, world } from './civs.mjs';

// ------------------------------------------------------------------ the roster
const ROSTER = {
  aztecs: ['Captives', 'Human Sacrifice', 'Aztec Gold', 'Tribute Empire'],
  babylonia: ['Canals', 'Code of Laws', 'Star Catalogs', 'Ziggurats'],
  carthage: ['Warbeasts', 'Hegemony', 'Pirate Allies', 'Mercenaries'],
  celts: ['Tribal Warfare', 'Tribal Allies', 'Druidic Influence', 'Tribal Trade'],
  china: ['Rice Paddies', 'Sprawling', 'Fireworks', 'Fighting Bands'],
  egypt: ['Flood Plains', 'Architecture', 'Embalming', 'Man God'],
  greece: ['Formal Training', 'Spartans', 'Hellenization', 'City States'],
  huns: ['Nomads', 'Mounted Archers', 'Raiders', 'Hunnic Tribes'],
  india: ['Indian Elephants', 'Proselytism', 'Prosperity', 'Peace and Poetry'],
  japan: ['Pottery', 'Horsemanship', 'Subterfuge', 'Shogunate'],
  maya: ['Terracing', 'Stelas', 'Ballcourts', 'Calendar'],
  persia: ['Elephants', 'Immortals', 'Zoroastrianism', 'Banking'],
  phoenicia: ['City Independence', 'Biremes', 'Alphabet', 'Cedars and Dyes'],
  rome: ['Aqueducts', 'Imperial Roads', 'Slave Economy', 'Provinces'],
  vikings: ['Shipcraft', 'Longships', 'Runestones', 'Marauders'],
};

// What each Advance hangs on: an Advance of the game, or any Government Advance. Chemistry (source/civ.md) is not an
// Advance of this game: the Chinese Fireworks come with Metallurgy, the last Science Advance.
const TRIGGERS = {
  aztecs: ['tactics', 'rituals', 'arts', 'government'],
  babylonia: ['engineering', 'writing', 'astronomy', 'dogma'],
  carthage: ['husbandry', 'cartography', 'navigation', 'draft'],
  celts: ['tactics', 'draft', 'priesthood', 'trade_routes'],
  china: ['irrigation', 'husbandry', 'metallurgy', 'government'],
  egypt: ['irrigation', 'engineering', 'rituals', 'priesthood'],
  greece: ['public_education', 'draft', 'arts', 'voting'],
  huns: ['storage', 'husbandry', 'tactics', 'government'],
  india: ['husbandry', 'state_religion', 'trade_routes', 'theaters'],
  japan: ['storage', 'husbandry', 'tactics', 'government'],
  maya: ['irrigation', 'arts', 'sports', 'astronomy'],
  persia: ['husbandry', 'draft', 'priesthood', 'currency'],
  phoenicia: ['fishing', 'warships', 'writing', 'trade_routes'],
  rome: ['engineering', 'roads', 'bartering', 'government'],
  vikings: ['fishing', 'warships', 'rituals', 'trade_routes'],
};

test('there are fifteen peoples with four Advances each, as listed in source/civ.md', () => {
  assert.deepEqual(CIV_ORDER.slice().sort(), Object.keys(ROSTER).sort());
  for (const [id, names] of Object.entries(ROSTER)) {
    assert.deepEqual(CIVS[id].advances.map((a) => a.name), names, id);
  }
  assert.equal(Object.keys(CIV_ADVANCES).length, 60, 'no Advance id is used twice');
});

test('every Civilization Advance hangs on an Advance of the game, or on a Government', () => {
  for (const [id, triggers] of Object.entries(TRIGGERS)) {
    assert.deepEqual(CIVS[id].advances.map((a) => a.trigger), triggers, id);
    for (const a of CIVS[id].advances) {
      assert.ok(a.trigger === GOVERNMENT_TRIGGER || ADVANCES[a.trigger], `${a.id} hangs on ${a.trigger}`);
      assert.equal(a.civ, id);
      assert.equal(CIV_OF_ADVANCE[a.id], id);
      assert.ok(a.text.length > 20, `${a.id} says what it does`);
    }
  }
});

test('a player gains exactly the Civilization Advances that hang on the Advance just bought; any Government Advance counts as a Government', () => {
  const govAdvances = Object.values(GROUPS).filter((x) => x.gov).flatMap((x) => x.advances.map((a) => a.id));
  assert.equal(govAdvances.length, 12);
  for (const id of CIV_ORDER) {
    const g = world(id);
    for (const adv of Object.keys(ADVANCES)) {
      const expected = CIVS[id].advances
        .filter((a) => a.trigger === adv || (a.trigger === GOVERNMENT_TRIGGER && govAdvances.includes(adv)))
        .map((a) => a.id);
      assert.deepEqual(civAdvancesFor(g.s, 0, adv).map((a) => a.id), expected, `${id} buying ${adv}`);
    }
  }
});

// ----------------------------------------------------------------- the module
test('the module is off unless asked for: no people, no Civilization Advances, no Obelisk or Observatory', () => {
  const g = fresh('plain');
  assert.equal(g.s.civs, false);
  assert.ok(g.s.players.every((p) => p.civ === null && !p.civAdv.length && !p.captives.length && p.runes === 0));
  assert.deepEqual(civAdvancesFor(g.s, 0, 'tactics'), []);
  assert.equal(hasCivAdv(g.s, 0, 'captives'), false);
  assert.deepEqual(buildingsIn(g.s), BUILDINGS.filter((b) => !CIV_BUILDINGS.includes(b)));
  assert.equal(scoreOf(g.s, 0).parts.civ, undefined, 'no part of the score belongs to the module');
  const types = new Set(enumerateActions(g, 0).map((c) => c.action.type));
  for (const t of ['hegemony', 'sprawl', 'fighting_bands', 'tribal_allies', 'human_sacrifice', 'calendar']) assert.ok(!types.has(t), t);
});

test('with the module on, every player is dealt a different people, the same ones for the same seed', () => {
  for (const opponents of [1, 2, 3]) {
    const g = world([], { opponents, seed: `deal-${opponents}` });
    const dealt = g.s.players.map((p) => p.civ);
    assert.equal(g.s.civs, true);
    assert.equal(new Set(dealt).size, opponents + 1, 'distinct');
    assert.ok(dealt.every((id) => CIVS[id]));
    assert.deepEqual(world([], { opponents, seed: `deal-${opponents}` }).s.players.map((p) => p.civ), dealt);
  }
  const peoples = new Set();
  for (let i = 0; i < 12; i++) peoples.add(world([], { seed: `variety-${i}` }).s.players[0].civ);
  assert.ok(peoples.size >= 5, `the seat of the human is not always the same people: ${[...peoples]}`);
});

test('a game may name the people of some seats; a name that is taken or unknown is dealt another one', () => {
  const g = world(['rome', 'rome', 'atlantis'], { opponents: 3, seed: 'named' });
  const dealt = g.s.players.map((p) => p.civ);
  assert.equal(dealt[0], 'rome');
  assert.equal(new Set(dealt).size, 4);
  assert.ok(dealt.slice(1).every((id) => CIVS[id] && id !== 'rome'));
  const only = Game.create({ seed: 'named-only', opponents: 1, civs: ['vikings'] });
  assert.equal(only.s.civs, true, 'naming a people switches the module on');
  assert.equal(only.s.players[0].civ, 'vikings');
});

test('dealing the peoples does not change the table: the map and the decks are those of a game without them', () => {
  const plain = Game.create({ seed: 'same-table', opponents: 2 });
  const full = Game.create({ seed: 'same-table', opponents: 2, civilizations: true });
  assert.deepEqual(full.s.map, plain.s.map);
  assert.deepEqual(full.s.decks, plain.s.decks);
  assert.equal(full.s.rng, plain.s.rng);
});

// ------------------------------------------------------------- gaining Advances
test('buying the Advance a power hangs on gives the power at once, without a tracker cube or an Event', () => {
  const g = world('babylonia');
  stock(g, 0, { food: 2 });
  me(g).cubes = 2; // were Canals to take a cube too, the tracker would be full and an Event would follow
  const events = g.s.decks.event.length;
  const actions = g.s.turn.actionsLeft;
  act(g, { type: 'advance', advance: 'engineering' });
  assert.deepEqual(me(g).advances.slice(-1), ['engineering']);
  assert.deepEqual(me(g).civAdv, ['canals']);
  assert.equal(me(g).cubes, 1, 'Engineering takes the cube; Canals comes from the supply');
  assert.equal(g.s.decks.event.length, events, 'no Event was drawn');
  assert.equal(g.s.turn.actionsLeft, actions - 1, 'one action for the Advance, none for the power');
  assert.deepEqual(ofType(g.drainEvents(), 'civAdvance').map((e) => [e.player, e.advance]), [[0, 'canals']]);
  assert.ok(logged(g, /gains Canals \(Babylonia\)/));
});

test('a power is gained once, and only by its own people', () => {
  const g = world(['babylonia', 'rome']);
  give(g, 0, { advances: ['engineering'] });
  give(g, 1, { advances: ['engineering'] });
  grantCivAdvances(g, 0, 'engineering');
  grantCivAdvances(g, 0, 'engineering');
  assert.deepEqual(me(g).civAdv, ['canals'], 'a second purchase of the trigger gives nothing more');
  grantCivAdvances(g, 1, 'engineering');
  assert.deepEqual(me(g, 1).civAdv, ['aqueducts'], 'Rome has its own Advance on Engineering');
  assert.deepEqual(checkInvariants(g), []);
});

test('an Advance gained any other way than by buying it (a card, an Event) gives the power too', () => {
  const g = world('china');
  run(g, gainAdvance(g, 0, 'irrigation'));
  assert.ok(hasCivAdv(g.s, 0, 'rice_paddies'));
  assert.equal(me(g).cubes, 2);
});

test('any Advance of a Government gives the power that hangs on "a Government"', () => {
  const g = world('china');
  give(g, 0, { advances: ['draft'] });
  run(g, gainAdvance(g, 0, 'nationalism'));
  assert.equal(me(g).government, 'autocracy');
  assert.deepEqual(me(g).civAdv, ['fighting_bands']);
});

test('changing Government moves the cubes, and the Civilization Advances on the Advances they land on come with them', () => {
  const g = world('greece'); // City States hangs on Voting
  give(g, 0, { advances: ['draft', 'philosophy', 'nationalism'] });
  me(g).government = 'autocracy';
  power(g, 0, 'spartans');
  assert.ok(!hasCivAdv(g.s, 0, 'city_states'));
  asking(g, { government: 'democracy' });
  const events = run(g, changeGovernment(g, 0, { free: true }));
  assert.equal(me(g).government, 'democracy');
  assert.ok(me(g).advances.includes('voting'));
  assert.ok(hasCivAdv(g.s, 0, 'city_states'), 'the cube on Voting is a Voting Advance');
  assert.deepEqual(ofType(events, 'civAdvance').map((e) => e.advance), ['city_states']);
  assert.ok(hasCivAdv(g.s, 0, 'spartans'), 'what was gained stays');
  assert.deepEqual(checkInvariants(g), []);
});

test('Civilization Advances stay when the Government is given up', () => {
  const g = world('china');
  give(g, 0, { advances: ['draft', 'state_religion'] });
  run(g, gainAdvance(g, 0, 'nationalism'));
  assert.ok(hasCivAdv(g.s, 0, 'fighting_bands'));
  asking(g, { government: 'theocracy' });
  run(g, changeGovernment(g, 0, { free: true }));
  assert.equal(me(g).government, 'theocracy');
  assert.ok(hasCivAdv(g.s, 0, 'fighting_bands'));
  assert.deepEqual(checkInvariants(g), []);
});

// --------------------------------------------------------------------- scoring
test('Civilization Advances are worth 1/2 VP like any Advance', () => {
  const g = world('babylonia');
  const before = scoreOf(g.s, 0);
  me(g).civAdv.push('canals', 'ziggurats');
  const after = scoreOf(g.s, 0);
  assert.equal(after.parts.advances, before.parts.advances + 1);
  assert.equal(after.total, before.total + 1);
});

test('Captives are worth 1/2 VP each, the Culture tokens of the Druids and the Runestones 1 VP each', () => {
  const g = world(['aztecs', 'celts']);
  assert.equal(scoreOf(g.s, 0).parts.civ, 0);
  me(g).captives.push({ owner: 1, type: 'infantry' }, { owner: 1, type: 'cavalry' }, { owner: BARBARIAN, type: 'infantry' });
  assert.equal(scoreOf(g.s, 0).parts.civ, 1.5);
  const camp = addCityAt(g, BARBARIAN, ring(g, capitalOf(g, 0).hex, 3)[0]);
  camp.druid = 0;
  assert.equal(scoreOf(g.s, 0).parts.civ, 2.5, 'the first player may hold a Druid token too');
  assert.equal(scoreOf(g.s, 1).parts.civ, 0);
  camp.druid = 1;
  assert.equal(scoreOf(g.s, 0).parts.civ, 1.5);
  assert.equal(scoreOf(g.s, 1).parts.civ, 1);
  me(g, 1).runes = 2;
  assert.equal(scoreOf(g.s, 1).parts.civ, 3);
  assert.equal(scoreOf(g.s, 1).total, scoreOf(g.s, 1).parts.core + scoreOf(g.s, 1).parts.advances + 3, 'they count in the total');
});

test('a tie is broken by the other parts of the score first, then by the points of the module', () => {
  const g = world(['aztecs']);
  me(g).captives.push({ owner: 1, type: 'infantry' }, { owner: 1, type: 'infantry' });
  me(g, 1).vpBonus += 1;
  const r = finalResult(g.s);
  assert.equal(r.scores[0].total, r.scores[1].total);
  assert.equal(r.winner, 1, 'Event points come before the points of the module');
});

// ------------------------------------------------------------- save and load
test('a saved game keeps the peoples, their Advances, Captives and Runestones', () => {
  const g = world(['aztecs', 'vikings']);
  power(g, 0, 'captives');
  power(g, 1, 'runestones');
  me(g).captives.push({ owner: 1, type: 'cavalry' });
  me(g, 1).runes = 1;
  const copy = Game.fromJSON(g.toJSON());
  assert.deepEqual(JSON.parse(copy.toJSON()), JSON.parse(g.toJSON()));
  assert.deepEqual(copy.s.players.map((p) => p.civ), ['aztecs', 'vikings']);
  assert.deepEqual(me(copy).captives, [{ owner: 1, type: 'cavalry' }]);
});

test('a game saved before the module played on without it', () => {
  const g = fresh('old-save');
  const old = JSON.parse(g.toJSON());
  delete old.civs;
  for (const p of old.players) {
    delete p.civ;
    delete p.civAdv;
    delete p.captives;
    delete p.runes;
  }
  const loaded = Game.fromJSON(JSON.stringify(old));
  assert.equal(loaded.s.civs, false);
  assert.ok(loaded.s.players.every((p) => p.civ === null && Array.isArray(p.civAdv) && p.civAdv.length === 0 && p.captives.length === 0 && p.runes === 0));
  assert.deepEqual(checkInvariants(loaded), []);
  loaded.policy = loaded.s.players.map(() => (_g, prompt) => prompt.default);
  assert.ok(loaded.apply({ type: 'end_turn' }).ok);
});

test('the module cannot be switched on in a game that has none: the actions are refused', () => {
  const g = fresh('plain-refusals');
  for (const action of [
    { type: 'hegemony', unit: 'x', to: '0,0' },
    { type: 'sprawl' },
    { type: 'fighting_bands', units: ['x'] },
    { type: 'tribal_allies' },
    { type: 'human_sacrifice', gain: { food: 1 } },
    { type: 'calendar' },
  ]) assert.match(refused(g, action), /do not have/);
});

// ---------------------------------------------------------- whole games played
test('computer players play whole games with the module on, and every rule holds after every action', () => {
  const peoples = new Set();
  for (const seed of ['civ-ai-1', 'civ-ai-2']) {
    const { g, problems } = playAIGame(seed, { civs: true });
    assert.deepEqual(problems, []);
    assert.equal(g.s.phase, 'over', `${seed} reached the end`);
    for (const p of g.s.players) peoples.add(p.civ);
    assert.ok(g.s.players.some((p) => p.civAdv.length), 'the powers were gained');
  }
  assert.ok(peoples.size >= 3);
});

test('four computer players, each with a people of their own, play a game to its end', () => {
  const { g, problems } = playAIGame('civ-ai-table', { civs: true, opponents: 3, ages: 4 });
  assert.deepEqual(problems, []);
  assert.equal(g.s.phase, 'over');
  assert.equal(new Set(g.s.players.map((p) => p.civ)).size, 4);
});

test('random play with every Advance in hand, a people of every kind and each Government, breaks no rule', () => {
  const total = {};
  for (const civ of CIV_ORDER) {
    for (let i = 0; i < 2; i++) {
      const r = playRandomGame({
        seed: `${civ}-${i}`, civs: [civ], opponents: 1, maxSteps: 1500,
        setup: (g) => {
          for (let p = 0; p < g.s.players.length; p++) enrich(g, p, { gov: ['democracy', 'autocracy', 'theocracy'][(p + i) % 3] });
        },
      });
      assert.deepEqual(r.errors, [], `${civ}-${i}: ${r.errors.slice(0, 2).join('\n')}`);
      for (const [type, n] of Object.entries(r.stats.events)) total[type] = (total[type] || 0) + n;
    }
  }
  for (const type of ['civAdvance', 'recruit', 'collect', 'move', 'found', 'construct', 'battle_start']) assert.ok(total[type], `random play reached ${type}`);
});
