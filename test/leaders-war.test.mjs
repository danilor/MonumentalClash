// Leaders in battle (Civilizations module): the CV they add, the questions they ask, the hits they cancel, and what their Army
// earns when it takes a city. The fixtures are in test/leaders.mjs and test/civs.mjs; the other Leaders are in test/leaders*.test.mjs.
// The dice are rigged: a face is `[value, icon]`, and the dice of a round are listed attacker first, then defender, round after round.
// A side with a Leader rolls a die again that shows the Leader icon, so a face that must stay put for such a side is LOW, not MISS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BARBARIAN, PIRATE } from '../src/engine/data/constants.js';
import { LEADERS, LEADERS_OF, LEADER_CAPTURE_VP } from '../src/engine/data/leaders.js';
import { battle } from '../src/engine/combat.js';
import { placeLeader, regionOf } from '../src/engine/leaders.js';
import { scoreOf } from '../src/engine/scoring.js';
import { allHexKeys, cityAt, hexDistance, leaderUnit, nbrs, unitById, unitsAt } from '../src/engine/queries.js';
import { checkInvariants } from './harness.mjs';
import { act, give, capitalOf, hold, landBattle, listen, refused, rigDice } from './scenario.mjs';
import { W, bay, free, logged, me, ofType, optionIds, pirates, ring, setTerrain, stock, town, troops, world } from './civs.mjs';
import { elsewhere, lead, secondCity } from './leaders.mjs';

/** A face that scores a hit for any Army, and two that never score anything (MISS only for a side without a Leader). */
const HIT = [6, 'infantry'];
const MISS = [1, 'leader'];
const LOW = [2, 'cavalry'];
/** The listed answers in turn, then the default of the prompt. */
const queue = (...answers) => (prompt) => (answers.length ? answers.shift() : prompt.default);
const asksOf = (asked, kind) => asked.filter((q) => q.kind === kind);
/** The CV the Leaders added to a side of a round. */
const bonus = (side) => side.leaderCv.reduce((n, x) => n + x.cv, 0);
const peopleOf = (id) => Object.keys(LEADERS_OF).find((civ) => LEADERS_OF[civ].includes(id));

/**
 * Seat 0 attacks, with `leader` in its Army (if any) and `atk` more units, from its capital the space next to it where `def` units of
 * `foe` (seat 1 or the Barbarians) stand. `foeLeader` stands with them, and `city` (a list of Buildings) puts a city of `foe` there.
 * `where(g, cap)` names another battle space (the Army then starts on a free space beside it); `prepare(g, { cap, hex, from })`
 * changes the table before the dice are rigged (what it returns is kept as `prepared`). `ask` and `foeAsk` answer the questions of
 * the two players: seat 0 retreats after round 1 unless told otherwise. `cards` and `foeCards` are their Action cards, and whoever
 * holds one has Tactics. `dice` fixes the dice from round 1 on; without them the rolls are the plain random ones.
 */
function fight({
  leader, foeLeader, foe = 1, atk = leader ? [] : ['infantry'], def = ['infantry'], city = null, cityMood = 'neutral', dice,
  ask = { retreat: 'yes' }, foeAsk = {}, cards = [], foeCards = [], landed = false, where, prepare,
}) {
  const civ0 = peopleOf(leader) ?? (peopleOf(foeLeader) === 'rome' ? 'greece' : 'rome');
  const g = world([civ0, peopleOf(foeLeader) ?? (civ0 === 'rome' ? 'greece' : 'rome')]);
  const cap = capitalOf(g);
  const player = foe !== BARBARIAN;
  const hex = where ? where(g, cap) : ring(g, cap.hex, 1)[0];
  const from = where ? nbrs(g.s, hex).find((k) => free(g, k)) : cap.hex;
  if (cards.length) give(g, 0, { advances: ['tactics'] });
  hold(g, 0, ...cards);
  stock(g, 0, {});
  if (player) {
    if (foeCards.length) give(g, foe, { advances: ['tactics'] });
    hold(g, foe, ...foeCards);
    stock(g, foe, {});
  }
  const mine = [...(leader ? [placeLeader(g, 0, leader, from).id] : []), ...atk.map((type) => troops(g, 0, type, from)[0].id)];
  const theirs = def.map((type) => troops(g, foe, type, hex)[0].id);
  if (foeLeader) theirs.push(placeLeader(g, foe, foeLeader, hex).id);
  if (city) town(g, foe, hex, cityMood, city);
  const prepared = prepare?.(g, { cap, hex, from });
  const asked = listen(g, 0, ask);
  const askedFoe = player ? listen(g, foe, foeAsk) : [];
  if (dice) rigDice(g, ...dice);
  g.drainEvents();
  const r = g._run(battle(g, { ...landBattle(0, foe, hex, from, mine), landed }));
  assert.ok(r.ok, r.error);
  assert.equal(g.pending, null);
  const events = g.drainEvents();
  const rounds = ofType(events, 'battle_round');
  return {
    g, cap, hex, from, mine, theirs, asked, askedFoe, prepared, events, rounds,
    round: rounds[0], a: rounds[0]?.a, d: rounds[0]?.d, end: ofType(events, 'battle_end')[0],
  };
}

/** The free space nearest to the capital that lies in its Region (or in another one). */
const inRegion = (same) => (g, cap) => allHexKeys(g.s)
  .filter((k) => free(g, k) && (regionOf(g.s, k) === regionOf(g.s, cap.hex)) === same)
  .sort((a, b) => hexDistance(cap.hex, a) - hexDistance(cap.hex, b))[0];
const far = (g, cap) => ring(g, cap.hex, 4)[0];
const seaBeside = (g, { hex }) => setTerrain(g, nbrs(g.s, hex).find((k) => free(g, k)), 'sea');
const foeTown = (g, buildings = []) => town(g, 1, elsewhere(g, capitalOf(g, 1).hex), 'neutral', buildings);
const withTactics = (g) => [0, 1].forEach((p) => give(g, p, { advances: ['tactics'] }));

// ------------------------------------------------------------------- CV
// [what, the fight, the side of the Leader's army in the first round, the CV he adds to it, whether he is in the battle]
const CV_ROWS = [
  ['Nabopolassar attacking a player with as many cities', { leader: 'nabopolassar' }, 'a', 2],
  ['Nabopolassar attacking a player with more cities', { leader: 'nabopolassar', prepare: (g) => foeTown(g) }, 'a', 2],
  ['Nabopolassar attacking a player with fewer cities', { leader: 'nabopolassar', prepare: (g, { cap }) => secondCity(g, cap) }, 'a', 0],
  ['Nabopolassar attacking the Barbarians', { leader: 'nabopolassar', foe: BARBARIAN }, 'a', 0],
  ['Nabopolassar defending', { foeLeader: 'nabopolassar' }, 'd', 2],
  ['Nebuchadnezzar attacking a city with a Temple', { leader: 'nebuchadnezzar', city: ['temple'] }, 'a', 2],
  ['Nebuchadnezzar attacking a city without a Temple', { leader: 'nebuchadnezzar', city: ['market'] }, 'a', 0],
  ['Nebuchadnezzar attacking in the open', { leader: 'nebuchadnezzar' }, 'a', 0],
  ['Nebuchadnezzar defending a city with a Temple', { foeLeader: 'nebuchadnezzar', city: ['temple'] }, 'd', 0],
  ['Dido defending a city', { foeLeader: 'dido', city: [] }, 'd', 2],
  ['Dido defending in the open', { foeLeader: 'dido' }, 'd', 0],
  ['Dido attacking a city', { leader: 'dido', city: [] }, 'a', 0],
  ['Boudica against a player with more Warfare Advances', { leader: 'boudica', prepare: (g) => give(g, 1, { advances: ['tactics'] }) }, 'a', 2],
  ['Boudica against a player with as many Warfare Advances', { leader: 'boudica', prepare: withTactics }, 'a', 0],
  ['Boudica against the Barbarians', { leader: 'boudica', foe: BARBARIAN }, 'a', 0],
  ['Boudica defending', { foeLeader: 'boudica', prepare: (g) => give(g, 0, { advances: ['tactics'] }) }, 'd', 2],
  ['Vercingetorix with the Settler of his capital beside him', { leader: 'vercingetorix' }, 'a', 1],
  [
    'Vercingetorix counts every Settler within 2 spaces of him',
    {
      leader: 'vercingetorix',
      prepare: (g, { cap }) => {
        troops(g, 0, 'settler', cap.hex);
        troops(g, 0, 'settler', ring(g, cap.hex, 2)[0]);
      },
    },
    'a', 3,
  ],
  ['Vercingetorix ignores a Settler 3 spaces away', { leader: 'vercingetorix', prepare: (g, { cap }) => troops(g, 0, 'settler', ring(g, cap.hex, 3)[0]) }, 'a', 1],
  ['Wu Zetian with more units than the enemy', { leader: 'wu_zetian', atk: ['infantry'] }, 'a', 2],
  ['Wu Zetian with as many units as the enemy', { leader: 'wu_zetian' }, 'a', 0],
  ['Wu Zetian outnumbered', { leader: 'wu_zetian', def: ['infantry', 'infantry'] }, 'a', 0],
  ['Wu Zetian defending with more units', { foeLeader: 'wu_zetian' }, 'd', 2],
  ['Ramses attacking a city by the sea', { leader: 'ramses', city: [], prepare: seaBeside }, 'a', 2],
  ['Ramses attacking an inland city', { leader: 'ramses', city: [] }, 'a', 0],
  ['Ramses attacking in the open by the sea', { leader: 'ramses', prepare: seaBeside }, 'a', 0],
  ['Leonidas outnumbered by 2', { leader: 'leonidas', def: ['infantry', 'infantry', 'infantry'] }, 'a', 4],
  ['Leonidas against as many units', { leader: 'leonidas' }, 'a', 0],
  ['Leonidas with more units', { leader: 'leonidas', atk: ['infantry', 'infantry'] }, 'a', 0],
  ['Leonidas defending outnumbered by 2', { foeLeader: 'leonidas', def: [], atk: ['infantry', 'infantry', 'infantry'] }, 'd', 4],
  ['Alexander with a city in his start Region only', { leader: 'alexander' }, 'a', 0],
  ['Alexander with another city in his start Region', { leader: 'alexander', prepare: (g, { cap }) => town(g, 0, inRegion(true)(g, cap)) }, 'a', 0],
  ['Alexander with a city in one other Region', { leader: 'alexander', prepare: (g, { cap }) => secondCity(g, cap) }, 'a', 1],
  [
    'Alexander with cities in two other Regions',
    { leader: 'alexander', prepare: (g, { cap }) => town(g, 0, elsewhere(g, cap.hex, secondCity(g, cap).hex)) },
    'a', 2,
  ],
  ['Maharaja with no Combat card', { leader: 'maharaja' }, 'a', 2],
  ['Maharaja holding a Combat card he does not play', { leader: 'maharaja', cards: ['timber'], ask: { combat_card: 'none', retreat: 'yes' } }, 'a', 2],
  ['Maharaja playing a Combat card', { leader: 'maharaja', cards: ['timber'], ask: { combat_card: 'timber', retreat: 'yes' } }, 'a', 0],
  ['Suiko defending', { foeLeader: 'suiko' }, 'd', 2],
  ['Suiko attacking', { leader: 'suiko' }, 'a', 0],
  ['Wak with a city of hers next to the battle', { leader: 'wak' }, 'a', 2],
  ['Wak fighting far from her cities', { leader: 'wak', where: far }, 'a', 0],
  ['Wak defending with a city 2 spaces away', { foeLeader: 'wak', prepare: (g, { hex }) => town(g, 1, ring(g, hex, 2)[0]) }, 'd', 2],
  ['Wak defending with her nearest city 3 spaces away', { foeLeader: 'wak', prepare: (g, { hex }) => town(g, 1, ring(g, hex, 3)[0]) }, 'd', 0],
  ['Siyaj K\'ak\' attacking a city of size 3', { leader: 'siyaj_kak', city: ['market', 'temple'] }, 'a', 3],
  ['Siyaj K\'ak\' attacking a city of size 1', { leader: 'siyaj_kak', city: [] }, 'a', 1],
  ['Siyaj K\'ak\' attacking in the open', { leader: 'siyaj_kak' }, 'a', 0],
  ['Siyaj K\'ak\' defending a city', { foeLeader: 'siyaj_kak', city: ['market'] }, 'd', 0],
  ['Ithobaal with a Temple city next to the battle', { leader: 'ithobaal', prepare: (g, { cap }) => { cap.buildings.temple = 0; } }, 'a', 2],
  ['Ithobaal with a Temple city 2 spaces away', { leader: 'ithobaal', prepare: (g, { hex }) => town(g, 0, ring(g, hex, 2)[0], 'neutral', ['temple']) }, 'a', 2],
  ['Ithobaal with a Temple city 3 spaces away', { leader: 'ithobaal', prepare: (g, { hex }) => town(g, 0, ring(g, hex, 3)[0], 'neutral', ['temple']) }, 'a', 0],
  ['Ithobaal with no Temple near', { leader: 'ithobaal' }, 'a', 0],
  ['Augustus fighting in a Region without his cities', { leader: 'augustus', where: inRegion(false) }, 'a', 2],
  ['Augustus fighting in a Region with his city', { leader: 'augustus', where: inRegion(true) }, 'a', 0],
  ['Sulla against the Barbarians', { leader: 'sulla', foe: BARBARIAN }, 'a', 2],
  ['Sulla against a player', { leader: 'sulla' }, 'a', 0],
  ['Ragnar landing from the sea', { leader: 'ragnar', landed: true }, 'a', 2],
  ['Ragnar attacking by land', { leader: 'ragnar' }, 'a', 0],
  ['Jimmu in the Fortress city he defends', { foeLeader: 'jimmu', city: ['fortress'] }, 'd', 2],
  [
    'Jimmu 2 spaces from the Fortress city, though he does not fight',
    { foeLeader: 'jimmu', city: ['fortress'], prepare: (g, { hex }) => { leaderUnit(g.s, 1).hex = ring(g, hex, 2)[0]; } },
    'd', 2, false,
  ],
  [
    'Jimmu 3 spaces from the Fortress city',
    { foeLeader: 'jimmu', city: ['fortress'], prepare: (g, { hex }) => { leaderUnit(g.s, 1).hex = ring(g, hex, 3)[0]; } },
    'd', 0, false,
  ],
  ['Jimmu defending a city without a Fortress', { foeLeader: 'jimmu', city: ['market'] }, 'd', 0],
];

for (const [what, opts, side, cv, present = true] of CV_ROWS) {
  test(`Leader CV: ${what} adds ${cv} CV`, () => {
    const t = fight(opts);
    const id = opts.leader ?? opts.foeLeader;
    assert.equal(t[side].lead, present ? id : null, present ? 'the Leader fights' : 'he is not in the battle');
    assert.equal(bonus(t[side]), cv);
    if (cv) assert.equal(t[side].leaderCv[0].label, LEADERS[id].name);
    if (!opts.cards) assert.equal(t[side].mod, cv, 'the CV of the round counts it');
  });
}

test('Siyaj K\'ak\' adds the size of the city in the first round only', () => {
  const t = fight({
    leader: 'siyaj_kak', city: ['market', 'temple'], def: ['infantry', 'infantry'], dice: [LOW, MISS, MISS], ask: { retreat: queue('no', 'yes') },
  });
  assert.equal(bonus(t.rounds[0].a), 3);
  assert.equal(bonus(t.rounds[1].a), 0);
});

// ------------------------------------------------ CV paid for, or that lasts
const RIGGED_TWO = { def: ['infantry', 'infantry'], dice: [LOW, MISS, MISS] };

test('Go-Toba: 1 Ore adds 2 CV to every round of the battle, and he is asked only once', () => {
  const t = fight({
    ...RIGGED_TWO, leader: 'go_toba', ask: { go_toba: 'yes', retreat: queue('no', 'yes') }, prepare: (g) => stock(g, 0, { ore: 2 }),
  });
  assert.deepEqual(t.rounds.slice(0, 2).map((r) => bonus(r.a)), [2, 2]);
  assert.equal(asksOf(t.asked, 'go_toba').length, 1);
  assert.equal(me(t.g).res.ore, 1);
  assert.ok(logged(t.g, /pays 1 Ore: Go-Toba/));
});

test('Go-Toba: while he is not paid he is asked again in the next round, and he asks nothing of a player without Ore', () => {
  const no = fight({
    ...RIGGED_TWO, leader: 'go_toba', ask: { go_toba: 'no', retreat: queue('no', 'yes') }, prepare: (g) => stock(g, 0, { ore: 2 }),
  });
  assert.equal(asksOf(no.asked, 'go_toba').length, 2);
  assert.deepEqual(no.rounds.slice(0, 2).map((r) => bonus(r.a)), [0, 0]);
  assert.equal(me(no.g).res.ore, 2);
  const broke = fight({ ...RIGGED_TWO, leader: 'go_toba', ask: { retreat: queue('no', 'yes') } });
  assert.equal(asksOf(broke.asked, 'go_toba').length, 0);
  assert.deepEqual(broke.rounds.slice(0, 2).map((r) => bonus(r.a)), [0, 0]);
});

test('Akbar: 2 Ore make each Elephant of his army add 1 CV in every round until it is lost', () => {
  const t = fight({
    leader: 'akbar', atk: ['elephant', 'elephant'], def: ['infantry', 'infantry'], dice: [LOW, LOW, LOW, HIT, MISS],
    ask: { akbar: 'yes', retreat: queue('no', 'yes') }, prepare: (g) => stock(g, 0, { ore: 2 }),
  });
  assert.equal(t.a.lost, 1, 'an Elephant goes down in round 1');
  assert.deepEqual(t.rounds.slice(0, 2).map((r) => bonus(r.a)), [2, 1]);
  assert.equal(asksOf(t.asked, 'akbar').length, 1);
  assert.equal(me(t.g).res.ore, 0);
});

test('Akbar asks nothing of an army without an Elephant or of a player with less than 2 Ore', () => {
  const none = fight({ leader: 'akbar', atk: ['infantry'], prepare: (g) => stock(g, 0, { ore: 2 }) });
  assert.equal(asksOf(none.asked, 'akbar').length, 0);
  const poor = fight({ leader: 'akbar', atk: ['elephant'], prepare: (g) => stock(g, 0, { ore: 1 }) });
  assert.equal(asksOf(poor.asked, 'akbar').length, 0);
  assert.equal(bonus(poor.a), 0);
});

// ------------------------------------------------------------- cards
test('Cyrus: a Combat card of his may count as +2 CV instead of its normal effect, and the weak ones do so by default', () => {
  const play = (card, cyrus) => fight({ leader: 'cyrus', cards: [card], ask: { combat_card: card, cyrus, retreat: 'yes' } }).a;
  assert.equal(play('surprise', 'yes').mod, 2);
  assert.equal(play('surprise', 'no').mod, 1, 'Flanking alone is +1 CV');
  assert.equal(play('surprise', undefined).mod, 2, 'a card worth +1 CV is better as +2 by default');
  assert.equal(play('windfall', undefined).mod, 3, 'a card worth +3 CV is played as it is by default');
  assert.equal(play('windfall', 'yes').mod, 2);
  assert.equal(play('surprise', 'yes').card, 'surprise', 'the card is spent either way');
});

test('Xerxes: an army of more than 4 Army units plays no Combat cards, an army of 4 does', () => {
  const play = (leader, atk) => fight({ leader, atk, cards: ['timber'], ask: { combat_card: 'timber', retreat: 'yes' } });
  const big = play('xerxes', ['infantry', 'infantry', 'infantry', 'infantry']);
  assert.equal(asksOf(big.asked, 'combat_card').length, 0);
  assert.ok(!big.a.card);
  const small = play('xerxes', ['infantry', 'infantry', 'infantry']);
  assert.equal(asksOf(small.asked, 'combat_card').length, 1);
  assert.equal(small.a.card, 'timber');
  const other = play('hammurabi', ['infantry', 'infantry', 'infantry', 'infantry']);
  assert.equal(other.a.card, 'timber', 'only his army is held back');
});

// ------------------------------------------------------------- the dice
test('Bleda: the Fortress of the city he attacks cancels no hit', () => {
  const plain = fight({ atk: ['infantry'], city: ['fortress'] });
  const bleda = fight({ leader: 'bleda', atk: [], city: ['fortress'] });
  assert.equal(plain.round.cancelD, 1);
  assert.equal(bleda.round.cancelD, 0);
});

test('Attila: in the first round one of his Cavalry cancels a hit like an Elephant', () => {
  const dice = [[2, 'cavalry'], [3, 'elephant'], HIT];
  const attila = fight({ leader: 'attila', atk: ['cavalry'], dice });
  assert.equal(attila.a.elephants, 1);
  assert.equal(attila.round.cancelA, 1);
  assert.equal(attila.a.lost, 0);
  const other = fight({ leader: 'hammurabi', atk: ['cavalry'], dice });
  assert.equal(other.a.elephants, 0);
  assert.equal(other.round.cancelA, 0);
  assert.equal(other.a.lost, 1);
});

test('Leader Clash: a Leader\'s army rolls a die that shows the Leader icon again, for one die per Leader', () => {
  const t = fight({ leader: 'imhotep', atk: ['infantry'], dice: [[1, 'leader'], [1, 'leader'], [5, 'infantry'], LOW] });
  assert.deepEqual(t.a.dice.map((d) => [d.v, d.icon]), [[5, 'infantry'], [1, 'leader']]);
  assert.equal(t.a.cv, 7, '5 and 1 for the Infantry icon: the second Leader icon stays a plain 1');
  const plain = fight({ atk: ['infantry', 'infantry'], dice: [[1, 'leader'], [1, 'leader'], LOW] });
  assert.deepEqual(plain.a.dice.map((d) => d.v), [1, 1], 'an army without a Leader keeps them');
});

test('Hannibal rerolls one die of the first round and keeps the new result', () => {
  const t = fight({ leader: 'hannibal', dice: [LOW, MISS, [5, 'infantry']] });
  assert.equal(asksOf(t.asked, 'hannibal').length, 1);
  assert.equal(t.a.dice[0].v, 5);
  assert.match(t.round.notes.join(' '), /rerolls a 2 and gets a 5/);
  const kept = fight({ leader: 'hannibal', ask: { hannibal: 'none', retreat: 'yes' }, dice: [LOW, MISS] });
  assert.equal(kept.a.dice[0].v, 2);
  assert.deepEqual(kept.round.notes, []);
});

test('Hannibal rerolls the same die once more when his army has fewer units, and is asked for each reroll', () => {
  const t = fight({ leader: 'hannibal', def: ['infantry', 'infantry'], dice: [LOW, MISS, MISS, [3, 'infantry'], [5, 'cavalry']] });
  const asks = asksOf(t.asked, 'hannibal');
  assert.equal(asks.length, 2);
  assert.deepEqual(optionIds(asks[1]), ['none', '0'], 'the second one is the same die again');
  assert.equal(t.a.dice[0].v, 5);
  assert.match(t.round.notes.join(' '), /rerolls a 2 and gets a 3.*rerolls a 3 and gets a 5/);
});

// ------------------------------------------------------ hits cancelled
/** A duel: the army of the Leader (an Infantry beside him) rolls too low to hurt, and the one Infantry facing it hits in every round. */
const duel = (opts) => fight({
  atk: ['infantry'], def: ['infantry'], dice: [LOW, LOW, HIT, LOW, LOW, HIT], ...opts, ask: { retreat: queue('no', 'yes'), ...opts.ask },
});
/** For each of the first two rounds of a `duel`: the hits the Leader cancelled, and the units his army lost. */
const outcome = (t) => t.rounds.slice(0, 2).map((r) => [r.cancelA, r.a.lost]);

test('Ahuitzotl: his army cancels one hit in a Region where the Aztecs have no city, and only one in the battle', () => {
  const away = duel({ leader: 'ahuitzotl', where: inRegion(false) });
  assert.deepEqual(outcome(away), [[1, 0], [0, 1]]);
  assert.match(away.round.notes.join(' '), /Ahuitzotl's army cancels a hit/);
  const home = duel({ leader: 'ahuitzotl', where: inRegion(true) });
  assert.deepEqual([home.round.cancelA, home.a.lost], [0, 1], 'nothing is cancelled in the Region of one of his cities');
});

test('Qin Shi Huang: 2 Culture cancel a hit, once in the battle, and by default only from 4 Culture on', () => {
  const rich = (culture, ask) => duel({ leader: 'qin', ask, prepare: (g) => stock(g, 0, { culture }) });
  const paid = rich(6, { qin: 'yes' });
  assert.deepEqual(outcome(paid), [[1, 0], [0, 1]]);
  assert.equal(asksOf(paid.asked, 'qin').length, 1, 'he is not asked again');
  assert.equal(me(paid.g).culture, 4);
  assert.match(paid.round.notes.join(' '), /pays 2 Culture: Qin Shi Huang cancels a hit/);
  const declined = rich(6, { qin: 'no' });
  assert.equal(declined.a.lost, 1);
  assert.equal(me(declined.g).culture, 6);
  assert.deepEqual(outcome(rich(4, {}))[0], [1, 0], 'with 4 Culture the default is to pay');
  assert.deepEqual(outcome(rich(3, {}))[0], [0, 1], 'with 3 the default is not to');
  const poor = rich(1, { qin: 'yes' });
  assert.equal(asksOf(poor.asked, 'qin').length, 0);
  assert.equal(poor.a.lost, 1);
});

/** Pygmalion defends a city of size 1 against 1 Infantry; seat 1 holds `culture` tokens. */
const keep = (culture, opts) => fight({ foeLeader: 'pygmalion', city: [], prepare: (g) => stock(g, 1, { culture }), ...opts });
/** One hit on his city and one on the attacker's only Infantry. */
const WIPED = { atk: ['infantry'], dice: [HIT, HIT, LOW] };
/** One hit on his city and none on the two Infantry attacking it. */
const STANDOFF = { atk: ['infantry', 'infantry'], dice: [HIT, LOW, LOW, LOW] };

test('Pygmalion: 1 Culture cancels a hit on his city, and the token comes back when the battle is won', () => {
  const t = keep(3, WIPED);
  assert.equal(asksOf(t.askedFoe, 'pygmalion').length, 1);
  assert.deepEqual([t.round.cancelD, t.d.lost], [1, 0]);
  assert.match(t.round.notes.join(' '), /pays 1 Culture: Pygmalion cancels a hit/);
  assert.equal(t.end.winner, 1);
  assert.equal(me(t.g, 1).culture, 3, 'paid 1 and got it back');
  assert.ok(logged(t.g, /gets the Culture back/));
});

test('Pygmalion: the Culture is not given back when the attackers only retreat', () => {
  const t = keep(3, STANDOFF);
  assert.deepEqual([t.round.cancelD, t.d.lost], [1, 0]);
  assert.equal(t.end.winner, null);
  assert.equal(me(t.g, 1).culture, 2);
});

test('Pygmalion: he may refuse, and he asks nothing without Culture, outside a city or when he is the attacker', () => {
  const declined = keep(3, { ...WIPED, foeAsk: { pygmalion: 'no' } });
  assert.equal(declined.d.lost, 1);
  assert.equal(me(declined.g, 1).culture, 3);
  assert.equal(keep(2, WIPED).round.cancelD, 1, 'the default is to pay from 2 Culture on');
  assert.equal(keep(1, WIPED).round.cancelD, 0, 'and not to with 1');
  const broke = keep(0, WIPED);
  assert.equal(asksOf(broke.askedFoe, 'pygmalion').length, 0);
  assert.equal(broke.d.lost, 1);
  const open = fight({ foeLeader: 'pygmalion', ...WIPED, prepare: (g) => stock(g, 1, { culture: 3 }) });
  assert.equal(asksOf(open.askedFoe, 'pygmalion').length, 0, 'not outside a city');
  const raid = fight({ leader: 'pygmalion', city: [], atk: ['infantry'], dice: [LOW, LOW, HIT], prepare: (g) => stock(g, 0, { culture: 3 }) });
  assert.equal(asksOf(raid.asked, 'pygmalion').length, 0, 'nor when he attacks');
});

// ------------------------------------------------------------------ Dido
/** Two Infantry attack the city of Dido and the Infantry with her: her city hits once, they never do. */
const siege = (foeAsk, opts = {}) => fight({
  foeLeader: 'dido', city: [], atk: ['infantry', 'infantry'], dice: [MISS, MISS, LOW, LOW], foeAsk, ...opts,
});

test('Dido: after a round her city survives, her player may eliminate her; the attack ceases and nobody scores her', () => {
  const t = siege({ dido: 'yes' });
  assert.deepEqual([t.d.hits, t.a.lost], [1, 1]);
  assert.equal(leaderUnit(t.g.s, 1), null);
  assert.deepEqual(me(t.g, 1).leaderLost, ['dido']);
  assert.deepEqual(me(t.g, 0).leaderCaptured, []);
  assert.deepEqual([t.end.retreated, t.end.winner], [true, null]);
  assert.equal(asksOf(t.asked, 'retreat').length, 0, 'the attacker is not asked');
  assert.equal(cityAt(t.g.s, t.hex).owner, 1, 'the city is not taken');
  assert.ok(logged(t.g, /sacrifices Queen Dido/));
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Dido: she may stay, and by default she is eliminated only when she is alone in the city', () => {
  const stay = siege({ dido: 'no' });
  assert.ok(leaderUnit(stay.g.s, 1));
  assert.equal(asksOf(stay.asked, 'retreat').length, 1, 'the battle goes on until the attacker retreats');
  assert.ok(leaderUnit(siege({}).g.s, 1), 'defended by an Infantry she stays');
  const alone = siege({}, { def: [], dice: [MISS, MISS, LOW] });
  assert.equal(asksOf(alone.askedFoe, 'dido').length, 1);
  assert.equal(leaderUnit(alone.g.s, 1), null);
});

test('Dido: no question outside her city', () => {
  const open = fight({ foeLeader: 'dido', atk: ['infantry', 'infantry'], dice: [MISS, MISS, LOW, LOW] });
  assert.equal(asksOf(open.askedFoe, 'dido').length, 0);
  assert.ok(leaderUnit(open.g.s, 1));
});

// --------------------------------------------------------------- Viriatus
const firstTarget = (prompt) => prompt.options.find((o) => o.id !== 'none').id;

test('Viriatus: after a round he survives, 2 Mood send an enemy unit out of the battle to an empty land space beside it', () => {
  const t = fight({
    leader: 'viriatus', def: ['infantry', 'infantry'], dice: [LOW, MISS, MISS], prepare: (g) => stock(g, 0, { mood: 3 }),
    ask: { viriatus: firstTarget, retreat: 'yes' },
  });
  const [question] = asksOf(t.asked, 'viriatus');
  const target = unitById(t.g.s, question.options.find((o) => o.id !== 'none').id);
  assert.equal(optionIds(question).length, 3, 'no, or one of the two Infantry');
  assert.ok(target.hex !== t.hex && nbrs(t.g.s, t.hex).includes(target.hex));
  assert.equal(unitsAt(t.g.s, target.hex).length, 1);
  assert.equal(asksOf(t.asked, 'pick_hex').length, 1);
  assert.equal(me(t.g).mood, 1);
  assert.ok(logged(t.g, /pays 2 Mood: Viriatus drives .* out of the battle/));
  assert.deepEqual(ofType(t.events, 'move').filter((e) => e.player === 1).map((e) => [e.units, e.to]), [[[target.id], target.hex]]);
});

test('Viriatus: defending, he drives one of the attackers out, and it no longer fights in the next round', () => {
  const t = fight({
    foeLeader: 'viriatus', def: [], atk: ['infantry', 'infantry'], dice: [MISS, MISS, LOW], prepare: (g) => stock(g, 1, { mood: 3 }),
    foeAsk: { viriatus: firstTarget }, ask: { retreat: queue('no', 'yes') },
  });
  assert.equal(asksOf(t.askedFoe, 'viriatus').length, 1, 'with 1 Mood left he is not asked again');
  assert.equal(me(t.g, 1).mood, 1);
  assert.deepEqual(t.rounds.slice(0, 2).map((r) => r.a.dice.length), [2, 1]);
});

test('Viriatus: no question with less than 2 Mood or against the Barbarians, and nothing is paid when he declines', () => {
  const army = { leader: 'viriatus', def: ['infantry', 'infantry'], dice: [LOW, MISS, MISS] };
  const poor = fight({ ...army, prepare: (g) => stock(g, 0, { mood: 1 }) });
  assert.equal(asksOf(poor.asked, 'viriatus').length, 0);
  const wild = fight({ ...army, foe: BARBARIAN, prepare: (g) => stock(g, 0, { mood: 3 }) });
  assert.equal(asksOf(wild.asked, 'viriatus').length, 0);
  const none = fight({ ...army, prepare: (g) => stock(g, 0, { mood: 3 }), ask: { viriatus: 'none', retreat: 'yes' } });
  assert.equal(me(none.g).mood, 3, 'and nothing is paid when he declines');
  assert.equal(asksOf(none.asked, 'pick_hex').length, 0);
});

/** A Barbarian city defended by an Infantry; the Viriatus of seat 1 stands `d` spaces from it, and seat 1 holds Rally and Tactics. */
const helped = (d) => fight({
  foe: BARBARIAN, city: [], atk: ['infantry'], def: ['infantry'], dice: [LOW, LOW],
  prepare: (g, { hex }) => {
    placeLeader(g, 1, 'viriatus', ring(g, hex, d)[0]);
    give(g, 1, { advances: ['tactics'] });
    hold(g, 1, 'timber');
    return listen(g, 1, { combat_card: 'timber' });
  },
});

test('Viriatus: his player plays the Combat cards of Barbarians defending a city within 2 spaces of him', () => {
  const t = helped(2);
  assert.equal(asksOf(t.prepared, 'combat_card').length, 1);
  assert.equal(t.d.card, 'timber');
  assert.equal(t.d.mod, 2);
  assert.ok(!t.g.s.players[1].hand.action.includes('timber'), 'it is a card of his hand');
  assert.ok(t.g.s.decks.actionDiscard.includes('timber'));
  const far = helped(3);
  assert.equal(far.prepared.length, 0);
  assert.ok(!far.d.card);
});

test('Viriatus: the Barbarians have no help against the player who holds him', () => {
  const t = fight({ leader: 'viriatus', foe: BARBARIAN, city: [], cards: ['timber'], dice: [LOW, LOW], ask: { combat_card: 'timber', retreat: 'yes' } });
  assert.equal(asksOf(t.asked, 'combat_card').length, 1, 'only for his own army');
  assert.equal(t.a.card, 'timber');
  assert.ok(!t.d.card);
});

test('Viriatus: his player plays the Combat cards of Barbarians attacking from a city within 2 spaces of him', () => {
  const g = world(['rome', 'greece']);
  const camp = ring(g, capitalOf(g).hex, 3)[0];
  const hex = ring(g, camp, 1)[0];
  town(g, BARBARIAN, camp);
  const raider = troops(g, BARBARIAN, 'infantry', camp)[0];
  troops(g, 0, 'infantry', hex);
  placeLeader(g, 1, 'viriatus', ring(g, camp, 2)[0]);
  give(g, 1, { advances: ['tactics'] });
  hold(g, 1, 'timber');
  hold(g, 0);
  stock(g, 0, {});
  const asked = listen(g, 1, { combat_card: 'timber' });
  rigDice(g, LOW, LOW);
  g.drainEvents();
  const r = g._run(battle(g, landBattle(BARBARIAN, 0, hex, camp, [raider.id])));
  assert.ok(r.ok, r.error);
  const [round] = ofType(g.drainEvents(), 'battle_round');
  assert.equal(asksOf(asked, 'combat_card').length, 1);
  assert.equal(round.a.card, 'timber');
  assert.equal(round.a.mod, 2);
});

// ----------------------------------------------------------- what they earn
test('Sun Tzu: winning in a single round against an army gives 1 Culture and 1 Mood, the Barbarians included', () => {
  for (const foe of [1, BARBARIAN]) {
    const t = fight({ leader: 'sun_tzu', foe, def: ['infantry'], dice: [HIT, MISS] });
    assert.deepEqual([t.rounds.length, t.end.winner], [1, 0]);
    assert.deepEqual([me(t.g).culture, me(t.g).mood], [1, 1]);
    assert.ok(logged(t.g, /gains 1 Culture and 1 Mood: Sun Tzu wins in a single round/));
  }
  const defended = fight({ foeLeader: 'sun_tzu', atk: ['infantry'], dice: [MISS, HIT, LOW] });
  assert.equal(defended.end.winner, 1);
  assert.deepEqual([me(defended.g, 1).culture, me(defended.g, 1).mood], [1, 1], 'as the defender too');
});

test('Sun Tzu: nothing for a win in more rounds, for a retreat, or for walking into a city nobody defends', () => {
  const slow = fight({ leader: 'sun_tzu', def: ['infantry', 'infantry'], dice: [HIT, MISS, MISS, HIT, MISS], ask: { retreat: 'no' } });
  assert.deepEqual([slow.rounds.length, slow.end.winner], [2, 0]);
  assert.deepEqual([me(slow.g).culture, me(slow.g).mood], [0, 0]);
  const run = fight({ leader: 'sun_tzu', def: ['infantry', 'infantry'], dice: [HIT, MISS, MISS] });
  assert.equal(run.end.winner, null);
  assert.deepEqual([me(run.g).culture, me(run.g).mood], [0, 0]);
  const empty = fight({ leader: 'sun_tzu', def: [], city: [] });
  assert.equal(empty.end.winner, 0);
  assert.deepEqual([me(empty.g).culture, me(empty.g).mood], [0, 0]);
  const other = fight({ leader: 'hammurabi', def: ['infantry'], dice: [HIT, MISS] });
  assert.deepEqual([me(other.g).culture, me(other.g).mood], [0, 0], 'only his');
});

test('Jimmu: for 1 Culture his player takes back an Action card that was spent in the battle he fought', () => {
  const play = (jimmu, culture = 1) => fight({
    leader: 'jimmu', cards: ['timber'], ask: { combat_card: 'timber', jimmu, retreat: 'yes' }, prepare: (g) => stock(g, 0, { culture }),
  });
  const back = play('timber');
  assert.equal(back.a.card, 'timber');
  assert.equal(me(back.g).culture, 0);
  assert.ok(me(back.g).hand.action.includes('timber'));
  assert.ok(!back.g.s.decks.actionDiscard.includes('timber'));
  assert.ok(logged(back.g, /pays 1 Culture and takes .* back \(Jimmu\)/));
  const left = play('none');
  assert.equal(me(left.g).culture, 1);
  assert.ok(!me(left.g).hand.action.includes('timber'));
  assert.ok(left.g.s.decks.actionDiscard.includes('timber'));
  assert.equal(asksOf(play(undefined, 0).asked, 'jimmu').length, 0, 'no Culture, no question');
  assert.equal(me(play(undefined, 2).g).culture, 1, 'with 2 Culture the default is to take it back');
  assert.equal(me(play(undefined, 1).g).culture, 1, 'with 1 it is not');
});

test('Jimmu: nothing to take back when his army played no card, or when another Leader fought', () => {
  const idle = fight({ leader: 'jimmu', ask: { combat_card: 'none', retreat: 'yes' }, prepare: (g) => stock(g, 0, { culture: 3 }) });
  assert.equal(asksOf(idle.asked, 'jimmu').length, 0);
  const other = fight({ leader: 'hammurabi', cards: ['timber'], ask: { combat_card: 'timber', retreat: 'yes' }, prepare: (g) => stock(g, 0, { culture: 3 }) });
  assert.equal(asksOf(other.asked, 'jimmu').length, 0);
});

// ------------------------------------------------------------------- at sea
const THREE = [3, 'infantry'];

/**
 * Seat 0 sails `ships` Ships into the Sea space where `def` Ships of `foe` (seat 1 or the Pirates) lie, and `foeLeader` with them.
 * `leader` sails along, unless `aboard` is false: it then stays in its capital. A battle at sea has no Clash, so any face does for
 * a die that must stay put. `dice`, `ask` and `prepare(g, { o, from })` are as in `fight`.
 */
function fleet({ leader, foeLeader, aboard = true, foe = PIRATE, ships = 1, def = 1, dice, ask = { retreat: 'yes' }, prepare }) {
  const civ0 = peopleOf(leader) ?? 'rome';
  const g = world([civ0, peopleOf(foeLeader) ?? (civ0 === 'rome' ? 'greece' : 'rome')], { opponents: 2 });
  const { o, at } = bay(g);
  const from = at(W);
  setTerrain(g, o, 'sea');
  setTerrain(g, from, 'sea');
  const mine = troops(g, 0, 'ship', from, ships).map((u) => u.id);
  if (foe === PIRATE) pirates(g, ...Array(def).fill(o));
  else troops(g, foe, 'ship', o, def);
  const leaderId = leader ? placeLeader(g, 0, leader, aboard ? from : capitalOf(g).hex).id : null;
  if (foeLeader) placeLeader(g, foe, foeLeader, o);
  prepare?.(g, { o, from });
  hold(g, 0);
  const asked = listen(g, 0, ask);
  if (foe !== PIRATE) {
    hold(g, foe);
    listen(g, foe, {});
  }
  rigDice(g, ...dice);
  g.drainEvents();
  const carried = leaderId && aboard ? [leaderId] : [];
  const r = g._run(battle(g, { domain: 'sea', attacker: 0, defender: foe, hex: o, from, units: mine, settlers: [], carried, landed: false, inPlace: false }));
  assert.ok(r.ok, r.error);
  assert.equal(g.pending, null);
  const events = g.drainEvents();
  const rounds = ofType(events, 'battle_round');
  return { g, o, from, mine, leaderId, asked, events, rounds, round: rounds[0], a: rounds[0]?.a, d: rounds[0]?.d, end: ofType(events, 'battle_end')[0] };
}

test('Hanno and Pericles: the Ships of the fleet they sail with add 2 CV, once for the whole fleet', () => {
  for (const leader of ['hanno', 'pericles']) {
    const sailed = fleet({ leader, dice: [THREE, MISS] });
    assert.deepEqual([bonus(sailed.a), sailed.a.cv, sailed.a.hits, sailed.end.winner], [2, 5, 1, 0], leader);
    const two = fleet({ leader, ships: 2, dice: [THREE, MISS, MISS] });
    assert.equal(bonus(two.a), 2, `${leader}: 2 CV for the fleet, not for each Ship`);
    const home = fleet({ leader, aboard: false, dice: [THREE, MISS] });
    assert.deepEqual([bonus(home.a), home.a.cv, home.a.hits, home.end.winner], [0, 3, 0, null], `${leader} stays on land`);
  }
});

test('Pericles: defending, he adds 2 CV when he is with the Ships that are attacked', () => {
  const t = fleet({ foe: 1, foeLeader: 'pericles', dice: [MISS, THREE] });
  assert.deepEqual([bonus(t.d), t.d.cv, t.d.hits, bonus(t.a)], [2, 5, 1, 0]);
  assert.equal(t.end.winner, 1);
  assert.equal(logged(t.g, /Leader bonus for .*: \+2 Pericles\./), true);
});

test('Ramses: his Ships add 2 CV against the Pirates and not against a player', () => {
  const pirate = fleet({ leader: 'ramses', dice: [THREE, MISS] });
  assert.deepEqual([bonus(pirate.a), pirate.a.hits, pirate.end.winner], [2, 1, 0]);
  const player = fleet({ leader: 'ramses', foe: 1, dice: [THREE, MISS] });
  assert.deepEqual([bonus(player.a), player.a.hits, player.end.winner], [0, 0, null]);
});

test('A Leader whose Ships are all sunk goes down with them: the enemy player takes him, the Pirates only drown him', () => {
  const sunk = fleet({ leader: 'hanno', foe: 1, dice: [LOW, HIT] });
  assert.equal(sunk.end.winner, 1);
  assert.deepEqual([me(sunk.g).leader, me(sunk.g).leaderLost], [null, ['hanno']]);
  assert.deepEqual(me(sunk.g, 1).leaderCaptured, [{ id: 'hanno', from: 0 }]);
  assert.equal(scoreOf(sunk.g.s, 1).parts.civ, LEADER_CAPTURE_VP);
  assert.ok(!unitById(sunk.g.s, sunk.leaderId));

  const drowned = fleet({ leader: 'hanno', dice: [LOW, HIT] });
  assert.equal(drowned.end.winner, PIRATE);
  assert.deepEqual([me(drowned.g).leader, me(drowned.g).leaderLost], [null, ['hanno']]);
  assert.deepEqual([1, 2].map((p) => me(drowned.g, p).leaderCaptured.length), [0, 0]);
});

test('A Leader stays aboard while a Ship is left to carry him, and one who stayed on land is not touched by the battle', () => {
  const kept = fleet({ leader: 'hanno', ships: 2, def: 2, dice: [LOW, LOW, HIT, LOW] });
  assert.deepEqual([kept.a.lost, kept.d.lost, kept.end.winner], [1, 1, null]);
  assert.equal(me(kept.g).leader, 'hanno');
  assert.equal(unitById(kept.g.s, kept.leaderId).hex, kept.from);
  const home = fleet({ leader: 'hanno', aboard: false, foe: 1, dice: [LOW, HIT] });
  assert.equal(home.end.winner, 1);
  assert.equal(me(home.g).leader, 'hanno');
});

// ------------------------------------------------------------ a Leader who falls
test('A Leader killed in a battle is taken by the player who beat him, who scores 2 VP; the Barbarians only get rid of him', () => {
  const t = fight({ leader: 'hammurabi', dice: [LOW, HIT] });
  assert.equal(t.end.winner, 1);
  assert.deepEqual([me(t.g).leader, me(t.g).leaderLost], [null, ['hammurabi']]);
  assert.deepEqual(me(t.g, 1).leaderCaptured, [{ id: 'hammurabi', from: 0 }]);
  assert.equal(scoreOf(t.g.s, 1).parts.civ, LEADER_CAPTURE_VP);
  assert.deepEqual(ofType(t.events, 'leader_lost').map((e) => [e.player, e.leader, e.by]), [[0, 'hammurabi', 1]]);
  assert.deepEqual(checkInvariants(t.g), []);

  const barbarians = fight({ leader: 'hammurabi', foe: BARBARIAN, dice: [LOW, HIT] });
  assert.equal(barbarians.end.winner, BARBARIAN);
  assert.deepEqual(me(barbarians.g).leaderLost, ['hammurabi']);
  assert.equal(me(barbarians.g, 1).leaderCaptured.length, 0);
  assert.deepEqual(checkInvariants(barbarians.g), []);
});

test('A defending Leader is taken by the Army that wins the battle', () => {
  const t = fight({ foeLeader: 'hammurabi', atk: ['infantry', 'infantry'], dice: [HIT, HIT, LOW, LOW] });
  assert.equal(t.end.winner, 0);
  assert.deepEqual(me(t.g).leaderCaptured, [{ id: 'hammurabi', from: 1 }]);
  assert.deepEqual([me(t.g, 1).leader, me(t.g, 1).leaderLost], [null, ['hammurabi']]);
  assert.equal(scoreOf(t.g.s, 0).parts.civ, LEADER_CAPTURE_VP);
  assert.deepEqual(checkInvariants(t.g), []);
});

test('The player of an Army with a Leader chooses whether he is among the casualties', () => {
  const army = { leader: 'hammurabi', atk: ['infantry'], dice: [LOW, LOW, HIT] };
  const spared = fight(army);
  assert.deepEqual(asksOf(spared.asked, 'casualties').map(optionIds), [['0', '1']]);
  assert.deepEqual([spared.a.lost, me(spared.g).leader, !!unitById(spared.g.s, spared.mine[1])], [1, 'hammurabi', false], 'by default the Infantry falls');
  const sacrificed = fight({ ...army, ask: { retreat: 'yes', casualties: '1' } });
  assert.deepEqual([sacrificed.a.lost, me(sacrificed.g).leader], [1, null]);
  assert.deepEqual(me(sacrificed.g, 1).leaderCaptured, [{ id: 'hammurabi', from: 0 }]);
  assert.deepEqual(checkInvariants(sacrificed.g), []);
});

// ------------------------------------------------------------ taking a city
/** The Army of `leader` walks into a city nobody defends. */
const walkIn = (leader, opts = {}) => fight({ leader, def: [], city: [], ...opts });
const taken = (t) => cityAt(t.g.s, t.hex);
const gold = (t) => me(t.g).res.gold;

test('Ashoka: 1 Culture for the city his Army takes, 2 when it has a Temple', () => {
  const plain = walkIn('ashoka');
  assert.deepEqual([plain.end.winner, plain.end.captured, taken(plain).owner, me(plain.g).culture], [0, true, 0, 1]);
  assert.equal(logged(plain.g, /gains 1 Culture: Ashoka takes a city\./), true);
  const temple = walkIn('ashoka', { city: ['temple'] });
  assert.equal(me(temple.g).culture, 2);
  assert.equal(logged(temple.g, /gains 2 Culture: Ashoka takes a city with a Temple/), true);
  assert.equal(me(walkIn('ashoka', { foe: BARBARIAN, city: ['temple'] }).g).culture, 2, 'a Barbarian city too');
  assert.equal(me(walkIn('hammurabi', { city: ['temple'] }).g).culture, 0, 'only his Army');
});

test('Rugila: 2 Gold for a city taken while another one that is not his lies within 2 spaces', () => {
  const plain = walkIn('rugila');
  assert.ok(hexDistance(capitalOf(plain.g, 1).hex, plain.hex) > 2, 'the other capital is out of reach');
  const gain = (opts) => gold(walkIn('rugila', opts)) - gold(walkIn('hammurabi', opts));
  const city = (foe, d) => ({ foe, prepare: (g, { hex }) => town(g, foe, ring(g, hex, d)[0]) });
  assert.equal(gain({}), 0, 'no other city near');
  assert.equal(gain(city(1, 2)), 2);
  assert.equal(gain(city(BARBARIAN, 2)), 2, 'Barbarian cities count');
  assert.equal(gain(city(1, 3)), 0, 'three spaces is too far');
  assert.equal(logged(walkIn('rugila', city(1, 2)).g, /gains 2 Gold: Rugila/), true);
});

test('Rugila: a Barbarian city he captures becomes Happy, a city of a player stays Angry', () => {
  assert.equal(taken(walkIn('rugila', { foe: BARBARIAN })).mood, 'happy');
  assert.equal(taken(walkIn('hammurabi', { foe: BARBARIAN })).mood, 'angry');
  assert.equal(taken(walkIn('rugila')).mood, 'angry');
});

test('Ragnar: 2 Gold for capturing a city that is not Angry', () => {
  const gain = (cityMood) => gold(walkIn('ragnar', { cityMood })) - gold(walkIn('hammurabi', { cityMood }));
  assert.deepEqual(['neutral', 'happy', 'angry'].map(gain), [2, 2, 0]);
});

test('Ithobaal: a city he captures that was under his cultural influence becomes Happy', () => {
  const influenced = { city: ['temple'], prepare: (g, { hex }) => { cityAt(g.s, hex).buildings.temple = 0; } };
  const t = walkIn('ithobaal', influenced);
  assert.deepEqual([taken(t).owner, taken(t).mood], [0, 'happy']);
  assert.equal(logged(t.g, /once under his influence, becomes Happy \(Ithobaal\)/), true);
  assert.equal(taken(walkIn('hammurabi', influenced)).mood, 'angry', 'only his Army');
  assert.equal(taken(walkIn('ithobaal', { city: ['temple'] })).mood, 'angry', 'nobody had influenced the city');
});

test('Nabopolassar: when a city of his player is captured a free Infantry stands with him, if there is room', () => {
  const lose = (leader, guards = 0) => {
    const g = world(['babylonia', 'rome']);
    const cap = capitalOf(g);
    placeLeader(g, 0, leader, cap.hex);
    troops(g, 0, 'infantry', cap.hex, guards);
    const city = secondCity(g, cap);
    const [from] = ring(g, city.hex, 1);
    const raider = troops(g, 1, 'infantry', from)[0];
    hold(g, 0);
    hold(g, 1);
    listen(g, 0, {});
    listen(g, 1, {});
    g.drainEvents();
    const r = g._run(battle(g, landBattle(1, 0, city.hex, from, [raider.id])));
    assert.ok(r.ok, r.error);
    assert.equal(cityAt(g.s, city.hex).owner, 1);
    return { g, infantry: unitsAt(g.s, cap.hex).filter((u) => u.owner === 0 && u.type === 'infantry').length };
  };
  const raised = lose('nabopolassar');
  assert.equal(raised.infantry, 1);
  assert.equal(logged(raised.g, /places a free Infantry with Nabopolassar/), true);
  assert.deepEqual(checkInvariants(raised.g), []);
  assert.equal(lose('nabopolassar', 3).infantry, 3, 'the stack of 4 is full');
  assert.equal(lose('hammurabi').infantry, 0, 'only his');
});

// ------------------------------------------------ a Move action that takes a city
/**
 * Seat 0 moves into a city of seat 1 next to its capital that nobody defends: the Leader `leader` goes alone, or an Infantry goes
 * and `who` is 'soldier' (the Leader stays home). Seat 0 has Tactics and `advances`; `buildings` are those of the city; `ask` answers
 * the questions of seat 0, and `prepare(g, { cap, city })` changes the table first.
 */
function march(civ, leader, { buildings = [], advances = [], prepare, ask = {}, who = 'leader' } = {}) {
  const { g, cap, unit } = lead(civ, leader);
  give(g, 0, { advances: ['tactics', ...advances] });
  const soldier = troops(g, 0, 'infantry', cap.hex)[0];
  const city = town(g, 1, ring(g, cap.hex, 1)[0], 'neutral', buildings);
  prepare?.(g, { cap, city });
  const asked = listen(g, 0, ask);
  g.drainEvents();
  const actions = g.s.turn.actionsLeft;
  act(g, { type: 'move', units: [who === 'soldier' ? soldier.id : unit.id], to: city.hex });
  return { g, cap, unit, soldier, asked, actions, hex: city.hex, events: g.drainEvents() };
}
/** The units of seat 0 in the city that a Recruit put there: the Leader and the soldier who may have come along do not count. */
const recruited = (t, type) => unitsAt(t.g.s, t.hex).filter((u) => u.owner === 0 && u.type === type && u.id !== t.soldier.id);
const stockFor = (res) => (g) => stock(g, 0, res);

test('Caesar: after taking a city he may pay 1 Gold to recruit there at no action cost', () => {
  const t = march('rome', 'caesar', { prepare: stockFor({ food: 1, ore: 1 }), ask: { caesar: 'yes' } });
  assert.equal(cityAt(t.g.s, t.hex).owner, 0);
  assert.equal(asksOf(t.asked, 'caesar').length, 1);
  assert.equal(asksOf(t.asked, 'caesar_unit').length, 0, 'Infantry is all he can afford, so there is nothing to choose');
  assert.equal(recruited(t, 'infantry').length, 1);
  const { food, ore, gold: coins } = me(t.g).res;
  assert.deepEqual([food, ore, coins], [0, 0, 0], 'the price of the unit and 1 Gold, out of the 1 Gold the city gave');
  assert.equal(t.g.s.turn.actionsLeft, t.actions - 1, 'the Move action is the only one spent');
  assert.equal(logged(t.g, /recruits .*Infantry/), true);
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Caesar: he chooses among the units he can afford, and the recruit cannot move in the same Move action', () => {
  const t = march('rome', 'caesar', {
    buildings: ['market'], prepare: stockFor({ food: 1, wood: 1, ore: 1 }), ask: { caesar: 'yes', caesar_unit: 'cavalry' },
  });
  assert.deepEqual(asksOf(t.asked, 'caesar_unit').map(optionIds), [['infantry', 'cavalry', 'elephant', 'settler']], 'Gold stands in for what he lacks; an Angry city holds one unit, so no Done');
  const [horse] = recruited(t, 'cavalry');
  assert.ok(horse);
  assert.equal(recruited(t, 'infantry').length, 0);
  const { food, wood, ore, gold: coins } = me(t.g).res;
  assert.deepEqual([food, wood, ore, coins], [0, 0, 1, 1], 'Cavalry and 1 Gold of the 2 Gold a city of size 2 gave');
  const step = (from) => nbrs(t.g.s, from).find((k) => free(t.g, k));
  act(t.g, { type: 'move', units: [t.soldier.id], to: step(t.cap.hex) });
  assert.equal(t.g.s.turn.actionsLeft, t.actions - 1, 'a unit that stayed home still moves in that Move action');
  act(t.g, { type: 'move', units: [horse.id], to: step(t.hex) });
  assert.equal(t.g.s.turn.actionsLeft, t.actions - 2, 'the recruit needs a Move action of its own');
});

test('Caesar: he asks nothing of a player who cannot pay, when he stays home or when another Leader takes the city', () => {
  const stocked = stockFor({ food: 1, ore: 1 });
  const yes = march('rome', 'caesar', { prepare: stocked });
  assert.equal(recruited(yes, 'infantry').length, 1, 'the default answer is to recruit');
  const declined = march('rome', 'caesar', { prepare: stocked, ask: { caesar: 'no' } });
  assert.deepEqual([asksOf(declined.asked, 'caesar').length, recruited(declined, 'infantry').length, gold(declined)], [1, 0, 1]);
  const broke = march('rome', 'caesar');
  assert.deepEqual([asksOf(broke.asked, 'caesar').length, recruited(broke, 'infantry').length, gold(broke)], [0, 0, 1]);
  const home = march('rome', 'caesar', { prepare: stocked, who: 'soldier' });
  assert.deepEqual([asksOf(home.asked, 'caesar').length, recruited(home, 'infantry').length], [0, 0], 'only with the Army that took it');
  const other = march('babylonia', 'hammurabi', { prepare: stocked });
  assert.deepEqual([asksOf(other.asked, 'caesar').length, recruited(other, 'infantry').length, gold(other)], [0, 0, 1], 'only his');
});

test('Wak Chanil Ajaw: after taking a city she may swap a piece of hers in it for another Building, at no action and no cost', () => {
  const t = march('maya', 'wak', { buildings: ['market'], advances: ['writing'], ask: { wak: 'yes', wak_build: 'academy' } });
  const city = cityAt(t.g.s, t.hex);
  assert.deepEqual([city.owner, city.buildings], [0, { academy: 0 }], 'the Market that was the foe\'s becomes hers, and she takes it out');
  assert.equal(asksOf(t.asked, 'wak_remove').length, 0, 'one piece, no choice');
  assert.deepEqual(asksOf(t.asked, 'wak_build').map(optionIds), [['academy', 'fortress']]);
  const { food, wood, ore, ideas } = me(t.g).res;
  assert.deepEqual([food, wood, ore, ideas], [0, 0, 0, 2], 'no resource is paid; the Academy still gives its 2 Ideas');
  assert.equal(t.g.s.turn.actionsLeft, t.actions - 1, 'the Move action is the only one spent');
  assert.equal(logged(t.g, /removes a market from the captured city \(Wak Chanil Ajaw\)/), true);
  assert.deepEqual(checkInvariants(t.g), []);
});

test('Wak Chanil Ajaw: she chooses which of her pieces goes, and may decline, which is the default', () => {
  const grown = { buildings: ['market', 'temple'], advances: ['writing'], prepare: (g, { cap }) => secondCity(g, cap) };
  const t = march('maya', 'wak', { ...grown, ask: { wak: 'yes', wak_remove: 'temple', wak_build: 'academy' } });
  assert.deepEqual(asksOf(t.asked, 'wak_remove').map(optionIds), [['market', 'temple']]);
  assert.deepEqual(cityAt(t.g.s, t.hex).buildings, { market: 0, academy: 0 });
  const left = march('maya', 'wak', grown);
  assert.equal(asksOf(left.asked, 'wak').length, 1);
  assert.deepEqual(cityAt(left.g.s, left.hex).buildings, { market: 0, temple: 0 });
  assert.equal(asksOf(left.asked, 'wak_remove').length, 0);
});

test('Wak Chanil Ajaw: nothing to ask when the city has no piece of hers, when she stays home or when another Leader takes it', () => {
  const asks = (t) => asksOf(t.asked, 'wak').length;
  const open = { buildings: ['market'], advances: ['writing'], ask: { wak: 'yes', wak_build: 'academy' } };
  assert.equal(asks(march('maya', 'wak', { advances: ['writing'] })), 0, 'a city without Buildings');
  const home = march('maya', 'wak', { ...open, who: 'soldier' });
  assert.deepEqual([asks(home), Object.keys(cityAt(home.g.s, home.hex).buildings)], [0, ['market']]);
  const other = march('maya', 'pakal', open);
  assert.deepEqual([asks(other), Object.keys(cityAt(other.g.s, other.hex).buildings)], [0, ['market']]);
});

// ------------------------------------------------------------- Cleopatra's tokens
test('Cleopatra: to attack a city that holds her tokens the attacker first pays as many Culture tokens, which removes them', () => {
  const siege = (culture, defended = false) => {
    const g = world(['rome', 'egypt']);
    const cap = capitalOf(g);
    give(g, 0, { advances: ['tactics'] });
    const [soldier] = troops(g, 0, 'infantry', cap.hex);
    const city = town(g, 1, ring(g, cap.hex, 1)[0]);
    city.beloved = 2;
    if (defended) troops(g, 1, 'infantry', city.hex);
    stock(g, 0, { culture });
    listen(g, 0, { retreat: 'yes' });
    g.drainEvents();
    return { g, hex: city.hex, move: { type: 'move', units: [soldier.id], to: city.hex } };
  };
  const poor = siege(1);
  assert.match(refused(poor.g, poor.move), /holds 2 Culture tokens \(Cleopatra\)/);
  assert.equal(cityAt(poor.g.s, poor.hex).beloved, 2, 'nothing was paid, nothing removed');

  const rich = siege(3);
  act(rich.g, rich.move);
  assert.equal(me(rich.g).culture, 1);
  assert.equal(logged(rich.g, /pays Culture tokens to remove the ones in the city at .* \(Cleopatra\)/), true);
  const city = cityAt(rich.g.s, rich.hex);
  assert.deepEqual([city.owner, city.beloved], [0, undefined]);
  assert.deepEqual(checkInvariants(rich.g), []);

  const beaten = siege(2, true);
  act(beaten.g, beaten.move);
  assert.deepEqual([me(beaten.g).culture, cityAt(beaten.g.s, beaten.hex).beloved], [0, undefined], 'paid, and gone, whoever wins');
});
