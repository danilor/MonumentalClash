// Leaders (Civilizations module): the data, recruiting a Leader, losing one, and the points they score. The abilities are tested in
// test/leaders-actions.test.mjs (Actions and Free Actions), test/leaders-passive.test.mjs (economy, cities, influence, trade, events)
// and test/leaders-war.test.mjs (battles, captures, moves). The fixtures are in test/civs.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CIV_ORDER } from '../src/engine/data/civs.js';
import { ERIC_TOKEN_VP, LEADERS, LEADERS_OF, LEADER_CAPTURE_VP, LEADER_ORDER, LEADER_RECRUIT_COST } from '../src/engine/data/leaders.js';
import { LEADER_ABILITY_IDS, leaderActionList } from '../src/engine/leaderActions.js';
import { leadersAvailable, placeLeader, regionOf, startRegion } from '../src/engine/leaders.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { removeUnits } from '../src/engine/core.js';
import { scoreOf } from '../src/engine/scoring.js';
import { upgradeState } from '../src/engine/state.js';
import { armyAt, hasLeader, isArmy, leaderAt, leaderCity, leaderIdOf, leaderUnit, stackLimit, unitsLeft } from '../src/engine/queries.js';
import { BARBARIAN, PIECE_LIMITS, PIRATE } from '../src/engine/data/constants.js';
import { checkInvariants } from './harness.mjs';
import { act, capitalOf, fresh, refused } from './scenario.mjs';
import { logged, me, ofType, power, ring, stock, town, troops, world } from './civs.mjs';

const GREEKS = ['greece', 'rome'];
/** Player 0 holds exactly this many tokens (and a little of each Resource). */
const tokens = (g, mood, culture, p = 0) => stock(g, p, { food: 2, wood: 2, ore: 2, mood, culture });
/** Seat 0 holds a happy city with room for a Leader and the Culture and Mood to recruit one. */
function court(civs = GREEKS, extra = {}) {
  const g = world(civs, extra);
  tokens(g, 4, 4);
  return { g, cap: capitalOf(g) };
}
const recruit = (cap, leader, units = {}) => ({ type: 'recruit', city: cap.id, units, leader });

// --------------------------------------------------------------------------- data
test('Leaders: 45 Leaders, three for each of the 15 peoples, with two abilities each', () => {
  assert.equal(LEADER_ORDER.length, 45);
  assert.deepEqual(Object.keys(LEADERS_OF).sort(), [...CIV_ORDER].sort());
  for (const civ of CIV_ORDER) assert.equal(LEADERS_OF[civ].length, 3, civ);
  for (const l of Object.values(LEADERS)) {
    assert.deepEqual(l.abilities.map((a) => a.id), [`${l.id}_a`, `${l.id}_b`]);
    for (const a of l.abilities) {
      assert.ok(['passive', 'action', 'free'].includes(a.kind), a.id);
      assert.ok(a.text.length > 10, a.id);
    }
  }
});

test('Leaders: the Leaders and abilities of source/leaders.md are all there, in the same order', () => {
  const lines = readFileSync(new URL('../source/leaders.md', import.meta.url), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const words = (t) => new Set(t.toLowerCase().match(/[a-z]{4,}/g));
  const places = LEADER_ORDER.map((id) => lines.indexOf(LEADERS[id].name));
  assert.ok(places.every((i) => i >= 0), 'every Leader is named in the file');
  assert.deepEqual(places, [...places].sort((a, b) => a - b), 'in the order of the file');
  for (const [n, id] of LEADER_ORDER.entries()) {
    LEADERS[id].abilities.forEach((a, k) => {
      const mine = words(a.text);
      const theirs = [...words(lines[places[n] + 1 + k])];
      const same = theirs.filter((w) => mine.has(w)).length;
      assert.ok(same >= theirs.length * 0.6, `${a.id} says what the file says (${same}/${theirs.length})`);
    });
  }
});

test('Leaders: exactly the Actions and Free Actions are things a player can do', () => {
  const doable = LEADER_ORDER.flatMap((id) => LEADERS[id].abilities).filter((a) => a.kind !== 'passive').map((a) => a.id);
  assert.deepEqual([...LEADER_ABILITY_IDS].sort(), doable.sort());
});

test('Leaders: they belong to the Civilizations module', () => {
  const g = fresh('no-civs');
  assert.deepEqual(leadersAvailable(g.s, 0), []);
  assert.match(refused(g, { type: 'recruit', city: capitalOf(g).id, units: {}, leader: 'hannibal' }), /cannot recruit that Leader/);
  assert.match(refused(g, { type: 'leader', ability: 'hannibal_a' }), /Civilizations module/);
});

// --------------------------------------------------------------------------- recruiting
test('Recruit: a Leader costs 1 Culture and 1 Mood, takes a place of the city, and stands in it as an Army unit', () => {
  const { g, cap } = court();
  assert.deepEqual(leadersAvailable(g.s, 0).sort(), ['alexander', 'leonidas', 'pericles']);
  assert.deepEqual(LEADER_RECRUIT_COST, { culture: 1, mood: 1 });
  g.drainEvents();
  act(g, recruit(cap, 'pericles'));
  const unit = leaderUnit(g.s, 0);
  assert.equal(unit.hex, cap.hex);
  assert.equal(unit.type, 'leader');
  assert.equal(leaderIdOf(g.s, 0), 'pericles');
  assert.ok(hasLeader(g.s, 0, 'pericles') && leaderAt(g.s, 0, 'pericles', cap.hex) && leaderCity(g.s, 0, 'pericles') === cap);
  assert.ok(isArmy(unit), 'a Leader is an Army unit');
  assert.deepEqual([me(g).culture, me(g).mood], [3, 3]);
  assert.equal(g.s.turn.actionsLeft, 2);
  const events = g.drainEvents();
  assert.deepEqual(ofType(events, 'leader').map((e) => [e.player, e.leader, e.hex]), [[0, 'pericles', cap.hex]]);
  assert.equal(ofType(events, 'recruit')[0].leader, 'pericles');
  assert.ok(logged(g, /recruits Pericles/));
  assert.deepEqual(checkInvariants(g), []);
});

test('Recruit: the Leader takes one of the places of the city, so a city of capacity 2 holds the Leader and one unit', () => {
  const { g, cap } = court();
  assert.match(refused(g, recruit(cap, 'pericles', { infantry: 2 })), /at most 2 units/);
  act(g, recruit(cap, 'pericles', { infantry: 1 }));
  assert.deepEqual(armyAt(g.s, cap.hex, 0).map((u) => u.type).sort(), ['infantry', 'leader']);
  assert.deepEqual(checkInvariants(g), []);
});

test('Recruit: only a Leader of your own people that is not in play and not lost, and only with the Culture and the Mood', () => {
  const { g, cap } = court();
  assert.match(refused(g, recruit(cap, 'hannibal')), /cannot recruit that Leader/);
  assert.match(refused(g, recruit(cap, 'nobody')), /cannot recruit that Leader/);
  tokens(g, 4, 0);
  assert.match(refused(g, recruit(cap, 'pericles')), /cannot afford/);
  tokens(g, 0, 4);
  assert.match(refused(g, recruit(cap, 'pericles')), /cannot afford/);
  tokens(g, 1, 1);
  act(g, recruit(cap, 'pericles'));
  assert.deepEqual([me(g).culture, me(g).mood], [0, 0]);
  assert.match(refused(g, recruit(cap, 'pericles')), /cannot recruit that Leader/, 'he is in play already');
});

test('Recruit: another Leader replaces the one in play, and the old one is gone for good', () => {
  const { g, cap } = court();
  act(g, recruit(cap, 'pericles'));
  const old = leaderUnit(g.s, 0).id;
  g.drainEvents();
  act(g, recruit(cap, 'leonidas'));
  assert.equal(leaderIdOf(g.s, 0), 'leonidas');
  assert.equal(g.s.units.filter((u) => u.type === 'leader' && u.owner === 0).length, 1);
  assert.ok(!g.s.units.some((u) => u.id === old));
  assert.deepEqual(me(g).leaderLost, ['pericles']);
  assert.deepEqual(leadersAvailable(g.s, 0), ['alexander']);
  assert.deepEqual(ofType(g.drainEvents(), 'leader_lost').map((e) => [e.player, e.leader, e.by]), [[0, 'pericles', null]]);
  assert.match(refused(g, recruit(cap, 'pericles')), /cannot recruit that Leader/);
  assert.deepEqual(checkInvariants(g), []);
});

test('Recruit: a Leader may be recruited in a city other than where the old one stands, which then leaves its place', () => {
  const { g, cap } = court();
  const far = ring(g, cap.hex, 3)[0];
  town(g, 0, far, 'happy');
  act(g, recruit(cap, 'pericles'));
  const city = g.s.cities.find((c) => c.hex === far);
  g.s.turn.actionsLeft = 3;
  act(g, recruit(city, 'alexander'));
  assert.equal(leaderUnit(g.s, 0).hex, far);
  assert.equal(armyAt(g.s, cap.hex, 0).length, 0);
});

test('Recruit: a Leader counts toward the stack limit of 4 Army units, and Xerxes toward 5', () => {
  const { g, cap } = court();
  const [out] = ring(g, cap.hex, 3);
  troops(g, 0, 'infantry', out, 4);
  const city = town(g, 0, out, 'happy', ['market', 'academy']);
  tokens(g, 4, 4);
  assert.match(refused(g, recruit(city, 'pericles')), /at most 4 Army units/);
  const persians = world(['persia', 'rome']);
  tokens(persians, 4, 4);
  const home = capitalOf(persians);
  assert.equal(stackLimit(persians.s, 0, home.hex), 4);
  placeLeader(persians, 0, 'xerxes', home.hex);
  assert.equal(stackLimit(persians.s, 0, home.hex), 5, 'with Xerxes the stack holds one more');
  assert.equal(stackLimit(persians.s, 1, home.hex), 4);
});

test('Recruit: the Leader pieces are not in the supply of the other units, and there is one Leader piece per player', () => {
  const { g, cap } = court();
  assert.equal(PIECE_LIMITS.leaders, 1);
  assert.equal(unitsLeft(g.s, 0, 'leader'), 1);
  act(g, recruit(cap, 'pericles'));
  assert.equal(unitsLeft(g.s, 0, 'leader'), 0);
  assert.equal(unitsLeft(g.s, 0, 'infantry'), PIECE_LIMITS.infantry);
});

test('Recruit: the enumeration offers every Leader alone or with an Infantry, and none that is in play', () => {
  const { g, cap } = court();
  const options = enumerateActions(g, 0).filter((c) => c.cat === 'recruit' && c.action.leader);
  assert.deepEqual([...new Set(options.map((c) => c.action.leader))].sort(), ['alexander', 'leonidas', 'pericles']);
  assert.ok(options.some((c) => c.action.leader === 'pericles' && !c.action.units.infantry && c.action.city === cap.id));
  assert.ok(options.some((c) => c.action.leader === 'pericles' && c.action.units.infantry === 1));
  act(g, recruit(cap, 'pericles'));
  g.s.turn.actionsLeft = 3;
  const next = enumerateActions(g, 0).filter((c) => c.cat === 'recruit' && c.action.leader);
  assert.ok(!next.some((c) => c.action.leader === 'pericles'));
});

test('Recruit: a replaced or fallen Leader is no longer offered, a Roman one is offered to Rome', () => {
  const { g } = court();
  assert.deepEqual(leadersAvailable(g.s, 1).sort(), ['augustus', 'caesar', 'sulla']);
  assert.deepEqual(leadersAvailable(g.s, 0).sort(), ['alexander', 'leonidas', 'pericles']);
});

// --------------------------------------------------------------------------- losing a Leader
test('A Leader that dies is gone for good and nobody scores it; a replaced one is the same', () => {
  const { g, cap } = court();
  act(g, recruit(cap, 'pericles'));
  g.drainEvents();
  removeUnits(g, [leaderUnit(g.s, 0).id]);
  assert.equal(leaderIdOf(g.s, 0), null);
  assert.deepEqual(me(g).leaderLost, ['pericles']);
  assert.equal(me(g).leaderCaptured.length + g.s.players[1].leaderCaptured.length, 0);
  assert.deepEqual(ofType(g.drainEvents(), 'leader_lost').map((e) => [e.leader, e.by]), [['pericles', null]]);
  assert.deepEqual(checkInvariants(g), []);
});

test('A Leader taken in battle is worth 2 VP to the player who took it, who also keeps its card for good', () => {
  const { g, cap } = court();
  act(g, recruit(cap, 'pericles'));
  const before = scoreOf(g.s, 1).total;
  removeUnits(g, [leaderUnit(g.s, 0).id], { by: 1 });
  assert.deepEqual(g.s.players[1].leaderCaptured, [{ id: 'pericles', from: 0 }]);
  assert.equal(scoreOf(g.s, 1).total - before, LEADER_CAPTURE_VP);
  assert.equal(scoreOf(g.s, 1).parts.civ, LEADER_CAPTURE_VP);
  assert.deepEqual(me(g).leaderLost, ['pericles']);
  assert.deepEqual(checkInvariants(g), []);
});

test('A Leader the Barbarians or the Pirates defeat is lost without a holder', () => {
  for (const by of [BARBARIAN, PIRATE]) {
    const { g, cap } = court();
    act(g, recruit(cap, 'pericles'));
    removeUnits(g, [leaderUnit(g.s, 0).id], { by });
    assert.equal(g.s.players[1].leaderCaptured.length, 0);
    assert.deepEqual(me(g).leaderLost, ['pericles']);
  }
});

test('Embalming pays 1 Culture for a Leader that is lost', () => {
  const { g, cap } = court(['egypt', 'rome']);
  power(g, 0, 'embalming');
  act(g, recruit(cap, 'ramses'));
  const culture = me(g).culture;
  removeUnits(g, [leaderUnit(g.s, 0).id]);
  assert.equal(me(g).culture, culture + 1);
});

test('Cleopatra: the Culture tokens in the cities leave with her', () => {
  const { g, cap } = court(['egypt', 'rome']);
  act(g, recruit(cap, 'cleopatra'));
  cap.beloved = 2;
  removeUnits(g, [leaderUnit(g.s, 0).id]);
  assert.equal(cap.beloved, undefined);
});

// --------------------------------------------------------------------------- scoring
test('Scoring: a Leader taken from another player is 2 VP, each Culture token of Eric the Red 1 VP, Cnut 0.5 VP per space', () => {
  assert.equal(LEADER_CAPTURE_VP, 2);
  assert.equal(ERIC_TOKEN_VP, 1);
  const { g, cap } = court(['vikings', 'rome']);
  const base = scoreOf(g.s, 0).parts.civ;
  me(g).ericTokens = ['x', 'y', 'z'];
  assert.equal(scoreOf(g.s, 0).parts.civ, base + 3 * ERIC_TOKEN_VP);
  me(g).ericTokens = [];
  me(g).leaderCaptured = [{ id: 'sulla', from: 1 }, { id: 'caesar', from: 1 }];
  assert.equal(scoreOf(g.s, 0).parts.civ, base + 2 * LEADER_CAPTURE_VP);
  me(g).leaderCaptured = [];
  const far = ring(g, cap.hex, 4)[0];
  const city = town(g, 0, far, 'happy');
  placeLeader(g, 0, 'cnut', far);
  assert.equal(scoreOf(g.s, 0).parts.civ, base + 2, 'four spaces from the starting city is 2 VP');
  assert.equal(leaderCity(g.s, 0, 'cnut'), city);
  city.hex = ring(g, cap.hex, 1)[0];
  leaderUnit(g.s, 0).hex = city.hex;
  assert.equal(scoreOf(g.s, 0).parts.civ, base + 0.5);
});

test('Scoring: Eric the Red keeps what his tokens score after he is gone, and a Region holds only one of his tokens', () => {
  const { g } = court(['vikings', 'rome']);
  const base = scoreOf(g.s, 0).parts.civ;
  me(g).ericTokens = ['r1'];
  placeLeader(g, 0, 'eric', capitalOf(g).hex);
  removeUnits(g, [leaderUnit(g.s, 0).id]);
  assert.equal(scoreOf(g.s, 0).parts.civ, base + 1);
});

test('Scoring: Leaders that nobody holds score nothing', () => {
  const { g } = court();
  assert.equal(scoreOf(g.s, 0).parts.civ, 0);
  assert.equal(scoreOf(g.s, 1).parts.civ, 0);
});

// --------------------------------------------------------------------------- saves
test('Saves: a game saved before Leaders existed loads with no Leader in play', () => {
  const { g } = court();
  const old = JSON.parse(JSON.stringify(g.s));
  for (const pl of old.players) {
    delete pl.leader;
    delete pl.leaderLost;
    delete pl.leaderCaptured;
    delete pl.ericTokens;
  }
  upgradeState(old);
  for (const pl of old.players) {
    assert.equal(pl.leader, null);
    assert.deepEqual([pl.leaderLost, pl.leaderCaptured, pl.ericTokens], [[], [], []]);
  }
});

// --------------------------------------------------------------------------- regions
test('Regions: every space belongs to a Region and the starting Region of a player is known', () => {
  const { g, cap } = court();
  assert.ok(regionOf(g.s, cap.hex) !== undefined);
  assert.equal(startRegion(g.s, 0), regionOf(g.s, cap.hex));
});

test('The Leader actions the AI is offered are a plain list that is empty without a Leader', () => {
  const { g } = court();
  assert.deepEqual(leaderActionList(g, 0), []);
});
