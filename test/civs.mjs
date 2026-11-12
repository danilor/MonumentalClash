// Fixtures shared by the Civilizations tests (test/civilizations.test.mjs and test/civ-*.test.mjs).
import assert from 'node:assert/strict';
import { BARBARIAN, PIRATE } from '../src/engine/data/constants.js';
import { step } from '../src/engine/hex.js';
import { addUnit } from '../src/engine/state.js';
import { allHexKeys, bfs, cityAt, hexDistance, nbrs, unitsAt } from '../src/engine/queries.js';
import { addCityAt, fresh, give, giveCiv } from './scenario.mjs';

export const me = (g, p = 0) => g.s.players[p];
export const ofType = (events, type) => events.filter((e) => e.type === type);
export const optionIds = (prompt) => prompt.options.map((o) => o.id);
export const logged = (g, pattern) => g.s.log.some((line) => pattern.test(line));
/** The six directions, counter-clockwise from the east: `step(k, E)`. */
export const [E, NE, NW, W, SW, SE] = [0, 1, 2, 3, 4, 5];

/**
 * A table where every space is Plains, so a scenario can make Sea or Mountains and put cities and units wherever it needs them.
 * `civs` names the peoples of the first seats (a string for one); every seat without a name is dealt one.
 */
export function world(civs = [], { opponents = 1, seed = 'civ' } = {}) {
  const g = fresh(seed, { opponents, civs: [].concat(civs) });
  for (const h of Object.values(g.s.map.hexes)) h.terrain = 'plains';
  return g;
}

/** Player p of a `world` holds these Civilization Advances (and the Advances that trigger them). */
export const power = (g, p, ...ids) => giveCiv(g, p, ...ids);

export const free = (g, k) => !cityAt(g.s, k) && !unitsAt(g.s, k).length;
/** The spaces exactly `d` steps from `k` that nothing stands on, in map order. */
export const ring = (g, k, d) => allHexKeys(g.s).filter((x) => hexDistance(k, x) === d && free(g, x));
export const setTerrain = (g, k, terrain) => {
  g.s.map.hexes[k].terrain = terrain;
};

/** A stretch of the map where nothing stands within 2 spaces of `o`; `at(E, NE)` walks from `o` one step east and one north-east. The map of two players has no such stretch: use `world(civs, { opponents: 2 })` or more. */
export function bay(g) {
  const o = allHexKeys(g.s).find((k) => {
    const disc = bfs(g.s, k, 2, () => true);
    return disc.size === 19 && [...disc.keys()].every((x) => free(g, x));
  });
  assert.ok(o, 'the map has room for the scenario (three players or more)');
  return { o, at: (...dirs) => dirs.reduce((k, d) => step(k, d), o) };
}

/** A city of p with these Buildings (never a Port: see `harbour`). */
export function town(g, p, k, mood = 'neutral', buildings = []) {
  const c = addCityAt(g, p, k, mood);
  for (const b of buildings) c.buildings[b] = p;
  return c;
}

/** Give a city a Port: a free space next to it becomes the Sea space of its harbour. Returns that space. */
export function harbour(g, c) {
  const sea = nbrs(g.s, c.hex).find((k) => free(g, k));
  setTerrain(g, sea, 'sea');
  c.buildings.port = c.owner;
  c.port = sea;
  return sea;
}

export const troops = (g, p, type, k, n = 1) => Array.from({ length: n }, () => addUnit(g.s, p, type, k));
export const pirates = (g, ...hexes) => hexes.map((k) => addUnit(g.s, PIRATE, 'ship', k));
export const barbarians = (g, type, k, n = 1) => troops(g, BARBARIAN, type, k, n);

/** Exactly this much of everything: the Resources of a player, with Mood and Culture tokens. */
export const stock = (g, p, { mood = 0, culture = 0, ...res } = {}) => give(g, p, { res: { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0, ...res }, mood, culture });

/** Every player answers with `answers[kind]` (a value, or a function of the prompt) and otherwise with the default. Returns the prompts asked. */
export function asking(g, answers = {}) {
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

/** Run a flow of the engine to its end; every question is answered by the policy. Returns the events. */
export function run(g, flow) {
  g.drainEvents();
  const r = g._run(flow);
  assert.ok(r.ok, r.error);
  assert.equal(g.pending, null, 'no question is left open');
  return g.drainEvents();
}

/** Put these Event cards on top of the draw pile; the first one is drawn first. */
export function stack(g, ...ids) {
  const d = g.s.decks;
  d.event = d.event.filter((x) => !ids.includes(x));
  d.eventDiscard = d.eventDiscard.filter((x) => !ids.includes(x));
  d.event.push(...[...ids].reverse());
}
