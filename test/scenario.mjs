// Helpers for hand-built rule scenarios used by the *.test.mjs files.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Game } from '../src/engine/game.js';
import { attachAI, chooseAction } from '../src/ai/index.js';
import { armyAt, bfs, nbrs } from '../src/engine/queries.js';
import { COMBAT_DIE } from '../src/engine/data/constants.js';
import { randInt, roll } from '../src/engine/rng.js';
import { checkInvariants } from './harness.mjs';

const auto = (_g, prompt) => prompt.default;

/** A started game (two players, or `opponents` + 1) where player `first` moves first and every question is answered with its default. */
export function fresh(seed = 'scenario', { ages, opponents = 1, first = 0 } = {}) {
  const seats = Array.from({ length: opponents + 1 }, () => true);
  const g = Game.create({ seed, humans: seats, ages, opponents });
  g.s.first = first;
  g.s.current = first;
  g.policy = seats.map(() => auto);
  g.begin();
  return g;
}

export function act(g, action) {
  const r = g.apply(action);
  assert.ok(r.ok, `${JSON.stringify(action)} was refused: ${r.error}`);
  return r;
}

/** Apply an action that must be refused; the state has to stay exactly as it was. Returns the message. */
export function refused(g, action) {
  const before = JSON.stringify(g.s);
  const r = g.apply(action);
  assert.equal(r.ok, false, `${JSON.stringify(action)} should have been refused`);
  assert.equal(JSON.stringify(g.s), before, 'a refused action must not change the game');
  return r.error;
}

export const capitalOf = (g, p = 0) => g.s.cities.find((c) => c.owner === p);
export const settlerOf = (g, p = 0) => g.s.units.find((u) => u.owner === p && u.type === 'settler');
export const neighbourWith = (g, hex, terrain) => nbrs(g.s, hex).find((k) => g.s.map.hexes[k].terrain === terrain);

/** Give player p what a scenario needs: res, mood, culture, advances (added), cards. */
export function give(g, p, { res = {}, mood, culture, advances = [], wonders = [] } = {}) {
  const pl = g.s.players[p];
  Object.assign(pl.res, res);
  if (mood !== undefined) pl.mood = mood;
  if (culture !== undefined) pl.culture = culture;
  for (const a of advances) if (!pl.advances.includes(a)) pl.advances.push(a);
  for (const w of wonders) {
    g.s.decks.wonder = g.s.decks.wonder.filter((x) => x !== w);
    pl.hand.wonder.push(w);
  }
}

/** A new city for p on a land hex that is not occupied yet. */
export function addCityAt(g, p, hex, mood = 'neutral') {
  const city = { id: `t${g.s.nextId++}`, owner: p, hex, mood, buildings: {}, wonders: [], port: null };
  g.s.cities.push(city);
  return city;
}

/** Turn the unexplored hexes around `hex` into Plains so a scenario can put units and cities there. Returns { k, d } pairs. */
export function openLand(g, hex, depth) {
  const ring = bfs(g.s, hex, depth, () => true);
  for (const k of ring.keys()) if (g.s.map.hexes[k].terrain === null) g.s.map.hexes[k].terrain = 'plains';
  return [...ring].map(([k, d]) => ({ k, d }));
}
export const ringOf = (list, d) => list.filter((x) => x.d === d).map((x) => x.k);
/** Only the Plains of a ring: no terrain rule gets in the way of a city, a move or a battle there. */
export const plains = (g, list, d) => ringOf(list, d).filter((k) => g.s.map.hexes[k].terrain === 'plains');
/** The sorted unit types of one owner's Army in a hex. */
export const kinds = (g, hex, owner = 0) => armyAt(g.s, hex, owner).map((u) => u.type).sort();

/** Answer prompts with `answers[kind]` when given (a function of the prompt or a fixed value); record every prompt. */
export function listen(g, p, answers = {}) {
  const asked = [];
  g.policy[p] = (_g, prompt) => {
    asked.push(prompt);
    const a = answers[prompt.kind];
    return typeof a === 'function' ? a(prompt) : a !== undefined ? a : prompt.default;
  };
  return asked;
}

export const landBattle = (attacker, defender, hex, from, units) => ({
  domain: 'land', attacker, defender, hex, from, units, settlers: [], carried: [], landed: false, inPlace: false,
});

/** Replace player p's Action hand with exactly these cards, taken from the draw pile; the old hand goes back, so the cards stay conserved. */
export function hold(g, p, ...cards) {
  const pl = g.s.players[p];
  g.s.decks.action.unshift(...pl.hand.action);
  pl.hand.action = [];
  for (const id of cards) {
    const i = g.s.decks.action.indexOf(id);
    assert.ok(i >= 0, `${id} is not in the Action draw pile`);
    g.s.decks.action.splice(i, 1);
    pl.hand.action.push(id);
  }
}

/** Move the random generator to a state whose next draws satisfy `fits` (which draws from a throwaway generator), so a scenario can fix rolls. */
function rig(g, fits) {
  for (let seed = 1; seed < 50_000_000; seed++) {
    if (fits({ rng: seed })) {
      g.s.rng = seed;
      return;
    }
  }
  assert.fail('no random state gives these rolls');
}

/** The next d6 rolls (an Influence Culture roll, for instance) will be exactly `faces`. */
export const rigRolls = (g, ...faces) => rig(g, (st) => faces.every((f) => roll(st, 6) === f));

/**
 * The next dice of a battle will show these faces, as `[value, icon]` pairs of the Combat die, in the order they are rolled
 * (the attacker's dice first, then the defender's; a Confusion reroll comes after both).
 */
export function rigDice(g, ...faces) {
  const slots = faces.map(([v, icon]) => COMBAT_DIE.flatMap(([value, i], k) => (value === v && i === icon ? [k] : [])));
  assert.ok(slots.every((s) => s.length), 'the Combat die has no such face');
  rig(g, (st) => slots.every((s) => s.includes(randInt(st, COMBAT_DIE.length))));
}

/** A quote-aware CSV file from source/ as rows of cells (the header row included); null when the file is not there. */
export function readCsv(name) {
  const file = new URL(`../source/${name}`, import.meta.url);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Computer players play a whole game (two of them, or `opponents` + 1); invariants are checked after every action. `prepare(g)` may set the table up before the first turn, `turn(g, p)` before each turn of player p. */
export function playAIGame(seed, { maxTurns = 400, ages, opponents = 1, prepare, turn } = {}) {
  const seats = opponents + 1;
  const g = Game.create({ seed: String(seed), humans: Array.from({ length: seats }, () => false), ages, opponents });
  for (let p = 0; p < seats; p++) attachAI(g, p);
  if (prepare) prepare(g);
  g.begin();
  const problems = [];
  for (let turns = 0; g.s.phase !== 'over' && turns < maxTurns; turns++) {
    const p = g.cur;
    turn?.(g, p);
    for (let n = 0; g.s.phase !== 'over' && g.cur === p && n < 40; n++) {
      const choice = chooseAction(g, p);
      let r = g.apply(choice.action);
      if (!r.ok) r = g.apply({ type: 'end_turn' });
      problems.push(...checkInvariants(g));
      g.drainEvents();
      if (problems.length) return { g, problems };
    }
  }
  return { g, problems };
}
