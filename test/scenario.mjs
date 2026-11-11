// Helpers for hand-built rule scenarios used by the *.test.mjs files.
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.js';
import { attachAI, chooseAction } from '../src/ai/index.js';
import { nbrs } from '../src/engine/queries.js';
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

/** Computer players play a whole game (two of them, or `opponents` + 1); invariants are checked after every action. */
export function playAIGame(seed, { maxTurns = 400, ages, opponents = 1 } = {}) {
  const seats = opponents + 1;
  const g = Game.create({ seed: String(seed), humans: Array.from({ length: seats }, () => false), ages, opponents });
  for (let p = 0; p < seats; p++) attachAI(g, p);
  g.begin();
  const problems = [];
  for (let turns = 0; g.s.phase !== 'over' && turns < maxTurns; turns++) {
    const p = g.cur;
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
